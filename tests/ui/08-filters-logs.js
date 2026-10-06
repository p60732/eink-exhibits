/**
 * 【UI 場景】tests/ui/08-filters-logs.js — 目錄 / 展品管理的地點篩選、總覽磚塊展開、操作紀錄籤條
 * 前置:00、01
 * 跑法:node tests/ui.test.js 08(會自動帶上前置場景)
 */
module.exports = { id: '08', title: '目錄 / 展品管理的地點篩選、總覽磚塊展開、操作紀錄籤條', needs: ['00', '01'], run: run };
async function run(C) {
  const { p, b, shot, wait, errs, PNG, d, URL } = C;
  // ---- 展品目錄:依地點篩選,數字也只算那個地點(v2.7)----
  // 選了「新竹」卻看到全部廠區加起來的 12 台,比不給篩還糟 —— 會有人照著那個數字去備料。
  {
    await p.click('[data-v=catalog]'); await wait(1500);
    await p.evaluate(() => { S.filters.q = ''; S.filters.cat = ''; S.filters.loc = ''; S._catDraw(); }); await wait(500);
    const sites = await p.$$eval('#csite .catchip', els => els.map(e => e.dataset.cloc));
    if (sites.length < 2) throw new Error('★ 少了地點籤條(或只有一個地點):' + sites.join(','));
    if (sites[0] !== '') throw new Error('★ 第一個應該是「全部廠區」:' + sites.join(','));
    // 找一個分散在多個地點的展品來驗
    const multi = await p.evaluate(() => {
      const i = (S.items || []).find(x => (x.sites || []).length > 1);
      return i ? { id: i.id, total: i.total, sites: i.sites.map(g => ({ loc: g.location, total: g.total, inStock: g.inStock })) } : null;
    });
    if (!multi) throw new Error('測試資料裡沒有分散在多個地點的展品,驗不到');
    const one = multi.sites[0];
    await p.click(`#csite .catchip[data-cloc="${one.loc}"]`); await wait(700);
    // 卡片上的「倉庫在庫」要是那一區的數字,不是全部加總
    const shownStock = await p.$eval(`#cgrid .item-card:has(.mono) .nums div b`, el => el.textContent).catch(() => null);
    const card = await p.evaluate(id => {
      const els = [...document.querySelectorAll('#cgrid .item-card')];
      const el = els.find(e => e.textContent.includes(id));
      if (!el) return null;
      const nums = [...el.querySelectorAll('.nums div')].map(d => d.textContent.trim());
      return { nums, dist: (el.querySelector('.dist') || {}).textContent || '' };
    }, multi.id);
    if (!card) throw new Error('★ 選了 ' + one.loc + ' 之後,那個展品不見了(它在那一區有貨)');
    const inStockShown = Number((card.nums[0] || '').replace(/[^0-9]/g, ''));
    if (inStockShown !== one.inStock)
      throw new Error('★ 選了 ' + one.loc + ',倉庫在庫要是 ' + one.inStock + '(那一區),卻顯示 ' + inStockShown);
    if (multi.total === one.total)
      throw new Error('測試資料不夠分辨:那一區的數量剛好等於總數,驗不出差別');
    const totalShown = Number((card.nums[3] || '').replace(/[^0-9]/g, ''));
    if (totalShown !== one.total)
      throw new Error('★ 選了 ' + one.loc + ',總數要是 ' + one.total + ',卻顯示 ' + totalShown + '(看起來是全部廠區加總)');
    if (!card.dist.includes(one.loc) || multi.sites.slice(1).some(g => card.dist.includes(g.loc)))
      throw new Error('★ 存放那一行應該只剩 ' + one.loc + ':' + card.dist);
    // 加入申請時來源要鎖在那一區
    const locVal = await p.$eval(`#loc-${multi.id}`, el => el.value);
    if (locVal !== one.loc) throw new Error('★ 加入申請的來源應該鎖在 ' + one.loc + ',卻是 ' + locVal);
    // 切回全部廠區,數字要回到合計
    await p.click('#csite .catchip[data-cloc=""]'); await wait(700);
    const back = await p.evaluate(id => {
      const el = [...document.querySelectorAll('#cgrid .item-card')].find(e => e.textContent.includes(id));
      return el ? [...el.querySelectorAll('.nums div')].map(d => d.textContent.trim()) : null;
    }, multi.id);
    const backTotal = Number((back[3] || '').replace(/[^0-9]/g, ''));
    if (backTotal !== multi.total) throw new Error('★ 切回全部廠區,總數要回到 ' + multi.total + ',卻是 ' + backTotal);
  }

  // ---- 總覽:磚塊點下去展開各廠區數字(v2.7.3)----
  // 最重要的一條:展開後的「合計」要等於磚塊上的數字。
  // 不相等就代表前端的加總跟後端的 stats() 算法漂開了 —— 那種數字沒人會發現是錯的。
  {
    // 先下架一項,合計才驗得到「有沒有排除已下架」——
    // 沒有下架的東西時,排不排除結果一樣,那條斷言等於沒在守。
    await p.click('[data-v=items]'); await wait(1500);
    await p.click('#ibody [data-act=archive][data-on="1"]'); await wait(1800);
    await p.click('[data-v=dash]'); await wait(1500);
    const tile = lab => p.evaluate(l => {
      const el = [...document.querySelectorAll('.kpi')].find(e => (e.querySelector('.l') || {}).textContent === l);
      return el ? Number((el.querySelector('.v') || {}).textContent.replace(/[^0-9]/g, '')) : null;
    }, lab);
    const items0 = await tile('展品品項'), total0 = await tile('總件數'), inStock0 = await tile('倉庫在庫');
    if (items0 == null || total0 == null) throw new Error('★ 找不到總覽的磚塊');
    if (await p.$('#sitebreak .sitebreak')) throw new Error('★ 一開始不該是展開的');
    // 展開
    await p.click('.kpi.sitekpi[data-f=total]'); await wait(1800);
    const foot = await p.$$eval('#sitebreak tfoot th', els => els.map(e => e.textContent.trim()));
    if (!foot.length) throw new Error('★ 點了磚塊沒有展開各廠區數字');
    const [, fItems, fTotal, fIn, fOut] = foot.map(x => /^\d+$/.test(x) ? Number(x) : x);
    if (fTotal !== total0) throw new Error('★ 合計件數 ' + fTotal + ' 跟磚塊上的 ' + total0 + ' 對不起來');
    if (fItems !== items0) throw new Error('★ 合計品項 ' + fItems + ' 跟磚塊上的 ' + items0 + ' 對不起來');
    if (fIn !== inStock0) throw new Error('★ 合計在庫 ' + fIn + ' 跟磚塊上的 ' + inStock0 + ' 對不起來');
    // 每一區的數字加起來也要等於合計
    const rows = await p.$$eval('#sitebreak tbody tr', els => els.map(e => [...e.querySelectorAll('td')].map(t => t.textContent.trim())));
    if (rows.length < 2) throw new Error('★ 至少要列得出兩個廠區:' + JSON.stringify(rows));
    const colSum = k => rows.reduce((a, r) => a + Number(r[k].replace(/[^0-9]/g, '') || 0), 0);
    if (colSum(2) !== fTotal) throw new Error('★ 各區件數加起來 ' + colSum(2) + ' ≠ 合計 ' + fTotal);
    if (colSum(3) !== fIn) throw new Error('★ 各區在庫加起來 ' + colSum(3) + ' ≠ 合計 ' + fIn);
    if (colSum(4) !== fOut) throw new Error('★ 各區出借加起來 ' + colSum(4) + ' ≠ 合計 ' + fOut);
    // 展開的那一塊要看得出來
    if (!await p.$('.kpi.sitekpi.open[data-f=total]')) throw new Error('★ 展開的磚塊要標示出來');

    // 點同一塊收起來
    await p.click('.kpi.sitekpi[data-f=total]'); await wait(700);
    if (await p.$('#sitebreak .sitebreak')) throw new Error('★ 再點同一塊磚應該收起來');
    // 點廠區要跳到展品目錄而且已經篩好
    await p.click('.kpi.sitekpi[data-f=inStock]'); await wait(1500);
    const firstLoc = await p.$eval('#sitebreak tbody [data-act=site-go]', el => el.dataset.loc);
    await p.click('#sitebreak tbody [data-act=site-go]'); await wait(1800);
    const on = await p.$eval('#csite .catchip.on', el => el.dataset.cloc).catch(() => null);
    if (on !== firstLoc) throw new Error('★ 點廠區要跳到展品目錄並篩好 ' + firstLoc + ',實際是 ' + on);
  }

  // ---- 展品管理:依地點篩選,表格數字也只算那個地點(v2.7.2)----
  {
    await p.click('[data-v=items]'); await wait(1500);
    await p.evaluate(() => { S.itemQ = ''; S.cat = ''; S.itemSite = ''; S._itemDraw(); }); await wait(500);
    const sites = await p.$$eval('#isite .catchip', els => els.map(e => e.dataset.isite));
    if (sites.length < 2) throw new Error('★ 展品管理少了地點籤條:' + sites.join(','));
    if (sites[0] !== '') throw new Error('★ 第一個應該是「全部廠區」:' + sites.join(','));
    // 找一個分散在多個地點的展品
    const multi = await p.evaluate(() => {
      const i2 = (S.items || []).find(x => (x.sites || []).length > 1);
      return i2 ? { id: i2.id, total: i2.total, sites: i2.sites.map(g => ({ loc: g.location, total: g.total, inStock: g.inStock })) } : null;
    });
    if (!multi) throw new Error('測試資料裡沒有分散在多個地點的展品,驗不到');
    const one = multi.sites[0];
    if (multi.total === one.total) throw new Error('測試資料不夠分辨:那一區的數量剛好等於總數');
    const rowOf = id => p.evaluate(x => {
      const tr = [...document.querySelectorAll('#ibody tr')].find(e => e.textContent.includes(x));
      if (!tr) return null;
      const td = [...tr.querySelectorAll('td')].map(c => c.textContent.trim());
      return { total: td[3], inStock: td[4], dist: td[7] };
    }, id);
    await p.click(`#isite .catchip[data-isite="${one.loc}"]`); await wait(700);
    const r = await rowOf(multi.id);
    if (!r) throw new Error('★ 選了 ' + one.loc + ' 之後那一列不見了(它在那一區有貨)');
    if (Number(r.total) !== one.total)
      throw new Error('★ 選了 ' + one.loc + ',總數要是 ' + one.total + ',卻顯示 ' + r.total + '(看起來是全部廠區加總)');
    if (Number(r.inStock) !== one.inStock)
      throw new Error('★ 選了 ' + one.loc + ',在庫要是 ' + one.inStock + ',卻顯示 ' + r.inStock);
    if (!r.dist.includes(one.loc) || multi.sites.slice(1).some(g => r.dist.includes(g.loc)))
      throw new Error('★ 存放那一欄應該只剩 ' + one.loc + ':' + r.dist);
    // 切回全部廠區要回到合計
    await p.click('#isite .catchip[data-isite=""]'); await wait(700);
    const back = await rowOf(multi.id);
    if (Number(back.total) !== multi.total)
      throw new Error('★ 切回全部廠區,總數要回到 ' + multi.total + ',卻是 ' + back.total);
  }

  // ---- 操作紀錄:動作大類 + 人員兩排籤條(v2.7)----
  {
    await p.click('[data-v=logs]'); await wait(1800);
    const cats = await p.$$eval('#gcat .catchip', els => els.map(e => e.textContent.trim()));
    const whos = await p.$$eval('#gwho .catchip', els => els.map(e => e.textContent.trim()));
    if (!cats.length || !/全部/.test(cats[0])) throw new Error('★ 少了動作大類籤條:' + cats.join(','));
    if (!whos.length || !/所有人/.test(whos[0])) throw new Error('★ 少了人員籤條:' + whos.join(','));
    if (cats.length < 3) throw new Error('★ 大類籤條太少,分類可能沒生效:' + cats.join(','));
    const rowsOf = () => p.$$eval('#gbody tr', els => els.map(e => [...e.querySelectorAll('td')].map(t => t.textContent.trim())));
    const all = await rowsOf();
    // 點一個大類,剩下的每一列都要是那一類
    await p.click('#gcat .catchip:nth-child(2)'); await wait(700);
    const catRows = await rowsOf();
    if (!catRows.length) throw new Error('★ 點了大類之後一列都沒有');
    if (catRows.length >= all.length) throw new Error('★ 點了大類之後筆數沒有變少(' + all.length + '→' + catRows.length + ')');
    const kinds = [...new Set(catRows.map(r => r[2]))];
    if (kinds.length !== 1) throw new Error('★ 篩了大類還混著別類:' + kinds.join(','));
    // 再疊一個人員,兩個條件要同時成立
    await p.click('#gwho .catchip:nth-child(2)'); await wait(700);
    const both = await rowsOf();
    if (both.length && !/沒有符合/.test(both[0][0])) {
      const people = [...new Set(both.map(r => r[1]))], ks = [...new Set(both.map(r => r[2]))];
      if (people.length !== 1 || ks.length !== 1)
        throw new Error('★ 大類 + 人員要同時成立,現在是 ' + people.join(',') + ' / ' + ks.join(','));
    }
    // 搜尋跟籤條也要疊得起來
    await p.fill('#gq', '不可能出現的字串zzz'); await wait(700);
    const none = await rowsOf();
    if (none.length !== 1 || !/沒有符合/.test(none[0][0])) throw new Error('★ 搜不到時應該顯示空狀態:' + JSON.stringify(none.slice(0, 2)));
    await p.fill('#gq', ''); await wait(700);
    await p.click('#gcat .catchip:nth-child(1)'); await wait(600);
    await p.click('#gwho .catchip:nth-child(1)'); await wait(600);
    const back = await rowsOf();
    if (back.length !== all.length) throw new Error('★ 清掉篩選之後筆數應該回到 ' + all.length + ',現在是 ' + back.length);
  }

  /**
   * ---- 照片載不出來要看得出來 ----
   * 以前卡片的照片是 background-image,載失敗就只剩一塊空白 ——
   * 使用者分不出「這個展品沒放照片」跟「照片壞了」,回報過來也只能用猜的
   * (2026-10-06 同事的電腦看不到照片,查了半天才確定不是版面問題)。
   */
  {
    const id = await p.evaluate(async () => {
      const it = await Api.call('saveItem', { item: { name: '壞照片測試機', mode: 'qty',
        category: 'Signage', sites: [{ location: '新竹', qty: 1 }],
        image: 'https://127.0.0.1:9/not-a-real-photo.jpg' } }, S.token);
      bumpCache();
      return it.id;
    });
    await p.click('[data-v=catalog]'); await wait(1200);
    await p.evaluate(() => { S.filters.q = '壞照片測試機'; S.filters.cat = ''; S.filters.loc = ''; S._catDraw(); });
    await p.waitForSelector(`#cgrid .item-card .img`, { timeout: 8000 });
    await wait(2500);                       // 等那張圖真的失敗(onerror)
    const st = await p.evaluate(() => {
      const el = document.querySelector('#cgrid .item-card .img');
      if (!el) return null;
      return { broken: el.classList.contains('broken'), h: Math.round(el.getBoundingClientRect().height),
        after: getComputedStyle(el, '::after').content };
    });
    if (!st) throw new Error('前置條件:找不到那張卡片的照片區塊');
    if (!st.broken) throw new Error('★ 照片載不出來時要標成 broken,不可以靜悄悄留一塊空白');
    if (!/載不出來/.test(st.after || '')) throw new Error('★ 載不出來的那一塊要寫出「照片載不出來」,實際:' + st.after);
    if (st.h < 60) throw new Error('★ 那一塊還是要佔住版面,不然卡片會跳一下:' + st.h);
    await p.evaluate(() => { S.filters.q = ''; S._catDraw(); }); await wait(400);
  }

  /**
   * ---- 點縮圖要看得到大圖 ----
   * 卡片上那一塊只有 150px 高,借用人光看它分不出展品長什麼樣(2026-10-06 回報)。
   * 用 data: 圖當測試素材,因為沙箱連不到 Google。
   */
  {
    // 用 SVG 當素材:沙箱連不到 Google,而且它有真正的尺寸(1px 的 GIF 放大也還是 1px)
    const PX = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='600' height='400'><rect width='600' height='400' fill='%23C8102E'/></svg>";
    await p.evaluate(async px => {
      await Api.call('saveItem', { item: { name: '放大測試機', mode: 'qty', category: 'Signage',
        sites: [{ location: '新竹', qty: 1 }], image: px } }, S.token);
      bumpCache();
    }, PX);
    await p.click('[data-v=catalog]'); await wait(1200);
    await p.evaluate(() => { S.filters.q = '放大測試機'; S.filters.cat = ''; S.filters.loc = ''; S._catDraw(); });
    await p.waitForSelector('#cgrid .item-card .img[data-act=zoom-photo]', { timeout: 8000 });
    if (await p.$('#photo-bg')) throw new Error('前置條件:還沒點就不該有大圖');
    await p.click('#cgrid .item-card .img[data-act=zoom-photo]'); await wait(600);
    const box = await p.evaluate(() => {
      const bg = document.querySelector('#photo-bg');
      if (!bg) return null;
      const img = bg.querySelector('img');
      const r = img.getBoundingClientRect();
      return { src: img.getAttribute('src'), w: Math.round(r.width), h: Math.round(r.height),
        cap: (bg.querySelector('.cap') || {}).textContent };
    });
    if (!box) throw new Error('★ 點了縮圖要蓋上一張大圖');
    if (box.h < 200) throw new Error('★ 大圖要比卡片上那 150px 大得有感,實際高 ' + box.h);
    if (!/放大測試機/.test(box.cap || '')) throw new Error('★ 大圖下面要寫是哪一個展品:' + box.cap);
    await p.keyboard.press('Escape'); await wait(400);
    if (await p.$('#photo-bg')) throw new Error('★ 按 Esc 要關掉大圖');
    if (!await p.$('#cgrid .item-card')) throw new Error('★ Esc 只該關大圖,不可以把底下的頁面一起收掉');
    /**
     * 放大的網址要**整個換成 lh3**,不是把原本 thumbnail 的 sz 調大 ——
     * `drive.google.com/thumbnail` 在 sz=w2000 有些檔案會卡住不回應
     * (2026-10-06 在正式站用真實檔案連測兩輪確認,每次都一樣)。
     */
    const ID = 'ABCDEFGHIJKLMNOPQRSTUVWX';
    const sz = await p.evaluate(id => [
      bigPhoto('https://drive.google.com/thumbnail?id=' + id + '&sz=w1000'),
      bigPhoto('https://lh3.googleusercontent.com/d/' + id + '=w1000'),
      bigPhoto('https://example.com/a.jpg?sz=w1000')
    ], ID);
    const want = 'https://lh3.googleusercontent.com/d/' + ID + '=w2000';
    if (sz[0] !== want) throw new Error('★ 放大要走 lh3,不可以沿用 thumbnail 的 sz 參數:' + sz[0]);
    if (sz[1] !== want) throw new Error('★ 本來就是 lh3 的也要換成 w2000:' + sz[1]);
    if (/drive\.google\.com\/thumbnail/.test(sz[0]))
      throw new Error('★ 放大不可以再用 thumbnail 那個網址(有些檔案在 w2000 會卡住)');
    if (sz[2] !== 'https://example.com/a.jpg?sz=w1000')
      throw new Error('★ 不是雲端硬碟的網址不可以亂改參數(會變成 404):' + sz[2]);
    await p.evaluate(() => { S.filters.q = ''; S._catDraw(); }); await wait(400);
  }

  /**
   * ---- 照片體檢 ----
   * 共用設定沒設好的照片,**上傳的人自己完全看不出異常**(他登入著同一個 Google 帳號),
   * 看不到的是別人。所以管理者要有一個地方可以一次問清楚。
   */
  {
    await p.click('[data-v=items]'); await wait(1400);
    if (!await p.$('[data-act=photo-check]')) throw new Error('★ 展品管理要有「檢查照片」');
    await p.click('[data-act=photo-check]'); await p.waitForSelector('.modal h2', { timeout: 10000 });
    await wait(500);
    const txt = await p.textContent('.modal');
    if (!/照片體檢/.test(txt)) throw new Error('★ 應該開出照片體檢視窗:' + txt.slice(0, 80));
    if (!/正常/.test(txt)) throw new Error('★ 體檢結果至少要講「正常幾張」:' + txt.slice(0, 120));
    await p.click('.modal [data-act=close]'); await wait(400);
  }

}
