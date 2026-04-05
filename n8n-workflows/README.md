# n8n Workflows — 正EV履約價推播系統 v3.4

## 工作流清單

| 檔案 | 工作流名稱 | 功能 |
|------|-----------|------|
| `ev-push-v3.4.json` | 【正EV履約價推播】開盤後即時推播官方LINE | 核心：21層篩選 + LINE/TG/Dashboard 推播 |
| `ev-signals-api.json` | 【正EV Signals API】Dashboard webhook | Dashboard 即時拉取信號 |
| `ev-signal-tracking.json` | 【正EV勝率追蹤】Signal Tracking & Stats | 信號寫入追蹤表 + 勝率統計 API |
| `ev-auto-settle.json` | 【正EV自動結算】每日盤後 WIN/LOSS 判斷 | 盤後自動結算到期信號 |

## 版本歷史

| 版本 | 日期 | 重大變更 |
|------|------|---------|
| v1.0 | 2026-03-25 | 初版：SD away + fallback credit |
| v2.0 | 2026-04-05 | Phase 1 修正：IC結構、移除fallback、流動性過濾 |
| v3.0 | 2026-04-05 | CBOE數據源、Greeks、IVR、方向判斷、Delta選價 |
| v3.1 | 2026-04-06 | Notion LV2+LV3 對齊：RSI趨勢跟隨、止損修正、MACD |
| v3.2 | 2026-04-06 | Notion LV1 對齊：PCS/CCS Delta分離、IVP過濾 |
| v3.3 | 2026-04-06 | 盤勢判斷：VIX + SPY方向第一層過濾 |
| v3.4 | 2026-04-06 | 10項優化：財報黑名單、支撐對齊、Vega效益、同產業限制等 |

## Code 節點獨立檔案

每個 `.js` 檔案對應一個 n8n Code node，方便 diff 和 review：
- `ev-push-v3.4_code_in_javascript.js` — Node1: 分析+篩選 (45K chars)
- `ev-push-v3.4_code_in_javascript1.js` — Node2: 格式化+推播 (14K chars)
- `ev-signal-tracking_build_rows.js` — 信號寫入邏輯
- `ev-signal-tracking_calc_stats.js` — 勝率統計計算
- `ev-auto-settle_settle_signals.js` — 自動結算邏輯

## 還原方式

如果需要還原到特定版本：
1. `git log` 找到目標 commit
2. `git checkout <commit> -- n8n-workflows/ev-push-v3.4.json`
3. 用 n8n API PUT 上傳：`curl -X PUT .../api/v1/workflows/{id} -d @ev-push-v3.4.json`
