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

## Drawing persistence partition

`chart-drawings.ts` continues to own the validated native drawing revision, history,
journal and tombstone logic. It now partitions records by the scoped symbol prefix
`ORDERFLOW:` at the final persistence boundary:

- Native objects: `sj-pro-chart-drawings`
- Flow objects: `sj-pro-orderflow-chart-drawings`
- Native tombstones: `sj-pro-chart-drawing-tombstones`
- Flow tombstones: `sj-pro-orderflow-chart-drawing-tombstones`
- Flow-only write-ahead journal: `sj-pro-orderflow-chart-drawings-pending:*`

The loader merges these stores for internal revision/history operations, but Flow
records are not written into native drawing keys on a new write. Legacy Flow objects
written into the native envelope by the previous Dev8.1 version remain readable,
and are migrated when the drawing store next persists.

**Residual gates:** verify simultaneous Flow/native drawing edits across two
windows, journal reconciliation after abrupt close, and migration from legacy
pre-partition Flow data. Automated in-repository unit tests are necessary but do
not substitute for multiwindow/browser tests. Flow drawing identity is per panel,
and Flow UI settings/preferences are separate from native settings.

## Indicator settings partition

- Native chart retains `sj-pro-indicators-v2`, `sj-pro-ind-defaults-v1`,
  and native favorites.
- Flow panel-specific instances: `sj-pro-orderflow-indicators-{panelId}`.
- Flow indicator saved type defaults: `sj-pro-orderflow-ind-defaults-{panelId}`.
- Flow favorites: `sj-pro-orderflow-ind-favorites-{panelId}`.
- Flow Bubble: `sj-pro-orderflow-kline-{panelId}`.

## Required Gate

- `pnpm run build` (TypeScript + Vite) success.
- `pnpm test` full unit/regression pass.
- Chart trading + drawing mode mutual-exclusion tests pass, including Flow VP.
- Protected native `chart` routing, indicators and broker account-selection behavior unchanged.
- Verify saved Flow settings across reload + two simultaneous Flow panels and against native chart state.
- No live orders in automated tests. Manual paper/broker UI acceptance remains necessary.

**Gate policy:** red or incomplete tests means the branch is **NOT COMPLETE**. Passing automated tests verifies code contracts; live account/desktop and two-window recovery still require explicit sign-off.
