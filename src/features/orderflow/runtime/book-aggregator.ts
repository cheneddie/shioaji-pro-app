// src/features/orderflow/runtime/book-aggregator.ts

import type { OrderFlowRawBook } from './market-event-bridge';
import { parseExchangeEventTimeMs } from './event-time';

export class BookAggregator {
    readonly bids = new Map<number, number>();
    readonly asks = new Map<number, number>();

    bookCount = 0;
    outOfOrderBookCount = 0;
    lastEventTimeMs: number | null = null;

    ingest(book: OrderFlowRawBook) {
        this.bookCount += 1;
        const eventTimeMs = parseExchangeEventTimeMs(book.date, book.time);
        if (
            eventTimeMs !== null &&
            this.lastEventTimeMs !== null &&
            eventTimeMs < this.lastEventTimeMs
        ) {
            this.outOfOrderBookCount += 1;
            return false;
        }
        if (eventTimeMs !== null) this.lastEventTimeMs = eventTimeMs;

        this.bids.clear();
        this.asks.clear();
        for (const level of book.bids) {
            if (
                level.price !== null &&
                Number.isFinite(level.price) &&
                level.volume >= 0
            ) {
                this.bids.set(level.price, level.volume);
            }
        }
        for (const level of book.asks) {
            if (
                level.price !== null &&
                Number.isFinite(level.price) &&
                level.volume >= 0
            ) {
                this.asks.set(level.price, level.volume);
            }
        }
        return true;
    }
}
