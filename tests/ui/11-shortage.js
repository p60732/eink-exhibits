/**
 * 【UI 場景】tests/ui/11-shortage.js — 短少分頁與收合狀態下的短少 / 損壞標籤
 * 前置:00、01
 * 跑法:node tests/ui.test.js 11(會自動帶上前置場景)
 *
 * ⚠️ 這個場景自己重設畫面(視窗寬度、頁面、登入):它排在 10-mobile 後面,
 *    而那一個會把視窗縮成手機寬度 —— 不重設的話釘住的籤條會收起來,點不到分頁。
 */
module.exports = { id: '11', title: '短少分頁:跨狀態收單、收合狀態下就看得到標籤', needs: ['00', '01'], run: run };
async function run(C) {
  const { p, shot, wait, URL } = C;
  await p.setViewportSize({ width: 1280, height: 900 });
  await p.goto(URL); await wait(800);
  if (await p.$('#login-f')) {
    await p.fill('#l-emp', '90001'); await p.click('#login-f button');
    await p.waitForSelector('#l-pin:visible'); await p.fill('#l-pin', '1234'); await p.click('#login-f button');
  }
  await p.waitForSelector('#tabs .tab');

  // 前置資料直接走後端:這個場景要驗的是畫面,不是再跑一次開單流程
  const ids = await p.evaluate(async () => {
    const items = await Api.call('items', {}, S.token);
    const it = items.find(i => i.mode === 'qty' && !i.archived && i.inStock >= 4);
    if (!it) throw new Error('測試資料不足:找不到在庫 4 台以上的數量型展品');
    const mk = async (ev, qty) => (await Api.call('createLoan', {
      event: ev, start: '2026-10-01', end: '2026-10-05', onBehalf: true, applicant: '10231',
      lines: [{ itemId: it.id, location: it.sites[0].location, qty: qty }]
    }, S.token)).id;
    const r = { itemId: it.id, loc: it.sites[0].location, short: await mk('UI 短少測試', 2), dmg: await mk('UI 損壞測試', 1) };
    bumpCache();            // 繞過畫面建的資料,要把前端快取清掉,不然列表還是舊的
    return r;
  });

  // ① 用畫面登記一筆「還 1、短少 1」
  await p.click('[data-v=loans]'); await wait(600);
  await p.click('[data-f=out]'); await wait(900);
  await p.click(`#loan-${ids.short} [data-act=receive]`); await p.waitForSelector('#rgo2');
  await p.$eval('.modal [data-rq]', el => { el.value = '1'; });
  await p.$eval('.modal [data-rl]', el => { el.value = '1'; });
  await p.click('#rgo2'); await wait(1200);

  // ② 再登記一筆「還 1、其中損壞 1」—— 損壞的東西還在庫存裡,不算短少
  await p.click('[data-f=out]'); await wait(900);
  await p.click(`#loan-${ids.dmg} [data-act=receive]`); await p.waitForSelector('#rgo2');
  await p.$eval('.modal [data-rd]', el => { el.value = '1'; });
  await p.click('#rgo2'); await wait(1200);

  // ③ 短少分頁要在,而且收得到那張單
  if (!await p.$('[data-f=short]')) throw new Error('★ 借用單頁應該要有「短少」分頁');
  await p.click('[data-f=short]'); await wait(1400); await shot('short_tab');
  if (!await p.$(`#loan-${ids.short}`)) throw new Error('★ 有短少的單沒有出現在「短少」分頁');
  if (await p.$(`#loan-${ids.dmg}`)) throw new Error('★ 只有損壞、沒有短少的單不該出現在「短少」分頁 —— 東西還在庫存裡');

  // ④ 最關鍵的一條:卡片是收合的,標籤必須在**不展開**的情況下就看得到
  const open = await p.$eval(`#loan-${ids.short}`, el => el.classList.contains('open'));
  if (open) throw new Error('前置條件:卡片這時候應該是收合的');
  const head = await p.textContent(`#loan-${ids.short} .loan-h`);
  if (!/短少\s*1/.test(head)) throw new Error('★ 收合狀態下就要看得到「短少 1」,不然追短少還要一張張點開:' + head.replace(/\n/g, ' '));

  // ⑤ 損壞也要標,但跟短少分開(兩回事:一個是東西不見了,一個是東西還在只是壞了)
  await p.click('[data-f=returned]'); await wait(1400);
  const dhead = await p.textContent(`#loan-${ids.dmg} .loan-h`);
  if (!/損壞\s*1/.test(dhead)) throw new Error('★ 收合狀態下也要看得到「損壞 1」:' + dhead.replace(/\n/g, ' '));
  if (/短少/.test(dhead)) throw new Error('★ 只有損壞的單不可以標成短少:' + dhead.replace(/\n/g, ' '));
}
