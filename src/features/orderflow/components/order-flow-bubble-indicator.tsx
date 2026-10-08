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
import {
    orderFlowEventTradingDate,
    orderFlowExpectedStartMs,
    orderFlowHistoryDate,
} from '../runtime/trading-date';
import { OrderFlowBubbleLayer } from './order-flow-bubble-layer';

const MAX_BUBBLE_TRADES = 300_000;
const TRIM_BUBBLE_BATCH = 10_000;
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
    const [coverage, setCoverage] = useState<'loading' | 'gap' | 'unverified' | 'ready'>('loading');
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
        const loadDate = orderFlowHistoryDate(
            contract.security_type, dayOnly,
        );
        const loadKey = [
            contract.code,
            contract.target_code ?? '',
            runtimeSession,
            loadDate ?? 'calendar-unknown',
            timeframeMinutes,
            dayOnly,
            historyRevision,
        ].join('|');
        let cancelled = false;

        loadedKeyRef.current = '';
        tradesRef.current = [];
        const replay = runtime.bufferedTicks();
        const bufferedTrades = replay.ticks
            .map((raw) => bubbleTradeFromRaw(
                raw,
                timeframeMinutes,
                contract.security_type,
                dayOnly,
            ))
            .filter((trade): trade is BubbleSourceTrade =>
                trade !== null && (
                    loadDate === null ||
                    orderFlowEventTradingDate(
                        contract.security_type,
                        dayOnly,
                        trade.eventTimeMs,
                    ) === loadDate
                ),
            );
        pendingRef.current = bufferedTrades;
        aggregatorRef.current = new BubbleAggregator(
            settingsRef.current,
        );
        setCandidates([]);
        setCoverage('loading');

        const commitTrades = (trades: BubbleSourceTrade[]) => {
            if (cancelled) return;
            pendingRef.current = [];
            tradesRef.current = boundedTrades(trades);
            const next = new BubbleAggregator(settingsRef.current);
            next.ingestMany(tradesRef.current);
            aggregatorRef.current = next;
            loadedKeyRef.current = loadKey;
            setCandidates(next.snapshot());
        };

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
                    MAX_BUBBLE_TRADES + TRIM_BUBBLE_BATCH
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

        if (loadDate === null) {
            // Missing authoritative exchange calendar: do not query a made-up
            // futures trading date. The received stream remains usable.
            commitTrades(pendingRef.current);
            setCoverage('gap');
        } else {
            void runtime.loadHistory(loadDate, {
                revision: historyRevision,
            }).then((history) => {
                if (cancelled) return;
                const historyTrades = history.ticks
                    .map((tick) => bubbleTradeFromHistory(
                        tick, timeframeMinutes, contract.security_type, dayOnly,
                    ))
                    .filter((trade): trade is BubbleSourceTrade => trade !== null);
                const merged = mergeBubbleHistoryAndPending(
                    historyTrades, pendingRef.current,
                );
                const expected = orderFlowExpectedStartMs(
                    loadDate, contract.security_type, dayOnly,
                );
                // Historical ticks cannot prove there are no internal gaps.
                // Only report "ready" for a past non-futures history window;
                // active futures remain explicitly unverified.
                const earliest = merged.reduce(
                    (min, trade) => Math.min(min, trade.eventTimeMs),
                    Number.POSITIVE_INFINITY,
                );
                const missingOpen = expected !== null && earliest > expected + 5 * 60_000;
                setCoverage(
                    replay.truncated || missingOpen || merged.length === 0
                        ? 'gap'
                        : contract.security_type === 'FUT' ||
                          contract.security_type === 'OPT'
                            ? 'unverified' : 'ready',
                );
                commitTrades(merged);
            }).catch(() => {
                if (cancelled) return;
                commitTrades(pendingRef.current);
                setCoverage('gap');
            });
        }

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
        <>
            {coverage !== 'ready' && coverage !== 'loading' && (
                <div role="status" data-orderflow-tick-coverage={coverage}
                    style={{
                        position: 'absolute', top: 8, left: 8, zIndex: 12,
                        pointerEvents: 'none', padding: '3px 7px',
                        borderRadius: 4, background: 'rgba(30,30,30,.8)',
                        color: '#fff', fontSize: 11,
                    }}>
                    {coverage === 'gap'
                        ? 'DATA GAP · 歷史成交不完整，僅呈現已取得 Tick'
                        : 'Tick 完整性未驗證 · 不代表完整盤中成交'}
                </div>
            )}
            <OrderFlowBubbleLayer
                hostRef={hostRef}
                chartRef={chartRef}
                candleRef={candleRef}
                candidates={candidates}
                settings={settings}
                colors={colors}
            />
        </>
    );
}
