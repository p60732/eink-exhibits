// 接線層 / 結構防回歸測試:node tests/structure.test.js
const assert = require('assert'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
/**
 * js/ui.js 是建置產物(原始碼在 js/src/*.js),所以這裡讀它 = 讀串接後的結果。
 * 下面那些檢查問的都是「整個前端有沒有做某件事」,要串起來看才對,不能逐檔檢查。
 */
const { concat: concatUI, parts: uiParts } = require('../js/src/_concat');
const read = f => f === 'js/ui.js' ? concatUI() : fs.readFileSync(path.join(root, f), 'utf8');
const gasFiles = fs.readdirSync(path.join(root, 'gas')).filter(f => f.endsWith('.gs'));
const GL = require('../gas-src/20_logic/_concat');
const webFiles = ['index.html', 'css/style.css', 'js/connect.js', 'js/ui.js'];
// 絕大多數檢查是同步的;少數需要真的跑起來(例如連線層的去重)會回傳 Promise,
// 那種要收集起來最後一起等 —— 不等的話斷言失敗會變成沒人接的 rejection,報錯訊息也認不出是哪一條。
let n = 0; const PENDING = [];
const t = (name, fn) => {
  try {
    const r = fn(); n++;
    if (r && typeof r.then === 'function') PENDING.push(r.catch(e => { e.message = name + ':' + e.message; throw e; }));
  } catch (e) { e.message = name + ':' + e.message; throw e; }
};

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
t('速度:一趟來回就要 1.7 秒,沒有先後關係的請求不可以排隊', () => {
  // 2026-09-24 實測:status(幾乎不讀資料)熱機後 8.2 秒、冷啟動 45.7 秒,catalog 只要 1.7 秒。
  // 也就是說成本在「排了幾趟」,不在「讀了幾欄」。這一條守住已經拆開的那幾處。
  const ui = read('js/ui.js');
  assert.ok(/function warm\(/.test(ui), '要有 warm():先把請求丟出去不等它');
  assert.ok(/warm\('items', 'items'\)/.test(ui), '展品管理的 items 不可以排在 cats 後面');
  assert.ok(/warm\(ckey2, 'catalog', req\)/.test(ui), '展品目錄的 catalog 不可以排在 cats 後面');
  assert.ok(/const preCheck =/.test(ui), '借用申請的可借量試算要跟目錄一起發');
  assert.ok(/id="settle-slot"/.test(ui), '展後結算在整頁最下面,不可以擋住第一次繪製');
  // 借用申請頁不可以再回到「先等目錄、再等試算」的排隊寫法
  const plan = ui.slice(ui.indexOf('VIEWS.plan = '), ui.indexOf('VIEWS.mine = '));
  assert.ok(plan.indexOf('const preCheck =') < plan.indexOf("await cachedGet('catalog|'"),
    '★ 試算要在等目錄之前就發出去,否則兩趟加起來要三秒半');
});
t('寫入逾時不可以中途放棄,訊息也不可以叫人再送一次', () => {
  // 冷啟動 45 秒 > 原本的 30 秒逾時:瀏覽器說逾時、伺服器卻可能已經寫進去了,再送一次就變兩張單
  const c = read('js/connect.js');
  assert.ok(/WRITE_TIMEOUT_MS/.test(c), '寫入要有自己的逾時');
  const m = c.match(/WRITE_TIMEOUT_MS:\s*(\d+)/);
  assert.ok(m && +m[1] >= 60000, '寫入逾時要大於冷啟動的時間(至少 60 秒),實際 ' + (m && m[1]));
  assert.ok(/READ\.has\(action\) \? CONFIG\.TIMEOUT_MS : CONFIG\.WRITE_TIMEOUT_MS/.test(c), '要依讀寫分開套用');
  assert.ok(/可能已經完成了/.test(c), '★ 寫入逾時的訊息要說「可能已經完成」,不可以叫人直接重送');
});
t('建置:index.html 本身也會被快取,所以要有建置編號 + version.json', () => {
  // `?v=` 只保護得了 js/css。index.html 被快取住時,裡面寫的還是舊的 ?v=,
  // 於是「已經部署好了,重新整理卻還是舊畫面」。這一組是專門守那個情況的。
  const h = read('index.html');
  assert.ok(/name="build" content="__BUILD__"/.test(h), 'index.html 要有建置編號的佔位符');
  assert.ok(/http-equiv="Cache-Control"/.test(h), 'index.html 要宣告不要被快取');
  const b = read('build.js');
  assert.ok(/html\.replace\('__BUILD__', build\)/.test(b), 'build.js 要把建置編號填進去');
  assert.ok(/site\/version\.json/.test(b), 'build.js 要產生 version.json');
  assert.ok(/沒有填入建置編號/.test(b), 'build.js 要自我檢查有沒有填進去');
  const ui = read('js/ui.js');
  assert.ok(/version\.json\?cb=/.test(ui) && /cache: 'no-store'/.test(ui), 'version.json 不可以進快取,否則比了也是白比');
  assert.ok(/location\.replace\(/.test(ui), '更新要換一個網址(帶建置編號),重新載入才抓得到新的 index.html');
  // 註解裡會提到它,所以先把註解拿掉再檢查
  const code = ui.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/[^\n]*/gm, '');
  assert.ok(!/location\.reload\(\)/.test(code), 'reload() 可能又拿到快取裡同一份舊 HTML,要換網址才抓得到新的');
});
t('建置:js/css 必須帶內容雜湊,部署後瀏覽器才不會繼續用舊版', () => {
  const b = read('build.js');
  assert.ok(/\?v=' \+ stamp\(f\)/.test(b), 'build.js 要把 ?v=<雜湊> 掛到 index.html 的資源上');
  assert.ok(/少了快取破壞參數/.test(b), 'build.js 要自我檢查有沒有掛上去');
});
t('日期上下界:前端與規則層必須是同一組數字', () => {
  // 兩邊各寫一份是刻意的(前端先擋一次,不用白跑一趟後端),但數字一旦漂開,
  // 使用者會看到「前端說可以、後端說不行」這種最難查的狀況。
  const grab = (src, name) => {
    const m = src.match(new RegExp(name + '\\s*=\\s*(\\d+)'));
    assert.ok(m, name + ' 找不到');
    return m[1];
  };
  const g = read('gas/20_logic.gs'), u = read('js/ui.js');
  ['DATE_BACK_DAYS', 'DATE_FWD_DAYS', 'MAX_SPAN_DAYS'].forEach(k =>
    assert.strictEqual(grab(u, k), grab(g, k), k + ' 前端與規則層不一致'));
  // 前端要真的用上它們:欄位要有 min/max,送出前要再檢查一次
  assert.ok(/const DLIM = \(\) =>[\s\S]{0,200}min="/.test(u), '日期欄位要吐得出 min/max');
  assert.ok((u.match(/\$\{DLIM\(\)\}/g) || []).length >= 6, '每個日期欄位都要掛上 min/max');
  assert.ok(/rangeProblem\(/.test(u), '前端要有送出前的日期檢查');
});
t('列印視窗:每一個開新視窗的列印頁都要放得回得來的工具列', () => {
  // QR 標籤那一頁要連 CDN 才畫得出來,UI 測試在沙箱裡跑不到,所以靠這裡守著。
  const ui = read('js/ui.js');
  const fns = ['printLoan', 'printShowSheet', 'printLabels'];
  fns.forEach(fn => {
    const at = ui.indexOf('function ' + fn);
    assert.ok(at > 0, '找不到 ' + fn);
    // 取這個函式到下一個頂層 function 為止
    const rest = ui.slice(at + 10);
    const end = rest.search(/\nfunction |\nasync function |\nconst VIEWS/);
    const body = end > 0 ? rest.slice(0, end) : rest;
    assert.ok(/window\.open\(/.test(body), fn + ' 應該是開新視窗的列印頁');
    assert.ok(body.includes('PRINT_BAR_CSS'), fn + ' 少了列印工具列的樣式');
    assert.ok(/PRINT_BAR\b/.test(body.replace(/PRINT_BAR_CSS/g, '')), fn + ' 少了列印工具列本身 —— 印完回不到系統');
  });
  assert.ok(/@media print\{\.pbar\{display:none\}\}/.test(ui), '工具列必須在列印時藏起來');
  assert.ok(/window\.close\(\)/.test(ui), '工具列的「關閉」要真的關掉視窗');
});
t('操作紀錄:每一個動作字串都要歸得到大類,不可以掉進「其他」', () => {
  // 動作名是自由文字,而且有兩個是動態組出來的(「當面確認…」「展覽改為…」)。
  // 這條測試把 .gs 裡每一個 log() 的動作字串抓出來跑一遍 logCat() ——
  // 以後有人改了動作名或加了新動作,忘記更新對照表就會在這裡紅,而不是在畫面上默默變成「其他」。
  const { makeEnv } = require('./fake-gas');
  const R = makeEnv().ctx.Logic.rules;
  // 取出 log(c, <第 2 個參數>) 與 log_(db, u, <第 3 個參數>) 裡的字面字串
  const argAt = (src, open, idx) => {
    let d = 0, args = [], cur = '', q = null;
    for (let i = open + 1; i < src.length; i++) {
      const ch = src[i];
      if (q) { if (ch === '\\') { cur += ch + src[++i]; continue; } cur += ch; if (ch === q) q = null; continue; }
      if (ch === "'" || ch === '"' || ch === '`') { q = ch; cur += ch; continue; }
      if ('([{'.includes(ch)) d++;
      if (')]}'.includes(ch)) { if (d === 0) { args.push(cur); break; } d--; }
      if (ch === ',' && d === 0) { args.push(cur); cur = ''; continue; }
      cur += ch;
    }
    return (args[idx] || '').trim();
  };
  const found = new Set();
  gasFiles.forEach(f => {
    const src = read('gas/' + f), re = /\blog(_?)\(/g;
    let m;
    while ((m = re.exec(src))) {
      const a2 = argAt(src, m.index + m[0].length - 1, m[1] === '_' ? 2 : 1);
      if (!a2 || /^function/.test(a2)) continue;
      [...a2.matchAll(/'([^']*)'/g)].map(x => x[1]).filter(Boolean).forEach(L => found.add(L));
    }
  });
  assert.ok(found.size >= 30, '抓到的動作字串太少(' + found.size + '),解析可能壞了');
  const other = [...found].filter(a2 => a2 !== 'extend' && R.logCat(a2) === 'other');
  assert.strictEqual(other.join('、'), '', '這些動作沒有大類,會掉進「其他」:' + other.join('、'));
  // 大類的顯示順序:前端那份要涵蓋後端全部的 key
  const ui = read('js/ui.js');
  const order = JSON.parse((ui.match(/const LOG_CAT_ORDER = (\[[^\]]*\])/) || [])[1].replace(/'/g, '"'));
  Object.keys(R.LOG_CAT_LABEL).forEach(k => assert.ok(order.includes(k), '前端的 LOG_CAT_ORDER 少了「' + k + '」'));
});
t('前端原始碼拆檔:串接順序就是行為,而且不可以留下手改的 js/ui.js', () => {
  // 1) 產物不可以躺在原始碼目錄裡 —— 留著遲早有人改到那一份,改完卻沒進建置
  assert.ok(!fs.existsSync(path.join(root, 'js/ui.js')),
    'js/ui.js 是建置產物,不應該存在於原始碼目錄(要改請改 js/src/*.js)');
  // 2) 串接結果語法要過,而且關鍵骨架都在(漏掉一個檔就會少東西)
  const ui = concatUI();
  new Function(ui);
  ['const VIEWS = {}', 'const ACT = {', 'const S = ', 'function render('].forEach(k =>
    assert.ok(ui.includes(k), '串接結果少了「' + k + '」,可能漏掉某個 js/src 檔'));
  // 3) 順序不變式:常數要在用到它的頁面之前,事件分派要在最後
  const names = uiParts();
  assert.ok(names.length >= 5, 'js/src 檔案數不對:' + names.join(','));
  assert.strictEqual(names.join(','), [...names].sort().join(','), 'parts() 必須是排序過的');
  const at = k => ui.indexOf(k);
  assert.ok(at('const REQ_WORD') < at('VIEWS.mine'), 'REQ_WORD 必須排在用到它的頁面之前');
  assert.ok(at('const LOG_CAT_ORDER') < at('VIEWS.logs'), 'LOG_CAT_ORDER 必須排在操作紀錄之前');
  assert.ok(at('const PRINT_BAR') < at('function printLoan'), 'PRINT_BAR 必須排在列印函式之前');
  assert.ok(at('const ACT = {') > at('VIEWS.catalog'), '事件分派必須排在所有頁面之後');
  // 4) 每個檔案都要小到「改一頁只讀那一頁」還有意義
  uiParts().forEach(f => {
    const n2 = fs.readFileSync(path.join(root, 'js/src', f), 'utf8').split('\n').length;
    assert.ok(n2 <= 600, 'js/src/' + f + ' 有 ' + n2 + ' 行,超過 600 就失去拆檔的意義了');
  });
});
t('換人登入:S 裡每一個篩選狀態都要被 clearWork() 清掉', () => {
  // v2.2 修過「換人登入會接手前一個人的購物車與篩選」,v2.7 加 filters.loc 時又漏了一次。
  // 靠記憶會再漏,所以把「S 宣告了什麼」與「clearWork 清了什麼」對起來。
  const ui = concatUI();
  const decl = (ui.match(/const S = \{[\s\S]*?\n\};/) || [])[0];
  assert.ok(decl, '找不到 S 的宣告');
  const clear = (ui.match(/function clearWork\(\)[\s\S]*?\n\}/) || [])[0];
  assert.ok(clear, '找不到 clearWork()');
  // 這些是「跟人無關、換人就該歸零」的篩選/暫存狀態
  const WORK = ['itemQ', 'cat', 'site', 'itemSite', 'logQ', 'logCat', 'logWho', 'loanFilter', 'loanHist', 'filters', 'cart', 'multi', 'editing'];
  const missing = WORK.filter(k => decl.includes(k + ':') && !new RegExp('S\\.' + k + '\\s*=').test(clear));
  assert.strictEqual(missing.join('、'), '', '★ clearWork() 沒清掉:' + missing.join('、'));
  // filters 物件裡的每個欄位也要被重設到
  const fDecl = (decl.match(/filters:\s*\{([^}]*)\}/) || [])[1] || '';
  const fClear = (clear.match(/S\.filters\s*=\s*\{([^}]*)\}/) || [])[1] || '';
  const fMiss = [...fDecl.matchAll(/(\w+):/g)].map(m => m[1]).filter(k => !fClear.includes(k + ':'));
  assert.strictEqual(fMiss.join('、'), '', '★ clearWork() 的 filters 少了:' + fMiss.join('、'));
});
t('部署印記:repo 裡必須是 dev,doGet 要吐出來,CI 要蓋章也要驗', () => {
  // 以前確認「線上是不是我剛推的那一份」得開編輯器逐檔比 sha256(十幾分鐘,而且靠眼睛)。
  // 現在靠這一行:CI 在 clasp push 前蓋上 commit 短雜湊,部署完 curl /exec 對答案。
  // 這三件事任何一件斷掉,驗證就會變成「永遠通過」的假綠燈,所以綁在一起檢查。
  const stamp = read('gas/99_stamp.gs');
  assert.ok(/^var CODE_STAMP = 'dev';$/m.test(stamp),
    "★ gas/99_stamp.gs 在 repo 裡必須剛好是 var CODE_STAMP = 'dev'; (CI 的 sed 認這一行)");
  assert.ok(/code:\s*CODE_STAMP/.test(read('gas/00_gateway.gs')), '★ doGet 必須帶 code: CODE_STAMP');
  assert.ok(/health:\s*true/.test(read('gas/00_gateway.gs')), 'doGet 仍然必須帶 health: true');
  const wf = read('.github/workflows/gas-deploy.yml');
  assert.ok(/sed -i .*CODE_STAMP/.test(wf), '★ gas-deploy 少了蓋印記那一步');
  // 比的是真正執行的那一行,不是檔頭註解裡的「clasp push」
  assert.ok(wf.indexOf('CODE_STAMP') < wf.indexOf('run: clasp push -f'), '★ 印記必須蓋在 clasp push 之前');
  assert.ok(/\\"code\\":\\"\$sha\\"/.test(wf), '★ gas-deploy 部署後必須驗 code 等於這次的 commit,只驗 health 等於沒驗');
});
t('總覽展開的明細要接在被點到的磚塊後面(手機上不能掉到八塊磚以下)', () => {
  const ui = read('js/ui.js');
  assert.ok(/brick\.after\(box\)/.test(ui), '★ 展開的明細必須插到被點到的磚塊後面');
  assert.ok(/const slot = siteBreakBox/.test(ui), 'drawSiteBreak 必須透過 siteBreakBox 取得容器(await 之後要重新定位)');
  const css = read('css/style.css');
  assert.ok(/\.kpis>#sitebreak\{grid-column:1\/-1\}/.test(css), '★ 明細進了格線就要橫跨一整列,不然會被擠成一格寬');
  assert.ok(/#sitebreak:empty\{display:none\}/.test(css), '收起的時候空容器不能佔位');
});
t('借用申請表單:聯絡方式只能從帳號帶,不可以再長出自由輸入欄', () => {
  // 2026-10-01 精簡表單:只剩「借用目的 + 期間」必填,地點與備註選填。
  // 聯絡方式改成後端從帳號帶(工號 / Email)—— 前端若又冒出 contact 欄,
  // 使用者填的東西會被默默丟掉,比沒有那一欄更糟。
  const ui = read('js/ui.js');
  assert.ok(!/name="contact"/.test(ui), '★ 借用申請表單不可以有 contact 輸入欄(聯絡方式由後端從帳號帶)');
  assert.ok(!/name="purpose"/.test(ui), '★ 用途已併進「借用目的」,不可以再有 purpose 輸入欄');
  assert.ok(/借用目的/.test(ui), '表單要有「借用目的」這一欄');
  const g = read('gas/20_logic.gs');
  assert.ok(!/contact:\s*s\(c\.p\.contact\)/.test(g), '★ 後端不可以吃前端送的 contact');
  assert.ok(/contact:\s*onBehalf \? contactOf\(who\) : contactOf\(c\.user\)/.test(g),
    '★ 聯絡方式要從帳號帶,代為登記時帶被登記者的');
  assert.ok(/mailList\(\[applicantEmail\(c\.db, L\), c\.user\.email\]\)/.test(g),
    '★ 核准通知的收件者要包含按下核准的那位管理者');
});
t('沒有 Email 就收不到任何通知:代填要對到帳號、登入要補 Email', () => {
  const g = read('gas/20_logic.gs'), i = read('gas/10_identity.gs'), ui = read('js/ui.js');
  assert.ok(/if \(!who\) throw E\('找不到「'/.test(g), '★ 代為登記對不到帳號必須擋下來(放行的話那張單沒有主人)');
  assert.ok(/setMyEmail: function/.test(i), '★ 要有讓本人補 Email 的路由');
  assert.ok(/add\('user', true, I, \{ logout: \[\], changePin:.*setMyEmail: \['email'\]/.test(read('gas/00_gateway.gs')),
    'setMyEmail 要掛在「登入後才能用」的路由上');
  assert.ok(/if \(!S\.user\.email\) \{[^}]*emailModal\(\)/.test(ui), '★ 登入後帳號沒有 Email 就要跳出補填');
  assert.ok(/openModal\(`<h2>請先補一下你的 Email/.test(ui) && /locked: true/.test(ui), '補 Email 的視窗要擋住畫面,不能略過');
  // 前端那道擋板擋不住舊瀏覽器,也擋不住代為登記 —— 後端要再擋一次
  assert.ok(/if \(!s\(applyUser\.email\)\)/.test(g), '★ 後端也要擋:帳號沒有 Email 就不收單');
});
t('gas/20_logic.gs 是建置產物:內容必須等於 gas-src/20_logic 串接的結果', () => {
  /**
   * 跟 js/ui.js 不同,這個產物**必須 commit** —— 部署是 clasp push 整個 gas/ 目錄,推的就是它。
   * 所以不能用「原始碼目錄不准有這個檔」來守,只能守「它跟原始碼一致」。
   * 手改了 gas/20_logic.gs 而沒改 gas-src/,或是改了 gas-src/ 忘記 node build.js,這條都會紅。
   */
  assert.strictEqual(read('gas/20_logic.gs'), GL.concat(),
    '★ gas/20_logic.gs 與 gas-src/20_logic 串接結果不一致 —— 跑 node build.js 重新產生,並且一起 commit');
  const p = GL.parts();
  assert.ok(p.length >= 2, 'gas-src/20_logic 應該有多個分片');
  assert.ok(/^\d\d-/.test(p[0]) && p.every(f => /^\d\d-/.test(f)),
    '★ 每個分片都要有兩位數字前綴 —— 排序就是串接順序,也就是行為');
  const head = fs.readFileSync(path.join(GL.SRC, p[0]), 'utf8');
  const tail = fs.readFileSync(path.join(GL.SRC, p[p.length - 1]), 'utf8');
  assert.ok(/var Logic = \(function \(\) \{/.test(head), '★ IIFE 的開頭必須在第一個分片裡');
  assert.ok(/\}\)\(\);\s*$/.test(tail), '★ IIFE 的結尾必須在最後一個分片裡');
});
t('gas/ 底下只能有 .gs 與 appsscript.json(clasp 會把別的檔也推上去)', () => {
  /**
   * 原始碼刻意放在 gas-src/ 而不是 gas/src/:clasp push 推的是整個 gas/,
   * 底下的 .js 會變成一個個獨立的 Apps Script 檔 —— Logic 被切成好幾段、重複宣告,線上直接掛。
   * 這條就是在擋「哪天有人把 gas-src 搬回 gas/ 底下」。
   */
  fs.readdirSync(path.join(root, 'gas'), { withFileTypes: true }).forEach(e => {
    assert.ok(e.isFile(), '★ gas/ 底下不可以有子目錄(clasp 會連裡面的檔一起推):' + e.name);
    assert.ok(/\.gs$/.test(e.name) || e.name === 'appsscript.json',
      '★ gas/ 底下只能放 .gs 與 appsscript.json,clasp 會把其他檔也當成程式推上去:' + e.name);
  });
});
t('人員管理不再收部門,而且 Email 要看得出有沒有', () => {
  const ui = read('js/ui.js');
  assert.ok(!/<span>部門<\/span>/.test(ui), '★ 表單不應該再有「部門」輸入欄(使用者、代為登記、初始設定)');
  assert.ok(/沒有 Email/.test(ui), '使用者清單要標出沒有 Email 的人 —— 他們送不出申請單');
  const i = read('gas/10_identity.gs');
  assert.ok(/if \(p\.email !== undefined\) u\.email = s\(p\.email\);/.test(i),
    '★ saveUser 沒帶到的欄位要保留原值,不可以整列覆蓋');
});
t('「一起填單」要釘在分類籤條那一塊裡面', () => {
  // 往下挑的時候按鈕要一直在手邊。以前靠 .multibar 的 sticky bottom,
  // 但它的容器只有自己那麼高,捲過去就跟著不見了 —— 挑到一半還得捲回最上面。
  const ui = read('js/ui.js'), css = read('css/style.css');
  const bars = (ui.match(/<div class="catbar-stick" id="cbars">[^\n]*/) || [])[0] || '';
  assert.ok(/id="mbar"/.test(bars), '★ #mbar 必須放在 .catbar-stick 裡面');
  assert.ok(/id="pickbar"/.test(bars), '★ 挑選模式的那一條也要放在 .catbar-stick 裡面');
  assert.ok(!/\.multibar\{position:sticky;bottom/.test(css), '★ 舊的 sticky bottom 要拿掉,不然兩種釘法會打架');
});
t('連點防呆:一樣的寫入還在路上就不可以再送一次', () => {
  // 2026-10-01 回報:連點兩下「下架」變成兩筆。真正保證不會變成兩筆的是連線層那一道。
  const c = read('js/connect.js'), ui = read('js/ui.js');
  assert.ok(/const FLYING = new Map\(\)/.test(c) && /if \(FLYING\.has\(key\)\) return FLYING\.get\(key\)/.test(c),
    '★ 連線層要擋掉「動作與參數一樣、而且還在路上」的寫入');
  assert.ok(/if \(READ\.has\(action\)\) return send\(action, payload, token\);/.test(c),
    '讀取類不走這個去重(讀取本來就可以重試)');
  assert.ok(/if \(el\.dataset\.busy === '1'\) return;/.test(ui), '★ 同一顆按鈕上一次還沒結束之前不可以再觸發');
  assert.ok(/aria-busy/.test(ui) && /\[aria-busy="true"\]\{opacity/.test(read('css/style.css')),
    '送出中的按鈕要看得出來(不然使用者會一直按)');
  assert.ok(/confirmInline\('確定要下架這個展品/.test(ui), '★ 下架要先問一次');
});
t('連線層實測:一樣的寫入同時送兩次,只能發出一趟', () => {
  /**
   * 這一條是真的跑起來驗,不是比對字串。
   * UI 測試擋不到這一層 —— 按鈕那道守門會先攔下第二次點擊,
   * 所以拿掉連線層的去重,UI 測試照樣綠(2026-10-01 實測過)。
   */
  const src = read('js/connect.js').replace("'__GAS_URL__'", "'https://script.google.com/macros/s/x/exec'");
  let calls = 0;
  const sandbox = {
    fetch: () => { calls++; return new Promise(r => setTimeout(() => r({ ok: true, json: () => ({ success: true, data: 1 }) }), 60)); },
    AbortController: function () { this.signal = null; this.abort = () => { }; },
    setTimeout, clearTimeout, TypeError
  };
  const make = new Function('fetch', 'AbortController', 'setTimeout', 'clearTimeout',
    src + '\nreturn Api;');
  const Api = make(sandbox.fetch, sandbox.AbortController, setTimeout, clearTimeout);
  const payload = { id: 'P0001', archived: true };
  return Promise.all([Api.call('archiveItem', payload, 't'), Api.call('archiveItem', payload, 't')])
    .then(() => {
      assert.strictEqual(calls, 1, '★ 同時送兩次一模一樣的寫入,只能真的發出一趟,實際 ' + calls);
      // 前一趟回來之後再送就是正常的第二次,不可以被吃掉
      return Api.call('archiveItem', payload, 't').then(() => {
        assert.strictEqual(calls, 2, '★ 前一趟結束後再送一次要照常發出');
      });
    });
});

t('借用單一張一張收合:預設只露出標題與狀態,但按鈕不收', () => {
  const ui = read('js/ui.js'), css = read('css/style.css');
  assert.ok(/data-act="loan-fold"/.test(ui), '★ 每張單的標題旁要有收合鈕');
  assert.ok(/\.loan \.loan-body\{display:none\}/.test(css) && /\.loan\.open \.loan-body\{display:block\}/.test(css),
    '★ 細項預設收起來,open 才展開');
  // 操作按鈕必須在 .loan-body 外面 —— 收起來還是要能直接核准 / 點交 / 歸還
  const i0 = ui.indexOf('<div class="loan-body">');
  const i1 = ui.indexOf('\n    </div>', i0);          // loan-body 的結尾
  assert.ok(i0 > 0 && i1 > i0, '找不到 .loan-body 區塊');
  assert.ok(!ui.slice(i0, i1).includes('class="actions"'),
    '★ 操作按鈕不可以放進 .loan-body(收起來就按不到了)');
  assert.ok(ui.slice(i1, i1 + 400).includes('class="actions"'), '操作按鈕要緊接在收合區塊之後');
  assert.ok(/'loan-fold':/.test(ui) && /'loan-foldall':/.test(ui), '要有單張與整批的收合動作');
  // 「我的借用」的歷史紀錄整段也要收得起來(久了也會變幾十張)
  assert.strictEqual((ui.match(/class="card histfold /g) || []).length, 2,
    '★ 借用單與我的借用兩邊都要有「整段歷史」的收合');
  assert.ok(/歷史紀錄<span class="chipnum">/.test(ui), '我的借用的那一條要標出有幾張');
  assert.ok(/S\.openLoans = new Set\(\);/.test(ui), '★ 換人登入要清掉展開狀態');
});
t('流程精簡:每一個轉折都要同步通知兩方', () => {
  // 對同仁來說,送出申請之後就只靠信知道發生了什麼事 —— 少寄一封就是斷掉一截。
  const g = read('gas/20_logic.gs');
  const both = (g.match(/mailList\(\[applicantEmail\(c\.db, L\), c\.user\.email\]\)/g) || []).length;
  assert.ok(both >= 3, '★ 核准 / 不核准 / 歸還三個轉折都要寄給兩方,目前只有 ' + both + ' 處');
  assert.ok(/其中損壞/.test(read('js/ui.js')), '歸還單要有「其中損壞」欄位');
  assert.ok(/var dmg = Math\.min\(ret,/.test(g), '★ 損壞要夾在這次歸還的數量以內');
});
Promise.all(PENDING).then(() => console.log('✔ 結構檢查 ' + n + ' 項通過'))
  .catch(e => { console.error('✘ ' + e.message); process.exit(1); });
