/**
 * 【連線積木】js/connect.js
 * 輸入:展示積木要送出的操作 { action, payload } 與登入 token
 * 責任:封裝對 GAS Web App 的 fetch、逾時處理、讀取類請求的網路錯誤重試、統一解析 { success, data, error }
 * 輸出:成功回傳 data;失敗拋出 Error(message = 後端 error)
 * 禁止:不放 API 金鑰;不做業務判斷;不操作畫面
 */
const CONFIG = {
  // 部署 Apps Script 後,把「網頁應用程式」網址貼在這裡
  GAS_URL: '__GAS_URL__',
  APP_NAME: '展品管理',
  /**
   * 讀取 30 秒:逾時了會自動重試,而重試那一趟容器已經熱了,通常兩秒就回來 ——
   * 所以讀取「等 30 秒再重試」比「乾等 45 秒」還快,維持原樣。
   * 寫入 75 秒:**寫入絕對不能中途放棄**。Apps Script 閒置後第一趟要 40 秒以上
   * (2026-09-24 實測 45.7 秒),30 秒就中斷的話,瀏覽器這邊報逾時、伺服器那邊卻可能已經寫進去了,
   * 使用者再送一次就變成兩張單。寧可讓他多等一下,也不要留下一張來路不明的單。
   */
  TIMEOUT_MS: 30000,
  WRITE_TIMEOUT_MS: 75000
};

const Api = (() => {
  // 只有讀取類動作允許自動重試(寫入重試可能造成重複申請)
  const READ = new Set(['status', 'me', 'catalog', 'check', 'myLoans', 'pickupOptions', 'lookup', 'dashboard', 'loans', 'items', 'units', 'users', 'logs', 'cats', 'allCats', 'shows', 'show', 'showCheck', 'showSettle', 'archivePreview', 'holders', 'showSheet']);
  async function once(action, payload, token) {
    const ctl = new AbortController();
    const ms = READ.has(action) ? CONFIG.TIMEOUT_MS : CONFIG.WRITE_TIMEOUT_MS;
    const timer = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await fetch(CONFIG.GAS_URL, {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // text/plain 避免 CORS 預檢
        body: JSON.stringify({ action, payload, token })
      });
      if (!res.ok) throw Object.assign(new Error('連線失敗(HTTP ' + res.status + ')'), { network: true });
      return await res.json();
    } catch (e) {
      if (e.name === 'AbortError') {
        // 寫入逾時不可以說「請稍後再試」—— 那次寫入可能已經成功了,直接再送一次會變成兩張單
        const msg = READ.has(action) ? '連線逾時,請稍後再試'
          : '連線逾時。這次的動作可能已經完成了,請先重新整理確認,不要直接重送';
        throw Object.assign(new Error(msg), { network: true });
      }
      if (e instanceof TypeError) throw Object.assign(new Error('無法連線到伺服器,請檢查網路'), { network: true });
      throw e;
    } finally { clearTimeout(timer); }
  }
  /**
   * GAS 的 /exec 會先回 302 再轉址,偶爾(尤其剛換版本那幾秒)POST 會被當成 GET 重送,
   * 回來的是 doGet 的健康檢查頁而不是這次要的資料。這種回應長得跟正常回應一樣,
   * 照單全收就會把一串字當成展品清單存進快取,畫面看起來就像「資料全不見了」。
   * 這裡把它當成連線失敗:讀取類會自動重試,寫入類則明確報錯(那次寫入其實沒有發生)。
   */
  function reject_(j) {
    return !!j && (j.health === true || (typeof j.data === 'string' && /API 運作中|健康檢查/.test(j.data)));
  }
  function check_(j) {
    if (reject_(j)) throw Object.assign(new Error('後端正在更新,請稍後再試一次'), { network: true });
    return j;
  }
  async function call(action, payload = {}, token = null) {
    if (!CONFIG.GAS_URL || CONFIG.GAS_URL.startsWith('__')) throw new Error('尚未設定後端網址(js/connect.js 的 GAS_URL)');
    let j;
    try { j = check_(await once(action, payload, token)); }
    catch (e) {
      if (!(e.network && READ.has(action))) throw e;
      await new Promise(r => setTimeout(r, 800));
      j = check_(await once(action, payload, token));
    }
    if (!j || j.success !== true) throw new Error((j && j.error) || '發生錯誤');
    return j.data;
  }
  return { call, READ };
})();
