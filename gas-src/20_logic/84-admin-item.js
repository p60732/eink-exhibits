    receive: function (c) {
      var L = byId(c.db.Loans, s(c.p.id));
      if (!L) throw E('找不到借用單');
      var lines = c.p.lines || [];
      return doReceive(c, L, lines, c.p.note);
    },
    /** 補回短少:東西後來找到了。`stock` 預設 'add'(連庫存一起補),'skip' 只結掉單上的短少 */
    recoverLost: function (c) {
      var L = byId(c.db.Loans, s(c.p.id));
      if (!L) throw E('找不到借用單。已經封存到歷史表的單沒辦法補,請用盤點把庫存調對。');
      return doRecover(c, L, c.p.lines || [], c.p.note, s(c.p.stock) !== 'skip');
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
      // 歷史表裡的舊單也算借過 —— 不看的話,封存之後這個展品會突然變得可以刪,
      // 舊單就會永遠顯示「(已刪除)」,查不出當初借了什麼
      var used = c.db.Loans.concat(c.db.Hist || []).filter(function (L) {
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
        if (st.out || st.reserved) throw E('此展品還有借出中的借用,無法下架');
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
        if (u.status === 'out' || p.status === 'out') throw E('借出狀態請透過核准 / 登記歸還變更');
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
    logs: function (c) {
      return c.readLogs(int(c.p.limit) || 300).map(function (r) {
        var o = {}; for (var k in r) o[k] = r[k];
        o.cat = logCat(r.action); o.catLabel = LOG_CAT_LABEL[o.cat];
        return o;
      });
    }
  };
