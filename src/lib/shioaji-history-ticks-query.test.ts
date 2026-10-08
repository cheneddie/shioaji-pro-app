import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContractBase } from './types/contract';

const api = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('./api', () => ({
    apiPost: api.post,
    apiGet: vi.fn(),
    apiPut: vi.fn(),
    apiDelete: vi.fn(),
}));
import { fetchHistoryTicks } from './shioaji';

const contract: ContractBase = {
    code: 'TXFR1', target_code: 'TXFJ6',
    region: 'TW', security_type: 'FUT' as const, exchange: 'TAIFEX',
};

beforeEach(() => {
    api.post.mockReset().mockResolvedValue({
        datetime: [], close: [], volume: [], tick_type: [],
    });
});

describe('Shioaji historical Tick optional query compatibility', () => {
    it('preserves the legacy AllDay request shape when no options are provided', async () => {
        await fetchHistoryTicks(contract, '2026-10-08');
        expect(api.post).toHaveBeenCalledWith('/api/v1/data/ticks', {
            contract: {
                code: 'TXFR1', target_code: 'TXFJ6',
                region: 'TW', security_type: 'FUT', exchange: 'TAIFEX',
            },
            date: '2026-10-08',
        });
    });

    it('serializes RangeTime in the documented Shioaji REST payload', async () => {
        await fetchHistoryTicks(contract, '2026-10-12', {
            queryType: 'RangeTime',
            timeStart: '15:00:00',
            timeEnd: '16:15:00',
        });
        expect(api.post).toHaveBeenCalledWith('/api/v1/data/ticks', {
            contract: expect.objectContaining({
                code: 'TXFR1', target_code: 'TXFJ6',
            }),
            date: '2026-10-12',
            query_type: 'RangeTime',
            time_start: '15:00:00',
            time_end: '16:15:00',
        }, { timeoutMs: 45_000 });
    });

    it('preserves LastCount when explicitly requested', async () => {
        await fetchHistoryTicks(contract, '2026-10-08', {
            queryType: 'LastCount', lastCount: 55,
        });
        expect(api.post.mock.calls[0]?.[1]).toMatchObject({
            query_type: 'LastCount', last_cnt: 55,
        });
    });
});
