/**
 * 【展示積木】js/ui.js
 * 輸入:後端(邏輯積木)回傳的 JSON
 * 責任:渲染畫面、收集使用者輸入、表單格式驗證;把操作交給連線積木送往守門調度
 * 輸出:{ action, payload } 請求
 * 禁止:不判斷業務規則(庫存夠不夠、能不能借都以後端回傳為準);不直接操作 Google Sheets;不存密鑰
 */
/* ===================== 狀態與工具 ===================== */
const S = {
  token: null, user: null, asUser: false, view: 'catalog', items: [], cats: [], editing: null,
  cart: [], multi: new Set(), plan: { start: '', end: '' },
  filters: { q: '', cat: '', start: '', end: '', onlyAvail: false },
  loanFilter: 'pending', itemQ: '', cat: '', site: '', showArchived: false, logQ: '',
  showId: null, showFilter: 'open', showLines: null, showPick: null
};
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isRealAdmin = () => !!(S.user && S.user.role === 'admin');
// 管理者可切到「同仁視角」預覽:畫面一律以 isAdmin() 為準,實際權限仍在後端
const isAdmin = () => isRealAdmin() && !S.asUser;
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
    if (!Api.READ.has(action)) bumpCache();           // 任何寫入 → 快取全部失效
    return data;
  } catch (e) {
    if (/登入已過期/.test(e.message)) { if (tok && tok === S.token) logout(true); e.silent = true; }
    throw e;
  } finally { busy(false); }
}

/* 讀取快取:切頁時先用上次的資料立刻畫出畫面,背景再向後端確認,有變動才重畫 */
const RCACHE = new Map();
const FRESH_MS = 15000;                 // 剛抓過的資料就直接用,不再回頭問後端
const copy = v => JSON.parse(JSON.stringify(v));
const fresh = hit => hit && Date.now() - hit.at < FRESH_MS;
/* 同一份資料同時被要兩次(例如第一次還沒回來就切了分頁)只送一次請求 */
const INFLIGHT = new Map();
/* 快取世代:寫入就 +1。出發前記下世代,回來時世代變了就代表這份資料是寫入前的,不能用 */
let CGEN = 0;
function bumpCache() { CGEN++; RCACHE.clear(); INFLIGHT.clear(); }
function cacheSet(key, data, gen) { if (gen === CGEN) RCACHE.set(key, { data, at: Date.now() }); }
function fetchOnce(key, action, payload) {
  const running = INFLIGHT.get(key);
  if (running) return running;
  const pr = api(action, payload);
  INFLIGHT.set(key, pr);
  const done = () => { if (INFLIGHT.get(key) === pr) INFLIGHT.delete(key); };
  pr.then(done, done);
  return pr;
}
/* 出發前記世代,回來時若已被寫入作廢就再抓一次(最多再一次,避免連環重試) */
async function freshFetch(key, action, payload) {
  for (let i = 0; i < 2; i++) {
    const gen = CGEN;
    const data = await fetchOnce(key, action, payload);
    if (gen === CGEN) return { data, gen };
  }
  return { data: await fetchOnce(key, action, payload), gen: CGEN };
}
async function cachedGet(key, action, payload = {}) {
  const hit = RCACHE.get(key);
  if (hit) {
    if (!fresh(hit)) freshFetch(key, action, payload).then(r => cacheSet(key, r.data, r.gen)).catch(() => { });
    return copy(hit.data);
  }
  const r = await freshFetch(key, action, payload);
  cacheSet(key, r.data, r.gen);
  return copy(r.data);
}
async function withData(main, key, action, payload, draw) {
  const hit = RCACHE.get(key), view = S.view;
  if (hit) draw(copy(hit.data));
  if (fresh(hit)) return;               // 同一批資料的不同分頁互相切換時,不用重打
  let r;
  try { r = await freshFetch(key, action, payload); }
  catch (e) { if (!hit) throw e; if (!e.silent) toast(e.message, true); return; }
  const changed = !hit || JSON.stringify(hit.data) !== JSON.stringify(r.data);
  cacheSet(key, r.data, r.gen);
  if (changed && S.view === view) draw(copy(r.data));
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
  S.showPick = store.get('showpick', null);
  if (S.showPick) { S.showId = S.showPick.id; S.showLines = store.get('showlines', []); S.view = 'catalog'; }
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
  S.token = null; S.user = null; S.asUser = false; bumpCache(); store.del('token'); store.del('user');
  if (expired) toast('登入已過期,請重新登入', true);
  showLogin('login');
}
function enterApp() {
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); $('#top').classList.remove('hidden');
  S.asUser = isRealAdmin() && !!store.get('asUser_' + S.user.id, false);
  syncRole();
  $('#lookup-btn').classList.remove('hidden');
  const saved = store.get('view_' + S.user.id, null);
  S.view = saved && tabsFor().some(t => t[0] === saved) ? saved : (isAdmin() ? 'dash' : 'catalog');
  if (S.user.mustChangePin) { $('#main').innerHTML = ''; renderTabs(); return pinModal(true); }
  render();
}

/** 依目前視角同步頁首與選單 */
function syncRole() {
  $('#who').textContent = S.user.name + (S.user.empNo ? ' ' + S.user.empNo : '') + (isAdmin() ? '(管理者)' : '');
  $('#m-pin').classList.toggle('hidden', !isAdmin());
  $('#m-view').classList.toggle('hidden', !isRealAdmin());
  $('#m-view').textContent = S.asUser ? '回到管理者視角' : '切換到同仁視角';
  $('#viewas-btn').classList.toggle('hidden', !S.asUser);
}
/** 切換管理者 / 同仁視角(只是預覽,不影響後端權限) */
function setAsUser(on) {
  if (!isRealAdmin()) return;
  S.asUser = !!on;
  store.set('asUser_' + S.user.id, S.asUser);
  syncRole();
  if (!tabsFor().some(t => t[0] === S.view)) S.view = S.asUser ? 'catalog' : 'dash';
  toast(S.asUser ? '已切換到同仁視角,看到的和一般同仁一樣' : '已回到管理者視角');
  render();
}

/* ===================== 導覽 ===================== */
function tabsFor() {
  const n = S.cart.length;
  const t = [];
  if (isAdmin()) t.push(['dash', '總覽'], ['loans', '借用單']);
  t.push(['catalog', '展品目錄'], ['plan', '展覽規劃' + (n ? ` <span class="n">${n}</span>` : '')], ['mine', '我的借用']);
  if (isAdmin()) t.push(['shows', '展覽檔期'], ['items', '展品管理'], ['count', '盤點'], ['users', '使用者'], ['logs', '紀錄']);
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
    if (req) A.push(`<button class="btn sm ghost" data-act="u-cancel-req" data-id="${L.id}">撤回${req.type === 'pickup' ? '簽收' : '歸還'}</button>`, `<button class="btn sm pri" data-act="u-onsite" data-id="${L.id}">請管理者當面確認</button>`);
  }
  const who = admin ? `<span>借用人 <b>${esc(L.applicant)}</b>${L.dept ? '・' + esc(L.dept) : ''}</span>${L.contact ? `<span>聯絡 ${esc(L.contact)}</span>` : ''}` : '';
  const notes = [L.purpose && '用途:' + L.purpose, L.reviewNote && '審核:' + L.reviewNote + (L.reviewer ? '(' + L.reviewer + ')' : ''), L.note && '備註:' + L.note].filter(Boolean);
  return `<div class="card" id="loan-${L.id}">
    <div class="loan-h"><span class="id">${esc(L.id)}</span><h3>${esc(L.event)}</h3>${statusPill(L)}</div>
    <div class="loan-meta">${who}<span>期間 <b>${esc(L.start)} → ${esc(L.end)}</b></span>${L.venue ? `<span>地點 ${esc(L.venue)}</span>` : ''}${L.outAt ? `<span>點交 ${esc(L.outAt)}</span>` : ''}${L.returnedAt ? `<span>歸還 ${esc(L.returnedAt)}</span>` : ''}</div>
    <div class="lines">${lines}</div>
    ${notes.length ? `<div class="note">${notes.map(esc).join('<br>')}</div>` : ''}
    ${opts.mine || isAdmin() ? reqBanner(req, !!opts.mine) : ''}
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
function saveCart() { store.set('cart', S.cart); store.set('plan', S.plan); renderTabs(); }
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
  const f = S.filters;
  // 為展覽挑選時,日期一律用展覽的檔期(不讓人在這裡改),可借量也要排除這場自己的卡位
  const pick = S.showPick;
  const rs = pick ? pick.from : f.start, re = pick ? pick.to : f.end;
  const range = rs && re && rs <= re;
  S.cats = await cachedGet('cats', 'cats');
  const req = range ? { start: rs, end: re } : {};
  if (pick) req.showId = pick.id;
  return withData(main, 'catalog|' + (range ? rs + '~' + re : '') + (pick ? '|show=' + pick.id : ''), 'catalog', req, items => {
  S.items = items;
  if (f.cat && !S.cats.some(c => c.name === f.cat)) f.cat = '';
  const picked = () => (S.showLines || []).reduce((a, l) => a + l.qty, 0);
  main.innerHTML = `<div class="eyebrow">Catalog</div><h1>展品目錄</h1>
    ${pick ? '' : `<p class="sub">即時庫存。選擇日期區間可查看該期間還能借多少,再加入「展覽規劃」。</p>`}
    ${pick ? `<div class="card bulkbar" id="pickbar"></div>` : ''}
    <div class="toolbar">
      <input class="grow" type="search" id="cq" placeholder="搜尋品名、規格、位置…" value="${esc(f.q)}">
      ${pick ? '' : `<span class="row" style="gap:6px"><input type="date" id="cs" value="${esc(f.start)}" aria-label="起"><span class="meta">→</span><input type="date" id="ce" value="${esc(f.end)}" aria-label="迄"></span>`}
      <label class="chk"><input type="checkbox" id="cav" ${f.onlyAvail ? 'checked' : ''}>只看可借</label>
      ${pick ? '' : `<button class="btn" data-act="export">${ICON.dl}<span class="lbl-hide">匯出</span></button>`}
    </div>
    <div id="cbar"></div>
    <div id="mbar"></div>
    ${range && !pick ? `<div class="banner info">顯示 <b>${esc(f.start)} → ${esc(f.end)}</b> 期間可借數量(已扣除已核准與出借中的借用)。 <a href="#" data-act="use-range">套用到展覽規劃</a></div>` : ''}
    <div id="cgrid"></div>`;
  const card = i => {
    const inCart = pick
      ? (S.showLines || []).filter(l => l.itemId === i.id).reduce((a, l) => a + l.qty, 0)
      : S.cart.filter(c => c.itemId === i.id).reduce((a, c) => a + c.qty, 0);
    const av = range ? i.available : null;
    const gs = i.sites || [];
    const picker = gs.length > 1
      ? `<select id="loc-${i.id}" aria-label="從哪個地點借">${gs.map(g => `<option value="${esc(g.location)}">${esc(g.location)}(${range ? '可借 ' + (g.available || 0) : '在庫 ' + g.inStock})</option>`).join('')}</select>`
      : `<input type="hidden" id="loc-${i.id}" value="${esc(gs[0] ? gs[0].location : '')}">`;
    const distHtml = distLine(i, range ? 'total' : 'inStock');
    return `<div class="card item-card">
      ${i.image ? `<div class="img" style="background-image:url('${esc(i.image)}')"></div>` : ''}
      <div class="row" style="gap:6px"><label class="chk"><input type="checkbox" data-mpick="${esc(i.id)}" ${S.multi.has(i.id) ? 'checked' : ''}>選</label><span class="pill">${esc(i.category)}</span>${i.mode === 'unit' ? '<span class="pill unit">逐台編號</span>' : ''}<span class="meta mono" style="margin-left:auto">${esc(i.id)}</span></div>
      <h3>${esc(i.name)}</h3>
      ${i.spec ? `<div class="meta">${esc(i.spec)}</div>` : ''}
      <div class="meta">存放:</div>${distHtml}
      <div class="nums"><div class="${i.inStock ? '' : 'zero'}"><b>${i.inStock}</b>倉庫在庫</div><div><b>${i.out}</b>出借中</div><div><b>${i.reserved}</b>已預約</div><div><b>${i.total}</b>總數</div></div>
      ${range ? `<div class="avail ${av ? '' : 'none'}">期間可借 <b>${av}</b></div>` : ''}
      <div class="addrow">${picker}<input type="number" min="1" value="1" id="q-${i.id}" aria-label="數量"><button class="btn sm pri" style="flex:1" data-act="${pick ? 'show-add-cat' : 'add-cart'}" data-id="${i.id}">${inCart ? (pick ? `加入展覽(已選 ${inCart})` : `加入規劃(已選 ${inCart})`) : (pick ? '加入展覽' : '加入規劃')}</button></div>
    </div>`;
  };
  let draw = () => {
    const q = f.q.toLowerCase();
    const match = i => (!q || [i.name, i.spec, i.location, i.category, i.id, itemSites(i).join(' ')].join(' ').toLowerCase().includes(q)) && (!f.onlyAvail || (range ? i.available : i.inStock) > 0);
    const shown = S.items.filter(match);
    const counts = {};
    shown.forEach(i => counts[i.category] = (counts[i.category] || 0) + 1);
    $('#cbar').innerHTML = catBar(S.cats, f.cat, counts);
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
  });
};

VIEWS.plan = async main => {
  const all = await cachedGet('catalog|', 'catalog');
  const byId = Object.fromEntries(all.map(i => [i.id, i]));
  S.cart = S.cart.filter(c => byId[c.itemId]); saveCart();
  const P = S.plan, admin = isAdmin();
  const draft = store.get('draft', {});
  if (!S.cart.length) {
    main.innerHTML = `${S.editing ? `<div class="banner info">正在修改申請 <b class="mono">${esc(S.editing.no)}</b>。 <a href="#" data-act="cancel-edit">放棄修改</a></div>` : ''}<div class="eyebrow">Planning</div><h1>${S.editing ? '修改借用申請' : '展覽規劃'}</h1><p class="sub">把需要的展品加進來,系統會依日期檢查夠不夠、缺什麼,確認後直接送出借用申請。</p>
      <div class="card empty">還沒有選任何展品。<br><br><button class="btn pri" data-act="go" data-v="catalog">前往展品目錄挑選</button></div>`;
    return;
  }
  const ed = S.editing;
  main.innerHTML = `${ed ? `<div class="banner info">正在修改申請 <b class="mono">${esc(ed.no)}</b>,改完按下方「儲存修改」。 <a href="#" data-act="cancel-edit">放棄修改</a></div>` : ''}
  <h1>${ed ? '修改借用申請' : '展覽規劃'}</h1><p class="sub">先選日期,系統即時比對可借數量。全部足夠即可送出申請${admin && !ed ? ';口頭借用可用「代為登記」直接建單' : ''}。</p>
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
      <button class="btn pri" style="width:100%" id="psubmit">${ed ? '儲存修改' : '送出借用申請'}</button>
    </form>
  </div>`;
  let lastCheck = [];
  const drawLines = () => {
    const ck = Object.fromEntries(lastCheck.map(c => [c.itemId + '@' + (c.location || ''), c]));
    $('#plines').innerHTML = S.cart.map(c => {
      const i = byId[c.itemId], k = ck[ckey(c)] || ck[c.itemId + '@'];
      const st = k ? (k.short ? `<span class="short">缺 ${k.short}(可借 ${k.available})</span>` : `<span class="okt">足夠(可借 ${k.available})</span>`) : `<span class="meta">在庫 ${i.inStock}</span>`;
      const where = esc(c.location || (i.sites || []).map(g => g.location).join('、'));
      const key = esc(ckey(c));
      return `<div class="line"><span class="nm">${esc(i.name)}<br><span class="meta">${where}</span></span>
        <span class="qtybox"><button type="button" data-act="cq" data-id="${key}" data-d="-1">−</button><input type="number" min="1" value="${c.qty}" data-cqi="${key}"><button type="button" data-act="cq" data-id="${key}" data-d="1">+</button></span>
        <span style="min-width:120px;text-align:right">${st}</span><button class="btn sm ghost" data-act="rm-cart" data-id="${key}" aria-label="移除">✕</button></div>`;
    }).join('');
    $$('[data-cqi]').forEach(inp => inp.onchange = () => { const c = S.cart.find(x => ckey(x) === inp.dataset.cqi); c.qty = Math.max(1, parseInt(inp.value, 10) || 1); saveCart(); recheck(); });
    const short = lastCheck.filter(c => c.short);
    const hasRange = P.start && P.end;
    $('#psum').innerHTML = !hasRange ? `<div class="sumbar banner info">選擇日期後會檢查每項是否足夠</div>`
      : short.length ? `<div class="sumbar banner bad"><b>缺 ${short.length} 項</b>:${short.map(s => esc(s.name) + (s.location ? '(' + esc(s.location) + ')' : '') + ' ×' + s.short).join('、')}</div>`
        : `<div class="sumbar banner ok"><b>全部足夠</b>,共 ${S.cart.length} 項 ${S.cart.reduce((a, c) => a + c.qty, 0)} 件</div>`;
    const force = admin && $('#pform [name=force]') && $('#pform [name=force]').checked;
    $('#psubmit').disabled = !hasRange || (short.length && !force);
  };
  const recheck = async () => {
    if (P.start && P.end && P.start <= P.end) {
      try { lastCheck = await api('check', { start: P.start, end: P.end, lines: S.cart, excludeId: ed ? ed.id : '' }); } catch (e) { lastCheck = []; toast(e.message, true); }
    } else lastCheck = [];
    drawLines();
  };
  S._recheck = recheck; S._planDraw = drawLines;
  const dch = () => { P.start = $('#ps').value; P.end = $('#pe').value; if (P.start && !P.end) { P.end = P.start; $('#pe').value = P.start; } saveCart(); recheck(); };
  $('#ps').onchange = dch; $('#pe').onchange = dch;
  $('#pform').oninput = () => { const fd = Object.fromEntries(new FormData($('#pform'))); store.set('draft', { event: fd.event, venue: fd.venue, contact: fd.contact, purpose: fd.purpose, note: fd.note }); drawLines(); };
  if (admin && !ed) {
    $('#ob').onchange = e => $('#obf').classList.toggle('hidden', !e.target.checked);
    api('users').then(us => { $('#ulist').innerHTML = us.filter(u => u.active).map(u => `<option value="${esc(u.empNo)}">${esc(u.name)} ${esc(u.dept || '')}</option>`).join(''); }).catch(() => { });
  }
  $('#pform').onsubmit = async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const payload = { ...fd, start: P.start, end: P.end, lines: S.cart, onBehalf: !!fd.onBehalf, force: !!fd.force };
    if (payload.onBehalf && !String(fd.applicant || '').trim()) return toast('請填寫借用人', true);
    if (ed) {
      const { event, venue, purpose, contact, note } = fd;
      const upd = await run(() => api('updateLoan',
        { id: ed.id, event, venue, purpose, contact, note, start: P.start, end: P.end, lines: S.cart, force: !!fd.force }),
        '已儲存修改').catch(() => null);
      if (!upd) return;
      S.editing = null; S.cart = []; store.del('draft'); saveCart();
      return go('mine');
    }
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
    ['今天到期', d.dueSoon.filter(l => l.end === d.today), 'out', 'out', '去登記歸還']
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
      ${kpi(ICON.layers, '展品品項', s.items)}
      ${kpi(ICON.cube, '總件數', s.total)}
      ${kpi(ICON.home, '倉庫在庫', s.inStock)}
      ${kpi(ICON.out, '出借中', s.out)}
      ${kpi(ICON.clock, '待審核', d.pending.length, d.pending.length ? 'warn' : '', 'go-loans', 'pending')}
      ${kpi(ICON.alert, '逾期未還', d.overdue.length, d.overdue.length ? 'bad' : '', 'go-loans', 'overdue')}
      ${kpi(ICON.check, '待確認簽收/歸還', d.requests.length, d.requests.length ? 'warn' : '', 'go-loans', 'request')}
      ${kpi(ICON.wrench, '維修 / 遺失', s.repair + ' / ' + s.lost)}
    </div>
    <div id="todo"></div>
    <div class="cols" style="margin-top:14px">
      <div class="card"><h2 style="margin-top:0">逾期未還</h2>${d.overdue.map(l => miniRow(l, `<span class="pill bad">逾期 ${l.overdueDays} 天</span>`)).join('') || '<div class="empty">沒有逾期,很好</div>'}</div>
      <div class="card"><h2 style="margin-top:0">待審核</h2>${d.pending.map(l => miniRow(l)).join('') || '<div class="empty">沒有待審核的申請</div>'}</div>
      <div class="card"><h2 style="margin-top:0">3 天內要點交</h2>${d.pickups.map(l => miniRow(l, `<span class="pill approved">${fmtD(l.start)} 領</span>`)).join('') || '<div class="empty">無</div>'}</div>
      <div class="card"><h2 style="margin-top:0">3 天內到期</h2>${d.dueSoon.map(l => miniRow(l, `<span class="pill out">${fmtD(l.end)} 還</span>`)).join('') || '<div class="empty">無</div>'}</div>
    </div>
    ${d.lowStock.length ? `<div class="card" style="margin-top:14px"><h2 style="margin-top:0">倉庫已無在庫</h2><div class="chips">${d.lowStock.map(i => `<span class="pill bad">${esc(i.name)}(${i.out}/${i.total} 借出)</span>`).join('')}</div></div>` : ''}`;
  $('#todo').innerHTML = todoList(d);
});

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
  return withData(main, 'loans|' + srv, 'loans', { filter: srv }, all => {
  if (loanSrv(S.loanFilter) !== srv) return;        // 使用者已經切到別的分頁了
  const pick = loanTabOf[S.loanFilter];
  const list = pick ? all.filter(pick) : all;
  S._loans = all;
  const F = [['request', '待確認'], ['pending', '待審核'], ['approved', '待點交'], ['out', '出借中'], ['overdue', '逾期'], ['returned', '已歸還'], ['all', '全部']];
  main.innerHTML = `<div class="row"><div><div class="eyebrow">Loans</div><h1>借用單</h1><p class="sub">審核 → 點交出借 → 登記歸還。口頭借用請從「展覽規劃」代為登記。</p></div><span class="spacer"></span><button class="btn brand" data-act="go" data-v="catalog">${ICON.plus}代為登記</button></div>
    <div class="toolbar"><div class="seg">${F.map(([k, l]) => {
      const n = loanTabOf[k] ? all.filter(loanTabOf[k]).length : (k === 'all' || k === 'returned' ? null : all.length);
      return `<button class="${S.loanFilter === k ? 'on' : ''}" data-act="lf" data-f="${k}">${l}${n ? ` <span class="n">${n}</span>` : ''}</button>`;
    }).join('')}</div>
    <input class="grow" type="search" id="lq" placeholder="搜尋單號、借用人、活動…"></div>
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
    $('#llist').innerHTML = f.map(l => l.status === 'pending'
      ? `<div class="pickwrap"><label class="chk pickbox"><input type="checkbox" data-pl="${l.id}" ${sel.has(l.id) ? 'checked' : ''}>選取</label>${loanCard(l)}</div>`
      : loanCard(l)).join('') || '<div class="card empty">沒有符合的借用單</div>';
    $$('[data-pl]').forEach(el => el.onchange = () => { el.checked ? sel.add(el.dataset.pl) : sel.delete(el.dataset.pl); bulk(); });
    bulk();
  };
  draw(); $('#lq').oninput = e => draw(e.target.value);
  if (S._focusLoan) { const el = $('#loan-' + S._focusLoan); if (el) { el.scrollIntoView({ block: 'center' }); el.style.outline = '2px solid var(--red)'; } S._focusLoan = null; }
  });
};
VIEWS.items = async main => {
  S.cats = await cachedGet('cats', 'cats');
  return withData(main, 'items', 'items', {}, list => {
  S.items = list;
  if (S.cat && !S.cats.some(c => c.name === S.cat)) S.cat = '';
  main.innerHTML = `<div class="row"><div><div class="eyebrow">Items</div><h1>展品管理</h1><p class="sub">貴重品用「逐台編號」(每台一張 QR 標籤);道具、線材用「數量」。</p></div><span class="spacer"></span>
    <button class="btn" data-act="cats">分類管理</button><button class="btn" data-act="import">批次匯入</button><button class="btn" data-act="export">${ICON.dl}匯出</button><button class="btn brand" data-act="edit-item">${ICON.plus}新增展品</button></div>
    <div class="toolbar"><input class="grow" type="search" id="iq" placeholder="搜尋…" value="${esc(S.itemQ)}"><label class="chk"><input type="checkbox" id="iarc" ${S.showArchived ? 'checked' : ''}>顯示已下架</label></div>
    <div id="ibar"></div>
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
  });
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
    <div class="card" style="margin:14px 0"><div class="row"><input class="grow" type="text" id="kscan" placeholder="輸入或用掃描槍刷編號後按 Enter(例:E0001)" style="flex:1 1 240px"><button class="btn" data-act="count-cam">${ICON.scan}相機掃描</button></div><div class="meta" id="klast" style="margin-top:6px"></div></div>
    <div class="catbar" id="ksite"></div>
    <div id="kbar"></div>
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
/** 挑選期間把清單也寫進 localStorage,重新整理不會白挑 */
function saveShowLines() { S.showLines = S.showLines || []; if (S.showPick) store.set('showlines', showDraftLines()); }

async function drawShow(main) {
  const isNew = S.showId === 'new';
  const v = isNew ? { id: '', name: '', from: '', to: '', venue: '', owner: '', note: '', status: 'draft', statusLabel: '規劃中', lines: [], loans: [], mismatch: [], loanCount: 0 }
    : await cachedGet('show|' + S.showId, 'show', { id: S.showId });
  if (S.showLines === null) S.showLines = v.lines.map(l => ({ itemId: l.itemId, location: l.location, qty: l.qty, note: l.note || '' }));
  S.items = await cachedGet('catalog|', 'catalog');
  const locked = v.status === 'closed' || v.status === 'cancelled';
  const live = (v.loans || []).filter(L => ['pending', 'approved', 'out'].includes(L.status));
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
        <label class="f"><span>檔期開始 <b>*</b></span><input type="date" name="from" required value="${esc(v.from)}"></label>
        <label class="f"><span>檔期結束 <b>*</b></span><input type="date" name="to" required value="${esc(v.to)}"></label>
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
        <button class="btn sm" data-act="show-paste" ${locked ? 'disabled' : ''}>整批貼上</button></div>
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
        ${v.status === 'closed' ? `<button class="btn sm" data-act="show-status" data-s="confirmed">重新開啟</button>` : ''}
        ${v.status === 'cancelled' ? `<button class="btn sm" data-act="show-status" data-s="draft">改回規劃中</button>` : ''}
        ${v.status === 'draft' || v.status === 'confirmed' ? `<button class="btn sm ghost" data-act="show-status" data-s="cancelled">取消展覽</button>` : ''}
        ${live.length ? `<button class="btn sm" data-act="show-extend">批次延期(${live.length} 張)</button>` : ''}
        <span class="spacer"></span>
        ${v.loanCount ? '' : `<button class="btn sm ghost" data-act="show-del">刪除</button>`}
      </div>
      ${(v.loans || []).length ? `<div style="margin-top:12px">${v.loans.map(L => miniRow(L, `${fmtD(L.start)}~${fmtD(L.end)}`)).join('')}</div>`
        : `<div class="meta" style="margin-top:12px">還沒有借用單。確認檔期之後按「依地點產生借用單」,系統會依各地點各開一張。</div>`}
    </div>`}`;

  const nameOf = Object.fromEntries(S.items.map(i => [i.id, i.name]));
  let gaps = [];
  const drawLines = () => {
    if (!$('#shlines')) return;                       // 新增階段還沒有需求清單
    const g = Object.fromEntries(gaps.map(x => [x.itemId + '@' + nloc(x.location), x]));
    const L2 = S.showLines;
    $('#shlines').innerHTML = !L2.length ? `<div class="meta">還沒有東西。</div>` : L2.map((l, idx) => {
      const k = g[lkey(l)];
      const st = !k ? '<span class="meta">填好檔期後會算可借量</span>'
        : k.short ? `<span class="short">缺 ${k.short}(可借 ${k.available})</span>`
          : k.issued ? `<span class="okt">已開單 ${k.issued}</span>`
            : `<span class="okt">足夠(可借 ${k.available})</span>`;
      return `<div class="line"><span class="nm">${esc(nameOf[l.itemId] || l.itemId)}<br><span class="meta">${esc(l.location)}</span></span>
        <span class="qtybox"><input type="number" min="1" value="${l.qty}" data-shq="${idx}" ${locked ? 'disabled' : ''}></span>
        <span style="min-width:150px;text-align:right">${st}</span>
        <button class="btn sm ghost" data-act="show-rm" data-i="${idx}" ${locked ? 'disabled' : ''} aria-label="移除">✕</button></div>`;
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
    if (from && to && from <= to && S.showLines.length) {
      try { gaps = await api('showCheck', { id: isNew ? '' : v.id, from, to, lines: showDraftLines() }); }
      catch (e) { gaps = []; toast(e.message, true); }
    } else gaps = [];
    drawLines();
  };
  S._showRecheck = recheck;
  S._showItems = S.items;
  S._showView = { id: isNew ? '' : v.id, name: v.name, from: v.from, to: v.to, venue: v.venue, owner: v.owner, note: v.note };
  $('#shform').querySelectorAll('input[type=date]').forEach(el => el.onchange = recheck);
  api('users').then(us => { const d = $('#ulist'); if (d) d.innerHTML = us.filter(u => u.active).map(u => `<option value="${esc(u.empNo)}">${esc(u.name)} ${esc(u.dept || '')}</option>`).join(''); }).catch(() => { });
  $('#shform').onsubmit = async e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    const saved = await run(() => api('saveShow', { show: { ...fd, id: isNew ? '' : v.id, lines: showDraftLines() } }),
      isNew ? '展覽已建立,接下來去挑展品' : '已儲存').catch(() => null);
    if (!saved) return;
    S.showId = saved.id; S.showLines = null;
    store.del('showlines');
    render();
  };
  recheck();
}

/** 加一項:選展品 → 選地點 → 數量 */
function showAddDialog() {
  const items = (S._showItems || S.items || []).filter(i => !i.archived);
  const opts = items.map(i => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('');
  openModal(`<h2>加入展品</h2>
    <label class="f"><span>展品</span><select id="sa-item">${opts}</select></label>
    <label class="f"><span>地點</span><select id="sa-loc"></select></label>
    <label class="f"><span>數量</span><input type="number" id="sa-qty" min="1" value="1"></label>
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" data-act="show-add-ok">加入</button></div>`);
  const fill = () => {
    const i = items.find(x => x.id === $('#sa-item').value);
    $('#sa-loc').innerHTML = ((i && i.sites) || []).map(g => `<option value="${esc(g.location)}">${esc(g.location)}(在庫 ${g.inStock}/${g.total})</option>`).join('') || `<option value="">未指定</option>`;
  };
  $('#sa-item').onchange = fill; fill();
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
/* ===================== 延期 / 轉借 / 改單 / 列印 ===================== */
const plusDays = (d, k) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + k); return t.toISOString().slice(0, 10); };
const findLoan = id => (S._loans || []).find(l => l.id === id) || null;

/** 批次核准:一次核准多張,沒過的逐張說明原因 */
function bulkApprove(ids) {
  const m = openModal(`<h2>批次核准 ${ids.length} 張</h2>
    <p class="sub">數量不足的那幾張會被跳過,結束後會告訴你是哪幾張、為什麼。</p>
    <label class="f"><span>共同備註</span><input type="text" id="bn" placeholder="選填,會寫進每一張的審核備註"></label>
    <label class="chk"><input type="checkbox" id="bf">數量不足仍核准</label>
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn brand" id="bgo">確定核准</button></div>`);
  $('#bgo', m).onclick = async () => {
    const r = await run(() => api('approveMany', { ids, note: $('#bn', m).value, force: $('#bf', m).checked })).catch(() => null);
    if (!r) return;
    const rows = r.fail.map(f => '<div class="line"><span class="nm mono">' + esc(f.id) + '</span><span class="short">' + esc(f.error) + '</span></div>').join('');
    openModal(`<h2>批次核准結果</h2>
      <div class="banner ${r.fail.length ? 'warn' : 'ok'}">成功 ${r.ok} 張${r.fail.length ? ',有 ' + r.fail.length + ' 張沒過' : ''}。</div>
      ${rows ? '<h2>沒過的</h2><div class="lines">' + rows + '</div>' : ''}
      <div class="modal-f"><button class="btn pri" data-act="close-render">完成</button></div>`);
  };
}

/** 修改待審核的申請:把它載回「展覽規劃」繼續編輯 */
function editLoan(id) {
  const L = findLoan(id);
  if (!L) return toast('請重新整理這一頁', true);
  S.editing = { id: L.id, no: L.id };
  S.cart = L.lines.map(ln => ({ itemId: ln.itemId, location: ln.location || '', qty: ln.qty }));
  S.plan = { start: L.start, end: L.end };
  saveCart();
  store.set('draft', { event: L.event, venue: L.venue, contact: L.contact, purpose: L.purpose, note: L.note });
  go('plan');
}
function cancelEdit() { S.editing = null; S.cart = []; store.del('draft'); saveCart(); go('mine'); }

/** 同仁申請延期 / 管理者直接延期 */
function extendModal(id, asAdmin) {
  const L = findLoan(id);
  if (!L) return toast('請重新整理這一頁', true);
  const m = openModal(`<h2>${asAdmin ? '延長歸還日' : '申請延長歸還日'} ${esc(id)}</h2>
    <p class="sub">${esc(L.event)}・目前歸還日 <b>${esc(L.end)}</b>。系統會檢查多出來的那一段期間還借不借得到。</p>
    <label class="f"><span>新的歸還日 <b>*</b></span><input type="date" id="xd" min="${esc(plusDays(L.end, 1))}" value="${esc(plusDays(L.end, 7))}"></label>
    <label class="f"><span>說明</span><input type="text" id="xn" placeholder="例:展期延後一週"></label>
    ${asAdmin ? '<label class="chk"><input type="checkbox" id="xf">數量不足仍延期</label>' : ''}
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" id="xgo">${asAdmin ? '確定延期' : '送出申請'}</button></div>`);
  $('#xgo', m).onclick = () => {
    const end = $('#xd', m).value, note = $('#xn', m).value;
    if (!end) return toast('請選新的歸還日', true);
    const call = asAdmin
      ? api('extendLoan', { id, end, note, force: $('#xf', m) && $('#xf', m).checked })
      : api('requestExtend', { id, end, note });
    run(() => call, asAdmin ? '已延期' : '已送出,請等管理者確認')
      .then(() => { closeModal(); if (!asAdmin) onsiteModal(id, 'extend'); else render(); }).catch(() => { });
  };
}

/** 同仁申請把借用轉給別人 */
function transferModal(id) {
  const L = findLoan(id);
  if (!L) return toast('請重新整理這一頁', true);
  const m = openModal(`<h2>轉借 ${esc(id)}</h2>
    <p class="sub">${esc(L.event)}・目前借用人 <b>${esc(L.applicant)}</b>。轉出去之後歸還責任就在對方身上,逾期也算他的。</p>
    <label class="f"><span>要轉給誰(工號) <b>*</b></span><input type="text" id="td" autocapitalize="characters" placeholder="例:10477"></label>
    <label class="f"><span>說明</span><input type="text" id="tn" placeholder="例:我出差,後續由他負責"></label>
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" id="tgo">送出申請</button></div>`);
  $('#tgo', m).onclick = () => {
    const emp = $('#td', m).value.trim().toUpperCase();
    if (!emp) return toast('請填寫要轉給誰的工號', true);
    run(() => api('requestTransfer', { id, emp, note: $('#tn', m).value }), '已送出,請等管理者確認')
      .then(() => { closeModal(); onsiteModal(id, 'transfer'); }).catch(() => { });
  };
}

/** 管理者處理延期 / 轉借申請 */
function decideModal(id, agree) {
  const L = findLoan(id), req = L && L.request;
  if (!req) return toast('請重新整理這一頁', true);
  const what = req.type === 'extend' ? '延期' : '轉借';
  const detail = req.type === 'extend'
    ? '把歸還日從 ' + L.end + ' 延到 ' + req.end
    : '把借用人從 ' + L.applicant + ' 換成 ' + (req.toName || '');
  const m = openModal(`<h2>${agree ? '同意' : '不同意'}${what} ${esc(id)}</h2>
    <p class="sub">${esc(L.event)}・${esc(req.by)} 申請${esc(detail)}${req.note ? '(' + esc(req.note) + ')' : ''}</p>
    <label class="f"><span>${agree ? '備註' : '原因'}${agree ? '' : ' <b>*</b>'}</span><input type="text" id="dn"></label>
    ${agree && req.type === 'extend' ? '<label class="chk"><input type="checkbox" id="df">數量不足仍延期</label>' : ''}
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn ${agree ? 'pri' : 'danger'}" id="dgo">${agree ? '確定' : '不同意'}</button></div>`);
  $('#dgo', m).onclick = () => {
    const note = $('#dn', m).value;
    if (!agree && !note.trim()) return toast('請填寫原因', true);
    run(() => api('decideRequest', { id, ok: agree, note, force: $('#df', m) && $('#df', m).checked }), agree ? '已處理' : '已回覆')
      .then(() => { closeModal(); render(); }).catch(() => { });
  };
}

/** 把借用單印成一張可簽名的單據 */
function printLoan(id) {
  const L = findLoan(id);
  if (!L) return toast('請重新整理這一頁', true);
  const row = (k, v) => '<tr><th>' + esc(k) + '</th><td>' + esc(v || '—') + '</td></tr>';
  const lines = L.lines.map(ln => '<tr><td>' + esc(ln.name) + '</td><td>' + esc(nloc(ln.location)) + '</td><td>' + esc(ln.mode === 'unit' ? '逐台編號' : '數量') + '</td>'
    + '<td class="n">' + ln.qty + '</td><td>' + esc((ln.units || []).join('、')) + '</td></tr>').join('');
  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) return toast('瀏覽器擋掉了列印視窗,請允許彈出視窗', true);
  w.document.write('<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>' + esc(L.id) + ' 借用單</title>'
    + '<style>body{font:14px/1.6 system-ui,"Noto Sans TC",sans-serif;color:#333F48;margin:36px;max-width:760px}'
    + 'h1{font-size:20px;margin:0 0 4px;color:#C8102E}.sub{color:#6b7280;font-size:12px;margin:0 0 18px}'
    + 'table{width:100%;border-collapse:collapse;margin-bottom:18px}th,td{border:1px solid #d8dce0;padding:7px 10px;text-align:left;vertical-align:top}'
    + 'th{background:#f4f5f7;width:96px;font-weight:600}td.n{text-align:right;width:56px}'
    + '.items th{width:auto;background:#f4f5f7}.sign{margin-top:36px;display:flex;gap:40px}'
    + '.sign div{flex:1;border-top:1px solid #333F48;padding-top:7px;font-size:12px;color:#6b7280}'
    + '@media print{body{margin:0}}</style></head><body>'
    + '<h1>展品借用單 ' + esc(L.id) + '</h1><div class="sub">' + esc(L.statusLabel) + '・列印於 ' + esc(todayStr()) + '</div>'
    + '<table>' + row('活動', L.event) + row('借用人', L.applicant + (L.dept ? '・' + L.dept : '')) + row('聯絡', L.contact)
    + row('地點', L.venue) + row('用途', L.purpose) + row('期間', L.start + ' → ' + L.end)
    + row('點交', L.outAt) + row('歸還', L.returnedAt) + row('備註', L.note) + '</table>'
    + '<table class="items"><thead><tr><th>品名</th><th>取自</th><th>方式</th><th class="n">數量</th><th>單台編號</th></tr></thead><tbody>' + lines + '</tbody></table>'
    + '<div class="sign"><div>借用人簽名</div><div>展品管理者簽名</div></div>'
    + '</body></html>');
  w.document.close();
  setTimeout(() => w.print(), 300);
}

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
  const pools = {}, byItem = {};
  await Promise.all([...new Set(unitLines.map(l => l.itemId))].map(async iid => { byItem[iid] = (await api('units', { itemId: iid })).filter(u => u.status === 'in'); }));
  unitLines.forEach(l => { pools[lkey(l)] = (byItem[l.itemId] || []).filter(u => nloc(u.location) === nloc(l.location)); });
  const pick = {}; unitLines.forEach(l => pick[lkey(l)] = []);
  const m = openModal(`<h2>${L.request ? '確認領取' : '點交出借'} ${esc(L.id)}</h2>${L.request ? `<div class="banner warn" style="font-size:13px">${esc(L.request.by)} 已送出簽收,以下為他選的編號,核對實物後確認。</div>` : ''}<p><b>${esc(L.event)}</b>・借用人 ${esc(L.applicant)}・應還 ${esc(L.end)}</p>
    ${unitLines.length ? `<div class="row" style="margin-bottom:10px"><input type="text" id="cscan" placeholder="輸入 / 刷編號後 Enter" style="flex:1"><button class="btn" id="ccam">${ICON.scan}掃描</button><button class="btn" id="cauto">自動指派</button></div>` : ''}
    <div class="lines">${L.lines.map(l => { const k = lkey(l), where = esc(nloc(l.location)); return l.mode === 'unit' ? `<div class="line" style="display:block"><div class="row"><b style="flex:1">${esc(l.name)} <span class="pill">${where}</span></b><span data-pc="${esc(k)}" class="short">已選 0 / ${l.qty}</span></div>
      <div class="chips">${pools[k].map(u => `<span class="chipk" data-pick="${u.id}" data-it="${esc(k)}">${esc(u.id)}${u.serial ? ' <small>' + esc(u.serial) + '</small>' : ''}</span>`).join('') || '<span class="short">' + where + ' 沒有在庫的單台</span>'}</div></div>`
      : `<div class="line"><span class="nm">${esc(l.name)}<br><span class="meta">${where}</span></span><span class="q">× ${l.qty}</span></div>`; }).join('')}</div>
    <label class="f" style="margin-top:12px"><span>點交備註</span><input type="text" id="cn" placeholder="外觀、配件狀況…"></label>
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" id="cgo">確認出借</button></div>`, { wide: true, noFocus: true });
  const upd = () => unitLines.forEach(l => { const el = $(`[data-pc="${lkey(l)}"]`, m); const n = pick[lkey(l)].length; el.textContent = `已選 ${n} / ${l.qty}`; el.className = n === +l.qty ? 'okt' : 'short'; });
  const toggle = (uid, force) => {
    const el = $(`[data-pick="${uid}"]`, m); if (!el) return false;
    const it = el.dataset.it, arr = pick[it], has = arr.includes(uid);
    const line = unitLines.find(l => lkey(l) === it);
    if (has && force !== true) arr.splice(arr.indexOf(uid), 1);
    else if (!has) { if (arr.length >= +line.qty) { toast(line.name + ' 已選滿', true); return false; } arr.push(uid); }
    el.classList.toggle('on', arr.includes(uid)); upd(); return true;
  };
  // 使用者已送出簽收 → 用他選的編號;否則自動挑前 N 台
  const preset = L.request && L.request.type === 'pickup' ? L.request.units || {} : null;
  const autoPick = () => {
    unitLines.forEach(l => {
      pick[lkey(l)].slice().forEach(uid => toggle(uid));                  // 先清掉
      pools[lkey(l)].slice(0, l.qty).forEach(u => toggle(u.id, true));
    });
    toast('已自動指派可用的編號,要換哪一台再自己點');
  };
  unitLines.forEach(l => (preset ? (preset[lkey(l)] || preset[l.itemId] || []) : pools[lkey(l)].slice(0, l.qty).map(u => u.id)).forEach(uid => toggle(uid)));
  if ($('#cauto', m)) $('#cauto', m).onclick = autoPick;
  $$('[data-pick]', m).forEach(el => el.onclick = () => toggle(el.dataset.pick));
  const sc = $('#cscan', m);
  if (sc) {
    sc.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const c = sc.value.trim().toUpperCase(); if (!toggle(c, true)) toast('此單沒有可選的 ' + c, true); sc.value = ''; } };
    $('#ccam', m).onclick = () => {
      unitLines.forEach(l => { pick[lkey(l)].slice().forEach(u => toggle(u)); });
      openScanner(code => { if (!toggle(code, true)) toast('不在可選清單:' + code, true); });
    };
  }
  $('#cgo', m).onclick = () => run(() => api('checkout', { id, units: pick, note: $('#cn', m).value }), '已點交出借').then(() => { closeModal(); render(); }).catch(() => { });
}
/** 歸還時可以選還到哪個廠區(預設還回原本借出的那一點) */
function backSelect(l) {
  const here = nloc(l.location);
  const list = [...new Set([here].concat(SITES, allSites()))];
  return `<label class="meta">還到 <select data-back="${esc(lkey(l))}">${list.map(v => `<option${v === here ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;
}
function backOf(m, key) { const el = $(`[data-back="${key}"]`, m); return el ? el.value : ''; }

async function receiveModal(id) {
  const L = await getLoan(id);
  const open = L.lines.filter(l => l.outstanding > 0);
  const m = openModal(`<h2>${L.request ? '確認歸還' : '登記歸還'} ${esc(L.id)}</h2>${L.request ? `<div class="banner warn" style="font-size:13px">${esc(L.request.by)} 已送出歸還,以下為他填的狀況,核對實物後可修改再確認。</div>` : ''}<p><b>${esc(L.event)}</b>・${esc(L.applicant)}・應還 ${esc(L.end)} ${L.overdue ? '<span class="pill bad">逾期</span>' : ''}</p>
    <div class="lines">${open.map(l => {
      const k = esc(lkey(l)), back = backSelect(l);
      if (l.mode === 'unit') {
        const pend = l.units.filter(u => !l.returnedUnits.includes(u) && !l.lostUnits.includes(u));
        return `<div class="line" style="display:block"><div class="row"><b style="flex:1">${esc(l.name)}</b>${back}</div>${pend.map(u => `<div class="row" style="margin:6px 0"><span class="mono" style="min-width:70px">${esc(u)}</span>
          <div class="seg" data-ru="${u}" data-it="${k}">${[['in', '歸還'], ['repair', '送修'], ['lost', '遺失'], ['', '未還']].map(([kk, t], i) => `<button type="button" data-v="${kk}" class="${i === 0 ? 'on' : ''}">${t}</button>`).join('')}</div></div>`).join('')}</div>`;
      }
      return `<div class="line"><span class="nm">${esc(l.name)}<br><span class="meta">未還 ${l.outstanding}</span></span>${back}
        <label class="meta">歸還 <input type="number" min="0" max="${l.outstanding}" value="${l.outstanding}" data-rq="${k}" style="width:80px"></label>
        <label class="meta">短少 <input type="number" min="0" max="${l.outstanding}" value="0" data-rl="${k}" style="width:80px"></label></div>`;
    }).join('')}</div>
    <label class="f" style="margin-top:12px"><span>備註</span><input type="text" id="rn2" placeholder="損壞狀況、短少原因…"></label>
    <p class="meta">「未還」的項目會保留在借用單上,之後可再登記。</p>
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" id="rgo2">確認</button></div>`, { wide: true, noFocus: true });
  $$('.seg[data-ru] button', m).forEach(b => b.onclick = () => { $$('button', b.parentNode).forEach(x => x.classList.remove('on')); b.classList.add('on'); });
  if (L.request && L.request.type === 'return') {
    const rq = {}; (L.request.lines || []).forEach(x => { rq[x.itemId + '@' + nloc(x.location)] = x; if (!(x.itemId in rq)) rq[x.itemId] = x; });
    $$('.seg[data-ru]', m).forEach(sg => {
      const x = rq[sg.dataset.it] || rq[String(sg.dataset.it).split('@')[0]], r = x && (x.unitResults || []).find(u => u.id === sg.dataset.ru);
      const v = r ? r.result : '';
      $$('button', sg).forEach(b => b.classList.toggle('on', b.dataset.v === v));
    });
    open.filter(l => l.mode !== 'unit').forEach(l => { const x = rq[lkey(l)] || rq[l.itemId] || { returned: 0, lost: 0 }; $(`[data-rq="${lkey(l)}"]`, m).value = x.returned || 0; $(`[data-rl="${lkey(l)}"]`, m).value = x.lost || 0; });
  }
  $('#rgo2', m).onclick = () => {
    const lines = open.map(l => { const k = lkey(l), to = backOf(m, k); return l.mode === 'unit'
      ? { itemId: l.itemId, location: nloc(l.location), to: to, unitResults: $$(`.seg[data-it="${k}"]`, m).map(sg => ({ id: sg.dataset.ru, result: $('button.on', sg).dataset.v })).filter(r => r.result) }
      : { itemId: l.itemId, location: nloc(l.location), to: to, returned: +$(`[data-rq="${k}"]`, m).value || 0, lost: +$(`[data-rl="${k}"]`, m).value || 0 }; });
    run(() => api('receive', { id, lines, note: $('#rn2', m).value })).then(r => { toast(r.status === 'returned' ? '已全部歸還' : '已登記部分歸還'); closeModal(); render(); }).catch(() => { });
  };
}

/* ===================== 展品 / 單台 ===================== */
/** 存放地點:先放公司的兩個廠區,已經用過的其他地點也會一起列出來 */
const SITES = ['新竹', '林口'];
function allSites() {
  const set = new Set();
  (S.items || []).forEach(i => {
    (i.sites || []).forEach(g => { if (g.location) set.add(String(g.location)); });
    String(i.location || '').split('、').forEach(v => { if (v.trim()) set.add(v.trim()); });
  });
  return [...set];
}
function siteOptions(cur) {
  const used = allSites();
  const list = SITES.concat(used.filter(v => !SITES.includes(v)));
  if (cur && !list.includes(cur)) list.push(cur);
  const out = [];
  list.forEach(v => out.push('<option' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>'));
  out.push('<option value="__new">+ 新增地點…</option>');
  return out.join('');
}

/** 清單上的分佈:新竹 3 · 林口 2(在庫 / 登記台數;全部借出的那一點會變灰) */
function distLine(i, key) {
  const gs = i.sites || [];
  if (!gs.length) return '—';
  return '<div class="dist">' + gs.map(g => {
    const n = key === 'inStock' ? g.inStock : g.total;
    return `<span class="${n ? '' : 'z'}">${esc(g.location)} <b>${Number(n) || 0}</b></span>`;
  }).join('') + '</div>';
}

/** 編輯展品時的一列「地點 + 台數」 */
function siteRow(where, qty) {
  return `<div class="siterow">
    <select class="sloc">${siteOptions(where || '')}</select>
    <input type="text" class="slocnew hidden" maxlength="60" placeholder="新地點名稱">
    <input type="number" class="sqty" min="0" value="${Number(qty) || 0}">
    <button type="button" class="btn sm ghost sdel" title="移除這一列">✕</button>
  </div>`;
}

/** 把使用者選的照片縮到合理大小再上傳,避免一張 5MB 的原圖塞爆請求 */
function shrinkImage(file, maxPx = 1200) {
  return new Promise((ok, bad) => {
    if (!/^image\//.test(file.type)) return bad(new Error('請選圖片檔'));
    const fr = new FileReader();
    fr.onerror = () => bad(new Error('讀不到這個檔案'));
    fr.onload = () => {
      const im = new Image();
      im.onerror = () => bad(new Error('這個檔案不是可以顯示的圖片'));
      im.onload = () => {
        const r = Math.min(1, maxPx / Math.max(im.width, im.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(im.width * r); cv.height = Math.round(im.height * r);
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        let q = 0.82, out = cv.toDataURL('image/jpeg', q);
        while (out.length > 380000 && q > 0.35) { q -= 0.12; out = cv.toDataURL('image/jpeg', q); }
        if (out.length > 380000) return bad(new Error('這張圖太大,請換一張或先裁小一點'));
        ok(out.split(',')[1]);
      };
      im.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

function itemModal(id, preCat) {
  const i = id ? S.items.find(x => x.id === id) : { mode: 'qty', qty: 0, category: preCat || (S.cats[0] && S.cats[0].name) || '' };
  const locOpts = siteOptions(i.mode === 'unit' ? String(i.location || '').split('、')[0] : '');   // 先組好,樣板裡就不會出現使用者欄位
  const cur = (i.sites || []).filter(g => g.total || g.countedAt);
  const siteRows = (cur.length ? cur.map(g => siteRow(g.location, g.total)) : [siteRow('', i.qty || 0)]).join('');
  const m = openModal(`<h2>${id ? '編輯展品 ' + esc(id) : '新增展品'}</h2><form id="itf">
    <label class="f"><span>品名 <b>*</b></span><input type="text" name="name" required value="${esc(i.name || '')}"></label>
    <div class="grid2"><label class="f"><span>分類</span><select name="category" id="fcat">${S.cats.map(c => `<option ${c.name === i.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}${S.cats.some(c => c.name === i.category) || !i.category ? '' : `<option selected>${esc(i.category)}</option>`}<option value="__new">+ 新增分類…</option></select>
    <input type="text" id="fcatnew" class="hidden" maxlength="40" placeholder="新分類名稱" style="margin-top:6px"></label>
    <label class="f" id="floc-wrap"><span>存放位置</span><select name="location" id="floc">${locOpts}</select>
    <input type="text" id="flocnew" class="hidden" maxlength="60" placeholder="例:湖口 B 倉 A-01" style="margin-top:6px"></label></div>
    <label class="f"><span>追蹤方式</span><div class="seg" id="mseg">${[['unit', '逐台編號(貴重品)'], ['qty', '只記數量(道具 / 配件)']].map(([k, t]) => `<button type="button" data-m="${k}" class="${i.mode === k ? 'on' : ''}" ${id && i.mode === 'unit' && k === 'qty' && i.total ? 'disabled' : ''}>${t}</button>`).join('')}</div></label>
    <label class="f" id="fq"><span>各地點的數量</span><div id="fsites">${siteRows}</div>
      <button type="button" class="btn sm ghost" id="faddsite" style="margin-top:8px">${ICON.plus}再加一個地點</button></label>
    ${id ? '' : '<label class="f" id="fu"><span>建立幾台(會自動產生 E0001 這類編號,可印 QR 標籤)</span><input type="number" min="0" max="200" name="unitCount" value="1"></label>'}
    <label class="f"><span>規格 / 配件</span><input type="text" name="spec" value="${esc(i.spec || '')}"></label>
    <label class="f"><span>照片(選填)</span>
      <div class="photo" id="fphoto"></div>
      <input type="hidden" name="image" id="fimg" value="${esc(i.image || '')}">
      <div class="row" style="gap:8px;margin-top:8px">
        <label class="btn sm">${ICON.plus}選照片 / 拍照<input type="file" accept="image/*" id="ffile" style="display:none"></label>
        <button type="button" class="btn sm ghost" id="furl">改貼網址</button>
        <button type="button" class="btn sm ghost" id="fdel">移除照片</button>
      </div></label>
    <label class="f"><span>備註</span><input type="text" name="note" value="${esc(i.note || '')}"></label>
    <div class="modal-f">${id ? '<button type="button" class="btn danger" id="fdrop">刪除展品</button>' : ''}<span class="spacer"></span><button type="button" class="btn" data-act="close">取消</button><button class="btn pri">儲存</button></div></form>`);
  let mode = i.mode;
  const sync = () => {
    $('#fq', m).classList.toggle('hidden', mode !== 'qty');
    $('#floc-wrap', m).classList.toggle('hidden', mode !== 'unit');      // 逐台編號:這裡只是新增單台時的預設地點
    const fu = $('#fu', m); if (fu) fu.classList.toggle('hidden', mode !== 'unit');
    $$('#mseg button', m).forEach(b => b.classList.toggle('on', b.dataset.m === mode));
  };
  $$('#mseg button', m).forEach(b => b.onclick = () => { mode = b.dataset.m; sync(); }); sync();
  /* 各地點數量:可以增減列,選「+ 新增地點…」就跳出可以自己打的欄位 */
  const box = $('#fsites', m);
  const syncRows = () => $$('.sdel', box).forEach(b => b.classList.toggle('hidden', $$('.siterow', box).length < 2));
  box.onchange = e => {
    const sel = e.target.closest('.sloc'); if (!sel) return;
    const isNew = sel.value === '__new', nw = sel.parentNode.querySelector('.slocnew');
    nw.classList.toggle('hidden', !isNew); if (isNew) nw.focus();
  };
  box.onclick = e => {
    const b = e.target.closest('.sdel'); if (!b) return;
    if ($$('.siterow', box).length > 1) { b.closest('.siterow').remove(); syncRows(); }
  };
  $('#faddsite', m).onclick = () => {
    const used = $$('.sloc', box).map(x => x.value);
    const next = SITES.concat(allSites()).find(v => !used.includes(v)) || '';
    box.insertAdjacentHTML('beforeend', siteRow(next, 0));
    syncRows();
  };
  syncRows();
  /* 照片 */
  const drawPhoto = () => {
    const v = $('#fimg', m).value;
    $('#fphoto', m).innerHTML = v
      ? `<img src="${esc(v)}" alt="展品照片" loading="lazy">`
      : '<div class="ph-empty">還沒有照片</div>';
    $('#fdel', m).classList.toggle('hidden', !v);
  };
  $('#ffile', m).onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const b64 = await run(() => shrinkImage(f)).catch(() => null);
    if (!b64) return;
    const r = await run(() => api('uploadImage', { name: $('#itf [name=name]', m).value || '展品照片', data: b64, ext: 'jpeg' }), '照片已上傳').catch(() => null);
    if (!r) return;
    $('#fimg', m).value = r.url; drawPhoto();
  };
  $('#furl', m).onclick = () => {
    const v = window.prompt('貼上照片網址(留白代表移除):', $('#fimg', m).value || '');
    if (v === null) return;
    $('#fimg', m).value = v.trim(); drawPhoto();
  };
  $('#fdel', m).onclick = () => { $('#fimg', m).value = ''; drawPhoto(); };
  drawPhoto();
  /* 刪除展品 */
  if ($('#fdrop', m)) $('#fdrop', m).onclick = () => {
    const msg = '確定要永久刪除「' + i.name + '」?\n\n'
      + '借過的展品不能刪(系統會擋下來);沒借過的會連同單台編號一起移除,無法復原。\n'
      + '如果只是暫時不用,請改用「下架」。';
    if (!confirmInline(msg)) return;
    run(() => api('deleteItem', { id }), '已刪除').then(() => { closeModal(); render(); }).catch(() => { });
  };
  const sel = $('#fcat', m), nw = $('#fcatnew', m);
  sel.onchange = () => { const isNew = sel.value === '__new'; nw.classList.toggle('hidden', !isNew); if (isNew) nw.focus(); };
  const loc = $('#floc', m), locNew = $('#flocnew', m);
  loc.onchange = () => { const isNew = loc.value === '__new'; locNew.classList.toggle('hidden', !isNew); if (isNew) locNew.focus(); };
  $('#itf', m).onsubmit = e => {
    e.preventDefault();
    const item = { ...Object.fromEntries(new FormData(e.target)), id: id || '', mode };
    if (item.category === '__new') {
      item.category = nw.value.trim();
      if (!item.category) return toast('請填寫新分類名稱', true);
    }
    if (item.location === '__new') {
      item.location = locNew.value.trim();
      if (!item.location) return toast('請填寫新的存放地點', true);
    }
    if (mode === 'qty') {
      const sites = [], seen = {};
      for (const row of $$('.siterow', m)) {
        const sel = row.querySelector('.sloc');
        const where = (sel.value === '__new' ? row.querySelector('.slocnew').value : sel.value).trim();
        const n = Math.max(0, parseInt(row.querySelector('.sqty').value, 10) || 0);
        if (!n) continue;
        if (!where) return toast('請填寫地點名稱', true);
        if (seen[where]) return toast('「' + where + '」填了兩次,請合併成一列', true);
        seen[where] = 1; sites.push({ location: where, qty: n });
      }
      item.sites = sites;
      delete item.qty; delete item.location;
    } else {
      delete item.sites;
    }
    run(() => api('saveItem', { item }), '已儲存').then(() => { RCACHE.delete('cats'); closeModal(); render(); }).catch(() => { });
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
    <div class="modal-f">${id ? '<button type="button" class="btn danger" id="fdrop">刪除展品</button>' : ''}<span class="spacer"></span><button type="button" class="btn" data-act="close">取消</button><button class="btn pri">儲存</button></div></form>`);
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
  const okey = o => o.key || (o.itemId + '@' + nloc(o.location));
  const pick = {}; unitLines.forEach(o => pick[okey(o)] = []);
  const m = openModal(`<h2>簽收領取 ${esc(L.id)}</h2><p><b>${esc(L.event)}</b>・應還 ${esc(L.end)}</p>
    ${unitLines.length ? `<div class="banner info" style="font-size:13px">請掃描或點選你實際拿到的那幾台(看展品上的 QR 標籤編號)。</div>
    <div class="row" style="margin-bottom:10px"><input type="text" id="pscan" placeholder="輸入編號後 Enter" style="flex:1"><button class="btn" id="pcam">${ICON.scan}掃描</button><button class="btn" id="pauto">自動選好</button></div>` : ''}
    <div class="lines">${opts.map(o => { const k = esc(okey(o)), where = esc(nloc(o.location)); return o.mode === 'unit' ? `<div class="line" style="display:block"><div class="row"><b style="flex:1">${esc(o.name)} <span class="pill">${where}</span></b><span data-pc="${k}" class="short">已選 0 / ${o.qty}</span></div>
      <div class="chips">${o.units.map(u => `<span class="chipk" data-pick="${u.id}" data-it="${k}">${esc(u.id)}${u.serial ? ' <small>' + esc(u.serial) + '</small>' : ''}</span>`).join('') || '<span class="short">目前沒有在庫的單台,請聯絡管理者</span>'}</div></div>`
      : `<div class="line"><span class="nm">${esc(o.name)}<br><span class="meta">${where}</span></span><span class="q">× ${o.qty}</span></div>`; }).join('')}</div>
    <label class="f" style="margin-top:12px"><span>備註</span><input type="text" id="pn" placeholder="外觀、配件狀況…"></label>
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" id="pgo2">確認簽收</button></div>`, { wide: true, noFocus: true });
  const upd = () => unitLines.forEach(o => { const el = $(`[data-pc="${okey(o)}"]`, m); const n = pick[okey(o)].length; el.textContent = `已選 ${n} / ${o.qty}`; el.className = n === o.qty ? 'okt' : 'short'; });
  const toggle = (uid, force) => {
    const el = $(`[data-pick="${uid}"]`, m); if (!el) return false;
    const it = el.dataset.it, arr = pick[it], has = arr.includes(uid), o = unitLines.find(x => okey(x) === it);
    if (has && force !== true) arr.splice(arr.indexOf(uid), 1);
    else if (!has) { if (arr.length >= o.qty) { toast(o.name + ' 已選滿 ' + o.qty + ' 台,請先取消一台', true); return false; } arr.push(uid); }
    el.classList.toggle('on', arr.includes(uid)); upd(); return true;
  };
  if ($('#pauto', m)) $('#pauto', m).onclick = () => {
    unitLines.forEach(o => {
      pick[okey(o)].slice().forEach(uid => toggle(uid));
      o.units.slice(0, o.qty).forEach(u => toggle(u.id, true));
    });
    toast('已幫你選好,拿到的不是這幾台就自己改');
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
      const k = esc(lkey(l)), back = backSelect(l);
      if (l.mode === 'unit') {
        const pend = l.units.filter(u => !l.returnedUnits.includes(u) && !l.lostUnits.includes(u));
        return `<div class="line" style="display:block"><div class="row"><b style="flex:1">${esc(l.name)}</b>${back}</div>${pend.map(u => `<div class="row" style="margin:6px 0"><span class="mono" style="min-width:70px">${esc(u)}</span>
          <div class="seg" data-ru="${u}" data-it="${k}">${[['in', '歸還'], ['repair', '有損壞'], ['lost', '遺失'], ['', '先不還']].map(([kk, t], i) => `<button type="button" data-v="${kk}" class="${i === 0 ? 'on' : ''}">${t}</button>`).join('')}</div></div>`).join('')}</div>`;
      }
      return `<div class="line"><span class="nm">${esc(l.name)}<br><span class="meta">未還 ${l.outstanding}</span></span>${back}
        <label class="meta">歸還 <input type="number" min="0" max="${l.outstanding}" value="${l.outstanding}" data-rq="${k}" style="width:80px"></label>
        <label class="meta">短少 <input type="number" min="0" max="${l.outstanding}" value="0" data-rl="${k}" style="width:80px"></label></div>`;
    }).join('')}</div>
    <label class="f" style="margin-top:12px"><span>備註</span><input type="text" id="un2" placeholder="損壞狀況、短少原因…"></label>
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" id="ugo2">送出歸還</button></div>`, { wide: true, noFocus: true });
  $$('.seg[data-ru] button', m).forEach(b => b.onclick = () => { $$('button', b.parentNode).forEach(x => x.classList.remove('on')); b.classList.add('on'); });
  $('#ugo2', m).onclick = () => {
    const lines = open.map(l => { const k = lkey(l), to = backOf(m, k); return l.mode === 'unit'
      ? { itemId: l.itemId, location: nloc(l.location), to: to, unitResults: $$(`.seg[data-it="${k}"]`, m).map(sg => ({ id: sg.dataset.ru, result: $('button.on', sg).dataset.v })).filter(r => r.result) }
      : { itemId: l.itemId, location: nloc(l.location), to: to, returned: +$(`[data-rq="${k}"]`, m).value || 0, lost: +$(`[data-rl="${k}"]`, m).value || 0 }; });
    run(() => api('requestReturn', { id, lines, note: $('#un2', m).value })).then(() => onsiteModal(id, 'return')).catch(() => { });
  };
}
function onsiteModal(id, type) {
  const word = { pickup: '領取', 'return': '歸還', extend: '延期', transfer: '轉借' }[type] || '確認';
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
  'add-cart': el => {
    const id = el.dataset.id, q = $('#q-' + id).value, where = ($('#loc-' + id) || {}).value || '';
    addToCart(id, q, where);
    toast('已加入展覽規劃' + (where ? '(' + where + ')' : ''));
    el.textContent = `加入規劃(已選 ${S.cart.filter(c => c.itemId === id).reduce((a, c) => a + c.qty, 0)})`;
  },
  'use-range': () => { S.plan.start = S.filters.start; S.plan.end = S.filters.end; saveCart(); go('plan'); },
  'rm-cart': el => { S.cart = S.cart.filter(c => ckey(c) !== el.dataset.id); saveCart(); S.cart.length ? S._recheck() : render(); },
  'cq': el => { const c = S.cart.find(x => ckey(x) === el.dataset.id); c.qty = Math.max(1, c.qty + +el.dataset.d); saveCart(); S._recheck(); },
  /* ---- 展覽檔期 ---- */
  'show-new': () => { S.showId = 'new'; S.showLines = []; go('shows'); },
  'show-open': el => { S.showId = el.dataset.id; S.showLines = null; go('shows'); },
  'show-back': () => { S.showId = null; S.showLines = null; S.showPick = null; store.del('showpick'); store.del('showlines'); render(); },
  'show-filter': el => { S.showFilter = el.dataset.f; render(); },
  /** 去目錄挑選:檔期已經定好,目錄會直接用那個區間算可借量 */
  'show-pick': () => {
    const v = S._showView;
    if (!v || !v.id) return toast('請先建立展覽', true);
    if (!v.from || !v.to) return toast('請先填好檔期起訖再挑展品', true);
    S.showPick = { id: v.id, name: v.name, from: v.from, to: v.to };
    store.set('showpick', S.showPick);
    saveShowLines();
    go('catalog');
  },
  'show-add-cat': el => {
    const id = el.dataset.id, q = Math.max(1, parseInt(($('#q-' + id) || {}).value, 10) || 1);
    const where = (($('#loc-' + id) || {}).value || '').trim() || '未指定';
    S.showLines = mergeShowLines(S.showLines || [], [{ itemId: id, location: where, qty: q, note: '' }]);
    saveShowLines();
    toast('已加入展覽' + (where !== '未指定' ? '(' + where + ')' : ''));
    S._catDraw();
  },
  /**
   * 挑完直接存檔,不留「還沒存的清單」這種狀態。
   * 存檔前先跟後端要一次現況 —— 中途重新整理過的話記憶體裡沒有場地 / 承辦人,
   * 拿空值寫回去會把那幾欄清掉。只有這次挑的「清單」是我們要覆蓋的東西。
   */
  'show-pick-done': async () => {
    const p2 = S.showPick;
    const cur = await run(() => api('show', { id: p2.id })).catch(() => null);
    if (!cur) return;                                   // 讀不到就原地不動,清單還留著
    const ok = await run(() => api('saveShow', { show: {
      id: cur.id, name: cur.name, from: cur.from, to: cur.to,
      venue: cur.venue, owner: cur.owner, note: cur.note, lines: showDraftLines()
    } }), '已加入需求清單').catch(() => null);
    if (!ok) return;                                    // 存不進去就別把挑好的東西丟掉
    S.showPick = null; store.del('showpick'); store.del('showlines');
    S.showId = p2.id; S.showLines = null;
    go('shows');
  },
  'show-add-ok': () => {
    const add = [{ itemId: $('#sa-item').value, location: $('#sa-loc').value || '未指定', qty: Math.max(1, parseInt($('#sa-qty').value, 10) || 1), note: '' }];
    S.showLines = mergeShowLines(S.showLines || [], add);
    saveShowLines();
    closeModal(); S._showRecheck();
  },
  'show-rm': el => { S.showLines.splice(+el.dataset.i, 1); saveShowLines(); S._showRecheck(); },
  'show-paste': () => showPasteDialog(),
  'show-paste-ok': () => {
    const r = parsePaste($('#sp-txt').value);
    if (r.lines.length) S.showLines = mergeShowLines(S.showLines || [], r.lines);
    if (r.bad.length) {
      // 對不到的行留在畫面上讓人修,不要整批退回
      $('#sp-out').innerHTML = `<div class="banner bad" style="margin-top:10px"><b>有 ${r.bad.length} 行對不到</b>(其餘 ${r.lines.length} 行已加入):<br>`
        + r.bad.map(b => `第 ${b.n} 行「${esc(b.text)}」— ${esc(b.why)}`).join('<br>') + `</div>`;
      $('#sp-txt').value = r.bad.map(b => b.text).join('\n');
    } else closeModal();
    if (r.lines.length) toast('已加入 ' + r.lines.length + ' 項');
    saveShowLines(); S._showRecheck();
  },
  'show-status': async el => {
    const st = el.dataset.s;
    const ask = { confirmed: '確認檔期?確認之後,還沒開單的部分會先幫你卡住,別場借不走。',
      draft: '改回規劃中?卡住的部分會全部釋放。', closed: '結案?底下的借用單必須都已經結束。',
      cancelled: '取消這場展覽?卡住的部分會全部釋放。' }[st];
    if (!confirmInline(ask)) return;
    try {
      await api('setShowStatus', { id: S.showId, status: st });
      toast('已更新'); S.showLines = null; render();
    } catch (e) {
      // 有缺口不直接擋,但要管理者明確認帳(後端會把缺口寫進異動紀錄)
      if (st === 'confirmed' && /缺/.test(e.message)) {
        return openModal(`<h2>這個檔期有缺口</h2><p>${esc(e.message)}</p>
          <div class="modal-f"><button class="btn" data-act="close">回去調整</button>
          <button class="btn pri" data-act="show-force">知道有缺口,仍要確認</button></div>`);
      }
      if (!e.silent) toast(e.message, true);
    }
  },
  'show-force': async () => {
    closeModal();
    await run(() => api('setShowStatus', { id: S.showId, status: 'confirmed', force: true }), '已確認檔期(有缺口)').catch(() => { });
    S.showLines = null; render();
  },
  'show-gen': async () => {
    if (!confirmInline('依地點產生借用單?每個還需要開單的地點各開一張,直接成為已核准。')) return;
    const r = await run(() => api('createLoansFromShow', { id: S.showId })).catch(() => null);
    if (!r) return;
    S.showLines = null;
    const ids = r.ids.join('、');
    openModal(`<h2>已產生 ${r.ok} 張借用單</h2>${ids ? `<p class="mono">${esc(ids)}</p>` : ''}
      ${r.fail.length ? `<div class="banner bad">有 ${r.fail.length} 個地點沒成功:<br>`
        + r.fail.map(f => esc(f.location) + ':' + esc(f.error)).join('<br>') + '</div>' : ''}
      <div class="modal-f"><button class="btn pri" data-act="close-render">知道了</button></div>`);
  },
  'show-del': () => {
    if (!confirmInline('刪除這場展覽?此動作無法復原。')) return;
    run(() => api('deleteShow', { id: S.showId }), '已刪除')
      .then(() => { S.showId = null; S.showLines = null; render(); }).catch(() => { });
  },
  'show-extend': async () => {
    const v = await cachedGet('show|' + S.showId, 'show', { id: S.showId });
    const live = (v.loans || []).filter(L => ['approved', 'out'].includes(L.status));
    if (!live.length) return toast('底下沒有可以延期的借用單(只有已核准 / 出借中的單能延)', true);
    const newEnd = esc(v.to);
    openModal(`<h2>批次延期</h2>
      <p class="meta">改檔期不會自動改單。勾選要一起延的,系統會逐張檢查延長那一段的庫存,一張失敗不影響其他張。</p>
      <label class="f"><span>新的歸還日</span><input type="date" id="se-end" value="${newEnd}"></label>
      ${live.map(L => `<label class="chk"><input type="checkbox" class="se-id" value="${esc(L.id)}" ${L.end < v.to ? 'checked' : ''}>
        <span class="mono">${esc(L.id)}</span> ${esc(L.applicant)}・${fmtD(L.start)} → ${fmtD(L.end)}</label>`).join('')}
      <label class="chk" style="margin-top:8px"><input type="checkbox" id="se-force">庫存不足仍延期</label>
      <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" data-act="show-extend-ok">送出</button></div>`);
  },
  'show-extend-ok': async () => {
    const ids = $$('.se-id').filter(c => c.checked).map(c => c.value);
    if (!ids.length) return toast('請先勾選要延期的借用單', true);
    const r = await run(() => api('extendMany', { ids: ids, end: $('#se-end').value, note: '展期延長', force: $('#se-force').checked })).catch(() => null);
    if (!r) return;
    closeModal();
    toast('已延期 ' + r.ok + ' 張' + (r.fail.length ? ',' + r.fail.length + ' 張沒成功' : ''));
    S.showLines = null;
    if (r.fail.length) openModal(`<h2>有 ${r.fail.length} 張沒延成功</h2>
      <div class="banner bad">${r.fail.map(f => esc(f.id) + ':' + esc(f.error)).join('<br>')}</div>
      <div class="modal-f"><button class="btn pri" data-act="close-render">知道了</button></div>`);
    else render();
  },
  'clear-cart': () => { if (confirmInline('清空規劃清單?')) { S.cart = []; saveCart(); render(); } },
  'copy-plan': async () => {
    const all = S.items.length ? S.items : await api('catalog');
    const nm = Object.fromEntries(all.map(i => [i.id, i.name]));
    const chk = S.plan.start && S.plan.end ? await api('check', { start: S.plan.start, end: S.plan.end, lines: S.cart }).catch(() => []) : [];
    const ck = Object.fromEntries(chk.map(c => [c.itemId + '@' + (c.location || ''), c]));
    const ps = S.plan.start || '?', pe = S.plan.end || '?';   // 純文字(剪貼簿),顯示時再經 esc()
    const txt = `展覽規劃 ${ps} ~ ${pe}\n` + S.cart.map(c => {
      const k = ck[ckey(c)], at = c.location ? '(' + c.location + ')' : '';
      return `・${nm[c.itemId] || c.itemId}${at} × ${c.qty}` + (k ? (k.short ? `(缺 ${k.short})` : '(足夠)') : '');
    }).join('\n');
    try { await navigator.clipboard.writeText(txt); toast('已複製,可貼到 Email / 通訊軟體'); } catch (e) { openModal(`<h2>清單</h2><textarea rows="10">${esc(txt)}</textarea><div class="modal-f"><button class="btn" data-act="close">關閉</button></div>`); }
  },
  'approve': el => approveModal(el.dataset.id),
  'edit-loan': el => editLoan(el.dataset.id),
  'cancel-edit': () => cancelEdit(),
  'u-extend': el => extendModal(el.dataset.id, false),
  'u-transfer': el => transferModal(el.dataset.id),
  'extend': el => extendModal(el.dataset.id, true),
  'req-ok': el => decideModal(el.dataset.id, true),
  'req-no': el => decideModal(el.dataset.id, false),
  'print-loan': el => printLoan(el.dataset.id),
  'reject': el => rejectModal(el.dataset.id),
  'checkout': el => checkoutModal(el.dataset.id),
  'receive': el => receiveModal(el.dataset.id),
  'cancel': el => { if (confirmInline('確定取消這筆申請?')) run(() => api('cancelLoan', { id: el.dataset.id }), '已取消').then(render).catch(() => { }); },
  'edit-item': el => itemModal(el.dataset.id, el.dataset.cat),
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
  'multi-clear': () => { S.multi.clear(); S._catDraw(); },
  'multi-go': () => {
    S.multi.forEach(id => {
      if (S.cart.find(c => c.itemId === id)) return;
      const i = S.items.find(x => x.id === id), gs = i ? (i.sites || []) : [];
      const pick = $('#loc-' + id);                                   // 卡片上選了哪一點就用哪一點
      S.cart.push({ itemId: id, location: (pick && pick.value) || (gs.length === 1 ? gs[0].location : ''), qty: 1 });
    });
    S.multi.clear(); saveCart(); go('plan');
  },
  'pick-cat': el => {
    const v = el.dataset.cat;
    if (S.view === 'catalog') { S.filters.cat = v; S._catDraw(); }
    else { S.cat = v; (S.view === 'items' ? S._itemDraw : S._countDraw)(); }
  },
  'cats': () => catsModal(),
  'out-who': el => outWhoModal(el.dataset.id),
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
$('#m-view').onclick = () => { $('#menu-pop').classList.add('hidden'); setAsUser(!S.asUser); };
$('#viewas-btn').onclick = () => setAsUser(false);
$('#m-pin').onclick = () => { $('#menu-pop').classList.add('hidden'); pinModal(); };
$('#m-out').onclick = () => { $('#menu-pop').classList.add('hidden'); logout(); };
