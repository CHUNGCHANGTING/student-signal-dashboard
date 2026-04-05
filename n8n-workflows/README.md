# 正EV履約價推播系統 — n8n Workflows

## 版本：v3.4（2026-04-06）

21 層過濾引擎，從市場數據到正EV信號的完整自動化流程。

## 系統架構

```
Yahoo Finance ──┐
tastytrade ─────┤──→ v3.4 Engine (21 filters) ──→ LINE / Telegram / Dashboard
CBOE quotes ────┤         │
Finnhub ────────┘         ├──→ Google Sheet (signal tracking)
                          └──→ Auto-settle (daily) → Weekly report
```

## Workflow 總覽

| Workflow | 排程 | 功能 |
|----------|------|------|
| 【正EV履約價推播】v3.4 | 每日 21:40 + 22:40 TW | 核心引擎：21層過濾 → 推播 |
| 【正EV Signals API】 | Webhook | Dashboard 資料接口 |
| 【正EV勝率追蹤】 | Webhook | 信號記錄與統計 |
| 【正EV自動結算】 | 每日 14:00 TW | 到期日自動判斷 WIN/LOSS |
| 【正EV週報】 | 每週一 10:00 TW | 勝率統計推送 LINE/TG |

## v3.4 — 21 層過濾引擎

| 層次 | 過濾器 | 說明 |
|------|--------|------|
| L1 | VIX Market Regime | VIX ≥ 35 暫停, ≥ 25+SPY空 → 僅看跌 |
| L2 | SPY Direction Score | RSI + MACD + MA20 方向評分 |
| L3 | Earnings Blackout | 🆕 財報前 2 天排除 |
| L4 | Symbol Liquidity | OI ≥ 100, Volume ≥ 50, Spread ≤ 20% |
| L5 | IVR Gate | PCS: 30-60%, CCS: 30-50%, IC: >30% |
| L6 | IVP Gate | Debit: 20-50% |
| L7 | Direction Score | RSI < 50 = 偏空（趨勢跟隨）|
| L8 | MACD Confirmation | MACD 方向一致性 |
| L9 | Delta Selection | PCS: 0.20-0.25, CCS: 0.10-0.20 |
| L10 | Strike-Support Align | 🆕 賣腿貼近支撐/壓力位 |
| L11 | Vega Alignment | 🆕 賣方Vega負效益, 買方Vega正效益 |
| L12 | Volume Confirmation | 🆕 支撐位成交量 > 1.2x 均量 |
| L13 | Theta Decay Rate | 🆕 Theta/Price 比率評估 |
| L14 | DTE Filter | Credit: 14-30d, IC: 20-30d, Debit: 14-45d |
| L15 | EV Calculation | P(win) × maxProfit - P(loss) × maxLoss > 0 |
| L16 | Stop Loss | Credit×1.3, Debit×0.7, IC×2.0 |
| L17 | Sector Limit | 🆕 同產業最多 2 檔 |
| L18 | Max Signals | 🆕 每次最多 5 檔（依EV排序）|
| L19 | Market Session | 🆕 盤前/盤中/盤後資料區分 |
| L20 | Signal Tracking | 🆕 自動記錄到 Google Sheet |
| L21 | Output Format | LINE/TG/Dashboard 推播格式化 |

## 檔案結構

```
n8n-workflows/
├── CHANGELOG.md                              # 版本變更記錄
├── manifest.json                             # 版本元資料
├── README.md                                 # 本文件
├── ev-push-v3.4.json                         # 核心推播 workflow
├── ev-push-v3.4_code_in_javascript.js        # Node1: 數據+分析+信號
├── ev-push-v3.4_code_in_javascript1.js       # Node2: 格式化+輸出
├── ev-signals-api.json                       # API webhook workflow
├── ev-signals-api_build_response.js          # API 回應建構
├── ev-signals-api_store_signals.js           # 信號儲存
├── ev-signal-tracking.json                   # 勝率追蹤 workflow
├── ev-signal-tracking_build_rows.js          # Sheet 列建構
├── ev-signal-tracking_calc_stats.js          # 統計計算
├── ev-auto-settle.json                       # 自動結算 workflow
├── ev-auto-settle_settle_signals.js          # 結算邏輯
├── ev-weekly-report.json                     # 週報 workflow
└── ev-weekly-report_build_report.js          # 報告建構
```

## 資料來源

- **Yahoo Finance**: 價格、RSI、MA20、MACD、支撐/壓力、成交量、VIX
- **tastytrade market-metrics**: IVR、IVP、IV Index
- **CBOE delayed quotes**: 完整 Greeks、bid/ask、OI、volume（15-20 分鐘延遲）
- **Finnhub**: 財報日曆
- **Google Sheets**: 信號追蹤與結算記錄
