// src/features/orderflow/domain/contracts.ts
// Shared contracts reserved for staged Order Flow visualizations.
// Development 2 defines shapes only; later developments own computation/rendering.

import type { OrderFlowSide } from './types';

export interface OrderFlowTick {
    code: string;
    date: string;
    time: string;
    eventTimeMs: number | null;
    price: number | null;
    volume: number;
    totalVolume: number;
    tickType: number;
    side: OrderFlowSide;
    simtrade: boolean;
}

export interface OrderFlowBookLevel {
    price: number | null;
    volume: number;
    diffVolume?: number;
}

export interface OrderFlowBook {
    code: string;
    date: string;
    time: string;
    eventTimeMs: number | null;
    bids: OrderFlowBookLevel[];
    asks: OrderFlowBookLevel[];
    simtrade: boolean;
}

export interface FootprintLevel {
    price: number;
    buyVolume: number;
    sellVolume: number;
    neutralVolume: number;
    totalVolume: number;
    delta: number;
    /** Diagonal ask-vs-bid imbalance. */
    buyImbalance?: boolean;
    /** Diagonal bid-vs-ask imbalance. */
    sellImbalance?: boolean;
    /** Same-price buy-vs-sell imbalance. */
    buyHorizontalImbalance?: boolean;
    /** Same-price sell-vs-buy imbalance. */
    sellHorizontalImbalance?: boolean;
}

export interface FootprintBar {
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    levels: FootprintLevel[];
    pocPrice?: number;
    deltaPocPrice?: number;
}

export interface VolumeProfileLevel {
    price: number;
    buyVolume: number;
    sellVolume: number;
    neutralVolume: number;
    totalVolume: number;
}

export interface VolumeProfile {
    fromTime: number;
    toTime: number;
    levels: VolumeProfileLevel[];
    pocPrice: number | null;
    vahPrice: number | null;
    valPrice: number | null;
    totalVolume: number;
}

export interface BubbleTrade {
    timestamp: number;
    price: number;
    side: OrderFlowSide;
    volume: number;
}

export interface FlowLadderLevel {
    price: number;
    bidSize: number;
    askSize: number;
    movingBuy: number;
    movingSell: number;
    movingNeutral: number;
    movingDelta: number;
    dailyBuy: number;
    dailySell: number;
    dailyNeutral: number;
}
