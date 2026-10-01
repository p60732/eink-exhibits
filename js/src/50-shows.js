/* ===================== 展覽檔期(管理者) =====================
 * 一場展覽 = 一個專案,底下掛多張借用單。
 * 「已確認」的展覽會先把還沒開單的部分卡住,避免同期的另一場把同一批東西借走。
 * 缺口、可借量一律以後端回傳為準,這裡只負責顯示與收集輸入。
 */
const SHOW_FILTERS = [['open', '進行中'], ['closed', '已結案'], ['cancelled', '已取消'], ['all', '全部']];

function showPill(v) {
  const cls = { draft: 'pending', confirmed: 'approved', closed: 'returned', cancelled: 'cancelled' }[v.status] || 'pending';
  return `<span class="pill ${cls}">${esc(v.statusLabel)}</span>`;
}
/** 一場展覽的摘要數字;缺口與檔期對不上都要一眼看得到 */
function showMeta(v) {
  const bits = [`${v.itemCount} 項 ${v.qtyTotal} 件`];
  if (v.issuedTotal) bits.push(`已開單 ${v.issuedTotal} 件`);
  const warn = [];
  if (v.shortTotal) warn.push(`<span class="short">缺 ${v.shortTotal} 件</span>`);
  if ((v.mismatch || []).length) warn.push(`<span class="short">${v.mismatch.length} 張單的日期與檔期不符</span>`);
  return `<span class="meta">${bits.join(' · ')}</span>` + (warn.length ? ' ' + warn.join(' ') : '');
}

VIEWS.shows = async main => {
  if (S.showId) return drawShow(main);
  return withData(main, 'shows|' + S.showFilter, 'shows', { filter: S.showFilter }, list => {
    main.innerHTML = `<div class="row"><div><div class="eyebrow">Shows</div><h1>展覽檔期</h1>
      <p class="sub">一場展覽底下可以掛好幾張借用單(各廠區一張)。確認檔期之後,還沒開單的部分會先幫你卡住。</p></div>
      <span class="spacer"></span><button class="btn brand" data-act="show-new">${ICON.plus}新增展覽</button></div>
      <div class="catbar">${SHOW_FILTERS.map(([k, l]) => `<button class="catchip ${S.showFilter === k ? 'on' : ''}" data-act="show-filter" data-f="${k}">${l}</button>`).join('')}</div>
      ${!list.length ? `<div class="card empty">這裡還沒有展覽。<br><br><button class="btn pri" data-act="show-new">新增第一場</button></div>`
        : list.map(v => `<div class="card loan" data-act="show-open" data-id="${esc(v.id)}" style="cursor:pointer">
        <div class="row"><b>${esc(v.name)}</b> ${showPill(v)}<span class="spacer"></span><span class="mono meta">${esc(v.id)}</span></div>
        <div class="meta">${fmtD(v.from)} ~ ${fmtD(v.to)}${v.venue ? ' · ' + esc(v.venue) : ''}${v.loanCount ? ' · ' + v.loanCount + ' 張借用單' : ''}</div>
        <div style="margin-top:6px">${showMeta(v)}</div></div>`).join('')}`;
  });
};

/** 編輯中的清單放在 S.showLines,存檔前都只是草稿 */
function showDraftLines() { return (S.showLines || []).map(l => ({ itemId: l.itemId, location: l.location, qty: l.qty, note: l.note || '' })); }
/** 退出挑選模式(展覽被刪、結案、取消,或挑完存檔之後都要收乾淨) */
function exitPick() { S.showPick = null; store.del(uk('showpick')); store.del(uk('showlines')); }
/** 挑選期間把清單也寫進 localStorage,重新整理不會白挑 */
function saveShowLines() { S.showLines = S.showLines || []; if (S.showPick) store.set(uk('showlines'), showDraftLines()); }

/**
 * 展後結算:規劃 / 實際借出 / 已歸還 / 未歸還 四欄對照。
 * 「未歸還」只是把數字攤開給人看,系統不會自己去改庫存 —— 追討是人的事,按一個鍵就扣庫存太危險。
 */
function settleCard(v, SE) {
  const T = SE.totals || {};
  const cell = (n, cls) => `<td class="num${cls && n ? ' ' + cls : ''}">${n || 0}</td>`;
  const rows = (SE.lines || []).map(r => `<tr>
      <td>${esc(r.name)}<br><span class="meta">${esc(r.location)}</span></td>
      ${cell(r.planned)}${cell(r.issued)}${cell(r.returned)}${cell(r.lost, 'short')}${cell(r.unreturned, 'short')}
      <td class="mono meta">${(r.loans || []).map(esc).join('<br>')}</td></tr>`).join('');
  const bad = (T.unreturned || 0) + (T.lost || 0);
  return `<div class="card" id="settle">
    <div class="row"><b>展後結算</b>
      ${SE.archived ? '<span class="pill">封存快照</span>' : ''}
      <span class="spacer"></span>
      <button class="btn sm" data-act="settle-csv">${ICON.dl}匯出清單</button></div>
    <div class="meta" style="margin:6px 0">${SE.archived
      ? '底下的借用單已經封存到歷史工作表,這裡顯示的是結案當下留下的數字。'
      : '即時計算。駁回與取消的單不算;已開單但還沒領走的另外列在「已開單」。'}</div>
    ${bad ? `<div class="banner bad"><b>還有 ${T.unreturned || 0} 件沒回來、${T.lost || 0} 件短少</b> —— 明細在下面,請自行追討;系統不會自動扣庫存。</div>`
      : `<div class="banner ok"><b>東西都回來了</b>,共 ${T.issued || 0} 件。</div>`}
    <div class="tbl-wrap"><table><thead><tr><th>展品</th><th class="num">規劃</th><th class="num">實際借出</th><th class="num">已歸還</th><th class="num">短少</th><th class="num">未歸還</th><th>借用單</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="empty">沒有資料</td></tr>'}
      <tr class="grouph"><th>合計</th><th class="num">${T.planned || 0}</th><th class="num">${T.issued || 0}</th><th class="num">${T.returned || 0}</th><th class="num">${T.lost || 0}</th><th class="num">${T.unreturned || 0}</th><th></th></tr></tbody></table></div>
    ${T.booked ? `<div class="meta" style="margin-top:8px">另有 ${T.booked} 件已開單但還沒領走。</div>` : ''}
  </div>`;
}

async function drawShow(main) {
  const isNew = S.showId === 'new';
  // 這一頁原本要排四趟(展覽 → 目錄 → 結算 → 缺口試算),約 7 秒。
  // 前三個彼此沒有先後關係,先一起丟出去。
  if (!isNew) warm('show|' + S.showId, 'show', { id: S.showId });
  warm('catalog|', 'catalog'); warm('users', 'users');
  let v;
  if (isNew) v = { id: '', name: '', from: '', to: '', venue: '', owner: '', note: '', status: 'draft', statusLabel: '規劃中', lines: [], loans: [], mismatch: [], loanCount: 0 };
  else {
    try { v = await cachedGet('show|' + S.showId, 'show', { id: S.showId }); }
    catch (e) {
      // 這一場可能已經被刪掉。沒有出口的錯誤畫面等於卡死,所以自己退回清單。
      exitPick();
      S.showId = null; S.showLines = null;
      main.innerHTML = `<div class="banner bad">${esc(e.message)}</div>
        <div class="card empty">這場展覽可能已經被刪除。<br><br><button class="btn pri" data-act="show-back">回展覽清單</button></div>`;
      return;
    }
  }
  if (S.showLines === null) S.showLines = v.lines.map(l => ({ itemId: l.itemId, location: l.location, qty: l.qty, note: l.note || '' }));
  S.items = await cachedGet('catalog|', 'catalog');
  const locked = v.status === 'closed' || v.status === 'cancelled';
  const live = (v.loans || []).filter(L => ['pending', 'approved', 'out'].includes(L.status));
  const outNow = (v.loans || []).filter(L => L.status === 'out');
  const wantSettle = !isNew && (v.archived || v.status === 'closed' || (v.loans || []).some(L => ['out', 'returned'].includes(L.status)));
  // 結算卡片在整頁最下面,不該擋住第一次繪製。先留一個位子,資料回來再填進去。
  S._settle = null;
  const settleP = wantSettle ? cachedGet('settle|' + v.id, 'showSettle', { id: v.id }).catch(() => null) : null;
  main.innerHTML = `<div class="row"><button class="btn sm ghost" data-act="show-back">← 回展覽清單</button><span class="spacer"></span>
      ${isNew ? '' : `<span class="mono meta">${esc(v.id)}</span> ${showPill(v)}`}</div>
    <h1>${isNew ? '新增展覽' : esc(v.name)}</h1>
    ${isNew ? `<p class="sub">先把檔期跟場地定下來。建立之後才會出現需求清單 —— 缺口要有檔期才算得出來。</p>` : ''}
    ${locked ? `<div class="banner info">${esc(v.statusLabel)}的展覽不能修改,也不再卡住庫存。要繼續編輯請先改回「${v.status === 'closed' ? '已確認' : '規劃中'}」。</div>` : ''}
    ${(v.mismatch || []).length ? `<div class="banner warn">有 ${v.mismatch.length} 張借用單的日期跟檔期不一樣(${v.mismatch.map(x => esc(x)).join('、')})。
      改檔期不會自動改單,確認要一起延的話請用下面的「批次延期」。</div>` : ''}
    <form class="card" id="shform">
      <label class="f"><span>展覽名稱 <b>*</b></span><input type="text" name="name" required maxlength="60" value="${esc(v.name)}"></label>
      <div class="grid2">
        <label class="f"><span>檔期開始 <b>*</b></span><input type="date" name="from" required ${DLIM()} value="${esc(v.from)}"></label>
        <label class="f"><span>檔期結束 <b>*</b></span><input type="date" name="to" required ${DLIM()} value="${esc(v.to)}"></label>
      </div>
      <div class="meta" style="margin:-4px 0 12px">檔期要把佈展與撤展的日子算進去 —— 卡位是用這個區間算的。對外的展出日期可以寫在備註。</div>
      <div class="grid2">
        <label class="f"><span>場地</span><input type="text" name="venue" value="${esc(v.venue)}"></label>
        <label class="f"><span>承辦人工號</span><input type="text" name="owner" list="ulist" value="${esc(v.owner)}"><datalist id="ulist"></datalist></label>
      </div>
      <label class="f"><span>備註</span><textarea name="note" rows="2">${esc(v.note)}</textarea></label>
      <button class="btn pri" ${locked ? 'disabled' : ''} style="width:100%">${isNew ? '建立展覽' : '儲存'}</button>
    </form>

    ${isNew ? '' : `<div class="card">
      <div class="row"><b>需求清單</b><span class="spacer"></span>
        <button class="btn brand sm" data-act="show-pick" ${locked ? 'disabled' : ''}>${ICON.plus}去展品目錄挑選</button>
        <button class="btn sm" data-act="show-paste" ${locked ? 'disabled' : ''}>整批貼上</button>
        <button class="btn sm" data-act="sheet-print" ${v.lines.length ? '' : 'disabled'}>列印備料清單</button>
        <button class="btn sm" data-act="sheet-csv" ${v.lines.length ? '' : 'disabled'}>${ICON.dl}匯出 CSV</button></div>
      <div class="meta" style="margin:6px 0">到目錄挑選時會直接顯示這個檔期能借幾台;一次 30～100 件的話,「整批貼上」從 Excel 複製「展品名稱 / 地點 / 數量」三欄最快。</div>
      <div class="lines" id="shlines"></div>
      <div id="shsum"></div>
    </div>`}

    ${isNew ? '' : `<div class="card">
      <div class="row"><b>狀態與借用單</b><span class="spacer"></span></div>
      <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:8px">
        ${v.status === 'draft' ? `<button class="btn pri sm" data-act="show-status" data-s="confirmed">確認檔期(開始卡位)</button>` : ''}
        ${v.status === 'confirmed' ? `<button class="btn sm" data-act="show-status" data-s="draft">改回規劃中</button>
          <button class="btn brand sm" data-act="show-gen">依地點產生借用單</button>
          <button class="btn sm" data-act="show-status" data-s="closed">結案</button>` : ''}
        ${v.status === 'closed' && !v.archived ? `<button class="btn sm" data-act="show-status" data-s="confirmed">重新開啟</button>` : ''}
        ${v.archived ? `<span class="meta">借用單已封存到歷史工作表,這場不能再重新開啟。</span>` : ''}
        ${v.status === 'cancelled' ? `<button class="btn sm" data-act="show-status" data-s="draft">改回規劃中</button>` : ''}
        ${v.status === 'draft' || v.status === 'confirmed' ? `<button class="btn sm ghost" data-act="show-status" data-s="cancelled">取消展覽</button>` : ''}
        ${live.length ? `<button class="btn sm" data-act="show-extend">批次延期(${live.length} 張)</button>` : ''}
        ${outNow.length ? `<button class="btn brand sm" data-act="show-return">批次登記歸還(${outNow.length} 張)</button>` : ''}
        <span class="spacer"></span>
        ${v.loanCount || v.archived ? '' : `<button class="btn sm ghost" data-act="show-del">刪除</button>`}
      </div>
      ${(v.loans || []).length ? `<div style="margin-top:12px">${v.loans.map(L => miniRow(L, `${fmtD(L.start)}~${fmtD(L.end)}`)).join('')}</div>`
        : `<div class="meta" style="margin-top:12px">${v.archived ? '底下的借用單已經封存到歷史工作表。要查明細請到「借用單」頁勾選「含歷史資料」。'
          : '還沒有借用單。確認檔期之後按「依地點產生借用單」,系統會依各地點各開一張。'}</div>`}
    </div>`}

    <div id="settle-slot"></div>`;

  if (settleP) {
    const myGen = RGEN;
    settleP.then(SE => {
      const slot = $('#settle-slot');
      if (!SE || !slot || myGen !== RGEN) return;          // 使用者已經切走了就不要硬塞
      S._settle = SE;
      slot.outerHTML = settleCard(v, SE);
    });
  }
  const nameOf = Object.fromEntries(S.items.map(i => [i.id, i.name]));
  let gaps = [];
  const drawLines = () => {
    if (!$('#shlines')) return;                       // 新增階段還沒有需求清單
    const g = Object.fromEntries(gaps.map(x => [x.itemId + '@' + nloc(x.location), x]));
    const L2 = S.showLines;
    $('#shlines').innerHTML = !L2.length ? `<div class="meta">還沒有東西。</div>` : L2.map((l, idx) => {
      const k = g[lkey(l)];
      // 缺口要點得開 —— 只給一個數字,使用者就得自己一張一張去翻借用單
      const gap = `<button type="button" class="short linkish" data-act="who" data-i="${esc(l.itemId)}" data-w="${esc(l.location || '')}"
        title="看看是誰佔著">缺 ${k ? k.short : 0}(可借 ${k ? k.available : 0})</button>`;
      const st = !k ? '<span class="meta">填好檔期後會算可借量</span>'
        : k.short ? gap
          : k.issued ? `<span class="okt">已開單 ${k.issued}</span>`
            : `<span class="okt">足夠(可借 ${k.available})</span>`;
      return `<div class="line"><span class="nm">${esc(nameOf[l.itemId] || l.itemId)}<br><span class="meta">${esc(l.location)}</span></span>
        <span class="qtybox"><input type="number" min="1" value="${l.qty}" data-shq="${idx}" ${locked ? 'disabled' : ''}></span>
        <span style="min-width:150px;text-align:right">${st}</span>
        ${rmBtn('show-rm', `data-i="${idx}"`, locked)}</div>`;
    }).join('');
    $$('[data-shq]').forEach(inp => inp.onchange = () => {
      S.showLines[+inp.dataset.shq].qty = Math.max(1, parseInt(inp.value, 10) || 1);
      saveShowLines(); recheck();
    });
    const short = gaps.filter(x => x.short);
    const total = L2.reduce((a, x) => a + x.qty, 0);
    $('#shsum').innerHTML = !L2.length ? ''
      : !gaps.length ? `<div class="sumbar banner info">填好檔期起訖之後,每一項都會即時比對可借量</div>`
        : short.length ? `<div class="sumbar banner bad"><b>缺 ${short.length} 項</b>:${short.map(x => esc(x.name) + '(' + esc(x.location) + ')×' + x.short).join('、')}</div>`
          : `<div class="sumbar banner ok"><b>全部足夠</b>,共 ${L2.length} 項 ${total} 件</div>`;
  };
  const recheck = async () => {
    const f = new FormData($('#shform')), from = f.get('from'), to = f.get('to');
    const bad = rangeProblem(from, to, '檔期開始', '檔期結束');
    if (bad) { gaps = []; toast(bad, true); return drawLines(); }
    if (from && to && S.showLines.length) {
      try { gaps = await api('showCheck', { id: isNew ? '' : v.id, from, to, lines: showDraftLines() }); }
      catch (e) { gaps = []; toast(e.message, true); }
    } else gaps = [];
    drawLines();
  };
  S._showRecheck = recheck;
  S._showItems = S.items;
  // `show` 的回應裡每一行已經帶了 available / short(showLineView 算好的),
  // 第一次繪製直接用,不要再為了同一組數字多打一趟 showCheck。
  // 之後使用者改日期或改數量時才需要 —— 那時清單還沒存檔,後端不知道要算什麼。
  if (!isNew && (v.lines || []).length) { gaps = v.lines; }
  $('#shform').querySelectorAll('input[type=date]').forEach(el => el.onchange = recheck);
  cachedGet('users', 'users').then(us => { const d = $('#ulist'); if (d) d.innerHTML = us.filter(u => u.active).map(u => `<option value="${esc(u.empNo)}">${esc(u.name)} ${esc(u.dept || '')}</option>`).join(''); }).catch(() => { });
  $('#shform').onsubmit = async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const bad = rangeProblem(fd.from, fd.to, '檔期開始', '檔期結束');
    if (bad) return toast(bad, true);
    const saved = await run(() => api('saveShow', { show: { ...fd, id: isNew ? '' : v.id, lines: showDraftLines() } }),
      isNew ? '展覽已建立,接下來去挑展品' : '已儲存').catch(() => null);
    if (!saved) return;
    S.showId = saved.id; S.showLines = null; S.showPick = null;
    store.del(uk('showlines')); store.del(uk('showpick'));   // 只清一半的話,重整之後會拿空清單覆蓋掉後端
    render();
  };
  // 已經有現成的缺口數字就直接畫,不要為了同一組數字再打一趟後端
  if (gaps.length) drawLines(); else recheck();
}

/**
 * 展覽總清單:備料 / 搬運用的紙本。
 * **依廠區分頁** —— 點貨的人站在某一個廠區的架子前面,不會想看別廠的東西。
 * 每一項前面留一個勾選格讓他手勾;逐台編號的把編號印出來,才對得起來。
 */
function printShowSheet(d) {
  const w = window.open('', '_blank', 'width=1000,height=1100');
  if (!w) return toast('瀏覽器擋掉了列印視窗,請允許彈出視窗', true);
  const esc2 = esc;
  const body = d.groups.map((g, gi) => {
    const rows = g.rows.map(r => {
      const gap = r.short ? '<span class="sh">缺 ' + r.short + '</span>' : '';
      const src = r.loans.length ? esc2(r.loans.join('、')) : '<span class="tb">未開單</span>';
      const un = r.units.length ? '<div class="un">' + esc2(r.units.join('、')) + '</div>' : '';
      return '<tr><td class="bx"></td><td>' + esc2(r.category || '') + '</td><td>' + esc2(r.name)
        + (r.note ? '<div class="nt">' + esc2(r.note) + '</div>' : '') + un + '</td>'
        + '<td class="n">' + r.planned + '</td><td class="n">' + r.issued + '</td>'
        + '<td class="n">' + (r.short || '') + gap + '</td><td class="src">' + src + '</td></tr>';
    }).join('');
    return '<section' + (gi ? ' class="pb"' : '') + '><h2>' + esc2(g.location) + '</h2>'
      + '<div class="sub">' + g.items + ' 項 ' + g.planned + ' 件'
      + (g.short ? '・<span class="sh">缺 ' + g.short + ' 件</span>' : '') + '</div>'
      + '<table class="items"><thead><tr><th class="bx">✓</th><th>分類</th><th>品名 / 單台編號</th>'
      + '<th class="n">規劃</th><th class="n">已開單</th><th class="n">缺</th><th class="src">借用單號</th></tr></thead>'
      + '<tbody>' + (rows || '<tr><td colspan="7">這個廠區沒有東西</td></tr>') + '</tbody></table>'
      + '<div class="sign"><div>點貨人簽名</div><div>日期</div></div></section>';
  }).join('');
  w.document.write('<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>'
    + esc2(d.name) + ' 備料清單</title><style>'
    + 'body{font:13px/1.55 system-ui,"Noto Sans TC",sans-serif;color:#333F48;margin:30px}'
    + 'h1{font-size:19px;margin:0 0 3px;color:#C8102E}h2{font-size:15px;margin:0 0 2px}'
    + '.hd{color:#6b7280;font-size:12px;margin:0 0 6px}.sub{color:#6b7280;font-size:11px;margin:0 0 8px}'
    + 'table{width:100%;border-collapse:collapse;margin-bottom:10px}'
    + 'th,td{border:1px solid #d8dce0;padding:5px 8px;text-align:left;vertical-align:top}'
    + 'th{background:#f4f5f7;font-weight:600}td.n,th.n{text-align:right;width:52px}'
    + '.bx{width:26px;text-align:center}td.bx{height:22px}.src,th.src{width:130px;font-size:11px}'
    + '.un{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#6b7280;margin-top:2px}'
    + '.nt{font-size:11px;color:#6b7280}.sh{color:#C8102E;font-weight:600}.tb{color:#9aa3ad}'
    + '.sign{display:flex;gap:36px;margin:14px 0 26px}'
    + '.sign div{flex:1;border-top:1px solid #333F48;padding-top:6px;font-size:11px;color:#6b7280}'
    + 'section.pb{page-break-before:always}@media print{body{margin:10mm}}'
    + PRINT_BAR_CSS
    + '</style></head><body>'
    + PRINT_BAR
    + '<h1>' + esc2(d.name) + ' 備料清單</h1>'
    + '<div class="hd">' + esc2(d.from) + ' ~ ' + esc2(d.to)
    + (d.venue ? '・' + esc2(d.venue) : '') + '・' + esc2(d.statusLabel)
    + (d.ownerName ? '・承辦 ' + esc2(d.ownerName) : '')
    + '<br>共 ' + d.totals.items + ' 項 ' + d.totals.planned + ' 件,已開單 ' + d.totals.issued + ' 件'
    + (d.totals.short ? '、<span class="sh">缺 ' + d.totals.short + ' 件</span>' : '')
    + '・列印於 ' + esc2(todayStr()) + '</div>'
    + body + '</body></html>');
  w.document.close();
  setTimeout(() => w.print(), 300);
}
function showSheetCSV(d) {
  const head = ['廠區', '分類', '展品編號', '品名', '追蹤方式', '規劃量', '已開單', '未開單', '這期間可借', '缺口', '借用單號', '單台編號', '備註'];
  const rows = d.groups.reduce((a, g) => a.concat(g.rows.map(r => [g.location, r.category, r.itemId, r.name,
    r.mode === 'unit' ? '逐台編號' : '數量', r.planned, r.issued, r.need, r.available, r.short,
    r.loans.join(' '), r.units.join(' '), r.note])), []);
  // 先算進區域變數再插值:結構測試會擋 `${}` 裡直接出現使用者欄位名(就算這裡是檔名不是 HTML)
  const nm = String(d.name || '').replace(/[\\/:*?"<>|]/g, '_');
  downloadCSV(`展覽總清單_${nm}_${todayStr()}.csv`,
    [['展覽', d.name], ['檔期', d.from + ' ~ ' + d.to], ['場地', d.venue], ['狀態', d.statusLabel],
     ['承辦', d.ownerName || d.owner], ['產生日', todayStr()], []]
      .concat([head]).concat(rows)
      .concat([[], ['合計', '', '', d.totals.items + ' 項', '', d.totals.planned, d.totals.issued, d.totals.need, '', d.totals.short]]));
}

/**
 * 整批貼上:從 Excel 複製「名稱 / 地點 / 數量」三欄。
 * 對不到的行不會中斷其他行 —— 100 行裡有 3 行打錯字,不該逼人整批重來。
 */
function showPasteDialog() {
  openModal(`<h2>整批貼上</h2>
    <p class="meta">每行一項,用 Tab 或逗號分隔:<b>展品名稱或編號 / 地點 / 數量</b>。地點與數量可以省略(數量預設 1)。</p>
    <textarea id="sp-txt" rows="10" style="width:100%" placeholder="42吋看板&#9;新竹&#9;3&#10;展示架&#9;林口&#9;5"></textarea>
    <div id="sp-out"></div>
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" data-act="show-paste-ok">加入</button></div>`, { wide: true });
}
/** 把貼上的文字對回展品;回傳 { lines, bad } */
function parsePaste(txt) {
  const items = (S._showItems || S.items || []).filter(i => !i.archived);
  const byName = {}, byId = {};
  items.forEach(i => { byName[String(i.name).trim().toLowerCase()] = i; byId[String(i.id).toUpperCase()] = i; });
  const lines = [], bad = [];
  String(txt || '').split(/\r?\n/).forEach((raw, n2) => {
    const row = raw.trim();
    if (!row) return;
    const cell = row.split(/\t|,|,/).map(x => x.trim());
    const key = cell[0] || '';
    const it = byId[key.toUpperCase()] || byName[key.toLowerCase()];
    if (!it) { bad.push({ n: n2 + 1, text: row, why: '找不到這個展品' }); return; }
    const sites = (it.sites || []).map(g => g.location);
    let where = cell[1] || '';
    const qty = Math.max(1, parseInt(cell[2] || cell[1], 10) || 1);
    if (where && !isNaN(parseInt(where, 10)) && sites.indexOf(where) < 0) where = '';   // 第二欄其實是數量
    if (!where) {
      if (sites.length > 1) { bad.push({ n: n2 + 1, text: row, why: '放在 ' + sites.join('、') + ',要指定地點' }); return; }
      where = sites[0] || '未指定';
    } else if (sites.length && sites.indexOf(where) < 0) {
      bad.push({ n: n2 + 1, text: row, why: '在「' + where + '」沒有庫存' }); return;
    }
    lines.push({ itemId: it.id, location: where, qty: qty, note: '' });
  });
  return { lines, bad };
}
/** 同一個品項 + 同一個地點合併成一行 */
function mergeShowLines(base, add) {
  const out = base.slice();
  add.forEach(l => {
    const hit = out.find(x => x.itemId === l.itemId && nloc(x.location) === nloc(l.location));
    if (hit) hit.qty += l.qty; else out.push(l);
  });
  return out;
}

