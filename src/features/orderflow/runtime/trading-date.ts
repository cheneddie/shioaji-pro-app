// TAIFEX trading-day assignment for historical Tick requests.
// Calendar authority: https://www.taifex.com.tw/file/taifex/CHINESE/11/attach/台期交字第1140003036號函.pdf
// 2026 annual calendar: https://www.taifex.com.tw/file/taifex/CHINESE/4/2026Calendar.pdf
// Update the calendar from the exchange's notices each year. Unknown years
// fail closed rather than silently treating an exchange holiday as a weekday.

import type { SecurityType } from '../../../lib/types/contract';

const TW_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const TAIFEX_CLOSED_2026 = new Set([
    '2026-01-01',
    '2026-02-12', '2026-02-13',
    '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', '2026-02-20',
    '2026-02-27', '2026-04-03', '2026-04-06', '2026-05-01',
    '2026-06-19', '2026-09-25', '2026-09-28',
    '2026-10-09', '2026-10-26', '2026-12-25',
]);

const isFutures = (securityType: SecurityType) =>
    securityType === 'FUT' || securityType === 'OPT';

function isoDate(date: Date): string {
    return [
        date.getUTCFullYear(),
        String(date.getUTCMonth() + 1).padStart(2, '0'),
        String(date.getUTCDate()).padStart(2, '0'),
    ].join('-');
}

function stepDay(date: string, amount: number): string {
    return isoDate(new Date(Date.parse(date + 'T00:00:00Z') + amount * DAY_MS));
}

/** null = unsupported year or malformed date: never fabricate a trading day. */
export function isTaifexTradingDay(date: string): boolean | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        isoDate(new Date(date + 'T00:00:00Z')) !== date ||
        !date.startsWith('2026-')) return null;
    const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
    return weekday !== 0 && weekday !== 6 && !TAIFEX_CLOSED_2026.has(date);
}

function seekTradingDate(date: string, direction: 1 | -1, includeCurrent = false): string | null {
    let cursor = includeCurrent ? date : stepDay(date, direction);
    for (let i = 0; i < 40; i++) {
        const open = isTaifexTradingDay(cursor);
        if (open === null) return null;
        if (open) return cursor;
        cursor = stepDay(cursor, direction);
    }
    return null;
}

export function previousTaifexTradingDay(date: string): string | null {
    return seekTradingDate(date, -1);
}

/**
 * Accept a Taiwan wall-clock encoded as a UTC Date (getUTC* returns TW
 * calendar fields). A night session begins at 15:00 on a trading day and
 * belongs to the NEXT exchange trading date, even over long holidays.
 */
function tradingDateAtTaiwanWall(
    securityType: SecurityType,
    dayOnly: boolean,
    wall: Date,
): string | null {
    const today = isoDate(wall);
    if (!isFutures(securityType)) return today;
    const todaysStatus = isTaifexTradingDay(today);
    if (todaysStatus === null) return null;
    const hours = wall.getUTCHours() + wall.getUTCMinutes() / 60;

    // The day-session-only chart should never jump to the next trading day
    // when the night market opens.
    if (dayOnly) return seekTradingDate(today, -1, true);

    if (todaysStatus && hours >= 15) return seekTradingDate(today, 1);
    if (todaysStatus && hours >= 5) return today;

    // Between midnight and 05:00 the previous calendar day's night session
    // is ongoing; on holidays/weekends the most recently opened night is
    // still assigned to its *following exchange trading day*.
    if (hours < 5 || !todaysStatus) {
        const prior = seekTradingDate(today, -1);
        if (prior === null) return null;
        return seekTradingDate(prior, 1);
    }
    return today;
}

/** Real UTC timestamp -> Taiwan civil date -> Shioaji historical Tick date. */
export function orderFlowHistoryDate(
    securityType: SecurityType,
    dayOnly: boolean,
    nowMs = Date.now(),
): string | null {
    return tradingDateAtTaiwanWall(
        securityType, dayOnly, new Date(nowMs + TW_OFFSET_MS),
    );
}

/** Shioaji Tick timestamps in this application are already TW-wall-clock UTC. */
export function orderFlowEventTradingDate(
    securityType: SecurityType,
    dayOnly: boolean,
    wallTimeMs: number,
): string | null {
    return tradingDateAtTaiwanWall(
        securityType, dayOnly, new Date(wallTimeMs),
    );
}

export function orderFlowExpectedStartMs(
    tradingDate: string,
    securityType: SecurityType,
    dayOnly: boolean,
): number | null {
    if (!isFutures(securityType)) return null;
    const sessionDate = dayOnly
        ? tradingDate
        : previousTaifexTradingDay(tradingDate);
    if (!sessionDate) return null;
    return Date.parse(sessionDate + (dayOnly ? 'T08:45:00Z' : 'T15:00:00Z'));
}
