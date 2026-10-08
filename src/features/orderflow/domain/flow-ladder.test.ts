import { describe, expect, it } from 'vitest';
import {
    buildFlowLadderPrices, flowLadderMaxima, flowLadderViewport,
    ladderTickSize, projectFlowLadderRows, FLOW_LADDER_TOTAL_ROWS,
} from './flow-ladder';
import { setTickBands, clearTickBands } from '../../../lib/tick-bands';
import type { ContractInfo } from '../../../lib/types/contract';

const contract = {
    code: 'TXFR1', target_code: 'TXFJ6', region: 'TW',
    security_type: 'FUT', exchange: 'TAIFEX', tick: 1,
    name: '臺股期貨', currency: 'TWD', reference: 100,
    limit_up: 200, limit_down: 50,
    day_trade: 'Yes', update_date: '',
    category: 'TXF', margin_trading_balance: 0, short_selling_balance: 0,
} as ContractInfo;

describe('Dev7 Flow Ladder view model', () => {
    it('builds a descending, bounded exact-price ladder around last trade', () => {
        const prices = buildFlowLadderPrices(contract, 100);
        expect(prices).toHaveLength(340);
        expect(prices[0]).toBe(340);
        expect(prices[240]).toBe(100);
        expect(prices.at(-1)).toBe(1); // lower bound is zero, no negative prices
        expect(buildFlowLadderPrices(contract, 300)).toHaveLength(FLOW_LADDER_TOTAL_ROWS);
        expect(prices.every((price) => price > 0)).toBe(true);
        expect(prices.slice(1).every((p, i) => p < prices[i]!)).toBe(true);
    });
    it('walks price-band boundaries with the actual tick size in either direction', () => {
        setTickBands('DEV7_TEST', [
            { min: 0, max: 10, tick: 0.05 },
            { min: 10, max: null, tick: 0.1 },
        ]);
        try {
            const instrument = { ...contract, tick_rule: 'DEV7_TEST' };
            expect(buildFlowLadderPrices(instrument, 10, 2)).toEqual([
                10.2, 10.1, 10, 9.95, 9.9,
            ]);
        } finally { clearTickBands(); }
    });
    it('does not invent price ladders while authoritative tick bands are absent', () => {
        expect(ladderTickSize({ ...contract, tick_rule: 'MISSING_DEV7' }, 100)).toBeNull();
        expect(buildFlowLadderPrices({ ...contract, tick_rule: 'MISSING_DEV7' }, 100)).toEqual([]);
        expect(buildFlowLadderPrices(contract, NaN)).toEqual([]);
    });
    it('projects actual passive book, 300s moving flow, delta and cumulative separately', () => {
        const prices = [101, 100, 99];
        const rows = projectFlowLadderRows(prices, [{
            price: 100, bidSize: 20, askSize: 12,
            movingBuy: 15, movingSell: 9, movingNeutral: 2,
            movingDelta: 999, movingTotal: 26, dailyBuy: 40,
            dailySell: 30, dailyNeutral: 3, dailyTotal: 73,
        }], 100, contract);
        expect(rows[1]).toMatchObject({
            bidSize: 20, askSize: 12,
            movingBuy: 15, movingSell: 9, movingDelta: 6,
            dailyBuy: 40, dailySell: 30, isLast: true,
        });
        expect(rows[0]?.bidSize).toBe(0);
        expect(rows[2]?.isLast).toBe(false);
        expect(flowLadderMaxima(rows)).toEqual({
            book: 20, moving: 15, cumulative: 40,
        });
    });
    it('virtualizes only visible rows, overscan and spacer heights', () => {
        const total = 481;
        expect(flowLadderViewport(total, 0, 270)).toMatchObject({start: 0, end: 15});
        const viewport = flowLadderViewport(total, 27 * 200, 270);
        expect(viewport).toEqual({
            start: 195, end: 215,
            topPadding: 195 * 27, bottomPadding: (481 - 215) * 27,
        });
        expect(flowLadderViewport(total, Number.POSITIVE_INFINITY, 270).end)
            .toBeLessThanOrEqual(total);
        expect(flowLadderViewport(0, 0, 270).end).toBe(0);
    });
});
