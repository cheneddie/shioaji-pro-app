# Flow 氣泡可視區間補載 — 驗收紀錄與操作清單

## Branch / scope
- Worktree base: `a28971cf8f41748c770b3085a9606468612c8185` (local merge of PR #14).
- Branch: `fix/orderflow-visible-range-bubbles`; PR #15 is **draft** until an isolated Shioaji simulation sidecar is visually verified.
- No real orders, no changes to production sidecar, no merge into baseline.
- Historical Tick is **not** a real-time feed: retained SSE + memory replay stay responsible for live bubbles.

## Implementation constraints
1. Only `1m/5m/15m/60m` query historical Ticks, selected from the visible Kbar time range; 1D renders an explicit unsupported status.
2. Up to the latest three **exchange trading dates**; a wider visible range has a disclosed omission count.
3. A trading date is split into at most two `RangeTime` slices: previous trading day night (15:00–23:59:59) and the post-midnight through day close (00:00–13:45). The latter may span nontrading calendar days across a long holiday; only the intersecting wall-clock interval is sent.
4. The exchange calendar is authoritative only for 2026; unsupported futures/option years fail closed.
5. The shared coordinator owns Web Locks + cross-window minimum 2-second spacing and checks `GET /api/v1/auth/usage` **before and after** every historical Tick request. At or above 80%, or if usage is unknown, no further historical Tick request is sent.
6. Historical responses are checked for typed, aligned column lengths; every retained Tick must have a valid timestamp, price, volume, type, requested trading date and requested slice interval. An empty, truncated or partly invalid response is not marked complete.
7. Stored replay comes exclusively from received physical-code SSE Ticks; owner-to-popout communication uses bounded BroadcastChannel chunks. No second SSE stream, quote subscription, polling loop or synthetic Kbar flow is introduced.

## CI evidence (run latest branch HEAD before acceptance)
```powershell
git fetch cheneddie
git switch fix/orderflow-visible-range-bubbles
git pull --ff-only cheneddie fix/orderflow-visible-range-bubbles
pnpm install --frozen-lockfile
pnpm exec tsc -b
pnpm test
pnpm run build
git diff --check
```

## Manual isolated simulation QA — still required
**Never launch against a production trading sidecar.** Start an isolated simulation sidecar on a separately selected port according to this repo's dev setup, confirm its server/mode identity, then run this build against **that exact port**. Do not submit a real order.

1. Check the displayed build commit against `git rev-parse HEAD`, and confirm no console errors.
2. Confirm a single shared SSE owner reports LIVE and fresh heartbeat.
3. Main window subscribes to TXFR1; allow physical target ticks to arrive. Then open a popout with the same contract. Confirm popout bubbles cover already observed owner ticks, no duplicate alias volume, and no extra EventSource.
4. On the 5m **All** view, compare visible bars for 2026-10-08 day and the subsequent night assigned to 2026-10-12. Confirm two distinct historical Tick request dates, no 2026-10-09 holiday requests.
5. Simulate `date=2026-10-12` returning only Oct 8 **day** Ticks; the requested 10/12 history must show DATA GAP, never fabricated completed bubbles. Actual Oct 8 **night** events are valid for trading date 10/12.
6. Scroll/zoom inside an already cached interval: no further `/data/ticks` calls. Move to an uncovered interval: load newest three trading dates, at most two slices per date. Confirm old viewport promises cannot overwrite new instrument or mode.
7. Zoom out past three trading dates: the omission notice is visible and no requests are made for older dates.
8. 1D mode: no historical Tick request and no partial bubble rendering.
9. Force the **mock** Usage response to 79%, then 80% after one slice: next historical Tick call must be blocked, but cached/replayed/live bubbles must remain visible. Also test usage endpoint failure and unknown/zero limit fail-closed. **Do not consume actual quota to test this.**
10. Exercise cumulative/single/charge, buy/sell/all filters, min/max volume, price/time axes, tooltip, day/all transitions, Footprint and Order Flow VP, and the existing unrelated native panels.

## Known honest limits
- Memory replay is never a replacement for a broker historical Tick source. Windows closed, unsubscribed contracts, late owner startup, truncated buffers and API fallback can all create gaps.
- A completed broker slice verifies only the returned Tick payload and trading date; it cannot mathematically prove that every real-world execution is present.
- No authenticated simulation-sidecar/browser validation is recorded from a GitHub-only session. CI passes do not prove that manual QA passed.
