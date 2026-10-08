import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ContractInfo } from '../../../lib/types/contract';

vi.mock('../../../components/quote-board', () => ({
    QuoteBoard: () => <div data-mock='quote' />,
}));
vi.mock('../../../components/candle-chart', () => ({
    CandleChart: (props: Record<string, unknown>) => <div data-mock='native' data-id={props.panelId} />,
}));
vi.mock('./order-flow-kline-panel', () => ({
    OrderFlowKlinePanel: (props: Record<string, unknown>) => <div data-mock='flow' data-id={props.panelId} />,
}));
vi.mock('./footprint-panel', () => ({
    FootprintPanel: (props: Record<string, unknown>) => <div data-mock='footprint' data-id={props.panelId} />,
}));
import { OrderFlowWorkspacePanel } from './order-flow-workspace-panel';

const contract = {
    code: 'TXFJ6', security_type: 'FUT', region: 'TW',
    exchange: 'TAIFEX', name: '臺指期', reference: 100,
} as ContractInfo;

beforeEach(() => localStorage.clear());

describe('Dev8 Order Flow workspace mode isolation', () => {
    it('switches between independent Flow, native chart and Footprint without changing native routes', async () => {
        let view!: ReactTestRenderer;
        await act(async () => {
            view = create(<OrderFlowWorkspacePanel panelId='flow-1' contract={contract} />);
        });
        expect(view.root.findByProps({ 'data-mock': 'flow' })).toBeTruthy();
        const buttons = view.root.findAllByType('button');
        await act(async () => buttons[1]!.props.onClick());
        expect(view.root.findByProps({ 'data-mock': 'native' }).props['data-id']).toBe('flow-1-native');
        expect(localStorage.getItem('sj-pro-orderflow-view-flow-1')).toBe('native');
        await act(async () => buttons[2]!.props.onClick());
        expect(view.root.findByProps({ 'data-mock': 'footprint' }).props['data-id']).toBe('flow-1-footprint');
        await act(async () => view.unmount());
    });
    it('isolates saved view selection by panel ID', async () => {
        localStorage.setItem('sj-pro-orderflow-view-flow-a', 'footprint');
        let view!: ReactTestRenderer;
        await act(async () => {
            view = create(<OrderFlowWorkspacePanel panelId='flow-a' contract={contract} />);
        });
        expect(view.root.findByProps({ 'data-mock': 'footprint' })).toBeTruthy();
        await act(async () => view.unmount());
    });
});
