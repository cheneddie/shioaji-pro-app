// Development 6 — isolated Order Flow K-line Volume Profile drawing.
// No native Shioaji chart/drawing/VolProfile code is changed.
import type { IChartApi, ISeriesApi, UTCTimestamp } from 'lightweight-charts';
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { ContractInfo } from '../../../lib/types/contract';
import type { ChartColors } from '../../../lib/theme-store';
import {
    aggregateRangeVolumeProfile, mergeProfileHistoryAndLive,
    normalizeVolumeProfileDrawings, profileDateRange,
    volumeProfileHistoryTrade, volumeProfileLiveTrade,
    type VolumeProfileDrawing, type VolumeProfileTrade,
} from '../domain/volume-profile';
import { getOrderFlowRuntime } from '../runtime/order-flow-runtime';
import * as styles from './order-flow-volume-profile.css';

interface StoredDrawings {
    key: string;
    drawings: VolumeProfileDrawing[];
}
function drawingStorageKey(
    panelId: string, contract: ContractInfo, session: string,
) {
    return [
        'sj-pro-orderflow-vp',
        encodeURIComponent(panelId),
        encodeURIComponent(contract.code),
        encodeURIComponent(contract.target_code ?? ''),
        encodeURIComponent(session),
    ].join('-');
}
function loadDrawings(key: string): VolumeProfileDrawing[] {
    try {
        if (typeof localStorage === 'undefined') return [];
        return normalizeVolumeProfileDrawings(
            JSON.parse(localStorage.getItem(key) ?? '[]'),
        );
    } catch { return []; }
}
function saveDrawings(key: string, drawings: VolumeProfileDrawing[]) {
    try { localStorage.setItem(key, JSON.stringify(drawings)); }
    catch { /* quota/private mode does not crash panel */ }
}
function datesFor(drawings: VolumeProfileDrawing[], timeframeMinutes: number) {
    const dates = new Set<string>();
    for (const drawing of drawings) {
        const range = profileDateRange(drawing.fromTime, drawing.toTime,
            31, timeframeMinutes < 1440);
        if (!range) return null;
        range.forEach((date) => dates.add(date));
        if (dates.size > 31) return null;
    }
    return [...dates].sort();
}
function coordinateTime(
    chart: IChartApi, clientX: number, host: HTMLDivElement,
): number | null {
    const x = clientX - host.getBoundingClientRect().left;
    const time = chart.timeScale().coordinateToTime(x);
    return typeof time === 'number' && Number.isFinite(time) ? time : null;
}
function normalizedDrawing(
    id: string, a: number, b: number,
): VolumeProfileDrawing {
    return { id, fromTime: Math.min(a, b), toTime: Math.max(a, b) };
}

export function OrderFlowVolumeProfileDrawingLayer({
    panelId, contract, timeframeMinutes, dayOnly, runtimeSession,
    historyRevision, active, onActiveChange,
    hostRef, chartRef, candleRef, colors,
}: {
    panelId: string;
    contract: ContractInfo;
    timeframeMinutes: number;
    dayOnly: boolean;
    runtimeSession: 'all' | 'day' | 'night';
    historyRevision: number;
    active: boolean;
    onActiveChange: (active: boolean) => void;
    hostRef: RefObject<HTMLDivElement | null>;
    chartRef: RefObject<IChartApi | null>;
    candleRef: RefObject<ISeriesApi<'Candlestick'> | null>;
    colors: ChartColors;
}) {
    const storageKey = drawingStorageKey(panelId, contract, runtimeSession);
    const [saved, setSaved] = useState<StoredDrawings>(() => ({
        key: storageKey, drawings: loadDrawings(storageKey),
    }));
    const drawings = saved.key === storageKey
        ? saved.drawings : loadDrawings(storageKey);
    const [start, setStart] = useState<number | null>(null);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const dragRef = useRef<{ id: string; edge: 'fromTime' | 'toTime'; opposite: number } | null>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const frameRef = useRef<number | null>(null);
    const liveRef = useRef<VolumeProfileTrade[]>([]);
    const hydratedRef = useRef(false);
    const historyRef = useRef<VolumeProfileTrade[]>([]);
    const updateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [data, setData] = useState<{
        key: string; status: 'idle' | 'loading' | 'ready' | 'error';
        trades: VolumeProfileTrade[]; error?: string;
    }>({ key: '', status: 'idle', trades: [] });

    const commit = (next: VolumeProfileDrawing[]) => {
        const normalized = normalizeVolumeProfileDrawings(next);
        setSaved({ key: storageKey, drawings: normalized });
        saveDrawings(storageKey, normalized);
    };

    useEffect(() => {
        setStart(null);
        onActiveChange(false);
    }, [storageKey, timeframeMinutes]);

    const dateList = useMemo(() => datesFor(drawings, timeframeMinutes), [drawings, timeframeMinutes]);
    const dateKey = dateList === null ? 'invalid' : dateList.join(',');
    const dataKey = [
        contract.region, contract.security_type, contract.exchange,
        contract.code, contract.target_code, runtimeSession,
        dayOnly, timeframeMinutes, historyRevision, dateKey,
    ].join('|');

    // Hydrate each required date through the existing deduped runtime
    // history cache. Historical and live flow are reconciled by multiplicity.
    // Missing history is an explicit error; never silently show partial POC.
    useEffect(() => {
        if (!dateList?.length) {
            setData({
                key: dataKey, status: dateList === null ? 'error' : 'idle',
                trades: [],
                error: dateList === null ? '最多選取 31 個日曆日' : undefined,
            });
            return;
        }
        const runtime = getOrderFlowRuntime(contract, runtimeSession);
        const release = runtime.retain();
        let cancelled = false;
        liveRef.current = [];
        historyRef.current = [];
        hydratedRef.current = false;
        setData({ key: dataKey, status: 'loading', trades: [] });
        const allowedDates = new Set(dateList);
        const publish = () => {
            if (cancelled) return;
            setData({
                key: dataKey, status: 'ready',
                trades: mergeProfileHistoryAndLive(
                    historyRef.current, liveRef.current,
                ),
            });
        };
        const offTick = runtime.subscribeTicks((tick) => {
            const trade = volumeProfileLiveTrade(
                tick, timeframeMinutes, contract.security_type, dayOnly,
            );
            if (!trade) return;
            const date = new Date(trade.eventTimeMs).toISOString().slice(0, 10);
            if (!allowedDates.has(date)) return;
            liveRef.current.push(trade);
            if (!hydratedRef.current) return;
            if (updateTimerRef.current) return;
            updateTimerRef.current = setTimeout(() => {
                updateTimerRef.current = null;
                publish();
            }, 125);
        });
        void (async () => {
            const collected: VolumeProfileTrade[] = [];
            try {
                // Sequential requests cap network pressure; the shared runtime
                // coalesces identical per-day calls across all consumers.
                for (const date of dateList) {
                    const history = await runtime.loadHistory(
                        date, { revision: historyRevision },
                    );
                    if (cancelled) return;
                    for (const tick of history.ticks) {
                        const trade = volumeProfileHistoryTrade(
                            tick, timeframeMinutes,
                            contract.security_type, dayOnly,
                        );
                        if (trade) collected.push(trade);
                    }
                }
                if (cancelled) return;
                historyRef.current = collected;
                hydratedRef.current = true;
                publish();
            } catch (error) {
                if (cancelled) return;
                setData({
                    key: dataKey, status: 'error', trades: [],
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        })();
        return () => {
            cancelled = true;
            offTick();
            release();
            if (updateTimerRef.current) {
                clearTimeout(updateTimerRef.current);
                updateTimerRef.current = null;
            }
            historyRef.current = [];
            liveRef.current = [];
            hydratedRef.current = false;
        };
    }, [dataKey]);

    const ready = data.key === dataKey && data.status === 'ready';
    const profiles = useMemo(
        () => ready ? drawings.map((drawing) => ({
            drawing, profile: aggregateRangeVolumeProfile(
                data.trades, drawing, contract.tick ?? 1,
            ),
        })) : [],
        [drawings, data, ready, contract.tick],
    );

    // Two chart clicks create a drawing; both anchors are candle-label times.
    // Unselected mode preserves ordinary chart drag/zoom/click behavior.
    useEffect(() => {
        const chart = chartRef.current;
        if (!chart || !active) return;
        const onClick = (param: { time?: unknown }) => {
            if (typeof param.time !== 'number' || !Number.isFinite(param.time)) return;
            const time = param.time;
            if (start === null) {
                setStart(time);
                return;
            }
            const id = globalThis.crypto?.randomUUID?.() ??
                String(Date.now()) + '-' + String(Math.random());
            commit([...drawings, normalizedDrawing(id, start, time)]);
            setSelectedId(id);
            setStart(null);
            onActiveChange(false);
        };
        chart.subscribeClick(onClick);
        return () => chart.unsubscribeClick(onClick);
    }, [active, start, storageKey, drawings, chartRef]);

    // Drag the top-of-chart edge handles. Capture the pointer so a drag does
    // not inadvertently pan the chart or trigger trading actions.
    useEffect(() => {
        const host = hostRef.current;
        const chart = chartRef.current;
        if (!host || !chart || !drawings.length) return;
        const onDown = (event: PointerEvent) => {
            if (active) return;
            const bounds = host.getBoundingClientRect();
            if (event.clientY - bounds.top > 24) return;
            const timeScale = chart.timeScale();
            for (const drawing of drawings.slice().reverse()) {
                for (const edge of ['fromTime', 'toTime'] as const) {
                    const x = timeScale.timeToCoordinate(
                        drawing[edge] as UTCTimestamp,
                    );
                    if (x !== null && Math.abs(event.clientX - bounds.left - x) <= 8) {
                        dragRef.current = { id: drawing.id, edge,
                            opposite: edge === 'fromTime' ? drawing.toTime : drawing.fromTime };
                        setSelectedId(drawing.id);
                        event.preventDefault();
                        event.stopPropagation();
                        host.setPointerCapture?.(event.pointerId);
                        return;
                    }
                }
            }
        };
        const onMove = (event: PointerEvent) => {
            const drag = dragRef.current;
            if (!drag) return;
            event.preventDefault();
            event.stopPropagation();
            const next = coordinateTime(chart, event.clientX, host);
            if (next === null) return;
            const updated = drawings.map((drawing) => {
                if (drawing.id !== drag.id) return drawing;
                // Preserve the opposite physical anchor while crossing it.
                return normalizedDrawing(drawing.id, next, drag.opposite);
            });
            commit(updated);
        };
        const onUp = (event: PointerEvent) => {
            if (!dragRef.current) return;
            dragRef.current = null;
            host.releasePointerCapture?.(event.pointerId);
            event.stopPropagation();
        };
        host.addEventListener('pointerdown', onDown, true);
        host.addEventListener('pointermove', onMove, true);
        host.addEventListener('pointerup', onUp, true);
        host.addEventListener('pointercancel', onUp, true);
        return () => {
            host.removeEventListener('pointerdown', onDown, true);
            host.removeEventListener('pointermove', onMove, true);
            host.removeEventListener('pointerup', onUp, true);
            host.removeEventListener('pointercancel', onUp, true);
        };
    }, [drawings, active, storageKey]);

    useEffect(() => {
        const host = hostRef.current;
        const canvas = canvasRef.current;
        const chart = chartRef.current;
        const candle = candleRef.current;
        if (!host || !canvas || !chart || !candle ||
            typeof canvas.getContext !== 'function') return;
        const draw = () => {
            frameRef.current = null;
            const width = Math.max(1, host.clientWidth);
            const height = Math.max(1, host.clientHeight);
            const dpr = Math.max(1, window.devicePixelRatio || 1);
            canvas.width = Math.round(width * dpr);
            canvas.height = Math.round(height * dpr);
            canvas.style.width = String(width) + 'px';
            canvas.style.height = String(height) + 'px';
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.clearRect(0, 0, width, height);
            const timeScale = chart.timeScale();
            const drawAnchor = (time: number, color: string) => {
                const x = timeScale.timeToCoordinate(time as UTCTimestamp);
                if (x === null || x < 0 || x > width) return null;
                ctx.strokeStyle = color;
                ctx.setLineDash([3, 4]);
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.fillStyle = color;
                ctx.fillRect(x - 5, 1, 10, 9);
                return x;
            };
            for (const drawing of drawings) {
                const color = drawing.id === selectedId ? colors.up : colors.crosshair;
                drawAnchor(drawing.fromTime, color);
                drawAnchor(drawing.toTime, color);
            }
            if (start !== null) drawAnchor(start, colors.up);
            if (!ready) return;
            for (const { drawing, profile } of profiles) {
                if (!profile) continue;
                const x1 = timeScale.timeToCoordinate(drawing.fromTime as UTCTimestamp);
                const x2 = timeScale.timeToCoordinate(drawing.toTime as UTCTimestamp);
                if (x1 === null || x2 === null) continue;
                const right = Math.max(x1, x2);
                const chartWidth = Math.min(140, Math.max(15, Math.abs(x2 - x1) * 0.8));
                const maximum = profile.levels.reduce((m, row) => Math.max(m, row.total), 0);
                if (maximum <= 0) continue;
                // Never use unbounded price range or per-tick DOM nodes.
                for (let i = 0; i < profile.levels.length; i++) {
                    const row = profile.levels[i]!;
                    const y = candle.priceToCoordinate(row.price);
                    if (y === null || y < -5 || y > height + 5) continue;
                    const nextY = i + 1 < profile.levels.length
                        ? candle.priceToCoordinate(profile.levels[i + 1]!.price)
                        : null;
                    const rowHeight = Math.max(1, Math.min(10,
                        nextY === null ? 3 : Math.abs(nextY - y) * 0.75));
                    let rightEdge = right;
                    for (const [volume, fill] of [
                        [row.buy, colors.up],
                        [row.sell, colors.down],
                        [row.neutral, colors.text],
                    ] as const) {
                        const w = chartWidth * volume / maximum;
                        if (w <= 0) continue;
                        ctx.globalAlpha = fill === colors.text ? 0.35 : 0.65;
                        ctx.fillStyle = fill;
                        ctx.fillRect(rightEdge - w, y - rowHeight / 2, w, rowHeight);
                        rightEdge -= w;
                    }
                    ctx.globalAlpha = 1;
                }
                for (const [label, price, color] of [
                    ['POC', profile.poc, colors.up],
                    ['VAH', profile.vah, colors.crosshair],
                    ['VAL', profile.val, colors.crosshair],
                ] as const) {
                    const y = candle.priceToCoordinate(price);
                    if (y === null || y < 0 || y > height) continue;
                    ctx.strokeStyle = color;
                    ctx.beginPath();
                    ctx.moveTo(right - chartWidth, y);
                    ctx.lineTo(right + 2, y);
                    ctx.stroke();
                    ctx.fillStyle = color;
                    ctx.font = '9px monospace';
                    ctx.fillText(label, right - chartWidth, Math.max(10, y - 3));
                }
            }
        };
        const schedule = () => {
            if (frameRef.current !== null) return;
            frameRef.current = window.requestAnimationFrame(draw);
        };
        draw();
        const scale = chart.timeScale();
        scale.subscribeVisibleLogicalRangeChange(schedule);
        scale.subscribeVisibleTimeRangeChange(schedule);
        candle.subscribeDataChanged(schedule);
        const resize = typeof ResizeObserver === 'undefined'
            ? null : new ResizeObserver(schedule);
        resize?.observe(host);
        const onWheel = () => schedule();
        host.addEventListener('wheel', onWheel, { capture: true, passive: true });
        host.addEventListener('pointermove', onWheel, true);
        return () => {
            scale.unsubscribeVisibleLogicalRangeChange(schedule);
            scale.unsubscribeVisibleTimeRangeChange(schedule);
            candle.unsubscribeDataChanged(schedule);
            resize?.disconnect();
            host.removeEventListener('wheel', onWheel, true);
            host.removeEventListener('pointermove', onWheel, true);
            if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
            frameRef.current = null;
        };
    }, [drawings, profiles, ready, start, selectedId, colors, hostRef, chartRef, candleRef]);

    return (
        <>
            <canvas ref={canvasRef} aria-label='Order Flow Volume Profile drawing'
                className={styles.canvas} />
            {(drawings.length > 0 || active) && (
                <div className={styles.actions}>
                    {active && <span>{start === null
                        ? 'VP：點選起點' : 'VP：點選終點'}</span>}
                    {drawings.length > 0 && <>
                        <label>
                            區間
                            <select aria-label='選擇 Volume Profile'
                                value={selectedId && drawings.some((d) => d.id === selectedId)
                                    ? selectedId : drawings[drawings.length - 1]!.id}
                                onChange={(event) => setSelectedId(event.target.value)}>
                                {drawings.map((drawing, index) =>
                                    <option value={drawing.id} key={drawing.id}>
                                        VP {index + 1}
                                    </option>,
                                )}
                            </select>
                        </label>
                        <span>{ready ? 'VP 已載入' :
                            (data.key === dataKey && data.status === 'error')
                                ? (data.error ?? '歷史不完整')
                                : 'VP 載入中'}</span>
                        <button type='button' className={styles.actionButton}
                            onClick={() => {
                                const chosen = selectedId && drawings.some((d) => d.id === selectedId)
                                    ? selectedId : drawings[drawings.length - 1]!.id;
                                commit(drawings.filter((d) => d.id !== chosen));
                                setSelectedId(null);
                            }}>
                            刪除選取
                        </button>
                        <button type='button' className={styles.actionButton}
                            onClick={() => commit([])}>
                            清除 VP
                        </button>
                    </>}
                </div>
            )}
        </>
    );
}
