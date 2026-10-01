/**
 * 【UI 場景】tests/ui/00-setup.js — 建管理者、匯入人員、分類、展品編輯(照片/刪除/快取賽跑)、多廠區庫存、只盤一區
 * 前置:無
 * 跑法:node tests/ui.test.js 00(會自動帶上前置場景)
 */
module.exports = { id: '00', title: '建管理者、匯入人員、分類、展品編輯(照片/刪除/快取賽跑)、多廠區庫存、只盤一區', needs: [], run: run };
async function run(C) {
  const { p, b, shot, wait, errs, PNG, d, URL } = C;
  await p.goto(URL); await p.waitForSelector('#login-f');
  // 第一位管理者的 Email 要填:核准通知會寄一份給按下核准的人,
  // 而且沒填的話一登入就會被「請先補 Email」的擋板擋住(這是刻意的)
  await p.fill('[name=name]', '測試管理者'); await p.fill('[name=email]', 'admin@x.com');
  await p.fill('#l-emp', '90001'); await p.fill('#l-pin', '1234'); await p.click('#login-f button');
  await p.waitForSelector('.kpis'); await shot('dash0');
  // 匯入人員、新增展品
  await p.click('[data-v=users]'); await wait(300); await p.click('[data-act=import-users]');
  // 第 4 欄是 Email。沒有 Email 的帳號登入時會被擋住要求補填(見下面「補 Email」那一段),
  // 所以這兩個一路用到底的測試帳號要先給信箱,10999 留著專門驗那個擋板。
  await p.fill('#iut', '10231\t測試員工A\t業務部\tming@x.com\n10477\t測試員工B\t產品部\tbee@x.com\n10999\t沒信箱的人\t倉管'); await p.click('#iugo'); await wait(400);
  await p.click('[data-v=items]'); await wait(500);
  // 預設七個分類要在籤條上,且順序正確
  // 展品管理現在有兩排籤條(#isite 地點 / #ibar 分類),要指名分類那一排
  const catChips = await p.$$eval('#ibar .catchip', els => els.map(e => e.dataset.cat));
  const want7 = ['', 'eReader', 'eNote', 'Logistics & Factory', 'Prism', 'Signage', 'Lifestyle', 'Mobile & Wearables'];
  if (catChips.slice(0, 8).join('|') !== want7.join('|')) throw new Error('分類籤條不正確:' + catChips.join("|"));
  // 自己新增一個分類,並調順序
  await p.click('[data-act=cats]'); await p.waitForSelector('#cnew');
  await p.fill('#cnew', '體驗區'); await p.click('#cadd'); await wait(600);
  const rowsOf = () => p.$$eval('#cmb [data-cn]', els => els.map(e => [e.dataset.cn, e.value]));
  const before = await rowsOf();
  if (!before.some(([, v]) => v === '體驗區')) throw new Error('新增分類沒出現:' + before.map(x => x[1]).join('|'));
  const enote = before.find(([, v]) => v === 'eNote')[0];
  await p.click(`#cmb [data-mv="${enote}"][data-d="1"]`); await wait(600);
  const moved = (await rowsOf()).map(x => x[1]);
  if (moved[1] !== before[2][1] || moved[2] !== 'eNote') throw new Error('往下移一位無效:' + moved.join('|'));
  await p.click(`#cmb [data-mv="${enote}"][data-d="-1"]`); await wait(600);
  const back = (await rowsOf()).map(x => x[1]);
  if (back.join('|') !== before.map(x => x[1]).join('|')) throw new Error('移回來順序不一樣:' + back.join('|'));
  await shot('cats'); await p.click('.modal [data-act=close-render]'); await wait(600);
  await p.click('[data-act=import]');
  await p.fill('#imt', '42吋彩色看板\tSignage\t逐台\t3\t湖口B倉\n展示立架\t體驗區\t數量\t10\t湖口B倉'); await p.click('#imgo'); await wait(700); await shot('items');
  // 展品管理要依分類分段,且空的分類也留著
  const heads = await p.$$eval('#ibody tr.grouph th', els => els.map(e => e.textContent.replace(/加到這一類|\+/g, '').trim()));
  if (!heads.some(h => /^Signage/.test(h)) || !heads.some(h => /^Prism/.test(h))) throw new Error('分段標題不正確:' + heads.join('|'));
  // 點分類籤條只看那一類
  await p.click('#ibar .catchip[data-cat="Signage"]'); await wait(400);
  const rows = await p.$$eval('#ibody tr:not(.grouph)', els => els.length);
  if (rows !== 1) throw new Error('籤條篩選後應只剩 1 筆,實際 ' + rows);
  await p.click('#ibar .catchip[data-cat=""]'); await wait(400);
  // 展品編輯:上傳照片 + 刪除
  await p.click('[data-act=edit-item][data-id]'); await p.waitForSelector('#fphoto');
  if (!await p.isVisible('#fdrop')) throw new Error('編輯視窗少了刪除按鈕');
  // 存放位置是下拉選單,先放新竹、林口(逐台編號的展品用單一預設地點)
  const sites = await p.$$eval('#floc option', els => els.map(e => e.textContent.trim()));
  if (sites[0] !== '新竹' || sites[1] !== '林口') throw new Error('存放位置選單不正確:' + sites.join('|'));
  if (!sites.some(v => /新增地點/.test(v))) throw new Error('存放位置少了「新增地點」');
  await p.setInputFiles('#ffile', { name: 'test.png', mimeType: 'image/png', buffer: PNG }); await wait(1500);
  const imgSrc = await p.getAttribute('#fphoto img', 'src');
  if (!/drive\.google\.com\/thumbnail/.test(imgSrc || '')) throw new Error('照片沒上傳成功:' + imgSrc);
  await shot('photo');
  await p.click('#fdel'); await wait(300);
  if (await p.$('#fphoto img')) throw new Error('移除照片沒生效');
  await p.click('.modal [data-act=close]'); await wait(400);
  // 借過的展品刪不掉(這時候還沒借,所以先建一個丟掉的來試刪除)
  await p.click('.btn.brand[data-act=edit-item]'); await p.waitForSelector('#itf');
  await p.fill('#itf [name=name]', '建錯的展品');
  await p.selectOption('.siterow .sloc', '__new'); await wait(300);
  await p.fill('.siterow .slocnew', '湖口 B 倉 A-01');
  await p.fill('.siterow .sqty', '1');
  await p.click('#itf .btn.pri'); await wait(900);
  const rowsBefore = await p.$$eval('#ibody tr:not(.grouph):not(.groupe)', els => els.length);
  const lastEdit = (await p.$$('[data-act=edit-item][data-id]')).slice(-1)[0];
  await lastEdit.click(); await p.waitForSelector('#fdrop');
  await p.click('#fdrop'); await wait(1200);
  const rowsAfter = await p.$$eval('#ibody tr:not(.grouph):not(.groupe)', els => els.length);
  if (rowsAfter !== rowsBefore - 1) throw new Error('刪除展品沒生效:' + rowsBefore + ' → ' + rowsAfter);
  // 回歸:背景重新驗證還在路上時按刪除,清單不可以還留著那一筆(舊讀取不能覆蓋寫入後的資料)
  await p.click('.btn.brand[data-act=edit-item]'); await p.waitForSelector('#itf');
  await p.fill('#itf [name=name]', '賽跑測試展品'); await p.fill('.siterow .sqty', '1');
  await p.click('#itf .btn.pri'); await wait(900);
  // 攔第一筆 items 讀取:先讓它真的去後端拿(拿到的是刪除前的資料),回應壓到刪除之後才送達
  let heldOnce = false;
  await p.route('**/api', async route => {
    const body = route.request().postData() || '';
    if (heldOnce || !/"action":"items"/.test(body)) return route.continue();
    heldOnce = true;
    const res = await route.fetch();                 // 這一刻的資料 = 刪除前
    const text = await res.text();
    await new Promise(r => setTimeout(r, 2500));     // 刪除在這段期間發生
    return route.fulfill({ status: 200, headers: { 'content-type': 'application/json' }, body: text });
  });
  await p.evaluate(() => { const h = RCACHE.get('items'); if (h) h.at = 0; });   // 讓快取過期,切回來就會背景重抓
  await p.click('[data-v=users]'); await wait(200); await p.click('[data-v=items]'); await wait(200);
  const raceId = await p.$$eval('#ibody tr', els => {
    const r = els.find(e => e.textContent.includes('賽跑測試展品'));
    return r ? r.querySelector('[data-act=edit-item][data-id]').dataset.id : '';
  });
  if (!raceId) throw new Error('賽跑測試展品沒出現在清單上');
  await p.click(`[data-act=edit-item][data-id="${raceId}"]`); await p.waitForSelector('#fdrop');
  await p.click('#fdrop'); await wait(2500);
  const raceLeft = await p.$$eval('#ibody tr:not(.grouph):not(.groupe)', els => els.filter(e => e.textContent.includes('賽跑測試展品')).length);
  if (raceLeft) throw new Error('刪除後被在路上的舊讀取蓋回來了,清單還留著已刪除的展品');
  await p.unroute('**/api');
  if (!heldOnce) throw new Error('賽跑測試沒攔到 items 讀取,測試本身失效了');
  /* 同一個展品分散在兩個廠區 */
  await p.click('.btn.brand[data-act=edit-item]'); await p.waitForSelector('#itf');
  await p.fill('#itf [name=name]', '雙廠展示機');
  await p.selectOption('#fcat', '體驗區'); await wait(200);        // 放最後一個分類,不要打亂後面依順序挑的測試
  await p.selectOption('.siterow .sloc', '新竹'); await p.fill('.siterow .sqty', '2');
  await p.click('#faddsite'); await wait(200);
  const rows2 = await p.$$('.siterow');
  if (rows2.length !== 2) throw new Error('加不了第二個地點');
  await p.selectOption('.siterow:nth-child(2) .sloc', '林口');
  await p.fill('.siterow:nth-child(2) .sqty', '3');
  await p.click('#itf .btn.pri'); await wait(1000);
  const distTxt = await p.$$eval('#ibody tr', els => {
    const r = els.find(e => e.textContent.includes('雙廠展示機'));
    return r ? r.querySelector('.dist').textContent.replace(/\s+/g, ' ').trim() : '';
  });
  if (!/新竹 2/.test(distTxt) || !/林口 3/.test(distTxt)) throw new Error('清單沒顯示各地分佈:' + distTxt);
  // 目錄:多地點的展品要能選從哪一點借
  await p.click('[data-v=catalog]'); await wait(700);
  const locSel = await p.$$eval('select[id^="loc-"]', els => els.filter(e => e.tagName === 'SELECT').map(e => [...e.options].map(o => o.textContent.trim())));
  if (!locSel.some(opts => opts.some(t => /新竹/.test(t)) && opts.some(t => /林口/.test(t)))) throw new Error('目錄沒有讓人選地點:' + JSON.stringify(locSel));
  // 回歸:後端換版時 POST 會被當成 GET,回來的是健康檢查頁 —— 不可以被當成展品清單
  let healthOnce = false;
  await p.route('**/api', async route => {
    const body = route.request().postData() || '';
    if (healthOnce || !/"action":"catalog"/.test(body)) return route.continue();
    healthOnce = true;                       // 只騙第一次,重試那次讓它拿到真資料
    return route.fulfill({ status: 200, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ success: true, data: '展品管理 API 運作中 2026-09-23T00:00:00.000Z', error: null }) });
  });
  await p.evaluate(() => { RCACHE.clear(); });
  await p.click('[data-v=items]'); await wait(300); await p.click('[data-v=catalog]'); await wait(3000);
  if (!healthOnce) throw new Error('健康檢查回歸測試沒攔到 catalog,測試本身失效了');
  const afterHealth = await p.evaluate(() => Array.isArray(S.items) ? 'array:' + S.items.length : typeof S.items);
  if (!/^array:[1-9]/.test(afterHealth)) throw new Error('健康檢查頁被當成展品清單了:' + afterHealth);
  if (!await p.$('.item-card')) throw new Error('重試後目錄應該要畫得出來');
  await p.unroute('**/api');

  // 盤點:可以只盤一個廠區
  await p.click('[data-v=count]'); await p.waitForSelector('#ksite .catchip');
  const chips2 = await p.$$eval('#ksite .catchip', els => els.map(e => e.textContent.trim()));
  if (!chips2.includes('新竹') || !chips2.includes('林口')) throw new Error('盤點少了廠區籤條:' + chips2.join('|'));
  await p.click('#ksite .catchip[data-site="林口"]'); await wait(600);
  const bodyTxt = await p.textContent('#kbody');
  if (/新竹/.test(bodyTxt)) throw new Error('只盤林口時不該出現新竹的東西');
  if (!/雙廠展示機/.test(bodyTxt)) throw new Error('林口該有的東西沒列出來');
  await shot('count_site');
  await p.click('#ksite .catchip[data-site=""]'); await wait(500);
  await p.click('[data-v=items]'); await wait(500);
  await p.click('#menu-btn'); await p.click('#m-out');
}
