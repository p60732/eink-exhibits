/**
 * 【UI 場景】tests/ui/02-admin-ops.js — 今天要做的事、批次核准、管理者延期、列印
 * 前置:00、01
 * 跑法:node tests/ui.test.js 02(會自動帶上前置場景)
 */
module.exports = { id: '02', title: '今天要做的事、批次核准、管理者延期、列印', needs: ['00', '01'], run: run };
async function run(C) {
  const { p, b, shot, wait, errs, PNG, d, URL } = C;
  // ---- 待辦 / 批次核准 / 延期 / 列印 ----
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
  await makeLoan('批次核准測試', d(20), d(22));
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
  // v3.0:延期只剩管理者這一條路(同仁的「申請延期 / 轉借」都砍掉了)
  await p.click('[data-v=loans]'); await wait(700);
  await p.click('[data-f=out]'); await wait(1000);
  if (await p.$('[data-act=req-ok]')) throw new Error('★ 新流程不該再產生待確認的請求');
  const exBtn = (await p.$$('[data-act=extend]'))[0];
  if (!exBtn) throw new Error('管理者應該可以直接延期');
  await exBtn.click(); await p.waitForSelector('#xgo');
  await p.fill('#xd', d(30)); await p.click('#xgo'); await wait(1400);
  await shot('extend');
  await p.click('[data-f=all]'); await wait(1000);
  const allTxt = await p.textContent('#llist');
  if (!new RegExp(d(30)).test(allTxt)) throw new Error('延期後歸還日沒改成 ' + d(30));
}
