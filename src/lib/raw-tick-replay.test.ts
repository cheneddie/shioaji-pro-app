import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRawTickReplayProtocol } from './raw-tick-replay';
import type { SseTick } from './types/market';

class TestChannel {
    static channels = new Map<string, Set<TestChannel>>();
    listeners = new Set<(event: MessageEvent) => void>();
    constructor(readonly name: string) {
        const group = TestChannel.channels.get(name) ?? new Set();
        group.add(this);
        TestChannel.channels.set(name, group);
    }
    addEventListener(_kind: string, cb: (event: MessageEvent) => void) {
        this.listeners.add(cb);
    }
    removeEventListener(_kind: string, cb: (event: MessageEvent) => void) {
        this.listeners.delete(cb);
    }
    postMessage(data: unknown) {
        for (const other of TestChannel.channels.get(this.name) ?? []) {
            if (other === this) continue;
            for (const callback of other.listeners) callback({ data } as MessageEvent);
        }
    }
    close() {
        TestChannel.channels.get(this.name)?.delete(this);
        this.listeners.clear();
    }
}
const tick = (code: string, time: string): SseTick => ({
    code, date: '2026/10/08', time,
    open: '100', high: '100', low: '100', close: '100',
    volume: 2, total_volume: 10, tick_type: 1,
});
beforeEach(() => {
    TestChannel.channels.clear();
    vi.stubGlobal('BroadcastChannel', TestChannel);
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('physical raw Tick cross-window replay', () => {
    it('owner transfers only requested code/range with ordered chunks', async () => {
        let owner = true;
        const snapshot = vi.fn(() => ({
            ticks: [tick('TXFJ6', '15:00:00.001'), tick('OTHER', '15:00:30.001'),
                tick('TXFJ6', '15:02:00.001')],
            truncated: false,
        }));
        const a = createRawTickReplayProtocol('test', () => owner, snapshot);
        const b = createRawTickReplayProtocol('test', () => false, snapshot);
        const response = await b.request('TXFJ6',
            Date.parse('2026-10-08T15:00:00Z'),
            Date.parse('2026-10-08T15:01:00Z'));
        expect(response.missingOwner).toBe(false);
        expect(response.ticks).toHaveLength(1);
        expect(response.ticks[0]!.code).toBe('TXFJ6');
        expect(snapshot).toHaveBeenCalledOnce();
        owner = false;
        a.close(); b.close();
    });
    it('streams more than one bounded chunk without duplicate or foreign aliases', async () => {
        const ticks = Array.from({ length: 805 }, (_, i) =>
            tick('TXFJ6', `15:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000123`));
        ticks.push(tick('TXFR1', '15:01:00.000123'));
        const a = createRawTickReplayProtocol('test', () => true,
            () => ({ ticks, truncated: false }));
        const b = createRawTickReplayProtocol('test', () => false,
            () => ({ ticks: [], truncated: false }));
        const response = await b.request('TXFJ6',
            Date.parse('2026-10-08T15:00:00Z'),
            Date.parse('2026-10-08T15:15:00Z'));
        expect(response.ticks).toHaveLength(805);
        expect(response.ticks.every(t => t.code === 'TXFJ6')).toBe(true);
        expect(response.truncated).toBe(false);
        a.close(); b.close();
    });
    it('times out safely when no owner exists', async () => {
        vi.useFakeTimers();
        const b = createRawTickReplayProtocol('test', () => false,
            () => ({ ticks: [], truncated: false }));
        const pending = b.request('TXFJ6',
            Date.parse('2026-10-08T15:00:00Z'),
            Date.parse('2026-10-08T15:01:00Z'));
        await vi.advanceTimersByTimeAsync(4_001);
        expect((await pending).missingOwner).toBe(true);
        b.close();
    });
    it('validates bounds before sending a replay request', async () => {
        const b = createRawTickReplayProtocol('test', () => false,
            () => ({ ticks: [], truncated: false }));
        const answer = await b.request('TXFJ6', Infinity, 0);
        expect(answer.missingOwner).toBe(true);
        b.close();
    });
});
