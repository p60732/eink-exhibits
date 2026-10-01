  /* ---------- 同仁可用的動作 ---------- */
  var USER = {
    catalog: function (c) {
      var today = c.today, range = null;
      if (isDate(c.p.start) && isDate(c.p.end)) range = saneRange(c.p.start, c.p.end, today, '起日', '迄日');
      // 為某一場展覽挑選時,要把那場自己的卡位排除掉,否則它會擋住自己
      var exShow = s(c.p.showId) || null;
      if (exShow && c.user.role !== 'admin') throw E('只有管理者可以為展覽挑選展品');
      var st = stats(c.db);
      return c.db.Items.filter(function (it) { return !bool(it.archived); })
        .map(function (it) { return itemView(c.db, it, st, range, today, exShow); });
    },
    check: function (c) {
      var r = validRange(c.p, c.today);
      var lines = (c.p.lines || []).filter(function (l) { return int(l.qty) > 0; });
      return checkLines(c.db, lines, r[0], r[1], c.p.excludeId || null, c.today);
    },
    createLoan: function (c) {
      var today = c.today, r = validRange(c.p, today), isAdmin = c.user.role === 'admin';
      if (!isAdmin && r[0] < today) throw E('借出日不可早於今天');
      if (!s(c.p.event)) throw E('請填寫借用目的');
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
        /**
         * 對不到帳號就擋下來。以前這裡會放行,單子的 applicantId 是空的 ——
         * 那張單從此沒有主人:「我的借用」找不到、離職未還抓不到、通知永遠寄不出去,
         * 而且當下看起來完全正常,是最難發現的那一種。
         */
        if (!who) throw E('找不到「' + s(c.p.applicant) + '」的帳號。代為登記要對得到真實帳號,請先在「使用者」建立(或用匯入),再回來登記。');
      }
      /**
       * 沒有 Email 的單子不收。
       * 登入時已經有一道擋板會請本人補,但那是前端的;瀏覽器停在舊版、
       * 或管理者代別人登記時都繞得過去,而繞過去的代價是「核准了卻沒人收到通知」——
       * 當事人只會覺得「我申請了都沒下文」,管理者也不會知道信沒寄出去。
       * 所以這裡再擋一次:要送單,Email 一定要先有。
       */
      var applyUser = onBehalf ? who : c.user;
      if (!s(applyUser.email)) {
        throw E(onBehalf
          ? '「' + s(applyUser.name) + '」的帳號還沒有 Email,核准通知寄不到他手上。請先到「使用者」幫他補上,再回來登記。'
          : '你的帳號還沒有 Email,核准通知會寄不到你手上。請重新整理頁面,系統會請你補一次。');
      }
      var L = {
        id: nextId(c.db.Loans, 'L' + today.slice(2, 4) + today.slice(5, 7) + '-', 3),
        applicant: onBehalf ? (who ? who.name : s(c.p.applicant)) : c.user.name,
        applicantId: onBehalf ? (who ? who.id : '') : c.user.id,
        dept: onBehalf ? (s(c.p.dept) || (who ? s(who.dept) : '')) : (s(c.p.dept) || s(c.user.dept)),
        contact: onBehalf ? contactOf(who) : contactOf(c.user),   // 不吃前端送的值
        event: s(c.p.event), venue: s(c.p.venue), purpose: s(c.p.purpose),
        start: r[0], end: r[1], status: onBehalf ? 'out' : 'pending', lines: lines,   // 代為登記 = 東西已經交出去了
        createdBy: c.user.name, createdAt: c.now,
        reviewer: onBehalf ? c.user.name : '', reviewedAt: onBehalf ? c.now : '', reviewNote: onBehalf ? '管理者代為登記' : '',
        outAt: onBehalf ? c.now : '', returnedAt: '', note: s(c.p.note), showId: showId
      };
      c.db.Loans.push(L); dirty(c.db, 'Loans');
      // 代為登記 = 東西已經交出去了,逐台編號要當場綁上(跟核准那條路一樣)
      if (onBehalf) {
        var pick0 = autoAssign(c, L);
        L.lines.forEach(function (ln) {
          var ids = pick0[lineKey(ln)];
          if (!ids) return;
          ln.units = ids;
          ids.forEach(function (uid) { var u = byId(c.db.Units, uid); if (u) { u.status = 'out'; u.updatedAt = c.now; } });
        });
        dirty(c.db, 'Units');
      }
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
      var r = validRange(c.p, c.today);
      if (!isAdmin && r[0] < c.today) throw E('借出日不可早於今天');
      if (!s(c.p.event)) throw E('請填寫借用目的');
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
    /** 現場把東西交給別人:申請轉借,管理者確認後生效 */
    cancelLoan: function (c) {
      var L = byId(c.db.Loans, s(c.p.id));
      if (!L) throw E('找不到借用單');
      if (L.applicantId !== c.user.id && c.user.role !== 'admin') throw E('只能取消自己的申請');
      if (L.status !== 'pending' && L.status !== 'approved' && L.status !== 'out') throw E('此狀態無法取消');
      // 核准即出借之後,按錯的唯一退路就是這裡 —— 但只要已經登記過歸還就不能整張收回去
      if (L.status === 'out' && !untouched(L)) throw E('這張單已經登記過歸還或短少,不能整張取消。請直接登記剩下的歸還。');
      var backC = releaseUnits(c, L);
      L.status = 'cancelled'; L.note = s(L.note) + (c.p.reason ? ' [取消原因] ' + s(c.p.reason) : '');
      dirty(c.db, 'Loans'); log(c, '取消借用', L.id, s(c.p.reason) + (backC.length ? ';放回 ' + backC.join('、') : ''));
      return enrichLoan(c.db, L, c.today);
    },
    /** 缺口是誰佔住的。同仁看得到數量與歸還日,看不到借用人姓名(跟借用單卡片同一套規則) */
    holders: function (c) {
      var it = byId(c.db.Items, s(c.p.itemId));
      if (!it) throw E('找不到展品');
      if (!isDate(c.p.from) || !isDate(c.p.to)) throw E('請指定期間');
      var hr = saneRange(c.p.from, c.p.to, c.today, '開始日', '結束日');
      var where = s(c.p.location) ? loc(c.p.location) : null;
      var r = holdersOf(c.db, it.id, where, hr[0], hr[1], c.today,
        s(c.p.excludeId) || null, s(c.p.excludeShowId) || null, c.user.role === 'admin');
      r.itemId = it.id; r.name = it.name; r.location = where || '';
      r.capacity = capacity(c.db, it, where);
      r.available = Math.max(0, availableInRange(c.db, it, where, hr[0], hr[1],
        s(c.p.excludeId) || null, c.today, s(c.p.excludeShowId) || null));
      return r;
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

