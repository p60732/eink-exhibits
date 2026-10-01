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
  function dayDiff(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 86400000); }
  /**
   * 日期合理範圍。type=date 的欄位很容易打成 0025-03-01 或 20255-03-01,
   * 日曆上算合法,可是那種單不該進得來 —— 進來之後庫存試算、逾期天數、統計全部會被帶歪。
   */
  var DATE_BACK_DAYS = 1095;   // 往前最多 3 年(補登舊紀錄夠用)
  var DATE_FWD_DAYS = 1825;    // 往後最多 5 年
  var MAX_SPAN_DAYS = 730;     // 單一期間最長 2 年
  function saneDate(v, today, label) {
    if (!isDate(v)) throw E('請填寫' + label);
    v = s(v);
    var d = dayDiff(today, v);
    if (d < -DATE_BACK_DAYS) throw E(label + ' ' + v + ' 太久以前了(最早 ' + addDays(today, -DATE_BACK_DAYS) + '),請確認年份有沒有打錯');
    if (d > DATE_FWD_DAYS) throw E(label + ' ' + v + ' 太遠了(最晚 ' + addDays(today, DATE_FWD_DAYS) + '),請確認年份有沒有打錯');
    return v;
  }
  function saneRange(a, b, today, la, lb) {
    var x = saneDate(a, today, la), y = saneDate(b, today, lb);
    if (x > y) throw E(lb + '不可早於' + la);
    var span = dayDiff(x, y);
    if (span > MAX_SPAN_DAYS) throw E('期間共 ' + (span + 1) + ' 天,超過上限 ' + MAX_SPAN_DAYS + ' 天,請確認日期有沒有打錯');
    return [x, y];
  }
  /**
   * 本次請求的暫存索引。放在 WeakMap 而不是 db 上,規則層依然沒有碰到資料本身。
   * 資料一變就清掉,不會拿到過期的數字。
   */
  var MEMO = new WeakMap();
  function memo(db) {
    var m = MEMO.get(db);
    if (!m) { m = { cap: {}, li: null, us: null, si: null }; MEMO.set(db, m); }
    return m;
  }
  function dirty(db, t) {
    db._dirty[t] = true;
    var m = memo(db);
    if (t === 'Units' || t === 'Items') { m.cap = {}; m.us = null; }
    if (t === 'Loans') { m.li = null; m.si = null; }   // 借用單一變,展覽的「已開單量」也跟著變
    if (t === 'Shows') m.si = null;
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

