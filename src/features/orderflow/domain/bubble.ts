// src/features/orderflow/domain/bubble.ts

import {
    isDaySessionTick,
} from '../../../lib/intraday-session';
import type { SecurityType } from '../../../lib/types/contract';
import { wallClockToUtc } from '../../../lib/utils/kbars';
import type { OrderFlowHistoryTick } from './types';
import type { OrderFlowRawTick } from '../runtime/market-event-bridge';

export const BUBBLE_DIRECTIONS = ['all', 'buy', 'sell'] as const;
export type BubbleDirection = (typeof BUBBLE_DIRECTIONS)[number];

export const BUBBLE_FILTER_MODES = [
    'cumulative',
    'single',
    'charge',
] as const;
export type BubbleFilterMode = (typeof BUBBLE_FILTER_MODES)[number];

export const BUBBLE_SCALE_MODES = ['visible', 'bar'] as const;
export type BubbleScaleMode = (typeof BUBBLE_SCALE_MODES)[number];

export interface BubbleSettings {
    enabled: boolean;
    minimumVolume: number;
    maximumVolume: number;
    minimumRadius: number;
    opacity: number;
    direction: BubbleDirection;
    filterMode: BubbleFilterMode;
    chargeWindowSeconds: number;
    scaleMode: BubbleScaleMode;
    scalePercent: number;
}

export const DEFAULT_BUBBLE_SETTINGS: BubbleSettings = {
    enabled: false,
    minimumVolume: 1,
    maximumVolume: 0,
    minimumRadius: 1,
    opacity: 28,
    direction: 'all',
    filterMode: 'cumulative',
    chargeWindowSeconds: 1,
    scaleMode: 'visible',
    scalePercent: 100,
};

export interface BubbleSourceTrade {
    eventTimeMs: number;
    timestamp: number;
    price: number;
    side: 'buy' | 'sell';
    volume: number;
}

export interface BubbleCandidate {
    timestamp: number;
    price: number;
    side: 'buy' | 'sell';
    volume: number;
    rawValue: number;
}

export interface RenderedBubble {
    x: number;
    y: number;
    radius: number;
    candidate: BubbleCandidate;
}

const positive = (
    value: unknown,
    fallback: number,
    minimum: number,
    maximum = Number.POSITIVE_INFINITY,
) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(maximum, Math.max(minimum, parsed));
};

export function normalizeBubbleSettings(
    value?: Partial<BubbleSettings> | null,
): BubbleSettings {
    const source = {
        ...DEFAULT_BUBBLE_SETTINGS,
        ...(value ?? {}),
    };
    return {
        enabled: source.enabled === true,
        minimumVolume: positive(
            source.minimumVolume,
            DEFAULT_BUBBLE_SETTINGS.minimumVolume,
            1,
        ),
        maximumVolume: positive(
            source.maximumVolume,
            DEFAULT_BUBBLE_SETTINGS.maximumVolume,
            0,
        ),
        minimumRadius: positive(
            source.minimumRadius,
            DEFAULT_BUBBLE_SETTINGS.minimumRadius,
            0.5,
        ),
        opacity: positive(
            source.opacity,
            DEFAULT_BUBBLE_SETTINGS.opacity,
            5,
            100,
        ),
        direction: BUBBLE_DIRECTIONS.includes(
            source.direction as BubbleDirection,
        )
            ? (source.direction as BubbleDirection)
            : DEFAULT_BUBBLE_SETTINGS.direction,
        filterMode: BUBBLE_FILTER_MODES.includes(
            source.filterMode as BubbleFilterMode,
        )
            ? (source.filterMode as BubbleFilterMode)
            : DEFAULT_BUBBLE_SETTINGS.filterMode,
        chargeWindowSeconds: positive(
            source.chargeWindowSeconds,
            DEFAULT_BUBBLE_SETTINGS.chargeWindowSeconds,
            1,
            3_600,
        ),
        scaleMode: BUBBLE_SCALE_MODES.includes(
            source.scaleMode as BubbleScaleMode,
        )
            ? (source.scaleMode as BubbleScaleMode)
            : DEFAULT_BUBBLE_SETTINGS.scaleMode,
        scalePercent: positive(
            source.scalePercent,
            DEFAULT_BUBBLE_SETTINGS.scalePercent,
            0.01,
        ),
    };
}

function sideOfTickType(tickType: number): 'buy' | 'sell' | null {
    if (tickType === 1) return 'buy';
    if (tickType === 2) return 'sell';
    return null;
}

function candleTimestamp(
    eventTimeSeconds: number,
    timeframeMinutes: number,
) {
    if (timeframeMinutes >= 1440) {
        return Math.floor(eventTimeSeconds / 86_400) * 86_400;
    }
    const bucketSeconds = Math.max(60, timeframeMinutes * 60);
    return (
        Math.floor(eventTimeSeconds / bucketSeconds) * bucketSeconds +
        bucketSeconds
    );
}

function allowedSession(
    securityType: SecurityType,
    eventTimeSeconds: number,
    dayOnly: boolean,
) {
    return (
        !dayOnly ||
        isDaySessionTick(securityType, eventTimeSeconds)
    );
}

export function bubbleTradeFromRaw(
    tick: OrderFlowRawTick,
    timeframeMinutes: number,
    securityType: SecurityType,
    dayOnly: boolean,
): BubbleSourceTrade | null {
    if (
        tick.simtrade ||
        tick.intradayOdd ||
        tick.volume <= 0 ||
        tick.price === null ||
        !Number.isFinite(tick.price)
    ) {
        return null;
    }
    const side = sideOfTickType(tick.tickType);
    if (!side) return null;
    const eventTimeSeconds = wallClockToUtc(
        `${tick.date}T${tick.time}`,
    );
    if (!Number.isFinite(eventTimeSeconds)) return null;
    if (!allowedSession(securityType, eventTimeSeconds, dayOnly)) {
        return null;
    }
    return {
        eventTimeMs: eventTimeSeconds * 1_000,
        timestamp: candleTimestamp(
            eventTimeSeconds,
            timeframeMinutes,
        ),
        price: tick.price,
        side,
        volume: tick.volume,
    };
}

export function bubbleTradeFromHistory(
    tick: OrderFlowHistoryTick,
    timeframeMinutes: number,
    securityType: SecurityType,
    dayOnly: boolean,
): BubbleSourceTrade | null {
    if (
        tick.eventTimeMs === null ||
        !Number.isFinite(tick.eventTimeMs) ||
        tick.price === null ||
        !Number.isFinite(tick.price) ||
        !Number.isFinite(tick.volume) ||
        tick.volume <= 0 ||
        (tick.side !== 'buy' && tick.side !== 'sell')
    ) {
        return null;
    }
    const eventTimeSeconds = tick.eventTimeMs / 1_000;
    if (!allowedSession(securityType, eventTimeSeconds, dayOnly)) {
        return null;
    }
    return {
        eventTimeMs: tick.eventTimeMs,
        timestamp: candleTimestamp(
            eventTimeSeconds,
            timeframeMinutes,
        ),
        price: tick.price,
        side: tick.side,
        volume: tick.volume,
    };
}

export function bubbleTradeKey(trade: BubbleSourceTrade): string {
    return [
        trade.eventTimeMs,
        trade.price,
        trade.volume,
        trade.side,
    ].join('|');
}

export function mergeBubbleHistoryAndPending(
    history: BubbleSourceTrade[],
    pending: BubbleSourceTrade[],
): BubbleSourceTrade[] {
    const counts = new Map<string, number>();
    for (const trade of history) {
        const key = bubbleTradeKey(trade);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const merged = [...history];
    for (const trade of pending) {
        const key = bubbleTradeKey(trade);
        const count = counts.get(key) ?? 0;
        if (count > 0) {
            counts.set(key, count - 1);
            continue;
        }
        merged.push(trade);
    }
    return merged;
}

function volumeAllowed(
    volume: number,
    settings: BubbleSettings,
) {
    return (
        volume >= settings.minimumVolume &&
        (
            settings.maximumVolume === 0 ||
            volume <= settings.maximumVolume
        )
    );
}

function directionAllowed(
    side: 'buy' | 'sell',
    settings: BubbleSettings,
) {
    return (
        settings.direction === 'all' ||
        settings.direction === side
    );
}

interface CumulativeBucket {
    timestamp: number;
    price: number;
    delta: number;
}

export class BubbleAggregator {
    private cumulative = new Map<string, CumulativeBucket>();
    private single = new Map<string, BubbleCandidate>();
    private charge = new Map<string, BubbleCandidate>();

    constructor(readonly settings: BubbleSettings) {}

    ingestMany(trades: Iterable<BubbleSourceTrade>) {
        for (const trade of trades) this.ingest(trade);
    }

    ingest(trade: BubbleSourceTrade) {
        if (
            !Number.isFinite(trade.eventTimeMs) ||
            !Number.isFinite(trade.timestamp) ||
            !Number.isFinite(trade.price) ||
            !Number.isFinite(trade.volume) ||
            trade.volume <= 0
        ) {
            return false;
        }

        if (this.settings.filterMode === 'cumulative') {
            const key = `${trade.timestamp}|${trade.price}`;
            const current = this.cumulative.get(key) ?? {
                timestamp: trade.timestamp,
                price: trade.price,
                delta: 0,
            };
            current.delta +=
                trade.side === 'buy' ? trade.volume : -trade.volume;
            this.cumulative.set(key, current);
            return true;
        }

        if (this.settings.filterMode === 'single') {
            // Original workspace semantics filter the single-order size
            // before identical price/side buckets are accumulated.
            if (!volumeAllowed(trade.volume, this.settings)) {
                return false;
            }
            const key = [
                trade.timestamp,
                trade.price,
                trade.side,
            ].join('|');
            const current = this.single.get(key);
            if (current) {
                current.volume += trade.volume;
                current.rawValue += trade.volume;
            } else {
                this.single.set(key, {
                    timestamp: trade.timestamp,
                    price: trade.price,
                    side: trade.side,
                    volume: trade.volume,
                    rawValue: trade.volume,
                });
            }
            return true;
        }

        const windowMs =
            Math.max(1, Math.round(
                this.settings.chargeWindowSeconds,
            )) * 1_000;
        const windowStart =
            Math.floor(trade.eventTimeMs / windowMs) * windowMs;
        const key = `${windowStart}|${trade.side}`;
        const current = this.charge.get(key);
        if (current) {
            current.volume += trade.volume;
            current.rawValue += trade.volume;
        } else {
            // Charge anchors to the first order price and its candle.
            this.charge.set(key, {
                timestamp: trade.timestamp,
                price: trade.price,
                side: trade.side,
                volume: trade.volume,
                rawValue: trade.volume,
            });
        }
        return true;
    }

    snapshot(): BubbleCandidate[] {
        let candidates: BubbleCandidate[];
        if (this.settings.filterMode === 'cumulative') {
            candidates = [...this.cumulative.values()]
                .flatMap((bucket) => {
                    if (bucket.delta === 0) return [];
                    const volume = Math.abs(bucket.delta);
                    if (!volumeAllowed(volume, this.settings)) {
                        return [];
                    }
                    return [{
                        timestamp: bucket.timestamp,
                        price: bucket.price,
                        side: bucket.delta > 0
                            ? 'buy' as const
                            : 'sell' as const,
                        volume,
                        rawValue: bucket.delta,
                    }];
                });
        } else if (this.settings.filterMode === 'single') {
            candidates = [...this.single.values()];
        } else {
            candidates = [...this.charge.values()].filter(
                (candidate) =>
                    volumeAllowed(
                        candidate.volume,
                        this.settings,
                    ),
            );
        }

        return candidates
            .filter((candidate) =>
                directionAllowed(
                    candidate.side,
                    this.settings,
                ),
            )
            .sort((left, right) =>
                left.timestamp - right.timestamp ||
                right.price - left.price ||
                (
                    left.side === right.side
                        ? 0
                        : left.side === 'sell'
                          ? -1
                          : 1
                ),
            );
    }
}

export function bubbleScaleMaximum(
    candidate: BubbleCandidate,
    visible: BubbleCandidate[],
    scaleMode: BubbleScaleMode,
) {
    const sameScope =
        scaleMode === 'bar'
            ? visible.filter(
                  (item) =>
                      item.timestamp === candidate.timestamp,
              )
            : visible;
    return Math.max(
        1,
        ...sameScope.map((item) => item.volume),
    );
}

export function bubbleRadius(
    volume: number,
    scaleMaximum: number,
    settings: Pick<
        BubbleSettings,
        'minimumRadius' | 'scalePercent'
    >,
    barWidth: number,
) {
    const userScale =
        Number.isFinite(settings.scalePercent) &&
        settings.scalePercent > 0
            ? settings.scalePercent / 100
            : 1;
    const minimumRadius =
        Math.max(0.5, settings.minimumRadius) * userScale;
    const adaptiveMaximum =
        Math.max(
            minimumRadius,
            Math.min(
                40,
                Math.max(8, Math.max(1, barWidth) * 0.45),
            ) * userScale,
        );
    const ratio = Math.sqrt(
        Math.max(
            0,
            volume / Math.max(1, scaleMaximum),
        ),
    );
    return Math.max(
        minimumRadius,
        adaptiveMaximum * Math.min(1, ratio),
    );
}

export function hitTestBubble(
    bubbles: readonly RenderedBubble[],
    x: number,
    y: number,
): RenderedBubble | null {
    for (let index = bubbles.length - 1; index >= 0; index -= 1) {
        const bubble = bubbles[index]!;
        const dx = x - bubble.x;
        const dy = y - bubble.y;
        if (
            dx * dx + dy * dy <=
            bubble.radius * bubble.radius
        ) {
            return bubble;
        }
    }
    return null;
}
