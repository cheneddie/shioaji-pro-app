// src/features/orderflow/runtime/tick-aggregator.ts

import {
    ORDER_FLOW_MOVING_WINDOW_SECONDS,
    ORDER_FLOW_RECENT_TICK_DEDUPE_LIMIT,
} from '../domain/constants';
import type {
    OrderFlowSide,
    OrderFlowVolumeBucket,
} from '../domain/types';
import type { OrderFlowRawTick } from './market-event-bridge';
import { parseExchangeEventTimeMs } from './event-time';

interface MovingTrade {
    eventTimeMs: number;
    price: number;
    side: OrderFlowSide;
    volume: number;
}

const emptyBucket = (): OrderFlowVolumeBucket => ({
    buy: 0,
    sell: 0,
    neutral: 0,
    total: 0,
});

function addBucket(
    map: Map<number, OrderFlowVolumeBucket>,
    price: number,
    side: OrderFlowSide,
    volume: number,
) {
    const bucket = map.get(price) ?? emptyBucket();
    bucket[side] += volume;
    bucket.total += volume;
    map.set(price, bucket);
}

function subtractBucket(
    map: Map<number, OrderFlowVolumeBucket>,
    price: number,
    side: OrderFlowSide,
    volume: number,
) {
    const bucket = map.get(price);
    if (!bucket) return;
    bucket[side] = Math.max(0, bucket[side] - volume);
    bucket.total = Math.max(0, bucket.total - volume);
    if (bucket.total === 0) map.delete(price);
}

export function classifyTickType(tickType: number): OrderFlowSide {
    if (tickType === 1) return 'buy';
    if (tickType === 2) return 'sell';
    return 'neutral';
}

export class TickAggregator {
    readonly daily = new Map<number, OrderFlowVolumeBucket>();
    readonly moving = new Map<number, OrderFlowVolumeBucket>();

    rawTickCount = 0;
    tradeTickCount = 0;
    duplicateTickCount = 0;
    outOfOrderTickCount = 0;
    invalidEventTimeCount = 0;
    lastObservedEventTimeMs: number | null = null;
    lastPrice: number | null = null;

    private watermarkMs: number | null = null;
    private movingTrades: MovingTrade[] = [];
    private recentKeys = new Map<string, true>();
    private readonly windowMs: number;

    constructor(windowSeconds = ORDER_FLOW_MOVING_WINDOW_SECONDS) {
        this.windowMs = windowSeconds * 1000;
    }

    ingest(tick: OrderFlowRawTick) {
        this.rawTickCount += 1;
        const eventTimeMs = parseExchangeEventTimeMs(tick.date, tick.time);
        if (eventTimeMs === null) this.invalidEventTimeCount += 1;
        else {
            this.lastObservedEventTimeMs =
                this.lastObservedEventTimeMs === null
                    ? eventTimeMs
                    : Math.max(this.lastObservedEventTimeMs, eventTimeMs);
        }

        const key = [
            tick.code,
            tick.date,
            tick.time,
            tick.price,
            tick.volume,
            tick.totalVolume,
            tick.tickType,
            tick.simtrade ? 1 : 0,
        ].join('|');
        if (this.recentKeys.has(key)) {
            this.duplicateTickCount += 1;
            return { changed: false, duplicate: true };
        }
        this.recentKeys.set(key, true);
        if (this.recentKeys.size > ORDER_FLOW_RECENT_TICK_DEDUPE_LIMIT) {
            const oldest = this.recentKeys.keys().next().value;
            if (oldest !== undefined) this.recentKeys.delete(oldest);
        }

        if (eventTimeMs !== null) {
            if (this.watermarkMs !== null && eventTimeMs < this.watermarkMs) {
                this.outOfOrderTickCount += 1;
            }
            this.watermarkMs =
                this.watermarkMs === null
                    ? eventTimeMs
                    : Math.max(this.watermarkMs, eventTimeMs);
            this.evictExpired();
        }

        if (
            tick.simtrade ||
            tick.volume <= 0 ||
            tick.price === null ||
            !Number.isFinite(tick.price)
        ) {
            return { changed: false, duplicate: false };
        }

        const side = classifyTickType(tick.tickType);
        this.tradeTickCount += 1;
        this.lastPrice = tick.price;
        addBucket(this.daily, tick.price, side, tick.volume);

        if (eventTimeMs !== null && this.watermarkMs !== null) {
            const cutoff = this.watermarkMs - this.windowMs;
            if (eventTimeMs >= cutoff) {
                const trade: MovingTrade = {
                    eventTimeMs,
                    price: tick.price,
                    side,
                    volume: tick.volume,
                };
                let index = this.movingTrades.length;
                while (
                    index > 0 &&
                    this.movingTrades[index - 1]!.eventTimeMs > eventTimeMs
                ) {
                    index -= 1;
                }
                this.movingTrades.splice(index, 0, trade);
                addBucket(this.moving, tick.price, side, tick.volume);
            }
        }

        return { changed: true, duplicate: false };
    }

    private evictExpired() {
        if (this.watermarkMs === null) return;
        const cutoff = this.watermarkMs - this.windowMs;
        while (
            this.movingTrades.length > 0 &&
            this.movingTrades[0]!.eventTimeMs < cutoff
        ) {
            const expired = this.movingTrades.shift()!;
            subtractBucket(
                this.moving,
                expired.price,
                expired.side,
                expired.volume,
            );
        }
    }
}
