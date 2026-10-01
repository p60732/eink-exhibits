/**
 * 【UI 場景】tests/ui/01-loan-flow.js — 同仁申請 → 核准即出借 → 登記歸還;同仁視角、盤點頁、借用單分頁
 * 前置:00
 * 跑法:node tests/ui.test.js 01(會自動帶上前置場景)
 */
module.exports = { id: '01', title: '同仁申請 → 核准即出借 → 登記歸還;同仁視角、盤點頁、借用單分頁', needs: ['00'], run: run };
async function run(C) {
  const { p, b, shot, wait, errs, PNG, d, URL } = C;
  // 同仁預約
  await p.fill('#l-emp', '10231'); await p.click('#login-f button'); await p.waitForSelector('.cards');
  // 目錄也要分段,且看得到還沒放東西的分類
  const cheads = await p.$$eval('h2.cath', els => els.map(e => e.textContent.trim()));
  if (!cheads.some(h => /^eReader/.test(h)) || !cheads.some(h => /^體驗區/.test(h))) throw new Error('目錄分段不正確:' + cheads.join('|'));
  await shot('catalog_cats');
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
  // 2026-10-01 精簡:表單只剩「借用目的 + 期間」必填,聯絡方式改由後端從帳號帶
  if (await p.$('[name=contact]')) throw new Error('★ 借用申請表單不該再有「聯絡方式」欄');
  if (await p.$('[name=purpose]')) throw new Error('★ 借用申請表單不該再有「用途」欄(已併進借用目的)');
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
  // v3.0:核准即出借 —— 同仁那邊直接變成「出借中」,而且不該再有任何操作入口
  await p.fill('#l-emp', '10231'); await p.click('#login-f button'); await p.waitForSelector('#tabs .tab');
  await p.click('[data-v=mine]'); await wait(400); await shot('mine_out');
  const st = await p.textContent('.loans');
  if (!/出借中/.test(st)) throw new Error('★ 核准就等於出借,同仁那邊應該直接是「出借中」:' + st.replace(/\n/g, ' ').slice(0, 160));
  for (const a of ['u-pickup', 'u-return', 'u-extend', 'u-transfer', 'u-onsite', 'u-cancel-req']) {
    if (await p.$(`[data-act=${a}]`)) throw new Error('★ 同仁端不該再有「' + a + '」這個入口(v3.0 砍掉了)');
  }
  const mineActs = await p.$$eval('.loans .actions [data-act]', els => [...new Set(els.map(e => e.dataset.act))]);
  const allowed = ['print-loan', 'loan-fold'];
  const extra = mineActs.filter(a => !allowed.includes(a));
  if (extra.length) throw new Error('★ 出借中的單在同仁端只該剩下列印:多了 ' + extra.join('、'));
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
  await p.click('[data-v=loans]'); await wait(300); await p.click('[data-f=out]'); await wait(400);
  await p.click('[data-act=receive]'); await p.waitForSelector('#rgo2');
  await p.click('#rgo2'); await wait(600);
  await p.click('[data-f=returned]'); await wait(500); const t2 = await p.textContent('#llist'); if (!/已歸還/.test(t2)) throw new Error('未歸還');
  // v3.0:舊流程那兩個分頁(待確認 / 待點交)連同背後的機制一起拿掉了
  for (const t of ['request', 'approved']) {
    if (await p.$(`[data-f=${t}]`)) throw new Error('★ 不該再有「' + t + '」分頁(舊流程已經拿掉)');
  }
  for (const a of ['checkout', 'req-ok', 'req-no']) {
    if (await p.$(`[data-act=${a}]`)) throw new Error('★ 不該再有「' + a + '」按鈕(舊流程已經拿掉)');
  }
  // 進行中的分頁共用同一次請求:切分頁不應該再打後端
  await p.click('[data-f=pending]'); await wait(900);
  await p.evaluate(() => { window.__n = 0; const f = window.fetch; window.fetch = (...a) => { window.__n++; return f(...a); }; });
  for (const t of ['out', 'overdue', 'pending']) { await p.click(`[data-f=${t}]`); await wait(450); }
  const nReq = await p.evaluate(() => window.__n);
  if (nReq > 0) throw new Error('切進行中的分頁不該再打後端,實際打了 ' + nReq + ' 次');
  await p.click('[data-f=all]'); await wait(700);
  if (await p.evaluate(() => window.__n) === 0) throw new Error('「全部」應該要向後端要資料');
}
