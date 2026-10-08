// src/features/orderflow/components/footprint-panel.tsx

import {
    useEffect,
    useRef,
    useState,
} from 'react';
import { AsyncStatus } from '../../../components/async-status';
import { RefreshButton } from '../../../components/refresh-button';
import {
    daySessionLabel,
    parseChartSessionMode,
    supportsSessionSplit,
    type ChartSessionMode,
} from '../../../lib/intraday-session';
import {
    getChartColors,
    useThemeSettings,
} from '../../../lib/theme-store';
import type { ContractInfo } from '../../../lib/types/contract';
import { dateStrOffset } from '../../../lib/utils/kbars';
import type { FootprintBar } from '../domain/contracts';
import {
    FootprintAggregator,
    footprintTradeFromHistory,
    footprintTradeFromRaw,
    footprintTradeKey,
    type FootprintDisplayMode,
    type FootprintSettings,
    type FootprintTrade,
} from '../domain/footprint';
import { getOrderFlowRuntime } from '../runtime/order-flow-runtime';
import { nextOrderFlowHistoryRevision } from '../runtime/order-flow-history';
import type { OrderFlowRawTick } from '../runtime/market-event-bridge';
import { FootprintGrid } from './footprint-grid';
import * as styles from './footprint-panel.css';

const TIMEFRAMES = [
    { label: '30s', seconds: 30 },
    { label: '1m', seconds: 60 },
    { label: '3m', seconds: 180 },
    { label: '5m', seconds: 300 },
    { label: '15m', seconds: 900 },
    { label: '30m', seconds: 1800 },
    { label: '60m', seconds: 3600 },
] as const;

interface FootprintPreferences {
    tfIndex: number;
    mode: FootprintDisplayMode;
    tickCompression: number;
    imbalanceRatio: number;
    minDelta: number;
    minimumVolume: number;
    opacity: number;
    showPoc: boolean;
    showDeltaPoc: boolean;
    showImbalance: boolean;
    visibleBars: number;
}

const DEFAULT_PREFS: FootprintPreferences = {
    tfIndex: 1,
    mode: 'bidask',
    tickCompression: 1,
    imbalanceRatio: 3,
    minDelta: 1,
    minimumVolume: 1,
    opacity: 88,
    showPoc: true,
    showDeltaPoc: true,
    showImbalance: true,
    visibleBars: 24,
};

function storageKey(panelId: string) {
    return `sj-pro-orderflow-footprint-${panelId}`;
}

function loadPreferences(panelId: string): FootprintPreferences {
    try {
        const raw = localStorage.getItem(storageKey(panelId));
        if (!raw) return DEFAULT_PREFS;
        const value = JSON.parse(raw) as Partial<FootprintPreferences>;
        const mode: FootprintDisplayMode =
            value.mode === 'delta' || value.mode === 'total'
                ? value.mode
                : 'bidask';
        return {
            tfIndex:
                Number.isInteger(value.tfIndex) &&
                Number(value.tfIndex) >= 0 &&
                Number(value.tfIndex) < TIMEFRAMES.length
                    ? Number(value.tfIndex)
                    : DEFAULT_PREFS.tfIndex,
            mode,
            tickCompression: [1, 2, 4, 8].includes(
                Number(value.tickCompression),
            )
                ? Number(value.tickCompression)
                : DEFAULT_PREFS.tickCompression,
            imbalanceRatio:
                Number.isFinite(value.imbalanceRatio) &&
                Number(value.imbalanceRatio) >= 1
                    ? Number(value.imbalanceRatio)
                    : DEFAULT_PREFS.imbalanceRatio,
            minDelta:
                Number.isFinite(value.minDelta) &&
                Number(value.minDelta) >= 0
                    ? Number(value.minDelta)
                    : DEFAULT_PREFS.minDelta,
            minimumVolume:
                Number.isFinite(value.minimumVolume) &&
                Number(value.minimumVolume) >= 1
                    ? Math.min(
                          1_000_000,
                          Math.floor(Number(value.minimumVolume)),
                      )
                    : DEFAULT_PREFS.minimumVolume,
            opacity:
                Number.isFinite(value.opacity) &&
                Number(value.opacity) >= 5 &&
                Number(value.opacity) <= 100
                    ? Number(value.opacity)
                    : DEFAULT_PREFS.opacity,
            showPoc:
                typeof value.showPoc === 'boolean'
                    ? value.showPoc
                    : DEFAULT_PREFS.showPoc,
            showDeltaPoc:
                typeof value.showDeltaPoc === 'boolean'
                    ? value.showDeltaPoc
                    : DEFAULT_PREFS.showDeltaPoc,
            showImbalance:
                typeof value.showImbalance === 'boolean'
                    ? value.showImbalance
                    : DEFAULT_PREFS.showImbalance,
            visibleBars: [12, 24, 48].includes(Number(value.visibleBars))
                ? Number(value.visibleBars)
                : DEFAULT_PREFS.visibleBars,
        };
    } catch {
        return DEFAULT_PREFS;
    }
}

function mergePendingWithHistory(
    historyTrades: FootprintTrade[],
    pendingTrades: FootprintTrade[],
) {
    const counts = new Map<string, number>();
    for (const trade of historyTrades) {
        const key = footprintTradeKey(trade);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const merged = [...historyTrades];
    for (const trade of pendingTrades) {
        const key = footprintTradeKey(trade);
        const remaining = counts.get(key) ?? 0;
        if (remaining > 0) {
            counts.set(key, remaining - 1);
            continue;
        }
        merged.push(trade);
    }
    return merged;
}

export function FootprintPanel({
    panelId,
    contract,
    sessionMode: sessionModeProp,
    onSessionModeChange,
}: {
    panelId: string;
    contract: ContractInfo;
    sessionMode?: ChartSessionMode;
    onSessionModeChange?: (mode: ChartSessionMode) => void;
}) {
    const initialPrefs = useRef(loadPreferences(panelId)).current;
    const [tfIndex, setTfIndex] = useState(initialPrefs.tfIndex);
    const [mode, setMode] = useState(initialPrefs.mode);
    const [tickCompression, setTickCompression] = useState(
        initialPrefs.tickCompression,
    );
    const [imbalanceRatio, setImbalanceRatio] = useState(
        initialPrefs.imbalanceRatio,
    );
    const [minDelta, setMinDelta] = useState(initialPrefs.minDelta);
    const [minimumVolume, setMinimumVolume] = useState(
        initialPrefs.minimumVolume,
    );
    const [opacity, setOpacity] = useState(initialPrefs.opacity);
    const [showPoc, setShowPoc] = useState(initialPrefs.showPoc);
    const [showDeltaPoc, setShowDeltaPoc] = useState(
        initialPrefs.showDeltaPoc,
    );
    const [showImbalance, setShowImbalance] = useState(
        initialPrefs.showImbalance,
    );
    const [visibleBars, setVisibleBars] = useState(
        initialPrefs.visibleBars,
    );
    const [bars, setBars] = useState<FootprintBar[]>([]);
    const [loading, setLoading] = useState(false);
    const [historyError, setHistoryError] = useState(false);
    const [streamStatus, setStreamStatus] = useState('connecting');
    const [historyRevision, setHistoryRevision] = useState(0);

    const parsedSession = parseChartSessionMode(sessionModeProp);
    const [localSession, setLocalSession] = useState<ChartSessionMode>(
        parsedSession ?? 'all',
    );
    const canDayOnly = supportsSessionSplit(contract);
    const sessionMode = onSessionModeChange
        ? (parsedSession ?? 'all')
        : localSession;
    const dayOnly = canDayOnly && sessionMode === 'day';
    const runtimeSession = dayOnly ? 'day' : 'all';
    const pickSession = (next: ChartSessionMode) => {
        setLocalSession(next);
        onSessionModeChange?.(next);
    };

    const tf = TIMEFRAMES[tfIndex] ?? TIMEFRAMES[1];
    const themeSettings = useThemeSettings();
    const colors = getChartColors(themeSettings);

    const allTradesRef = useRef<FootprintTrade[]>([]);
    const pendingTradesRef = useRef<FootprintTrade[]>([]);
    const aggregatorRef = useRef<FootprintAggregator | null>(null);
    const loadedKeyRef = useRef('');
    const notifyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );
    const settingsRef = useRef<FootprintSettings>({
        timeframeSeconds: tf.seconds,
        tickCompression,
        imbalanceRatio,
        minDelta,
        dayOnly,
        securityType: contract.security_type,
    });
    settingsRef.current = {
        timeframeSeconds: tf.seconds,
        tickCompression,
        imbalanceRatio,
        minDelta,
        dayOnly,
        securityType: contract.security_type,
    };

    useEffect(() => {
        const prefs: FootprintPreferences = {
            tfIndex,
            mode,
            tickCompression,
            imbalanceRatio,
            minDelta,
            minimumVolume,
            opacity,
            showPoc,
            showDeltaPoc,
            showImbalance,
            visibleBars,
        };
        localStorage.setItem(storageKey(panelId), JSON.stringify(prefs));
    }, [
        panelId,
        tfIndex,
        mode,
        tickCompression,
        imbalanceRatio,
        minDelta,
        minimumVolume,
        opacity,
        showPoc,
        showDeltaPoc,
        showImbalance,
        visibleBars,
    ]);

    useEffect(() => {
        const aggregator = new FootprintAggregator(
            contract,
            settingsRef.current,
        );
        aggregator.ingestMany(allTradesRef.current);
        aggregatorRef.current = aggregator;
        setBars(aggregator.snapshot());
    }, [
        contract,
        tf.seconds,
        tickCompression,
        imbalanceRatio,
        minDelta,
        dayOnly,
    ]);

    useEffect(() => {
        const loadDate = dateStrOffset(0);
        const loadKey = [
            contract.code,
            contract.target_code ?? '',
            runtimeSession,
            loadDate,
            historyRevision,
        ].join('|');
        let cancelled = false;

        loadedKeyRef.current = '';
        allTradesRef.current = [];
        pendingTradesRef.current = [];
        aggregatorRef.current = new FootprintAggregator(
            contract,
            settingsRef.current,
        );
        setBars([]);
        setLoading(true);
        setHistoryError(false);

        // Resolve inside the effect for the same StrictMode reason as the
        // Development 3 K-line: cleanup can dispose the last registry runtime.
        const runtime = getOrderFlowRuntime(contract, runtimeSession);
        const release = runtime.retain();
        setStreamStatus(runtime.getSnapshot().health.streamStatus);

        const publish = () => {
            if (notifyTimerRef.current) return;
            notifyTimerRef.current = setTimeout(() => {
                notifyTimerRef.current = null;
                if (cancelled) return;
                setBars(aggregatorRef.current?.snapshot() ?? []);
            }, 32);
        };

        const offHealth = runtime.subscribe(() => {
            if (cancelled) return;
            setStreamStatus(runtime.getSnapshot().health.streamStatus);
        });
        const offTick = runtime.subscribeTicks(
            (tick: OrderFlowRawTick) => {
                const trade = footprintTradeFromRaw(
                    tick,
                    contract.security_type,
                    dayOnly,
                );
                if (!trade) return;
                if (loadedKeyRef.current !== loadKey) {
                    pendingTradesRef.current.push(trade);
                    return;
                }
                allTradesRef.current.push(trade);
                aggregatorRef.current?.ingest(trade);
                setHistoryError(false);
                publish();
            },
        );

        void runtime
            .loadHistory(loadDate, { revision: historyRevision })
            .then((history) => {
                if (cancelled) return;
                const historyTrades = history.ticks
                    .map((tick) =>
                        footprintTradeFromHistory(
                            tick,
                            contract.security_type,
                            dayOnly,
                        ),
                    )
                    .filter(
                        (trade): trade is FootprintTrade => trade !== null,
                    );
                const pending = pendingTradesRef.current;
                pendingTradesRef.current = [];
                const merged = mergePendingWithHistory(
                    historyTrades,
                    pending,
                );
                allTradesRef.current = merged;
                const aggregator = new FootprintAggregator(
                    contract,
                    settingsRef.current,
                );
                aggregator.ingestMany(merged);
                aggregatorRef.current = aggregator;
                loadedKeyRef.current = loadKey;
                setBars(aggregator.snapshot());
            })
            .catch(() => {
                if (cancelled) return;
                const pending = pendingTradesRef.current;
                pendingTradesRef.current = [];
                allTradesRef.current = pending;
                const aggregator = new FootprintAggregator(
                    contract,
                    settingsRef.current,
                );
                aggregator.ingestMany(pending);
                aggregatorRef.current = aggregator;
                loadedKeyRef.current = loadKey;
                setBars(aggregator.snapshot());
                setHistoryError(true);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });

        return () => {
            cancelled = true;
            offTick();
            offHealth();
            release();
            if (notifyTimerRef.current) {
                clearTimeout(notifyTimerRef.current);
                notifyTimerRef.current = null;
            }
        };
    }, [
        contract.region,
        contract.security_type,
        contract.exchange,
        contract.code,
        contract.target_code,
        runtimeSession,
        historyRevision,
        dayOnly,
    ]);

    const empty = !loading && bars.length === 0;

    return (
        <div className={styles.wrap}>
            <div className={styles.toolbar}>
                {TIMEFRAMES.map((item, index) => (
                    <button
                        key={item.label}
                        type='button'
                        className={
                            styles.button[
                                index === tfIndex ? 'active' : 'normal'
                            ]
                        }
                        onClick={() => setTfIndex(index)}
                    >
                        {item.label}
                    </button>
                ))}
                {canDayOnly && (
                    <>
                        <span className={styles.separator} />
                        <button
                            type='button'
                            className={
                                styles.button[
                                    sessionMode === 'all'
                                        ? 'active'
                                        : 'normal'
                                ]
                            }
                            onClick={() => pickSession('all')}
                        >
                            全盤
                        </button>
                        <button
                            type='button'
                            title={daySessionLabel(
                                contract.security_type,
                            )}
                            className={
                                styles.button[
                                    sessionMode === 'day'
                                        ? 'active'
                                        : 'normal'
                                ]
                            }
                            onClick={() => pickSession('day')}
                        >
                            日盤
                        </button>
                    </>
                )}
                <span className={styles.separator} />
                {(
                    [
                        ['bidask', 'B×A'],
                        ['delta', 'Δ'],
                        ['total', 'VOL'],
                    ] as const
                ).map(([value, label]) => (
                    <button
                        key={value}
                        type='button'
                        className={
                            styles.button[
                                mode === value ? 'active' : 'normal'
                            ]
                        }
                        onClick={() => setMode(value)}
                    >
                        {label}
                    </button>
                ))}
                <select
                    className={styles.select}
                    aria-label='Tick compression'
                    value={tickCompression}
                    onChange={(event) =>
                        setTickCompression(Number(event.target.value))
                    }
                >
                    {[1, 2, 4, 8].map((value) => (
                        <option key={value} value={value}>
                            {value}T
                        </option>
                    ))}
                </select>
                <select
                    className={styles.select}
                    aria-label='Imbalance ratio'
                    value={imbalanceRatio}
                    onChange={(event) =>
                        setImbalanceRatio(Number(event.target.value))
                    }
                >
                    {[2, 3, 4, 5].map((value) => (
                        <option key={value} value={value}>
                            {value}:1
                        </option>
                    ))}
                </select>
                <input
                    className={styles.input}
                    aria-label='Minimum delta'
                    type='number'
                    min={0}
                    step={1}
                    value={minDelta}
                    onChange={(event) =>
                        setMinDelta(
                            Math.max(0, Number(event.target.value) || 0),
                        )
                    }
                />
                <input
                    className={styles.input}
                    aria-label='Footprint minimum volume'
                    title='最低成交量'
                    type='number'
                    min={1}
                    max={1_000_000}
                    step={1}
                    value={minimumVolume}
                    onChange={(event) =>
                        setMinimumVolume(
                            Math.min(
                                1_000_000,
                                Math.max(
                                    1,
                                    Math.floor(
                                        Number(event.target.value) || 1,
                                    ),
                                ),
                            ),
                        )
                    }
                />
                <input
                    className={styles.input}
                    aria-label='Footprint opacity'
                    title='Profile 透明度 (%)'
                    type='number'
                    min={5}
                    max={100}
                    step={5}
                    value={opacity}
                    onChange={(event) =>
                        setOpacity(
                            Math.min(
                                100,
                                Math.max(
                                    5,
                                    Number(event.target.value) || 5,
                                ),
                            ),
                        )
                    }
                />
                <button
                    type='button'
                    className={
                        styles.button[showPoc ? 'active' : 'normal']
                    }
                    onClick={() => setShowPoc((value) => !value)}
                >
                    POC
                </button>
                <button
                    type='button'
                    className={
                        styles.button[
                            showDeltaPoc ? 'active' : 'normal'
                        ]
                    }
                    onClick={() => setShowDeltaPoc((value) => !value)}
                >
                    ΔPOC
                </button>
                <button
                    type='button'
                    className={
                        styles.button[
                            showImbalance ? 'active' : 'normal'
                        ]
                    }
                    onClick={() => setShowImbalance((value) => !value)}
                >
                    IMB
                </button>
                <select
                    className={styles.select}
                    aria-label='Visible bars'
                    value={visibleBars}
                    onChange={(event) =>
                        setVisibleBars(Number(event.target.value))
                    }
                >
                    {[12, 24, 48].map((value) => (
                        <option key={value} value={value}>
                            {value} bars
                        </option>
                    ))}
                </select>
                <span className={styles.badge}>FOOTPRINT</span>
                <span className={styles.health}>
                    {streamStatus.toUpperCase()}
                </span>
                <RefreshButton
                    label='更新逐筆'
                    loading={loading}
                    onClick={() =>
                        setHistoryRevision(
                            nextOrderFlowHistoryRevision(),
                        )
                    }
                />
            </div>
            <div className={styles.host}>
                <FootprintGrid
                    bars={bars}
                    contract={contract}
                    colors={colors}
                    mode={mode}
                    visibleBars={visibleBars}
                    minimumVolume={minimumVolume}
                    opacity={opacity}
                    showPoc={showPoc}
                    showDeltaPoc={showDeltaPoc}
                    showImbalance={showImbalance}
                />
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
                                    ? '載入 Footprint 逐筆歷史…'
                                    : historyError
                                      ? '歷史逐筆無法取得，等待即時成交'
                                      : '尚無 Footprint 成交資料'
                            }
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
