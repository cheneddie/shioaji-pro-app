# Flow 夜盤即時 Tick 持久化 — 公私兩端整合規格（Draft）

> 本文件屬 **配對開發**：目前公開前端分支 `fix/orderflow-night-live-recorder` 已有保護與讀取端；真正常駐的 Shioaji Sidecar 原始碼位於獨立私有 `shioaji-pro-desktop`，本次 GitHub 連線未授權讀取，因而 **SQLite 寫入服務尚未實作／驗收**。不可將 CI PASS 宣稱為 Sidecar Recorder 完工。

## 問題：2026-10-08 20:05 TW 的夜盤

- `2026-10-08 15:00` 開始的期貨夜盤被歸屬交易日 `2026-10-12`。
- `Shioaji api.ticks(date=2026-10-12, RangeTime=15:00–19:45)` 尚未提供該盤資料時，可能返回 `2026-10-07` 夜盤（`2026-10-08` 交易日）的資料。
- 現有錯交易日驗證必須繼續拒收；不能改查 `date=2026-10-08`、也不能用 K 棒合成逐筆成交。
- `api.ticks()` 是歷史 API，不可作為當前時段的固定輪詢來源。

## 本次公開前端已實作的兩層

1. **歷史查詢保護**：`broker-history-eligibility.ts` 對未完成及未來交易日直接 deferred，不查 `RangeTime`；已完成歷史盤仍可按原有 3 個交易日與 80% 閘門載入。畫面改說「當前盤歷史 Tick 尚未發布」，不將 API fallback 誤判為 SSE 掛掉。
2. **瀏覽器端真實 SSE 保存**：`raw-tick-disk.ts` 僅在 shared SSE owner 對實體商品接收 tick 時，將有效事件以批次寫入 IndexedDB。依 API origin + production/simulation 隔離、按 `physicalCode+TWWallMs` 查詢；全域 bounded queue、最多 8 萬回放、7? **實作實際為 72 小時保存與 24 萬筆全域上限**。前端重整／重開相同 WebView origin 可回放已寫入的資料。

**這兩層不等於常駐錄製**：所有前端視窗關閉時不會收到任何新 Tick，IndexedDB 亦可能被瀏覽器清理；目前不可宣稱完整夜盤已被保存。

## 私有 Sidecar v1 必須完成的介面

### 1. 輕量能力宣告

現有 `GET /api/v1/info` JSON 額外加入：

```json
{
  "orderflow_recorder": {
    "enabled": true,
    "version": 1
  }
}
```

僅在 Sidecar **真正啟動持久化寫入服務**、錄製回放路由可用時宣告 enabled。舊版不宣告；公開前端絕不探測不存在的路由。

### 2. 常駐資料來源

- 重用 Sidecar **現有** Shioaji `quote.set_on_tick_fop_v1_callback` 或等效中央 Tick 回呼，及既有 subscription registry，不新建獨立 Shioaji session / SSE / 行情 pipeline。
- 想在沒開任何 Flow 面板時也錄製，必須由 Sidecar 在**使用者明確設定要錄製的商品集合**（如 `TXFR1` 所映射的實體近月）上維持訂閱。Recorder 與一般面板共用同一 physical contract 訂閱，不能重複建立；若 Sidecar 未登入或未訂閱，必須記錄覆蓋缺口。
- 永遠以原始 **physical_code** 及 `simulation/production` 身分入庫；合約換月時不能把上一個月的 Tick 當本月的。
- Callback 不直接做 SQLite I/O：copy 真實 Tick payload 丟給 bounded queue，單一 writer 批次提交。Queue 滿、DB 寫失敗、Sidecar 重啟、行情斷線均記錄 GAP reason；絕不悄悄覆蓋資料後宣稱完整。
- 不含交易下單／改單權限；不操作正式 Sidecar 的 PID/port。

### 3. SQLite schema（建議）

```sql
PRAGMA journal_mode=WAL;
PRAGMA busy_timeout=3000;

CREATE TABLE IF NOT EXISTS recorded_ticks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  environment TEXT NOT NULL CHECK(environment IN ('simulation','production')),
  physical_code TEXT NOT NULL,
  event_time_ms INTEGER NOT NULL,
  received_at_utc_ms INTEGER NOT NULL,
  capture_session_id TEXT NOT NULL,
  tick_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_recorded_ticks_range
  ON recorded_ticks(environment, physical_code, event_time_ms, id);

CREATE TABLE IF NOT EXISTS capture_gaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  environment TEXT NOT NULL,
  physical_code TEXT NOT NULL,
  from_ms INTEGER NOT NULL,
  to_ms INTEGER NOT NULL,
  reason TEXT NOT NULL,
  capture_session_id TEXT
);
```

`event_time_ms` 按**本 App 現有慣例**：台灣牆上時間的 UTC 編碼毫秒（`Date.UTC(2026,9,8,15,0)` 代表 10/8 台灣 15:00），並非 UTC 實際 epoch。這點務必以跨午夜與時區 golden test 鎖定；`received_at_utc_ms` 才是真實 UTC epoch。

不能以 `(timestamp, price, volume, tick_type)` 做 UNIQUE：約同一毫秒同價同量兩筆真實成交均須保留。查詢結果依 `event_time_ms, id` 排序，保持同毫秒先後與 multiplicity。

### 4. 讀取 API

```http
GET /api/v1/orderflow/ticks/recorded?physical_code=TXFJ6&from_ms=1791471600000&to_ms=1791475200000
```

上例數字僅為**請求格式示意**，正式請由 `Date.UTC()` 即時計算，勿複製作固定日期。

回應 `application/json`：

```json
{
  "schema_version": 1,
  "physical_code": "TXFJ6",
  "mode": "simulation",
  "ticks": [{
    "code": "TXFJ6",
    "date": "2026/10/08",
    "time": "15:00:01.001",
    "open": "27000",
    "high": "27000",
    "low": "27000",
    "close": "27000",
    "volume": 3,
    "total_volume": 3,
    "tick_type": 1,
    "simtrade": false,
    "intraday_odd": false
  }],
  "recorded_from_ms": 1791471601001,
  "recorded_to_ms": 1791471601001,
  "gaps": [
    {"from_ms": 1791471600000, "to_ms": 1791471601000, "reason": "CAPTURE_STARTED_LATE"}
  ],
  "truncated": false
}
```

API 只能查本地真實 Tick；不能向 `api.ticks()` 偷偷 fallback。最大 8 萬筆，超過必須 `truncated=true`；建議支援游標分頁擴展，但本版前端不依賴其分頁。回應的 `mode` 必須匹配 Sidecar 目前登入身分，並依現有 loopback/身份機制拒絕跨實例請求。

`gaps` 是 Sidecar 根據自己的訂閱起訖、掉線、寫入失敗及保留策略記錄的**觀測缺口**。未觀測到不代表交易所零成交。歷史沒有首次錄製之前的可靠資料時必須表達 `CAPTURE_STARTED_LATE`。

### 5. 驗收（隔離 simulation dev Sidecar）

1. 登入 simulation 後錄製指定實體期貨；不開 Flow K 線也會有 SQLite rows 增長，且只有一個實體合約 Tick 訂閱。
2. 切換 Flow 面板／Popout／前端 reload：舊 Tick 透過 API 重新讀回，維持真實同毫秒重複成交數量，不新增 Shioaji quote subscription。
3. 關閉所有前端視窗但保留 Sidecar：前端重開後可讀到關閉期間錄到的 Tick（這是和 IndexedDB 的核心差異）。
4. 手動停 Sidecar 模擬斷線：恢復後 `capture_gaps` 能指出缺口，不假造資料。
5. 10/8 夜盤查詢 `2026-10-12` 的 Shioaji 歷史 API **不應送出**，只使用 Recorder + SSE Live；仍可補載 10/8 完成交易日。
6. 80% Usage 閘門不影響已接收 Tick 與 Recorder 本地讀取；只控制額外 Shioaji 歷史查詢。
7. 在隔離 Dev 環境用 mock 測錯商品、跨 mode、wrong-date、truncation、Quota 達標、歷史 API 未更新；禁止為了測試 80% 刻意消耗實際額度。
8. 使用者正式服務與 dev Sidecar PID、port、訂閱身分必須明確分離，不動正式交易與委託。

## 部署／配對 PR

- 此公開前端改動目前只提交至 Draft PR #16，base 為 `fix/orderflow-visible-range-bubbles`（PR #15）。
- 私有 `shioaji-pro-desktop` 必須另建 worktree 與 Draft PR，實作 SQLite Recorder、訂閱所有權及 HTTP route，於私有 CI + 公私合成 CI 驗證。
- 兩側有相容、可重現的 SHA 且隔離 Sidecar QA 過關前，不得把前端的相容 client 視為 Recorder 完成，也不修改 `DESKTOP_MODULES_REF` 或合併 main/baseline。
