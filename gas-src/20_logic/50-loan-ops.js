  /* ---------- 延期 / 轉借(管理者後台與當面確認共用) ---------- */
  /** 只檢查日期與延長期間的可借量,回傳不足的品項 */
  function checkExtend(db, L, newEnd, today) {
    newEnd = saneDate(newEnd, today, '新的歸還日');
    if (newEnd <= L.end) throw E('新的歸還日要比原本的 ' + L.end + ' 晚');
    if (dayDiff(s(L.start), newEnd) > MAX_SPAN_DAYS) throw E('延長後整段期間共 ' + (dayDiff(s(L.start), newEnd) + 1) + ' 天,超過上限 ' + MAX_SPAN_DAYS + ' 天');
    return checkLines(db, L.lines, addDays(L.end, 1), newEnd, L.id, today, s(L.showId)).filter(function (x) { return x.short > 0; });
  }
  function doExtend(c, L, newEnd, note, force) {
    if (L.status !== 'approved' && L.status !== 'out') throw E('只有出借中的借用可以延期');
    var short = checkExtend(c.db, L, newEnd, c.today);
    if (short.length && !force) throw E('延長期間數量不足:' + short.map(function (x) { return x.name + ' 缺 ' + x.short; }).join('、') + '。若仍要延期請勾選「強制」');
    var old = L.end;
    L.end = newEnd;
    dirty(c.db, 'Loans');
    log(c, '延長歸還日', L.id, old + ' → ' + newEnd + (note ? '|' + note : ''));
    notify(c, applicantEmail(c.db, L), '[展品管理] 已延長歸還日 ' + L.id + ' — ' + L.event,
      '歸還日由 ' + old + ' 延長為 ' + newEnd + '。' + (note ? '\n備註:' + note : ''));
    return enrichLoan(c.db, L, c.today);
  }

  /* ---------- 歸還 ---------- */

  /**
   * 核准即出借:逐台編號的展品,編號本來是在「點交」那一步綁定的。
   * 拿掉點交之後就得在核准當下自動挑 —— 不然 lines[].units 是空的,
   * 歸還時一台都對不到,會被「這次沒有登記到任何一項」擋下來。
   *
   * ⚠️ 連帶的意思:**核准 = 東西交出去了**,那幾台當下就變成「借出」,
   * 盤點時看得到它們不在架上。所以規則是「人來拿的時候才核准」。
   */
  /**
   * 把已經綁上去的單台編號放回架上。
   * 核准即出借之後,「按錯了」的唯一退路就是取消 / 取消核准 ——
   * 不放回去的話那幾台會永遠卡在「借出」,盤點永遠對不起來。
   */
  function releaseUnits(c, L) {
    var back = [];
    (L.lines || []).forEach(function (ln) {
      (ln.units || []).forEach(function (uid) {
        var u = byId(c.db.Units, uid);
        if (u && u.status === 'out') { u.status = 'in'; u.updatedAt = c.now; back.push(uid); }
      });
      ln.units = [];
    });
    if (back.length) dirty(c.db, 'Units');
    return back;
  }
  /** 還沒有任何一項被登記歸還 / 短少,才可以整張收回去 */
  function untouched(L) {
    return (L.lines || []).every(function (ln) { return !int(ln.returned) && !int(ln.lost); });
  }
  function autoAssign(c, L) {
    var used = {};
    (c.db.Loans || []).forEach(function (o) {
      if (o.id === L.id || !LIVE_ST[o.status]) return;
      (o.lines || []).forEach(function (ln) { (ln.units || []).forEach(function (u) { used[u] = 1; }); });
    });
    var out = {};
    L.lines.forEach(function (ln) {
      var it = byId(c.db.Items, ln.itemId);
      if (!it || it.mode !== 'unit') return;
      var where = loc(ln.location), need = int(ln.qty);
      var free = (c.db.Units || []).filter(function (u) {
        return u.itemId === it.id && u.status === 'in' && loc(u.location) === where && !used[u.id];
      }).slice(0, need);
      if (free.length < need) {
        throw E('「' + it.name + '」在 ' + where + ' 現在只有 ' + free.length + ' 台在庫,這張單要 ' + need
          + ' 台。請確認實物後再核准(核准就等於把東西交出去)。');
      }
      free.forEach(function (u) { used[u.id] = 1; });
      out[lineKey(ln)] = free.map(function (u) { return u.id; });
    });
    return out;
  }

  function doReceive(c, L, inputLines, note) {
    var today = c.today, now = c.now;
    if (L.status !== 'out') throw E('只有「出借中」的借用單可以歸還');
    var input = {};
    // 一律用「品項@地點」對位。沒有對到的行就不動它 ——
    // 退回去抓「同品項的另一行」會把 A 廠區的歸還數量套到 B 廠區,東西還在外面卻記成已還。
    (inputLines || []).forEach(function (x) { input[s(x.itemId) + '@' + loc(x.location)] = x; });
    var notes = [], touched = 0;      // 真的動到幾項。一項都沒動到就不算一次歸還(見下面的守門)
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
          if (r.result === 'lost') { touched++; ln.lostUnits.push(uid); ln.lost = int(ln.lost) + 1; if (u) u.status = 'lost'; notes.push(uid + ' 遺失'); }
          /**
           * 「不歸還」= 東西沒有不見,是**決定不收回來了**(例:老闆指示留在當地)。
           * 庫存一樣要扣,但它跟短少是兩回事:短少要追,這個已經結案了。
           * 逐台型接到既有的 `retired` —— unitSites 只算 in / out,所以它本來就不佔庫存。
           * 計數上掛在 lost 底下(kept 是 lost 的子集),這樣 outstanding 的公式完全不用動。
           */
          else if (r.result === 'retired') {
            if (!s(r.note)) throw E(uid + ' 標成「不歸還」要在備註寫原因 —— 這會直接把它從庫存移除,而且不能反悔。');
            touched++; ln.lostUnits.push(uid); ln.lost = int(ln.lost) + 1; ln.kept = int(ln.kept) + 1;
            // 另外記一份 keptUnits:lostUnits 裡混了「遺失」與「不歸還」,畫面上要分得出來哪台是哪種
            ln.keptUnits = (ln.keptUnits || []).concat([uid]);
            ln.keptNote = (s(ln.keptNote) ? s(ln.keptNote) + ';' : '') + uid + ':' + s(r.note);
            if (u) u.status = 'retired'; notes.push(uid + ' 不歸還(' + s(r.note) + ')');
          }
          else if (r.result === 'in' || r.result === 'repair') {
            touched++;
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
        /**
         * 損壞是「還回來了,但壞了」——**算在 ret 裡面的子集**,不另外佔 outstanding。
         * 這樣 `outstanding = qty − returned − lost` 這條公式完全不用動,
         * 是刻意選的最小風險路徑(動那條公式等於動整個庫存計算)。
         * 東西還在庫存裡,只是在這張單與操作紀錄上留下記號。
         */
        var dmg = Math.min(ret, Math.max(0, int(x.damaged)));
        /**
         * 「不歸還」跟「短少」一樣會讓東西離開庫存,但意思相反:
         * 短少是東西不見了、要去追;不歸還是**決定不收回來**,已經結案。
         * 兩個分開記才有意義 —— 不然「短少」那個清單會混進一堆不用追的單。
         * kept 是 lost 的子集(跟 damaged 之於 returned 同一套),所以
         * `outstanding = qty − returned − lost` 這條核心公式一個字都不用動。
         */
        var kept = Math.min(left - ret - lost, Math.max(0, int(x.kept)));
        if (kept && !s(x.keptNote)) throw E('標成「不歸還」要寫原因 —— 這會直接把東西從庫存移除,而且不能反悔。');
        lost += kept;
        if (ret || lost) touched++;
        ln.returned = int(ln.returned) + ret; ln.lost = int(ln.lost) + lost;
        if (kept) {
          ln.kept = int(ln.kept) + kept;
          ln.keptNote = (s(ln.keptNote) ? s(ln.keptNote) + ';' : '') + s(x.keptNote);
          notes.push((it ? it.name : '') + ' 不歸還 ' + kept + '(' + s(x.keptNote) + ')');
        }
        if (dmg) { ln.damaged = int(ln.damaged) + dmg; notes.push(it ? it.name + ' 有 ' + dmg + ' 台損壞' : dmg + ' 台損壞'); }
        // 庫存照 lost 全額扣(kept 已經併進去了),但紀錄上要分開寫 ——
        // 操作紀錄是事後追短少唯一的線索,混在一起寫就分不出哪些還要追。
        if (lost && it) { adjustStock(c, it, from, -lost); if (lost - kept > 0) notes.push(it.name + '(' + from + ') 短少 ' + (lost - kept)); }
        if (ret && it && back !== from) {                            // 還到別的廠區 = 庫存跟著搬過去
          adjustStock(c, it, from, -ret); adjustStock(c, it, back, ret);
          notes.push(it.name + ' ' + ret + ' 台從 ' + from + ' 移到 ' + back);
        }
      }
    });
    // 一項都沒登記到就停在這裡。以前這種情況會「回報成功 + 寫一筆歸還紀錄」,
    // 東西其實還在外面,單子看起來卻處理過了 —— 這是最難發現的那種掉東西。
    // 在這裡丟錯誤,這次請求整個不存檔。
    if (!touched) throw E('這次沒有登記到任何一項。數量型請至少填「歸還」或「短少」的數量,逐台型請選「歸還 / 送修 / 遺失」。');
    var done = L.lines.every(function (ln) { return outstanding(ln) === 0; });
    if (done) { L.status = 'returned'; L.returnedAt = now; }
    if (s(note)) L.note = s(L.note) + ' [歸還] ' + s(note);
    dirty(c.db, 'Loans'); dirty(c.db, 'Units');
    log(c, (c.onSite ? '當面確認' : '') + (done ? '歸還完成' : '部分歸還'), L.id, notes.join(';') || '正常歸還');
    /**
     * 歸還本來完全不寄信 —— 申請人只能自己去看系統才知道「這筆結案了沒」,
     * 而管理者也沒有任何回執。對同仁來說,整個流程應該是「送出申請之後都靠信」。
     */
    notify(c, mailList([applicantEmail(c.db, L), c.user.email]),
      '[展品管理] ' + (done ? '借用已結案' : '部分歸還') + ' ' + L.id + ' — ' + L.event,
      L.applicant + ' 的借用單' + (done ? '已全部歸還,這筆結案。' : '登記了部分歸還,還有沒還完的項目。')
      + '\n登記人:' + c.user.name + '\n歸還日:' + today
      + (notes.length ? '\n\n' + notes.join('\n') : '')
      + '\n\n' + linesText(c.db, L));
    return enrichLoan(c.db, L, today);
  }
  function ownLoan(c) {
    var L = byId(c.db.Loans, s(c.p.id));
    if (!L) throw E('找不到借用單');
    if (L.applicantId !== c.user.id && c.user.role !== 'admin') throw E('這不是你的借用單');
    return L;
  }

