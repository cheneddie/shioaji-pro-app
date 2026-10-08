import { describe, expect, it } from 'vitest';
import { shouldDeferBrokerHistory } from './broker-history-eligibility';

const at = (iso: string) => Date.parse(iso);
const date = (d: string) => ({ date: d });

describe('live-session Shioaji history eligibility', () => {
    it('never sends an Oct 12 history request during Oct 8 night', () => {
        const now = at('2026-10-08T12:05:00Z'); // Taiwan 20:05
        expect(shouldDeferBrokerHistory('FUT', date('2026-10-12'), now)).toBe(true);
        expect(shouldDeferBrokerHistory('FUT', date('2026-10-08'), now)).toBe(false);
    });
    it('does not treat the holiday post-midnight Tick as Oct 9 history', () => {
        const now = at('2026-10-08T18:05:00Z'); // Taiwan Oct 9 02:05
        expect(shouldDeferBrokerHistory('FUT', date('2026-10-12'), now)).toBe(true);
        expect(shouldDeferBrokerHistory('FUT', date('2026-10-08'), now)).toBe(false);
    });
    it('does not unnecessarily block completed day-only history during night', () => {
        const now = at('2026-10-08T08:10:00Z');
        expect(shouldDeferBrokerHistory('FUT', date('2026-10-08'), now)).toBe(false);
    });
    it('keeps the active daytime futures and stock trading date deferred', () => {
        const now = at('2026-10-08T02:00:00Z');
        expect(shouldDeferBrokerHistory('FUT', date('2026-10-08'), now)).toBe(true);
        expect(shouldDeferBrokerHistory('STK', date('2026-10-08'), now)).toBe(true);
        expect(shouldDeferBrokerHistory('STK', date('2026-10-07'), now)).toBe(false);
    });
    it('fails closed for unknown TAIFEX calendar years', () => {
        expect(shouldDeferBrokerHistory('FUT', date('2027-01-04'),
            at('2027-01-04T01:00:00Z'))).toBe(true);
    });
});
