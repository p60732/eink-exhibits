  function addUnits(c, it, k, location, serials) {
    var made = [], now = c.now;
    for (var i = 0; i < k; i++) {
      var u = { id: nextId(c.db.Units, 'E', 4), itemId: it.id, serial: serials && serials[i] ? s(serials[i]) : '', status: 'in', location: s(location) || it.location, note: '', countedAt: '', updatedAt: now };
      c.db.Units.push(u); made.push(u.id);
    }
    dirty(c.db, 'Units'); log(c, '新增單台編號', it.id, it.name + ':' + made[0] + (made.length > 1 ? ' ~ ' + made[made.length - 1] : ''));
    return made;
  }


  /** 每日提醒:回傳通知事件(由排程積木交給通知積木寄出) */
  function reminders(db, today) {
    var tomorrow = addDays(today, 1), events = [], over = [];
    db.Loans.forEach(function (L) {
      if (L.status !== 'out') return;
      var overdue = L.end < today;
      if (!overdue && L.end !== tomorrow) return;
      var to = applicantEmail(db, L), text = linesText(db, L);
      if (overdue) over.push(L.id + ' ' + L.applicant + '(' + (L.dept || '-') + ')' + L.event + ' 應還 ' + L.end + '\n' + text);
      if (to) events.push({ to: to,
        subject: (overdue ? '[展品管理] 借用已逾期 ' : '[展品管理] 明天到期 ') + L.id + ' — ' + L.event,
        body: L.applicant + ' 您好:\n\n' + (overdue ? '以下展品已超過歸還日 ' + L.end + ',請儘速歸還。' : '以下展品將於明天 ' + L.end + ' 到期,請記得歸還。') + '\n\n' + text });
    });
    var admins = emailsOfAdmins(db);
    if (over.length && admins.length) events.push({ to: admins, subject: '[展品管理] 今日逾期 ' + over.length + ' 筆', body: over.join('\n\n') });
    return events;
  }

  // rules:純函式,供規則層單元測試使用
  var rules = { isDate: isDate, addDays: addDays, stats: stats, loanWindow: loanWindow, reservedInRange: reservedInRange, availableInRange: availableInRange, checkLines: checkLines, isOverdue: isOverdue, sitesOf: sitesOf, capacity: capacity, cleanLines: cleanLines, showHold: showHold, showIssued: showIssued, cleanShowLines: cleanShowLines, saneDate: saneDate, saneRange: saneRange, leftBehindLoans: leftBehindLoans, logCat: logCat, LOG_CAT_LABEL: LOG_CAT_LABEL, LOG_CAT_ORDER: LOG_CAT_ORDER, settleShow: settleShow, archivable: archivable, archiveGroups: archiveGroups, holdersOf: holdersOf, showSheet: showSheet };
  return { USER: USER, ADMIN: ADMIN, reminders: reminders, rules: rules };
})();
