#!/bin/bash
# 【版本控制 + 部署積木】首次發佈到 GitHub:p60732/eink-exhibits
# 用法:在「終端機」執行  bash ~/Documents/eink-exhibits/publish.sh
set -e
cd "$(dirname "$0")"

# 1) GitHub Actions 工作流程(push main → 測試 → 建置 → 發佈 Pages)
mkdir -p .github/workflows
cat > .github/workflows/pages.yml <<'YML'
# 【部署積木】push 到 main → 跑測試 → 建置 → 發佈 GitHub Pages(測試失敗就不會上線)
name: test-build-deploy
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: node build.js
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist/site
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
YML

# 2) 上線前先在本機跑一次全部測試與建置(失敗就停止)
node build.js

# 3) 依積木分次 commit
[ -d .git ] || git init -b main
TRAILER=$'\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>'
c() { local msg="$1"; shift; git add "$@"; git diff --cached --quiet || git commit -q -m "$msg$TRAILER"; }
c "[版本控制] 專案架構、問題規格書、資安規則與說明文件" README.md ARCHITECTURE.md SPEC.md SECURITY.md docs .gitignore
c "[記憶] Google Sheets 結構與讀寫(依表頭名稱對應)" gas/30_memory.gs
c "[身份] 工號登入、管理者 PIN、首次改 PIN、登出作廢 token" gas/10_identity.gs
c "[邏輯] 庫存與可借量、預約審核、簽收歸還、盤點、提醒內容" gas/20_logic.gs
c "[通知] MailApp 寄送邏輯積木產生的事件" gas/40_notify.gs
c "[排程] 每日 08:30 逾期與到期提醒" gas/50_schedule.gs
c "[守門+調度] 路由表、權限、參數白名單、統一回應格式" gas/00_gateway.gs
c "[連線] fetch GAS、逾時、讀取重試" js/connect.js
c "[入口][展示] 畫面與樣式" index.html css js/ui.js
c "[建置/測試] 規則層、流程層、結構、突變、前端 E2E 測試與建置腳本" tests build.js
c "[部署] GitHub Actions 與後端網址設定" .github deploy.config.json publish.sh

# 4) 推上 GitHub(repo 已建立;第一次會要求 GitHub 登入)
git remote get-url origin >/dev/null 2>&1 || git remote add origin https://github.com/p60732/eink-exhibits.git
git push -u origin main
echo "✔ 已推上 GitHub:https://github.com/p60732/eink-exhibits"
