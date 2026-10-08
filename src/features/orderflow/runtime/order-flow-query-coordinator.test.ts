import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
    usage: vi.fn(),
    ticks: vi.fn(),
}));
vi.mock('../../../lib/api', () => ({ apiGet: m.usage }));
vi.mock('../../../lib/runtime', () => ({ getApiBase: () => 'http://fixture' }));
vi.mock('../../../lib/shioaji', () => ({ fetchHistoryTicks: m.ticks }));

const contract = {
    code: 'TXFR1', target_code: 'TXFJ6',
    region: 'TW', security_type: 'FUT', exchange: 'TAIFEX',
} as const;
const fromMs = Date.parse('2026-10-08T09:00:00Z');
const toMs = Date.parse('2026-10-08T09:15:00Z');
const slice = {
    date: '2026-10-08', session: 'day' as const,
    fromMs, toMs, timeStart: '09:00:00', timeEnd: '09:15:00',
};
const fixture = {
    datetime: ['2026-10-08 09:01:00.123'], close: [27100],
    volume: [3], tick_type: [1], bid_price: [27099],
    ask_price: [27101], bid_volume: [1], ask_volume: [5],
};
let clock = Date.parse('2026-10-08T02:00:00Z');

beforeEach(() => {
    vi.resetModules();
    clock = Date.parse('2026-10-08T02:00:00Z');
    vi.spyOn(Date, 'now').mockImplementation(() => { clock += 3_000; return clock; });
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => { values.set(key, value); },
    });
    vi.stubGlobal('navigator', {
        locks: { request: async (_key: string, run: () => unknown) => run() },
    });
    m.usage.mockReset().mockResolvedValue({
        connections: 1, bytes: 79, limit_bytes: 100, remaining_bytes: 21,
    });
    m.ticks.mockReset().mockResolvedValue(fixture);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('shared Order Flow range query quota coordinator', () => {
    it('sends RangeTime with physical contract identity and validates the response', async () => {
        const { fetchOrderFlowVisibleSlice } = await import('./order-flow-query-coordinator');
        const result = await fetchOrderFlowVisibleSlice(contract, slice, { revision: 0 });
        expect(m.ticks).toHaveBeenCalledWith(contract, '2026-10-08', {
            queryType: 'RangeTime', timeStart: '09:00:00', timeEnd: '09:15:00',
        });
        expect(m.usage).toHaveBeenCalledTimes(2);
        expect(result.status).toBe('ready');
        expect(result.ticks).toHaveLength(1);
    });
    it('deduplicates identical pending queries and reuses a covered range', async () => {
        const { fetchOrderFlowVisibleSlice } = await import('./order-flow-query-coordinator');
        const one = fetchOrderFlowVisibleSlice(contract, slice, { revision: 0 });
        const two = fetchOrderFlowVisibleSlice({ ...contract }, slice, { revision: 0 });
        expect(one).toBe(two);
        await Promise.all([one, two]);
        const covered = { ...slice, fromMs: fromMs + 60_000,
            timeStart: '09:01:00', toMs: toMs - 60_000, timeEnd: '09:14:00' };
        await fetchOrderFlowVisibleSlice(contract, covered, { revision: 0 });
        expect(m.ticks).toHaveBeenCalledOnce();
    });
    it('fails closed at 80 percent with zero historical requests', async () => {
        m.usage.mockResolvedValue({
            connections: 1, bytes: 80, limit_bytes: 100, remaining_bytes: 20,
        });
        const { fetchOrderFlowVisibleSlice } = await import('./order-flow-query-coordinator');
        const answer = await fetchOrderFlowVisibleSlice(contract, slice, { revision: 0 });
        expect(answer.status).toBe('quota');
        expect(answer.percent).toBe(80);
        expect(m.ticks).not.toHaveBeenCalled();
    });
    it('stops the next slice after post-request usage passes 80 percent', async () => {
        m.usage.mockResolvedValueOnce({
            connections: 1, bytes: 79, limit_bytes: 100, remaining_bytes: 21,
        }).mockResolvedValue({
            connections: 1, bytes: 81, limit_bytes: 100, remaining_bytes: 19,
        });
        const { fetchOrderFlowVisibleSlice } = await import('./order-flow-query-coordinator');
        const first = await fetchOrderFlowVisibleSlice(contract, slice, { revision: 0 });
        expect(first.status).toBe('ready');
        expect(first.percent).toBe(81);
        const second = await fetchOrderFlowVisibleSlice(contract, {
            ...slice, timeStart: '09:15:01',
            timeEnd: '09:16:00', fromMs: toMs + 1000, toMs: toMs + 60_000,
        }, { revision: 0 });
        expect(second.status).toBe('quota');
        expect(m.ticks).toHaveBeenCalledOnce();
    });
    it('blocks when usage cannot be verified and does not call Tick API', async () => {
        m.usage.mockRejectedValue(new Error('offline'));
        const { fetchOrderFlowVisibleSlice } = await import('./order-flow-query-coordinator');
        const answer = await fetchOrderFlowVisibleSlice(contract, slice, { revision: 0 });
        expect(answer.status).toBe('unknown');
        expect(m.ticks).not.toHaveBeenCalled();
    });
    it('rejects 10/8 fallback Tick data for requested 10/12 trading date', async () => {
        const { fetchOrderFlowVisibleSlice } = await import('./order-flow-query-coordinator');
        const night = {
            date: '2026-10-12', session: 'night' as const,
            timeStart: '15:00:00', timeEnd: '16:00:00',
            fromMs: Date.parse('2026-10-08T15:00:00Z'),
            toMs: Date.parse('2026-10-08T16:00:00Z'),
        };
        const answer = await fetchOrderFlowVisibleSlice(contract, night, { revision: 0 });
        expect(answer.status).toBe('gap');
        expect(answer.ticks).toHaveLength(0);
    });
});
