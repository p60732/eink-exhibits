/**
 * 【UI 場景】tests/ui/10-mobile.js — 手機寬度不可以橫向捲動
 * 前置:00(要有展品才看得出目錄會不會撐寬)
 * 跑法:node tests/ui.test.js 10(會自動帶上前置場景)
 */
module.exports = { id: '10', title: '手機寬度不可以橫向捲動', needs: ['00'], run: run };
async function run(C) {
  const { p, shot, wait, URL } = C;
  /**
   * 這個場景刻意「自己站得住」:前一個場景結束時停在哪一頁、登入了沒,都不該影響它。
   * 原本它是整段腳本的最後兩行,吃的是前面留下來的畫面狀態 ——
   * 拆成場景檔之後那種寫法會讓它只能排在最後,等於不能單獨跑。
   */
  await p.goto(URL); await wait(800);
  if (await p.$('#login-f')) {
    await p.fill('#l-emp', '90001'); await p.click('#login-f button');
    await p.waitForSelector('#l-pin:visible'); await p.fill('#l-pin', '1234'); await p.click('#login-f button');
  }
  await p.waitForSelector('#tabs .tab');
  await p.setViewportSize({ width: 390, height: 844 });
  await p.click('[data-v=catalog]'); await wait(600); await shot('mobile');
  const sw = await p.evaluate(() => document.documentElement.scrollWidth);
  if (sw > 390) throw new Error('★ 手機寬度不可以橫向捲動,scrollWidth=' + sw);
  C.mobileWidth = sw;
}
