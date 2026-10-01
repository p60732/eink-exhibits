/**
 * 【測試積木】tests/ui.test.js — 前端流程測試的跑者
 * 輸入:tests/ui/*.js 場景檔 + 一個**剛起來的**假後端(node tests/serve.js <port>)
 * 責任:決定要跑哪幾個場景(指定的 + 它們的前置)、依編號順序跑、最後統一檢查 pageerror
 * 輸出:通過與否 + 手機寬度
 * 禁止:不放任何斷言 —— 斷言全部住在場景檔裡,這裡只負責調度
 *
 * 跑法:
 *   node tests/ui.test.js            全部場景(CI 用)
 *   node tests/ui.test.js 05         只跑 05,但會自動先跑它宣告的前置(00、01)
 *   node tests/ui.test.js 05 08      跑兩個場景(各自的前置會自動補上、不會重複跑)
 *
 * ⚠️ 假後端的資料在記憶體,**每次跑之前都要重開**(或換一個新的 port)。
 *    同一個行程跑第二次會卡在「建立管理者」那一步等 30 秒逾時 ——
 *    錯誤訊息看起來像第一步就壞了,其實是狀態沒重設。
 *    不要用 pkill -f tests/serve.js,會連自己的 shell 一起殺掉(exit 144)。
 */
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, 'ui');
const ALL = fs.readdirSync(DIR).filter(f => /^\d\d-.*\.js$/.test(f)).sort()
  .map(f => Object.assign(require(path.join(DIR, f)), { file: f }));
const byId = {}; ALL.forEach(s => { byId[s.id] = s; });

const args = process.argv.slice(2).filter(a => !a.startsWith('-'));
const want = new Set();
function add(id) {
  if (want.has(id)) return;
  const s = byId[id];
  if (!s) { console.error('✘ 沒有這個場景:' + id + '(有的是 ' + ALL.map(x => x.id).join('、') + ')'); process.exit(1); }
  want.add(id);
  (s.needs || []).forEach(add);
}
if (args.length) args.forEach(a => add(String(a).padStart(2, '0').slice(0, 2)));
else ALL.forEach(s => want.add(s.id));
const PLAN = ALL.filter(s => want.has(s.id));

(async () => {
  const C = await require('./ui/_ctx').open();
  const partial = PLAN.length !== ALL.length;
  if (partial) console.log('→ 只跑 ' + PLAN.map(s => s.id).join('、') + '(含前置)');
  for (const s of PLAN) {
    const t0 = Date.now();
    await s.run(C);
    console.log('  ✔ ' + s.id + ' ' + s.title.split('、')[0] + '(' + ((Date.now() - t0) / 1000).toFixed(1) + ' 秒)');
  }
  console.log(C.errs.length ? 'ERR ' + C.errs.join('|')
    : '✔ UI 流程通過' + (partial ? '(部分:' + PLAN.map(s => s.id).join('、') + ')' : ''),
    C.mobileWidth ? 'scrollWidth=' + C.mobileWidth : '');
  if (C.errs.length) process.exit(1);
  await C.b.close();
})().catch(async e => {
  console.error('✘', e.message);
  try { await global.__p.screenshot({ path: '/tmp/ee_fail.png' }); console.error(await global.__p.textContent('#toasts')); } catch (x) { }
  process.exit(1);
});
