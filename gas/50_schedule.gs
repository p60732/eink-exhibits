/**
 * 【排程積木】50_schedule.gs
 * 輸入:時間條件(每天 08:30,Asia/Taipei)
 * 責任:定時喚醒邏輯積木的提醒計算,並交給通知積木寄送
 * 輸出:Apps Script 執行紀錄
 * 禁止:排程本身不含業務邏輯,只呼叫
 */

/** 手動執行一次即可安裝每日觸發器 */
function installDailyTrigger() {
  assertOwner_();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'dailyReminder') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyReminder').timeBased().everyDays(1).atHour(8).nearMinute(30).inTimezone('Asia/Taipei').create();
}

function dailyReminder() {
  var db = Memory.load();
  var events = Logic.reminders(db, Clock.today());
  var r = Notify.sendAll(events);
  console.log('每日提醒:寄出 ' + r.sent + ' 封,失敗 ' + r.failed + ' 封');
}
