/**
 * 【UI 場景】tests/ui/06-fold.js — 三種收合(我的借用歷史、每張單、封存舊單)+ 連點防呆
 * 前置:00、01
 * 跑法:node tests/ui.test.js 06(會自動帶上前置場景)
 */
module.exports = { id: '06', title: '三種收合(我的借用歷史、每張單、封存舊單)+ 連點防呆', needs: ['00', '01'], run: run };
async function run(C) {
  const { p, b, shot, wait, errs, PNG, d, URL } = C;
  // ---- 我的借用:歷史紀錄整段預設收起來(2026-10-01)----
  {
    await p.click('[data-v=mine]'); await wait(1500);
    if (await p.$('[data-act=hist-toggle]')) {
      const before = await p.$$eval('[id^=loan-]', els => els.length);
      await p.click('[data-act=hist-toggle]'); await wait(900);
      const after = await p.$$eval('[id^=loan-]', els => els.length);
      if (after <= before) throw new Error('★ 展開歷史紀錄之後單子要變多(' + before + ' → ' + after + ')');
      await p.click('[data-act=hist-toggle]'); await wait(900);
      if (await p.$$eval('[id^=loan-]', els => els.length) !== before)
        throw new Error('★ 收起來要回到原本的數量');
    }
  }

  // ---- 每張借用單自己收合:預設只露出標題與狀態,按鈕不收(2026-10-01)----
  {
    await p.click('[data-v=loans]'); await wait(1200);
    await p.click('[data-act=lf][data-f=all]'); await wait(1500);
    const card = await p.$('.loan');
    if (!card) throw new Error('借用單頁上沒有任何單子');
    const id = await card.getAttribute('id');
    const body = async () => await p.isVisible(`#${id} .loan-body`);
    if (await body()) throw new Error('★ 預設應該是收起來的,只露出標題與狀態');
    if (!await p.isVisible(`#${id} .loan-h h3`)) throw new Error('★ 收起來的時候標題還是要看得到');
    // 有動作按鈕的單,按鈕不可以被收掉 —— 收起來還是要能直接核准 / 點交 / 歸還
    const withAct = await p.$('.loan:has(.actions)');
    if (withAct) {
      const aid = await withAct.getAttribute('id');
      if (!await p.isVisible(`#${aid} .actions`)) throw new Error('★ 收起來的時候操作按鈕要還在');
    }
    await p.click(`#${id} [data-act=loan-fold]`); await wait(400);
    if (!await body()) throw new Error('★ 點 + 要展開細項');
    if (await p.textContent(`#${id} [data-act=loan-fold]`) !== '−') throw new Error('展開後按鈕要變成 −');
    await p.click(`#${id} [data-act=loan-fold]`); await wait(400);
    if (await body()) throw new Error('★ 再點一次要收回去');
    // 全部展開 / 全部收合
    await p.click('[data-act=loan-foldall]'); await wait(500);
    const opened = await p.$$eval('.loan', els => els.filter(e => e.classList.contains('open')).length);
    const total = await p.$$eval('.loan', els => els.length);
    if (opened !== total) throw new Error('★ 全部展開要全開(' + opened + '/' + total + ')');
    await p.click('[data-act=loan-foldall]'); await wait(500);
    const still = await p.$$eval('.loan', els => els.filter(e => e.classList.contains('open')).length);
    if (still !== 0) throw new Error('★ 再按一次要全部收合,還開著 ' + still + ' 張');
  }

  // ---- 封存過的舊單預設收起來(2026-10-01 回報:歷史單太多很亂)----
  {
    await p.click('[data-v=loans]'); await wait(1200);
    await p.click('[data-act=lf][data-f=all]'); await wait(1200);
    // ⚠️ 每次 render 都會把節點換掉,抓著舊的 handle 會「not attached to the DOM」——
    //    一律用選擇器,讓 playwright 每次重新解析。
    if (await p.$('#lhist')) {
      await p.check('#lhist'); await wait(2000);
      if (await p.$('[data-act=hist-toggle]')) {
        const before = await p.$$eval('[id^=loan-]', els => els.length);
        await p.click('[data-act=hist-toggle]'); await wait(900);
        const after = await p.$$eval('[id^=loan-]', els => els.length);
        if (after <= before) throw new Error('★ 展開歷史單之後單子要變多(' + before + ' → ' + after + ')');
        await p.click('[data-act=hist-toggle]'); await wait(900);
        const back = await p.$$eval('[id^=loan-]', els => els.length);
        if (back !== before) throw new Error('★ 收起來要回到原本的數量(' + before + ' → ' + back + ')');
      }
      if (await p.$('#lhist')) await p.uncheck('#lhist');
      await wait(1500);
    }
  }

  // ---- 連點兩下只能算一次(2026-10-01 回報:連點下架變成兩筆)----
  {
    await p.click('[data-v=items]'); await wait(1500);
    const before = await p.evaluate(async () => (await Api.call('logs', { limit: 500 }, S.token))
      .filter(r => /下架/.test(r.action)).length);
    const btn = await p.$$('[data-act=archive][data-on="1"]');
    if (!btn.length) throw new Error('展品管理上找不到可以下架的展品');
    // ⚠️ 本機假後端是瞬間回應的,直接連點兩下根本撞不出競態,
    //    那樣的測試拿掉修正也不會紅。這裡把回應壓慢 1.2 秒,讓第二下**確實**落在第一趟還沒回來的時候。
    await p.evaluate(() => { const f = window.fetch.bind(window); window.__realFetch = f;
      window.fetch = (...a) => new Promise(r => setTimeout(() => r(f(...a)), 1200)); });
    await btn[0].click();
    // 第一下按下去之後,按鈕要看得出來正在送 —— 沒有回饋的話使用者就是會一直按
    await wait(400);
    if (!await p.$('[data-act=archive][aria-busy="true"]'))
      throw new Error('★ 送出中的按鈕要標成忙碌(aria-busy),不然使用者會連點');
    await btn[0].click({ force: true }).catch(() => { });
    await wait(4000);
    await p.evaluate(() => { window.fetch = window.__realFetch; });
    const after = await p.evaluate(async () => (await Api.call('logs', { limit: 500 }, S.token))
      .filter(r => /下架/.test(r.action)).length);
    if (after !== before + 1) throw new Error('★ 連點兩下只能產生一筆下架紀錄,實際多了 ' + (after - before) + ' 筆');
    await wait(600);
  }

}
