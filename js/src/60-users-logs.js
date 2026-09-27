VIEWS.users = main => withData(main, 'users', 'users', {}, list => {
  main.innerHTML = `<div class="row"><div><div class="eyebrow">People</div><h1>使用者</h1><p class="sub">同仁以工號登入(不需密碼);管理者需另設 PIN。人員異動時重新匯入即可更新。</p></div><span class="spacer"></span><button class="btn" data-act="import-users">匯入人員清單</button><button class="btn brand" data-act="edit-user">${ICON.plus}新增</button></div>
    <div class="toolbar"><input class="grow" type="search" id="uq" placeholder="搜尋工號、姓名、部門…"></div>
    <div class="tbl-wrap"><table><thead><tr><th>工號</th><th>姓名</th><th>部門</th><th>Email</th><th>角色</th><th>狀態</th><th></th></tr></thead><tbody id="ubody"></tbody></table></div>`;
  S._users = list;
  const draw = q => {
    q = (q || '').toLowerCase();
    $('#ubody').innerHTML = list.filter(u => !q || [u.empNo, u.name, u.dept, u.email].join(' ').toLowerCase().includes(q)).map(u => `<tr class="${u.active ? '' : 'dim'}"><td class="mono">${esc(u.empNo)}</td><td>${esc(u.name)}</td><td>${esc(u.dept)}</td><td>${esc(u.email)}</td><td>${u.role === 'admin' ? '<span class="pill approved">管理者</span>' : '<span class="pill">使用者</span>'}</td><td>${u.active ? '啟用' : '停用'}</td>
    <td><button class="btn sm" data-act="edit-user" data-id="${u.id}">編輯</button></td></tr>`).join('') || '<tr><td colspan="7" class="empty">無資料</td></tr>';
  };
  draw(); $('#uq').oninput = e => draw(e.target.value);
});

VIEWS.logs = main => withData(main, 'logs', 'logs', { limit: 500 }, list => {
  // 動作大類由後端算好帶過來(cat / catLabel),前端不重寫那張對照表
  const CATS = [];
  list.forEach(l => { if (l.cat && !CATS.some(c => c[0] === l.cat)) CATS.push([l.cat, l.catLabel || l.cat]); });
  CATS.sort((a, b) => LOG_CAT_ORDER.indexOf(a[0]) - LOG_CAT_ORDER.indexOf(b[0]));
  const PEOPLE = [...new Set(list.map(l => l.user).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
  main.innerHTML = `<div class="eyebrow">Audit log</div><h1>操作紀錄</h1>
    <p class="sub">誰在什麼時候做了什麼。最近 500 筆,完整紀錄在試算表「操作紀錄」工作表。</p>
    <div class="toolbar"><input class="grow" type="search" id="gq" placeholder="搜尋人名、單號、動作…" value="${esc(S.logQ || '')}">
      <button class="btn" data-act="logs-csv" title="把目前篩選出來的紀錄匯出成 CSV" aria-label="匯出操作紀錄 CSV">${ICON.dl}<span class="lbl-hide">匯出</span></button></div>
    <div class="catbar-stick" id="gbars"><div class="catbar" id="gcat"></div><div class="catbar" id="gwho"></div></div>
    <div class="meta" id="gsum" style="margin:8px 0"></div>
    <div class="tbl-wrap"><table><thead><tr><th>時間</th><th>人員</th><th>分類</th><th>動作</th><th>對象</th><th>內容</th></tr></thead><tbody id="gbody"></tbody></table></div>`;
  // 籤條上的數字要反映「另一個篩選器已經篩過之後」還剩幾筆,不然點下去會是空的
  const byQ = () => { const q = (S.logQ || '').toLowerCase();
    return list.filter(l => !q || [l.user, l.action, l.ref, l.detail, l.catLabel].join(' ').toLowerCase().includes(q)); };
  const shown = () => byQ().filter(l => (!S.logCat || l.cat === S.logCat) && (!S.logWho || l.user === S.logWho));
  const chip = (on, key, label, n, attr) => `<button class="catchip ${on ? 'on' : ''}" ${attr}="${esc(key)}">${esc(label)}<span class="n">${n}</span></button>`;
  const bars = () => {
    const base = byQ();
    const inWho = l => !S.logWho || l.user === S.logWho;
    const inCat = l => !S.logCat || l.cat === S.logCat;
    $('#gcat').innerHTML = chip(!S.logCat, '', '全部', base.filter(inWho).length, 'data-lcat')
      + CATS.map(([k, t]) => chip(S.logCat === k, k, t, base.filter(l => l.cat === k && inWho(l)).length, 'data-lcat')).join('');
    $('#gwho').innerHTML = chip(!S.logWho, '', '所有人', base.filter(inCat).length, 'data-lwho')
      + PEOPLE.map(u => chip(S.logWho === u, u, u, base.filter(l => l.user === u && inCat(l)).length, 'data-lwho')).join('');
    $$('[data-lcat]').forEach(el => el.onclick = () => { S.logCat = el.dataset.lcat; draw(); });
    $$('[data-lwho]').forEach(el => el.onclick = () => { S.logWho = el.dataset.lwho; draw(); });
  };
  const draw = () => {
    bars();
    const rows = shown();
    S._logRows = rows;
    $('#gsum').textContent = rows.length === list.length ? `共 ${list.length} 筆`
      : `符合 ${rows.length} 筆 / 共 ${list.length} 筆`;
    $('#gbody').innerHTML = rows.map(l =>
      `<tr><td class="mono">${esc(l.ts)}</td><td>${esc(l.user)}</td><td><span class="pill">${esc(l.catLabel || '—')}</span></td>
       <td>${esc(l.action)}</td><td class="mono">${esc(l.ref)}</td><td class="wrap">${esc(l.detail)}</td></tr>`).join('')
      || '<tr><td colspan="6" class="empty">沒有符合的紀錄</td></tr>';
  };
  draw();
  $('#gq').oninput = e => { S.logQ = e.target.value; draw(); };
});
/** 匯出目前篩出來的操作紀錄 */
function exportLogs() {
  const rows = S._logRows || [];
  if (!rows.length) return toast('目前沒有可以匯出的紀錄', true);
  downloadCSV(`操作紀錄_${todayStr()}.csv`,
    [['時間', '人員', '分類', '動作', '對象', '內容']].concat(rows.map(l => [l.ts, l.user, l.catLabel || '', l.action, l.ref, l.detail])));
}

