import { describe, expect, it } from 'vitest';
import type { OrderFlowRawTick } from './market-event-bridge';
import { TickAggregator } from './tick-aggregator';

function tick(index: number): OrderFlowRawTick {
    const minute = Math.floor(index / 60_000);
    const second = Math.floor(index / 1000) % 60;
    const ms = index % 1000;
    const time = `10:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
    const price = 25000 + index % 10;
    const tickType = (index % 3) as 0 | 1 | 2;
    return {
        code: 'TXFR1', date: '2026/10/08', time,
        price, volume: 1, totalVolume: index + 1,
        tickType, simtrade: false, intradayOdd: false,
        raw: {
            code: 'TXFJ6', date: '2026/10/08', time,
            open: String(price), high: String(price),
            low: String(price), close: String(price),
            volume: 1, total_volume: index + 1,
            tick_type: tickType, simtrade: false,
        },
    };
}

describe('Development 8 bounded synthetic Order Flow stress', () => {
    it.each([10_000, 50_000, 100_000])(
        'keeps 300-second moving volumes correct over %i sequential raw ticks',
        (count) => {
            const aggregator = new TickAggregator(300);
            let duplicates = 0;
            for (let i = 0; i < count; i++) {
                if (aggregator.ingest(tick(i)).duplicate) duplicates++;
            }
            expect(duplicates).toBe(0);
            const total = (values: Iterable<{total: number}>) =>
                [...values].reduce((sum, bucket) => sum + bucket.total, 0);
            expect(aggregator.tradeTickCount).toBe(count);
            expect(aggregator.rawTickCount).toBe(count);
            expect(aggregator.duplicateTickCount).toBe(0);
            expect(aggregator.outOfOrderTickCount).toBe(0);
            expect(total(aggregator.daily.values())).toBe(count);
            expect(total(aggregator.moving.values())).toBe(count);
            expect(aggregator.daily.size).toBe(10);
            expect(aggregator.moving.size).toBe(10);
        },
        30_000,
    );
});
