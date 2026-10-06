/* ===================== 共用元件 ===================== */
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
/**
 * 照片放大(v3.5)。卡片上的縮圖只有一百多像素高 —— 借用人要看清楚展品長什麼樣,
 * 那個尺寸根本不夠(2026-10-06 回報)。點一下整張蓋上來,盡量拿得到的最大尺寸。
 *
 * 雲端硬碟的網址帶著尺寸參數,這裡把它換大;**自己貼的網址原樣不動**
 * (那是別人家的網站,亂改參數只會變成 404)。
 * 上傳時前端會先把長邊縮到 1200px,所以再大也就是原圖那麼大,不會更清楚。
 */
function bigPhoto(url) {
  const u = String(url || '');
  if (/drive\.google\.com\/thumbnail/.test(u)) return u.replace(/([?&]sz=)w\d+/, '$1w2000');
  if (/lh3\.googleusercontent\.com\/d\//.test(u)) return u.replace(/=w\d+(-h\d+)?$/, '=w2000');
  return u;
}
/** 點縮圖之後蓋上來的那一張。點畫面任何地方或按 Esc 都關掉 */
function photoBox(src, caption) {
  const old = $('#photo-bg'); if (old) old.remove();
  const bg = document.createElement('div');
  bg.className = 'photo-bg'; bg.id = 'photo-bg';
  bg.innerHTML = `<img src="${esc(bigPhoto(src))}" alt="${esc(caption || '展品照片')}"
      onerror="this.closest('#photo-bg').classList.add('broken')">
    <div class="cap">${esc(caption || '')}</div>
    <button class="x" type="button" aria-label="關閉">×</button>`;
  bg.addEventListener('click', () => bg.remove());
  document.body.appendChild(bg);
  return bg;
}
/**
  * 短少 / 不歸還 / 損壞要標在**收合狀態下就看得到的地方**。每張單預設只露出單號 / 標題 / 狀態,
  * 數字藏在收合起來的明細裡 —— 追短少時一張一張點開等於沒有這個功能。
  * 三個分開標,因為它們是三回事:**短少 = 東西不見了、還要追**(總數會少),
  * **不歸還 = 決定不收回來了、不用追**(總數一樣會少,但追查清單不該出現它),
  * **損壞 = 東西還在、只是壞了**(總數不變,只留記號)。
  * 後端把「不歸還」當成 lost 的子集(kept ⊆ lost),所以要追的短少是 lost − kept。
  */
function lossPills(L) {
  const sum = k => (L.lines || []).reduce((a, ln) => a + (Number(ln[k]) || 0), 0);
  const kept = sum('kept'), lost = sum('lost') - kept, dmg = sum('damaged');
  return (lost ? ` <span class="pill lost">短少 ${lost}</span>` : '')
    + (kept ? ` <span class="pill">不歸還 ${kept}</span>` : '')
    + (dmg ? ` <span class="pill repair">損壞 ${dmg}</span>` : '');
}
function statusPill(L) {
  return `<span class="pill ${L.status}">${esc(L.statusLabel)}</span>` + lossPills(L)
    + (L.overdue ? ` <span class="pill bad">逾期 ${L.overdueDays} 天</span>` : '');
}
function loanCard(L, opts = {}) {
  const chk = {}; (L.check || []).forEach(c => { chk[c.itemId + '@' + nloc(c.location)] = c; });
  const lines = L.lines.map(ln => {
    const c = chk[lkey(ln)];
    const where = esc(nloc(ln.location));
    const units = (ln.units || []).length ? `<div class="u">${ln.units.map(u => {
      // keptUnits 也在 lostUnits 裡(kept ⊆ lost),所以要先問「不歸還」才問「遺失」
      const st = (ln.keptUnits || []).includes(u) ? '(不歸還)'
        : (ln.lostUnits || []).includes(u) ? '(遺失)'
          : (ln.returnedUnits || []).includes(u) ? '(已還)' : '';
      return esc(u) + st;
    }).join('、')}</div>` : '';
    let right = `<span class="q">× ${ln.qty}</span>`;
    const kept = Number(ln.kept) || 0, lost = (Number(ln.lost) || 0) - kept;
    if ((L.status === 'out' || L.status === 'returned') && (ln.returned || ln.lost)) right += ` <span class="meta">已還 ${ln.returned}${ln.damaged ? `(損壞 ${ln.damaged})` : ''}${lost ? `・短少 ${lost}` : ''}${kept ? `・不歸還 ${kept}` : ''}${ln.found ? `・找回 ${ln.found}` : ''}</span>`;
    if (c) right += c.short ? ` <span class="short">缺 ${c.short}(可借 ${c.available})</span>` : ` <span class="okt">足夠</span>`;
    return `<div class="line"><span class="nm">${esc(ln.name)} ${ln.mode === 'unit' ? '<span class="pill unit">逐台</span>' : ''}<br><span class="meta">${where}</span></span>${right}${units}${ln.keptNote ? `<div class="u">不歸還原因:${esc(ln.keptNote)}</div>` : ''}</div>`;
  }).join('');
  const A = [];
  const admin = isAdmin() && !opts.mine;
  const btn = (act, label, cls) => `<button class="btn sm ${cls || ''}" data-act="${act}" data-id="${L.id}">${label}</button>`;
  if (admin && L.status === 'pending') A.push(`<button class="btn sm danger" data-act="reject" data-id="${L.id}">駁回</button>`, `<button class="btn sm pri" data-act="approve" data-id="${L.id}">核准</button>`);
  // 出借中的單:按錯了可以「取消核准」把東西收回來(只在還沒登記過歸還時,後端會擋)
  if (admin && L.status === 'out') A.push(`<button class="btn sm danger" data-act="reject" data-id="${L.id}">取消核准</button>`,
    btn('extend', '延期'), btn('receive', '登記歸還', 'pri'));
  /* 短少的東西後來找到是常事,所以「補回短少」要出現在**看得到短少的那張卡片上**,
     不要逼人記得「這種事要去盤點那一頁做」。已封存的單寫不回去,所以不給按。
     「不歸還」那一份不算 —— 它不會回來,所以條件是 lost − kept。 */
  if (admin && !L.archived && (L.status === 'out' || L.status === 'returned')
    && (L.lines || []).some(ln => (Number(ln.lost) || 0) - (Number(ln.kept) || 0) > 0)) A.push(btn('recover', '補回短少'));
  if (!['pending', 'rejected', 'cancelled'].includes(L.status)) A.push(btn('print-loan', '列印', 'ghost'));
  if (opts.mine) {
    /* v3.0(2026-10-01):同仁端只剩「申請」這一步 —— 待審核時可以改或取消,之後什麼都不用做。
       簽收領取 / 申請歸還 / 申請延期 / 轉借 / 撤回 / 當面確認六個入口全部拿掉了,
       核准就等於東西交出去,之後一律由管理者登記歸還,同仁收 Email 就好。 */
    if (L.status === 'pending') A.push(btn('edit-loan', '修改申請'), btn('cancel', '取消申請', 'danger'));
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
      <div class="loan-meta">${who}<span>期間 <b>${esc(L.start)} → ${esc(L.end)}</b></span>${L.venue ? `<span>地點 ${esc(L.venue)}</span>` : ''}${L.outAt ? `<span>出借 ${esc(L.outAt)}</span>` : ''}${L.returnedAt ? `<span>歸還 ${esc(L.returnedAt)}</span>` : ''}</div>
      <div class="lines">${lines}</div>
      ${notes.length ? `<div class="note">${notes.map(esc).join('<br>')}</div>` : ''}
    </div>
    <!-- 操作按鈕**不收**:收起來的時候還是要能直接核准 / 登記歸還,
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

