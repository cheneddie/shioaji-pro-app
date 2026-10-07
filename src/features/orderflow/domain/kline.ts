// src/features/orderflow/domain/kline.ts

import {
    filterDaySession,
    isDaySessionTick,
} from '../../../lib/intraday-session';
import type { SecurityType } from '../../../lib/types/contract';
import type { Candle, KBars } from '../../../lib/types/market';
import { aggregate, kbarsToCandles, wallClockToUtc } from '../../../lib/utils/kbars';
import type { OrderFlowRawTick } from '../runtime/market-event-bridge';

export interface OrderFlowKlineTrade {
    /** Exchange event time in wall-clock encoded UTC seconds. */
    eventTime: number;
    /** close-label-right candle bucket. */
    time: number;
    price: number;
    volume: number;
}

function orderFlowHistoryRaw(
    source: KBars,
    securityType: SecurityType,
    dayOnly: boolean,
): Candle[] {
    const raw = kbarsToCandles(source);
    return dayOnly ? filterDaySession(securityType, raw) : raw;
}

export function orderFlowHistoryCutoff(
    source: KBars,
    securityType: SecurityType,
    dayOnly: boolean,
): number {
    return orderFlowHistoryRaw(source, securityType, dayOnly).at(-1)?.time ?? -Infinity;
}

export function orderFlowHistoryBars(
    source: KBars,
    minutes: number,
    securityType: SecurityType,
    dayOnly: boolean,
): Candle[] {
    return aggregate(
        orderFlowHistoryRaw(source, securityType, dayOnly),
        minutes,
    );
}

export function projectOrderFlowTick(
    tick: OrderFlowRawTick,
    minutes: number,
    securityType: SecurityType,
    dayOnly: boolean,
): OrderFlowKlineTrade | null {
    if (
        tick.simtrade ||
        tick.volume <= 0 ||
        tick.price === null ||
        !Number.isFinite(tick.price)
    ) {
        return null;
    }
    const eventTime = wallClockToUtc(`${tick.date}T${tick.time}`);
    if (!Number.isFinite(eventTime)) return null;
    if (dayOnly && !isDaySessionTick(securityType, eventTime)) return null;

    const bucketSeconds = minutes * 60;
    const time =
        minutes >= 1440
            ? Math.floor(eventTime / 86400) * 86400
            : Math.floor(eventTime / bucketSeconds) * bucketSeconds +
              bucketSeconds;
    return { eventTime, time, price: tick.price, volume: tick.volume };
}

export function applyOrderFlowTrade(
    last: Candle | null,
    trade: OrderFlowKlineTrade,
): { bar: Candle; append: boolean } | null {
    if (!last || trade.time > last.time) {
        return {
            append: true,
            bar: {
                time: trade.time,
                open: trade.price,
                high: trade.price,
                low: trade.price,
                close: trade.price,
                volume: trade.volume,
            },
        };
    }
    if (trade.time < last.time) return null;
    return {
        append: false,
        bar: {
            ...last,
            high: Math.max(last.high, trade.price),
            low: Math.min(last.low, trade.price),
            close: trade.price,
            volume: last.volume + trade.volume,
        },
    };
}
