// 端到端測試:node tests/e2e.test.js
const assert = require('assert');
const { makeEnv } = require('./fake-gas');
const G = makeEnv();
G.ctx.Memory.setup();
const ok = (a, p, t) => { const r = G.call(a, p, t); if (!r.success) throw new Error(a + ': ' + r.error); assert.strictEqual(r.error, null); return r.data; };
const bad = (a, p, t, re) => { const r = G.call(a, p, t); assert.strictEqual(r.success, false, a + ' should fail'); assert.match(r.error, re); };

// 身份
assert.strictEqual(ok('status').hasUsers, false);
bad('setup', { name: '測試管理者', empNo: '90001' }, null, /PIN/);
const A = ok('setup', { name: '測試管理者', empNo: '90001', pin: '1234', email: 'admin@x.com' }).token;
bad('setup', { name: 'x', empNo: '1', pin: '1234' }, null, /已初始化/);
const imp = ok('importUsers', { rows: [{ empNo: '10231', name: '測試員工A', email: 'ming@x.com' }, { empNo: '10477', name: '測試員工B' }, { empNo: '90001', name: '測試管理者', active: '離職' }] }, A);
assert.deepStrictEqual([imp.created, imp.updated], [2, 1]);
assert.strictEqual(ok('login', { emp: '90001' }).needPin, true);
bad('login', { emp: '90001', pin: '0000' }, null, /不正確/);
const U = ok('login', { emp: '10231' }).token;
const U2 = ok('login', { emp: '10477' }).token;
bad('login', { emp: '99999' }, null, /查無/);
bad('dashboard', {}, U, /管理者權限/);
bad('catalog', {}, 'garbage', /登入已過期/);
bad('nope', {}, U, /未知的操作/);

// 展品
const panel = ok('saveItem', { item: { name: '42吋看板', mode: 'unit', unitCount: 3, category: '看板' } }, A);
const stand = ok('saveItem', { item: { name: '展示架', mode: 'qty', qty: 10 } }, A);
assert.strictEqual(G.sheets['單台編號'].getLastRow(), 4);

// 預約 → 核准 → 可借量
bad('createLoan', { event: 'X', start: '2026-10-01', end: '2026-10-05', lines: [{ itemId: panel.id, qty: 4 }] }, U, /不足/);
const L = ok('createLoan', { event: '台北展', start: '2026-10-01', end: '2026-10-05', lines: [{ itemId: panel.id, qty: 2 }, { itemId: stand.id, qty: 6 }] }, U);
assert.ok(G.mails.some(m => /新借用申請/.test(m.subject) && m.to === 'admin@x.com'), '通知管理者');
ok('approve', { id: L.id }, A);
const chk = ok('check', { start: '2026-10-03', end: '2026-10-08', lines: [{ itemId: panel.id, qty: 2 }] }, U2);
assert.strictEqual(chk[0].short, 1);

// 簽收 → 當面確認
const opt = ok('pickupOptions', { id: L.id }, U); assert.strictEqual(opt[0].units.length, 3);
bad('requestPickup', { id: L.id, units: { [panel.id]: ['E0001'] } }, U, /需要指定 2/);
bad('requestPickup', { id: L.id, units: { [panel.id]: ['E0001', 'E0002'] } }, U2, /不是你的/);
ok('requestPickup', { id: L.id, units: { [panel.id]: ['E0001', 'E0003'] } }, U);
assert.strictEqual(ok('dashboard', {}, A).requests.length, 1);
bad('confirmOnSite', { id: L.id, emp: '10477', pin: 'x' }, U, /不是管理者/);
bad('confirmOnSite', { id: L.id, emp: '90001', pin: '9999' }, U, /不正確/);
let x = ok('confirmOnSite', { id: L.id, emp: '90001', pin: '1234' }, U);
assert.strictEqual(x.status, 'out'); assert.strictEqual(x.lines[0].units.join(), 'E0001,E0003');
assert.strictEqual(ok('lookup', { code: 'e0003' }, U2).loan.applicant, '測試員工A');

// 歸還 → 後台確認
ok('requestReturn', { id: L.id, lines: [{ itemId: panel.id, unitResults: [{ id: 'E0001', result: 'in' }, { id: 'E0003', result: 'repair' }] }, { itemId: stand.id, returned: 5, lost: 1 }] }, U);
assert.strictEqual(ok('loans', { filter: 'request' }, A).length, 1);
x = ok('receive', { id: L.id }, A);
assert.strictEqual(x.status, 'returned');
const items = ok('items', {}, A);
assert.strictEqual(items.find(i => i.id === stand.id).total, 9);
assert.strictEqual(items.find(i => i.id === panel.id).repair, 1);

// 代為登記 + 逾期提醒(排程→邏輯→通知)
const L2 = ok('createLoan', { onBehalf: true, applicant: '10231', event: '拜訪', start: '2026-09-20', end: '2026-09-21', lines: [{ itemId: stand.id, qty: 2 }] }, A);
assert.strictEqual(L2.applicant, '測試員工A'); assert.strictEqual(L2.status, 'approved');
ok('checkout', { id: L2.id }, A);
G.mails.length = 0; G.ctx.dailyReminder();
assert.ok(G.mails.some(m => m.to === 'ming@x.com' && /逾期/.test(m.subject)));
assert.ok(G.mails.some(m => m.to === 'admin@x.com' && /今日逾期 1 筆/.test(m.subject)));

// 盤點
const rep = ok('stocktake', { qty: [{ itemId: stand.id, counted: 6 }], unitItems: [panel.id], seenUnits: ['E0001'], apply: true }, A);
assert.strictEqual(rep.qty[0].diff, -1); assert.strictEqual(rep.missingUnits.map(u => u.id).join(), 'E0002');

// 其他身份規則
bad('saveUser', { user: { id: 'U0002', empNo: '10231', name: '測試員工A', role: 'admin' } }, A, /PIN/);
bad('changePin', { oldPin: '', newPin: '1111' }, U, /不需要/);
for (let i = 0; i < 5; i++) G.call('login', { emp: '90001', pin: 'bad' });
bad('login', { emp: '90001', pin: '1234' }, null, /次數過多/);

// 記憶:表頭依名稱讀取、JSON 欄位
const loanSheet = G.sheets['借用單'];
assert.strictEqual(loanSheet.data[0].join(), G.ctx.Memory.SCHEMA.Loans.join());
assert.ok(ok('logs', {}, A).length > 10, '操作紀錄有寫入');

// ---- 資安:攻擊者視角 ----
bad('saveItem', { item: { name: 'x' } }, null, /登入已過期/);                        // 未登入
bad('approve', { id: L.id }, U, /管理者權限/);                                       // 越權
bad('catalog', { start: '2026-01-01', role: 'admin' }, U, /不接受的參數:role/);      // 白名單外欄位
bad('createLoan', { event: 'x'.repeat(501), start: '2026-10-01', end: '2026-10-02', lines: [] }, U, /文字過長/);
bad('createLoan', { event: '<script>', start: '2026-13-01', end: '2026-10-02', lines: [{ itemId: stand.id, qty: 1 }] }, U, /日期/);
bad('createLoan', { event: 'x', start: '2026-10-01', end: '2026-10-02', lines: [{ itemId: stand.id, qty: -5 }] }, U, /至少選擇/);
bad('toString', {}, U, /未知的操作/);                                                 // 原型鏈名稱
bad('__proto__', {}, U, /未知的操作/);
// 管理者替他人設 PIN → 首次登入必須改
ok('saveUser', { user: { empNo: '90002', name: '測試副管理', role: 'admin', pin: '5678' } }, A);
const G2 = G;   // 同環境
const A2 = ok('login', { emp: '90002', pin: '5678' });
assert.strictEqual(A2.user.mustChangePin, true);
bad('dashboard', {}, A2.token, /請先變更 PIN/);
bad('changePin', { oldPin: '5678', newPin: '5678' }, A2.token, /不可與舊 PIN 相同/);
ok('changePin', { oldPin: '5678', newPin: '8765' }, A2.token);
ok('dashboard', {}, A2.token);
// 登出後 token 失效
const U3 = ok('login', { emp: '10477' }).token;
ok('logout', {}, U3);
bad('catalog', {}, U3, /登入已過期/);
// 內部錯誤只回通用訊息
const orig = G.ctx.Memory.load; G.ctx.Memory.load = () => { throw new TypeError('secret internal detail'); };
const r = G.call('catalog', {}, U); G.ctx.Memory.load = orig;
assert.strictEqual(r.error, '操作失敗,請稍後再試');
// 編輯器函式只限擁有者
const Gx = makeEnv({ activeUser: '' });
assert.throws(() => Gx.ctx.setupSheets(), /擁有者/);
// 紀錄不含 PIN
const logText = JSON.stringify(G.sheets['操作紀錄'].data);
assert.ok(!/5678|8765|1234/.test(logText), '操作紀錄不得含 PIN');
console.log('✔ e2e 全部通過');
