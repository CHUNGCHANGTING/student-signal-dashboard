# 下班鴿 Options Strategy Engine

[![WF-06 E2E Tests](https://github.com/CHUNGCHANGTING/student-signal-dashboard/actions/workflows/wf06-e2e.yml/badge.svg)](https://github.com/CHUNGCHANGTING/student-signal-dashboard/actions/workflows/wf06-e2e.yml)

正EV 選擇權策略引擎 — 從信號推播到一鍵下單的完整自動化系統。

## 系統架構

```
┌─────────────────────────────────────────────────────────────┐
│                    v3.4 正EV推播引擎（21層過濾）                │
│  Yahoo Finance → tastytrade → CBOE → Finnhub                │
│  ↓                                                           │
│  LINE / Telegram / Dashboard 推播                             │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│              Student Dashboard (4 關流程)                     │
│                                                              │
│  第1關 盤前訊號 → 第2關 TOS試算 → 第3關 部位確認 → 第4關 送單  │
│                                                              │
│  ┌──────────────────────────────────────────────┐            │
│  │ 多券商下單 (WF-06)                             │            │
│  │  ├── tastytrade  OTOCO/OTO/Simple             │            │
│  │  ├── Schwab      BRACKET/OTO/Simple           │            │
│  │  └── IBKR        Bracket (auto conid resolve) │            │
│  └──────────────────────────────────────────────┘            │
│                                                              │
│  即時持倉 Dashboard ←→ WF-08 持倉同步                         │
│  🟢 平倉按鈕 → WF-07 平倉執行                                 │
│  📊 訂單監控 → WF-09 Filled/Rejected 告警                     │
└──────────────────────────────────────────────────────────────┘
```

## n8n Workflows

| ID | 名稱 | 端點 | 狀態 |
|---|---|---|---|
| `94K8VLorR9VVxgd3` | 【正EV履約價推播】v3.4 | Schedule 21:40/22:40 TW | 🟢 Active |
| `3dNTt3IUZNSE0Mkm` | 【正EV Signals API】 | GET/POST `/webhook/ev-signals` | 🟢 Active |
| `NMM0ejwlcGKmOhKo` | 【正EV勝率追蹤】 | POST `/webhook/ev-signal-track` | 🟢 Active |
| `o59CezursWELrfYa` | 【正EV自動結算】 | Schedule UTC 06:00 | 🟢 Active |
| `sFV6aCeC6AZt4hE2` | 【正EV週報】 | Schedule Mon UTC 02:00 | 🟢 Active |
| `nGYCG2l7JRVP9D6s` | 【學生下單】WF-06 | POST `/webhook/student-order` | 🟢 Active |
| `UWSFghoS27mcfPRd` | 【學生平倉】WF-07 | POST `/webhook/student-close-position` | 🟢 Active |
| `ws7E5Rq4qVAnc69s` | 【持倉同步】WF-08 | GET/POST `/webhook/student-broker-dashboard` | 🟢 Active |
| `tecBDH3Q64fBF2a2` | 【訂單監控】WF-09 | Schedule (每2分鐘，盤中) | 🟢 Active |

## Dashboard

**線上版**: https://chungchangting.github.io/student-signal-dashboard

### 4 關流程

| 關卡 | 功能 | 特色 |
|---|---|---|
| 第1關 盤前訊號 | IVR / VIX / 事件風險檢查 | 市場狀態自動分流 |
| 第2關 TOS 試算 | 5 策略 Tab (IC/PCS/CCS/BCDS/BPDS) | Delta/DTE/停損/獲利參數表 |
| 第3關 部位確認 | 8 項 checklist + 自動計算 | Max Loss/BP/EV/Kelly 驗證 |
| 第4關 人工確認送單 | 止損單計算器 + OTOCO | 8/8 通過才能送單 |

### 即時持倉 Dashboard

- 連接 tastytrade/Schwab/IBKR 帳戶
- 即時顯示持倉、餘額、live orders
- 🟢 平倉按鈕（獲利了結 / 停損出場）
- 自動偵測策略類型（PCS/CCS/IC）

## 多券商支援

| 券商 | 下單 | 平倉 | 持倉同步 | 止損單 |
|---|---|---|---|---|
| tastytrade | ✅ OTOCO | ✅ | ✅ | ✅ OTO/OTOCO |
| Schwab (TOS) | ✅ BRACKET | ✅ | ✅ | ✅ childOrderStrategies |
| IBKR | ✅ Bracket | ✅ | ✅ | ✅ parent-child |

**IBKR conid 自動解析** — 學生不需要手動查 conid，系統自動從 OCC symbol 走 `/secdef/search` → `/secdef/strikes` → `/secdef/info` 三步解析。

## 測試

```bash
# 執行 9 個 E2E 測試
./tests/test-wf06-e2e.sh <tastytrade_refresh_token>

# 測試涵蓋:
# 1. tastytrade OTOCO/OTO/Simple dry-run
# 2. Schwab/IBKR routing
# 3. Input validation
# 4. OCC symbol parsing (SPY/QQQ/AAPL)
```

每次 push 到 `main` 會自動觸發 [GitHub Actions CI](.github/workflows/wf06-e2e.yml)。

## 學生券商綁定

詳見 [BROKER-SETUP.md](BROKER-SETUP.md) — 完整的 tastytrade / Schwab / IBKR 綁定指南。

## 版本歷史

詳見 [n8n-workflows/CHANGELOG.md](n8n-workflows/CHANGELOG.md)

| 版本 | 重點 |
|---|---|
| v3.4 | 21層過濾引擎 + 9項優化 |
| v3.3 | VIX + SPY 市場狀態濾層 |
| v3.2 | Notion 規則完整對齊 |
| v3.0 | CBOE + 方向評分引擎 |
| v2.0 | IC/Credit/流動性修正 |

## 資料來源

- **Yahoo Finance** — 價格、RSI、MA20、MACD、支撐/壓力、VIX
- **tastytrade market-metrics** — IVR、IVP、IV Index
- **CBOE delayed quotes** — Greeks、bid/ask、OI、volume
- **Finnhub** — 財報日曆
- **Google Sheets** — 信號追蹤、結算、勝率統計
