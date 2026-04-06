## 變更說明

<!-- 簡要描述這次 PR 修改了什麼 -->

## 變更類型

- [ ] 🔧 Workflow 邏輯修改（n8n Code Node）
- [ ] 🎨 Dashboard UI 修改
- [ ] 📊 策略參數調整
- [ ] 🔌 券商串接（tastytrade / Schwab / IBKR）
- [ ] 🧪 測試新增 / 修改
- [ ] 📝 文件更新
- [ ] 🐛 Bug 修正

## 核心邏輯 Checklist

> **以下項目只要有任何一項被修改，必須逐條確認並勾選。**
> 未修改的項目請標記 `N/A`。

### EV 計算邏輯

- [ ] `EV = P(win) × MaxProfit − P(loss) × MaxLoss` 公式未被改動
- [ ] Credit spread: `MaxProfit = Net Credit × 100`
- [ ] Debit spread: `MaxProfit = (Width − Debit) × 100`
- [ ] IC: `MaxProfit = Net Credit × 100`, `MaxLoss = (Width − Credit) × 100`
- [ ] P(win) 使用 POP（不是 Delta）
- [ ] 若有修改 EV 公式，附上修改前後對比與回測驗證
- [ ] N/A — 本次 PR 未涉及 EV 計算

### Iron Condor 結構

- [ ] 4 腿結構正確：Short Put + Long Put + Short Call + Long Call
- [ ] Short Put strike < Long Put strike（Bull Put Spread 側）— ❌ 反了會變 debit
- [ ] Short Call strike > Long Call strike — ❌ 反了會變 debit
- [ ] 兩側 Wing 寬度獨立計算（不強制對稱）
- [ ] IC Delta 範圍: 0.10 – 0.15（兩邊 short leg）
- [ ] IC DTE: 20 – 30 天
- [ ] IC IVR 門檻: ≥ 30%
- [ ] IC 止損: Credit × 2.0
- [ ] 若有修改 IC 邏輯，附上至少 3 個 symbol 的測試結果
- [ ] N/A — 本次 PR 未涉及 IC 結構

### 流動性過濾門檻

- [ ] OI（Open Interest）≥ 100
- [ ] Volume ≥ 50
- [ ] Bid-Ask Spread ≤ 20%
- [ ] 以上三個條件為 AND（全部通過才放行）
- [ ] 若有調整門檻數值，附上調整理由與影響分析
- [ ] N/A — 本次 PR 未涉及流動性過濾

### 策略參數（Notion 教學規則）

- [ ] PCS Delta: 0.20 – 0.25 | IVR: 30% – 60% | DTE: 14 – 30 天
- [ ] CCS Delta: 0.10 – 0.20 | IVR: 30% – 50% | DTE: 14 – 30 天
- [ ] Debit Delta: 0.40 – 0.60 | IVP: 20% – 50% | DTE: 14 – 45 天
- [ ] 止損: Credit × 1.3 / Debit × 0.7 / IC × 2.0
- [ ] RSI 方向邏輯: RSI < 50 = 偏空（趨勢跟隨），非超賣反彈
- [ ] 同產業 ≤ 2 檔 / 每次推薦 ≤ 5 檔
- [ ] VIX ≥ 35 暫停 / VIX ≥ 25 + SPY 偏空 → 僅看跌
- [ ] N/A — 本次 PR 未涉及策略參數

### 券商 API

- [ ] tastytrade: OAuth token 讀取用 `access_token`（非 `access-token`）
- [ ] tastytrade: Option symbol 6 字元 root + 空格填充（`SPY   260417P00540000`）
- [ ] Schwab: `orderStrategyType: 'TRIGGER'` + `childOrderStrategies`
- [ ] IBKR: conid 自動解析（`/secdef/search` → `/secdef/strikes` → `/secdef/info`）
- [ ] 所有 httpRequest 加 `ignoreHttpStatusErrors: true`
- [ ] N/A — 本次 PR 未涉及券商 API

## 測試

- [ ] 本地跑過 `./tests/test-wf06-e2e.sh` — 9/9 通過
- [ ] GitHub Actions CI 通過
- [ ] 手動 dry-run 測試過（如有修改下單邏輯）
- [ ] 未修改需要測試的部分

## 截圖 / 日誌

<!-- 如果修改了 Dashboard UI 或 workflow 輸出，貼截圖或日誌 -->

## 關聯 Issue

<!-- 如有關聯的 issue，填 #issue_number -->
