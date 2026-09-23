# 稽核紀錄

| 日期 | 版本 | 變更 | 風險狀態 |
|---|---|---|---|
| 2026-09-22 | v1.0 | 初版:12 積木架構、工號登入、預約/審核/簽收/歸還/盤點、每日提醒;移除瀏覽器示範模式(前端不含任何業務規則與資料) | 已知風險見 SECURITY.md |
| 2026-09-23 | v1.1 | 套用 E Ink 企業識別色(Pantone 186 Red #C8102E / 432 Gray #333F48)與新版 UI;效能:後端依路由選擇性載入工作表 + CacheService 版本快取,前端讀取快取先畫再背景更新,盤點頁由 N+1 次請求降為 2 次;修正 isDate 未檢查日曆(2026-13-01 曾被接受);新增 docs/FLOW.md | 無新增對外介面;快取以 DBVER 版本失效,寫入即 bump |

## 部署基準(每次部署後補上)
| 日期 | Apps Script 版本 | Pages commit | 測試結果 |
|---|---|---|---|
| 2026-09-22 | 1 版(v1.0 12積木架構首次上線) | 57c0aa6 | 規則 8 / e2e 全過 / 結構 8 / 突變 10 |
| 2026-09-23 | 2 版(v1.1 選擇性載入工作表+快取,單台一次查詢) | 775c7d1 | 規則 8 / e2e 全過(含限縮載入一致性)/ 結構 8 / 突變 10 / UI E2E 通過 |

## 環境
- Apps Script 專案:展品管理後端 `1Mk2JuR7fYYj8bl1w1hh1o2ICCsFalu1u9xsc3_Op68DwpM1vuNFzNrZY`
- 網頁應用程式部署 ID:`AKfycbyKSJTXKFkZPx0ub45aKd7_0kn3Gv3379GYRJAnE9lfhXpR60HlhtWKSdgreblyZTQssQ`(換版本不換網址)
- 前端:GitHub Pages `p60732/eink-exhibits`,由 GitHub Actions 測試通過後發佈

## 待辦
- [ ] 執行一次 `installDailyTrigger()` 安裝每日 08:30 提醒觸發器(需擁有者本人在編輯器中執行)
