# Development 9 — Order Flow hardening and release acceptance

> Scope decision: Dev0–Dev8 plan originally stopped at Dev8. A formal Dev9
> specification was not present in the repository. This document defines
> Dev9 as the user's requested final verification and hardening follow-up,
> **not** a previously approved or completed release phase.

## Baseline and PR dependency

- Baseline: `feat/orderflow-complete-trading-chart` (PR #12), built on
  `feat/orderflow-unified-chart-tools` (PR #11), in turn built on Dev8
  (PR #10). Earlier Dev0–Dev7 changes are a stacked PR chain.
- Dev9 branch: `feat/orderflow-dev9-release-gates`. Base PR on PR #12's
  branch; never open it directly against `main` until the chain is merged
  in order. Do not change protected native trading behavior or merge/tag
  before all release gates are met.

## Focused defects resolved in Dev9

1. **Transient tick-history outage recovery.** Preserve in-flight request
   coalescing for Bubble, Footprint and range VP, but evict a rejected
   `fetchOrderFlowHistory` Promise so an identical market/date/revision
   can retry after broker/network recovery. Retain successful bounded
   cache entries.
2. **Runtime history health under overlapping requests.** Different
   historical dates can be required by multiple overlay consumers;
   only the latest issued request is permitted to settle the displayed
   `health.history` status. Earlier completions still resolve to their
   own callers but cannot overwrite a newer status.
3. **Footprint localStorage denial.** Quota/security exceptions when
   persisting chart preferences must not crash a connected Footprint
   panel; in-memory controls remain usable.
4. **Popout coverage and isolation.** The Popout type list previously
   allowed `footprint` without a PopoutView switch case, resulting in
   a placeholder. Render the actual Footprint panel. Scope Flow Kline,
   Footprint and Flow Ladder popout preference panel IDs by contract
   code and use a symbol key to reset component-local state when a
   popout's instrument changes.

## Machine-verifiable release gates

| Gate | Expected evidence |
| --- | --- |
| TypeScript + Vite | `pnpm run build` PASS |
| Entire test suite | `pnpm test` PASS; report exact passed/skipped counts |
| Shared raw listener ownership | 3 same-identity consumer leases -> one Tick listener, one BidAsk listener; release only with last consumer |
| Duplicate/replay correctness | same tick after reconnect counted/published once; neutral still separate |
| Rolling volume | 10k/50k/100k synthetic events spanning 300s, verify inclusive moving cutoff and buy/sell/neutral conservation |
| Historical coalescing/recovery | concurrent same-key fetch shares one request; rejected request is not permanently cached |
| History status race | later date's ready/error state not overwritten by an older request resolving late |
| Storage failure | Footprint remains mounted and runtime released when localStorage setItem throws |
| Popout coverage | Flow Kline/Footprint/Flow Ladder each have a real popout route and per-symbol panel ID |
| Native isolation | native `chart` has no Flow extension prop; flash/depth/tape/volprofile routes and trade safety tests pass |

## Mandatory manual/desktop acceptance (not certifiable by CI alone)

The following gates remain **NOT VERIFIED** unless a dated, reproducible
run record (screenshots/logs/build SHA) proves each one:

- Open an isolated dev App and a separately isolated development sidecar,
  with exact process/port inventory before and after. If a production
  sidecar exists, use `VITE_DEV_SERVER_PORT=21323` and matching
  Vite same-origin SSE proxy; **never** probe or take over production
  `21322` or `8080` ports. Confirm frontend build identity and a new
  SSE heartbeat. No real order submission as a QA technique.
- Open five original + three Order Flow panels together. Confirm one
  market-data subscription per shared runtime identity (per process),
  no duplicate on mode toggle, cleanup on final unmount.
- Native chart drawing/indicators + Bubble + range VP on one Flow Kline:
  1m/5m/15m/60m/1D, compression/expansion, auto-scroll, time/price scale,
  trading mode and drawing mode mutual exclusion, panel and symbol changes,
  VP anchor/edge dragging, chart quantity/account settings and simulated
  alert/stop/take flow. Verify the native `chart` is unaffected.
- Footprint visual comparison with the user's original reference screenshot
  (requires access to image pixels, not only its URL) and printed market
  snapshots: Bid×Ask, Delta, POC, Delta POC, imbalance, low-LOD.
- Two-window persistence and drawing journal recovery, abrupt close/reopen,
  interleaved writes, legacy Flow drawing migration, quota-full handling.
- 100 repeated chart mounts/unmounts, live reconnect/replay, session boundary
  and futures front-month symbol rollover.
- A one-hour browser-heap and CPU soak, including 100k-tick replay, with
  baseline/peak/end heap and render latency. No performance pass without
  measured metrics.

## Release disposition

**A passing CI run does not mean Dev9 is production ready.** Dev9 can be
declared **automated gate complete** with the above evidence but remains
**manual QA pending** until the desktop/live-data items have been
reproducibly checked. Keep PRs draft and do not merge into main, create
release tags, or place any real trades during automated testing.
