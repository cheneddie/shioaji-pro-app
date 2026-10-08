# Development 7 — Flow Ladder (read-only Order Flow quote panel)

**Base:** Development 6 HEAD `4932618fe927f6090a85a7b9c2bbf19a103ee515`.
**Branch:** `feat/orderflow-dev7-flow-ladder`.

## Scope and isolation

Adds an independent `flowladder` BlockType in the market Panel Library, with a schematic panel thumbnail, pinned-contract support, session workspace persistence, and separate pop-out routing.

All implementation resides under `src/features/orderflow/` with small additive registration changes in Workspace/App/panel library/preview. No native CandleChart, FlashOrder, DepthLadder, VolProfile, TickTape, indicator, or drawing implementation is touched.

No order placement APIs are imported or called. The panel and all price cells are read-only. Clicking any price cannot place an order.

## Columns (left-to-right)

| Column | Exact source semantics |
| --- | --- |
| PRICE | Trade-price ladder generated from the contract's exchange tick bands, or existing spot tick rules |
| BID | Current passive bid quantity at this level from latest BidAsk snapshot |
| M.SEL | Aggressive sell volume at price in runtime's trailing 300-second **event-time** window |
| Δ | M.BUY minus M.SEL (neutral side does not contribute) |
| M.BUY | Aggressive buy volume at price in the same trailing window |
| ASK | Current passive ask quantity at this level from latest BidAsk snapshot |
| D.BUY | Aggressive buy volume at price **since the runtime was started** |
| D.SEL | Aggressive sell volume at price **since the runtime was started** |

Shioaji tick_type: 1 = buy, 2 = sell, 0 = neutral/unknown. Neutral contributes to neither directional column. BID/ASK are passive depth, not completed trades.

**Critical caveat:** Existing \`TickAggregator.daily\` is a session-named runtime's cumulative volume since its start, **not broker day-to-date backfill**; \`D.BUY\` and \`D.SEL\` must not be interpreted as a full exchange-session total. This is explicitly shown in the UI and tooltips. We do not synthesize undocumented book changes, iceberg or absorption signals.

The moving window expires against the maximum observed **tick event-time watermark**, and therefore does **not** decay merely because local wall-clock time passes without new market events. UI shows its measurement basis.

## Shared runtime and session fidelity

\`\`\`text
Shioaji shared SSE Tick/BidAsk
  -> existing OrderFlowRuntime (one instance per market/symbol/physical source/session)
  -> snapshot with market depth and per-price flow
  -> FlowLadderPanel (batched 50 ms snapshot notifications)
  -> bounded/virtualized price grid
\`\`\`

The panel retains/releases the runtime, subscribes only via \`runtime.subscribe()\`, and does not independently call \`retainQuote()\`, subscribe to raw SSE, or fetch history.

Order Flow Runtime's \`day\` identity now filters non-day ticks and books before aggregating so \`day\` statistics do not contain night events. This is a fix scoped to the extension runtime, not Shioaji's original quote handling.

## Price ladder and rendering

- Price ladder has **at most 481 rows** (±240 increments at the latest price). Near zero it truncates rather than producing negative prices.
- Exchange tick bands are authoritative for derivative instruments with a tick rule. Unavailable bands fail closed; no made-up ladder based on the reference-price tick.
- Exact price-key matching against \`OrderFlowRuntimeSnapshot.levels\`.
- Fixed row height and virtual viewport with ±5 row overscan; only visible rows render, other rows occupy spacer height.
- Auto-follow centers the latest price until manual scroll. Hover pauses recentring to stabilize visual analysis. **回到最新** resumes follow.
- Depth/flow/cumulative bars are normalized to the **visible row maximum** for readability; the numbers are raw and unmodified.
- Stream status (LIVE/STALE/DOWN) is shown; no blank dashboard or false live-state inference.

## Tests and release gate

- Numerical price ladder and variable tick-band boundary stepping.
- Missing-band fail-closed.
- Snapshot mapping BID/ASK, M.BUY/M.SEL, delta, D.BUY/D.SEL and sparse levels.
- Virtual viewport and bounds.
- UI lifecycle, retain/release, symbol/session rerouting, hover/scroll follow, snapshot updates.
- Runtime \`day\` filter for both ticks and books.
- Native panel route regression and no order execution imports.

CI: \`pnpm test\` and \`pnpm run build\`.

## QA limitation

Only frontend/unit tests and CI can be verified in GitHub automation. A compatible Tauri dev shell, live broker SSE/heartbeat, trading-day reset/full-session history, and real browser hover/scroll/virtualization under live high-volume ticks require isolated on-device QA. Do not claim execution, desktop, or brokerage certification on the basis of frontend CI.

- Contract combos are rejected before mounting Flow Ladder because a multi-leg synthetic book is not a single-instrument passive price ladder.
