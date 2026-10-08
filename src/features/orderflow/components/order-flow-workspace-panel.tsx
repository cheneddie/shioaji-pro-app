// Unified Flow K-line: native chart capabilities with additive Order Flow overlays.
// The original `chart` block never supplies an extension prop.
import { useEffect, useState } from 'react';
import { CandleChart, type CandleChartExtension } from '../../../components/candle-chart';
import { QuoteBoard } from '../../../components/quote-board';
import type { ChartSessionMode } from '../../../lib/intraday-session';
import type { ContractInfo } from '../../../lib/types/contract';
import type { Trade } from '../../../lib/types/order';
import type { Snapshot } from '../../../lib/types/market';
import type { ChartOrderPanelState } from '../../../lib/chart-order-settings';
import { DEF_BY_TYPE, type IndicatorInstance } from '../../../lib/indicator-defs';
import { DEFAULT_BUBBLE_SETTINGS, normalizeBubbleSettings, type BubbleSettings } from '../domain/bubble';
import { OrderFlowBubbleIndicator } from './order-flow-bubble-indicator';
import { OrderFlowVolumeProfileDrawingLayer } from './order-flow-volume-profile';
import { OrderFlowBubbleSettingsDialog } from './order-flow-bubble-settings-dialog';
import { FootprintPanel } from './footprint-panel';
import * as styles from './order-flow-workspace-panel.css';

export type OrderFlowView = 'orderflow' | 'footprint';
const VIEWS: ReadonlyArray<{ id: OrderFlowView; label: string }> = [
    { id: 'orderflow', label: 'Flow K 線' },
    { id: 'footprint', label: 'Footprint' },
];
function indicatorKey(id: string) { return `sj-pro-orderflow-indicators-${id}`; }
function loadFlowIndicators(id: string): IndicatorInstance[] {
    try {
        const raw: unknown = JSON.parse(localStorage.getItem(indicatorKey(id)) ?? '[]');
        if (!Array.isArray(raw)) return [];
        return raw.filter((item): item is IndicatorInstance =>
            !!item && typeof item === 'object' && typeof item.id === 'string'
            && typeof item.type === 'string' && DEF_BY_TYPE.has(item.type)
            && !!item.params && typeof item.params === 'object' && !Array.isArray(item.params));
    } catch { return []; }
}
function viewKey(id: string) {
    return `sj-pro-orderflow-view-${id}`;
}
function bubbleKey(id: string) {
    return `sj-pro-orderflow-kline-${id}`;
}
function initialView(id: string): OrderFlowView {
    try {
        // Previously saved "native" mode now migrates to unified Flow K-line.
        return localStorage.getItem(viewKey(id)) === 'footprint' ? 'footprint' : 'orderflow';
    } catch {
        return 'orderflow';
    }
}
function loadBubble(id: string): BubbleSettings {
    try {
        const raw = localStorage.getItem(bubbleKey(id));
        const data = raw ? JSON.parse(raw) as { bubble?: Partial<BubbleSettings> } : null;
        return normalizeBubbleSettings(data?.bubble);
    } catch {
        return { ...DEFAULT_BUBBLE_SETTINGS };
    }
}
function persistView(id: string, view: OrderFlowView) {
    try { localStorage.setItem(viewKey(id), view); } catch { /* storage unavailable */ }
}
function persistBubble(id: string, bubble: BubbleSettings) {
    try { localStorage.setItem(bubbleKey(id), JSON.stringify({ bubble })); }
    catch { /* storage unavailable */ }
}

/** Kline and Footprint share one block identity but retain separate runtime leases. */
export function OrderFlowWorkspacePanel({
    panelId, contract, sessionMode, onSessionModeChange,
    trades = [], onOrdersChanged, orderSettings, onOrderSettingsChange, snapshot,
}: {
    panelId: string;
    contract: ContractInfo;
    sessionMode?: ChartSessionMode;
    onSessionModeChange?: (mode: ChartSessionMode) => void;
    trades?: Trade[];
    snapshot?: Snapshot;
    onOrdersChanged?: () => void;
    orderSettings?: ChartOrderPanelState;
    onOrderSettingsChange?: (next: ChartOrderPanelState) => void;
}) {
    const [view, setView] = useState<OrderFlowView>(() => initialView(panelId));
    const [bubbleSettings, setBubbleSettings] = useState<BubbleSettings>(
        () => loadBubble(panelId),
    );
    const [flowIndicators, setFlowIndicators] = useState<IndicatorInstance[]>(() => loadFlowIndicators(panelId));
    const updateFlowIndicators = (next: IndicatorInstance[]) => {
        setFlowIndicators(next);
        try { localStorage.setItem(indicatorKey(panelId), JSON.stringify(next)); }
        catch { /* keep isolated state in memory */ }
    };
    const [bubbleDialogOpen, setBubbleDialogOpen] = useState(false);
    const [vpDrawingActive, setVpDrawingActive] = useState(false);
    useEffect(() => {
        persistBubble(panelId, bubbleSettings);
    }, [panelId, bubbleSettings]);
    const patchBubble = (patch: Partial<BubbleSettings>) => {
        setBubbleSettings((current) => normalizeBubbleSettings({ ...current, ...patch }));
    };
    const selectView = (next: OrderFlowView) => {
        setVpDrawingActive(false);
        setBubbleDialogOpen(false);
        setView(next);
        persistView(panelId, next);
    };

    const extension: CandleChartExtension = {
        storageScope: panelId,
        indicatorInstances: { instances: flowIndicators, onChange: updateFlowIndicators },
        indicator: {
            label: 'Order Flow 成交氣泡',
            description: '買賣主動成交 Bubble · 累積 Delta / 單筆 / N 秒模式',
            enabled: bubbleSettings.enabled,
            onSelect: () => {
                if (!bubbleSettings.enabled) patchBubble({ enabled: true });
                setBubbleDialogOpen(true);
            },
        },
        drawing: {
            label: 'VP 畫圖',
            active: vpDrawingActive,
            onActiveChange: setVpDrawingActive,
        },
        renderOverlay: ({
            hostRef, chartRef, candleRef, timeframeMinutes, dayOnly,
            historyRevision, colors, tradeModeArmed, drawingToolArmed,
        }) => (
            <>
                <OrderFlowVolumeProfileDrawingLayer
                    panelId={panelId}
                    contract={contract}
                    timeframeMinutes={timeframeMinutes}
                    dayOnly={dayOnly}
                    runtimeSession={dayOnly ? 'day' : 'all'}
                    historyRevision={historyRevision}
                    active={vpDrawingActive}
                    interactionLocked={tradeModeArmed || drawingToolArmed}
                    onActiveChange={setVpDrawingActive}
                    hostRef={hostRef}
                    chartRef={chartRef}
                    candleRef={candleRef}
                    colors={colors}
                />
                {bubbleSettings.enabled && (
                    <OrderFlowBubbleIndicator
                        contract={contract}
                        timeframeMinutes={timeframeMinutes}
                        dayOnly={dayOnly}
                        runtimeSession={dayOnly ? 'day' : 'all'}
                        historyRevision={historyRevision}
                        settings={bubbleSettings}
                        hostRef={hostRef}
                        chartRef={chartRef}
                        candleRef={candleRef}
                        colors={colors}
                    />
                )}
            </>
        ),
    };

    return (
        <div className={styles.shell} data-orderflow-view={view}>
            <div className={styles.switcher} role='group' aria-label='Order Flow 圖表模式'>
                {VIEWS.map((item) => (
                    <button
                        key={item.id}
                        type='button'
                        aria-pressed={view === item.id}
                        className={styles.tab[view === item.id ? 'active' : 'normal']}
                        onClick={() => selectView(item.id)}
                    >
                        {item.label}
                    </button>
                ))}
                <span className={styles.hint}>
                    {view === 'footprint'
                        ? 'Bid × Ask 成交足跡 · 唯讀'
                        : '原生畫圖／指標／點價交易＋Flow Bubble／VP'}
                </span>
            </div>
            {view === 'orderflow' && (
                <>
                    <QuoteBoard contract={contract} snapshot={snapshot} />
                    <CandleChart
                        panelId={`${panelId}-native`}
                        contract={contract}
                        trades={trades}
                        onOrdersChanged={onOrdersChanged}
                        sessionMode={sessionMode}
                        onSessionModeChange={onSessionModeChange}
                        orderSettings={orderSettings}
                        onOrderSettingsChange={onOrderSettingsChange}
                        extension={extension}
                    />
                </>
            )}
            {view === 'footprint' && (
                <FootprintPanel
                    panelId={`${panelId}-footprint`}
                    contract={contract}
                    sessionMode={sessionMode}
                    onSessionModeChange={onSessionModeChange}
                />
            )}
            {bubbleDialogOpen && view === 'orderflow' && (
                <OrderFlowBubbleSettingsDialog
                    settings={bubbleSettings}
                    onPatch={patchBubble}
                    onClose={() => setBubbleDialogOpen(false)}
                />
            )}
        </div>
    );
}
