// src/features/orderflow/domain/bubble.test.ts

import { describe, expect, it } from 'vitest';
import type { ContractInfo } from '../../../lib/types/contract';
import {
    BubbleAggregator,
    DEFAULT_BUBBLE_SETTINGS,
    bubbleRadius,
    bubbleScaleMaximum,
    bubbleScaleReferences,
    selectVisibleBubbleCandidates,
    bubbleTradeFromHistory,
    bubbleTradeFromRaw,
    hitTestBubble,
    mergeBubbleHistoryAndPending,
    normalizeBubbleSettings,
    type BubbleSourceTrade,
} from './bubble';

const contract: ContractInfo = {
    region: 'TW',
    exchange: 'TAIFEX',
    code: 'TXFR1',
    security_type: 'FUT',
    target_code: 'TXFJ6',
    name: '臺股期貨',
    currency: 'TWD',
    limit_up: 0,
    limit_down: 0,
    reference: 100,
    day_trade: 'Yes',
    update_date: '2026-10-08',
    category: 'TXF',
    margin_trading_balance: 0,
    short_selling_balance: 0,
    tick: 1,
    underlying_kind: 'I',
};

function trade(
    second: number,
    price: number,
    volume: number,
    side: 'buy' | 'sell',
    timestamp = 60,
): BubbleSourceTrade {
    return {
        eventTimeMs: second * 1_000,
        timestamp,
        price,
        volume,
        side,
    };
}

describe('BubbleAggregator', () => {
    it('builds cumulative delta candidates per bar and price', () => {
        const agg = new BubbleAggregator({
            ...DEFAULT_BUBBLE_SETTINGS,
            enabled: true,
            filterMode: 'cumulative',
        });
        agg.ingestMany([
            trade(1, 100, 50, 'buy'),
            trade(2, 100, 35, 'sell'),
            trade(3, 101, 8, 'sell'),
        ]);
        expect(agg.snapshot()).toEqual([
            {
                timestamp: 60,
                price: 101,
                side: 'sell',
                volume: 8,
                rawValue: -8,
            },
            {
                timestamp: 60,
                price: 100,
                side: 'buy',
                volume: 15,
                rawValue: 15,
            },
        ]);
    });

    it('applies single-order min/max before price-side accumulation', () => {
        const agg = new BubbleAggregator({
            ...DEFAULT_BUBBLE_SETTINGS,
            enabled: true,
            filterMode: 'single',
            minimumVolume: 10,
            maximumVolume: 20,
        });
        agg.ingestMany([
            trade(1, 100, 9, 'buy'),
            trade(2, 100, 12, 'buy'),
            trade(3, 100, 15, 'buy'),
            trade(4, 100, 25, 'buy'),
        ]);
        expect(agg.snapshot()).toEqual([
            {
                timestamp: 60,
                price: 100,
                side: 'buy',
                volume: 27,
                rawValue: 27,
            },
        ]);
    });

    it('builds fixed-window same-direction charge at first order price', () => {
        const agg = new BubbleAggregator({
            ...DEFAULT_BUBBLE_SETTINGS,
            enabled: true,
            filterMode: 'charge',
            chargeWindowSeconds: 2,
            minimumVolume: 10,
            maximumVolume: 15,
        });
        agg.ingestMany([
            trade(60.1, 100, 4, 'buy', 60),
            trade(61.6, 101, 7, 'buy', 120),
            trade(61.8, 99, 12, 'sell', 120),
            trade(62.1, 102, 20, 'buy', 120),
        ]);
        expect(agg.snapshot()).toEqual([
            {
                timestamp: 60,
                price: 100,
                side: 'buy',
                volume: 11,
                rawValue: 11,
            },
            {
                timestamp: 120,
                price: 99,
                side: 'sell',
                volume: 12,
                rawValue: 12,
            },
        ]);
    });

    it('anchors charge to earliest event-time despite out-of-order arrival', () => {
        const agg = new BubbleAggregator({
            ...DEFAULT_BUBBLE_SETTINGS,
            enabled: true,
            filterMode: 'charge',
            chargeWindowSeconds: 5,
        });
        agg.ingestMany([
            trade(64, 104, 2, 'buy', 120),
            trade(61, 101, 3, 'buy', 60),
            trade(62, 102, 4, 'buy', 120),
        ]);
        expect(agg.snapshot()).toEqual([{
            timestamp: 60,
            price: 101,
            side: 'buy',
            volume: 9,
            rawValue: 9,
        }]);
    });

    it('filters buy/sell direction after aggregation', () => {
        const agg = new BubbleAggregator({
            ...DEFAULT_BUBBLE_SETTINGS,
            enabled: true,
            filterMode: 'cumulative',
            direction: 'sell',
        });
        agg.ingestMany([
            trade(1, 100, 10, 'buy'),
            trade(2, 101, 12, 'sell'),
        ]);
        expect(agg.snapshot()).toHaveLength(1);
        expect(agg.snapshot()[0]!.side).toBe('sell');
    });
});

describe('Bubble projection and merge', () => {
    it('preserves history aggressor side and rejects neutral history', () => {
        const buy = bubbleTradeFromHistory(
            {
                datetime: '2026-10-08 09:00:01.000',
                eventTimeMs: Date.UTC(2026, 9, 8, 9, 0, 1),
                price: 100,
                volume: 3,
                tickType: 1,
                side: 'buy',
            },
            1,
            contract.security_type,
            false,
        );
        const neutral = bubbleTradeFromHistory(
            {
                datetime: '2026-10-08 09:00:02.000',
                eventTimeMs: Date.UTC(2026, 9, 8, 9, 0, 2),
                price: 100,
                volume: 3,
                tickType: 0,
                side: 'neutral',
            },
            1,
            contract.security_type,
            false,
        );
        expect(buy?.side).toBe('buy');
        expect(neutral).toBeNull();
    });

    it('preserves millisecond event time for live/history handoff keys', () => {
        const raw = bubbleTradeFromRaw(
            {
                code: 'TXFR1',
                date: '2026/10/08',
                time: '09:00:01.125',
                price: 100,
                volume: 3,
                totalVolume: 3,
                tickType: 1,
                simtrade: false,
                intradayOdd: false,
                raw: {} as never,
            },
            1,
            contract.security_type,
            false,
        );
        const historical = bubbleTradeFromHistory(
            {
                datetime: '2026-10-08 09:00:01.125',
                eventTimeMs: Date.UTC(2026, 9, 8, 9, 0, 1, 125),
                price: 100,
                volume: 3,
                tickType: 1,
                side: 'buy',
            },
            1,
            contract.security_type,
            false,
        );
        expect(raw).toEqual(historical);
        expect(
            mergeBubbleHistoryAndPending(
                [historical!],
                [raw!],
            ),
        ).toHaveLength(1);
    });

    it('dedupes history/live handoff with multiplicity', () => {
        const a = trade(1, 100, 2, 'buy');
        const b = trade(1, 100, 2, 'buy');
        const c = trade(2, 101, 3, 'sell');
        const merged = mergeBubbleHistoryAndPending(
            [a],
            [b, c],
        );
        expect(merged).toEqual([a, c]);
    });
});

describe('Bubble settings, scale and hit testing', () => {
    it('normalizes invalid settings without native indicator dependencies', () => {
        expect(
            normalizeBubbleSettings({
                filterMode: 'bad' as never,
                minimumRadius: 0,
                opacity: 500,
                chargeWindowSeconds: 0,
            }),
        ).toMatchObject({
            filterMode: 'cumulative',
            minimumRadius: 0.5,
            opacity: 100,
            chargeWindowSeconds: 1,
        });
    });

    it('uses visible or per-bar maximum as the scale reference', () => {
        const candidates = [
            {
                timestamp: 60,
                price: 100,
                side: 'buy' as const,
                volume: 10,
                rawValue: 10,
            },
            {
                timestamp: 60,
                price: 101,
                side: 'sell' as const,
                volume: 20,
                rawValue: 20,
            },
            {
                timestamp: 120,
                price: 102,
                side: 'buy' as const,
                volume: 100,
                rawValue: 100,
            },
        ];
        expect(
            bubbleScaleMaximum(
                candidates[0]!,
                candidates,
                'visible',
            ),
        ).toBe(100);
        expect(
            bubbleScaleMaximum(
                candidates[0]!,
                candidates,
                'bar',
            ),
        ).toBe(20);
    });

    it('uses linear-time scale references and bounded time-range slicing', () => {
        const candidates = Array.from({ length: 30_000 }, (_, i) => ({
            timestamp: i * 60,
            price: 100,
            side: 'buy' as const,
            volume: i + 1,
            rawValue: i + 1,
        }));
        const sliced = selectVisibleBubbleCandidates(
            candidates,
            600,
            1200,
        );
        expect(sliced).toHaveLength(11);
        expect(sliced[0]?.timestamp).toBe(600);
        expect(sliced.at(-1)?.timestamp).toBe(1200);
        const refs = bubbleScaleReferences(candidates);
        expect(refs.visibleMax).toBe(30_000);
        expect(refs.byBar.get(0)).toBe(1);
        expect(bubbleScaleMaximum(candidates[0]!, candidates, 'visible')).toBe(30_000);
        expect(selectVisibleBubbleCandidates(candidates, null, null)).toHaveLength(30_000);
    });

    it('scales radius by square-root volume and user percentage', () => {
        const base = {
            minimumRadius: 2,
            scalePercent: 100,
        };
        const small = bubbleRadius(25, 100, base, 72);
        const large = bubbleRadius(100, 100, base, 72);
        const doubled = bubbleRadius(
            100,
            100,
            { ...base, scalePercent: 200 },
            72,
        );
        expect(large).toBeGreaterThan(small);
        expect(doubled).toBeCloseTo(large * 2);
    });

    it('tracks candle spacing smoothly and retains relative volume sizes', () => {
        const settings = { minimumRadius: 1, scalePercent: 100 };
        const spacings = [1, 2, 4, 8, 16, 32, 64];
        const large = spacings.map((spacing) =>
            bubbleRadius(100, 100, settings, spacing));
        const small = spacings.map((spacing) =>
            bubbleRadius(25, 100, settings, spacing));

        for (let i = 1; i < large.length; i++) {
            expect(large[i]).toBeGreaterThan(large[i - 1]!);
            expect(large[i]! / large[i - 1]!).toBeLessThanOrEqual(2.01);
        }
        expect(large[0]).toBeLessThan(1);
        expect(large.at(-1)).toBeGreaterThan(12);
        for (let i = 0; i < large.length; i++) {
            expect(small[i]).toBeLessThan(large[i]!);
        }
    });

    it('hit-tests inside, boundary and outside a rendered circle', () => {
        const bubble = {
            x: 20,
            y: 30,
            radius: 10,
            candidate: {
                timestamp: 60,
                price: 100,
                side: 'buy' as const,
                volume: 10,
                rawValue: 10,
            },
        };
        expect(hitTestBubble([bubble], 20, 30)).toBe(bubble);
        expect(hitTestBubble([bubble], 30, 30)).toBe(bubble);
        expect(hitTestBubble([bubble], 31, 30)).toBeNull();
    });
});
