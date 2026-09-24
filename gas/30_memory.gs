/**
 * 【記憶積木】30_memory.gs
 * 輸入:邏輯積木(經守門調度交付)的讀寫指令
 * 責任:Google Sheets 的結構定義(工作表、欄位)與存取;只讀取這次請求需要的工作表,
 *       並用 CacheService 快取(寫入時以版本號失效)以加快讀取
 * 輸出:原始資料列(物件陣列)
 * 禁止:不做業務判斷;試算表內不寫公式當邏輯
 */
var Memory = (function () {
  var TZ = 'Asia/Taipei';
  var SHEET_NAMES = { Cats: '分類', Items: '展品', Units: '單台編號', Loans: '借用單', Hist: '借用單歷史', Shows: '展覽', Users: '使用者', Logs: '操作紀錄' };
  var SCHEMA = {
    Cats: ['id', 'name', 'sort', 'archived', 'updatedAt'],
    Items: ['id', 'name', 'category', 'mode', 'qty', 'location', 'stock', 'spec', 'note', 'image', 'archived', 'countedAt', 'updatedAt'],
    Units: ['id', 'itemId', 'serial', 'status', 'location', 'note', 'countedAt', 'updatedAt'],
    Loans: ['id', 'applicant', 'applicantId', 'dept', 'contact', 'event', 'venue', 'purpose', 'start', 'end', 'status', 'lines',
      'createdBy', 'createdAt', 'reviewer', 'reviewedAt', 'reviewNote', 'outAt', 'returnedAt', 'note', 'request', 'showId'],
    Shows: ['id', 'name', 'from', 'to', 'venue', 'owner', 'status', 'lines', 'note', 'settle', 'archived', 'createdBy', 'createdAt', 'updatedAt'],
    Users: ['id', 'empNo', 'name', 'dept', 'email', 'role', 'pinHash', 'mustChange', 'sessionVer', 'active', 'createdAt'],
    Logs: ['ts', 'user', 'action', 'ref', 'detail']
  };
  // 歷史表跟借用單同一組欄位:搬過去的列原封不動,之後要查才不用做欄位對照
  SCHEMA.Hist = SCHEMA.Loans.slice();
  // stock:數量型展品的各地點庫存 {"新竹":{"數量":3,"盤點":"2026-09-23"}};qty 與 countedAt 由後端回填
  var JSON_FIELDS = { Loans: { lines: [], request: null }, Hist: { lines: [], request: null }, Items: { stock: {} }, Shows: { lines: [], settle: null } };   // 欄位 → 空值預設
  var TABLES = ['Cats', 'Items', 'Units', 'Loans', 'Shows', 'Users'];
  /**
   * 只有明確點名才會讀的表。歷史表會是整個試算表最大的一張,
   * 放進 TABLES 的話,每一個「寫入類路由一律全載」的動作都會順便把它整張讀進來 ——
   * 那就完全抵消掉搬歷史的意義了。
   */
  var EXTRA_TABLES = ['Hist'];
  // 分類第一次建立時先放進來的七類(之後可在畫面上自行新增 / 改名 / 調順序)
  var SEED = { Cats: ['eReader', 'eNote', 'Logistics & Factory', 'Prism', 'Signage', 'Lifestyle', 'Mobile & Wearables'] };

  /**
   * 每張表一定要有的欄位。開起來的試算表對不上就停下 ——
   * 這是用來擋「指到了別的試算表」或「工作表被覆蓋掉」的,不是用來檢查欄位齊不齊
   * (SCHEMA 新增欄位時,舊試算表還沒有那一欄是正常的,讀進來補空值即可)。
   */
  var MUST_HAVE = {
    Cats: ['id', 'name'], Items: ['id', 'name'], Units: ['id', 'itemId'],
    Loans: ['id', 'status'], Hist: ['id', 'status'], Shows: ['id', 'name'], Users: ['id', 'empNo'], Logs: ['ts', 'action']
  };
  /**
   * 資料守門的錯誤:標成 userFacing,讓訊息原封不動送到畫面上。
   * 這種錯的重點就是「讓人知道發生什麼、不要自己亂修」,顯示成「操作失敗,請稍後再試」
   * 反而會害人以為是網路問題,然後跑去重新初始化 —— 那才是真的會把資料弄掉。
   * 訊息裡不放試算表 ID 之類的資源識別碼。
   */
  function fail_(msg) { var e = new Error(msg); e.userFacing = true; e.dataGuard = true; return e; }

  function ss_() {
    var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    var ss;
    try { ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet(); }
    catch (e) { throw fail_('開不起來指定的試算表。請確認檔案還在、沒有被丟到垃圾桶,權限也沒有被改掉(設定在指令碼屬性 SHEET_ID)。'); }
    if (!ss) throw fail_('找不到要用的試算表。請在專案設定裡設好指令碼屬性 SHEET_ID。');
    return ss;
  }

  /**
   * 找工作表。**找不到就報錯,絕對不自動建立。**
   * 自動建立加上塞預設值,會把「工作表被改名 / 被刪 / 開到別的試算表」這種異常,
   * 偽裝成一個看起來正常的空系統 —— 使用者會以為資料被刪光了,其實原檔還在別的地方。
   * 建立與塞種子只發生在人工執行的 setupSheets()。
   */
  function sheet_(key) {
    var sh = ss_().getSheetByName(SHEET_NAMES[key]);
    if (!sh) throw fail_('找不到工作表「' + SHEET_NAMES[key] + '」。系統不會自動幫你重建(重建等於把資料清空)。'
      + '請先確認是不是開錯試算表、或工作表被改名 / 刪掉;確定要從零開始時,才在編輯器執行一次 setupSheets()。');
    return sh;
  }
  /** 只有 setupSheets() 會呼叫:建立工作表、寫表頭、第一次建立分類時塞入預設七類 */
  function create_(key) {
    var ss = ss_();
    if (ss.getSheetByName(SHEET_NAMES[key])) return ss.getSheetByName(SHEET_NAMES[key]);
    var sh = ss.insertSheet(SHEET_NAMES[key]), head = SCHEMA[key];
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), head.length).setNumberFormat('@');
    if (SEED[key]) {
      var seed = SEED[key].map(function (n, i) { return ['C' + ('000' + (i + 1)).slice(-4), n, String((i + 1) * 10), 'FALSE', '']; });
      sh.getRange(2, 1, seed.length, head.length).setValues(seed);
    }
    return sh;
  }
  /** 表頭對不上就停:寧可整個功能壞掉,也不要把錯的資料當成對的用 */
  function checkHead_(key, head) {
    var miss = (MUST_HAVE[key] || []).filter(function (h) { return head.indexOf(h) < 0; });
    if (miss.length) throw fail_('工作表「' + SHEET_NAMES[key] + '」的標題列缺少 ' + miss.join('、')
      + ',看起來不是這個系統的資料表。為了避免寫壞資料已經停下來,請確認是不是開到別的試算表。');
    return head;
  }
  function cellOut_(v) {
    if (v instanceof Date) {
      var hasTime = v.getHours() || v.getMinutes();
      return Utilities.formatDate(v, TZ, hasTime ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd');
    }
    return v === '' || v == null ? '' : v;
  }
  function empty_(key, h) { var jf = JSON_FIELDS[key] || {}; return h in jf ? JSON.parse(JSON.stringify(jf[h])) : ''; }

  /* ---- 快取:每張表一份,版本號變更即失效(上限 100KB 的表才快取) ---- */
  var CACHE_SEC = 300;
  function version_() {
    var p = PropertiesService.getScriptProperties(), v = p.getProperty('DBVER');
    if (!v) { v = '1'; p.setProperty('DBVER', v); }
    return v;
  }
  function bumpVersion_() {
    var p = PropertiesService.getScriptProperties();
    p.setProperty('DBVER', String((+p.getProperty('DBVER') || 1) + 1));
  }
  function cacheGet_(key) {
    try { var raw = CacheService.getScriptCache().get(key + ':' + version_()); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function cachePut_(key, rows) {
    try {
      var raw = JSON.stringify(rows);
      if (raw.length < 95000) CacheService.getScriptCache().put(key + ':' + version_(), raw, CACHE_SEC);
    } catch (e) { /* 快取失敗不影響正確性 */ }
  }

  /** 表頭(欄名 → 位置)。只讀第 1 列,並隨 DBVER 一起快取 */
  function head_(key) {
    var ck = key + '#head', cached = cacheGet_(ck);
    if (cached) return checkHead_(key, cached);
    var sh = sheet_(key), lastCol = Math.max(1, sh.getLastColumn());
    var head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
    checkHead_(key, head);
    cachePut_(ck, head);
    return head;
  }

  /** 把要讀的欄位位置合併成少數幾段連續範圍:少一次往返通常比多讀幾格划算 */
  function spans_(idx, gap) {
    var a = idx.slice().sort(function (x, y) { return x - y; }), out = [];
    a.forEach(function (i) {
      var last = out[out.length - 1];
      if (last && i - last[1] <= gap + 1) last[1] = i; else out.push([i, i]);
    });
    return out;
  }

  /** 把儲存格轉成物件列;head 與 cells 的欄位位置一致,未讀到的欄位補空值 */
  function toRows_(key, head, cells) {
    var jf = JSON_FIELDS[key] || {}, rows = [];
    cells.forEach(function (r) {
      var o = {};
      head.forEach(function (h, i) {
        if (!h || !(i in r)) return;
        var v = cellOut_(r[i]);
        if (h in jf) { try { v = v ? JSON.parse(v) : empty_(key, h); } catch (e) { v = empty_(key, h); } }
        o[h] = v;
      });
      o.id = String(o.id || '');
      if (!o.id) return;                       // 沒有 id 的列視為空白列
      SCHEMA[key].forEach(function (h) { if (!(h in o)) o[h] = empty_(key, h); });
      if (key === 'Users') o.empNo = String(o.empNo || '').trim();
      rows.push(o);
    });
    return rows;
  }

  /**
   * 只要「還沒結案」的列時,先單獨讀那一欄,找出第一筆符合的位置,之後只讀這一段到最後。
   * 借用單是往後累加的,已歸還的舊單通常集中在前面,這一刀常常可以少讀大半張表。
   * 找不到符合的列就完全不用讀;最舊的一筆仍符合時就退回整段讀,結果一樣正確。
   */
  function firstRowOf_(sh, last, head, only) {
    var col = head.indexOf(only.field);
    if (col < 0) return 0;
    var vals = sh.getRange(2, col + 1, last - 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) {
      if (only.values.indexOf(String(vals[i][0]).trim()) >= 0) return i;
    }
    return -1;                                   // 沒有任何一列符合
  }

  /** 讀一張表:cols 省略時讀全部欄位;快取依「欄位組合 + 條件」分開存 */
  function readTable_(key, cols, only) {
    var sig = (cols ? cols.slice().sort().join(',') : '*') + (only ? '|' + only.field + '=' + only.values.join('+') : '');
    var ck = key + '#' + sig, cached = cacheGet_(ck);
    if (cached) return cached;
    var sh = sheet_(key), last = sh.getLastRow(), rows = [];
    if (last > 1) {
      var head = (cols || only) ? head_(key) : null, from = 0;
      if (only) {
        from = firstRowOf_(sh, last, head, only);
        if (from < 0) { cachePut_(ck, rows); return rows; }
      }
      var n = last - 1 - from;
      if (n > 0) {
        var idx = [];
        if (cols) cols.forEach(function (f) { var i = head.indexOf(f); if (i >= 0 && idx.indexOf(i) < 0) idx.push(i); });
        // 需要的欄位超過七成就整列讀,省下拆段的往返
        if (cols && (!idx.length || idx.length * 10 >= head.length * 7)) cols = null;
        if (cols) {
          var cells = [];
          spans_(idx, 3).forEach(function (sp) {
            sh.getRange(2 + from, sp[0] + 1, n, sp[1] - sp[0] + 1).getValues().forEach(function (row, r) {
              cells[r] = cells[r] || [];
              row.forEach(function (v, j) { cells[r][sp[0] + j] = v; });
            });
          });
          rows = toRows_(key, head, cells);
        } else {
          var lastCol = Math.max(1, sh.getLastColumn());
          if (!head) head = checkHead_(key, sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }));
          rows = toRows_(key, head, sh.getRange(2 + from, 1, n, lastCol).getValues());
        }
      }
    }
    cachePut_(ck, rows);
    return rows;
  }

  /**
   * 把路由給的讀取需求正規化成 { 表名: { cols: null(整張)|[欄位], only: null|{field,values} } }
   * 接受:省略(全部)、['Items','Loans'](這幾張的全部欄位)、
   *       { Items: '*', Loans: [...] } 或 { Loans: { cols: '*', only: { field: 'status', values: [...] } } }
   */
  function want_(spec) {
    if (!spec) return null;
    var out = {};
    if (Object.prototype.toString.call(spec) === '[object Array]') {
      if (!spec.length) return null;
      spec.forEach(function (k) { out[k] = { cols: null, only: null }; });
      return out;
    }
    Object.keys(spec).forEach(function (k) {
      var v = spec[k], cols = v, only = null;
      if (v && !Array.isArray(v) && typeof v === 'object') { cols = v.cols; only = v.only || null; }
      if (cols === '*' || cols == null) cols = null;
      else {
        cols = cols.slice();
        if (cols.indexOf('id') < 0) cols.push('id');          // id 一定要讀,否則無法辨識列
        if (only && cols.indexOf(only.field) < 0) cols.push(only.field);
      }
      out[k] = { cols: cols, only: only };
    });
    return out;
  }

  /** 讀取資料表(依表頭名稱對應,欄位順序可調整)。spec 省略時讀全部 */
  function load(spec) {
    var want = want_(spec), db = {}, full = {};
    TABLES.forEach(function (key) {
      // 沒被要求的表給空陣列;它「不是完整的」,所以之後不可能被寫回(見 save 的檢查)
      if (want && !(key in want)) { db[key] = []; full[key] = false; return; }
      var w = want ? want[key] : { cols: null, only: null };
      db[key] = readTable_(key, w.cols, w.only);
      full[key] = !w.cols && !w.only;          // 欄位與列都沒限縮,才算完整
    });
    // 額外的表(歷史)只有被點名時才讀。沒點名就給空陣列且標成「不完整」,
    // 所以就算哪天有人不小心 dirty 了它,save() 也會先擋下來。
    EXTRA_TABLES.forEach(function (key) {
      if (want && (key in want)) {
        var w = want[key];
        db[key] = readTable_(key, w.cols, w.only);
        full[key] = !w.cols && !w.only;
      } else { db[key] = []; full[key] = false; }
    });
    db._dirty = {}; db._newLogs = []; db._full = full;
    return db;
  }

  /** 一列物件 → 一列儲存格文字(save 與 appendHist 共用,兩邊的寫法一定要一樣) */
  function toCells_(key, o) {
    var head = SCHEMA[key], jf = JSON_FIELDS[key] || {};
    return head.map(function (h) {
      var v = o[h];
      if (h in jf) return v == null ? '' : JSON.stringify(v);
      if (v === true) return 'TRUE';
      if (v === false) return 'FALSE';
      return v == null ? '' : String(v);
    });
  }

  /**
   * 把借用單附加到歷史表。**只附加,永遠不整張重寫** ——
   * 重寫是「先清空再寫」,歷史表是唯一一張「清空了就真的沒有別的地方還有」的表。
   * 附加失敗會直接丟出例外,呼叫端因此不會走到「從借用單表刪掉」那一步。
   */
  function appendHist(rows) {
    if (!rows || !rows.length) return 0;
    var sh = sheet_('Hist'), head = SCHEMA.Hist;
    head_('Hist');                                   // 先驗表頭,對不上就停
    var rg = sh.getRange(sh.getLastRow() + 1, 1, rows.length, head.length);
    rg.setNumberFormat('@');
    rg.setValues(rows.map(function (o) { return toCells_('Hist', o); }));
    SpreadsheetApp.flush();                          // 確定真的寫進去了,再讓呼叫端去刪原本那幾列
    bumpVersion_();
    return rows.length;
  }

  /** 寫回有變動的資料表,並附加新的操作紀錄 */
  function save(db) {
    /**
     * 寫回是「整張清空再重寫」,所以只要這次不是完整讀進來的,寫回就會把沒讀到的欄位或列清掉。
     * 這種事不會報錯、只會靜靜少資料,所以在這裡擋死:**先把所有要寫的表檢查過一遍,再動手寫**,
     * 免得寫到一半才發現問題。守門積木的規則是「寫入類路由一律完整載入」,這裡是那條規則的保險絲。
     */
    var full = db._full || {};
    Object.keys(db._dirty || {}).forEach(function (key) {
      if (EXTRA_TABLES.indexOf(key) >= 0) throw fail_('「' + SHEET_NAMES[key] + '」只能附加,不可以整張寫回。'
        + '這張表是舊資料唯一的存放處,整張重寫等於先清空 —— 清到一半斷掉就真的沒了。');
      if (!full[key]) throw fail_('「' + SHEET_NAMES[key] + '」這次只讀了一部分,不可以整張寫回(會清掉沒讀到的資料)。'
        + '請把這個動作的路由改成完整載入這張表。');
    });
    Object.keys(db._dirty || {}).forEach(function (key) {
      var sh = sheet_(key), head = SCHEMA[key];
      var rows = db[key].map(function (o) { return toCells_(key, o); });
      var last = sh.getLastRow(), lastCol = Math.max(sh.getLastColumn(), head.length);
      if (last > 0) sh.getRange(1, 1, last, lastCol).clearContent();
      var all = [head].concat(rows), rg = sh.getRange(1, 1, all.length, head.length);
      rg.setNumberFormat('@');
      rg.setValues(all);
      sh.getRange(1, 1, 1, head.length).setFontWeight('bold');
    });
    if (Object.keys(db._dirty || {}).length) bumpVersion_();
    var logs = db._newLogs || [];
    if (logs.length) {
      var sh = sheet_('Logs'), head = SCHEMA.Logs;
      var rg = sh.getRange(sh.getLastRow() + 1, 1, logs.length, head.length);
      rg.setNumberFormat('@');
      rg.setValues(logs.map(function (l) { return head.map(function (h) { return String(l[h] == null ? '' : l[h]); }); }));
    }
  }

  function readLogs(limit) {
    var sh = sheet_('Logs'), head = SCHEMA.Logs, last = sh.getLastRow();
    if (last >= 1) checkHead_('Logs', sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(function (h) { return String(h).trim(); }));
    if (last < 2) return [];
    var from = Math.max(2, last - limit + 1);
    return sh.getRange(from, 1, last - from + 1, head.length).getValues().map(function (r) {
      var o = {}; head.forEach(function (h, i) { o[h] = cellOut_(r[i]); }); return o;
    }).reverse();
  }

  /**
   * 升級用:只建立這個版本新增的工作表,核心表缺了照樣報錯。
   * 跟 setup() 分開是因為 setup() 會把「工作表被改名 / 開錯試算表」當成「還沒建立」,
   * 在那種情況下跑 setup() 會生出一張空表,讓人以為資料真的沒了。升級只該補新的。
   */
  var NEW_SHEETS = ['Shows', 'Hist'];
  function upgrade() {
    var ss = ss_(), made = [];
    Object.keys(SHEET_NAMES).forEach(function (key) {
      if (NEW_SHEETS.indexOf(key) >= 0) return;
      if (!ss.getSheetByName(SHEET_NAMES[key])) throw fail_('找不到工作表「' + SHEET_NAMES[key] + '」。'
        + '升級不會幫你重建核心資料表(重建等於把資料清空)。請先確認是不是開錯試算表、或工作表被改名。');
    });
    NEW_SHEETS.forEach(function (key) {
      if (ss.getSheetByName(SHEET_NAMES[key])) return;
      create_(key); made.push(SHEET_NAMES[key]);
    });
    return made;
  }

  /** 建立所有工作表並移除空白預設工作表 */
  function setup() {
    Object.keys(SHEET_NAMES).forEach(create_);
    var ss = ss_(), def = ss.getSheetByName('工作表1') || ss.getSheetByName('Sheet1');
    if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);
    return Object.keys(SHEET_NAMES).map(function (k) { return SHEET_NAMES[k]; });
  }

  return { SCHEMA: SCHEMA, load: load, save: save, appendHist: appendHist, readLogs: readLogs, setup: setup, upgrade: upgrade };
})();
