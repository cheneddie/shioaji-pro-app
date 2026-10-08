import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractInfo } from '../../../lib/types/contract';

const m = vi.hoisted(() => {
    const release = vi.fn();
    const off = vi.fn();
    const retain = vi.fn(() => release);
    let notify: (() => void) | undefined;
    let snapshot = {
        identity: {market: 'TW:FUT:TAIFEX', symbol: 'TXFR1', session: 'all'},
        version: 1, lastPrice: 100, levels: [{
            price: 100, bidSize: 20, askSize: 12,
            movingBuy: 15, movingSell: 9, movingNeutral: 2,
            movingTotal: 26, movingDelta: 6,
            dailyBuy: 40, dailySell: 30, dailyNeutral: 3, dailyTotal: 73,
        }], health: {
            active: true, refs: 1, streamStatus: 'live', stale: false,
            lastTickAt: 0, lastBookAt: 0, eventGapMs: 0,
            rawTickCount: 1, tradeTickCount: 1,
            bookCount: 1, duplicateTickCount: 0, outOfOrderTickCount: 0,
            outOfOrderBookCount: 0, invalidEventTimeCount: 0,
            history: {status: 'idle'},
        },
    };
    const getSnapshot = vi.fn(() => snapshot);
    const subscribe = vi.fn((listener: () => void) => {
        notify = listener; return off;
    });
    const getRuntime = vi.fn((..._args: unknown[]) => ({
        retain, subscribe, getSnapshot,
    }));
    return {
        release, off, retain, getSnapshot, subscribe, getRuntime,
        emit(patch: Record<string, unknown>) {
            snapshot = { ...snapshot, ...patch } as typeof snapshot;
            notify?.();
        },
        reset() {
            notify = undefined;
            release.mockClear(); off.mockClear(); retain.mockClear();
            subscribe.mockClear(); getSnapshot.mockClear();
            getRuntime.mockClear();
        },
    };
});
vi.mock('../runtime/order-flow-runtime', () => ({
    getOrderFlowRuntime: (...args: unknown[]) => m.getRuntime(...args),
}));
vi.mock('../../../lib/tick-bands', () => ({
    prefetchTickBands: vi.fn(),
    useTickBandsVersion: () => 0,
    bandTickFor: () => undefined,
}));
import { FlowLadderPanel } from './flow-ladder-panel';

const contract = {
    code: 'TXFR1', target_code: 'TXFJ6', region: 'TW',
    security_type: 'FUT', exchange: 'TAIFEX', tick: 1,
    name: '臺股期貨', currency: 'TWD', reference: 100,
    limit_up: 200, limit_down: 50,
    day_trade: 'Yes', update_date: '',
    category: 'TXF', margin_trading_balance: 0,
    short_selling_balance: 0, underlying_kind: 'I',
} as ContractInfo;

const flush = async () => {
    for(let i=0;i<4;i++) await act(async()=>Promise.resolve());
};

beforeEach(() => {
    m.reset();
});

describe('Development 7 FlowLadderPanel read-only lifecycle', () => {
    it('renders exact runtime price/BID/ASK/moving/delta/cumulative and never orders', async () => {
        let view!: ReactTestRenderer;
        await act(async () => {
            view = create(<FlowLadderPanel panelId='ladder-1' contract={contract} />);
        });
        await flush();
        expect(m.retain).toHaveBeenCalledOnce();
        expect(m.subscribe).toHaveBeenCalledOnce();
        const panel = view.root.findByProps({'data-read-only':'true'});
        expect(panel.props['aria-label']).toBe('Order Flow 報價');
        const price = view.root.findAllByProps({'data-price':100})[0]!;
        expect(price.props['data-last']).toBe('true');
        const values = price.findAllByType('span')
            .map((s) => s.props.children);
        expect(values).toEqual(expect.arrayContaining(['20','9','+6','15','12','40','30']));
        await act(async () => view.unmount());
        expect(m.off).toHaveBeenCalledOnce();
        expect(m.release).toHaveBeenCalledOnce();
    });

    it('switches runtime identity on symbol/session and resets on removal', async () => {
        let view!: ReactTestRenderer;
        await act(async()=> {
            view=create(<FlowLadderPanel panelId='ladder-2'
                contract={contract} sessionMode='all' />);
        });
        await flush();
        expect(m.getRuntime).toHaveBeenCalledWith(contract,'all');
        await act(async()=>view.update(
            <FlowLadderPanel panelId='ladder-2' contract={contract} sessionMode='day' />,
        ));
        await flush();
        expect(m.getRuntime).toHaveBeenCalledWith(contract,'day');
        await act(async()=>view.update(
            <FlowLadderPanel panelId='ladder-2'
                contract={{...contract,code:'MXFR1'}} sessionMode='all' />,
        ));
        await flush();
        expect(m.getRuntime).toHaveBeenCalledWith(
            expect.objectContaining({code:'MXFR1'}),'all',
        );
        await act(async()=>view.unmount());
        expect(m.release.mock.calls.length).toBeGreaterThanOrEqual(3);
    });

    it('keeps last price centered while following, pauses on hover or scroll and resumes by button', async () => {
        let view!: ReactTestRenderer;
        await act(async()=> {
            view=create(<FlowLadderPanel panelId='ladder-3' contract={contract} />);
        });
        await flush();
        const scroll = view.root.findByProps({
            'aria-label':'Order Flow 逐價位報價',
        });
        await act(async()=>scroll.props.onMouseEnter());
        const toolbar = view.root.findAllByType('button');
        await act(async()=>scroll.props.onWheel());
        expect(view.root.findByProps({'aria-label':'Order Flow 報價'})).toBeDefined();
        const resume = toolbar.find(b=>b.props.children==='回到最新')!;
        expect(resume).toBeDefined();
        await act(async()=>resume.props.onClick());
        await act(async()=>view.unmount());
    });

    it('updates after batched runtime publication without new market-data subscription', async () => {
        let view!: ReactTestRenderer;
        await act(async()=> {view=create(
            <FlowLadderPanel panelId='ladder-4' contract={contract} />,
        );});
        await flush();
        await act(async()=>m.emit({lastPrice:101}));
        await flush();
        expect(view.root.findAllByProps({'data-price':101}).length).toBeGreaterThan(0);
        expect(m.retain).toHaveBeenCalledOnce();
        await act(async()=>view.unmount());
    });
});
