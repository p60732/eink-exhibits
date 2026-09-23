/**
 * 【邏輯積木】20_logic.gs
 * 輸入:守門調度傳入的「已驗證」上下文 c = { db, p(參數), user(登入者), today, now, log(), notify() }
 *       ※ 純規則引擎:不讀系統時間(today/now 由外部傳入)、不呼叫任何 Google 服務
 * 責任:所有業務規則——庫存 / 可借量計算、借用申請、審核、簽收、歸還、盤點、展品維護、提醒內容
 * 輸出:計算結果(回傳前端);資料變動寫在 db 上由記憶積木存檔;通知以事件交給通知積木
 * 禁止:不碰 HTML / DOM;不直接接收未經守門的請求;不直接呼叫 MailApp / SpreadsheetApp
 */
var Logic = (function () {
  'use strict';
  var LOAN_ST = { pending: '待審核', approved: '已核准', out: '出借中', returned: '已歸還', rejected: '已駁回', cancelled: '已取消' };
  var REQ_ST = { pickup: '待確認領取', 'return': '待確認歸還', extend: '待確認延期', transfer: '待確認轉借' };
  var UNIT_ST = { 'in': '在庫', out: '借出', repair: '維修', lost: '遺失', retired: '報廢' };
  var FOREVER = '9999-12-31';

  /* ---------- 小工具 ---------- */
  function E(msg) { var e = new Error(msg); e.userFacing = true; return e; }
  function s(v) { return v == null ? '' : String(v).trim(); }
  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function int(v) { return Math.floor(n(v)); }
  function bool(v) { return v === true || v === 'true' || v === 'TRUE' || v === 1 || v === '1'; }
  function isDate(v) {
    v = s(v);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    var d = new Date(v + 'T00:00:00Z');   // 只用來檢查日曆是否存在,不讀「現在時間」
    return !isNaN(d) && d.toISOString().slice(0, 10) === v;
  }
  function addDays(d, k) {
    var p = d.split('-'), dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + k));
    return dt.toISOString().slice(0, 10);
  }
  /**
   * 本次請求的暫存索引。放在 WeakMap 而不是 db 上,規則層依然沒有碰到資料本身。
   * 資料一變就清掉,不會拿到過期的數字。
   */
  var MEMO = new WeakMap();
  function memo(db) {
    var m = MEMO.get(db);
    if (!m) { m = { cap: {}, li: null }; MEMO.set(db, m); }
    return m;
  }
  function dirty(db, t) {
    db._dirty[t] = true;
    var m = memo(db);
    if (t === 'Units' || t === 'Items') m.cap = {};
    if (t === 'Loans') m.li = null;
  }
  function byId(list, id) { for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]; return null; }
  function nextId(list, prefix, width) {
    var max = 0;
    list.forEach(function (r) {
      var id = s(r.id);
      if (id.indexOf(prefix) === 0) { var k = parseInt(id.slice(prefix.length), 10); if (k > max) max = k; }
    });
    var num = String(max + 1);
    while (num.length < width) num = '0' + num;
    return prefix + num;
  }
  function log(c, action, ref, detail) { c.log(action, ref, detail); }
  function notify(c, to, subject, body) { if (to && (!Array.isArray(to) || to.length)) c.notify(to, subject, body); }
  function findByEmp(db, emp) {
    emp = s(emp).toUpperCase();
    return emp ? db.Users.filter(function (u) { return s(u.empNo).toUpperCase() === emp; })[0] || null : null;
  }

  /* ---------- 庫存計算 ---------- */
  function outstanding(line) { return Math.max(0, int(line.qty) - int(line.returned) - int(line.lost)); }
  /** 總數(unit 模式數在庫+借出的台數);同一次請求內每個品項只算一次 */
  function capacity(db, item) {
    var cache = memo(db).cap;
    if (item.id in cache) return cache[item.id];
    var c;
    if (item.mode === 'unit') {
      c = 0;
      db.Units.forEach(function (u) { if (u.itemId === item.id && (u.status === 'in' || u.status === 'out')) c++; });
    } else c = int(item.qty);
    return (cache[item.id] = c);
  }
  function stats(db, today) {
    var m = {};
    db.Items.forEach(function (it) {
      m[it.id] = { total: capacity(db, it), out: 0, reserved: 0, repair: 0, lost: 0 };
    });
    db.Units.forEach(function (u) {
      if (!m[u.itemId]) return;
      if (u.status === 'repair') m[u.itemId].repair++;
      if (u.status === 'lost') m[u.itemId].lost++;
    });
    db.Loans.forEach(function (L) {
      if (L.status !== 'out' && L.status !== 'approved') return;
      (L.lines || []).forEach(function (ln) {
        var st = m[ln.itemId]; if (!st) return;
        if (L.status === 'out') st.out += outstanding(ln); else st.reserved += outstanding(ln);
      });
    });
    Object.keys(m).forEach(function (k) { m[k].inStock = m[k].total - m[k].out; });
    return m;
  }
  function loanWindow(L, today) {
    if (L.status === 'out') return [L.start < today ? L.start : today, L.end < today ? FOREVER : L.end];
    return [L.start, L.end];
  }
  /** 品項 → 還佔著它的借用明細;審核一整批時不用每張單都重掃整表 */
  function loanIndex(db) {
    var m = memo(db);
    if (m.li) return m.li;
    var idx = {};
    db.Loans.forEach(function (L) {
      if (L.status !== 'approved' && L.status !== 'out') return;
      (L.lines || []).forEach(function (ln) { (idx[ln.itemId] = idx[ln.itemId] || []).push({ L: L, ln: ln }); });
    });
    return (m.li = idx);
  }
  function reservedInRange(db, itemId, from, to, excludeId, today) {
    var sum = 0;
    (loanIndex(db)[itemId] || []).forEach(function (e) {
      if (e.L.id === excludeId) return;
      var w = loanWindow(e.L, today);
      if (w[0] > to || w[1] < from) return;
      sum += outstanding(e.ln);
    });
    return sum;
  }
  function availableInRange(db, item, from, to, excludeId, today) {
    return capacity(db, item) - reservedInRange(db, item.id, from, to, excludeId, today);
  }
  function checkLines(db, lines, from, to, excludeId, today) {
    return lines.map(function (ln) {
      var it = byId(db.Items, ln.itemId);
      if (!it) return { itemId: ln.itemId, name: '(已刪除)', qty: int(ln.qty), available: 0, short: int(ln.qty) };
      var av = availableInRange(db, it, from, to, excludeId, today);
      return { itemId: it.id, name: it.name, qty: int(ln.qty), available: Math.max(0, av), short: Math.max(0, int(ln.qty) - av) };
    });
  }
  function isOverdue(L, today) { return L.status === 'out' && L.end < today; }
  function enrichLoan(db, L, today) {
    var o = {};
    for (var k in L) o[k] = L[k];
    o.statusLabel = LOAN_ST[L.status] || L.status;
    o.request = L.request && L.request.type ? L.request : null;
    o.stage = o.request ? (REQ_ST[o.request.type] || '待確認') : '';
    o.overdue = isOverdue(L, today);
    if (o.overdue) o.overdueDays = Math.round((Date.parse(today) - Date.parse(L.end)) / 86400000);
    o.lines = (L.lines || []).map(function (ln) {
      var it = byId(db.Items, ln.itemId) || {};
      var x = {}; for (var k2 in ln) x[k2] = ln[k2];
      x.name = it.name || '(已刪除)'; x.mode = it.mode || 'qty'; x.outstanding = outstanding(ln);
      return x;
    });
    return o;
  }
  function sortLoans(a, b) { return a.createdAt < b.createdAt ? 1 : -1; }
  function currentLoanOfUnit(db, unitId) {
    for (var i = 0; i < db.Loans.length; i++) {
      var L = db.Loans[i];
      if (L.status !== 'out') continue;
      for (var j = 0; j < (L.lines || []).length; j++) {
        var ln = L.lines[j];
        if ((ln.units || []).indexOf(unitId) >= 0 && (ln.returnedUnits || []).indexOf(unitId) < 0 && (ln.lostUnits || []).indexOf(unitId) < 0) return L;
      }
    }
    return null;
  }
  function unitHistory(db, unitId) {
    var h = [];
    db.Loans.forEach(function (L) {
      (L.lines || []).forEach(function (ln) {
        if ((ln.units || []).indexOf(unitId) >= 0) h.push({ id: L.id, applicant: L.applicant, dept: L.dept, event: L.event, start: L.start, end: L.end, outAt: L.outAt, returnedAt: L.returnedAt, status: L.status, statusLabel: LOAN_ST[L.status] || L.status });
      });
    });
    return h.sort(function (a, b) { return a.start < b.start ? 1 : -1; });
  }
  function itemView(db, it, st, range, today) {
    var x = st[it.id] || { total: 0, out: 0, reserved: 0, inStock: 0, repair: 0, lost: 0 };
    var v = {
      id: it.id, name: it.name, category: it.category, mode: it.mode, location: it.location, spec: it.spec, note: it.note,
      image: it.image, archived: bool(it.archived), countedAt: it.countedAt, qty: int(it.qty),
      total: x.total, inStock: x.inStock, out: x.out, reserved: x.reserved, repair: x.repair, lost: x.lost
    };
    if (range) v.available = Math.max(0, availableInRange(db, it, range[0], range[1], null, today));
    return v;
  }
  function validRange(p) {
    if (!isDate(p.start) || !isDate(p.end)) throw E('請填寫借用起訖日期');
    if (p.start > p.end) throw E('歸還日不可早於借出日');
    return [p.start, p.end];
  }
  function cleanLines(db, lines) {
    var merged = {};
    (lines || []).forEach(function (ln) {
      var id = s(ln.itemId), q = int(ln.qty);
      if (!id || q <= 0) return;
      if (!byId(db.Items, id)) throw E('找不到展品 ' + id);
      merged[id] = (merged[id] || 0) + q;
    });
    var out = Object.keys(merged).map(function (id) { return { itemId: id, qty: merged[id], returned: 0, lost: 0, units: [], returnedUnits: [], lostUnits: [] }; });
    if (!out.length) throw E('請至少選擇一項展品');
    return out;
  }


  /* ---------- 分類 ---------- */
  /** 目前可選的分類,依 sort 排序 */
  function activeCats(db) {
    return (db.Cats || []).filter(function (x) { return !bool(x.archived); })
      .slice().sort(function (a, b) { return (n(a.sort) - n(b.sort)) || (a.name < b.name ? -1 : 1); });
  }
  function catByName(db, name) {
    var k = s(name).toLowerCase();
    var hit = (db.Cats || []).filter(function (x) { return s(x.name).toLowerCase() === k; });
    return hit[0] || null;
  }
  /** 取得分類名稱;沒有就照著建一個(批次匯入與手動輸入新分類都走這裡) */
  function ensureCat(c, name) {
    var want = s(name) || '未分類';
    var hit = catByName(c.db, want);
    if (hit) {
      if (bool(hit.archived)) { hit.archived = false; hit.updatedAt = c.now; dirty(c.db, 'Cats'); log(c, '啟用分類', hit.id, hit.name); }
      return hit.name;
    }
    if (want.length > 40) throw E('分類名稱過長(上限 40 字)');
    var max = 0;
    (c.db.Cats || []).forEach(function (x) { if (n(x.sort) > max) max = n(x.sort); });
    var cat = { id: nextId(c.db.Cats || [], 'C', 4), name: want, sort: max + 10, archived: false, updatedAt: c.now };
    c.db.Cats.push(cat); dirty(c.db, 'Cats'); log(c, '新增分類', cat.id, cat.name);
    return cat.name;
  }

  function emailsOfAdmins(db) {
    return db.Users.filter(function (u) { return u.role === 'admin' && bool(u.active) && s(u.email); }).map(function (u) { return u.email; });
  }
  function applicantEmail(db, L) {
    var u = byId(db.Users, L.applicantId);
    if (u && s(u.email)) return u.email;
    return /@/.test(s(L.contact)) ? s(L.contact) : '';
  }
  function linesText(db, L) {
    return (L.lines || []).map(function (ln) { var it = byId(db.Items, ln.itemId) || {}; return '・' + (it.name || ln.itemId) + ' × ' + ln.qty; }).join('\n');
  }

  /* ---------- 延期 / 轉借(管理者後台與當面確認共用) ---------- */
  /** 只檢查日期與延長期間的可借量,回傳不足的品項 */
  function checkExtend(db, L, newEnd, today) {
    if (!isDate(newEnd)) throw E('請填寫新的歸還日');
    if (newEnd <= L.end) throw E('新的歸還日要比原本的 ' + L.end + ' 晚');
    return checkLines(db, L.lines, addDays(L.end, 1), newEnd, L.id, today).filter(function (x) { return x.short > 0; });
  }
  function doExtend(c, L, newEnd, note, force) {
    var short = checkExtend(c.db, L, newEnd, c.today);
    if (short.length && !force) throw E('延長期間數量不足:' + short.map(function (x) { return x.name + ' 缺 ' + x.short; }).join('、') + '。若仍要延期請勾選「強制」');
    var old = L.end;
    L.end = newEnd; L.request = null;
    dirty(c.db, 'Loans');
    log(c, '延長歸還日', L.id, old + ' → ' + newEnd + (note ? '|' + note : ''));
    notify(c, applicantEmail(c.db, L), '[展品管理] 已延長歸還日 ' + L.id + ' — ' + L.event,
      '歸還日由 ' + old + ' 延長為 ' + newEnd + '。' + (note ? '\n備註:' + note : ''));
    return enrichLoan(c.db, L, c.today);
  }
  function doTransfer(c, L, toId, note) {
    var to = byId(c.db.Users, s(toId));
    if (!to || !bool(to.active)) throw E('找不到要轉給的人,或該帳號已停用');
    if (to.id === L.applicantId) throw E('借用人本來就是這個人');
    var from = L.applicant, fromMail = applicantEmail(c.db, L);
    L.applicant = to.name; L.applicantId = to.id; L.dept = s(to.dept);
    if (s(to.email)) L.contact = to.email;
    L.request = null;
    dirty(c.db, 'Loans');
    log(c, '轉借', L.id, from + ' → ' + to.name + (note ? '|' + note : ''));
    notify(c, [fromMail, s(to.email)].filter(function (x) { return x; }),
      '[展品管理] 借用已轉給 ' + to.name + ' ' + L.id + ' — ' + L.event,
      L.id + '(' + L.event + ')的借用人由 ' + from + ' 變更為 ' + to.name + ',歸還日 ' + L.end + '。' + (note ? '\n備註:' + note : ''));
    return enrichLoan(c.db, L, c.today);
  }

  /* ---------- 點交 / 歸還(管理者後台與當面確認共用) ---------- */
  function validatePickup(c, L, assign, allowPartial) {
    var today = c.today, st = stats(c.db, today), used = {}, clean = {};
    assign = assign || {};
    L.lines.forEach(function (ln) {
      var it = byId(c.db.Items, ln.itemId);
      if (!it) throw E('展品已不存在:' + ln.itemId);
      if (it.mode === 'unit') {
        var ids = (assign[ln.itemId] || []).map(function (x) { return s(x).toUpperCase(); });
        if (!allowPartial && ids.length !== int(ln.qty)) throw E(it.name + ' 需要指定 ' + ln.qty + ' 台(目前 ' + ids.length + ' 台)');
        if (ids.length > int(ln.qty)) throw E(it.name + ' 只借 ' + ln.qty + ' 台');
        ids.forEach(function (uid) {
          var u = byId(c.db.Units, uid);
          if (!u || u.itemId !== it.id) throw E(uid + ' 不是「' + it.name + '」的編號');
          if (u.status !== 'in') throw E(uid + ' 目前狀態為「' + UNIT_ST[u.status] + '」,無法出借');
          if (used[uid]) throw E(uid + ' 重複指定');
          used[uid] = 1;
        });
        clean[ln.itemId] = ids;
      } else if (st[it.id].inStock < int(ln.qty)) {
        throw E(it.name + ' 倉庫現有 ' + st[it.id].inStock + ',不足 ' + ln.qty);
      }
    });
    return clean;
  }
  function doCheckout(c, L, assign, note) {
    var today = c.today;
    if (L.status !== 'approved') throw E('只有「已核准」的借用單可以點交出借');
    var clean = validatePickup(c, L, assign, false);
    L.lines.forEach(function (ln) {
      if (clean[ln.itemId]) {
        ln.units = clean[ln.itemId];
        ln.units.forEach(function (uid) { var u = byId(c.db.Units, uid); u.status = 'out'; u.updatedAt = c.now; });
      }
    });
    L.status = 'out'; L.outAt = c.now; L.request = null;
    if (s(note)) L.note = s(L.note) + ' [點交] ' + s(note);
    dirty(c.db, 'Loans'); dirty(c.db, 'Units');
    log(c, c.onSite ? '當面確認領取' : '點交出借', L.id, L.applicant + ' 領取;' + L.lines.map(function (ln) { return ln.itemId + '×' + ln.qty + (ln.units.length ? '(' + ln.units.join(',') + ')' : ''); }).join(' '));
    return enrichLoan(c.db, L, today);
  }
  function doReceive(c, L, inputLines, note) {
    var today = c.today, now = c.now;
    if (L.status !== 'out') throw E('只有「出借中」的借用單可以歸還');
    var input = {}; (inputLines || []).forEach(function (x) { input[x.itemId] = x; });
    var notes = [];
    L.lines.forEach(function (ln) {
      var x = input[ln.itemId]; if (!x) return;
      var it = byId(c.db.Items, ln.itemId);
      if (it && it.mode === 'unit') {
        var pending = ln.units.filter(function (u) { return ln.returnedUnits.indexOf(u) < 0 && ln.lostUnits.indexOf(u) < 0; });
        (x.unitResults || []).forEach(function (r) {
          var uid = s(r.id).toUpperCase();
          if (pending.indexOf(uid) < 0) return;
          var u = byId(c.db.Units, uid);
          if (r.result === 'lost') { ln.lostUnits.push(uid); ln.lost = int(ln.lost) + 1; if (u) u.status = 'lost'; notes.push(uid + ' 遺失'); }
          else if (r.result === 'in' || r.result === 'repair') {
            ln.returnedUnits.push(uid); ln.returned = int(ln.returned) + 1;
            if (u) u.status = r.result; if (r.result === 'repair') notes.push(uid + ' 送修');
          }
          if (u) { u.updatedAt = now; if (s(r.note)) u.note = s(r.note); }
        });
      } else {
        var left = outstanding(ln), ret = Math.min(left, Math.max(0, int(x.returned))), lost = Math.min(left - ret, Math.max(0, int(x.lost)));
        ln.returned = int(ln.returned) + ret; ln.lost = int(ln.lost) + lost;
        if (lost && it) { it.qty = Math.max(0, int(it.qty) - lost); it.updatedAt = now; dirty(c.db, 'Items'); notes.push(it.name + ' 短少 ' + lost); }
      }
    });
    var done = L.lines.every(function (ln) { return outstanding(ln) === 0; });
    if (done) { L.status = 'returned'; L.returnedAt = now; }
    L.request = null;
    if (s(note)) L.note = s(L.note) + ' [歸還] ' + s(note);
    dirty(c.db, 'Loans'); dirty(c.db, 'Units');
    log(c, (c.onSite ? '當面確認' : '') + (done ? '歸還完成' : '部分歸還'), L.id, notes.join(';') || '正常歸還');
    return enrichLoan(c.db, L, today);
  }
  function ownLoan(c) {
    var L = byId(c.db.Loans, s(c.p.id));
    if (!L) throw E('找不到借用單');
    if (L.applicantId !== c.user.id && c.user.role !== 'admin') throw E('這不是你的借用單');
    return L;
  }

  /* ---------- 同仁可用的動作 ---------- */
  var USER = {
    catalog: function (c) {
      var today = c.today, range = null;
      if (isDate(c.p.start) && isDate(c.p.end)) range = [c.p.start, c.p.end];
      var st = stats(c.db, today);
      return c.db.Items.filter(function (it) { return !bool(it.archived); })
        .map(function (it) { return itemView(c.db, it, st, range, today); });
    },
    check: function (c) {
      var r = validRange(c.p);
      var lines = (c.p.lines || []).filter(function (l) { return int(l.qty) > 0; });
      return checkLines(c.db, lines, r[0], r[1], c.p.excludeId || null, c.today);
    },
    createLoan: function (c) {
      var r = validRange(c.p), today = c.today, isAdmin = c.user.role === 'admin';
      if (!isAdmin && r[0] < today) throw E('借出日不可早於今天');
      if (!s(c.p.event)) throw E('請填寫活動 / 展覽名稱');
      var lines = cleanLines(c.db, c.p.lines);
      var chk = checkLines(c.db, lines, r[0], r[1], null, today);
      var short = chk.filter(function (x) { return x.short > 0; });
      if (short.length && !(isAdmin && c.p.force)) {
        throw E('以下展品在該期間數量不足:' + short.map(function (x) { return x.name + '(需 ' + x.qty + ',可借 ' + x.available + ')'; }).join('、'));
      }
      var onBehalf = isAdmin && c.p.onBehalf && s(c.p.applicant);
      var who = null;
      if (onBehalf) {
        who = findByEmp(c.db, c.p.applicant);
        if (!who) { var byName = c.db.Users.filter(function (u) { return s(u.name) === s(c.p.applicant); }); if (byName.length === 1) who = byName[0]; }
      }
      var L = {
        id: nextId(c.db.Loans, 'L' + today.slice(2, 4) + today.slice(5, 7) + '-', 3),
        applicant: onBehalf ? (who ? who.name : s(c.p.applicant)) : c.user.name,
        applicantId: onBehalf ? (who ? who.id : '') : c.user.id,
        dept: onBehalf ? (s(c.p.dept) || (who ? s(who.dept) : '')) : (s(c.p.dept) || s(c.user.dept)),
        contact: s(c.p.contact) || s(c.user.email),
        event: s(c.p.event), venue: s(c.p.venue), purpose: s(c.p.purpose),
        start: r[0], end: r[1], status: onBehalf ? 'approved' : 'pending', lines: lines,
        createdBy: c.user.name, createdAt: c.now,
        reviewer: onBehalf ? c.user.name : '', reviewedAt: onBehalf ? c.now : '', reviewNote: onBehalf ? '管理者代為登記' : '',
        outAt: '', returnedAt: '', note: s(c.p.note), request: null
      };
      L.request = null;
      c.db.Loans.push(L); dirty(c.db, 'Loans');
      log(c, onBehalf ? '代為登記借用' : '提出借用申請', L.id, L.applicant + '|' + L.event + '|' + L.start + '~' + L.end);
      if (!onBehalf) notify(c, emailsOfAdmins(c.db), '[展品管理] 新借用申請 ' + L.id + ' — ' + L.event,
        L.applicant + '(' + L.dept + ')申請借用\n活動:' + L.event + '\n期間:' + L.start + ' ~ ' + L.end + '\n\n' + linesText(c.db, L));
      return enrichLoan(c.db, L, today);
    },
    myLoans: function (c) {
      var today = c.today, id = c.user.id;
      return c.db.Loans.filter(function (L) { return L.applicantId === id; }).slice().sort(sortLoans)
        .map(function (L) { return enrichLoan(c.db, L, today); });
    },
    /** 待審核的申請可以自己改,不用取消重來(改完仍是待審核) */
    updateLoan: function (c) {
      var L = ownLoan(c), isAdmin = c.user.role === 'admin';
      if (L.status !== 'pending') throw E('只有「待審核」的申請可以修改');
      var r = validRange(c.p);
      if (!isAdmin && r[0] < c.today) throw E('借出日不可早於今天');
      if (!s(c.p.event)) throw E('請填寫活動 / 展覽名稱');
      var lines = cleanLines(c.db, c.p.lines);
      var short = checkLines(c.db, lines, r[0], r[1], L.id, c.today).filter(function (x) { return x.short > 0; });
      if (short.length && !(isAdmin && c.p.force)) {
        throw E('以下展品在該期間數量不足:' + short.map(function (x) { return x.name + '(需 ' + x.qty + ',可借 ' + x.available + ')'; }).join('、'));
      }
      var before = L.event + '|' + L.start + '~' + L.end + '|' + L.lines.length + ' 項';
      L.event = s(c.p.event); L.venue = s(c.p.venue); L.purpose = s(c.p.purpose);
      L.contact = s(c.p.contact) || L.contact; L.note = s(c.p.note);
      L.start = r[0]; L.end = r[1]; L.lines = lines;
      dirty(c.db, 'Loans');
      log(c, '修改借用申請', L.id, before + ' → ' + L.event + '|' + L.start + '~' + L.end + '|' + lines.length + ' 項');
      return enrichLoan(c.db, L, c.today);
    },
    /** 展期延後:申請延長歸還日,管理者確認後生效 */
    requestExtend: function (c) {
      var L = ownLoan(c);
      if (L.status !== 'approved' && L.status !== 'out') throw E('只有已核准或出借中的借用可以申請延期');
      if (L.request && L.request.type) throw E('這張單還有待確認的請求,請先完成或撤回');
      var newEnd = s(c.p.end);
      checkExtend(c.db, L, newEnd, c.today);
      L.request = { type: 'extend', at: c.now, by: c.user.name, end: newEnd, note: s(c.p.note) };
      dirty(c.db, 'Loans'); log(c, '申請延長歸還日', L.id, L.end + ' → ' + newEnd);
      notify(c, emailsOfAdmins(c.db), '[展品管理] 延期申請 ' + L.id + ' — ' + L.event,
        L.applicant + ' 申請把歸還日由 ' + L.end + ' 延長為 ' + newEnd + '。' + (s(c.p.note) ? '\n說明:' + s(c.p.note) : ''));
      return enrichLoan(c.db, L, c.today);
    },
    /** 現場把東西交給別人:申請轉借,管理者確認後生效 */
    requestTransfer: function (c) {
      var L = ownLoan(c);
      if (L.status !== 'approved' && L.status !== 'out') throw E('只有已核准或出借中的借用可以轉借');
      if (L.request && L.request.type) throw E('這張單還有待確認的請求,請先完成或撤回');
      var to = findByEmp(c.db, c.p.emp);
      if (!to) throw E('查無此工號');
      if (!bool(to.active)) throw E('此帳號已停用');
      if (to.id === L.applicantId) throw E('借用人本來就是這個人');
      L.request = { type: 'transfer', at: c.now, by: c.user.name, toId: to.id, toName: to.name, note: s(c.p.note) };
      dirty(c.db, 'Loans'); log(c, '申請轉借', L.id, L.applicant + ' → ' + to.name);
      notify(c, emailsOfAdmins(c.db), '[展品管理] 轉借申請 ' + L.id + ' — ' + L.event,
        L.applicant + ' 要把借用轉給 ' + to.name + '(' + s(to.empNo) + ')。');
      return enrichLoan(c.db, L, c.today);
    },
    cancelLoan: function (c) {
      var L = byId(c.db.Loans, s(c.p.id));
      if (!L) throw E('找不到借用單');
      if (L.applicantId !== c.user.id && c.user.role !== 'admin') throw E('只能取消自己的申請');
      if (L.status !== 'pending' && L.status !== 'approved') throw E('此狀態無法取消');
      L.status = 'cancelled'; L.request = null; L.note = s(L.note) + (c.p.reason ? ' [取消原因] ' + s(c.p.reason) : '');
      dirty(c.db, 'Loans'); log(c, '取消借用', L.id, s(c.p.reason));
      return enrichLoan(c.db, L, c.today);
    },
    pickupOptions: function (c) {
      var L = ownLoan(c);
      if (L.status !== 'approved') throw E('這筆借用目前不能簽收');
      var st = stats(c.db, c.today);
      return L.lines.map(function (ln) {
        var it = byId(c.db.Items, ln.itemId) || {};
        return { itemId: ln.itemId, name: it.name, mode: it.mode, qty: int(ln.qty), inStock: st[ln.itemId] ? st[ln.itemId].inStock : 0,
          units: it.mode === 'unit' ? c.db.Units.filter(function (u) { return u.itemId === it.id && u.status === 'in'; }).map(function (u) { return { id: u.id, serial: u.serial }; }) : [] };
      });
    },
    requestPickup: function (c) {
      var L = ownLoan(c);
      if (L.status !== 'approved') throw E('只有「已核准」的借用可以簽收');
      var clean = validatePickup(c, L, c.p.units, false);
      L.request = { type: 'pickup', at: c.now, by: c.user.name, units: clean, note: s(c.p.note) };
      dirty(c.db, 'Loans'); log(c, '申請簽收領取', L.id, s(c.p.note));
      return enrichLoan(c.db, L, c.today);
    },
    requestReturn: function (c) {
      var L = ownLoan(c);
      if (L.status !== 'out') throw E('只有「出借中」的借用可以歸還');
      var lines = (c.p.lines || []).map(function (x) {
        return { itemId: s(x.itemId), returned: int(x.returned), lost: int(x.lost),
          unitResults: (x.unitResults || []).filter(function (r) { return r && r.result; }).map(function (r) { return { id: s(r.id).toUpperCase(), result: r.result, note: s(r.note) }; }) };
      });
      L.request = { type: 'return', at: c.now, by: c.user.name, lines: lines, note: s(c.p.note) };
      dirty(c.db, 'Loans'); log(c, '申請歸還', L.id, s(c.p.note));
      return enrichLoan(c.db, L, c.today);
    },
    cancelRequest: function (c) {
      var L = ownLoan(c);
      if (!L.request) throw E('沒有待確認的申請');
      L.request = null; dirty(c.db, 'Loans'); log(c, '取消簽收 / 歸還申請', L.id, '');
      return enrichLoan(c.db, L, c.today);
    },
    cats: function (c) {
      var used = {};
      c.db.Items.forEach(function (it) { if (!bool(it.archived)) used[it.category] = (used[it.category] || 0) + 1; });
      return activeCats(c.db).map(function (x) { return { id: x.id, name: x.name, count: used[x.name] || 0 }; });
    },
    lookup: function (c) {
      var code = s(c.p.code).toUpperCase(), today = c.today;
      var u = byId(c.db.Units, code);
      if (u) {
        var it = byId(c.db.Items, u.itemId) || {};
        var L = currentLoanOfUnit(c.db, u.id);
        return {
          type: 'unit', unit: u, statusLabel: UNIT_ST[u.status], item: { id: it.id, name: it.name, category: it.category, location: it.location },
          loan: L ? enrichLoan(c.db, L, today) : null,
          history: c.user.role === 'admin' ? unitHistory(c.db, u.id).slice(0, 10) : []
        };
      }
      var item = byId(c.db.Items, code);
      if (item) return { type: 'item', item: itemView(c.db, item, stats(c.db, today), null, today) };
      throw E('查無此編號:' + code);
    }
  };

  var ADMIN = {
    dashboard: function (c) {
      var today = c.today, st = stats(c.db, today), soon = addDays(today, 3);
      var items = c.db.Items.filter(function (it) { return !bool(it.archived); });
      var sum = { items: items.length, total: 0, inStock: 0, out: 0, reserved: 0, repair: 0, lost: 0 };
      items.forEach(function (it) { var x = st[it.id]; ['total', 'inStock', 'out', 'reserved', 'repair', 'lost'].forEach(function (k) { sum[k] += x[k]; }); });
      var en = function (L) { return enrichLoan(c.db, L, today); };
      var L = c.db.Loans;
      return {
        today: today, sum: sum,
        pending: L.filter(function (x) { return x.status === 'pending'; }).sort(sortLoans).map(en),
        overdue: L.filter(function (x) { return isOverdue(x, today); }).map(en),
        dueSoon: L.filter(function (x) { return x.status === 'out' && x.end >= today && x.end <= soon; }).map(en),
        requests: L.filter(function (x) { return x.request && x.request.type && (x.status === 'approved' || x.status === 'out'); }).map(en),
        pickups: L.filter(function (x) { return x.status === 'approved' && x.start <= soon; }).sort(function (a, b) { return a.start < b.start ? -1 : 1; }).map(en),
        outCount: L.filter(function (x) { return x.status === 'out'; }).length,
        lowStock: items.map(function (it) { return itemView(c.db, it, st, null, today); }).filter(function (v) { return v.total > 0 && v.inStock === 0; })
      };
    },
    loans: function (c) {
      var today = c.today, f = s(c.p.filter) || 'active';
      return c.db.Loans.filter(function (L) {
        if (f === 'all') return true;
        if (f === 'active') return L.status === 'pending' || L.status === 'approved' || L.status === 'out';
        if (f === 'overdue') return isOverdue(L, today);
        if (f === 'request') return !!(L.request && L.request.type) && (L.status === 'approved' || L.status === 'out');
        return L.status === f;
      }).slice().sort(sortLoans).map(function (L) {
        var o = enrichLoan(c.db, L, today);
        if (L.status === 'pending' || L.status === 'approved') o.check = checkLines(c.db, L.lines, L.start, L.end, L.id, today);
        return o;
      });
    },
    approve: function (c) {
      var L = byId(c.db.Loans, s(c.p.id)), today = c.today;
      if (!L || L.status !== 'pending') throw E('此申請不是待審核狀態');
      var short = checkLines(c.db, L.lines, L.start, L.end, L.id, today).filter(function (x) { return x.short > 0; });
      if (short.length && !c.p.force) throw E('數量不足:' + short.map(function (x) { return x.name + ' 缺 ' + x.short; }).join('、') + '。若仍要核准請勾選「強制核准」');
      L.status = 'approved'; L.reviewer = c.user.name; L.reviewedAt = c.now; L.reviewNote = s(c.p.note);
      dirty(c.db, 'Loans'); log(c, '核准借用', L.id, s(c.p.note));
      notify(c, applicantEmail(c.db, L), '[展品管理] 借用已核准 ' + L.id + ' — ' + L.event,
        '您的借用申請已核准,請於 ' + L.start + ' 前往點交領取。\n歸還日:' + L.end + '\n\n' + linesText(c.db, L) + (L.reviewNote ? '\n\n備註:' + L.reviewNote : ''));
      return enrichLoan(c.db, L, today);
    },
    reject: function (c) {
      var L = byId(c.db.Loans, s(c.p.id));
      if (!L || (L.status !== 'pending' && L.status !== 'approved')) throw E('此借用單無法駁回');
      if (!s(c.p.note)) throw E('請填寫駁回原因');
      L.status = 'rejected'; L.reviewer = c.user.name; L.reviewedAt = c.now; L.reviewNote = s(c.p.note);
      dirty(c.db, 'Loans'); log(c, '駁回借用', L.id, s(c.p.note));
      notify(c, applicantEmail(c.db, L), '[展品管理] 借用未核准 ' + L.id + ' — ' + L.event, '原因:' + L.reviewNote);
      return enrichLoan(c.db, L, c.today);
    },
    /** 處理同仁送出的延期 / 轉借申請 */
    decideRequest: function (c) {
      var L = byId(c.db.Loans, s(c.p.id));
      if (!L) throw E('找不到借用單');
      var req = L.request;
      if (!req || (req.type !== 'extend' && req.type !== 'transfer')) throw E('這張單沒有待處理的延期或轉借申請');
      if (!bool(c.p.ok)) {
        L.request = null; dirty(c.db, 'Loans');
        log(c, req.type === 'extend' ? '不同意延期' : '不同意轉借', L.id, s(c.p.note));
        notify(c, applicantEmail(c.db, L), '[展品管理] ' + (req.type === 'extend' ? '延期' : '轉借') + '申請未通過 ' + L.id + ' — ' + L.event,
          '原因:' + (s(c.p.note) || '未說明'));
        return enrichLoan(c.db, L, c.today);
      }
      return req.type === 'extend' ? doExtend(c, L, req.end, s(c.p.note), bool(c.p.force)) : doTransfer(c, L, req.toId, s(c.p.note));
    },
    /** 管理者直接延期,不用等同仁申請 */
    extendLoan: function (c) {
      var L = byId(c.db.Loans, s(c.p.id));
      if (!L) throw E('找不到借用單');
      if (L.status !== 'approved' && L.status !== 'out') throw E('只有已核准或出借中的借用可以延期');
      return doExtend(c, L, s(c.p.end), s(c.p.note), bool(c.p.force));
    },
    /** 批次核准:一張失敗不影響其他張,回報哪幾張沒過 */
    approveMany: function (c) {
      var ids = (c.p.ids || []).map(s).filter(Boolean), ok = 0, fail = [];
      if (!ids.length) throw E('請先勾選要核准的借用單');
      if (ids.length > 50) throw E('一次最多核准 50 張');
      ids.forEach(function (id) {
        var sub = { db: c.db, p: { id: id, note: s(c.p.note), force: bool(c.p.force) }, user: c.user,
          today: c.today, now: c.now, log: c.log, logAs: c.logAs, notify: c.notify };
        try { ADMIN.approve(sub); ok++; }
        catch (e) { fail.push({ id: id, error: e.userFacing ? e.message : '無法核准' }); }
      });
      return { ok: ok, fail: fail };
    },
    checkout: function (c) {
      var L = byId(c.db.Loans, s(c.p.id));
      if (!L) throw E('找不到借用單');
      var units = c.p.units || (L.request && L.request.type === 'pickup' ? L.request.units : {});
      return doCheckout(c, L, units, c.p.note);
    },
    receive: function (c) {
      var L = byId(c.db.Loans, s(c.p.id));
      if (!L) throw E('找不到借用單');
      var lines = c.p.lines || (L.request && L.request.type === 'return' ? L.request.lines : []);
      return doReceive(c, L, lines, c.p.note);
    },
    items: function (c) {
      var today = c.today, st = stats(c.db, today);
      return c.db.Items.map(function (it) { return itemView(c.db, it, st, null, today); });
    },
    allCats: function (c) {
      var used = {};
      c.db.Items.forEach(function (it) { used[it.category] = (used[it.category] || 0) + 1; });
      return (c.db.Cats || []).slice().sort(function (a, b) { return (n(a.sort) - n(b.sort)) || (a.name < b.name ? -1 : 1); })
        .map(function (x) { return { id: x.id, name: x.name, archived: bool(x.archived), count: used[x.name] || 0 }; });
    },
    /** 新增 / 改名 / 停用分類;改名時底下的展品跟著走 */
    saveCat: function (c) {
      var p = c.p.cat || {}, id = s(p.id), name = s(p.name);
      if (!id) {
        if (!name) throw E('請填寫分類名稱');
        var same = catByName(c.db, name);
        if (same && !bool(same.archived)) throw E('分類「' + same.name + '」已存在');
        ensureCat(c, name);                       // 停用過的同名分類會直接重新啟用
        return ADMIN.allCats(c);
      }
      var cat = byId(c.db.Cats, id);
      if (!cat) throw E('找不到分類');
      if (name && name !== cat.name) {
        if (name.length > 40) throw E('分類名稱過長(上限 40 字)');
        var dup = catByName(c.db, name);
        if (dup && dup.id !== cat.id) throw E('分類「' + name + '」已存在');
        var old = cat.name;
        c.db.Items.forEach(function (it) { if (it.category === old) { it.category = name; dirty(c.db, 'Items'); } });
        cat.name = name; log(c, '分類改名', cat.id, old + ' → ' + name);
      }
      if ('archived' in p) {
        var off = bool(p.archived);
        if (off) {
          var used = c.db.Items.filter(function (it) { return it.category === cat.name; }).length;
          if (used) throw E('還有 ' + used + ' 項展品屬於「' + cat.name + '」,請先改到其他分類');
        }
        if (bool(cat.archived) !== off) log(c, off ? '停用分類' : '啟用分類', cat.id, cat.name);
        cat.archived = off;
      }
      cat.updatedAt = c.now; dirty(c.db, 'Cats');
      return ADMIN.allCats(c);
    },
    /** 調整分類順序:與上 / 下一個對調 */
    moveCat: function (c) {
      var list = (c.db.Cats || []).slice().sort(function (a, b) { return (n(a.sort) - n(b.sort)) || (a.name < b.name ? -1 : 1); });
      var i = -1;
      list.forEach(function (x, k) { if (x.id === s(c.p.id)) i = k; });
      if (i < 0) throw E('找不到分類');
      var j = i + (n(c.p.dir) < 0 ? -1 : 1);
      if (j < 0 || j >= list.length) return ADMIN.allCats(c);
      list.forEach(function (x, k) { x.sort = (k + 1) * 10; });
      var a = list[i], b = list[j], t = a.sort; a.sort = b.sort; b.sort = t;
      a.updatedAt = c.now; b.updatedAt = c.now; dirty(c.db, 'Cats');
      log(c, '調整分類順序', a.id, a.name);
      return ADMIN.allCats(c);
    },
    saveItem: function (c) {
      var p = c.p.item || {}, now = c.now, isNew = !s(p.id);
      if (!s(p.name)) throw E('請填寫品名');
      var mode = p.mode === 'unit' ? 'unit' : 'qty';
      var it = isNew ? { id: nextId(c.db.Items, 'P', 4), archived: false, countedAt: '' } : byId(c.db.Items, s(p.id));
      if (!it) throw E('找不到展品');
      if (!isNew && it.mode !== mode && c.db.Units.some(function (u) { return u.itemId === it.id; })) throw E('此展品已有逐台編號,無法改為「只記數量」');
      it.name = s(p.name); it.category = ensureCat(c, p.category); it.mode = mode;
      it.qty = mode === 'qty' ? Math.max(0, int(p.qty)) : 0;
      it.location = s(p.location); it.spec = s(p.spec); it.note = s(p.note); it.image = s(p.image); it.updatedAt = now;
      if (isNew) c.db.Items.push(it);
      dirty(c.db, 'Items');
      log(c, isNew ? '新增展品' : '修改展品', it.id, it.name + (mode === 'qty' ? ' 數量 ' + it.qty : ''));
      if (isNew && mode === 'unit' && int(p.unitCount) > 0) addUnits(c, it, int(p.unitCount), p.location);
      return it;
    },
    archiveItem: function (c) {
      var it = byId(c.db.Items, s(c.p.id));
      if (!it) throw E('找不到展品');
      var on = !!c.p.archived;
      if (on) {
        var st = stats(c.db, c.today)[it.id];
        if (st.out || st.reserved) throw E('此展品還有借出或已核准的借用,無法下架');
      }
      it.archived = on; it.updatedAt = c.now; dirty(c.db, 'Items');
      log(c, on ? '下架展品' : '重新上架', it.id, it.name);
      return true;
    },
    units: function (c) {
      var want = s(c.p.itemId), today = c.today;
      if (want && !byId(c.db.Items, want)) throw E('找不到展品');
      // 省略 itemId 時回傳全部單台(盤點頁一次取得,避免逐項請求)
      return c.db.Units.filter(function (u) { return !want || u.itemId === want; }).map(function (u) {
        var L = currentLoanOfUnit(c.db, u.id);
        return { id: u.id, itemId: u.itemId, serial: u.serial, status: u.status, statusLabel: UNIT_ST[u.status], location: u.location, note: u.note, countedAt: u.countedAt,
          holder: L ? { loanId: L.id, applicant: L.applicant, dept: L.dept, event: L.event, end: L.end, overdue: isOverdue(L, today) } : null };
      });
    },
    addUnits: function (c) {
      var it = byId(c.db.Items, s(c.p.itemId));
      if (!it || it.mode !== 'unit') throw E('此展品不是逐台編號模式');
      var k = int(c.p.count);
      if (k < 1 || k > 200) throw E('一次可新增 1–200 台');
      return addUnits(c, it, k, c.p.location, c.p.serials);
    },
    saveUnit: function (c) {
      var p = c.p.unit || {}, u = byId(c.db.Units, s(p.id).toUpperCase());
      if (!u) throw E('找不到編號');
      if (p.status && p.status !== u.status) {
        if (u.status === 'out' || p.status === 'out') throw E('借出狀態請透過點交 / 歸還變更');
        if (!UNIT_ST[p.status]) throw E('狀態不正確');
        log(c, '變更單台狀態', u.id, UNIT_ST[u.status] + ' → ' + UNIT_ST[p.status] + (s(p.note) ? '(' + s(p.note) + ')' : ''));
        u.status = p.status;
      }
      if (p.serial != null) u.serial = s(p.serial);
      if (p.location != null) u.location = s(p.location);
      if (p.note != null) u.note = s(p.note);
      u.updatedAt = c.now; dirty(c.db, 'Units');
      return u;
    },
    stocktake: function (c) {
      var today = c.today, now = c.now, st = stats(c.db, today), apply = !!c.p.apply;
      var report = { qty: [], missingUnits: [], seenUnits: 0, adjusted: 0 };
      (c.p.qty || []).forEach(function (x) {
        var it = byId(c.db.Items, s(x.itemId));
        if (!it || it.mode !== 'qty' || x.counted === '' || x.counted == null) return;
        var expected = st[it.id].inStock, counted = Math.max(0, int(x.counted)), diff = counted - expected;
        report.qty.push({ itemId: it.id, name: it.name, expected: expected, counted: counted, diff: diff });
        it.countedAt = today;
        if (apply && diff) { it.qty = Math.max(0, int(it.qty) + diff); report.adjusted++; }
        dirty(c.db, 'Items');
      });
      var seen = {}; (c.p.seenUnits || []).forEach(function (id) { seen[s(id).toUpperCase()] = 1; });
      var scope = {}; (c.p.unitItems || []).forEach(function (id) { scope[id] = 1; });
      c.db.Units.forEach(function (u) {
        if (!scope[u.itemId]) return;
        if (seen[u.id]) {
          report.seenUnits++; u.countedAt = today;
          if (u.status === 'lost' && apply) { u.status = 'in'; u.updatedAt = now; report.adjusted++; report.qty.push({ itemId: u.id, name: u.id + ' 找回', expected: 0, counted: 1, diff: 1 }); }
        } else if (u.status === 'in') {
          var it = byId(c.db.Items, u.itemId) || {};
          report.missingUnits.push({ id: u.id, name: it.name, serial: u.serial, history: unitHistory(c.db, u.id).slice(0, 1) });
          if (apply && c.p.markMissingLost) { u.status = 'lost'; u.updatedAt = now; report.adjusted++; }
        }
      });
      dirty(c.db, 'Units');
      var diffs = report.qty.filter(function (x) { return x.diff; });
      log(c, '盤點', today, '數量品項 ' + report.qty.length + ',差異 ' + diffs.length + ';逐台點到 ' + report.seenUnits + ',未點到 ' + report.missingUnits.length + (apply ? '(已套用調整)' : '(僅記錄)'));
      return report;
    },
    importItems: function (c) {
      var rows = c.p.rows || [], made = 0;
      rows.forEach(function (r) {
        if (!s(r.name)) return;
        var sub = { p: { item: { name: r.name, category: r.category, mode: /逐|unit/i.test(s(r.mode)) ? 'unit' : 'qty', qty: r.qty, unitCount: r.qty, location: r.location, spec: r.spec, note: r.note } }, db: c.db, user: c.user, log: c.log, notify: c.notify, today: c.today, now: c.now };
        ADMIN.saveItem(sub); made++;
      });
      return { created: made };
    },
    logs: function (c) { return c.readLogs(int(c.p.limit) || 300); }
  };
  function addUnits(c, it, k, location, serials) {
    var made = [], now = c.now;
    for (var i = 0; i < k; i++) {
      var u = { id: nextId(c.db.Units, 'E', 4), itemId: it.id, serial: serials && serials[i] ? s(serials[i]) : '', status: 'in', location: s(location) || it.location, note: '', countedAt: '', updatedAt: now };
      c.db.Units.push(u); made.push(u.id);
    }
    dirty(c.db, 'Units'); log(c, '新增單台編號', it.id, it.name + ':' + made[0] + (made.length > 1 ? ' ~ ' + made[made.length - 1] : ''));
    return made;
  }


  /** 當面確認:admin 已由身份積木驗證 */
  function confirmOnSite(c, admin) {
    var L = ownLoan(c), req = L.request;
    if (!req || !req.type) throw E('沒有待確認的請求');
    var sub = { db: c.db, p: {}, user: admin, onSite: true, log: c.logAs(admin), notify: c.notify, today: c.today, now: c.now };
    if (req.type === 'pickup') return doCheckout(sub, L, req.units, req.note);
    if (req.type === 'return') return doReceive(sub, L, req.lines, req.note);
    if (req.type === 'extend') return doExtend(sub, L, req.end, req.note, false);
    if (req.type === 'transfer') return doTransfer(sub, L, req.toId, req.note);
    throw E('不支援的請求類型');
  }

  /** 每日提醒:回傳通知事件(由排程積木交給通知積木寄出) */
  function reminders(db, today) {
    var tomorrow = addDays(today, 1), events = [], over = [];
    db.Loans.forEach(function (L) {
      if (L.status !== 'out') return;
      var overdue = L.end < today;
      if (!overdue && L.end !== tomorrow) return;
      var to = applicantEmail(db, L), text = linesText(db, L);
      if (overdue) over.push(L.id + ' ' + L.applicant + '(' + (L.dept || '-') + ')' + L.event + ' 應還 ' + L.end + '\n' + text);
      if (to) events.push({ to: to,
        subject: (overdue ? '[展品管理] 借用已逾期 ' : '[展品管理] 明天到期 ') + L.id + ' — ' + L.event,
        body: L.applicant + ' 您好:\n\n' + (overdue ? '以下展品已超過歸還日 ' + L.end + ',請儘速歸還。' : '以下展品將於明天 ' + L.end + ' 到期,請記得歸還。') + '\n\n' + text });
    });
    var admins = emailsOfAdmins(db);
    if (over.length && admins.length) events.push({ to: admins, subject: '[展品管理] 今日逾期 ' + over.length + ' 筆', body: over.join('\n\n') });
    return events;
  }

  // rules:純函式,供規則層單元測試使用
  var rules = { isDate: isDate, addDays: addDays, stats: stats, loanWindow: loanWindow, reservedInRange: reservedInRange, availableInRange: availableInRange, checkLines: checkLines, isOverdue: isOverdue };
  return { USER: USER, ADMIN: ADMIN, confirmOnSite: confirmOnSite, reminders: reminders, rules: rules, LOAN_ST: LOAN_ST };
})();
