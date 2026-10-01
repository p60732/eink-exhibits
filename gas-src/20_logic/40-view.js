  function isOverdue(L, today) { return L.status === 'out' && L.end < today; }
  function enrichLoan(db, L, today) {
    var o = {};
    for (var k in L) o[k] = L[k];
    o.statusLabel = LOAN_ST[L.status] || L.status;
    /* v3.0:借用單的 request 欄不再是流程的一部分(簽收 / 歸還 / 延期 / 轉借四種請求都拿掉了)。
       **工作表的欄位刻意留著**不動結構,舊單裡的值也原樣保存;但它不再出現在 API 回應裡,
       免得前端又長出讀它的分支。 */
    delete o.request;
    o.showId = s(L.showId);
    if (o.showId) { var sw = byId(db.Shows || [], o.showId); o.showName = sw ? sw.name : ''; }
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
    // 封存到歷史表的舊單也要列進來,否則一台機器的借用歷程會在封存那天憑空斷掉
    db.Loans.concat(db.Hist || []).forEach(function (L) {
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
  function validRange(p, today) {
    if (!isDate(p.start) || !isDate(p.end)) throw E('請填寫借用起訖日期');
    return saneRange(p.start, p.end, today, '借出日', '歸還日');
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
  /**
   * 聯絡方式一律從帳號帶:工號 / Email。
   * 以前這是表單上的自由輸入欄,十個人十種寫法、常常留空,而帳號裡本來就有這兩樣,
   * 叫人再抄一次只會多出錯字。**前端不再送 contact,送了也不算數。**
   */
  function contactOf(u) {
    if (!u) return '';
    var emp = s(u.empNo), mail = s(u.email);
    return emp && mail ? emp + ' / ' + mail : (emp || mail);
  }
  /** 收件者清單:去掉空的、去掉重複(自己核准自己代開的單時,兩邊會是同一個人) */
  function mailList(list) {
    var seen = {}, out = [];
    (list || []).forEach(function (x) { var v = s(x); if (v && !seen[v]) { seen[v] = 1; out.push(v); } });
    return out;
  }
  function applicantEmail(db, L) {
    var u = byId(db.Users, L.applicantId);
    if (u && s(u.email)) return u.email;
    return /@/.test(s(L.contact)) ? s(L.contact) : '';
  }
  function linesText(db, L) {
    return (L.lines || []).map(function (ln) { var it = byId(db.Items, ln.itemId) || {}; return '・' + (it.name || ln.itemId) + ' × ' + ln.qty; }).join('\n');
  }

