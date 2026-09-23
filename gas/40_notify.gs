/**
 * 【通知積木】40_notify.gs
 * 輸入:邏輯積木產生的通知事件 { to, subject, body }
 * 責任:把 Email 送出去(MailApp)
 * 輸出:發送結果 { sent, failed }
 * 禁止:不決定「何時該通知、通知誰、內容是什麼」——那是邏輯積木的事
 */
var Notify = (function () {
  var FOOTER = '\n\n— 展品管理系統自動通知';
  function enabled_() { return PropertiesService.getScriptProperties().getProperty('MAIL_OFF') !== '1'; }
  function sendAll(events) {
    var r = { sent: 0, failed: 0 };
    if (!events || !events.length || !enabled_()) return r;
    events.forEach(function (ev) {
      var to = Array.isArray(ev.to) ? ev.to.filter(Boolean).join(',') : ev.to;
      if (!to) return;
      try { MailApp.sendEmail({ to: to, subject: ev.subject, body: ev.body + FOOTER }); r.sent++; }
      catch (e) { r.failed++; console.error('通知失敗', to, e); }
    });
    return r;
  }
  return { sendAll: sendAll };
})();
