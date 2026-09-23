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
  var SHOW_ST = { draft: '規劃中', confirmed: '已確認', closed: '已結案', cancelled: '已取消' };
  /**
   * 「還在跑」的借用單狀態。改這裡要一起改 `00_gateway.gs` 的 `LIVE`(尾段讀取用的同一組),
   * 兩邊跨不了執行環境,只能靠這行註解對齊。
   */
  var LIVE_ST = { pending: 1, approved: 1, out: 1 };
  // 展覽狀態只能這樣走;進 closed / cancelled 之前必須沒有還在跑的借用單
  var SHOW_FLOW = { draft: ['confirmed', 'cancelled'], confirmed: ['draft', 'closed', 'cancelled'], closed: ['confirmed'], cancelled: ['draft'] };
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

  /* ---------- 庫存計算 ---------- */
  function outstanding(line) { return Math.max(0, int(line.qty) - int(line.returned) - int(line.lost)); }

  /* ---------- 存放地點 ----------
   * 一個展品可以分散在好幾個地點(新竹 3 台、林口 2 台)。
   * 逐台編號的展品:每台自己的 location 就是答案,分佈用算的。
   * 數量型展品:存在 Items.stock,形如 {"新竹":{"數量":3,"盤點":"2026-09-23"}}。
   * 舊資料只有「總數 + 單一地點」,讀進來時自動當成全部放在那個地點。
   */
  var SQ = '數量', SC = '盤點';
  var NOLOC = '未指定';
  function loc(v) { return s(v) || NOLOC; }
  function lineKey(ln) { return s(ln.itemId) + '@' + loc(ln.location); }
  /** 數量型展品 → { 地點: { qty, countedAt } } */
  function stockMap(it) {
    var raw = it.stock, m = {}, any = false;
    if (raw && typeof raw === 'object') Object.keys(raw).forEach(function (k) {
      var L = s(k); if (!L) return;
      var v = raw[k] || {}, isObj = typeof v === 'object';
      m[L] = { qty: Math.max(0, int(isObj ? v[SQ] : v)), countedAt: s(isObj ? v[SC] : '') };
      any = true;
    });
    if (!any && (int(it.qty) > 0 || s(it.location))) m[loc(it.location)] = { qty: int(it.qty), countedAt: s(it.countedAt) };
    return m;
  }
  /** 把各地點數量寫回展品,並回填舊欄位(總數 / 存放位置 / 最後盤點)讓試算表與匯出仍看得懂 */
  function writeStock(it, m) {
    var out = {}, total = 0, names = [], dates = [];
    Object.keys(m).forEach(function (L) {
      var q = Math.max(0, int(m[L].qty)), c = s(m[L].countedAt);
      if (!q && !c) return;
      out[L] = {}; out[L][SQ] = q; out[L][SC] = c;
      total += q; names.push(L); dates.push(c);
    });
    it.stock = out;
    it.qty = total;
    it.location = names.join('、');
    it.countedAt = dates.length && dates.every(function (d) { return d; }) ? dates.slice().sort()[0] : '';
    return it;
  }
  /** 逐台編號的展品 → { itemId: { 地點: { qty, countedAt } } };一次請求只算一次 */
  function unitSites(db) {
    var m = memo(db);
    if (m.us) return m.us;
    var idx = {};
    db.Units.forEach(function (u) {
      if (u.status !== 'in' && u.status !== 'out') return;      // 維修 / 遺失不算庫存
      var g = idx[u.itemId] = idx[u.itemId] || {}, L = loc(u.location);
      var e = g[L] = g[L] || { qty: 0, dates: [] };
      e.qty++; e.dates.push(s(u.countedAt));
    });
    // 該地點的「最後盤點」= 全部都點過才算,取最早的那天(有一台沒點過就當作還沒盤完)
    Object.keys(idx).forEach(function (id) {
      Object.keys(idx[id]).forEach(function (L) {
        var e = idx[id][L];
        e.countedAt = e.dates.every(function (d) { return d; }) ? e.dates.slice().sort()[0] : '';
        delete e.dates;
      });
    });
    return (m.us = idx);
  }
  function siteMap(db, it) { return it.mode === 'unit' ? (unitSites(db)[it.id] || {}) : stockMap(it); }
  /** 一個展品的分佈:[{ location, qty, countedAt }],多的排前面 */
  function sitesOf(db, it) {
    var m = siteMap(db, it);
    return Object.keys(m).map(function (L) { return { location: L, qty: int(m[L].qty), countedAt: s(m[L].countedAt) }; })
      .sort(function (a, b) { return b.qty - a.qty || (a.location < b.location ? -1 : 1); });
  }
  /** 這個地點登記了幾台(不扣借出) */
  function siteTotal(db, it, L) { var e = siteMap(db, it)[loc(L)]; return e ? int(e.qty) : 0; }
  /** 數量型展品:把某個地點的台數加減 delta(搬動 / 短少 / 盤點調整都走這裡) */
  function adjustStock(c, it, where, delta) {
    if (!delta || it.mode === 'unit') return;
    var m = stockMap(it), L = loc(where);
    m[L] = m[L] || { qty: 0, countedAt: '' };
    m[L].qty = Math.max(0, int(m[L].qty) + delta);
    writeStock(it, m);
    it.updatedAt = c.now;
    dirty(c.db, 'Items');
  }

  /** 總數(unit 模式數在庫+借出的台數);同一次請求內每個品項只算一次 */
  function capacity(db, item, where) {
    if (where != null) return siteTotal(db, item, where);
    var cache = memo(db).cap;
    if (item.id in cache) return cache[item.id];
    var m = siteMap(db, item), c = 0;
    Object.keys(m).forEach(function (L) { c += int(m[L].qty); });
    return (cache[item.id] = c);
  }
  /** 每個品項一組數字;另外用「品項@地點」為 key 再放一組,盤點與可借量要分地點時直接查 */
  /** 總數 / 在庫 / 借出 / 預約。跟日期無關 —— 要算「某段期間可借幾台」請用 availableInRange */
  function stats(db) {
    var m = {};
    function box(total) { return { total: total, out: 0, reserved: 0, repair: 0, lost: 0 }; }
    db.Items.forEach(function (it) {
      m[it.id] = box(capacity(db, it));
      var sm = siteMap(db, it);
      Object.keys(sm).forEach(function (L) { m[it.id + '@' + L] = box(int(sm[L].qty)); });
    });
    db.Units.forEach(function (u) {
      var st = m[u.itemId], site = m[u.itemId + '@' + loc(u.location)];
      if (!st) return;
      if (u.status === 'repair') { st.repair++; if (site) site.repair++; }
      if (u.status === 'lost') { st.lost++; if (site) site.lost++; }
    });
    db.Loans.forEach(function (L) {
      if (L.status !== 'out' && L.status !== 'approved') return;
      (L.lines || []).forEach(function (ln) {
        var n = outstanding(ln), st = m[ln.itemId], site = m[lineKey(ln)];
        if (st) { if (L.status === 'out') st.out += n; else st.reserved += n; }
        if (site) { if (L.status === 'out') site.out += n; else site.reserved += n; }
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
      (L.lines || []).forEach(function (ln) {
        var e = { L: L, ln: ln };
        (idx[ln.itemId] = idx[ln.itemId] || []).push(e);        // 整個品項
        var k = lineKey(ln);
        (idx[k] = idx[k] || []).push(e);                        // 單一地點
      });
    });
    return (m.li = idx);
  }
  /** where 省略 = 整個品項;給地點就只算那個地點借出去的 */
  function reservedInRange(db, itemId, where, from, to, excludeId, today) {
    var sum = 0, key = where == null ? itemId : itemId + '@' + loc(where);
    (loanIndex(db)[key] || []).forEach(function (e) {
      if (e.L.id === excludeId) return;
      var w = loanWindow(e.L, today);
      if (w[0] > to || w[1] < from) return;
      sum += outstanding(e.ln);
    });
    return sum;
  }

  /* ---------- 展覽的殘額佔位 ----------
   * 展覽要「卡位」,底下又會開借用單,兩邊都扣就會把同一批東西扣兩次。
   * 所以展覽佔的不是規劃量,而是**還沒被借用單佔住的那一段**:
   *     展覽佔用量 = max(0, 規劃量 − 已開單量)
   *
   * 「已開單量」只算**已核准 / 出借中** —— 那才是真正佔住庫存的狀態。
   *   · 待審核:單子還沒佔住庫存,所以展覽繼續幫它佔著(否則審核那段時間是空窗,會被別人搶走)
   *   · 已駁回 / 已取消:那份回到展覽身上,可以重開單
   *   · 已歸還:展覽會把那份重新佔回來,直到把展覽結案或改掉規劃量。
   *     這是刻意選保守的一邊(寧可擋住,也不要超賣),而且只影響展覽檔期之內的查詢。
   */
  var ISSUED_ST = { approved: 1, out: 1 };
  /** showId + '|' + 品項@地點 → 已開單量;一次請求只算一次 */
  function showIssued(db) {
    var m = memo(db);
    if (m.si) return m.si;
    var idx = {};
    (db.Loans || []).forEach(function (L) {
      var sid = s(L.showId);
      if (!sid || !ISSUED_ST[L.status]) return;
      (L.lines || []).forEach(function (ln) {
        var k = sid + '|' + lineKey(ln);
        // 用 outstanding 而不是 qty:reservedInRange 也是用 outstanding。
        // 兩邊基準不同的話,部分歸還會讓「展覽佔的 + 借用單佔的」小於規劃量,
        // 等於在展期中途把東西放給別人借走。
        idx[k] = (idx[k] || 0) + outstanding(ln);
      });
    });
    return (m.si = idx);
  }
  /** where 省略 = 整個品項;excludeShowId 是「這張單本來就屬於那場展覽」時要排除自己 */
  function showHold(db, itemId, where, from, to, excludeShowId) {
    var issued = showIssued(db), sum = 0, want = where == null ? null : loc(where);
    (db.Shows || []).forEach(function (S) {
      if (S.status !== 'confirmed' || S.id === excludeShowId) return;
      if (s(S.from) > to || s(S.to) < from) return;
      (S.lines || []).forEach(function (ln) {
        if (s(ln.itemId) !== itemId) return;
        if (want != null && loc(ln.location) !== want) return;
        sum += Math.max(0, int(ln.qty) - (issued[S.id + '|' + lineKey(ln)] || 0));
      });
    });
    return sum;
  }
  function availableInRange(db, item, where, from, to, excludeId, today, excludeShowId) {
    return capacity(db, item, where)
      - reservedInRange(db, item.id, where, from, to, excludeId, today)
      - showHold(db, item.id, where, from, to, excludeShowId || null);
  }
  function checkLines(db, lines, from, to, excludeId, today, excludeShowId) {
    return lines.map(function (ln) {
      var it = byId(db.Items, ln.itemId), where = loc(ln.location);
      if (!it) return { itemId: ln.itemId, location: where, name: '(已刪除)', qty: int(ln.qty), available: 0, short: int(ln.qty) };
      var av = availableInRange(db, it, where, from, to, excludeId, today, excludeShowId || null);
      var can = Math.max(0, av);       // av 可能是負的(先前被強制超賣),缺口只算這一行真正借不到的量
      return { itemId: it.id, location: where, name: it.name, qty: int(ln.qty), available: can, short: Math.max(0, int(ln.qty) - can) };
    });
  }
  function isOverdue(L, today) { return L.status === 'out' && L.end < today; }
  function enrichLoan(db, L, today) {
    var o = {};
    for (var k in L) o[k] = L[k];
    o.statusLabel = LOAN_ST[L.status] || L.status;
    o.showId = s(L.showId);
    if (o.showId) { var sw = byId(db.Shows || [], o.showId); o.showName = sw ? sw.name : ''; }
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
  function itemView(db, it, st, range, today, exShow) {
    var x = st[it.id] || { total: 0, out: 0, reserved: 0, inStock: 0, repair: 0, lost: 0 };
    var v = {
      id: it.id, name: it.name, category: it.category, mode: it.mode, location: it.location, spec: it.spec, note: it.note,
      image: it.image, archived: bool(it.archived), countedAt: it.countedAt, qty: int(it.qty),
      total: x.total, inStock: x.inStock, out: x.out, reserved: x.reserved, repair: x.repair, lost: x.lost
    };
    v.sites = sitesOf(db, it).map(function (g) {
      var y = st[it.id + '@' + g.location] || { out: 0, reserved: 0, repair: 0, lost: 0 };
      var o = { location: g.location, total: g.qty, countedAt: g.countedAt, out: y.out, reserved: y.reserved, repair: y.repair, lost: y.lost, inStock: g.qty - y.out };
      if (range) o.available = Math.max(0, availableInRange(db, it, g.location, range[0], range[1], null, today, exShow || null));
      return o;
    });
    if (range) v.available = Math.max(0, availableInRange(db, it, null, range[0], range[1], null, today, exShow || null));
    return v;
  }
  function validRange(p) {
    if (!isDate(p.start) || !isDate(p.end)) throw E('請填寫借用起訖日期');
    if (p.start > p.end) throw E('歸還日不可早於借出日');
    return [p.start, p.end];
  }
  /** 同一個品項在不同地點算不同行;沒指定地點時,只有一個地點就自動補上,有兩個以上就要求指定 */
  function cleanLines(db, lines) {
    var merged = {}, meta = {};
    (lines || []).forEach(function (ln) {
      var id = s(ln.itemId), q = int(ln.qty);
      if (!id || q <= 0) return;
      var it = byId(db.Items, id);
      if (!it) throw E('找不到展品 ' + id);
      var where = s(ln.location), sites = Object.keys(siteMap(db, it));
      if (!where) {
        if (sites.length > 1) throw E('「' + it.name + '」放在 ' + sites.join('、') + ',請指定要從哪一個地點借');
        where = sites[0] || loc(it.location);
      } else if (sites.length && sites.indexOf(where) < 0) {
        throw E('「' + it.name + '」在 ' + where + ' 沒有庫存');
      }
      var k = id + '@' + where;
      merged[k] = (merged[k] || 0) + q;
      meta[k] = { itemId: id, location: where };
    });
    var out = Object.keys(merged).map(function (k) {
      return { itemId: meta[k].itemId, location: meta[k].location, qty: merged[k], returned: 0, lost: 0, units: [], returnedUnits: [], lostUnits: [] };
    });
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
    return checkLines(db, L.lines, addDays(L.end, 1), newEnd, L.id, today, s(L.showId)).filter(function (x) { return x.short > 0; });
  }
  function doExtend(c, L, newEnd, note, force) {
    if (L.status !== 'approved' && L.status !== 'out') throw E('只有已核准或出借中的借用可以延期');
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
    var today = c.today, st = stats(c.db), used = {}, clean = {};
    assign = assign || {};
    L.lines.forEach(function (ln) {
      var it = byId(c.db.Items, ln.itemId);
      if (!it) throw E('展品已不存在:' + ln.itemId);
      var key = lineKey(ln), where = loc(ln.location), label = it.name + '(' + where + ')';
      if (it.mode === 'unit') {
        var ids = (assign[key] || assign[ln.itemId] || []).map(function (x) { return s(x).toUpperCase(); });
        if (!allowPartial && ids.length !== int(ln.qty)) throw E(label + ' 需要指定 ' + ln.qty + ' 台(目前 ' + ids.length + ' 台)');
        if (ids.length > int(ln.qty)) throw E(label + ' 只借 ' + ln.qty + ' 台');
        ids.forEach(function (uid) {
          var u = byId(c.db.Units, uid);
          if (!u || u.itemId !== it.id) throw E(uid + ' 不是「' + it.name + '」的編號');
          if (u.status !== 'in') throw E(uid + ' 目前狀態為「' + UNIT_ST[u.status] + '」,無法出借');
          if (loc(u.location) !== where) throw E(uid + ' 放在 ' + loc(u.location) + ',這一行借的是 ' + where + ' 的');
          if (used[uid]) throw E(uid + ' 重複指定');
          used[uid] = 1;
        });
        clean[key] = ids;
      } else {
        var have = st[key] ? st[key].inStock : 0;
        if (have < int(ln.qty)) throw E(label + ' 現有 ' + have + ',不足 ' + ln.qty);
      }
    });
    return clean;
  }
  function doCheckout(c, L, assign, note) {
    var today = c.today;
    if (L.status !== 'approved') throw E('只有「已核准」的借用單可以點交出借');
    var clean = validatePickup(c, L, assign, false);
    L.lines.forEach(function (ln) {
      var ids = clean[lineKey(ln)];
      if (ids) {
        ln.units = ids;
        ids.forEach(function (uid) { var u = byId(c.db.Units, uid); u.status = 'out'; u.updatedAt = c.now; });
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
    var input = {};
    // 一律用「品項@地點」對位。沒有對到的行就不動它 ——
    // 退回去抓「同品項的另一行」會把 A 廠區的歸還數量套到 B 廠區,東西還在外面卻記成已還。
    (inputLines || []).forEach(function (x) { input[s(x.itemId) + '@' + loc(x.location)] = x; });
    var notes = [];
    L.lines.forEach(function (ln) {
      var x = input[lineKey(ln)]; if (!x) return;
      var it = byId(c.db.Items, ln.itemId);
      var from = loc(ln.location), back = s(x.to) || from;          // 可以還到別的廠區,預設還回原借出的點
      if (it && it.mode === 'unit') {
        var pending = ln.units.filter(function (u) { return ln.returnedUnits.indexOf(u) < 0 && ln.lostUnits.indexOf(u) < 0; });
        (x.unitResults || []).forEach(function (r) {
          var uid = s(r.id).toUpperCase(), at = pending.indexOf(uid);
          if (at < 0) return;
          pending.splice(at, 1);        // 處理過就從待還清單移除:同一台送兩次只能算一次,
                                        // 否則 returned 會多加,單子提早結案,另一台永遠卡在「借出中」
          var u = byId(c.db.Units, uid);
          if (r.result === 'lost') { ln.lostUnits.push(uid); ln.lost = int(ln.lost) + 1; if (u) u.status = 'lost'; notes.push(uid + ' 遺失'); }
          else if (r.result === 'in' || r.result === 'repair') {
            ln.returnedUnits.push(uid); ln.returned = int(ln.returned) + 1;
            if (u) {
              u.status = r.result;
              var dest = s(r.to) || back;
              if (loc(u.location) !== dest) { notes.push(uid + ' 移到 ' + dest); u.location = dest; }
            }
            if (r.result === 'repair') notes.push(uid + ' 送修');
          }
          if (u) { u.updatedAt = now; if (s(r.note)) u.note = s(r.note); }
        });
      } else {
        var left = outstanding(ln), ret = Math.min(left, Math.max(0, int(x.returned))), lost = Math.min(left - ret, Math.max(0, int(x.lost)));
        ln.returned = int(ln.returned) + ret; ln.lost = int(ln.lost) + lost;
        if (lost && it) { adjustStock(c, it, from, -lost); notes.push(it.name + '(' + from + ') 短少 ' + lost); }
        if (ret && it && back !== from) {                            // 還到別的廠區 = 庫存跟著搬過去
          adjustStock(c, it, from, -ret); adjustStock(c, it, back, ret);
          notes.push(it.name + ' ' + ret + ' 台從 ' + from + ' 移到 ' + back);
        }
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

  /* ---------- 展覽 ----------
   * 展覽是「專案」那一層:底下掛多張借用單(新竹一張、林口一張),
   * 各自走原本的核准 / 點交 / 歸還流程,展覽頁只負責規劃、卡位與總覽。
   */
  /** 規劃清單:跟借用單一樣依「品項+地點」合併,地點只有一個就自動補上 */
  function cleanShowLines(db, lines) {
    var merged = {}, meta = {};
    (lines || []).forEach(function (ln) {
      var id = s(ln.itemId), q = int(ln.qty);
      if (!id || q <= 0) return;
      var it = byId(db.Items, id);
      if (!it) throw E('找不到展品 ' + id);
      var where = s(ln.location), sites = Object.keys(siteMap(db, it));
      if (!where) {
        if (sites.length > 1) throw E('「' + it.name + '」放在 ' + sites.join('、') + ',請指定要從哪一個地點出');
        where = sites[0] || loc(it.location);
      } else if (sites.length && sites.indexOf(where) < 0) {
        throw E('「' + it.name + '」在 ' + where + ' 沒有庫存');
      }
      var k = id + '@' + where;
      merged[k] = (merged[k] || 0) + q;
      meta[k] = { itemId: id, location: where, note: s(ln.note) };
    });
    return Object.keys(merged).map(function (k) {
      return { itemId: meta[k].itemId, location: meta[k].location, qty: merged[k], note: meta[k].note };
    });
  }
  function loansOfShow(db, showId) {
    return (db.Loans || []).filter(function (L) { return s(L.showId) === showId; });
  }
  function liveLoansOfShow(db, showId) {
    return loansOfShow(db, showId).filter(function (L) { return !!LIVE_ST[L.status]; });
  }
  /**
   * 一行規劃的缺口。
   *   還要借的 = 規劃量 − 已開單量
   *   可借量   = 扣掉別人的借用單與**別場**展覽的卡位(自己這場要排除,否則會擋住自己的單)
   */
  function showLineView(db, S, ln, today) {
    var it = byId(db.Items, ln.itemId), where = loc(ln.location), qty = int(ln.qty);
    var issued = showIssued(db)[S.id + '|' + lineKey(ln)] || 0;
    var need = Math.max(0, qty - issued);
    var o = { itemId: s(ln.itemId), location: where, qty: qty, note: s(ln.note), issued: issued, need: need,
      over: Math.max(0, issued - qty),
      name: it ? it.name : '(已刪除)', mode: it ? it.mode : 'qty', category: it ? it.category : '', available: 0, short: need };
    if (!it) return o;
    var av = Math.max(0, availableInRange(db, it, where, s(S.from), s(S.to), null, today, S.id));
    o.available = av;
    o.short = Math.max(0, need - av);
    return o;
  }
  function showView(db, S, today, withLoans) {
    var lines = (S.lines || []).map(function (ln) { return showLineView(db, S, ln, today); });
    var o = {
      id: S.id, name: s(S.name), from: s(S.from), to: s(S.to), venue: s(S.venue), owner: s(S.owner),
      status: s(S.status) || 'draft', note: s(S.note), createdBy: s(S.createdBy), createdAt: s(S.createdAt),
      lines: lines,
      statusLabel: SHOW_ST[S.status] || SHOW_ST.draft,
      itemCount: lines.length,
      qtyTotal: lines.reduce(function (a, x) { return a + x.qty; }, 0),
      issuedTotal: lines.reduce(function (a, x) { return a + x.issued; }, 0),
      shortTotal: lines.reduce(function (a, x) { return a + x.short; }, 0)
    };
    var mine = loansOfShow(db, S.id);
    o.loanCount = mine.length;
    o.liveCount = liveLoansOfShow(db, S.id).length;
    // 檔期跟底下借用單對不上時要看得見:展覽改期不會自動改單,要人決定
    o.mismatch = mine.filter(function (L) {
      return L.status !== 'cancelled' && L.status !== 'rejected' && (s(L.start) !== o.from || s(L.end) !== o.to);
    }).map(function (L) { return L.id; });
    if (withLoans) o.loans = mine.slice().sort(sortLoans).map(function (L) { return enrichLoan(db, L, today); });
    return o;
  }
  function showById(c) {
    var S = byId(c.db.Shows || [], s(c.p.id));
    if (!S) throw E('找不到展覽');
    return S;
  }

  /* ---------- 同仁可用的動作 ---------- */
  var USER = {
    catalog: function (c) {
      var today = c.today, range = null;
      if (isDate(c.p.start) && isDate(c.p.end)) range = [c.p.start, c.p.end];
      // 為某一場展覽挑選時,要把那場自己的卡位排除掉,否則它會擋住自己
      var exShow = s(c.p.showId) || null;
      if (exShow && c.user.role !== 'admin') throw E('只有管理者可以為展覽挑選展品');
      var st = stats(c.db);
      return c.db.Items.filter(function (it) { return !bool(it.archived); })
        .map(function (it) { return itemView(c.db, it, st, range, today, exShow); });
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
      var showId = s(c.p.showId);
      if (showId) {
        if (!isAdmin) throw E('只有管理者可以把借用單掛到展覽底下');
        var sw = byId(c.db.Shows || [], showId);
        if (!sw) throw E('找不到展覽 ' + showId);
        // 不擋的話,「結案前底下不能有沒結束的單」那道守門會被繞過,而且展覽從此刪不掉
        if (sw.status === 'closed' || sw.status === 'cancelled') throw E('「' + SHOW_ST[sw.status] + '」的展覽不能再掛新的借用單');
      }
      var lines = cleanLines(c.db, c.p.lines);
      var chk = checkLines(c.db, lines, r[0], r[1], null, today, showId || null);
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
        outAt: '', returnedAt: '', note: s(c.p.note), request: null, showId: showId
      };
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
      var short = checkLines(c.db, lines, r[0], r[1], L.id, c.today, s(L.showId)).filter(function (x) { return x.short > 0; });
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
      var st = stats(c.db);
      return L.lines.map(function (ln) {
        var it = byId(c.db.Items, ln.itemId) || {}, where = loc(ln.location), box = st[lineKey(ln)];
        return { itemId: ln.itemId, key: lineKey(ln), location: where, name: it.name, mode: it.mode, qty: int(ln.qty),
          inStock: box ? box.inStock : 0,
          units: it.mode === 'unit' ? c.db.Units.filter(function (u) { return u.itemId === it.id && u.status === 'in' && loc(u.location) === where; }).map(function (u) { return { id: u.id, serial: u.serial }; }) : [] };
      });
    },
    requestPickup: function (c) {
      var L = ownLoan(c);
      if (L.status !== 'approved') throw E('只有「已核准」的借用可以簽收');
      if (L.request && L.request.type) throw E('這張單還有待確認的請求,請先完成或撤回');
      var clean = validatePickup(c, L, c.p.units, false);
      L.request = { type: 'pickup', at: c.now, by: c.user.name, units: clean, note: s(c.p.note) };
      dirty(c.db, 'Loans'); log(c, '申請簽收領取', L.id, s(c.p.note));
      return enrichLoan(c.db, L, c.today);
    },
    requestReturn: function (c) {
      var L = ownLoan(c);
      if (L.status !== 'out') throw E('只有「出借中」的借用可以歸還');
      if (L.request && L.request.type) throw E('這張單還有待確認的請求,請先完成或撤回');
      var lines = (c.p.lines || []).map(function (x) {
        return { itemId: s(x.itemId), location: loc(x.location), to: s(x.to), returned: int(x.returned), lost: int(x.lost),
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
      if (item) return { type: 'item', item: itemView(c.db, item, stats(c.db), null, today) };
      throw E('查無此編號:' + code);
    }
  };

  var ADMIN = {
    dashboard: function (c) {
      var today = c.today, st = stats(c.db), soon = addDays(today, 3);
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
        if (f === 'active') return !!LIVE_ST[L.status];
        if (f === 'overdue') return isOverdue(L, today);
        if (f === 'request') return !!(L.request && L.request.type) && (L.status === 'approved' || L.status === 'out');
        return L.status === f;
      }).slice().sort(sortLoans).map(function (L) {
        var o = enrichLoan(c.db, L, today);
        if (L.status === 'pending' || L.status === 'approved') o.check = checkLines(c.db, L.lines, L.start, L.end, L.id, today, s(L.showId));
        return o;
      });
    },
    approve: function (c) {
      var L = byId(c.db.Loans, s(c.p.id)), today = c.today;
      if (!L || L.status !== 'pending') throw E('此申請不是待審核狀態');
      var short = checkLines(c.db, L.lines, L.start, L.end, L.id, today, s(L.showId)).filter(function (x) { return x.short > 0; });
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
      L.status = 'rejected'; L.request = null;     // 不清掉的話,已駁回的單還能被延期 / 轉借
      L.reviewer = c.user.name; L.reviewedAt = c.now; L.reviewNote = s(c.p.note);
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
    /* ---------- 展覽 ---------- */
    shows: function (c) {
      var today = c.today, f = s(c.p.filter) || 'open';
      return (c.db.Shows || []).filter(function (S) {
        var st = s(S.status) || 'draft';
        if (f === 'all') return true;
        if (f === 'open') return st === 'draft' || st === 'confirmed';
        return st === f;
      }).slice().sort(function (a, b) { return s(a.from) < s(b.from) ? 1 : -1; })
        .map(function (S) { return showView(c.db, S, today, false); });
    },
    show: function (c) { return showView(c.db, showById(c), c.today, true); },
    /** 編輯中即時看缺口:還沒存檔也能算,所以清單由參數帶進來 */
    showCheck: function (c) {
      if (!isDate(c.p.from) || !isDate(c.p.to)) throw E('請先填寫檔期起訖日期');
      if (s(c.p.from) > s(c.p.to)) throw E('結束日不可早於開始日');
      var draft = { id: s(c.p.id) || '-', from: s(c.p.from), to: s(c.p.to), lines: cleanShowLines(c.db, c.p.lines) };
      return draft.lines.map(function (ln) { return showLineView(c.db, draft, ln, c.today); });
    },
    saveShow: function (c) {
      var p = c.p.show || {}, id = s(p.id), today = c.today, name = s(p.name);
      if (!name) throw E('請填寫展覽名稱');
      if (name.length > 60) throw E('展覽名稱過長(上限 60 字)');
      if (!isDate(p.from) || !isDate(p.to)) throw E('請填寫檔期起訖日期');
      if (s(p.from) > s(p.to)) throw E('結束日不可早於開始日');
      if (s(p.owner) && !findByEmp(c.db, p.owner)) throw E('查無承辦人工號 ' + s(p.owner));
      var lines = cleanShowLines(c.db, p.lines);
      if (lines.length > 300) throw E('一場展覽最多 300 項');
      var S = id ? byId(c.db.Shows, id) : null;
      if (id && !S) throw E('找不到展覽');
      if (S && (S.status === 'closed' || S.status === 'cancelled')) throw E('「' + SHOW_ST[S.status] + '」的展覽不能修改,請先改回進行中的狀態');
      var before = S ? (s(S.name) + '|' + s(S.from) + '~' + s(S.to) + '|' + (S.lines || []).length + ' 項 → ') : '';
      if (!S) {
        S = { id: nextId(c.db.Shows, 'S' + today.slice(2, 4) + '-', 3), status: 'draft', createdBy: c.user.name, createdAt: c.now };
        c.db.Shows.push(S);
      }
      S.name = name; S.from = s(p.from); S.to = s(p.to); S.venue = s(p.venue);
      S.owner = s(p.owner).toUpperCase(); S.note = s(p.note); S.lines = lines; S.updatedAt = c.now;
      dirty(c.db, 'Shows');
      log(c, id ? '修改展覽' : '新增展覽', S.id, before + name + '|' + S.from + '~' + S.to + '|' + lines.length + ' 項');
      return showView(c.db, S, today, true);
    },
    /** 狀態切換。確認檔期時才開始卡位;結案 / 取消前底下不能還有沒結束的借用單 */
    setShowStatus: function (c) {
      var S = showById(c), today = c.today, from = s(S.status) || 'draft', to = s(c.p.status);
      if (!SHOW_ST[to]) throw E('不認得的展覽狀態');
      if (to === from) return showView(c.db, S, today, true);
      if ((SHOW_FLOW[from] || []).indexOf(to) < 0) throw E('「' + SHOW_ST[from] + '」不能直接改成「' + SHOW_ST[to] + '」');
      if (to === 'closed' || to === 'cancelled') {
        var live = liveLoansOfShow(c.db, S.id);
        if (live.length) throw E('底下還有 ' + live.length + ' 張沒結束的借用單(' + live.map(function (L) { return L.id; }).join('、')
          + '),請先處理完再' + (to === 'closed' ? '結案' : '取消'));
      }
      if (to === 'confirmed') {
        if (!(S.lines || []).length) throw E('規劃清單是空的,沒有東西可以確認');
        var short = (S.lines || []).map(function (ln) { return showLineView(c.db, S, ln, today); })
          .filter(function (x) { return x.short > 0; });
        // 有缺口不直接擋:現實上常常是「先確認展覽,東西之後再喬」。要管理者明確認帳,並留紀錄。
        if (short.length && !bool(c.p.force)) {
          throw E('以下展品在這個檔期不夠:' + short.map(function (x) { return x.name + '(' + x.location + ')缺 ' + x.short; }).join('、')
            + '。確定仍要確認檔期,請勾選「知道有缺口,仍要確認」');
        }
        if (short.length) log(c, '確認展覽(有缺口)', S.id, short.map(function (x) { return x.name + '@' + x.location + ' 缺 ' + x.short; }).join(';'));
      }
      S.status = to; S.updatedAt = c.now;
      dirty(c.db, 'Shows');
      log(c, '展覽改為' + SHOW_ST[to], S.id, S.name);
      return showView(c.db, S, today, true);
    },
    deleteShow: function (c) {
      var S = showById(c), mine = loansOfShow(c.db, S.id);
      if (mine.length) throw E('這場展覽底下已經有 ' + mine.length + ' 張借用單,不能刪除。請改成「取消」以保留紀錄');
      c.db.Shows = c.db.Shows.filter(function (x) { return x.id !== S.id; });
      dirty(c.db, 'Shows');
      log(c, '刪除展覽', S.id, S.name);
      return { id: S.id };
    },
    /**
     * 依地點把「還沒開單的部分」各開一張借用單。
     * 開出來的單直接是「已核准」—— 展覽本身已經確認過檔期與缺口,再跑一次審核只是多一道手續;
     * 而且核准後借用單就接手佔住庫存,跟展覽的卡位無縫接上,中間不會有空窗。
     */
    createLoansFromShow: function (c) {
      var S = showById(c), today = c.today;
      if (S.status !== 'confirmed') throw E('請先把展覽狀態改成「已確認」再產生借用單');
      if (!s(S.owner)) throw E('請先填寫展覽的承辦人工號 —— 產生的借用單要掛在他名下');
      var who = findByEmp(c.db, S.owner);
      if (!who) throw E('查無承辦人工號 ' + s(S.owner));
      var only = (c.p.locations || []).map(s).filter(Boolean), want = {};
      (S.lines || []).forEach(function (ln) {
        var v = showLineView(c.db, S, ln, today);
        if (v.need <= 0) return;
        if (only.length && only.indexOf(v.location) < 0) return;
        (want[v.location] = want[v.location] || []).push({ itemId: v.itemId, location: v.location, qty: v.need });
      });
      var locs = Object.keys(want).sort();
      if (!locs.length) throw E('沒有還需要開單的項目');
      var made = [], fail = [];
      locs.forEach(function (where) {
        var sub = { db: c.db, user: c.user, today: c.today, now: c.now, log: c.log, logAs: c.logAs, notify: c.notify,
          p: { event: S.name, venue: s(S.venue), purpose: '', contact: '', note: '由展覽「' + S.name + '」產生(' + where + ')',
            start: s(S.from), end: s(S.to), lines: want[where], onBehalf: true, applicant: s(S.owner),
            dept: s(who.dept), force: bool(c.p.force), showId: S.id } };
        try { made.push(USER.createLoan(sub).id); }
        catch (e) { fail.push({ location: where, error: e.userFacing ? e.message : '無法產生借用單' }); }
      });
      log(c, '由展覽產生借用單', S.id, made.join('、') || '全部失敗');
      return { ok: made.length, ids: made, fail: fail, show: showView(c.db, S, today, true) };
    },
    /** 批次延期:展期往後延時,底下的單不用一張一張延。一張失敗不影響其他張 */
    extendMany: function (c) {
      var ids = (c.p.ids || []).map(s).filter(Boolean), ok = 0, fail = [];
      if (!ids.length) throw E('請先勾選要延期的借用單');
      if (ids.length > 50) throw E('一次最多延期 50 張');
      if (!isDate(c.p.end)) throw E('請填寫新的歸還日');
      ids.forEach(function (id) {
        var sub = { db: c.db, p: { id: id, end: s(c.p.end), note: s(c.p.note), force: bool(c.p.force) }, user: c.user,
          today: c.today, now: c.now, log: c.log, logAs: c.logAs, notify: c.notify };
        try { ADMIN.extendLoan(sub); ok++; }
        catch (e) { fail.push({ id: id, error: e.userFacing ? e.message : '無法延期' }); }
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
      var today = c.today, st = stats(c.db);
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
      it.spec = s(p.spec); it.note = s(p.note); it.image = s(p.image); it.updatedAt = now;
      if (mode === 'qty') {
        var keep = stockMap(it), m = {};
        (p.sites && p.sites.length ? p.sites : [{ location: p.location, qty: p.qty }]).forEach(function (g) {
          var L = loc(g.location), q = Math.max(0, int(g.qty));
          if (!q) return;
          m[L] = { qty: (m[L] ? m[L].qty : 0) + q, countedAt: keep[L] ? keep[L].countedAt : '' };
        });
        writeStock(it, m);
      } else {
        it.qty = 0; it.stock = {};
        it.location = s(p.location);                               // 之後新增單台時的預設地點
      }
      if (isNew) c.db.Items.push(it);
      dirty(c.db, 'Items');
      log(c, isNew ? '新增展品' : '修改展品', it.id, it.name + (mode === 'qty' ? ' ' + (it.location || '') + ' 共 ' + it.qty : ''));
      if (isNew && mode === 'unit' && int(p.unitCount) > 0) addUnits(c, it, int(p.unitCount), p.location);
      return it;
    },
    /** 永久刪除展品:只有從來沒被借過的才可以,借過的請改用下架 */
    deleteItem: function (c) {
      var it = byId(c.db.Items, s(c.p.id));
      if (!it) throw E('找不到展品');
      var used = c.db.Loans.filter(function (L) {
        return (L.lines || []).some(function (ln) { return ln.itemId === it.id; });
      }).length;
      if (used) throw E('「' + it.name + '」已經有 ' + used + ' 筆借用紀錄,不能刪除。請改用「下架」 —— 刪掉的話那些借用單會變成「(已刪除)」,查不出當初借了什麼。');
      var units = c.db.Units.filter(function (u) { return u.itemId === it.id; });
      if (units.some(function (u) { return u.status === 'out'; })) throw E('還有單台在外面,不能刪除');
      var gone = units.length;
      if (gone) {
        c.db.Units = c.db.Units.filter(function (u) { return u.itemId !== it.id; });
        dirty(c.db, 'Units');
      }
      c.db.Items = c.db.Items.filter(function (x) { return x.id !== it.id; });
      dirty(c.db, 'Items');
      log(c, '刪除展品', it.id, it.name + '|' + it.category + '|' + (it.mode === 'unit' ? gone + ' 台單台編號' : '數量 ' + it.qty));
      return { id: it.id, name: it.name, units: gone };
    },
    archiveItem: function (c) {
      var it = byId(c.db.Items, s(c.p.id));
      if (!it) throw E('找不到展品');
      var on = !!c.p.archived;
      if (on) {
        var st = stats(c.db)[it.id];
        if (st.out || st.reserved) throw E('此展品還有借出或已核准的借用,無法下架');
        // 待審核不算在 reserved 裡,但下架之後核准就會變成「看不到的展品被借出去」
        var wait = c.db.Loans.filter(function (L) {
          return L.status === 'pending' && (L.lines || []).some(function (ln) { return ln.itemId === it.id; });
        }).length;
        if (wait) throw E('此展品還有 ' + wait + ' 張待審核的申請,請先處理完再下架');
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
    /** 盤點。給了 location 就只盤那個廠區:應在庫、差異、未點到的單台都只算該區 */
    stocktake: function (c) {
      var today = c.today, now = c.now, st = stats(c.db), apply = !!c.p.apply;
      var where = s(c.p.location), onlyHere = !!where;
      var report = { location: where, qty: [], missingUnits: [], seenUnits: 0, adjusted: 0 };
      (c.p.qty || []).forEach(function (x) {
        var it = byId(c.db.Items, s(x.itemId));
        if (!it || it.mode !== 'qty' || x.counted === '' || x.counted == null) return;
        var at = loc(x.location || where), box = st[it.id + '@' + at];
        if (onlyHere && at !== where) return;
        var expected = box ? box.inStock : 0, counted = Math.max(0, int(x.counted)), diff = counted - expected;
        report.qty.push({ itemId: it.id, name: it.name, location: at, expected: expected, counted: counted, diff: diff });
        var m = stockMap(it);
        m[at] = m[at] || { qty: 0, countedAt: '' };
        m[at].countedAt = today;
        if (apply && diff) { m[at].qty = Math.max(0, int(m[at].qty) + diff); report.adjusted++; }
        writeStock(it, m);
        it.updatedAt = now;
        dirty(c.db, 'Items');
      });
      var seen = {}; (c.p.seenUnits || []).forEach(function (id) { seen[s(id).toUpperCase()] = 1; });
      var scope = {}; (c.p.unitItems || []).forEach(function (id) { scope[id] = 1; });
      c.db.Units.forEach(function (u) {
        if (!scope[u.itemId]) return;
        if (onlyHere && loc(u.location) !== where) return;
        if (seen[u.id]) {
          report.seenUnits++; u.countedAt = today;
          if (u.status === 'lost' && apply) { u.status = 'in'; u.updatedAt = now; report.adjusted++; report.qty.push({ itemId: u.id, name: u.id + ' 找回', expected: 0, counted: 1, diff: 1 }); }
        } else if (u.status === 'in') {
          var it = byId(c.db.Items, u.itemId) || {};
          report.missingUnits.push({ id: u.id, name: it.name, location: loc(u.location), serial: u.serial, history: unitHistory(c.db, u.id).slice(0, 1) });
          if (apply && c.p.markMissingLost) { u.status = 'lost'; u.updatedAt = now; report.adjusted++; }
        }
      });
      dirty(c.db, 'Units');
      var diffs = report.qty.filter(function (x) { return x.diff; });
      log(c, '盤點', today, (where ? where + ':' : '') + '數量品項 ' + report.qty.length + ',差異 ' + diffs.length + ';逐台點到 ' + report.seenUnits + ',未點到 ' + report.missingUnits.length + (apply ? '(已套用調整)' : '(僅記錄)'));
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
  var rules = { isDate: isDate, addDays: addDays, stats: stats, loanWindow: loanWindow, reservedInRange: reservedInRange, availableInRange: availableInRange, checkLines: checkLines, isOverdue: isOverdue, sitesOf: sitesOf, capacity: capacity, cleanLines: cleanLines, showHold: showHold, showIssued: showIssued, cleanShowLines: cleanShowLines };
  return { USER: USER, ADMIN: ADMIN, confirmOnSite: confirmOnSite, reminders: reminders, rules: rules };
})();
