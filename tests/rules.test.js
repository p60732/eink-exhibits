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
  const st = R.stats(db(), TODAY);
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
  const st = R.stats(d, TODAY), P1 = d.Items[0];
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
  const a = JSON.stringify(R.stats(d, TODAY)), b = JSON.stringify(R.stats(d, TODAY));
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
console.log('✔ 規則層 ' + n + ' 項通過');
