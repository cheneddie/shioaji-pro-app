// Read-only compatibility adapter for the proposed private-Sidecar recorder.
// The existing Sidecar does not currently expose this endpoint. We issue NO
// requests until /api/v1/info explicitly advertises recorder v1 support.
// All returned events must be genuinely captured source Tick events.
import { apiGet } from '../../../lib/api';
import { getApiBase } from '../../../lib/runtime';
import { knownServerInfo, getServerModeVersion } from '../../../lib/server-info-store';
import { replayEventTimeMs } from '../../../lib/raw-tick-replay';
import type { SseTick } from '../../../lib/types/market';

const MAX_TICKS = 80_000;
const MAX_SPAN_MS = 45 * 86_400_000;
export interface SidecarRecordedReplay {
    ticks: SseTick[];
    available: boolean;
    truncated: boolean;
    recordedFromMs: number | null;
    recordedToMs: number | null;
    gapCount: number;
}
interface RecordedPayload {
    schema_version: number;
    physical_code: string;
    mode: 'simulation' | 'production';
    ticks: SseTick[];
    recorded_from_ms: number | null;
    recorded_to_ms: number | null;
    gaps: Array<{ from_ms: number; to_ms: number; reason: string }>;
    truncated: boolean;
}
const unavailable = (): SidecarRecordedReplay => ({
    ticks: [], available: false, truncated: false,
    recordedFromMs: null, recordedToMs: null, gapCount: 0,
});
export async function fetchSidecarRecordedTicks(
    code: string, fromMs: number, toMs: number,
): Promise<SidecarRecordedReplay> {
    const info = knownServerInfo();
    if (info?.orderflow_recorder?.enabled !== true ||
        info.orderflow_recorder.version !== 1) return unavailable();
    if (!/^[A-Z0-9_-]{1,32}$/.test(code) ||
        !Number.isFinite(fromMs) || !Number.isFinite(toMs) ||
        fromMs > toMs || toMs - fromMs > MAX_SPAN_MS) return unavailable();
    const apiBase = getApiBase();
    const modeVersion = getServerModeVersion();
    const mode = info.simulation ? 'simulation' : 'production';
    let data: RecordedPayload;
    try {
        data = await apiGet<RecordedPayload>(
            '/api/v1/orderflow/ticks/recorded' +
                '?physical_code=' + encodeURIComponent(code) +
                '&from_ms=' + fromMs + '&to_ms=' + toMs,
        );
    } catch {
        return unavailable();
    }
    // Never allow a late reply from another port or a sidecar mode switch.
    if (getApiBase() !== apiBase || getServerModeVersion() !== modeVersion ||
        knownServerInfo()?.simulation !== info.simulation) return unavailable();
    if (data?.schema_version !== 1 || data.mode !== mode ||
        data.physical_code !== code || !Array.isArray(data.ticks) ||
        !Array.isArray(data.gaps) || typeof data.truncated !== 'boolean') return unavailable();
    let invalid = data.ticks.length > MAX_TICKS;
    const safeTicks: SseTick[] = [];
    for (const tick of data.ticks.slice(0, MAX_TICKS)) {
        const eventTimeMs = tick && replayEventTimeMs(tick);
        if (!tick || tick.code !== code ||
            eventTimeMs === null || eventTimeMs < fromMs || eventTimeMs > toMs ||
            !Number.isFinite(Number(tick.close)) ||
            !Number.isFinite(tick.volume) || tick.volume <= 0 ||
            ![0, 1, 2].includes(tick.tick_type) ||
            tick.simtrade || tick.intraday_odd) {
            invalid = true;
            continue;
        }
        safeTicks.push(tick);
    }
    const validCoverage = (n: unknown) => n === null ||
        (typeof n === 'number' && Number.isFinite(n));
    if (!validCoverage(data.recorded_from_ms) ||
        !validCoverage(data.recorded_to_ms)) return unavailable();
    const gapValid = data.gaps.every(g => Number.isFinite(g?.from_ms) &&
        Number.isFinite(g?.to_ms) && g.from_ms <= g.to_ms &&
        typeof g.reason === 'string');
    if (!gapValid) return unavailable();
    return {
        ticks: safeTicks, available: true,
        truncated: data.truncated || invalid,
        recordedFromMs: data.recorded_from_ms,
        recordedToMs: data.recorded_to_ms,
        gapCount: data.gaps.length,
    };
}
