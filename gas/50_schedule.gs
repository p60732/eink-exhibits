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

/* ===================== 每日備份(預設沒有啟用) =====================
 * 試算表自己的「版本記錄」只救得回「同一個檔案被改壞」;
 * 救不回「檔案被丟到垃圾桶」「程式指到了別的檔案」。副本才救得回。
 * 要啟用:在編輯器手動執行一次 installBackupTrigger()。
 */
var BACKUP_ = { folder: '展品管理備份', keepDays: 30 };

/** 手動執行一次即可安裝每日備份(凌晨 2 點複製一份) */
function installBackupTrigger() {
  assertOwner_();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'dailyBackup') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyBackup').timeBased().everyDays(1).atHour(2).inTimezone('Asia/Taipei').create();
  console.log('已安裝每日備份:每天凌晨 2 點複製一份到雲端硬碟「' + BACKUP_.folder + '」,保留 ' + BACKUP_.keepDays + ' 天');
}

/** 複製一份試算表到備份資料夾,並清掉超過保留天數的舊副本 */
function dailyBackup() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  var file = id ? DriveApp.getFileById(id) : DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId());
  var it = DriveApp.getFoldersByName(BACKUP_.folder);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(BACKUP_.folder);
  var stamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
  file.makeCopy(file.getName() + ' 備份 ' + stamp, folder);

  var cut = new Date().getTime() - BACKUP_.keepDays * 86400000, gone = 0;
  var olds = folder.getFiles();
  while (olds.hasNext()) {
    var f = olds.next();
    if (f.getDateCreated().getTime() < cut) { f.setTrashed(true); gone++; }
  }
  console.log('備份完成:' + stamp + ';清掉 ' + gone + ' 份過期副本');
}
