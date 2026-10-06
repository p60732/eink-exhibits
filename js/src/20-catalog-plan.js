/* ===================== 各頁面 ===================== */
const VIEWS = {};

/** KPI 磚:圖示 + 標題 + 數字,可選擇點擊跳頁 */
function kpi(icon, label, value, cls, act, f) {
  return `<div class="card kpi ${cls || ''}" ${act ? `data-act="${act}" data-f="${f}" style="cursor:pointer"` : ''}>
    <div class="box">${icon}</div><div><div class="l">${label}</div><div class="v">${value}</div></div></div>`;
}

/** 分類籤條:全部 + 每個分類各自帶數量 */
function catBar(cats, active, counts) {
  const all = Object.values(counts).reduce((x, y) => x + y, 0);
  const one = (key, label, n2) => `<button class="catchip ${active === key ? 'on' : ''}" data-act="pick-cat" data-cat="${esc(key)}">${esc(label)}<span class="n">${n2}</span></button>`;
  const chips = [one('', '全部', all)];
  cats.forEach(c => chips.push(one(c.name, c.name, counts[c.name] || 0)));
  return `<div class="catbar">${chips.join('')}</div>`;
}
/** 依分類把展品分段;某一類還沒有東西也要留著,才看得出缺什麼 */
function groupByCat(cats, list) {
  const byCat = {};
  cats.forEach(c => byCat[c.name] = []);
  list.forEach(i => (byCat[i.category] = byCat[i.category] || []).push(i));
  const order = cats.map(c => c.name);
  Object.keys(byCat).forEach(k => { if (order.indexOf(k) < 0) order.push(k); });
  return order.map(name => [name, byCat[name]]);
}

VIEWS.catalog = async main => {
  const gen = RGEN;
  const f = S.filters;
  // 為展覽挑選時,日期一律用展覽的檔期(不讓人在這裡改),可借量也要排除這場自己的卡位
  const pick = S.showPick;
  const rs = pick ? pick.from : f.start, re = pick ? pick.to : f.end;
  const range = rs && re && rs <= re;
  const req = range ? { start: rs, end: re } : {};
  if (pick) req.showId = pick.id;
  const ckey2 = 'catalog|' + (range ? rs + '~' + re : '') + (pick ? '|show=' + pick.id : '');
  warm(ckey2, 'catalog', req);                 // 別排在 cats 後面
  S.cats = await cachedGet('cats', 'cats');
  return withData(main, ckey2, 'catalog', req, items => {
  S.items = items;
  if (f.cat && !S.cats.some(c => c.name === f.cat)) f.cat = '';
  const picked = () => (S.showLines || []).reduce((a, l) => a + l.qty, 0);
  main.innerHTML = `<div class="eyebrow">Catalog</div><h1>展品目錄</h1>
    ${pick ? '' : `<p class="sub">即時庫存。選擇日期區間可查看該期間還能借多少,再加入「借用申請」。</p>`}
    <div class="toolbar">
      <input class="grow" type="search" id="cq" placeholder="搜尋品名、規格、位置…" value="${esc(f.q)}">
      ${pick ? '' : `<span class="row" style="gap:6px"><input type="date" id="cs" ${DLIM()} value="${esc(f.start)}" aria-label="起"><span class="meta">→</span><input type="date" id="ce" ${DLIM()} value="${esc(f.end)}" aria-label="迄"></span>`}
      <label class="chk"><input type="checkbox" id="cav" ${f.onlyAvail ? 'checked' : ''}>只看可借</label>
      ${pick ? '' : `<button class="btn" data-act="export" title="把目前的庫存表匯出成 CSV" aria-label="匯出庫存 CSV">${ICON.dl}<span class="lbl-hide">匯出</span></button>`}
    </div>
    <!-- 挑選中的提示與「一起填單」都放進釘住的那一塊:往下挑的時候按鈕要一直在手邊 -->
    <div class="catbar-stick" id="cbars">${pick ? `<div class="card bulkbar" id="pickbar"></div>` : ''}<div class="catbar" id="csite"></div><div id="cbar"></div><div id="mbar"></div></div>
    ${range && !pick ? `<div class="banner info">顯示 <b>${esc(f.start)} → ${esc(f.end)}</b> 期間可借數量(已扣除出借中的借用與展覽卡位)。 <a href="#" data-act="use-range">套用到借用申請</a></div>` : ''}
    <div id="cgrid"></div>`;
  const card = i => {
    const inCart = pick
      ? (S.showLines || []).filter(l => l.itemId === i.id).reduce((a, l) => a + l.qty, 0)
      : S.cart.filter(c => c.itemId === i.id).reduce((a, c) => a + c.qty, 0);
    // 選了地點就整張卡只講那個地點:數字、可借量、加入申請的來源通通鎖在那一區。
    // 每個地點的數字後端本來就分開算好了(itemView 的 sites[]),前端不重算。
    const gsAll = i.sites || [];
    const here = f.loc ? gsAll.find(g => nloc(g.location) === f.loc) : null;
    const n = here || i;                       // 沒選地點就用整個品項的合計
    const av = range ? (here ? (here.available || 0) : i.available) : null;
    const gs = f.loc ? (here ? [here] : []) : gsAll;
    const picker = gs.length > 1
      ? `<select id="loc-${i.id}" aria-label="從哪個地點借">${gs.map(g => `<option value="${esc(g.location)}">${esc(g.location)}(${range ? '可借 ' + (g.available || 0) : '在庫 ' + g.inStock})</option>`).join('')}</select>`
      : `<input type="hidden" id="loc-${i.id}" value="${esc(gs[0] ? gs[0].location : '')}">`;
    const distHtml = f.loc
      ? `<div class="dist"><span class="${n.inStock ? '' : 'z'}">${esc(f.loc)} <b>${Number(range ? n.total : n.inStock) || 0}</b></span></div>`
      : distLine(i, range ? 'total' : 'inStock');
    return `<div class="card item-card">
      ${i.image ? `<div class="img"><img src="${esc(i.image)}" alt="${esc(i.name)}" loading="lazy" onerror="this.closest('.img').classList.add('broken')"></div>` : ''}
      <div class="row" style="gap:6px"><label class="chk"><input type="checkbox" data-mpick="${esc(i.id)}" ${S.multi.has(i.id) ? 'checked' : ''}>選</label><span class="pill">${esc(i.category)}</span>${i.mode === 'unit' ? '<span class="pill unit">逐台編號</span>' : ''}<span class="meta mono" style="margin-left:auto">${esc(i.id)}</span></div>
      <h3>${esc(i.name)}</h3>
      ${i.spec ? `<div class="meta">${esc(i.spec)}</div>` : ''}
      <div class="meta">存放:</div>${distHtml}
      <div class="nums"><div class="${n.inStock ? '' : 'zero'}"><b>${n.inStock}</b>倉庫在庫</div><div><b>${n.out}</b>出借中</div><div><b>${n.reserved}</b>已預約</div><div><b>${n.total}</b>總數</div></div>
      ${range ? `<div class="avail ${av ? '' : 'none'}">期間可借 <b>${av}</b></div>` : ''}
      <div class="addrow">${picker}<input type="number" min="1" value="1" id="q-${i.id}" aria-label="數量"><button class="btn sm pri" style="flex:1" data-act="${pick ? 'show-add-cat' : 'add-cart'}" data-id="${i.id}">${inCart ? (pick ? `加入展覽(已選 ${inCart})` : `加入申請(已選 ${inCart})`) : (pick ? '加入展覽' : '加入申請')}</button></div>
    </div>`;
  };
  // 這批展品實際出現過的地點(排除只出現在別區的),選了不存在的地點就當作沒選
  const SITES = [...new Set(S.items.flatMap(i => (i.sites || []).map(g => nloc(g.location))))].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  if (f.loc && !SITES.includes(f.loc)) f.loc = '';
  const atLoc = i => !f.loc || (i.sites || []).some(g => nloc(g.location) === f.loc);
  /** 只看得到這個地點時,「有沒有貨」要用那個地點的數字判斷,不是全部廠區加總 */
  const stockAt = i => { const g = f.loc ? (i.sites || []).find(x => nloc(x.location) === f.loc) : null;
    const src = g || i; return range ? (src.available || 0) : (src.inStock || 0); };
  let draw = () => {
    const q = f.q.toLowerCase();
    const match = i => atLoc(i)
      && (!q || [i.name, i.spec, i.location, i.category, i.id, itemSites(i).join(' ')].join(' ').toLowerCase().includes(q))
      && (!f.onlyAvail || stockAt(i) > 0);
    const shown = S.items.filter(match);
    const counts = {};
    shown.forEach(i => counts[i.category] = (counts[i.category] || 0) + 1);
    $('#cbar').innerHTML = catBar(S.cats, f.cat, counts);
    // 地點籤條的數字:已經套上搜尋與分類之後,那一區還剩幾項
    const inCat = i => !f.cat || i.category === f.cat;
    const qOnly = S.items.filter(i => !q || [i.name, i.spec, i.location, i.category, i.id, itemSites(i).join(' ')].join(' ').toLowerCase().includes(q));
    const siteChip = (key, label, n2) => `<button class="catchip ${f.loc === key ? 'on' : ''}" data-cloc="${esc(key)}">${esc(label)}<span class="n">${n2}</span></button>`;
    $('#csite').innerHTML = siteChip('', '全部廠區', qOnly.filter(inCat).length)
      + SITES.map(L => siteChip(L, L, qOnly.filter(i => inCat(i) && (i.sites || []).some(g => nloc(g.location) === L)).length)).join('');
    $$('[data-cloc]').forEach(el => el.onclick = () => { f.loc = el.dataset.cloc; draw(); });
    const block = arr => arr.length ? `<div class="cards">${arr.map(card).join('')}</div>` : '<div class="catempty">這個分類還沒有展品</div>';
    $('#cgrid').innerHTML = f.cat
      ? (shown.filter(i => i.category === f.cat).length ? block(shown.filter(i => i.category === f.cat)) : '<div class="card empty">這個分類還沒有展品</div>')
      : groupByCat(S.cats, shown).map(([name, arr]) => `<h2 class="cath">${esc(name)}<span class="chipnum">${arr.length}</span></h2>` + block(arr)).join('');
  };
  const mbar = () => {
    if (pick) { $('#mbar').innerHTML = ''; return; }
    $('#mbar').innerHTML = S.multi.size
      ? `<div class="card bulkbar multibar"><b>已選 ${S.multi.size} 項</b><span class="meta">預設各 1 個,到規劃頁可以改數量</span>
         <span class="spacer"></span><button class="btn" data-act="multi-clear">清空</button><button class="btn brand" data-act="multi-go">一起填單</button></div>`
      : '';
  };
  const wirePick = () => $$('[data-mpick]').forEach(el => el.onchange = () => {
    el.checked ? S.multi.add(el.dataset.mpick) : S.multi.delete(el.dataset.mpick);
    mbar();
  });
  const pickbar = () => {
    if (!pick) return;
    const nm = pick.name, a = pick.from, b = pick.to;   // 純文字,插值時各自 esc()
    $('#pickbar').innerHTML = `<b>正在為「${esc(nm)}」挑選展品</b>
      <span class="meta">${esc(a)} → ${esc(b)}・已選 ${(S.showLines || []).length} 項 ${picked()} 件</span>
      <span class="spacer"></span><button class="btn brand" data-act="show-pick-done">完成,回到展覽</button>`;
  };
  const draw0 = draw;
  draw = () => { draw0(); wirePick(); mbar(); pickbar(); };
  draw();
  $('#cq').oninput = e => { f.q = e.target.value; draw(); };
  $('#cav').onchange = e => { f.onlyAvail = e.target.checked; draw(); };
  S._catDraw = draw;
  if (!pick) {
    const dch = () => { f.start = $('#cs').value; f.end = $('#ce').value; if ((f.start && f.end) || (!f.start && !f.end)) render(); };
    $('#cs').onchange = dch; $('#ce').onchange = dch;
  }
  }, gen);
};

VIEWS.plan = async main => {
  // 可借量的試算跟目錄沒有先後關係,一起發。排隊的話要等兩趟(約 3.5 秒)才看得到數字
  const P0 = S.plan, ed0 = S.editing;
  if (isAdmin() && !ed0) warm('users', 'users');   // 代為登記的工號下拉,別排在目錄後面
  const preCheck = (P0.start && P0.end && P0.start <= P0.end && S.cart.length)
    ? api('check', { start: P0.start, end: P0.end, lines: S.cart.slice(), excludeId: ed0 ? ed0.id : '' }).catch(() => null)
    : Promise.resolve(null);
  const all = await cachedGet('catalog|', 'catalog');
  const byId = Object.fromEntries(all.map(i => [i.id, i]));
  S.cart = S.cart.filter(c => byId[c.itemId]); saveCart();
  const P = S.plan, admin = isAdmin();
  const draft = store.get(uk('draft'), {});
  if (!S.cart.length) {
    main.innerHTML = `${S.editing ? `<div class="banner info">正在修改申請 <b class="mono">${esc(S.editing.no)}</b>。 <a href="#" data-act="cancel-edit">放棄修改</a></div>` : ''}<div class="eyebrow">Planning</div><h1>${S.editing ? '修改借用申請' : '借用申請'}</h1><p class="sub">把需要的展品加進來,系統會依日期檢查夠不夠、缺什麼,確認後直接送出。</p>
      <div class="card empty">還沒有選任何展品。<br><br><button class="btn pri" data-act="go" data-v="catalog">前往展品目錄挑選</button></div>`;
    return;
  }
  const ed = S.editing;
  main.innerHTML = `${ed ? `<div class="banner info">正在修改申請 <b class="mono">${esc(ed.no)}</b>,改完按下方「儲存修改」。 <a href="#" data-act="cancel-edit">放棄修改</a></div>` : ''}
  <h1>${ed ? '修改借用申請' : '借用申請'}</h1><p class="sub">先選日期,系統即時比對可借數量。全部足夠即可送出申請${admin && !ed ? ';口頭借用可用「代為登記」直接建單' : ''}。</p>
  <div class="plan">
    <div class="card">
      <div class="grid2"><label class="f"><span>借出日 <b>*</b></span><input type="date" id="ps" ${DLIM()} value="${esc(P.start)}"></label><label class="f"><span>歸還日 <b>*</b></span><input type="date" id="pe" ${DLIM()} value="${esc(P.end)}"></label></div>
      <div class="lines" id="plines"></div>
      <div id="psum"></div>
      <div class="row" style="margin-top:10px"><button class="btn sm" data-act="go" data-v="catalog">${ICON.plus}繼續加展品</button><button class="btn sm ghost" data-act="clear-cart">清空</button><span class="spacer"></span><button class="btn sm" data-act="copy-plan">複製清單</button></div>
    </div>
    <form class="card" id="pform">
      <label class="f"><span>借用目的 <b>*</b></span><input type="text" name="event" required value="${esc(draft.event || '')}" placeholder="例:客戶參訪展示、春季展覽佈展"></label>
      <div class="grid2"><label class="f"><span>地點</span><input type="text" name="venue" value="${esc(draft.venue || '')}"></label><label class="f"><span>備註</span><input type="text" name="note" value="${esc(draft.note || '')}"></label></div>
      <div class="meta" style="margin:-4px 0 10px">聯絡方式自動帶:<b>${esc([S.user.empNo, S.user.email].filter(Boolean).join(' / '))}</b>(來自你的帳號,不用填)</div>
      ${admin ? `<div class="card" style="background:var(--surface-2);box-shadow:none;margin-bottom:12px">
        <label class="chk"><input type="checkbox" name="onBehalf" id="ob">代為登記(口頭借用 / 臨時借出)</label>
        <div id="obf" class="hidden" style="margin-top:10px"><label class="f"><span>借用人工號或姓名 <b>*</b></span><input type="text" name="applicant" list="ulist"></label>
        <div class="meta">代為登記會直接成為「<b>出借中</b>」—— 等於東西當下就交出去了,逐台編號也會自動綁定。<b>借用人要對得到真實帳號</b>(從上面的清單選),通知才寄得到他。</div>
        <label class="chk" style="margin-top:8px"><input type="checkbox" name="force">數量不足仍建立</label></div>
        <datalist id="ulist"></datalist></div>` : ''}
      <button class="btn pri" style="width:100%" id="psubmit">${ed ? '儲存修改' : '送出借用申請'}</button>
    </form>
  </div>`;
  let lastCheck = [], dateErr = rangeProblem(P.start, P.end);
  const drawLines = () => {
    const ck = Object.fromEntries(lastCheck.map(c => [c.itemId + '@' + (c.location || ''), c]));
    $('#plines').innerHTML = S.cart.map(c => {
      const i = byId[c.itemId], k = ck[ckey(c)] || ck[c.itemId + '@'];
      const st = k ? (k.short
        ? `<button type="button" class="short linkish" data-act="who" data-i="${esc(c.itemId)}" data-w="${esc(c.location || '')}" title="看看是誰佔著">缺 ${k.short}(可借 ${k.available})</button>`
        : `<span class="okt">足夠(可借 ${k.available})</span>`) : `<span class="meta">在庫 ${i.inStock}</span>`;
      const where = esc(c.location || (i.sites || []).map(g => g.location).join('、'));
      const key = esc(ckey(c));
      return `<div class="line"><span class="nm">${esc(i.name)}<br><span class="meta">${where}</span></span>
        <span class="qtybox"><button type="button" data-act="cq" data-id="${key}" data-d="-1">−</button><input type="number" min="1" value="${c.qty}" data-cqi="${key}"><button type="button" data-act="cq" data-id="${key}" data-d="1">+</button></span>
        <span style="min-width:120px;text-align:right">${st}</span>${rmBtn('rm-cart', `data-id="${key}"`)}</div>`;
    }).join('');
    $$('[data-cqi]').forEach(inp => inp.onchange = () => { const c = S.cart.find(x => ckey(x) === inp.dataset.cqi); c.qty = Math.max(1, parseInt(inp.value, 10) || 1); saveCart(); recheck(); });
    const short = lastCheck.filter(c => c.short);
    const hasRange = P.start && P.end && !dateErr;
    $('#psum').innerHTML = dateErr ? `<div class="sumbar banner bad"><b>日期有問題</b>:${esc(dateErr)}</div>`
      : !hasRange ? `<div class="sumbar banner info">選擇日期後會檢查每項是否足夠</div>`
      : short.length ? `<div class="sumbar banner bad"><b>缺 ${short.length} 項</b>:${short.map(s => esc(s.name) + (s.location ? '(' + esc(s.location) + ')' : '') + ' ×' + s.short).join('、')}</div>`
        : `<div class="sumbar banner ok"><b>全部足夠</b>,共 ${S.cart.length} 項 ${S.cart.reduce((a, c) => a + c.qty, 0)} 件</div>`;
    const force = admin && $('#pform [name=force]') && $('#pform [name=force]').checked;
    $('#psubmit').disabled = !hasRange || (short.length && !force);
  };
  const recheck = async () => {
    dateErr = rangeProblem(P.start, P.end);
    if (!dateErr && P.start && P.end) {
      try { lastCheck = await api('check', { start: P.start, end: P.end, lines: S.cart, excludeId: ed ? ed.id : '' }); } catch (e) { lastCheck = []; toast(e.message, true); }
    } else lastCheck = [];
    drawLines();
  };
  S._recheck = recheck;
  const dch = () => { P.start = $('#ps').value; P.end = $('#pe').value; if (P.start && !P.end) { P.end = P.start; $('#pe').value = P.start; } saveCart(); recheck(); };
  $('#ps').onchange = dch; $('#pe').onchange = dch;
  $('#pform').oninput = () => { const fd = Object.fromEntries(new FormData($('#pform'))); store.set(uk('draft'), { event: fd.event, venue: fd.venue, note: fd.note }); drawLines(); };
  // 先用在庫數把清單畫出來,不要讓它空在那裡等後端 —— 可借量回來再補上去就好
  drawLines();
  preCheck.then(pre => {
    if (dateErr) return;                                     // 日期本身就有問題,算可借量沒有意義
    if (pre) { lastCheck = pre; drawLines(); }
    else if (P.start && P.end && S.cart.length) recheck();   // 那一趟失敗了才補打一次(順便讓錯誤訊息出得來)
  });
  if (admin && !ed) {
    $('#ob').onchange = e => $('#obf').classList.toggle('hidden', !e.target.checked);
    cachedGet('users', 'users').then(us => { $('#ulist').innerHTML = us.filter(u => u.active).map(u => `<option value="${esc(u.empNo)}">${esc(u.name)} ${esc(u.dept || '')}</option>`).join(''); }).catch(() => { });
  }
  $('#pform').onsubmit = async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const bad = rangeProblem(P.start, P.end);
    if (bad) return toast(bad, true);
    const payload = { ...fd, start: P.start, end: P.end, lines: S.cart, onBehalf: !!fd.onBehalf, force: !!fd.force };
    if (payload.onBehalf && !String(fd.applicant || '').trim()) return toast('請填寫借用人', true);
    if (ed) {
      const { event, venue, note } = fd;
      const upd = await run(() => api('updateLoan',
        { id: ed.id, event, venue, note, start: P.start, end: P.end, lines: S.cart, force: !!fd.force }),
        '已儲存修改').catch(() => null);
      if (!upd) return;
      S.editing = null; S.cart = []; store.del(uk('draft')); saveCart();
      return go('mine');
    }
    const L = await run(() => api('createLoan', payload)).catch(() => null);
    if (!L) return;
    S.cart = []; store.del(uk('draft')); saveCart();
    // 代為登記回來的是「出借中」(v3.0 起沒有「已核准」這個中繼狀態了),兩邊的文案與落點都要跟著分
    const direct = L.status === 'out';
    openModal(`<h2>${direct ? '已建立借用單' : '申請已送出'}</h2>
      <p>單號 <b class="mono">${esc(L.id)}</b>。${direct
        ? '已直接登記為「出借中」,展品當下就算交出去了。歸還時再到借用單按「登記歸還」。'
        : '管理者核准或不核准都會寄 Email 通知你,核准的那一刻展品就算交付了。進度也可以在「我的借用」查看。'}</p>
      <div class="modal-f"><button class="btn" data-act="close">留在此頁</button><button class="btn pri" data-act="go" data-v="${direct ? 'loans' : 'mine'}" data-f="${direct ? 'out' : ''}">查看借用單</button></div>`);
    render();
  };
};

