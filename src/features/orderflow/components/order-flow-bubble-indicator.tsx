// src/features/orderflow/components/order-flow-bubble-indicator.tsx

import type {
    IChartApi,
    ISeriesApi,
} from 'lightweight-charts';
import {
    useEffect,
    useRef,
    useState,
    type RefObject,
} from 'react';
import type { ChartColors } from '../../../lib/theme-store';
import type { ContractInfo } from '../../../lib/types/contract';
import { dateStrOffset } from '../../../lib/utils/kbars';
import {
    BubbleAggregator,
    bubbleTradeFromHistory,
    bubbleTradeFromRaw,
    mergeBubbleHistoryAndPending,
    type BubbleCandidate,
    type BubbleSettings,
    type BubbleSourceTrade,
} from '../domain/bubble';
import type { OrderFlowSession } from '../domain/types';
import { getOrderFlowRuntime } from '../runtime/order-flow-runtime';
import type { OrderFlowRawTick } from '../runtime/market-event-bridge';
import { OrderFlowBubbleLayer } from './order-flow-bubble-layer';

const MAX_BUBBLE_TRADES = 300_000;
const BUBBLE_NOTIFY_MS = 48;

function boundedTrades(trades: BubbleSourceTrade[]) {
    if (trades.length <= MAX_BUBBLE_TRADES) return trades;
    return trades.slice(-MAX_BUBBLE_TRADES);
}

export function OrderFlowBubbleIndicator({
    contract,
    timeframeMinutes,
    dayOnly,
    runtimeSession,
    historyRevision,
    settings,
    hostRef,
    chartRef,
    candleRef,
    colors,
}: {
    contract: ContractInfo;
    timeframeMinutes: number;
    dayOnly: boolean;
    runtimeSession: OrderFlowSession;
    historyRevision: number;
    settings: BubbleSettings;
    hostRef: RefObject<HTMLDivElement | null>;
    chartRef: RefObject<IChartApi | null>;
    candleRef: RefObject<ISeriesApi<'Candlestick'> | null>;
    colors: ChartColors;
}) {
    const [candidates, setCandidates] =
        useState<BubbleCandidate[]>([]);
    const settingsRef = useRef(settings);
    settingsRef.current = settings;

    const tradesRef = useRef<BubbleSourceTrade[]>([]);
    const pendingRef = useRef<BubbleSourceTrade[]>([]);
    const aggregatorRef = useRef(
        new BubbleAggregator(settings),
    );
    const loadedKeyRef = useRef('');
    const publishTimerRef =
        useRef<ReturnType<typeof setTimeout> | null>(null);

    const publish = () => {
        if (publishTimerRef.current) return;
        publishTimerRef.current = setTimeout(() => {
            publishTimerRef.current = null;
            setCandidates(
                aggregatorRef.current.snapshot(),
            );
        }, BUBBLE_NOTIFY_MS);
    };

    const rebuild = () => {
        const aggregator = new BubbleAggregator(
            settingsRef.current,
        );
        aggregator.ingestMany(tradesRef.current);
        aggregatorRef.current = aggregator;
        setCandidates(aggregator.snapshot());
    };

    useEffect(() => {
        rebuild();
        // Presentation/filter setting changes must not refetch ticks.
    }, [
        settings.filterMode,
        settings.direction,
        settings.minimumVolume,
        settings.maximumVolume,
        settings.chargeWindowSeconds,
    ]);

    useEffect(() => {
        const runtime = getOrderFlowRuntime(
            contract,
            runtimeSession,
        );
        const release = runtime.retain();
        const loadDate = dateStrOffset(0);
        const loadKey = [
            contract.code,
            contract.target_code ?? '',
            runtimeSession,
            loadDate,
            timeframeMinutes,
            dayOnly,
            historyRevision,
        ].join('|');
        let cancelled = false;

        loadedKeyRef.current = '';
        tradesRef.current = [];
        pendingRef.current = [];
        aggregatorRef.current = new BubbleAggregator(
            settingsRef.current,
        );
        setCandidates([]);

        const offTick = runtime.subscribeTicks(
            (tick: OrderFlowRawTick) => {
                const trade = bubbleTradeFromRaw(
                    tick,
                    timeframeMinutes,
                    contract.security_type,
                    dayOnly,
                );
                if (!trade) return;

                if (loadedKeyRef.current !== loadKey) {
                    pendingRef.current.push(trade);
                    return;
                }

                tradesRef.current.push(trade);
                if (
                    tradesRef.current.length >
                    MAX_BUBBLE_TRADES
                ) {
                    tradesRef.current = boundedTrades(
                        tradesRef.current,
                    );
                    const next = new BubbleAggregator(
                        settingsRef.current,
                    );
                    next.ingestMany(tradesRef.current);
                    aggregatorRef.current = next;
                } else {
                    aggregatorRef.current.ingest(trade);
                }
                publish();
            },
        );

        void runtime
            .loadHistory(loadDate, {
                revision: historyRevision,
            })
            .then((history) => {
                if (cancelled) return;
                const historyTrades = history.ticks
                    .map((tick) =>
                        bubbleTradeFromHistory(
                            tick,
                            timeframeMinutes,
                            contract.security_type,
                            dayOnly,
                        ),
                    )
                    .filter(
                        (
                            trade,
                        ): trade is BubbleSourceTrade =>
                            trade !== null,
                    );
                const merged =
                    mergeBubbleHistoryAndPending(
                        historyTrades,
                        pendingRef.current,
                    );
                pendingRef.current = [];
                tradesRef.current = boundedTrades(merged);
                const next = new BubbleAggregator(
                    settingsRef.current,
                );
                next.ingestMany(tradesRef.current);
                aggregatorRef.current = next;
                loadedKeyRef.current = loadKey;
                setCandidates(next.snapshot());
            })
            .catch(() => {
                if (cancelled) return;
                tradesRef.current = boundedTrades(
                    pendingRef.current,
                );
                pendingRef.current = [];
                const next = new BubbleAggregator(
                    settingsRef.current,
                );
                next.ingestMany(tradesRef.current);
                aggregatorRef.current = next;
                loadedKeyRef.current = loadKey;
                setCandidates(next.snapshot());
            });

        return () => {
            cancelled = true;
            offTick();
            release();
            if (publishTimerRef.current) {
                clearTimeout(publishTimerRef.current);
                publishTimerRef.current = null;
            }
        };
    }, [
        contract.region,
        contract.security_type,
        contract.exchange,
        contract.code,
        contract.target_code,
        timeframeMinutes,
        dayOnly,
        runtimeSession,
        historyRevision,
    ]);

    return (
        <OrderFlowBubbleLayer
            hostRef={hostRef}
            chartRef={chartRef}
            candleRef={candleRef}
            candidates={candidates}
            settings={settings}
            colors={colors}
        />
    );
}
