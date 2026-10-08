# Order Flow Extension — Development 8 integration and carryover fixes

## Source / branch safety

- Base: `feat/orderflow-dev7-flow-ladder`, HEAD `961523f0ce5ee05c8510f96ca19457590ac1c770`.
- New branch: `feat/orderflow-dev8-integration`.
- The preceding Dev0–Dev7 PRs are **stacked/open**, and `main` remains
  at `7d425b6659e5c628444f9c3fbc2aaa9a9295035d`.
- Do not open this stage against `main` until the preceding PR chain has
  been reviewed/merged or intentionally rebased.
- All old native panel switch cases stay unmodified.

## Development 8 changes

### 1. Bubble radius / zoom continuity

Before: width inferred from gaps between **sparse bubble-bearing candle
coordinates**, then clamped to a fixed 8px minimum and 40px maximum. This
created nearly uniform bubbles while zoomed out and size jumps on zoom.

Now: take the exact `chart.timeScale().options().barSpacing` and calculate
a bounded screen-space radius proportional to that candle slot. Preserve
sqrt(volume / reference) and user scale. Clamp the minimum radius to a
fraction of the maximum when compressed, so small trades remain distinct.

Acceptance: monotonic smooth growth on repeated changes of candle spacing;
stable relative volume encoding within the same scale reference. Volume
ratio may still update in `visible` scale mode if the reference maximum
enters/leaves the visible window; this is intentional and separately
described by the selected `scaleMode`.

### 2. Flow Ladder / flash-style read-only quote ladder

Refit the **new** `flowladder` rows around a central PRICE spine:
`D.SEL / M.SEL / BID / PRICE / ASK / M.BUY / D.BUY / Δ`.

The source is still the shared `OrderFlowRuntime`, not the FlashOrder
component's account/order execution runtime. BID and ASK denote live
five-level passive book size; M is a 300-second moving trade aggregate;
D is Runtime-lifetime cumulative volume, not full-session backfill.

Never mount native `FlashOrder` here or copy order command handlers.
The visual layout is modeled after the native price ladder, but
the Order Flow ladder remains strictly read-only.

### 3. Bid × Ask Footprint readability

In the new Footprint canvas, each detailed traded price row now shows:
- left half: sell-at-bid heat, sell volume
- right half: buy-at-ask heat, buy volume
- a center divider, candle price envelope, optional POC, delta POC,
  diagonal and horizontal imbalance markers
- a per-bar time label and price-level-derived Delta summary

Low-resolution LOD continues using heatmap or candle summary to avoid
overdraw and illegible values. The EBC image link supplied by the user
could not be fetched in this execution environment; exact styling
matching of that specific screenshot is not yet verified.

### 4. Flow K line ↔ native full chart ↔ Footprint

The new `orderflow_kline` block receives an independent view switcher:
- `Flow K 線`: existing Order Flow K line with Bubble/VP.
- `完整 K 線`: reuse the entire unmodified Shioaji `CandleChart`
  and `QuoteBoard` (all existing chart features and native trading
  controls).
- `Footprint`: embed the existing independent Footprint component.

Mode is stored under `sj-pro-orderflow-view-<panelId>`. Native mode is
explicitly labeled as including trading actions. This is an **opt-in
composition**, not a claim that original CandleChart indicators and
Order Flow Bubble can run simultaneously on a single chart API. Such
deep merging is prohibited by the existing isolation contract.

## Verification gates

Automation:
- `pnpm test` (including new view isolation and bubble sizing tests).
- `pnpm run build`.
- Keep existing native regression guard and all Dev0–Dev7 tests passing.

Manual/live gates that cannot be certified by static CI:
- Three independent new panels plus all native panels opened together.
- Real-market or replay audit of historical/live volume, bid/ask semantics,
  symbol/session changes, reconnect, no double counting.
- Bubble scroll/zoom both axes at multiple bar spacings and candidate
  densities; side volume differences remain legible.
- Footprint appearance against the **actual user-supplied screenshot**.
- Native `完整 K 線` mode confirms all native tools and order risk guards.
- Repeated 100x mount/unmount check for listener/resource leaks.
- 10k/50k/100k tick stress for listener count, memory and UI frame budget.

**Do not claim those live/manual/performance gates passed without
execution evidence.** If they cannot be completed, treat Development 8
as code-complete/CI-verified at most, not production ready.
