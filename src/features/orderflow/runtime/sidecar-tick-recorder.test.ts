import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({
    info: {
        simulation: true,
        orderflow_recorder: { enabled: true, version: 1 },
    } as { simulation: boolean; orderflow_recorder?: { enabled: boolean; version: number } },
    base: 'http://127.0.0.1:21323',
    version: 0,
    apiGet: vi.fn(),
}));
vi.mock('../../../lib/api', () => ({ apiGet: m.apiGet }));
vi.mock('../../../lib/runtime', () => ({ getApiBase: () => m.base }));
vi.mock('../../../lib/server-info-store', () => ({
    knownServerInfo: () => m.info,
    getServerModeVersion: () => m.version,
}));
import { fetchSidecarRecordedTicks } from './sidecar-tick-recorder';

const tick = {
    code: 'TXFJ6', date: '2026/10/08', time: '15:00:01.001',
    open: '27000', high: '27000', low: '27000', close: '27000',
    volume: 3, total_volume: 3, tick_type: 1,
};
const fromMs = Date.parse('2026-10-08T15:00:00Z');
const toMs = Date.parse('2026-10-08T15:10:00Z');
const payload = () => ({
    schema_version: 1, physical_code: 'TXFJ6',
    mode: 'simulation', ticks: [tick],
    recorded_from_ms: fromMs,
    recorded_to_ms: fromMs + 1000,
    gaps: [], truncated: false,
});
beforeEach(() => {
    m.info = { simulation: true, orderflow_recorder: { enabled: true, version: 1 } };
    m.base = 'http://127.0.0.1:21323'; m.version = 0;
    m.apiGet.mockReset().mockResolvedValue(payload());
});

describe('Sidecar recorded Tick capability and data isolation', () => {
    it('does not probe absent capability or unsupported protocol', async () => {
        m.info.orderflow_recorder = undefined;
        expect((await fetchSidecarRecordedTicks('TXFJ6', fromMs, toMs)).available).toBe(false);
        expect(m.apiGet).not.toHaveBeenCalled();
        m.info.orderflow_recorder = { enabled: true, version: 2 };
        expect((await fetchSidecarRecordedTicks('TXFJ6', fromMs, toMs)).available).toBe(false);
        expect(m.apiGet).not.toHaveBeenCalled();
    });
    it('accepts physical contract only, preserving genuine repeated trades', async () => {
        m.apiGet.mockResolvedValueOnce({ ...payload(), ticks: [tick, { ...tick }] });
        const result = await fetchSidecarRecordedTicks('TXFJ6', fromMs, toMs);
        expect(result).toMatchObject({ available: true, truncated: false, gapCount: 0 });
        expect(result.ticks).toHaveLength(2);
        expect(m.apiGet).toHaveBeenCalledWith(
            expect.stringContaining('physical_code=TXFJ6'),
        );
    });
    it('rejects incompatible code, schema or simulation mode', async () => {
        m.apiGet.mockResolvedValueOnce({ ...payload(), physical_code: 'TXFR1' });
        expect((await fetchSidecarRecordedTicks('TXFJ6', fromMs, toMs)).available).toBe(false);
        m.apiGet.mockResolvedValueOnce({ ...payload(), mode: 'production' });
        expect((await fetchSidecarRecordedTicks('TXFJ6', fromMs, toMs)).available).toBe(false);
        m.apiGet.mockResolvedValueOnce({ ...payload(), schema_version: 2 });
        expect((await fetchSidecarRecordedTicks('TXFJ6', fromMs, toMs)).available).toBe(false);
    });
    it('rejects late replies after origin or server-mode changes', async () => {
        m.apiGet.mockImplementationOnce(async () => {
            m.version++;
            return payload();
        });
        expect((await fetchSidecarRecordedTicks('TXFJ6', fromMs, toMs)).available).toBe(false);
    });
    it('does not accept wrong-dated Tick as requested replay', async () => {
        m.apiGet.mockResolvedValueOnce({
            ...payload(), ticks: [{ ...tick, date: '2026/10/07' }],
        });
        const result = await fetchSidecarRecordedTicks('TXFJ6', fromMs, toMs);
        expect(result.available).toBe(true);
        expect(result.truncated).toBe(true);
        expect(result.ticks).toHaveLength(0);
    });
    it('marks explicit capture gaps instead of fabricating an uninterrupted session', async () => {
        m.apiGet.mockResolvedValueOnce({ ...payload(), gaps: [{
            from_ms: fromMs, to_ms: fromMs + 2000, reason: 'CAPTURE_STARTED_LATE',
        }] });
        const result = await fetchSidecarRecordedTicks('TXFJ6', fromMs, toMs);
        expect(result.gapCount).toBe(1);
        expect(result.ticks).toHaveLength(1);
    });
    it('does not query an unbounded range or an invalid physical code', async () => {
        expect((await fetchSidecarRecordedTicks('TXFJ6/../', fromMs, toMs)).available).toBe(false);
        expect((await fetchSidecarRecordedTicks('TXFJ6', fromMs, toMs + 46 * 86_400_000)).available).toBe(false);
        expect(m.apiGet).not.toHaveBeenCalled();
    });
});
