# Order Flow Extension Isolation Contract

This contract is the mandatory boundary for the staged Order Flow extension.

## 1. Protected native product behavior

The following native Shioaji Pro panels are protected and their existing behavior must remain unchanged:

- `chart` → native `CandleChart`
- `flash` → native flash-order execution path
- `volprofile` → native `VolProfile`
- `depth` → native `DepthLadder`
- `tape` → native `TickTape`

The Order Flow project must not turn these panels into wrappers around new Order Flow components and must not silently change their data sources, storage, execution, rendering, subscriptions, or interaction semantics.

## 2. Extension ownership

All substantive new Order Flow implementation must live under:

`src/features/orderflow/`

Planned independent panels:

- `orderflow_kline` — Order Flow candlestick chart; owns Order Flow Bubble and range Volume Profile drawing.
- `footprint` — independent Footprint /成交足跡 panel.
- `flowladder` — independent analytical Order Flow price ladder.

These are analysis panels. They must not send live orders in their first implementation.

## 3. Allowed edits to existing files

Existing production files may only receive the smallest additive integration needed for the extension.

Expected allowed integration points:

- `src/lib/workspace.ts`: additive future BlockType / BLOCK_META entries and backward-compatible optional panel state.
- `src/App.tsx`: additive imports and switch cases for new panel types.
- `src/components/panel-library.tsx`: additive icon/preview metadata only if required.
- `src/components/panel-preview-live.tsx`: additive preview registration only if safe and explicitly chosen.
- `src/lib/stream.ts`: additive raw-event listener/export needed by the shared Order Flow runtime, without changing the existing quote store semantics.
- `src/lib/types/market.ts`: additive types only when required; existing wire field meaning must not change.

Any broader modification requires an explicit architecture review before implementation.

## 4. Forbidden native refactors

Unless a later reviewed architecture blocker proves unavoidable, the project must not modify the implementation behavior of:

- `src/components/candle-chart.tsx`
- `src/components/flash-order.tsx`
- `src/components/vol-profile.tsx`
- `src/components/depth-ladder.tsx`
- `src/components/tick-tape.tsx`
- native indicator computation/registry behavior
- native chart drawing behavior

Do not refactor native code merely to make the Order Flow extension easier.

## 5. Shared market-data contract

All new Order Flow panels for the same canonical market identity must share one Order Flow runtime.

The runtime identity must include at least:

- market
- symbol
- session

Odd-lot or another independently matched market must use a distinct identity when applicable.

The extension must:

- reuse the existing shared Shioaji stream;
- avoid duplicate SSE connections;
- avoid one identical market subscription per panel;
- process raw events losslessly before UI throttling;
- allow UI notifications to be batched independently from aggregation;
- use retain/release ownership so the last consumer tears down extension listeners/resources.

## 6. Source-of-truth and event semantics

For the first implementation:

- Shioaji `tick_type=1` is active buy.
- Shioaji `tick_type=2` is active sell.
- Shioaji `tick_type=0` is neutral/unknown.
- The extension must preserve buy, sell, and neutral separately.
- It must not override authoritative `tick_type` with price-direction guessing.
- Simulated auction/trial events must preserve their `simtrade` identity.
- Regular and intraday odd-lot streams must not be mixed.

Any alternative classification logic requires a separate documented contract and tests.

## 7. Persistence isolation

Order Flow-specific persistence must use the namespace:

`sj-pro-orderflow-*`

The extension must not reuse or mutate existing native indicator/drawing storage keys.

Specifically, Order Flow Bubble and Order Flow Volume Profile drawings must not write into native `CandleChart` indicator/drawing persistence.

Workspace-level optional fields may be added later only if:

- old workspace JSON remains loadable;
- missing new fields have safe defaults;
- old profiles remain valid;
- regression tests cover the compatibility.

## 8. No execution coupling

`flowladder`, `footprint`, and `orderflow_kline` are analytical panels in the staged implementation.

They must not call native order-placement functions in the initial project.

Native `FlashOrder` remains the execution-focused DOM. Any future click-to-trade feature in an Order Flow panel is a separate reviewed development phase and is not implied by this project.

## 9. Testing rules

Every development phase must run:

- `pnpm test`
- `pnpm run build`

Do not delete, skip, weaken, or rewrite unrelated tests to make a phase pass.

Native regression coverage must continue protecting:

- `chart -> CandleChart`
- `flash -> LiveFlashOrder/FlashOrder path`
- `volprofile -> VolProfile`
- `depth -> DepthLadder`
- `tape -> TickTape`

Feature tests must distinguish:

- raw event correctness;
- aggregation correctness;
- renderer correctness;
- workspace lifecycle;
- subscription/reference ownership;
- reconnect and symbol/session isolation.

## 10. Development discipline

- Do not skip stages.
- Do not implement future-stage functionality early.
- Report an architecture blocker before changing this contract.
- Do not upgrade dependencies unless the active stage explicitly requires it.
- Avoid unrelated formatting.
- Each development stage should be independently reviewable and committed.
- After the active stage passes its gate, stop.

Development 0 itself is baseline/documentation/regression-only. It must not register `orderflow_kline`, `footprint`, or `flowladder`.
