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

