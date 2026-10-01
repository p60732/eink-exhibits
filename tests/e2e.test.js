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
const imp = ok('importUsers', { rows: [{ empNo: '10231', name: '測試員工A', email: 'ming@x.com' }, { empNo: '10477', name: '測試員工B', email: 'bee@x.com' }, { empNo: '90001', name: '測試管理者', active: '離職' }] }, A);
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

// 核准即出借(2026-10-01 流程精簡:沒有簽收、沒有點交這兩步了)
// 逐台編號在核准當下自動綁上 —— 不然歸還時一台都對不到
let x = ok('loans', { filter: 'all' }, A).find(l => l.id === L.id);
assert.strictEqual(x.status, 'out', '★ 核准之後直接就是出借中');
assert.strictEqual(x.lines.find(l => l.itemId === panel.id).units.length, 2, '★ 逐台編號要自動指派好');
assert.ok(x.outAt, '核准當下要記下出借時間');
assert.strictEqual(ok('units', { itemId: panel.id }, A).filter(u => u.status === 'out').length, 2,
  '★ 被指派的那兩台要變成「借出」(盤點看得到它們不在架上)');
const gotUnits = x.lines.find(l => l.itemId === panel.id).units;
assert.strictEqual(ok('lookup', { code: gotUnits[1].toLowerCase() }, U2).loan.applicant, '測試員工A');

// 歸還:管理者直接登記,同仁不用先申請
x = ok('receive', { id: L.id, lines: [
  { itemId: panel.id, unitResults: [{ id: gotUnits[0], result: 'in' }, { id: gotUnits[1], result: 'repair' }] },
  { itemId: stand.id, returned: 5, lost: 1 }] }, A);
assert.strictEqual(x.status, 'returned');
const items = ok('items', {}, A);
assert.strictEqual(items.find(i => i.id === stand.id).total, 9);
assert.strictEqual(items.find(i => i.id === panel.id).repair, 1);

// 代為登記 + 逾期提醒(排程→邏輯→通知)
const L2 = ok('createLoan', { onBehalf: true, applicant: '10231', event: '拜訪', start: '2026-09-20', end: '2026-09-21', lines: [{ itemId: stand.id, qty: 2 }] }, A);
assert.strictEqual(L2.applicant, '測試員工A'); assert.strictEqual(L2.status, 'out', '代為登記 = 東西已經交出去了');
// 代為登記已經是出借中,不用再點交
G.mails.length = 0; G.ctx.dailyReminder();
assert.ok(G.mails.some(m => m.to === 'ming@x.com' && /逾期/.test(m.subject)));
assert.ok(G.mails.some(m => m.to === 'admin@x.com' && /今日逾期 1 筆/.test(m.subject)));

// 盤點
// ⚠️ 不要寫死編號:核准時是自動指派的,哪幾台被借走會隨資料改變。
//    盤點只看到第一台,其他「應該在架上」的就是短少。
const onShelf = ok('units', { itemId: panel.id }, A).filter(u => u.status === 'in').map(u => u.id).sort();
const seen = onShelf[0];
const rep = ok('stocktake', { qty: [{ itemId: stand.id, counted: 6 }], unitItems: [panel.id], seenUnits: [seen], apply: true }, A);
assert.strictEqual(rep.qty[0].diff, -1);
assert.strictEqual(rep.missingUnits.map(u => u.id).sort().join(), onShelf.slice(1).join(),
  '在架上卻沒盤到的就是短少');

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

// ---- 借用單流程:改單 / 延期 / 轉借 / 批次核准 ----
const UX = ok('login', { emp: '10477' }).token;   // 測試員工B(先前登出過,重新取得憑證)
// 改單:待審核時可以自己改,不用取消重來
const E1 = ok('createLoan', { event: '初稿', start: '2026-11-10', end: '2026-11-12', lines: [{ itemId: stand.id, qty: 1 }] }, U);
const E1b = ok('updateLoan', { id: E1.id, event: '改過的展', venue: '南港', start: '2026-11-10', end: '2026-11-15', lines: [{ itemId: stand.id, qty: 2 }] }, U);
assert.strictEqual(E1b.event, '改過的展');
assert.strictEqual(E1b.end, '2026-11-15');
assert.strictEqual(E1b.lines[0].qty, 2, '改單要換成新的品項數量');
assert.strictEqual(E1b.status, 'pending', '改完仍是待審核');
bad('updateLoan', { id: E1.id, event: 'x', start: '2026-11-10', end: '2026-11-15', lines: [{ itemId: stand.id, qty: 1 }] }, UX, /不是你的/);
// 批次核准:一次核准多張,失敗的單獨回報
const E2 = ok('createLoan', { event: '同時段A', start: '2026-11-20', end: '2026-11-22', lines: [{ itemId: stand.id, qty: 1 }] }, U);
const E3 = ok('createLoan', { event: '同時段B', start: '2026-11-20', end: '2026-11-22', lines: [{ itemId: stand.id, qty: 1 }] }, UX);
const many = ok('approveMany', { ids: [E1.id, E2.id, E3.id] }, A);
assert.strictEqual(many.ok, 3, '三張都該核准');
assert.strictEqual(many.fail.length, 0);
// 兩張搶同一批:先核准的吃掉庫存,後面那張單獨失敗,不影響前面
const av = ok('check', { start: '2026-11-20', end: '2026-11-22', lines: [{ itemId: stand.id, qty: 1 }] }, U)[0].available;
assert.ok(av >= 1, '測試前提:這段期間還借得到');
const E5 = ok('createLoan', { event: '搶同一批A', start: '2026-11-20', end: '2026-11-22', lines: [{ itemId: stand.id, qty: av }] }, U);
const E6 = ok('createLoan', { event: '搶同一批B', start: '2026-11-20', end: '2026-11-22', lines: [{ itemId: stand.id, qty: av }] }, U);
const mix = ok('approveMany', { ids: [E5.id, E6.id] }, A);
assert.strictEqual(mix.ok, 1, '先到的那張要過');
assert.strictEqual(mix.fail.length, 1, '後到的那張因為量被吃掉要失敗');
assert.strictEqual(mix.fail[0].id, E6.id);
assert.match(mix.fail[0].error, /數量不足/);
ok('cancelLoan', { id: E5.id }, U); ok('cancelLoan', { id: E6.id }, U);
bad('approveMany', { ids: [] }, A, /請先勾選/);
bad('approveMany', { ids: [E1.id] }, U, /管理者權限/);
// 核准後就不能再自己改單了
bad('updateLoan', { id: E1.id, event: '不該改得動', start: '2026-11-10', end: '2026-11-15', lines: [{ itemId: stand.id, qty: 1 }] }, U, /待審核/);
// 已核准的不能再用批次核准,會被單獨列為失敗
const again = ok('approveMany', { ids: [E1.id] }, A);
assert.strictEqual(again.ok, 0);
assert.match(again.fail[0].error, /不是待審核/);
// 延期:2026-10-01 流程精簡之後只剩管理者這一條(同仁要延期就跟管理者說)
bad('extendLoan', { id: E1.id, end: '2026-11-14' }, A, /要比原本的 2026-11-15 晚/);
bad('extendLoan', { id: E1.id, end: '2026-13-01' }, A, /請填寫新的歸還日/);
assert.strictEqual(ok('extendLoan', { id: E1.id, end: '2026-11-25', note: '展期延後' }, A).end, '2026-11-25');
assert.strictEqual(ok('extendLoan', { id: E1.id, end: '2026-11-28' }, A).end, '2026-11-28');
bad('extendLoan', { id: E1.id, end: '2026-11-01' }, A, /要比原本的/);
// 同仁端的六個入口都已經移除 —— 再送就是「未知的操作」
['requestPickup', 'requestReturn', 'requestExtend', 'requestTransfer', 'cancelRequest', 'confirmOnSite']
  .forEach(a => bad(a, { id: E1.id }, U, /未知的操作/));
/**
 * 延期要檢查「延長出來的那一段」有沒有庫存。
 * ⚠️ 2026-10-01 之後的語意:**出借中的單從今天起就佔住**(東西實體已經不在架上),
 * 所以這一段用專屬展品,不受前面累積下來的佔用影響。
 */
const EXT = ok('saveItem', { item: { name: '延期庫存測試機', mode: 'qty', category: 'Signage',
  sites: [{ location: '新竹', qty: 2 }] } }, A);
const H2 = ok('createLoan', { onBehalf: true, applicant: '10231', event: '想延到12月',
  start: '2026-11-05', end: '2026-11-06', lines: [{ itemId: EXT.id, location: '新竹', qty: 1 }] }, A);
/**
 * ⚠️ 12 月要被「只佔住那一段」的東西吃滿,才試得出「延長進去會不足」。
 * 出借中的單一律從**今天**開始佔(東西已經不在架上),所以拿它來吃 12 月的話,
 * 11 月也會一起被吃掉,H2 根本開不出來 —— 真正只佔一段期間的是**展覽卡位**。
 */
let EXS = ok('saveShow', { show: { name: '吃滿12月的展', from: '2026-12-01', to: '2026-12-31',
  venue: '測試', owner: '10231', lines: [{ itemId: EXT.id, location: '新竹', qty: 2 }] } }, A);
EXS = ok('setShowStatus', { id: EXS.id, status: 'confirmed', force: true }, A);
bad('extendLoan', { id: H2.id, end: '2026-12-20' }, A, /延長期間數量不足/);
assert.strictEqual(ok('loans', { filter: 'all' }, A).find(l => l.id === H2.id).end, '2026-11-06', '擋下來之後日期不能被改到');
ok('setShowStatus', { id: EXS.id, status: 'cancelled' }, A);
assert.strictEqual(ok('extendLoan', { id: H2.id, end: '2026-12-20' }, A).end, '2026-12-20', '騰出空間後就延得動');
ok('cancelLoan', { id: H2.id }, A);

// 待審核的不能延期(核准了才有東西可以延)
const E4 = ok('createLoan', { event: '還沒審', start: '2026-12-10', end: '2026-12-12', lines: [{ itemId: stand.id, qty: 1 }] }, U);
bad('extendLoan', { id: E4.id, end: '2026-12-20' }, A, /只有出借中的借用可以延期/);
ok('cancelLoan', { id: E4.id }, U);

// ---- 分類 ----
const cats0 = ok('cats', {}, U);
assert.strictEqual(cats0.slice(0, 7).map(x => x.name).join(), 'eReader,eNote,Logistics & Factory,Prism,Signage,Lifestyle,Mobile & Wearables', '預設七個分類要照順序在最前面');
assert.strictEqual(cats0.find(x => x.name === 'Prism').count, 0, '還沒放東西的分類也要看得到');
assert.strictEqual(cats0.find(x => x.name === '看板').count, 1, '分類要算出底下的展品數');   // 42吋看板
// 新增分類(自己加的)
let cl = ok('saveCat', { cat: { name: '體驗區' } }, A);
assert.ok(cl.some(x => x.name === '體驗區'), '可自行新增分類');
bad('saveCat', { cat: { name: 'ereader' } }, A, /已存在/);        // 不分大小寫視為同一個
bad('saveCat', { cat: { name: '體驗區' } }, A, /已存在/);
// 一般同仁不能改分類
bad('saveCat', { cat: { name: 'X' } }, U, /管理者權限/);
// 改名 → 底下的展品跟著走
const catId = cl.find(x => x.name === '看板').id;
ok('saveCat', { cat: { id: catId, name: '大型看板' } }, A);
assert.strictEqual(ok('items', {}, A).find(i => i.id === panel.id).category, '大型看板', '改名後展品要跟著換');
// 還有展品的分類不能停用
bad('saveCat', { cat: { id: catId, archived: true } }, A, /請先改到其他分類/);
const emptyId = cl.find(x => x.name === '體驗區').id;
cl = ok('saveCat', { cat: { id: emptyId, archived: true } }, A);
assert.strictEqual(cl.find(x => x.id === emptyId).archived, true);
assert.ok(!ok('cats', {}, U).some(x => x.id === emptyId), '停用的分類不出現在挑選清單');
// 調順序
const before = ok('allCats', {}, A).map(x => x.name);
ok('moveCat', { id: cl[0].id, dir: 1 }, A);
const after = ok('allCats', {}, A).map(x => x.name);
assert.strictEqual(after[0], before[1], '往下移一位');
assert.strictEqual(after[1], before[0]);
ok('moveCat', { id: cl[0].id, dir: -1 }, A);
assert.strictEqual(ok('allCats', {}, A).map(x => x.name).join(), before.join(), '再移回來要一樣');
assert.strictEqual(ok('allCats', {}, A)[0].name, before[0]);

// ---- 刪除展品 / 照片上傳 ----
// 借過的不能刪,只能下架
bad('deleteItem', { id: panel.id }, A, /筆借用紀錄.*下架/s);
assert.ok(ok('items', {}, A).some(i => i.id === panel.id), '擋下來之後展品還要在');
// 沒借過的可以刪,連帶把單台編號一起刪掉
const D1 = ok('saveItem', { item: { name: '建錯的看板', mode: 'unit', unitCount: 3, category: 'Signage' } }, A);
assert.strictEqual(ok('units', { itemId: D1.id }, A).length, 3);
const delRes = ok('deleteItem', { id: D1.id }, A);
assert.strictEqual(delRes.units, 3, '單台編號要一起刪掉');
assert.ok(!ok('items', {}, A).some(i => i.id === D1.id), '刪掉之後就不該出現');
assert.ok(!ok('units', {}, A).some(u => u.itemId === D1.id), '單台編號也不該留下');
bad('deleteItem', { id: D1.id }, A, /找不到展品/);
bad('deleteItem', { id: stand.id }, U, /管理者權限/);
// 刪除有寫進操作紀錄
assert.ok(ok('logs', { limit: 50 }, A).some(l => l.action === '刪除展品' && /建錯的看板/.test(l.detail)), '刪除要留下紀錄');
// 照片上傳:回傳可直接顯示的連結
const img = ok('uploadImage', { name: '看板正面', data: Buffer.from('fake-image').toString('base64'), ext: 'jpeg' }, A);
assert.match(img.url, /^https:\/\/drive\.google\.com\/thumbnail\?id=/);
bad('uploadImage', { name: 'x', data: '', ext: 'jpeg' }, A, /沒有收到照片內容/);
bad('uploadImage', { name: 'x', data: 'AAAA', ext: 'gif' }, A, /只接受 JPG/);
bad('uploadImage', { name: 'x', data: 'A'.repeat(410000), ext: 'jpeg' }, A, /照片太大/);      // 檔案積木自己的上限
bad('uploadImage', { name: 'x', data: 'A'.repeat(420001), ext: 'jpeg' }, A, /文字過長/);      // 守門的外層上限
bad('uploadImage', { name: 'x', data: 'AAAA', ext: 'jpeg' }, U, /管理者權限/);
// 一般欄位的長度上限沒有被放寬
bad('saveItem', { item: { name: 'x'.repeat(501) } }, A, /文字過長/);

/* ===== 展覽:規劃 → 卡位 → 開單 → 批次延期 → 結案 =====
 * 最重要的一條在「開單之後可借量不可以再掉一次」——
 * 展覽卡位與借用單佔用如果重複計算,同一批東西會被扣兩次,而且不會報任何錯。
 */
const expo = ok('saveItem', { item: { name: '展覽用展示機', mode: 'qty', category: 'Signage', sites: [{ location: '新竹', qty: 10 }] } }, A);
const availAt = (a, b) => ok('check', { start: a, end: b, lines: [{ itemId: expo.id, location: '新竹', qty: 1 }] }, U)[0].available;
const avail = () => availAt('2027-03-02', '2027-03-04');
assert.strictEqual(avail(), 10, '還沒有任何展覽時全部可借');

// 規劃中不卡位
let SH = ok('saveShow', { show: { name: '春季巡迴展', from: '2027-03-01', to: '2027-03-10', venue: '南港展覽館', owner: '10231',
  lines: [{ itemId: expo.id, location: '新竹', qty: 5 }] } }, A);
assert.strictEqual(SH.status, 'draft');
assert.strictEqual(SH.lines[0].need, 5, '還沒開單,整個規劃量都還要借');
assert.strictEqual(avail(), 10, '「規劃中」不可以卡位');
bad('setShowStatus', { id: SH.id, status: 'closed' }, A, /不能直接改成/);
bad('createLoansFromShow', { id: SH.id }, A, /改成「已確認」/);

// 確認檔期 → 開始卡位
SH = ok('setShowStatus', { id: SH.id, status: 'confirmed' }, A);
assert.strictEqual(avail(), 5, '確認之後展覽要卡住 5 台');
bad('setShowStatus', { id: SH.id, status: 'nonsense' }, A, /不認得/);

/* 待審核的單還沒佔住庫存,所以展覽不可以放手 ——
 * 如果展覽這時就把那一份讓出去,審核那段時間就是空窗,別人剛好可以把東西搶走。 */
const PS = ok('createLoan', { event: '插隊測試', start: '2027-03-02', end: '2027-03-04',
  lines: [{ itemId: expo.id, location: '新竹', qty: 5 }], showId: SH.id }, A);
assert.strictEqual(PS.status, 'pending');
assert.strictEqual(avail(), 5, '★ 底下只有一張待審核的單時,展覽要繼續卡著 5 台(放手的話會變成 10)');
ok('cancelLoan', { id: PS.id, reason: '測試' }, A);
assert.strictEqual(avail(), 5, '取消之後那一份回到展覽身上');
bad('createLoan', { event: '同仁不能掛展覽', start: '2027-03-02', end: '2027-03-04',
  lines: [{ itemId: expo.id, location: '新竹', qty: 1 }], showId: SH.id }, U, /只有管理者/);

// 產生借用單:卡位讓給借用單,合計不變 —— 這條紅了就是重複扣庫存
const gen = ok('createLoansFromShow', { id: SH.id }, A);
assert.strictEqual(gen.ok, 1, '只有新竹有東西,應該只開一張單');
assert.strictEqual(avail(), 5, '★ 開單之後可借量必須維持 5(重複扣的話會變成 0)');
const SL = gen.ids[0];
SH = ok('show', { id: SH.id }, A);
assert.strictEqual(SH.lines[0].issued, 5, '已開單量');
assert.strictEqual(SH.lines[0].need, 0, '不用再開單了');
assert.deepStrictEqual([SH.loanCount, SH.liveCount], [2, 1], '取消掉的那張仍留在歷史裡,但不算「還在跑」');
assert.strictEqual(ok('loans', { filter: 'all' }, A).find(L => L.id === SL).showName, '春季巡迴展', '借用單要看得到屬於哪一場');

// 展期往後延 → 底下的單不會自動跟著改,要看得見,然後批次延期
SH = ok('saveShow', { show: { id: SH.id, name: '春季巡迴展', from: '2027-03-01', to: '2027-03-20', owner: '10231',
  lines: [{ itemId: expo.id, location: '新竹', qty: 5 }] } }, A);
assert.deepStrictEqual(SH.mismatch, [SL], '改了檔期之後要指出哪幾張單的日期對不上');
const extMany = ok('extendMany', { ids: [SL], end: '2027-03-20', note: '展期延長' }, A);
assert.deepStrictEqual([extMany.ok, extMany.fail.length], [1, 0]);
assert.strictEqual(ok('show', { id: SH.id }, A).mismatch.length, 0, '延期之後就對得上了');
// 批次裡有一張過不了,只回報那一張,不會整批失敗
const extBad = ok('extendMany', { ids: [SL, 'L-沒這張'], end: '2027-03-15' }, A);
assert.strictEqual(extBad.ok, 0);
assert.strictEqual(extBad.fail.length, 2);
assert.match(extBad.fail[0].error, /要比原本的/);
assert.match(extBad.fail[1].error, /找不到借用單/);
bad('extendMany', { ids: [], end: '2027-03-25' }, A, /請先勾選/);

// 缺口:第二場要 8 台,只剩 5 台 → 要明確認帳才能確認
let SH2 = ok('saveShow', { show: { name: '同期的另一場', from: '2027-03-05', to: '2027-03-08', owner: '10477',
  lines: [{ itemId: expo.id, location: '新竹', qty: 8 }] } }, A);
assert.strictEqual(SH2.lines[0].short, 3, '應該算得出缺 3 台');
bad('setShowStatus', { id: SH2.id, status: 'confirmed' }, A, /缺 3/);
SH2 = ok('setShowStatus', { id: SH2.id, status: 'confirmed', force: true }, A);
assert.strictEqual(SH2.status, 'confirmed');
assert.strictEqual(avail(), 5, '第二場的檔期沒蓋到 3/02~3/04,不該影響那幾天');
assert.strictEqual(availAt('2027-03-06', '2027-03-07'), 0, '第二場的檔期內被卡光(借用單 5 + 第二場 8 > 10)');
ok('deleteShow', { id: SH2.id }, A);           // 沒有借用單才可以刪
assert.strictEqual(availAt('2027-03-06', '2027-03-07'), 5, '刪掉之後卡位要跟著釋放');

// 結案前底下不能還有沒結束的單
bad('setShowStatus', { id: SH.id, status: 'closed' }, A, /沒結束的借用單/);
bad('deleteShow', { id: SH.id }, A, /不能刪除/);
ok('receive', { id: SL, lines: [{ itemId: expo.id, location: '新竹', returned: 5 }] }, A);
SH = ok('setShowStatus', { id: SH.id, status: 'closed' }, A);
assert.strictEqual(SH.status, 'closed');
assert.strictEqual(avail(), 10, '結案之後全部釋放');

// 編輯中的試算(還沒存檔也要算得出缺口)
const pre = ok('showCheck', { from: '2027-03-01', to: '2027-03-10', lines: [{ itemId: expo.id, location: '新竹', qty: 12 }] }, A);
assert.deepStrictEqual([pre[0].available, pre[0].short], [10, 2]);


/* ===== 審查抓到的回歸案例(v2.2)=====
 * 這一段每一條都先在未修正的版本上重現過,確認會給出錯的結果,才寫成測試。
 */
const RG = ok('saveItem', { item: { name: '回歸用單台機', mode: 'unit', unitCount: 2, category: '體驗區', location: '新竹' } }, A);
const RQ = ok('saveItem', { item: { name: '回歸用雙廠機', mode: 'qty', category: '體驗區', sites: [{ location: '新竹', qty: 5 }, { location: '林口', qty: 5 }] } }, A);

// 1. 同一台編號送兩次,只能算一次 —— 否則單子提早結案,另一台永遠卡在「借出中」
const R1 = ok('createLoan', { event: '重複歸還', start: '2026-09-22', end: '2026-09-30',
  lines: [{ itemId: RG.id, location: '新竹', qty: 2 }], onBehalf: true, applicant: '10231' }, A);
// 代為登記的當下就已經自動綁好編號了,直接讀回來用
const RU = R1.lines[0].units;
assert.strictEqual(RU.length, 2, '★ 代為登記要自動指派兩台');
let r1 = ok('receive', { id: R1.id, lines: [{ itemId: RG.id, location: '新竹',
  unitResults: [{ id: RU[0], result: 'in' }, { id: RU[0], result: 'in' }] }] }, A);
assert.strictEqual(r1.status, 'out', '★ 只還了一台,單子不可以變成已歸還');
assert.strictEqual(r1.lines[0].returned, 1, '★ 同一台送兩次只能算一次');
ok('receive', { id: R1.id, lines: [{ itemId: RG.id, location: '新竹', unitResults: [{ id: RU[1], result: 'in' }] }] }, A);
assert.strictEqual(ok('units', { itemId: RG.id }, A).every(u => u.status === 'in'), true, '兩台都回到在庫');

// 2. 歸還只送一個地點時,不可以套用到同品項的另一個地點
const R2 = ok('createLoan', { event: '兩地借用', start: '2026-09-22', end: '2026-09-30',
  lines: [{ itemId: RQ.id, location: '新竹', qty: 3 }, { itemId: RQ.id, location: '林口', qty: 2 }],
  onBehalf: true, applicant: '10231' }, A);
const r2 = ok('receive', { id: R2.id, lines: [{ itemId: RQ.id, location: '新竹', returned: 3 }] }, A);
assert.strictEqual(r2.status, 'out', '★ 林口還沒還,整張單不可以結案');
assert.strictEqual(r2.lines.find(l => l.location === '林口').returned, 0, '★ 林口那行不可以被新竹的數量帶著還掉');
ok('receive', { id: R2.id, lines: [{ itemId: RQ.id, location: '林口', returned: 2 }] }, A);

// 3. 取消核准:東西要拿回來(單台放回架上),而且不能再延期
const R3 = ok('createLoan', { event: '取消核准測試', start: '2026-09-25', end: '2026-09-28', lines: [{ itemId: RQ.id, location: '新竹', qty: 1 }] }, U);
ok('approve', { id: R3.id }, A);
ok('reject', { id: R3.id, note: '不准' }, A);
bad('extendLoan', { id: R3.id, end: '2026-11-30' }, A, /只有出借中的借用可以延期/);
// 已經登記過歸還的就不能整張收回去了
const R3b = ok('createLoan', { event: '還一半不給取消', start: '2026-09-25', end: '2026-09-28', lines: [{ itemId: RQ.id, location: '新竹', qty: 2 }] }, U);
ok('approve', { id: R3b.id }, A);
ok('receive', { id: R3b.id, lines: [{ itemId: RQ.id, location: '新竹', returned: 1 }] }, A);
bad('reject', { id: R3b.id, note: '反悔' }, A, /已經登記過歸還/);
bad('cancelLoan', { id: R3b.id }, A, /已經登記過歸還/);
ok('receive', { id: R3b.id, lines: [{ itemId: RQ.id, location: '新竹', returned: 1 }] }, A);

// 4. 取消核准要把單台編號放回架上 —— 不放回去的話那幾台永遠卡在「借出」
const R4 = ok('createLoan', { event: '放回編號測試', start: '2026-09-22', end: '2026-09-28', lines: [{ itemId: RG.id, location: '新竹', qty: 1 }] }, U);
ok('approve', { id: R4.id }, A);
const r4u = ok('loans', { filter: 'all' }, A).find(L => L.id === R4.id).lines[0].units[0];
assert.strictEqual(ok('units', { itemId: RG.id }, A).find(u => u.id === r4u).status, 'out', '核准之後那一台是借出');
ok('cancelLoan', { id: R4.id }, A);
assert.strictEqual(ok('units', { itemId: RG.id }, A).find(u => u.id === r4u).status, 'in',
  '★ 取消之後那一台要回到在庫,不然盤點永遠對不起來');

// 5. 展覽卡位:部分歸還不可以把展期內的庫存放給別人
const RS0 = ok('saveItem', { item: { name: '回歸用展覽機', mode: 'qty', category: '體驗區', sites: [{ location: '新竹', qty: 10 }] } }, A);
let RS = ok('saveShow', { show: { name: '回歸展', from: '2027-06-01', to: '2027-06-30', owner: '10231',
  lines: [{ itemId: RS0.id, location: '新竹', qty: 10 }] } }, A);
RS = ok('setShowStatus', { id: RS.id, status: 'confirmed' }, A);
const RSg = ok('createLoansFromShow', { id: RS.id }, A);
const rsAvail = () => ok('check', { start: '2027-06-10', end: '2027-06-11', lines: [{ itemId: RS0.id, location: '新竹', qty: 1 }] }, U)[0].available;
assert.strictEqual(rsAvail(), 0, '全部借出時展期內可借 0');
ok('receive', { id: RSg.ids[0], lines: [{ itemId: RS0.id, location: '新竹', returned: 4 }] }, A);
assert.strictEqual(rsAvail(), 0, '★ 還回 4 台,展覽要把那份重新佔住,不可以放給別人');

// 6. 已結案 / 已取消的展覽不能再掛新單
ok('receive', { id: RSg.ids[0], lines: [{ itemId: RS0.id, location: '新竹', returned: 6 }] }, A);
RS = ok('setShowStatus', { id: RS.id, status: 'closed' }, A);
bad('createLoan', { event: '結案後插隊', start: '2027-06-02', end: '2027-06-03',
  lines: [{ itemId: RS0.id, location: '新竹', qty: 1 }], showId: RS.id, onBehalf: true, applicant: '10231' }, A, /不能再掛新的借用單/);

// 7. 有待審核的申請時不可以下架
const R7 = ok('createLoan', { event: '下架測試', start: '2026-12-20', end: '2026-12-22', lines: [{ itemId: RQ.id, location: '新竹', qty: 1 }] }, U);
bad('archiveItem', { id: RQ.id, archived: true }, A, /待審核/);
ok('cancelLoan', { id: R7.id, reason: '測試完畢' }, U);

// 8. 某地點的單台全部點到 → 最後盤點日要算得出來(讀取規格少了 countedAt 就會永遠是空的)
ok('stocktake', { location: '新竹', unitItems: [RG.id], seenUnits: RU, apply: true }, A);
const rgView = ok('items', {}, A).find(x => x.id === RG.id);
assert.strictEqual((rgView.sites.find(g => g.location === '新竹') || {}).countedAt, '2026-09-22', '★ 該地點全部點到,最後盤點日要填上');
// 展覽清單的分類也要讀得到(ITEM_CALC 原本沒宣告 category,只是剛好被連續段順便讀到)
assert.strictEqual(ok('show', { id: SH.id }, A).lines[0].category, 'Signage', '展覽需求清單要帶得出分類');

/* ===== v2.4:有多少開多少 / 缺口是誰佔的 / 展覽總清單 ===== */
{
  // 10 台的品項,先被別人借走 4 台,展覽規劃 8 台 → 只借得到 6 台
  const PV = ok('saveItem', { item: { name: '部分開單用機', mode: 'qty', category: '體驗區', sites: [{ location: '新竹', qty: 10 }] } }, A);
  const other = ok('createLoan', { event: '先卡住的單', start: '2027-04-01', end: '2027-04-10',
    lines: [{ itemId: PV.id, location: '新竹', qty: 4 }], onBehalf: true, applicant: '10477' }, A);   // 代為登記 = 直接已核准
  let PS = ok('saveShow', { show: { name: '部分開單測試展', from: '2027-04-02', to: '2027-04-08', owner: '10231',
    lines: [{ itemId: PV.id, location: '新竹', qty: 8 }] } }, A);
  assert.deepStrictEqual([PS.lines[0].available, PS.lines[0].short], [6, 2], '規劃 8 只借得到 6');
  PS = ok('setShowStatus', { id: PS.id, status: 'confirmed', force: true }, A);

  // ★ 有多少開多少:開 6 台,剩下 2 台留在清單上
  const gen = ok('createLoansFromShow', { id: PS.id }, A);
  assert.strictEqual(gen.ok, 1, '應該開得出一張');
  assert.strictEqual(gen.short.length, 1);
  assert.deepStrictEqual([gen.short[0].want, gen.short[0].got, gen.short[0].short], [8, 6, 2], '★ 要開得出來的那 6 台,不是硬開 8 台');
  const made = ok('loans', { filter: 'all' }, A).find(x => x.id === gen.ids[0]);
  assert.strictEqual(made.lines[0].qty, 6, '★ 借用單上只能是 6 台 —— 硬開 8 台之後點交一定對不起來');
  PS = ok('show', { id: PS.id }, A);
  assert.deepStrictEqual([PS.lines[0].issued, PS.lines[0].need], [6, 2], '★ 缺的 2 台要留在需求清單上');

  // ★ 剩下的 2 台展覽要繼續卡著,不可以放給別人
  const freeNow = ok('check', { start: '2027-04-03', end: '2027-04-05', lines: [{ itemId: PV.id, location: '新竹', qty: 1 }] }, A)[0].available;
  assert.strictEqual(freeNow, 0, '★ 開完單之後那 2 台仍然被展覽卡著(放掉的話就變成 2)');

  // 一台都借不到時要講清楚,而且不可以留下半張空單
  const ZR = ok('saveItem', { item: { name: '完全借不到的機', mode: 'qty', category: '體驗區', sites: [{ location: '新竹', qty: 2 }] } }, A);
  const eat = ok('createLoan', { event: '吃光光', start: '2027-04-01', end: '2027-04-10',
    lines: [{ itemId: ZR.id, location: '新竹', qty: 2 }], onBehalf: true, applicant: '10477' }, A);
  let ZS = ok('saveShow', { show: { name: '完全沒貨的展', from: '2027-04-03', to: '2027-04-06', owner: '10231',
    lines: [{ itemId: ZR.id, location: '新竹', qty: 2 }] } }, A);
  ZS = ok('setShowStatus', { id: ZS.id, status: 'confirmed', force: true }, A);
  bad('createLoansFromShow', { id: ZS.id }, A, /一台都借不到/);
  assert.strictEqual(ok('show', { id: ZS.id }, A).loanCount, 0, '★ 開不出來就不可以留下半張單');

  // 進貨之後再按一次,就會把剩下的補開
  const grown = ok('items', {}, A).find(x => x.id === PV.id);
  ok('saveItem', { item: { id: PV.id, name: grown.name, mode: 'qty', category: grown.category, sites: [{ location: '新竹', qty: 12 }] } }, A);
  const gen2 = ok('createLoansFromShow', { id: PS.id }, A);
  assert.strictEqual(gen2.ok, 1);
  assert.strictEqual(gen2.short.length, 0, '★ 進貨之後缺口就補得齊了');
  assert.strictEqual(ok('show', { id: PS.id }, A).lines[0].need, 0, '補開之後不用再開單了');

  // ---- 缺口是誰佔的 ----
  const h = ok('holders', { itemId: ZR.id, location: '新竹', from: '2027-04-03', to: '2027-04-06' }, A);
  assert.strictEqual(h.loans.length, 1);
  assert.strictEqual(h.loans[0].id, eat.id);
  assert.strictEqual(h.loans[0].applicant, '測試員工B', '管理者看得到借用人');
  assert.strictEqual(h.loanQty, 2);
  assert.strictEqual(h.available, 0);
  // 同仁看得到數量與歸還日,看不到姓名
  const hu = ok('holders', { itemId: ZR.id, location: '新竹', from: '2027-04-03', to: '2027-04-06' }, U);
  assert.strictEqual(hu.loans[0].applicant, undefined, '★ 同仁不該看到別人的姓名');
  assert.strictEqual(hu.loans[0].end, '2027-04-10', '但歸還日要看得到');
  // ★ 展覽已經整批開成借用單的那一段,不可以在「展覽卡位」那邊再列一次(會變成看起來被佔兩倍)
  {
    const hp = ok('holders', { itemId: PV.id, location: '新竹', from: '2027-04-03', to: '2027-04-05' }, A);
    assert.ok(!hp.shows.some(x => x.id === PS.id), '★ 規劃量已經全部開成單了,展覽那邊不可以再列一次');
    assert.strictEqual(hp.showQty, 0);
    assert.strictEqual(hp.loanQty, 12, '三張單加起來 4 + 6 + 2');
  }
  // ★ 已經還完的行不可以被列進來(單子還沒結案時,某一行可能已經全還了)
  {
    const X1 = ok('saveItem', { item: { name: '兩項單甲', mode: 'qty', category: '體驗區', sites: [{ location: '新竹', qty: 3 }] } }, A);
    const X2 = ok('saveItem', { item: { name: '兩項單乙', mode: 'qty', category: '體驗區', sites: [{ location: '新竹', qty: 3 }] } }, A);
    const TL = ok('createLoan', { event: '兩項的單', start: '2026-09-20', end: '2026-11-30',
      lines: [{ itemId: X1.id, location: '新竹', qty: 3 }, { itemId: X2.id, location: '新竹', qty: 3 }],
      onBehalf: true, applicant: '10477' }, A);
    ok('receive', { id: TL.id, lines: [{ itemId: X1.id, location: '新竹', returned: 3 }] }, A);
    assert.strictEqual(ok('loans', { filter: 'all' }, A).find(x => x.id === TL.id).status, 'out', '另一項還沒還,單子仍然是出借中');
    const h1 = ok('holders', { itemId: X1.id, location: '新竹', from: '2026-10-01', to: '2026-10-05' }, A);
    assert.strictEqual(h1.loans.length, 0, '★ 這一項已經全部還回來了,不可以還列在「誰佔著」裡面');
    const h2 = ok('holders', { itemId: X2.id, location: '新竹', from: '2026-10-01', to: '2026-10-05' }, A);
    assert.strictEqual(h2.loanQty, 3, '沒還的那一項才要列');
  }
  bad('holders', { itemId: 'P-沒這個', from: '2027-04-03', to: '2027-04-06' }, A, /找不到展品/);
  bad('holders', { itemId: ZR.id, from: '2027-04-06', to: '2027-04-03' }, A, /不可早於/);

  // ---- 展覽總清單 ----
  const sheet = ok('showSheet', { id: PS.id }, A);
  assert.strictEqual(sheet.groups.length, 1);
  assert.strictEqual(sheet.groups[0].location, '新竹');
  assert.strictEqual(sheet.totals.planned, 8);
  assert.strictEqual(sheet.totals.issued, 8);
  assert.strictEqual(sheet.groups[0].rows[0].loans.length, 2, '兩次開單都要列出來');
  assert.strictEqual(sheet.ownerName, '測試員工A', '要帶出承辦人姓名,不能只有工號');
  // ★ 規劃中就要出得來 —— 備料本來就發生在開單之前
  const DR = ok('saveShow', { show: { name: '還在規劃的展', from: '2027-07-01', to: '2027-07-05', owner: '10231',
    lines: [{ itemId: PV.id, location: '新竹', qty: 3 }] } }, A);
  const ds = ok('showSheet', { id: DR.id }, A);
  assert.strictEqual(ds.status, 'draft');
  assert.deepStrictEqual([ds.totals.planned, ds.totals.issued, ds.totals.need], [3, 0, 3], '★ 規劃中也要算得出來');
  ok('deleteShow', { id: DR.id }, A);
}

/* ===== v2.3:展後結算 / 批次申請歸還 / 封存到歷史表 ===== */

// ---- 展後結算 ----
// SH(春季巡迴展)已結案:規劃 5、實際借出 5、已歸還 5、未歸還 0;另有一張取消的單不該被算進去
const st1 = ok('showSettle', { id: SH.id }, A);
assert.strictEqual(st1.archived, false, '還沒封存 → 即時算');
assert.deepStrictEqual(
  [st1.totals.planned, st1.totals.issued, st1.totals.returned, st1.totals.lost, st1.totals.unreturned],
  [5, 5, 5, 0, 0], '結算四欄');
assert.strictEqual(st1.lines.length, 1);
assert.strictEqual(st1.lines[0].location, '新竹');

// 短少要進「短少」而不是「未歸還」
const SS0 = ok('saveItem', { item: { name: '結算用展品', mode: 'qty', category: '體驗區', sites: [{ location: '林口', qty: 6 }] } }, A);
let SS = ok('saveShow', { show: { name: '結算測試展', from: '2027-08-01', to: '2027-08-10', venue: '世貿', owner: '10231',
  lines: [{ itemId: SS0.id, location: '林口', qty: 6 }] } }, A);
SS = ok('setShowStatus', { id: SS.id, status: 'confirmed' }, A);
const SSg = ok('createLoansFromShow', { id: SS.id }, A);
const SSL = SSg.ids[0];
// 規劃 6、借出 6、還 4、短少 1 → 未歸還 1
ok('receive', { id: SSL, lines: [{ itemId: SS0.id, location: '林口', returned: 4, lost: 1 }] }, A);
const st2 = ok('showSettle', { id: SS.id }, A);
assert.deepStrictEqual(
  [st2.totals.planned, st2.totals.issued, st2.totals.returned, st2.totals.lost, st2.totals.unreturned],
  [6, 6, 4, 1, 1], '★ 短少要算進 lost,剩下的才是未歸還');
assert.deepStrictEqual(st2.lines[0].loans, [SSL], '結算要指得出是哪張單');

// ---- 批次登記歸還 ----
bad('returnMany', { id: SS.id, ids: [] }, A, /請先勾選/);
const rm1 = ok('returnMany', { id: SS.id, ids: [SSL], note: '撤場' }, A);
assert.deepStrictEqual([rm1.ok, rm1.fail.length], [1, 0], '批次歸還應該成功一張');
// 2026-10-01 起批次歸還是**直接登記歸還**,不再掛「待確認」的請求
const rmLoan = ok('loans', { filter: 'all' }, A).find(x => x.id === SSL);
assert.strictEqual(rmLoan.status, 'returned', '★ 批次歸還要直接結案,不是掛請求等人確認');
// 已經結案的單再按一次要被擋(而不是重複扣)
const rm2 = ok('returnMany', { id: SS.id, ids: [SSL] }, A);
assert.deepStrictEqual([rm2.ok, rm2.fail.length], [0, 1]);
// 不屬於這場的單要被擋,而且不影響同批其他張
const rm3 = ok('returnMany', { id: SS.id, ids: [SL] }, A);
assert.match(rm3.fail[0].error, /不屬於這場展覽/);
SS = ok('setShowStatus', { id: SS.id, status: 'closed' }, A);

// ---- 封存到歷史表 ----
// 預覽:只列「已結案展覽底下、本身也結束了」的單
const pv = ok('archivePreview', {}, A);
const pvShow = pv.shows.find(x => x.id === SS.id);
assert.ok(pvShow, '結案的展覽要出現在預覽裡');
assert.ok(pvShow.ids.indexOf(SSL) >= 0);
assert.strictEqual(pv.plain.length, 0, '沒勾「一般單」時不可以列出沒掛展覽的單');
assert.ok(ok('archivePreview', { includePlain: true }, A).plain.length > 0, '勾了才列一般單');
// 還沒結案的展覽底下的單絕對不可以被搬走
let OPEN = ok('saveShow', { show: { name: '還沒結案的展', from: '2027-09-01', to: '2027-09-05', owner: '10231',
  lines: [{ itemId: SS0.id, location: '林口', qty: 1 }] } }, A);
OPEN = ok('setShowStatus', { id: OPEN.id, status: 'confirmed' }, A);
const OPENL = ok('createLoansFromShow', { id: OPEN.id }, A).ids[0];
ok('reject', { id: OPENL, note: '測試用' }, A);      // 本身結束了,但展覽還沒結案
assert.ok(!ok('archivePreview', {}, A).shows.some(x => x.id === OPEN.id),
  '★ 展覽還沒結案,底下的單一張都不能搬');

const beforeLoans = ok('loans', { filter: 'all' }, A).length;
const arch = ok('archiveLoans', { ids: pvShow.ids }, A);
assert.strictEqual(arch.moved, pvShow.ids.length, '搬走的張數');
assert.strictEqual(arch.skipped, 0);
assert.deepStrictEqual(arch.shows, [SS.id]);
// 借用單表少了、歷史表多了
assert.strictEqual(ok('loans', { filter: 'all' }, A).length, beforeLoans - pvShow.ids.length, '借用單表要變少');
assert.ok(!ok('loans', { filter: 'all' }, A).some(x => x.id === SSL), '預設看不到封存的單');
const withHist = ok('loans', { filter: 'all', includeHistory: true }, A);
const back = withHist.find(x => x.id === SSL);
assert.ok(back, '★ 勾了「含歷史」就要查得到');
assert.strictEqual(back.archived, true, '要標示這張是封存的');
assert.strictEqual(back.lines[0].returned + back.lines[0].lost, 6, '封存的單內容要完整保留');
assert.strictEqual(G.sheets['借用單歷史'].getLastRow(), pvShow.ids.length + 1, '歷史工作表的列數(含表頭)');

// 封存不可以影響可借量(搬走的都是已結束的單,本來就不佔庫存)
const ssAvail = () => ok('check', { start: '2027-08-02', end: '2027-08-05', lines: [{ itemId: SS0.id, location: '林口', qty: 1 }] }, A)[0].available;
assert.strictEqual(ssAvail(), 5, '★ 封存之後可借量不可以改變(短少 1 台,所以是 5)');

// 結算改看快照 —— 單已經不在借用單表了,數字還是要在
const st3 = ok('showSettle', { id: SS.id }, A);
assert.strictEqual(st3.archived, true);
assert.deepStrictEqual(
  [st3.totals.planned, st3.totals.issued, st3.totals.returned, st3.totals.lost, st3.totals.unreturned],
  [6, 6, 5, 1, 0], '★ 封存之後結算要讀結案當下的快照,不可以歸零');

// 封存過的展覽不准重開、不准刪
bad('setShowStatus', { id: SS.id, status: 'confirmed' }, A, /已經封存/);
bad('deleteShow', { id: SS.id }, A, /已經封存/);

// 封存過的展品仍然不准刪(歷史表裡還有它的借用紀錄)
bad('deleteItem', { id: SS0.id }, A, /已經有 \d+ 筆借用紀錄/);

// 已經搬走的不會再被搬一次
bad('archiveLoans', { ids: pvShow.ids }, A, /沒有符合條件/);
bad('archiveLoans', { ids: ['L-沒這張'] }, A, /沒有符合條件/);

// 上一次「歷史表寫進去了、借用單還沒刪」就斷掉時,重跑要安全
{
  const shGroup = ok('archivePreview', {}, A).shows.find(x => x.id === SH.id);
  assert.ok(shGroup && shGroup.ids.length >= 2, '春季巡迴展底下應該有可封存的單');
  const M3 = G.ctx.Memory, one = M3.load({ Loans: '*' }).Loans.find(L => L.id === shGroup.ids[0]);
  M3.appendHist([one]);                                   // 模擬:上次只寫到這一步就斷了
  const histBefore = G.sheets['借用單歷史'].getLastRow();
  const r = ok('archiveLoans', { ids: shGroup.ids }, A);
  assert.strictEqual(r.skipped, 1, '★ 已經在歷史表裡的那一張要跳過');
  assert.strictEqual(r.moved, shGroup.ids.length - 1);
  assert.strictEqual(G.sheets['借用單歷史'].getLastRow(), histBefore + shGroup.ids.length - 1, '★ 不可以產生重複列');
  const seen = ok('loans', { filter: 'all', includeHistory: true }, A).filter(x => x.id === shGroup.ids[0]);
  assert.strictEqual(seen.length, 1, '★ 同一張單不可以在查詢結果裡出現兩次');
}

// 歷史表只能附加,不可以整張寫回
{
  const M2 = G.ctx.Memory, d = M2.load({ Hist: '*' });
  d._dirty.Hist = 1;
  assert.throws(() => M2.save(d), /只能附加/, '★ 歷史表整張寫回一定要被擋下來');
}

// 單台的借用歷程不可以因為封存而斷掉
{
  const UH0 = ok('saveItem', { item: { name: '歷程用單台機', mode: 'unit', unitCount: 1, category: '體驗區' } }, A);
  const uid = ok('units', { itemId: UH0.id }, A)[0].id;
  let UHS = ok('saveShow', { show: { name: '歷程測試展', from: '2027-10-01', to: '2027-10-05', owner: '10231',
    lines: [{ itemId: UH0.id, qty: 1 }] } }, A);
  UHS = ok('setShowStatus', { id: UHS.id, status: 'confirmed' }, A);
  const uhl = ok('createLoansFromShow', { id: UHS.id }, A).ids[0];
  ok('receive', { id: uhl, lines: [{ itemId: UH0.id, unitResults: [{ id: uid, result: 'in' }] }] }, A);
  ok('setShowStatus', { id: UHS.id, status: 'closed' }, A);
  ok('archiveLoans', { ids: [uhl] }, A);
  const got = ok('lookup', { code: uid }, A);
  assert.ok((got.history || []).some(h => h.id === uhl), '★ 封存之後掃單台還要看得到那一張借用紀錄');
  // 這個展品現在只剩下「封存到歷史表」的借用紀錄,還是不可以刪
  bad('deleteItem', { id: UH0.id }, A, /筆借用紀錄/);
}

// 升級前就已經結案的展覽沒有結算快照 —— 封存時要當場補上,不能讓它變成空的
{
  const AD0 = ok('saveItem', { item: { name: '舊版結案展品', mode: 'qty', category: '體驗區', sites: [{ location: '新竹', qty: 3 }] } }, A);
  let OLD = ok('saveShow', { show: { name: '升級前就結案的展', from: '2027-11-01', to: '2027-11-05', owner: '10231',
    lines: [{ itemId: AD0.id, location: '新竹', qty: 3 }] } }, A);
  OLD = ok('setShowStatus', { id: OLD.id, status: 'confirmed' }, A);
  const ol = ok('createLoansFromShow', { id: OLD.id }, A).ids[0];
  ok('receive', { id: ol, lines: [{ itemId: AD0.id, location: '新竹', returned: 3 }] }, A);
  ok('setShowStatus', { id: OLD.id, status: 'closed' }, A);
  // 直接把 settle 欄清掉,模擬「這一列是舊版寫的,根本沒有這一欄」
  const sh = G.sheets['展覽'], col = sh.data[0].indexOf('settle');
  assert.ok(col >= 0, '展覽表要有 settle 欄');
  const at = sh.data.findIndex((r, i) => i > 0 && r[0] === OLD.id);
  sh.data[at][col] = '';
  G.ctx.PropertiesService.getScriptProperties().setProperty('DBVER', '777001');   // 清掉讀取快取
  assert.strictEqual(ok('showSettle', { id: OLD.id }, A).totals.issued, 3, '清掉快照後仍然算得出來(還沒封存)');
  ok('archiveLoans', { ids: [ol] }, A);
  const after = ok('showSettle', { id: OLD.id }, A);
  assert.strictEqual(after.archived, true);
  assert.deepStrictEqual([after.totals.planned, after.totals.issued, after.totals.returned], [3, 3, 3],
    '★ 舊資料沒有快照時,封存要當場補上,不可以變成 0');
}


// ---- 效能重構的正確性:限縮載入 vs 全部載入,結果必須一致 ----
// 多做一筆封存展品與一筆待審單,讓限縮欄位(archived / status / request)都被走到
const U2b = ok('login', { emp: '10477' }).token;   // 先前登出過,重新取得憑證
const gone = ok('saveItem', { item: { name: '已封存燈箱', mode: 'qty', qty: 4 } }, A);
ok('archiveItem', { id: gone.id, archived: true }, A);
const L3 = ok('createLoan', { event: '待審中', start: '2026-12-01', end: '2026-12-03', lines: [{ itemId: stand.id, qty: 1 }] }, U2b);
ok('approve', { id: L3.id }, A);
// 再留一筆「出借中」且綁到單台的借用單,讓「這台在誰手上」也被比對到
const L4 = ok('createLoan', { event: '出借中的展', start: '2026-11-01', end: '2026-11-05', lines: [{ itemId: panel.id, qty: 1 }] }, U);
ok('approve', { id: L4.id }, A);
const l4u = ok('loans', { filter: 'all' }, A).find(l => l.id === L4.id).lines[0].units[0];
assert.strictEqual(ok('units', { itemId: panel.id }, A).find(u => u.id === l4u).holder.applicant, '測試員工A');

/* 舊資料相容:直接在試算表補一列「只有總數 + 單一地點、沒有 stock 欄」的舊展品 */
(() => {
  const sh = G.sheets['展品'], head = G.ctx.Memory.SCHEMA.Items, row = head.map(h => '');
  const put = (h, v) => row[head.indexOf(h)] = v;
  put('id', 'P9000'); put('name', '舊資料燈箱'); put('category', 'Signage'); put('mode', 'qty');
  put('qty', '7'); put('location', '湖口'); put('archived', 'FALSE');       // 沒有 stock 欄
  sh.getRange(sh.getLastRow() + 1, 1, 1, head.length).setValues([row]);
  G.ctx.Memory.load({});                                                     // 觸發一次讀取,確保快取用的是新版本
})();
const legacy = ok('items', {}, A).find(x => x.id === 'P9000');
assert.strictEqual(legacy.total, 7, '舊資料的總數要讀得到');
assert.deepStrictEqual(legacy.sites.map(g => g.location + g.total), ['湖口7'], '舊資料要自動視為全部放在那個地點');
const LG = ok('createLoan', { event: '舊資料場', start: '2026-12-01', end: '2026-12-03', lines: [{ itemId: 'P9000', qty: 2 }] }, U);
ok('approve', { id: LG.id }, A);
const lgView = ok('items', {}, A).find(x => x.id === 'P9000');
assert.strictEqual(lgView.total, 7, '舊資料的總數要算得出來');
assert.strictEqual(lgView.inStock, 5, '舊資料的在庫量要扣掉已經借出去的 2 台');
assert.strictEqual(LG.lines[0].location, '湖口', '沒指定地點時要自動補上唯一的那個地點');

/* ===== 分地點庫存:同一個展品散在兩個廠區 ===== */
const dual = ok('saveItem', { item: { name: '雙廠展示機', mode: 'qty', category: 'Signage', sites: [{ location: '新竹', qty: 3 }, { location: '林口', qty: 2 }] } }, A);
assert.strictEqual(dual.qty, 5, '總數應為各地相加');
const dualView = ok('items', {}, A).find(x => x.id === dual.id);
assert.deepStrictEqual(dualView.sites.map(g => g.location + g.total), ['新竹3', '林口2']);
// 借新竹的 3 台 → 新竹借光,林口不受影響
const LS = ok('createLoan', { event: '新竹場', start: '2026-11-01', end: '2026-11-05', lines: [{ itemId: dual.id, location: '新竹', qty: 3 }] }, U);
assert.strictEqual(LS.lines[0].location, '新竹', '借用單那一行要記得是哪個廠區的');
ok('approve', { id: LS.id }, A);
assert.strictEqual(ok('check', { start: '2026-11-02', end: '2026-11-03', lines: [{ itemId: dual.id, location: '新竹', qty: 1 }] }, U)[0].short, 1);
assert.strictEqual(ok('check', { start: '2026-11-02', end: '2026-11-03', lines: [{ itemId: dual.id, location: '林口', qty: 2 }] }, U)[0].short, 0);
bad('createLoan', { event: 'X', start: '2026-11-01', end: '2026-11-05', lines: [{ itemId: dual.id, qty: 1 }] }, U, /請指定要從哪一個地點借/);
bad('createLoan', { event: 'X', start: '2026-11-01', end: '2026-11-05', lines: [{ itemId: dual.id, location: '湖口', qty: 1 }] }, U, /沒有庫存/);
// 只盤林口:新竹的那一筆不該進報表,林口盤完差異為 0
const repL = ok('stocktake', { location: '林口', qty: [{ itemId: dual.id, location: '林口', counted: 2 }, { itemId: dual.id, location: '新竹', counted: 0 }], unitItems: [], seenUnits: [], apply: true }, A);
assert.deepStrictEqual(repL.qty.map(x => x.location), ['林口']);
assert.strictEqual(repL.qty[0].diff, 0);
const dual2 = ok('items', {}, A).find(x => x.id === dual.id);
assert.match(dual2.sites.find(g => g.location === '林口').countedAt, /^\d{4}-\d{2}-\d{2}$/, '林口要留下盤點日');
assert.strictEqual(dual2.sites.find(g => g.location === '新竹').countedAt, '', '新竹沒盤到就不該有盤點日');
// 逐台編號也分廠區:點交時不能拿別廠的機器交差
const dualU = ok('saveItem', { item: { name: '雙廠單台機', mode: 'unit', category: 'Signage', unitCount: 2, location: '新竹' } }, A);
const dualUnits = ok('units', { itemId: dualU.id }, A).map(u => u.id);
ok('saveUnit', { unit: { id: dualUnits[0], location: '林口' } }, A);   // 故意讓「別廠的那一台」排在前面
const dualUView = ok('items', {}, A).find(x => x.id === dualU.id);
assert.deepStrictEqual(dualUView.sites.map(g => g.location + g.total).sort(), ['新竹1', '林口1'].sort());
const LU = ok('createLoan', { event: '新竹單台場', start: '2026-11-10', end: '2026-11-12', lines: [{ itemId: dualU.id, location: '新竹', qty: 1 }] }, U);
ok('approve', { id: LU.id }, A);
assert.deepStrictEqual(ok('loans', { filter: 'all' }, A).find(l => l.id === LU.id).lines[0].units, [dualUnits[1]],
  '★ 核准自動綁定時只能挑該廠區在庫的機器,不能拿別廠的交差');
// 只盤林口:新竹那一台沒點到也不算短少(根本不在這一區)
const dualU2 = ok('saveItem', { item: { name: '雙廠單台機B', mode: 'unit', category: 'Signage', unitCount: 2, location: '新竹' } }, A);
const u2 = ok('units', { itemId: dualU2.id }, A).map(u => u.id);
ok('saveUnit', { unit: { id: u2[1], location: '林口' } }, A);
const repU = ok('stocktake', { location: '林口', unitItems: [dualU2.id], seenUnits: [], qty: [], apply: false }, A);
assert.deepStrictEqual(repU.missingUnits.map(u => u.id), [u2[1]], '只盤林口時,新竹的單台不該被當成沒點到');

/* 健康檢查頁必須認得出來:GAS 換版時 POST 會被當成 GET 重送,前端要能分辨 */
const health = JSON.parse(G.ctx.doGet().t);
assert.strictEqual(health.health, true, 'doGet 必須帶 health 記號');
assert.notStrictEqual(health.success, true, 'doGet 不可以長得像一個成功的回應');

const itemCountBefore = ok('items', {}, A).length;
/* ===== 防資料遺失的三道保險 ===== */
{
  const M = G.ctx.Memory;
  // 1. 只讀了一部分卻要整張寫回 → 必須擋下(不然沒讀到的欄位 / 列會被清成空白)
  const part = M.load({ Items: ['id', 'name'] });
  part._dirty.Items = true;
  assert.throws(() => M.save(part), /只讀了一部分/, '欄位限縮後寫回應該被擋下');
  const tail = M.load({ Loans: { cols: '*', only: { field: 'status', values: ['pending'] } } });
  tail._dirty.Loans = true;
  assert.throws(() => M.save(tail), /只讀了一部分/, '只讀未結案的列之後寫回應該被擋下');
  const none = M.load({ Users: '*' });            // 沒被要求的表 = 空陣列,更不可以寫回
  none._dirty.Items = true;
  assert.throws(() => M.save(none), /只讀了一部分/, '根本沒載入的表寫回應該被擋下');
  const whole = M.load();                          // 完整載入才放行
  whole._dirty.Items = true;
  M.save(whole);
  assert.strictEqual(ok('items', {}, A).length, itemCountBefore, '完整載入的寫回不可以動到筆數');

  // 2. 工作表不見了 → 報錯,絕對不可以自動重建並塞回預設值
  const keep = G.sheets['分類'];
  delete G.sheets['分類'];
  assert.throws(() => M.load(), /找不到工作表/, '工作表不見時應該停下報錯');
  assert.ok(!G.sheets['分類'], '報錯之後不可以偷偷把工作表建回來');
  G.sheets['分類'] = keep;
  assert.ok(ok('cats', {}, U).length >= 7, '放回去之後要能正常讀');

  // 3. 表頭對不上(例如開到別的試算表)→ 報錯
  const head = G.sheets['展品'].data[0].slice();
  G.sheets['展品'].data[0] = ['甲', '乙', '丙'];
  G.ctx.PropertiesService.getScriptProperties().setProperty('DBVER', '999999');   // 避開表頭快取
  assert.throws(() => M.load(), /不是這個系統的資料表/, '表頭對不上時應該停下報錯');
  G.sheets['展品'].data[0] = head;
}

/* ===== v2.5.3:離譜的借出 / 歸還日期不可以送得進來 =====
   type=date 打成 0025 或 9999 在日曆上是合法日期,以前一路過關到工作表裡;
   之後逾期天數、可借量、統計全部被那張單帶歪,而且不容易發現是哪一張。 */
{
  const DZ = ok('saveItem', { item: { name: '日期檢查用機', mode: 'qty', category: '體驗區', sites: [{ location: '新竹', qty: 3 }] } }, A);
  const L1 = [{ itemId: DZ.id, location: '新竹', qty: 1 }];
  const mk = (start, end, who) => ({ event: '日期測試', start: start, end: end, lines: L1, onBehalf: true, applicant: '10231' });

  bad('createLoan', mk('0025-10-01', '0025-10-05'), A, /太久以前/);
  bad('createLoan', mk('2026-10-01', '9999-12-31'), A, /太遠/);
  bad('createLoan', mk('2026-10-05', '2026-10-01'), A, /不可早於/);
  bad('createLoan', mk('2026-10-01', '2030-10-01'), A, /超過上限/);   // 四年,單一張單不合理
  // 管理者可以補登舊單,但也只能補到三年內
  bad('createLoan', mk('2020-01-01', '2020-01-05'), A, /太久以前/);
  ok('createLoan', mk('2026-10-01', '2026-10-05'), A);                // 正常的照樣過

  // 展覽檔期走同一套
  bad('saveShow', { show: { name: '年份打錯展', from: '0025-01-01', to: '0025-01-05' } }, A, /太久以前/);
  bad('saveShow', { show: { name: '三年展', from: '2026-10-01', to: '2029-10-01' } }, A, /超過上限/);
  // 試算與「缺口是誰佔的」也不該拿離譜的日期去算
  bad('showCheck', { id: '', from: '2026-10-01', to: '9999-01-01', lines: L1 }, A, /太遠/);
  bad('holders', { itemId: DZ.id, location: '新竹', from: '0025-01-01', to: '0025-01-05' }, A, /太久以前/);
  bad('check', { start: '2026-10-01', end: '9999-01-01', lines: L1 }, A, /太遠/);

  // 延期不可以把整段期間撐過上限,也不可以延到天邊
  const DL = ok('createLoan', { event: '延期上限測試', start: '2026-10-01', end: '2026-10-05',
    lines: L1, onBehalf: true, applicant: '10231' }, A);
  bad('extendLoan', { id: DL.id, end: '9999-01-01' }, A, /太遠/);
  bad('extendLoan', { id: DL.id, end: '2029-10-01' }, A, /超過上限/);
  ok('extendLoan', { id: DL.id, end: '2026-11-05' }, A);
}

/* ===== v2.6:迴圈缺口 =====
   ① 一項都沒登記到的歸還,不可以回報成功、更不可以把單子的狀態動掉
   ② 已停用的人手上還沒還的單,要在總覽看得到 */
{
  const DZ = ok('saveItem', { item: { name: '迴圈檢查機', mode: 'qty', category: '體驗區', sites: [{ location: '新竹', qty: 6 }] } }, A);
  const ln = [{ itemId: DZ.id, location: '新竹', qty: 2 }];
  const mkOut = (ev) => { const L = ok('createLoan', { event: ev, start: '2026-10-01', end: '2026-10-05', lines: ln }, U);
    ok('approve', { id: L.id }, A); return L.id; };   // 核准即出借
  const find = id => ok('loans', { filter: 'all' }, A).find(x => x.id === id);

  // ① 管理者送出一個什麼都沒對到的歸還
  const E1 = mkOut('空歸還測試');
  bad('receive', { id: E1, lines: [{ itemId: DZ.id, location: '林口', returned: 2, to: '林口' }] }, A, /沒有登記到任何一項/);
  bad('receive', { id: E1, lines: [] }, A, /沒有登記到任何一項/);
  bad('receive', { id: E1, lines: [{ itemId: DZ.id, location: '新竹', returned: 0, lost: 0, to: '新竹' }] }, A, /沒有登記到任何一項/);
  const still = find(E1);
  assert.strictEqual(still.status, 'out', '★ 沒登記到任何一項,單子不可以動');
  assert.strictEqual(Number(still.lines[0].returned || 0), 0, '★ 沒登記到任何一項,已還數量不可以被加上去');
  // 正常的部分歸還照樣過
  const half = ok('receive', { id: E1, lines: [{ itemId: DZ.id, location: '新竹', returned: 1, to: '新竹' }] }, A);
  assert.strictEqual(half.status, 'out', '還一半應該還是出借中');
  assert.strictEqual(half.lines[0].returned, 1);
  ok('receive', { id: E1, lines: [{ itemId: DZ.id, location: '新竹', returned: 1, to: '新竹' }] }, A);
  assert.strictEqual(find(E1).status, 'returned', '還完應該結案');
  // 只回報短少也算有動到
  const E2 = mkOut('只短少測試');
  ok('receive', { id: E2, lines: [{ itemId: DZ.id, location: '新竹', returned: 0, lost: 2, to: '新竹' }] }, A);
  assert.strictEqual(find(E2).status, 'returned', '全部回報短少也要結案');

  // 逐台型:只回報「遺失」也算有動到(不然整批遺失的單會被當成空歸還擋下來)
  const DU = ok('saveItem', { item: { name: '迴圈單台機', mode: 'unit', category: '體驗區', location: '新竹' } }, A);
  ok('addUnits', { itemId: DU.id, count: 2, location: '新竹' }, A);
  const dun = ok('units', { itemId: DU.id }, A).map(x => x.id);
  const DL = ok('createLoan', { event: '單台空歸還測試', start: '2026-10-01', end: '2026-10-05',
    lines: [{ itemId: DU.id, location: '新竹', qty: 2 }], onBehalf: true, applicant: '10477' }, A);
  assert.deepStrictEqual(find(DL.id).lines[0].units.slice().sort(), dun.slice().sort(), '代為登記就是已出借,兩台都要綁好');
  const uline = { itemId: DU.id, location: '新竹', to: '新竹' };
  // 每一台都選「未還」(result 空字串會被前端濾掉,這裡直接送空陣列)
  bad('receive', { id: DL.id, lines: [Object.assign({ unitResults: [] }, uline)] }, A, /沒有登記到任何一項/);
  // 對不到的編號也不算
  bad('receive', { id: DL.id, lines: [Object.assign({ unitResults: [{ id: 'E9999', result: 'in' }] }, uline)] }, A, /沒有登記到任何一項/);
  assert.strictEqual(find(DL.id).status, 'out', '★ 單台一台都沒處理,單子不可以動');
  // 兩台都遺失 → 要過,而且單子要結案
  ok('receive', { id: DL.id, lines: [Object.assign({ unitResults: dun.map(x => ({ id: x, result: 'lost' })) }, uline)] }, A);
  assert.strictEqual(find(DL.id).status, 'returned', '★ 全部回報遺失也要結得了案');

  // ② 已停用的人手上還有沒還的單 → 總覽要看得到
  const E3 = mkOut('離職未還測試');
  const uu = ok('users', {}, A).find(x => x.empNo === '10231');
  assert.strictEqual(ok('dashboard', {}, A).leftBehind.length, 0, '停用之前不該有人上榜');
  ok('saveUser', { user: { id: uu.id, empNo: uu.empNo, name: uu.name, active: false } }, A);
  const lb = ok('dashboard', {}, A).leftBehind;
  assert.ok(lb.some(x => x.id === E3), '★ 停用的人手上還沒還的單要出現在總覽');
  assert.ok(!lb.some(x => x.status === 'returned' || x.status === 'cancelled'), '已結束的單不該上榜');
  ok('saveUser', { user: { id: uu.id, empNo: uu.empNo, name: uu.name, active: true } }, A);
  assert.strictEqual(ok('dashboard', {}, A).leftBehind.length, 0, '重新啟用之後就不該再上榜');
  ok('receive', { id: E3, lines: [{ itemId: DZ.id, location: '新竹', returned: 2, to: '新竹' }] }, A);
}

/* ===== 流程精簡 A+B:駁回與歸還都要寄信;數量型可以標損壞(2026-10-01) ===== */
{
  const DM = ok('saveItem', { item: { name: '損壞標記測試機', mode: 'qty', category: '體驗區',
    sites: [{ location: '新竹', qty: 10 }] } }, A);
  const dln = [{ itemId: DM.id, location: '新竹', qty: 4 }];
  const u231 = ok('users', {}, A).find(x => x.empNo === '10231');
  ok('saveUser', { user: { id: u231.id, empNo: '10231', name: u231.name, email: 'ming@x.com', active: true } }, A);
  const UD = ok('login', { emp: '10231' }).token;

  // 不核准 → 申請人與按下駁回的管理者都要收到
  const R1 = ok('createLoan', { event: '駁回要寄兩方', start: '2026-10-01', end: '2026-10-05', lines: dln }, UD);
  G.mails.length = 0;
  ok('reject', { id: R1.id, note: '這批要留給客戶參訪' }, A);
  const rj = G.mails.filter(m => /未核准/.test(m.subject))[0];
  assert.ok(rj, '駁回要寄信');
  assert.ok(/ming@x\.com/.test(rj.to) && /admin@x\.com/.test(rj.to), '★ 不核准也要同步通知兩方');
  assert.ok(/審核人:測試管理者/.test(rj.body), '信裡要寫審核人');

  // 登記歸還 → 兩方都要收到(以前完全沒寄)
  const R2 = ok('createLoan', { event: '歸還要寄兩方', start: '2026-10-01', end: '2026-10-05', lines: dln }, UD);
  ok('approve', { id: R2.id }, A);
  G.mails.length = 0;
  const half = ok('receive', { id: R2.id, lines: [{ itemId: DM.id, location: '新竹', returned: 2, damaged: 1, to: '新竹' }] }, A);
  const m1 = G.mails.filter(m => /部分歸還/.test(m.subject))[0];
  assert.ok(m1, '★ 部分歸還也要寄信');
  assert.ok(/ming@x\.com/.test(m1.to) && /admin@x\.com/.test(m1.to), '★ 歸還要同步通知兩方');
  assert.ok(/1 台損壞/.test(m1.body), '★ 損壞要寫在信裡');

  // 損壞是「已還」的子集:不可以多扣 outstanding
  assert.strictEqual(half.lines[0].returned, 2, '還了 2 台');
  assert.strictEqual(half.lines[0].damaged, 1, '★ 其中 1 台損壞');
  assert.strictEqual(half.lines[0].outstanding, 2, '★ 損壞不可以另外佔 outstanding(還有 2 台沒還)');
  // 損壞不可以大於歸還數 —— 後端要自己夾住
  const over = ok('receive', { id: R2.id, lines: [{ itemId: DM.id, location: '新竹', returned: 1, damaged: 9, to: '新竹' }] }, A);
  assert.strictEqual(over.lines[0].damaged, 2, '★ 損壞要被夾在「這次歸還數」以內(1+1=2)');

  // 全部還完 → 結案信
  G.mails.length = 0;
  const done = ok('receive', { id: R2.id, lines: [{ itemId: DM.id, location: '新竹', returned: 1, to: '新竹' }] }, A);
  assert.strictEqual(done.status, 'returned');
  const m2 = G.mails.filter(m => /已結案/.test(m.subject))[0];
  assert.ok(m2 && /ming@x\.com/.test(m2.to) && /admin@x\.com/.test(m2.to), '★ 結案信也要兩方都收到');
  // 總數不變:損壞的東西還在庫存裡
  assert.strictEqual(ok('items', {}, A).find(i => i.id === DM.id).total, 10, '★ 損壞不影響總數,東西還在');
}

/* ===== 流程精簡 C+D:舊流程的痕跡要真的消失(2026-10-01) =====
   線上資料查過沒有任何卡在「已核准」或掛著 request 的舊單,所以那一整層連同
   checkout / decideRequest / pickupOptions 三條路由一起砍掉了。
   這裡守的是「真的砍乾淨」—— 留著一條叫得動的路,就等於流程還是兩套。 */
['checkout', 'decideRequest', 'pickupOptions', 'requestPickup', 'requestReturn',
  'requestExtend', 'requestTransfer', 'cancelRequest', 'confirmOnSite'].forEach(function (act) {
  bad(act, { id: 'L0001' }, A, /未知的操作/);
  bad(act, { id: 'L0001' }, U, /未知的操作/);
});
// 借用單也不會再帶出 request / stage 這兩個欄位
{
  const anyLoan = ok('loans', { filter: 'all' }, A)[0];
  assert.ok(anyLoan, '前置條件:這時候應該已經有借用單了');
  assert.ok(!('request' in anyLoan), '★ 借用單不該再帶出 request 欄位');
  assert.ok(!('stage' in anyLoan), '★ 借用單不該再帶出 stage 欄位');
  const d0 = ok('dashboard', {}, A);
  assert.ok(!('requests' in d0), '★ 總覽不該再算「待確認」');
  assert.ok(!('pickups' in d0), '★ 總覽不該再算「待點交」');
}

/* ===== 人員管理:部門不再收;沒帶到的欄位不可以被清掉(2026-10-01) ===== */
{
  const mk = r => ok('importUsers', { rows: [r] }, A);
  mk({ empNo: '30001', name: '不收部門', email: 'd1@x.com' });
  const u1 = ok('users', {}, A).find(x => x.empNo === '30001');
  assert.strictEqual(u1.email, 'd1@x.com');

  // ★ 停用 / 啟用時只送了 id / 工號 / 姓名 / active —— email 不可以被清掉
  ok('saveUser', { user: { id: u1.id, empNo: '30001', name: '不收部門', active: false } }, A);
  assert.strictEqual(ok('users', {}, A).find(x => x.id === u1.id).email, 'd1@x.com',
    '★ saveUser 沒帶到的欄位要保留原值(以前會整列覆蓋,把 Email 清掉)');
  ok('saveUser', { user: { id: u1.id, empNo: '30001', name: '不收部門', active: true } }, A);

  // 有送就是要改成那樣,包括清空
  ok('saveUser', { user: { id: u1.id, empNo: '30001', name: '不收部門', email: '', active: true } }, A);
  assert.strictEqual(ok('users', {}, A).find(x => x.id === u1.id).email, '', '有送空字串才是真的要清掉');
  ok('saveUser', { user: { id: u1.id, empNo: '30001', name: '不收部門', email: 'd1@x.com', active: true } }, A);

  // 舊的四欄名單(工號/姓名/部門/Email)照樣匯得進來
  mk({ empNo: '30002', name: '舊格式', dept: '業務部', email: 'd2@x.com' });
  const u2 = ok('users', {}, A).find(x => x.empNo === '30002');
  assert.deepStrictEqual([u2.dept, u2.email], ['業務部', 'd2@x.com'], '舊名單的部門欄還是收得下來(只是不再要求填)');
}

/* ===== 借用申請精簡:聯絡方式自動帶、核准通知兩邊都收得到(2026-10-01) =====
 * 表單只剩「借用目的 + 期間」是必要的,聯絡方式改成從帳號帶。
 * 這裡守的是「帶對人」——帶錯人的話,要聯絡借用人時會打到管理者自己。
 */
{
  // ⚠️ 前面「離職未還」那一段用 saveUser 停用又啟用 10231,卻沒帶 email ——
  //    saveUser 是「整列覆蓋」,沒帶的欄位會被清掉,所以這裡先把 email 補回來。
  //    (同時 sessionVer 被 bump 過,舊 token 失效,要重新登入)
  const u231 = ok('users', {}, A).find(x => x.empNo === '10231');
  ok('saveUser', { user: { id: u231.id, empNo: '10231', name: u231.name, email: 'ming@x.com', active: true } }, A);
  const UA = ok('login', { emp: '10231' }).token, UB = ok('login', { emp: '10477' }).token;
  const CT = ok('saveItem', { item: { name: '精簡表單測試機', mode: 'qty', category: '體驗區',
    sites: [{ location: '新竹', qty: 8 }] } }, A);
  const cln = [{ itemId: CT.id, location: '新竹', qty: 1 }];
  const mk = (p, t) => ok('createLoan', Object.assign({ start: '2026-10-01', end: '2026-10-05', lines: cln }, p), t);

  // 目的沒填就不給送 —— 它現在是整張單子的標題
  bad('createLoan', { event: '', start: '2026-10-01', end: '2026-10-05', lines: cln }, UA, /請填寫借用目的/);

  // 聯絡方式從帳號帶,前端送什麼都不算數
  const C1 = mk({ event: '自動帶入測試', contact: '亂填的分機 9999' }, UA);
  assert.strictEqual(C1.contact, '10231 / ming@x.com', '★ 聯絡方式要從帳號帶(工號 / Email),不可以吃前端送的值');
  assert.strictEqual(mk({ event: '另一個人也帶得到' }, UB).contact, '10477 / bee@x.com', '每個人帶自己帳號裡的');
  // 代為登記:帶的是「被登記的那個人」,不是管理者自己
  assert.strictEqual(mk({ event: '代登記測試', onBehalf: true, applicant: '10231' }, A).contact,
    '10231 / ming@x.com', '★ 代為登記要帶被登記者的聯絡方式,不是管理者自己的');

  // 代為登記對不到帳號就擋下來 —— 放行的話那張單沒有主人:
  // 「我的借用」找不到、離職未還抓不到、通知永遠寄不出去,而且當下看起來完全正常
  bad('createLoan', { event: '查無此人', start: '2026-10-01', end: '2026-10-05', lines: cln,
    onBehalf: true, applicant: '路人甲' }, A, /找不到「路人甲」的帳號/);
  assert.ok(!ok('loans', { filter: 'all' }, A).some(x => x.event === '查無此人'), '★ 擋下來之後不可以留下半張單');

  // 自己補 Email:只能改自己的,而且要是像樣的 Email
  const noMail = ok('importUsers', { rows: [{ empNo: '20001', name: '沒信箱的人' }] }, A);
  assert.strictEqual(noMail.created, 1);
  const UC = ok('login', { emp: '20001' }).token;
  assert.strictEqual(ok('me', {}, UC).email, '', '匯入時沒帶 Email,帳號就是空的');

  // 沒有 Email 的單子一律不收 —— 登入時那道擋板是前端的,舊瀏覽器與代為登記都繞得過去,
  // 繞過去的代價是「核准了卻沒人收到通知」,當事人只會覺得申請完沒下文
  bad('createLoan', { event: '沒信箱也想借', start: '2026-10-01', end: '2026-10-05', lines: cln }, UC,
    /你的帳號還沒有 Email/);
  bad('createLoan', { event: '代沒信箱的人登記', start: '2026-10-01', end: '2026-10-05', lines: cln,
    onBehalf: true, applicant: '20001' }, A, /「沒信箱的人」的帳號還沒有 Email/);
  assert.ok(!ok('loans', { filter: 'all' }, A).some(x => /沒信箱/.test(x.event)), '★ 擋下來之後不可以留下半張單');
  bad('setMyEmail', { email: '不是信箱' }, UC, /正確的 Email/);
  bad('setMyEmail', { email: 'a@b' }, UC, /正確的 Email/);
  assert.strictEqual(ok('setMyEmail', { email: 'new@x.com' }, UC).email, 'new@x.com', '★ 自己補得了 Email');
  assert.strictEqual(ok('me', {}, UC).email, 'new@x.com', '補完要真的存進帳號');
  // 補完之後,他的單子就帶得到 Email,核准通知也寄得到
  const C5 = mk({ event: '補完信箱再申請' }, UC);
  assert.strictEqual(C5.contact, '20001 / new@x.com', '★ 補完 Email 之後,聯絡方式要帶得到');
  G.mails.length = 0;
  ok('approve', { id: C5.id }, A);
  assert.ok(/new@x\.com/.test(G.mails.filter(m => /借用已核准/.test(m.subject))[0].to), '★ 補完 Email 之後核准通知寄得到本人');

  // 核准 → 申請人與核准的人在同一封信裡
  G.mails.length = 0;
  ok('approve', { id: C1.id }, A);
  const ap = G.mails.filter(m => /借用已核准/.test(m.subject));
  assert.strictEqual(ap.length, 1, '核准只寄一封(兩個收件者在同一封)');
  assert.ok(/ming@x\.com/.test(ap[0].to), '★ 核准通知要寄給申請人');
  assert.ok(/admin@x\.com/.test(ap[0].to), '★ 核准通知也要寄給按下核准的那位管理者');
  assert.ok(/核准人:測試管理者/.test(ap[0].body), '★ 信裡要寫核准人是誰');
  assert.ok(/10231 \/ ming@x\.com/.test(ap[0].body), '信裡要帶得到借用人的聯絡方式');

  // 申請人自己就是核准人時,同一個信箱不可以寄兩次
  const C4 = mk({ event: '管理者自己申請' }, A);
  G.mails.length = 0;
  ok('approve', { id: C4.id }, A);
  assert.strictEqual(G.mails.filter(m => /借用已核准/.test(m.subject))[0].to, 'admin@x.com',
    '★ 申請人就是核准人時,同一個信箱不可以出現兩次');
}

/* ===== 跨廠區歸還:總數不變,兩邊各加減 =====
 * 盤點只看兩件事:總數對不對、各區加起來對不對。
 * 「新竹借出、還到林口」是唯一會讓庫存在廠區之間移動的路徑,
 * 少了這條測試,只減不加 / 加錯區都會全綠,然後在盤點當天才炸開。
 */
{
  const MV = ok('saveItem', { item: { name: '跨廠歸還測試機', mode: 'qty', category: '體驗區',
    sites: [{ location: '新竹', qty: 4 }, { location: '林口', qty: 1 }] } }, A);
  const look = () => {
    const v = ok('items', {}, A).find(x => x.id === MV.id);
    const at = L => (v.sites.find(g => g.location === L) || { total: 0 }).total;
    return { total: v.total, hc: at('新竹'), lk: at('林口') };
  };
  const b4 = look();
  assert.deepStrictEqual([b4.total, b4.hc, b4.lk], [5, 4, 1], '前置:新竹 4、林口 1、共 5');

  const LM = ok('createLoan', { event: '跨廠歸還測試', start: '2026-10-01', end: '2026-10-05',
    lines: [{ itemId: MV.id, location: '新竹', qty: 2 }], onBehalf: true, applicant: '10231' }, A);
  const out = look();
  assert.strictEqual(out.total, 5, '借出期間總數不變(東西只是在外面)');
  assert.strictEqual(out.hc, 4, '借出不會把展品從原廠區搬走');

  // 新竹借出的 2 台,還到林口
  ok('receive', { id: LM.id, lines: [{ itemId: MV.id, location: '新竹', returned: 2, to: '林口' }] }, A);
  const af = look();
  assert.strictEqual(af.total, 5, '★ 還到別區:總數不可以變 —— 盤點對不上就是從這裡開始');
  assert.strictEqual(af.hc, 2, '★ 還到別區:原本那一區要少掉 2');
  assert.strictEqual(af.lk, 3, '★ 還到別區:還過去那一區要多 2');

  // 還回原區:誰都不該動
  const LN = ok('createLoan', { event: '還回原區測試', start: '2026-10-01', end: '2026-10-05',
    lines: [{ itemId: MV.id, location: '林口', qty: 1 }], onBehalf: true, applicant: '10231' }, A);
  ok('receive', { id: LN.id, lines: [{ itemId: MV.id, location: '林口', returned: 1, to: '林口' }] }, A);
  assert.deepStrictEqual([look().total, look().hc, look().lk], [5, 2, 3], '還回原區不該搬動任何庫存');

  // 短少是唯一該讓總數變少的路徑
  const LL = ok('createLoan', { event: '短少不搬廠測試', start: '2026-10-01', end: '2026-10-05',
    lines: [{ itemId: MV.id, location: '林口', qty: 1 }], onBehalf: true, applicant: '10231' }, A);
  ok('receive', { id: LL.id, lines: [{ itemId: MV.id, location: '林口', returned: 0, lost: 1, to: '新竹' }] }, A);
  const lost = look();
  assert.strictEqual(lost.total, 4, '★ 短少要讓總數少 1');
  assert.strictEqual(lost.lk, 2, '★ 短少要算在「借出的那一區」,不可以算到 to 指的那一區');
  assert.strictEqual(lost.hc, 2, '★ 短少不可以順便把庫存搬到 to 指的那一區');

  // 逐台型:那一台的所在地要跟著改,而且可以逐台指定
  const MU = ok('saveItem', { item: { name: '跨廠單台機', mode: 'unit', category: '體驗區', location: '新竹' } }, A);
  ok('addUnits', { itemId: MU.id, count: 2, location: '新竹' }, A);
  const mun = ok('units', { itemId: MU.id }, A).map(u => u.id);
  const LU = ok('createLoan', { event: '單台跨廠歸還', start: '2026-10-01', end: '2026-10-05',
    lines: [{ itemId: MU.id, location: '新竹', qty: 2 }], onBehalf: true, applicant: '10231' }, A);
  assert.deepStrictEqual(ok('loans', { filter: 'all' }, A).find(x => x.id === LU.id).lines[0].units.slice().sort(), mun.slice().sort(), '代為登記就是已出借,兩台都要綁好');
  ok('receive', { id: LU.id, lines: [{ itemId: MU.id, location: '新竹', to: '林口',
    unitResults: [{ id: mun[0], result: 'in' }, { id: mun[1], result: 'in', to: '新竹' }] }] }, A);
  const uv = ok('units', { itemId: MU.id }, A);
  assert.strictEqual(uv.find(u => u.id === mun[0]).location, '林口', '★ 逐台還到別區:那一台的所在地要跟著改');
  assert.strictEqual(uv.find(u => u.id === mun[1]).location, '新竹', '★ 逐台可以各自指定還到哪一區');
  const muv = ok('items', {}, A).find(x => x.id === MU.id);
  assert.strictEqual(muv.total, 2, '★ 逐台搬廠之後總數不變');
  assert.deepStrictEqual(muv.sites.map(g => g.location + g.total).sort(), ['新竹1', '林口1'], '★ 逐台搬廠之後各區總和要對');
}

/* ===== v2.7:操作紀錄要帶大類 ===== */
{
  // 先補一個「下架 → 重新上架」的來回,操作紀錄才驗得到這兩個動作
  const AR = ok('saveItem', { item: { name: '上下架測試機', mode: 'qty', category: '體驗區', sites: [{ location: '新竹', qty: 1 }] } }, A);
  ok('archiveItem', { id: AR.id, archived: true }, A);
  ok('archiveItem', { id: AR.id, archived: false }, A);
  assert.strictEqual(ok('items', {}, A).find(x => x.id === AR.id).archived, false, '重新上架之後不該還是下架狀態');

  const rows = ok('logs', { limit: 500 }, A);
  assert.ok(rows.length > 20, '這時候應該已經累積不少紀錄了:' + rows.length);
  rows.forEach(r => {
    assert.ok(r.cat, '每一筆都要有大類:' + JSON.stringify(r).slice(0, 120));
    assert.ok(r.catLabel, '每一筆都要有大類名稱:' + r.action);
  });
  const other = rows.filter(r => r.cat === 'other').map(r => r.action);
  assert.strictEqual([...new Set(other)].join('、'), '', '★ 實際跑出來的動作掉進「其他」:' + [...new Set(other)].join('、'));
  const kinds = [...new Set(rows.map(r => r.cat))];
  ['loan', 'item', 'show', 'cat'].forEach(k => assert.ok(kinds.includes(k), '跑了這麼多流程,應該要有 ' + k + ' 類的紀錄'));
  // 人員欄要填得出來(籤條是靠它分的)
  assert.ok(rows.every(r => r.user), '每一筆都要記得住是誰做的');
  // 會互相搶的那幾個要歸對邊 —— 只檢查「有跑到」的動作,沒跑到就不管
  const WANT = { '封存借用單到歷史表': 'show', '由展覽產生借用單': 'show', '展覽批次歸還': 'show',
    '重新上架': 'item', '下架展品': 'item', '核准借用': 'loan', '登記歸還': 'loan' };
  let checked = 0;
  Object.keys(WANT).forEach(act => {
    const hit = rows.filter(r => r.action === act);
    hit.forEach(r => { checked++;
      assert.strictEqual(r.cat, WANT[act], '★「' + act + '」應該歸到 ' + WANT[act] + ',實際是 ' + r.cat); });
  });
  assert.ok(checked >= 3, '★ 這幾個最容易歸錯的動作至少要驗到 3 筆,只驗到 ' + checked + ' 筆');
}

const origLoad = G.ctx.Memory.load;
const run = (act, p2, tok) => { const r = G.call(act, p2, tok); return JSON.stringify([r.success, r.data, r.error]); };
const readActions = [
  ['status', {}, null], ['me', {}, U], ['users', {}, A], ['logs', { limit: 50 }, A],
  ['cats', {}, U], ['allCats', {}, A],
  ['catalog', {}, U], ['catalog', { start: '2026-10-01', end: '2026-10-05' }, U],
  ['check', { start: '2026-10-01', end: '2026-10-05', lines: [{ itemId: stand.id, qty: 3 }] }, U],
  ['myLoans', {}, U], ['myLoans', {}, U2b],
  ['lookup', { code: 'E0001' }, U2b], ['lookup', { code: 'E0001' }, A], ['lookup', { code: '沒這個' }, U],
  ['dashboard', {}, A], ['items', {}, A], ['units', {}, A], ['units', { itemId: panel.id }, A]
];
['all', 'active', 'overdue', 'request', 'pending', 'returned'].forEach(f => readActions.push(['loans', { filter: f }, A]));
['open', 'all', 'draft', 'confirmed', 'closed'].forEach(f => readActions.push(['shows', { filter: f }, A]));
readActions.push(['show', { id: SH.id }, A]);
readActions.push(['showSettle', { id: SH.id }, A]);
readActions.push(['showSettle', { id: SS.id }, A]);
readActions.push(['archivePreview', {}, A]);
readActions.push(['showSheet', { id: SH.id }, A]);
readActions.push(['holders', { itemId: expo.id, location: '新竹', from: '2027-03-02', to: '2027-03-04' }, A]);
readActions.push(['holders', { itemId: expo.id, location: '新竹', from: '2027-03-02', to: '2027-03-04' }, U]);
readActions.push(['archivePreview', { includePlain: true }, A]);
['returned', 'all'].forEach(f => readActions.push(['loans', { filter: f, includeHistory: true }, A]));
readActions.push(['showCheck', { id: SH.id, from: '2027-03-01', to: '2027-03-10', lines: [{ itemId: expo.id, location: '新竹', qty: 6 }] }, A]);
readActions.forEach(([act, p2, tok]) => {
  const restricted = run(act, p2, tok);
  // 忽略欄位/列的限縮,整張整欄載入。歷史表是「有沒有被點名」的差別,不是限縮,所以要跟著帶
  G.ctx.Memory.load = function (spec) {
    return origLoad(spec && spec.Hist ? { Cats: '*', Items: '*', Units: '*', Loans: '*', Shows: '*', Users: '*', Hist: '*' } : undefined);
  };
  const complete = run(act, p2, tok);
  G.ctx.Memory.load = origLoad;
  assert.strictEqual(restricted, complete, act + '(' + JSON.stringify(p2) + ')限縮載入的結果不一致');
});
assert.ok(ok('units', {}, A).length >= 3, 'units 省略 itemId 應回傳全部單台');

// 記憶積木本身:指定欄位讀到的值必須與整張讀一致(含跨段、亂序、不存在的欄位)
const M = G.ctx.Memory;
const fullDb = M.load();
[['Items', ['id', 'name', 'archived']], ['Items', ['archived', 'id', 'qty', 'mode', '不存在的欄位']],
 ['Units', ['status', 'itemId']], ['Loans', ['lines', 'id', 'status', 'start', 'end']],
 ['Loans', ['applicant', 'id']], ['Users', ['id', 'role', 'sessionVer']]].forEach(([t, cols]) => {
  const part = M.load({ [t]: cols })[t];
  assert.strictEqual(part.length, fullDb[t].length, t + ' 指定欄位後筆數不同');
  part.forEach((row, i) => cols.filter(c => c in fullDb[t][i]).forEach(c => {
    assert.strictEqual(JSON.stringify(row[c]), JSON.stringify(fullDb[t][i][c]), t + '.' + c + ' 第 ' + i + ' 列值不同');
  }));
  assert.strictEqual(part.map(r => r.id).join(), fullDb[t].map(r => r.id).join(), t + ' 指定欄位後 id 順序不同');
});
// 沒指定的欄位補空值,不會殘留上一次的內容
const lite = M.load({ Loans: ['id', 'status'] }).Loans[0];
assert.strictEqual(lite.event, '', '未讀取的欄位應為空值');
assert.strictEqual(JSON.stringify(lite.lines), '[]', '未讀取的 JSON 欄位應為空陣列');
// 未列在 spec 的工作表不讀取
assert.strictEqual(M.load({ Users: ['id'] }).Items.length, 0, '未指定的工作表不應載入');

console.log('✔ e2e 全部通過');
