// Development 8 — isolated view composition. Native components remain unmodified.
import { useState } from 'react';
import { CandleChart } from '../../../components/candle-chart';
import { QuoteBoard } from '../../../components/quote-board';
import type { ChartSessionMode } from '../../../lib/intraday-session';
import type { ContractInfo } from '../../../lib/types/contract';
import type { Trade } from '../../../lib/types/order';
import type { Snapshot } from '../../../lib/types/market';
import type { ChartOrderPanelState } from '../../../lib/chart-order-settings';
import { FootprintPanel } from './footprint-panel';
import { OrderFlowKlinePanel } from './order-flow-kline-panel';
import * as styles from './order-flow-workspace-panel.css';

export type OrderFlowView = 'orderflow' | 'native' | 'footprint';
const VIEWS: ReadonlyArray<{ id: OrderFlowView; label: string }> = [
    { id: 'orderflow', label: 'Flow K 線' },
    { id: 'native', label: '完整 K 線' },
    { id: 'footprint', label: 'Footprint' },
];
function viewKey(id: string) {
    return `sj-pro-orderflow-view-${id}`;
}
function initialView(id: string): OrderFlowView {
    try {
        const raw = localStorage.getItem(viewKey(id));
        if (VIEWS.some((item) => item.id === raw)) return raw as OrderFlowView;
    } catch {
        // Private browsing/storage policy: use default.
    }
    return 'orderflow';
}
function persistView(id: string, mode: OrderFlowView) {
    try { localStorage.setItem(viewKey(id), mode); } catch { /* graceful fallback */ }
}

/** An independent panel switcher. It never adds tools to native CandleChart. */
export function OrderFlowWorkspacePanel({
    panelId, contract, sessionMode, onSessionModeChange,
    trades = [], onOrdersChanged, orderSettings, onOrderSettingsChange,
    snapshot,
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
    const selectView = (next: OrderFlowView) => {
        setView(next);
        persistView(panelId, next);
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
                    {view === 'native'
                        ? '原生完整功能（含原生圖表交易操作）'
                        : view === 'footprint'
                          ? 'Bid × Ask 成交足跡 · 唯讀'
                          : '成交氣泡 / VP 畫圖 · 唯讀'}
                </span>
            </div>
            {view === 'orderflow' && (
                <OrderFlowKlinePanel
                    panelId={panelId}
                    contract={contract}
                    sessionMode={sessionMode}
                    onSessionModeChange={onSessionModeChange}
                />
            )}
            {view === 'native' && (<>
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
                />
            </>)}
            {view === 'footprint' && (
                <FootprintPanel
                    panelId={`${panelId}-footprint`}
                    contract={contract}
                    sessionMode={sessionMode}
                    onSessionModeChange={onSessionModeChange}
                />
            )}
        </div>
    );
}
