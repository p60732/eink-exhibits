VIEWS.items = async main => {
  const gen = RGEN;
  warm('items', 'items');                      // 別排在 cats 後面,兩個沒有先後關係
  S.cats = await cachedGet('cats', 'cats');
  return withData(main, 'items', 'items', {}, list => {
  S.items = list;
  if (S.cat && !S.cats.some(c => c.name === S.cat)) S.cat = '';
  main.innerHTML = `<div class="row"><div><div class="eyebrow">Items</div><h1>展品管理</h1><p class="sub">貴重品用「逐台編號」(每台一張 QR 標籤);道具、線材用「數量」。</p></div><span class="spacer"></span>
    <button class="btn" data-act="cats">分類管理</button><button class="btn" data-act="import">批次匯入</button><button class="btn" data-act="export">${ICON.dl}匯出</button><button class="btn brand" data-act="edit-item">${ICON.plus}新增展品</button></div>
    <div class="toolbar"><input class="grow" type="search" id="iq" placeholder="搜尋…" value="${esc(S.itemQ)}"><label class="chk"><input type="checkbox" id="iarc" ${S.showArchived ? 'checked' : ''}>顯示已下架</label></div>
    <div id="ibar" class="catbar-stick"></div>
    <div class="tbl-wrap"><table><thead><tr><th>編號</th><th>品名</th><th>方式</th><th class="num">總數</th><th class="num">在庫</th><th class="num">借出</th><th class="num">預約</th><th>存放位置</th><th>最後盤點</th><th></th></tr></thead><tbody id="ibody"></tbody></table></div>`;
  const row = i => { const dist = distLine(i, 'total'); return `
    <tr class="${i.archived ? 'dim' : ''}"><td class="mono">${esc(i.id)}</td><td>${esc(i.name)}</td><td>${i.mode === 'unit' ? '<span class="pill unit">逐台</span>' : '<span class="pill">數量</span>'}</td>
    <td class="num">${i.total}</td><td class="num"><span class="chipnum ${i.inStock ? '' : 'zero'}">${i.inStock}</span></td><td class="num">${i.out}</td><td class="num">${i.reserved}</td><td>${dist}</td><td>${esc(i.countedAt || '—')}</td>
    <td><div class="row" style="gap:4px;flex-wrap:nowrap">${i.mode === 'unit' ? `<button class="btn sm" data-act="units" data-id="${i.id}">單台 / QR</button>` : ''}<button class="btn sm" data-act="edit-item" data-id="${i.id}">編輯</button>
    <button class="btn sm ghost" data-act="archive" data-id="${i.id}" data-on="${i.archived ? '0' : '1'}">${i.archived ? '上架' : '下架'}</button></div></td></tr>`; };
  const draw = () => {
    const q = S.itemQ.toLowerCase();
    const shown = list.filter(i => (S.showArchived || !i.archived) && (!q || [i.id, i.name, i.category, i.location, i.spec, (i.sites || []).map(g => g.location).join(' ')].join(' ').toLowerCase().includes(q)));
    const counts = {};
    shown.forEach(i => counts[i.category] = (counts[i.category] || 0) + 1);
    $('#ibar').innerHTML = catBar(S.cats, S.cat, counts);
    const sect = (name, arr) => `<tr class="grouph"><th colspan="10">${esc(name)}<span class="chipnum">${arr.length}</span>
      <button class="btn sm ghost" data-act="edit-item" data-cat="${esc(name)}">${ICON.plus}加到這一類</button></th></tr>` +
      (arr.length ? arr.map(row).join('') : '<tr class="groupe"><td colspan="10">這個分類還沒有展品</td></tr>');
    $('#ibody').innerHTML = S.cat ? (shown.filter(i => i.category === S.cat).map(row).join('') || '<tr><td colspan="10" class="empty">這個分類還沒有展品</td></tr>')
      : groupByCat(S.cats, shown).map(([name, arr]) => sect(name, arr)).join('');
  };
  draw();
  S._itemDraw = draw;
  $('#iq').oninput = e => { S.itemQ = e.target.value; draw(); };
  $('#iarc').onchange = e => { S.showArchived = e.target.checked; draw(); };
  }, gen);
};

/** 分類管理:新增、改名、調順序、停用 */
async function catsModal() {
  let list = await api('allCats');
  const m = openModal('<h2>分類管理</h2><div id="cmb"></div>');
  const draw = () => {
    $('#cmb', m).innerHTML = `<p class="sub">展品目錄與展品管理都照這個順序分段顯示。還沒放東西的分類也會留著,方便看出還缺什麼。</p>
      <div class="tbl-wrap"><table><thead><tr><th>分類</th><th class="num">展品</th><th>順序</th><th></th></tr></thead><tbody>
      ${list.map((c, i) => `<tr class="${c.archived ? 'dim' : ''}">
        <td><input type="text" data-cn="${c.id}" value="${esc(c.name)}" style="width:100%"></td>
        <td class="num">${c.count}</td>
        <td><div class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn sm ghost" data-mv="${c.id}" data-d="-1" ${i === 0 ? 'disabled' : ''}>↑</button><button class="btn sm ghost" data-mv="${c.id}" data-d="1" ${i === list.length - 1 ? 'disabled' : ''}>↓</button></div></td>
        <td><div class="row" style="gap:4px;flex-wrap:nowrap"><button class="btn sm" data-rn="${c.id}">改名</button>
        <button class="btn sm ghost" data-ar="${c.id}" data-on="${c.archived ? '0' : '1'}">${c.archived ? '啟用' : '停用'}</button></div></td></tr>`).join('')}
      </tbody></table></div>
      <div class="toolbar" style="margin-top:12px"><input class="grow" type="text" id="cnew" placeholder="新分類名稱…" maxlength="40"><button class="btn brand" id="cadd">${ICON.plus}新增分類</button></div>
      <div class="modal-f"><button type="button" class="btn pri" data-act="close-render">完成</button></div>`;
    const go = (fn) => run(fn).then(r => { list = r; draw(); }).catch(() => { });
    $$('[data-mv]', m).forEach(b => b.onclick = () => go(() => api('moveCat', { id: b.dataset.mv, dir: +b.dataset.d })));
    $$('[data-ar]', m).forEach(b => b.onclick = () => go(() => api('saveCat', { cat: { id: b.dataset.ar, archived: b.dataset.on === '1' } })));
    $$('[data-rn]', m).forEach(b => b.onclick = () => {
      const inp = $(`[data-cn="${b.dataset.rn}"]`, m);
      go(() => api('saveCat', { cat: { id: b.dataset.rn, name: inp.value } }));
    });
    const add = () => { const v = $('#cnew', m).value.trim(); if (v) go(() => api('saveCat', { cat: { name: v } })); };
    $('#cadd', m).onclick = add;
    $('#cnew', m).onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
  };
  draw();
}

/** 一列「在誰手上・什麼活動・什麼時候還」 */
function holderLine(code, h, qty) {
  const who = esc(h.applicant) + (h.dept ? '・' + esc(h.dept) : '');
  const late = h.overdue ? '<span class="pill bad">逾期</span>' : '';
  return '<div class="line"><span class="nm mono">' + esc(code) + '</span><span>' + who + '</span>'
    + '<span class="meta">' + esc(h.event) + '・還 ' + esc(h.end) + '</span>'
    + (qty ? '<span class="q">× ' + qty + '</span>' : '') + late + '</div>';
}

/** 借出中的單台:列出在誰手上、什麼活動、什麼時候還 */
function outUnitLines(us) {
  if (!us.length) return '';
  const rows = us.map(u => u.holder ? holderLine(u.id, u.holder, 0)
    : '<div class="line"><span class="nm mono">' + esc(u.id) + '</span><span class="meta">借出中(查無借用單)</span></div>');
  return '<div class="outbox"><div class="meta">借出中 ' + us.length + ' 台(不列入本次盤點)</div><div class="lines">' + rows.join('') + '</div></div>';
}

/** 數量品項:點「借出中」的數字看是誰借走的 */
function outWhoModal(key) {
  const itemId = String(key).split('@')[0], where = String(key).split('@')[1] || '';
  const it = (S.items || []).find(x => x.id === itemId) || {};
  const hs = (S._holders || {})[key] || [];
  const rows = hs.map(h => holderLine(h.loanId, h, h.qty)).join('');
  openModal('<h2>' + esc(it.name || itemId) + (where ? '(' + esc(where) + ')' : '') + '・借出中</h2>'
    + '<p class="sub">這些不列入盤點,實點時不用把它們算進去。</p>'
    + (rows ? '<div class="lines">' + rows + '</div>' : '<div class="card empty">查無借用中的紀錄</div>')
    + '<div class="modal-f"><button class="btn pri" data-act="close">關閉</button></div>');
}

VIEWS.count = async main => {
  const [cats, items, allUnits, outLoans] = await Promise.all([
    cachedGet('cats', 'cats'), cachedGet('items', 'items'), cachedGet('units|all', 'units'),
    cachedGet('loans|out', 'loans', { filter: 'out' })
  ]);
  S.cats = cats;
  // 誰把東西借走了:數量品項沒有單台編號,只能從出借中的借用單推回來
  const holders = {};
  outLoans.forEach(L => (L.lines || []).forEach(ln => {
    const left = ln.outstanding == null ? ln.qty : ln.outstanding;
    if (!left) return;
    const rec = { loanId: L.id, applicant: L.applicant, dept: L.dept, event: L.event, end: L.end, overdue: L.overdue, qty: left };
    (holders[lkey(ln)] = holders[lkey(ln)] || []).push(rec);
  }));
  S._holders = holders;
  const all = items.filter(i => !i.archived);
  const unitsBy = {};
  all.forEach(i => unitsBy[i.id] = []);
  allUnits.forEach(u => { if (unitsBy[u.itemId]) unitsBy[u.itemId].push(u); });
  // 盤點是一個廠區一個廠區盤的,所以一列 = 一個展品在一個地點
  const sites = [...new Set(all.flatMap(i => (i.sites || []).map(g => nloc(g.location))))].sort();
  if (S.site && !sites.includes(S.site)) S.site = '';
  const rowsOf = i => (i.sites || []).map(g => nloc(g.location)).filter(L => !S.site || L === S.site);
  const list = all.filter(i => rowsOf(i).length);
  const K = (i, L) => i.id + '@' + L;
  const inUnits = (i, L) => unitsBy[i.id].filter(u => u.status === 'in' && nloc(u.location) === L);
  const outUnits = (i, L) => unitsBy[i.id].filter(u => u.status === 'out' && nloc(u.location) === L);
  const siteOf = (i, L) => (i.sites || []).find(g => nloc(g.location) === L) || { total: 0, inStock: 0, out: 0 };
  const expect = (i, L) => i.mode === 'unit' ? inUnits(i, L).length : siteOf(i, L).inStock;   // 應在庫
  const seen = new Set(), scope = new Set(), counted = {};                 // 切分類重畫時要保留
  if (S.cat && !cats.some(c => c.name === S.cat)) S.cat = '';

  main.innerHTML = `<div class="eyebrow">Stocktake</div><h1>盤點</h1>
    <p class="sub" id="ksub2">先選你要盤的廠區,畫面只會列出那一區該有的東西,差異也只算那一區。「應在庫」已扣除借出中的數量;未填 / 未勾選的不列入本次盤點。</p>
    <div class="kpis" id="ksum"></div>
    <div class="meta" id="ksub" style="margin:-4px 0 10px"></div>
    <div class="card" style="margin:14px 0"><div class="row"><input class="grow" type="text" id="kscan" placeholder="輸入或用掃描槍刷編號後按 Enter(例:E0001)" style="flex:1 1 240px"><button class="btn" data-act="count-cam">${ICON.scan}相機掃描</button></div><div class="meta" id="klast" style="margin-top:6px"></div></div>
    <div class="catbar-stick" id="kbars"><div class="catbar" id="ksite"></div><div id="kbar"></div></div>
    <div id="kbody"></div>
    <div class="card" style="margin-top:14px"><div class="row"><label class="chk"><input type="checkbox" id="kapply" checked>把差異套用到系統數量</label><label class="chk"><input type="checkbox" id="klost">未點到的單台標記為「遺失」</label><span class="spacer"></span><button class="btn pri" data-act="count-submit">完成盤點</button></div></div>`;

  /* ---- 總計對照:只算「已納入本次盤點」的品項 ---- */
  const drawSum = () => {
    let exp = 0, got = 0, done = 0, todo = 0, out = 0, total = 0;
    list.forEach(i => rowsOf(i).forEach(L => {
      total++;
      const k = K(i, L);
      out += i.mode === 'unit' ? outUnits(i, L).length : siteOf(i, L).out;
      const inScope = i.mode === 'unit' ? scope.has(k) : counted[k] != null;
      if (!inScope) { todo++; return; }
      done++;
      exp += expect(i, L);
      got += i.mode === 'unit' ? inUnits(i, L).concat(unitsBy[i.id].filter(u => u.status === 'lost' && nloc(u.location) === L)).filter(u => seen.has(u.id)).length : counted[k];
    }));
    const diff = got - exp;
    $('#ksum').innerHTML = [
      kpi(ICON.layers, '已盤 / 全部品項', done + ' / ' + total),
      kpi(ICON.home, '應在庫(已盤部分)', exp),
      kpi(ICON.check, '實際點到', got),
      kpi(ICON.alert, '差異', (diff > 0 ? '+' : '') + diff, diff ? 'bad' : ''),
      kpi(ICON.out, '借出中(不用盤)', out)
    ].join('');
    $('#ksub') && ($('#ksub').textContent = todo ? '還有 ' + todo + ' 項沒盤' : '全部盤完了');
    $('#ksite').innerHTML = ['<span class="catchip' + (S.site ? '' : ' on') + '" data-site="">全部廠區</span>']
      .concat(sites.map(v => '<span class="catchip' + (S.site === v ? ' on' : '') + '" data-site="' + esc(v) + '">' + esc(v) + '</span>')).join('');
    $$('[data-site]').forEach(el => el.onclick = () => { S.site = el.dataset.site; seen.clear(); scope.clear(); Object.keys(counted).forEach(k => delete counted[k]); draw(); });
  };

  /* ---- 依分類分段 ---- */
  const unitCard = (i, L) => {
    const k = esc(K(i, L));
    const ins = inUnits(i, L), lost = unitsBy[i.id].filter(u => u.status === 'lost' && nloc(u.location) === L);
    const pick = ins.concat(lost);
    const chips = pick.map(u => `<span class="chipk ${seen.has(u.id) ? 'on' : ''}" data-unit="${esc(u.id)}" data-item="${k}">${esc(u.id)}${u.status === 'lost' ? ' <small>遺失</small>' : ''}</span>`);
    return `<div class="card"><div class="row"><b style="flex:1">${esc(i.name)} <span class="pill">${esc(L)}</span></b><label class="chk"><input type="checkbox" data-scope="${k}" ${scope.has(K(i, L)) ? 'checked' : ''}>納入盤點</label></div>
      <div class="meta">應在庫 <b>${ins.length}</b> 台・<span data-cnt="${k}"></span>・<span data-udiff="${k}"></span></div>
      <div class="chips">${chips.join('') || '<span class="meta">這一區沒有應在庫的單台</span>'}</div>
      ${outUnitLines(outUnits(i, L))}</div>`;
  };
  const qtyTable = qs => qs.length ? `<div class="tbl-wrap"><table><thead><tr><th>品名</th><th>存放位置</th><th class="num">應在庫</th><th class="num">借出中</th><th class="num" style="width:120px">實點</th><th class="num">差異</th></tr></thead><tbody>
    ${qs.map(([i, L]) => { const k = esc(K(i, L)), g = siteOf(i, L); return `<tr><td>${esc(i.name)}</td><td>${esc(L)}</td><td class="num">${g.inStock}</td><td class="num">${g.out ? '<button class="btn sm ghost" data-act="out-who" data-id="' + k + '">' + g.out + ' 台</button>' : '—'}</td>
      <td><input type="number" min="0" data-cnt-qty="${k}" data-exp="${g.inStock}" value="${counted[K(i, L)] == null ? '' : counted[K(i, L)]}" style="text-align:right"></td>
      <td class="num" data-diff="${k}">—</td></tr>`; }).join('')}</tbody></table></div>` : '';

  const draw = () => {
    const counts = {};
    list.forEach(i => counts[i.category] = (counts[i.category] || 0) + 1);
    $('#kbar').innerHTML = catBar(cats, S.cat, counts);
    const groups = S.cat ? [[S.cat, list.filter(i => i.category === S.cat)]] : groupByCat(cats, list);
    $('#kbody').innerHTML = groups.map(([name, arr]) => {
      const pairs = arr.flatMap(i => rowsOf(i).map(L => [i, L]));
      const us = pairs.filter(([i]) => i.mode === 'unit'), qs = pairs.filter(([i]) => i.mode === 'qty');
      const body = pairs.length
        ? (us.length ? `<div class="cards" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">${us.map(([i, L]) => unitCard(i, L)).join('')}</div>` : '') + qtyTable(qs)
        : '<div class="catempty">這個分類在這一區沒有展品</div>';
      return `<h2 class="cath">${esc(name)}<span class="chipnum">${pairs.length}</span></h2>` + body;
    }).join('');
    wire();
    list.forEach(i => rowsOf(i).forEach(L => { if (i.mode === 'unit') syncUnit(K(i, L)); else syncQty(K(i, L)); }));
    drawSum();
  };
  S._countDraw = draw;

  /* ---- 即時同步單一品項的數字 ---- */
  const split = k => { const j = String(k).indexOf('@'); return [String(k).slice(0, j), String(k).slice(j + 1)]; };
  const syncUnit = k => {
    const c = $(`[data-cnt="${k}"]`), d = $(`[data-udiff="${k}"]`);
    if (!c) return;
    const [id, L] = split(k), i = list.find(x => x.id === id);
    if (!i) return;
    const got = unitsBy[id].filter(u => nloc(u.location) === L && seen.has(u.id)).length, exp = inUnits(i, L).length;
    c.textContent = '點到 ' + got;
    if (!scope.has(k)) { d.textContent = '尚未納入盤點'; d.className = 'meta'; return; }
    const v = got - exp;
    d.textContent = v ? '差異 ' + (v > 0 ? '+' : '') + v : '相符';
    d.className = v ? 'short' : 'okt';
  };
  const syncQty = k => {
    const d = $(`[data-diff="${k}"]`);
    if (!d) return;
    if (counted[k] == null) { d.textContent = '—'; d.className = 'num'; return; }
    const [id, L] = split(k), i = list.find(x => x.id === id);
    const v = counted[k] - (i ? siteOf(i, L).inStock : 0);
    d.textContent = v ? (v > 0 ? '+' : '') + v : '0';
    d.className = 'num ' + (v ? 'short' : 'okt');
  };

  const markUnit = (id, on) => {
    const el = $(`[data-unit="${id}"]`);
    if (!el) return false;
    on = on == null ? !seen.has(id) : on;
    on ? seen.add(id) : seen.delete(id);
    el.classList.toggle('on', on);
    const it = el.dataset.item;
    scope.add(it);
    const box = $(`[data-scope="${it}"]`); if (box) box.checked = true;
    syncUnit(it); drawSum();
    return true;
  };
  S._countMark = code => {
    const el = $(`[data-unit="${code}"]`);
    if (!el && S.site) { $('#klast').textContent = '✕ ' + code + ' 不在目前盤的廠區「' + S.site + '」,請切到「全部廠區」或到那一區盤'; return false; }
    if (!el && S.cat) { $('#klast').textContent = '✕ ' + code + ' 不在目前的分類「' + S.cat + '」裡,請先切到「全部」'; return false; }
    const ok = markUnit(code, true);
    $('#klast').textContent = ok ? '✓ ' + code : '✕ 找不到或不在應在庫清單:' + code;
    return ok;
  };

  function wire() {
    $$('[data-unit]').forEach(el => el.onclick = () => markUnit(el.dataset.unit));
    $$('[data-scope]').forEach(el => el.onchange = () => {
      el.checked ? scope.add(el.dataset.scope) : scope.delete(el.dataset.scope);
      syncUnit(el.dataset.scope); drawSum();
    });
    $$('[data-cnt-qty]').forEach(inp => inp.oninput = () => {
      const id = inp.dataset.cntQty;
      counted[id] = inp.value === '' ? null : +inp.value;
      if (counted[id] == null) delete counted[id];
      syncQty(id); drawSum();
    });
  }
  $('#kscan').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); S._countMark(e.target.value.trim().toUpperCase()); e.target.value = ''; } };

  S._countSubmit = async () => {
    const qty = Object.keys(counted).map(k => { const [id, L] = split(k); return { itemId: id, location: L, counted: counted[k] }; });
    const unitItems = [...new Set([...scope].map(k => split(k)[0]))];
    if (!qty.length && !unitItems.length) return toast('請至少填寫或勾選一項', true);
    const rep = await run(() => api('stocktake', { location: S.site || '', qty, unitItems, seenUnits: [...seen], apply: $('#kapply').checked, markMissingLost: $('#klost').checked })).catch(() => null);
    if (!rep) return;
    const diffs = rep.qty.filter(x => x.diff);
    openModal(`<h2>盤點結果</h2>
      <div class="banner ${diffs.length || rep.missingUnits.length ? 'warn' : 'ok'}">${rep.location ? esc(rep.location) + ':' : ''}數量品項 ${rep.qty.length} 項,差異 ${diffs.length} 項;逐台點到 ${rep.seenUnits} 台,未點到 ${rep.missingUnits.length} 台。${rep.adjusted ? '已套用 ' + rep.adjusted + ' 筆調整。' : ''}</div>
      ${diffs.length ? `<h2>數量差異</h2><div class="lines">${diffs.map(x => `<div class="line"><span class="nm">${esc(x.name)}<br><span class="meta">${esc(x.location || '')}</span></span><span class="q">系統 ${x.expected} → 實點 ${x.counted}(${x.diff > 0 ? '+' : ''}${x.diff})</span></div>`).join('')}</div>` : ''}
      ${rep.missingUnits.length ? `<h2>未點到的單台</h2><div class="lines">${rep.missingUnits.map(u => `<div class="line"><span class="nm mono">${esc(u.id)}</span><span>${esc(u.name)} <span class="meta">${esc(u.location || '')}</span></span><span class="u">${u.history[0] ? '最後借用:' + esc(u.history[0].applicant) + '・' + esc(u.history[0].event) + '(' + esc(u.history[0].end) + ')' : '無借用紀錄'}</span></div>`).join('')}</div>` : ''}
      <div class="modal-f"><button class="btn pri" data-act="close-render">完成</button></div>`, { noFocus: true });
  };

  draw();
};

