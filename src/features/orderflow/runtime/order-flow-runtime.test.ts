import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OrderFlowRawBook, OrderFlowRawTick } from './market-event-bridge';

const mocks = vi.hoisted(() => ({
    base: 'fixture',
    status: 'live' as 'connecting' | 'live' | 'down' | 'stale',
    ensure: vi.fn(),
    retain: vi.fn(),
    releaseFns: [] as ReturnType<typeof vi.fn>[],
    tickListener: null as null | ((tick: OrderFlowRawTick) => void),
    bookListener: null as null | ((book: OrderFlowRawBook) => void),
    offTick: vi.fn(),
    offBook: vi.fn(),
    statusListener: null as null | (() => void),
    offStatus: vi.fn(),
    history: vi.fn(),
}));

vi.mock('../../../lib/runtime', () => ({
    getApiBase: () => mocks.base,
}));
vi.mock('../../../lib/quote-ownership', () => ({
    retainQuote: (...args: unknown[]) => mocks.retain(...args),
}));
vi.mock('../../../lib/stream', () => ({
    ensureStream: () => mocks.ensure(),
    getStreamStatus: () => mocks.status,
    subscribeStatusStore: (listener: () => void) => {
        mocks.statusListener = listener;
        return mocks.offStatus;
    },
}));
vi.mock('./market-event-bridge', () => ({
    subscribeOrderFlowTicks: (
        _code: string,
        listener: (tick: OrderFlowRawTick) => void,
    ) => {
        mocks.tickListener = listener;
        return mocks.offTick;
    },
    subscribeOrderFlowBooks: (
        _code: string,
        listener: (book: OrderFlowRawBook) => void,
    ) => {
        mocks.bookListener = listener;
        return mocks.offBook;
    },
}));
vi.mock('./order-flow-history', () => ({
    fetchOrderFlowHistory: (...args: unknown[]) => mocks.history(...args),
}));

const contract = {
    code: 'TXFR1',
    exchange: 'TAIFEX',
    security_type: 'FUT',
    target_code: 'TXFF6',
    region: 'TW',
} as const;

function tick(
    time: string,
    patch: Partial<OrderFlowRawTick> = {},
): OrderFlowRawTick {
    return {
        code: 'TXFR1',
        date: '2026/10/07',
        time,
        price: 27110,
        volume: 1,
        totalVolume: 100,
        tickType: 1,
        simtrade: false,
        intradayOdd: false,
        raw: {
            code: 'TXFR1',
            date: '2026/10/07',
            time,
            open: '27100',
            high: '27120',
            low: '27090',
            close: '27110',
            volume: 1,
            total_volume: 100,
            tick_type: 1,
        },
        ...patch,
    };
}

function book(
    time: string,
    bid = 20,
    ask = 12,
): OrderFlowRawBook {
    return {
        code: 'TXFR1',
        date: '2026/10/07',
        time,
        bids: [{ price: 27109, volume: bid }],
        asks: [{ price: 27110, volume: ask }],
        simtrade: false,
        intradayOdd: false,
        raw: {
            code: 'TXFR1',
            date: '2026/10/07',
            time,
            bid_price: ['27109'],
            bid_volume: [bid],
            ask_price: ['27110'],
            ask_volume: [ask],
        },
    };
}

beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.base = 'fixture';
    mocks.status = 'live';
    mocks.releaseFns = [];
    mocks.tickListener = null;
    mocks.bookListener = null;
    mocks.statusListener = null;
    mocks.retain.mockImplementation(() => {
        const release = vi.fn();
        mocks.releaseFns.push(release);
        return release;
    });
    mocks.history.mockResolvedValue({
        date: '2026-10-07',
        ticks: [],
    });
});

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
});

describe('shared OrderFlowRuntime ownership', () => {
    it('shares one runtime and one Tick/BidAsk listener pair across multiple consumers', async () => {
        const { getOrderFlowRuntime } = await import('./order-flow-runtime');
        const a = getOrderFlowRuntime(contract, 'all');
        const b = getOrderFlowRuntime({ ...contract }, 'all');
        expect(a).toBe(b);

        const releaseA = a.retain();
        const releaseB = b.retain();

        expect(mocks.ensure).toHaveBeenCalledTimes(1);
        expect(mocks.retain.mock.calls).toEqual([
            [contract, 'Tick'],
            [contract, 'BidAsk'],
        ]);
        expect(mocks.tickListener).not.toBeNull();
        expect(mocks.bookListener).not.toBeNull();

        releaseA();
        expect(mocks.offTick).not.toHaveBeenCalled();
        expect(mocks.releaseFns.every((fn) => fn.mock.calls.length === 0)).toBe(true);

        releaseB();
        expect(mocks.offTick).toHaveBeenCalledOnce();
        expect(mocks.offBook).toHaveBeenCalledOnce();
        expect(mocks.offStatus).toHaveBeenCalledOnce();
        expect(mocks.releaseFns.every((fn) => fn.mock.calls.length === 1)).toBe(true);
    });

    it('partitions runtime identity by symbol and session and removes disposed instances from the registry', async () => {
        const { getOrderFlowRuntime } = await import('./order-flow-runtime');
        const all = getOrderFlowRuntime(contract, 'all');
        const day = getOrderFlowRuntime(contract, 'day');
        const other = getOrderFlowRuntime({ ...contract, code: 'MXFR1', target_code: 'MXFF6' }, 'all');
        expect(day).not.toBe(all);
        expect(other).not.toBe(all);

        const release = all.retain();
        release();
        const replacement = getOrderFlowRuntime(contract, 'all');
        expect(replacement).not.toBe(all);
        expect(replacement.getSnapshot().health.rawTickCount).toBe(0);
    });
});

describe('OrderFlowRuntime aggregation and health', () => {
    it('aggregates every raw event synchronously but batches subscriber notifications', async () => {
        const { getOrderFlowRuntime } = await import('./order-flow-runtime');
        const runtime = getOrderFlowRuntime(contract, 'all');
        const release = runtime.retain();
        const notified = vi.fn();
        runtime.subscribe(notified);

        for (let i = 0; i < 100; i++) {
            mocks.tickListener!(tick(
                `10:00:00.${String(i).padStart(3, '0')}`,
                { volume: 1, totalVolume: 100 + i },
            ));
        }

        expect(runtime.getSnapshot().health.rawTickCount).toBe(100);
        expect(runtime.getSnapshot().health.tradeTickCount).toBe(100);
        expect(runtime.getSnapshot().levels.find((level) => level.price === 27110)?.dailyTotal).toBe(100);
        expect(notified).not.toHaveBeenCalled();

        await vi.advanceTimersByTimeAsync(50);
        expect(notified).toHaveBeenCalledTimes(1);
        release();
    });

    it('does not double-count an exact replay after a reconnect status cycle', async () => {
        const { getOrderFlowRuntime } = await import('./order-flow-runtime');
        const runtime = getOrderFlowRuntime(contract, 'all');
        const release = runtime.retain();
        const replay = tick('10:00:00.000', { volume: 5, totalVolume: 105 });
        mocks.tickListener!(replay);

        mocks.status = 'down';
        mocks.statusListener!();
        mocks.status = 'live';
        mocks.statusListener!();
        mocks.tickListener!(replay);

        const snapshot = runtime.getSnapshot();
        expect(snapshot.health.rawTickCount).toBe(2);
        expect(snapshot.health.duplicateTickCount).toBe(1);
        expect(snapshot.levels.find((level) => level.price === 27110)?.dailyTotal).toBe(5);
        expect(snapshot.health.streamStatus).toBe('live');
        expect(snapshot.health.stale).toBe(false);
        release();
    });

    it('keeps the newest book and rejects an older out-of-order snapshot', async () => {
        const { getOrderFlowRuntime } = await import('./order-flow-runtime');
        const runtime = getOrderFlowRuntime(contract, 'all');
        const release = runtime.retain();

        mocks.bookListener!(book('10:00:02.000', 30, 14));
        mocks.bookListener!(book('10:00:01.000', 5, 6));

        const snapshot = runtime.getSnapshot();
        expect(snapshot.health.bookCount).toBe(2);
        expect(snapshot.health.outOfOrderBookCount).toBe(1);
        expect(snapshot.levels.find((level) => level.price === 27109)?.bidSize).toBe(30);
        expect(snapshot.levels.find((level) => level.price === 27110)?.askSize).toBe(14);
        release();
    });

    it('exposes moving delta and session buy/sell/neutral separately', async () => {
        const { getOrderFlowRuntime } = await import('./order-flow-runtime');
        const runtime = getOrderFlowRuntime(contract, 'all');
        const release = runtime.retain();

        mocks.tickListener!(tick('10:00:00.000', { volume: 5, totalVolume: 105, tickType: 1 }));
        mocks.tickListener!(tick('10:00:01.000', { volume: 2, totalVolume: 107, tickType: 2 }));
        mocks.tickListener!(tick('10:00:02.000', { volume: 3, totalVolume: 110, tickType: 0 }));

        const level = runtime.getSnapshot().levels.find((row) => row.price === 27110)!;
        expect(level).toMatchObject({
            dailyBuy: 5,
            dailySell: 2,
            dailyNeutral: 3,
            dailyTotal: 10,
            movingBuy: 5,
            movingSell: 2,
            movingNeutral: 3,
            movingTotal: 10,
            movingDelta: 3,
        });
        release();
    });

    it('tracks stream stale state without changing aggregation', async () => {
        const { getOrderFlowRuntime } = await import('./order-flow-runtime');
        const runtime = getOrderFlowRuntime(contract, 'all');
        const release = runtime.retain();
        mocks.tickListener!(tick('10:00:00.000', { volume: 2, totalVolume: 102 }));

        mocks.status = 'stale';
        mocks.statusListener!();
        const snapshot = runtime.getSnapshot();
        expect(snapshot.health.stale).toBe(true);
        expect(snapshot.health.streamStatus).toBe('stale');
        expect(snapshot.levels.find((row) => row.price === 27110)?.dailyTotal).toBe(2);
        release();
    });

    it('tracks history loading/ready/error without merging history into live totals', async () => {
        const { getOrderFlowRuntime } = await import('./order-flow-runtime');
        const runtime = getOrderFlowRuntime(contract, 'all');
        const release = runtime.retain();
        mocks.tickListener!(tick('10:00:00.000', { volume: 2, totalVolume: 102 }));

        let resolveHistory!: (value: { date: string; ticks: [] }) => void;
        mocks.history.mockReturnValueOnce(new Promise((resolve) => {
            resolveHistory = resolve;
        }));
        const pending = runtime.loadHistory('2026-10-07');
        expect(runtime.getSnapshot().health.history.status).toBe('loading');
        resolveHistory({ date: '2026-10-07', ticks: [] });
        await pending;
        expect(runtime.getSnapshot().health.history).toEqual({
            status: 'ready',
            date: '2026-10-07',
        });
        expect(runtime.getSnapshot().levels.find((row) => row.price === 27110)?.dailyTotal).toBe(2);

        mocks.history.mockRejectedValueOnce(new Error('offline'));
        await expect(runtime.loadHistory('2026-10-06', { revision: 1 })).rejects.toThrow('offline');
        expect(runtime.getSnapshot().health.history).toEqual({
            status: 'error',
            date: '2026-10-06',
            error: 'offline',
        });
        release();
    });
});
