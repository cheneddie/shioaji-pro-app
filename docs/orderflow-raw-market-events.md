# Order Flow Raw Market Event Bridge — Development 1

Development 1 adds an additive, regular-lot raw event path for the future Order Flow runtime. It does not add panels, aggregation, indicators, drawings, trading actions, or new market subscriptions.

## Confirmed existing behavior

Source-code review found that `onAnyTick()` is **not** a lossless raw tick listener. Its established behavior is real regular-lot trades only:

```text
!tick.simtrade && tick.volume > 0
```

That behavior is relied on by native tape/trigger consumers and is intentionally unchanged.

React quote-store listeners are notified in a 50 ms batch, while the internal quote maps are updated on each event. Sequential Order Flow analytics therefore must not derive from React notification snapshots.

## Additive APIs

Development 1 adds:

- `onRawTick(listener)`
  - every regular-lot tick handled by the existing stream ingestion path;
  - includes simtrade and zero-volume events;
  - excludes intraday odd-lot events;
  - follows existing continuous-contract alias ingestion semantics.

- `onAnyBidAsk(listener)`
  - every regular-lot bid/ask event handled by the existing stream ingestion path;
  - fires before React's batched notification flush;
  - excludes intraday odd-lot books;
  - follows existing continuous-contract alias ingestion semantics.

Neither API opens an EventSource or creates a Shioaji subscription.

## Order Flow bridge

`src/features/orderflow/runtime/market-event-bridge.ts` is the only new Order Flow feature-layer file in Development 1.

It provides:

- `subscribeOrderFlowTicks(code, listener)`
- `subscribeOrderFlowBooks(code, listener)`
- `normalizeOrderFlowTick()`
- `normalizeOrderFlowBook()`

The bridge:

- filters by the requested display/canonical code;
- exposes numeric prices while retaining the original typed SSE object in `raw`;
- preserves exchange `date` and `time`;
- preserves `tick_type`, `simtrade`, and `intraday_odd` semantics;
- keeps book-side `diff_bid_vol` / `diff_ask_vol` values as `diffVolume` without assigning absorption/iceberg meaning;
- does not aggregate or classify beyond the upstream fields.

## Explicit non-goals

Development 1 does **not**:

- register `orderflow_kline`, `footprint`, or `flowladder`;
- create `OrderFlowRuntime`;
- fetch history;
- aggregate moving or daily order flow;
- modify native panel implementations;
- alter `useQuote()` / quote-store behavior;
- alter `onAnyTick()` semantics;
- support odd-lot Order Flow consumers yet;
- create any new SSE connection or market subscription.

Those belong to later reviewed stages.
