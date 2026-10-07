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
    DEFAULT_BUBBLE_SETTINGS,
    normalizeBubbleSettings,
    type BubbleSettings,
} from '../domain/bubble';
import {
    applyOrderFlowTrade,
    orderFlowHistoryBars,
    orderFlowHistoryCutoff,
    projectOrderFlowTick,
} from '../domain/kline';
import { getOrderFlowRuntime } from '../runtime/order-flow-runtime';
import type { OrderFlowRawTick } from '../runtime/market-event-bridge';
import type { OrderFlowKlineTrade } from '../domain/kline';
import { OrderFlowBubbleIndicator } from './order-flow-bubble-indicator';
import * as styles from './order-flow-kline-panel.css';

const TIMEFRAMES = [
    { label: '1m', minutes: 1, days: 3 },
    { label: '5m', minutes: 5, days: 10 },
    { label: '15m', minutes: 15, days: 20 },
    { label: '60m', minutes: 60, days: 60 },
    { label: '1D', minutes: 1440, days: 240 },
] as const;

interface OrderFlowKlinePreferences {
    bubble?: Partial<BubbleSettings>;
}

function klineStorageKey(panelId: string) {
    return `sj-pro-orderflow-kline-${panelId}`;
}

function loadBubbleSettings(panelId: string): BubbleSettings {
    if (typeof localStorage === 'undefined') {
        return DEFAULT_BUBBLE_SETTINGS;
    }
    try {
        const raw = localStorage.getItem(klineStorageKey(panelId));
        if (!raw) return DEFAULT_BUBBLE_SETTINGS;
        const parsed = JSON.parse(raw) as OrderFlowKlinePreferences;
        return normalizeBubbleSettings(parsed.bubble);
    } catch {
        return DEFAULT_BUBBLE_SETTINGS;
    }
}

function saveBubbleSettings(
    panelId: string,
    bubble: BubbleSettings,
) {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(
            klineStorageKey(panelId),
            JSON.stringify({ bubble }),
        );
    } catch {
        // Storage quota/private-mode failure must not break the chart.
    }
}

export function OrderFlowKlinePanel({
    panelId = 'orderflow-kline',
    contract,
    sessionMode: sessionModeProp,
    onSessionModeChange,
}: {
    panelId?: string;
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
    const [chartReady, setChartReady] = useState(false);
    const [indicatorOpen, setIndicatorOpen] = useState(false);
    const [bubbleSettings, setBubbleSettings] = useState<BubbleSettings>(
        () => loadBubbleSettings(panelId),
    );

    const patchBubble = (patch: Partial<BubbleSettings>) => {
        setBubbleSettings((current) =>
            normalizeBubbleSettings({
                ...current,
                ...patch,
            }),
        );
    };

    useEffect(() => {
        saveBubbleSettings(panelId, bubbleSettings);
    }, [panelId, bubbleSettings]);

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
        setChartReady(true);
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
                <button
                    type='button'
                    className={
                        styles.button[
                            indicatorOpen || bubbleSettings.enabled
                                ? 'active'
                                : 'normal'
                        ]
                    }
                    onClick={() =>
                        setIndicatorOpen((value) => !value)
                    }
                >
                    指標
                </button>
                <span className={styles.badge}>ORDER FLOW</span>
                <RefreshButton
                    label='更新歷史'
                    loading={loading}
                    onClick={() => setHistoryRevision(nextChartHistoryRevision())}
                />
            </div>

            {indicatorOpen && (
                <div className={styles.indicatorPanel}>
                    <label className={styles.indicatorCheck}>
                        <input
                            type='checkbox'
                            checked={bubbleSettings.enabled}
                            onChange={(event) =>
                                patchBubble({
                                    enabled: event.target.checked,
                                })
                            }
                        />
                        成交氣泡
                    </label>
                    <label className={styles.indicatorControl}>
                        模式
                        <select
                            value={bubbleSettings.filterMode}
                            disabled={!bubbleSettings.enabled}
                            onChange={(event) =>
                                patchBubble({
                                    filterMode:
                                        event.target.value as BubbleSettings['filterMode'],
                                })
                            }
                        >
                            <option value='cumulative'>累積 Delta</option>
                            <option value='single'>單筆成交</option>
                            <option value='charge'>N 秒同向</option>
                        </select>
                    </label>
                    <label className={styles.indicatorControl}>
                        方向
                        <select
                            value={bubbleSettings.direction}
                            disabled={!bubbleSettings.enabled}
                            onChange={(event) =>
                                patchBubble({
                                    direction:
                                        event.target.value as BubbleSettings['direction'],
                                })
                            }
                        >
                            <option value='all'>全部</option>
                            <option value='buy'>買</option>
                            <option value='sell'>賣</option>
                        </select>
                    </label>
                    <label className={styles.indicatorControl}>
                        最小量
                        <input
                            type='number'
                            min={1}
                            value={bubbleSettings.minimumVolume}
                            disabled={!bubbleSettings.enabled}
                            onChange={(event) =>
                                patchBubble({
                                    minimumVolume:
                                        Number(event.target.value),
                                })
                            }
                        />
                    </label>
                    <label className={styles.indicatorControl}>
                        最大量
                        <input
                            type='number'
                            min={0}
                            value={bubbleSettings.maximumVolume}
                            disabled={!bubbleSettings.enabled}
                            onChange={(event) =>
                                patchBubble({
                                    maximumVolume:
                                        Number(event.target.value),
                                })
                            }
                        />
                    </label>
                    <label className={styles.indicatorControl}>
                        最小半徑
                        <input
                            type='number'
                            min={0.5}
                            step={0.5}
                            value={bubbleSettings.minimumRadius}
                            disabled={!bubbleSettings.enabled}
                            onChange={(event) =>
                                patchBubble({
                                    minimumRadius:
                                        Number(event.target.value),
                                })
                            }
                        />
                    </label>
                    <label className={styles.indicatorControl}>
                        透明度 %
                        <input
                            type='number'
                            min={5}
                            max={100}
                            value={bubbleSettings.opacity}
                            disabled={!bubbleSettings.enabled}
                            onChange={(event) =>
                                patchBubble({
                                    opacity:
                                        Number(event.target.value),
                                })
                            }
                        />
                    </label>
                    {bubbleSettings.filterMode === 'charge' && (
                        <label className={styles.indicatorControl}>
                            N 秒
                            <input
                                type='number'
                                min={1}
                                max={3600}
                                value={
                                    bubbleSettings.chargeWindowSeconds
                                }
                                disabled={!bubbleSettings.enabled}
                                onChange={(event) =>
                                    patchBubble({
                                        chargeWindowSeconds:
                                            Number(event.target.value),
                                    })
                                }
                            />
                        </label>
                    )}
                    <label className={styles.indicatorControl}>
                        比例基準
                        <select
                            value={bubbleSettings.scaleMode}
                            disabled={!bubbleSettings.enabled}
                            onChange={(event) =>
                                patchBubble({
                                    scaleMode:
                                        event.target.value as BubbleSettings['scaleMode'],
                                })
                            }
                        >
                            <option value='visible'>可視範圍</option>
                            <option value='bar'>單根 K</option>
                        </select>
                    </label>
                    <label className={styles.indicatorControl}>
                        放大 %
                        <input
                            type='number'
                            min={0.01}
                            step='any'
                            value={bubbleSettings.scalePercent}
                            disabled={!bubbleSettings.enabled}
                            onChange={(event) =>
                                patchBubble({
                                    scalePercent:
                                        Number(event.target.value),
                                })
                            }
                        />
                    </label>
                </div>
            )}
            <div ref={hostRef} className={styles.host}>
                {chartReady && bubbleSettings.enabled && (
                    <OrderFlowBubbleIndicator
                        contract={contract}
                        timeframeMinutes={tf.minutes}
                        dayOnly={dayOnly}
                        runtimeSession={runtimeSession}
                        historyRevision={historyRevision}
                        settings={bubbleSettings}
                        hostRef={hostRef}
                        chartRef={chartRef}
                        candleRef={candleRef}
                        colors={colors}
                    />
                )}
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
