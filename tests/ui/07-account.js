/**
 * 【UI 場景】tests/ui/07-account.js — 沒有 Email 的帳號擋板、同仁端只剩「申請」這一步
 * 前置:00、01
 * 跑法:node tests/ui.test.js 07(會自動帶上前置場景)
 */
module.exports = { id: '07', title: '沒有 Email 的帳號擋板、同仁端只剩「申請」這一步', needs: ['00', '01'], run: run };
async function run(C) {
  const { p, b, shot, wait, errs, PNG, d, URL } = C;
  // ---- 帳號沒有 Email:登入時擋下來要他補(2026-10-01)----
  // 空的 Email = 核准通知寄不到,而且當事人完全不會知道,
  // 他只會覺得「我申請了都沒下文」。所以在進系統之前擋一次。
  {
    await p.click('#menu-btn'); await p.click('#m-out'); await p.waitForSelector('#login-f');
    await p.fill('#l-emp', '10999'); await p.click('#login-f button');
    await p.waitForSelector('#myml', { timeout: 15000 });
    if (!/Email/.test(await p.textContent('.modal h2'))) throw new Error('★ 沒有 Email 的帳號登入後要跳出補填視窗');
    // 擋板不可以略過:點背景、按 Esc 都要還在
    await p.click('#modal-bg', { position: { x: 5, y: 5 } }).catch(() => { });
    await p.keyboard.press('Escape'); await wait(300);
    if (!await p.$('#myml')) throw new Error('★ 補 Email 的視窗不可以被點掉或按 Esc 關掉');
    // 格式不對要擋
    await p.fill('#myml', '不是信箱'); await p.click('#mlgo'); await wait(600);
    if (!await p.$('#myml')) throw new Error('★ Email 格式不對不可以放行');
    // 填對了就進得去,而且不會再問第二次
    await p.fill('#myml', 'nomail@x.com'); await p.click('#mlgo');
    // ⚠️ 不能等 #tabs .tab —— 擋板是蓋在已經畫好的分頁列上面的,那個選擇器一開始就中了。
    //    要等的是「擋板消失」。
    await p.waitForSelector('#myml', { state: 'detached', timeout: 15000 });
    await p.waitForSelector('#tabs .tab', { timeout: 15000 });
    const mail = await p.evaluate(() => S.user.email);
    if (mail !== 'nomail@x.com') throw new Error('★ 補完的 Email 要存回帳號:' + mail);
    // 借用申請表單上要看得到帶進去的聯絡方式(購物車空的話那一頁只有空狀態,所以先加一項)
    await p.click('[data-v=catalog]'); await wait(1500);
    const pick = await p.$$('[data-mpick]');
    if (pick.length) { await pick[0].check(); await wait(300); await p.click('[data-act=multi-go]'); await wait(900); }
    else { await p.click('[data-v=plan]'); await wait(900); }
    const hint = await p.textContent('#pform').catch(() => '');
    if (!/10999 \/ nomail@x\.com/.test(hint)) throw new Error('★ 申請表單要顯示自動帶入的聯絡方式:' + hint.slice(0, 150));
    // 換回管理者,後面的段落都是管理者視角
    await p.click('#menu-btn'); await p.click('#m-out'); await p.waitForSelector('#login-f');
    await p.fill('#l-emp', '90001'); await p.click('#login-f button'); await p.waitForSelector('#l-pin:visible');
    await p.fill('#l-pin', '1234'); await p.click('#login-f button'); await p.waitForSelector('[data-v=items]');
  }

  // ---- 同仁端只剩「申請」這一步(v3.0)----
  // 以前這裡驗的是四種請求的按鈕文案。v3.0 把簽收 / 歸還 / 延期 / 轉借 / 撤回 / 當面確認
  // 六個入口全部砍掉了,所以改成反向守門:連舊資料(身上還掛著 request)也不能長出那些鈕。
  {
    const out = await p.evaluate(() => {
      const mk = (status, req) => ({
        id: 'L2609-999', event: '入口測試', applicant: '員工A', dept: '業務部',
        status: status, statusLabel: status === 'approved' ? '已核准' : '出借中',
        start: '2026-10-01', end: '2026-10-05',
        lines: [{ itemId: 'P0001', name: '測試機', qty: 1, location: '新竹', mode: 'qty', returned: 0, lost: 0, outstanding: 1, units: [], returnedUnits: [], lostUnits: [] }],
        request: req, stage: req ? '待確認' : '', overdue: false, archived: false
      });
      const cases = [['approved', null], ['out', null],
        ['approved', { type: 'pickup', at: '2026-09-27 10:00', by: '員工A' }],
        ['out', { type: 'return', at: '2026-09-27 10:00', by: '員工A' }],
        ['out', { type: 'extend', at: '2026-09-27 10:00', by: '員工A', end: '2026-10-09' }],
        ['out', { type: 'transfer', at: '2026-09-27 10:00', by: '員工A', toName: '員工B' }]];
      return cases.map(([st, rq]) => {
        const d = document.createElement('div');
        d.innerHTML = loanCard(mk(st, rq), { mine: true });
        return { st: st, rq: rq ? rq.type : '-',
          acts: [...new Set([...d.querySelectorAll('[data-act]')].map(e => e.dataset.act))] };
      });
    });
    const BAN = ['u-pickup', 'u-return', 'u-extend', 'u-transfer', 'u-onsite', 'u-cancel-req'];
    out.forEach(c => {
      const hit = c.acts.filter(a => BAN.includes(a));
      if (hit.length) throw new Error(`★ 同仁端(${c.st} / request=${c.rq})又長出被砍掉的入口:${hit.join('、')}`);
    });
    // 反過來也要守:該留的「列印」還在,不然等於整段斷言都在測一塊空白
    if (!out.some(c => c.acts.includes('print-loan'))) throw new Error('★ 同仁端的列印鈕不該一起被砍掉');
  }

}
