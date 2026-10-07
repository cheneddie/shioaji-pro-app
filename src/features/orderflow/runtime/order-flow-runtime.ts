// src/features/orderflow/runtime/order-flow-runtime.ts

import { getApiBase } from '../../../lib/runtime';
import { retainQuote } from '../../../lib/quote-ownership';
import {
    ensureStream,
    getStreamStatus,
    subscribeStatusStore,
} from '../../../lib/stream';
import type { ContractBase } from '../../../lib/types/contract';
import {
    ORDER_FLOW_NOTIFY_MS,
} from '../domain/constants';
import type {
    OrderFlowHistory,
    OrderFlowPriceLevel,
    OrderFlowRuntimeIdentity,
    OrderFlowRuntimeSnapshot,
    OrderFlowSession,
} from '../domain/types';
import { BookAggregator } from './book-aggregator';
import {
    subscribeOrderFlowBooks,
    subscribeOrderFlowTicks,
} from './market-event-bridge';
import { fetchOrderFlowHistory } from './order-flow-history';
import { TickAggregator } from './tick-aggregator';

type Listener = () => void;

const registry = new Map<string, OrderFlowRuntime>();

function marketOf(contract: ContractBase) {
    return [
        contract.region ?? 'TW',
        contract.security_type ?? 'UNKNOWN',
        contract.exchange ?? 'UNKNOWN',
    ].join(':');
}

function runtimeKey(contract: ContractBase, session: OrderFlowSession) {
    return JSON.stringify([
        getApiBase(),
        marketOf(contract),
        contract.code.trim().toUpperCase(),
        session,
    ]);
}

function zero(value: number | undefined) {
    return value ?? 0;
}

export class OrderFlowRuntime {
    readonly identity: OrderFlowRuntimeIdentity;

    private refs = 0;
    private active = false;
    private disposed = false;
    private version = 0;
    private cachedSnapshot: OrderFlowRuntimeSnapshot | null = null;
    private listeners = new Set<Listener>();
    private notifyTimer: ReturnType<typeof setTimeout> | null = null;

    private tickAggregator = new TickAggregator();
    private bookAggregator = new BookAggregator();
    private streamStatus = getStreamStatus();
    private historyState: {
        status: 'idle' | 'loading' | 'ready' | 'error';
        date?: string;
        error?: string;
    } = { status: 'idle' };

    private stopTick?: () => void;
    private stopBook?: () => void;
    private stopStatus?: () => void;
    private releaseTickQuote?: () => void;
    private releaseBookQuote?: () => void;
    private lifecycle = 0;

    constructor(
        private readonly contract: ContractBase,
        readonly session: OrderFlowSession,
        private readonly registryId: string,
    ) {
        this.identity = {
            market: marketOf(contract),
            symbol: contract.code.trim().toUpperCase(),
            session,
        };
    }

    retain(): () => void {
        if (this.disposed) {
            throw new Error('OrderFlowRuntime has been disposed');
        }
        this.refs += 1;
        if (this.refs === 1) this.start();
        this.invalidate(false);

        let released = false;
        return () => {
            if (released) return;
            released = true;
            this.refs = Math.max(0, this.refs - 1);
            if (this.refs === 0) this.dispose();
            else this.invalidate(false);
        };
    }

    subscribe(listener: Listener) {
        if (this.disposed) return () => undefined;
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    getSnapshot(): OrderFlowRuntimeSnapshot {
        if (this.cachedSnapshot) return this.cachedSnapshot;

        const prices = new Set<number>([
            ...this.tickAggregator.daily.keys(),
            ...this.tickAggregator.moving.keys(),
            ...this.bookAggregator.bids.keys(),
            ...this.bookAggregator.asks.keys(),
        ]);
        const levels: OrderFlowPriceLevel[] = [...prices]
            .sort((a, b) => b - a)
            .map((price) => {
                const daily = this.tickAggregator.daily.get(price);
                const moving = this.tickAggregator.moving.get(price);
                const movingBuy = zero(moving?.buy);
                const movingSell = zero(moving?.sell);
                return {
                    price,
                    dailyBuy: zero(daily?.buy),
                    dailySell: zero(daily?.sell),
                    dailyNeutral: zero(daily?.neutral),
                    dailyTotal: zero(daily?.total),
                    movingBuy,
                    movingSell,
                    movingNeutral: zero(moving?.neutral),
                    movingTotal: zero(moving?.total),
                    movingDelta: movingBuy - movingSell,
                    bidSize: zero(this.bookAggregator.bids.get(price)),
                    askSize: zero(this.bookAggregator.asks.get(price)),
                };
            });

        const lastTickAt = this.tickAggregator.lastObservedEventTimeMs;
        const lastBookAt = this.bookAggregator.lastEventTimeMs;
        const eventGapMs =
            lastTickAt !== null && lastBookAt !== null
                ? Math.abs(lastTickAt - lastBookAt)
                : null;

        this.cachedSnapshot = {
            identity: this.identity,
            version: this.version,
            lastPrice: this.tickAggregator.lastPrice,
            levels,
            health: {
                active: this.active,
                refs: this.refs,
                streamStatus: this.streamStatus,
                stale: this.streamStatus !== 'live',
                lastTickAt,
                lastBookAt,
                eventGapMs,
                rawTickCount: this.tickAggregator.rawTickCount,
                tradeTickCount: this.tickAggregator.tradeTickCount,
                bookCount: this.bookAggregator.bookCount,
                duplicateTickCount: this.tickAggregator.duplicateTickCount,
                outOfOrderTickCount:
                    this.tickAggregator.outOfOrderTickCount,
                outOfOrderBookCount:
                    this.bookAggregator.outOfOrderBookCount,
                invalidEventTimeCount:
                    this.tickAggregator.invalidEventTimeCount,
                history: { ...this.historyState },
            },
        };
        return this.cachedSnapshot;
    }

    async loadHistory(
        date: string,
        opts?: { revision?: number },
    ): Promise<OrderFlowHistory> {
        if (this.disposed) {
            throw new Error('OrderFlowRuntime has been disposed');
        }
        const lifecycle = this.lifecycle;
        this.historyState = { status: 'loading', date };
        this.invalidate();
        try {
            const history = await fetchOrderFlowHistory(
                this.contract,
                date,
                opts,
            );
            if (!this.disposed && lifecycle === this.lifecycle) {
                this.historyState = { status: 'ready', date };
                this.invalidate();
            }
            return history;
        } catch (error) {
            if (!this.disposed && lifecycle === this.lifecycle) {
                this.historyState = {
                    status: 'error',
                    date,
                    error:
                        error instanceof Error
                            ? error.message
                            : String(error),
                };
                this.invalidate();
            }
            throw error;
        }
    }

    private start() {
        this.active = true;
        this.lifecycle += 1;
        ensureStream();
        this.releaseTickQuote = retainQuote(this.contract, 'Tick');
        this.releaseBookQuote = retainQuote(this.contract, 'BidAsk');
        this.stopTick = subscribeOrderFlowTicks(
            this.identity.symbol,
            (tick) => {
                // Every raw event changes runtime health counters/time even
                // when it is simtrade or zero-volume and therefore excluded
                // from executed-flow totals.
                this.tickAggregator.ingest(tick);
                this.invalidate();
            },
        );
        this.stopBook = subscribeOrderFlowBooks(
            this.identity.symbol,
            (book) => {
                this.bookAggregator.ingest(book);
                this.invalidate();
            },
        );
        this.stopStatus = subscribeStatusStore(() => {
            const next = getStreamStatus();
            if (next === this.streamStatus) return;
            this.streamStatus = next;
            this.invalidate();
        });
        this.streamStatus = getStreamStatus();
    }

    private invalidate(notify = true) {
        this.version += 1;
        this.cachedSnapshot = null;
        if (!notify || this.listeners.size === 0 || this.notifyTimer) return;
        this.notifyTimer = setTimeout(() => {
            this.notifyTimer = null;
            for (const listener of this.listeners) {
                try {
                    listener();
                } catch (error) {
                    console.error(
                        '[orderflow] runtime listener threw',
                        error,
                    );
                }
            }
        }, ORDER_FLOW_NOTIFY_MS);
    }

    private dispose() {
        if (this.disposed) return;
        this.active = false;
        this.disposed = true;
        this.lifecycle += 1;
        this.stopTick?.();
        this.stopBook?.();
        this.stopStatus?.();
        this.releaseTickQuote?.();
        this.releaseBookQuote?.();
        this.stopTick = undefined;
        this.stopBook = undefined;
        this.stopStatus = undefined;
        this.releaseTickQuote = undefined;
        this.releaseBookQuote = undefined;
        if (this.notifyTimer) clearTimeout(this.notifyTimer);
        this.notifyTimer = null;
        this.listeners.clear();
        registry.delete(this.registryId);
        this.invalidate(false);
    }
}

export function getOrderFlowRuntime(
    contract: ContractBase,
    session: OrderFlowSession = 'all',
) {
    const key = runtimeKey(contract, session);
    let runtime = registry.get(key);
    if (!runtime) {
        runtime = new OrderFlowRuntime(contract, session, key);
        registry.set(key, runtime);
    }
    return runtime;
}

export function retainOrderFlowRuntime(
    contract: ContractBase,
    session: OrderFlowSession = 'all',
) {
    const runtime = getOrderFlowRuntime(contract, session);
    return { runtime, release: runtime.retain() };
}
