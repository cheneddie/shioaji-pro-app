# Order Flow Footprint — Development 4

Development 4 adds a new independent `footprint` market panel. It does not modify or wrap native `CandleChart`, `FlashOrder`, `VolProfile`, `DepthLadder`, or `TickTape`.

## Data flow

```text
existing Shioaji shared stream
  -> Development 1 raw bridge
  -> Development 2 OrderFlowRuntime
      -> loadHistory(date) (request-coalesced)
      -> subscribeTicks() (post-runtime dedupe)
  -> FootprintPanel
      -> FootprintAggregator
      -> FootprintGrid canvas
```

The panel does not create an SSE connection, does not call `retainQuote()` directly, and does not fetch history outside the shared runtime.

## Footprint semantics

Each bar groups executed trades by timeframe and compressed price level.

For each level:

- `buyVolume`: source `tick_type=1`
- `sellVolume`: source `tick_type=2`
- `neutralVolume`: source `tick_type=0/unknown`
- `totalVolume = buy + sell + neutral`
- `delta = buy - sell`

Neutral trades are never silently reassigned to buy or sell.

Supported timeframes: 30s, 1m, 3m, 5m, 15m, 30m, 60m.

## Price ladder and compression

Missing price levels inside each bar are filled with zero volume so the footprint ladder remains structurally continuous.

Compression supports 1T / 2T / 4T / 8T. The anchor is the contract reference price when available, otherwise the first valid trade. Price stepping reuses Shioaji Pro's existing `tickSizeFor/stepPrice` path, including server-backed FUT/OPT tick-band metadata; Dev4 does not hard-code TAIFEX tick sizes.

## POC and imbalance

- POC: largest total volume; ties resolve to the higher price.
- Delta POC: largest absolute delta; ties resolve to the higher price.
- Horizontal imbalance compares active buy/sell on the same price.
- Diagonal buy imbalance compares buy volume against sell volume one compressed level below.
- Diagonal sell imbalance compares sell volume against buy volume one compressed level above.
- Ratio and minimum delta are user-configurable.

These are visualization signals only. Dev4 does not label them as iceberg, absorption, MBO, or verified queue state.

## History/live handoff

The panel subscribes to runtime ticks before history resolves and buffers normalized footprint trades. When REST history returns, a multiplicity-preserving key (`eventTimeMs + price + volume + side`) removes only matching replayed events from the pending buffer. This avoids both fixed-size handoff loss and naive timestamp-only dropping.

If history fails, buffered/live trades remain usable and the panel degrades to live-only data instead of crashing.

## Rendering and LOD

The footprint grid is Canvas-based. It renders only the most recent configured number of bars (12 / 24 / 48) and avoids one DOM node per price cell.

Automatic LOD:

1. `detail`: Bid×Ask / Delta / Total text plus heatmap.
2. `heatmap`: colored cells, POC / Delta-POC / imbalance markers, no text.
3. `summary`: candle summary when bars or price rows are too dense.

## Persistence

Panel-local display preferences use:

`sj-pro-orderflow-footprint-<panelId>`

The existing native indicator/drawing storage namespaces are untouched. Session choice continues to use the existing backward-compatible workspace `chartSession` field.

## Explicit non-goals

Development 4 does not implement:

- Bubble indicator (Development 5)
- range Volume Profile drawing (Development 6)
- Flow Ladder (Development 7)
- click-to-trade
- native CandleChart changes
- native VolProfile changes
