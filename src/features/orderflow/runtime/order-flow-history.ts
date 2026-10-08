// src/features/orderflow/runtime/order-flow-history.ts

import { getApiBase } from '../../../lib/runtime';
import { fetchHistoryTicks } from '../../../lib/shioaji';
import type { ContractBase } from '../../../lib/types/contract';
import {
    ORDER_FLOW_HISTORY_CACHE_LIMIT,
} from '../domain/constants';
import type {
    OrderFlowHistory,
    OrderFlowHistoryTick,
} from '../domain/types';
import { classifyTickType } from './tick-aggregator';
import { parseHistoryDateTimeMs } from './event-time';

let revision = 0;
const requests = new Map<string, Promise<OrderFlowHistory>>();

export const nextOrderFlowHistoryRevision = () => ++revision;

function requestKey(
    contract: ContractBase,
    date: string,
    requestRevision: number,
) {
    return JSON.stringify([
        getApiBase(),
        contract.region ?? 'TW',
        contract.security_type,
        contract.exchange,
        contract.code,
        contract.target_code,
        date,
        requestRevision,
    ]);
}

function finiteNumber(value: number | undefined): number | null {
    return value !== undefined && Number.isFinite(value) ? value : null;
}

export function fetchOrderFlowHistory(
    contract: ContractBase,
    date: string,
    opts?: { revision?: number },
): Promise<OrderFlowHistory> {
    const key = requestKey(contract, date, opts?.revision ?? 0);
    let request = requests.get(key);
    if (!request) {
        request = fetchHistoryTicks(contract, date).then((source) => {
            const count = Math.max(
                source.datetime.length,
                source.close.length,
                source.volume.length,
                source.tick_type.length,
            );
            const ticks: OrderFlowHistoryTick[] = Array.from(
                { length: count },
                (_, index) => {
                    const datetime = source.datetime[index] ?? '';
                    const price = finiteNumber(source.close[index]);
                    const volume = source.volume[index] ?? 0;
                    const tickType = source.tick_type[index] ?? 0;
                    return {
                        datetime,
                        eventTimeMs: parseHistoryDateTimeMs(datetime),
                        price,
                        volume: Number.isFinite(volume) ? volume : 0,
                        tickType,
                        side: classifyTickType(tickType),
                    };
                },
            );
            return { date, ticks };
        }).catch((error) => {
            // A transient network/broker failure must not poison this
            // request key forever. Keep concurrent callers coalesced during
            // the failed attempt but allow a later same-revision retry.
            if (requests.get(key) === request) requests.delete(key);
            throw error;
        });
        requests.set(key, request);
        if (requests.size > ORDER_FLOW_HISTORY_CACHE_LIMIT) {
            const oldest = requests.keys().next().value;
            if (oldest !== undefined) requests.delete(oldest);
        }
    }
    return request;
}
