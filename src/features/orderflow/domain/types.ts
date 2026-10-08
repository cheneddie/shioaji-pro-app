// src/features/orderflow/domain/types.ts

export type OrderFlowSession = 'all' | 'day' | 'night';
export type OrderFlowSide = 'buy' | 'sell' | 'neutral';

export interface OrderFlowRuntimeIdentity {
    market: string;
    symbol: string;
    session: OrderFlowSession;
}

export interface OrderFlowVolumeBucket {
    buy: number;
    sell: number;
    neutral: number;
    total: number;
}

export interface OrderFlowPriceLevel {
    price: number;
    dailyBuy: number;
    dailySell: number;
    dailyNeutral: number;
    dailyTotal: number;
    movingBuy: number;
    movingSell: number;
    movingNeutral: number;
    movingTotal: number;
    movingDelta: number;
    bidSize: number;
    askSize: number;
}

export type OrderFlowHistoryStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface OrderFlowHistoryHealth {
    status: OrderFlowHistoryStatus;
    date?: string;
    error?: string;
}

export interface OrderFlowRuntimeHealth {
    active: boolean;
    refs: number;
    streamStatus: 'connecting' | 'live' | 'down' | 'stale';
    stale: boolean;
    lastTickAt: number | null;
    lastBookAt: number | null;
    eventGapMs: number | null;
    rawTickCount: number;
    tradeTickCount: number;
    bookCount: number;
    duplicateTickCount: number;
    outOfOrderTickCount: number;
    outOfOrderBookCount: number;
    invalidEventTimeCount: number;
    history: OrderFlowHistoryHealth;
}

export interface OrderFlowRuntimeSnapshot {
    identity: OrderFlowRuntimeIdentity;
    version: number;
    lastPrice: number | null;
    levels: OrderFlowPriceLevel[];
    health: OrderFlowRuntimeHealth;
}

export interface OrderFlowHistoryTick {
    datetime: string;
    eventTimeMs: number | null;
    price: number | null;
    volume: number;
    tickType: number;
    side: OrderFlowSide;
}

export interface OrderFlowHistory {
    date: string;
    ticks: OrderFlowHistoryTick[];
}
