# eink-exhibits 展品管理系統｜專案規則

> 共用規則在 p60732/claude-kit 的 CLAUDE.md（開工讀取預算見其 §0.5）。這裡只寫本專案特有的東西。

## 開工順序（新對話）
1. 讀 `STATUS.md` 的「🔁 交接」→ 2. 只讀交接列出的檔案 → 3. 動手。
**開工不要讀**：`docs/AUDIT.md`、`docs/FLOW.md`、`docs/MANUAL-*.md`、`tests/*.test.js` 全文、`gas/20_logic.gs` 全文（1,600+ 行，用 grep 找函式再讀那段）。

## 專案卡
- 目標：讓管理者與同仁隨時查展品庫存、線上預約、簽收、歸還；展覽檔期掛多張借用單。
- 使用者：管理者（PIN）、同仁（工號登入）。手機＋公司電腦。
- 前端：GitHub Pages，原始碼在 `js/src/*.js`（依頁面分檔，由 `build.js` 組裝＋內容雜湊）。**`js/ui.js` 已不存在**，舊文件提到它請改看 `js/src/`。
- 後端：GAS（`gas/*.gs`），合併到 main 會由 `gas-deploy.yml` 自動部署（網址不變）。
- 資料：Google Sheets（分類、展品、單台編號、借用單、借用單歷史、展覽、使用者、操作紀錄）。
- 機密：人員名冊（姓名、工號）只在 Sheets；測試用假資料。

## 去哪裡找
| 想知道 | 看哪裡（用 grep 找段落，不要整份讀） |
|---|---|
| 業務規則、可借量怎麼算 | `gas/20_logic.gs` |
| 路由與權限 | `gas/00_gateway.gs` 的路由表 |
| 狀態流程 | `docs/FLOW.md` |
| 某版改了什麼、部署基準 | `docs/AUDIT.md`（只看最後幾列） |
| 某頁畫面 | `js/src/<編號>-<頁面>.js` |

## 測試
- `node tests/rules.test.js`、`structure.test.js`、`e2e.test.js`（各 <1 秒）
- `node tests/mutation.test.js`（約 15 秒，M／L 級才跑）
- `tests/ui.test.js`（Playwright，UI 改動時跑）

## 已決定不做
- 每日逾期提醒排程：`installDailyTrigger()` 不要執行（2026-09-23 決定）。
- 跨點調撥獨立功能（v1.8 決定）。
