# Shared Order Flow Runtime — Development 2

Development 2 introduces the shared, non-UI data layer used by all future Order Flow panels.

## Scope

This stage adds:

- domain types and constants;
- exchange event-time parsing;
- tick aggregation;
- current-book aggregation;
- shared history request cache;
- runtime registry with retain/release ownership;
- batched runtime notifications and synchronous aggregation;
- health/status snapshot.

It does **not** register panels or render UI.

## Runtime identity

A runtime is shared by:

```text
API base
+ market = region : security_type : exchange
+ display symbol
+ session
```

Session values are currently:

- `all`
- `day`
- `night`

The session is an ownership/data-partition key in Development 2. Session-hour filtering belongs to the consuming panel/history policy and is not guessed here.

Alias and physical contracts remain separate presentation runtimes when their display symbols differ. Broker-level subscription deduplication continues to be handled by the existing `quote-ownership.ts`, which already coalesces alias/physical ownership through `target_code`.

## Ownership

`getOrderFlowRuntime(contract, session)` returns the registry instance.

A consumer activates it with:

```ts
const release = runtime.retain();
```

The first retain:

- calls the existing `ensureStream()`;
- retains one Tick quote;
- retains one BidAsk quote;
- registers one raw Tick listener;
- registers one raw BidAsk listener;
- listens to stream status.

Additional consumers of the same runtime do not create more listeners or quote retains.

The last release immediately removes extension listeners and releases both quote holds through the existing quote-ownership layer.

## Tick semantics

Raw delivery remains lossless from Development 1, but aggregation only treats a tick as an executed trade when:

```text
simtrade !== true
volume > 0
price is finite
```

Authoritative side classification:

- `tick_type = 1` → buy
- `tick_type = 2` → sell
- anything else → neutral

No price-direction guessing is used.

Per-price session totals:

- dailyBuy
- dailySell
- dailyNeutral
- dailyTotal

Rolling window defaults to 300 seconds of **event time**:

- movingBuy
- movingSell
- movingNeutral
- movingTotal
- movingDelta = movingBuy - movingSell

Out-of-order trades inside the current moving window are inserted by event time. Older-than-window arrivals still affect the session totals but not the current moving window.

Exact recent tick replays are deduplicated with a bounded recent-event key set so reconnect replay cannot double-count an identical trade.

## Book semantics

The runtime keeps the latest regular-lot bid/ask snapshot by price.

An out-of-order book update older than the current book event time is counted for diagnostics but does not roll the visible book backward.

`diff_bid_vol` and `diff_ask_vol` remain available in the Development 1 raw bridge, but Development 2 does not label them absorption, reload, or iceberg.

## History

`fetchOrderFlowHistory()` wraps the existing `fetchHistoryTicks()`.

Requests are coalesced by API base + contract identity + date + revision and stored in a bounded 64-entry Promise cache, matching the existing chart-history architecture.

A revision can explicitly permit another request after a cached success/failure.

History is normalized but is **not** merged into live aggregation in Development 2. This prevents live/history overlap from silently double-counting before the later Footprint/Volume Profile range policies are defined.

## Notification policy

Aggregation is synchronous per raw market event.

Runtime UI-facing subscribers are notified on a 50 ms batch timer. The notification throttle never drops aggregation events.

## Health

Snapshot health includes:

- active/ref count;
- stream status and stale flag;
- last tick/book event time;
- tick/book event gap;
- raw and executed tick counts;
- duplicate count;
- out-of-order tick/book counts;
- invalid event-time count;
- history loading/error state.

## Explicit non-goals

Development 2 does not add:

- `orderflow_kline`
- `footprint`
- `flowladder`
- Bubble indicator
- Volume Profile drawing
- React hooks/components
- order placement
- session-hour heuristics
- history/live merge
