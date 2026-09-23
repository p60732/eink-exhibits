# eink-exhibits 展品管理系統

即時查庫存、依日期算可借量、線上預約、簽收/歸還(管理者當面確認)、QR 追蹤、盤點、逾期提醒。

- 網站:https://p60732.github.io/eink-exhibits/
- 架構:[ARCHITECTURE.md](ARCHITECTURE.md)(12 積木)|問題定義:[SPEC.md](SPEC.md)|資安:[SECURITY.md](SECURITY.md)
- 說明書:[一般版](docs/MANUAL-USER.md)|[IT 版](docs/MANUAL-IT.md)|測試計畫:[docs/TEST-PLAN.md](docs/TEST-PLAN.md)|稽核:[docs/AUDIT.md](docs/AUDIT.md)

```
index.html          入口
css/ js/            展示積木(ui.js)、連線積木(connect.js)
gas/                守門調度 / 身份 / 邏輯 / 記憶 / 通知 / 排程(Apps Script)
tests/              規則層、流程層、結構、突變、前端 E2E
build.js            測試 → 建置 → 一致性檢查
.github/workflows/  push main 自動測試並發佈 Pages
```

```bash
node build.js                         # 跑全部測試並建置
node tests/serve.js 8787              # 本機以模擬 GAS 預覽 http://localhost:8787
```
