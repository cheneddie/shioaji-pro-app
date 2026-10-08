import { describe, expect, it } from 'vitest';
import type { KBars } from '../../../lib/types/market';
import type { OrderFlowRawTick } from '../runtime/market-event-bridge';
import {
    applyOrderFlowTrade,
    orderFlowHistoryBars,
    orderFlowHistoryCutoff,
    projectOrderFlowTick,
} from './kline';

const history: KBars = {
    datetime: [
        '2026-10-07T08:46:00',
        '2026-10-07T08:47:00',
        '2026-10-07T15:01:00',
    ],
    Open: [100, 101, 200],
    High: [102, 103, 202],
    Low: [99, 100, 199],
    Close: [101, 102, 201],
    Volume: [2, 3, 7],
    Amount: [0, 0, 0],
};

function tick(
    time: string,
    patch: Partial<OrderFlowRawTick> = {},
): OrderFlowRawTick {
    return {
        code: 'TXFR1',
        date: '2026/10/07',
        time,
        price: 101,
        volume: 2,
        totalVolume: 100,
        tickType: 1,
        simtrade: false,
        intradayOdd: false,
        raw: {
            code: 'TXFJ6',
            date: '2026/10/07',
            time,
            open: '100',
            high: '102',
            low: '99',
            close: '101',
            volume: 2,
            total_volume: 100,
            tick_type: 1,
        },
        ...patch,
    };
}

describe('Order Flow K-line projection', () => {
    it('reuses the native day-session filter before K-bar aggregation', () => {
        const all = orderFlowHistoryBars(history, 5, 'FUT', false);
        expect(all).toHaveLength(2);
        expect(all[0]).toMatchObject({ time: expect.any(Number), open: 100, close: 102, volume: 5 });
        expect(all[1]).toMatchObject({ open: 200, close: 201, volume: 7 });

        const day = orderFlowHistoryBars(history, 5, 'FUT', true);
        expect(day).toHaveLength(1);
        expect(day[0]).toMatchObject({ open: 100, close: 102, volume: 5 });
        expect(orderFlowHistoryCutoff(history, 'FUT', true)).toBe(
            day[0]!.time - 180,
        );
        expect(orderFlowHistoryCutoff(history, 'FUT', false)).toBeGreaterThan(
            orderFlowHistoryCutoff(history, 'FUT', true),
        );
    });

    it('projects real raw ticks into close-label-right buckets and rejects non-trades', () => {
        expect(projectOrderFlowTick(tick('10:00:00.000'), 5, 'FUT', false)).toMatchObject({
            eventTime: expect.any(Number),
            price: 101,
            volume: 2,
        });
        const at = projectOrderFlowTick(tick('10:00:00.000'), 5, 'FUT', false)!;
        const before = projectOrderFlowTick(tick('09:59:59.999'), 5, 'FUT', false)!;
        expect(at.time - before.time).toBe(300);

        expect(projectOrderFlowTick(tick('10:00:00.000', { simtrade: true }), 5, 'FUT', false)).toBeNull();
        expect(projectOrderFlowTick(tick('10:00:00.000', { volume: 0 }), 5, 'FUT', false)).toBeNull();
        expect(projectOrderFlowTick(tick('10:00:00.000', { price: null }), 5, 'FUT', false)).toBeNull();
        expect(projectOrderFlowTick(tick('15:00:01.000'), 5, 'FUT', true)).toBeNull();
    });

    it('appends new buckets, updates the current bucket and ignores older buckets', () => {
        const first = applyOrderFlowTrade(null, { eventTime: 90, time: 100, price: 10, volume: 2 })!;
        expect(first).toEqual({
            append: true,
            bar: { time: 100, open: 10, high: 10, low: 10, close: 10, volume: 2 },
        });
        const same = applyOrderFlowTrade(first.bar, { eventTime: 95, time: 100, price: 12, volume: 3 })!;
        expect(same).toEqual({
            append: false,
            bar: { time: 100, open: 10, high: 12, low: 10, close: 12, volume: 5 },
        });
        expect(applyOrderFlowTrade(same.bar, { eventTime: 80, time: 99, price: 9, volume: 1 })).toBeNull();
    });
});
