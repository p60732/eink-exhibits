/**
 * 【展示積木】js/ui.js
 * 輸入:後端(邏輯積木)回傳的 JSON
 * 責任:渲染畫面、收集使用者輸入、表單格式驗證;把操作交給連線積木送往守門調度
 * 輸出:{ action, payload } 請求
 * 禁止:不判斷業務規則(庫存夠不夠、能不能借都以後端回傳為準);不直接操作 Google Sheets;不存密鑰
 */
/* ===================== 狀態與工具 ===================== */
const S = {
  token: null, user: null, view: 'catalog', items: [], cats: [],
  cart: [], plan: { start: '', end: '' },
  filters: { q: '', cat: '', start: '', end: '', onlyAvail: false },
  loanFilter: 'pending', itemQ: '', showArchived: false, logQ: ''
};
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isAdmin = () => S.user && S.user.role === 'admin';
const store = {
  get(k, d) { try { const v = localStorage.getItem('exh_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('exh_' + k, JSON.stringify(v)); } catch (e) { } },
  del(k) { try { localStorage.removeItem('exh_' + k); } catch (e) { } }
};
const pad2 = n => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };
const fmtD = d => d ? d.slice(5).replace('-', '/') : '';
const ICON = {
  search: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>',
  scan: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10"/></svg>',
  plus: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
  dl: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 4v11m0 0-4-4m4 4 4-4M5 20h14"/></svg>',
  user: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/></svg>',
  box: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M4 8l8-4 8 4-8 4-8-4zM4 8v8l8 4 8-4V8M12 12v8"/></svg>',
  qr: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2"/></svg>',
  layers: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m12 3 9 5-9 5-9-5 9-5zM3 13l9 5 9-5M3 17l9 5 9-5"/></svg>',
  cube: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 8 12 3 3 8v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8"/></svg>',
  home: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 10 12 4l8 6v9a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-9z"/></svg>',
  out: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 6 4 12l5 6M4 12h11M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4"/></svg>',
  clock: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  alert: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 4.5 21 19H3l9-14.5zM12 10v4M12 16.5h.01"/></svg>',
  check: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  wrench: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15.5 4.5a5 5 0 0 0-6.2 6.2L4 16l4 4 5.3-5.3a5 5 0 0 0 6.2-6.2L16.5 12 12 7.5l3.5-3z"/></svg>'
};

let busyN = 0;
function busy(on) { busyN += on ? 1 : -1; $('#busy').classList.toggle('hidden', busyN <= 0); }
async function api(action, payload = {}) {
  busy(true);
  const tok = S.token;
  try {
    const data = await Api.call(action, payload, tok);
    if (!Api.READ.has(action)) RCACHE.clear();        // 任何寫入 → 快取全部失效
    return data;
  } catch (e) {
    if (/登入已過期/.test(e.message)) { if (tok && tok === S.token) logout(true); e.silent = true; }
    throw e;
  } finally { busy(false); }
}

/* 讀取快取:切頁時先用上次的資料立刻畫出畫面,背景再向後端確認,有變動才重畫 */
const RCACHE = new Map();
const copy = v => JSON.parse(JSON.stringify(v));
async function cachedGet(key, action, payload = {}) {
  const hit = RCACHE.get(key);
  if (hit) { api(action, payload).then(d => RCACHE.set(key, { data: d })).catch(() => { }); return copy(hit.data); }
  const data = await api(action, payload);
  RCACHE.set(key, { data });
  return copy(data);
}
async function withData(main, key, action, payload, draw) {
  const hit = RCACHE.get(key), view = S.view;
  if (hit) draw(copy(hit.data));
  let data;
  try { data = await api(action, payload); }
  catch (e) { if (!hit) throw e; if (!e.silent) toast(e.message, true); return; }
  const changed = !hit || JSON.stringify(hit.data) !== JSON.stringify(data);
  RCACHE.set(key, { data });
  if (changed && S.view === view) draw(copy(data));
}
function toast(msg, err) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
  $('#toasts').appendChild(t); setTimeout(() => t.remove(), err ? 6000 : 3000);
}
async function run(fn, okMsg) {
  try { const r = await fn(); if (okMsg) toast(okMsg); return r; }
  catch (e) { if (!e.silent) toast(e.message || String(e), true); throw e; }
}
function loadScript(src) {
  return new Promise((ok, bad) => {
    if ($(`script[src="${src}"]`)) return ok();
    const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => bad(new Error('無法載入元件,請確認網路'));
    document.head.appendChild(s);
  });
}

/* ===================== Modal / 掃描器 ===================== */
function openModal(html, opts = {}) {
  closeModal();
  const bg = document.createElement('div');
  bg.className = 'modal-bg'; bg.id = 'modal-bg';
  bg.innerHTML = `<div class="modal ${opts.wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  if (opts.locked) bg.dataset.locked = '1';
  else bg.addEventListener('mousedown', e => { if (e.target === bg) closeModal(); });
  document.body.appendChild(bg);
  const f = bg.querySelector('input:not([type=checkbox]):not([type=radio]),select,textarea');
  if (f && !opts.noFocus) setTimeout(() => f.focus(), 30);
  return bg.firstElementChild;
}
function closeModal() { const m = $('#modal-bg'); if (m) m.remove(); }
let scanner = null;
async function openScanner(onCode, title = '掃描 QR Code') {
  const bg = document.createElement('div');
  bg.className = 'modal-bg'; bg.id = 'scanner-bg';
  bg.innerHTML = `<div class="modal"><h2>${esc(title)}</h2><div id="reader"></div><p class="sub" style="margin-top:10px">將鏡頭對準展品上的 QR 標籤。連續掃描會自動加入,完成後按「關閉」。</p><div id="scan-last" class="meta"></div><div class="modal-f"><button class="btn" id="scan-close">關閉</button></div></div>`;
  document.body.appendChild(bg);
  const stop = async () => { try { if (scanner) { await scanner.stop(); scanner.clear(); } } catch (e) { } scanner = null; bg.remove(); };
  $('#scan-close', bg).onclick = stop;
  try {
    await loadScript('https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js');
    scanner = new Html5Qrcode('reader');
    let last = '', lastT = 0;
    await scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 220, height: 220 } }, text => {
      const code = String(text).trim().toUpperCase();
      if (code === last && Date.now() - lastT < 2500) return;
      last = code; lastT = Date.now();
      if (navigator.vibrate) navigator.vibrate(60);
      $('#scan-last', bg).textContent = '已讀取:' + code;
      const keep = onCode(code);
      if (keep === false) stop();
    });
  } catch (e) {
    $('#reader', bg).innerHTML = `<div class="empty" style="color:#fff">無法開啟相機:${esc(e.message || e)}<br>請確認已允許相機權限,或直接手動輸入編號。</div>`;
  }
}

/* ===================== 登入 ===================== */
async function boot() {
  S.token = store.get('token', null); S.user = store.get('user', null);
  S.cart = store.get('cart', []); S.plan = store.get('plan', { start: '', end: '' });
  if (S.token && S.user) {
    try { S.user = await api('me'); store.set('user', S.user); return enterApp(); } catch (e) { }
  }
  let st = { hasUsers: true };
  try { st = await api('status'); } catch (e) { toast(e.message, true); }
  showLogin(st.hasUsers ? 'login' : 'setup');
}
function showLogin(mode) {
  $('#app').classList.add('hidden'); $('#top').classList.add('hidden');
  const box = $('#login'); box.classList.remove('hidden');
  const setup = mode === 'setup';
  box.innerHTML = `<div class="card">
    <h1><span class="brand"><span class="dot">${ICON.box}</span></span>${esc(CONFIG.APP_NAME)}</h1>
    <p class="sub">${setup ? '建立第一位管理者' : '輸入工號即可借用、簽收與歸還'}</p>
    ${setup ? '<div class="banner info" style="font-size:13px">系統尚未有任何帳號。這位將成為管理者,之後可在「使用者」頁匯入全公司人員清單。</div>' : ''}
    <form id="login-f" autocomplete="off">
      ${setup ? '<label class="f"><span>姓名 <b>*</b></span><input type="text" name="name" required></label>' : ''}
      <label class="f"><span>工號 <b>*</b></span><input type="text" name="emp" id="l-emp" required autocapitalize="characters" value="${esc(setup ? '' : store.get('lastEmp', ''))}" style="font-size:20px;letter-spacing:.08em;text-align:center"></label>
      ${setup ? '<div class="grid2"><label class="f"><span>部門</span><input type="text" name="dept"></label><label class="f"><span>Email(接收通知)</span><input type="email" name="email"></label></div>' : ''}
      <label class="f ${setup ? '' : 'hidden'}" id="l-pinf"><span>${setup ? '管理者 PIN <b>*</b>' : '<span id="l-hi"></span>管理者請輸入 PIN'}</span><input type="password" name="pin" id="l-pin" inputmode="numeric" placeholder="4–12 碼" ${setup ? 'required' : ''}></label>
      <button class="btn pri" style="width:100%;min-height:46px;font-size:16px">${setup ? '建立並登入' : '進入'}</button>
    </form>
  </div>`;
  const emp = $('#l-emp');
  emp.oninput = () => { if (!setup) { $('#l-pinf').classList.add('hidden'); $('#l-pin').value = ''; } };
  setTimeout(() => emp.focus(), 30);
  $('#login-f').onsubmit = async e => {
    e.preventDefault();
    const p = Object.fromEntries(new FormData(e.target));
    const r = await run(() => setup ? api('setup', { name: p.name, empNo: p.emp, dept: p.dept, email: p.email, pin: p.pin }) : api('login', { emp: p.emp, pin: p.pin })).catch(() => null);
    if (!r) return;
    if (r.needPin) {
      $('#l-pinf').classList.remove('hidden'); $('#l-hi').textContent = r.name + ' 您好,';
      $('#l-pin').focus(); return;
    }
    store.set('lastEmp', setup ? p.emp : p.emp.trim().toUpperCase());
    S.token = r.token; S.user = r.user; store.set('token', r.token); store.set('user', r.user);
    enterApp();
  };
}
function logout(expired) {
  if (!expired && S.token) Api.call('logout', {}, S.token).catch(() => { });   // 後端作廢 token
  S.token = null; S.user = null; RCACHE.clear(); store.del('token'); store.del('user');
  if (expired) toast('登入已過期,請重新登入', true);
  showLogin('login');
}
function enterApp() {
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); $('#top').classList.remove('hidden');
  $('#who').textContent = S.user.name + (S.user.empNo ? ' ' + S.user.empNo : '') + (isAdmin() ? '(管理者)' : '');
  $('#m-pin').classList.toggle('hidden', !isAdmin());
  $('#lookup-btn').classList.remove('hidden');
  const saved = store.get('view_' + S.user.id, null);
  S.view = saved && tabsFor().some(t => t[0] === saved) ? saved : (isAdmin() ? 'dash' : 'catalog');
  if (S.user.mustChangePin) { $('#main').innerHTML = ''; renderTabs(); return pinModal(true); }
  render();
}

/* ===================== 導覽 ===================== */
function tabsFor() {
  const n = S.cart.length;
  const t = [];
  if (isAdmin()) t.push(['dash', '總覽'], ['loans', '借用單']);
  t.push(['catalog', '展品目錄'], ['plan', '展覽規劃' + (n ? ` <span class="n">${n}</span>` : '')], ['mine', '我的借用']);
  if (isAdmin()) t.push(['items', '展品管理'], ['count', '盤點'], ['users', '使用者'], ['logs', '紀錄']);
  return t;
}
function renderTabs() {
  $('#tabs').innerHTML = tabsFor().map(([k, l]) => `<button class="tab ${S.view === k ? 'on' : ''}" data-act="go" data-v="${k}">${l}</button>`).join('');
}
async function render() {
  renderTabs();
  if (S.user) store.set('view_' + S.user.id, S.view);
  const main = $('#main');
  const V = VIEWS[S.view];
  try { await V(main); } catch (e) { main.innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; }
}
function go(v) { S.view = v; window.scrollTo(0, 0); render(); }
/* ===================== 共用元件 ===================== */
function statusPill(L) {
  return `<span class="pill ${L.status}">${esc(L.statusLabel)}</span>` + (L.stage ? ` <span class="pill pending">${esc(L.stage)}</span>` : '') + (L.overdue ? ` <span class="pill bad">逾期 ${L.overdueDays} 天</span>` : '');
}
function loanCard(L, opts = {}) {
  const chk = {}; (L.check || []).forEach(c => chk[c.itemId] = c);
  const lines = L.lines.map(ln => {
    const c = chk[ln.itemId];
    const units = (ln.units || []).length ? `<div class="u">${ln.units.map(u => {
      const st = (ln.lostUnits || []).includes(u) ? '(遺失)' : (ln.returnedUnits || []).includes(u) ? '(已還)' : '';
      return esc(u) + st;
    }).join('、')}</div>` : '';
    let right = `<span class="q">× ${ln.qty}</span>`;
    if (L.status === 'out' && (ln.returned || ln.lost)) right += ` <span class="meta">已還 ${ln.returned}${ln.lost ? `・短少 ${ln.lost}` : ''}</span>`;
    if (c) right += c.short ? ` <span class="short">缺 ${c.short}(可借 ${c.available})</span>` : ` <span class="okt">足夠</span>`;
    return `<div class="line"><span class="nm">${esc(ln.name)} ${ln.mode === 'unit' ? '<span class="pill unit">逐台</span>' : ''}</span>${right}${units}</div>`;
  }).join('');
  const A = [];
  const admin = isAdmin() && !opts.mine;
  const req = L.request;
  if (admin && req) A.push(`<button class="btn sm pri" data-act="${req.type === 'pickup' ? 'checkout' : 'receive'}" data-id="${L.id}">${req.type === 'pickup' ? '確認領取' : '確認歸還'}</button>`);
  if (admin && L.status === 'pending') A.push(`<button class="btn sm danger" data-act="reject" data-id="${L.id}">駁回</button>`, `<button class="btn sm pri" data-act="approve" data-id="${L.id}">核准</button>`);
  if (admin && L.status === 'approved' && !req) A.push(`<button class="btn sm danger" data-act="reject" data-id="${L.id}">取消核准</button>`, `<button class="btn sm pri" data-act="checkout" data-id="${L.id}">點交出借</button>`);
  if (admin && L.status === 'out' && !req) A.push(`<button class="btn sm pri" data-act="receive" data-id="${L.id}">登記歸還</button>`);
  if (opts.mine) {
    if ((L.status === 'pending' || L.status === 'approved') && !req) A.push(`<button class="btn sm danger" data-act="cancel" data-id="${L.id}">取消申請</button>`);
    if (L.status === 'approved' && !req) A.push(`<button class="btn sm pri" data-act="u-pickup" data-id="${L.id}">簽收領取</button>`);
    if (L.status === 'out' && !req) A.push(`<button class="btn sm pri" data-act="u-return" data-id="${L.id}">歸還</button>`);
    if (req) A.push(`<button class="btn sm ghost" data-act="u-cancel-req" data-id="${L.id}">撤回${req.type === 'pickup' ? '簽收' : '歸還'}</button>`, `<button class="btn sm pri" data-act="u-onsite" data-id="${L.id}">請管理者當面確認</button>`);
  }
  const who = admin ? `<span>借用人 <b>${esc(L.applicant)}</b>${L.dept ? '・' + esc(L.dept) : ''}</span>${L.contact ? `<span>聯絡 ${esc(L.contact)}</span>` : ''}` : '';
  const notes = [L.purpose && '用途:' + L.purpose, L.reviewNote && '審核:' + L.reviewNote + (L.reviewer ? '(' + L.reviewer + ')' : ''), L.note && '備註:' + L.note].filter(Boolean);
  return `<div class="card" id="loan-${L.id}">
    <div class="loan-h"><span class="id">${esc(L.id)}</span><h3>${esc(L.event)}</h3>${statusPill(L)}</div>
    <div class="loan-meta">${who}<span>期間 <b>${esc(L.start)} → ${esc(L.end)}</b></span>${L.venue ? `<span>地點 ${esc(L.venue)}</span>` : ''}${L.outAt ? `<span>點交 ${esc(L.outAt)}</span>` : ''}${L.returnedAt ? `<span>歸還 ${esc(L.returnedAt)}</span>` : ''}</div>
    <div class="lines">${lines}</div>
    ${notes.length ? `<div class="note">${notes.map(esc).join('<br>')}</div>` : ''}
    ${req && opts.mine ? `<div class="banner warn" style="margin:10px 0 0;font-size:13px">已送出${req.type === 'pickup' ? '簽收' : '歸還'}(${esc(req.at)}),請交給管理者當面確認後才算完成。</div>` : ''}
    ${req && !opts.mine && isAdmin() ? `<div class="banner warn" style="margin:10px 0 0;font-size:13px">${esc(req.by)} 於 ${esc(req.at)} 送出${req.type === 'pickup' ? '簽收:' + esc(Object.values(req.units || {}).flat().join('、') || '數量品項') : '歸還'},等待確認</div>` : ''}
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
  downloadCSV(`展品庫存_${todayStr()}.csv`, [['編號', '品名', '類別', '追蹤方式', '總數', '倉庫在庫', '出借中', '已預約', '維修', '存放位置', '最後盤點', '規格', '狀態']]
    .concat(list.map(i => [i.id, i.name, i.category, i.mode === 'unit' ? '逐台編號' : '數量', i.total, i.inStock, i.out, i.reserved, i.repair || 0, i.location, i.countedAt, i.spec, i.archived ? '已下架' : '使用中'])));
}
function saveCart() { store.set('cart', S.cart); store.set('plan', S.plan); renderTabs(); }
function addToCart(itemId, qty) {
  qty = Math.max(1, parseInt(qty, 10) || 1);
  const ex = S.cart.find(c => c.itemId === itemId);
  if (ex) ex.qty += qty; else S.cart.push({ itemId, qty });
  saveCart();
}

/* ===================== 各頁面 ===================== */
const VIEWS = {};

VIEWS.catalog = main => {
  const f = S.filters, range = f.start && f.end && f.start <= f.end;
  return withData(main, 'catalog|' + (range ? f.start + '~' + f.end : ''), 'catalog', range ? { start: f.start, end: f.end } : {}, items => {
  S.items = items;
  S.cats = [...new Set(S.items.map(i => i.category))].sort();
  main.innerHTML = `<div class="eyebrow">Catalog</div><h1>展品目錄</h1><p class="sub">即時庫存。選擇日期區間可查看該期間還能借多少,再加入「展覽規劃」。</p>
    <div class="toolbar">
      <input class="grow" type="search" id="cq" placeholder="搜尋品名、規格、位置…" value="${esc(f.q)}">
      <select id="ccat" style="width:auto"><option value="">全部類別</option>${S.cats.map(c => `<option ${c === f.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      <span class="row" style="gap:6px"><input type="date" id="cs" value="${esc(f.start)}" aria-label="起"><span class="meta">→</span><input type="date" id="ce" value="${esc(f.end)}" aria-label="迄"></span>
      <label class="chk"><input type="checkbox" id="cav" ${f.onlyAvail ? 'checked' : ''}>只看可借</label>
      <button class="btn" data-act="export">${ICON.dl}<span class="lbl-hide">匯出</span></button>
    </div>
    ${range ? `<div class="banner info">顯示 <b>${esc(f.start)} → ${esc(f.end)}</b> 期間可借數量(已扣除已核准與出借中的借用)。 <a href="#" data-act="use-range">套用到展覽規劃</a></div>` : ''}
    <div class="cards" id="cgrid"></div>`;
  const draw = () => {
    const q = f.q.toLowerCase();
    const list = S.items.filter(i => (!f.cat || i.category === f.cat) && (!q || [i.name, i.spec, i.location, i.category, i.id].join(' ').toLowerCase().includes(q)) && (!f.onlyAvail || (range ? i.available : i.inStock) > 0));
    $('#cgrid').innerHTML = list.length ? list.map(i => {
      const inCart = S.cart.find(c => c.itemId === i.id);
      const av = range ? i.available : null;
      return `<div class="card item-card">
        ${i.image ? `<div class="img" style="background-image:url('${esc(i.image)}')"></div>` : ''}
        <div class="row" style="gap:6px"><span class="pill">${esc(i.category)}</span>${i.mode === 'unit' ? '<span class="pill unit">逐台編號</span>' : ''}<span class="meta mono" style="margin-left:auto">${esc(i.id)}</span></div>
        <h3>${esc(i.name)}</h3>
        ${i.spec ? `<div class="meta">${esc(i.spec)}</div>` : ''}
        <div class="meta">存放:${esc(i.location || '—')}</div>
        <div class="nums"><div class="${i.inStock ? '' : 'zero'}"><b>${i.inStock}</b>倉庫在庫</div><div><b>${i.out}</b>出借中</div><div><b>${i.reserved}</b>已預約</div><div><b>${i.total}</b>總數</div></div>
        ${range ? `<div class="avail ${av ? '' : 'none'}">期間可借 <b>${av}</b></div>` : ''}
        <div class="addrow"><input type="number" min="1" value="1" id="q-${i.id}" aria-label="數量"><button class="btn sm pri" style="flex:1" data-act="add-cart" data-id="${i.id}">${inCart ? `加入規劃(已選 ${inCart.qty})` : '加入規劃'}</button></div>
      </div>`;
    }).join('') : '<div class="empty">沒有符合的展品</div>';
  };
  draw();
  $('#cq').oninput = e => { f.q = e.target.value; draw(); };
  $('#ccat').onchange = e => { f.cat = e.target.value; draw(); };
  $('#cav').onchange = e => { f.onlyAvail = e.target.checked; draw(); };
  const dch = () => { f.start = $('#cs').value; f.end = $('#ce').value; if ((f.start && f.end) || (!f.start && !f.end)) render(); };
  $('#cs').onchange = dch; $('#ce').onchange = dch;
  });
};

VIEWS.plan = async main => {
  const all = await cachedGet('catalog|', 'catalog');
  const byId = Object.fromEntries(all.map(i => [i.id, i]));
  S.cart = S.cart.filter(c => byId[c.itemId]); saveCart();
  const P = S.plan, admin = isAdmin();
  const draft = store.get('draft', {});
  if (!S.cart.length) {
    main.innerHTML = `<div class="eyebrow">Planning</div><h1>展覽規劃</h1><p class="sub">把需要的展品加進來,系統會依日期檢查夠不夠、缺什麼,確認後直接送出借用申請。</p>
      <div class="card empty">還沒有選任何展品。<br><br><button class="btn pri" data-act="go" data-v="catalog">前往展品目錄挑選</button></div>`;
    return;
  }
  main.innerHTML = `<h1>展覽規劃</h1><p class="sub">先選日期,系統即時比對可借數量。全部足夠即可送出申請${admin ? ';口頭借用可用「代為登記」直接建單' : ''}。</p>
  <div class="plan">
    <div class="card">
      <div class="grid2"><label class="f"><span>借出日 <b>*</b></span><input type="date" id="ps" value="${esc(P.start)}"></label><label class="f"><span>歸還日 <b>*</b></span><input type="date" id="pe" value="${esc(P.end)}"></label></div>
      <div class="lines" id="plines"></div>
      <div id="psum"></div>
      <div class="row" style="margin-top:10px"><button class="btn sm" data-act="go" data-v="catalog">${ICON.plus}繼續加展品</button><button class="btn sm ghost" data-act="clear-cart">清空</button><span class="spacer"></span><button class="btn sm" data-act="copy-plan">複製清單</button></div>
    </div>
    <form class="card" id="pform">
      <label class="f"><span>活動 / 展覽名稱 <b>*</b></span><input type="text" name="event" required value="${esc(draft.event || '')}"></label>
      <div class="grid2"><label class="f"><span>地點</span><input type="text" name="venue" value="${esc(draft.venue || '')}"></label><label class="f"><span>聯絡方式</span><input type="text" name="contact" value="${esc(draft.contact || '')}" placeholder="分機 / Email"></label></div>
      <label class="f"><span>用途</span><input type="text" name="purpose" value="${esc(draft.purpose || '')}"></label>
      <label class="f"><span>備註</span><textarea name="note" rows="2">${esc(draft.note || '')}</textarea></label>
      ${admin ? `<div class="card" style="background:var(--surface-2);box-shadow:none;margin-bottom:12px">
        <label class="chk"><input type="checkbox" name="onBehalf" id="ob">代為登記(口頭借用 / 臨時借出)</label>
        <div id="obf" class="hidden" style="margin-top:10px"><div class="grid2"><label class="f"><span>借用人工號或姓名 <b>*</b></span><input type="text" name="applicant" list="ulist"></label><label class="f"><span>部門</span><input type="text" name="dept"></label></div>
        <div class="meta">代為登記會直接成為「已核准」,可立即到借用單點交。</div>
        <label class="chk" style="margin-top:8px"><input type="checkbox" name="force">數量不足仍建立</label></div>
        <datalist id="ulist"></datalist></div>` : ''}
      <button class="btn pri" style="width:100%" id="psubmit">送出借用申請</button>
    </form>
  </div>`;
  let lastCheck = [];
  const drawLines = () => {
    const ck = Object.fromEntries(lastCheck.map(c => [c.itemId, c]));
    $('#plines').innerHTML = S.cart.map(c => {
      const i = byId[c.itemId], k = ck[c.itemId];
      const st = k ? (k.short ? `<span class="short">缺 ${k.short}(可借 ${k.available})</span>` : `<span class="okt">足夠(可借 ${k.available})</span>`) : `<span class="meta">在庫 ${i.inStock}</span>`;
      return `<div class="line"><span class="nm">${esc(i.name)}<br><span class="meta">${esc(i.location || '')}</span></span>
        <span class="qtybox"><button type="button" data-act="cq" data-id="${i.id}" data-d="-1">−</button><input type="number" min="1" value="${c.qty}" data-cqi="${i.id}"><button type="button" data-act="cq" data-id="${i.id}" data-d="1">+</button></span>
        <span style="min-width:120px;text-align:right">${st}</span><button class="btn sm ghost" data-act="rm-cart" data-id="${i.id}" aria-label="移除">✕</button></div>`;
    }).join('');
    $$('[data-cqi]').forEach(inp => inp.onchange = () => { const c = S.cart.find(x => x.itemId === inp.dataset.cqi); c.qty = Math.max(1, parseInt(inp.value, 10) || 1); saveCart(); recheck(); });
    const short = lastCheck.filter(c => c.short);
    const hasRange = P.start && P.end;
    $('#psum').innerHTML = !hasRange ? `<div class="sumbar banner info">選擇日期後會檢查每項是否足夠</div>`
      : short.length ? `<div class="sumbar banner bad"><b>缺 ${short.length} 項</b>:${short.map(s => esc(s.name) + ' ×' + s.short).join('、')}</div>`
        : `<div class="sumbar banner ok"><b>全部足夠</b>,共 ${S.cart.length} 項 ${S.cart.reduce((a, c) => a + c.qty, 0)} 件</div>`;
    const force = admin && $('#pform [name=force]') && $('#pform [name=force]').checked;
    $('#psubmit').disabled = !hasRange || (short.length && !force);
  };
  const recheck = async () => {
    if (P.start && P.end && P.start <= P.end) {
      try { lastCheck = await api('check', { start: P.start, end: P.end, lines: S.cart }); } catch (e) { lastCheck = []; toast(e.message, true); }
    } else lastCheck = [];
    drawLines();
  };
  S._recheck = recheck; S._planDraw = drawLines;
  const dch = () => { P.start = $('#ps').value; P.end = $('#pe').value; if (P.start && !P.end) { P.end = P.start; $('#pe').value = P.start; } saveCart(); recheck(); };
  $('#ps').onchange = dch; $('#pe').onchange = dch;
  $('#pform').oninput = () => { const fd = Object.fromEntries(new FormData($('#pform'))); store.set('draft', { event: fd.event, venue: fd.venue, contact: fd.contact, purpose: fd.purpose, note: fd.note }); drawLines(); };
  if (admin) {
    $('#ob').onchange = e => $('#obf').classList.toggle('hidden', !e.target.checked);
    api('users').then(us => { $('#ulist').innerHTML = us.filter(u => u.active).map(u => `<option value="${esc(u.empNo)}">${esc(u.name)} ${esc(u.dept || '')}</option>`).join(''); }).catch(() => { });
  }
  $('#pform').onsubmit = async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const payload = { ...fd, start: P.start, end: P.end, lines: S.cart, onBehalf: !!fd.onBehalf, force: !!fd.force };
    if (payload.onBehalf && !String(fd.applicant || '').trim()) return toast('請填寫借用人', true);
    const L = await run(() => api('createLoan', payload)).catch(() => null);
    if (!L) return;
    S.cart = []; store.del('draft'); saveCart();
    openModal(`<h2>${L.status === 'approved' ? '已建立借用單' : '申請已送出'}</h2>
      <p>單號 <b class="mono">${esc(L.id)}</b>。${L.status === 'approved' ? '已直接核准,可前往借用單進行點交。' : '管理者核准後會通知你(有填 Email 的話),可在「我的借用」查看進度。'}</p>
      <div class="modal-f"><button class="btn" data-act="close">留在此頁</button><button class="btn pri" data-act="go" data-v="${L.status === 'approved' ? 'loans' : 'mine'}" data-f="${L.status}">查看借用單</button></div>`);
    render();
  };
  recheck();
};

VIEWS.mine = main => withData(main, 'mine', 'myLoans', {}, list => {
  const act = list.filter(l => ['pending', 'approved', 'out'].includes(l.status)), past = list.filter(l => !act.includes(l));
  main.innerHTML = `<div class="eyebrow">My Loans</div><h1>我的借用</h1><p class="sub">申請進度、借用中的展品與歸還日。</p>
    ${act.some(l => l.overdue) ? '<div class="banner bad">你有逾期未歸還的展品,請儘速歸還。</div>' : ''}
    <h2>進行中(${act.length})</h2><div class="loans">${act.map(l => loanCard(l, { mine: true })).join('') || '<div class="card empty">目前沒有進行中的借用</div>'}</div>
    <h2>歷史紀錄</h2><div class="loans">${past.map(l => loanCard(l, { mine: true })).join('') || '<div class="card empty">尚無紀錄</div>'}</div>`;
});

VIEWS.dash = main => withData(main, 'dash', 'dashboard', {}, d => {
  const s = d.sum;
  const kpi = (icon, label, value, cls, act, f) =>
    `<div class="card kpi ${cls || ''}" ${act ? `data-act="${act}" data-f="${f}" style="cursor:pointer"` : ''}>
      <div class="box">${icon}</div><div><div class="l">${label}</div><div class="v">${value}</div></div></div>`;
  main.innerHTML = `<div class="row"><div><div class="eyebrow">Inventory &amp; Loans</div><h1>展品借用與庫存追蹤</h1><p class="sub">${esc(d.today)}・主管問「還有幾個」,看這裡或匯出庫存表。</p></div><span class="spacer"></span><button class="btn" data-act="export">${ICON.dl}匯出庫存表</button></div>
    <div class="kpis">
      ${kpi(ICON.layers, '展品品項', s.items)}
      ${kpi(ICON.cube, '總件數', s.total)}
      ${kpi(ICON.home, '倉庫在庫', s.inStock)}
      ${kpi(ICON.out, '出借中', s.out)}
      ${kpi(ICON.clock, '待審核', d.pending.length, d.pending.length ? 'warn' : '', 'go-loans', 'pending')}
      ${kpi(ICON.alert, '逾期未還', d.overdue.length, d.overdue.length ? 'bad' : '', 'go-loans', 'overdue')}
      ${kpi(ICON.check, '待確認簽收/歸還', d.requests.length, d.requests.length ? 'warn' : '', 'go-loans', 'request')}
      ${kpi(ICON.wrench, '維修 / 遺失', s.repair + ' / ' + s.lost)}
    </div>
    ${d.requests.length ? `<div class="card" style="margin-top:14px;border-color:var(--warn-soft)"><h2 style="margin-top:0">等待確認的簽收 / 歸還</h2>${d.requests.map(l => miniRow(l, `<span class="pill pending">${esc(l.stage)}</span>`)).join('')}</div>` : ''}
    <div class="cols" style="margin-top:14px">
      <div class="card"><h2 style="margin-top:0">逾期未還</h2>${d.overdue.map(l => miniRow(l, `<span class="pill bad">逾期 ${l.overdueDays} 天</span>`)).join('') || '<div class="empty">沒有逾期,很好</div>'}</div>
      <div class="card"><h2 style="margin-top:0">待審核</h2>${d.pending.map(l => miniRow(l)).join('') || '<div class="empty">沒有待審核的申請</div>'}</div>
      <div class="card"><h2 style="margin-top:0">3 天內要點交</h2>${d.pickups.map(l => miniRow(l, `<span class="pill approved">${fmtD(l.start)} 領</span>`)).join('') || '<div class="empty">無</div>'}</div>
      <div class="card"><h2 style="margin-top:0">3 天內到期</h2>${d.dueSoon.map(l => miniRow(l, `<span class="pill out">${fmtD(l.end)} 還</span>`)).join('') || '<div class="empty">無</div>'}</div>
    </div>
    ${d.lowStock.length ? `<div class="card" style="margin-top:14px"><h2 style="margin-top:0">倉庫已無在庫</h2><div class="chips">${d.lowStock.map(i => `<span class="pill bad">${esc(i.name)}(${i.out}/${i.total} 借出)</span>`).join('')}</div></div>` : ''}`;
});

VIEWS.loans = main => withData(main, 'loans|' + S.loanFilter, 'loans', { filter: S.loanFilter }, list => {
  const F = [['request', '待確認'], ['pending', '待審核'], ['approved', '待點交'], ['out', '出借中'], ['overdue', '逾期'], ['returned', '已歸還'], ['all', '全部']];
  main.innerHTML = `<div class="row"><div><div class="eyebrow">Loans</div><h1>借用單</h1><p class="sub">審核 → 點交出借 → 登記歸還。口頭借用請從「展覽規劃」代為登記。</p></div><span class="spacer"></span><button class="btn brand" data-act="go" data-v="catalog">${ICON.plus}代為登記</button></div>
    <div class="toolbar"><div class="seg">${F.map(([k, l]) => `<button class="${S.loanFilter === k ? 'on' : ''}" data-act="lf" data-f="${k}">${l}</button>`).join('')}</div>
    <input class="grow" type="search" id="lq" placeholder="搜尋單號、借用人、活動…"></div>
    <div class="loans" id="llist"></div>`;
  const draw = q => {
    q = (q || '').toLowerCase();
    const f = list.filter(l => !q || [l.id, l.applicant, l.dept, l.event, l.venue].concat(l.lines.map(x => x.name)).join(' ').toLowerCase().includes(q));
    $('#llist').innerHTML = f.map(l => loanCard(l)).join('') || '<div class="card empty">沒有符合的借用單</div>';
  };
  draw(); $('#lq').oninput = e => draw(e.target.value);
  if (S._focusLoan) { const el = $('#loan-' + S._focusLoan); if (el) { el.scrollIntoView({ block: 'center' }); el.style.outline = '2px solid var(--red)'; } S._focusLoan = null; }
});
VIEWS.items = main => withData(main, 'items', 'items', {}, list => {
  S.items = list; S.cats = [...new Set(list.map(i => i.category))].sort();
  main.innerHTML = `<div class="row"><div><div class="eyebrow">Items</div><h1>展品管理</h1><p class="sub">貴重品用「逐台編號」(每台一張 QR 標籤);道具、線材用「數量」。</p></div><span class="spacer"></span>
    <button class="btn" data-act="import">批次匯入</button><button class="btn" data-act="export">${ICON.dl}匯出</button><button class="btn brand" data-act="edit-item">${ICON.plus}新增展品</button></div>
    <div class="toolbar"><input class="grow" type="search" id="iq" placeholder="搜尋…" value="${esc(S.itemQ)}"><label class="chk"><input type="checkbox" id="iarc" ${S.showArchived ? 'checked' : ''}>顯示已下架</label></div>
    <div class="tbl-wrap"><table><thead><tr><th>編號</th><th>品名</th><th>類別</th><th>方式</th><th class="num">總數</th><th class="num">在庫</th><th class="num">借出</th><th class="num">預約</th><th>存放位置</th><th>最後盤點</th><th></th></tr></thead><tbody id="ibody"></tbody></table></div>`;
  const draw = () => {
    const q = S.itemQ.toLowerCase();
    $('#ibody').innerHTML = list.filter(i => (S.showArchived || !i.archived) && (!q || [i.id, i.name, i.category, i.location, i.spec].join(' ').toLowerCase().includes(q))).map(i => `
      <tr class="${i.archived ? 'dim' : ''}"><td class="mono">${esc(i.id)}</td><td>${esc(i.name)}</td><td>${esc(i.category)}</td><td>${i.mode === 'unit' ? '<span class="pill unit">逐台</span>' : '<span class="pill">數量</span>'}</td>
      <td class="num">${i.total}</td><td class="num"><span class="chipnum ${i.inStock ? '' : 'zero'}">${i.inStock}</span></td><td class="num">${i.out}</td><td class="num">${i.reserved}</td><td>${esc(i.location)}</td><td>${esc(i.countedAt || '—')}</td>
      <td><div class="row" style="gap:4px;flex-wrap:nowrap">${i.mode === 'unit' ? `<button class="btn sm" data-act="units" data-id="${i.id}">單台 / QR</button>` : ''}<button class="btn sm" data-act="edit-item" data-id="${i.id}">編輯</button>
      <button class="btn sm ghost" data-act="archive" data-id="${i.id}" data-on="${i.archived ? '0' : '1'}">${i.archived ? '上架' : '下架'}</button></div></td></tr>`).join('') || '<tr><td colspan="11" class="empty">尚無展品</td></tr>';
  };
  draw();
  $('#iq').oninput = e => { S.itemQ = e.target.value; draw(); };
  $('#iarc').onchange = e => { S.showArchived = e.target.checked; draw(); };
});

VIEWS.count = async main => {
  const [items, allUnits] = await Promise.all([cachedGet('items', 'items'), cachedGet('units|all', 'units')]);
  const list = items.filter(i => !i.archived);
  const unitItems = list.filter(i => i.mode === 'unit'), qtyItems = list.filter(i => i.mode === 'qty');
  const unitsBy = {};
  unitItems.forEach(i => unitsBy[i.id] = []);
  allUnits.forEach(u => { if (unitsBy[u.itemId]) unitsBy[u.itemId].push(u); });
  const seen = new Set(), scope = new Set();
  main.innerHTML = `<div class="eyebrow">Stocktake</div><h1>盤點</h1><p class="sub">「應在庫」已扣除借出中的數量。數量品項填實點數;逐台品項勾選或掃描點到的編號。未填 / 未勾選的品項不列入本次盤點。</p>
    <div class="card" style="margin-bottom:14px"><div class="row"><input class="grow" type="text" id="kscan" placeholder="輸入或用掃描槍刷編號後按 Enter(例:E0001)" style="flex:1 1 240px"><button class="btn" data-act="count-cam">${ICON.scan}相機掃描</button></div><div class="meta" id="klast" style="margin-top:6px"></div></div>
    <h2>逐台編號品項</h2><div class="cards" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">${unitItems.map(i => {
      const us = unitsBy[i.id].filter(u => u.status === 'in' || u.status === 'lost');
      return `<div class="card"><div class="row"><b style="flex:1">${esc(i.name)}</b><label class="chk"><input type="checkbox" data-scope="${i.id}">納入盤點</label></div>
        <div class="meta">應在庫 ${unitsBy[i.id].filter(u => u.status === 'in').length} 台・借出 ${i.out}・<span data-cnt="${i.id}">點到 0</span></div>
        <div class="chips">${us.map(u => `<span class="chipk" data-unit="${u.id}" data-item="${i.id}">${esc(u.id)}${u.status === 'lost' ? ' <small>遺失</small>' : ''}</span>`).join('') || '<span class="meta">無應在庫的單台</span>'}</div></div>`;
    }).join('') || '<div class="empty">無</div>'}</div>
    <h2>數量品項</h2><div class="tbl-wrap"><table><thead><tr><th>品名</th><th>存放位置</th><th class="num">應在庫</th><th class="num" style="width:120px">實點</th><th class="num">差異</th></tr></thead><tbody>
    ${qtyItems.map(i => `<tr><td>${esc(i.name)}</td><td>${esc(i.location)}</td><td class="num">${i.inStock}</td><td><input type="number" min="0" data-cnt-qty="${i.id}" data-exp="${i.inStock}" style="text-align:right"></td><td class="num" data-diff="${i.id}">—</td></tr>`).join('')}</tbody></table></div>
    <div class="card" style="margin-top:14px"><div class="row"><label class="chk"><input type="checkbox" id="kapply" checked>把差異套用到系統數量</label><label class="chk"><input type="checkbox" id="klost">未點到的單台標記為「遺失」</label><span class="spacer"></span><button class="btn pri" data-act="count-submit">完成盤點</button></div></div>`;
  const markUnit = (id, on) => {
    const el = $(`[data-unit="${id}"]`);
    if (!el) return false;
    on = on == null ? !seen.has(id) : on;
    on ? seen.add(id) : seen.delete(id); el.classList.toggle('on', on);
    const it = el.dataset.item; scope.add(it); $(`[data-scope="${it}"]`).checked = true;
    $(`[data-cnt="${it}"]`).textContent = '點到 ' + $$(`[data-item="${it}"].on`).length;
    return true;
  };
  S._countMark = code => { const ok = markUnit(code, true); $('#klast').textContent = ok ? '✓ ' + code : '✕ 找不到或不在應在庫清單:' + code; return ok; };
  $$('[data-unit]').forEach(el => el.onclick = () => markUnit(el.dataset.unit));
  $$('[data-scope]').forEach(el => el.onchange = () => el.checked ? scope.add(el.dataset.scope) : scope.delete(el.dataset.scope));
  $('#kscan').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); S._countMark(e.target.value.trim().toUpperCase()); e.target.value = ''; } };
  $$('[data-cnt-qty]').forEach(inp => inp.oninput = () => {
    const d = $(`[data-diff="${inp.dataset.cntQty}"]`);
    if (inp.value === '') { d.textContent = '—'; d.style.color = ''; return; }
    const v = +inp.value - +inp.dataset.exp; d.textContent = (v > 0 ? '+' : '') + v; d.style.color = v ? 'var(--bad)' : 'var(--ok)';
  });
  S._countSubmit = async () => {
    const qty = $$('[data-cnt-qty]').filter(i => i.value !== '').map(i => ({ itemId: i.dataset.cntQty, counted: +i.value }));
    if (!qty.length && !scope.size) return toast('請至少填寫或勾選一項', true);
    const rep = await run(() => api('stocktake', { qty, unitItems: [...scope], seenUnits: [...seen], apply: $('#kapply').checked, markMissingLost: $('#klost').checked })).catch(() => null);
    if (!rep) return;
    const diffs = rep.qty.filter(x => x.diff);
    openModal(`<h2>盤點結果</h2>
      <div class="banner ${diffs.length || rep.missingUnits.length ? 'warn' : 'ok'}">數量品項 ${rep.qty.length} 項,差異 ${diffs.length} 項;逐台點到 ${rep.seenUnits} 台,未點到 ${rep.missingUnits.length} 台。${rep.adjusted ? '已套用 ' + rep.adjusted + ' 筆調整。' : ''}</div>
      ${diffs.length ? `<h2>數量差異</h2><div class="lines">${diffs.map(x => `<div class="line"><span class="nm">${esc(x.name)}</span><span class="q">系統 ${x.expected} → 實點 ${x.counted}(${x.diff > 0 ? '+' : ''}${x.diff})</span></div>`).join('')}</div>` : ''}
      ${rep.missingUnits.length ? `<h2>未點到的單台</h2><div class="lines">${rep.missingUnits.map(u => `<div class="line"><span class="nm mono">${esc(u.id)}</span><span>${esc(u.name)}</span><span class="u">${u.history[0] ? '最後借用:' + esc(u.history[0].applicant) + '・' + esc(u.history[0].event) + '(' + esc(u.history[0].end) + ')' : '無借用紀錄'}</span></div>`).join('')}</div>` : ''}
      <div class="modal-f"><button class="btn pri" data-act="close-render">完成</button></div>`, { noFocus: true });
  };
};

VIEWS.users = main => withData(main, 'users', 'users', {}, list => {
  main.innerHTML = `<div class="row"><div><div class="eyebrow">People</div><h1>使用者</h1><p class="sub">同仁以工號登入(不需密碼);管理者需另設 PIN。人員異動時重新匯入即可更新。</p></div><span class="spacer"></span><button class="btn" data-act="import-users">匯入人員清單</button><button class="btn brand" data-act="edit-user">${ICON.plus}新增</button></div>
    <div class="toolbar"><input class="grow" type="search" id="uq" placeholder="搜尋工號、姓名、部門…"></div>
    <div class="tbl-wrap"><table><thead><tr><th>工號</th><th>姓名</th><th>部門</th><th>Email</th><th>角色</th><th>狀態</th><th></th></tr></thead><tbody id="ubody"></tbody></table></div>`;
  S._users = list;
  const draw = q => {
    q = (q || '').toLowerCase();
    $('#ubody').innerHTML = list.filter(u => !q || [u.empNo, u.name, u.dept, u.email].join(' ').toLowerCase().includes(q)).map(u => `<tr class="${u.active ? '' : 'dim'}"><td class="mono">${esc(u.empNo)}</td><td>${esc(u.name)}</td><td>${esc(u.dept)}</td><td>${esc(u.email)}</td><td>${u.role === 'admin' ? '<span class="pill approved">管理者</span>' : '<span class="pill">使用者</span>'}</td><td>${u.active ? '啟用' : '停用'}</td>
    <td><button class="btn sm" data-act="edit-user" data-id="${u.id}">編輯</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">無資料</td></tr>';
  };
  draw(); $('#uq').oninput = e => draw(e.target.value);
});

VIEWS.logs = main => withData(main, 'logs', 'logs', { limit: 500 }, list => {
  main.innerHTML = `<div class="eyebrow">Audit log</div><h1>操作紀錄</h1><p class="sub">誰在什麼時候做了什麼。最近 500 筆,完整紀錄在試算表「操作紀錄」工作表。</p>
    <div class="toolbar"><input class="grow" type="search" id="gq" placeholder="搜尋人名、單號、動作…"></div>
    <div class="tbl-wrap"><table><thead><tr><th>時間</th><th>人員</th><th>動作</th><th>對象</th><th>內容</th></tr></thead><tbody id="gbody"></tbody></table></div>`;
  const draw = q => {
    q = (q || '').toLowerCase();
    $('#gbody').innerHTML = list.filter(l => !q || [l.user, l.action, l.ref, l.detail].join(' ').toLowerCase().includes(q)).map(l =>
      `<tr><td class="mono">${esc(l.ts)}</td><td>${esc(l.user)}</td><td>${esc(l.action)}</td><td class="mono">${esc(l.ref)}</td><td class="wrap">${esc(l.detail)}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">無紀錄</td></tr>';
  };
  draw(); $('#gq').oninput = e => draw(e.target.value);
});

/* ===================== 借用單動作 ===================== */
async function getLoan(id) { const all = await api('loans', { filter: 'all' }); return all.find(l => l.id === id); }
async function approveModal(id) {
  const L = await getLoan(id);
  const short = (L.check || []).filter(c => c.short);
  const m = openModal(`<h2>核准 ${esc(L.id)}</h2><p><b>${esc(L.event)}</b>・${esc(L.applicant)}・${esc(L.start)} → ${esc(L.end)}</p>
    ${short.length ? `<div class="banner bad">數量不足:${short.map(s => esc(s.name) + ' 缺 ' + s.short).join('、')}</div><label class="chk" style="margin-bottom:12px"><input type="checkbox" id="af">仍要核准(強制)</label>` : '<div class="banner ok">所有展品在期間內數量足夠</div>'}
    <label class="f"><span>給借用人的備註(選填)</span><input type="text" id="an" placeholder="例:請於 9:00 到湖口倉領取"></label>
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" id="ago">核准</button></div>`);
  $('#ago', m).onclick = async () => { await run(() => api('approve', { id, note: $('#an', m).value, force: $('#af', m) && $('#af', m).checked }), '已核准').then(() => { closeModal(); render(); }).catch(() => { }); };
}
function rejectModal(id) {
  const m = openModal(`<h2>駁回 / 取消 ${esc(id)}</h2><label class="f"><span>原因 <b>*</b></span><textarea id="rn" rows="3"></textarea></label>
    <div class="modal-f"><button class="btn" data-act="close">返回</button><button class="btn pri" id="rgo" style="background:var(--bad);border-color:var(--bad);color:#fff">確認駁回</button></div>`);
  $('#rgo', m).onclick = () => run(() => api('reject', { id, note: $('#rn', m).value }), '已駁回').then(() => { closeModal(); render(); }).catch(() => { });
}
async function checkoutModal(id) {
  const L = await getLoan(id);
  const unitLines = L.lines.filter(l => l.mode === 'unit');
  const pools = {};
  await Promise.all(unitLines.map(async l => { pools[l.itemId] = (await api('units', { itemId: l.itemId })).filter(u => u.status === 'in'); }));
  const pick = {}; unitLines.forEach(l => pick[l.itemId] = []);
  const m = openModal(`<h2>${L.request ? '確認領取' : '點交出借'} ${esc(L.id)}</h2>${L.request ? `<div class="banner warn" style="font-size:13px">${esc(L.request.by)} 已送出簽收,以下為他選的編號,核對實物後確認。</div>` : ''}<p><b>${esc(L.event)}</b>・借用人 ${esc(L.applicant)}・應還 ${esc(L.end)}</p>
    ${unitLines.length ? `<div class="row" style="margin-bottom:10px"><input type="text" id="cscan" placeholder="輸入 / 刷編號後 Enter" style="flex:1"><button class="btn" id="ccam">${ICON.scan}掃描</button></div>` : ''}
    <div class="lines">${L.lines.map(l => l.mode === 'unit' ? `<div class="line" style="display:block"><div class="row"><b style="flex:1">${esc(l.name)}</b><span data-pc="${l.itemId}" class="short">已選 0 / ${l.qty}</span></div>
      <div class="chips">${pools[l.itemId].map(u => `<span class="chipk" data-pick="${u.id}" data-it="${l.itemId}">${esc(u.id)}${u.serial ? ' <small>' + esc(u.serial) + '</small>' : ''}</span>`).join('') || '<span class="short">沒有在庫的單台</span>'}</div></div>`
      : `<div class="line"><span class="nm">${esc(l.name)}</span><span class="q">× ${l.qty}</span></div>`).join('')}</div>
    <label class="f" style="margin-top:12px"><span>點交備註</span><input type="text" id="cn" placeholder="外觀、配件狀況…"></label>
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" id="cgo">確認出借</button></div>`, { wide: true, noFocus: true });
  const upd = () => unitLines.forEach(l => { const el = $(`[data-pc="${l.itemId}"]`, m); const n = pick[l.itemId].length; el.textContent = `已選 ${n} / ${l.qty}`; el.className = n === +l.qty ? 'okt' : 'short'; });
  const toggle = (uid, force) => {
    const el = $(`[data-pick="${uid}"]`, m); if (!el) return false;
    const it = el.dataset.it, arr = pick[it], has = arr.includes(uid);
    const line = unitLines.find(l => l.itemId === it);
    if (has && force !== true) arr.splice(arr.indexOf(uid), 1);
    else if (!has) { if (arr.length >= +line.qty) { toast(line.name + ' 已選滿', true); return false; } arr.push(uid); }
    el.classList.toggle('on', arr.includes(uid)); upd(); return true;
  };
  // 使用者已送出簽收 → 用他選的編號;否則自動挑前 N 台
  const preset = L.request && L.request.type === 'pickup' ? L.request.units || {} : null;
  unitLines.forEach(l => (preset ? (preset[l.itemId] || []) : pools[l.itemId].slice(0, l.qty).map(u => u.id)).forEach(uid => toggle(uid)));
  $$('[data-pick]', m).forEach(el => el.onclick = () => toggle(el.dataset.pick));
  const sc = $('#cscan', m);
  if (sc) {
    sc.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const c = sc.value.trim().toUpperCase(); if (!toggle(c, true)) toast('此單沒有可選的 ' + c, true); sc.value = ''; } };
    $('#ccam', m).onclick = () => {
      unitLines.forEach(l => { pick[l.itemId].slice().forEach(u => toggle(u)); });
      openScanner(code => { if (!toggle(code, true)) toast('不在可選清單:' + code, true); });
    };
  }
  $('#cgo', m).onclick = () => run(() => api('checkout', { id, units: pick, note: $('#cn', m).value }), '已點交出借').then(() => { closeModal(); render(); }).catch(() => { });
}
async function receiveModal(id) {
  const L = await getLoan(id);
  const open = L.lines.filter(l => l.outstanding > 0);
  const m = openModal(`<h2>${L.request ? '確認歸還' : '登記歸還'} ${esc(L.id)}</h2>${L.request ? `<div class="banner warn" style="font-size:13px">${esc(L.request.by)} 已送出歸還,以下為他填的狀況,核對實物後可修改再確認。</div>` : ''}<p><b>${esc(L.event)}</b>・${esc(L.applicant)}・應還 ${esc(L.end)} ${L.overdue ? '<span class="pill bad">逾期</span>' : ''}</p>
    <div class="lines">${open.map(l => {
      if (l.mode === 'unit') {
        const pend = l.units.filter(u => !l.returnedUnits.includes(u) && !l.lostUnits.includes(u));
        return `<div class="line" style="display:block"><b>${esc(l.name)}</b>${pend.map(u => `<div class="row" style="margin:6px 0"><span class="mono" style="min-width:70px">${esc(u)}</span>
          <div class="seg" data-ru="${u}" data-it="${l.itemId}">${[['in', '歸還'], ['repair', '送修'], ['lost', '遺失'], ['', '未還']].map(([k, t], i) => `<button type="button" data-v="${k}" class="${i === 0 ? 'on' : ''}">${t}</button>`).join('')}</div></div>`).join('')}</div>`;
      }
      return `<div class="line"><span class="nm">${esc(l.name)}<br><span class="meta">未還 ${l.outstanding}</span></span>
        <label class="meta">歸還 <input type="number" min="0" max="${l.outstanding}" value="${l.outstanding}" data-rq="${l.itemId}" style="width:80px"></label>
        <label class="meta">短少 <input type="number" min="0" max="${l.outstanding}" value="0" data-rl="${l.itemId}" style="width:80px"></label></div>`;
    }).join('')}</div>
    <label class="f" style="margin-top:12px"><span>備註</span><input type="text" id="rn2" placeholder="損壞狀況、短少原因…"></label>
    <p class="meta">「未還」的項目會保留在借用單上,之後可再登記。</p>
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" id="rgo2">確認</button></div>`, { wide: true, noFocus: true });
  $$('.seg[data-ru] button', m).forEach(b => b.onclick = () => { $$('button', b.parentNode).forEach(x => x.classList.remove('on')); b.classList.add('on'); });
  if (L.request && L.request.type === 'return') {
    const rq = {}; (L.request.lines || []).forEach(x => rq[x.itemId] = x);
    $$('.seg[data-ru]', m).forEach(sg => {
      const x = rq[sg.dataset.it], r = x && (x.unitResults || []).find(u => u.id === sg.dataset.ru);
      const v = r ? r.result : '';
      $$('button', sg).forEach(b => b.classList.toggle('on', b.dataset.v === v));
    });
    open.filter(l => l.mode !== 'unit').forEach(l => { const x = rq[l.itemId] || { returned: 0, lost: 0 }; $(`[data-rq="${l.itemId}"]`, m).value = x.returned || 0; $(`[data-rl="${l.itemId}"]`, m).value = x.lost || 0; });
  }
  $('#rgo2', m).onclick = () => {
    const lines = open.map(l => l.mode === 'unit'
      ? { itemId: l.itemId, unitResults: $$(`.seg[data-it="${l.itemId}"]`, m).map(sg => ({ id: sg.dataset.ru, result: $('button.on', sg).dataset.v })).filter(r => r.result) }
      : { itemId: l.itemId, returned: +$(`[data-rq="${l.itemId}"]`, m).value || 0, lost: +$(`[data-rl="${l.itemId}"]`, m).value || 0 });
    run(() => api('receive', { id, lines, note: $('#rn2', m).value })).then(r => { toast(r.status === 'returned' ? '已全部歸還' : '已登記部分歸還'); closeModal(); render(); }).catch(() => { });
  };
}

/* ===================== 展品 / 單台 ===================== */
function itemModal(id) {
  const i = id ? S.items.find(x => x.id === id) : { mode: 'qty', qty: 0, category: '' };
  const m = openModal(`<h2>${id ? '編輯展品 ' + esc(id) : '新增展品'}</h2><form id="itf">
    <label class="f"><span>品名 <b>*</b></span><input type="text" name="name" required value="${esc(i.name || '')}"></label>
    <div class="grid2"><label class="f"><span>類別</span><input type="text" name="category" list="catl" value="${esc(i.category || '')}"><datalist id="catl">${S.cats.map(c => `<option>${esc(c)}</option>`).join('')}</datalist></label>
    <label class="f"><span>存放位置</span><input type="text" name="location" value="${esc(i.location || '')}" placeholder="例:湖口 B 倉 A-01"></label></div>
    <label class="f"><span>追蹤方式</span><div class="seg" id="mseg">${[['unit', '逐台編號(貴重品)'], ['qty', '只記數量(道具 / 配件)']].map(([k, t]) => `<button type="button" data-m="${k}" class="${i.mode === k ? 'on' : ''}" ${id && i.mode === 'unit' && k === 'qty' && i.total ? 'disabled' : ''}>${t}</button>`).join('')}</div></label>
    <label class="f" id="fq"><span>${id ? '持有數量' : '數量'}</span><input type="number" min="0" name="qty" value="${i.qty || 0}"></label>
    ${id ? '' : '<label class="f" id="fu"><span>建立幾台(會自動產生 E0001 這類編號,可印 QR 標籤)</span><input type="number" min="0" max="200" name="unitCount" value="1"></label>'}
    <label class="f"><span>規格 / 配件</span><input type="text" name="spec" value="${esc(i.spec || '')}"></label>
    <label class="f"><span>圖片網址(選填)</span><input type="text" name="image" value="${esc(i.image || '')}" placeholder="https://…"></label>
    <label class="f"><span>備註</span><input type="text" name="note" value="${esc(i.note || '')}"></label>
    <div class="modal-f"><button type="button" class="btn" data-act="close">取消</button><button class="btn pri">儲存</button></div></form>`);
  let mode = i.mode;
  const sync = () => { $('#fq', m).classList.toggle('hidden', mode !== 'qty'); const fu = $('#fu', m); if (fu) fu.classList.toggle('hidden', mode !== 'unit'); $$('#mseg button', m).forEach(b => b.classList.toggle('on', b.dataset.m === mode)); };
  $$('#mseg button', m).forEach(b => b.onclick = () => { mode = b.dataset.m; sync(); }); sync();
  $('#itf', m).onsubmit = e => {
    e.preventDefault();
    const item = { ...Object.fromEntries(new FormData(e.target)), id: id || '', mode };
    run(() => api('saveItem', { item }), '已儲存').then(() => { closeModal(); render(); }).catch(() => { });
  };
}
async function unitsModal(itemId) {
  const it = S.items.find(x => x.id === itemId);
  const us = await api('units', { itemId });
  const m = openModal(`<h2>${esc(it.name)}・單台編號</h2>
    <div class="toolbar"><label class="chk"><input type="checkbox" id="uall">全選</label><button class="btn sm" id="uqr">${ICON.qr}列印選取的 QR 標籤</button><span class="spacer"></span>
    <input type="number" min="1" max="200" value="1" id="uadd-n" style="width:80px"><button class="btn sm pri" id="uadd">${ICON.plus}新增台數</button></div>
    <div class="tbl-wrap"><table><thead><tr><th></th><th>編號</th><th>序號</th><th>狀態</th><th>目前在誰手上</th><th>位置</th><th>備註</th><th></th></tr></thead><tbody>
    ${us.map(u => `<tr data-row="${u.id}"><td><input type="checkbox" data-qr="${u.id}"></td><td class="mono"><a href="#" data-act="lookup-code" data-code="${u.id}">${esc(u.id)}</a></td>
      <td><input type="text" data-f="serial" value="${esc(u.serial)}" style="width:120px"></td>
      <td>${u.status === 'out' ? '<span class="pill out">借出</span>' : `<select data-f="status" style="width:auto">${Object.entries({ in: '在庫', repair: '維修', lost: '遺失', retired: '報廢' }).map(([k, t]) => `<option value="${k}" ${u.status === k ? 'selected' : ''}>${t}</option>`).join('')}</select>`}</td>
      <td>${u.holder ? `${esc(u.holder.applicant)}${u.holder.dept ? '・' + esc(u.holder.dept) : ''}<br><span class="meta">${esc(u.holder.event)}・還 ${esc(u.holder.end)}</span>${u.holder.overdue ? ' <span class="pill bad">逾期</span>' : ''}` : '—'}</td>
      <td><input type="text" data-f="location" value="${esc(u.location)}" style="width:130px"></td><td><input type="text" data-f="note" value="${esc(u.note)}" style="width:140px"></td>
      <td><button class="btn sm" data-save-unit="${u.id}">存</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">尚無單台</td></tr>'}</tbody></table></div>
    <div class="modal-f"><button class="btn" data-act="close-render">關閉</button></div>`, { wide: true, noFocus: true });
  $('#uall', m).onchange = e => $$('[data-qr]', m).forEach(c => c.checked = e.target.checked);
  $('#uqr', m).onclick = () => { const ids = $$('[data-qr]:checked', m).map(c => c.dataset.qr); if (!ids.length) return toast('請先勾選要列印的編號', true); printLabels(ids.map(id => ({ id, name: it.name, serial: (us.find(u => u.id === id) || {}).serial }))); };
  $('#uadd', m).onclick = () => run(() => api('addUnits', { itemId, count: +$('#uadd-n', m).value }), '已新增').then(() => unitsModal(itemId)).catch(() => { });
  $$('[data-save-unit]', m).forEach(b => b.onclick = () => {
    const tr = b.closest('tr'), unit = { id: b.dataset.saveUnit };
    $$('[data-f]', tr).forEach(f => unit[f.dataset.f] = f.value);
    run(() => api('saveUnit', { unit }), '已更新 ' + unit.id).catch(() => { });
  });
}
async function printLabels(list) {
  await run(() => loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'));
  const tmp = document.createElement('div'); tmp.style.cssText = 'position:absolute;left:-9999px'; document.body.appendChild(tmp);
  const imgs = list.map(x => {
    const d = document.createElement('div'); tmp.appendChild(d);
    new QRCode(d, { text: x.id, width: 256, height: 256, correctLevel: QRCode.CorrectLevel.M });
    const c = d.querySelector('canvas'); return c ? c.toDataURL('image/png') : '';
  });
  tmp.remove();
  const w = window.open('', '_blank');
  if (!w) return toast('請允許彈出視窗以列印標籤', true);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR 標籤</title><style>
    body{font-family:-apple-system,"PingFang TC","Microsoft JhengHei",sans-serif;margin:10mm}
    .g{display:grid;grid-template-columns:repeat(4,1fr);gap:4mm}.l{border:1px dashed #999;padding:3mm;text-align:center;break-inside:avoid}
    .l img{width:32mm;height:32mm}.id{font:700 14px ui-monospace,Menlo,monospace}.n{font-size:10px;color:#333}
    @media print{.tip{display:none}}</style></head><body><p class="tip">建議用 A4 貼紙列印,或印出後裁切、以透明膠帶貼在展品不顯眼處。</p>
    <div class="g">${list.map((x, i) => `<div class="l"><img src="${imgs[i]}"><div class="id">${esc(x.id)}</div><div class="n">${esc(x.name)}${x.serial ? '<br>' + esc(x.serial) : ''}</div></div>`).join('')}</div>
    <script>setTimeout(function(){window.print()},400)<\/script></body></html>`);
  w.document.close();
}
function importModal() {
  const m = openModal(`<h2>批次匯入展品</h2><p class="sub">從 Excel 直接複製貼上(含或不含標題列皆可)。欄位順序:<br><b>品名、類別、方式(數量 / 逐台)、數量、存放位置、規格、備註</b></p>
    <textarea id="imt" rows="10" placeholder="42吋電子紙看板	大尺寸看板	逐台	4	湖口B倉	含壁掛架&#10;展示立架	陳列道具	數量	20	湖口B倉"></textarea><div class="meta" id="imp"></div>
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" id="imgo">匯入</button></div>`, { wide: true });
  const parse = () => $('#imt', m).value.split(/\r?\n/).map(r => r.split(r.includes('\t') ? '\t' : ',').map(x => x.trim())).filter(r => r[0] && r[0] !== '品名')
    .map(r => ({ name: r[0], category: r[1], mode: r[2], qty: r[3], location: r[4], spec: r[5], note: r[6] }));
  $('#imt', m).oninput = () => { const r = parse(); $('#imp', m).textContent = r.length ? `將匯入 ${r.length} 項(逐台 ${r.filter(x => /逐|unit/i.test(x.mode || '')).length} 項)` : ''; };
  $('#imgo', m).onclick = () => { const rows = parse(); if (!rows.length) return toast('沒有可匯入的資料', true); run(() => api('importItems', { rows })).then(r => { toast(`已匯入 ${r.created} 項`); closeModal(); render(); }).catch(() => { }); };
}
function userModal(id) {
  const u = id ? S._users.find(x => x.id === id) : { role: 'user', active: true };
  const m = openModal(`<h2>${id ? '編輯使用者' : '新增使用者'}</h2><form id="uf">
    <div class="grid2"><label class="f"><span>工號 <b>*</b></span><input type="text" name="empNo" required value="${esc(u.empNo || '')}"></label><label class="f"><span>姓名 <b>*</b></span><input type="text" name="name" required value="${esc(u.name || '')}"></label></div>
    <div class="grid2"><label class="f"><span>部門</span><input type="text" name="dept" value="${esc(u.dept || '')}"></label><label class="f"><span>Email(接收通知)</span><input type="email" name="email" value="${esc(u.email || '')}"></label></div>
    <div class="grid2"><label class="f"><span>角色</span><select name="role" id="ur"><option value="user">使用者(只輸工號)</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>管理者(工號+PIN)</option></select></label>
    <label class="f" id="upf"><span>${u.hasPin ? '重設 PIN(留空不變)' : '管理者 PIN <b>*</b>'}</span><input type="text" name="pin" placeholder="4–12 碼"></label></div>
    ${id ? `<label class="chk"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}>啟用(離職可取消勾選)</label>` : ''}
    <div class="modal-f"><button type="button" class="btn" data-act="close">取消</button><button class="btn pri">儲存</button></div></form>`);
  const sync = () => $('#upf', m).classList.toggle('hidden', $('#ur', m).value !== 'admin');
  $('#ur', m).onchange = sync; sync();
  $('#uf', m).onsubmit = e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    if (fd.role !== 'admin') fd.pin = '';
    run(() => api('saveUser', { user: { ...fd, id: id || '', active: id ? !!fd.active : true } }), '已儲存').then(() => { closeModal(); render(); }).catch(() => { });
  };
}
function importUsersModal() {
  const m = openModal(`<h2>匯入人員清單</h2><p class="sub">從 Excel / HR 名單直接複製貼上。欄位順序:<br><b>工號、姓名、部門、Email、在職(選填,填「離職」會停用)</b><br>已存在的工號會更新姓名 / 部門 / Email,不會動到角色。</p>
    <textarea id="iut" rows="10" placeholder="A001	員工001	業務部	a001@example.com&#10;A002	員工002	產品部"></textarea><div class="meta" id="iup"></div>
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" id="iugo">匯入</button></div>`, { wide: true });
  const parse = () => $('#iut', m).value.split(/\r?\n/).map(r => r.split(r.includes('\t') ? '\t' : ',').map(x => x.trim())).filter(r => r[0] && r[1] && r[0] !== '工號')
    .map(r => ({ empNo: r[0], name: r[1], dept: r[2], email: r[3], active: r[4] }));
  $('#iut', m).oninput = () => { const r = parse(); const have = new Set((S._users || []).map(u => String(u.empNo).toUpperCase())); $('#iup', m).textContent = r.length ? `共 ${r.length} 人:新增 ${r.filter(x => !have.has(x.empNo.toUpperCase())).length}、更新 ${r.filter(x => have.has(x.empNo.toUpperCase())).length}` : ''; };
  $('#iugo', m).onclick = () => { const rows = parse(); if (!rows.length) return toast('沒有可匯入的資料', true); run(() => api('importUsers', { rows })).then(r => { toast(`新增 ${r.created} 人、更新 ${r.updated} 人`); closeModal(); render(); }).catch(() => { }); };
}

/* ===================== 使用者自助:簽收 / 歸還 / 當面確認 ===================== */
async function myLoan(id) { return (await api('myLoans')).find(l => l.id === id); }
async function userPickupModal(id) {
  const L = await myLoan(id);
  const opts = await api('pickupOptions', { id });
  const unitLines = opts.filter(o => o.mode === 'unit');
  const pick = {}; unitLines.forEach(o => pick[o.itemId] = []);
  const m = openModal(`<h2>簽收領取 ${esc(L.id)}</h2><p><b>${esc(L.event)}</b>・應還 ${esc(L.end)}</p>
    ${unitLines.length ? `<div class="banner info" style="font-size:13px">請掃描或點選你實際拿到的那幾台(看展品上的 QR 標籤編號)。</div>
    <div class="row" style="margin-bottom:10px"><input type="text" id="pscan" placeholder="輸入編號後 Enter" style="flex:1"><button class="btn" id="pcam">${ICON.scan}掃描</button></div>` : ''}
    <div class="lines">${opts.map(o => o.mode === 'unit' ? `<div class="line" style="display:block"><div class="row"><b style="flex:1">${esc(o.name)}</b><span data-pc="${o.itemId}" class="short">已選 0 / ${o.qty}</span></div>
      <div class="chips">${o.units.map(u => `<span class="chipk" data-pick="${u.id}" data-it="${o.itemId}">${esc(u.id)}${u.serial ? ' <small>' + esc(u.serial) + '</small>' : ''}</span>`).join('') || '<span class="short">目前沒有在庫的單台,請聯絡管理者</span>'}</div></div>`
      : `<div class="line"><span class="nm">${esc(o.name)}</span><span class="q">× ${o.qty}</span></div>`).join('')}</div>
    <label class="f" style="margin-top:12px"><span>備註</span><input type="text" id="pn" placeholder="外觀、配件狀況…"></label>
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" id="pgo2">確認簽收</button></div>`, { wide: true, noFocus: true });
  const upd = () => unitLines.forEach(o => { const el = $(`[data-pc="${o.itemId}"]`, m); const n = pick[o.itemId].length; el.textContent = `已選 ${n} / ${o.qty}`; el.className = n === o.qty ? 'okt' : 'short'; });
  const toggle = (uid, force) => {
    const el = $(`[data-pick="${uid}"]`, m); if (!el) return false;
    const it = el.dataset.it, arr = pick[it], has = arr.includes(uid), o = unitLines.find(x => x.itemId === it);
    if (has && force !== true) arr.splice(arr.indexOf(uid), 1);
    else if (!has) { if (arr.length >= o.qty) { toast(o.name + ' 已選滿 ' + o.qty + ' 台,請先取消一台', true); return false; } arr.push(uid); }
    el.classList.toggle('on', arr.includes(uid)); upd(); return true;
  };
  upd();
  $$('[data-pick]', m).forEach(el => el.onclick = () => toggle(el.dataset.pick));
  const sc = $('#pscan', m);
  if (sc) {
    sc.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const c = sc.value.trim().toUpperCase(); if (!toggle(c, true)) toast('這筆借用不能選 ' + c, true); sc.value = ''; } };
    $('#pcam', m).onclick = () => openScanner(code => { if (!toggle(code, true)) toast('不在可選清單:' + code, true); });
  }
  $('#pgo2', m).onclick = () => run(() => api('requestPickup', { id, units: pick, note: $('#pn', m).value })).then(() => onsiteModal(id, 'pickup')).catch(() => { });
}
async function userReturnModal(id) {
  const L = await myLoan(id);
  const open = L.lines.filter(l => l.outstanding > 0);
  const m = openModal(`<h2>歸還 ${esc(L.id)}</h2><p><b>${esc(L.event)}</b>・應還 ${esc(L.end)} ${L.overdue ? '<span class="pill bad">逾期</span>' : ''}</p>
    <div class="lines">${open.map(l => {
      if (l.mode === 'unit') {
        const pend = l.units.filter(u => !l.returnedUnits.includes(u) && !l.lostUnits.includes(u));
        return `<div class="line" style="display:block"><b>${esc(l.name)}</b>${pend.map(u => `<div class="row" style="margin:6px 0"><span class="mono" style="min-width:70px">${esc(u)}</span>
          <div class="seg" data-ru="${u}" data-it="${l.itemId}">${[['in', '歸還'], ['repair', '有損壞'], ['lost', '遺失'], ['', '先不還']].map(([k, t], i) => `<button type="button" data-v="${k}" class="${i === 0 ? 'on' : ''}">${t}</button>`).join('')}</div></div>`).join('')}</div>`;
      }
      return `<div class="line"><span class="nm">${esc(l.name)}<br><span class="meta">未還 ${l.outstanding}</span></span>
        <label class="meta">歸還 <input type="number" min="0" max="${l.outstanding}" value="${l.outstanding}" data-rq="${l.itemId}" style="width:80px"></label>
        <label class="meta">短少 <input type="number" min="0" max="${l.outstanding}" value="0" data-rl="${l.itemId}" style="width:80px"></label></div>`;
    }).join('')}</div>
    <label class="f" style="margin-top:12px"><span>備註</span><input type="text" id="un2" placeholder="損壞狀況、短少原因…"></label>
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" id="ugo2">送出歸還</button></div>`, { wide: true, noFocus: true });
  $$('.seg[data-ru] button', m).forEach(b => b.onclick = () => { $$('button', b.parentNode).forEach(x => x.classList.remove('on')); b.classList.add('on'); });
  $('#ugo2', m).onclick = () => {
    const lines = open.map(l => l.mode === 'unit'
      ? { itemId: l.itemId, unitResults: $$(`.seg[data-it="${l.itemId}"]`, m).map(sg => ({ id: sg.dataset.ru, result: $('button.on', sg).dataset.v })).filter(r => r.result) }
      : { itemId: l.itemId, returned: +$(`[data-rq="${l.itemId}"]`, m).value || 0, lost: +$(`[data-rl="${l.itemId}"]`, m).value || 0 });
    run(() => api('requestReturn', { id, lines, note: $('#un2', m).value })).then(() => onsiteModal(id, 'return')).catch(() => { });
  };
}
function onsiteModal(id, type) {
  const word = type === 'pickup' ? '領取' : '歸還';
  const m = openModal(`<h2>請管理者當面確認${word}</h2>
    <p class="sub">把畫面交給展品管理者,輸入管理者工號與 PIN 即完成${word}。<br>管理者不在場也沒關係,已送出的申請會出現在管理者後台等待確認。</p>
    <form id="osf" autocomplete="off"><div class="grid2"><label class="f"><span>管理者工號</span><input type="text" name="emp" required></label><label class="f"><span>PIN</span><input type="password" name="pin" inputmode="numeric" required></label></div>
    <div class="modal-f"><button type="button" class="btn" data-act="close-render">稍後由管理者確認</button><button class="btn pri">確認${word}</button></div></form>`);
  $('#osf', m).onsubmit = e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    run(() => api('confirmOnSite', { id, emp: fd.emp, pin: fd.pin }), `已完成${word}`).then(() => { closeModal(); render(); }).catch(() => { });
  };
}
function lookupModal(code) {
  const m = openModal(`<h2>查詢編號</h2><div class="row"><input type="text" id="lkc" placeholder="單台編號(E0001)或品項編號(P0001)" style="flex:1" value="${esc(code || '')}"><button class="btn" id="lkcam">${ICON.scan}掃描</button><button class="btn pri" id="lkgo">查詢</button></div><div id="lkr" style="margin-top:14px"></div>`);
  const go = async c => {
    c = (c || $('#lkc', m).value).trim().toUpperCase(); if (!c) return;
    $('#lkc', m).value = c;
    const r = await api('lookup', { code: c }).catch(e => { $('#lkr', m).innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; return null; });
    if (!r) return;
    if (r.type === 'item') { const i = r.item; $('#lkr', m).innerHTML = `<div class="card"><b>${esc(i.name)}</b><div class="meta">${esc(i.category)}・${esc(i.location)}</div><div class="nums"><div><b>${i.inStock}</b>在庫</div><div><b>${i.out}</b>出借中</div><div><b>${i.reserved}</b>已預約</div><div><b>${i.total}</b>總數</div></div></div>`; return; }
    const u = r.unit, L = r.loan;
    $('#lkr', m).innerHTML = `<div class="card"><div class="row"><b class="mono">${esc(u.id)}</b><span class="pill ${u.status}">${esc(r.statusLabel)}</span></div>
      <div style="margin:6px 0"><b>${esc(r.item.name)}</b>${u.serial ? '・序號 ' + esc(u.serial) : ''}</div><div class="meta">存放:${esc(u.location || r.item.location || '—')}${u.note ? '・' + esc(u.note) : ''}</div>
      ${L ? `<div class="banner ${L.overdue ? 'bad' : 'info'}" style="margin-top:10px">目前在 <b>${esc(L.applicant)}</b>${L.dept ? '(' + esc(L.dept) + ')' : ''} 手上<br>${esc(L.event)}・應還 ${esc(L.end)}${L.overdue ? '・已逾期 ' + L.overdueDays + ' 天' : ''}${L.contact ? '<br>聯絡:' + esc(L.contact) : ''}</div>` : ''}
      ${r.history.length ? `<h2 style="font-size:14px">借用歷史</h2><ul class="hist">${r.history.map(h => `<li>${esc(h.start)} → ${esc(h.end)}|${esc(h.applicant)}|${esc(h.event)}(${esc(h.statusLabel || h.status)})</li>`).join('')}</ul>` : ''}</div>`;
  };
  $('#lkgo', m).onclick = () => go();
  $('#lkc', m).onkeydown = e => { if (e.key === 'Enter') go(); };
  $('#lkcam', m).onclick = () => openScanner(c => { go(c); return false; });
  if (code) go(code);
}
function pinModal(forced) {
  const m = openModal(`<h2>${forced ? '首次登入請變更 PIN' : '變更 PIN'}</h2>${forced ? '<div class="banner warn" style="font-size:13px">這組 PIN 是別人幫你設定的,請改成只有你知道的 PIN 才能繼續使用。</div>' : ''}
    <label class="f"><span>目前 PIN</span><input type="password" id="op"></label><label class="f"><span>新 PIN(4–12 碼)</span><input type="password" id="np"></label><label class="f"><span>再輸入一次新 PIN</span><input type="password" id="np2"></label>
    <div class="modal-f">${forced ? '<button class="btn" id="pout">登出</button>' : '<button class="btn" data-act="close">取消</button>'}<button class="btn pri" id="pgo">變更</button></div>`, { locked: forced });
  if (forced) $('#pout', m).onclick = () => { closeModal(); logout(); };
  $('#pgo', m).onclick = () => {
    if ($('#np', m).value !== $('#np2', m).value) return toast('兩次輸入的新 PIN 不一致', true);
    run(() => api('changePin', { oldPin: $('#op', m).value, newPin: $('#np', m).value }), 'PIN 已變更').then(async () => {
      closeModal();
      if (forced) { S.user = await api('me'); store.set('user', S.user); enterApp(); }
    }).catch(() => { });
  };
}

/* ===================== 事件分派 ===================== */
const ACT = {
  'go': el => { closeModal(); if (el.dataset.f === 'approved') S.loanFilter = 'approved'; go(el.dataset.v); },
  'go-loans': el => { S.loanFilter = el.dataset.f; go('loans'); },
  'open-loan': el => { S.loanFilter = el.dataset.st; if (/逾期/.test(el.textContent)) S.loanFilter = 'overdue'; if (/待確認/.test(el.textContent)) S.loanFilter = 'request'; S._focusLoan = el.dataset.id; go('loans'); },
  'lf': el => { S.loanFilter = el.dataset.f; render(); },
  'close': () => closeModal(),
  'close-render': () => { closeModal(); render(); },
  'to-register': () => showLogin('register'),
  'to-login': () => showLogin('login'),
  'export': () => run(exportStock),
  'add-cart': el => { const q = $('#q-' + el.dataset.id).value; addToCart(el.dataset.id, q); toast('已加入展覽規劃'); el.textContent = `加入規劃(已選 ${S.cart.find(c => c.itemId === el.dataset.id).qty})`; },
  'use-range': () => { S.plan.start = S.filters.start; S.plan.end = S.filters.end; saveCart(); go('plan'); },
  'rm-cart': el => { S.cart = S.cart.filter(c => c.itemId !== el.dataset.id); saveCart(); S.cart.length ? S._recheck() : render(); },
  'cq': el => { const c = S.cart.find(x => x.itemId === el.dataset.id); c.qty = Math.max(1, c.qty + +el.dataset.d); saveCart(); S._recheck(); },
  'clear-cart': () => { if (confirmInline('清空規劃清單?')) { S.cart = []; saveCart(); render(); } },
  'copy-plan': async () => {
    const all = S.items.length ? S.items : await api('catalog');
    const nm = Object.fromEntries(all.map(i => [i.id, i.name]));
    const chk = S.plan.start && S.plan.end ? await api('check', { start: S.plan.start, end: S.plan.end, lines: S.cart }).catch(() => []) : [];
    const ck = Object.fromEntries(chk.map(c => [c.itemId, c]));
    const ps = S.plan.start || '?', pe = S.plan.end || '?';   // 純文字(剪貼簿),顯示時再經 esc()
    const txt = `展覽規劃 ${ps} ~ ${pe}\n` + S.cart.map(c => `・${nm[c.itemId] || c.itemId} × ${c.qty}` + (ck[c.itemId] ? (ck[c.itemId].short ? `(缺 ${ck[c.itemId].short})` : '(足夠)') : '')).join('\n');
    try { await navigator.clipboard.writeText(txt); toast('已複製,可貼到 Email / 通訊軟體'); } catch (e) { openModal(`<h2>清單</h2><textarea rows="10">${esc(txt)}</textarea><div class="modal-f"><button class="btn" data-act="close">關閉</button></div>`); }
  },
  'approve': el => approveModal(el.dataset.id),
  'reject': el => rejectModal(el.dataset.id),
  'checkout': el => checkoutModal(el.dataset.id),
  'receive': el => receiveModal(el.dataset.id),
  'cancel': el => { if (confirmInline('確定取消這筆申請?')) run(() => api('cancelLoan', { id: el.dataset.id }), '已取消').then(render).catch(() => { }); },
  'edit-item': el => itemModal(el.dataset.id),
  'units': el => unitsModal(el.dataset.id),
  'archive': el => run(() => api('archiveItem', { id: el.dataset.id, archived: el.dataset.on === '1' }), el.dataset.on === '1' ? '已下架' : '已上架').then(render).catch(() => { }),
  'import': () => importModal(),
  'edit-user': el => userModal(el.dataset.id),
  'import-users': () => importUsersModal(),
  'u-pickup': el => userPickupModal(el.dataset.id),
  'u-return': el => userReturnModal(el.dataset.id),
  'u-onsite': el => { const L = el.closest('.card'); onsiteModal(el.dataset.id, /簽收/.test(L.textContent.match(/撤回(簽收|歸還)/)[0]) ? 'pickup' : 'return'); },
  'u-cancel-req': el => run(() => api('cancelRequest', { id: el.dataset.id }), '已撤回').then(render).catch(() => { }),
  'lookup-code': el => lookupModal(el.dataset.code),
  'count-cam': () => openScanner(c => { S._countMark(c); }),
  'count-submit': () => S._countSubmit(),
};
function confirmInline(msg) { return window.confirm(msg); }
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) { if (!e.target.closest('.menu')) $('#menu-pop').classList.add('hidden'); return; }
  if (el.tagName === 'A') e.preventDefault();
  const f = ACT[el.dataset.act]; if (f) f(el);
});
document.addEventListener('keydown', e => { const m = $('#modal-bg'); if (e.key === 'Escape' && !$('#scanner-bg') && !(m && m.dataset.locked)) closeModal(); });
/* 主題(淺色 / 深色),記在這台裝置 */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  $('#m-theme').textContent = t === 'dark' ? '淺色模式' : '深色模式';
  store.set('theme', t);
}
applyTheme(store.get('theme', 'light'));
$('#m-theme').onclick = () => { $('#menu-pop').classList.add('hidden'); applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); };
$('#lookup-btn').onclick = () => lookupModal();
$('#menu-btn').onclick = () => $('#menu-pop').classList.toggle('hidden');
$('#m-pin').onclick = () => { $('#menu-pop').classList.add('hidden'); pinModal(); };
$('#m-out').onclick = () => { $('#menu-pop').classList.add('hidden'); logout(); };
