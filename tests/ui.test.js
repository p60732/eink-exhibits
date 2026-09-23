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
  await p.click('[data-v=items]'); await wait(300); await p.click('[data-act=import]');
  await p.fill('#imt', '42吋彩色看板\t大尺寸看板\t逐台\t3\t湖口B倉\n展示立架\t陳列道具\t數量\t10\t湖口B倉'); await p.click('#imgo'); await wait(500); await shot('items');
  await p.click('#menu-btn'); await p.click('#m-out');
  // 同仁預約
  await p.fill('#l-emp', '10231'); await p.click('#login-f button'); await p.waitForSelector('.cards');
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
  await p.click('[data-act=go-loans][data-f=request]'); await wait(300); await p.click('[data-act=receive]'); await p.waitForSelector('#rgo2'); await p.click('#rgo2'); await wait(600);
  await p.click('[data-f=returned]'); await wait(300); const t2 = await p.textContent('#llist'); if (!/已歸還/.test(t2)) throw new Error('未歸還');
  await p.setViewportSize({ width: 390, height: 844 }); await p.click('[data-v=catalog]'); await wait(300); await shot('mobile');
  const sw = await p.evaluate(() => document.documentElement.scrollWidth);
  console.log(errs.length ? 'ERR ' + errs.join('|') : '✔ UI 流程通過', 'scrollWidth=' + sw);
  await b.close();
})().catch(async e => { console.error('✘', e.message); try { await global.__p.screenshot({ path: '/tmp/ee_fail.png' }); console.error(await global.__p.textContent('#toasts')); } catch (x) { } process.exit(1); });
