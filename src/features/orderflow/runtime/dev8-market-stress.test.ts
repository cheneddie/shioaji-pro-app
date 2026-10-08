import { describe, expect, it } from 'vitest';
import type { OrderFlowRawTick } from './market-event-bridge';
import { TickAggregator } from './tick-aggregator';

function tick(index: number): OrderFlowRawTick {
    // 100 ticks/second for up to 1000 seconds. This deliberately
    // crosses the 300s window (the former 1000 ticks/second did not).
    const elapsedMs = index * 10;
    const hour = 10 + Math.floor(elapsedMs / 3_600_000);
    const minute = Math.floor(elapsedMs / 60_000) % 60;
    const second = Math.floor(elapsedMs / 1_000) % 60;
    const ms = elapsedMs % 1_000;
    const time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;
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
            // A 300-second inclusive moving window at 100Hz retains
            // exactly 30,001 ticks after 300 seconds of event time.
            expect(total(aggregator.moving.values())).toBe(Math.min(count, 30_001));
            expect(aggregator.daily.size).toBe(10);
            expect(aggregator.moving.size).toBe(10);
            for (const bucket of aggregator.daily.values()) {
                expect(bucket.buy + bucket.sell + bucket.neutral).toBe(bucket.total);
            }
            for (const bucket of aggregator.moving.values()) {
                expect(bucket.buy + bucket.sell + bucket.neutral).toBe(bucket.total);
            }
        },
        30_000,
    );
});
