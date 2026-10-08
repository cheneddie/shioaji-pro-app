// Development 7 — read-only Flow Ladder, independent from FlashOrder.
// Quotes come exclusively from the shared OrderFlowRuntime snapshot.
import { useEffect, useMemo, useRef, useState } from 'react';
import { vars } from '../../../theme.css';
import {
    parseChartSessionMode, supportsSessionSplit,
    type ChartSessionMode,
} from '../../../lib/intraday-session';
import { prefetchTickBands, useTickBandsVersion } from '../../../lib/tick-bands';
import type { ContractInfo } from '../../../lib/types/contract';
import { tickDecimals } from '../../../lib/utils/ticksize';
import { getOrderFlowRuntime } from '../runtime/order-flow-runtime';
import type { OrderFlowRuntimeSnapshot } from '../domain/types';
import {
    buildFlowLadderPrices, flowLadderMaxima, flowLadderViewport,
    ladderTickSize, projectFlowLadderRows,
    FLOW_LADDER_RADIUS, FLOW_LADDER_ROW_HEIGHT,
    FLOW_LADDER_WINDOW_SECONDS,
    type FlowLadderRow,
} from '../domain/flow-ladder';
import * as styles from './flow-ladder-panel.css';

// FlashOrder-inspired symmetric ladder: passive BID/ASK flank PRICE,
// moving and cumulative traded sides flank the book. No order callbacks.
const COLS = [
    { label: 'D.SEL', hint: 'Runtime 啟動後累積主動賣量（不是完整日量）' },
    { label: 'M.SEL', hint: '最近 300 秒主動賣量' },
    { label: 'BID', hint: '當前五檔被動買委託量' },
    { label: 'PRICE', hint: '價格中心軸（唯讀）' },
    { label: 'ASK', hint: '當前五檔被動賣委託量' },
    { label: 'M.BUY', hint: '最近 300 秒主動買量' },
    { label: 'D.BUY', hint: 'Runtime 啟動後累積主動買量（不是完整日量）' },
    { label: 'Δ', hint: '最近 300 秒 M.BUY − M.SEL' },
] as const;

function display(value: number) {
    return value ? value.toLocaleString('en-US') : '—';
}
function barPercent(value: number, max: number) {
    return Math.min(100, Math.max(0, value / max * 100));
}
function Cell({ value, maximum, side }: {
    value: number; maximum: number; side?: 'buy' | 'sell';
}) {
    return (
        <div className={styles.numeric}>
            {value > 0 && <div aria-hidden='true'
                className={styles.meter}
                style={{
                    width: barPercent(value, maximum) + '%',
                    background: side === 'sell' ? vars.color.down :
                        side === 'buy' ? vars.color.up : vars.color.foreground,
                }}
            />}
            <span className={styles.value}>{display(value)}</span>
        </div>
    );
}
function FlowLadderRowView({ row, max, decimals }: {
    row: FlowLadderRow;
    max: ReturnType<typeof flowLadderMaxima>;
    decimals: number;
}) {
    const delta = row.movingDelta;
    return (
        <div role='row' data-price={row.price}
            data-last={row.isLast ? 'true' : undefined}
            className={styles.row + (row.isLast ? ' ' + styles.lastRow : '')}>
            <Cell value={row.dailySell} maximum={max.cumulative} side='sell' />
            <Cell value={row.movingSell} maximum={max.moving} side='sell' />
            <Cell value={row.bidSize} maximum={max.book} side='buy' />
            <div role='cell' className={styles.price}>
                {row.price.toLocaleString('en-US', {
                    minimumFractionDigits: decimals, maximumFractionDigits: decimals,
                })}
            </div>
            <Cell value={row.askSize} maximum={max.book} side='sell' />
            <Cell value={row.movingBuy} maximum={max.moving} side='buy' />
            <Cell value={row.dailyBuy} maximum={max.cumulative} side='buy' />
            <div className={styles.numeric}>
                <span className={styles.value + (delta > 0 ? ' ' + styles.buy :
                    delta < 0 ? ' ' + styles.sell : '')}>
                    {delta > 0 ? '+' : ''}{display(delta)}
                </span>
            </div>
        </div>
    );
}

export function FlowLadderPanel({
    panelId, contract, sessionMode: sessionModeProp, onSessionModeChange,
}: {
    panelId: string;
    contract: ContractInfo;
    sessionMode?: ChartSessionMode;
    onSessionModeChange?: (session: ChartSessionMode) => void;
}) {
    const [localSession, setLocalSession] = useState<ChartSessionMode>(
        parseChartSessionMode(sessionModeProp) ?? 'all',
    );
    const canDayOnly = supportsSessionSplit(contract);
    const sessionMode = onSessionModeChange
        ? (parseChartSessionMode(sessionModeProp) ?? 'all')
        : localSession;
    const dayOnly = canDayOnly && sessionMode === 'day';
    const runtimeSession = dayOnly ? 'day' : 'all';
    const pickSession = (next: ChartSessionMode) => {
        setLocalSession(next);
        onSessionModeChange?.(next);
    };

    const tickBandsVersion = useTickBandsVersion();
    useEffect(() => {
        if ((contract.security_type === 'FUT' || contract.security_type === 'OPT') &&
            contract.tick_rule) {
            prefetchTickBands(contract.tick_rule, contract.security_type);
        }
    }, [contract.security_type, contract.tick_rule]);

    const identity = JSON.stringify([
        contract.region, contract.security_type, contract.exchange,
        contract.code, contract.target_code, runtimeSession,
    ]);
    const [versioned, setVersioned] = useState<{
        identity: string; snapshot: OrderFlowRuntimeSnapshot;
    } | null>(null);
    useEffect(() => {
        // StrictMode may dispose the first instance; resolve fresh in setup.
        const runtime = getOrderFlowRuntime(contract, runtimeSession);
        const release = runtime.retain();
        let active = true;
        const update = () => {
            if (active) setVersioned({
                identity, snapshot: runtime.getSnapshot(),
            });
        };
        const off = runtime.subscribe(update);
        update();
        return () => {
            active = false;
            off();
            release();
        };
    }, [identity]);

    const snapshot = versioned?.identity === identity ? versioned.snapshot : null;
    const lastPrice = snapshot?.lastPrice ?? null;
    const [follow, setFollow] = useState(true);
    const [hover, setHover] = useState(false);
    const [center, setCenter] = useState<number | null>(null);
    const [scrollTop, setScrollTop] = useState(0);
    const [height, setHeight] = useState(360);
    const listRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setCenter(null);
        setFollow(true);
        setHover(false);
        setScrollTop(0);
    }, [identity]);
    useEffect(() => {
        if (!follow || hover || lastPrice === null) return;
        setCenter((old) => old === lastPrice ? old : lastPrice);
    }, [lastPrice, follow, hover]);
    const centerPrice = center ?? lastPrice ?? (
        Number.isFinite(contract.reference) && contract.reference > 0
            ? contract.reference : null
    );
    const prices = useMemo(
        () => centerPrice === null ? [] : buildFlowLadderPrices(contract, centerPrice),
        [identity, centerPrice, contract.tick, contract.tick_rule, tickBandsVersion],
    );
    const rows = useMemo(
        () => projectFlowLadderRows(prices, snapshot?.levels ?? [], lastPrice, contract),
        [prices, snapshot, contract.tick, contract.tick_rule, tickBandsVersion],
    );
    const viewport = flowLadderViewport(rows.length, scrollTop,
        Math.max(FLOW_LADDER_ROW_HEIGHT, height - FLOW_LADDER_ROW_HEIGHT));
    const visible = rows.slice(viewport.start, viewport.end);
    const max = flowLadderMaxima(visible);
    const decimals = centerPrice === null ? 0 :
        tickDecimals(ladderTickSize(contract, centerPrice) ?? contract.tick ?? 1);

    useEffect(() => {
        const node = listRef.current;
        if (!node || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(() => {
            setHeight(node.clientHeight || 360);
        });
        observer.observe(node);
        setHeight(node.clientHeight || 360);
        return () => observer.disconnect();
    }, []);
    useEffect(() => {
        const node = listRef.current;
        if (!follow || hover || centerPrice === null || !rows.length) return;
        const h = node?.clientHeight || height;
        const viewportHeight = Math.max(
            FLOW_LADDER_ROW_HEIGHT, h - FLOW_LADDER_ROW_HEIGHT,
        );
        const target = Math.max(0, Math.min(
            rows.length * FLOW_LADDER_ROW_HEIGHT - viewportHeight,
            FLOW_LADDER_RADIUS * FLOW_LADDER_ROW_HEIGHT -
                viewportHeight / 2 + FLOW_LADDER_ROW_HEIGHT / 2,
        ));
        if (node) node.scrollTop = target + FLOW_LADDER_ROW_HEIGHT;
        setScrollTop(target);
    }, [centerPrice, follow, hover, rows.length, height]);

    const health = snapshot?.health;
    const live = health?.streamStatus === 'live';
    const streamLabel = live ? 'LIVE' : health?.streamStatus ?? '等待行情';
    const canRender = rows.length > 0;

    return (
        <section className={styles.shell} aria-label='Order Flow 報價'
            data-panel-id={panelId} data-read-only='true'>
            <div className={styles.toolbar}>
                <span className={styles.title}>FLOW DOM · FLASH 版型</span>
                {canDayOnly && <>
                    <button type='button' className={styles.button[dayOnly ? 'normal' : 'active']}
                        onClick={() => pickSession('all')}>全盤</button>
                    <button type='button' className={styles.button[dayOnly ? 'active' : 'normal']}
                        onClick={() => pickSession('day')}>日盤</button>
                </>}
                <button type='button' className={styles.button[follow ? 'active' : 'normal']}
                    onClick={() => {
                        setFollow(true);
                        setHover(false);
                        if (lastPrice !== null) setCenter(lastPrice);
                    }}>
                    回到最新
                </button>
                <span className={styles.status}>
                    {streamLabel} · {FLOW_LADDER_WINDOW_SECONDS}s
                    {hover ? ' · 指標凍結置中' : !follow ? ' · 手動瀏覽' : ''}
                </span>
            </div>
            <div className={styles.notice}>
                BID / ASK 取即時五檔、價格置中；M = 300 秒成交量，
                D = Runtime 啟動後累計量（非完整日量）。唯讀報價，點擊不會下單
            </div>
            {!canRender && (
                <div className={styles.empty} role='status'>
                    {centerPrice === null
                        ? '等待成交價或參考價'
                        : '價格級距資料尚未就緒，暫不顯示推測階梯'}
                </div>
            )}
            {canRender && (
                <div ref={listRef} role='table' aria-label='Order Flow 逐價位報價'
                    className={styles.scroll} onScroll={(e) =>
                        setScrollTop(Math.max(0,
                            e.currentTarget.scrollTop - FLOW_LADDER_ROW_HEIGHT))}
                    onMouseEnter={() => setHover(true)}
                    onMouseLeave={() => setHover(false)}
                    onWheel={() => setFollow(false)}
                    onTouchStart={() => setFollow(false)}>
                    <div className={styles.table}>
                        <div className={styles.header} role='row'>
                            {COLS.map((col) => (
                                <div key={col.label} role='columnheader'
                                    className={col.label === 'PRICE' ? styles.price : styles.numeric}
                                    title={col.hint}>{col.label}</div>
                            ))}
                        </div>
                        <div style={{ height: viewport.topPadding }} aria-hidden='true' />
                        {visible.map((row) => (
                            <FlowLadderRowView key={row.price}
                                row={row} max={max} decimals={decimals} />
                        ))}
                        <div style={{ height: viewport.bottomPadding }} aria-hidden='true' />
                    </div>
                </div>
            )}
        </section>
    );
}
