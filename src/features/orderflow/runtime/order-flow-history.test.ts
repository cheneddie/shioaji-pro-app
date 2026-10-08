import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    fetch: vi.fn(),
    usage: vi.fn(),
    base: 'fixture',
}));

vi.mock('../../../lib/runtime', () => ({
    getApiBase: () => mocks.base,
}));
vi.mock('../../../lib/shioaji', () => ({
    fetchHistoryTicks: mocks.fetch,
}));
vi.mock('../../../lib/api', () => ({
    apiGet: mocks.usage,
}));

const contract = {
    code: 'TXFR1',
    exchange: 'TAIFEX',
    security_type: 'FUT',
    target_code: 'TXFF6',
    region: 'TW',
} as const;

const payload = {
    datetime: ['2026-10-07T10:00:00.123456'],
    close: [27110.5],
    volume: [3],
    bid_price: [27110],
    bid_volume: [5],
    ask_price: [27111],
    ask_volume: [4],
    tick_type: [2],
};

beforeEach(() => {
    vi.resetModules();
    mocks.fetch.mockReset().mockResolvedValue(payload);
    mocks.usage.mockReset().mockResolvedValue({
        connections: 1, bytes: 10, limit_bytes: 100, remaining_bytes: 90,
    });
    // The legacy-cache tests verify historical coalescing. Quota enforcement
    // and 2s throttling have dedicated tests with real shared stamp semantics.
    vi.stubGlobal('localStorage', {
        getItem: () => null,
        setItem: () => undefined,
    });
    vi.stubGlobal('navigator', {
        locks: { request: async (_name: string, callback: () => unknown) => callback() },
    });
    mocks.base = 'fixture';
});

afterEach(() => vi.unstubAllGlobals());

describe('Order Flow history cache', () => {
    it('coalesces concurrent and completed requests for the same contract/date', async () => {
        const { fetchOrderFlowHistory } = await import('./order-flow-history');
        const a = fetchOrderFlowHistory(contract, '2026-10-07');
        const b = fetchOrderFlowHistory({ ...contract }, '2026-10-07');
        expect(a).toBe(b);
        const result = await a;
        await fetchOrderFlowHistory(contract, '2026-10-07');
        expect(mocks.fetch).toHaveBeenCalledOnce();
        expect(result.ticks[0]).toEqual(expect.objectContaining({
            price: 27110.5,
            volume: 3,
            tickType: 2,
            side: 'sell',
        }));
        expect(result.ticks[0]!.eventTimeMs).not.toBeNull();
    });

    it('uses revision to permit an explicit retry after a cached request', async () => {
        const {
            fetchOrderFlowHistory,
            nextOrderFlowHistoryRevision,
        } = await import('./order-flow-history');
        await fetchOrderFlowHistory(contract, '2026-10-07');
        const revision = nextOrderFlowHistoryRevision();
        await fetchOrderFlowHistory(contract, '2026-10-07', { revision });
        expect(mocks.fetch).toHaveBeenCalledTimes(2);
    });

    it('coalesces a failing history request but retries the exact same key after rejection', async () => {
        const { fetchOrderFlowHistory } = await import('./order-flow-history');
        mocks.fetch.mockRejectedValueOnce(new Error('broker temporarily offline'));
        const a = fetchOrderFlowHistory(contract, '2026-10-07');
        const b = fetchOrderFlowHistory({ ...contract }, '2026-10-07');
        expect(a).toBe(b);
        await expect(a).rejects.toThrow('broker temporarily offline');
        await expect(b).rejects.toThrow('broker temporarily offline');
        expect(mocks.fetch).toHaveBeenCalledTimes(1);

        const recovered = await fetchOrderFlowHistory(contract, '2026-10-07');
        expect(mocks.fetch).toHaveBeenCalledTimes(2);
        expect(recovered.ticks[0]).toMatchObject({
            volume: 3, side: 'sell',
        });
        const cached = await fetchOrderFlowHistory(contract, '2026-10-07');
        expect(cached).toBe(recovered);
        expect(mocks.fetch).toHaveBeenCalledTimes(2);
    });

    it('re-fetches an active or future trading date instead of caching a partial result', async () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(new Date('2026-10-08T08:15:00Z'));
            const { fetchOrderFlowHistory } = await import('./order-flow-history');
            await fetchOrderFlowHistory(contract, '2026-10-12');
            await fetchOrderFlowHistory(contract, '2026-10-12');
            expect(mocks.fetch).toHaveBeenCalledTimes(2);
        } finally {
            vi.useRealTimers();
        }
    });

    it('bounds the request cache and evicts the oldest entry', async () => {
        const { fetchOrderFlowHistory } = await import('./order-flow-history');
        for (let day = 1; day <= 65; day++) {
            await fetchOrderFlowHistory(
                contract,
                `2026-08-${String(day).padStart(2, '0')}`,
            );
        }
        expect(mocks.fetch).toHaveBeenCalledTimes(65);
        await fetchOrderFlowHistory(contract, '2026-08-01');
        expect(mocks.fetch).toHaveBeenCalledTimes(66);
    });
});
