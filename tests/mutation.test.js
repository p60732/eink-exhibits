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
  ['00_gateway.gs', "ITEM_CALC: ['id', 'name', 'mode', 'qty', 'location', 'stock', 'archived']", "ITEM_CALC: ['id', 'name', 'mode', 'qty', 'archived']", '展品少讀各地點庫存(stock)欄'],
  ['00_gateway.gs', "UNIT_CALC: ['id', 'itemId', 'status', 'location']", "UNIT_CALC: ['id', 'itemId', 'status']", '單台少讀地點欄'],
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
  ['20_logic.gs', "if (t === 'Loans') m.li = null;", '', '借用單索引沒隨資料更新'],
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
  ['00_gateway.gs', "success: false, health: true", "success: true, health: false", '健康檢查頁偽裝成正常回應(換版時會被當成資料)']
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
