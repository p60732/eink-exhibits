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
  filters: { q: '', cat: '', loc: '', start: '', end: '', onlyAvail: false },
  loanFilter: 'pending', itemQ: '', cat: '', site: '', itemSite: '', showArchived: false, loanHist: false, histOpen: false, openLoans: new Set(),
  logQ: '', logCat: '', logWho: '',              // 操作紀錄的搜尋與兩排籤條
  dashSite: '',                                  // 總覽展開了哪一塊磚的各廠區數字
  showId: null, showFilter: 'open', showLines: null, showPick: null
};
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isRealAdmin = () => !!(S.user && S.user.role === 'admin');
// 管理者可切到「同仁視角」預覽:畫面一律以 isAdmin() 為準,實際權限仍在後端
const isAdmin = () => isRealAdmin() && !S.asUser;
/** 工作中的狀態(購物車、草稿、挑選清單)要綁使用者,不然同一台電腦換人登入會接手前一個人的東西 */
function uk(k) { return k + '_' + ((S.user && S.user.id) || '-'); }
const store = {
  get(k, d) { try { const v = localStorage.getItem('exh_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('exh_' + k, JSON.stringify(v)); } catch (e) { } },
  del(k) { try { localStorage.removeItem('exh_' + k); } catch (e) { } }
};
const pad2 = n => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); };

/* 日期的合理範圍。上下界跟後端 20_logic.gs 的 saneRange 是同一組數字 ——
   後端才是真正的守門,這裡只是讓人在按送出以前就看到問題,不用白跑一趟。 */
const DATE_BACK_DAYS = 1095, DATE_FWD_DAYS = 1825, MAX_SPAN_DAYS = 730;
const shiftDays = (d, k) => { const p = d.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + k)).toISOString().slice(0, 10); };
const dayGap = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
/** 塞進 <input type="date"> 的 min/max,日曆本身就先擋掉離譜的年份 */
const DLIM = () => `min="${shiftDays(todayStr(), -DATE_BACK_DAYS)}" max="${shiftDays(todayStr(), DATE_FWD_DAYS)}"`;
/** 有問題回傳訊息,沒問題回空字串。只填一半也要檢查 —— 年份打錯通常在第一個欄位就看得出來 */
function rangeProblem(a, b, la = '借出日', lb = '歸還日') {
  const t = todayStr();
  for (const [v, l] of [[a, la], [b, lb]]) {
    if (!v) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return `${l}的格式不對`;
    if (dayGap(t, v) < -DATE_BACK_DAYS) return `${l} ${v} 太久以前了,請確認年份有沒有打錯`;
    if (dayGap(t, v) > DATE_FWD_DAYS) return `${l} ${v} 太遠了,請確認年份有沒有打錯`;
  }
  if (!a || !b) return '';
  if (a > b) return `${lb}不可早於${la}`;
  if (dayGap(a, b) > MAX_SPAN_DAYS) return `期間共 ${dayGap(a, b) + 1} 天,超過上限 ${MAX_SPAN_DAYS} 天,請確認日期有沒有打錯`;
  return '';
}
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
  wrench: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M15.5 4.5a5 5 0 0 0-6.2 6.2L4 16l4 4 5.3-5.3a5 5 0 0 0 6.2-6.2L16.5 12 12 7.5l3.5-3z"/></svg>',
  trash: '<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M10 4h4M9 7v11M12 7v11M15 7v11M6 7l1 13h10l1-13"/></svg>'
};

/**
 * 清單裡的「移除這一項」。
 * 原本只是一個灰色的 ✕,緊貼在「在庫 3」右邊,看起來像標點符號而不是按鈕 ——
 * 使用者回報「找不到單獨刪除,只能整張清空」。所以這裡一定要有圖示 + 文字 + 框。
 */
function rmBtn(act, data, disabled) {
  return `<button type="button" class="rm" data-act="${act}" ${data} ${disabled ? 'disabled' : ''} aria-label="移除這一項">${ICON.trash}<span>移除</span></button>`;
}

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
/* ---------- 讀取快取存進 localStorage ----------
 * 量過了(2026-09-24):一趟來回 1.2～1.8 秒是**固定成本**,跟讀多少資料無關 ——
 * 讀整張借用單表(1,742 ms)跟什麼都不讀的 status(1,729 ms)一樣快,而且偶爾會跳到 8～26 秒。
 * 所以能做的不是「讀少一點」,是「不要讓人乾等那一趟」。
 * 記憶體快取重整就沒了,每天早上第一次打開、每次重整,每個分頁都得重等一趟。
 * 存進 localStorage 之後,打開先畫上次的,背景再更新(withData 本來就是這個模型,
 * 差別只在 stale 的來源從「這次開著的視窗」變成「上一次用的時候」)。
 */
const PERSIST_MAX = 12;                 // 最多留幾份,免得 show|xxx 這種一場一份的把空間塞爆
const PERSIST_MS = 12 * 3600 * 1000;    // 超過這個時間就不拿來畫,寧可等
const PERSIST_BYTES = 300000;           // 單筆太大就不存(localStorage 只有幾 MB)
const pkey = () => 'rc_' + ((S.user && S.user.id) || '-');
function persistWrite(key, data) {
  try {
    const raw = JSON.stringify({ at: Date.now(), data });
    if (raw.length > PERSIST_BYTES) return;
    const idx = store.get(pkey(), []).filter(k => k !== key);
    idx.push(key);
    while (idx.length > PERSIST_MAX) store.del(pkey() + '|' + idx.shift());
    localStorage.setItem('exh_' + pkey() + '|' + key, raw);
    store.set(pkey(), idx);
  } catch (e) { persistClear(); }       // 空間不夠就整批放棄,不要留下半套
}
function persistClear() {
  try {
    store.get(pkey(), []).forEach(k => store.del(pkey() + '|' + k));
    store.del(pkey());
  } catch (e) { }
}
/** 登入後把上次的快取倒回記憶體,讓第一次繪製不用等後端 */
function hydrateCache() {
  const now = Date.now();
  store.get(pkey(), []).forEach(k => {
    const hit = store.get(pkey() + '|' + k, null);
    if (!hit || !hit.data || now - hit.at > PERSIST_MS) return;
    RCACHE.set(k, { data: hit.data, at: hit.at });     // 保留原本的時間 → 不算新鮮 → 畫完會自己去更新
  });
}
function bumpCache() { CGEN++; RCACHE.clear(); INFLIGHT.clear(); persistClear(); }
function cacheSet(key, data, gen) {
  if (gen !== CGEN) return;
  RCACHE.set(key, { data, at: Date.now() });
  persistWrite(key, data);
}
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
/**
 * 先把請求丟出去,不等它回來。
 * **一趟來回大約 1.7 秒,容器冷掉時第一趟要 40 秒以上**(2026-09-24 實測)。
 * 所以真正的成本是「排了幾趟」,不是「讀了幾欄」—— 兩個沒有先後關係的請求排隊等於白等一趟。
 * fetchOnce 依 key 去重,所以稍後真的要用的人會直接接手同一個 promise,不會變成兩次請求。
 */
function warm(key, action, payload = {}) {
  if (RCACHE.has(key) || INFLIGHT.has(key)) return;
  const gen = CGEN;
  // **一定要把結果收進快取。** 只丟出去不收的話,它比另一個請求早回來時
  // INFLIGHT 已經清掉、RCACHE 又還沒有,等一下真的要用的人會再送一次 —— 白跑一趟,
  // 比不做還糟。(2026-09-24 逐頁量測抓到:目錄與展品管理各送了三趟,同一份資料要兩次。)
  fetchOnce(key, action, payload).then(data => cacheSet(key, data, gen)).catch(() => { });
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
/**
 * gen:呼叫端在「開始畫這個分頁」時記下的 RGEN。
 * 非同步的分頁(目錄、展品管理)在 await 之後才記的話,記到的已經是新分頁的名字,守衛形同虛設。
 */
async function withData(main, key, action, payload, draw, gen) {
  const live = () => gen == null || gen === RGEN;
  const hit = RCACHE.get(key);
  if (hit && live()) draw(copy(hit.data));
  if (fresh(hit)) return;               // 同一批資料的不同分頁互相切換時,不用重打
  let r;
  try { r = await freshFetch(key, action, payload); }
  catch (e) { if (!hit) throw e; if (!e.silent && live()) toast(e.message, true); return; }
  const changed = !hit || JSON.stringify(hit.data) !== JSON.stringify(r.data);
  cacheSet(key, r.data, r.gen);
  if (changed && live()) draw(copy(r.data));
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

/* ===================== 新版本偵測 =====================
 * `?v=<雜湊>` 只破壞得了 js/css 的快取 —— index.html 自己還是會被瀏覽器快取住,
 * 而舊的 index.html 裡寫的仍然是舊的 `?v=`,所以換版之後「重新整理」常常沒有用(2026-09-24 踩到)。
 * 做法:每次建置寫一個 version.json,頁面載入時拿它跟自己內嵌的建置編號比。
 * 就算這份 HTML 是從快取來的也照樣比得出來 —— 因為 version.json 是明確不進快取的。
 * 不自動重新整理:有人可能正在填單。只掛一條橫幅,由他決定什麼時候更新。
 */
const BUILD = (document.querySelector('meta[name=build]') || {}).content || '';
let lastBuildChk = 0;
async function checkBuild(force) {
  if (!BUILD || BUILD.indexOf('__') === 0) return;            // 直接開原始檔(沒經過建置)就不用比
  if (!force && Date.now() - lastBuildChk < 600000) return;   // 最多十分鐘問一次
  lastBuildChk = Date.now();
  try {
    const r = await fetch('version.json?cb=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const live = (await r.json()).build;
    if (live && live !== BUILD) showNewVer(live);
  } catch (e) { /* 連不到就算了,絕對不能影響正常使用 */ }
}
function showNewVer(live) {
  if ($('#newver')) return;
  const bar = document.createElement('div');
  bar.id = 'newver'; bar.className = 'newver';
  bar.innerHTML = `<span>系統已經更新,你看到的是舊畫面。</span><button class="btn sm pri" id="nv-go">立即更新</button>`;
  document.body.appendChild(bar);
  $('#nv-go').onclick = () => {
    // 不能用 location.reload() —— 它可能又從快取拿同一份舊的 index.html。
    // 換一個網址(帶建置編號)才會真的去抓新的。
    const to = location.pathname + '?b=' + encodeURIComponent(live);
    location.replace(to);
  };
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkBuild(); });

/* ===================== 登入 ===================== */
/**
 * 開機。
 * ⚠️ 這裡**一件事都不能等後端**。一趟來回 1.2～1.8 秒起跳,容器冷掉時 40 秒以上 ——
 * 原本的寫法是先等 `me`(或 `status`)回來才畫畫面,所以冷啟動時使用者對著白畫面乾等 40 幾秒,
 * 連登入表單都還沒出現。那才是「開起來很慢」最痛的一段。
 * 現在改成:畫面先出來,後端在背景確認。順便,那一趟背景請求會把冷掉的容器叫醒,
 * 等使用者打完工號按下登入時,容器已經熱了。
 */
async function boot() {
  checkBuild(true);
  S.token = store.get('token', null); S.user = store.get('user', null);
  if (S.token && S.user) {
    // 先用上次記下的身分把畫面開起來(資料也會從 localStorage 快取先畫出來),再去後端確認。
    // token 真的失效的話,第一個資料請求就會收到「登入已過期」,api() 會自己把人送回登入頁。
    const was = JSON.stringify([S.user.role, !!S.user.mustChangePin]);
    enterApp();
    api('me').then(u => {
      S.user = u; store.set('user', u);
      // 權限或強制改 PIN 變了才整個重畫,否則只更新頁首,不要無謂閃一下
      if (JSON.stringify([u.role, !!u.mustChangePin]) !== was) enterApp(); else syncRole();
    }).catch(() => { });
    return;
  }
  // `status` 只是用來判斷「這個系統有沒有使用者」,不值得讓人對著白畫面等它。
  showLogin('login');
  api('status').then(st => {
    // 只有全新的系統會走到這裡(還沒有任何使用者)。已經在打字就不要把表單換掉。
    const typed = $('#l-emp') && $('#l-emp').value;
    if (!st.hasUsers && !typed) showLogin('setup');
  }).catch(e => { if (!e.silent) toast(e.message, true); });
}
function showLogin(mode) {
  $('#app').classList.add('hidden'); $('#top').classList.add('hidden');
  const box = $('#login'); box.classList.remove('hidden');
  const setup = mode === 'setup';
  box.innerHTML = `<div class="card">
    <h1><span class="brand"><span class="dot">${ICON.box}</span></span>${esc(CONFIG.APP_NAME)}</h1>
    <p class="sub">${setup ? '建立第一位管理者' : '輸入工號即可查詢展品、送出借用申請'}</p>
    ${setup ? '<div class="banner info" style="font-size:13px">系統尚未有任何帳號。這位將成為管理者,之後可在「使用者」頁匯入全公司人員清單。</div>' : ''}
    <form id="login-f" autocomplete="off">
      ${setup ? '<label class="f"><span>姓名 <b>*</b></span><input type="text" name="name" required></label>' : ''}
      <label class="f"><span>工號 <b>*</b></span><input type="text" name="emp" id="l-emp" required autocapitalize="characters" value="${esc(setup ? '' : store.get('lastEmp', ''))}" style="font-size:20px;letter-spacing:.08em;text-align:center"></label>
      ${setup ? '<label class="f"><span>Email(接收通知)<b>*</b></span><input type="email" name="email" required></label>' : ''}
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
    const r = await run(() => setup ? api('setup', { name: p.name, empNo: p.emp, email: p.email, pin: p.pin }) : api('login', { emp: p.emp, pin: p.pin })).catch(() => null);
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
  bumpCache();                                            // 要在清掉 S.user 之前:pkey() 綁使用者
  S.token = null; S.user = null; S.asUser = false; store.del('token'); store.del('user');
  clearWork();                                            // 不清的話下一個人會看到上一個人的購物車
  if (expired) toast('登入已過期,請重新登入', true);
  showLogin('login');
}
/** 載入這個使用者自己的工作狀態(登入之後才做,因為 key 綁 user id) */
function loadWork() {
  S.cart = store.get(uk('cart'), []);
  S.plan = store.get(uk('plan'), { start: '', end: '' });
  S.editing = store.get(uk('editing'), null);
  S.showPick = store.get(uk('showpick'), null);
  S.showLines = null; S.showId = null;
  if (S.showPick) { S.showId = S.showPick.id; S.showLines = store.get(uk('showlines'), []); }
}
/** 登出 / 換人時把記憶體裡的工作狀態歸零(localStorage 留著,是那個人自己的) */
function clearWork() {
  S.cart = []; S.plan = { start: '', end: '' }; S.editing = null;
  S.showPick = null; S.showLines = null; S.showId = null;
  S.multi = new Set(); S.loanFilter = 'pending'; S.itemQ = ''; S.cat = ''; S.site = ''; S.itemSite = '';
  S.logQ = ''; S.logCat = ''; S.logWho = ''; S.loanHist = false; S.histOpen = false; S.openLoans = new Set();
  S.dashSite = '';
  // ⚠️ 新增任何篩選狀態都要加進這裡。v2.2 修過「換人登入會接手前一個人的狀態」,
  //    v2.7 加 filters.loc 時又漏了一次 —— 結構測試現在會擋。
  S.filters = { q: '', cat: '', loc: '', start: '', end: '', onlyAvail: false };
}
function enterApp() {
  loadWork();
  hydrateCache();                       // 先把上次的資料倒回來,第一次繪製就不用等後端
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); $('#top').classList.remove('hidden');
  S.asUser = isRealAdmin() && !!store.get('asUser_' + S.user.id, false);
  syncRole();
  $('#lookup-btn').classList.remove('hidden');
  const saved = store.get('view_' + S.user.id, null);
  S.view = saved && tabsFor().some(t => t[0] === saved) ? saved : (isAdmin() ? 'dash' : 'catalog');
  if (S.showPick) S.view = 'catalog';                    // 挑選到一半重新整理,回到原地繼續
  if (S.user.mustChangePin) { $('#main').innerHTML = ''; renderTabs(); return pinModal(true); }
  // 沒有 Email 就收不到任何通知,而且當事人不會知道 —— 在這裡補,不要讓他一路用下去
  if (!S.user.email) { $('#main').innerHTML = ''; renderTabs(); return emailModal(); }
  render();
  prefetch();
}
/**
 * 登入之後先把最常點的兩份資料抓起來放著。
 * 兩個作用:① 使用者真的點進去時已經有了 ② **順便把後端的容器叫醒** ——
 * Apps Script 閒置一陣子之後第一趟要 40 秒以上(2026-09-24 實測 45.7 秒),
 * 讓那一趟發生在「剛登入、還在看總覽」的時候,而不是他按下分頁之後。
 */
function prefetch() {
  warm('cats', 'cats');
  warm('catalog|', 'catalog');
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
  t.push(['catalog', '展品目錄'], ['plan', '借用申請' + (n ? ` <span class="n">${n}</span>` : '')], ['mine', '我的借用']);
  if (isAdmin()) t.push(['shows', '展覽檔期'], ['items', '展品管理'], ['count', '盤點'], ['users', '使用者'], ['logs', '紀錄']);
  return t;
}
function renderTabs() {
  $('#tabs').innerHTML = tabsFor().map(([k, l]) => `<button class="tab ${S.view === k ? 'on' : ''}" data-act="go" data-v="${k}">${l}</button>`).join('');
}
let RGEN = 0;                    // 畫面世代:每次切換分頁 +1,用來丟掉「上一個分頁晚回來的資料」
/** 量出標題列實際高度寫進 --toph:釘住的分類籤條要貼在它下面,不能猜一個固定值 */
function measureTop() {
  const t = document.querySelector('.top');
  if (t) document.documentElement.style.setProperty('--toph', Math.round(t.getBoundingClientRect().height) + 'px');
}
addEventListener('resize', measureTop);

async function render() {
  RGEN++;
  renderTabs();
  measureTop();
  if (S.user) store.set('view_' + S.user.id, S.view);
  const main = $('#main');
  const V = VIEWS[S.view];
  try { await V(main); } catch (e) { main.innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; }
}
function go(v) {
  // 離開展覽分頁(而且不是去挑展品)就把開著的那一場收掉,下次點分頁是看清單不是上一場
  if (S.view === 'shows' && v !== 'shows' && !S.showPick) { S.showId = null; S.showLines = null; }
  S.view = v; window.scrollTo(0, 0); render();
}
