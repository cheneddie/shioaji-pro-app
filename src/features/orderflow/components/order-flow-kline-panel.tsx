// src/features/orderflow/components/order-flow-kline-panel.tsx

import {
    CandlestickSeries,
    ColorType,
    createChart,
    HistogramSeries,
    type IChartApi,
    type ISeriesApi,
    type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef, useState } from 'react';
import { AsyncStatus } from '../../../components/async-status';
import { RefreshButton } from '../../../components/refresh-button';
import { fetchChartHistory, nextChartHistoryRevision } from '../../../lib/chart-history';
import {
    daySessionLabel,
    parseChartSessionMode,
    supportsSessionSplit,
    type ChartSessionMode,
} from '../../../lib/intraday-session';
import { getChartColors, themeKey as themeKeyOf, useThemeSettings } from '../../../lib/theme-store';
import type { ContractInfo } from '../../../lib/types/contract';
import type { Candle } from '../../../lib/types/market';
import { dateStrOffset } from '../../../lib/utils/kbars';
import {
    applyOrderFlowTrade,
    orderFlowHistoryBars,
    orderFlowHistoryCutoff,
    projectOrderFlowTick,
} from '../domain/kline';
import { getOrderFlowRuntime } from '../runtime/order-flow-runtime';
import type { OrderFlowRawTick } from '../runtime/market-event-bridge';
import type { OrderFlowKlineTrade } from '../domain/kline';
import * as styles from './order-flow-kline-panel.css';

const TIMEFRAMES = [
    { label: '1m', minutes: 1, days: 3 },
    { label: '5m', minutes: 5, days: 10 },
    { label: '15m', minutes: 15, days: 20 },
    { label: '60m', minutes: 60, days: 60 },
    { label: '1D', minutes: 1440, days: 240 },
] as const;

export function OrderFlowKlinePanel({
    contract,
    sessionMode: sessionModeProp,
    onSessionModeChange,
}: {
    contract: ContractInfo;
    sessionMode?: ChartSessionMode;
    onSessionModeChange?: (mode: ChartSessionMode) => void;
}) {
    const hostRef = useRef<HTMLDivElement>(null);
    const chartRef = useRef<IChartApi | null>(null);
    const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
    const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
    const barsRef = useRef<Candle[]>([]);
    const lastBarRef = useRef<Candle | null>(null);
    const loadedKeyRef = useRef('');
    const pendingTradesRef = useRef<OrderFlowKlineTrade[]>([]);

    const [tfIndex, setTfIndex] = useState(1);
    const [historyRevision, setHistoryRevision] = useState(0);
    const [loading, setLoading] = useState(false);
    const [historyError, setHistoryError] = useState(false);
    const [empty, setEmpty] = useState(false);

    const parsedSession = parseChartSessionMode(sessionModeProp);
    const [localSession, setLocalSession] = useState<ChartSessionMode>(
        parsedSession ?? 'all',
    );
    const canDayOnly = supportsSessionSplit(contract);
    const sessionMode = onSessionModeChange
        ? (parsedSession ?? 'all')
        : localSession;
    const dayOnly = canDayOnly && sessionMode === 'day';
    const pickSession = (mode: ChartSessionMode) => {
        setLocalSession(mode);
        onSessionModeChange?.(mode);
    };

    const tf = TIMEFRAMES[tfIndex] ?? TIMEFRAMES[1];
    const loadKey = `${contract.code}|${contract.target_code ?? ''}|${tf.minutes}|${dayOnly}`;
    const runtimeSession = dayOnly ? 'day' : 'all';

    const themeSettings = useThemeSettings();
    const colors = getChartColors(themeSettings);
    const colorsRef = useRef(colors);
    colorsRef.current = colors;
    const themeKey = themeKeyOf(themeSettings);

    const writeBars = (bars: Candle[]) => {
        const colorsNow = colorsRef.current;
        candleRef.current?.setData(
            bars.map((bar) => ({
                time: bar.time as UTCTimestamp,
                open: bar.open,
                high: bar.high,
                low: bar.low,
                close: bar.close,
            })),
        );
        volumeRef.current?.setData(
            bars.map((bar) => ({
                time: bar.time as UTCTimestamp,
                value: bar.volume,
                color: bar.close >= bar.open ? colorsNow.upVol : colorsNow.downVol,
            })),
        );
        barsRef.current = bars;
        lastBarRef.current = bars.at(-1) ?? null;
    };

    const applyTrade = (trade: OrderFlowKlineTrade) => {
        const next = applyOrderFlowTrade(lastBarRef.current, trade);
        if (!next) return;

        if (next.append) barsRef.current.push(next.bar);
        else if (barsRef.current.length > 0) {
            barsRef.current[barsRef.current.length - 1] = next.bar;
        } else {
            barsRef.current.push(next.bar);
        }
        lastBarRef.current = next.bar;
        const c = colorsRef.current;
        try {
            candleRef.current?.update({
                time: next.bar.time as UTCTimestamp,
                open: next.bar.open,
                high: next.bar.high,
                low: next.bar.low,
                close: next.bar.close,
            });
            volumeRef.current?.update({
                time: next.bar.time as UTCTimestamp,
                value: next.bar.volume,
                color: next.bar.close >= next.bar.open ? c.upVol : c.downVol,
            });
        } catch {
            // A stale/out-of-order render update must not unmount the panel.
        }
        setEmpty(false);
        setHistoryError(false);
    };

    useEffect(() => {
        // Resolve inside the effect rather than memoizing a runtime object:
        // React StrictMode runs setup -> cleanup -> setup once in development.
        // The first cleanup may release the last consumer and dispose/delete
        // that runtime, so the second setup must ask the registry again.
        const runtime = getOrderFlowRuntime(contract, runtimeSession);
        const release = runtime.retain();
        const off = runtime.subscribeTicks((tick: OrderFlowRawTick) => {
            const trade = projectOrderFlowTick(
                tick,
                tf.minutes,
                contract.security_type,
                dayOnly,
            );
            if (!trade) return;
            if (loadedKeyRef.current !== loadKey) {
                // Buffer the compact projected trade rather than the raw SSE
                // payload. fetchChartHistory is timeout-bounded, so this keeps
                // every handoff trade without a lossy fixed-size cap.
                pendingTradesRef.current.push(trade);
                return;
            }
            applyTrade(trade);
        });
        return () => {
            off();
            release();
        };
    }, [
        contract.region,
        contract.security_type,
        contract.exchange,
        contract.code,
        contract.target_code,
        runtimeSession,
        loadKey,
        tf.minutes,
        dayOnly,
    ]);

    useEffect(() => {
        const host = hostRef.current;
        if (!host) return;
        const c = colorsRef.current;
        const chart = createChart(host, {
            layout: {
                background: { type: ColorType.Solid, color: 'transparent' },
                textColor: c.text,
                fontFamily: "'JetBrains Mono', monospace",
                fontSize: 10,
                attributionLogo: false,
            },
            grid: {
                vertLines: { color: c.grid },
                horzLines: { color: c.grid },
            },
            crosshair: {
                vertLine: { color: c.crosshair, labelBackgroundColor: c.labelBg },
                horzLine: { color: c.crosshair, labelBackgroundColor: c.labelBg },
            },
            rightPriceScale: { borderColor: c.border },
            timeScale: {
                borderColor: c.border,
                timeVisible: true,
                secondsVisible: false,
            },
            autoSize: true,
        });
        const candles = chart.addSeries(CandlestickSeries, {
            upColor: c.up,
            downColor: c.down,
            borderUpColor: c.up,
            borderDownColor: c.down,
            wickUpColor: c.up,
            wickDownColor: c.down,
        });
        const volume = chart.addSeries(HistogramSeries, {
            priceFormat: { type: 'volume' },
            priceScaleId: 'vol',
        });
        chart.priceScale('vol').applyOptions({
            scaleMargins: { top: 0.82, bottom: 0 },
        });
        chartRef.current = chart;
        candleRef.current = candles;
        volumeRef.current = volume;
        return () => {
            chart.remove();
            chartRef.current = null;
            candleRef.current = null;
            volumeRef.current = null;
        };
    }, []);

    useEffect(() => {
        const chart = chartRef.current;
        if (!chart) return;
        chart.applyOptions({
            layout: { textColor: colors.text },
            grid: {
                vertLines: { color: colors.grid },
                horzLines: { color: colors.grid },
            },
            crosshair: {
                vertLine: { color: colors.crosshair, labelBackgroundColor: colors.labelBg },
                horzLine: { color: colors.crosshair, labelBackgroundColor: colors.labelBg },
            },
            rightPriceScale: { borderColor: colors.border },
            timeScale: { borderColor: colors.border },
        });
        candleRef.current?.applyOptions({
            upColor: colors.up,
            downColor: colors.down,
            borderUpColor: colors.up,
            borderDownColor: colors.down,
            wickUpColor: colors.up,
            wickDownColor: colors.down,
        });
        writeBars(barsRef.current);
    }, [themeKey]);

    useEffect(() => {
        let cancelled = false;
        loadedKeyRef.current = '';
        pendingTradesRef.current = [];
        writeBars([]);
        setLoading(true);
        setHistoryError(false);
        setEmpty(false);

        void fetchChartHistory(
            contract,
            dateStrOffset(tf.days),
            dateStrOffset(0),
            { revision: historyRevision, timeoutMs: 30_000 },
        )
            .then((source) => {
                if (cancelled) return;
                const bars = orderFlowHistoryBars(
                    source,
                    tf.minutes,
                    contract.security_type,
                    dayOnly,
                );
                writeBars(bars);
                // K-bar datetimes are close-label-right minute coverage.
                // A raw trade at/after the last returned 1m label belongs to
                // data not covered by that completed minute, even when its
                // larger 5m/60m candle bucket equals the aggregate tail.
                const historyCutoff = orderFlowHistoryCutoff(
                    source,
                    contract.security_type,
                    dayOnly,
                );
                loadedKeyRef.current = loadKey;

                const pending = pendingTradesRef.current;
                pendingTradesRef.current = [];
                for (const trade of pending) {
                    if (trade.eventTime < historyCutoff) continue;
                    applyTrade(trade);
                }
                setEmpty(bars.length === 0 && lastBarRef.current === null);
                chartRef.current?.timeScale().fitContent();
            })
            .catch(() => {
                if (cancelled) return;
                loadedKeyRef.current = loadKey;
                const pending = pendingTradesRef.current;
                pendingTradesRef.current = [];
                for (const trade of pending) applyTrade(trade);
                setHistoryError(true);
                setEmpty(lastBarRef.current === null);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [contract, tf.minutes, tf.days, dayOnly, historyRevision, loadKey]);

    return (
        <div className={styles.wrap}>
            <div className={styles.toolbar}>
                {TIMEFRAMES.map((item, index) => (
                    <button
                        key={item.label}
                        type='button'
                        className={styles.button[index === tfIndex ? 'active' : 'normal']}
                        onClick={() => setTfIndex(index)}
                    >
                        {item.label}
                    </button>
                ))}
                {canDayOnly && (
                    <>
                        <button
                            type='button'
                            className={styles.button[sessionMode === 'all' ? 'active' : 'normal']}
                            onClick={() => pickSession('all')}
                        >
                            全盤
                        </button>
                        <button
                            type='button'
                            title={daySessionLabel(contract.security_type)}
                            className={styles.button[sessionMode === 'day' ? 'active' : 'normal']}
                            onClick={() => pickSession('day')}
                        >
                            日盤
                        </button>
                    </>
                )}
                <span className={styles.badge}>ORDER FLOW</span>
                <RefreshButton
                    label='更新歷史'
                    loading={loading}
                    onClick={() => setHistoryRevision(nextChartHistoryRevision())}
                />
            </div>
            <div ref={hostRef} className={styles.host}>
                {(loading || empty) && (
                    <div className={styles.status}>
                        <AsyncStatus
                            phase={
                                loading
                                    ? 'loading'
                                    : historyError
                                      ? 'error'
                                      : 'empty'
                            }
                            text={
                                loading
                                    ? `載入 ${tf.label} Order Flow K 線…`
                                    : historyError
                                      ? '歷史 K 線無法取得，等待即時成交'
                                      : '尚無 K 線資料'
                            }
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
