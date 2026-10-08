import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractInfo } from '../../../lib/types/contract';
import { DEFAULT_BUBBLE_SETTINGS } from '../domain/bubble';

const mocks = vi.hoisted(() => ({
    query: vi.fn(),
    visible: {
        from: Date.UTC(2026, 9, 8, 9, 0, 0) / 1000,
        to: Date.UTC(2026, 9, 8, 9, 30, 0) / 1000,
    },
}));

const runtime = vi.hoisted(() => {
    let tickListener: ((tick: unknown) => void) | null = null;
    const release = vi.fn();
    const offTick = vi.fn();
    return {
        release,
        offTick,
        retain: vi.fn(() => release),
        subscribeTicks: vi.fn((listener: (tick: unknown) => void) => {
            tickListener = listener;
            return offTick;
        }),
        loadHistory: vi.fn(),
        bufferedTicks: vi.fn(() => ({ ticks: [] as object[], truncated: false })),
        ownerReplayTicks: vi.fn(async () => ({
            ticks: [], truncated: false, missingOwner: false,
            earliestMs: null, latestMs: null,
        })),
        browserRecordedTicks: vi.fn(async () => ({
            ticks: [] as object[], truncated: false, available: true,
            earliestMs: null as number | null, latestMs: null as number | null,
        })),
        emit(tick: unknown) { tickListener?.(tick); },
        reset() {
            tickListener = null;
            release.mockClear();
            offTick.mockClear();
            this.retain.mockClear();
            this.subscribeTicks.mockClear();
            this.loadHistory.mockReset();
            this.ownerReplayTicks.mockClear();
            this.browserRecordedTicks.mockClear();
        },
    };
});

vi.mock('../runtime/order-flow-runtime', () => ({
    getOrderFlowRuntime: () => runtime,
}));
vi.mock('../runtime/order-flow-query-coordinator', () => ({
    fetchOrderFlowVisibleSlice: mocks.query,
}));
vi.mock('./order-flow-bubble-layer', () => ({
    OrderFlowBubbleLayer: ({ candidates }: { candidates: unknown[] }) => (
        <div data-testid='bubble-layer' data-count={candidates.length} />
    ),
}));

import { OrderFlowBubbleIndicator } from './order-flow-bubble-indicator';

const contract: ContractInfo = {
    region: 'TW', exchange: 'TAIFEX',
    code: 'TXFR1', security_type: 'FUT', target_code: 'TXFJ6',
    name: '臺股期貨', currency: 'TWD',
    limit_up: 0, limit_down: 0, reference: 100, day_trade: 'Yes',
    update_date: '2026-10-08', category: 'TXF',
    margin_trading_balance: 0, short_selling_balance: 0,
    tick: 1, underlying_kind: 'I',
};
const colors = {
    up: '#f00', upVol: '#f008', down: '#0f0', downVol: '#0f08',
    text: '#aaa', grid: '#222', crosshair: '#39f', border: '#333', labelBg: '#111',
};
const dummyRef = { current: null };
const listeners = new Set<() => void>();
const scale = {
    getVisibleRange: () => mocks.visible,
    subscribeVisibleTimeRangeChange: vi.fn((fn: () => void) => { listeners.add(fn); }),
    unsubscribeVisibleTimeRangeChange: vi.fn((fn: () => void) => { listeners.delete(fn); }),
};
const candle = {
    subscribeDataChanged: vi.fn((fn: () => void) => { listeners.add(fn); }),
    unsubscribeDataChanged: vi.fn((fn: () => void) => { listeners.delete(fn); }),
};
const chartRef = { current: { timeScale: () => scale } };
const candleRef = { current: candle };

async function flush() {
    for (let i = 0; i < 6; i++) {
        await act(async () => { await Promise.resolve(); });
    }
}
async function completeVisibleDebounce() {
    await act(async () => { await vi.advanceTimersByTimeAsync(305); });
    await flush();
}

function viewComponent(minutes = 1) {
    return (
        <OrderFlowBubbleIndicator
            contract={contract} timeframeMinutes={minutes} dayOnly={false}
            runtimeSession='all' historyRevision={0}
            settings={{ ...DEFAULT_BUBBLE_SETTINGS, enabled: true }}
            hostRef={dummyRef} chartRef={chartRef as never}
            candleRef={candleRef as never} colors={colors}
        />
    );
}
describe('OrderFlowBubbleIndicator visible-range lifecycle', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // Oct 9 Taiwan holiday. Oct 8 day is completed; Oct 12
        // night-current must be served by replay/live, not history API.
        vi.setSystemTime(new Date('2026-10-09T02:00:00Z'));
        runtime.reset();
        mocks.query.mockReset().mockImplementation(async (_contract, slice) => ({
            slice, status: 'ready', percent: 23, checkedAt: Date.now(),
            truncated: false,
            ticks: [{
                datetime: '2026-10-08 09:00:01.000',
                eventTimeMs: Date.UTC(2026, 9, 8, 9, 0, 1),
                price: 100, volume: 10, tickType: 1, side: 'buy',
            }],
        }));
        mocks.visible = {
            from: Date.UTC(2026, 9, 8, 9, 0) / 1000,
            to: Date.UTC(2026, 9, 8, 9, 30) / 1000,
        };
        listeners.clear();
    });
    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });
    it('queries current visible trading date and releases shared-runtime ownership', async () => {
        let view!: ReactTestRenderer;
        await act(async () => { view = create(viewComponent()); });
        await completeVisibleDebounce();

        expect(runtime.retain).toHaveBeenCalledOnce();
        expect(runtime.subscribeTicks).toHaveBeenCalledOnce();
        expect(mocks.query).toHaveBeenCalledOnce();
        expect(mocks.query.mock.calls[0]![1]).toMatchObject({
            date: '2026-10-08', session: 'day',
            timeStart: '08:45:00',
        });
        expect(runtime.loadHistory).not.toHaveBeenCalled();
        expect(view.root.findByProps({ 'data-testid': 'bubble-layer' }).props['data-count']).toBe(1);

        await act(async () => view.unmount());
        expect(runtime.offTick).toHaveBeenCalledOnce();
        expect(runtime.release).toHaveBeenCalledOnce();
        expect(scale.unsubscribeVisibleTimeRangeChange).toHaveBeenCalled();
    });
    it('keeps historical and subsequent live ticks visible together', async () => {
        let view!: ReactTestRenderer;
        await act(async () => { view = create(viewComponent()); });
        await completeVisibleDebounce();
        await act(async () => {
            runtime.emit({
                code: 'TXFR1', date: '2026/10/08', time: '09:00:02.000',
                price: 101, volume: 5, totalVolume: 15, tickType: 2,
                simtrade: false, intradayOdd: false, raw: {},
            });
            await vi.advanceTimersByTimeAsync(55);
        });
        expect(view.root.findByProps({ 'data-testid': 'bubble-layer' }).props['data-count']).toBe(2);
        await act(async () => view.unmount());
    });
    it('does not indefinitely restart hydration when live Kbar updates fire', async () => {
        let view!: ReactTestRenderer;
        await act(async () => { view = create(viewComponent()); });
        // Candle updates occur continuously, but the aligned 15-minute
        // viewport request is identical. Do not reset the 300 ms debounce.
        for (let i = 0; i < 9; i++) {
            await act(async () => {
                for (const cb of [...listeners]) cb();
                await vi.advanceTimersByTimeAsync(50);
            });
        }
        await flush();
        expect(mocks.query).toHaveBeenCalledOnce();
        await act(async () => view.unmount());
    });
    it('changes requested trading days when the viewport pans into the night', async () => {
        let view!: ReactTestRenderer;
        await act(async () => { view = create(viewComponent()); });
        await completeVisibleDebounce();
        expect(mocks.query.mock.calls[0]![1].date).toBe('2026-10-08');
        mocks.visible = {
            from: Date.UTC(2026, 9, 8, 15, 0) / 1000,
            to: Date.UTC(2026, 9, 8, 16, 30) / 1000,
        };
        await act(async () => {
            for (const cb of [...listeners]) cb();
        });
        await completeVisibleDebounce();
        // The same active night must not query the unpublished trading date.
        expect(mocks.query).toHaveBeenCalledOnce();
        expect(view.root.findByProps({ role: 'status' }).props.children)
            .toContain('當前盤歷史 Tick 尚未發布');
        await act(async () => view.unmount());
    });
    it('replays genuine browser-recorded ticks on a refreshed viewport without Tick history', async () => {
        runtime.browserRecordedTicks.mockResolvedValueOnce({
            ticks: [{
                code: 'TXFR1', date: '2026/10/08', time: '15:00:02.000',
                price: 102, volume: 7, totalVolume: 7, tickType: 1,
                simtrade: false, intradayOdd: false, raw: {},
            }],
            available: true, truncated: false,
            earliestMs: Date.UTC(2026, 9, 8, 15, 0, 2),
            latestMs: Date.UTC(2026, 9, 8, 15, 0, 2),
        });
        mocks.visible = {
            from: Date.UTC(2026, 9, 8, 15, 0) / 1000,
            to: Date.UTC(2026, 9, 8, 16, 0) / 1000,
        };
        let view!: ReactTestRenderer;
        await act(async () => { view = create(viewComponent()); });
        await completeVisibleDebounce();
        expect(mocks.query).not.toHaveBeenCalled();
        expect(view.root.findByProps({ 'data-testid': 'bubble-layer' }).props['data-count']).toBe(1);
        expect(view.root.findByProps({ role: 'status' }).props.children)
            .toContain('已回放本機錄製成交');
        await act(async () => view.unmount());
    });
    it('never fetches or renders partial 1D bubble data', async () => {
        runtime.bufferedTicks.mockReturnValueOnce({
            ticks: [{
                code: 'TXFR1', date: '2026/10/08', time: '09:00:02.000',
                price: 101, volume: 5, totalVolume: 15, tickType: 2,
                simtrade: false, intradayOdd: false, raw: {},
            }], truncated: false,
        });
        let view!: ReactTestRenderer;
        await act(async () => { view = create(viewComponent(1440)); });
        expect(view.root.findByProps({ 'data-testid': 'bubble-layer' }).props['data-count']).toBe(0);
        await completeVisibleDebounce();
        expect(mocks.query).not.toHaveBeenCalled();
        expect(view.root.findByProps({ role: 'status' }).props.children)
            .toContain('成交氣泡僅支援 60m 以下');
        await act(async () => view.unmount());
    });
    it('shows quota block after the first selected trading date without hiding live flow', async () => {
        mocks.query.mockImplementation(async (_contract, slice) => ({
            slice, status: 'quota', percent: 80, checkedAt: Date.now(),
            truncated: false, ticks: [],
        }));
        let view!: ReactTestRenderer;
        await act(async () => { view = create(viewComponent()); });
        await completeVisibleDebounce();
        const notice = view.root.findByProps({ role: 'status' });
        expect(notice.props.children).toContain('80.0%');
        expect(notice.props['data-orderflow-tick-coverage']).toBe('quota');
        await act(async () => {
            runtime.emit({
                code: 'TXFR1', date: '2026/10/08', time: '09:00:05.000',
                price: 101, volume: 5, totalVolume: 15, tickType: 2,
                simtrade: false, intradayOdd: false, raw: {},
            });
            await vi.advanceTimersByTimeAsync(55);
        });
        expect(view.root.findByProps({ 'data-testid': 'bubble-layer' }).props['data-count']).toBe(1);
        await act(async () => view.unmount());
    });
    it('reports capped latest three dates and preserves completed partial date history', async () => {
        mocks.visible = {
            from: Date.UTC(2026, 9, 5, 8, 45) / 1000,
            to: Date.UTC(2026, 9, 8, 17, 30) / 1000,
        };
        mocks.query.mockImplementation(async (_contract, slice) => ({
            slice, status: slice.date === '2026-10-12' ? 'gap' : 'ready',
            percent: 25, checkedAt: Date.now(), truncated: false,
            ticks: slice.date === '2026-10-12' ? [] : [{
                datetime: '2026-10-08 09:00:01.000',
                eventTimeMs: Date.UTC(2026, 9, 8, 9, 0, 1),
                price: 100, volume: 10, tickType: 1, side: 'buy',
            }],
        }));
        let view!: ReactTestRenderer;
        await act(async () => { view = create(viewComponent()); });
        await completeVisibleDebounce();
        const notice = view.root.findByProps({ role: 'status' });
        // Three-date cap is the highest visible warning for this very broad
        // window when the unfinished night is intentionally not broker-queried.
        expect(notice.props.children).toContain('僅載入可視範圍最新 3 個交易日');
        expect(view.root.findByProps({ 'data-testid': 'bubble-layer' }).props['data-count'])
            .toBeGreaterThan(0);
        expect(mocks.query.mock.calls.length).toBeGreaterThan(1);
        await act(async () => view.unmount());
    });
    it('presentation settings do not re-request history', async () => {
        let view!: ReactTestRenderer;
        await act(async () => { view = create(viewComponent()); });
        await completeVisibleDebounce();
        const once = mocks.query.mock.calls.length;
        await act(async () => view.update(
            <OrderFlowBubbleIndicator
                contract={contract} timeframeMinutes={1} dayOnly={false}
                runtimeSession='all' historyRevision={0}
                settings={{
                    ...DEFAULT_BUBBLE_SETTINGS, enabled: true, minimumVolume: 15,
                }}
                hostRef={dummyRef} chartRef={chartRef as never}
                candleRef={candleRef as never} colors={colors}
            />));
        expect(mocks.query).toHaveBeenCalledTimes(once);
        expect(view.root.findByProps({ 'data-testid': 'bubble-layer' }).props['data-count']).toBe(0);
        await act(async () => view.unmount());
    });
});
