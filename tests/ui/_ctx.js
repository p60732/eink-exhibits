/**
 * 【UI 測試共用】tests/ui/_ctx.js — 開瀏覽器、提供每個場景都會用到的小工具
 * 輸入:PORT 環境變數(假後端的埠)
 * 責任:只做「每個場景都一樣」的事 —— 開瀏覽器、開分頁、收集 pageerror、截圖、等待、日期
 * 禁止:不放任何跟某個場景有關的資料或步驟,那些要留在場景檔裡
 */
const { chromium } = require('playwright');
async function open() {
  const URL = 'http://localhost:' + (process.env.PORT || 8787) + '/';
  const b = global.__b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-proxy-server'] });
  const p = global.__p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  return {
    URL: URL, b: b, p: p, errs: errs,
    shot: n => p.screenshot({ path: `/tmp/ee_${n}.png`, fullPage: true }),
    wait: ms => p.waitForTimeout(ms),
    // 1×1 透明 PNG,給照片上傳測試用
    PNG: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
    d: k => new Date(Date.now() + k * 864e5).toISOString().slice(0, 10)
  };
}
module.exports = { open };
