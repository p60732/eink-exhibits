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
    // 自己建一個夠用的展品:場景不該依賴前面剛好留下多少庫存
    const it = await Api.call('saveItem', { item: { name: 'UI 歸還測試機', mode: 'qty',
      category: 'Signage', sites: [{ location: '新竹', qty: 20 }] } }, S.token);
    const mk = async (ev, qty) => (await Api.call('createLoan', {
      event: ev, start: '2026-10-01', end: '2026-10-05', onBehalf: true, applicant: '10231',
      lines: [{ itemId: it.id, location: '新竹', qty: qty }]
    }, S.token)).id;
    const r = { itemId: it.id, loc: '新竹', part: await mk('UI 部分歸還測試', 3),
      short: await mk('UI 短少測試', 2), dmg: await mk('UI 損壞測試', 1), keep: await mk('UI 不歸還測試', 2) };
    bumpCache();            // 繞過畫面建的資料,要把前端快取清掉,不然列表還是舊的
    return r;
  });

  /**
   * ⓪ 部分歸還:3 台只回來 1 台。使用者回報過「只能寫短少」—— 畫面原本沒講
   * 「把歸還改小就好」,而猜錯的那條路(把剩下的填進短少)會直接扣庫存且不能反悔。
   * 這一段守的就是那件事:做得到、而且畫面上看得出來。
   */
  await p.click('[data-v=loans]'); await wait(600);
  await p.click('[data-f=out]'); await wait(900);
  await p.click(`#loan-${ids.part} [data-act=receive]`); await p.waitForSelector('#rgo2');
  const hint = await p.textContent('.modal');
  if (!/把「歸還」的數字改小/.test(hint)) throw new Error('★ 歸還視窗要講清楚「部分歸還怎麼做」');
  await p.$eval('.modal [data-rq]', el => { el.value = '1'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  const rest = await p.textContent('.modal [data-rest]');
  if (!/還欠\s*2/.test(rest)) throw new Error('★ 改小「歸還」之後要即時顯示「還欠 2」,不要讓人自己心算:' + rest);
  await p.click('#rgo2'); await wait(1200);
  const after = await p.evaluate(async id => {
    const L = (await Api.call('loans', { filter: 'all' }, S.token)).find(x => x.id === id);
    return { st: L.status, left: L.lines[0].outstanding, lost: L.lines[0].lost || 0 };
  }, ids.part);
  if (after.st !== 'out') throw new Error('★ 部分歸還之後單子要留在「出借中」,實際是 ' + after.st);
  if (after.left !== 2) throw new Error('★ 剩下的 2 台要留在單子上等之後再登記,實際未還 ' + after.left);
  if (after.lost !== 0) throw new Error('★ 部分歸還不可以被記成短少 —— 那會扣庫存而且不能反悔');

  // ① 用畫面登記一筆「還 1、短少 1」
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

  /**
   * ⑥ 「不歸還」:東西沒有不見,是決定不收回來了(主管指示留在當地)。
   * 這是整張表單唯一「按下去就不能反悔」的欄位,所以守三件事:
   * 原因欄平常不佔位、填了數字才出現;沒寫原因按確認要被擋下來;
   * 以及它**不可以**混進「短少」分頁(那張清單是用來追還沒追到的)。
   */
  await p.click('[data-f=out]'); await wait(900);
  await p.click(`#loan-${ids.keep} [data-act=receive]`); await p.waitForSelector('#rgo2');
  const whyShown = () => p.$eval('.modal [data-rkn]', el => !el.hidden);
  if (await whyShown()) throw new Error('★ 不歸還原因欄平常不該佔位置,填了數字才出現');
  await p.$eval('.modal [data-rq]', el => { el.value = '0'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await p.$eval('.modal [data-rk]', el => { el.value = '2'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  if (!await whyShown()) throw new Error('★ 不歸還填了數字,原因欄就要自己出現(它是必填,藏起來只會讓人卡住)');
  const krest = await p.textContent('.modal [data-rest]');
  if (!/這項還清/.test(krest)) throw new Error('★ 不歸還也要算進「還欠幾個」,2 個全部不歸還就該顯示「這項還清」:' + krest);

  // 沒寫原因就按確認:要被擋在前端,而且什麼都不可以送出去
  await p.click('#rgo2'); await wait(600);
  const warn = await p.textContent('#toasts').catch(() => '');
  if (!/原因/.test(warn)) throw new Error('★ 不歸還沒寫原因就按確認,要擋下來並說明:' + warn);
  const mid = await p.evaluate(async id => (await Api.call('loans', { filter: 'all' }, S.token))
    .find(x => x.id === id).status, ids.keep);
  if (mid !== 'out') throw new Error('★ 被擋下來的那一次不可以真的送出去,實際狀態 ' + mid);

  await p.fill('.modal [data-rkn]', '主管指示留在當地');
  await p.click('#rgo2'); await wait(1400);
  const kept = await p.evaluate(async id => {
    const L = (await Api.call('loans', { filter: 'all' }, S.token)).find(x => x.id === id);
    return { st: L.status, kept: L.lines[0].kept || 0, lost: L.lines[0].lost || 0 };
  }, ids.keep);
  if (kept.st !== 'returned') throw new Error('★ 2 個都標成不歸還 = 這張單處理完了,實際 ' + kept.st);
  if (kept.kept !== 2) throw new Error('★ 不歸還要記成 kept 2,實際 ' + kept.kept);

  await p.click('[data-f=short]'); await wait(1400);
  if (await p.$(`#loan-${ids.keep}`)) throw new Error('★ 純「不歸還」的單不該出現在「短少」分頁 —— 已經結案,追它只是浪費時間');
  await p.click('[data-f=returned]'); await wait(1400); await shot('kept_tab');
  const khead = await p.textContent(`#loan-${ids.keep} .loan-h`);
  if (!/不歸還\s*2/.test(khead)) throw new Error('★ 收合狀態下就要看得到「不歸還 2」:' + khead.replace(/\n/g, ' '));
  if (/短少/.test(khead)) throw new Error('★ 不歸還不可以被標成短少(一個要追、一個不用):' + khead.replace(/\n/g, ' '));
}
