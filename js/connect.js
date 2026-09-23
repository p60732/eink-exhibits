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
  TIMEOUT_MS: 30000
};

const Api = (() => {
  // 只有讀取類動作允許自動重試(寫入重試可能造成重複申請)
  const READ = new Set(['status', 'me', 'catalog', 'check', 'myLoans', 'pickupOptions', 'lookup', 'dashboard', 'loans', 'items', 'units', 'users', 'logs']);
  async function once(action, payload, token) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), CONFIG.TIMEOUT_MS);
    try {
      const res = await fetch(CONFIG.GAS_URL, {
        method: 'POST', signal: ctl.signal,
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },   // text/plain 避免 CORS 預檢
        body: JSON.stringify({ action, payload, token })
      });
      if (!res.ok) throw Object.assign(new Error('連線失敗(HTTP ' + res.status + ')'), { network: true });
      return await res.json();
    } catch (e) {
      if (e.name === 'AbortError') throw Object.assign(new Error('連線逾時,請稍後再試'), { network: true });
      if (e instanceof TypeError) throw Object.assign(new Error('無法連線到伺服器,請檢查網路'), { network: true });
      throw e;
    } finally { clearTimeout(timer); }
  }
  async function call(action, payload = {}, token = null) {
    if (!CONFIG.GAS_URL || CONFIG.GAS_URL.startsWith('__')) throw new Error('尚未設定後端網址(js/connect.js 的 GAS_URL)');
    let j;
    try { j = await once(action, payload, token); }
    catch (e) {
      if (!(e.network && READ.has(action))) throw e;
      await new Promise(r => setTimeout(r, 800));
      j = await once(action, payload, token);
    }
    if (!j || j.success !== true) throw new Error((j && j.error) || '發生錯誤');
    return j.data;
  }
  return { call, READ };
})();
