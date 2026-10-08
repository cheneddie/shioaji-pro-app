// src/features/orderflow/runtime/market-event-bridge.ts
// Development 1: lossless regular-lot market-event bridge for future
// Order Flow aggregation. It reuses stream.ts listeners and never opens,
// retains, or subscribes another market-data connection.

import { onAnyBidAsk, onRawTick } from '../../../lib/stream';
import type { SseBidAsk, SseTick } from '../../../lib/types/market';

export interface OrderFlowRawTick {
    code: string;
    date: string;
    time: string;
    price: number | null;
    volume: number;
    totalVolume: number;
    tickType: number;
    simtrade: boolean;
    intradayOdd: boolean;
    raw: SseTick;
}

export interface OrderFlowRawBookLevel {
    price: number | null;
    volume: number;
    diffVolume?: number;
}

export interface OrderFlowRawBook {
    code: string;
    date: string;
    time: string;
    bids: OrderFlowRawBookLevel[];
    asks: OrderFlowRawBookLevel[];
    simtrade: boolean;
    intradayOdd: boolean;
    raw: SseBidAsk;
}

function finitePrice(value: string | undefined): number | null {
    if (value === undefined || value.trim() === '') return null;
    const price = Number(value);
    return Number.isFinite(price) ? price : null;
}

function bookLevels(
    prices: string[],
    volumes: number[],
    diffs?: number[],
): OrderFlowRawBookLevel[] {
    const count = Math.max(prices.length, volumes.length);
    return Array.from({ length: count }, (_, index) => ({
        price: finitePrice(prices[index]),
        volume: Number.isFinite(volumes[index]) ? volumes[index]! : 0,
        ...(Number.isFinite(diffs?.[index])
            ? { diffVolume: diffs![index]! }
            : {}),
    }));
}

export function normalizeOrderFlowTick(tick: SseTick): OrderFlowRawTick {
    return {
        code: tick.code,
        date: tick.date,
        time: tick.time,
        price: finitePrice(tick.close),
        volume: tick.volume,
        totalVolume: tick.total_volume,
        tickType: tick.tick_type,
        simtrade: tick.simtrade === true,
        intradayOdd: tick.intraday_odd === true,
        raw: tick,
    };
}

export function normalizeOrderFlowBook(bidask: SseBidAsk): OrderFlowRawBook {
    return {
        code: bidask.code,
        date: bidask.date,
        time: bidask.time,
        bids: bookLevels(
            bidask.bid_price,
            bidask.bid_volume,
            bidask.diff_bid_vol,
        ),
        asks: bookLevels(
            bidask.ask_price,
            bidask.ask_volume,
            bidask.diff_ask_vol,
        ),
        simtrade: bidask.simtrade === true,
        intradayOdd: bidask.intraday_odd === true,
        raw: bidask,
    };
}

export function subscribeOrderFlowTicks(
    displayCode: string,
    listener: (tick: OrderFlowRawTick) => void,
    sourceCode = displayCode,
) {
    return onRawTick((tick) => {
        // Raw listeners see the physical event first and stream.ts may emit
        // an additional display-alias clone afterwards. Bind Order Flow to
        // the expected physical source so a continuous-contract rollover
        // cannot mix the old target into the new runtime.
        if (tick.code !== sourceCode || tick.intraday_odd) return;
        listener({
            ...normalizeOrderFlowTick(tick),
            code: displayCode,
        });
    });
}

export function subscribeOrderFlowBooks(
    displayCode: string,
    listener: (book: OrderFlowRawBook) => void,
    sourceCode = displayCode,
) {
    return onAnyBidAsk((bidask) => {
        if (bidask.code !== sourceCode || bidask.intraday_odd) return;
        listener({
            ...normalizeOrderFlowBook(bidask),
            code: displayCode,
        });
    });
}
