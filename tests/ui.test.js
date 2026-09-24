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
  // ★ 每一項都要有看得出來的「移除」鈕(使用者回報過:只有一個灰色 ✕ 貼在「在庫 3」旁邊,
  //   看起來像標點符號,結果只能整張清空)。所以這裡連「像不像按鈕」一起驗。
  {
    const rm = await p.$$eval('#plines .line .rm', els => els.map(e => {
      const r = e.getBoundingClientRect(), cs = getComputedStyle(e);
      return { w: Math.round(r.width), h: Math.round(r.height), icon: !!e.querySelector('svg'),
        bordered: cs.borderStyle !== 'none' && cs.borderTopWidth !== '0px' };
    }));
    if (rm.length !== 2) throw new Error('★ 每一項都要有自己的移除鈕,實際 ' + rm.length + ' 個');
    rm.forEach((x, i) => {
      if (x.w < 32 || x.h < 32) throw new Error('★ 移除鈕太小點不到(第 ' + (i + 1) + ' 個 ' + x.w + '×' + x.h + ')');
      if (!x.icon || !x.bordered) throw new Error('★ 移除鈕要有圖示與外框,才看得出來是按鈕(第 ' + (i + 1) + ' 個)');
    });
    // 按下去只能刪掉那一項,不可以把整張清空
    await p.click('#plines .line .rm'); await wait(900);
    const left = await p.$$eval('#plines .line', els => els.length);
    if (left !== 1) throw new Error('★ 移除一項之後應該剩 1 項,實際 ' + left);
    // 補回來,後面的步驟仍要兩項
    await p.click('[data-v=catalog]'); await wait(1000);
    const again = await p.$$('[data-mpick]');
    await again[0].check(); await again[1].check(); await wait(400);
    await p.click('[data-act=multi-go]'); await wait(800);
    const back = await p.$$eval('#plines .line', els => els.length);
    if (back !== 2) throw new Error('重新加回來應該是 2 項,實際 ' + back);
  }
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
  // 第一步只有表單:還沒建立就不該出現需求清單(缺口要有檔期才算得出來)
  if (await p.$('#shlines')) throw new Error('新增階段不該出現需求清單');
  if (await p.$('[data-act=show-pick]')) throw new Error('還沒建立就不該能去挑展品');
  await p.fill('#shform [name=name]', '春季巡迴展');
  await p.fill('#shform [name=from]', d(40)); await p.fill('#shform [name=to]', d(50));
  await p.fill('#shform [name=venue]', '南港展覽館');
  await p.fill('#shform [name=owner]', '10231');
  await p.click('#shform button'); await wait(1400);
  if (!/春季巡迴展/.test(await p.textContent('#main'))) throw new Error('建立展覽後沒有回到明細:' + (await p.textContent('#main')).replace(/\n/g, ' ').slice(0, 200));
  await p.waitForSelector('#shlines');
  await shot('show-new');

  // 第二步:去展品目錄挑 —— 目錄要自動套用展覽檔期,而且不讓人在那裡改日期
  await p.click('[data-act=show-pick]'); await wait(1400);
  const pickTxt = await p.textContent('#pickbar');
  if (!/正在為「春季巡迴展」挑選展品/.test(pickTxt)) throw new Error('目錄沒有進入挑選模式:' + pickTxt);
  if (!new RegExp(d(40)).test(pickTxt)) throw new Error('挑選橫幅沒顯示展覽檔期:' + pickTxt);
  if (await p.$('#cs')) throw new Error('挑選模式不該讓人在目錄改日期');
  if (!/期間可借/.test(await p.textContent('#cgrid'))) throw new Error('挑選模式要顯示該檔期的可借量');
  // 挑一台「雙廠展示機(林口)」進來
  const cards = await p.$$('.item-card');
  let hit = null;
  for (const c of cards) if (/雙廠展示機/.test(await c.textContent())) { hit = c; break; }
  if (!hit) throw new Error('目錄裡找不到雙廠展示機');
  const iid = await hit.$eval('[data-act=show-add-cat]', e => e.dataset.id);
  await p.selectOption('#loc-' + iid, '林口');
  await p.fill('#q-' + iid, '2');
  await p.click(`[data-act=show-add-cat][data-id="${iid}"]`); await wait(700);
  const btnTxt = await p.textContent(`[data-act=show-add-cat][data-id="${iid}"]`);
  const lineN = await p.evaluate(() => JSON.stringify(S.showLines));
  if (!/加入展覽.已選 2/.test(btnTxt)) throw new Error('卡片沒顯示已選數量,按鈕是「' + btnTxt + '」,S.showLines=' + lineN);
  await shot('show-pick');
  // ★ 挑到一半重新整理:要回到原地繼續,而且已選的東西不能不見
  await p.reload(); await wait(2500);
  const afterReload = await p.textContent('#pickbar');
  if (!/已選 1 項/.test(afterReload)) throw new Error('重整之後挑選中的清單不見了:' + afterReload);
  // ★ 挑選中途跑回展覽頁按「儲存」,挑選狀態要一起收掉 ——
  //   只清一半的話,重整之後會帶著空清單回到挑選模式,按「完成」就把後端的清單洗光
  await p.click('[data-v=shows]'); await wait(1500);
  await p.click('#shform button'); await wait(1500);
  await p.reload(); await wait(2500);
  if (await p.$('#pickbar')) throw new Error('★ 存檔之後不該還停在挑選模式');
  await p.click('[data-v=shows]'); await wait(1500);
  await p.click('[data-act=show-open]'); await wait(1500);       // 修好之後重整會落在清單,要再點進那一場
  if (!/林口/.test(await p.textContent('#shlines'))) throw new Error('★ 存檔後重整,需求清單被清掉了');
  await p.click('[data-act=show-pick]'); await wait(1800);
  await p.click('[data-act=show-pick-done]'); await wait(1800);
  if (!/林口/.test(await p.textContent('#shlines'))) throw new Error('挑完沒有帶回需求清單');
  // 場地與承辦人不可以被挑選流程洗掉
  if (await p.inputValue('#shform [name=venue]') !== '南港展覽館') throw new Error('挑完之後場地被清掉了');
  if (await p.inputValue('#shform [name=owner]') !== '10231') throw new Error('挑完之後承辦人被清掉了');

  // 整批貼上:對不到的那一行要留在框裡讓人修,其餘照樣加入
  await p.click('[data-act=show-paste]'); await p.waitForSelector('#sp-txt');
  await p.fill('#sp-txt', '雙廠展示機\t新竹\t1\n根本沒有這個展品\t1');
  await p.click('[data-act=show-paste-ok]'); await wait(600);
  const pasteMsg = await p.textContent('#sp-out');
  if (!/有 1 行對不到/.test(pasteMsg)) throw new Error('沒有回報對不到的行:' + pasteMsg.replace(/\n/g, ' ').slice(0, 120));
  if (!/根本沒有這個展品/.test(await p.inputValue('#sp-txt'))) throw new Error('對不到的行應該留在輸入框裡');
  await p.click('.modal [data-act=close]'); await wait(400);
  if ((await p.$$('#shlines .line')).length !== 2) throw new Error('挑 1 行 + 貼 1 行,應該有 2 行');
  await wait(900);
  if (!/足夠|缺/.test(await p.textContent('#shsum'))) throw new Error('沒有即時算出可借量');
  await p.click('#shform button'); await wait(1400);
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
  if (!/已產生 2 張借用單/.test(genTxt)) throw new Error('產生借用單結果不對(新竹、林口各一張):' + genTxt.replace(/\n/g, ' ').slice(0, 140));
  await p.click('.modal [data-act=close-render]'); await wait(1400);
  const after3 = await availOf();
  if (after3 !== after2) throw new Error('★ 開單後可借量不該再變(重複扣庫存):' + after2 + ' → ' + after3);
  if (!/已開單 2/.test(await p.textContent('#shlines'))) throw new Error('需求清單沒顯示已開單量');
  await shot('show-detail');

  // ---- v2.4:缺口點得開 / 備料清單 / 匯出 CSV ----
  {
    // 先把這場的規劃量加到超過庫存,逼出一個缺口
    await p.evaluate(async () => {
      const id = S.showId;
      const v = await Api.call('show', { id }, S.token);
      const lines = v.lines.map(l => ({ itemId: l.itemId, location: l.location, qty: l.qty + 50, note: l.note || '' }));
      await Api.call('saveShow', { show: { id, name: v.name, from: v.from, to: v.to, venue: v.venue, owner: v.owner, note: v.note, lines } }, S.token);
    });
    await p.evaluate(() => { bumpCache(); S.showLines = null; render(); }); await wait(2000);
    const gapBtn = await p.$('#shlines [data-act=who]');
    if (!gapBtn) throw new Error('★ 有缺口時「缺 N」要是可以點的');
    await gapBtn.click(); await wait(2000);
    const whoTxt = await p.textContent('.modal');
    if (!/是誰佔著/.test(whoTxt)) throw new Error('缺口來源視窗沒開:' + whoTxt.replace(/\n/g, ' ').slice(0, 160));
    if (!/借用單佔|展覽卡著|沒有人佔著/.test(whoTxt)) throw new Error('★ 缺口視窗要講清楚是被誰佔著:' + whoTxt.replace(/\n/g, ' ').slice(0, 200));
    await shot('who-holds');
    await p.click('.modal [data-act=close]'); await wait(700);
    // 備料清單:規劃中 / 已確認都要印得出來,攔下 window.open 檢查內容
    await p.evaluate(() => { window.__printed = ''; window.open = () => ({ document: { write: h => { window.__printed = h; }, close() { } }, print() { } }); });
    await p.click('[data-act=sheet-print]'); await wait(2000);
    const sheet = await p.evaluate(() => window.__printed || '');
    if (!/備料清單/.test(sheet)) throw new Error('備料清單沒印出來');
    if (!/新竹|林口/.test(sheet)) throw new Error('★ 備料清單要依廠區分段:' + sheet.slice(0, 200));
    if (!/點貨人簽名/.test(sheet)) throw new Error('備料清單要有簽名欄');
    if (!/class="bx"/.test(sheet)) throw new Error('★ 備料清單每一項要有可以手勾的格子');
    // 匯出 CSV:攔下下載
    const dl = p.waitForEvent('download', { timeout: 15000 }).catch(() => null);
    await p.click('[data-act=sheet-csv]'); await wait(1500);
    const got = await dl;
    if (!got) throw new Error('★ 匯出 CSV 沒有產生下載');
    // 驗內容而不是檔名 —— headless 的 blob 下載回報的檔名不一定帶得出 download 屬性
    const csv = require('fs').readFileSync(await got.path(), 'utf8');
    if (!/廠區/.test(csv) || !/規劃量/.test(csv) || !/缺口/.test(csv)) throw new Error('★ CSV 欄位不對:' + csv.slice(0, 200));
    if (!/春季巡迴展/.test(csv)) throw new Error('CSV 沒帶出展覽名稱');
    // 把規劃量改回去,後面的步驟還要用
    await p.evaluate(async () => {
      const id = S.showId;
      const v = await Api.call('show', { id }, S.token);
      const lines = v.lines.map(l => ({ itemId: l.itemId, location: l.location, qty: Math.max(1, l.qty - 50), note: l.note || '' }));
      await Api.call('saveShow', { show: { id, name: v.name, from: v.from, to: v.to, venue: v.venue, owner: v.owner, note: v.note, lines } }, S.token);
    });
    await p.evaluate(() => { bumpCache(); S.showLines = null; render(); }); await wait(2000);
  }

  // ---- v2.3:展後結算 / 批次申請歸還 / 整理歷史 ----
  // 純粹推進狀態的步驟(點交、確認歸還)直接呼叫後端,這一段要驗的是畫面
  const shid = await p.evaluate(() => S.showId);
  await p.evaluate(async id => {
    const v = await Api.call('show', { id }, S.token);
    for (const L of v.loans.filter(x => x.status === 'approved')) await Api.call('checkout', { id: L.id, units: {} }, S.token);
  }, shid);
  await p.evaluate(() => { bumpCache(); render(); }); await wait(1800);
  // 批次申請歸還:撤場時一次送出,預設全勾
  if (!await p.$('[data-act=show-return]')) throw new Error('底下有出借中的單時應該出現「批次申請歸還」');
  await p.click('[data-act=show-return]'); await p.waitForSelector('.sr-id');
  const srN = await p.$$eval('.sr-id', els => els.filter(e => e.checked).length);
  if (srN !== 2) throw new Error('批次歸還預設應該把出借中的都勾起來:' + srN);
  await p.click('[data-act=show-return-ok]'); await wait(2000);
  const srReq = await p.evaluate(async id =>
    (await Api.call('show', { id }, S.token)).loans.filter(L => L.request && L.request.type === 'return').length, shid);
  if (srReq !== 2) throw new Error('★ 批次申請歸還沒有把請求掛上去:' + srReq);
  // 確認歸還 → 結案 → 結算卡片要出現,而且說東西都回來了
  await p.evaluate(async id => {
    const v = await Api.call('show', { id }, S.token);
    for (const L of v.loans.filter(x => x.status === 'out')) {
      await Api.call('receive', { id: L.id, lines: L.lines.map(ln => ({ itemId: ln.itemId, location: ln.location,
        returned: ln.qty - (ln.returned || 0) - (ln.lost || 0) })) }, S.token);
    }
    await Api.call('setShowStatus', { id, status: 'closed' }, S.token);
  }, shid);
  await p.evaluate(() => { bumpCache(); render(); }); await wait(2000);
  await p.waitForSelector('#settle');
  const seTxt = await p.textContent('#settle');
  if (!/東西都回來了/.test(seTxt)) throw new Error('結算卡片應該說東西都回來了:' + seTxt.replace(/\n/g, ' ').slice(0, 220));
  if (!/規劃/.test(seTxt) || !/未歸還/.test(seTxt)) throw new Error('結算四欄沒出現:' + seTxt.replace(/\n/g, ' ').slice(0, 220));
  await shot('show-settle');

  // 整理歷史:預覽 → 搬走 → 預設查不到、勾了「含歷史資料」才查得到
  await p.click('[data-v=loans]'); await wait(1400);
  await p.click('[data-act=arch-open]'); await p.waitForSelector('.modal .ar-s');
  if (!/春季巡迴展/.test(await p.textContent('.modal'))) throw new Error('整理歷史的預覽沒列出已結案的展覽');
  await p.click('[data-act=arch-go]'); await p.waitForSelector('.modal [data-act=close-render]');
  const archTxt = await p.textContent('.modal');
  if (!/已搬走 2 張/.test(archTxt)) throw new Error('搬走的張數不對:' + archTxt.replace(/\n/g, ' ').slice(0, 160));
  await p.click('.modal [data-act=close-render]'); await wait(1600);
  await p.click('[data-f=all]'); await wait(1600);
  if (/已封存/.test(await p.textContent('#llist'))) throw new Error('★ 沒勾「含歷史資料」不該列出封存的舊單');
  await p.click('#lhist'); await wait(1800);
  if (!/已封存/.test(await p.textContent('#llist'))) throw new Error('★ 勾了「含歷史資料」就要查得到封存的舊單');
  await p.click('#lhist'); await wait(1600);
  // 已封存的展覽:結算改看快照,而且不給重新開啟
  await p.click('[data-v=shows]'); await wait(1400);
  await p.click('[data-act=show-filter][data-f=all]'); await wait(1400);   // 結案的不在「進行中」那一籤
  await p.click(`[data-act=show-open][data-id="${shid}"]`); await wait(1800);
  await p.waitForSelector('#settle');
  if (!/封存快照/.test(await p.textContent('#settle'))) throw new Error('★ 封存之後結算要標示成快照');
  if (await p.$('[data-act=show-status][data-s=confirmed]')) throw new Error('★ 已封存的展覽不該還有「重新開啟」');

  await p.click('[data-act=show-back]'); await wait(900);
  if (!/春季巡迴展/.test(await p.textContent('#main'))) throw new Error('展覽清單沒有這一場');
  // ★ 點進某一場 → 切走 → 再回來,應該看到清單,不是停在上一場
  await p.click('[data-act=show-open]'); await wait(1200);
  if (!await p.$('#shform')) throw new Error('沒有進到展覽明細');
  await p.click('[data-v=items]'); await wait(900);
  await p.click('[data-v=shows]'); await wait(1200);
  if (await p.$('#shform')) throw new Error('★ 切回展覽分頁應該回到清單,不該停在上一場');
  await p.click('[data-v=loans]'); await wait(700); await p.click('[data-f=all]'); await wait(1000);
  // 列印:攔下 window.open,檢查產出的單據內容
  await p.evaluate(() => { window.__printed = ''; window.open = () => ({ document: { write: h => { window.__printed = h; }, close() { } }, print() { } }); });
  await (await p.$('[data-act=print-loan]')).click(); await wait(700);
  const printed = await p.evaluate(() => window.__printed || '');
  if (!/展品借用單/.test(printed) || !/簽名/.test(printed)) throw new Error('列印單據內容不對');
  // ★ 換人登入不可以看到前一個人的購物車(工作中的狀態要綁使用者,登出要清掉)
  await p.click('[data-v=catalog]'); await wait(1200);
  await (await p.$$('[data-act=add-cart]'))[0].click(); await wait(500);
  if (!/借用申請/.test(await p.textContent('#tabs'))) throw new Error('分頁名稱應該是「借用申請」');
  const badgeBefore = await p.textContent('#tabs [data-v=plan]');
  if (!/\d/.test(badgeBefore)) throw new Error('加入之後分頁上應該有數量徽章:' + badgeBefore);
  await p.click('#menu-btn'); await p.click('#m-out'); await p.waitForSelector('#login-f');
  await p.fill('#l-emp', '10231'); await p.click('#login-f button'); await p.waitForSelector('#tabs .tab');
  const badgeAfter = await p.textContent('#tabs [data-v=plan]');
  if (/\d/.test(badgeAfter)) throw new Error('★ 換人登入後還看得到前一個人的購物車:' + badgeAfter);
  await p.click('[data-v=plan]'); await wait(800);
  if (!/還沒有選任何展品/.test(await p.textContent('#main'))) throw new Error('★ 換人登入後購物車應該是空的');

  // ---- 「系統已經更新」橫幅(v2.3.2)----
  // index.html 本身也會被瀏覽器快取,舊的 HTML 裡寫的還是舊的 ?v=,所以「重新整理」常常沒有用。
  // 這裡假裝「這一份頁面是舊的建置、伺服器上已經是新的」,驗證橫幅會出現、按了會帶著新編號重新載入。
  {
    const srcHtml = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
    const p2 = await b.newPage({ viewport: { width: 1280, height: 900 } });
    p2.on('dialog', dlg => dlg.accept());
    await p2.route('**/version.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"build":"bbbbbbbb"}' }));
    await p2.route(URL, r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: srcHtml.replace('__BUILD__', 'aaaaaaaa') }));
    await p2.goto(URL);
    await p2.waitForSelector('#newver', { timeout: 10000 }).catch(() => { throw new Error('★ 建置編號不一樣時要掛出「系統已經更新」橫幅'); });
    if (!/已經更新/.test(await p2.textContent('#newver'))) throw new Error('橫幅文字不對');
    await p2.click('#nv-go'); await p2.waitForTimeout(1500);
    if (!/\?b=bbbbbbbb/.test(p2.url())) throw new Error('★ 按了更新要換一個帶建置編號的網址(reload 可能又拿到快取裡的舊 HTML):' + p2.url());
    // 編號一樣的時候不可以打擾使用者
    const p3 = await b.newPage({ viewport: { width: 1280, height: 900 } });
    await p3.route('**/version.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"build":"aaaaaaaa"}' }));
    await p3.route(URL, r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: srcHtml.replace('__BUILD__', 'aaaaaaaa') }));
    await p3.goto(URL); await p3.waitForTimeout(2500);
    if (await p3.$('#newver')) throw new Error('★ 編號一樣就不該跳更新橫幅');
    // 拿不到 version.json 也不可以壞掉(離線 / 還沒部署)
    const p4 = await b.newPage({ viewport: { width: 1280, height: 900 } });
    const e4 = []; p4.on('pageerror', e => e4.push(e.message));
    await p4.route('**/version.json*', r => r.abort());
    await p4.route(URL, r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: srcHtml.replace('__BUILD__', 'aaaaaaaa') }));
    await p4.goto(URL); await p4.waitForSelector('#login-f', { timeout: 10000 });
    if (e4.length) throw new Error('★ 抓不到 version.json 不可以影響正常使用:' + e4.join('|'));
    await p2.close(); await p3.close(); await p4.close();
  }

  await p.setViewportSize({ width: 390, height: 844 }); await p.click('[data-v=catalog]'); await wait(300); await shot('mobile');
  const sw = await p.evaluate(() => document.documentElement.scrollWidth);
  console.log(errs.length ? 'ERR ' + errs.join('|') : '✔ UI 流程通過', 'scrollWidth=' + sw);
  await b.close();
})().catch(async e => { console.error('✘', e.message); try { await global.__p.screenshot({ path: '/tmp/ee_fail.png' }); console.error(await global.__p.textContent('#toasts')); } catch (x) { } process.exit(1); });
