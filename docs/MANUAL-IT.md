# 技術說明書(IT 版)

## 架構
GitHub Pages(靜態前端)→ HTTPS POST → Google Apps Script Web App(執行身分:擁有者、存取:任何人)→ Google Sheets。詳見 ARCHITECTURE.md。

## 首次部署
1. 建立試算表 → 擴充功能 → Apps Script。
2. 依 `gas/` 建立 6 個同名檔案(00_gateway … 50_schedule),貼上內容並儲存。
3. 執行 `setupSheets` 並授權(讀寫試算表、寄信、指令碼屬性、觸發器)。
4. 部署 → 新增部署作業 → 網頁應用程式;執行身分「我」、存取權「任何人」→ 複製 `/exec` 網址。
5. 把網址寫入 repo 的 `deploy.config.json` → push → GitHub Actions 測試並發佈。
6. repo Settings → Pages → Source 選「GitHub Actions」。
7. (選用)執行 `installDailyTrigger` 開啟每日 08:30 提醒。
8. 開啟網站建立第一位管理者,再到「使用者」匯入人員名冊。

## 更新
- 前端:改原始碼 → `node build.js` 本機驗證 → push。
- 後端:改 `gas/*.gs` → 本機測試 → 貼到 Apps Script → 部署 → 管理部署作業 → 編輯 → **新版本**(網址不變)。

## 指令碼屬性
| 鍵 | 用途 |
|---|---|
| SECRET | 簽章 / PIN 雜湊金鑰(自動產生,**勿外流、勿修改**,修改會讓所有 PIN 與登入失效) |
| MAIL_OFF | 設為 `1` 停止寄信 |
| SHEET_ID | (選用)改用其他試算表 |

## 配額
Apps Script 免費帳號每日寄信約 100 封;Web App 同時請求有鎖(寫入時 LockService)。
