// 守門突變測試:逐一拿掉防護,e2e 必須失敗,證明測試真的擋得住。node tests/mutation.test.js
const fs = require('fs'), path = require('path'), os = require('os'), { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const M = [
  ['00_gateway.gs', "if (route.auth === 'admin') Identity.requireAdmin(c.user);", '', '拿掉管理者權限檢查'],
  ['00_gateway.gs', 'checkPayload_(req.payload, route.fields)', '(req.payload || {})', '拿掉參數白名單'],
  ['00_gateway.gs', "err.userFacing ? err.message : '操作失敗,請稍後再試'", 'err.message', '錯誤訊息洩漏內部細節'],
  ['10_identity.gs', '    checkPin_(a, pin);\n    return a;', '    return a;', '當面確認不驗管理者 PIN'],
  ['10_identity.gs', "if (bool(u.mustChange) && ['me', 'changePin', 'logout'].indexOf(action) < 0) throw E('請先變更 PIN');", '', '拿掉首次改 PIN 強制'],
  ['10_identity.gs', "|| String(+u.sessionVer || 0) !== p[1]", '', '登出後 token 仍有效'],
  ['10_identity.gs', 'function guardOk_(k) { return', 'function guardOk_(k) { return true || ', '拿掉 PIN 錯誤次數限制'],
  ['20_logic.gs', 'if (short.length && !(isAdmin && c.p.force)) {', 'if (false) {', '拿掉庫存不足檢查'],
  ['20_logic.gs', "if (L.applicantId !== c.user.id && c.user.role !== 'admin') throw E('這不是你的借用單');", '', '可操作別人的借用單'],
  ['20_logic.gs', "if (!isDate(p.start) || !isDate(p.end)) throw E('請填寫借用起訖日期');", '', '拿掉日期格式驗證']
];
let pass = 0; const fail = [];
M.forEach(([file, find, repl, desc]) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-'));
  fs.readdirSync(path.join(root, 'gas')).forEach(f => fs.copyFileSync(path.join(root, 'gas', f), path.join(dir, f)));
  const src = fs.readFileSync(path.join(dir, file), 'utf8');
  if (!src.includes(find)) { fail.push(desc + '(找不到突變點)'); return; }
  fs.writeFileSync(path.join(dir, file), src.replace(find, repl));
  const r = spawnSync(process.execPath, [path.join(__dirname, 'e2e.test.js')], { env: { ...process.env, GAS_DIR: dir }, encoding: 'utf8' });
  if (r.status !== 0) pass++; else fail.push(desc + '(測試沒有抓到!)');
  fs.rmSync(dir, { recursive: true, force: true });
});
if (fail.length) { console.error('✘ 突變存活:\n  ' + fail.join('\n  ')); process.exit(1); }
console.log('✔ 突變測試 ' + pass + '/' + M.length + ' 皆被擋下');
