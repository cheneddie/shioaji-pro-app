import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./runtime', () => ({ getApiBase: () => 'http://127.0.0.1:21323' }));
vi.mock('./server-info-store', () => ({ knownServerInfo: () => undefined }));
import { recorderScope, readRecordedRawTicks, queueRecordedRawTick } from './raw-tick-disk';

afterEach(() => { vi.unstubAllGlobals(); });

describe('browser Tick recorder safety', () => {
    it('never combines simulation, production and distinct Sidecar origins', () => {
        const sim = recorderScope('http://127.0.0.1:21323', true);
        const prod = recorderScope('http://127.0.0.1:21323', false);
        const other = recorderScope('http://127.0.0.1:21322', true);
        expect(sim).not.toEqual(prod);
        expect(sim).not.toEqual(other);
        expect(recorderScope('http://127.0.0.1:21323', undefined)).toBeNull();
    });
    it('fails closed when origin/server mode or disk is unavailable', async () => {
        vi.stubGlobal('indexedDB', undefined);
        const answer = await readRecordedRawTicks(
            'TXFJ6', Date.parse('2026-10-08T15:00:00Z'),
            Date.parse('2026-10-08T16:00:00Z'),
        );
        expect(answer).toMatchObject({ available: false, truncated: true, ticks: [] });
        expect(() => queueRecordedRawTick({
            code: 'TXFJ6', date: '2026/10/08', time: '15:00:00.001',
            close: '100', open: '100', high: '100', low: '100',
            volume: 1, total_volume: 1, tick_type: 1,
        })).not.toThrow();
    });
    it('never accepts an unbounded or wrong-code playback request', async () => {
        expect((await readRecordedRawTicks('TXFJ6/../', 0, 1)).available).toBe(false);
        expect((await readRecordedRawTicks('TXFJ6', 1000, 1)).available).toBe(false);
    });
});
