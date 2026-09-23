// 前端流程測試(需先 node tests/serve.js 8787):node tests/ui.test.js
const { chromium } = require('playwright');
const URL = 'http://localhost:' + (process.env.PORT || 8787) + '/';
(async () => {
  global.__b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-proxy-server'] });
  const b = global.__b;
  const p = global.__p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  const shot = n => p.screenshot({ path: `/tmp/ee_${n}.png`, fullPage: true });
  const wait = ms => p.waitForTimeout(ms);
  // 1×1 透明 PNG,給照片上傳測試用
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await p.goto(URL); await p.waitForSelector('#login-f');
  await p.fill('[name=name]', '測試管理者'); await p.fill('#l-emp', '90001'); await p.fill('#l-pin', '1234'); await p.click('#login-f button');
  await p.waitForSelector('.kpis'); await shot('dash0');
  // 匯入人員、新增展品
  await p.click('[data-v=users]'); await wait(300); await p.click('[data-act=import-users]');
  await p.fill('#iut', '10231\t測試員工A\t業務部\n10477\t測試員工B\t產品部'); await p.click('#iugo'); await wait(400);
  await p.click('[data-v=items]'); await wait(500);
  // 預設七個分類要在籤條上,且順序正確
  const catChips = await p.$$eval('.catbar .catchip', els => els.map(e => e.dataset.cat));
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
  await p.click('.catbar .catchip[data-cat="Signage"]'); await wait(400);
  const rows = await p.$$eval('#ibody tr:not(.grouph)', els => els.length);
  if (rows !== 1) throw new Error('籤條篩選後應只剩 1 筆,實際 ' + rows);
  await p.click('.catbar .catchip[data-cat=""]'); await wait(400);
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
  // 同仁預約
  await p.fill('#l-emp', '10231'); await p.click('#login-f button'); await p.waitForSelector('.cards');
  // 目錄也要分段,且看得到還沒放東西的分類
  const cheads = await p.$$eval('h2.cath', els => els.map(e => e.textContent.trim()));
  if (!cheads.some(h => /^eReader/.test(h)) || !cheads.some(h => /^體驗區/.test(h))) throw new Error('目錄分段不正確:' + cheads.join('|'));
  await shot('catalog_cats');
  const d = k => new Date(Date.now() + k * 864e5).toISOString().slice(0, 10);
  // 多選一起填單
  const picks = await p.$$('[data-mpick]');
  await picks[0].check(); await picks[1].check(); await wait(400);
  if (!await p.isVisible('.multibar')) throw new Error('多選後沒有出現「一起填單」');
  await shot('multi'); await p.click('[data-act=multi-go]'); await wait(600);
  const nLines = await p.$$eval('#plines .line', els => els.length);
  if (nLines !== 2) throw new Error('一起填單應帶入 2 項,實際 ' + nLines);
  await p.fill('#ps', d(1)); await p.dispatchEvent('#ps', 'change'); await p.fill('#pe', d(3)); await p.dispatchEvent('#pe', 'change'); await wait(500);
  await p.fill('[name=event]', '台北展'); await wait(200); await shot('plan');
  await p.click('#psubmit'); await wait(500); await p.click('.modal [data-v=mine]'); await wait(600); await shot('mine');
  // 改單:待審核時可以自己改,不用取消重來
  await p.click('[data-act=edit-loan]'); await wait(800);
  if (!await p.isVisible('[data-act=cancel-edit]')) throw new Error('沒有進入改單模式');
  await p.fill('[name=event]', '台北展(改過)'); await wait(300);
  await p.click('#psubmit'); await wait(900);
  const mineTxt = await p.textContent('.loans');
  if (!/台北展\(改過\)/.test(mineTxt)) throw new Error('改單沒生效:' + mineTxt.replace(/\n/g, ' ').slice(0, 120));
  await p.click('#menu-btn'); await p.click('#m-out');
  // 管理者核准
  await p.fill('#l-emp', '90001'); await p.click('#login-f button'); await p.waitForSelector('#l-pin:visible'); await p.fill('#l-pin', '1234'); await p.click('#login-f button');
  await p.waitForSelector('#tabs .tab'); await p.click('[data-v=dash]'); await p.waitForSelector('.kpis'); await p.click('[data-v=loans]'); await wait(300);
  await p.click('[data-f=pending]'); await wait(400); await p.click('[data-act=approve]'); await p.waitForSelector('#ago'); await p.click('#ago'); await wait(600);
  await p.click('#menu-btn'); await p.click('#m-out');
  // 同仁簽收 + 當面確認
  await p.fill('#l-emp', '10231'); await p.click('#login-f button'); await p.waitForSelector('#tabs .tab');
  await p.click('[data-v=mine]'); await wait(400); await p.click('[data-act=u-pickup]'); await p.waitForSelector('#pgo2');
  await p.click('#pauto'); await wait(500);                       // 自動指派:不用逐台勾
  const pc = await p.textContent('[data-pc]');
  if (!/已選 1 \/ 1/.test(pc)) throw new Error('自動選好沒生效:' + pc);
  await shot('pickup'); await p.click('#pgo2'); await p.waitForSelector('#osf');
  // 一次把兩欄填好再送出,避免自動聚焦跟輸入搶時序
  await p.$eval('#osf', (f, v) => { f.emp.value = v.e; f.pin.value = v.p; }, { e: '90001', p: '1234' });
  await p.click('#osf .btn.pri'); await wait(900); await shot('mine_out');
  const st = await p.textContent('.loans'); if (!/出借中/.test(st)) throw new Error('未變成出借中');
  // 歸還
  await p.click('[data-act=u-return]'); await p.waitForSelector('#ugo2'); await p.click('#ugo2'); await p.waitForSelector('#osf'); await p.click('.modal [data-act=close-render]'); await wait(500);
  await p.click('#menu-btn'); await p.click('#m-out');
  await p.fill('#l-emp', '90001'); await p.click('#login-f button'); await p.waitForSelector('#l-pin:visible'); await p.fill('#l-pin', '1234'); await p.click('#login-f button');
  await p.waitForSelector('#tabs .tab'); await p.click('[data-v=dash]'); await p.waitForSelector('.kpis'); await shot('dash_req');
  // 管理者切換到同仁視角預覽,再切回來
  await p.click('#menu-btn'); await p.click('#m-view'); await wait(600);
  const asTabs = await p.$$eval('#tabs .tab', els => els.map(e => e.dataset.v));
  if (asTabs.join() !== 'catalog,plan,mine') throw new Error('同仁視角分頁不正確:' + asTabs.join());
  if (!await p.isVisible('#viewas-btn')) throw new Error('同仁視角提示鍵沒出現');
  if (await p.isVisible('[data-v=dash]')) throw new Error('同仁視角不該看到總覽');
  await shot('as_user');
  await p.click('#viewas-btn'); await wait(600);
  if (!await p.isVisible('[data-v=dash]')) throw new Error('未回到管理者視角');
  if (await p.isVisible('#viewas-btn')) throw new Error('提示鍵沒收起來');
  // 盤點頁:總計對照、分類分段、逐台差異、借出中的也要列出來
  await p.click('[data-v=count]'); await wait(1500);
  if ((await p.$$('#ksum .kpi')).length < 5) throw new Error('盤點少了總計對照磚');
  const kchips = await p.$$eval('#kbar .catchip', els => els.map(e => e.dataset.cat));
  if (!kchips.includes('Signage')) throw new Error('盤點沒有分類籤條:' + kchips.join('|'));
  if (!(await p.$('.outbox'))) throw new Error('盤點沒有列出借出中的單台');
  const outTxt = await p.textContent('.outbox');
  if (!/測試員工A/.test(outTxt)) throw new Error('借出中沒顯示持有人:' + outTxt.replace(/\n/g, ' '));
  await (await p.$('#kbody .chipk')).click(); await wait(500);
  const udiff = (await p.$$eval('[data-udiff]', els => els.map(e => e.textContent.trim()))).filter(Boolean);
  if (!udiff.some(t => /差異|相符/.test(t))) throw new Error('逐台差異沒顯示:' + udiff.join('|'));
  const sumTxt = await p.textContent('#ksum');
  if (!/實際點到/.test(sumTxt)) throw new Error('總計對照內容不對:' + sumTxt.replace(/\n/g, ' '));
  // 數量品項:點「借出中」要看得到是誰借走的
  const owBtn = await p.$('[data-act=out-who]');
  if (!owBtn) throw new Error('數量品項沒有可點的借出中');
  await owBtn.click(); await p.waitForSelector('.modal .lines');
  const owTxt = await p.textContent('.modal');
  if (!/測試員工A/.test(owTxt)) throw new Error('借出中沒顯示持有人:' + owTxt.replace(/\n/g, ' ').slice(0, 120));
  await shot('count_who'); await p.click('.modal [data-act=close]'); await wait(400);
  await shot('count');
  await p.click('[data-v=dash]'); await p.waitForSelector('.kpis');
  await p.click('[data-act=go-loans][data-f=request]'); await wait(300); await p.click('[data-act=receive]'); await p.waitForSelector('#rgo2');
  await p.click('#rgo2'); await wait(600);
  await p.click('[data-f=returned]'); await wait(500); const t2 = await p.textContent('#llist'); if (!/已歸還/.test(t2)) throw new Error('未歸還');
  // 進行中的五個分頁共用同一次請求:切分頁不應該再打後端
  await p.click('[data-f=pending]'); await wait(900);
  await p.evaluate(() => { window.__n = 0; const f = window.fetch; window.fetch = (...a) => { window.__n++; return f(...a); }; });
  for (const t of ['approved', 'out', 'overdue', 'request', 'pending']) { await p.click(`[data-f=${t}]`); await wait(450); }
  const nReq = await p.evaluate(() => window.__n);
  if (nReq > 0) throw new Error('切進行中的分頁不該再打後端,實際打了 ' + nReq + ' 次');
  await p.click('[data-f=all]'); await wait(700);
  if (await p.evaluate(() => window.__n) === 0) throw new Error('「全部」應該要向後端要資料');
  // ---- 待辦 / 批次核准 / 延期 / 轉借 / 列印 ----
  const makeLoan = async (name, d1, d2) => {
    await p.click('[data-v=catalog]'); await wait(900);
    const ps = await p.$$('[data-mpick]'); await ps[1].check(); await wait(300);
    await p.click('[data-act=multi-go]'); await wait(900);
    await p.fill('#ps', d1); await p.dispatchEvent('#ps', 'change');
    await p.fill('#pe', d2); await p.dispatchEvent('#pe', 'change'); await wait(700);
    await p.fill('[name=event]', name); await wait(300);
    await p.click('#psubmit'); await wait(900); await p.click('.modal [data-act=close]'); await wait(400);
  };
  await p.click('#menu-btn'); await p.click('#m-out');
  await p.fill('#l-emp', '10231'); await p.click('#login-f button'); await p.waitForSelector('#tabs .tab');
  await makeLoan('延期測試', d(10), d(12));
  await makeLoan('轉借測試', d(20), d(22));
  await p.click('#menu-btn'); await p.click('#m-out');
  await p.fill('#l-emp', '90001'); await p.click('#login-f button'); await p.waitForSelector('#l-pin:visible'); await p.fill('#l-pin', '1234'); await p.click('#login-f button');
  await p.waitForSelector('#tabs .tab'); await p.click('[data-v=dash]'); await p.waitForSelector('.kpis'); await wait(800);
  if (!await p.isVisible('.card.todo')) throw new Error('總覽沒有「今天要做的事」');
  const todoTxt = await p.textContent('.card.todo');
  if (!/待審核/.test(todoTxt)) throw new Error('待辦沒列出待審核:' + todoTxt.replace(/\n/g, ' '));
  await shot('todo');
  await p.click('.card.todo [data-act=go-loans][data-f=pending]'); await wait(1000);
  if (!await p.isVisible('.bulkbar')) throw new Error('沒有出現批次核准列');
  await p.click('#lall'); await wait(600);
  await p.click('#lgo'); await p.waitForSelector('#bgo'); await p.click('#bgo'); await wait(1500);
  const bulkTxt = await p.textContent('.modal');
  if (!/成功 2 張/.test(bulkTxt)) throw new Error('批次核准結果不對:' + bulkTxt.replace(/\n/g, ' ').slice(0, 140));
  await shot('bulk'); await p.click('.modal [data-act=close-render]'); await wait(800);
  // 同仁:申請延期 + 轉借
  await p.click('#menu-btn'); await p.click('#m-out');
  await p.fill('#l-emp', '10231'); await p.click('#login-f button'); await p.waitForSelector('#tabs .tab');
  await p.click('[data-v=mine]'); await wait(1000);
  await (await p.$$('[data-act=u-extend]'))[0].click(); await p.waitForSelector('#xgo');
  await p.fill('#xd', d(30)); await p.click('#xgo'); await wait(1200);
  await p.click('.modal [data-act=close-render]'); await wait(900);
  await (await p.$$('[data-act=u-transfer]'))[0].click(); await p.waitForSelector('#tgo');
  await p.fill('#td', '10477'); await p.click('#tgo'); await wait(1200);
  await p.click('.modal [data-act=close-render]'); await wait(900);
  const stages = await p.textContent('.loans');
  if (!/待確認延期/.test(stages) || !/待確認轉借/.test(stages)) throw new Error('請求狀態沒顯示:' + stages.replace(/\n/g, ' ').slice(0, 160));
  await shot('requests');
  // 管理者:同意延期與轉借
  await p.click('#menu-btn'); await p.click('#m-out');
  await p.fill('#l-emp', '90001'); await p.click('#login-f button'); await p.waitForSelector('#l-pin:visible'); await p.fill('#l-pin', '1234'); await p.click('#login-f button');
  await p.waitForSelector('#tabs .tab'); await p.click('[data-v=loans]'); await wait(700);
  await p.click('[data-f=request]'); await wait(1000);
  const reqN = (await p.$$('[data-act=req-ok]')).length;
  if (reqN !== 2) throw new Error('待確認應有 2 張,實際 ' + reqN);
  for (let k = 0; k < 2; k++) {
    await (await p.$$('[data-act=req-ok]'))[0].click(); await p.waitForSelector('#dgo');
    await p.click('#dgo'); await wait(1400); await p.click('[data-f=request]'); await wait(900);
  }
  await p.click('[data-f=all]'); await wait(1000);
  const allTxt = await p.textContent('#llist');
  if (!/測試員工B/.test(allTxt)) throw new Error('轉借後借用人沒換人');
  if (!new RegExp(d(30)).test(allTxt)) throw new Error('延期後歸還日沒改成 ' + d(30));
  /* ---- 展覽檔期:新增 → 整批貼上 → 確認卡位 → 產生借用單 ---- */
  await p.click('[data-v=shows]'); await wait(700);
  await p.click('[data-act=show-new]'); await p.waitForSelector('#shform'); await wait(300);
  // 整批貼上:對不到的那一行要留在框裡讓人修,其餘照樣加入
  await p.click('[data-act=show-paste]'); await p.waitForSelector('#sp-txt');
  await p.fill('#sp-txt', '雙廠展示機\t林口\t2\n根本沒有這個展品\t1');
  await p.click('[data-act=show-paste-ok]'); await wait(600);
  const pasteMsg = await p.textContent('#sp-out');
  if (!/有 1 行對不到/.test(pasteMsg)) throw new Error('沒有回報對不到的行:' + pasteMsg.replace(/\n/g, ' ').slice(0, 120));
  if (!/根本沒有這個展品/.test(await p.inputValue('#sp-txt'))) throw new Error('對不到的行應該留在輸入框裡');
  await p.click('.modal [data-act=close]'); await wait(400);
  if ((await p.$$('#shlines .line')).length !== 1) throw new Error('貼上之後應該有 1 行');
  // 填檔期 → 缺口即時算出來
  await p.fill('#shform [name=name]', '春季巡迴展');
  await p.fill('#shform [name=from]', d(40)); await p.fill('#shform [name=to]', d(50)); await wait(900);
  await p.fill('#shform [name=owner]', '10231');
  if (!/足夠|缺/.test(await p.textContent('#shsum'))) throw new Error('沒有即時算出可借量');
  await p.click('#shform button'); await wait(1200);
  if (!/春季巡迴展/.test(await p.textContent('#main'))) throw new Error('建立展覽後沒有回到明細:' + (await p.textContent('#main')).replace(/\n/g, ' ').slice(0, 200));
  await shot('show-new');
  // 確認檔期 → 開始卡位;可借量要跟著少 2
  const availOf = () => p.evaluate(async () => {
    const it = (await Api.call('catalog', {}, S.token)).find(i => i.name === '雙廠展示機');
    const r = await Api.call('check', { start: S._t1, end: S._t2, lines: [{ itemId: it.id, location: '林口', qty: 1 }] }, S.token);
    return r[0].available;
  });
  await p.evaluate(([a, b2]) => { S._t1 = a; S._t2 = b2; }, [d(42), d(44)]);
  const before2 = await availOf();
  await p.click('[data-act=show-status][data-s=confirmed]'); await wait(1400);
  const after2 = await availOf();
  if (after2 !== before2 - 2) throw new Error('確認檔期後應該卡住 2 台:' + before2 + ' → ' + after2);
  // 產生借用單 → 卡位讓給借用單,合計不變(重複扣的話這裡會再少 2)
  await p.click('[data-act=show-gen]'); await p.waitForSelector('.modal [data-act=close-render]'); await wait(300);
  const genTxt = await p.textContent('.modal');
  if (!/已產生 1 張借用單/.test(genTxt)) throw new Error('產生借用單結果不對:' + genTxt.replace(/\n/g, ' ').slice(0, 140));
  await p.click('.modal [data-act=close-render]'); await wait(1400);
  const after3 = await availOf();
  if (after3 !== after2) throw new Error('★ 開單後可借量不該再變(重複扣庫存):' + after2 + ' → ' + after3);
  if (!/已開單 2/.test(await p.textContent('#shlines'))) throw new Error('需求清單沒顯示已開單量');
  await shot('show-detail');
  await p.click('[data-act=show-back]'); await wait(900);
  if (!/春季巡迴展/.test(await p.textContent('#main'))) throw new Error('展覽清單沒有這一場');
  await p.click('[data-v=loans]'); await wait(700); await p.click('[data-f=all]'); await wait(1000);
  // 列印:攔下 window.open,檢查產出的單據內容
  await p.evaluate(() => { window.__printed = ''; window.open = () => ({ document: { write: h => { window.__printed = h; }, close() { } }, print() { } }); });
  await (await p.$('[data-act=print-loan]')).click(); await wait(700);
  const printed = await p.evaluate(() => window.__printed || '');
  if (!/展品借用單/.test(printed) || !/簽名/.test(printed)) throw new Error('列印單據內容不對');
  await p.setViewportSize({ width: 390, height: 844 }); await p.click('[data-v=catalog]'); await wait(300); await shot('mobile');
  const sw = await p.evaluate(() => document.documentElement.scrollWidth);
  console.log(errs.length ? 'ERR ' + errs.join('|') : '✔ UI 流程通過', 'scrollWidth=' + sw);
  await b.close();
})().catch(async e => { console.error('✘', e.message); try { await global.__p.screenshot({ path: '/tmp/ee_fail.png' }); console.error(await global.__p.textContent('#toasts')); } catch (x) { } process.exit(1); });
