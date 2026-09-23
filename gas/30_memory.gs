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
  var SHEET_NAMES = { Cats: '分類', Items: '展品', Units: '單台編號', Loans: '借用單', Users: '使用者', Logs: '操作紀錄' };
  var SCHEMA = {
    Cats: ['id', 'name', 'sort', 'archived', 'updatedAt'],
    Items: ['id', 'name', 'category', 'mode', 'qty', 'location', 'spec', 'note', 'image', 'archived', 'countedAt', 'updatedAt'],
    Units: ['id', 'itemId', 'serial', 'status', 'location', 'note', 'countedAt', 'updatedAt'],
    Loans: ['id', 'applicant', 'applicantId', 'dept', 'contact', 'event', 'venue', 'purpose', 'start', 'end', 'status', 'lines',
      'createdBy', 'createdAt', 'reviewer', 'reviewedAt', 'reviewNote', 'outAt', 'returnedAt', 'note', 'request'],
    Users: ['id', 'empNo', 'name', 'dept', 'email', 'role', 'pinHash', 'mustChange', 'sessionVer', 'active', 'createdAt'],
    Logs: ['ts', 'user', 'action', 'ref', 'detail']
  };
  var JSON_FIELDS = { Loans: { lines: [], request: null } };   // 欄位 → 空值預設
  var TABLES = ['Cats', 'Items', 'Units', 'Loans', 'Users'];
  // 分類第一次建立時先放進來的七類(之後可在畫面上自行新增 / 改名 / 調順序)
  var SEED = { Cats: ['eReader', 'eNote', 'Logistics & Factory', 'Prism', 'Signage', 'Lifestyle', 'Mobile & Wearables'] };

  function ss_() {
    var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet();
  }
  function sheet_(key) {
    var ss = ss_(), sh = ss.getSheetByName(SHEET_NAMES[key]);
    if (!sh) {
      sh = ss.insertSheet(SHEET_NAMES[key]);
      var head = SCHEMA[key];
      sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
      sh.setFrozenRows(1);
      sh.getRange(1, 1, sh.getMaxRows(), head.length).setNumberFormat('@');
      if (SEED[key]) {
        var seed = SEED[key].map(function (n, i) { return ['C' + ('000' + (i + 1)).slice(-4), n, String((i + 1) * 10), 'FALSE', '']; });
        sh.getRange(2, 1, seed.length, head.length).setValues(seed);
      }
    }
    return sh;
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
    if (cached) return cached;
    var sh = sheet_(key), lastCol = Math.max(1, sh.getLastColumn());
    var head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
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
          if (!head) head = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
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
    var want = want_(spec), db = {}, loaded = [];
    TABLES.forEach(function (key) {
      if (want && !(key in want)) { db[key] = []; return; }
      db[key] = want ? readTable_(key, want[key].cols, want[key].only) : readTable_(key, null, null);
      loaded.push(key);
    });
    db._dirty = {}; db._newLogs = []; db._loaded = loaded;
    return db;
  }

  /** 寫回有變動的資料表,並附加新的操作紀錄 */
  function save(db) {
    Object.keys(db._dirty || {}).forEach(function (key) {
      var sh = sheet_(key), head = SCHEMA[key], jf = JSON_FIELDS[key] || {};
      var rows = db[key].map(function (o) {
        return head.map(function (h) {
          var v = o[h];
          if (h in jf) return v == null ? '' : JSON.stringify(v);
          if (v === true) return 'TRUE';
          if (v === false) return 'FALSE';
          return v == null ? '' : String(v);
        });
      });
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
    if (last < 2) return [];
    var from = Math.max(2, last - limit + 1);
    return sh.getRange(from, 1, last - from + 1, head.length).getValues().map(function (r) {
      var o = {}; head.forEach(function (h, i) { o[h] = cellOut_(r[i]); }); return o;
    }).reverse();
  }

  /** 建立所有工作表並移除空白預設工作表 */
  function setup() {
    Object.keys(SHEET_NAMES).forEach(sheet_);
    var ss = ss_(), def = ss.getSheetByName('工作表1') || ss.getSheetByName('Sheet1');
    if (def && def.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(def);
    return Object.keys(SHEET_NAMES).map(function (k) { return SHEET_NAMES[k]; });
  }

  return { SCHEMA: SCHEMA, load: load, save: save, readLogs: readLogs, setup: setup };
})();
