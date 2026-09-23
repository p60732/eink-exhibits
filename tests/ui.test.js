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
  await p.click('#menu-btn'); await p.click('#m-out');
  // 同仁預約
  await p.fill('#l-emp', '10231'); await p.click('#login-f button'); await p.waitForSelector('.cards');
  // 目錄也要分段,且看得到還沒放東西的分類
  const cheads = await p.$$eval('h2.cath', els => els.map(e => e.textContent.trim()));
  if (!cheads.some(h => /^eReader/.test(h)) || !cheads.some(h => /^體驗區/.test(h))) throw new Error('目錄分段不正確:' + cheads.join('|'));
  await shot('catalog_cats');
  const d = k => new Date(Date.now() + k * 864e5).toISOString().slice(0, 10);
  const btns = await p.$$('[data-act=add-cart]'); await btns[0].click(); await btns[1].click();
  await p.click('[data-v=plan]'); await wait(400);
  await p.fill('#ps', d(1)); await p.dispatchEvent('#ps', 'change'); await p.fill('#pe', d(3)); await p.dispatchEvent('#pe', 'change'); await wait(500);
  await p.fill('[name=event]', '台北展'); await wait(200); await shot('plan');
  await p.click('#psubmit'); await wait(500); await p.click('.modal [data-v=mine]'); await wait(400); await shot('mine');
  await p.click('#menu-btn'); await p.click('#m-out');
  // 管理者核准
  await p.fill('#l-emp', '90001'); await p.click('#login-f button'); await p.waitForSelector('#l-pin:visible'); await p.fill('#l-pin', '1234'); await p.click('#login-f button');
  await p.waitForSelector('#tabs .tab'); await p.click('[data-v=dash]'); await p.waitForSelector('.kpis'); await p.click('[data-v=loans]'); await wait(300);
  await p.click('[data-f=pending]'); await wait(300); await p.click('[data-act=approve]'); await p.waitForSelector('#ago'); await p.click('#ago'); await wait(500);
  await p.click('#menu-btn'); await p.click('#m-out');
  // 同仁簽收 + 當面確認
  await p.fill('#l-emp', '10231'); await p.click('#login-f button'); await p.waitForSelector('#tabs .tab');
  await p.click('[data-v=mine]'); await wait(400); await p.click('[data-act=u-pickup]'); await p.waitForSelector('#pgo2');
  const chips = await p.$$('[data-pick]'); await chips[0].click(); await shot('pickup'); await p.click('#pgo2'); await p.waitForSelector('#osf');
  await p.fill('#osf [name=emp]', '90001'); await p.fill('#osf [name=pin]', '1234'); await p.click('#osf .btn.pri'); await wait(700); await shot('mine_out');
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
  await p.click('[data-act=go-loans][data-f=request]'); await wait(300); await p.click('[data-act=receive]'); await p.waitForSelector('#rgo2'); await p.click('#rgo2'); await wait(600);
  await p.click('[data-f=returned]'); await wait(300); const t2 = await p.textContent('#llist'); if (!/已歸還/.test(t2)) throw new Error('未歸還');
  await p.setViewportSize({ width: 390, height: 844 }); await p.click('[data-v=catalog]'); await wait(300); await shot('mobile');
  const sw = await p.evaluate(() => document.documentElement.scrollWidth);
  console.log(errs.length ? 'ERR ' + errs.join('|') : '✔ UI 流程通過', 'scrollWidth=' + sw);
  await b.close();
})().catch(async e => { console.error('✘', e.message); try { await global.__p.screenshot({ path: '/tmp/ee_fail.png' }); console.error(await global.__p.textContent('#toasts')); } catch (x) { } process.exit(1); });
