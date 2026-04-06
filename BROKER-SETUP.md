# 下班鴿 Options Strategy Engine — 券商帳號連接指南

> **適用對象：** 課程學生  
> **目的：** 將個人券商帳號綁定至 下班鴿 Options Strategy Engine 儀表板，以啟用自動下單與持倉同步功能。  
> **注意：** 本文件包含敏感設定步驟，請妥善保管你的 token，勿公開分享。

---

## 目錄

1. [tastytrade（已內建）](#1-tastytrade已內建)
2. [Charles Schwab（TOS）](#2-charles-schwab-tos)
3. [Interactive Brokers（IBKR）](#3-interactive-brokers-ibkr)
4. [Option Symbol 格式對照](#4-option-symbol-格式對照)
5. [Webhook 端點一覽](#5-webhook-端點一覽)
6. [安全注意事項](#6-安全注意事項)

---

## 1. tastytrade（已內建）

> **好消息：** tastytrade 無需老師另外建立 App。系統已使用課程專屬的 OAuth client，學生只需在 tastytrade 開發者入口授權即可。

### 操作步驟

1. 開啟瀏覽器，前往 tastytrade 開發者入口：  
   👉 [https://developer.tastytrade.com](https://developer.tastytrade.com)

2. 使用你的 tastytrade 帳號登入。

3. 點擊上方 **「OAuth Grants」** 分頁。

4. 找到「Grant Access to Client」欄位，輸入以下 `client_id`：

   ```
   ec8b4453-d7e5-418e-8170-43e9b3e0b460
   ```

5. 勾選以下三個 scope（授權範圍）：

   | Scope | 說明 |
   |-------|------|
   | `read` | 讀取帳號與持倉資料 |
   | `trade` | 執行下單操作 |
   | `openid` | 身分識別（必選） |

6. 完成雙重驗證（2FA）以確認授權。

7. 授權完成後，頁面會顯示你的 **`refresh_token`**。  
   ⚠️ 請立即複製並妥善保存，此 token **永不過期**，但只會顯示一次。

### 儀表板綁定格式

將以下 JSON 填入儀表板的「新增券商」設定頁：

```json
{
  "broker": "tastytrade",
  "account_number": "你的帳號(如5XX00000)",
  "refresh_token": "你的refresh_token"
}
```

---

## 2. Charles Schwab（TOS）

Schwab 的 OAuth 流程分為兩個階段：**老師建立開發者 App（僅需做一次）**，以及**學生自行取得 token**。

---

### Step A：老師建立 Schwab Developer App（只需做一次）

> 此步驟由老師完成，學生可跳至 [Step B](#step-b學生取得-token)。

1. 前往 Schwab 開發者平台：  
   👉 [https://developer.schwab.com/](https://developer.schwab.com/)

2. 註冊帳號後，點擊 **「Create an App」**。

3. 填入以下資訊：

   | 欄位 | 填入值 |
   |------|--------|
   | App Name | `下班鴿 Options Strategy Engine` |
   | Callback URL | `https://chilldove.app.n8n.cloud/webhook/schwab-callback` |
   | App Permissions | `Read`、`Trading` |

4. 提交後，儲存系統產生的：
   - **App Key**（即 `client_id`）
   - **App Secret**（即 `client_secret`）

5. 等待 Schwab 審核，通常需要 **1–3 個工作天**。審核通過後，老師再將 `client_id` 與 `client_secret` 提供給學生。

---

### Step B：學生取得 Token

1. **開啟授權頁面**  
   將以下網址中的 `{APP_KEY}` 替換為老師提供的 App Key，貼入瀏覽器開啟：

   ```
   https://api.schwabapi.com/v1/oauth/authorize?client_id={APP_KEY}&redirect_uri=https://chilldove.app.n8n.cloud/webhook/schwab-callback&response_type=code
   ```

2. 以你的 Schwab 帳號密碼登入，並點擊「Approve」授權應用程式。

3. Schwab 會將你重導至 callback URL，網址列中會附帶授權碼，格式如下：

   ```
   https://chilldove.app.n8n.cloud/webhook/schwab-callback?code=XXXXXX
   ```

   複製 `code=` 後面的完整授權碼。

4. **交換 Access Token**  
   使用以下 API 請求將授權碼換成 token（可用 Postman、curl 或請老師協助）：

   ```
   POST https://api.schwabapi.com/v1/oauth/token

   Authorization: Basic base64(client_id:client_secret)
   Content-Type: application/x-www-form-urlencoded

   Body:
     grant_type=authorization_code
     &code=XXXXXX
     &redirect_uri=https://chilldove.app.n8n.cloud/webhook/schwab-callback
   ```

5. 回應的 JSON 中會包含 `refresh_token`，請複製並保存。

   > ⚠️ **重要：** Schwab 的 `refresh_token` **有效期為 7 天**，過期後需重新走一次授權流程。系統會在 token 快過期時，自動使用 `refresh_token` 取得新的 `access_token`，但 `refresh_token` 本身無法自動續期。

---

### Step C：取得加密帳號（Account Hash）

Schwab API 使用加密後的帳號 hash 而非明文帳號。取得方式如下：

```
GET https://api.schwabapi.com/trader/v1/accounts/accountNumbers

Authorization: Bearer {access_token}
```

回應範例：

```json
[
  {
    "accountNumber": "12345678",
    "hashValue": "A1B2C3D4E5F6..."
  }
]
```

請複製 `hashValue` 欄位的值，填入儀表板設定中的 `account_number`。

---

### Step D：儀表板綁定格式

```json
{
  "broker": "schwab",
  "account_number": "加密後的帳號hash(從API取得)",
  "refresh_token": "Schwab refresh_token",
  "client_id": "老師提供的 App Key",
  "client_secret": "老師提供的 App Secret"
}
```

---

## 3. Interactive Brokers（IBKR）

IBKR 同樣採用 OAuth 2.0 流程，亦分為老師建立 App 和學生授權兩個階段。

> **備注：** IBKR 亦支援 Client Portal Gateway（Java 本地架構），但雲端部署環境建議使用 OAuth 2.0。

---

### Step A：老師建立 IBKR Third-Party OAuth App（只需做一次）

> 此步驟由老師完成，學生可跳至 [Step B](#step-b學生授權)。

1. 登入 IBKR Client Portal：  
   👉 [https://www.interactivebrokers.com/](https://www.interactivebrokers.com/)

2. 前往 **Settings → API → OAuth Apps**。

3. 點擊「Create New OAuth Application」，填入以下資訊：

   | 欄位 | 填入值 |
   |------|--------|
   | App Name | `下班鴿 Options Strategy Engine` |
   | Redirect URI | `https://chilldove.app.n8n.cloud/webhook/ibkr-callback` |
   | Scopes | `trading`、`account_data` |

4. 提交後，儲存系統產生的 **`client_id`** 與 **`client_secret`**，並提供給學生。

---

### Step B：學生授權

1. **開啟授權頁面**  
   將以下網址中的 `{CLIENT_ID}` 替換為老師提供的 client_id，貼入瀏覽器開啟：

   ```
   https://api.ibkr.com/v1/api/oauth/authorize?client_id={CLIENT_ID}&redirect_uri=https://chilldove.app.n8n.cloud/webhook/ibkr-callback&response_type=code&scope=trading+account_data
   ```

2. 以你的 IBKR 帳號登入，點擊「Approve」授予應用程式權限。

3. 授權完成後，瀏覽器會重導至 callback URL，並附帶授權碼。

4. **交換 Refresh Token**  
   透過以下請求取得 token：

   ```
   POST https://api.ibkr.com/v1/api/oauth/token

   Content-Type: application/x-www-form-urlencoded

   Body:
     grant_type=authorization_code
     &code={授權碼}
     &client_id={CLIENT_ID}
     &client_secret={CLIENT_SECRET}
     &redirect_uri=https://chilldove.app.n8n.cloud/webhook/ibkr-callback
   ```

5. 複製回應中的 `refresh_token` 並保存。

---

### Step C：儀表板綁定格式

```json
{
  "broker": "ibkr",
  "account_number": "IBKR帳號(如U12345678)",
  "refresh_token": "IBKR refresh_token",
  "client_id": "老師提供的 OAuth client_id",
  "client_secret": "老師提供的 OAuth client_secret"
}
```

> **關於 Option Symbol：** IBKR 內部使用 `conid`（合約 ID）來識別選擇權合約。儀表板系統會自動將標準 OCC 格式（symbol + 到期日 + 買/賣權 + 履約價）解析並對應至正確的 `conid`，**學生無需手動查詢 conid**。

---

## 4. Option Symbol 格式對照

各券商使用的選擇權代碼格式不同，儀表板統一採用 **OCC 標準格式**作為輸入。以下為對照說明，範例以 SPY 2026/4/17 Put $540 為例：

| 券商 | 格式說明 | 範例 |
|------|----------|------|
| **tastytrade** | 6 字元 root（含空格補位）+ `YYMMDD` + `C`/`P` + 履約價 × 1000（8 位數，前補零） | `SPY   260417P00540000` |
| **Schwab** | 同 OCC 標準格式 | `SPY   260417P00540000` |
| **IBKR** | conid（數字 ID） | 系統自動解析，不需手動填入 |
| **儀表板送出** | 統一使用 OCC 格式 | `SPY   260417P00540000` |

### OCC 格式拆解說明

```
SPY   260417P00540000
│     │      │ └─── 履約價 540.00（× 1000，補零至 8 位）
│     │      └───── P = Put / C = Call
│     └──────────── 到期日 YYMMDD（2026/04/17）
└──────────────────── 標的代碼，固定 6 字元（不足補空格）
```

---

## 5. Webhook 端點一覽

以下為儀表板所有可用的 webhook 端點，Base URL 為 `https://chilldove.app.n8n.cloud`：

| 端點路徑 | 方法 | 用途說明 |
|----------|------|----------|
| `/webhook/student-order` | `POST` | 送出下單請求，支援 `dry_run` 模式（模擬下單，不實際執行） |
| `/webhook/student-close-position` | `POST` | 平倉指定部位 |
| `/webhook/student-broker-dashboard` | `GET` / `POST` | 同步並取得目前持倉資料 |
| `/webhook/schwab-callback` | `GET` | Schwab OAuth 授權回調（勿手動呼叫） |
| `/webhook/ibkr-callback` | `GET` | IBKR OAuth 授權回調（勿手動呼叫） |

> **dry_run 模式：** 在 `/webhook/student-order` 的請求 body 中加入 `"dry_run": true`，系統會模擬下單流程並回傳預期結果，但不會實際送出委託。建議初次設定時使用此模式進行驗證。

---

## 6. 安全注意事項

妥善保管你的 token，是保護帳號資產的第一道防線。請務必遵守以下原則：

| 注意事項 | 說明 |
|----------|------|
| 🔒 **勿分享 token** | `refresh_token` 等同於帳號存取鑰匙，任何人拿到都可以操作你的帳號，請勿傳送給他人或貼到公開頻道 |
| 🚫 **系統不儲存密碼** | 儀表板系統僅使用 OAuth token，不會儲存你的帳號密碼 |
| ✅ **隨時可撤銷授權** | 若懷疑 token 外洩，可立即至各券商後台撤銷 OAuth 授權，舊 token 將立即失效 |
| 🧪 **先用模擬帳號測試** | 強烈建議先使用 paperMoney / 模擬帳號完成完整流程測試，確認無誤後再切換至正式帳號 |
| 📅 **注意 Schwab token 有效期** | Schwab `refresh_token` 7 天到期，請留意系統通知，及時重新授權 |

---

## 附錄：常見問題

**Q：我要在哪裡填入綁定的 JSON？**  
A：登入儀表板後，前往「設定 → 券商帳號 → 新增帳號」，將對應的 JSON 貼入輸入欄位。

**Q：tastytrade 的 refresh_token 真的永不過期嗎？**  
A：是的，只要你沒有主動撤銷授權，tastytrade 的 refresh_token 不會過期。

**Q：Schwab token 過期了怎麼辦？**  
A：重新走一遍 Step B 的授權流程，取得新的 `refresh_token`，更新儀表板設定即可。

**Q：我可以同時綁定多個券商嗎？**  
A：可以，每個券商帳號分別新增一筆設定，儀表板會統一管理所有持倉。

---

*文件版本：v1.0 ｜ 最後更新：2025 年*  
*如有問題，請在課程群組發問或聯繫老師。*
