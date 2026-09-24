// 規則層單元測試(純函式,不需任何 Google 服務):node tests/rules.test.js
const assert = require('assert');
const { makeEnv } = require('./fake-gas');
const R = makeEnv().ctx.Logic.rules;
let n = 0; const t = (name, fn) => { fn(); n++; };

t('日期格式:閏年、月底、錯誤日期', () => {
  assert.ok(R.isDate('2028-02-29')); assert.ok(!R.isDate('2026-02-29'));
  assert.ok(!R.isDate('2026-13-01')); assert.ok(!R.isDate('2026-04-31')); assert.ok(!R.isDate('2026/10/01')); assert.ok(!R.isDate(''));
});
t('加天數:跨月、跨年', () => {
  assert.strictEqual(R.addDays('2026-01-31', 1), '2026-02-01');
  assert.strictEqual(R.addDays('2026-12-31', 1), '2027-01-01');
  assert.strictEqual(R.addDays('2026-03-01', -1), '2026-02-28');
});
const db = () => ({
  Items: [{ id: 'P1', mode: 'qty', qty: 10 }, { id: 'P2', mode: 'unit' }],
  Units: [{ id: 'E1', itemId: 'P2', status: 'in' }, { id: 'E2', itemId: 'P2', status: 'out' }, { id: 'E3', itemId: 'P2', status: 'repair' }, { id: 'E4', itemId: 'P2', status: 'lost' }],
  Loans: [
    { id: 'L1', status: 'approved', start: '2026-10-01', end: '2026-10-05', lines: [{ itemId: 'P1', qty: 4, returned: 0, lost: 0 }] },
    { id: 'L2', status: 'out', start: '2026-09-01', end: '2026-09-10', lines: [{ itemId: 'P1', qty: 3, returned: 1, lost: 0 }, { itemId: 'P2', qty: 1, returned: 0, lost: 0 }] },
    { id: 'L3', status: 'returned', start: '2026-10-01', end: '2026-10-05', lines: [{ itemId: 'P1', qty: 9, returned: 9, lost: 0 }] },
    { id: 'L4', status: 'pending', start: '2026-10-01', end: '2026-10-05', lines: [{ itemId: 'P1', qty: 9, returned: 0, lost: 0 }] }
  ]
});
const TODAY = '2026-09-22';
t('庫存統計:在庫 = 總數 − 出借中未還;維修/遺失不算總數', () => {
  const st = R.stats(db());
  assert.deepStrictEqual([st.P1.total, st.P1.out, st.P1.reserved, st.P1.inStock], [10, 2, 4, 8]);
  assert.deepStrictEqual([st.P2.total, st.P2.repair, st.P2.lost, st.P2.inStock], [2, 1, 1, 1]);
});
t('可借量:區間重疊邊界(同一天算重疊、隔天不算)', () => {
  const d = db(), P1 = d.Items[0];
  assert.strictEqual(R.availableInRange(d, P1, null, '2026-10-05', '2026-10-06', null, TODAY), 10 - 4 - 2);
  assert.strictEqual(R.availableInRange(d, P1, null, '2026-09-25', '2026-09-30', null, TODAY), 10 - 2);  // L1 還沒開始
});
t('逾期未還:永久佔用直到歸還', () => {
  const d = db(), P1 = d.Items[0];
  assert.ok(R.isOverdue(d.Loans[1], TODAY));
  assert.strictEqual(R.loanWindow(d.Loans[1], TODAY)[1], '9999-12-31');
  assert.strictEqual(R.availableInRange(d, P1, null, '2027-06-01', '2027-06-02', null, TODAY), 8);
});
t('待審核 / 已歸還不佔用;排除自己', () => {
  const d = db(), P1 = d.Items[0];
  assert.strictEqual(R.reservedInRange(d, 'P1', null, '2026-10-01', '2026-10-05', 'L1', TODAY), 2);
});
t('分地點庫存:各地各算各的,借出只扣借出的那一點', () => {
  const d = {
    Items: [{ id: 'P1', mode: 'qty', stock: { 新竹: { 數量: 3, 盤點: '' }, 林口: { 數量: 2, 盤點: '' } } },
            { id: 'P2', mode: 'unit' }],
    Units: [{ id: 'E1', itemId: 'P2', status: 'in', location: '新竹' }, { id: 'E2', itemId: 'P2', status: 'in', location: '林口' }],
    Loans: [{ id: 'L1', status: 'out', start: '2026-09-01', end: '2026-12-31', lines: [{ itemId: 'P1', location: '新竹', qty: 3, returned: 0, lost: 0 }] }]
  };
  const st = R.stats(d), P1 = d.Items[0];
  assert.strictEqual(st.P1.total, 5);                       // 總數 = 各地相加
  assert.strictEqual(st['P1@新竹'].inStock, 0);              // 新竹 3 台全借走了
  assert.strictEqual(st['P1@林口'].inStock, 2);              // 林口沒被動到
  assert.strictEqual(R.availableInRange(d, P1, '新竹', '2026-10-01', '2026-10-02', null, TODAY), 0);
  assert.strictEqual(R.availableInRange(d, P1, '林口', '2026-10-01', '2026-10-02', null, TODAY), 2);
  assert.strictEqual(R.availableInRange(d, P1, null, '2026-10-01', '2026-10-02', null, TODAY), 2);
  assert.deepStrictEqual(R.sitesOf(d, d.Items[1]).map(x => x.location + x.qty).sort(), ['新竹1', '林口1'].sort());
});
t('舊資料(只有總數 + 單一地點)自動視為全部放在那個地點', () => {
  const d = { Items: [{ id: 'P1', mode: 'qty', qty: 4, location: '湖口' }], Units: [], Loans: [] };
  assert.strictEqual(JSON.stringify(R.sitesOf(d, d.Items[0])), JSON.stringify([{ location: '湖口', qty: 4, countedAt: '' }]));
  assert.strictEqual(R.capacity(d, d.Items[0]), 4);
  assert.strictEqual(R.capacity(d, d.Items[0], '湖口'), 4);
  assert.strictEqual(R.capacity(d, d.Items[0], '新竹'), 0);
});
t('缺料計算', () => {
  const r = R.checkLines(db(), [{ itemId: 'P1', qty: 7 }, { itemId: 'P2', qty: 1 }, { itemId: 'NOPE', qty: 1 }], '2026-10-01', '2026-10-02', null, TODAY);
  assert.deepStrictEqual(r.map(x => x.short), [3, 0, 1]);   // P2:2 台可用 − 逾期佔用 1 = 1,剛好夠
});
t('純函式:同樣輸入同樣輸出、不改輸入', () => {
  const d = db(), snap = JSON.stringify(d);
  const a = JSON.stringify(R.stats(d)), b = JSON.stringify(R.stats(d));
  assert.strictEqual(a, b); assert.strictEqual(JSON.stringify(d), snap);
});

/* ---------- 展覽的殘額佔位 ----------
 * 這幾條是整個展覽功能的命脈:展覽會卡位,底下又會開借用單,
 * 兩邊都扣就會把同一批東西扣兩次,可借量憑空少一半而且不會報錯。
 */
const sdb = (loans) => ({
  Items: [{ id: 'P1', mode: 'qty', qty: 10, location: '新竹' }],
  Units: [],
  Loans: loans || [],
  Shows: [{ id: 'S1', status: 'confirmed', from: '2026-12-01', to: '2026-12-10',
    lines: [{ itemId: 'P1', location: '新竹', qty: 5 }] }]
});
const loan = (st, qty) => ({ id: 'LX', status: st, start: '2026-12-01', end: '2026-12-10', showId: 'S1',
  lines: [{ itemId: 'P1', location: '新竹', qty: qty, returned: 0, lost: 0 }] });
const hold = (d) => R.showHold(d, 'P1', '新竹', '2026-12-03', '2026-12-04', null);

t('展覽卡位:還沒開單時佔滿規劃量', () => {
  assert.strictEqual(hold(sdb()), 5);
});
t('展覽卡位:開了單就讓出那一份,兩邊加起來還是 5', () => {
  const d = sdb([loan('approved', 3)]);
  assert.strictEqual(hold(d), 2);                                                   // 展覽只剩 2
  assert.strictEqual(R.reservedInRange(d, 'P1', '新竹', '2026-12-03', '2026-12-04', null, TODAY), 3);
  assert.strictEqual(R.availableInRange(d, d.Items[0], '新竹', '2026-12-03', '2026-12-04', null, TODAY), 5);
});
t('展覽卡位:全部開完就完全放手', () => {
  assert.strictEqual(hold(sdb([loan('approved', 5)])), 0);
});
t('展覽卡位:開超過規劃量不會變成負的', () => {
  assert.strictEqual(hold(sdb([loan('out', 8)])), 0);
});
t('展覽卡位:待審核的單還沒佔住庫存,所以展覽要繼續佔著(不可以有空窗)', () => {
  const d = sdb([loan('pending', 5)]);
  assert.strictEqual(hold(d), 5);
  assert.strictEqual(R.reservedInRange(d, 'P1', '新竹', '2026-12-03', '2026-12-04', null, TODAY), 0);
  assert.strictEqual(R.availableInRange(d, d.Items[0], '新竹', '2026-12-03', '2026-12-04', null, TODAY), 5);
});
t('展覽卡位:單被取消 / 駁回,那一份回到展覽身上', () => {
  assert.strictEqual(hold(sdb([loan('cancelled', 5)])), 5);
  assert.strictEqual(hold(sdb([loan('rejected', 5)])), 5);
});
t('展覽卡位:只有「已確認」才卡位,規劃中 / 結案 / 取消都不卡', () => {
  ['draft', 'closed', 'cancelled'].forEach(st => {
    const d = sdb(); d.Shows[0].status = st;
    assert.strictEqual(hold(d), 0, st + ' 不應該卡位');
  });
});
t('展覽卡位:檔期沒重疊就不影響', () => {
  assert.strictEqual(R.showHold(sdb(), 'P1', '新竹', '2026-11-01', '2026-11-30', null), 0);
  assert.strictEqual(R.showHold(sdb(), 'P1', '新竹', '2026-12-10', '2026-12-20', null), 5);   // 同一天算重疊
});
t('展覽卡位:別的地點不受影響', () => {
  assert.strictEqual(R.showHold(sdb(), 'P1', '林口', '2026-12-03', '2026-12-04', null), 0);
});
t('展覽卡位:排除自己那場,否則展覽會擋住它自己要開的單', () => {
  assert.strictEqual(R.showHold(sdb(), 'P1', '新竹', '2026-12-03', '2026-12-04', 'S1'), 0);
});
t('展覽卡位:兩場展覽各自卡位,會疊加', () => {
  const d = sdb();
  d.Shows.push({ id: 'S2', status: 'confirmed', from: '2026-12-05', to: '2026-12-08',
    lines: [{ itemId: 'P1', location: '新竹', qty: 2 }] });
  assert.strictEqual(hold(d), 5);                                                   // 12-03~04 只跟 S1 重疊
  assert.strictEqual(R.showHold(d, 'P1', '新竹', '2026-12-06', '2026-12-07', null), 7);
});
/* cleanLines / cleanShowLines:「同品項+同地點合併」「地點只有一個就自動補、兩個以上要指定」
 * 這兩條規則同時被借用單與展覽需求清單用到,之前只有間接覆蓋。 */
const cdb = () => ({
  Items: [
    { id: 'P1', name: '單一地點機', mode: 'qty', qty: 5, location: '新竹', stock: { 新竹: { 數量: 5, 盤點: '' } } },
    { id: 'P2', name: '雙廠機', mode: 'qty', qty: 5, location: '', stock: { 新竹: { 數量: 3, 盤點: '' }, 林口: { 數量: 2, 盤點: '' } } }
  ],
  Units: [], Loans: [], Shows: []
});
t('清單合併:同品項同地點的兩行要併成一行', () => {
  const out = R.cleanLines(cdb(), [{ itemId: 'P1', qty: 2 }, { itemId: 'P1', location: '新竹', qty: 3 }]);
  assert.strictEqual(out.length, 1);
  assert.deepStrictEqual([out[0].location, out[0].qty], ['新竹', 5]);
});
t('清單合併:只有一個地點就自動補上', () => {
  assert.strictEqual(R.cleanLines(cdb(), [{ itemId: 'P1', qty: 1 }])[0].location, '新竹');
});
t('清單合併:兩個以上地點沒指定就要擋下來', () => {
  assert.throws(() => R.cleanLines(cdb(), [{ itemId: 'P2', qty: 1 }]), /請指定/);
  assert.throws(() => R.cleanLines(cdb(), [{ itemId: 'P2', location: '湖口', qty: 1 }]), /沒有庫存/);
});
t('清單合併:數量 0 或負數直接略過;全部略過就報錯', () => {
  assert.strictEqual(R.cleanLines(cdb(), [{ itemId: 'P1', qty: 2 }, { itemId: 'P1', qty: 0 }])[0].qty, 2);
  assert.throws(() => R.cleanLines(cdb(), [{ itemId: 'P1', qty: 0 }]), /至少選擇一項/);
});
t('展覽需求清單:同一套合併規則,但允許空清單(規劃中可以慢慢加)', () => {
  const out = R.cleanShowLines(cdb(), [{ itemId: 'P2', location: '新竹', qty: 1 }, { itemId: 'P2', location: '新竹', qty: 4 }]);
  assert.deepStrictEqual([out.length, out[0].qty], [1, 5]);
  assert.deepStrictEqual(R.cleanShowLines(cdb(), []), []);
});
/* ---- 展後結算 ---- */
const stdb = () => ({
  Items: [{ id: 'P1', name: '甲機', mode: 'qty', stock: { 新竹: { 數量: 10 } } }],
  Shows: [{ id: 'S1', name: '秋季展', status: 'closed', from: '2026-11-01', to: '2026-11-10',
    lines: [{ itemId: 'P1', location: '新竹', qty: 6 }] }],
  Loans: [
    // 真的出去過:借 4、還 3、短少 1 → 未歸還 0
    { id: 'LA', showId: 'S1', status: 'returned', start: '2026-11-01', end: '2026-11-10',
      lines: [{ itemId: 'P1', location: '新竹', qty: 4, returned: 3, lost: 1 }] },
    // 還在外面:借 2、還 0 → 未歸還 2
    { id: 'LB', showId: 'S1', status: 'out', start: '2026-11-01', end: '2026-11-10',
      lines: [{ itemId: 'P1', location: '新竹', qty: 2, returned: 0, lost: 0 }] },
    // 開了單還沒領:算「已開單」,不算「實際借出」
    { id: 'LC', showId: 'S1', status: 'approved', start: '2026-11-01', end: '2026-11-10',
      lines: [{ itemId: 'P1', location: '新竹', qty: 3, returned: 0, lost: 0 }] },
    // 駁回 / 取消:完全不算
    { id: 'LD', showId: 'S1', status: 'rejected', start: '2026-11-01', end: '2026-11-10',
      lines: [{ itemId: 'P1', location: '新竹', qty: 5, returned: 0, lost: 0 }] },
    // 別場的單不可以混進來
    { id: 'LE', showId: 'S9', status: 'out', start: '2026-11-01', end: '2026-11-10',
      lines: [{ itemId: 'P1', location: '新竹', qty: 7, returned: 0, lost: 0 }] }
  ]
});
t('展後結算:駁回與取消不算,待領只算已開單,短少與未歸還分開', () => {
  const r = R.settleShow(stdb(), stdb().Shows[0], '2026-11-20');
  assert.strictEqual([r.totals.planned, r.totals.booked, r.totals.issued, r.totals.returned, r.totals.lost, r.totals.unreturned].join(),
    '6,3,6,3,1,2');
  assert.strictEqual(r.lines[0].loans.join(), 'LA,LB,LC');
});
t('展後結算:借用單多出來的品項也要列(規劃是 0)', () => {
  const d = stdb();
  d.Items.push({ id: 'P9', name: '臨時加的', mode: 'qty', stock: { 林口: { 數量: 2 } } });
  d.Loans.push({ id: 'LF', showId: 'S1', status: 'out', start: '2026-11-01', end: '2026-11-10',
    lines: [{ itemId: 'P9', location: '林口', qty: 2, returned: 0, lost: 0 }] });
  const r = R.settleShow(d, d.Shows[0], '2026-11-20');
  const extra = r.lines.find(x => x.itemId === 'P9');
  assert.strictEqual([extra.planned, extra.issued, extra.unreturned].join(), '0,2,2');
});
t('展後結算:同品項不同地點要分開算', () => {
  const d = stdb();
  d.Shows[0].lines.push({ itemId: 'P1', location: '林口', qty: 2 });
  d.Loans.push({ id: 'LG', showId: 'S1', status: 'returned', start: '2026-11-01', end: '2026-11-10',
    lines: [{ itemId: 'P1', location: '林口', qty: 2, returned: 2, lost: 0 }] });
  const r = R.settleShow(d, d.Shows[0], '2026-11-20');
  assert.strictEqual(r.lines.length, 2);
  assert.strictEqual(r.lines.find(x => x.location === '林口').returned, 2);
  assert.strictEqual(r.lines.find(x => x.location === '新竹').returned, 3);
});

/* ---- 缺口是誰佔住的 ---- */
const hdb = () => ({
  Items: [{ id: 'P1', name: '甲機', mode: 'qty', stock: { 新竹: { 數量: 10 } } }],
  Shows: [
    { id: 'S1', name: '別場展', status: 'confirmed', from: '2026-12-01', to: '2026-12-10',
      lines: [{ itemId: 'P1', location: '新竹', qty: 4 }] },
    { id: 'S2', name: '自己這場', status: 'confirmed', from: '2026-12-01', to: '2026-12-10',
      lines: [{ itemId: 'P1', location: '新竹', qty: 3 }] },
    { id: 'S3', name: '還在規劃', status: 'draft', from: '2026-12-01', to: '2026-12-10',
      lines: [{ itemId: 'P1', location: '新竹', qty: 9 }] },
    { id: 'S4', name: '檔期沒蓋到', status: 'confirmed', from: '2027-05-01', to: '2027-05-10',
      lines: [{ itemId: 'P1', location: '新竹', qty: 9 }] }
  ],
  Loans: [
    { id: 'LA', status: 'out', start: '2026-12-02', end: '2026-12-06', applicant: '甲君', dept: '業務', event: '客戶來訪',
      lines: [{ itemId: 'P1', location: '新竹', qty: 2, returned: 0, lost: 0 }] },
    { id: 'LB', status: 'approved', start: '2026-12-03', end: '2026-12-04', applicant: '乙君', dept: '產品', event: '內部測試',
      lines: [{ itemId: 'P1', location: '新竹', qty: 1, returned: 0, lost: 0 }] },
    { id: 'LC', status: 'returned', start: '2026-12-01', end: '2026-12-02', applicant: '丙君',
      lines: [{ itemId: 'P1', location: '新竹', qty: 5, returned: 5, lost: 0 }] },
    { id: 'LD', status: 'out', start: '2026-12-02', end: '2026-12-03', applicant: '丁君',
      lines: [{ itemId: 'P1', location: '林口', qty: 3, returned: 0, lost: 0 }] }
  ]
});
const H = (ex) => R.holdersOf(hdb(), 'P1', '新竹', '2026-12-01', '2026-12-10', '2026-11-20', null, ex || null, true);
t('誰佔住:已歸還的不算、別的廠區不算', () => {
  assert.strictEqual(H().loans.map(x => x.id).join(), 'LB,LA');   // 依歸還日排序
  assert.strictEqual(H().loanQty, 3);
});
t('誰佔住:最早還的排最前面 —— 那通常最喬得動', () => {
  const l = H().loans;
  assert.strictEqual(l[0].id, 'LB');
  assert.strictEqual(l[0].end, '2026-12-04');
});
t('誰佔住:只算已確認且檔期有重疊的展覽,自己那場要排除', () => {
  assert.strictEqual(H().shows.map(x => x.id).join(), 'S1,S2');
  assert.strictEqual(H('S2').shows.map(x => x.id).join(), 'S1', '排除自己那場');
  assert.strictEqual(H('S2').showQty, 4);
});
t('誰佔住:展覽已經開成借用單的那一段不可以重複列', () => {
  const d = hdb();
  d.Loans.push({ id: 'LS', showId: 'S1', status: 'approved', start: '2026-12-01', end: '2026-12-10',
    lines: [{ itemId: 'P1', location: '新竹', qty: 4, returned: 0, lost: 0 }] });
  const r = R.holdersOf(d, 'P1', '新竹', '2026-12-01', '2026-12-10', '2026-11-20', null, null, true);
  assert.strictEqual((r.shows.find(x => x.id === 'S1') || {}).qty, undefined, '★ 已經整批開成單了,展覽那邊不可以再列一次');
  assert.ok(r.loans.some(x => x.id === 'LS'), '要改成列那張借用單');
});
t('誰佔住:不是管理者就不帶借用人姓名', () => {
  const r = R.holdersOf(hdb(), 'P1', '新竹', '2026-12-01', '2026-12-10', '2026-11-20', null, null, false);
  assert.strictEqual(r.loans[0].applicant, undefined);
  assert.strictEqual(r.loans[0].end, '2026-12-04', '歸還日還是要看得到');
});

/* ---- 封存的挑選條件 ---- */
const adb = () => ({
  Shows: [{ id: 'S1', name: '結案的', status: 'closed' }, { id: 'S2', name: '還在跑的', status: 'confirmed' }],
  Loans: [
    { id: 'A1', showId: 'S1', status: 'returned' },
    { id: 'A2', showId: 'S1', status: 'cancelled' },
    { id: 'A3', showId: 'S1', status: 'out' },        // 展覽結案了但這張還沒結束 → 不搬
    { id: 'B1', showId: 'S2', status: 'returned' },   // 展覽還沒結案 → 不搬
    { id: 'C1', showId: 'S9', status: 'returned' },   // 展覽不存在 → 不搬
    { id: 'D1', showId: '', status: 'returned' },     // 一般單
    { id: 'D2', showId: '', status: 'out' }
  ]
});
t('封存條件:只搬「已結案展覽底下 + 本身也結束」的單', () => {
  assert.strictEqual(R.archivable(adb(), false).map(L => L.id).join(), 'A1,A2');
});
t('封存條件:一般單要另外勾選才搬,而且一樣只搬結束了的', () => {
  assert.strictEqual(R.archivable(adb(), true).map(L => L.id).join(), 'A1,A2,D1');
});
t('封存預覽:依展覽分組,一般單另外一堆', () => {
  const g = R.archiveGroups(adb(), true);
  assert.strictEqual(g.total, 3);
  assert.strictEqual(g.plain.join(), 'D1');
  assert.strictEqual(g.shows.map(x => x.id).join(), 'S1');
  assert.strictEqual(g.shows[0].ids.join(), 'A1,A2');
  assert.strictEqual(g.shows[0].name, '結案的');
});

t('規則層不可以改到傳入的資料', () => {
  const d = cdb(), before = JSON.stringify(d);
  R.cleanLines(d, [{ itemId: 'P1', qty: 2 }]);
  R.cleanShowLines(d, [{ itemId: 'P2', location: '林口', qty: 1 }]);
  R.showHold(d, 'P1', '新竹', '2026-10-01', '2026-10-02', null);
  assert.strictEqual(JSON.stringify(d), before);
  const sd = stdb(), stBefore = JSON.stringify(sd);
  R.settleShow(sd, sd.Shows[0], '2026-11-20');
  R.archivable(sd, true); R.archiveGroups(sd, true);
  assert.strictEqual(JSON.stringify(sd), stBefore);
});

console.log('✔ 規則層 ' + n + ' 項通過');
