// src/features/orderflow/domain/footprint.test.ts

import { describe, expect, it } from 'vitest';
import type { ContractInfo } from '../../../lib/types/contract';
import {
    FootprintAggregator,
    footprintTradeFromHistory,
    type FootprintTrade,
} from './footprint';

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

const settings = {
    timeframeSeconds: 60,
    tickCompression: 1,
    imbalanceRatio: 3,
    minDelta: 2,
    dayOnly: false,
    securityType: contract.security_type,
} as const;

function trade(
    seconds: number,
    price: number,
    volume: number,
    side: FootprintTrade['side'],
): FootprintTrade {
    return {
        eventTimeMs: Date.UTC(2026, 9, 8, 9, 0, seconds),
        price,
        volume,
        side,
    };
}

describe('FootprintAggregator', () => {
    it('fills missing tick levels without inventing volume', () => {
        const agg = new FootprintAggregator(contract, settings);
        agg.ingestMany([
            trade(1, 100, 3, 'buy'),
            trade(2, 102, 4, 'sell'),
        ]);
        const bar = agg.snapshot()[0]!;
        expect(bar.levels.map((level) => level.price)).toEqual([100, 101, 102]);
        expect(bar.levels[1]).toMatchObject({
            buyVolume: 0,
            sellVolume: 0,
            neutralVolume: 0,
            totalVolume: 0,
            delta: 0,
        });
        expect(bar.volume).toBe(7);
    });

    it('uses a stable contract-reference anchor for tick compression', () => {
        const agg = new FootprintAggregator(contract, {
            ...settings,
            tickCompression: 2,
        });
        agg.ingestMany([
            trade(1, 99, 1, 'buy'),
            trade(2, 100, 2, 'buy'),
            trade(3, 101, 3, 'sell'),
            trade(4, 102, 4, 'buy'),
        ]);
        const bar = agg.snapshot()[0]!;
        expect(bar.levels.map((level) => level.price)).toEqual([98, 100, 102]);
        expect(bar.levels.find((level) => level.price === 100)).toMatchObject({
            buyVolume: 2,
            sellVolume: 3,
            totalVolume: 5,
        });
    });

    it('uses the higher price for deterministic POC and delta-POC ties', () => {
        const agg = new FootprintAggregator(contract, settings);
        agg.ingestMany([
            trade(1, 100, 5, 'buy'),
            trade(2, 101, 5, 'sell'),
        ]);
        const bar = agg.snapshot()[0]!;
        expect(bar.pocPrice).toBe(101);
        expect(bar.deltaPocPrice).toBe(101);
    });

    it('marks diagonal and horizontal imbalances independently', () => {
        const agg = new FootprintAggregator(contract, {
            ...settings,
            imbalanceRatio: 3,
            minDelta: 2,
        });
        agg.ingestMany([
            trade(1, 100, 1, 'sell'),
            trade(2, 101, 6, 'buy'),
            trade(3, 101, 1, 'sell'),
            trade(4, 102, 8, 'sell'),
            trade(5, 103, 1, 'buy'),
        ]);
        const bar = agg.snapshot()[0]!;
        const p101 = bar.levels.find((level) => level.price === 101)!;
        const p102 = bar.levels.find((level) => level.price === 102)!;
        expect(p101.buyImbalance).toBe(true);
        expect(p101.buyHorizontalImbalance).toBe(true);
        expect(p102.sellImbalance).toBe(true);
        expect(p102.sellHorizontalImbalance).toBe(true);
    });

    it('keeps neutral volume separate from active buy/sell delta', () => {
        const agg = new FootprintAggregator(contract, settings);
        agg.ingestMany([
            trade(1, 100, 7, 'neutral'),
            trade(2, 100, 3, 'buy'),
        ]);
        const level = agg.snapshot()[0]!.levels[0]!;
        expect(level).toMatchObject({
            buyVolume: 3,
            sellVolume: 0,
            neutralVolume: 7,
            totalVolume: 10,
            delta: 3,
        });
    });

    it.each([
        [30, 15, 30],
        [180, 61, 180],
        [300, 61, 300],
    ])('buckets %ss trades on close-label-right boundaries', (seconds, offset, expected) => {
        const agg = new FootprintAggregator(contract, {
            ...settings,
            timeframeSeconds: seconds,
        });
        agg.ingest({
            eventTimeMs: Date.UTC(2026, 9, 8, 9, 0, 0) + offset * 1000,
            price: 100,
            volume: 1,
            side: 'buy',
        });
        const dayStart = Date.UTC(2026, 9, 8, 9, 0, 0) / 1000;
        expect(agg.snapshot()[0]!.timestamp).toBe(dayStart + expected);
    });

    it('filters night trades in day-only mode', () => {
        const agg = new FootprintAggregator(contract, {
            ...settings,
            dayOnly: true,
        });
        agg.ingest({
            eventTimeMs: Date.UTC(2026, 9, 8, 9, 1, 0),
            price: 100,
            volume: 1,
            side: 'buy',
        });
        agg.ingest({
            eventTimeMs: Date.UTC(2026, 9, 8, 15, 1, 0),
            price: 101,
            volume: 2,
            side: 'sell',
        });
        const bars = agg.snapshot();
        expect(bars).toHaveLength(1);
        expect(bars[0]!.volume).toBe(1);
    });

    it('projects history ticks without reclassifying their side', () => {
        const projected = footprintTradeFromHistory(
            {
                datetime: '2026-10-08 09:01:01.123',
                eventTimeMs: Date.UTC(2026, 9, 8, 9, 1, 1, 123),
                price: 100,
                volume: 2,
                tickType: 0,
                side: 'neutral',
            },
            'FUT',
            false,
        );
        expect(projected?.side).toBe('neutral');
    });

    it('does not let older out-of-order trades replace a bar close', () => {
        const agg = new FootprintAggregator(contract, settings);
        agg.ingest({
            eventTimeMs: Date.UTC(2026, 9, 8, 9, 0, 20),
            price: 102,
            volume: 1,
            side: 'buy',
        });
        agg.ingest({
            eventTimeMs: Date.UTC(2026, 9, 8, 9, 0, 10),
            price: 99,
            volume: 1,
            side: 'sell',
        });
        const bar = agg.snapshot()[0]!;
        expect(bar.open).toBe(99);
        expect(bar.close).toBe(102);
        expect(bar.low).toBe(99);
        expect(bar.high).toBe(102);
    });
});
