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
  var SHEET_NAMES = { Items: '展品', Units: '單台編號', Loans: '借用單', Users: '使用者', Logs: '操作紀錄' };
  var SCHEMA = {
    Items: ['id', 'name', 'category', 'mode', 'qty', 'location', 'spec', 'note', 'image', 'archived', 'countedAt', 'updatedAt'],
    Units: ['id', 'itemId', 'serial', 'status', 'location', 'note', 'countedAt', 'updatedAt'],
    Loans: ['id', 'applicant', 'applicantId', 'dept', 'contact', 'event', 'venue', 'purpose', 'start', 'end', 'status', 'lines',
      'createdBy', 'createdAt', 'reviewer', 'reviewedAt', 'reviewNote', 'outAt', 'returnedAt', 'note', 'request'],
    Users: ['id', 'empNo', 'name', 'dept', 'email', 'role', 'pinHash', 'mustChange', 'sessionVer', 'active', 'createdAt'],
    Logs: ['ts', 'user', 'action', 'ref', 'detail']
  };
  var JSON_FIELDS = { Loans: { lines: [], request: null } };   // 欄位 → 空值預設
  var TABLES = ['Items', 'Units', 'Loans', 'Users'];

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

  function readTable_(key) {
    var cached = cacheGet_(key);
    if (cached) return cached;
    var sh = sheet_(key), jf = JSON_FIELDS[key] || {}, rows = [];
    var last = sh.getLastRow(), lastCol = Math.max(1, sh.getLastColumn());
    if (last > 1) {
      var vals = sh.getRange(1, 1, last, lastCol).getValues();
      var head = vals[0].map(function (h) { return String(h).trim(); });
      vals.slice(1).forEach(function (r) {
        if (r.join('') === '') return;
        var o = {};
        head.forEach(function (h, i) {
          if (!h) return;
          var v = cellOut_(r[i]);
          if (h in jf) { try { v = v ? JSON.parse(v) : empty_(key, h); } catch (e) { v = empty_(key, h); } }
          o[h] = v;
        });
        SCHEMA[key].forEach(function (h) { if (!(h in o)) o[h] = empty_(key, h); });
        o.id = String(o.id || '');
        if (key === 'Users') o.empNo = String(o.empNo || '').trim();
        rows.push(o);
      });
    }
    cachePut_(key, rows);
    return rows;
  }

  /** 讀取資料表(依表頭名稱對應,欄位順序可調整)。tables 省略時讀全部 */
  function load(tables) {
    var want = tables && tables.length ? tables : TABLES;
    var db = {};
    TABLES.forEach(function (key) { db[key] = want.indexOf(key) >= 0 ? readTable_(key) : []; });
    db._dirty = {}; db._newLogs = []; db._loaded = want.slice();
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
