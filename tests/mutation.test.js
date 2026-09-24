// 守門突變測試:逐一拿掉防護,e2e 必須失敗,證明測試真的擋得住。node tests/mutation.test.js
const fs = require('fs'), path = require('path'), os = require('os'), { spawnSync } = require('child_process');
const root = path.join(__dirname, '..');
const M = [
  ['00_gateway.gs', "if (route.auth === 'admin') Identity.requireAdmin(c.user);", '', '拿掉管理者權限檢查'],
  ['00_gateway.gs', 'checkPayload_(req.payload, route.fields, route.big)', '(req.payload || {})', '拿掉參數白名單'],
  ['00_gateway.gs', "err.userFacing ? err.message : '操作失敗,請稍後再試'", 'err.message', '錯誤訊息洩漏內部細節'],
  ['10_identity.gs', '    checkPin_(a, pin);\n    return a;', '    return a;', '當面確認不驗管理者 PIN'],
  ['10_identity.gs', "if (bool(u.mustChange) && ['me', 'changePin', 'logout'].indexOf(action) < 0) throw E('請先變更 PIN');", '', '拿掉首次改 PIN 強制'],
  ['10_identity.gs', "|| String(+u.sessionVer || 0) !== p[1]", '', '登出後 token 仍有效'],
  ['10_identity.gs', 'function guardOk_(k) { return', 'function guardOk_(k) { return true || ', '拿掉 PIN 錯誤次數限制'],
  ['20_logic.gs', 'if (short.length && !(isAdmin && c.p.force)) {', 'if (false) {', '拿掉庫存不足檢查'],
  ['20_logic.gs', "if (L.applicantId !== c.user.id && c.user.role !== 'admin') throw E('這不是你的借用單');", '', '可操作別人的借用單'],
  ['20_logic.gs', "if (!isDate(p.start) || !isDate(p.end)) throw E('請填寫借用起訖日期');", '', '拿掉日期格式驗證'],
  // 效能重構的守門:欄位少讀 / 表少讀 / 快取沒失效,都必須被 e2e 抓到
  ['00_gateway.gs', "LOAN_CALC: ['id', 'status', 'start', 'end', 'lines']", "LOAN_CALC: ['id', 'status', 'start', 'end']", '可借量計算少讀 lines 欄'],
  ['00_gateway.gs', "ITEM_CALC: ['id', 'name', 'category', 'mode', 'qty', 'location', 'stock', 'archived']", "ITEM_CALC: ['id', 'name', 'category', 'mode', 'qty', 'archived']", '展品少讀各地點庫存(stock)欄'],
  ['00_gateway.gs', "UNIT_CALC: ['id', 'itemId', 'status', 'location', 'countedAt']", "UNIT_CALC: ['id', 'itemId', 'status']", '單台少讀地點與盤點日欄'],
  ['00_gateway.gs', "LOAN_HOLD: ['id', 'status', 'start', 'end', 'lines', 'applicant', 'dept', 'event']", "LOAN_HOLD: ['id', 'status', 'start', 'end', 'lines']", '單台持有人少讀 applicant 欄'],
  ['30_memory.gs', "if (cols.indexOf('id') < 0) cols.push('id');", '', '指定欄位時漏讀 id'],
  ['30_memory.gs', "if (Object.keys(db._dirty || {}).length) bumpVersion_();", '', '寫入後快取沒有失效'],
  ['00_gateway.gs', "values: ['pending', 'approved', 'out']", "values: ['pending']", '庫存計算漏掉出借中的單'],
  ['30_memory.gs', "if (only.values.indexOf(String(vals[i][0]).trim()) >= 0) return i;", "if (only.values.indexOf(String(vals[i][0]).trim()) >= 0) return i + 1;", '尾段讀取少讀最舊的一筆'],
  ['20_logic.gs', "c.db.Items.forEach(function (it) { if (it.category === old) { it.category = name; dirty(c.db, 'Items'); } });", '', '分類改名後展品沒跟著換'],
  ['20_logic.gs', "if (used) throw E('還有 ' + used + ' 項展品屬於「' + cat.name + '」,請先改到其他分類');", '', '停用分類時沒檢查底下還有展品'],
  ['20_logic.gs', "if (same && !bool(same.archived)) throw E('分類「' + same.name + '」已存在');", '', '允許建立重複的分類'],
  // 借用單流程的守門
  ['20_logic.gs', "if (L.status !== 'pending') throw E('只有「待審核」的申請可以修改');", '', '已核准的單也能被改掉'],
  ['20_logic.gs', "if (newEnd <= L.end) throw E('新的歸還日要比原本的 ' + L.end + ' 晚');", '', '延期可以往前縮'],
  ['20_logic.gs', "if (short.length && !force) throw E('延長期間數量不足:'", "if (false) throw E('延長期間數量不足:'", '延期不檢查延長期間的庫存'],
  ['20_logic.gs', "if (L.request && L.request.type) throw E('這張單還有待確認的請求,請先完成或撤回');", '', '同一張單可以同時掛兩個請求'],
  ['20_logic.gs', "catch (e) { fail.push({ id: id, error: e.userFacing ? e.message : '無法核准' }); }", 'catch (e) { ok++; }', '批次核准把失敗的也算成功'],
  // 效能索引:資料變了卻沒清掉快取,會算出過期的可借量
  ['20_logic.gs', "if (t === 'Loans') { m.li = null; m.si = null; }", '', '借用單索引沒隨資料更新'],
  // 刪除展品與照片上傳的守門
  ['20_logic.gs', "if (used) throw E('「' + it.name + '」已經有 '", "if (false) throw E('「' + it.name + '」已經有 '", '借過的展品也能被刪掉'],
  ['60_files.gs', "if (!mime) throw err_('只接受 JPG / PNG / WebP');", "mime = mime || 'image/jpeg';", '什麼檔案都收'],
  ['60_files.gs', "if (data.length > MAX_B64) throw err_('照片太大", "if (false) throw err_('照片太大", '照片大小沒有上限'],
  ['00_gateway.gs', "var strMax = maxStr || LIMITS_.str;", "var strMax = 400000;", '所有路由的文字長度限制都被放寬'],
  // 分地點庫存的守門
  ['20_logic.gs', "if (where != null) return siteTotal(db, item, where);", '', '可借量不分地點,新竹借光了林口也跟著不能借'],
  ['20_logic.gs', "if (loc(u.location) !== where) throw E(uid + ' 放在 '", "if (false) throw E(uid + ' 放在 '", '點交可以拿別廠的機器交差'],
  ['20_logic.gs', "if (sites.length > 1) throw E('「' + it.name + '」放在 '", "if (false) throw E('「' + it.name + '」放在 '", '多地點時沒要求指定要借哪一點'],
  ['20_logic.gs', "} else if (sites.length && sites.indexOf(where) < 0) {", '} else if (false) {', '可以借一個根本沒庫存的地點'],
  ['20_logic.gs', "if (onlyHere && at !== where) return;", '', '只盤一個廠區時卻把別廠的也算進差異'],
  ['20_logic.gs', "if (onlyHere && loc(u.location) !== where) return;", '', '只盤一個廠區時別廠的單台被當成沒點到'],
  ['00_gateway.gs', "success: false, health: true", "success: true, health: false", '健康檢查頁偽裝成正常回應(換版時會被當成資料)'],
  // 防資料遺失的三道保險
  ['30_memory.gs', "if (!full[key]) throw fail_('「' + SHEET_NAMES[key] + '」這次只讀了一部分", "if (false) throw fail_('「' + SHEET_NAMES[key] + '」這次只讀了一部分", '只讀一部分也能整張寫回(會清掉沒讀到的資料)'],
  ['30_memory.gs', "if (!sh) throw fail_('找不到工作表「'", "if (!sh) return create_(key); if (!sh) throw fail_('找不到工作表「'", '工作表不見時自動重建並塞回預設值'],
  ['30_memory.gs', "if (miss.length) throw fail_('工作表「'", "if (false) throw fail_('工作表「'", '表頭對不上也照讀(等於認錯試算表)'],
  // 展覽的殘額佔位:這幾條紅了才代表「不會重複扣庫存」真的被守住
  ['20_logic.gs', "sum += Math.max(0, int(ln.qty) - (issued[S.id + '|' + lineKey(ln)] || 0));", 'sum += int(ln.qty);', '展覽卡位沒扣掉已開單量(同一批東西被扣兩次)'],
  ['20_logic.gs', "      - showHold(db, item.id, where, from, to, excludeShowId || null);", '      - 0;', '可借量沒扣掉展覽的卡位(展覽等於沒卡位)'],
  ['20_logic.gs', "var ISSUED_ST = { approved: 1, out: 1 };", "var ISSUED_ST = { pending: 1, approved: 1, out: 1 };", '待審核就讓展覽放手(審核期間出現空窗)'],
  ['20_logic.gs', "if (S.status !== 'confirmed' || S.id === excludeShowId) return;", "if (S.id === excludeShowId) return;", '規劃中 / 已結案的展覽也在卡位'],
  ['00_gateway.gs', "SHOW_CALC: ['id', 'name', 'from', 'to', 'status', 'lines'],", "SHOW_CALC: ['id', 'name', 'from', 'to', 'status'],", '算卡位時少讀展覽的規劃清單'],
  ['20_logic.gs', "if (live.length) throw E('底下還有 ' + live.length + ' 張沒結束的借用單('", "if (false) throw E('底下還有 ' + live.length + ' 張沒結束的借用單('", '底下還有沒結束的單也能結案'],
  ['20_logic.gs', "if (mine.length) throw E('這場展覽底下已經有 ' + mine.length + ' 張借用單,不能刪除。請改成「取消」以保留紀錄');", '', '有借用單的展覽也能刪掉'],
  ['20_logic.gs', "        if (!isAdmin) throw E('只有管理者可以把借用單掛到展覽底下');", '', '同仁也能把單掛到展覽底下(可以解掉別人的卡位)'],
  // v2.2 審查抓到的八條:每一條都先在未修正版重現過,這裡證明測試真的擋得住
  ['20_logic.gs', "          pending.splice(at, 1);", '', '同一台編號送兩次被算兩次(單子提早結案,另一台卡死)'],
  ['20_logic.gs', "    (inputLines || []).forEach(function (x) { input[s(x.itemId) + '@' + loc(x.location)] = x; });",
   "    (inputLines || []).forEach(function (x) { input[s(x.itemId) + '@' + loc(x.location)] = x; if (!(s(x.itemId) in input)) input[s(x.itemId)] = x; });\n    L.lines.forEach(function (ln) { if (!input[lineKey(ln)] && input[ln.itemId]) input[lineKey(ln)] = input[ln.itemId]; });",
   '歸還只送一個地點時套用到同品項的另一個地點'],
  ['20_logic.gs', "      L.status = 'rejected'; L.request = null;", "      L.status = 'rejected';", '駁回沒清掉待確認請求(已駁回的單還能被延期)'],
  ['20_logic.gs', "      if (L.request && L.request.type) throw E('這張單還有待確認的請求,請先完成或撤回');\n      var lines = (c.p.lines || []).map", '      var lines = (c.p.lines || []).map', '歸還申請無聲蓋掉待確認的延期 / 轉借'],
  ['20_logic.gs', "        idx[k] = (idx[k] || 0) + outstanding(ln);", '        idx[k] = (idx[k] || 0) + int(ln.qty);', '展覽已開單量與可借量基準不一致(部分歸還會放掉庫存)'],
  ['20_logic.gs', "        if (sw.status === 'closed' || sw.status === 'cancelled') throw E(", "        if (false) throw E(", '已結案 / 已取消的展覽還能掛新借用單'],
  ['20_logic.gs', "        if (wait) throw E('此展品還有 ' + wait + ' 張待審核的申請,請先處理完再下架');", '', '有待審核申請的展品也能下架'],
  ['00_gateway.gs', "    UNIT_CALC: ['id', 'itemId', 'status', 'location', 'countedAt'],", "    UNIT_CALC: ['id', 'itemId', 'status', 'location'],", '算「該地點最後盤點日」少讀 countedAt'],
  // v2.3:展後結算 / 批次歸還 / 封存到歷史表 —— 這三個都會動到「舊資料還在不在」,守門必須真的守得住
  ['20_logic.gs', "      if (to === 'closed') S.settle = settleShow(c.db, S, today);", '',
   '結案時沒存結算快照(單被封存之後結算數字就歸零)'],
  ['20_logic.gs', "        if (!S.settle || !S.settle.totals) S.settle = settleShow(c.db, S, today);", '',
   '封存時沒補結算快照'],
  ['20_logic.gs', "      c.db.Loans = c.db.Loans.filter(function (L) { return !gone[L.id]; });\n      dirty(c.db, 'Loans');\n      log(c, '封存借用單到歷史表'",
   "      dirty(c.db, 'Loans');\n      log(c, '封存借用單到歷史表'", '封存後沒有從借用單表移除(同一張單會變成兩份)'],
  ['20_logic.gs', "      var fresh = list.filter(function (L) { return !already[L.id]; });", '      var fresh = list;',
   '封存不跳過已經在歷史表裡的單(中斷重跑會產生重複列)'],
  ['20_logic.gs', "      return !!closed[sid];                     // 展覽不存在或還沒結案 → 不搬", '      return true;',
   '展覽還沒結案就把底下的單搬走'],
  ['20_logic.gs', "      if (!sid) return !!includePlain;          // 沒掛展覽的一般單:要另外勾選才搬", '      if (!sid) return true;',
   '沒勾「一般單」也把沒掛展覽的單搬走'],
  ['20_logic.gs', "      if (from === 'closed' && bool(S.archived)) throw E('這場展覽的借用單已經封存到歷史表",
   "      if (false) throw E('這場展覽的借用單已經封存到歷史表", '已封存的展覽還能重新開啟(結算會憑空歸零)'],
  ['20_logic.gs', "      if (bool(S.archived)) throw E('這場展覽的借用單已經封存到歷史表,不能刪除');", '',
   '已封存的展覽還能被刪掉'],
  ['20_logic.gs', "      var used = c.db.Loans.concat(c.db.Hist || []).filter(function (L) {",
   '      var used = c.db.Loans.filter(function (L) {', '刪展品時沒看歷史表(封存後舊單會變成「已刪除」)'],
  ['30_memory.gs', "      if (EXTRA_TABLES.indexOf(key) >= 0) throw fail_(", "      if (false) throw fail_(",
   '歷史表可以被整張寫回(清空到一半就真的沒了)'],
  ['30_memory.gs', "      if (want && (key in want)) {", "      if (true) {",
   '沒點名也把歷史表整張讀進來'],
  ['00_gateway.gs', "    if (!live && p && p.includeHistory) spec.Hist = '*';", '',
   '勾了「含歷史資料」卻沒有把歷史表讀進來'],
  ['00_gateway.gs', "  add('admin', true, A, { deleteItem: ['id'] }, withHist_(C.HIST_USE));",
   "  add('admin', true, A, { deleteItem: ['id'] }, FULL_);", '刪展品的路由沒把歷史表讀進來'],
  ['00_gateway.gs', "  var LOOKUP_ = { Items: '*', Units: '*', Loans: '*', Shows: C.SHOW_CALC, Users: C.USER_AUTH, Hist: C.HIST_UNIT };",
   "  var LOOKUP_ = { Items: '*', Units: '*', Loans: '*', Shows: C.SHOW_CALC, Users: C.USER_AUTH };",
   '掃單台時看不到封存的借用歷程'],
  // v2.4:有多少開多少 / 缺口是誰佔的 / 總清單
  ['20_logic.gs', "        var take = Math.min(v.need, Math.max(0, v.available));", "        var take = v.need;",
   '不管借不借得到都照規劃量硬開單(點交一定對不起來)'],
  ['20_logic.gs', "        if (take <= 0) return;                    // 完全借不到就整行跳過,留在清單上", '',
   '一台都借不到還是塞一行 0 台進借用單'],
  ['20_logic.gs', "      if (q <= 0) return;\n      var o = { id: e.L.id, qty: q, status: e.L.status,", "      var o = { id: e.L.id, qty: q, status: e.L.status,",
   '誰佔住:把已經還完的單也列進去'],
  ['20_logic.gs', "      if (S.status !== 'confirmed' || S.id === excludeShowId) return;\n      if (s(S.from) > to || s(S.to) < from) return;\n      (S.lines || []).forEach(function (ln) {\n        if (s(ln.itemId) !== itemId) return;\n        if (where != null && loc(ln.location) !== loc(where)) return;\n        var q = Math.max(0, int(ln.qty) - (issued[S.id + '|' + lineKey(ln)] || 0));",
   "      if (S.status !== 'confirmed' || S.id === excludeShowId) return;\n      if (s(S.from) > to || s(S.to) < from) return;\n      (S.lines || []).forEach(function (ln) {\n        if (s(ln.itemId) !== itemId) return;\n        if (where != null && loc(ln.location) !== loc(where)) return;\n        var q = int(ln.qty);",
   '誰佔住:展覽已經開成單的那一段被重複列了一次'],
  ['20_logic.gs', "      if (full) { o.applicant = s(e.L.applicant); o.dept = s(e.L.dept); o.event = s(e.L.event); }",
   "      o.applicant = s(e.L.applicant); o.dept = s(e.L.dept); o.event = s(e.L.event);",
   '同仁也看得到別人的借用人姓名'],
  ['20_logic.gs', "    showSheet: function (c) { return showSheet(c.db, showById(c), c.today); },",
   "    showSheet: function (c) { var S = showById(c); if (S.status !== 'confirmed') throw E('x'); return showSheet(c.db, S, c.today); },",
   '總清單要等確認檔期才出得來(備料階段就沒東西可用了)']
  // 註:`doExtend` / `doTransfer` 開頭的狀態檢查是第二層防護。駁回與取消都會把 `L.request` 清掉之後,
  //     已經沒有路徑能帶著待確認的延期請求走到這裡,所以拿掉它測試不會紅(等價突變)。
  //     保留的理由:它擋的是「請求殘留」這一類 bug,而那正是 v2.2 真的發生過的事。
  // 註:拿掉 ITEM_CALC 的 category 也是等價突變 —— 展品表現在的欄序讓它夾在連續段裡會被順便讀到。
  //     但「欄序可以調整」是記憶積木明講的前提,所以宣告還是要寫上去(有人把分類欄搬到最後就會變空白)。
  // 註:單獨拿掉 ITEM_CALC 的 qty 欄是等價突變 —— 讀取會把相鄰欄位合併成連續段(spans_ 的 gap=3),
  //     qty 夾在 mode 與 location 中間,不在清單上也會被順便讀到。真正有效的守門是上面的 stock 欄。
  // 註:`m.cap` 的失效目前沒有路徑會在同一次請求裡「先算總數 → 改 Items/Units → 再算總數」,
  //     所以拿掉它測試也不會失敗(等價突變)。程式碼保留,是為了將來真的出現這種呼叫順序時不會算錯。
];
let pass = 0; const fail = [];
M.forEach(([file, find, repl, desc]) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mut-'));
  fs.readdirSync(path.join(root, 'gas')).forEach(f => fs.copyFileSync(path.join(root, 'gas', f), path.join(dir, f)));
  const src = fs.readFileSync(path.join(dir, file), 'utf8');
  if (!src.includes(find)) { fail.push(desc + '(找不到突變點)'); return; }
  fs.writeFileSync(path.join(dir, file), src.replace(find, repl));
  const r = spawnSync(process.execPath, [path.join(__dirname, 'e2e.test.js')], { env: { ...process.env, GAS_DIR: dir }, encoding: 'utf8' });
  if (r.status !== 0) pass++; else fail.push(desc + '(測試沒有抓到!)');
  fs.rmSync(dir, { recursive: true, force: true });
});
if (fail.length) { console.error('✘ 突變存活:\n  ' + fail.join('\n  ')); process.exit(1); }
console.log('✔ 突變測試 ' + pass + '/' + M.length + ' 皆被擋下');
