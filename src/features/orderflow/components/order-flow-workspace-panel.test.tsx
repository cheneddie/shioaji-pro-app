import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { ContractInfo } from '../../../lib/types/contract';
import type { CandleChartExtension } from '../../../components/candle-chart';

const mock = vi.hoisted(() => ({
    extension: null as unknown,
    nativeRenders: 0,
}));
vi.mock('../../../components/quote-board', () => ({
    QuoteBoard: () => <div data-mock='quote' />,
}));
vi.mock('../../../components/candle-chart', () => ({
    CandleChart: (props: Record<string, unknown>) => {
        mock.extension = props.extension;
        mock.nativeRenders += 1;
        return <div data-mock='flow-native' data-id={props.panelId} />;
    },
}));
vi.mock('./footprint-panel', () => ({
    FootprintPanel: (props: Record<string, unknown>) =>
        <div data-mock='footprint' data-id={props.panelId} />,
}));
import { OrderFlowWorkspacePanel } from './order-flow-workspace-panel';

const contract = {
    code: 'TXFJ6', security_type: 'FUT', region: 'TW',
    exchange: 'TAIFEX', name: '臺指期', reference: 100,
} as ContractInfo;

const store = new Map<string, string>();
beforeEach(() => {
    mock.extension = null;
    mock.nativeRenders = 0;
    store.clear();
    vi.stubGlobal('localStorage', {
        clear: () => store.clear(),
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, value); },
    });
});
afterEach(() => vi.unstubAllGlobals());

describe('Dev8.1 unified Flow chart extension isolation', () => {
    it('mounts full native chart with Bubble/VP extension in one Flow mode', async () => {
        let view!: ReactTestRenderer;
        await act(async () => {
            view = create(<OrderFlowWorkspacePanel panelId='flow-1' contract={contract} />);
        });
        expect(view.root.findByProps({ 'data-mock': 'flow-native' })
            .props['data-id']).toBe('flow-1-native');
        expect(view.root.findAllByType('button')).toHaveLength(2);
        const ext = mock.extension as CandleChartExtension;
        expect(ext.indicator?.label).toContain('氣泡');
        expect(ext.indicator?.enabled).toBe(false);
        expect(ext.drawing?.label).toBe('VP 畫圖');
        expect(typeof ext.renderOverlay).toBe('function');
        await act(async () => view.root.findAllByType('button')[1]!.props.onClick());
        expect(view.root.findByProps({ 'data-mock': 'footprint' })).toBeTruthy();
        expect(localStorage.getItem('sj-pro-orderflow-view-flow-1')).toBe('footprint');
        await act(async () => view.root.findAllByType('button')[0]!.props.onClick());
        expect(view.root.findByProps({ 'data-mock': 'flow-native' })).toBeTruthy();
        await act(async () => view.unmount());
    });

    it('restores prior Bubble settings, migrates legacy native view to unified Flow and preserves namespace', async () => {
        store.set('sj-pro-orderflow-view-flow-a', 'native');
        store.set('sj-pro-orderflow-kline-flow-a',
            JSON.stringify({bubble:{enabled:true,scalePercent:125,opacity:40}}));
        let view!: ReactTestRenderer;
        await act(async () => {
            view = create(<OrderFlowWorkspacePanel panelId='flow-a' contract={contract} />);
        });
        expect(view.root.findByProps({ 'data-mock': 'flow-native' })).toBeTruthy();
        const ext = mock.extension as CandleChartExtension;
        expect(ext.indicator?.enabled).toBe(true);
        expect(store.get('sj-pro-orderflow-kline-flow-a')).toContain('"scalePercent":125');
        await act(async () => view.unmount());
    });
});
