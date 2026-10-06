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
   * 已經停用(離職 / 調職)的人手上還沒結束的借用單。
   * 停用帳號本身不擋 —— 人事那邊當天就會停,擋下來只會讓人卡住;
   * 真正需要的是「這個人走了、東西還在他手上」這件事要被看見,所以放進總覽的待辦。
   */
  /**
   * 操作紀錄的動作大類。動作名是自由文字(而且有兩個是動態組出來的:
   * 「當面確認…」「展覽改為…」),所以用**有順序的關鍵字**比對,第一個中的就算。
   *
   * ⚠️ 順序不能亂改:「展覽批次申請歸還」「由展覽產生借用單」「封存借用單到歷史表」
   * 都含有「歸還 / 借用」,必須先被展覽那一條抓走,否則會被歸到借用流程。
   * 結構測試會把 .gs 裡每一個動作字串都跑一遍,掉到「其他」就紅。
   */
  var LOG_CAT_LABEL = { show: '展覽', cat: '分類', item: '展品庫存', loan: '借用流程', user: '人員系統', other: '其他' };
  var LOG_CAT_ORDER = ['loan', 'item', 'show', 'cat', 'user', 'other'];
  var LOG_CAT_RULES = [
    ['show', ['展覽', '封存借用單到歷史表']],
    ['cat', ['分類']],
    ['item', ['展品', '單台', '盤點', '上架', '照片']],
    ['loan', ['借用', '歸還', '領取', '簽收', '轉借', '延期', '延長', '點交', '當面確認', '補回短少']],
    ['user', ['帳號', '使用者', '人員', 'PIN', 'Email']]
  ];
  function logCat(action) {
    var a = s(action);
    for (var i = 0; i < LOG_CAT_RULES.length; i++) {
      var key = LOG_CAT_RULES[i][0], words = LOG_CAT_RULES[i][1];
      for (var j = 0; j < words.length; j++) if (a.indexOf(words[j]) >= 0) return key;
    }
    return 'other';
  }
  function leftBehindLoans(db, today) {
    var off = {};
    (db.Users || []).forEach(function (u) { if (!bool(u.active)) off[u.id] = u.name || u.empNo; });
    return (db.Loans || []).filter(function (L) {
      return !!LIVE_ST[L.status] && s(L.applicantId) && off[s(L.applicantId)];
    });
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
      archived: bool(S.archived),
      settled: !!(S.settle && S.settle.totals),
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
  /**
   * 展後結算:依「品項@地點」把規劃與實際對照起來。
   *   規劃     = 展覽規劃清單的數量
   *   已開單   = 開了單但還沒領走(待審核 / 已核准)
   *   實際借出 = 真的領出去過的(出借中 / 已歸還)
   *   已歸還 / 短少 / 未歸還 = 從每一行的 returned / lost / outstanding 累加
   * 駁回與取消的單完全不算 —— 那些東西根本沒出去過。
   */
  var WENT_OUT = { out: 1, returned: 1 };
  var BOOKED_ST = { pending: 1, approved: 1 };
  function settleShow(db, S, today) {
    var rows = {}, order = [];
    function row(itemId, where) {
      var k = itemId + '@' + where;
      if (!rows[k]) {
        var it = byId(db.Items, itemId);
        rows[k] = { itemId: itemId, location: where, name: it ? it.name : '(已刪除)', mode: it ? it.mode : 'qty',
          planned: 0, booked: 0, issued: 0, returned: 0, lost: 0, unreturned: 0, loans: [] };
        order.push(k);
      }
      return rows[k];
    }
    (S.lines || []).forEach(function (ln) { row(s(ln.itemId), loc(ln.location)).planned += int(ln.qty); });
    loansOfShow(db, S.id).forEach(function (L) {
      if (L.status === 'rejected' || L.status === 'cancelled') return;
      (L.lines || []).forEach(function (ln) {
        var r = row(s(ln.itemId), loc(ln.location));
        if (BOOKED_ST[L.status]) r.booked += int(ln.qty);
        if (WENT_OUT[L.status]) {
          r.issued += int(ln.qty);
          r.returned += int(ln.returned);
          r.lost += int(ln.lost);
          r.unreturned += outstanding(ln);
        }
        if (r.loans.indexOf(L.id) < 0) r.loans.push(L.id);
      });
    });
    var lines = order.map(function (k) { return rows[k]; });
    var F = ['planned', 'booked', 'issued', 'returned', 'lost', 'unreturned'], totals = {};
    F.forEach(function (f) { totals[f] = 0; });
    lines.forEach(function (r) { F.forEach(function (f) { totals[f] += r[f]; }); });
    return { at: today, lines: lines, totals: totals, loanCount: loansOfShow(db, S.id).length };
  }

  /* ---------- 封存到歷史表 ----------
   * 「已結案」的展覽底下、而且本身也已經結束的單才可以搬。
   * 搬 = 先附加到歷史表,附加確定成功才從借用單表移除;順序反過來就會掉單。
   * 掛在還沒結案的展覽底下的單一律不搬 —— 展覽還沒結算完,資料不能先被抽走。
   */
  var ARCH_ST = { returned: 1, cancelled: 1, rejected: 1 };
  function archivable(db, includePlain) {
    var closed = {};
    (db.Shows || []).forEach(function (S) { if (s(S.status) === 'closed') closed[S.id] = 1; });
    return (db.Loans || []).filter(function (L) {
      if (!ARCH_ST[L.status]) return false;
      var sid = s(L.showId);
      if (!sid) return !!includePlain;          // 沒掛展覽的一般單:要另外勾選才搬
      return !!closed[sid];                     // 展覽不存在或還沒結案 → 不搬
    });
  }
  function archiveGroups(db, includePlain) {
    var list = archivable(db, includePlain), byShow = {}, plain = [];
    list.forEach(function (L) {
      var sid = s(L.showId);
      if (!sid) { plain.push(L.id); return; }
      (byShow[sid] = byShow[sid] || []).push(L.id);
    });
    return {
      total: list.length,
      plain: plain,
      shows: Object.keys(byShow).sort().map(function (sid) {
        var S = byId(db.Shows || [], sid);
        return { id: sid, name: S ? s(S.name) : sid, from: S ? s(S.from) : '', to: S ? s(S.to) : '', ids: byShow[sid] };
      })
    };
  }

  /**
   * 展覽總清單(備料 / 搬運用)。
   * **規劃中就出得來** —— 備料本來就發生在開單之前,要等開完單才能印等於沒用。
   * 依廠區分組,因為點貨的人是站在某一個廠區的架子前面,不會想看別廠的東西。
   */
  function showSheet(db, S, today) {
    var mine = loansOfShow(db, S.id).filter(function (L) { return L.status !== 'rejected' && L.status !== 'cancelled'; });
    var byLoc = {}, order = [];
    (S.lines || []).forEach(function (ln) {
      var v = showLineView(db, S, ln, today), where = v.location;
      var row = { itemId: v.itemId, name: v.name, category: v.category, mode: v.mode, location: where,
        planned: v.qty, issued: v.issued, need: v.need, available: v.available, short: v.short,
        note: s(ln.note), loans: [], units: [] };
      mine.forEach(function (L) {
        (L.lines || []).forEach(function (x) {
          if (s(x.itemId) !== v.itemId || loc(x.location) !== where) return;
          if (row.loans.indexOf(L.id) < 0) row.loans.push(L.id);
          (x.units || []).forEach(function (u) { if (row.units.indexOf(u) < 0) row.units.push(u); });
        });
      });
      if (!byLoc[where]) { byLoc[where] = []; order.push(where); }
      byLoc[where].push(row);
    });
    order.sort();
    var groups = order.map(function (w) {
      var rows = byLoc[w].slice().sort(function (a, b) {
        var ka = s(a.category) + '\u0000' + s(a.name), kb = s(b.category) + '\u0000' + s(b.name);
        return ka < kb ? -1 : (ka > kb ? 1 : 0);
      });
      return { location: w, rows: rows, items: rows.length,
        planned: rows.reduce(function (a, x) { return a + x.planned; }, 0),
        short: rows.reduce(function (a, x) { return a + x.short; }, 0) };
    });
    var all = groups.reduce(function (a, g) { return a.concat(g.rows); }, []);
    var sum = function (f) { return all.reduce(function (a, x) { return a + x[f]; }, 0); };
    var who = s(S.owner) ? findByEmp(db, S.owner) : null;
    return {
      id: S.id, name: s(S.name), from: s(S.from), to: s(S.to), venue: s(S.venue),
      owner: s(S.owner), ownerName: who ? s(who.name) : '', note: s(S.note),
      status: s(S.status) || 'draft', statusLabel: SHOW_ST[S.status] || SHOW_ST.draft,
      at: today, groups: groups,
      totals: { items: all.length, planned: sum('planned'), issued: sum('issued'), need: sum('need'), short: sum('short') }
    };
  }
  function showById(c) {
    var S = byId(c.db.Shows || [], s(c.p.id));
    if (!S) throw E('找不到展覽');
    return S;
  }

