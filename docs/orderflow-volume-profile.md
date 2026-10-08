# Development 6 — Order Flow Range Volume Profile Drawing

**Base:** Development 5 \`6a892ec71b68c585088a330b603f6e3222af9d4e\`.
**Scope:** New \`orderflow_kline\` only. No changes to native \`chart\`, \`volprofile\`, \`flash\`, \`depth\`, or \`tape\`.

## User workflow

1. Open the independent **Order Flow K 線** panel.
2. Select **VP 畫圖**.
3. Click start candle and end candle (either direction) to create a range drawing.
4. Drawings display price-level stacked buy/sell/neutral volume bars, and three lines: POC, VAH, VAL.
5. Use the range dropdown to select a drawing; drag either anchor by its **top-edge marker**. Use **刪除選取** or **清除 VP** to delete.
6. The drawing survives ordinary chart pan/zoom, refresh and panel remount. Persistence is per panel ID, displayed contract, physical target and session, isolated from native chart drawings.

The two anchors are **candlestick close-label-right times**, not raw individual trade timestamps. Only trades whose K-bar label lies inside the selected interval (inclusive) participate.

## Data path

\`\`\`text
existing SSE -> shared OrderFlowRuntime.subscribeTicks()
                    +
               OrderFlowRuntime.loadHistory(date)
                         |
            history/live multiplicity reconciliation
                         |
       domain/volume-profile.ts (price tick binning, value area)
                         |
       OrderFlowVolumeProfileDrawingLayer canvas overlay
\`\`\`

The feature creates **no new SSE connection or quote retain of its own**. It acquires and releases the same shared Order Flow runtime. A single date history request uses the runtime's existing coalescing cache.

Historical range selection may span several Taiwan-local dates. Missing history is reported as an error instead of publishing a misleading partial POC. Fetches run sequentially to avoid burst load; requests for a single selection are capped to 31 calendar days. Midnight-labelled intraday bars include the prior date as necessary.

## Price profile rules

- `tick_type = 1` = buy; `2` = sell; other = neutral.
- Ignore simulated/odd-lot, zero-volume and invalid-priced events.
- Aggregate with the **tick size at each executed price**, not just `contract.tick` at reference price. For FUT/OPT with `tick_rule`, reuse the authoritative cached server tick bands via `bandTickFor()`; for non-derivatives use existing market tick rules. If a selected price band is unavailable, do not publish a partial POC. All three sides contribute to **total**.
- POC = highest-total-volume level, breaking ties in favor of higher price.
- Value area = 70% of total. Start from POC, expand to next-volume-heaviest neighboring level. Ties expand upward first.
- POC, VAH, VAL never claim to represent a range when any requested historical date failed to load.
- Selected range endpoints may be moved; the profile recomputes after anchor changes.

## Isolation and storage

- New code only: `src/features/orderflow/domain/volume-profile.ts`, `src/features/orderflow/components/order-flow-volume-profile.tsx`, and local CSS/tests.
- One additive integration in `src/features/orderflow/components/order-flow-kline-panel.tsx`.
- Namespace: `sj-pro-orderflow-vp-*`.
- No native drawing tool registration, no native VolProfile refactor, no native indicator modification, no trading commands.

## Limitations

- Full historical tick hydration is demand-driven for the selected date range, with a 31-day safety cap; this is not unbounded multi-year VP.
- Date-range loading is asynchronous; the range appears before the final volume calculation. Do not interpret a loading/error drawing as complete.
- The raw Shioaji tick stream does not expose MBO-level order identities.
- Native app live-SSE login and Windows desktop runtime require separate on-device QA; frontend CI does not prove a working broker connection.

- Missing or invalid instrument tick size disables VP computation explicitly instead of silently assuming a tick interval.

- Price-banded FUT/OPT profiles display `VP 價格級距尚未就緒` while server-authoritative tick bands are unavailable; they never silently fall back to a single reference-price tick size.
