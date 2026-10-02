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
        outCount: L.filter(function (x) { return x.status === 'out'; }).length,
        leftBehind: leftBehindLoans(c.db, today).map(en),
        lowStock: items.map(function (it) { return itemView(c.db, it, st, null, today); }).filter(function (v) { return v.total > 0 && v.inStock === 0; })
      };
    },
    loans: function (c) {
      var today = c.today, f = s(c.p.filter) || 'active';
      // 歷史表只有在路由把它讀進來時才有東西(前端勾了「含歷史資料」才會讀)
      var hist = {}, src = c.db.Loans;
      if ((c.db.Hist || []).length) {
        c.db.Hist.forEach(function (h) { hist[s(h.id)] = 1; });
        src = src.concat(c.db.Hist);
      }
      return src.filter(function (L) {
        if (f === 'all') return true;
        if (f === 'active') return !!LIVE_ST[L.status];
        if (f === 'overdue') return isOverdue(L, today);
        /**
         * 「短少」是**跨狀態**的視角,不是一個狀態:只要單子身上有短少就收進來。
         * 分成「已歸還(全部)/ 已歸還(短少)」看起來比較直覺,但那樣會漏掉
         * **還了一半、其中有短少、所以還停在「出借中」**的單 —— 而那種才是最該追的
         * (東西還在外面,而且已經確定少了)。
         */
        // 扣掉「不歸還」—— 那些已經決定不收回來了,混進來會讓這個清單失去意義
        if (f === 'short') return (L.lines || []).some(function (ln) { return int(ln.lost) - int(ln.kept) > 0; });
        return L.status === f;
      }).slice().sort(sortLoans).map(function (L) {
        var o = enrichLoan(c.db, L, today);
        o.archived = !!hist[s(L.id)];
        if (L.status === 'pending' || L.status === 'approved') o.check = checkLines(c.db, L.lines, L.start, L.end, L.id, today, s(L.showId));
        return o;
      });
    },
    approve: function (c) {
      var L = byId(c.db.Loans, s(c.p.id)), today = c.today;
      if (!L || L.status !== 'pending') throw E('此申請不是待審核狀態');
      var short = checkLines(c.db, L.lines, L.start, L.end, L.id, today, s(L.showId)).filter(function (x) { return x.short > 0; });
      if (short.length && !c.p.force) throw E('數量不足:' + short.map(function (x) { return x.name + ' 缺 ' + x.short; }).join('、') + '。若仍要核准請勾選「強制核准」');
      // 核准即出借:沒有「點交」這一步了,逐台編號在這裡自動綁上去
      var pick = autoAssign(c, L);
      L.lines.forEach(function (ln) {
        var ids = pick[lineKey(ln)];
        if (!ids) return;
        ln.units = ids;
        ids.forEach(function (uid) { var u = byId(c.db.Units, uid); if (u) { u.status = 'out'; u.updatedAt = c.now; } });
      });
      L.status = 'out'; L.outAt = c.now;
      L.reviewer = c.user.name; L.reviewedAt = c.now; L.reviewNote = s(c.p.note);
      dirty(c.db, 'Loans'); dirty(c.db, 'Units'); log(c, '核准借用', L.id, s(c.p.note));
      // 申請人與核准的人各收到一份:核准的人自己也留一份存檔,不用另外記自己核了什麼
      notify(c, mailList([applicantEmail(c.db, L), c.user.email]), '[展品管理] 借用已核准 ' + L.id + ' — ' + L.event,
        L.applicant + ' 的借用申請已核准,展品已經交付。\n歸還日:' + L.end
        + '\n核准人:' + L.reviewer + '\n聯絡方式:' + (s(L.contact) || '(帳號沒有填 Email)')
        + '\n\n' + linesText(c.db, L) + (L.reviewNote ? '\n\n備註:' + L.reviewNote : ''));
      return enrichLoan(c.db, L, today);
    },
    reject: function (c) {
      var L = byId(c.db.Loans, s(c.p.id));
      if (!L || (L.status !== 'pending' && L.status !== 'approved' && L.status !== 'out')) throw E('此借用單無法駁回');
      if (!s(c.p.note)) throw E('請填寫駁回原因');
      // 已經出借中的只能在「還沒登記過任何歸還」時收回(等於取消核准,東西要拿回來)
      if (L.status === 'out' && !untouched(L)) throw E('這張單已經登記過歸還或短少,不能取消核准。請直接登記剩下的歸還。');
      var backR = releaseUnits(c, L);
      L.status = 'rejected';
      L.reviewer = c.user.name; L.reviewedAt = c.now; L.reviewNote = s(c.p.note);
      dirty(c.db, 'Loans'); log(c, '駁回借用', L.id, s(c.p.note) + (backR.length ? ';放回 ' + backR.join('、') : ''));
      notify(c, mailList([applicantEmail(c.db, L), c.user.email]), '[展品管理] 借用未核准 ' + L.id + ' — ' + L.event,
        L.applicant + ' 的借用申請未核准。\n原因:' + L.reviewNote + '\n審核人:' + L.reviewer);
      return enrichLoan(c.db, L, c.today);
    },
    /** 管理者直接延期,不用等同仁申請 */
    extendLoan: function (c) {
      var L = byId(c.db.Loans, s(c.p.id));
      if (!L) throw E('找不到借用單');
      if (L.status !== 'approved' && L.status !== 'out') throw E('只有出借中的借用可以延期');
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
