// Dev6 UI contract: new OrderFlow Kline drawing only, isolated persistence.
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IChartApi, ISeriesApi } from 'lightweight-charts';
import type { RefObject } from 'react';
import type { ContractInfo } from '../../../lib/types/contract';

const mock = vi.hoisted(() => ({
    release: vi.fn(), off: vi.fn(), load: vi.fn(),
    subscribeTicks: vi.fn(), retain: vi.fn(),
}));
vi.mock('../runtime/order-flow-runtime', () => ({
    getOrderFlowRuntime: () => ({
        retain: mock.retain,
        subscribeTicks: mock.subscribeTicks,
        loadHistory: mock.load,
    }),
}));
import { OrderFlowVolumeProfileDrawingLayer } from './order-flow-volume-profile';

const contract = {
    code: 'TXFR1',
    target_code: 'TXFJ6',
    security_type: 'FUT',
    exchange: 'TAIFEX',
    region: 'TW',
    name: '臺股期貨',
    currency: 'TWD',
    limit_up: 0, limit_down: 0,
    reference: 100,
    day_trade: 'Yes',
    update_date: '',
    category: 'TXF',
    margin_trading_balance: 0,
    short_selling_balance: 0,
    tick: 1,
    underlying_kind: 'I',
} as ContractInfo;

const colors = {
    up: '#f00', down: '#0f0', crosshair: '#888',
    text: '#aaa', grid: '#333', border: '#666',
    labelBg: '#111', upVol: '#f008', downVol: '#0f08',
};
let click: ((param: { time: number }) => void) | null = null;
const scale = {
    timeToCoordinate: (value: number) => value,
    coordinateToTime: (value: number) => value,
    subscribeVisibleLogicalRangeChange: vi.fn(),
    unsubscribeVisibleLogicalRangeChange: vi.fn(),
    subscribeVisibleTimeRangeChange: vi.fn(),
    unsubscribeVisibleTimeRangeChange: vi.fn(),
};
const chart = {
    timeScale: () => scale,
    subscribeClick: vi.fn((fn: typeof click) => { click = fn; }),
    unsubscribeClick: vi.fn(() => { click = null; }),
} as unknown as IChartApi;
const candle = {
    subscribeDataChanged: vi.fn(),
    unsubscribeDataChanged: vi.fn(),
    priceToCoordinate: (value: number) => value,
} as unknown as ISeriesApi<'Candlestick'>;
const host = {
    clientWidth: 800,
    clientHeight: 400,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 400 }),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
};
const ref = <T,>(current: unknown) => ({ current }) as RefObject<T | null>;

async function flush() {
    for (let i = 0; i < 4; i++) await act(async () => Promise.resolve());
}

beforeEach(() => {
    const map = new Map<string, string>();
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => map.get(key) ?? null,
        setItem: (key: string, value: string) => { map.set(key, value); },
        clear: () => map.clear(),
        removeItem: (key: string) => { map.delete(key); },
    });
    vi.stubGlobal('window', {
        devicePixelRatio: 1,
        requestAnimationFrame: vi.fn(() => 1),
        cancelAnimationFrame: vi.fn(),
    });
    click = null;
    vi.clearAllMocks();
    mock.retain.mockImplementation(() => mock.release);
    mock.subscribeTicks.mockImplementation(() => mock.off);
    mock.load.mockResolvedValue({ date: '2026-10-08', ticks: [] });
});

afterEach(() => vi.unstubAllGlobals());

describe('Dev6 isolated Order Flow Volume Profile drawing', () => {
    it('creates, persists, selects and deletes a two-click drawing without order commands', async () => {
        let view!: ReactTestRenderer;
        const onActiveChange = vi.fn();
        await act(async () => {
            view = create(
                <OrderFlowVolumeProfileDrawingLayer
                    panelId='VPTEST'
                    contract={contract}
                    timeframeMinutes={5}
                    dayOnly={false}
                    runtimeSession='all'
                    historyRevision={0}
                    active={true}
                    onActiveChange={onActiveChange}
                    hostRef={ref<HTMLDivElement>(host)}
                    chartRef={ref<IChartApi>(chart)}
                    candleRef={ref<ISeriesApi<'Candlestick'>>(candle)}
                    colors={colors}
                />,
                { createNodeMock: () => ({
                    style: {}, getContext: () => null,
                }) },
            );
        });
        await flush();
        await act(async () => (click as ((param: {time: number}) => void) | null)?.({ time: 60 }));
        await act(async () => (click as ((param: {time: number}) => void) | null)?.({ time: 120 }));
        await flush();
        const storage = 'sj-pro-orderflow-vp-VPTEST-TXFR1-TXFJ6-all';
        const stored = JSON.parse(localStorage.getItem(storage) ?? '[]');
        expect(stored).toHaveLength(1);
        expect(stored[0]).toMatchObject({ fromTime: 60, toTime: 120 });
        expect(onActiveChange).toHaveBeenCalledWith(false);
        expect(mock.retain).toHaveBeenCalled();
        const buttons = view.root.findAllByType('button');
        await act(async () =>
            buttons.find((b) => b.props.children === '刪除選取')?.props.onClick(),
        );
        expect(JSON.parse(localStorage.getItem(storage) ?? '[]')).toEqual([]);
        await act(async () => view.unmount());
        expect(mock.release).toHaveBeenCalled();
        expect(mock.off).toHaveBeenCalled();
    });

    it('rejects overlarge historical range without fetching or inventing a POC', async () => {
        const storage = 'sj-pro-orderflow-vp-VPTEST-TXFR1-TXFJ6-all';
        localStorage.setItem(storage, JSON.stringify([{
            id: 'large', fromTime: 60, toTime: 60 + 40 * 86400,
        }]));
        let view!: ReactTestRenderer;
        await act(async () => {
            view = create(
                <OrderFlowVolumeProfileDrawingLayer
                    panelId='VPTEST'
                    contract={contract}
                    timeframeMinutes={5}
                    dayOnly={false}
                    runtimeSession='all'
                    historyRevision={0}
                    active={false}
                    onActiveChange={vi.fn()}
                    hostRef={ref<HTMLDivElement>(host)}
                    chartRef={ref<IChartApi>(chart)}
                    candleRef={ref<ISeriesApi<'Candlestick'>>(candle)}
                    colors={colors}
                />,
                { createNodeMock: () => ({
                    style: {}, getContext: () => null,
                }) },
            );
        });
        await flush();
        const labels = view.root.findAllByType('span').map((s) => s.props.children);
        expect(labels).toContain('最多選取 31 個日曆日');
        expect(mock.load).not.toHaveBeenCalled();
        await act(async () => view.unmount());
    });
    it('restores drawings, drags either anchor, isolates symbols, and clears all', async () => {
        const storage = 'sj-pro-orderflow-vp-VPTEST-TXFR1-TXFJ6-all';
        localStorage.setItem(storage, JSON.stringify([
            { id: 'a', fromTime: 60, toTime: 120 },
            { id: 'b', fromTime: 200, toTime: 240 },
        ]));
        const renderLayer = (item: ContractInfo) => (
            <OrderFlowVolumeProfileDrawingLayer
                panelId='VPTEST' contract={item}
                timeframeMinutes={5} dayOnly={false}
                runtimeSession='all' historyRevision={0}
                active={false} onActiveChange={vi.fn()}
                hostRef={ref<HTMLDivElement>(host)}
                chartRef={ref<IChartApi>(chart)}
                candleRef={ref<ISeriesApi<'Candlestick'>>(candle)}
                colors={colors}
            />
        );
        let view!: ReactTestRenderer;
        await act(async () => {
            view = create(renderLayer(contract), {
                createNodeMock: () => ({ style: {}, getContext: () => null }),
            });
        });
        await flush();
        const down = host.addEventListener.mock.calls.filter((call) =>
            call[0] === 'pointerdown').at(-1)?.[1] as
                ((event: Record<string, unknown>) => void);
        expect(down).toBeTypeOf('function');
        const event = (x: number) => ({
            clientX: x, clientY: 5, pointerId: 1,
            preventDefault: vi.fn(), stopPropagation: vi.fn(),
        });
        await act(async () => down(event(60)));
        const move = host.addEventListener.mock.calls.find((call) =>
            call[0] === 'pointermove')?.[1] as
                ((event: Record<string, unknown>) => void);
        await act(async () => move(event(150)));
        expect(JSON.parse(localStorage.getItem(storage) ?? '[]')[0])
            .toMatchObject({ fromTime: 120, toTime: 150 });
        await act(async () => view.update(renderLayer({
            ...contract, code: 'MXFR1',
        })));
        expect(view.root.findAllByType('button')).toHaveLength(0);
        expect(JSON.parse(localStorage.getItem(storage) ?? '[]')).toHaveLength(2);
        await act(async () => view.update(renderLayer(contract)));
        const clear = view.root.findAllByType('button')
            .find((button) => button.props.children === '清除 VP');
        expect(clear).toBeDefined();
        await act(async () => clear!.props.onClick());
        expect(JSON.parse(localStorage.getItem(storage) ?? '[]')).toEqual([]);
        await act(async () => view.unmount());
    });

    it('fails closed when the instrument tick size is unknown', async () => {
        const storage = 'sj-pro-orderflow-vp-VPTEST-TXFR1-TXFJ6-all';
        localStorage.setItem(storage, JSON.stringify([
            { id: 'a', fromTime: 60, toTime: 120 },
        ]));
        let view!: ReactTestRenderer;
        await act(async () => {
            view = create(
                <OrderFlowVolumeProfileDrawingLayer
                    panelId='VPTEST'
                    contract={{ ...contract, tick: undefined }}
                    timeframeMinutes={5} dayOnly={false}
                    runtimeSession='all' historyRevision={0}
                    active={false} onActiveChange={vi.fn()}
                    hostRef={ref<HTMLDivElement>(host)}
                    chartRef={ref<IChartApi>(chart)}
                    candleRef={ref<ISeriesApi<'Candlestick'>>(candle)}
                    colors={colors}
                />,
                { createNodeMock: () => ({ style: {}, getContext: () => null }) },
            );
        });
        await flush();
        expect(view.root.findAllByType('span')
            .map((span) => span.props.children))
            .toContain('商品缺少最小跳動值');
        await act(async () => view.unmount());
    });

});
