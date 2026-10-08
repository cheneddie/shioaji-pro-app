import { describe, expect, it } from 'vitest';
import {
    isTaifexTradingDay,
    orderFlowEventTradingDate,
    orderFlowExpectedStartMs,
    orderFlowHistoryDate,
    previousTaifexTradingDay,
} from './trading-date';

const taiwanTime = (local: string) =>
    Date.parse(local + '+08:00');
const wallEvent = (local: string) =>
    Date.parse(local + 'Z');

describe('TAIFEX 2026 trading day / Shioaji futures history date', () => {
    it('assigns the Oct 8 night to Oct 12, skipping the Oct 9 observed holiday', () => {
        expect(isTaifexTradingDay('2026-10-09')).toBe(false);
        expect(isTaifexTradingDay('2026-10-12')).toBe(true);
        expect(previousTaifexTradingDay('2026-10-12')).toBe('2026-10-08');
        expect(orderFlowHistoryDate('FUT', false,
            taiwanTime('2026-10-08T16:15:00'))).toBe('2026-10-12');
        expect(orderFlowHistoryDate('FUT', false,
            taiwanTime('2026-10-08T20:00:00'))).toBe('2026-10-12');
        expect(orderFlowHistoryDate('FUT', false,
            taiwanTime('2026-10-09T03:00:00'))).toBe('2026-10-12');
        expect(orderFlowExpectedStartMs('2026-10-12', 'FUT', false))
            .toBe(wallEvent('2026-10-08T15:00:00'));
    });

    it('keeps Oct 8 day-session review on Oct 8 after the night opens', () => {
        expect(orderFlowHistoryDate('FUT', true,
            taiwanTime('2026-10-08T16:15:00'))).toBe('2026-10-08');
        expect(orderFlowHistoryDate('FUT', true,
            taiwanTime('2026-10-09T12:00:00'))).toBe('2026-10-08');
        expect(orderFlowExpectedStartMs('2026-10-08', 'FUT', true))
            .toBe(wallEvent('2026-10-08T08:45:00'));
    });

    it('handles Sunday and reopening Monday without inventing a Friday date', () => {
        expect(orderFlowHistoryDate('FUT', false,
            taiwanTime('2026-10-11T20:00:00'))).toBe('2026-10-12');
        expect(orderFlowHistoryDate('FUT', false,
            taiwanTime('2026-10-12T09:00:00'))).toBe('2026-10-12');
        expect(orderFlowHistoryDate('FUT', false,
            taiwanTime('2026-10-12T15:01:00'))).toBe('2026-10-13');
    });

    it('respects the official February 11 night-to-February 23 transition', () => {
        expect(isTaifexTradingDay('2026-02-12')).toBe(false);
        expect(isTaifexTradingDay('2026-02-13')).toBe(false);
        expect(orderFlowHistoryDate('FUT', false,
            taiwanTime('2026-02-11T15:01:00'))).toBe('2026-02-23');
    });

    it('filters buffered physical Tick against the target trading date', () => {
        expect(orderFlowEventTradingDate(
            'FUT', false, wallEvent('2026-10-08T16:15:00'),
        )).toBe('2026-10-12');
        expect(orderFlowEventTradingDate(
            'FUT', false, wallEvent('2026-10-08T11:30:00'),
        )).toBe('2026-10-08');
        expect(orderFlowEventTradingDate(
            'FUT', true, wallEvent('2026-10-08T11:30:00'),
        )).toBe('2026-10-08');
    });

    it('does not pretend to know unsupported future exchange holidays', () => {
        expect(isTaifexTradingDay('2027-01-04')).toBeNull();
        expect(orderFlowHistoryDate('FUT', false,
            taiwanTime('2027-01-04T16:00:00'))).toBeNull();
        expect(orderFlowHistoryDate('STK', false,
            taiwanTime('2027-01-04T16:00:00'))).toBe('2027-01-04');
    });
});
