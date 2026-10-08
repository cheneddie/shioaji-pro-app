// Best-effort browser-side persistence of genuine SSE Tick events.
// This is NOT a sidecar recorder: when every App window is closed no new
// events can be captured. Records always retain physical contract identity.
// No synthesized trades, quotes, subscriptions or broker history requests.
import { replayEventTimeMs } from './raw-tick-replay';
import { getApiBase } from './runtime';
import { knownServerInfo } from './server-info-store';
import type { SseTick } from './types/market';

const DB_NAME = 'sj-orderflow-raw-ticks-v2';
const STORE = 'ticks';
const MAX_PENDING = 10_000;
const FLUSH_BATCH = 500;
const MAX_READ = 80_000;
const RETENTION_MS = 72 * 60 * 60 * 1_000;
const MAX_ROWS = 240_000;
const PRUNE_EVERY = 5_000;
const TW_OFFSET_MS = 8 * 60 * 60 * 1_000;

interface StoredRawTick {
    id?: number;
    scope: string;
    code: string;
    eventTimeMs: number; // Taiwan wall-clock UTC encoding, not true epoch.
    tick: SseTick;
}

export interface DiskTickReplay {
    ticks: SseTick[];
    available: boolean;
    truncated: boolean;
    earliestMs: number | null;
    latestMs: number | null;
}

/**
 * Treat an unknown Sidecar mode as unavailable. Browser persistence is not
 * permitted to mix production and simulation ticks when ports/modes change.
 */
export function recorderScope(base: string, simulation: boolean | undefined): string | null {
    if (simulation === undefined || !base) return null;
    return JSON.stringify([base, simulation ? 'simulation' : 'production']);
}
function currentScope(): string | null {
    return recorderScope(getApiBase(), knownServerInfo()?.simulation);
}

const queue: StoredRawTick[] = [];
let connection: Promise<IDBDatabase> | null = null;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let writing: Promise<void> | null = null;
let dropped = false;
let writtenSincePrune = 0;
let pruning = false;

function dbOpen(): Promise<IDBDatabase> {
    if (connection) return connection;
    if (typeof indexedDB === 'undefined') return Promise.reject(new Error('IndexedDB unavailable'));
    connection = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE)) {
                const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
                store.createIndex('scopeCodeTime', ['scope', 'code', 'eventTimeMs']);
                store.createIndex('eventTime', 'eventTimeMs');
            }
        };
        request.onsuccess = () => {
            const db = request.result;
            db.onversionchange = () => { db.close(); connection = null; };
            resolve(db);
        };
        request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
        request.onblocked = () => reject(new Error('IndexedDB version upgrade blocked'));
    }).catch(err => {
        connection = null; // transient failure can be retried
        throw err;
    });
    return connection;
}

function transactionComplete(tx: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
        tx.onabort = () => reject(tx.error ?? new Error('IndexedDB aborted'));
    });
}

// Delete old records and trim total cardinality without fetching Tick bodies.
// Perform maintenance in a separate transaction so live writes remain short.
async function prune(): Promise<void> {
    if (pruning) return;
    pruning = true;
    try {
        const db = await dbOpen();
        const tx = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const index = store.index('eventTime');
        const cutoff = Date.now() + TW_OFFSET_MS - RETENTION_MS;
        const countReq = store.count();
        countReq.onsuccess = () => {
            let excess = Math.max(0, countReq.result - MAX_ROWS);
            const cursorReq = index.openCursor();
            cursorReq.onsuccess = () => {
                const cursor = cursorReq.result;
                if (!cursor) return;
                if ((typeof cursor.key === 'number' && cursor.key <= cutoff) || excess > 0) {
                    cursor.delete();
                    excess = Math.max(0, excess - 1);
                    cursor.continue();
                }
            };
        };
        await transactionComplete(tx);
    } catch {
        // Persisted gaps must be reported by clients; never crash the stream.
        dropped = true;
    } finally {
        pruning = false;
    }
}

async function flush(): Promise<void> {
    if (writing) return writing;
    if (!queue.length) return;
    const batch = queue.splice(0, FLUSH_BATCH);
    writing = (async () => {
        try {
            const db = await dbOpen();
            const tx = db.transaction(STORE, 'readwrite');
            const store = tx.objectStore(STORE);
            for (const item of batch) store.add(item);
            await transactionComplete(tx);
            writtenSincePrune += batch.length;
        } catch {
            dropped = true;
            // Do not silently pretend a failed write was persisted.
        }
    })();
    try { await writing; }
    finally {
        writing = null;
        if (writtenSincePrune >= PRUNE_EVERY) {
            writtenSincePrune = 0;
            void prune();
        }
        if (queue.length) scheduleFlush();
    }
}

function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
        flushTimer = null;
        void flush();
    }, 250);
}

/** Call ONLY for physical-code events from the shared SSE owner. */
export function queueRecordedRawTick(tick: SseTick): void {
    if (tick.simtrade || tick.intraday_odd || tick.volume <= 0) return;
    if (!Number.isFinite(tick.volume) || !/^[A-Z0-9_-]{1,32}$/.test(tick.code)) return;
    const eventTimeMs = replayEventTimeMs(tick);
    if (eventTimeMs === null) return;
    if (typeof indexedDB === 'undefined') return;
    const scope = currentScope();
    if (!scope) return;
    if (queue.length >= MAX_PENDING) {
        queue.shift();
        dropped = true;
    }
    queue.push({ scope, code: tick.code, eventTimeMs, tick });
    scheduleFlush();
}

export async function readRecordedRawTicks(
    physicalCode: string, fromMs: number, toMs: number,
): Promise<DiskTickReplay> {
    const unavailable = (): DiskTickReplay => ({
        ticks: [], available: false, truncated: true, earliestMs: null, latestMs: null,
    });
    if (!/^[A-Z0-9_-]{1,32}$/.test(physicalCode) ||
        !Number.isFinite(fromMs) || !Number.isFinite(toMs) ||
        fromMs > toMs || toMs - fromMs > 45 * 86_400_000) return unavailable();
    if (typeof indexedDB === 'undefined' || typeof IDBKeyRange === 'undefined') return unavailable();
    const scope = currentScope();
    if (!scope) return unavailable();
    try {
        if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
        while (writing || queue.length) {
            if (writing) await writing;
            else await flush();
        }
        const db = await dbOpen();
        return await new Promise<DiskTickReplay>((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const store = tx.objectStore(STORE);
            const range = IDBKeyRange.bound(
                [scope, physicalCode, fromMs], [scope, physicalCode, toMs],
            );
            const req = store.index('scopeCodeTime').openCursor(range, 'prev');
            const ticks: SseTick[] = [];
            let truncated = dropped;
            req.onsuccess = () => {
                const cursor = req.result;
                if (!cursor) return;
                if (ticks.length >= MAX_READ) { truncated = true; return; }
                const entry = cursor.value as StoredRawTick;
                if (entry.scope !== scope || entry.code !== physicalCode || entry.eventTimeMs < fromMs ||
                    entry.eventTimeMs > toMs || replayEventTimeMs(entry.tick) !== entry.eventTimeMs) {
                    truncated = true;
                } else ticks.push(entry.tick);
                cursor.continue();
            };
            tx.oncomplete = () => {
                ticks.reverse();
                resolve({
                    ticks, available: true, truncated,
                    earliestMs: ticks.length ? replayEventTimeMs(ticks[0]!) : null,
                    latestMs: ticks.length ? replayEventTimeMs(ticks[ticks.length - 1]!) : null,
                });
            };
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
    } catch { return unavailable(); }
}
