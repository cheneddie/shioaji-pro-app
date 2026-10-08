// Development 7 — read-only Order Flow Ladder price/grid model.
// The panel consumes shared OrderFlowRuntime snapshots; this module never trades.
import type { ContractInfo } from '../../../lib/types/contract';
import { bandTickFor } from '../../../lib/tick-bands';
import { tickSizeFor } from '../../../lib/utils/ticksize';
import type { OrderFlowPriceLevel } from './types';

export const FLOW_LADDER_WINDOW_SECONDS = 300;
export const FLOW_LADDER_ROW_HEIGHT = 27;
export const FLOW_LADDER_RADIUS = 240;
export const FLOW_LADDER_OVERSCAN = 5;
export const FLOW_LADDER_TOTAL_ROWS = FLOW_LADDER_RADIUS * 2 + 1;

export interface FlowLadderRow extends OrderFlowPriceLevel {
    isLast: boolean;
}
const n = (v: number) => Number(v.toFixed(8));

export function ladderTickSize(contract: ContractInfo, price: number): number | null {
    if (!Number.isFinite(price) || price <= 0) return null;
    const st = contract.security_type;
    // Unlike native FlashOrder, analysis must fail closed if an authoritative
    // exchange tick-band rule is known but its table is not yet in cache.
    const tick = (st === 'FUT' || st === 'OPT') && contract.tick_rule
        ? bandTickFor(contract.tick_rule, price)
        : tickSizeFor(contract, price);
    return tick !== undefined && Number.isFinite(tick) && tick > 0 ? tick : null;
}

export function buildFlowLadderPrices(
    contract: ContractInfo,
    centerPrice: number,
    radius = FLOW_LADDER_RADIUS,
): number[] {
    if (!Number.isFinite(centerPrice) || centerPrice <= 0 || radius < 0 ||
        !Number.isInteger(radius) || radius > FLOW_LADDER_RADIUS) return [];
    const centerTick = ladderTickSize(contract, centerPrice);
    if (centerTick === null) return [];
    const center = n(Math.round(centerPrice / centerTick) * centerTick);
    const upward: number[] = [center];
    const downward: number[] = [];
    let current = center;
    for (let i = 0; i < radius; i++) {
        const tick = ladderTickSize(contract, current);
        if (tick === null) return [];
        const next = n(current + tick);
        if (next <= current) break;
        upward.push(next);
        current = next;
    }
    current = center;
    for (let i = 0; i < radius; i++) {
        // At band boundaries downward stepping uses the increment immediately
        // BELOW the boundary, rather than the increment above it.
        const tick = ladderTickSize(
            contract, Math.max(Number.EPSILON, current - Math.max(1e-8, current * 1e-12)),
        );
        if (tick === null) return [];
        const next = n(current - tick);
        if (next <= 0 || next >= current) break;
        downward.push(next);
        current = next;
    }
    return [...upward.reverse(), ...downward];
}

export function projectFlowLadderRows(
    prices: readonly number[],
    levels: readonly OrderFlowPriceLevel[],
    lastPrice: number | null,
    contract: ContractInfo,
): FlowLadderRow[] {
    const byPrice = new Map(levels.map((row) => [n(row.price), row]));
    const lastTick = lastPrice !== null ? ladderTickSize(contract, lastPrice) : null;
    const snappedLast = lastPrice !== null && lastTick !== null
        ? n(Math.round(lastPrice / lastTick) * lastTick) : null;
    return prices.map((price) => {
        const level = byPrice.get(price);
        return {
            price,
            dailyBuy: level?.dailyBuy ?? 0,
            dailySell: level?.dailySell ?? 0,
            dailyNeutral: level?.dailyNeutral ?? 0,
            dailyTotal: level?.dailyTotal ?? 0,
            movingBuy: level?.movingBuy ?? 0,
            movingSell: level?.movingSell ?? 0,
            movingNeutral: level?.movingNeutral ?? 0,
            movingTotal: level?.movingTotal ?? 0,
            movingDelta: (level?.movingBuy ?? 0) - (level?.movingSell ?? 0),
            bidSize: level?.bidSize ?? 0,
            askSize: level?.askSize ?? 0,
            isLast: snappedLast === price,
        };
    });
}

export function flowLadderViewport(
    total: number, scrollTop: number, height: number,
    rowHeight = FLOW_LADDER_ROW_HEIGHT,
    overscan = FLOW_LADDER_OVERSCAN,
) {
    const safeTotal = Math.max(0, Math.floor(total));
    const safeHeight = Math.max(rowHeight, height);
    const safeTop = Math.max(0, Math.min(
        Number.isFinite(scrollTop) ? scrollTop : 0,
        Math.max(0, safeTotal * rowHeight - safeHeight),
    ));
    const start = Math.max(0, Math.floor(safeTop / rowHeight) - overscan);
    const end = Math.min(safeTotal, Math.ceil((safeTop + safeHeight) / rowHeight) + overscan);
    return {
        start,
        end,
        topPadding: start * rowHeight,
        bottomPadding: (safeTotal - end) * rowHeight,
    };
}

export function flowLadderMaxima(rows: readonly FlowLadderRow[]) {
    return {
        book: Math.max(1, ...rows.map((r) => Math.max(r.bidSize, r.askSize))),
        moving: Math.max(1, ...rows.map((r) => Math.max(r.movingBuy, r.movingSell, Math.abs(r.movingDelta)))),
        cumulative: Math.max(1, ...rows.map((r) => Math.max(r.dailyBuy, r.dailySell))),
    };
}
