/**
 * 【UI 場景】tests/ui/03-shows.js — 展覽全流程:卡位、產生借用單、缺口、備料清單、結算、批次登記歸還、封存
 * 前置:00、01
 * 跑法:node tests/ui.test.js 03(會自動帶上前置場景)
 */
module.exports = { id: '03', title: '展覽全流程:卡位、產生借用單、缺口、備料清單、結算、批次登記歸還、封存', needs: ['00', '01'], run: run };
async function run(C) {
  const { p, b, shot, wait, errs, PNG, d, URL } = C;
  /* ---- 展覽檔期:新增 → 整批貼上 → 確認卡位 → 產生借用單 ---- */
  await p.click('[data-v=shows]'); await wait(700);
  await p.click('[data-act=show-new]'); await p.waitForSelector('#shform'); await wait(300);
  // 第一步只有表單:還沒建立就不該出現需求清單(缺口要有檔期才算得出來)
  if (await p.$('#shlines')) throw new Error('新增階段不該出現需求清單');
  if (await p.$('[data-act=show-pick]')) throw new Error('還沒建立就不該能去挑展品');
  await p.fill('#shform [name=name]', '春季巡迴展');
  await p.fill('#shform [name=from]', d(40)); await p.fill('#shform [name=to]', d(50));
  await p.fill('#shform [name=venue]', '南港展覽館');
  await p.fill('#shform [name=owner]', '10231');
  await p.click('#shform button'); await wait(1400);
  if (!/春季巡迴展/.test(await p.textContent('#main'))) throw new Error('建立展覽後沒有回到明細:' + (await p.textContent('#main')).replace(/\n/g, ' ').slice(0, 200));
  await p.waitForSelector('#shlines');
  await shot('show-new');

  // 第二步:去展品目錄挑 —— 目錄要自動套用展覽檔期,而且不讓人在那裡改日期
  await p.click('[data-act=show-pick]'); await wait(1400);
  const pickTxt = await p.textContent('#pickbar');
  if (!/正在為「春季巡迴展」挑選展品/.test(pickTxt)) throw new Error('目錄沒有進入挑選模式:' + pickTxt);
  if (!new RegExp(d(40)).test(pickTxt)) throw new Error('挑選橫幅沒顯示展覽檔期:' + pickTxt);
  if (await p.$('#cs')) throw new Error('挑選模式不該讓人在目錄改日期');
  if (!/期間可借/.test(await p.textContent('#cgrid'))) throw new Error('挑選模式要顯示該檔期的可借量');
  // 挑一台「雙廠展示機(林口)」進來
  const cards = await p.$$('.item-card');
  let hit = null;
  for (const c of cards) if (/雙廠展示機/.test(await c.textContent())) { hit = c; break; }
  if (!hit) throw new Error('目錄裡找不到雙廠展示機');
  const iid = await hit.$eval('[data-act=show-add-cat]', e => e.dataset.id);
  await p.selectOption('#loc-' + iid, '林口');
  await p.fill('#q-' + iid, '2');
  await p.click(`[data-act=show-add-cat][data-id="${iid}"]`); await wait(700);
  const btnTxt = await p.textContent(`[data-act=show-add-cat][data-id="${iid}"]`);
  const lineN = await p.evaluate(() => JSON.stringify(S.showLines));
  if (!/加入展覽.已選 2/.test(btnTxt)) throw new Error('卡片沒顯示已選數量,按鈕是「' + btnTxt + '」,S.showLines=' + lineN);
  await shot('show-pick');
  // ★ 挑到一半重新整理:要回到原地繼續,而且已選的東西不能不見
  await p.reload(); await wait(2500);
  const afterReload = await p.textContent('#pickbar');
  if (!/已選 1 項/.test(afterReload)) throw new Error('重整之後挑選中的清單不見了:' + afterReload);
  // ★ 挑選中途跑回展覽頁按「儲存」,挑選狀態要一起收掉 ——
  //   只清一半的話,重整之後會帶著空清單回到挑選模式,按「完成」就把後端的清單洗光
  await p.click('[data-v=shows]'); await wait(1500);
  await p.click('#shform button'); await wait(1500);
  await p.reload(); await wait(2500);
  if (await p.$('#pickbar')) throw new Error('★ 存檔之後不該還停在挑選模式');
  await p.click('[data-v=shows]'); await wait(1500);
  await p.click('[data-act=show-open]'); await wait(1500);       // 修好之後重整會落在清單,要再點進那一場
  if (!/林口/.test(await p.textContent('#shlines'))) throw new Error('★ 存檔後重整,需求清單被清掉了');
  await p.click('[data-act=show-pick]'); await wait(1800);
  await p.click('[data-act=show-pick-done]'); await wait(1800);
  if (!/林口/.test(await p.textContent('#shlines'))) throw new Error('挑完沒有帶回需求清單');
  // 場地與承辦人不可以被挑選流程洗掉
  if (await p.inputValue('#shform [name=venue]') !== '南港展覽館') throw new Error('挑完之後場地被清掉了');
  if (await p.inputValue('#shform [name=owner]') !== '10231') throw new Error('挑完之後承辦人被清掉了');

  // 整批貼上:對不到的那一行要留在框裡讓人修,其餘照樣加入
  await p.click('[data-act=show-paste]'); await p.waitForSelector('#sp-txt');
  await p.fill('#sp-txt', '雙廠展示機\t新竹\t1\n根本沒有這個展品\t1');
  await p.click('[data-act=show-paste-ok]'); await wait(600);
  const pasteMsg = await p.textContent('#sp-out');
  if (!/有 1 行對不到/.test(pasteMsg)) throw new Error('沒有回報對不到的行:' + pasteMsg.replace(/\n/g, ' ').slice(0, 120));
  if (!/根本沒有這個展品/.test(await p.inputValue('#sp-txt'))) throw new Error('對不到的行應該留在輸入框裡');
  await p.click('.modal [data-act=close]'); await wait(400);
  if ((await p.$$('#shlines .line')).length !== 2) throw new Error('挑 1 行 + 貼 1 行,應該有 2 行');
  await wait(900);
  if (!/足夠|缺/.test(await p.textContent('#shsum'))) throw new Error('沒有即時算出可借量');
  await p.click('#shform button'); await wait(1400);
  // 確認檔期 → 開始卡位;可借量要跟著少 2
  const availOf = () => p.evaluate(async () => {
    const it = (await Api.call('catalog', {}, S.token)).find(i => i.name === '雙廠展示機');
    const r = await Api.call('check', { start: S._t1, end: S._t2, lines: [{ itemId: it.id, location: '林口', qty: 1 }] }, S.token);
    return r[0].available;
  });
  await p.evaluate(([a, b2]) => { S._t1 = a; S._t2 = b2; }, [d(42), d(44)]);
  const before2 = await availOf();
  await p.click('[data-act=show-status][data-s=confirmed]'); await wait(1400);
  const after2 = await availOf();
  if (after2 !== before2 - 2) throw new Error('確認檔期後應該卡住 2 台:' + before2 + ' → ' + after2);
  // 產生借用單 → 卡位讓給借用單,合計不變(重複扣的話這裡會再少 2)
  await p.click('[data-act=show-gen]'); await p.waitForSelector('.modal [data-act=close-render]'); await wait(300);
  const genTxt = await p.textContent('.modal');
  if (!/已產生 2 張借用單/.test(genTxt)) throw new Error('產生借用單結果不對(新竹、林口各一張):' + genTxt.replace(/\n/g, ' ').slice(0, 140));
  await p.click('.modal [data-act=close-render]'); await wait(1400);
  const after3 = await availOf();
  if (after3 !== after2) throw new Error('★ 開單後可借量不該再變(重複扣庫存):' + after2 + ' → ' + after3);
  if (!/已開單 2/.test(await p.textContent('#shlines'))) throw new Error('需求清單沒顯示已開單量');
  await shot('show-detail');

  // ---- v2.4:缺口點得開 / 備料清單 / 匯出 CSV ----
  {
    // 先把這場的規劃量加到超過庫存,逼出一個缺口
    await p.evaluate(async () => {
      const id = S.showId;
      const v = await Api.call('show', { id }, S.token);
      const lines = v.lines.map(l => ({ itemId: l.itemId, location: l.location, qty: l.qty + 50, note: l.note || '' }));
      await Api.call('saveShow', { show: { id, name: v.name, from: v.from, to: v.to, venue: v.venue, owner: v.owner, note: v.note, lines } }, S.token);
    });
    await p.evaluate(() => { bumpCache(); S.showLines = null; render(); }); await wait(2000);
    const gapBtn = await p.$('#shlines [data-act=who]');
    if (!gapBtn) throw new Error('★ 有缺口時「缺 N」要是可以點的');
    await gapBtn.click(); await wait(2000);
    const whoTxt = await p.textContent('.modal');
    if (!/是誰佔著/.test(whoTxt)) throw new Error('缺口來源視窗沒開:' + whoTxt.replace(/\n/g, ' ').slice(0, 160));
    if (!/借用單佔|展覽卡著|沒有人佔著/.test(whoTxt)) throw new Error('★ 缺口視窗要講清楚是被誰佔著:' + whoTxt.replace(/\n/g, ' ').slice(0, 200));
    await shot('who-holds');
    await p.click('.modal [data-act=close]'); await wait(700);
    // 備料清單:規劃中 / 已確認都要印得出來,攔下 window.open 檢查內容
    await p.evaluate(() => { window.__printed = ''; window.open = () => ({ document: { write: h => { window.__printed = h; }, close() { } }, print() { } }); });
    await p.click('[data-act=sheet-print]'); await wait(2000);
    const sheet = await p.evaluate(() => window.__printed || '');
    if (!/備料清單/.test(sheet)) throw new Error('備料清單沒印出來');
    if (!/新竹|林口/.test(sheet)) throw new Error('★ 備料清單要依廠區分段:' + sheet.slice(0, 200));
    if (!/點貨人簽名/.test(sheet)) throw new Error('備料清單要有簽名欄');
    if (!/class="bx"/.test(sheet)) throw new Error('★ 備料清單每一項要有可以手勾的格子');
    // 匯出 CSV:攔下下載
    const dl = p.waitForEvent('download', { timeout: 15000 }).catch(() => null);
    await p.click('[data-act=sheet-csv]'); await wait(1500);
    const got = await dl;
    if (!got) throw new Error('★ 匯出 CSV 沒有產生下載');
    // 驗內容而不是檔名 —— headless 的 blob 下載回報的檔名不一定帶得出 download 屬性
    const csv = require('fs').readFileSync(await got.path(), 'utf8');
    if (!/廠區/.test(csv) || !/規劃量/.test(csv) || !/缺口/.test(csv)) throw new Error('★ CSV 欄位不對:' + csv.slice(0, 200));
    if (!/春季巡迴展/.test(csv)) throw new Error('CSV 沒帶出展覽名稱');
    // 把規劃量改回去,後面的步驟還要用
    await p.evaluate(async () => {
      const id = S.showId;
      const v = await Api.call('show', { id }, S.token);
      const lines = v.lines.map(l => ({ itemId: l.itemId, location: l.location, qty: Math.max(1, l.qty - 50), note: l.note || '' }));
      await Api.call('saveShow', { show: { id, name: v.name, from: v.from, to: v.to, venue: v.venue, owner: v.owner, note: v.note, lines } }, S.token);
    });
    await p.evaluate(() => { bumpCache(); S.showLines = null; render(); }); await wait(2000);
  }

  // ---- v2.3:展後結算 / 批次申請歸還 / 整理歷史 ----
  // 純粹推進狀態的步驟(點交、確認歸還)直接呼叫後端,這一段要驗的是畫面
  const shid = await p.evaluate(() => S.showId);
  await p.evaluate(async id => {
    const v = await Api.call('show', { id }, S.token);
    for (const L of v.loans.filter(x => x.status === 'approved')) await Api.call('checkout', { id: L.id, units: {} }, S.token);
  }, shid);
  await p.evaluate(() => { bumpCache(); render(); }); await wait(1800);
  // 批次登記歸還:撤場時一次送出,預設全勾
  if (!await p.$('[data-act=show-return]')) throw new Error('底下有出借中的單時應該出現「批次登記歸還」');
  await p.click('[data-act=show-return]'); await p.waitForSelector('.sr-id');
  const srN = await p.$$eval('.sr-id', els => els.filter(e => e.checked).length);
  if (srN !== 2) throw new Error('批次歸還預設應該把出借中的都勾起來:' + srN);
  await p.click('[data-act=show-return-ok]'); await wait(2000);
  const srReq = await p.evaluate(async id =>
    (await Api.call('show', { id }, S.token)).loans.filter(L => L.status === 'returned').length, shid);
  if (srReq !== 2) throw new Error('★ 批次登記歸還應該把兩張單直接結案,實際結案 ' + srReq + ' 張');
  // 確認歸還 → 結案 → 結算卡片要出現,而且說東西都回來了
  await p.evaluate(async id => {
    const v = await Api.call('show', { id }, S.token);
    for (const L of v.loans.filter(x => x.status === 'out')) {
      await Api.call('receive', { id: L.id, lines: L.lines.map(ln => ({ itemId: ln.itemId, location: ln.location,
        returned: ln.qty - (ln.returned || 0) - (ln.lost || 0) })) }, S.token);
    }
    await Api.call('setShowStatus', { id, status: 'closed' }, S.token);
  }, shid);
  await p.evaluate(() => { bumpCache(); render(); }); await wait(2000);
  await p.waitForSelector('#settle');
  const seTxt = await p.textContent('#settle');
  if (!/東西都回來了/.test(seTxt)) throw new Error('結算卡片應該說東西都回來了:' + seTxt.replace(/\n/g, ' ').slice(0, 220));
  if (!/規劃/.test(seTxt) || !/未歸還/.test(seTxt)) throw new Error('結算四欄沒出現:' + seTxt.replace(/\n/g, ' ').slice(0, 220));
  await shot('show-settle');

  // 整理歷史:預覽 → 搬走 → 預設查不到、勾了「含歷史資料」才查得到
  await p.click('[data-v=loans]'); await wait(1400);
  await p.click('[data-act=arch-open]'); await p.waitForSelector('.modal .ar-s');
  if (!/春季巡迴展/.test(await p.textContent('.modal'))) throw new Error('整理歷史的預覽沒列出已結案的展覽');
  await p.click('[data-act=arch-go]'); await p.waitForSelector('.modal [data-act=close-render]');
  const archTxt = await p.textContent('.modal');
  if (!/已搬走 2 張/.test(archTxt)) throw new Error('搬走的張數不對:' + archTxt.replace(/\n/g, ' ').slice(0, 160));
  await p.click('.modal [data-act=close-render]'); await wait(1600);
  await p.click('[data-f=all]'); await wait(1600);
  if (/已封存/.test(await p.textContent('#llist'))) throw new Error('★ 沒勾「含歷史資料」不該列出封存的舊單');
  await p.click('#lhist'); await wait(1800);
  if (!/已封存/.test(await p.textContent('#llist'))) throw new Error('★ 勾了「含歷史資料」就要查得到封存的舊單');
  await p.click('#lhist'); await wait(1600);
  // 已封存的展覽:結算改看快照,而且不給重新開啟
  await p.click('[data-v=shows]'); await wait(1400);
  await p.click('[data-act=show-filter][data-f=all]'); await wait(1400);   // 結案的不在「進行中」那一籤
  await p.click(`[data-act=show-open][data-id="${shid}"]`); await wait(1800);
  await p.waitForSelector('#settle');
  if (!/封存快照/.test(await p.textContent('#settle'))) throw new Error('★ 封存之後結算要標示成快照');
  if (await p.$('[data-act=show-status][data-s=confirmed]')) throw new Error('★ 已封存的展覽不該還有「重新開啟」');

  await p.click('[data-act=show-back]'); await wait(900);
  if (!/春季巡迴展/.test(await p.textContent('#main'))) throw new Error('展覽清單沒有這一場');
  // ★ 點進某一場 → 切走 → 再回來,應該看到清單,不是停在上一場
  await p.click('[data-act=show-open]'); await wait(1200);
  if (!await p.$('#shform')) throw new Error('沒有進到展覽明細');
  await p.click('[data-v=items]'); await wait(900);
  await p.click('[data-v=shows]'); await wait(1200);
  if (await p.$('#shform')) throw new Error('★ 切回展覽分頁應該回到清單,不該停在上一場');
  await p.click('[data-v=loans]'); await wait(700); await p.click('[data-f=all]'); await wait(1000);
  // 列印:攔下 window.open,檢查產出的單據內容
  await p.evaluate(() => { window.__printed = ''; window.open = () => ({ document: { write: h => { window.__printed = h; }, close() { } }, print() { } }); });
  await (await p.$('[data-act=print-loan]')).click(); await wait(700);
  const printed = await p.evaluate(() => window.__printed || '');
  if (!/展品借用單/.test(printed) || !/簽名/.test(printed)) throw new Error('列印單據內容不對');
  // ★ 換人登入不可以看到前一個人的購物車(工作中的狀態要綁使用者,登出要清掉)
  await p.click('[data-v=catalog]'); await wait(1200);
  await (await p.$$('[data-act=add-cart]'))[0].click(); await wait(500);
  if (!/借用申請/.test(await p.textContent('#tabs'))) throw new Error('分頁名稱應該是「借用申請」');
  const badgeBefore = await p.textContent('#tabs [data-v=plan]');
  if (!/\d/.test(badgeBefore)) throw new Error('加入之後分頁上應該有數量徽章:' + badgeBefore);
  await p.click('#menu-btn'); await p.click('#m-out'); await p.waitForSelector('#login-f');
  await p.fill('#l-emp', '10231'); await p.click('#login-f button'); await p.waitForSelector('#tabs .tab');
  const badgeAfter = await p.textContent('#tabs [data-v=plan]');
  if (/\d/.test(badgeAfter)) throw new Error('★ 換人登入後還看得到前一個人的購物車:' + badgeAfter);
  await p.click('[data-v=plan]'); await wait(800);
  if (!/還沒有選任何展品/.test(await p.textContent('#main'))) throw new Error('★ 換人登入後購物車應該是空的');

}
