/**
 * 【守門+調度積木】00_gateway.gs  ← Web App 進入點
 * 輸入:前端送來的所有請求(POST,body = { action, payload, token })
 * 責任:① 驗證請求(交給身份積木)② 依 action 分派給身份 / 邏輯積木 ③ 統一回傳 { success, data, error }
 *       並以「一次請求 = 一次讀取 + 一次存檔」協調記憶積木,結束後把通知事件交給通知積木
 * 輸出:JSON
 * 禁止:本身不寫業務邏輯,只做「驗證+分派+包裝回傳」
 */

/** 時鐘(台北時間),供各積木共用 */
var Clock = {
  TZ: 'Asia/Taipei',
  today: function () { return Utilities.formatDate(new Date(), Clock.TZ, 'yyyy-MM-dd'); },
  now: function () { return Utilities.formatDate(new Date(), Clock.TZ, 'yyyy-MM-dd HH:mm'); }
};

/**
 * 路由表(第一次請求時建立,避免檔案載入順序問題):action → { auth: public|user|admin, write: 是否寫入, fn }
 * 新增功能時只在這裡登記,不在這裡寫規則。
 */
var ROUTES_ = null;
function routes_() {
  if (ROUTES_) return ROUTES_;
  var R = {};
  // add(權限, 是否寫入, 積木動作表, { 動作: [允許的參數欄位] }, 需要的資料表)
  // 讀取類動作只載入需要的工作表(寫入類一律全載,確保計算正確)
  function add(auth, write, table, spec, tables) {
    Object.keys(spec).forEach(function (k) {
      R[k] = { auth: auth, write: write, fields: spec[k], fn: table[k], tables: write ? null : (tables || null) };
    });
  }
  var T_ALL = ['Items', 'Units', 'Loans', 'Users'];
  var I = Identity.actions, U = Logic.USER, A = Logic.ADMIN;
  // 身份積木
  add('public', false, I, { status: [], login: ['emp', 'pin'] }, ['Users']);
  add('public', true, I, { setup: ['name', 'empNo', 'dept', 'email', 'pin'] });
  add('user', false, I, { me: [] }, ['Users']);
  add('user', true, I, { logout: [], changePin: ['oldPin', 'newPin'] });
  add('admin', false, I, { users: [] }, ['Users']);
  add('admin', true, I, { saveUser: ['user'], importUsers: ['rows'] });
  // 邏輯積木:同仁
  add('user', false, U, {
    catalog: ['start', 'end'], check: ['start', 'end', 'lines', 'excludeId'], myLoans: [],
    pickupOptions: ['id'], lookup: ['code']
  }, T_ALL);
  add('user', true, U, {
    createLoan: ['event', 'venue', 'purpose', 'contact', 'note', 'start', 'end', 'lines', 'onBehalf', 'applicant', 'dept', 'force'],
    cancelLoan: ['id', 'reason'], requestPickup: ['id', 'units', 'note'], requestReturn: ['id', 'lines', 'note'], cancelRequest: ['id']
  });
  // 邏輯積木:管理者
  add('admin', false, A, { dashboard: [], loans: ['filter'], items: [], units: ['itemId'] }, T_ALL);
  add('admin', false, A, { logs: ['limit'] }, ['Users']);
  add('admin', true, A, {
    approve: ['id', 'note', 'force'], reject: ['id', 'note'], checkout: ['id', 'units', 'note'], receive: ['id', 'lines', 'note'],
    saveItem: ['item'], archiveItem: ['id', 'archived'], addUnits: ['itemId', 'count', 'location', 'serials'], saveUnit: ['unit'],
    stocktake: ['qty', 'unitItems', 'seenUnits', 'apply', 'markMissingLost'], importItems: ['rows']
  });
  // 當面確認:先由身份積木驗證在場管理者,再交邏輯積木
  R.confirmOnSite = { auth: 'user', write: true, fields: ['id', 'emp', 'pin'], fn: function (c) { return Logic.confirmOnSite(c, Identity.verifyAdmin(c.db, c.p.emp, c.p.pin)); } };
  return (ROUTES_ = R);
}

/** 輸入守門:只收白名單欄位,並限制字串長度、陣列大小與巢狀深度 */
var LIMITS_ = { str: 500, arr: 2000, depth: 5, body: 500000 };
function checkPayload_(payload, fields) {
  if (payload == null) return {};
  if (typeof payload !== 'object' || Array.isArray(payload)) throw userError_('參數格式錯誤');
  Object.keys(payload).forEach(function (k) { if (fields.indexOf(k) < 0) throw userError_('不接受的參數:' + k); });
  (function walk(v, d) {
    if (d > LIMITS_.depth) throw userError_('參數層級過深');
    if (typeof v === 'string') { if (v.length > LIMITS_.str) throw userError_('文字過長(上限 ' + LIMITS_.str + ' 字)'); return; }
    if (typeof v === 'number') { if (!isFinite(v)) throw userError_('數字格式錯誤'); return; }
    if (v == null || typeof v === 'boolean') return;
    if (Array.isArray(v)) { if (v.length > LIMITS_.arr) throw userError_('資料筆數過多'); v.forEach(function (x) { walk(x, d + 1); }); return; }
    if (typeof v === 'object') { Object.keys(v).forEach(function (k) { if (k.length > 64) throw userError_('參數名稱過長'); walk(v[k], d + 1); }); return; }
    throw userError_('參數格式錯誤');
  })(payload, 0);
  return payload;
}
function userError_(msg) { var e = new Error(msg); e.userFacing = true; return e; }

function doGet() {
  return json_({ success: true, data: '展品管理 API 運作中 ' + new Date().toISOString(), error: null });
}

function doPost(e) {
  var req;
  var body = e && e.postData && e.postData.contents || '';
  if (body.length > LIMITS_.body) return json_({ success: false, data: null, error: '請求過大' });
  try { req = JSON.parse(body); } catch (err) { return json_({ success: false, data: null, error: '請求格式錯誤' }); }
  return json_(dispatch_(req));
}

function dispatch_(req) {
  var route = req && typeof req.action === 'string' && Object.prototype.hasOwnProperty.call(routes_(), req.action) ? routes_()[req.action] : null;
  if (!route) return { success: false, data: null, error: '未知的操作:' + (req && req.action) };
  var lock = LockService.getScriptLock();
  if (route.write && !lock.tryLock(20000)) return { success: false, data: null, error: '系統忙碌中,請稍後再試' };
  try {
    var db = Memory.load(route.tables), events = [];
    var c = { db: db, p: checkPayload_(req.payload, route.fields), user: null, today: Clock.today(), now: Clock.now() };
    if (route.auth !== 'public') c.user = Identity.authenticate(db, req.token, req.action);
    if (route.auth === 'admin') Identity.requireAdmin(c.user);
    c.logAs = function (who) {
      return function (action, ref, detail) {
        db._newLogs.push({ ts: Clock.now(), user: who ? who.name : '-', action: action, ref: ref || '', detail: typeof detail === 'string' ? detail : JSON.stringify(detail || '') });
      };
    };
    c.log = c.logAs(c.user);
    c.notify = function (to, subject, body) { events.push({ to: to, subject: subject, body: body }); };
    c.readLogs = Memory.readLogs;
    var data = route.fn(c);
    if (route.write) Memory.save(db);
    Notify.sendAll(events);
    return { success: true, data: data, error: null };
  } catch (err) {
    if (!err.userFacing) console.error('[dispatch] ' + req.action, err && err.stack || err);   // 細節只進後端紀錄
    return { success: false, data: null, error: err.userFacing ? err.message : '操作失敗,請稍後再試' };
  } finally {
    if (route.write) lock.releaseLock();
  }
}

function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/** 只允許專案擁有者在編輯器執行 */
function assertOwner_() {
  var active = Session.getActiveUser().getEmail(), eff = Session.getEffectiveUser().getEmail();
  if (!active || active !== eff) throw new Error('只有專案擁有者可以執行');
}

/** 首次使用:在編輯器手動執行一次(建立工作表) */
function setupSheets() {
  assertOwner_();
  var names = Memory.setup();
  console.log('已建立工作表:' + names.join('、'));
}
