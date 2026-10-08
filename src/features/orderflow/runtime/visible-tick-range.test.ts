import { describe, expect, it } from 'vitest';
import { planVisibleTickSlices } from './visible-tick-range';

const wall = (t: string) => Date.parse(t + 'Z') / 1000;
const plan = (from: string, to: string, dayOnly = false, timeframe = 5) =>
    planVisibleTickSlices('FUT', dayOnly, timeframe, wall(from), wall(to));

describe('visible Tick range planner', () => {
    it('maps Oct 8 morning + night to two actual exchange trading dates', () => {
        const result = plan('2026-10-08T01:30:00', '2026-10-08T17:40:00');
        expect(result.selectedDates).toEqual(['2026-10-12', '2026-10-08']);
        expect(result.slices.find(s => s.date === '2026-10-12')).toMatchObject({
            session: 'night', timeStart: '15:00:00', timeEnd: '17:45:00',
        });
        expect(result.slices.find(s => s.date === '2026-10-08')).toMatchObject({
            session: 'day', timeStart: '01:15:00',
        });
    });
    it('skips Oct 9 holiday and weekend', () => {
        expect(plan('2026-10-08T20:00:00', '2026-10-12T12:00:00')
            .selectedDates).toContain('2026-10-12');
        expect(plan('2026-10-08T20:00:00', '2026-10-12T12:00:00')
            .selectedDates).not.toContain('2026-10-09');
    });
    it('includes post-midnight holiday executions in the following trading date', () => {
        const result = plan('2026-10-08T23:50:00', '2026-10-09T02:30:00');
        expect(result.selectedDates).toEqual(['2026-10-12']);
        expect(result.slices.map(s => s.session)).toEqual(['night', 'day']);
        const afterMidnight = result.slices.find(s => s.session === 'day')!;
        expect(afterMidnight.date).toBe('2026-10-12');
        expect(afterMidnight.timeStart).toBe('00:00:00');
        expect(afterMidnight.timeEnd).toBe('02:30:00');
    });
    it('does not suppress recent 3 dates when zoomed out over 45 calendar days', () => {
        const result = plan('2026-08-01T09:00:00', '2026-10-08T18:00:00');
        expect(result.unsupportedCalendar).toBe(false);
        expect(result.selectedDates).toHaveLength(3);
        expect(result.omittedDates).toBeGreaterThan(3);
    });
    it('restricts day-only and respects 15 minute alignment', () => {
        const result = plan('2026-10-08T09:17:00', '2026-10-08T10:03:00', true);
        expect(result.slices).toHaveLength(1);
        expect(result.slices[0]).toMatchObject({
            date: '2026-10-08', session: 'day',
            timeStart: '09:00:00', timeEnd: '10:15:00',
        });
    });
    it('selects newest 3 trading dates', () => {
        const result = plan('2026-10-05T08:45:00', '2026-10-08T20:00:00');
        expect(result.selectedDates).toHaveLength(3);
        expect(result.omittedDates).toBeGreaterThan(0);
    });
    it('uses calendar days for stocks', () => {
        const result = planVisibleTickSlices('STK', false, 1,
            wall('2026-10-08T09:00:00'), wall('2026-10-09T10:00:00'));
        expect(result.selectedDates).toEqual(['2026-10-09', '2026-10-08']);
    });
    it('suppresses daily bubbles and unknown futures years', () => {
        expect(plan('2026-10-08T09:00:00', '2026-10-08T10:00:00', false, 1440)
            .unsupportedTimeframe).toBe(true);
        expect(plan('2027-01-04T09:00:00', '2027-01-04T10:00:00')
            .unsupportedCalendar).toBe(true);
    });
});
