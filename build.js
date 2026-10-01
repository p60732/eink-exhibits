#!/usr/bin/env node
/**
 * 【建置/測試積木】build.js
 * 輸入:原始碼(index.html、css/、js/、gas/)+ deploy.config.json
 * 責任:① 跑全部測試(規則層、流程層、結構、突變)② 產生可部署檔案 ③ 確認產物與原始碼一致
 * 輸出:dist/site/(GitHub Pages)、dist/gas/(Apps Script)
 * 禁止:測試沒過不產生產物;不手改 dist/
 *
 * 用法:node build.js             → 後端四層測試 + 建置
 *       node build.js --no-test   → 只建置(僅限本機預覽,CI 一律跑測試)
 *       node build.js --ui        → 再加跑全部 UI 場景(約 4 分鐘)
 *       node build.js --ui=05     → 只跑 05 這個 UI 場景(會自動帶上它的前置)
 *       node build.js --ui=05,08  → 跑兩個場景
 *
 * ⚠️ `--ui` 會自己挑一個沒人用的埠、起一個**全新的**假後端、跑完再關掉。
 *    手動跑的話那一步很容易出錯:假後端的資料在記憶體,沒重開就跑第二次會卡在
 *    「建立管理者」等 30 秒逾時(錯誤訊息看起來像第一步就壞了);
 *    而且不能用 `pkill -f tests/serve.js` 關它,會連自己的 shell 一起殺掉。
 */
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const root = __dirname, dist = path.join(root, 'dist');
const args = process.argv.slice(2);

function run(file) {
  const r = spawnSync(process.execPath, [path.join(root, 'tests', file)], { stdio: 'inherit' });
  if (r.status !== 0) { console.error('✘ 測試失敗:' + file + ',停止建置'); process.exit(1); }
}
/**
 * gas/20_logic.gs 的原始碼在 gas-src/20_logic/*.js,**先串好再跑測試** ——
 * 測試(以及 CI 的 gas-deploy)讀的都是 gas/20_logic.gs 那個產物,
 * 不先串的話改了原始碼卻測到舊產物,是最糟的一種綠燈。
 * 這一步會寫回原始碼目錄,是刻意的:那個產物要 commit(clasp 推的是它)。
 */
{
  const gl = require('./gas-src/20_logic/_concat');
  const joined = gl.concat();
  try { new Function(joined); } catch (e) {
    console.error('✘ gas-src/20_logic 串接之後語法不正確:' + e.message); process.exit(1);
  }
  if (!/var Logic = \(function \(\) \{/.test(joined) || !/\}\)\(\);\s*$/.test(joined)) {
    console.error('✘ 串接結果不是完整的 IIFE,頭尾那兩個檔可能漏了'); process.exit(1);
  }
  const before = fs.existsSync(gl.OUT) ? fs.readFileSync(gl.OUT, 'utf8') : null;
  if (before !== joined) {
    /**
     * ⚠️ 這裡會直接覆蓋掉 gas/20_logic.gs。2026-10-01 真的踩到:
     * 改錯地方(直接改產物)、build 一跑就被蓋回去,而且原本只印一行「已更新」,
     * 看起來像正常的建置訊息 —— 改動就這樣無聲無息地不見了。
     * 所以:產物比所有原始碼都新 = 有人直接改了產物,**當場停下來**,不要幫他蓋掉。
     */
    const outM = before === null ? 0 : fs.statSync(gl.OUT).mtimeMs;
    const srcM = Math.max(...gl.parts().map(f => fs.statSync(path.join(gl.SRC, f)).mtimeMs));
    if (outM > srcM) {
      console.error('✘ gas/20_logic.gs 比 gas-src/20_logic 的每一個檔都新,而且內容對不上。');
      console.error('  看起來是直接改到**產物**了 —— 那個檔是建置出來的,改它沒有用。');
      console.error('  請把改動搬到 gas-src/20_logic/ 底下對應的分片,再跑一次 node build.js。');
      console.error('  (真的要丟掉那些改動,就先 git checkout gas/20_logic.gs)');
      process.exit(1);
    }
    fs.writeFileSync(gl.OUT, joined);
    console.log('  gas-src/20_logic → gas/20_logic.gs(' + gl.parts().length + ' 個檔,已更新,記得一起 commit)');
  }
}

if (!args.includes('--no-test')) ['rules.test.js', 'e2e.test.js', 'structure.test.js', 'mutation.test.js'].forEach(run);

/**
 * UI 場景測試。跟後端四層不一樣,它需要一個跑起來的假後端,而且**必須是全新的** ——
 * 所以這裡自己起、自己關,不要求人先手動開一個。
 */
const uiArg = args.find(a => a === '--ui' || a.startsWith('--ui='));
if (uiArg) {
  const ids = uiArg.includes('=') ? uiArg.slice(5).split(',').map(x => x.trim()).filter(Boolean) : [];
  /**
   * 先確認這台機器跑得動 —— UI 場景要 playwright 的 chromium,**Mac 上沒有**,
   * 只跑得動在雲端沙箱。不先擋的話錯誤會長成
   * 「Cannot find module 'playwright'」夾在測試輸出中間,看起來像某個場景壞了。
   */
  try { require.resolve('playwright'); }
  catch (e) {
    console.error('✘ 這台機器沒有 playwright,跑不了 UI 場景測試。');
    console.error('  UI 測試只跑得動在雲端沙箱(Mac 上沒有 chromium)。');
    console.error('  後端四層已經跑完了,要只建置請改用:node build.js --no-test');
    process.exit(1);
  }
  const port = 8700 + Math.floor(Math.random() * 200);
  const srv = require('child_process').spawn(process.execPath, [path.join(root, 'tests', 'serve.js'), String(port)],
    { stdio: 'ignore', detached: true });
  const stop = () => { try { process.kill(-srv.pid); } catch (e) { try { srv.kill(); } catch (e2) { } } };
  process.on('exit', stop);
  const http = require('http');
  const alive = () => new Promise(res => {
    const q = http.get({ host: '127.0.0.1', port: port, path: '/' }, r => { r.resume(); res(r.statusCode === 200); });
    q.on('error', () => res(false)); q.setTimeout(900, () => { q.destroy(); res(false); });
  });
  (async () => {
    let up = false;
    for (let i = 0; i < 40 && !up; i++) { up = await alive(); if (!up) await new Promise(r => setTimeout(r, 250)); }
    if (!up) { console.error('✘ 假後端起不來(埠 ' + port + ')'); stop(); process.exit(1); }
    const r = spawnSync(process.execPath, [path.join(root, 'tests', 'ui.test.js'), ...ids],
      { stdio: 'inherit', env: { ...process.env, PORT: String(port) } });
    stop();
    if (r.status !== 0) { console.error('✘ UI 場景測試失敗,停止建置'); process.exit(1); }
    rest();
  })();
} else rest();

function rest() {

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
['index.html', 'css/style.css'].forEach(f => copy(path.join(root, f), path.join(dist, 'site', f)));
/**
 * js/ui.js 是**建置產物**,原始碼在 js/src/*.js(依檔名數字前綴串接)。
 * 串接不做任何轉換,所以產物跟拆檔之前的單一檔案一模一樣 —— 這是「拆檔零風險」的依據。
 */
{
  const { parts, concat } = require('./js/src/_concat');
  const ui = concat();
  try { new Function(ui); } catch (e) {
    console.error('✘ js/src 串接之後語法不正確:' + e.message); process.exit(1);
  }
  if (!/const VIEWS = \{\}/.test(ui) || !/const ACT = \{/.test(ui)) {
    console.error('✘ 串接結果少了 VIEWS 或 ACT,檔案可能漏掉了'); process.exit(1);
  }
  fs.mkdirSync(path.join(dist, 'site/js'), { recursive: true });
  fs.writeFileSync(path.join(dist, 'site/js/ui.js'), ui);
  console.log('  js/src → js/ui.js(' + parts().length + ' 個檔,' + ui.split('\n').length + ' 行)');
}
copy(path.join(root, 'js/connect.js'), path.join(dist, 'site/js/connect.js'), s => s.replace("'__GAS_URL__'", JSON.stringify(cfg.gasUrl)));
/**
 * 檔名後面掛上內容雜湊:GitHub Pages 會讓瀏覽器快取 js/css 一段時間,
 * 沒有這個的話「已經修好並部署了,使用者卻還看到舊版壞掉的畫面」會持續好幾分鐘(踩過)。
 * 內容沒變雜湊就不變,所以平常不會白白重抓。
 */
const stamp = f => require('crypto').createHash('sha256')
  .update(fs.readFileSync(path.join(dist, 'site', f))).digest('hex').slice(0, 8);
const ASSETS = ['css/style.css', 'js/connect.js', 'js/ui.js'];
{
  const idx = path.join(dist, 'site/index.html');
  let html = fs.readFileSync(idx, 'utf8');
  ASSETS.forEach(f => { html = html.split('"' + f + '"').join('"' + f + '?v=' + stamp(f) + '"'); });
  fs.writeFileSync(idx, html);
  const missing = ASSETS.filter(f => !new RegExp(f.replace('.', '\\.') + '\\?v=[0-9a-f]{8}').test(html));
  if (missing.length) { console.error('✘ index.html 少了快取破壞參數:' + missing.join('、')); process.exit(1); }
  /**
   * 建置編號 + version.json。
   * 上面那個 `?v=` 只保護得了 js/css —— index.html 自己被瀏覽器快取住的話,裡面寫的還是舊的 `?v=`,
   * 於是「已經部署好了,使用者重新整理卻還是舊畫面」(2026-09-24 踩到,要硬重新整理才看得到)。
   * 所以另外放一支不進快取的 version.json,前端拿它跟內嵌的建置編號比,不一樣就掛一條「立即更新」。
   */
  const build = require('crypto').createHash('sha256').update(ASSETS.map(stamp).join('|')).digest('hex').slice(0, 8);
  html = html.replace('__BUILD__', build);
  fs.writeFileSync(idx, html);
  if (html.includes('__BUILD__') || html.indexOf('name="build" content="' + build + '"') < 0) {
    console.error('✘ index.html 沒有填入建置編號'); process.exit(1);
  }
  fs.writeFileSync(path.join(dist, 'site/version.json'), JSON.stringify({ build: build }));
}
fs.writeFileSync(path.join(dist, 'site/.nojekyll'), '');
// 後端:原樣複製(.gs 與 appsscript.json;後者由 clasp 自動部署使用,缺了一致性檢查會失敗)
const GAS_FILES = fs.readdirSync(path.join(root, 'gas')).filter(f => f.endsWith('.gs') || f === 'appsscript.json');
GAS_FILES.forEach(f => copy(path.join(root, 'gas', f), path.join(dist, 'gas', f)));

// 單一來源檢查
const diff = [];
// index.html 只允許多出 ?v=<雜湊>,其他一個字都不能差
['index.html', 'css/style.css', 'js/ui.js'].forEach(f => {
  // js/ui.js 沒有單一原始檔,它的「原始碼」就是 js/src 串起來的結果
  const a = f === 'js/ui.js' ? require('./js/src/_concat').concat() : fs.readFileSync(path.join(root, f), 'utf8');
  let b = fs.readFileSync(path.join(dist, 'site', f), 'utf8');
  if (f === 'index.html') b = b.replace(/\?v=[0-9a-f]{8}/g, '').replace(/name="build" content="[0-9a-f]{8}"/, 'name="build" content="__BUILD__"');
  if (a !== b) diff.push(f);
});
// 只比對「有被複製」的那些(過濾條件要跟上面複製那一行一致,不然 gas/ 多放一個檔就會噴 ENOENT)
GAS_FILES.forEach(f => { if (fs.readFileSync(path.join(root, 'gas', f), 'utf8') !== fs.readFileSync(path.join(dist, 'gas', f), 'utf8')) diff.push('gas/' + f); });
const c1 = fs.readFileSync(path.join(root, 'js/connect.js'), 'utf8').split('\n'), c2 = fs.readFileSync(path.join(dist, 'site/js/connect.js'), 'utf8').split('\n');
if (c1.filter((l, i) => l !== c2[i]).length !== 1) diff.push('js/connect.js(應只差 GAS_URL 一行)');
if (diff.length) { console.error('✘ 產物與原始碼不一致:' + diff.join('、')); process.exit(1); }
console.log('✔ 建置完成 → dist/site(前端)、dist/gas(後端)');
}
