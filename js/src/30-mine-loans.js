VIEWS.mine = main => withData(main, 'mine', 'myLoans', {}, list => {
  S._loans = list;
  const act = list.filter(l => ['pending', 'approved', 'out'].includes(l.status)), past = list.filter(l => !act.includes(l));
  main.innerHTML = `<div class="eyebrow">My Loans</div><h1>我的借用</h1><p class="sub">申請進度、借用中的展品與歸還日。</p>
    ${act.some(l => l.overdue) ? '<div class="banner bad">你有逾期未歸還的展品,請儘速歸還。</div>' : ''}
    <h2>進行中(${act.length})</h2><div class="loans">${act.map(l => loanCard(l, { mine: true })).join('') || '<div class="card empty">目前沒有進行中的借用</div>'}</div>
    <h2>歷史紀錄</h2><div class="loans">${past.map(l => loanCard(l, { mine: true })).join('') || '<div class="card empty">尚無紀錄</div>'}</div>`;
});

/** 今天要做的事:把散在各頁的待辦收成一張清單 */
function todoList(d) {
  const G = [
    ['逾期未還', d.overdue, 'bad', 'overdue', '催回來'],
    ['等待確認', d.requests, 'pending', 'request', '去確認'],
    ['待審核', d.pending, 'pending', 'pending', '去審核'],
    ['今天要點交', d.pickups.filter(l => l.start <= d.today), 'approved', 'approved', '去點交'],
    ['今天到期', d.dueSoon.filter(l => l.end === d.today), 'out', 'out', '去登記歸還'],
    // 離職交接最容易掉東西的地方:帳號停用了,東西還在他手上。停用本身不擋,但這件事要被看見。
    ['已停用還沒還', d.leftBehind || [], 'bad', 'active', '去追回來']
  ].filter(g => g[1].length);
  if (!G.length) return '<div class="card ok-empty">今天沒有待辦事項 👍</div>';
  const rows = G.map(([label, arr, pill, filter, cta]) =>
    '<div class="todo-row"><span class="pill ' + pill + '">' + esc(label) + '</span>'
    + '<b>' + arr.length + '</b><span class="meta">' + esc(arr.slice(0, 3).map(l => l.id + ' ' + l.event).join('、')) + (arr.length > 3 ? ' …' : '') + '</span>'
    + '<span class="spacer"></span><button class="btn sm" data-act="go-loans" data-f="' + filter + '">' + esc(cta) + '</button></div>').join('');
  return '<div class="card todo"><h2 style="margin-top:0">今天要做的事</h2>' + rows + '</div>';
}

VIEWS.dash = main => withData(main, 'dash', 'dashboard', {}, d => {
  S._loans = [].concat(d.pending, d.overdue, d.dueSoon, d.requests, d.pickups);
  const s = d.sum;
  main.innerHTML = `<div class="row"><div><div class="eyebrow">Inventory &amp; Loans</div><h1>展品借用與庫存追蹤</h1><p class="sub">${esc(d.today)}・主管問「還有幾個」,看這裡或匯出庫存表。</p></div><span class="spacer"></span><button class="btn" data-act="export">${ICON.dl}匯出庫存表</button></div>
    <div class="kpis">
      ${kpi(ICON.layers, '展品品項', s.items, 'sitekpi', 'site-break', 'items')}
      ${kpi(ICON.cube, '總件數', s.total, 'sitekpi', 'site-break', 'total')}
      ${kpi(ICON.home, '倉庫在庫', s.inStock, 'sitekpi', 'site-break', 'inStock')}
      ${kpi(ICON.out, '出借中', s.out)}
      ${kpi(ICON.clock, '待審核', d.pending.length, d.pending.length ? 'warn' : '', 'go-loans', 'pending')}
      ${kpi(ICON.alert, '逾期未還', d.overdue.length, d.overdue.length ? 'bad' : '', 'go-loans', 'overdue')}
      ${kpi(ICON.check, '待確認簽收/歸還', d.requests.length, d.requests.length ? 'warn' : '', 'go-loans', 'request')}
      ${kpi(ICON.wrench, '維修 / 遺失', s.repair + ' / ' + s.lost)}
    </div>
    <div id="sitebreak"></div>
    <div id="todo"></div>
    <div class="cols" style="margin-top:14px">
      <div class="card"><h2 style="margin-top:0">逾期未還</h2>${d.overdue.map(l => miniRow(l, `<span class="pill bad">逾期 ${l.overdueDays} 天</span>`)).join('') || '<div class="empty">沒有逾期,很好</div>'}</div>
      <div class="card"><h2 style="margin-top:0">待審核</h2>${d.pending.map(l => miniRow(l)).join('') || '<div class="empty">沒有待審核的申請</div>'}</div>
      <div class="card"><h2 style="margin-top:0">3 天內要點交</h2>${d.pickups.map(l => miniRow(l, `<span class="pill approved">${fmtD(l.start)} 領</span>`)).join('') || '<div class="empty">無</div>'}</div>
      <div class="card"><h2 style="margin-top:0">3 天內到期</h2>${d.dueSoon.map(l => miniRow(l, `<span class="pill out">${fmtD(l.end)} 還</span>`)).join('') || '<div class="empty">無</div>'}</div>
    </div>
    ${d.lowStock.length ? `<div class="card" style="margin-top:14px"><h2 style="margin-top:0">倉庫已無在庫</h2><div class="chips">${d.lowStock.map(i => `<span class="pill bad">${esc(i.name)}(${i.out}/${i.total} 借出)</span>`).join('')}</div></div>` : ''}`;
  $('#todo').innerHTML = todoList(d);
  drawSiteBreak();
});

/**
 * 總覽的「展品品項 / 總件數 / 倉庫在庫」點下去,展開各廠區的數字。
 * 資料用現成的 `items` 路由(它每一項都帶 sites[],各廠區的數字後端已經算好),
 * **展開時才要**,所以總覽第一次開還是一趟。前端只做加總,不重算任何庫存規則。
 * ⚠️ 要跟磚塊上的數字對得起來,就得跟後端 dashboard 一樣**排除已下架的展品**。
 */
/**
 * 展開的內容要接在**被點到的那塊磚**後面。
 * 手機上一排只放得下一塊磚,展開的表格如果固定放在八塊磚之後,
 * 使用者點了箭頭還得往下捲很久才看得到(2026-09-27 回報)。
 * 收起的時候把空的容器移回格線外面,不然它會在格線裡佔一格、多出一段空白。
 */
function siteBreakBox() {
  const box = $('#sitebreak');
  if (!box) return null;
  const brick = S.dashSite ? $('.kpi.sitekpi.open') : null;
  const grid = $('.kpis');
  if (brick) { if (brick.nextElementSibling !== box) brick.after(box); }
  else if (grid && box.parentElement === grid) grid.after(box);
  return box;
}

async function drawSiteBreak() {
  const want = S.dashSite;
  // 哪一塊磚被展開了,要看得出來(箭頭轉向)
  $$('.kpi.sitekpi').forEach(el => el.classList.toggle('open', !!want && el.dataset.f === want));
  const slot = siteBreakBox;
  if (!slot()) return;
  if (!want) { slot().innerHTML = ''; return; }
  slot().innerHTML = '<div class="card"><div class="meta">載入各廠區數字…</div></div>';
  const list = await cachedGet('items', 'items').catch(() => null);
  /**
   * ⚠️ 等待期間總覽可能已經背景重畫過(withData 是「先畫快取、再更新」),
   * 原本那個 #sitebreak 節點早就不在畫面上了。抓著舊參照寫 innerHTML =
   * 寫進一個沒人看得到的節點 → 使用者按了箭頭什麼都沒發生,而且完全沒有錯誤訊息。
   * 所以這裡**重新抓一次**,不要沿用 await 之前的節點。
   */
  const box = slot();
  if (!box || S.dashSite !== want) return;      // 已經離開總覽,或使用者又點了別塊磚
  if (!list) { box.innerHTML = '<div class="card"><div class="banner bad">讀不到展品資料,請重新整理</div></div>'; return; }
  const live = list.filter(i => !i.archived);
  const rows = {};
  live.forEach(i => (i.sites || []).forEach(g => {
    const L = nloc(g.location);
    const r = rows[L] || (rows[L] = { items: 0, total: 0, inStock: 0, out: 0 });
    r.items++; r.total += Number(g.total) || 0; r.inStock += Number(g.inStock) || 0; r.out += Number(g.out) || 0;
  }));
  const names = Object.keys(rows).sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  const sum = names.reduce((a, L) => ({ items: a.items + rows[L].items, total: a.total + rows[L].total,
    inStock: a.inStock + rows[L].inStock, out: a.out + rows[L].out }), { items: 0, total: 0, inStock: 0, out: 0 });
  // 合計的「品項」要算不重複的展品數(同一項放兩區會被數兩次)
  sum.items = live.filter(i => (i.sites || []).length).length;
  const HEAD = { items: '展品品項', total: '總件數', inStock: '倉庫在庫' };
  box.innerHTML = `<div class="card sitebreak">
    <div class="row"><b>各廠區的${esc(HEAD[want] || '數字')}</b>
      <span class="meta">點廠區可以跳到展品目錄,那邊已經幫你篩好</span>
      <span class="spacer"></span><button class="btn sm ghost" data-act="site-break" data-f="">收起</button></div>
    <div class="tbl-wrap" style="margin-top:10px"><table><thead><tr><th>廠區</th><th class="num">品項</th><th class="num">件數</th><th class="num">在庫</th><th class="num">出借中</th></tr></thead><tbody>
      ${names.map(L => `<tr><td><button class="btn sm ghost" data-act="site-go" data-loc="${esc(L)}">${esc(L)}</button></td>
        <td class="num">${rows[L].items}</td><td class="num">${rows[L].total}</td>
        <td class="num"><span class="chipnum ${rows[L].inStock ? '' : 'zero'}">${rows[L].inStock}</span></td>
        <td class="num">${rows[L].out}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">還沒有展品</td></tr>'}
    </tbody><tfoot><tr class="sumrow"><th>合計</th><th class="num">${sum.items}</th><th class="num">${sum.total}</th><th class="num">${sum.inStock}</th><th class="num">${sum.out}</th></tr></tfoot></table></div>
  </div>`;
}

/* 進行中的五個分頁都是同一批資料的子集合:向後端要一次「active」,分頁在前端切,點分頁不再等後端 */
const LOAN_HIST = { returned: 1, all: 1, rejected: 1, cancelled: 1 };
const loanSrv = f => LOAN_HIST[f] ? f : 'active';
const loanTabOf = {
  request: l => !!(l.request && l.request.type),
  pending: l => l.status === 'pending',
  approved: l => l.status === 'approved',
  out: l => l.status === 'out',
  overdue: l => !!l.overdue
};
VIEWS.loans = main => {
  const srv = loanSrv(S.loanFilter);
  // 歷史表預設不讀 —— 讀了就等於沒搬。只有在翻舊單的分頁、而且使用者自己勾了才帶
  const hist = !!(LOAN_HIST[srv] && S.loanHist);
  return withData(main, 'loans|' + srv + (hist ? '|h' : ''), 'loans', { filter: srv, includeHistory: hist }, all => {
  if (loanSrv(S.loanFilter) !== srv || !!(LOAN_HIST[loanSrv(S.loanFilter)] && S.loanHist) !== hist) return;   // 使用者已經切走了
  const pick = loanTabOf[S.loanFilter];
  const list = pick ? all.filter(pick) : all;
  S._loans = all;
  const F = [['request', '待確認'], ['pending', '待審核'], ['approved', '待點交'], ['out', '出借中'], ['overdue', '逾期'], ['returned', '已歸還'], ['all', '全部']];
  main.innerHTML = `<div class="row"><div><div class="eyebrow">Loans</div><h1>借用單</h1><p class="sub">審核 → 點交出借 → 登記歸還。口頭借用請從「借用申請」代為登記。</p></div><span class="spacer"></span><button class="btn brand" data-act="go" data-v="catalog">${ICON.plus}代為登記</button></div>
    <div class="toolbar"><div class="seg">${F.map(([k, l]) => {
      const n = loanTabOf[k] ? all.filter(loanTabOf[k]).length : (k === 'all' || k === 'returned' ? null : all.length);
      return `<button class="${S.loanFilter === k ? 'on' : ''}" data-act="lf" data-f="${k}">${l}${n ? ` <span class="n">${n}</span>` : ''}</button>`;
    }).join('')}</div>
    <input class="grow" type="search" id="lq" placeholder="搜尋單號、借用人、活動…">
    ${LOAN_HIST[srv] ? `<label class="chk"><input type="checkbox" id="lhist" ${S.loanHist ? 'checked' : ''}>含歷史資料</label>` : ''}
    <button class="btn sm ghost" data-act="arch-open">整理歷史</button></div>
    ${hist ? '<div class="banner info">已含封存到歷史工作表的舊單(標示「已封存」的那些)。查完建議取消勾選,平常翻單會比較快。</div>' : ''}
    <div id="lbulk"></div>
    <div class="loans" id="llist"></div>`;
  const sel = new Set();
  const bulk = () => {
    const pend = list.filter(l => l.status === 'pending');
    $('#lbulk').innerHTML = pend.length < 2 ? '' :
      `<div class="card bulkbar"><label class="chk"><input type="checkbox" id="lall" ${sel.size === pend.length ? 'checked' : ''}>全選待審核(${pend.length} 張)</label>
        <span class="spacer"></span><span class="meta">已選 ${sel.size} 張</span>
        <button class="btn brand" id="lgo" ${sel.size ? '' : 'disabled'}>批次核准</button></div>`;
    if (!pend.length || pend.length < 2) return;
    $('#lall').onchange = e => { sel.clear(); if (e.target.checked) pend.forEach(l => sel.add(l.id)); draw($('#lq').value); };
    $('#lgo').onclick = () => bulkApprove([...sel]);
  };
  const draw = q => {
    q = (q || '').toLowerCase();
    const f = list.filter(l => !q || [l.id, l.applicant, l.dept, l.event, l.venue].concat(l.lines.map(x => x.name)).join(' ').toLowerCase().includes(q));
    /**
     * 封存過的舊單預設收起來。勾了「含歷史資料」之後,一兩百張舊單會跟現行的混在一起,
     * 要找的那張反而被淹掉(2026-10-01 回報)。現行的照舊直接列,歷史的收成一條,點開才展開。
     */
    const card = l => l.status === 'pending'
      ? `<div class="pickwrap"><label class="chk pickbox"><input type="checkbox" data-pl="${l.id}" ${sel.has(l.id) ? 'checked' : ''}>選取</label>${loanCard(l)}</div>`
      : loanCard(l);
    const now = f.filter(l => !l.archived), old = f.filter(l => l.archived);
    const fold = old.length ? `<div class="card histfold ${S.histOpen ? 'open' : ''}">
      <button class="histbtn" data-act="hist-toggle">${S.histOpen ? '收起' : '展開'}歷史單<span class="chipnum">${old.length}</span>
        <span class="meta">已封存到歷史工作表的舊單</span></button></div>` : '';
    const body = now.map(card).join('');
    $('#llist').innerHTML = (body || (old.length ? '' : '<div class="card empty">沒有符合的借用單</div>'))
      + fold + (S.histOpen ? old.map(card).join('') : '');
    $$('[data-pl]').forEach(el => el.onchange = () => { el.checked ? sel.add(el.dataset.pl) : sel.delete(el.dataset.pl); bulk(); });
    bulk();
  };
  draw(); $('#lq').oninput = e => draw(e.target.value);
  if ($('#lhist')) $('#lhist').onchange = e => { S.loanHist = e.target.checked; render(); };
  if (S._focusLoan) { const el = $('#loan-' + S._focusLoan); if (el) { el.scrollIntoView({ block: 'center' }); el.style.outline = '2px solid var(--red)'; } S._focusLoan = null; }
  });
};
