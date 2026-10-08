// src/features/orderflow/runtime/event-time.ts

export function parseExchangeEventTimeMs(
    date: string,
    time: string,
): number | null {
    const d = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/.exec(date.trim());
    const t = /^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$/.exec(time.trim());
    if (!d || !t) return null;
    const fraction = (t[4] ?? '').padEnd(3, '0').slice(0, 3);
    const value = Date.UTC(
        Number(d[1]),
        Number(d[2]) - 1,
        Number(d[3]),
        Number(t[1]),
        Number(t[2]),
        Number(t[3]),
        Number(fraction || 0),
    );
    return Number.isFinite(value) ? value : null;
}

export function parseHistoryDateTimeMs(datetime: string): number | null {
    const value = datetime.trim();
    const match =
        /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})[T ](\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?/.exec(
            value,
        );
    if (match) {
        return parseExchangeEventTimeMs(
            `${match[1]}/${match[2]}/${match[3]}`,
            `${match[4]}:${match[5]}:${match[6]}${match[7] ? `.${match[7]}` : ''}`,
        );
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
}
