/**
 * 【UI 場景】tests/ui/04-speed.js — 速度四條 + 換版橫幅
 * 前置:00、01
 * 跑法:node tests/ui.test.js 04(會自動帶上前置場景)
 */
module.exports = { id: '04', title: '速度四條 + 換版橫幅', needs: ['00'], run: run };
async function run(C) {
  const { p, b, shot, wait, errs, PNG, d, URL } = C;
  // ---- 速度:同一次開頁不可以把同一份資料要兩次(v2.5.2)----
  // warm() 如果只把請求丟出去、沒把結果收進快取,它早回來時 INFLIGHT 已經清掉、
  // RCACHE 又還沒有,等一下真的要用的人會再送一次 —— 白跑一趟,比不做還糟。
  // 2026-09-24 逐頁量測就是這樣抓到的(目錄與展品管理各送了三趟)。
  {
    const p8 = await b.newPage({ viewport: { width: 1280, height: 900 } });
    p8.on('dialog', d => d.accept());
    let seen = [];
    await p8.route('**/api', async r => {
      let act = '';
      try { act = JSON.parse(r.request().postData() || '{}').action || ''; } catch (e) { }
      seen.push(act);
      await new Promise(z => setTimeout(z, 250));     // 本機太快,拉開一點才量得到重複
      await r.continue();
    });
    await p8.goto(URL); await p8.waitForSelector('#login-f');
    await p8.fill('#l-emp', '90001'); await p8.click('#login-f button');
    await p8.waitForSelector('#l-pin:visible'); await p8.fill('#l-pin', '1234'); await p8.click('#login-f button');
    await p8.waitForSelector('#tabs .tab');
    for (const tab of ['catalog', 'items']) {
      await p8.click('[data-v=dash]'); await p8.waitForTimeout(500);
      await p8.evaluate(() => bumpCache());
      seen = [];
      await p8.click('[data-v=' + tab + ']'); await p8.waitForTimeout(3000);
      const dup = seen.filter((a, i) => seen.indexOf(a) !== i);
      if (dup.length) throw new Error('★ 開「' + tab + '」把同一份資料要了兩次:' + seen.join(',')
        + ' —— warm() 沒有把結果收進快取的話就會這樣');
    }
    await p8.close();
  }

  // ---- 速度:開機畫面不可以等後端(v2.5.1)----
  // 容器冷掉時一趟要 40 秒以上。原本 boot() 先等 status 回來才畫登入表單,
  // 等於讓人對著白畫面乾等 40 幾秒,連帳號都還不能打。
  {
    const p7 = await b.newPage({ viewport: { width: 1280, height: 900 } });
    p7.on('dialog', d => d.accept());
    // status / me 一律不回應,模擬「容器正在冷啟動」
    await p7.route('**/api', async r => {
      let act = '';
      try { act = JSON.parse(r.request().postData() || '{}').action || ''; } catch (e) { }
      if (act === 'status' || act === 'me') return;          // 卡住不回
      await r.continue();
    });
    const t0 = Date.now();
    await p7.goto(URL);
    await p7.waitForSelector('#login-f', { timeout: 3000 })
      .catch(() => { throw new Error('★ 後端沒回應時登入表單就出不來 —— 冷啟動要 40 秒,使用者會對著白畫面等'); });
    const ms = Date.now() - t0;
    if (ms > 3000) throw new Error('★ 登入表單出現得太慢:' + ms + 'ms');
    await p7.close();
  }

  // ---- 速度:重整之後不該乾等後端(v2.5)----
  // 一趟來回 1.2~1.8 秒起跳、偶爾 8~26 秒,所以快取要跨重整活下來:
  // 打開先畫上次的,背景再更新。這裡把 loans 的請求卡住不回,驗證畫面照樣出得來。
  {
    const p6 = await b.newPage({ viewport: { width: 1280, height: 900 } });
    p6.on('dialog', d => d.accept());
    await p6.goto(URL); await p6.waitForSelector('#login-f');
    await p6.fill('#l-emp', '90001'); await p6.click('#login-f button');
    await p6.waitForSelector('#l-pin:visible'); await p6.fill('#l-pin', '1234'); await p6.click('#login-f button');
    await p6.waitForSelector('#tabs .tab');
    await p6.click('[data-v=loans]'); await p6.waitForTimeout(1500);
    await p6.click('[data-f=all]'); await p6.waitForTimeout(2000);
    const before = await p6.textContent('#llist');
    if (!/\S/.test(before)) throw new Error('借用單清單一開始就是空的,量不出東西');
    // 重整,並且讓 loans 的請求永遠不回來
    await p6.route('**/api', async r => {
      let act = '';
      try { act = JSON.parse(r.request().postData() || '{}').action || ''; } catch (e) { }
      if (act === 'loans') return;                      // 卡住不回應
      await r.continue();
    });
    await p6.reload();
    await p6.waitForSelector('#tabs .tab', { timeout: 15000 });
    await p6.click('[data-v=loans]');
    // 後端完全不回的情況下,還是要在兩秒內畫出東西
    await p6.waitForFunction(() => {
      const el = document.querySelector('#llist');
      return el && /\S/.test(el.textContent);
    }, null, { timeout: 2500 }).catch(() => { throw new Error('★ 重整之後沒有快取可畫,使用者只能乾等後端那一趟'); });
    await p6.close();
  }

  // ---- 速度:同一頁不可以把沒有先後關係的請求排成一列(v2.5)----
  // 一趟來回 1.7 秒,排隊就是倍數。這裡數「開這一頁實際送出幾趟、有沒有重疊」。
  {
    const p5 = await b.newPage({ viewport: { width: 1280, height: 900 } });
    p5.on('dialog', d => d.accept());
    const reqs = [];
    await p5.route('**/api', async r => {
      let act = '';
      try { act = JSON.parse(r.request().postData() || '{}').action || ''; } catch (e) { }
      const rec = { act, t0: Date.now(), t1: 0 };
      reqs.push(rec);
      await r.continue();
      rec.t1 = Date.now();
    });
    await p5.goto(URL); await p5.waitForSelector('#login-f');
    await p5.fill('#l-emp', '10231'); await p5.click('#login-f button'); await p5.waitForSelector('#tabs .tab');
    // 放兩項進購物車並填好日期,製造出「目錄 + 試算」兩份需求
    await p5.click('[data-v=catalog]'); await p5.waitForTimeout(1200);
    const adds = await p5.$$('[data-act=add-cart]');
    await adds[0].click(); await p5.waitForTimeout(400);
    await p5.click('[data-v=plan]'); await p5.waitForTimeout(1200);
    const dd = k => new Date(Date.now() + k * 864e5).toISOString().slice(0, 10);
    await p5.fill('#ps', dd(1)); await p5.dispatchEvent('#ps', 'change');
    await p5.fill('#pe', dd(3)); await p5.dispatchEvent('#pe', 'change');
    await p5.waitForTimeout(1200);
    // 重新開一次借用申請,這次才是要量的。
    // 一定要先清快取 —— 不然目錄直接從快取拿,根本不會送出請求,也就量不到有沒有排隊。
    await p5.click('[data-v=catalog]'); await p5.waitForTimeout(900);
    await p5.evaluate(() => bumpCache());
    reqs.length = 0;
    await p5.click('[data-v=plan]'); await p5.waitForTimeout(3000);
    const cat = reqs.find(r => r.act === 'catalog'), chk = reqs.find(r => r.act === 'check');
    if (!cat) throw new Error('量不到目錄請求(清了快取還是沒送?):' + reqs.map(r => r.act).join(','));
    if (!chk) throw new Error('借用申請沒有送出可借量試算:' + reqs.map(r => r.act).join(','));
    if (chk.t0 > cat.t1) throw new Error('★ 試算排在目錄回來之後才發,兩趟加起來要等兩倍('
      + (chk.t0 - cat.t1) + 'ms 之後才發)');
    await p5.close();
  }

  // ---- 「系統已經更新」橫幅(v2.3.2)----
  // index.html 本身也會被瀏覽器快取,舊的 HTML 裡寫的還是舊的 ?v=,所以「重新整理」常常沒有用。
  // 這裡假裝「這一份頁面是舊的建置、伺服器上已經是新的」,驗證橫幅會出現、按了會帶著新編號重新載入。
  {
    const srcHtml = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'index.html'), 'utf8');
    const p2 = await b.newPage({ viewport: { width: 1280, height: 900 } });
    p2.on('dialog', dlg => dlg.accept());
    await p2.route('**/version.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"build":"bbbbbbbb"}' }));
    await p2.route(URL, r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: srcHtml.replace('__BUILD__', 'aaaaaaaa') }));
    await p2.goto(URL);
    await p2.waitForSelector('#newver', { timeout: 10000 }).catch(() => { throw new Error('★ 建置編號不一樣時要掛出「系統已經更新」橫幅'); });
    if (!/已經更新/.test(await p2.textContent('#newver'))) throw new Error('橫幅文字不對');
    await p2.click('#nv-go'); await p2.waitForTimeout(1500);
    if (!/\?b=bbbbbbbb/.test(p2.url())) throw new Error('★ 按了更新要換一個帶建置編號的網址(reload 可能又拿到快取裡的舊 HTML):' + p2.url());
    // 編號一樣的時候不可以打擾使用者
    const p3 = await b.newPage({ viewport: { width: 1280, height: 900 } });
    await p3.route('**/version.json*', r => r.fulfill({ status: 200, contentType: 'application/json', body: '{"build":"aaaaaaaa"}' }));
    await p3.route(URL, r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: srcHtml.replace('__BUILD__', 'aaaaaaaa') }));
    await p3.goto(URL); await p3.waitForTimeout(2500);
    if (await p3.$('#newver')) throw new Error('★ 編號一樣就不該跳更新橫幅');
    // 拿不到 version.json 也不可以壞掉(離線 / 還沒部署)
    const p4 = await b.newPage({ viewport: { width: 1280, height: 900 } });
    const e4 = []; p4.on('pageerror', e => e4.push(e.message));
    await p4.route('**/version.json*', r => r.abort());
    await p4.route(URL, r => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: srcHtml.replace('__BUILD__', 'aaaaaaaa') }));
    await p4.goto(URL); await p4.waitForSelector('#login-f', { timeout: 10000 });
    if (e4.length) throw new Error('★ 抓不到 version.json 不可以影響正常使用:' + e4.join('|'));
    await p2.close(); await p3.close(); await p4.close();
  }

}
