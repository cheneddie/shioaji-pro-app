import { StrictMode, createElement } from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { created, kbars } from '../../../components/chart-session.test-harness';
import type { OrderFlowRawTick } from '../runtime/market-event-bridge';

vi.mock('lightweight-charts', async () =>
    (await import('../../../components/chart-session.test-harness')).lwMock(),
);

const m = vi.hoisted(() => ({
    fetch: vi.fn(),
    runtimes: [] as Array<{
        retain: ReturnType<typeof vi.fn>;
        release: ReturnType<typeof vi.fn>;
        subscribeTicks: ReturnType<typeof vi.fn>;
        off: ReturnType<typeof vi.fn>;
        listener?: (tick: unknown) => void;
        disposed: boolean;
    }>,
}));

vi.mock('../../../lib/chart-history', () => ({
    fetchChartHistory: (...args: unknown[]) => m.fetch(...args),
    nextChartHistoryRevision: () => 1,
}));

vi.mock('../../../lib/theme-store', () => ({
    useThemeSettings: () => ({ mode: 'dark' }),
    themeKey: () => 'test-theme',
    getChartColors: () => ({
        text: '#fff',
        grid: '#222',
        crosshair: '#888',
        labelBg: '#333',
        border: '#444',
        up: '#f00',
        down: '#0f0',
        upVol: '#f008',
        downVol: '#0f08',
    }),
}));

vi.mock('../runtime/order-flow-runtime', () => ({
    getOrderFlowRuntime: () => {
        const runtime = {
            disposed: false,
            release: vi.fn(),
            off: vi.fn(),
            listener: undefined as ((tick: unknown) => void) | undefined,
            retain: vi.fn(),
            subscribeTicks: vi.fn(),
        };
        runtime.retain.mockImplementation(() => {
            if (runtime.disposed) throw new Error('disposed runtime retained');
            return () => {
                runtime.disposed = true;
                runtime.release();
            };
        });
        runtime.subscribeTicks.mockImplementation((listener: (tick: unknown) => void) => {
            runtime.listener = listener;
            return runtime.off;
        });
        m.runtimes.push(runtime);
        return runtime;
    },
}));

import { OrderFlowKlinePanel } from './order-flow-kline-panel';

const contract = {
    code: 'TXFR1',
    security_type: 'FUT',
    exchange: 'TAIFEX',
    target_code: 'TXFJ6',
    region: 'TW',
    name: '臺指期',
    currency: 'TWD',
    limit_up: 30000,
    limit_down: 20000,
    reference: 25000,
    day_trade: 'Yes',
    update_date: '',
    category: 'TXF',
    margin_trading_balance: 0,
    short_selling_balance: 0,
} as const;

const history = kbars([
    ['2026-10-07T08:45:00', '2026-10-07T08:50:00', () => 100],
]);

const flush = async () => {
    for (let i = 0; i < 6; i++) await act(async () => {});
};

const nodeMock = () => ({
    clientWidth: 800,
    clientHeight: 400,
    getBoundingClientRect: () => ({
        width: 800,
        height: 400,
        left: 0,
        top: 0,
    }),
    addEventListener() {},
    removeEventListener() {},
    style: {},
});

function liveTick(time = '08:50:00'): OrderFlowRawTick {
    return {
        code: 'TXFR1',
        date: '2026/10/07',
        time,
        price: 101,
        volume: 3,
        totalVolume: 999,
        tickType: 1,
        simtrade: false,
        intradayOdd: false,
        raw: {
            code: 'TXFJ6',
            date: '2026/10/07',
            time,
            open: '100',
            high: '101',
            low: '99',
            close: '101',
            volume: 3,
            total_volume: 999,
            tick_type: 1,
            simtrade: false,
        },
    };
}

beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    created.length = 0;
    m.runtimes = [];
    m.fetch.mockReset().mockResolvedValue(history);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('OrderFlowKlinePanel lifecycle', () => {
    it('loads history, consumes runtime live ticks, and releases ownership on unmount', async () => {
        let renderer!: ReactTestRenderer;
        act(() => {
            renderer = create(
                createElement(OrderFlowKlinePanel, { contract }),
                { createNodeMock: nodeMock },
            );
        });
        await flush();

        const runtime = m.runtimes.at(-1)!;
        expect(runtime.retain).toHaveBeenCalledOnce();
        expect(runtime.subscribeTicks).toHaveBeenCalledOnce();

        const candles = created.filter((series) => series.kind === 'Candlestick').at(-1)!;
        expect(candles.last).toHaveLength(1);
        expect(candles.last[0]).toMatchObject({ open: 100, close: 100 });

        act(() => runtime.listener?.(liveTick()));
        expect(candles.update).toHaveBeenCalled();
        expect(candles.update.mock.calls.at(-1)?.[0]).toMatchObject({
            open: 101,
            close: 101,
        });

        act(() => renderer.unmount());
        expect(runtime.off).toHaveBeenCalledOnce();
        expect(runtime.release).toHaveBeenCalledOnce();
    });

    it('survives StrictMode setup-cleanup-setup without re-retaining a disposed runtime', async () => {
        let renderer!: ReactTestRenderer;
        expect(() => {
            act(() => {
                renderer = create(
                    createElement(
                        StrictMode,
                        null,
                        createElement(OrderFlowKlinePanel, { contract }),
                    ),
                    {
                        createNodeMock: nodeMock,
                        unstable_strictMode: true,
                    } as Parameters<typeof create>[1],
                );
            });
        }).not.toThrow();
        await flush();

        expect(m.runtimes.length).toBeGreaterThanOrEqual(2);
        for (const runtime of m.runtimes.slice(0, -1)) {
            expect(runtime.release).toHaveBeenCalled();
        }
        expect(m.runtimes.at(-1)!.disposed).toBe(false);

        act(() => renderer.unmount());
        expect(m.runtimes.at(-1)!.release).toHaveBeenCalled();
    });
});
