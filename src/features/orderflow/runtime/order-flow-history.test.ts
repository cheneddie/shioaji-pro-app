import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    fetch: vi.fn(),
    base: 'fixture',
}));

vi.mock('../../../lib/runtime', () => ({
    getApiBase: () => mocks.base,
}));
vi.mock('../../../lib/shioaji', () => ({
    fetchHistoryTicks: mocks.fetch,
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
    mocks.base = 'fixture';
});

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
