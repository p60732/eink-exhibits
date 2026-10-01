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
  /**
   * 「這段期間是誰佔著它」。
   * 只給一個「缺 3」的數字,遇到一場 30～100 件的展覽就只能一張一張去翻借用單 ——
   * 所以缺口要點得開,直接告訴你是哪幾張單、哪幾場展覽卡著,以及最早什麼時候會還。
   * `full` 為假時不帶借用人姓名/部門(同仁看得到「被幾張單佔住、最早哪天還」就夠了)。
   */
  function holdersOf(db, itemId, where, from, to, today, excludeId, excludeShowId, full) {
    var key = where == null ? itemId : itemId + '@' + loc(where), loans = [];
    (loanIndex(db)[key] || []).forEach(function (e) {
      if (e.L.id === excludeId) return;
      var w = loanWindow(e.L, today);
      if (w[0] > to || w[1] < from) return;
      var q = outstanding(e.ln);
      if (q <= 0) return;
      var o = { id: e.L.id, qty: q, status: e.L.status, statusLabel: LOAN_ST[e.L.status] || e.L.status,
        start: s(e.L.start), end: s(e.L.end), overdue: isOverdue(e.L, today), showId: s(e.L.showId) };
      if (full) { o.applicant = s(e.L.applicant); o.dept = s(e.L.dept); o.event = s(e.L.event); }
      loans.push(o);
    });
    var issued = showIssued(db), shows = [];
    (db.Shows || []).forEach(function (S) {
      if (S.status !== 'confirmed' || S.id === excludeShowId) return;
      if (s(S.from) > to || s(S.to) < from) return;
      (S.lines || []).forEach(function (ln) {
        if (s(ln.itemId) !== itemId) return;
        if (where != null && loc(ln.location) !== loc(where)) return;
        var q = Math.max(0, int(ln.qty) - (issued[S.id + '|' + lineKey(ln)] || 0));
        if (q <= 0) return;
        shows.push({ id: S.id, name: s(S.name), from: s(S.from), to: s(S.to), qty: q });
      });
    });
    // 最早還的排前面 —— 那通常就是最喬得動的那一張
    loans.sort(function (a, b) { return a.end < b.end ? -1 : (a.end > b.end ? 1 : 0); });
    shows.sort(function (a, b) { return a.from < b.from ? -1 : (a.from > b.from ? 1 : 0); });
    return { loans: loans, shows: shows,
      loanQty: loans.reduce(function (a, x) { return a + x.qty; }, 0),
      showQty: shows.reduce(function (a, x) { return a + x.qty; }, 0) };
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
