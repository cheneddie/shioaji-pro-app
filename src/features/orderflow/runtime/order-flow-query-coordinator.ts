// Bounded Order Flow history requests: shared within this window, serialized
// across windows by the browser's Web Locks API. Never polls live market data.
import { apiGet } from '../../../lib/api';
import { getApiBase } from '../../../lib/runtime';
import { parseUsage, quotaState, type Usage } from '../../../lib/server-monitor';
import { fetchHistoryTicks } from '../../../lib/shioaji';
import type { ContractBase } from '../../../lib/types/contract';
import type { HistoryTicks } from '../../../lib/types/tick';
import type { OrderFlowHistoryTick } from '../domain/types';
import { parseHistoryDateTimeMs } from './event-time';
import { classifyTickType } from './tick-aggregator';
import { orderFlowEventTradingDate } from './trading-date';
import type { VisibleTickSlice } from './visible-tick-range';

export type SliceCoverage = 'ready' | 'gap' | 'error' | 'quota' | 'unknown' | 'cancelled';
export interface OrderFlowSliceResult {
    slice: VisibleTickSlice;
    status: SliceCoverage;
    ticks: OrderFlowHistoryTick[];
    percent: number | null;
    checkedAt: number | null;
    truncated: boolean;
    error?: string;
}
const CACHE_LIMIT = 16;
const CACHE_TICK_LIMIT = 300_000;
const INTERVAL_MS = 2_000;
const CACHE_ACTIVE_MS = 60_000;
type CacheEntry = {
    identity: string;
    date: string;
    fromMs: number;
    toMs: number;
    expiresAt: number;
    promise: Promise<OrderFlowSliceResult>;
};
const entries = new Map<string, CacheEntry>();
const liveRequests = new Set<Promise<unknown>>();
let localQueue = Promise.resolve();

export function makeSliceIdentity(contract: ContractBase, revision: number) {
    return JSON.stringify([
        getApiBase(), contract.region ?? 'TW', contract.security_type,
        contract.exchange, contract.code, contract.target_code ?? contract.code,
        revision,
    ]);
}
function keyOf(identity: string, slice: VisibleTickSlice) {
    return JSON.stringify([identity, slice.date, slice.session, slice.timeStart, slice.timeEnd]);
}
function currentTradingDay() {
    return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function result(
    slice: VisibleTickSlice, status: SliceCoverage,
    ticks: OrderFlowHistoryTick[] = [], error?: string,
    percent: number | null = null, checkedAt: number | null = null,
    truncated = false,
): OrderFlowSliceResult {
    return { slice, status, ticks, error, percent, checkedAt, truncated };
}
function validate(
    source: HistoryTicks,
    contract: ContractBase,
    slice: VisibleTickSlice,
    percent: number,
    checkedAt: number,
): OrderFlowSliceResult {
    if (!source || !Array.isArray(source.datetime) ||
        !Array.isArray(source.close) ||
        !Array.isArray(source.volume) ||
        !Array.isArray(source.tick_type)) {
        return result(slice, 'gap', [], '歷史 Tick 欄位缺失', percent, checkedAt);
    }
    const count = source.datetime.length;
    const arrays = [
        source.close, source.volume, source.tick_type,
        source.bid_price, source.bid_volume, source.ask_price, source.ask_volume,
    ];
    if (arrays.some(a => a !== undefined && (!Array.isArray(a) || a.length !== count))) {
        return result(slice, 'gap', [], '歷史 Tick 欄位長度不一致', percent, checkedAt);
    }
    const max = Math.min(count, CACHE_TICK_LIMIT);
    const truncated = count > max;
    const ticks: OrderFlowHistoryTick[] = [];
    let rejected = 0;
    for (let i = count - max; i < count; i++) {
        const eventTimeMs = typeof source.datetime[i] === 'string'
            ? parseHistoryDateTimeMs(source.datetime[i]!) : null;
        const price = source.close[i];
        const volume = source.volume[i];
        const tickType = source.tick_type[i];
        const valid = eventTimeMs !== null && Number.isFinite(eventTimeMs) &&
            typeof price === 'number' && Number.isFinite(price) &&
            typeof volume === 'number' && Number.isFinite(volume) && volume >= 0 &&
            typeof tickType === 'number' && Number.isFinite(tickType) &&
            orderFlowEventTradingDate(contract.security_type, false, eventTimeMs) === slice.date &&
            eventTimeMs >= slice.fromMs && eventTimeMs <= slice.toMs;
        if (!valid) { rejected++; continue; }
        ticks.push({
            datetime: source.datetime[i]!, eventTimeMs, price: price!,
            volume: volume!, tickType: tickType!,
            side: classifyTickType(tickType!),
        });
    }
    if (truncated || rejected || ticks.length === 0) {
        return result(slice, 'gap', ticks,
            truncated ? 'Tick 超過記憶體上限，已截斷' :
                rejected ? 'API 回傳錯誤交易日／時間或無效成交' : '查詢區間沒有可驗證的歷史成交',
            percent, checkedAt, truncated);
    }
    return result(slice, 'ready', ticks, undefined, percent, checkedAt);
}

const lockName = () => 'sj-orderflow-history:' +
    (typeof location === 'undefined' ? 'test' : location.origin) + ':' + getApiBase();
const stampName = () => lockName() + ':last-dispatch';

async function guardedRequest(
    contract: ContractBase,
    slice: VisibleTickSlice,
    stillNeeded: () => boolean,
): Promise<OrderFlowSliceResult> {
    if (!stillNeeded()) return result(slice, 'cancelled');
    // Cannot guarantee one active request across popouts without Web Locks.
    if (typeof navigator === 'undefined' || !navigator.locks?.request) {
        return result(slice, 'unknown', [], '無跨視窗請求鎖，已停止歷史查詢');
    }
    return navigator.locks.request(lockName(), async () => {
        if (!stillNeeded()) return result(slice, 'cancelled');
        let previous: number;
        try {
            previous = Number(localStorage.getItem(stampName()) ?? '0');
            if (!Number.isFinite(previous) || previous < 0) throw Error('Invalid dispatch stamp');
        } catch {
            return result(slice, 'unknown', [], '無法驗證跨視窗請求節流狀態');
        }
        const delay = Math.max(0, previous + INTERVAL_MS - Date.now());
        if (delay > 0) await new Promise<void>(resolve => setTimeout(resolve, delay));
        if (!stillNeeded()) return result(slice, 'cancelled');

        // A fresh usage snapshot is mandatory before EVERY missing slice.
        let usage: Usage;
        const checkedAt = Date.now();
        try {
            usage = parseUsage(await apiGet<Usage>('/api/v1/auth/usage'));
        } catch {
            return result(slice, 'unknown', [], '無法確認流量額度，未送出歷史查詢');
        }
        const quota = quotaState(usage);
        if (quota.percent === null) {
            return result(slice, 'unknown', [], '流量額度上限未知，未送出歷史查詢');
        }
        if (usage.remaining_bytes === 0 || quota.percent >= 80) {
            return result(slice, 'quota', [],
                `歷史行情流量已用 ${quota.percent.toFixed(1)}%，已停止補載成交氣泡`,
                quota.percent, checkedAt);
        }
        if (!stillNeeded()) return result(slice, 'cancelled');
        try {
            localStorage.setItem(stampName(), String(Date.now()));
        } catch {
            return result(slice, 'unknown', [], '無法記錄跨視窗請求節流狀態');
        }
        let answer: OrderFlowSliceResult;
        try {
            const source = await fetchHistoryTicks(contract, slice.date, {
                queryType: 'RangeTime',
                timeStart: slice.timeStart, timeEnd: slice.timeEnd,
            });
            answer = validate(source, contract, slice, quota.percent, checkedAt);
        } catch (error) {
            answer = result(slice, 'error', [],
                error instanceof Error ? error.message : String(error),
                quota.percent, checkedAt);
        }
        // A failed after-query usage read blocks subsequent queries (each next
        // request always makes its own fail-closed preflight regardless).
        try {
            const after = parseUsage(await apiGet<Usage>('/api/v1/auth/usage'));
            const afterQuota = quotaState(after);
            answer.percent = afterQuota.percent;
            answer.checkedAt = Date.now();
            if (afterQuota.percent === null) {
                answer.error = '歷史查詢後無法確認流量額度';
            }
        } catch {
            answer.error = answer.error || '歷史查詢後用量無法確認';
        }
        return answer;
    });
}

export function fetchOrderFlowVisibleSlice(
    contract: ContractBase,
    slice: VisibleTickSlice,
    opts: { revision: number; stillNeeded?: () => boolean },
): Promise<OrderFlowSliceResult> {
    const identity = makeSliceIdentity(contract, opts.revision);
    const key = keyOf(identity, slice);
    const now = Date.now();
    for (const [k, entry] of entries) {
        if (entry.expiresAt <= now && !liveRequests.has(entry.promise)) {
            entries.delete(k);
        }
    }
    // Also reuse covering intervals for panning/zooming within a fetched slice.
    let found: CacheEntry | undefined = entries.get(key);
    if (!found) {
        found = [...entries.values()].find(e =>
            e.identity === identity && e.date === slice.date &&
            e.fromMs <= slice.fromMs && e.toMs >= slice.toMs &&
            e.expiresAt > now);
    }
    if (found) {
        entries.delete(key);
        entries.set(key, found);
        return found.promise;
    }
    const stillNeeded = opts.stillNeeded ?? (() => true);
    // Within a window this queue preserves ordering even if Web Locks are absent.
    const promise = localQueue.then(() => guardedRequest(contract, slice, stillNeeded))
        .catch(error => result(slice, 'error', [],
            error instanceof Error ? error.message : String(error)));
    localQueue = promise.then(() => undefined);
    const entry: CacheEntry = {
        identity, date: slice.date, fromMs: slice.fromMs, toMs: slice.toMs,
        expiresAt: Number.POSITIVE_INFINITY, promise,
    };
    entries.set(key, entry);
    liveRequests.add(promise);
    void promise.then(answer => {
        liveRequests.delete(promise);
        entry.expiresAt = (answer.status === 'ready' || answer.status === 'gap')
            ? (slice.date < currentTradingDay() ? Number.POSITIVE_INFINITY : Date.now() + CACHE_ACTIVE_MS)
            : Date.now();
        if (answer.status !== 'ready' && answer.status !== 'gap' &&
            entries.get(key) === entry) entries.delete(key);
    });
    while (entries.size > CACHE_LIMIT) {
        const oldest = entries.keys().next().value;
        if (oldest === undefined) break;
        entries.delete(oldest);
    }
    return promise;
}

// Legacy Footprint and Order Flow VP consumers must use the SAME lock and
// quota gate as visible bubbles. Keep their existing AllDay semantics; do not
// silently change the dataset shape relied upon by these native-free panels.
export async function quotaGuardedOrderFlowAllDay(
    contract: ContractBase,
    date: string,
): Promise<HistoryTicks> {
    if (typeof navigator === 'undefined' || !navigator.locks?.request)
        throw new Error('無跨視窗請求鎖，拒絕歷史 Tick 查詢');
    return navigator.locks.request(lockName(), async () => {
        let last: number;
        try {
            last = Number(localStorage.getItem(stampName()) ?? '0');
            if (!Number.isFinite(last) || last < 0) throw Error('invalid stamp');
        } catch {
            throw new Error('無法確認歷史查詢節流狀態，未送出 Tick');
        }
        const interval = Math.max(0, last + INTERVAL_MS - Date.now());
        if (interval) await new Promise<void>(resolve => setTimeout(resolve, interval));
        let usage: Usage;
        try {
            usage = parseUsage(await apiGet<Usage>('/api/v1/auth/usage'));
        } catch {
            throw new Error('無法確認流量額度，未送出歷史查詢');
        }
        const quota = quotaState(usage);
        if (quota.percent === null) throw new Error('流量額度上限未知，未送出歷史查詢');
        if (usage.remaining_bytes === 0 || quota.percent >= 80)
            throw new Error('歷史行情流量已用 ' + quota.percent.toFixed(1) + '%，已停止補載成交氣泡');
        try {
            localStorage.setItem(stampName(), String(Date.now()));
        } catch {
            throw new Error('無法記錄跨視窗查詢節流狀態，未送出 Tick');
        }
        let raw: HistoryTicks;
        try {
            raw = await fetchHistoryTicks(contract, date);
        } finally {
            // Every historical Tick request triggers an after-query refresh;
            // subsequent queries require their own verified preflight.
            try { parseUsage(await apiGet<Usage>('/api/v1/auth/usage')); }
            catch { /* next request fails closed on its own preflight */ }
        }
        return raw;
    });
}
