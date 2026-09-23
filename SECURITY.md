# 資安規則(通用模板第 3 節 + 本專案特例)

## 本專案的機密資料
| 資料 | 放哪裡 | 誰看得到 |
|---|---|---|
| 同仁工號、姓名、部門、Email | 試算表「使用者」 | 管理者(後台);同仁只看得到自己 |
| 借用紀錄 | 試算表「借用單」 | 管理者全部;同仁只看自己的 |
| 管理者 PIN | 只存雜湊(SHA-256 + 專案金鑰) | 無人可反查 |
| 簽章金鑰 SECRET | Apps Script 指令碼屬性 | 專案擁有者 |

**repo 與頁面原始碼內沒有任何真實人員或展品資料**,測試一律用假資料(測試員工A、A001…)。

## 已實作的防護
| 規則 | 實作位置 | 測試 |
|---|---|---|
| 身分只在後端驗證 | `Identity.authenticate` 每次請求重驗 token | e2e:偽造 token、越權 |
| 不靠隱藏按鈕做權限 | 路由表 `auth: public/user/admin` | e2e:同仁呼叫管理者動作被拒 |
| 輸入白名單 | `checkPayload_`:未列出的欄位一律拒絕;字串 ≤ 500、陣列 ≤ 2000、深度 ≤ 5、body ≤ 500KB | e2e + 突變 |
| 通用錯誤訊息 | 非預期錯誤只回「操作失敗,請稍後再試」,細節寫 console | e2e + 突變 |
| 頂層函式不外露 | 內部函式一律 `_` 結尾;白名單:doGet、doPost、setupSheets、installDailyTrigger、dailyReminder | 結構測試 |
| 編輯器函式限擁有者 | `assertOwner_()` | e2e |
| 管理者 PIN 暴力破解 | 錯 5 次鎖 10 分鐘(CacheService) | e2e + 突變 |
| 別人設定的 PIN 首次登入必改 | `mustChange` 旗標,改前只能 me/changePin/logout | e2e + 突變 |
| 登出即失效 | token 內含 `sessionVer`,登出 / 停用 / 重設 PIN 時遞增 | e2e + 突變 |
| 輸出跳脫 | 所有使用者欄位經 `esc()` 才進 HTML | 結構測試掃描 |
| 無 eval / new Function | — | 結構測試 |
| 紀錄不含密碼 | 操作紀錄只記動作摘要 | e2e 掃描紀錄內容 |
| 套件鎖版本 | html5-qrcode@2.3.8(jsDelivr)、qrcodejs 1.0.0(cdnjs);GitHub Actions 固定主版本 | — |

## 已知風險與接受理由
| 風險 | 說明 | 緩解 |
|---|---|---|
| 同仁只憑工號登入 | 知道別人工號可用其名義**預約** | 預約要核准;簽收/歸還需管理者 PIN 確認,無法冒領;所有動作留紀錄 |
| Web App 存取權為「任何人」 | GitHub Pages 跨網域呼叫,且公司未使用 Google Workspace 網域登入 | 所有動作都要 token;未知動作與欄位一律拒絕 |
| repo 公開 | 免費 GitHub Pages 需公開 | repo 只有程式碼與假資料;後端網址本來就會出現在前端 |
| 前端 token 存 localStorage | 共用電腦可能被他人使用 | 同仁 7 天、管理者 12 小時過期;登出即作廢 |

## 攻擊者視角自我審查(每次功能完成必做)
- [x] 不登入直接呼叫 API → 「登入已過期」
- [x] 同仁改參數冒充管理者 → 路由權限拒絕;多送 `role` 欄位 → 白名單拒絕
- [x] 超長字串 / HTML / 負數 / 不存在的日期 → 拒絕或跳脫
- [x] 檢視網頁原始碼 → 無機密、無資料
- [x] 新的頂層函式 → 結構測試會擋
- [x] 錯誤訊息 → 不含內部結構
- [ ] 舊連結、舊版本 → 上線後檢查(見 docs/AUDIT.md)

## 回復方式
- 回到上一版:Apps Script → 部署 → 管理部署作業 → 編輯 → 版本選前一版
- 緊急關閉:Apps Script 部署存取權改「只有我自己」(資料保留)
- 前端下線:GitHub → Settings → Pages → Unpublish
