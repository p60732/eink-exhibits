# 專案架構宣告書(12 積木)

> 給 AI 的指令:「請閱讀 ARCHITECTURE.md、SECURITY.md,依照已啟用的積木與階段目標開始實作,嚴格遵守每塊積木的邊界與禁止事項。」

## 一、專案基本資料

| 欄位 | 內容 |
|---|---|
| 專案名稱 | eink-exhibits 展品管理系統 |
| 一句話描述 | 讓展品管理者與同仁隨時查庫存、線上預約、簽收與歸還,解決「東西在誰手上、還剩幾個」只能靠人記的問題 |
| 目前階段 | ☐ 01 環境建置 ☐ 02 加入AI ☑ 03 記憶與身份 ☑ 04 連線+自動化 ☐ 05 完整上線(待實際部署驗收) |
| 前端載體 | ☑ 單一 HTML(GitHub Pages,經 GitHub Actions 建置) |
| 後端載體 | ☑ Google Apps Script(Web App,執行身分:擁有者) |
| 資料儲存 | ☑ Google Sheets(分類、展品、單台編號、借用單、展覽、使用者、操作紀錄) |

## 二、積木啟用清單

| 啟用 | 積木 | 本專案的具體實作 |
|---|---|---|
| ☑ | 入口 | `index.html`:載入 css/js 後呼叫 `boot()`,不含邏輯 |
| ☑ | 展示積木 | `js/ui.js` + `css/style.css`:畫面、表單格式驗證、QR 掃描/列印 |
| ☑ | 排程積木 | `gas/50_schedule.gs`:每日 08:30 觸發 `dailyReminder` |
| ☑ | 守門+調度 | `gas/00_gateway.gs`:`doPost` → 路由表(權限、欄位白名單)→ 分派 → `{success,data,error}` |
| ☑ | 身份積木 | `gas/10_identity.gs`:工號登入、管理者 PIN、token、名冊維護 |
| ☑ | 邏輯積木 | `gas/20_logic.gs`:庫存/可借量(分地點各算各的)、預約、審核、簽收、歸還、盤點、提醒內容(純規則,時間由外部傳入) |
| ☑ | 連線積木 | `js/connect.js`:fetch GAS、逾時、讀取類重試、統一解析 |
| ☐ | 爬蟲積木 | — |
| ☐ | AI 積木 | — |
| ☑ | 通知積木 | `gas/40_notify.gs`:MailApp 寄出邏輯積木產生的事件 |
| ☑ | 記憶積木 | `gas/30_memory.gs`:Sheets 結構與讀寫(依表頭名稱對應;可指定只讀某些表 / 欄位 / 未結案的列,並依版本快取)。展品的 `stock` 欄存各地點數量與各自的盤點日 |
| ☑ | 檔案積木 | `gas/60_files.gs`:展品照片存進雲端硬碟「展品照片」資料夾,試算表只存連結 |
| ☑ | 版本控制積木 | GitHub repo:`p60732/eink-exhibits` |
| ☑ | 部署積木 | GitHub Pages:`https://p60732.github.io/eink-exhibits/`(Actions:測試 → 建置 → 發佈) |

## 三、資料流

```
使用者 ──▶ 入口 index.html ──▶ 展示 ui.js ──▶ 連線 connect.js ──POST {action,payload,token}──▶
  守門調度 00_gateway.gs
    ├─ 查路由表:未知動作 → 拒絕
    ├─ 欄位白名單 + 長度/筆數/深度限制
    ├─ 身份 10_identity.gs:authenticate(token) / requireAdmin / verifyAdmin(當面確認)
    ├─ 記憶 30_memory.gs:load()  ── 一次請求只讀一次
    ├─ 分派 → 身份動作 或 邏輯 20_logic.gs(c = {db, p, user, today, now, log, notify})
    ├─ 記憶 save(db)            ── 寫入類才存檔,附加操作紀錄
    └─ 通知 40_notify.gs:sendAll(邏輯產生的事件)
  ◀── { success, data, error }

排程 50_schedule.gs ──▶ 記憶 load ──▶ 邏輯 reminders(db, today) ──▶ 通知 sendAll
```

## 四、積木邊界(本專案特例)

- **邏輯積木是純規則引擎**:不讀系統時間、不呼叫任何 Google 服務;`today/now` 由守門調度傳入,通知只產生事件。規則層測試直接呼叫 `Logic.rules.*`。
- **前端不重寫規則**:能不能借、缺多少、狀態文字都以後端回傳為準(結構測試會掃描 ui.js)。
- **當面確認**:守門調度先請身份積木驗證在場管理者的工號+PIN,再把管理者身分交給邏輯積木。
- **檔案載入順序**:Apps Script 依序載入各檔,路由表採第一次請求時才建立(`routes_()`),避免順序依賴。

## 五、建置與部署

| 步驟 | 指令 / 位置 |
|---|---|
| 測試 | `node tests/rules.test.js`、`e2e.test.js`、`structure.test.js`、`mutation.test.js`;前端 `node tests/serve.js 8787` + `PORT=8787 node tests/ui.test.js` |
| 建置 | `node build.js`(先跑測試,失敗即停止)→ `dist/site`、`dist/gas` |
| 前端上線 | push `main` → GitHub Actions 自動測試、建置、發佈 Pages |
| 後端上線 | 把 `gas/*.gs` 貼到 Apps Script 同名檔案 → 部署 → 管理部署 → 新版本 |
| 版本控制 | commit 訊息 `[積木名] 做了什麼`,例:`[邏輯] 逾期借用永久佔用可借量` |

## 六、路線圖

| 階段 | 狀態 |
|---|---|
| 03 記憶與身份 | ✅ 工號登入、PIN、名冊、Sheets |
| 04 連線+自動化 | ✅ 每日提醒、Email 通知 |
| 05 完整上線 | ⏳ 實際部署驗收、使用者說明書發布 |
| 未來 🟡 | 檔案積木(展品照片上傳 Drive)、LINE 通知、數量品項的維修數 |
