import { describe, expect, it } from 'vitest';
import type { SseTick } from '../../../lib/types/market';
import type { OrderFlowRawTick } from './market-event-bridge';
import { TickAggregator, classifyTickType } from './tick-aggregator';

function raw(
    time: string,
    patch: Partial<OrderFlowRawTick> = {},
): OrderFlowRawTick {
    const baseRaw: SseTick = {
        code: 'TXFF6',
        date: '2026/10/07',
        time,
        open: '27100',
        high: '27120',
        low: '27090',
        close: '27110',
        volume: 1,
        total_volume: 100,
        tick_type: 1,
        intraday_odd: false,
        simtrade: false,
    };
    return {
        code: 'TXFF6',
        date: '2026/10/07',
        time,
        price: 27110,
        volume: 1,
        totalVolume: 100,
        tickType: 1,
        simtrade: false,
        intradayOdd: false,
        raw: baseRaw,
        ...patch,
    };
}

describe('TickAggregator', () => {
    it('uses upstream tick_type as buy/sell/neutral without price-direction guessing', () => {
        expect(classifyTickType(1)).toBe('buy');
        expect(classifyTickType(2)).toBe('sell');
        expect(classifyTickType(0)).toBe('neutral');
        expect(classifyTickType(99)).toBe('neutral');

        const agg = new TickAggregator(300);
        agg.ingest(raw('10:00:00.000', { volume: 3, totalVolume: 100, tickType: 1 }));
        agg.ingest(raw('10:00:01.000', { volume: 2, totalVolume: 102, tickType: 2 }));
        agg.ingest(raw('10:00:02.000', { volume: 4, totalVolume: 106, tickType: 0 }));

        expect(agg.daily.get(27110)).toEqual({
            buy: 3,
            sell: 2,
            neutral: 4,
            total: 9,
        });
        expect(agg.moving.get(27110)).toEqual({
            buy: 3,
            sell: 2,
            neutral: 4,
            total: 9,
        });
    });

    it('expires moving flow strictly by event-time while retaining session totals', () => {
        const agg = new TickAggregator(300);
        agg.ingest(raw('10:00:00.000', { volume: 5, totalVolume: 100 }));
        agg.ingest(raw('10:05:00.000', { volume: 7, totalVolume: 107, price: 27111 }));
        expect(agg.moving.get(27110)?.total).toBe(5); // exact boundary remains
        agg.ingest(raw('10:05:00.001', { volume: 1, totalVolume: 108, price: 27112 }));
        expect(agg.moving.has(27110)).toBe(false);
        expect(agg.daily.get(27110)?.total).toBe(5);
    });

    it('inserts in-window out-of-order trades but excludes arrivals older than the moving window', () => {
        const agg = new TickAggregator(300);
        agg.ingest(raw('10:10:00.000', { volume: 2, totalVolume: 200, price: 27120 }));
        agg.ingest(raw('10:08:00.000', { volume: 3, totalVolume: 150, price: 27119 }));
        agg.ingest(raw('10:04:59.000', { volume: 4, totalVolume: 120, price: 27118 }));

        expect(agg.outOfOrderTickCount).toBe(2);
        expect(agg.moving.get(27119)?.total).toBe(3);
        expect(agg.moving.has(27118)).toBe(false);
        expect(agg.daily.get(27118)?.total).toBe(4);
    });

    it('deduplicates exact recent tick replays without double-counting volume', () => {
        const agg = new TickAggregator();
        const tick = raw('10:00:00.000', { volume: 6, totalVolume: 106 });
        agg.ingest(tick);
        agg.ingest(tick);

        expect(agg.rawTickCount).toBe(2);
        expect(agg.tradeTickCount).toBe(1);
        expect(agg.duplicateTickCount).toBe(1);
        expect(agg.daily.get(27110)?.total).toBe(6);
        expect(agg.moving.get(27110)?.total).toBe(6);
    });

    it('observes simtrade and zero-volume ticks but excludes them from executed-flow aggregation', () => {
        const agg = new TickAggregator();
        agg.ingest(raw('10:00:00.000', { simtrade: true, volume: 9, totalVolume: 90 }));
        agg.ingest(raw('10:00:01.000', { volume: 0, totalVolume: 90 }));
        expect(agg.rawTickCount).toBe(2);
        expect(agg.tradeTickCount).toBe(0);
        expect(agg.daily.size).toBe(0);
        expect(agg.moving.size).toBe(0);
        expect(agg.lastPrice).toBeNull();
    });

    it('keeps real trades with invalid event time in session totals but not the moving window', () => {
        const agg = new TickAggregator();
        agg.ingest(raw('bad-time', { volume: 5, totalVolume: 105 }));
        expect(agg.invalidEventTimeCount).toBe(1);
        expect(agg.daily.get(27110)?.total).toBe(5);
        expect(agg.moving.size).toBe(0);
    });
});
