# Order Flow Bubble — Development 5

Development 5 adds a tick-backed Bubble indicator **only** to the independent `orderflow_kline` panel.

It does not modify the native `CandleChart`, `src/lib/indicator-defs.ts`, native indicator persistence, native chart drawings, `FlashOrder`, `VolProfile`, `DepthLadder`, or `TickTape`.

## Data path

```text
existing Shioaji shared stream
  -> OrderFlowRuntime dedupe
  -> existing OrderFlowKline runtime.subscribeTicks()
      -> candle projection
      -> BubbleSourceTrade projection
          -> BubbleAggregator
          -> OrderFlowBubbleLayer canvas
```

The Bubble feature does not create a second SSE connection and does not call `retainQuote()` directly.

For history, when Bubble is enabled the panel calls the same shared `OrderFlowRuntime.loadHistory()` for the current trading date. Pending live ticks are merged with history using multiplicity-preserving keys before Bubble aggregation.

## Source semantics

- `tick_type=1` → buy
- `tick_type=2` → sell
- neutral/unknown ticks are not rendered as bubbles
- simulated and intraday-odd ticks are rejected
- day-only mode uses the same session filter as the Order Flow K-line

## Filter modes

The semantics intentionally match the existing trading-workspace Bubble behavior:

### cumulative

For each candle + price level:

`delta = buy volume - sell volume`

A bubble is drawn only when delta is non-zero. Side follows the delta sign; bubble volume is `abs(delta)`.

### single

The min/max filter applies to each individual trade size first. Passing trades are then accumulated by candle + price + side.

This is equivalent to the prior `single_order_buckets` behavior without requiring a separate bucket wire format.

### charge

Trades are grouped into fixed N-second windows by direction. The candidate anchors at the first trade price and its candle; window volume is the sum of same-direction trades.

Min/max filtering applies after the charge window is accumulated.

## Scale modes

The prior trading-workspace exposed `visible / bar` but its renderer did not actually branch on that setting. Dev5 makes the setting explicit:

- `visible`: radius is normalized against the largest visible Bubble candidate.
- `bar`: radius is normalized against the largest Bubble candidate in the same candle.

Both use square-root volume scaling, `minimumRadius`, and `scalePercent`.

## Rendering

Bubble is a dedicated Canvas overlay inside `OrderFlowKlinePanel`, projected with Lightweight Charts:

- X: `timeScale.timeToCoordinate(timestamp)`
- Y: candle series `priceToCoordinate(price)`

The overlay redraws on candidate changes, visible-range changes, and resize. It renders only coordinate-visible candidates.

Bubble colors reuse the active chart up/down palette.

## Tooltip / hit test

The Bubble canvas does not capture pointer input. Mouse events remain owned by the chart; the parent host performs circle-radius hit testing and shows:

- BUY / SELL
- price
- volume

## Settings and persistence

The Order Flow K-line owns its own indicator settings under:

`sj-pro-orderflow-kline-<panelId>`

Bubble defaults follow the existing workspace defaults:

- disabled
- minimum volume 1
- maximum volume 0 (unbounded)
- minimum radius 1
- opacity 28%
- direction all
- filter mode cumulative
- charge window 1 second
- scale mode visible
- scale percent 100%

## Bounded history

Dev5 intentionally hydrates Bubble tick history for the current trading date only. The K-line itself may show a longer multi-day bar history. Multi-day / viewport-driven tick hydration is a later optimization, not a reason to duplicate market-data subscriptions in Dev5.

## Explicit non-goals

Development 5 does not implement:

- native CandleChart indicators
- Volume Profile drawing (Development 6)
- Flow Ladder (Development 7)
- click-to-trade
- iceberg / absorption inference
- any dependency upgrade
