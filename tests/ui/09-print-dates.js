/**
 * 【UI 場景】tests/ui/09-print-dates.js — 列印視窗要回得來、離譜日期不可以送出
 * 前置:00、01
 * 跑法:node tests/ui.test.js 09(會自動帶上前置場景)
 */
module.exports = { id: '09', title: '列印視窗要回得來、離譜日期不可以送出', needs: ['00', '01'], run: run };
async function run(C) {
  const { p, b, shot, wait, errs, PNG, d, URL } = C;
  // ---- 列印視窗要回得來(v2.6)----
  // 三種列印都是 window.open 開新視窗,以前印完就停在那一頁,沒有任何回得來的入口
  //(手機上尤其明顯 —— 那是一個分頁,不是視窗)。
  // 註:前面的測試已經把 window.open 換成攔截用的假物件,所以這裡直接檢查它寫出去的 HTML。
  {
    const grab = async (fn) => {
      await p.evaluate(() => { window.__printed = ''; window.open = () => ({ document: { write: h => { window.__printed += h; }, close() { } }, print() { } }); });
      await fn();
      return p.evaluate(() => window.__printed || '');
    };
    const checkBar = async (html, label) => {
      if (!/class="pbar"/.test(html)) throw new Error('★ ' + label + ':列印頁沒有工具列 —— 印完回不到系統');
      if (!/關閉/.test(html)) throw new Error('★ ' + label + ':列印頁少了「關閉」鈕');
      if (!/window\.close\(\)/.test(html)) throw new Error('★ ' + label + ':「關閉」鈕沒有真的關視窗');
      if (!/window\.print\(\)/.test(html)) throw new Error('★ ' + label + ':列印頁少了「列印」鈕');
      // 光有 @media print 規則不算數,實際套用之後要真的看不見
      const t = await b.newPage();
      await t.setContent(html);
      await t.emulateMedia({ media: 'print' });
      const d = await t.$eval('.pbar', el => getComputedStyle(el).display);
      await t.close();
      if (d !== 'none') throw new Error('★ ' + label + ':列印時工具列要藏起來,現在是 display:' + d);
    };
    await p.click('[data-v=loans]'); await wait(1200);
    await p.click('[data-act=lf][data-f=all]'); await wait(1800);   // 待審核的單沒有列印鈕
    const lb = await p.$('[data-act=print-loan]');
    if (!lb) throw new Error('找不到可以列印的借用單');
    await checkBar(await grab(() => lb.click().then(() => p.waitForTimeout(700))), '借用單');

  }

  // ---- 離譜的借出 / 歸還日期不可以送出(v2.5.3)----
  // 手打 type=date 很容易打成 0025 或 9999,以前一路送進工作表,統計就從那張單開始歪掉。
  {
    await p.click('[data-v=catalog]'); await wait(900);
    await p.click('.item-card [data-act=add-cart]'); await wait(400);
    await p.click('[data-v=plan]'); await p.waitForSelector('#ps'); await wait(600);
    const bad = async (a2, b2, why) => {
      await p.fill('#ps', a2); await p.dispatchEvent('#ps', 'change');
      await p.fill('#pe', b2); await p.dispatchEvent('#pe', 'change');
      await wait(700);
      const sum = await p.textContent('#psum');
      if (!/日期有問題/.test(sum)) throw new Error('★ ' + why + '(' + a2 + '~' + b2 + ')沒被擋:' + sum);
      if (!await p.$eval('#psubmit', el => el.disabled)) throw new Error('★ ' + why + ' 還按得下送出');
    };
    await bad('0025-10-01', '0025-10-05', '年份少打一位');
    await bad('9999-01-01', '9999-01-05', '年份多打一位');
    await bad('2026-12-05', '2026-12-01', '歸還日早於借出日');
    await bad('2026-12-01', '2030-12-01', '期間長達四年');
    // 正常的日期要放行
    const okA = new Date(Date.now() + 86400000 * 7).toISOString().slice(0, 10);
    const okB = new Date(Date.now() + 86400000 * 10).toISOString().slice(0, 10);
    await p.fill('#ps', okA); await p.dispatchEvent('#ps', 'change');
    await p.fill('#pe', okB); await p.dispatchEvent('#pe', 'change');
    await wait(1500);
    const sum2 = await p.textContent('#psum');
    if (/日期有問題/.test(sum2)) throw new Error('★ 正常的日期被誤擋:' + sum2);
    // 日曆本身也要先擋住,不要讓人選得到離譜的年份
    const lim = await p.$eval('#ps', el => [el.min, el.max]);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lim[0]) || !/^\d{4}-\d{2}-\d{2}$/.test(lim[1]))
      throw new Error('★ 日期欄位要有 min / max:' + lim.join('~'));
    await p.click('[data-act=clear-cart]'); await wait(400);
  }

}
