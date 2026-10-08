// Historical Shioaji ticks are not an intraday live-data source.
// Never query the active/future exchange trading date: providers may
// silently return the most recent completed day's data instead.
import type { SecurityType } from '../../../lib/types/contract';
import { orderFlowHistoryDate } from './trading-date';
import type { VisibleTickSlice } from './visible-tick-range';

export function shouldDeferBrokerHistory(
    securityType: SecurityType,
    slice: Pick<VisibleTickSlice, 'date'>,
    nowMs = Date.now(),
): boolean {
    if (securityType === 'FUT' || securityType === 'OPT') {
        // Use full-session trading date even for a day-only chart: a day
        // session is considered complete when the following night begins.
        const activeDate = orderFlowHistoryDate(securityType, false, nowMs);
        return activeDate === null || slice.date >= activeDate;
    }
    const todayTw = new Date(nowMs + 8 * 60 * 60 * 1_000)
        .toISOString().slice(0, 10);
    return slice.date >= todayTw;
}
