# Order Flow K-line — Development 3

Development 3 adds the first independent Order Flow workspace panel.

## Registration

New additive block type:

`orderflow_kline`

The native mapping remains unchanged:

`chart -> CandleChart`

The new mapping is:

`orderflow_kline -> OrderFlowKlinePanel`

The panel is pinnable, multi-instance, belongs to the market category, supports the same `chartSession` workspace field, and is available as a popout.

## Isolation

`OrderFlowKlinePanel` is **not** a wrapper around native `CandleChart`.

It owns a small independent `lightweight-charts` instance and intentionally does not import or mount:

- native chart order placement;
- native indicator dialog/registry;
- native drawing tools;
- native chart order settings.

This preserves the Development 0 isolation contract and leaves those future Order Flow capabilities to their own stages.

## Data flow

```text
existing shared SSE
  -> Dev1 raw bridge
  -> Dev2 OrderFlowRuntime
     -> dedupe / health / moving flow
     -> Dev3 synchronous tick fan-out
        -> OrderFlowKlinePanel live OHLCV

REST /api/v1/data/kbars
  -> existing fetchChartHistory cache
  -> existing kbarsToCandles / aggregate
  -> OrderFlowKlinePanel history
```

No second EventSource is created and multiple Order Flow K-line panels sharing the same runtime do not create additional raw market listeners.

## Live / history handoff

While a REST history request is in flight, raw ticks are buffered locally by the panel.

After history arrives:

- buffered ticks whose bucket is at or before the returned history tail are discarded to avoid double counting a partial REST tail;
- buffered ticks in newer buckets are applied;
- subsequent deduped raw runtime ticks update the current/new candle directly.

If history fails, buffered raw ticks become the live chart seed.

## Session handling

`all` and `day` reuse the existing chart-session workspace field.

Day-only filtering reuses the existing Taiwan-session helpers before history aggregation and for live raw ticks.

The runtime is retained using the matching `all` / `day` identity; Development 3 still does not redefine session hours inside the shared runtime.

## Explicit non-goals

Development 3 does not add:

- Footprint rendering;
- Bubble rendering or settings;
- Volume Profile drawing;
- Flow Ladder;
- Order Flow indicators;
- Order Flow drawing persistence;
- live order placement;
- native CandleChart changes;
- dependency upgrades.

Those remain later stages.
