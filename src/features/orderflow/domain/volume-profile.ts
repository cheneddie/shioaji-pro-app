// Development 6: isolated Order Flow range Volume Profile domain.
// No imports from native CandleChart drawings or VolProfile.
import { isDaySessionTick } from '../../../lib/intraday-session';
import type { SecurityType } from '../../../lib/types/contract';
import { parseExchangeEventTimeMs } from '../runtime/event-time';
import type { OrderFlowRawTick } from '../runtime/market-event-bridge';
import type { OrderFlowHistoryTick } from './types';

export interface VolumeProfileTrade {
    eventTimeMs: number;
    barTime: number;
    price: number;
    volume: number;
    side: 'buy' | 'sell' | 'neutral';
}
export interface VolumeProfileDrawing {
    id: string;
    fromTime: number;
    toTime: number;
}
export interface VolumeProfileLevel {
    price: number;
    buy: number;
    sell: number;
    neutral: number;
    total: number;
}
export interface RangeVolumeProfile {
    levels: VolumeProfileLevel[];
    total: number;
    poc: number;
    vah: number;
    val: number;
}
export const VP_VALUE_AREA_FRACTION = 0.7;
export const VP_MAX_DAYS = 31;

function sideOf(tickType: number): VolumeProfileTrade['side'] {
    return tickType === 1 ? 'buy' : tickType === 2 ? 'sell' : 'neutral';
}

export function profileBarTime(eventTimeMs: number, minutes: number): number {
    const secs = eventTimeMs / 1_000;
    if (minutes >= 1440) return Math.floor(secs / 86400) * 86400;
    const bucket = Math.max(1, minutes) * 60;
    return Math.floor(secs / bucket) * bucket + bucket;
}
function toTrade(
    eventTimeMs: number | null,
    price: number | null,
    volume: number,
    side: VolumeProfileTrade['side'],
    minutes: number,
    securityType: SecurityType,
    dayOnly: boolean,
): VolumeProfileTrade | null {
    if (eventTimeMs === null || !Number.isFinite(eventTimeMs) ||
        price === null || !Number.isFinite(price) ||
        !Number.isFinite(volume) || volume <= 0) return null;
    if (dayOnly && !isDaySessionTick(securityType, eventTimeMs / 1000)) return null;
    return {
        eventTimeMs,
        barTime: profileBarTime(eventTimeMs, minutes),
        price,
        volume,
        side,
    };
}
export function volumeProfileHistoryTrade(
    tick: OrderFlowHistoryTick,
    minutes: number,
    securityType: SecurityType,
    dayOnly: boolean,
): VolumeProfileTrade | null {
    return toTrade(tick.eventTimeMs, tick.price, tick.volume, sideOf(tick.tickType),
        minutes, securityType, dayOnly);
}
export function volumeProfileLiveTrade(
    tick: OrderFlowRawTick,
    minutes: number,
    securityType: SecurityType,
    dayOnly: boolean,
): VolumeProfileTrade | null {
    if (tick.simtrade || tick.intradayOdd) return null;
    return toTrade(parseExchangeEventTimeMs(tick.date, tick.time),
        tick.price, tick.volume, sideOf(tick.tickType),
        minutes, securityType, dayOnly);
}

// A history/live handoff can contain identical physical trades. Remove only
// as many live copies as are already in history; retain real equal trade repeats.
export function mergeProfileHistoryAndLive(
    history: VolumeProfileTrade[],
    live: VolumeProfileTrade[],
): VolumeProfileTrade[] {
    const counts = new Map<string, number>();
    const key = (t: VolumeProfileTrade) =>
        [t.eventTimeMs, t.price, t.volume, t.side].join('|');
    for (const trade of history) {
        const k = key(trade);
        counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const merged = [...history];
    for (const trade of live) {
        const k = key(trade);
        const remaining = counts.get(k) ?? 0;
        if (remaining > 0) counts.set(k, remaining - 1);
        else merged.push(trade);
    }
    return merged;
}

export function profileDateRange(
    fromTime: number, toTime: number, maxDays = VP_MAX_DAYS, includePreviousDay = false,
): string[] | null {
    if (!Number.isFinite(fromTime) || !Number.isFinite(toTime)) return null;
    const firstTime = Math.min(fromTime, toTime);
    const from = Math.floor(firstTime / 86400) -
        (includePreviousDay && firstTime % 86400 === 0 ? 1 : 0);
    const to = Math.floor(Math.max(fromTime, toTime) / 86400);
    if (to - from + 1 > maxDays) return null;
    const result: string[] = [];
    for (let day = from; day <= to; day++) {
        result.push(new Date(day * 86400_000).toISOString().slice(0, 10));
    }
    return result;
}

export function normalizeVolumeProfileDrawings(
    value: unknown,
): VolumeProfileDrawing[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, 50).flatMap((item) => {
        if (!item || typeof item !== 'object') return [];
        const obj = item as Record<string, unknown>;
        if (typeof obj.id !== 'string' || obj.id.length > 128 ||
            typeof obj.fromTime !== 'number' || typeof obj.toTime !== 'number' ||
            !Number.isFinite(obj.fromTime) || !Number.isFinite(obj.toTime)) return [];
        return [{
            id: obj.id,
            fromTime: Math.min(obj.fromTime as number, obj.toTime as number),
            toTime: Math.max(obj.fromTime as number, obj.toTime as number),
        }];
    });
}

export function aggregateRangeVolumeProfile(
    trades: readonly VolumeProfileTrade[],
    drawing: VolumeProfileDrawing,
    tickSize: number,
): RangeVolumeProfile | null {
    if (!Number.isFinite(tickSize) || tickSize <= 0) return null;
    const decimals = Math.min(10,
        (String(tickSize).split('.')[1] ?? '').length);
    const rows = new Map<number, VolumeProfileLevel>();
    for (const trade of trades) {
        if (trade.barTime < drawing.fromTime || trade.barTime > drawing.toTime ||
            !Number.isFinite(trade.price) || !Number.isFinite(trade.volume) ||
            trade.volume <= 0) continue;
        const bucket = Math.round(trade.price / tickSize);
        const price = Number((bucket * tickSize).toFixed(decimals));
        const level = rows.get(bucket) ?? {
            price, buy: 0, sell: 0, neutral: 0, total: 0,
        };
        level[trade.side] += trade.volume;
        level.total += trade.volume;
        rows.set(bucket, level);
    }
    const levels = [...rows.values()].sort((a, b) => a.price - b.price);
    if (!levels.length) return null;
    const total = levels.reduce((sum, level) => sum + level.total, 0);
    if (total <= 0) return null;

    // Same volume: select higher-priced POC deterministically.
    let pocIndex = 0;
    for (let i = 1; i < levels.length; i++) {
        if (levels[i]!.total >= levels[pocIndex]!.total) pocIndex = i;
    }
    let low = pocIndex;
    let high = pocIndex;
    let covered = levels[pocIndex]!.total;
    const target = total * VP_VALUE_AREA_FRACTION;
    while (covered < target && (low > 0 || high < levels.length - 1)) {
        const down = low > 0 ? levels[low - 1]!.total : -1;
        const up = high < levels.length - 1 ? levels[high + 1]!.total : -1;
        // Equal next-volume prefers the higher price.
        if (up >= down && up >= 0) covered += levels[++high]!.total;
        else covered += levels[--low]!.total;
    }
    return {
        levels, total,
        poc: levels[pocIndex]!.price,
        vah: levels[high]!.price,
        val: levels[low]!.price,
    };
}
