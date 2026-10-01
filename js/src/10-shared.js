/* ===================== 共用元件 ===================== */
/** 四種請求的中文字。按鈕標籤、當面確認對話框共用一份,免得哪天又有人只改一邊 */
const REQ_WORD = { pickup: '領取', 'return': '歸還', extend: '延期', transfer: '轉借' };
/** 操作紀錄大類的顯示順序。名稱與歸類規則都在後端(Logic.logCat),這裡只決定籤條排列 */
const LOG_CAT_ORDER = ['loan', 'item', 'show', 'cat', 'user', 'other'];

/* 列印視窗頂端的工具列。三種列印(借用單 / 備料清單 / QR 標籤)都是 window.open 開新視窗,
   以前印完就停在那一頁,沒有任何回得來的入口 —— 手機上尤其明顯(那是一個分頁,不是視窗)。
   @media print 會把它整條藏掉,所以不會印出來。 */
const PRINT_BAR_CSS = '.pbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;background:#333F48;color:#fff;'
  + 'padding:10px 14px;border-radius:8px;margin:0 0 18px;font:13px/1.5 system-ui,"Noto Sans TC",sans-serif}'
  + '.pbar button{font:inherit;border:0;border-radius:7px;padding:7px 15px;cursor:pointer}'
  + '.pbar .go{background:#C8102E;color:#fff}.pbar .cl{background:#fff;color:#333F48}'
  + '.pbar .tip{opacity:.8}@media print{.pbar{display:none}}';
const PRINT_BAR = '<div class="pbar"><button class="go" onclick="window.print()">列印</button>'
  + '<button class="cl" onclick="window.close()">關閉,回到系統</button>'
  + '<span class="tip">印完按「關閉」就會回到展品管理系統。這一條不會被印出來。</span></div>';
function archPill(L) { return L.archived ? '<span class="pill">已封存</span>' : ''; }
function statusPill(L) {
  return `<span class="pill ${L.status}">${esc(L.statusLabel)}</span>` + (L.stage ? ` <span class="pill pending">${esc(L.stage)}</span>` : '') + (L.overdue ? ` <span class="pill bad">逾期 ${L.overdueDays} 天</span>` : '');
}
/** 待確認請求的說明列(四種請求共用) */
function reqBanner(req, mine) {
  if (!req || !req.type) return '';
  const T = { pickup: '簽收領取', 'return': '歸還', extend: '延長歸還日', transfer: '轉借' };
  let what = T[req.type] || '請求';
  if (req.type === 'pickup') { const u = Object.values(req.units || {}).flat().join('、'); what += u ? ':' + u : ''; }
  if (req.type === 'extend') what += ':延到 ' + req.end;
  if (req.type === 'transfer') what += ':轉給 ' + (req.toName || '');
  const body = mine
    ? '已送出' + what + '(' + req.at + '),等管理者確認後才算完成。'
    : req.by + ' 於 ' + req.at + ' 送出' + what + ',等待確認';
  return '<div class="banner warn" style="margin:10px 0 0;font-size:13px">' + esc(body) + '</div>';
}

function loanCard(L, opts = {}) {
  const chk = {}; (L.check || []).forEach(c => { chk[c.itemId + '@' + nloc(c.location)] = c; });
  const lines = L.lines.map(ln => {
    const c = chk[lkey(ln)];
    const where = esc(nloc(ln.location));
    const units = (ln.units || []).length ? `<div class="u">${ln.units.map(u => {
      const st = (ln.lostUnits || []).includes(u) ? '(遺失)' : (ln.returnedUnits || []).includes(u) ? '(已還)' : '';
      return esc(u) + st;
    }).join('、')}</div>` : '';
    let right = `<span class="q">× ${ln.qty}</span>`;
    if (L.status === 'out' && (ln.returned || ln.lost)) right += ` <span class="meta">已還 ${ln.returned}${ln.lost ? `・短少 ${ln.lost}` : ''}</span>`;
    if (c) right += c.short ? ` <span class="short">缺 ${c.short}(可借 ${c.available})</span>` : ` <span class="okt">足夠</span>`;
    return `<div class="line"><span class="nm">${esc(ln.name)} ${ln.mode === 'unit' ? '<span class="pill unit">逐台</span>' : ''}<br><span class="meta">${where}</span></span>${right}${units}</div>`;
  }).join('');
  const A = [];
  const admin = isAdmin() && !opts.mine;
  const req = L.request;
  const btn = (act, label, cls) => `<button class="btn sm ${cls || ''}" data-act="${act}" data-id="${L.id}">${label}</button>`;
  if (admin && req) {
    if (req.type === 'pickup') A.push(btn('checkout', '確認領取', 'pri'));
    else if (req.type === 'return') A.push(btn('receive', '確認歸還', 'pri'));
    else A.push(btn('req-no', '不同意', 'danger'), btn('req-ok', req.type === 'extend' ? '同意延期' : '同意轉借', 'pri'));
  }
  if (admin && L.status === 'pending') A.push(`<button class="btn sm danger" data-act="reject" data-id="${L.id}">駁回</button>`, `<button class="btn sm pri" data-act="approve" data-id="${L.id}">核准</button>`);
  if (admin && L.status === 'approved' && !req) A.push(`<button class="btn sm danger" data-act="reject" data-id="${L.id}">取消核准</button>`, `<button class="btn sm pri" data-act="checkout" data-id="${L.id}">點交出借</button>`);
  if (admin && L.status === 'out' && !req) A.push(btn('receive', '登記歸還', 'pri'));
  if (admin && (L.status === 'approved' || L.status === 'out') && !req) A.push(btn('extend', '延期'));
  if (!['pending', 'rejected', 'cancelled'].includes(L.status)) A.push(btn('print-loan', '列印', 'ghost'));
  if (opts.mine) {
    if (L.status === 'pending' && !req) A.push(btn('edit-loan', '修改申請'));
    if ((L.status === 'pending' || L.status === 'approved') && !req) A.push(btn('cancel', '取消申請', 'danger'));
    if ((L.status === 'approved' || L.status === 'out') && !req) A.push(btn('u-extend', '申請延期'), btn('u-transfer', '轉借'));
    if (L.status === 'approved' && !req) A.push(btn('u-pickup', '簽收領取', 'pri'));
    if (L.status === 'out' && !req) A.push(btn('u-return', '歸還', 'pri'));
    // 四種請求各自用自己的字。以前這裡寫死成「簽收 / 歸還」,延期與轉借都會長出「撤回歸還」,
    // 而且 u-onsite 是用卡片上的文字去 regex 猜型別的 —— 延期會被猜成歸還,跳出錯的對話框。
    if (req) A.push(`<button class="btn sm ghost" data-act="u-cancel-req" data-id="${L.id}">撤回${REQ_WORD[req.type] || '申請'}</button>`,
      `<button class="btn sm pri" data-act="u-onsite" data-id="${L.id}" data-t="${esc(req.type)}">請管理者當面確認</button>`);
  }
  const who = admin ? `<span>借用人 <b>${esc(L.applicant)}</b>${L.dept ? '・' + esc(L.dept) : ''}</span>${L.contact ? `<span>聯絡 ${esc(L.contact)}</span>` : ''}` : '';
  const notes = [L.purpose && '用途:' + L.purpose, L.reviewNote && '審核:' + L.reviewNote + (L.reviewer ? '(' + L.reviewer + ')' : ''), L.note && '備註:' + L.note].filter(Boolean);
  /**
   * 每張單子自己收合:預設只露出「單號 + 標題 + 狀態」,點標題旁的 +/− 才展開細項。
   * 一頁幾十張單、每張都攤開全部明細,要找的那張得捲很久(2026-10-01 回報)。
   * 展開狀態記在 S.openLoans,重畫之後還在;換人登入會清掉。
   */
  const open = S.openLoans.has(L.id);
  return `<div class="card loan ${open ? 'open' : ''}" id="loan-${L.id}">
    <div class="loan-h"><span class="id">${esc(L.id)}</span><h3>${esc(L.event)}</h3>${statusPill(L)}${archPill(L)}
      <button class="foldbtn" data-act="loan-fold" data-id="${L.id}" aria-expanded="${open}"
        aria-label="${open ? '收合' : '展開'}這張單的細項" title="${open ? '收合細項' : '展開細項'}">${open ? '−' : '+'}</button></div>
    <div class="loan-body">
      <div class="loan-meta">${who}<span>期間 <b>${esc(L.start)} → ${esc(L.end)}</b></span>${L.venue ? `<span>地點 ${esc(L.venue)}</span>` : ''}${L.outAt ? `<span>點交 ${esc(L.outAt)}</span>` : ''}${L.returnedAt ? `<span>歸還 ${esc(L.returnedAt)}</span>` : ''}</div>
      <div class="lines">${lines}</div>
      ${notes.length ? `<div class="note">${notes.map(esc).join('<br>')}</div>` : ''}
      ${opts.mine || isAdmin() ? reqBanner(req, !!opts.mine) : ''}
    </div>
    <!-- 操作按鈕**不收**:收起來的時候還是要能直接核准 / 點交 / 歸還,
         不然審 20 張待審核要先點開 20 次(2026-10-01 使用者決定) -->
    ${A.length ? `<div class="actions">${A.join('')}</div>` : ''}
  </div>`;
}
function miniRow(L, extra) {
  return `<div class="list-row" data-act="open-loan" data-id="${L.id}" data-st="${L.status}">
    <div class="t"><div>${esc(L.event)}</div><div class="meta">${esc(L.applicant)}${L.dept ? '・' + esc(L.dept) : ''}|${fmtD(L.start)} → ${fmtD(L.end)}|${L.lines.length} 項</div></div>${extra || statusPill(L)}</div>`;
}
function downloadCSV(name, rows) {
  const csv = '﻿' + rows.map(r => r.map(v => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function exportStock() {
  const list = await api(isAdmin() ? 'items' : 'catalog');
  downloadCSV(`展品庫存_${todayStr()}.csv`, [['編號', '品名', '類別', '追蹤方式', '總數', '倉庫在庫', '出借中', '已預約', '維修', '各地點數量', '最後盤點', '規格', '狀態']]
    .concat(list.map(i => [i.id, i.name, i.category, i.mode === 'unit' ? '逐台編號' : '數量', i.total, i.inStock, i.out, i.reserved, i.repair || 0,
      (i.sites || []).map(g => g.location + ' ' + g.total).join('、') || i.location, i.countedAt, i.spec, i.archived ? '已下架' : '使用中'])));
}
function saveCart() { store.set(uk('cart'), S.cart); store.set(uk('plan'), S.plan); store.set(uk('editing'), S.editing); renderTabs(); }
/** 同一個展品放在不同廠區要分開算,所以清單的 key 是「展品 + 地點」 */
const ckey = c => c.itemId + '@' + (c.location || '');
function addToCart(itemId, qty, where) {
  qty = Math.max(1, parseInt(qty, 10) || 1);
  const key = itemId + '@' + (where || '');
  const ex = S.cart.find(c => ckey(c) === key);
  if (ex) ex.qty += qty; else S.cart.push({ itemId, location: where || '', qty });
  saveCart();
}
/** 這個展品放在哪幾個地點 */
function itemSites(i) { return (i.sites || []).map(g => g.location); }
/** 地點的標準寫法:沒填就叫「未指定」(後端也是這樣算) */
const nloc = v => (v && String(v).trim()) || '未指定';
/** 借用單一行的 key:同一個展品在不同廠區是兩行 */
const lkey = l => l.itemId + '@' + nloc(l.location);

