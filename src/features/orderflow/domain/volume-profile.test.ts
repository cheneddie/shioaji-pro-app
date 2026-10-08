import { describe, expect, it } from 'vitest';
import {
    aggregateRangeVolumeProfile, mergeProfileHistoryAndLive, normalizeVolumeProfileDrawings,
    profileDateRange, profileBarTime, volumeProfileHistoryTrade,
    type VolumeProfileTrade,
} from './volume-profile';

const t = (barTime: number, price: number, volume: number,
    side: VolumeProfileTrade['side'] = 'buy'): VolumeProfileTrade => ({
    eventTimeMs: barTime * 1000, barTime, price, volume, side,
});
const range = { id: 'vp1', fromTime: 60, toTime: 120 };

describe('Development 6 range Volume Profile', () => {
    it('aggregates buy/sell/neutral by tick and includes both selected bar anchors', () => {
        const result = aggregateRangeVolumeProfile([
            t(59, 101, 999), t(60, 100.01, 4), t(60, 100.02, 3, 'sell'),
            t(120, 100.02, 2, 'neutral'), t(121, 101, 999),
        ], range, 0.01)!;
        expect(result.total).toBe(9);
        expect(result.levels).toEqual([
            { price: 100.01, buy: 4, sell: 0, neutral: 0, total: 4 },
            { price: 100.02, buy: 0, sell: 3, neutral: 2, total: 5 },
        ]);
        expect(result.poc).toBe(100.02);
    });
    it('uses higher price for tied POC and deterministic outward 70% value area', () => {
        const result = aggregateRangeVolumeProfile([
            t(60, 99, 3), t(60, 100, 5), t(60, 101, 5), t(60, 102, 2),
        ], range, 1)!;
        expect(result.poc).toBe(101);
        expect(result.val).toBe(99);
        expect(result.vah).toBe(101);
    });
    it('handles sparse prices, zero volume, invalid tick size and reverse anchors', () => {
        expect(aggregateRangeVolumeProfile([], range, 1)).toBeNull();
        expect(aggregateRangeVolumeProfile([t(60, 100, 0)], range, 1)).toBeNull();
        expect(aggregateRangeVolumeProfile([t(60, 100, 1)], range, 0)).toBeNull();
        const result = aggregateRangeVolumeProfile([t(60, 100, 1), t(60, 110, 10)],
            { id:'a', fromTime:60, toTime:120 }, 1)!;
        expect(result.val).toBe(110);
        expect(result.vah).toBe(110);
    });
    it('keeps neutral history ticks, rejects invalid entries, and aligns bar labels', () => {
        const raw = {
            datetime: '2026-10-08 09:00:01.000',
            eventTimeMs: Date.UTC(2026, 9, 8, 9, 0, 1),
            price: 100, volume: 3, tickType: 0, side: 'neutral' as const,
        };
        const trade = volumeProfileHistoryTrade(raw, 5, 'FUT', false)!;
        expect(trade.side).toBe('neutral');
        expect(trade.barTime).toBe(Date.UTC(2026, 9, 8, 9, 5) / 1000);
        expect(profileBarTime(raw.eventTimeMs, 1))
            .toBe(Date.UTC(2026, 9, 8, 9, 1) / 1000);
        expect(volumeProfileHistoryTrade({ ...raw, volume: 0 }, 5, 'FUT', false)).toBeNull();
    });
    it('deduplicates live/history by multiplicity without dropping identical physical trades', () => {
        const a = t(60, 100, 3);
        expect(mergeProfileHistoryAndLive([a], [a, a])).toEqual([a, a]);
        expect(mergeProfileHistoryAndLive([a, a], [a])).toEqual([a, a]);
    });
    it('bounds multi-day hydration and validates persisted drawings', () => {
        const from = Date.UTC(2026, 9, 8, 9) / 1000;
        const to = Date.UTC(2026, 9, 9, 9) / 1000;
        expect(profileDateRange(from, to)).toEqual(['2026-10-08','2026-10-09']);
        expect(profileDateRange(Date.UTC(2026,9,9)/1000, to, 31, true))
            .toEqual(['2026-10-08','2026-10-09']);
        expect(profileDateRange(from, from + 40 * 86400)).toBeNull();
        expect(normalizeVolumeProfileDrawings([
            {id:'x',fromTime:120,toTime:60},
            {id:'z',fromTime:Infinity,toTime:60},
            {id:7,fromTime:60,toTime:100},
        ])).toEqual([{id:'x',fromTime:60,toTime:120}]);
    });
    it('resolves each executed price using its OWN exchange tick band', () => {
        // Below 10: 0.05; 10 or above: 0.1. A reference-price-only
        // contract.tick=0.05 would invent an illegal 10.15 bin.
        const result = aggregateRangeVolumeProfile([
            t(60, 9.95, 5), t(60, 10.2, 8, 'sell'),
            t(60, 10.3, 4, 'neutral'),
        ], range, (price) => price < 10 ? 0.05 : 0.1)!;
        expect(result.levels.map((level) => level.price)).toEqual([
            9.95, 10.2, 10.3,
        ]);
        expect(result.poc).toBe(10.2);
        expect(result.total).toBe(17);
    });
    it('refuses partial profiles when any selected price band is unresolved', () => {
        const result = aggregateRangeVolumeProfile([
            t(60, 9.95, 5), t(60, 10.2, 8),
        ], range, (price) => price < 10 ? 0.05 : NaN);
        expect(result).toBeNull();
        // Unknown prices outside the drawing are irrelevant.
        const unaffected = aggregateRangeVolumeProfile([
            t(60, 9.95, 5), t(300, 10.2, 8),
        ], range, (price) => price < 10 ? 0.05 : NaN);
        expect(unaffected?.total).toBe(5);
    });

});
