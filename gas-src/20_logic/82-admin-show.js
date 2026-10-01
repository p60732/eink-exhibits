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
      var dr = saneRange(c.p.from, c.p.to, c.today, '開始日', '結束日');
      var draft = { id: s(c.p.id) || '-', from: dr[0], to: dr[1], lines: cleanShowLines(c.db, c.p.lines) };
      return draft.lines.map(function (ln) { return showLineView(c.db, draft, ln, c.today); });
    },
    saveShow: function (c) {
      var p = c.p.show || {}, id = s(p.id), today = c.today, name = s(p.name);
      if (!name) throw E('請填寫展覽名稱');
      if (name.length > 60) throw E('展覽名稱過長(上限 60 字)');
      if (!isDate(p.from) || !isDate(p.to)) throw E('請填寫檔期起訖日期');
      var sr = saneRange(p.from, p.to, today, '開始日', '結束日');
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
      S.name = name; S.from = sr[0]; S.to = sr[1]; S.venue = s(p.venue);
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
      // 借用單已經搬去歷史表了,重開會變成一場沒有單的展覽,結算數字也會跟著歸零
      if (from === 'closed' && bool(S.archived)) throw E('這場展覽的借用單已經封存到歷史表,不能再重新開啟。要查資料請到借用單頁勾選「含歷史資料」');
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
      // 結案的當下把結算結果存成快照:之後單被搬去歷史表,結算頁還看得到數字
      if (to === 'closed') S.settle = settleShow(c.db, S, today);
      if (from === 'closed' && to === 'confirmed') S.settle = null;
      S.status = to; S.updatedAt = c.now;
      dirty(c.db, 'Shows');
      log(c, '展覽改為' + SHOW_ST[to], S.id, S.name + (to === 'closed' ? '|結算 未歸還 ' + S.settle.totals.unreturned + '、短少 ' + S.settle.totals.lost : ''));
      return showView(c.db, S, today, true);
    },
    deleteShow: function (c) {
      var S = showById(c), mine = loansOfShow(c.db, S.id);
      if (bool(S.archived)) throw E('這場展覽的借用單已經封存到歷史表,不能刪除');
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
      /**
       * 有多少開多少:每一行取 min(還要借的量, 這個檔期真的借得到的量)。
       * 借不到的那一段**不會**被硬塞進借用單 —— 它留在需求清單上繼續顯示缺口,
       * 而且展覽會繼續幫它卡著位子(展覽佔用量 = 規劃量 − 已開單量),等進貨進來再按一次就補開。
       * 硬開一張「帳面 12 台、實際只有 10 台」的單,之後點交一定對不起來,所以寧可開一半。
       */
      var only = (c.p.locations || []).map(s).filter(Boolean), want = {}, short = [];
      (S.lines || []).forEach(function (ln) {
        var v = showLineView(c.db, S, ln, today);
        if (v.need <= 0) return;
        if (only.length && only.indexOf(v.location) < 0) return;
        var take = Math.min(v.need, Math.max(0, v.available));
        if (take < v.need) short.push({ itemId: v.itemId, name: v.name, location: v.location, want: v.need, got: take, short: v.need - take });
        if (take <= 0) return;                    // 完全借不到就整行跳過,留在清單上
        (want[v.location] = want[v.location] || []).push({ itemId: v.itemId, location: v.location, qty: take });
      });
      var locs = Object.keys(want).sort();
      if (!locs.length) {
        if (short.length) throw E('這個檔期一台都借不到:' + short.map(function (x) { return x.name + '(' + x.location + ')缺 ' + x.short; }).join('、')
          + '。缺口仍然幫你卡著,進貨之後再按一次就會補開。');
        throw E('沒有還需要開單的項目');
      }
      var made = [], fail = [];
      locs.forEach(function (where) {
        var sub = { db: c.db, user: c.user, today: c.today, now: c.now, log: c.log, logAs: c.logAs, notify: c.notify,
          p: { event: S.name, venue: s(S.venue), purpose: '', contact: '', note: '由展覽「' + S.name + '」產生(' + where + ')',
            start: s(S.from), end: s(S.to), lines: want[where], onBehalf: true, applicant: s(S.owner),
            dept: s(who.dept), force: bool(c.p.force), showId: S.id } };
        try { made.push(USER.createLoan(sub).id); }
        catch (e) { fail.push({ location: where, error: e.userFacing ? e.message : '無法產生借用單' }); }
      });
      log(c, '由展覽產生借用單', S.id, (made.join('、') || '全部失敗')
        + (short.length ? '|缺:' + short.map(function (x) { return x.name + '@' + x.location + ' 差 ' + x.short; }).join(';') : ''));
      return { ok: made.length, ids: made, fail: fail, short: short, show: showView(c.db, S, today, true) };
    },
    /** 展覽總清單:備料 / 搬運用,任何狀態都出得來 */
    showSheet: function (c) { return showSheet(c.db, showById(c), c.today); },
    /** 展後結算:已封存的看結案當下的快照,其他的即時算 */
    showSettle: function (c) {
      var S = showById(c), today = c.today;
      if (bool(S.archived)) {
        var snap = S.settle || { at: '', lines: [], totals: { planned: 0, booked: 0, issued: 0, returned: 0, lost: 0, unreturned: 0 }, loanCount: 0 };
        var out = { at: s(snap.at), lines: snap.lines || [], totals: snap.totals, loanCount: int(snap.loanCount) };
        out.archived = true; out.id = S.id; out.name = s(S.name); out.from = s(S.from); out.to = s(S.to);
        out.venue = s(S.venue); out.status = s(S.status); out.statusLabel = SHOW_ST[S.status] || '';
        return out;
      }
      var live = settleShow(c.db, S, today);
      live.archived = false; live.id = S.id; live.name = s(S.name); live.from = s(S.from); live.to = s(S.to);
      live.venue = s(S.venue); live.status = s(S.status) || 'draft'; live.statusLabel = SHOW_ST[S.status] || SHOW_ST.draft;
      return live;
    },
    /**
     * 批次申請歸還:撤場時底下的單不用一張一張申請。
     * 預設整批全還、還回原借出的廠區;真正扣庫存仍然要管理者確認(receive),這裡只是提出申請。
     */
    returnMany: function (c) {
      var S = showById(c), ids = (c.p.ids || []).map(s).filter(Boolean), ok = 0, fail = [];
      if (!ids.length) throw E('請先勾選要登記歸還的借用單');
      if (ids.length > 50) throw E('一次最多 50 張');
      var mine = {};
      loansOfShow(c.db, S.id).forEach(function (L) { mine[L.id] = L; });
      ids.forEach(function (id) {
        var L = mine[id];
        if (!L) { fail.push({ id: id, error: '這張單不屬於這場展覽' }); return; }
        if (L.status !== 'out') { fail.push({ id: id, error: '不是「出借中」,不能登記歸還' }); return; }
        var lines = (L.lines || []).map(function (ln) {
          var it = byId(c.db.Items, ln.itemId), left = outstanding(ln), where = loc(ln.location);
          if (it && it.mode === 'unit') {
            var back = (ln.units || []).filter(function (u) {
              return (ln.returnedUnits || []).indexOf(u) < 0 && (ln.lostUnits || []).indexOf(u) < 0;
            });
            return { itemId: s(ln.itemId), location: where, to: '', returned: 0, lost: 0,
              unitResults: back.map(function (u) { return { id: u, result: 'in', note: '' }; }) };
          }
          return { itemId: s(ln.itemId), location: where, to: '', returned: left, lost: 0, unitResults: [] };
        }).filter(function (x) { return x.returned > 0 || x.unitResults.length; });
        if (!lines.length) { fail.push({ id: id, error: '沒有還沒歸還的項目' }); return; }
        var sub = { db: c.db, user: c.user, today: c.today, now: c.now, log: c.log, logAs: c.logAs, notify: c.notify,
          p: { id: id, lines: lines, note: s(c.p.note) } };
        // 以前是幫同仁送出「歸還申請」再等管理者確認;現在沒有那一步了,直接登記歸還
        try { doReceive(sub, byId(c.db.Loans, id), lines, s(c.p.note)); ok++; }
        catch (e) { fail.push({ id: id, error: e.userFacing ? e.message : '無法登記歸還' }); }
      });
      log(c, '展覽批次歸還', S.id, ok + ' 張' + (fail.length ? ',失敗 ' + fail.length + ' 張' : ''));
      return { ok: ok, fail: fail, show: showView(c.db, S, c.today, true) };
    },
    /** 先看會搬走哪些,再決定要不要搬。這一步完全不寫東西 */
    archivePreview: function (c) {
      return archiveGroups(c.db, bool(c.p.includePlain));
    },
    /**
     * 實際封存。順序不可以反:
     *   ① 先把結算快照補起來(還看得到單的時候算)
     *   ② 附加到歷史表(失敗就整個中止,借用單一列都沒動)
     *   ③ 確定附加成功,才從借用單表移除
     * 中間斷掉的話,重跑一次會跳過已經在歷史表裡的單,所以可以安全重跑。
     */
    archiveLoans: function (c) {
      if (typeof c.appendHist !== 'function') throw E('這個版本的後端還不支援封存');
      var plain = bool(c.p.includePlain), today = c.today;
      var list = archivable(c.db, plain);
      var only = (c.p.ids || []).map(s).filter(Boolean);
      if (only.length) {
        var want = {};
        only.forEach(function (i) { want[i] = 1; });
        list = list.filter(function (L) { return want[L.id]; });
      }
      if (!list.length) throw E('沒有符合條件的借用單。只有「已結案展覽底下」而且本身已經結束的單才會被搬走');
      if (list.length > 500) list = list.slice(0, 500);      // 一次的寫入量要壓得住

      // ① 快照:一定要在單還在的時候算
      var shows = {}, marked = [];
      list.forEach(function (L) { var sid = s(L.showId); if (sid) shows[sid] = 1; });
      Object.keys(shows).forEach(function (sid) {
        var S = byId(c.db.Shows || [], sid);
        if (!S) return;
        if (!S.settle || !S.settle.totals) S.settle = settleShow(c.db, S, today);
        S.archived = true; S.updatedAt = c.now;
        marked.push(sid);
      });
      if (marked.length) dirty(c.db, 'Shows');

      // ② 附加(已經在歷史表裡的跳過,讓中斷後重跑是安全的)
      var already = {};
      (c.db.Hist || []).forEach(function (h) { already[s(h.id)] = 1; });
      var fresh = list.filter(function (L) { return !already[L.id]; });
      if (fresh.length) c.appendHist(fresh);

      // ③ 附加成功才移除
      var gone = {};
      list.forEach(function (L) { gone[L.id] = 1; });
      c.db.Loans = c.db.Loans.filter(function (L) { return !gone[L.id]; });
      dirty(c.db, 'Loans');
      log(c, '封存借用單到歷史表', marked.join('、') || '-', list.length + ' 張(重複 ' + (list.length - fresh.length) + ' 張)');
      return { moved: fresh.length, skipped: list.length - fresh.length, shows: marked, ids: list.map(function (L) { return L.id; }) };
    },
    /** 批次延期:展期往後延時,底下的單不用一張一張延。一張失敗不影響其他張 */
    extendMany: function (c) {
      var ids = (c.p.ids || []).map(s).filter(Boolean), ok = 0, fail = [];
      if (!ids.length) throw E('請先勾選要延期的借用單');
      if (ids.length > 50) throw E('一次最多延期 50 張');
      saneDate(c.p.end, c.today, '新的歸還日');
      ids.forEach(function (id) {
        var sub = { db: c.db, p: { id: id, end: s(c.p.end), note: s(c.p.note), force: bool(c.p.force) }, user: c.user,
          today: c.today, now: c.now, log: c.log, logAs: c.logAs, notify: c.notify };
        try { ADMIN.extendLoan(sub); ok++; }
        catch (e) { fail.push({ id: id, error: e.userFacing ? e.message : '無法延期' }); }
      });
      return { ok: ok, fail: fail };
    },
