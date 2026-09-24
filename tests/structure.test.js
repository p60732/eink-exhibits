// 接線層 / 結構防回歸測試:node tests/structure.test.js
const assert = require('assert'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
const gasFiles = fs.readdirSync(path.join(root, 'gas')).filter(f => f.endsWith('.gs'));
const webFiles = ['index.html', 'css/style.css', 'js/connect.js', 'js/ui.js'];
let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { e.message = name + ':' + e.message; throw e; } };

t('公開函式白名單:GAS 頂層函式除白名單外必須以 _ 結尾', () => {
  const allow = ['doGet', 'doPost', 'setupSheets', 'installDailyTrigger', 'dailyReminder', 'authorizeDrive',
    'installBackupTrigger', 'dailyBackup', 'upgradeSheets'];
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
t('連線積木:健康檢查頁不可以被當成資料(GAS 換版時 POST 會被當成 GET)', () => {
  const c = read('js/connect.js');
  assert.ok(/health === true/.test(c), 'connect.js 要認得 health 記號');
  assert.ok(/API 運作中|健康檢查/.test(c), 'connect.js 也要擋掉舊版沒有記號的健康檢查頁');
  assert.ok(/check_\(await once\(/.test(c), '兩次嘗試都要經過檢查');
  assert.ok(/health: true/.test(read('gas/00_gateway.gs')), 'doGet 要帶 health 記號');
});
t('路由:每個動作都有欄位白名單', () => {
  const s = read('gas/00_gateway.gs');
  assert.ok(/checkPayload_\(req\.payload, route\.fields, route\.big\)/.test(s));
});
t('連線積木的 READ 名單要跟後端的寫入旗標一致', () => {
  // 名單漏了讀取路由 → 換版那幾秒不會自動重試;誤放了寫入路由 → 寫完快取不會失效,畫面顯示舊資料
  const { makeEnv } = require('./fake-gas');
  const R = makeEnv().ctx.routes_();
  const named = read('js/connect.js').match(/const READ = new Set\(\[([^\]]*)\]/);
  assert.ok(named, 'connect.js 要有 READ 名單');
  const listed = new Set(named[1].split(',').map(x => x.trim().replace(/^'|'$/g, '')).filter(Boolean));
  // 刻意不自動重試的兩個:login 重試會多吃一次 PIN 錯誤次數;uploadImage 重試會在雲端硬碟多出一張照片
  const noRetry = ['login', 'uploadImage'];
  const missing = Object.keys(R).filter(k => !R[k].write && !listed.has(k) && noRetry.indexOf(k) < 0);
  const extra = [...listed].filter(k => R[k] && R[k].write);
  assert.deepStrictEqual(missing, [], '讀取路由沒列進 READ:' + missing.join('、'));
  assert.deepStrictEqual(extra, [], '寫入路由不可以列進 READ:' + extra.join('、'));
});
t('歷史工作表只能附加,不可以整張寫回', () => {
  const m = read('gas/30_memory.gs');
  assert.ok(/EXTRA_TABLES\.indexOf\(key\) >= 0\) throw fail_/.test(m), 'save() 要擋掉歷史表的整張寫回');
  assert.ok(/function appendHist/.test(m) && /SpreadsheetApp\.flush\(\)/.test(m), '附加之後要 flush,確定真的寫進去再讓呼叫端刪原本那幾列');
  const g = read('gas/20_logic.gs');
  const fn = g.slice(g.indexOf('archiveLoans: function'), g.indexOf('批次延期:展期往後延時'));
  assert.ok(fn.indexOf('c.appendHist(fresh)') < fn.indexOf('c.db.Loans = c.db.Loans.filter'),
    '★ 一定要先附加到歷史表,成功了才可以從借用單表移除(順序反了會掉單)');
});
t('積木檔頭:每個檔案宣告所屬積木與禁止事項', () => {
  [...gasFiles.map(f => 'gas/' + f), 'js/connect.js', 'js/ui.js'].forEach(f => { const s = read(f); assert.ok(/【.+積木】/.test(s) && /禁止/.test(s), f); });
});
t('建置:js/css 必須帶內容雜湊,部署後瀏覽器才不會繼續用舊版', () => {
  const b = read('build.js');
  assert.ok(/\?v=' \+ stamp\(f\)/.test(b), 'build.js 要把 ?v=<雜湊> 掛到 index.html 的資源上');
  assert.ok(/少了快取破壞參數/.test(b), 'build.js 要自我檢查有沒有掛上去');
});
console.log('✔ 結構檢查 ' + n + ' 項通過');
