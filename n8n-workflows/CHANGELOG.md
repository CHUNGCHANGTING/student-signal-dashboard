# 正EV履約價推播系統 — Changelog

## v3.4 (2026-04-06) — 9 項優化完成

### 🔴 高優先修正 (P0)

1. **財報日曆檢查**
   - 使用 Finnhub API 查詢個股財報日期
   - 財報前 2 天自動排除該標的，避免 IV crush 風險
   - 節點：`checkEarningsBlackout(symbol)`

2. **支撐壓力與履約價對齊**
   - PCS 賣腿（short put）自動貼近技術支撐位
   - CCS 賣腿（short call）自動貼近技術壓力位
   - 使用 20 日高低點 + 成交量加權計算支撐/壓力
   - 節點：`alignStrikeToSupportResistance()`

3. **Vega 正/負效益判斷**
   - 賣方策略（PCS/CCS/IC）確認 Vega 為負效益（做空波動率）
   - 買方策略（Debit Spread）確認 Vega 為正效益（做多波動率）
   - IVR 偏高 + 賣方 = Vega 有利；IVR 偏低 + 買方 = Vega 有利
   - 節點：`checkVegaAlignment(strategy, ivr)`

### 🟡 中優先修正 (P1)

4. **成交量爆量確認**
   - 支撐位附近成交量需 > 20 日均量 1.2 倍
   - 確認支撐有效性，避免假突破
   - 節點：`confirmVolumeAtSupport()`

5. **同產業不超過 2 檔**
   - 內建 symbol → sector 對照表（Technology, Healthcare, Finance 等）
   - 同 sector 最多推薦 2 檔，避免集中風險
   - 節點：`enforceSectorLimit(signals)`

6. **Theta 衰減速度評估**
   - 計算 Theta/Price 比率，衡量時間價值衰減效率
   - Credit spread: Theta/Price > 0.02 為佳
   - Debit spread: Theta/Price < 0.03 為佳（衰減不宜太快）
   - 節點：`evaluateThetaDecay()`

7. **最大同時推薦數限制**
   - 每次推播最多 5 檔信號
   - 依 EV 分數排序，取 Top 5
   - 節點：`limitMaxSignals(signals, 5)`

### ⚪ 低優先修正 (P2)

8. **盤前/盤後資料區分**
   - 自動偵測 UTC 時間判斷美股盤中/盤前/盤後
   - 盤前：使用前一日收盤價 + 預估值
   - 盤中：使用即時 CBOE 延遲報價（15-20 分鐘）
   - 盤後：使用收盤確認價
   - 節點：`getMarketSession()` → `pre_market` | `market_hours` | `after_hours`

9. **歷史勝率追蹤（Google Sheet）**
   - 每次推播自動寫入 Google Sheet（signal_tracking 表）
   - 記錄：tracking_id, symbol, strategy, entry_credit, max_profit, max_loss, expiry
   - 每日盤後自動結算 WIN/LOSS（Yahoo Finance 到期價格）
   - 每週一自動產生勝率報告推送 LINE/Telegram

### ❌ 未實作

10. **DXLink WebSocket 即時串流**
    - 需要 tastytrade DXLink streaming API
    - 目前使用 CBOE 延遲報價（15-20 分鐘）替代
    - 列為未來升級項目

---

## v3.3 (2026-04-05) — VIX + SPY 市場狀態濾層

- VIX ≥ 35 → 暫停所有信號
- VIX ≥ 25 + SPY 趨勢偏空 → 僅允許看跌策略
- VIX ≥ 20 → 標記 caution，信號照出但附警示
- SPY 方向評分整合 RSI + MACD + MA20

## v3.2 (2026-04-05) — Notion 規則完整對齊

- PCS/CCS Delta 分離：PCS 0.20-0.25, CCS 0.10-0.20
- IVP 過濾器（Debit 專用）：20%-50%
- Stop Loss 修正：Credit × 1.3, Debit × 0.7, IC × 2.0
- RSI 趨勢跟隨邏輯（< 50 偏空，非超賣反彈）
- MACD 方向確認加入

## v3.1 (2026-04-04) — Notion 審計修正

- RSI 邏輯修正（趨勢跟隨）
- Stop Loss 公式修正
- MACD 方向確認
- IVR/IVP 門檻分策略設定

## v3.0 (2026-04-04) — CBOE + 方向評分引擎

- CBOE delayed quotes 取代 tastytrade streaming
- 完整 Greeks 取得（Delta, Gamma, Theta, Vega）
- 方向評分引擎：RSI + MACD + MA20
- Delta-based 履約價自動選擇

## v2.0 (2026-04-03) — 三大致命問題修正

- Iron Condor 結構邏輯修正（4 腿正確組合）
- Credit 估算 fallback 公式修正
- 流動性過濾門檻（OI ≥ 100, Volume ≥ 50, Spread ≤ 20%）

## v1.0 (Initial) — 原始版本

- 84% 使用 fallback credit 估算
- IC 結構錯誤
- 無流動性過濾
- 無方向判斷
