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
  // add(權限, 是否寫入, 積木動作表, { 動作: [允許的參數欄位] }, 需要的資料)
  // 讀取類動作只載入需要的工作表與欄位;寫入類一律全載,確保計算正確
  function add(auth, write, table, spec, need) {
    Object.keys(spec).forEach(function (k) {
      R[k] = { auth: auth, write: write, fields: spec[k], fn: table[k], tables: need || null };
    });
  }
  // 欄位組合:讀取類動作只讀真正用到的欄位(Sheets 讀取成本與儲存格數量成正比)
  var C = {
    LOAN_CALC: ['id', 'status', 'start', 'end', 'lines'],                                  // 只做可借量 / 在庫計算
    LOAN_MINE: ['id', 'status', 'start', 'end', 'lines', 'applicantId'],                   // 加上「是不是我的單」
    LOAN_HOLD: ['id', 'status', 'start', 'end', 'lines', 'applicant', 'dept', 'event'],    // 加上「這台在誰手上」
    UNIT_CALC: ['id', 'itemId', 'status', 'location', 'countedAt'],                        // 地點要算各廠區的庫存;countedAt 供「該地點最後盤點日」
    UNIT_PICK: ['id', 'itemId', 'status', 'serial', 'location', 'countedAt'],
    ITEM_CALC: ['id', 'name', 'category', 'mode', 'qty', 'location', 'stock', 'archived'],
    ITEM_CAT: ['id', 'name', 'category', 'archived'],
    USER_AUTH: ['id', 'name', 'dept', 'empNo', 'role', 'active', 'sessionVer', 'mustChange'],  // 不讀 pinHash / email
    SHOW_CALC: ['id', 'name', 'from', 'to', 'status', 'lines'],                            // 算展覽卡位 + 借用單上顯示場次名稱
    LOAN_SHOW: ['id', 'status', 'start', 'end', 'lines', 'showId', 'applicant', 'dept', 'event', 'createdAt'],
    HIST_USE: ['id', 'lines'],                                                            // 只用來判斷「這個展品借過沒」
    HIST_UNIT: ['id', 'status', 'start', 'end', 'lines', 'applicant', 'dept', 'event', 'outAt', 'returnedAt']  // 單台借用歷程
  };
  var A_ALL = { Items: '*', Units: '*', Loans: '*', Shows: C.SHOW_CALC, Users: C.USER_AUTH };
  // 寫入類一律全載(歷史表除外 —— 它只能附加,永遠不會被整張寫回)
  var FULL_ = { Cats: '*', Items: '*', Units: '*', Loans: '*', Shows: '*', Users: '*' };
  function withHist_(cols) {
    var o = {};
    Object.keys(FULL_).forEach(function (k) { o[k] = FULL_[k]; });
    o.Hist = cols;
    return o;
  }
  // 展覽會卡位,所以凡是要算「這段期間可借幾台」的讀取都得把展覽讀進來,否則會算得比實際多
  var SHOWS_ = C.SHOW_CALC;
  // 只做庫存 / 可借量計算時,已歸還與已取消的舊單完全用不到:
  // 記憶積木會先只讀 status 欄找出第一筆未結案的位置,再從那裡讀到最後
  // 與 20_logic.gs 的 `LIVE_ST` 是同一組狀態,改一邊要改兩邊(GAS 與前端跨不了執行環境,只能靠註解對齊)
  var LIVE = { field: 'status', values: ['pending', 'approved', 'out'] };
  var I = Identity.actions, U = Logic.USER, A = Logic.ADMIN;
  // 身份積木
  add('public', false, I, { status: [], login: ['emp', 'pin'] }, { Users: '*' });
  add('public', true, I, { setup: ['name', 'empNo', 'dept', 'email', 'pin'] }, FULL_);
  add('user', false, I, { me: [] }, { Users: '*' });
  add('user', true, I, { logout: [], changePin: ['oldPin', 'newPin'] }, FULL_);
  add('admin', false, I, { users: [] }, { Users: '*' });
  add('admin', true, I, { saveUser: ['user'], importUsers: ['rows'] }, FULL_);
  // 邏輯積木:同仁
  add('user', false, U, { catalog: ['start', 'end', 'showId'], check: ['start', 'end', 'lines', 'excludeId'] },
    { Items: '*', Units: C.UNIT_CALC, Loans: { cols: C.LOAN_CALC.concat(['showId']), only: LIVE }, Shows: SHOWS_, Users: C.USER_AUTH });
  add('user', false, U, { myLoans: [] },
    { Items: C.ITEM_CALC, Units: C.UNIT_CALC, Loans: '*', Shows: SHOWS_, Users: C.USER_AUTH });
  add('user', false, U, { pickupOptions: ['id'] },
    { Items: C.ITEM_CALC, Units: C.UNIT_PICK, Loans: C.LOAN_MINE, Users: C.USER_AUTH });
  add('user', false, U, { cats: [] }, { Cats: '*', Items: C.ITEM_CAT, Users: C.USER_AUTH });
  // 掃條碼查單台會列出借用歷程,封存的舊單也要接得起來,否則歷程會在封存那天憑空斷掉
  var LOOKUP_ = { Items: '*', Units: '*', Loans: '*', Shows: C.SHOW_CALC, Users: C.USER_AUTH, Hist: C.HIST_UNIT };
  add('user', false, U, { lookup: ['code'] }, LOOKUP_);
  add('user', true, U, {
    createLoan: ['event', 'venue', 'purpose', 'contact', 'note', 'start', 'end', 'lines', 'onBehalf', 'applicant', 'dept', 'force', 'showId'],
    updateLoan: ['id', 'event', 'venue', 'purpose', 'contact', 'note', 'start', 'end', 'lines', 'force'],
    cancelLoan: ['id', 'reason'], requestPickup: ['id', 'units', 'note'], requestReturn: ['id', 'lines', 'note'], cancelRequest: ['id'],
    requestExtend: ['id', 'end', 'note'], requestTransfer: ['id', 'emp', 'note']
  }, FULL_);
  // 邏輯積木:管理者
  add('admin', false, A, { dashboard: [] },
    { Items: '*', Units: '*', Loans: { cols: '*', only: LIVE }, Shows: SHOWS_, Users: C.USER_AUTH });
  // 借用單:只看進行中的那幾個分頁不必翻出歷史單,只有「已歸還 / 全部 / 已駁回 / 已取消」才整張讀
  var HISTORY_ = { returned: 1, all: 1, rejected: 1, cancelled: 1 };
  add('admin', false, A, { loans: ['filter', 'includeHistory'] }, function (p) {
    var live = !HISTORY_[String((p && p.filter) || 'active')];
    var spec = { Items: C.ITEM_CALC, Units: C.UNIT_CALC, Users: C.USER_AUTH, Shows: SHOWS_,
      Loans: live ? { cols: '*', only: LIVE } : '*' };
    // 歷史表只有在「翻舊單的分頁」而且使用者明確勾了才讀。預設不讀,不然搬歷史就白搬了
    if (!live && p && p.includeHistory) spec.Hist = '*';
    return spec;
  });
  add('admin', false, A, { items: [] },
    { Items: '*', Units: C.UNIT_CALC, Loans: { cols: C.LOAN_CALC, only: LIVE }, Users: C.USER_AUTH });
  add('admin', false, A, { units: ['itemId'] },
    { Items: C.ITEM_CALC, Units: '*', Loans: C.LOAN_HOLD, Shows: SHOWS_, Users: C.USER_AUTH });
  add('admin', false, A, { allCats: [] }, { Cats: '*', Items: C.ITEM_CAT, Users: C.USER_AUTH });
  add('admin', false, A, { logs: ['limit'] }, { Users: C.USER_AUTH });
  // 展覽:showIssued 要看到掛在展覽底下的每一張單(含已歸還),所以不截尾,只限縮欄位
  add('admin', false, A, { shows: ['filter'] },
    { Items: C.ITEM_CALC, Units: C.UNIT_CALC, Loans: C.LOAN_SHOW, Shows: '*', Users: C.USER_AUTH });
  // 展覽明細會把底下每一張借用單整張帶出來,所以這裡不能限縮借用單的欄位
  add('admin', false, A, { show: ['id'], showCheck: ['id', 'from', 'to', 'lines'], showSettle: ['id'] },
    { Items: C.ITEM_CALC, Units: C.UNIT_CALC, Loans: '*', Shows: '*', Users: C.USER_AUTH });
  add('admin', false, A, { archivePreview: ['includePlain'] },
    { Loans: { cols: ['id', 'status', 'showId', 'start', 'end', 'event'], only: null }, Shows: C.SHOW_CALC, Users: C.USER_AUTH });
  add('admin', true, A, {
    approve: ['id', 'note', 'force'], reject: ['id', 'note'], checkout: ['id', 'units', 'note'], receive: ['id', 'lines', 'note'],
    saveItem: ['item'], archiveItem: ['id', 'archived'], addUnits: ['itemId', 'count', 'location', 'serials'], saveUnit: ['unit'],
    stocktake: ['location', 'qty', 'unitItems', 'seenUnits', 'apply', 'markMissingLost'], importItems: ['rows'],
    saveCat: ['cat'], moveCat: ['id', 'dir'],
    approveMany: ['ids', 'note', 'force'], decideRequest: ['id', 'ok', 'note', 'force'], extendLoan: ['id', 'end', 'note', 'force'],
    extendMany: ['ids', 'end', 'note', 'force'],
    saveShow: ['show'], setShowStatus: ['id', 'status', 'force'], deleteShow: ['id'],
    createLoansFromShow: ['id', 'locations', 'force'], returnMany: ['id', 'ids', 'note']
  }, FULL_);
  // 這兩個動作要看得到歷史表:刪展品要知道舊單借過沒,封存要跳過已經搬過去的單
  add('admin', true, A, { deleteItem: ['id'] }, withHist_(C.HIST_USE));
  add('admin', true, A, { archiveLoans: ['ids', 'includePlain'] }, withHist_(['id']));
  // 照片上傳:交給檔案積木放進雲端硬碟,試算表只存連結。不碰試算表,所以不算寫入。
  R.uploadImage = { auth: 'admin', write: false, fields: ['name', 'data', 'ext'], big: 420000,
    tables: { Users: C.USER_AUTH }, fn: function (c) { return Files.saveImage(c.p.name, c.p.data, c.p.ext); } };
  // 當面確認:先由身份積木驗證在場管理者,再交邏輯積木
  R.confirmOnSite = { auth: 'user', write: true, fields: ['id', 'emp', 'pin'], tables: FULL_, fn: function (c) { return Logic.confirmOnSite(c, Identity.verifyAdmin(c.db, c.p.emp, c.p.pin)); } };
  return (ROUTES_ = R);
}

/** 輸入守門:只收白名單欄位,並限制字串長度、陣列大小與巢狀深度 */
var LIMITS_ = { str: 500, arr: 2000, depth: 5, body: 500000 };
function checkPayload_(payload, fields, maxStr) {
  var strMax = maxStr || LIMITS_.str;          // 只有照片上傳這類路由會放寬
  if (payload == null) return {};
  if (typeof payload !== 'object' || Array.isArray(payload)) throw userError_('參數格式錯誤');
  Object.keys(payload).forEach(function (k) { if (fields.indexOf(k) < 0) throw userError_('不接受的參數:' + k); });
  (function walk(v, d) {
    if (d > LIMITS_.depth) throw userError_('參數層級過深');
    if (typeof v === 'string') { if (v.length > strMax) throw userError_('文字過長(上限 ' + strMax + ' 字)'); return; }
    if (typeof v === 'number') { if (!isFinite(v)) throw userError_('數字格式錯誤'); return; }
    if (v == null || typeof v === 'boolean') return;
    if (Array.isArray(v)) { if (v.length > LIMITS_.arr) throw userError_('資料筆數過多'); v.forEach(function (x) { walk(x, d + 1); }); return; }
    if (typeof v === 'object') { Object.keys(v).forEach(function (k) { if (k.length > 64) throw userError_('參數名稱過長'); walk(v[k], d + 1); }); return; }
    throw userError_('參數格式錯誤');
  })(payload, 0);
  return payload;
}
function userError_(msg) { var e = new Error(msg); e.userFacing = true; return e; }

/**
 * 健康檢查頁。**一定要帶 health: true**:
 * Apps Script 的 /exec 會先回 302 再轉址,偶爾(特別是剛換版本那幾秒)POST 會被當成 GET 重送,
 * 於是前端拿到的是這一頁而不是它要的資料。沒有這個記號的話,前端會把這串字當成正常答案存進快取,
 * 畫面就會變成「資料全都不見了」。前端看到 health 就當成連線失敗處理(讀取類會自動重試)。
 */
function doGet() {
  return json_({ success: false, health: true, data: null, error: '這是後端的健康檢查頁,前端請用 POST 呼叫。' + new Date().toISOString() });
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
    var need = typeof route.tables === 'function' ? route.tables(req.payload || {}) : route.tables;
    var db = Memory.load(need), events = [];
    var c = { db: db, p: checkPayload_(req.payload, route.fields, route.big), user: null, today: Clock.today(), now: Clock.now() };
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
    // 歷史表不走 save():它只能附加。邏輯積木要搬單時透過這個把列寫進去,
    // 成功回來了才可以去動借用單表 —— 順序反過來就會掉單
    c.appendHist = Memory.appendHist;
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

/**
 * 升級用:在編輯器手動執行一次,只補這個版本新增的工作表(展覽、借用單歷史)。
 * 跟 setupSheets 不一樣 —— 核心工作表缺了它會報錯而不是重建,所以不會把異常變成一張看起來正常的空表。
 */
function upgradeSheets() {
  assertOwner_();
  var made = Memory.upgrade();
  console.log(made.length ? '已新增工作表:' + made.join('、') : '沒有需要新增的工作表,資料表已經是最新的');
}

/** 首次使用:在編輯器手動執行一次(建立工作表) */
function setupSheets() {
  assertOwner_();
  var names = Memory.setup();
  console.log('已建立工作表:' + names.join('、'));
}
