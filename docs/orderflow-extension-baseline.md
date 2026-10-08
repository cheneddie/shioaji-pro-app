# Order Flow Extension — Development 0 Baseline

> Scope: baseline only. No Order Flow feature implementation is introduced by Development 0.

## Repository baseline

- Repository: `cheneddie/shioaji-pro-app`
- Baseline branch: `main`
- Baseline commit: `7d425b6659e5c628444f9c3fbc2aaa9a9295035d`
- Upstream: `Sinotrade/shioaji-pro-app`
- Package manager used by CI: pnpm 10
- CI Node.js: 22
- Build command: `pnpm run build` (`tsc -b && vite build`)
- Test command: `pnpm test` (`vitest run`)

Relevant frontend versions at the baseline commit:

- React: `^19.2.4`
- React DOM: `^19.2.4`
- TypeScript: `~5.9.3`
- Vite: `^8.0.1`
- Vitest: `^4.1.10`
- lightweight-charts: `^5.2.0`
- react-grid-layout: `^2.2.3`

No dependency upgrades are part of the Order Flow extension plan.

## Native panel baseline

The existing workspace panel model is defined in `src/lib/workspace.ts` through `BlockType`, `Block`, `Workspace`, and `BLOCK_META`.

The five protected native panels for this extension are:

| BlockType | Native implementation | Role |
| --- | --- | --- |
| `chart` | `src/components/candle-chart.tsx` / `CandleChart` | Native candlestick chart, indicators, drawings, chart trading |
| `flash` | `src/components/flash-order.tsx` / `FlashOrder` (mounted through `LiveFlashOrder`) | Native flash-order DOM and execution |
| `volprofile` | `src/components/vol-profile.tsx` / `VolProfile` | Native session price-volume profile |
| `depth` | `src/components/depth-ladder.tsx` / `DepthLadder` | Native market depth |
| `tape` | `src/components/tick-tape.tsx` / `TickTape` | Native trade tape |

Production panel routing is centralized in `BlockBody()` inside `src/App.tsx`. Development 0 adds a regression guard that protects the above `BlockType -> component` routing without modifying `BlockBody()`.

## Workspace and panel library flow

`src/lib/workspace.ts`
→ `BlockType`
→ `BLOCK_META`
→ `src/components/panel-library.tsx`
→ `ALL_TYPES = Object.keys(BLOCK_META)`
→ workspace adds a block
→ `src/App.tsx::BlockBody()`
→ native panel component.

The panel library therefore discovers registered block types from `BLOCK_META`. Future Order Flow panels should be additive block registrations rather than changes to native block definitions.

Live panel previews are separately whitelisted in `src/components/panel-preview-live.tsx`. Native `chart`, `depth`, `tape`, and `volprofile` previews mount their existing components. The `flash` panel is intentionally not in the live-preview whitelist.

## Workspace persistence baseline

Workspace persistence currently lives in `src/lib/workspace.ts`.

Existing keys:

- `sj-pro-workspace-v3`
- legacy fallback `sj-pro-workspace-v2`
- `sj-pro-profiles-v2`
- legacy fallback `sj-pro-profiles-v1`

Future Order Flow state must not alter the meaning of these existing keys. Order Flow-specific browser persistence must use an isolated `sj-pro-orderflow-*` namespace unless panel-local state is deliberately stored as an additive workspace field with backward-compatible parsing.

## Market-data flow baseline

The live quote path is centered in `src/lib/stream.ts`.

Current flow:

```text
shared SSE stream
  ├─ tick event
  │   └─ handleTick()
  │       ├─ regular: ingestTick()
  │       └─ intraday odd lot: ingestOddTick()
  └─ bidask event
      └─ handleBidAsk()
          ├─ regular: ingestBidAsk()
          └─ intraday odd lot: odd quote store

quotes / oddQuotes module stores
  └─ emitQuote()
      └─ React-facing subscribers are notified in a 50 ms batch
```

Important baseline behavior:

- The SSE connection is shared; Order Flow must not create a second market stream.
- Quote state is updated for every event.
- React-facing quote notifications are intentionally batched every 50 ms.
- Real regular-lot trades are additionally delivered to `tickTapeListeners` only when `!simtrade && volume > 0`.
- Intraday odd-lot quotes are isolated in a separate store and are not mixed into the regular tape.
- Continuous-contract aliases are applied during tick and bid/ask ingestion.

Development 1 may add an additive raw bid/ask listener API, but must preserve all existing state update and notification behavior.

## Native indicator architecture baseline

Native indicator definitions live in `src/lib/indicator-defs.ts`.

An `IndicatorDef` is candle-driven:

```text
Candle[] + numeric params
  → compute()
  → IndicatorPoint[] outputs
  → CandleChart rendering
```

The existing native indicator registry and its persistence belong to `CandleChart`. The planned Order Flow Bubble must not be injected into this native registry; it will belong to the new `orderflow_kline` implementation.

## Native drawing architecture baseline

Native chart drawings live in `src/lib/chart-drawings.ts` and are consumed by the native candle chart drawing hook/UI.

Existing principles include:

- anchors stored as time + price, not bar index;
- drawings persisted per symbol;
- cross-window synchronization via browser storage;
- native tool registry includes line, shape, Fibonacci, text, and measure tools.

The planned Order Flow Volume Profile drawing must not extend the native `CandleChart` drawing registry. It will use an isolated drawing implementation owned by `orderflow_kline`.

## Planned extension boundary

Development 0 reserves the following future block identities only as architecture names; it does **not** register them yet:

- `orderflow_kline`
- `footprint`
- `flowladder`

All new implementation code is planned under:

`src/features/orderflow/`

No Order Flow implementation exists at Development 0.
