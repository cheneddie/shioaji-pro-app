// src/features/orderflow/domain/footprint.ts

import { isDaySessionTick } from '../../../lib/intraday-session';
import type { ContractInfo, SecurityType } from '../../../lib/types/contract';
import { roundToTick, stepPrice } from '../../../lib/utils/ticksize';
import type { FootprintBar, FootprintLevel } from './contracts';
import type {
    OrderFlowHistoryTick,
    OrderFlowSide,
} from './types';
import type { OrderFlowRawTick } from '../runtime/market-event-bridge';
import { parseExchangeEventTimeMs } from '../runtime/event-time';
import { classifyTickType } from '../runtime/tick-aggregator';

export type FootprintDisplayMode = 'bidask' | 'delta' | 'total';

export interface FootprintSettings {
    timeframeSeconds: number;
    tickCompression: number;
    imbalanceRatio: number;
    minDelta: number;
    dayOnly: boolean;
    securityType: SecurityType;
}

export interface FootprintTrade {
    eventTimeMs: number;
    price: number;
    volume: number;
    side: OrderFlowSide;
}

interface MutableLevel {
    buyVolume: number;
    sellVolume: number;
    neutralVolume: number;
    totalVolume: number;
}

interface MutableBar {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    firstEventTimeMs: number;
    lastEventTimeMs: number;
    levels: Map<number, MutableLevel>;
}

const MAX_LADDER_STEPS = 100_000;
const EPSILON = 1e-9;

function emptyLevel(): MutableLevel {
    return {
        buyVolume: 0,
        sellVolume: 0,
        neutralVolume: 0,
        totalVolume: 0,
    };
}

function validTrade(
    eventTimeMs: number | null,
    price: number | null,
    volume: number,
) {
    return (
        eventTimeMs !== null &&
        Number.isFinite(eventTimeMs) &&
        price !== null &&
        Number.isFinite(price) &&
        Number.isFinite(volume) &&
        volume > 0
    );
}

function sessionAllows(
    securityType: SecurityType,
    eventTimeMs: number,
    dayOnly: boolean,
) {
    return !dayOnly || isDaySessionTick(securityType, eventTimeMs / 1000);
}

export function footprintTradeFromHistory(
    tick: OrderFlowHistoryTick,
    securityType: SecurityType,
    dayOnly: boolean,
): FootprintTrade | null {
    if (!validTrade(tick.eventTimeMs, tick.price, tick.volume)) return null;
    if (!sessionAllows(securityType, tick.eventTimeMs!, dayOnly)) return null;
    return {
        eventTimeMs: tick.eventTimeMs!,
        price: tick.price!,
        volume: tick.volume,
        side: tick.side,
    };
}

export function footprintTradeFromRaw(
    tick: OrderFlowRawTick,
    securityType: SecurityType,
    dayOnly: boolean,
): FootprintTrade | null {
    if (tick.simtrade || tick.intradayOdd) return null;
    const eventTimeMs = parseExchangeEventTimeMs(tick.date, tick.time);
    if (!validTrade(eventTimeMs, tick.price, tick.volume)) return null;
    if (!sessionAllows(securityType, eventTimeMs!, dayOnly)) return null;
    return {
        eventTimeMs: eventTimeMs!,
        price: tick.price!,
        volume: tick.volume,
        side: classifyTickType(tick.tickType),
    };
}

export function footprintTradeKey(trade: FootprintTrade): string {
    return [
        trade.eventTimeMs,
        trade.price,
        trade.volume,
        trade.side,
    ].join('|');
}

function passesImbalance(
    own: number,
    opposite: number,
    signedDelta: number,
    ratio: number,
    minDelta: number,
) {
    if (own <= 0 || Math.abs(signedDelta) < minDelta) return false;
    if (opposite <= 0) return own >= minDelta;
    return own / opposite >= ratio;
}

export class FootprintAggregator {
    private readonly bars = new Map<number, MutableBar>();
    private readonly compressedPriceCache = new Map<number, number>();
    private anchorPrice: number | null;

    constructor(
        private readonly contract: ContractInfo,
        private readonly settings: FootprintSettings,
    ) {
        const reference = Number(contract.reference);
        this.anchorPrice =
            Number.isFinite(reference) && reference > 0
                ? roundToTick(contract, reference)
                : null;
    }

    ingestMany(trades: Iterable<FootprintTrade>) {
        for (const trade of trades) this.ingest(trade);
    }

    ingest(trade: FootprintTrade) {
        if (
            !Number.isFinite(trade.eventTimeMs) ||
            !Number.isFinite(trade.price) ||
            !Number.isFinite(trade.volume) ||
            trade.volume <= 0 ||
            !sessionAllows(
                this.settings.securityType,
                trade.eventTimeMs,
                this.settings.dayOnly,
            )
        ) {
            return false;
        }

        const timeframeMs = Math.max(
            1_000,
            Math.floor(this.settings.timeframeSeconds * 1000),
        );
        const timestamp =
            Math.floor(trade.eventTimeMs / timeframeMs) * timeframeMs +
            timeframeMs;
        const price = roundToTick(this.contract, trade.price);
        const levelPrice = this.compressedPrice(price);

        let bar = this.bars.get(timestamp);
        if (!bar) {
            bar = {
                timestamp,
                open: price,
                high: price,
                low: price,
                close: price,
                volume: 0,
                firstEventTimeMs: trade.eventTimeMs,
                lastEventTimeMs: trade.eventTimeMs,
                levels: new Map(),
            };
            this.bars.set(timestamp, bar);
        }

        bar.high = Math.max(bar.high, price);
        bar.low = Math.min(bar.low, price);
        bar.volume += trade.volume;
        if (trade.eventTimeMs < bar.firstEventTimeMs) {
            bar.firstEventTimeMs = trade.eventTimeMs;
            bar.open = price;
        }
        if (trade.eventTimeMs >= bar.lastEventTimeMs) {
            bar.lastEventTimeMs = trade.eventTimeMs;
            bar.close = price;
        }

        const level = bar.levels.get(levelPrice) ?? emptyLevel();
        level[trade.side === 'buy'
            ? 'buyVolume'
            : trade.side === 'sell'
              ? 'sellVolume'
              : 'neutralVolume'] += trade.volume;
        level.totalVolume += trade.volume;
        bar.levels.set(levelPrice, level);
        return true;
    }

    snapshot(): FootprintBar[] {
        return [...this.bars.values()]
            .sort((a, b) => a.timestamp - b.timestamp)
            .map((bar) => this.finalizeBar(bar));
    }

    private compressedPrice(price: number): number {
        const normalized = roundToTick(this.contract, price);
        const cached = this.compressedPriceCache.get(normalized);
        if (cached !== undefined) return cached;

        const compression = Math.max(
            1,
            Math.floor(this.settings.tickCompression),
        );
        if (compression === 1) {
            this.compressedPriceCache.set(normalized, normalized);
            return normalized;
        }

        if (this.anchorPrice === null) this.anchorPrice = normalized;
        let cursor = this.anchorPrice;

        if (normalized >= cursor) {
            for (let i = 0; i < MAX_LADDER_STEPS; i += 1) {
                const next = stepPrice(this.contract, cursor, compression);
                if (!Number.isFinite(next) || next <= cursor + EPSILON) break;
                if (normalized < next - EPSILON) {
                    this.compressedPriceCache.set(normalized, cursor);
                    return cursor;
                }
                cursor = next;
            }
        } else {
            for (let i = 0; i < MAX_LADDER_STEPS; i += 1) {
                const next = stepPrice(this.contract, cursor, -compression);
                if (!Number.isFinite(next) || next >= cursor - EPSILON) break;
                cursor = next;
                const upper = stepPrice(this.contract, cursor, compression);
                if (
                    normalized >= cursor - EPSILON &&
                    normalized < upper - EPSILON
                ) {
                    this.compressedPriceCache.set(normalized, cursor);
                    return cursor;
                }
            }
        }

        // Guard fallback: never drop a valid trade if a vendor tick-band
        // definition cannot be traversed as expected.
        this.compressedPriceCache.set(normalized, normalized);
        return normalized;
    }

    private finalizedLevels(bar: MutableBar): FootprintLevel[] {
        if (bar.levels.size === 0) return [];
        const prices = [...bar.levels.keys()].sort((a, b) => a - b);
        const min = prices[0]!;
        const max = prices[prices.length - 1]!;
        const compression = Math.max(
            1,
            Math.floor(this.settings.tickCompression),
        );
        const filled = new Map<number, MutableLevel>();

        let cursor = min;
        for (let i = 0; i < MAX_LADDER_STEPS; i += 1) {
            filled.set(cursor, bar.levels.get(cursor) ?? emptyLevel());
            if (cursor >= max - EPSILON) break;
            const next = stepPrice(this.contract, cursor, compression);
            if (!Number.isFinite(next) || next <= cursor + EPSILON) break;
            cursor = next > max && max - cursor > EPSILON ? max : next;
        }
        for (const [price, level] of bar.levels) {
            if (!filled.has(price)) filled.set(price, level);
        }

        const levels: FootprintLevel[] = [...filled.entries()]
            .sort(([a], [b]) => a - b)
            .map(([price, level]) => ({
                price,
                buyVolume: level.buyVolume,
                sellVolume: level.sellVolume,
                neutralVolume: level.neutralVolume,
                totalVolume: level.totalVolume,
                delta: level.buyVolume - level.sellVolume,
            }));

        const ratio = Math.max(1, this.settings.imbalanceRatio);
        const minDelta = Math.max(0, this.settings.minDelta);
        for (let i = 0; i < levels.length; i += 1) {
            const level = levels[i]!;
            const lower = levels[i - 1];
            const higher = levels[i + 1];

            level.buyHorizontalImbalance = passesImbalance(
                level.buyVolume,
                level.sellVolume,
                level.delta,
                ratio,
                minDelta,
            );
            level.sellHorizontalImbalance = passesImbalance(
                level.sellVolume,
                level.buyVolume,
                -level.delta,
                ratio,
                minDelta,
            );
            level.buyImbalance = lower
                ? passesImbalance(
                      level.buyVolume,
                      lower.sellVolume,
                      level.buyVolume - lower.sellVolume,
                      ratio,
                      minDelta,
                  )
                : false;
            level.sellImbalance = higher
                ? passesImbalance(
                      level.sellVolume,
                      higher.buyVolume,
                      level.sellVolume - higher.buyVolume,
                      ratio,
                      minDelta,
                  )
                : false;
        }
        return levels;
    }

    private finalizeBar(bar: MutableBar): FootprintBar {
        const levels = this.finalizedLevels(bar);
        let pocPrice: number | undefined;
        let pocVolume = -1;
        let deltaPocPrice: number | undefined;
        let deltaPocAbs = -1;

        for (const level of levels) {
            if (
                level.totalVolume > pocVolume ||
                (level.totalVolume === pocVolume &&
                    (pocPrice === undefined || level.price > pocPrice))
            ) {
                pocVolume = level.totalVolume;
                pocPrice = level.price;
            }
            const absDelta = Math.abs(level.delta);
            if (
                absDelta > deltaPocAbs ||
                (absDelta === deltaPocAbs &&
                    (deltaPocPrice === undefined ||
                        level.price > deltaPocPrice))
            ) {
                deltaPocAbs = absDelta;
                deltaPocPrice = level.price;
            }
        }

        return {
            timestamp: Math.floor(bar.timestamp / 1000),
            open: bar.open,
            high: bar.high,
            low: bar.low,
            close: bar.close,
            volume: bar.volume,
            levels,
            pocPrice,
            deltaPocPrice,
        };
    }
}
