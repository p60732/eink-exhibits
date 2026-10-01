/**
 * 【UI 場景】tests/ui/05-sticky.js — 分類 / 地點籤條要釘住、手機上總覽磚塊展開的位置
 * 前置:00、01
 * 跑法:node tests/ui.test.js 05(會自動帶上前置場景)
 */
module.exports = { id: '05', title: '分類 / 地點籤條要釘住、手機上總覽磚塊展開的位置', needs: ['00', '01'], run: run };
async function run(C) {
  const { p, b, shot, wait, errs, PNG, d, URL } = C;
  // ---- 分類籤條要釘在標題列底下(v2.5.3:展品目錄 + 展品管理)----
  // 展品一多就得一路捲回最上面才換得了分類,捲到下面等於沒有這排籤條。
  {
    // 上面「換人登入」那一段把 p 留在同仁身分,展品管理是管理者分頁,要先換回來
    await p.click('#menu-btn'); await p.click('#m-out'); await p.waitForSelector('#login-f');
    await p.fill('#l-emp', '90001'); await p.click('#login-f button'); await p.waitForSelector('#l-pin:visible');
    await p.fill('#l-pin', '1234'); await p.click('#login-f button'); await p.waitForSelector('[data-v=items]');
    const stickyOk = async (view, barSel, label) => {
      await p.click(`[data-v=${view}]`); await wait(900);
      await p.evaluate(() => window.scrollTo(0, 0)); await wait(200);
      const topH = await p.$eval('.top', el => el.getBoundingClientRect().height);
      await p.evaluate(() => window.scrollTo(0, 2000)); await wait(300);
      const bar = await p.$(barSel);
      if (!bar) throw new Error(label + ':找不到分類籤條 ' + barSel);
      const box = await bar.boundingBox();
      if (!box) throw new Error('★ ' + label + ':捲下去之後分類籤條不見了 —— 要釘在上面');
      if (Math.abs(box.y - topH) > 3) throw new Error('★ ' + label + ':捲下去時分類籤條要貼在標題列底下('
        + '標題列高 ' + Math.round(topH) + ',籤條在 ' + Math.round(box.y) + ')');
      // 釘住的籤條不可以蓋掉標題列
      const zs = await p.evaluate(sel => [getComputedStyle(document.querySelector('.top')).zIndex,
        getComputedStyle(document.querySelector(sel)).zIndex].map(Number), barSel);
      if (!(zs[1] < zs[0])) throw new Error('★ ' + label + ':籤條的 z-index 要低於標題列,不然會蓋住分頁列:' + zs.join('<'));
      // 點了還要真的換得動分類
      await p.click(`${barSel} .catchip:nth-child(2)`); await wait(400);
      if (!await p.$(`${barSel} .catchip.on`)) throw new Error(label + ':釘住之後點籤條沒反應');
      await p.click(`${barSel} .catchip:nth-child(1)`); await wait(400);
      await p.evaluate(() => window.scrollTo(0, 0)); await wait(200);
    };
    await stickyOk('catalog', '#cbars', '展品目錄');
    await stickyOk('items', '#ibars', '展品管理');
    await stickyOk('count', '#kbars', '盤點');
    // 多選的「一起填單」要跟著釘住:捲到下面還要看得到、按得到(2026-10-01 回報)
    {
      await p.click('[data-v=catalog]'); await wait(1500);
      await p.evaluate(() => window.scrollTo(0, 0)); await wait(200);
      const box = await p.$$('[data-mpick]');
      if (!box.length) throw new Error('目錄上找不到多選框');
      await box[0].check(); await wait(400);
      if (!await p.$('[data-act=multi-go]')) throw new Error('勾了之後應該出現「一起填單」');
      const topH = await p.$eval('.top', el => el.getBoundingClientRect().height);
      await p.evaluate(() => window.scrollTo(0, 3000)); await wait(400);
      const m = await (await p.$('[data-act=multi-go]')).boundingBox();
      if (!m) throw new Error('★ 捲下去之後「一起填單」不見了 —— 要跟分類籤條一起釘住');
      if (m.y < 0 || m.y > topH + 140) throw new Error('★ 捲下去時「一起填單」要還在畫面上方(標題列高 '
        + Math.round(topH) + ',按鈕在 ' + Math.round(m.y) + ')');
      // 釘住之後還要按得動
      await p.click('[data-act=multi-clear]'); await wait(400);
      if (await p.$('[data-act=multi-go]')) throw new Error('清空之後那一條應該收起來');
      await p.evaluate(() => window.scrollTo(0, 0)); await wait(200);
    }
    // 展品目錄釘的也是兩排(廠區 + 分類)
    {
      await p.click('[data-v=catalog]'); await wait(1200);
      await p.evaluate(() => window.scrollTo(0, 2000)); await wait(300);
      const [site, cat, wrap] = await p.evaluate(() => ['#csite', '#cbar', '#cbars']
        .map(sel => { const r = document.querySelector(sel).getBoundingClientRect(); return { y: r.y, b: r.bottom }; }));
      if (site.y < wrap.y - 1 || cat.b > wrap.b + 1) throw new Error('★ 展品目錄:廠區與分類兩排都要在釘住的那一塊裡面');
      if (cat.y - site.b > 12) throw new Error('★ 展品目錄:兩排之間離太開(' + Math.round(cat.y - site.b) + 'px)');
      await p.evaluate(() => window.scrollTo(0, 0)); await wait(200);
    }
    // 展品管理釘的也是兩排
    {
      await p.click('[data-v=items]'); await wait(1200);
      await p.evaluate(() => window.scrollTo(0, 2000)); await wait(300);
      const [site, cat, wrap] = await p.evaluate(() => ['#isite', '#ibar', '#ibars']
        .map(sel => { const r = document.querySelector(sel).getBoundingClientRect(); return { y: r.y, b: r.bottom }; }));
      if (site.y < wrap.y - 1 || cat.b > wrap.b + 1) throw new Error('★ 展品管理:廠區與分類兩排都要在釘住的那一塊裡面');
      if (cat.y - site.b > 12) throw new Error('★ 展品管理:兩排之間離太開(' + Math.round(cat.y - site.b) + 'px)');
      await p.evaluate(() => window.scrollTo(0, 0)); await wait(200);
    }
    // 盤點釘的是兩排(廠區 + 分類),兩排都要在釘住的那一塊裡面,而且要黏在一起
    {
      await p.click('[data-v=count]'); await wait(1500);
      await p.evaluate(() => window.scrollTo(0, 2000)); await wait(300);
      const [site, cat, wrap] = await p.evaluate(() => ['#ksite', '#kbar', '#kbars']
        .map(sel => { const r = document.querySelector(sel).getBoundingClientRect(); return { y: r.y, b: r.bottom, h: r.height }; }));
      if (site.y < wrap.y - 1 || cat.b > wrap.b + 1) throw new Error('★ 盤點:廠區與分類兩排都要在釘住的那一塊裡面');
      if (cat.y - site.b > 12) throw new Error('★ 盤點:兩排之間離太開(' + Math.round(cat.y - site.b) + 'px),手機上會吃掉太多畫面');
      // 釘住之後兩排都還要點得動
      await p.click('#ksite .catchip:nth-child(2)'); await wait(500);
      if (!await p.$('#ksite .catchip.on')) throw new Error('盤點:釘住之後點廠區沒反應');
      await p.click('#ksite .catchip:nth-child(1)'); await wait(500);
      await p.evaluate(() => window.scrollTo(0, 0)); await wait(200);
    }
  }

  // ---- 手機上「總覽磚塊展開」要接在被點到的那塊磚後面(2026-09-27 回報)----
  // 手機一排只放得下一塊磚。展開的明細原本固定放在八塊磚之後,
  // 使用者點了箭頭,數字跑到畫面外,看起來像「點了沒反應」。
  {
    await p.click('[data-v=dash]'); await wait(1500);
    await p.evaluate(() => window.scrollTo(0, 0)); await wait(200);
    const brickSel = '.kpi.sitekpi[data-f=items]';
    if (!await p.$(brickSel)) throw new Error('總覽:找不到可展開的「展品品項」磚塊');
    await p.click(brickSel); await p.waitForSelector('.sitebreak table', { timeout: 15000 });
    const m = await p.evaluate(sel => {
      const b = document.querySelector(sel).getBoundingClientRect();
      const s = document.querySelector('#sitebreak').getBoundingClientRect();
      const bricks = [...document.querySelectorAll('.kpi')].map(e => e.getBoundingClientRect().bottom);
      return { brickBottom: b.bottom, panelTop: s.y, lastBrickBottom: Math.max(...bricks), bricks: bricks.length };
    }, brickSel);
    if (m.bricks < 6) throw new Error('總覽的磚塊數不對:' + m.bricks);
    const gap = m.panelTop - m.brickBottom;
    if (gap < -2 || gap > 40) throw new Error('★ 總覽:展開的明細要緊接在被點到的磚塊下面,現在差 ' + Math.round(gap) + 'px');
    if (m.panelTop >= m.lastBrickBottom) throw new Error('★ 總覽:展開的明細掉到所有磚塊的下面了,手機上要捲很久才看得到');
    // 收起來之後不可以留一段空白(空的容器要移回格線外面)
    await p.click('.sitebreak [data-act=site-break]'); await wait(600);
    const h = await p.$eval('#sitebreak', el => el.getBoundingClientRect().height);
    if (h > 1) throw new Error('★ 總覽:收起之後空容器還佔了 ' + Math.round(h) + 'px');
  }

}
