/**
 * 【身份積木】10_identity.gs
 * 輸入:工號、管理者 PIN、登入 token
 * 責任:確認「你是誰」「你能做什麼」;維護人員名冊(工號、姓名、角色、PIN)
 *       同仁只憑工號登入(token 7 天);管理者需工號 + PIN(token 12 小時,錯 5 次鎖 10 分鐘)
 *       由他人設定的 PIN 須於首次登入時變更;登出會讓該使用者所有 token 失效(sessionVer)
 * 輸出:通過(使用者 + 角色)或拒絕(拋出錯誤)
 * 禁止:不管業務資料(展品、借用單)
 */
var Identity = (function () {
  var ADMIN_HOURS = 12, USER_HOURS = 24 * 7, MAX_FAIL = 5, LOCK_SEC = 600;

  function E(msg) { var e = new Error(msg); e.userFacing = true; return e; }
  function s(v) { return v == null ? '' : String(v).trim(); }
  function bool(v) { return v === true || v === 'true' || v === 'TRUE' || v === 1 || v === '1'; }

  /* ---- 密碼學小工具 ---- */
  function sha256(str) {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(str), Utilities.Charset.UTF_8);
    return bytes.map(function (b) { var h = (b & 255).toString(16); return h.length < 2 ? '0' + h : h; }).join('');
  }
  var secretCache_;
  function secret() {
    if (secretCache_) return secretCache_;
    var p = PropertiesService.getScriptProperties(), v = p.getProperty('SECRET');
    if (!v) { v = Utilities.getUuid() + Utilities.getUuid(); p.setProperty('SECRET', v); }
    return (secretCache_ = v);
  }
  function pinHash(uid, pin) { return sha256(secret() + ':' + uid + ':' + pin); }
  function makeToken(u) {
    var exp = Date.now() + (u.role === 'admin' ? ADMIN_HOURS : USER_HOURS) * 3600 * 1000;
    var base = u.id + '|' + (+u.sessionVer || 0) + '|' + exp;
    return base + '|' + sha256(secret() + '|' + base).slice(0, 32);
  }

  /* ---- 錯誤次數限制(CacheService) ---- */
  function guardOk_(k) { return (+CacheService.getScriptCache().get(k) || 0) < MAX_FAIL; }
  function guardFail_(k) { var c = CacheService.getScriptCache(); c.put(k, String((+c.get(k) || 0) + 1), LOCK_SEC); }
  function guardReset_(k) { CacheService.getScriptCache().remove(k); }

  /* ---- 名冊查詢 ---- */
  function byId_(db, id) { return db.Users.filter(function (u) { return u.id === id; })[0] || null; }
  function findByEmp(db, emp) {
    emp = s(emp).toUpperCase();
    if (!emp) return null;
    return db.Users.filter(function (u) { return s(u.empNo).toUpperCase() === emp; })[0] || null;
  }
  function pub(u) { return { id: u.id, empNo: u.empNo, name: u.name, dept: u.dept, email: u.email, role: u.role, active: bool(u.active), hasPin: !!s(u.pinHash), mustChangePin: bool(u.mustChange) }; }
  function nextId_(db) {
    var max = 0;
    db.Users.forEach(function (u) { var k = parseInt(s(u.id).slice(1), 10); if (k > max) max = k; });
    return 'U' + ('000' + (max + 1)).slice(-4);
  }
  function log_(db, who, action, ref, detail) {
    db._newLogs.push({ ts: Clock.now(), user: who ? who.name : '-', action: action, ref: ref || '', detail: detail || '' });
  }

  /* ---- 驗證 ---- */
  function checkPin_(u, pin) {
    var key = 'pin:' + u.id;
    if (!guardOk_(key)) throw E('PIN 錯誤次數過多,請 10 分鐘後再試');
    if (!s(u.pinHash) || u.pinHash !== pinHash(u.id, s(pin))) { guardFail_(key); throw E('PIN 不正確'); }
    guardReset_(key);
  }
  /** 由 token 取得登入者;失敗拋錯。action 用來判斷「待改 PIN」期間可做的事 */
  function authenticate(db, token, action) {
    var p = s(token).split('|');
    var ok = p.length === 4 && sha256(secret() + '|' + p[0] + '|' + p[1] + '|' + p[2]).slice(0, 32) === p[3] && +p[2] >= Date.now();
    var u = ok ? byId_(db, p[0]) : null;
    if (!u || !bool(u.active) || String(+u.sessionVer || 0) !== p[1]) throw E('登入已過期,請重新登入');
    if (bool(u.mustChange) && ['me', 'changePin', 'logout'].indexOf(action) < 0) throw E('請先變更 PIN');
    return u;
  }
  function requireAdmin(u) { if (!u || u.role !== 'admin') throw E('需要管理者權限'); }
  /** 當面確認:驗證在場管理者的工號 + PIN */
  function verifyAdmin(db, emp, pin) {
    var a = findByEmp(db, emp);
    if (!a || a.role !== 'admin' || !bool(a.active)) throw E('此工號不是管理者');
    checkPin_(a, pin);
    return a;
  }

  /* ---- 名冊維護 ---- */
  function createUser_(db, actor, p) {
    var name = s(p.name), emp = s(p.empNo).toUpperCase(), pin = s(p.pin), role = p.role === 'admin' ? 'admin' : 'user';
    if (!emp) throw E('請填寫工號');
    if (!name) throw E('請填寫姓名');
    if (findByEmp(db, emp)) throw E('工號 ' + emp + ' 已存在');
    if (role === 'admin' && !pin) throw E('管理者需設定 PIN');
    if (pin && !/^\w{4,12}$/.test(pin)) throw E('PIN 需為 4–12 碼英數字');
    var u = { id: nextId_(db), empNo: emp, name: name, dept: s(p.dept), email: s(p.email), role: role, active: true, createdAt: Clock.now(), pinHash: '', mustChange: false, sessionVer: 0 };
    if (pin) { u.pinHash = pinHash(u.id, pin); u.mustChange = !!actor; }   // 別人設定的 PIN → 首次登入須改
    db.Users.push(u); db._dirty.Users = true;
    log_(db, actor || u, '建立帳號', u.empNo, u.name + '(' + (role === 'admin' ? '管理者' : '使用者') + ')');
    return u;
  }

  /* ---- 對外動作(由守門調度分派) ---- */
  var actions = {
    status: function (c) { return { hasUsers: c.db.Users.length > 0, today: Clock.today() }; },
    setup: function (c) {
      if (c.db.Users.length) throw E('系統已初始化');
      var u = createUser_(c.db, null, { name: c.p.name, empNo: c.p.empNo, dept: c.p.dept, email: c.p.email, pin: c.p.pin, role: 'admin' });
      return { token: makeToken(u), user: pub(u) };
    },
    login: function (c) {
      var u = findByEmp(c.db, c.p.emp);
      if (!u) throw E('查無此工號,請確認輸入或聯絡展品管理者');
      if (!bool(u.active)) throw E('此帳號已停用,請聯絡管理者');
      if (u.role === 'admin') {
        if (!s(c.p.pin)) return { needPin: true, name: u.name };
        checkPin_(u, c.p.pin);
      }
      return { token: makeToken(u), user: pub(u) };
    },
    me: function (c) { return pub(c.user); },
    logout: function (c) {
      c.user.sessionVer = (+c.user.sessionVer || 0) + 1; c.db._dirty.Users = true;
      return true;
    },
    changePin: function (c) {
      var u = c.user;
      if (u.role !== 'admin') throw E('一般同仁以工號登入,不需要 PIN');
      if (u.pinHash !== pinHash(u.id, s(c.p.oldPin))) throw E('舊 PIN 不正確');
      if (!/^\w{4,12}$/.test(s(c.p.newPin))) throw E('新 PIN 需為 4–12 碼英數字');
      if (s(c.p.newPin) === s(c.p.oldPin)) throw E('新 PIN 不可與舊 PIN 相同');
      u.pinHash = pinHash(u.id, s(c.p.newPin)); u.mustChange = false; c.db._dirty.Users = true;
      log_(c.db, u, '變更 PIN', u.empNo, '');
      return true;
    },
    users: function (c) { return c.db.Users.map(pub); },
    saveUser: function (c) {
      var p = c.p.user || {};
      if (!s(p.id)) return pub(createUser_(c.db, c.user, p));
      var u = byId_(c.db, s(p.id));
      if (!u) throw E('找不到使用者');
      var name = s(p.name), emp = s(p.empNo).toUpperCase();
      if (!name || !emp) throw E('請填寫工號與姓名');
      var dup = findByEmp(c.db, emp);
      if (dup && dup.id !== u.id) throw E('工號 ' + emp + ' 已存在');
      var role = p.role === 'admin' ? 'admin' : 'user', active = p.active !== false;
      if (u.id === c.user.id && (role !== 'admin' || !active)) throw E('不能移除自己的管理者權限或停用自己');
      if (s(p.pin) && !/^\w{4,12}$/.test(s(p.pin))) throw E('PIN 需為 4–12 碼英數字');
      if (role === 'admin' && !s(u.pinHash) && !s(p.pin)) throw E('設為管理者需同時設定 PIN');
      var before = u.name + '/' + (u.role === 'admin' ? '管理者' : '使用者') + '/' + (bool(u.active) ? '啟用' : '停用');
      u.empNo = emp; u.name = name; u.dept = s(p.dept); u.email = s(p.email); u.role = role; u.active = active;
      if (s(p.pin)) { u.pinHash = pinHash(u.id, s(p.pin)); u.mustChange = u.id !== c.user.id; u.sessionVer = (+u.sessionVer || 0) + 1; }
      if (!active) u.sessionVer = (+u.sessionVer || 0) + 1;
      var after = u.name + '/' + (u.role === 'admin' ? '管理者' : '使用者') + '/' + (bool(u.active) ? '啟用' : '停用');
      c.db._dirty.Users = true;
      log_(c.db, c.user, '修改使用者', u.empNo, before + ' → ' + after + (s(p.pin) ? '(重設 PIN)' : ''));
      return pub(u);
    },
    importUsers: function (c) {
      var made = 0, upd = 0;
      (c.p.rows || []).forEach(function (r) {
        var emp = s(r.empNo).toUpperCase(), name = s(r.name);
        if (!emp || !name) return;
        var u = findByEmp(c.db, emp);
        if (u) {
          u.name = name; if (s(r.dept)) u.dept = s(r.dept); if (s(r.email)) u.email = s(r.email);
          if (s(r.active) !== '') u.active = !/^(0|n|no|false|停用|離職)$/i.test(s(r.active)) || u.id === c.user.id;
          upd++;
        } else {
          createUser_(c.db, c.user, { empNo: emp, name: name, dept: r.dept, email: r.email, role: 'user' }); made++;
        }
      });
      c.db._dirty.Users = true;
      log_(c.db, c.user, '匯入人員清單', '', '新增 ' + made + '、更新 ' + upd);
      return { created: made, updated: upd };
    }
  };

  return { actions: actions, authenticate: authenticate, requireAdmin: requireAdmin, verifyAdmin: verifyAdmin, findByEmp: findByEmp };
})();
