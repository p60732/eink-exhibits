/**
 * 【邏輯積木】20_logic.gs
 * 輸入:守門調度傳入的「已驗證」上下文 c = { db, p(參數), user(登入者), today, now, log(), notify() }
 *       ※ 純規則引擎:不讀系統時間(today/now 由外部傳入)、不呼叫任何 Google 服務
 * 責任:所有業務規則——庫存 / 可借量計算、借用申請、審核、簽收、歸還、盤點、展品維護、提醒內容
 * 輸出:計算結果(回傳前端);資料變動寫在 db 上由記憶積木存檔;通知以事件交給通知積木
 * 禁止:不碰 HTML / DOM;不直接接收未經守門的請求;不直接呼叫 MailApp / SpreadsheetApp
 */
var Logic = (function () {
  'use strict';
  var LOAN_ST = { pending: '待審核', approved: '已核准', out: '出借中', returned: '已歸還', rejected: '已駁回', cancelled: '已取消' };
  var UNIT_ST = { 'in': '在庫', out: '借出', repair: '維修', lost: '遺失', retired: '報廢' };
  var SHOW_ST = { draft: '規劃中', confirmed: '已確認', closed: '已結案', cancelled: '已取消' };
  /**
   * 「還在跑」的借用單狀態。改這裡要一起改 `00_gateway.gs` 的 `LIVE`(尾段讀取用的同一組),
   * 兩邊跨不了執行環境,只能靠這行註解對齊。
   */
  var LIVE_ST = { pending: 1, approved: 1, out: 1 };
  // 展覽狀態只能這樣走;進 closed / cancelled 之前必須沒有還在跑的借用單
  var SHOW_FLOW = { draft: ['confirmed', 'cancelled'], confirmed: ['draft', 'closed', 'cancelled'], closed: ['confirmed'], cancelled: ['draft'] };
  var FOREVER = '9999-12-31';

