/**
 * 【展示積木】js/src/_concat.js — 把 js/src/*.js 串成一個 js/ui.js
 * 輸入:js/src/ 目錄
 * 責任:依檔名排序串接(數字前綴決定順序),供 build.js / tests/serve.js / 結構測試共用
 * 禁止:不做任何轉換 —— 串出來的結果必須跟拆檔之前的 js/ui.js 一模一樣。
 *       串接是「零行為風險」的前提,加了轉換就不是了。
 *
 * ⚠️ 順序就是行為:常數(LOG_CAT_ORDER / PRINT_BAR)在 10-shared,
 *    必須排在用到它們的頁面之前;90-act 引用所有頁面的函式,必須排最後。
 *    檔名的數字前綴是唯一的依據,改名之前先想清楚。
 */
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname);
function parts() {
  return fs.readdirSync(SRC).filter(f => f.endsWith('.js') && !f.startsWith('_')).sort();
}
function concat() {
  return parts().map(f => fs.readFileSync(path.join(SRC, f), 'utf8')).join('');
}
module.exports = { parts, concat, SRC };
