/**
 * 【邏輯積木】gas-src/20_logic/_concat.js — 把 gas-src/20_logic/*.js 串成 gas/20_logic.gs
 * 輸入:gas-src/20_logic/ 目錄
 * 責任:依檔名排序串接(數字前綴決定順序),供 build.js 與結構測試共用
 * 禁止:不做任何轉換 —— 串出來的結果必須跟拆檔之前的 gas/20_logic.gs 一模一樣。
 *       串接是「零行為風險」的前提,加了轉換就不是了。
 *
 * ⚠️ 為什麼原始碼放在 `gas-src/` 而不是 `gas/src/`:
 *    部署是 `clasp push` 整個 `gas/` 目錄,底下的 .js 會被當成**另一個 Apps Script 檔**上傳,
 *    於是 Logic 的每一段都變成獨立檔案 → 重複宣告、IIFE 被切斷,線上直接掛掉。
 *    放在 gas/ 外面,clasp 根本看不到,不用靠 .claspignore 這種沒辦法在本機驗證的東西。
 *
 * ⚠️ 所以 `gas/20_logic.gs` 是**建置產物,但仍然要 commit**(clasp 要推它)。
 *    這跟 js/ui.js 不一樣 —— 那個可以直接從 repo 拿掉。
 *    守門改用結構測試:「產物必須等於這裡串出來的結果」,手改產物當場就紅。
 */
const fs = require('fs'), path = require('path');
const SRC = __dirname;
const OUT = path.join(__dirname, '..', '..', 'gas', '20_logic.gs');
function parts() {
  return fs.readdirSync(SRC).filter(f => f.endsWith('.js') && !f.startsWith('_')).sort();
}
function concat() {
  return parts().map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('');
}
module.exports = { parts, concat, SRC, OUT };
