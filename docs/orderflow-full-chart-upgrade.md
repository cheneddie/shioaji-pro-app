# Flow K 線完整交易圖表 — 獨立驗收分支

## Baseline / source of truth

- Repository: `cheneddie/shioaji-pro-app`
- Dev8 branch: `feat/orderflow-dev8-integration` at `c3b3faad1f797b025ac44127f72f508ed4aa275b`.
- Inherited Dev8.1 work: `feat/orderflow-unified-chart-tools` at `1c287deef28adfec7d306a800504c68466632006` (PR #11). This branch is a descendant of Dev8. The current independent follow-up branch begins from this verified implementation, without duplicating the native chart or brokerage order pathway.
- Working branch: `feat/orderflow-complete-trading-chart`.

## Why the Flow panel uses the native chart engine

`OrderFlowWorkspacePanel` passes an optional `CandleChartExtension` to the existing native chart. All chart-order account checks, confirmation, execution, trigger management, plot indicators, and drawing tools remain in `CandleChart` rather than being reimplemented in Order Flow. The original `chart` route supplies no extension.

Bubble is offered through `IndicatorDialog.extraIndicator`, with parameters stored in `sj-pro-orderflow-kline-{panelId}`. The native main chart retains the original indicator picker.

Flow-only Volume Profile drawing remains on the Flow overlay and the view switch is limited to `Flow K 線` and `Footprint`.

## Isolation hardening on this branch

1. **Native technical indicators:** Flow passes a controlled list of native `IndicatorInstance` objects using `extension.indicatorInstances`. It persists to `sj-pro-orderflow-indicators-{panelId}` instead of saving to `sj-pro-indicators-v2` or the native `chart` block indicator service. Native indicator computations and visual behavior are retained.
2. **Drawing identity:** Native chart drawings stay keyed by their original contract/symbol. The Flow chart supplies a unique `ORDERFLOW:{panelId}:{drawingSymbolKey}` key to the validated native hook so drawing objects cannot appear in the ordinary chart under the same symbol. The Flow drawing-setting values are independently stored in `sj-pro-orderflow-drawing-settings-{panelId}` rather than writing `sj-pro-chart-drawing-settings`.
3. **Order defaults:** Pressing the native `設為預設` button in a Flow chart writes `sj-pro-orderflow-order-defaults-{panelId}`; it never writes `sj-pro-chart-order-defaults`. The standard account availability check and order confirmation are not changed.
4. **Stock lot preference:** The Flow lot/unit preference uses `sj-pro-orderflow-lot-{panelId}-{symbol}`; it does not write `sj-pro-order-lot-preferences`.
5. **Existing routing:** Original `chart`, `flash`, `volprofile`, `depth`, `tape` components keep their render routing and native non-extension logic.

## Open architecture risk — do not overstate isolation

The original `chart-drawings.ts` library has **one process-wide shared drawing store** and currently persists its symbol-keyed object collection in `sj-pro-chart-drawings`. The Flow-scoped **symbol keys** isolate drawing *identity and visibility* from native chart drawings, but the lowest-level persisted drawing collection is still the native storage envelope.

That is **not byte-level storage separation**. A stricter requirement that the native `sj-pro-chart-drawings` localStorage value not change at all when using Flow drawing tools requires extracting a namespaced drawing store factory / storage adapter while preserving the native journal, revision, tombstone and cross-window merge algorithms. This is a separate high-risk refactor; do not claim completed until tested across multiple tabs.

Also verify native global favorites and optional indicator type-default operations in Flow are non-mutating or explicitly split into Flow-scoped keys before final acceptance.

## Required Gate

- `pnpm run build` (TypeScript + Vite) success.
- `pnpm test` full unit/regression pass.
- Chart trading + drawing mode mutual-exclusion tests pass, including Flow VP.
- Protected native `chart` routing, indicators and broker account-selection behavior unchanged.
- Verify saved Flow settings across reload + two simultaneous Flow panels and against native chart state.
- No live orders in automated tests. Manual paper/broker UI acceptance remains necessary.

**Gate policy:** red or incomplete tests means the branch is **NOT COMPLETE**. In particular, the drawing storage-envelope risk above blocks any claim of full strict storage isolation.
