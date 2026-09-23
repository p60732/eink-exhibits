// 以 Node 模擬 Google Apps Script 執行環境,載入 gas/*.gs 做端到端測試
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto');

function makeEnv(opts = {}) {
  const clock = { today: opts.today || '2026-09-22' };
  const sheets = {}, props = {}, cache = {}, mails = [];
  class Sheet {
    constructor(n) { this.name = n; this.data = []; }
    getLastRow() { let n = this.data.length; while (n && this.data[n - 1].every(v => v === '')) n--; return n; }
    getLastColumn() { return Math.max(0, ...this.data.map(r => r.length)); }
    getMaxRows() { return 1000; }
    setFrozenRows() { }
    getRange(r, c, nr, nc) {
      const sh = this;
      return {
        setValues(v) { v.forEach((row, i) => { sh.data[r - 1 + i] = sh.data[r - 1 + i] || []; row.forEach((x, j) => sh.data[r - 1 + i][c - 1 + j] = x); }); return this; },
        getValues() { const o = []; for (let i = 0; i < nr; i++) { const row = sh.data[r - 1 + i] || []; o.push(Array.from({ length: nc }, (_, j) => row[c - 1 + j] ?? '')); } return o; },
        clearContent() { for (let i = 0; i < nr; i++) if (sh.data[r - 1 + i]) sh.data[r - 1 + i] = sh.data[r - 1 + i].map(() => ''); return this; },
        setFontWeight() { return this; }, setNumberFormat() { return this; }
      };
    }
  }
  const SS = { getSheetByName: n => sheets[n], insertSheet: n => (sheets[n] = new Sheet(n)), getSheets: () => Object.values(sheets), deleteSheet() { } };
  const ctx = {
    console: { log() { }, error: (...a) => opts.verbose && console.error(...a) },
    Date, JSON, Math, Object, Array, String, Number, isFinite, parseInt, Error, RegExp,
    SpreadsheetApp: { getActiveSpreadsheet: () => SS, openById: () => SS },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] ?? null, put: (k, v) => { cache[k] = v; }, remove: k => { delete cache[k]; } }) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() { } }) },
    ContentService: { createTextOutput: t => ({ t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    Session: { getActiveUser: () => ({ getEmail: () => opts.activeUser ?? 'owner@x.com' }), getEffectiveUser: () => ({ getEmail: () => 'owner@x.com' }) },
    MailApp: { sendEmail: m => mails.push(m) },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased() { return this; }, everyDays() { return this; }, atHour() { return this; }, nearMinute() { return this; }, inTimezone() { return this; }, create() { } }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, str) => Array.from(crypto.createHash('sha256').update(str, 'utf8').digest()).map(b => b > 127 ? b - 256 : b),
      getUuid: () => crypto.randomUUID(),
      formatDate: (d, tz, f) => f.length > 10 ? clock.today + ' 10:00' : clock.today
    }
  };
  vm.createContext(ctx);
  const dir = opts.gasDir || process.env.GAS_DIR || path.join(__dirname, '..', 'gas');
  fs.readdirSync(dir).filter(f => f.endsWith('.gs')).sort().forEach(f => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f }));
  const call = (action, payload, token) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ action, payload, token }) } }).t);
  return { ctx, call, sheets, mails, clock, props };
}
module.exports = { makeEnv };
