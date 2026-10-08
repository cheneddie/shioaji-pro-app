// Visible-range Tick query planner. Kbar times are Taiwan wall-clock
// timestamps encoded in Lightweight Charts as UTC seconds.
import type { SecurityType } from '../../../lib/types/contract';
import {
    isTaifexTradingDay, previousTaifexTradingDay,
} from './trading-date';

const MINUTE = 60_000;
const DAY = 86_400_000;
const QUARTER = 15 * MINUTE;

export interface VisibleTickSlice {
    date: string; // Broker trading date, NOT the civil date of the tick
    session: 'night' | 'day' | 'calendar';
    fromMs: number;
    toMs: number;
    timeStart: string;
    timeEnd: string;
}
export interface VisibleTickPlan {
    requestedDates: string[];
    selectedDates: string[];
    omittedDates: number;
    slices: VisibleTickSlice[];
    unsupportedCalendar: boolean;
    unsupportedTimeframe: boolean;
}
const dayAt = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const clockAt = (ms: number) => new Date(ms).toISOString().slice(11, 19);
const wall = (date: string, hhmmss: string) =>
    Date.parse(date + 'T' + hhmmss + 'Z');
const step = (date: string, days: number) => dayAt(wall(date, '00:00:00') + days * DAY);

export function planVisibleTickSlices(
    securityType: SecurityType,
    dayOnly: boolean,
    timeframeMinutes: number,
    visibleFromSeconds: number,
    visibleToSeconds: number,
    limit = 3,
): VisibleTickPlan {
    const empty = (unsupportedTimeframe = false, unsupportedCalendar = false): VisibleTickPlan => ({
        requestedDates: [], selectedDates: [], omittedDates: 0,
        slices: [], unsupportedTimeframe, unsupportedCalendar,
    });
    if (![1, 5, 15, 60].includes(timeframeMinutes)) return empty(true);
    if (!Number.isFinite(visibleFromSeconds) ||
        !Number.isFinite(visibleToSeconds)) return empty();
    const fromMs = Math.min(visibleFromSeconds, visibleToSeconds) * 1000;
    const toMs = Math.max(visibleFromSeconds, visibleToSeconds) * 1000;
    // The UI limits query DATES to 3, not the visible span itself.
    // A 45-day zoom-out must still select the latest three trade dates.
    // Unknown exchange years are dealt with by the calendar guard below.
    if (toMs - fromMs > 366 * DAY) return empty(false, true);

    const isFuture = securityType === 'FUT' || securityType === 'OPT';
    const slices: VisibleTickSlice[] = [];
    let unsupportedCalendar = false;
    const intersect = (
        date: string, session: VisibleTickSlice['session'],
        start: number, end: number,
    ) => {
        if (end < fromMs || start > toMs) return;
        const from = Math.max(start, Math.floor((fromMs - timeframeMinutes * MINUTE) / QUARTER) * QUARTER);
        const to = Math.min(end, Math.ceil(toMs / QUARTER) * QUARTER);
        if (to < from) return;
        slices.push({
            date, session, fromMs: from, toMs: to,
            timeStart: clockAt(from), timeEnd: clockAt(to),
        });
    };
    const first = dayAt(fromMs);
    const last = dayAt(toMs);
    const spanDays = Math.ceil((wall(last, '00:00:00') - wall(first, '00:00:00')) / DAY);
    for (let i = -1; i <= spanDays + (isFuture ? 9 : 0); i++) {
        const date = step(first, i);
        if (!isFuture) {
            if (i >= 0 && i <= spanDays) {
                intersect(date, 'calendar', wall(date, '00:00:00'), wall(date, '23:59:59'));
            }
            continue;
        }
        const active = isTaifexTradingDay(date);
        if (active === null) {
            if (i >= 0 && i <= spanDays) unsupportedCalendar = true;
            continue;
        }
        if (!active) continue;
        let morningStart = date;
        if (!dayOnly) {
            const previous = previousTaifexTradingDay(date);
            if (previous === null) {
                unsupportedCalendar = true;
            } else {
                intersect(date, 'night', wall(previous, '15:00:00'), wall(previous, '23:59:59'));
                // On a long weekend, the previous session's post-midnight
                // executions live on the CALENDAR day immediately after the
                // preceding night (e.g. Oct 9 01:00 belongs to Oct 12).
                // The broker accepts a clock-time query per trading date;
                // keep the second slice encompassing that possible morning
                // and the eventual day session without adding a 7th query.
                morningStart = step(previous, 1);
            }
        }
        intersect(
            date, 'day',
            wall(date, dayOnly ? '08:45:00' : '00:00:00') < wall(morningStart, '00:00:00')
                ? wall(date, dayOnly ? '08:45:00' : '00:00:00')
                : wall(dayOnly ? date : morningStart, dayOnly ? '08:45:00' : '00:00:00'),
            wall(date, '13:45:00'),
        );
    }
    const requestedDates = [...new Set(slices.map(s => s.date))].sort().reverse();
    const selectedDates = requestedDates.slice(0, Math.max(0, limit));
    const selected = new Set(selectedDates);
    return {
        requestedDates, selectedDates,
        omittedDates: requestedDates.length - selectedDates.length,
        slices: slices.filter(s => selected.has(s.date)).sort((a, b) =>
            b.date.localeCompare(a.date) || (a.session === 'night' ? -1 : 1)),
        unsupportedCalendar, unsupportedTimeframe: false,
    };
}
