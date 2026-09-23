#!/usr/bin/env node
/**
 * 【建置/測試積木】build.js
 * 輸入:原始碼(index.html、css/、js/、gas/)+ deploy.config.json
 * 責任:① 跑全部測試(規則層、流程層、結構、突變)② 產生可部署檔案 ③ 確認產物與原始碼一致
 * 輸出:dist/site/(GitHub Pages)、dist/gas/(Apps Script)
 * 禁止:測試沒過不產生產物;不手改 dist/
 *
 * 用法:node build.js            → 測試 + 建置
 *       node build.js --no-test  → 只建置(僅限本機預覽,CI 一律跑測試)
 */
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const root = __dirname, dist = path.join(root, 'dist');
const args = process.argv.slice(2);

function run(file) {
  const r = spawnSync(process.execPath, [path.join(root, 'tests', file)], { stdio: 'inherit' });
  if (r.status !== 0) { console.error('✘ 測試失敗:' + file + ',停止建置'); process.exit(1); }
}
if (!args.includes('--no-test')) ['rules.test.js', 'e2e.test.js', 'structure.test.js', 'mutation.test.js'].forEach(run);

const cfg = JSON.parse(fs.readFileSync(path.join(root, 'deploy.config.json'), 'utf8'));
if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(cfg.gasUrl || '')) {
  console.error('✘ deploy.config.json 的 gasUrl 不是有效的 Apps Script 網頁應用程式網址'); process.exit(1);
}

fs.rmSync(dist, { recursive: true, force: true });
const copy = (from, to, transform) => {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  const src = fs.readFileSync(from, 'utf8');
  fs.writeFileSync(to, transform ? transform(src) : src);
};
// 前端:只有 GAS_URL 由建置注入
['index.html', 'css/style.css', 'js/ui.js'].forEach(f => copy(path.join(root, f), path.join(dist, 'site', f)));
copy(path.join(root, 'js/connect.js'), path.join(dist, 'site/js/connect.js'), s => s.replace("'__GAS_URL__'", JSON.stringify(cfg.gasUrl)));
fs.writeFileSync(path.join(dist, 'site/.nojekyll'), '');
// 後端:原樣複製
fs.readdirSync(path.join(root, 'gas')).filter(f => f.endsWith('.gs')).forEach(f => copy(path.join(root, 'gas', f), path.join(dist, 'gas', f)));

// 單一來源檢查
const diff = [];
['index.html', 'css/style.css', 'js/ui.js'].forEach(f => { if (fs.readFileSync(path.join(root, f), 'utf8') !== fs.readFileSync(path.join(dist, 'site', f), 'utf8')) diff.push(f); });
fs.readdirSync(path.join(root, 'gas')).forEach(f => { if (fs.readFileSync(path.join(root, 'gas', f), 'utf8') !== fs.readFileSync(path.join(dist, 'gas', f), 'utf8')) diff.push('gas/' + f); });
const c1 = fs.readFileSync(path.join(root, 'js/connect.js'), 'utf8').split('\n'), c2 = fs.readFileSync(path.join(dist, 'site/js/connect.js'), 'utf8').split('\n');
if (c1.filter((l, i) => l !== c2[i]).length !== 1) diff.push('js/connect.js(應只差 GAS_URL 一行)');
if (diff.length) { console.error('✘ 產物與原始碼不一致:' + diff.join('、')); process.exit(1); }
console.log('✔ 建置完成 → dist/site(前端)、dist/gas(後端)');
