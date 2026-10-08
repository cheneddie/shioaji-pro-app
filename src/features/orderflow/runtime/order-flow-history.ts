// src/features/orderflow/runtime/order-flow-history.ts

import { getApiBase } from '../../../lib/runtime';
import { fetchHistoryTicks } from '../../../lib/shioaji';
import { dateStrOffset } from '../../../lib/utils/kbars';
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
        // Current and future trading dates are never immutable historical
        // datasets. A night-session date can be days ahead of wall-clock
        // today; do not cache an empty/partial intraday API result forever.
        const completedTradingDate = date < dateStrOffset(0);
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
            if (requests.get(key) === request) requests.delete(key);
            throw error;
        }).finally(() => {
            // Only completed trading days may retain their resolved promise.
            // Active/future dates must be fetched afresh on the next open,
            // without introducing an API polling loop.
            if (!completedTradingDate && requests.get(key) === request) {
                requests.delete(key);
            }
        });
        requests.set(key, request);
        if (requests.size > ORDER_FLOW_HISTORY_CACHE_LIMIT) {
            const oldest = requests.keys().next().value;
            if (oldest !== undefined) requests.delete(oldest);
        }
    }
    return request;
}
