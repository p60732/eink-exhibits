// 接線層 / 結構防回歸測試:node tests/structure.test.js
const assert = require('assert'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const gasFiles = fs.readdirSync(path.join(root, 'gas')).filter(f => f.endsWith('.gs'));
const webFiles = ['index.html', 'css/style.css', 'js/connect.js', 'js/ui.js'];
let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { e.message = name + ':' + e.message; throw e; } };

t('公開函式白名單:GAS 頂層函式除白名單外必須以 _ 結尾', () => {
  const allow = ['doGet', 'doPost', 'setupSheets', 'installDailyTrigger', 'dailyReminder', 'authorizeDrive'];
  gasFiles.forEach(f => {
    const names = [...read('gas/' + f).matchAll(/^function\s+([A-Za-z0-9_$]+)\s*\(/gm)].map(m => m[1]);
    names.forEach(nm => assert.ok(allow.includes(nm) || nm.endsWith('_'), `${f}: ${nm}() 會被公開`));
  });
});
t('危險語法:不得使用 eval / new Function', () => {
  [...webFiles, ...gasFiles.map(f => 'gas/' + f)].forEach(f => assert.ok(!/\beval\s*\(|new\s+Function\s*\(/.test(read(f)), f));
});
t('機密掃描:前端不得含 Google 資源 ID、Email、金鑰;頁面不內嵌資料', () => {
  webFiles.forEach(f => {
    const s = read(f);
    assert.ok(!/docs\.google\.com\/spreadsheets\/d\/|script\.google\.com\/macros\/s\/|AKfyc[\w-]{20,}/.test(s), f + ' 含 Google 資源網址');
    assert.ok(!/[\w.+-]+@(?!example\.com)[\w-]+\.[\w.]+/i.test(s.replace(/html5-qrcode@[\d.]+/g, '')), f + ' 含 Email');
    assert.ok(!/(api[_-]?key|secret|password)\s*[:=]\s*['"][^'"]{6,}/i.test(s), f + ' 疑似金鑰');
  });
  assert.ok(/GAS_URL:\s*'__GAS_URL__'/.test(read('js/connect.js')), '原始碼 GAS_URL 必須是佔位符,由建置腳本注入');
});
t('展示積木不重寫規則:前端不得出現庫存/可借量計算', () => {
  const ui = read('js/ui.js');
  ['availableInRange', 'reservedInRange', 'capacity(', 'outstanding(', 'SpreadsheetApp', 'pinHash', 'sha256'].forEach(k => assert.ok(!ui.includes(k), 'ui.js 含 ' + k));
});
t('輸出跳脫:使用者可輸入的欄位插入 HTML 前必須經過 esc()', () => {
  const ui = read('js/ui.js');
  const risky = /\.(name|event|note|dept|email|location|spec|category|serial|empNo|applicant|contact|venue|purpose|image|detail|reviewNote|reviewer|by|reason|user|action|ref|at|outAt|returnedAt|start|end|countedAt|ts)\b/;
  const bad = [];
  for (const m of ui.matchAll(/\$\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
    const expr = m[1].trim();
    if (!risky.test(expr)) continue;
    if (/^esc\(/.test(expr) || /^fmtD\(/.test(expr)) continue;
    // 允許:條件式中每個使用者欄位都被 esc 包住
    const stripped = expr.replace(/^[^?`]*\?/, '').replace(/\.has\([^)]*\)/g, '').replace(/\.length\b/g, '').replace(/esc\((?:[^()]|\([^()]*\))*\)/g, '').replace(/fmtD\([^()]*\)/g, '');
    if (risky.test(stripped.replace(/`[^`]*`/g, ''))) bad.push(expr.slice(0, 80));
  }
  assert.deepStrictEqual(bad, []);
});
t('連線積木:統一回應格式 success/data/error', () => {
  assert.ok(/j\.success !== true/.test(read('js/connect.js')));
  assert.ok(/success: true, data: data, error: null/.test(read('gas/00_gateway.gs')));
});
t('路由:每個動作都有欄位白名單', () => {
  const s = read('gas/00_gateway.gs');
  assert.ok(/checkPayload_\(req\.payload, route\.fields, route\.big\)/.test(s));
});
t('積木檔頭:每個檔案宣告所屬積木與禁止事項', () => {
  [...gasFiles.map(f => 'gas/' + f), 'js/connect.js', 'js/ui.js'].forEach(f => { const s = read(f); assert.ok(/【.+積木】/.test(s) && /禁止/.test(s), f); });
});
console.log('✔ 結構檢查 ' + n + ' 項通過');
