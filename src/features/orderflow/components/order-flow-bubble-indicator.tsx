// Order Flow bubbles use the currently visible Kbar interval, not wall-clock
// "today". Live events are never held behind historical API requests.
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ChartColors } from '../../../lib/theme-store';
import type { ContractInfo } from '../../../lib/types/contract';
import {
    BubbleAggregator, bubbleTradeFromHistory, bubbleTradeFromRaw,
    mergeBubbleHistoryAndPending, type BubbleCandidate,
    type BubbleSettings, type BubbleSourceTrade,
} from '../domain/bubble';
import type { OrderFlowSession } from '../domain/types';
import { getOrderFlowRuntime } from '../runtime/order-flow-runtime';
import type { OrderFlowRawTick } from '../runtime/market-event-bridge';
import {
    fetchOrderFlowVisibleSlice, type SliceCoverage,
} from '../runtime/order-flow-query-coordinator';
import { planVisibleTickSlices, type VisibleTickSlice } from '../runtime/visible-tick-range';
import { OrderFlowBubbleLayer } from './order-flow-bubble-layer';

const MAX_TRADES = 300_000;
const NOTIFY_MS = 48;
const DEBOUNCE_MS = 300;
type Coverage = {
    requested: string[];
    selected: string[];
    omitted: number;
    dates: Record<string, SliceCoverage>;
    loading: number;
    total: number;
    truncated: boolean;
    replayTruncated: boolean;
    unsupportedCalendar: boolean;
    unsupportedTimeframe: boolean;
    activeUnverified: boolean;
    quota: number | null;
    blocked: 'quota' | 'unknown' | null;
};
const initialCoverage = (): Coverage => ({
    requested: [], selected: [], omitted: 0, dates: {},
    loading: 0, total: 0, truncated: false, replayTruncated: false,
    unsupportedCalendar: false, unsupportedTimeframe: false,
    activeUnverified: false, quota: null, blocked: null,
});
function coverageLabel(coverage: Coverage): string | null {
    if (coverage.unsupportedTimeframe) return '成交氣泡僅支援 60m 以下';
    if (coverage.blocked === 'quota')
        return '歷史行情流量已用 ' + (coverage.quota?.toFixed(1) ?? '80') + '%，已停止補載成交氣泡';
    if (coverage.blocked === 'unknown') return '無法確認流量額度，未送出歷史查詢';
    if (coverage.unsupportedCalendar) return 'DATA GAP · 交易所行事曆未支援，未推測交易日';
    if (Object.values(coverage.dates).some(s => s === 'error' || s === 'gap'))
        return 'DATA GAP · 部分歷史成交缺失或交易日不符';
    if (coverage.omitted > 0)
        return '僅載入可視範圍最新 3 個交易日（其他 ' + coverage.omitted + ' 日未查詢）';
    if (coverage.truncated || coverage.replayTruncated)
        return 'DATA GAP · Tick 緩衝或畫面資料已截斷';
    if (coverage.activeUnverified)
        return 'Tick 完整性未驗證 · 當前盤可能仍有缺口';
    if (coverage.loading > 0)
        return '正在補載成交氣泡 ' + (coverage.total - coverage.loading) + '/' + coverage.total;
    return null;
}
function sliceId(slice: VisibleTickSlice) {
    return [slice.date, slice.session, slice.fromMs, slice.toMs].join('|');
}
const todayTW = () => new Date(Date.now() + 28_800_000).toISOString().slice(0, 10);

export function OrderFlowBubbleIndicator({
    contract, timeframeMinutes, dayOnly, runtimeSession, historyRevision,
    settings, hostRef, chartRef, candleRef, colors,
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
    const [candidates, setCandidates] = useState<BubbleCandidate[]>([]);
    const [coverage, setCoverage] = useState<Coverage>(initialCoverage);
    const settingsRef = useRef(settings);
    settingsRef.current = settings;
    const liveRef = useRef<BubbleSourceTrade[]>([]);
    const replayRef = useRef<BubbleSourceTrade[]>([]);
    const ownerRef = useRef<BubbleSourceTrade[]>([]);
    const historyRef = useRef(new Map<string, BubbleSourceTrade[]>());
    const tradesRef = useRef<BubbleSourceTrade[]>([]);
    const aggregatorRef = useRef(new BubbleAggregator(settings));
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const generationRef = useRef(0);

    const publish = () => {
        if (timerRef.current) return;
        timerRef.current = setTimeout(() => {
            timerRef.current = null;
            setCandidates(aggregatorRef.current.snapshot());
        }, NOTIFY_MS);
    };
    const commit = (truncated: () => void) => {
        const historical = [...historyRef.current.values()].flat();
        const replay = mergeBubbleHistoryAndPending(replayRef.current, ownerRef.current);
        let merged = mergeBubbleHistoryAndPending(historical, replay);
        merged = mergeBubbleHistoryAndPending(merged, liveRef.current);
        if (merged.length > MAX_TRADES) {
            // Keep newest event-time observations; never silently say complete.
            merged.sort((a, b) => a.eventTimeMs - b.eventTimeMs);
            merged = merged.slice(-MAX_TRADES);
            truncated();
        }
        tradesRef.current = merged;
        const aggregator = new BubbleAggregator(settingsRef.current);
        aggregator.ingestMany(merged);
        aggregatorRef.current = aggregator;
        setCandidates(aggregator.snapshot());
    };
    useEffect(() => {
        // Filtering and presentation settings only recompute local ticks.
        const next = new BubbleAggregator(settingsRef.current);
        next.ingestMany(tradesRef.current);
        aggregatorRef.current = next;
        setCandidates(next.snapshot());
    }, [
        settings.filterMode, settings.direction, settings.minimumVolume,
        settings.maximumVolume, settings.chargeWindowSeconds,
    ]);

    useEffect(() => {
        const runtime = getOrderFlowRuntime(contract, runtimeSession);
        const release = runtime.retain();
        let cancelled = false;
        let debounce: ReturnType<typeof setTimeout> | null = null;
        let bootstrap: ReturnType<typeof setTimeout> | null = null;
        let onRange: (() => void) | undefined;
        let subscribedChart: IChartApi | null = null;
        let subscribedCandle: ISeriesApi<'Candlestick'> | null = null;
        const dateStates = new Map<string, SliceCoverage>();
        let currentPlan = planVisibleTickSlices(
            contract.security_type, dayOnly, timeframeMinutes, NaN, NaN,
        );
        let blocked: 'quota' | 'unknown' | null = null;
        let quota: number | null = null;
        let truncated = false;
        let ownerIncomplete = false;
        let inFlight = 0;

        generationRef.current++;
        historyRef.current.clear();
        liveRef.current = [];
        replayRef.current = [];
        ownerRef.current = [];
        tradesRef.current = [];
        aggregatorRef.current = new BubbleAggregator(settingsRef.current);
        setCandidates([]);
        setCoverage(initialCoverage());

        const updateCoverage = () => {
            if (cancelled) return;
            const dates: Record<string, SliceCoverage> = {};
            for (const slice of currentPlan.slices) {
                const state = dateStates.get(sliceId(slice));
                if (state) {
                    const existing = dates[slice.date];
                    if (!existing || state !== 'ready') dates[slice.date] = state;
                }
            }
            setCoverage({
                requested: currentPlan.requestedDates,
                selected: currentPlan.selectedDates,
                omitted: currentPlan.omittedDates,
                dates,
                loading: inFlight, total: currentPlan.slices.length,
                truncated, replayTruncated: replay.truncated || ownerIncomplete,
                unsupportedCalendar: currentPlan.unsupportedCalendar,
                unsupportedTimeframe: currentPlan.unsupportedTimeframe,
                activeUnverified: currentPlan.selectedDates.some(d => d >= todayTW()),
                quota, blocked,
            });
        };
        const markTruncated = () => { truncated = true; updateCoverage(); };
        // Live subscribe FIRST. Stream startup and snapshot do not add a
        // second SSE or quote subscription.
        const offTick = runtime.subscribeTicks((tick: OrderFlowRawTick) => {
            if (cancelled || currentPlan.unsupportedTimeframe) return;
            const trade = bubbleTradeFromRaw(
                tick, timeframeMinutes, contract.security_type, dayOnly,
            );
            if (!trade) return;
            liveRef.current.push(trade);
            if (liveRef.current.length > MAX_TRADES) {
                liveRef.current.splice(0, 10_000);
                markTruncated();
            }
            aggregatorRef.current.ingest(trade);
            tradesRef.current.push(trade);
            if (tradesRef.current.length > MAX_TRADES) commit(markTruncated);
            else publish();
        });
        const replay = runtime.bufferedTicks();
        replayRef.current = replay.ticks.map(raw => bubbleTradeFromRaw(
            raw, timeframeMinutes, contract.security_type, dayOnly,
        )).filter((value): value is BubbleSourceTrade => value !== null);
        commit(markTruncated);

        const load = () => {
            const range = subscribedChart?.timeScale().getVisibleRange();
            if (!range || typeof range.from !== 'number' || typeof range.to !== 'number') return;
            const plan = planVisibleTickSlices(
                contract.security_type, dayOnly, timeframeMinutes,
                range.from, range.to,
            );
            currentPlan = plan;
            const generation = ++generationRef.current;
            ownerRef.current = [];
            ownerIncomplete = false;
            dateStates.clear();
            historyRef.current.clear();
            inFlight = 0;
            if (plan.unsupportedTimeframe) {
                // Daily/unsupported bars must not show misleading partial bubbles.
                aggregatorRef.current = new BubbleAggregator(settingsRef.current);
                tradesRef.current = [];
                setCandidates([]);
                updateCoverage();
                return;
            }
            commit(markTruncated);
            updateCoverage();
            if (plan.unsupportedCalendar || blocked) return;
            // A follower may have opened after the main SSE window received
            // trades. Request the owner's physical-code ring for this viewport.
            void runtime.ownerReplayTicks(
                Math.min(range.from, range.to) * 1000 - timeframeMinutes * 60_000,
                Math.max(range.from, range.to) * 1000,
            ).then(owner => {
                if (cancelled || generation !== generationRef.current) return;
                ownerIncomplete = owner.truncated || owner.missingOwner;
                ownerRef.current = owner.ticks.map(raw => bubbleTradeFromRaw(
                    raw, timeframeMinutes, contract.security_type, dayOnly,
                )).filter((trade): trade is BubbleSourceTrade => trade !== null);
                commit(markTruncated);
                updateCoverage();
            }).catch(() => {
                if (cancelled || generation !== generationRef.current) return;
                ownerIncomplete = true;
                updateCoverage();
            });
            for (const slice of plan.slices) {
                const key = sliceId(slice);
                dateStates.set(key, 'cancelled');
            }
            // Sequential priority: newest date first. Each result is committed
            // individually, so the user sees completed and live bubbles early.
            void (async () => {
                for (const slice of plan.slices) {
                    if (cancelled || generation !== generationRef.current || blocked) return;
                    const key = sliceId(slice);
                    dateStates.set(key, 'cancelled');
                    inFlight++;
                    updateCoverage();
                    const answer = await fetchOrderFlowVisibleSlice(contract, slice, {
                        revision: historyRevision,
                        stillNeeded: () => !cancelled &&
                            generation === generationRef.current && !blocked,
                    });
                    if (cancelled || generation !== generationRef.current) return;
                    inFlight--;
                    dateStates.set(key, answer.status);
                    if (answer.percent !== null) quota = answer.percent;
                    if (answer.status === 'quota' || answer.status === 'unknown')
                        blocked = answer.status === 'quota' ? 'quota' : 'unknown';
                    if (answer.truncated) truncated = true;
                    if (answer.ticks.length) {
                        historyRef.current.set(key, answer.ticks.map(tick =>
                            bubbleTradeFromHistory(
                                tick, timeframeMinutes, contract.security_type, dayOnly,
                            )).filter((trade): trade is BubbleSourceTrade => trade !== null));
                        commit(markTruncated);
                    }
                    updateCoverage();
                }
            })();
        };
        const schedule = () => {
            if (cancelled) return;
            generationRef.current++; // queued old work is now obsolete
            if (debounce) clearTimeout(debounce);
            debounce = setTimeout(load, DEBOUNCE_MS);
        };
        const subscribeChart = (attempt: number) => {
            if (cancelled) return;
            const chart = chartRef.current;
            const candle = candleRef.current;
            if (!chart || !candle) {
                if (attempt < 30) bootstrap = setTimeout(() => subscribeChart(attempt + 1), 100);
                return;
            }
            subscribedChart = chart;
            subscribedCandle = candle;
            chart.timeScale().subscribeVisibleTimeRangeChange(schedule);
            candle.subscribeDataChanged(schedule);
            onRange = schedule;
            schedule();
        };
        subscribeChart(0);

        return () => {
            cancelled = true;
            generationRef.current++;
            if (debounce) clearTimeout(debounce);
            if (bootstrap) clearTimeout(bootstrap);
            if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
            if (subscribedChart && onRange)
                subscribedChart.timeScale().unsubscribeVisibleTimeRangeChange(onRange);
            if (subscribedCandle && onRange)
                subscribedCandle.unsubscribeDataChanged(onRange);
            offTick();
            release();
        };
    }, [
        contract.region, contract.security_type, contract.exchange,
        contract.code, contract.target_code, timeframeMinutes,
        dayOnly, runtimeSession, historyRevision,
    ]);

    const label = coverageLabel(coverage);
    return (
        <>
            {label && (
                <div role='status' aria-live='polite' data-orderflow-tick-coverage={
                    coverage.blocked ?? (coverage.unsupportedTimeframe ? 'unsupported' :
                        coverage.omitted ? 'limited' : 'gap')
                } style={{
                    position: 'absolute', top: 8, left: 8, zIndex: 12,
                    pointerEvents: 'none', padding: '3px 7px',
                    borderRadius: 4, background: 'rgba(30,30,30,.8)',
                    color: '#fff', fontSize: 11,
                }}>{label}</div>
            )}
            <OrderFlowBubbleLayer
                hostRef={hostRef} chartRef={chartRef} candleRef={candleRef}
                candidates={candidates} settings={settings} colors={colors}
            />
        </>
    );
}
