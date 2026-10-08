# Development 8.1 — Flow K-line unified tools

**Task source:** User-provided screenshot of Order Flow toolbar with
`Flow K 線 / 完整 K 線 / Footprint` and follow-up instruction to integrate
native chart drawing/transaction/alert/indicator features *into* Flow K-line.

## Requirements

1. **Single canvas**: `Flow K 線` uses the full native chart engine with
   identical drawing palette, undo/redo/object operations, timeframes,
   indicator picker, plot legends, order-mode toolbar, account and lot/quantity
   selectors, alert/stop/take trigger engine.
2. **Bubble inside indicators**: the normal `指標` popup lists
   `Order Flow 成交氣泡` in the overlay category and search results.
   Selecting it opens settings with enable/disable, cumulative/single/charge
   filter, buy/sell, quantity thresholds, radius, opacity, reference and scale.
   Persist legacy Flow bubble settings per panel ID, never native indicators.
3. **Order Flow additions**: keep the Flow-specific range VP drawing tool,
   its persisted anchors, tick/book source, and all original Bubble logic.
4. **View switch**: only `Flow K 線 / Footprint`; legacy saved
   `native` view migrates to unified Flow K-line.
5. **Trading safety**: native order/account/confirmation code remains the only
   execution path; VP anchor clicks never submit orders, native order/drawing
   mode disables VP, VP edge dragging is disabled while trade mode is armed.
6. **Native non-regression**: the original `chart` route does not supply
   extension props. `flash`, `depth`, `tape`, `volprofile`, `footprint`
   and `flowladder` keep their own established behavior.
7. **Tests**: typecheck/build, all existing unit/native tests, new Flow view
   & persistence regression, conditional native picker extension and trade
   disarm static/behavior tests. No real live order should be sent by tests.

## Architecture and residual caveats

The native chart uses its existing OHLC history for K-bars and all native
indicators; the Bubble and Flow VP layers still consume the shared raw-event
Order Flow runtime. Their price/time coordinates are projected onto the same
`lightweight-charts` candle series. The two sources must not be naively
assumed identical at every reconnect/broker history boundary.

Conservatively additive optional interface in CandleChart and indicator picker
avoids copying the entire live-trading implementation, but needs manual QA of
overlay alignment on multi-pane charts and both-axis zoom, account switching,
order cancel/drag with selected VP drawings, 100x mount lifecycle and real
session boundary behavior. Green CI alone is not a release sign-off.
