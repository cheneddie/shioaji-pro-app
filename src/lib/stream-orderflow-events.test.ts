// Development 1: raw market-event bridge contract.
// Verifies that Order Flow sees every regular-lot event before React's
// 50 ms quote notification batching without changing the existing tape path.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
    owner: true,
    options: null as null | {
        onOwn: () => void;
        onWire: (wire: { kind: 'event'; name: string; raw: string }) => void;
    },
}));

vi.mock('./runtime', () => ({
    getApiBase: () => 'http://fixture.invalid',
    getStreamBase: () => 'http://fixture.invalid',
}));
vi.mock('./api', () => ({ apiPost: vi.fn(async () => ({ success: true })) }));
vi.mock('./server-info-store', () => ({
    forgetServerInfo: vi.fn(),
    knownServerInfo: () => undefined,
}));
vi.mock('./shared-stream', () => ({
    createSharedStream: (options: typeof m.options) => {
        m.options = options;
        return {
            isOwner: () => m.owner,
            publish: vi.fn(),
            close: () => undefined,
        };
    },
}));

type Listener = (event: { data: string }) => void;

class FakeEventSource {
    static last: FakeEventSource | null = null;
    listeners = new Map<string, Listener[]>();
    onopen: (() => void) | null = null;
    onerror: (() => void) | null = null;

    constructor(public url: string) {
        FakeEventSource.last = this;
    }

    addEventListener(name: string, listener: Listener) {
        this.listeners.set(name, [
            ...(this.listeners.get(name) ?? []),
            listener,
        ]);
    }

    close() {}

    emit(name: string, data: unknown) {
        for (const listener of this.listeners.get(name) ?? []) {
            listener({ data: JSON.stringify(data) });
        }
    }
}

const regularTick = (
    code = 'TXFF6',
    patch: Record<string, unknown> = {},
) => ({
    code,
    date: '2026/10/07',
    time: '10:15:30.123456',
    open: '27100',
    high: '27120',
    low: '27090',
    close: '27110',
    volume: 3,
    total_volume: 1200,
    tick_type: 1,
    intraday_odd: false,
    simtrade: false,
    ...patch,
});

const regularBook = (
    code = 'TXFF6',
    patch: Record<string, unknown> = {},
) => ({
    code,
    date: '2026/10/07',
    time: '10:15:30.123456',
    bid_price: ['27109', '27108'],
    bid_volume: [20, 15],
    ask_price: ['27110', '27111'],
    ask_volume: [12, 18],
    diff_bid_vol: [2, -1],
    diff_ask_vol: [1, 3],
    intraday_odd: false,
    simtrade: false,
    ...patch,
});

beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    m.owner = true;
    m.options = null;
    FakeEventSource.last = null;
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
});

afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

async function owner() {
    const stream = await import('./stream');
    stream.ensureStream();
    m.options!.onOwn();
    return { stream, source: FakeEventSource.last! };
}

describe('raw regular-lot stream listeners', () => {
    it('delivers every bid/ask event before the 50 ms React notification flush', async () => {
        const { stream, source } = await owner();
        const raw = vi.fn();
        const quote = vi.fn();
        stream.onAnyBidAsk(raw);
        stream.subscribeQuoteStore('TXFF6', quote);

        for (let i = 0; i < 10; i++) {
            source.emit('bidask_fop', regularBook('TXFF6', {
                time: `10:15:30.12${i}`,
                bid_volume: [20 + i, 15],
            }));
        }

        expect(raw).toHaveBeenCalledTimes(10);
        expect(quote).not.toHaveBeenCalled();
        expect(stream.getQuote('TXFF6')?.bidask?.bid_volume[0]).toBe(29);

        await vi.advanceTimersByTimeAsync(50);
        expect(quote).toHaveBeenCalledTimes(1);
    });

    it('unsubscribes raw bid/ask listeners cleanly', async () => {
        const { stream, source } = await owner();
        const raw = vi.fn();
        const off = stream.onAnyBidAsk(raw);
        source.emit('bidask_fop', regularBook());
        off();
        source.emit('bidask_fop', regularBook());
        expect(raw).toHaveBeenCalledTimes(1);
    });

    it('keeps onAnyTick real-trade semantics while onRawTick includes simtrade and zero volume', async () => {
        const { stream, source } = await owner();
        const tape = vi.fn();
        const raw = vi.fn();
        stream.onAnyTick(tape);
        stream.onRawTick(raw);

        source.emit('tick_fop', regularTick('TXFF6', { simtrade: true, volume: 3 }));
        source.emit('tick_fop', regularTick('TXFF6', { simtrade: false, volume: 0 }));
        source.emit('tick_fop', regularTick('TXFF6', { simtrade: false, volume: 4 }));

        expect(raw).toHaveBeenCalledTimes(3);
        expect(raw.mock.calls.map((call) => call[0].simtrade)).toEqual([
            true,
            false,
            false,
        ]);
        expect(tape).toHaveBeenCalledTimes(1);
        expect(tape.mock.calls[0]![0].volume).toBe(4);
    });

    it('does not leak intraday odd-lot events into regular raw listeners', async () => {
        const { stream, source } = await owner();
        const ticks = vi.fn();
        const books = vi.fn();
        stream.onRawTick(ticks);
        stream.onAnyBidAsk(books);

        source.emit('tick_fop', regularTick('TXFF6', { intraday_odd: true }));
        source.emit('bidask_fop', regularBook('TXFF6', { intraday_odd: true }));

        expect(ticks).not.toHaveBeenCalled();
        expect(books).not.toHaveBeenCalled();
        expect(stream.getQuote('TXFF6')).toBeUndefined();
        expect(stream.getQuote('TXFF6', true)?.tick?.intraday_odd).toBe(true);
        expect(stream.getQuote('TXFF6', true)?.bidask?.intraday_odd).toBe(true);
    });

    it('does not create another EventSource when raw listeners are registered', async () => {
        const stream = await import('./stream');
        stream.onRawTick(vi.fn());
        stream.onAnyBidAsk(vi.fn());
        expect(FakeEventSource.last).toBeNull();

        stream.ensureStream();
        m.options!.onOwn();
        expect(FakeEventSource.last).not.toBeNull();
    });
});

describe('Order Flow market-event bridge', () => {
    it('normalizes numeric prices and preserves exchange fields and flags', async () => {
        const { source } = await owner();
        const bridge = await import('../features/orderflow/runtime/market-event-bridge');
        const ticks = vi.fn();
        const books = vi.fn();
        bridge.subscribeOrderFlowTicks('TXFF6', ticks);
        bridge.subscribeOrderFlowBooks('TXFF6', books);

        source.emit('tick_fop', regularTick('TXFF6', {
            close: '27110.5',
            tick_type: 2,
            simtrade: true,
        }));
        source.emit('bidask_fop', regularBook('TXFF6', {
            simtrade: true,
        }));

        expect(ticks).toHaveBeenCalledWith(expect.objectContaining({
            code: 'TXFF6',
            date: '2026/10/07',
            time: '10:15:30.123456',
            price: 27110.5,
            tickType: 2,
            simtrade: true,
            intradayOdd: false,
        }));
        expect(books).toHaveBeenCalledWith(expect.objectContaining({
            code: 'TXFF6',
            simtrade: true,
            intradayOdd: false,
            bids: [
                { price: 27109, volume: 20, diffVolume: 2 },
                { price: 27108, volume: 15, diffVolume: -1 },
            ],
            asks: [
                { price: 27110, volume: 12, diffVolume: 1 },
                { price: 27111, volume: 18, diffVolume: 3 },
            ],
        }));
    });

    it('normalizes blank or non-numeric prices as null instead of price zero', async () => {
        const bridge = await import('../features/orderflow/runtime/market-event-bridge');
        expect(bridge.normalizeOrderFlowTick(regularTick('TXFF6', { close: '' }))).toMatchObject({
            price: null,
        });
        const normalized = bridge.normalizeOrderFlowBook(regularBook('TXFF6', {
            bid_price: ['', 'bad'],
            bid_volume: [20, 15],
            ask_price: ['27110', ''],
            ask_volume: [12, 18],
        }));
        expect(normalized.bids.map((level) => level.price)).toEqual([null, null]);
        expect(normalized.asks.map((level) => level.price)).toEqual([27110, null]);
    });

    it('filters by requested symbol', async () => {
        const { source } = await owner();
        const bridge = await import('../features/orderflow/runtime/market-event-bridge');
        const ticks = vi.fn();
        const books = vi.fn();
        bridge.subscribeOrderFlowTicks('TXFF6', ticks);
        bridge.subscribeOrderFlowBooks('TXFF6', books);

        source.emit('tick_fop', regularTick('MXFF6'));
        source.emit('bidask_fop', regularBook('MXFF6'));
        source.emit('tick_fop', regularTick('TXFF6'));
        source.emit('bidask_fop', regularBook('TXFF6'));

        expect(ticks).toHaveBeenCalledTimes(1);
        expect(books).toHaveBeenCalledTimes(1);
    });

    it('delivers a continuous-contract alias exactly once for the alias subscriber', async () => {
        const { stream, source } = await owner();
        const bridge = await import('../features/orderflow/runtime/market-event-bridge');
        stream.registerCodeAlias('TXFF6', 'TXFR1');
        const aliasTicks = vi.fn();
        const aliasBooks = vi.fn();
        bridge.subscribeOrderFlowTicks('TXFR1', aliasTicks);
        bridge.subscribeOrderFlowBooks('TXFR1', aliasBooks);

        source.emit('tick_fop', regularTick('TXFF6'));
        source.emit('bidask_fop', regularBook('TXFF6'));

        expect(aliasTicks).toHaveBeenCalledTimes(1);
        expect(aliasTicks.mock.calls[0]![0].code).toBe('TXFR1');
        expect(aliasBooks).toHaveBeenCalledTimes(1);
        expect(aliasBooks.mock.calls[0]![0].code).toBe('TXFR1');
    });

    it('unsubscribes bridge consumers cleanly', async () => {
        const { source } = await owner();
        const bridge = await import('../features/orderflow/runtime/market-event-bridge');
        const ticks = vi.fn();
        const books = vi.fn();
        const offTicks = bridge.subscribeOrderFlowTicks('TXFF6', ticks);
        const offBooks = bridge.subscribeOrderFlowBooks('TXFF6', books);

        source.emit('tick_fop', regularTick());
        source.emit('bidask_fop', regularBook());
        offTicks();
        offBooks();
        source.emit('tick_fop', regularTick());
        source.emit('bidask_fop', regularBook());

        expect(ticks).toHaveBeenCalledTimes(1);
        expect(books).toHaveBeenCalledTimes(1);
    });
});
