// Same-origin raw Tick replay between the shared SSE owner and popout windows.
// No persistent storage, no second EventSource and no quote subscriptions.
import type { SseTick } from './types/market';

export interface RawTickReplay {
    ticks: SseTick[];
    truncated: boolean;
    missingOwner: boolean;
    earliestMs: number | null;
    latestMs: number | null;
}
type Snapshot = { ticks: SseTick[]; truncated: boolean };
type Request = { kind: 'request'; id: string; code: string; fromMs: number; toMs: number };
type Chunk = { kind: 'chunk'; id: string; code: string; index: number; ticks: SseTick[] };
type Finished = {
    kind: 'complete'; id: string; code: string; chunks: number; total: number;
    truncated: boolean; earliestMs: number | null; latestMs: number | null;
};
type Envelope = Request | Chunk | Finished;
const MAX_EVENTS = 30_000;
const CHUNK_SIZE = 400;
const TIMEOUT_MS = 4_000;
const MAX_SPAN_MS = 45 * 86_400_000;

export function replayEventTimeMs(tick: Pick<SseTick, 'date' | 'time'>): number | null {
    if (typeof tick.date !== 'string' || typeof tick.time !== 'string') return null;
    const date = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(tick.date);
    const time = /^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$/.exec(tick.time);
    if (!date || !time) return null;
    const milliseconds = Number((time[4] ?? '').padEnd(3, '0').slice(0, 3));
    const year = Number(date[1]), month = Number(date[2]), day = Number(date[3]);
    const hours = Number(time[1]), minutes = Number(time[2]), seconds = Number(time[3]);
    const value = Date.UTC(year, month - 1, day, hours, minutes, seconds, milliseconds);
    const roundtrip = new Date(value);
    if (!Number.isFinite(value) ||
        roundtrip.getUTCFullYear() !== year ||
        roundtrip.getUTCMonth() + 1 !== month ||
        roundtrip.getUTCDate() !== day ||
        roundtrip.getUTCHours() !== hours ||
        roundtrip.getUTCMinutes() !== minutes ||
        roundtrip.getUTCSeconds() !== seconds) return null;
    return value;
}
function empty(missingOwner = false): RawTickReplay {
    return { ticks: [], truncated: missingOwner, missingOwner, earliestMs: null, latestMs: null };
}
function physicalCode(code: unknown): code is string {
    return typeof code === 'string' && /^[A-Z0-9_-]{1,32}$/.test(code);
}
function validRange(fromMs: number, toMs: number) {
    return Number.isFinite(fromMs) && Number.isFinite(toMs) &&
        fromMs <= toMs && toMs - fromMs <= MAX_SPAN_MS;
}
function filterSnapshot(snapshot: Snapshot, code: string, fromMs: number, toMs: number): RawTickReplay {
    const ticks = snapshot.ticks.filter(t => {
        const ms = replayEventTimeMs(t);
        return t.code === code && ms !== null && ms >= fromMs && ms <= toMs;
    });
    const truncated = snapshot.truncated || ticks.length > MAX_EVENTS;
    const selected = ticks.slice(-MAX_EVENTS);
    return {
        ticks: selected, truncated, missingOwner: false,
        earliestMs: selected.length ? replayEventTimeMs(selected[0]!) : null,
        latestMs: selected.length ? replayEventTimeMs(selected[selected.length - 1]!) : null,
    };
}

export function createRawTickReplayProtocol(
    name: string,
    isOwner: () => boolean,
    snapshot: (code: string) => Snapshot,
) {
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(name);
    let seq = 0;
    let closed = false;
    const pending = new Map<string, {
        code: string; fromMs: number; toMs: number;
        ticks: SseTick[]; nextChunk: number; invalid: boolean;
        timer: ReturnType<typeof setTimeout>;
        resolve: (reply: RawTickReplay) => void;
    }>();
    const send = (message: Envelope) => { try { channel?.postMessage(message); } catch { /* remote closed */ } };
    const receive = (event: MessageEvent<Envelope>) => {
        const msg = event.data;
        if (!msg || typeof msg !== 'object' || typeof msg.id !== 'string' ||
            msg.id.length > 128) return;
        if (msg.kind === 'request') {
            if (!isOwner() || !physicalCode(msg.code) ||
                !validRange(msg.fromMs, msg.toMs)) return;
            const data = filterSnapshot(snapshot(msg.code), msg.code, msg.fromMs, msg.toMs);
            const count = Math.ceil(data.ticks.length / CHUNK_SIZE);
            for (let i = 0; i < count; i++) {
                if (!isOwner() || closed) return;
                send({
                    kind: 'chunk', id: msg.id, code: msg.code, index: i,
                    ticks: data.ticks.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
                });
            }
            if (!isOwner() || closed) return;
            send({
                kind: 'complete', id: msg.id, code: msg.code,
                chunks: count, total: data.ticks.length,
                truncated: data.truncated, earliestMs: data.earliestMs,
                latestMs: data.latestMs,
            });
            return;
        }
        const waiter = pending.get(msg.id);
        if (!waiter || msg.code !== waiter.code) return;
        if (msg.kind === 'chunk') {
            if (!Array.isArray(msg.ticks) || msg.ticks.length > CHUNK_SIZE ||
                msg.index !== waiter.nextChunk ||
                waiter.ticks.length + msg.ticks.length > MAX_EVENTS ||
                msg.ticks.some(t => t?.code !== waiter.code ||
                    replayEventTimeMs(t) === null ||
                    replayEventTimeMs(t)! < waiter.fromMs ||
                    replayEventTimeMs(t)! > waiter.toMs)) {
                waiter.invalid = true;
                return;
            }
            waiter.nextChunk++;
            waiter.ticks.push(...msg.ticks);
        } else if (msg.kind === 'complete') {
            clearTimeout(waiter.timer);
            pending.delete(msg.id);
            if (waiter.invalid || msg.chunks !== waiter.nextChunk ||
                msg.total !== waiter.ticks.length ||
                typeof msg.truncated !== 'boolean' ||
                (msg.earliestMs !== null && !Number.isFinite(msg.earliestMs)) ||
                (msg.latestMs !== null && !Number.isFinite(msg.latestMs))) {
                waiter.resolve(empty(true));
                return;
            }
            waiter.resolve({
                ticks: waiter.ticks, truncated: msg.truncated,
                missingOwner: false, earliestMs: msg.earliestMs, latestMs: msg.latestMs,
            });
        }
    };
    channel?.addEventListener('message', receive);
    return {
        request(code: string, fromMs: number, toMs: number): Promise<RawTickReplay> {
            if (closed || !physicalCode(code) || !validRange(fromMs, toMs))
                return Promise.resolve(empty(true));
            if (isOwner()) return Promise.resolve(filterSnapshot(snapshot(code), code, fromMs, toMs));
            if (!channel) return Promise.resolve(empty(true));
            const id = (typeof crypto !== 'undefined' && 'randomUUID' in crypto
                ? crypto.randomUUID() : Date.now().toString(36) + '-' + String(++seq));
            return new Promise(resolve => {
                const timer = setTimeout(() => {
                    pending.delete(id);
                    resolve(empty(true));
                }, TIMEOUT_MS);
                pending.set(id, {
                    code, fromMs, toMs, ticks: [], nextChunk: 0,
                    invalid: false, timer, resolve,
                });
                send({ kind: 'request', id, code, fromMs, toMs });
            });
        },
        close() {
            closed = true;
            channel?.removeEventListener('message', receive);
            channel?.close();
            for (const waiter of pending.values()) {
                clearTimeout(waiter.timer);
                waiter.resolve(empty(true));
            }
            pending.clear();
        },
    };
}
