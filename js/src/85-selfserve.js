/* ===================== 使用者自助:簽收 / 歸還 / 當面確認 ===================== */
async function myLoan(id) { return (await api('myLoans')).find(l => l.id === id); }
async function userPickupModal(id) {
  const L = await myLoan(id);
  const opts = await api('pickupOptions', { id });
  const unitLines = opts.filter(o => o.mode === 'unit');
  const okey = o => o.key || (o.itemId + '@' + nloc(o.location));
  const pick = {}; unitLines.forEach(o => pick[okey(o)] = []);
  const m = openModal(`<h2>簽收領取 ${esc(L.id)}</h2><p><b>${esc(L.event)}</b>・應還 ${esc(L.end)}</p>
    ${unitLines.length ? `<div class="banner info" style="font-size:13px">請掃描或點選你實際拿到的那幾台(看展品上的 QR 標籤編號)。</div>
    <div class="row" style="margin-bottom:10px"><input type="text" id="pscan" placeholder="輸入編號後 Enter" style="flex:1"><button class="btn" id="pcam">${ICON.scan}掃描</button><button class="btn" id="pauto">自動選好</button></div>` : ''}
    <div class="lines">${opts.map(o => { const k = esc(okey(o)), where = esc(nloc(o.location)); return o.mode === 'unit' ? `<div class="line" style="display:block"><div class="row"><b style="flex:1">${esc(o.name)} <span class="pill">${where}</span></b><span data-pc="${k}" class="short">已選 0 / ${o.qty}</span></div>
      <div class="chips">${o.units.map(u => `<span class="chipk" data-pick="${u.id}" data-it="${k}">${esc(u.id)}${u.serial ? ' <small>' + esc(u.serial) + '</small>' : ''}</span>`).join('') || '<span class="short">目前沒有在庫的單台,請聯絡管理者</span>'}</div></div>`
      : `<div class="line"><span class="nm">${esc(o.name)}<br><span class="meta">${where}</span></span><span class="q">× ${o.qty}</span></div>`; }).join('')}</div>
    <label class="f" style="margin-top:12px"><span>備註</span><input type="text" id="pn" placeholder="外觀、配件狀況…"></label>
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" id="pgo2">確認簽收</button></div>`, { wide: true, noFocus: true });
  const upd = () => unitLines.forEach(o => { const el = $(`[data-pc="${okey(o)}"]`, m); const n = pick[okey(o)].length; el.textContent = `已選 ${n} / ${o.qty}`; el.className = n === o.qty ? 'okt' : 'short'; });
  const toggle = (uid, force) => {
    const el = $(`[data-pick="${uid}"]`, m); if (!el) return false;
    const it = el.dataset.it, arr = pick[it], has = arr.includes(uid), o = unitLines.find(x => okey(x) === it);
    if (has && force !== true) arr.splice(arr.indexOf(uid), 1);
    else if (!has) { if (arr.length >= o.qty) { toast(o.name + ' 已選滿 ' + o.qty + ' 台,請先取消一台', true); return false; } arr.push(uid); }
    el.classList.toggle('on', arr.includes(uid)); upd(); return true;
  };
  if ($('#pauto', m)) $('#pauto', m).onclick = () => {
    unitLines.forEach(o => {
      pick[okey(o)].slice().forEach(uid => toggle(uid));
      o.units.slice(0, o.qty).forEach(u => toggle(u.id, true));
    });
    toast('已幫你選好,拿到的不是這幾台就自己改');
  };
  upd();
  $$('[data-pick]', m).forEach(el => el.onclick = () => toggle(el.dataset.pick));
  const sc = $('#pscan', m);
  if (sc) {
    sc.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const c = sc.value.trim().toUpperCase(); if (!toggle(c, true)) toast('這筆借用不能選 ' + c, true); sc.value = ''; } };
    $('#pcam', m).onclick = () => openScanner(code => { if (!toggle(code, true)) toast('不在可選清單:' + code, true); });
  }
  $('#pgo2', m).onclick = () => run(() => api('requestPickup', { id, units: pick, note: $('#pn', m).value })).then(() => onsiteModal(id, 'pickup')).catch(() => { });
}
async function userReturnModal(id) {
  const L = await myLoan(id);
  const open = L.lines.filter(l => l.outstanding > 0);
  const m = openModal(`<h2>歸還 ${esc(L.id)}</h2><p><b>${esc(L.event)}</b>・應還 ${esc(L.end)} ${L.overdue ? '<span class="pill bad">逾期</span>' : ''}</p>
    <div class="lines">${open.map(l => {
      const k = esc(lkey(l)), back = backSelect(l);
      if (l.mode === 'unit') {
        const pend = l.units.filter(u => !l.returnedUnits.includes(u) && !l.lostUnits.includes(u));
        return `<div class="line" style="display:block"><div class="row"><b style="flex:1">${esc(l.name)}</b>${back}</div>${pend.map(u => `<div class="row" style="margin:6px 0"><span class="mono" style="min-width:70px">${esc(u)}</span>
          <div class="seg" data-ru="${u}" data-it="${k}">${[['in', '歸還'], ['repair', '有損壞'], ['lost', '遺失'], ['', '先不還']].map(([kk, t], i) => `<button type="button" data-v="${kk}" class="${i === 0 ? 'on' : ''}">${t}</button>`).join('')}</div></div>`).join('')}</div>`;
      }
      return `<div class="line"><span class="nm">${esc(l.name)}<br><span class="meta">未還 ${l.outstanding}</span></span>${back}
        <label class="meta">歸還 <input type="number" min="0" max="${l.outstanding}" value="${l.outstanding}" data-rq="${k}" style="width:80px"></label>
        <label class="meta">短少 <input type="number" min="0" max="${l.outstanding}" value="0" data-rl="${k}" style="width:80px"></label></div>`;
    }).join('')}</div>
    <label class="f" style="margin-top:12px"><span>備註</span><input type="text" id="un2" placeholder="損壞狀況、短少原因…"></label>
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" id="ugo2">送出歸還</button></div>`, { wide: true, noFocus: true });
  $$('.seg[data-ru] button', m).forEach(b => b.onclick = () => { $$('button', b.parentNode).forEach(x => x.classList.remove('on')); b.classList.add('on'); });
  $('#ugo2', m).onclick = () => {
    const lines = open.map(l => { const k = lkey(l), to = backOf(m, k); return l.mode === 'unit'
      ? { itemId: l.itemId, location: nloc(l.location), to: to, unitResults: $$(`.seg[data-it="${k}"]`, m).map(sg => ({ id: sg.dataset.ru, result: $('button.on', sg).dataset.v })).filter(r => r.result) }
      : { itemId: l.itemId, location: nloc(l.location), to: to, returned: +$(`[data-rq="${k}"]`, m).value || 0, lost: +$(`[data-rl="${k}"]`, m).value || 0 }; });
    run(() => api('requestReturn', { id, lines, note: $('#un2', m).value })).then(() => onsiteModal(id, 'return')).catch(() => { });
  };
}
function onsiteModal(id, type) {
  const word = REQ_WORD[type] || '確認';
  const m = openModal(`<h2>請管理者當面確認${word}</h2>
    <p class="sub">把畫面交給展品管理者,輸入管理者工號與 PIN 即完成${word}。<br>管理者不在場也沒關係,已送出的申請會出現在管理者後台等待確認。</p>
    <form id="osf" autocomplete="off"><div class="grid2"><label class="f"><span>管理者工號</span><input type="text" name="emp" required></label><label class="f"><span>PIN</span><input type="password" name="pin" inputmode="numeric" required></label></div>
    <div class="modal-f"><button type="button" class="btn" data-act="close-render">稍後由管理者確認</button><button class="btn pri">確認${word}</button></div></form>`);
  $('#osf', m).onsubmit = e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    run(() => api('confirmOnSite', { id, emp: fd.emp, pin: fd.pin }), `已完成${word}`).then(() => { closeModal(); render(); }).catch(() => { });
  };
}
function lookupModal(code) {
  const m = openModal(`<h2>查詢編號</h2><div class="row"><input type="text" id="lkc" placeholder="單台編號(E0001)或品項編號(P0001)" style="flex:1" value="${esc(code || '')}"><button class="btn" id="lkcam">${ICON.scan}掃描</button><button class="btn pri" id="lkgo">查詢</button></div><div id="lkr" style="margin-top:14px"></div>`);
  const go = async c => {
    c = (c || $('#lkc', m).value).trim().toUpperCase(); if (!c) return;
    $('#lkc', m).value = c;
    const r = await api('lookup', { code: c }).catch(e => { $('#lkr', m).innerHTML = `<div class="banner bad">${esc(e.message)}</div>`; return null; });
    if (!r) return;
    if (r.type === 'item') { const i = r.item; $('#lkr', m).innerHTML = `<div class="card"><b>${esc(i.name)}</b><div class="meta">${esc(i.category)}・${esc(i.location)}</div><div class="nums"><div><b>${i.inStock}</b>在庫</div><div><b>${i.out}</b>出借中</div><div><b>${i.reserved}</b>已預約</div><div><b>${i.total}</b>總數</div></div></div>`; return; }
    const u = r.unit, L = r.loan;
    $('#lkr', m).innerHTML = `<div class="card"><div class="row"><b class="mono">${esc(u.id)}</b><span class="pill ${u.status}">${esc(r.statusLabel)}</span></div>
      <div style="margin:6px 0"><b>${esc(r.item.name)}</b>${u.serial ? '・序號 ' + esc(u.serial) : ''}</div><div class="meta">存放:${esc(u.location || r.item.location || '—')}${u.note ? '・' + esc(u.note) : ''}</div>
      ${L ? `<div class="banner ${L.overdue ? 'bad' : 'info'}" style="margin-top:10px">目前在 <b>${esc(L.applicant)}</b>${L.dept ? '(' + esc(L.dept) + ')' : ''} 手上<br>${esc(L.event)}・應還 ${esc(L.end)}${L.overdue ? '・已逾期 ' + L.overdueDays + ' 天' : ''}${L.contact ? '<br>聯絡:' + esc(L.contact) : ''}</div>` : ''}
      ${r.history.length ? `<h2 style="font-size:14px">借用歷史</h2><ul class="hist">${r.history.map(h => `<li>${esc(h.start)} → ${esc(h.end)}|${esc(h.applicant)}|${esc(h.event)}(${esc(h.statusLabel || h.status)})</li>`).join('')}</ul>` : ''}</div>`;
  };
  $('#lkgo', m).onclick = () => go();
  $('#lkc', m).onkeydown = e => { if (e.key === 'Enter') go(); };
  $('#lkcam', m).onclick = () => openScanner(c => { go(c); return false; });
  if (code) go(code);
}
function pinModal(forced) {
  const m = openModal(`<h2>${forced ? '首次登入請變更 PIN' : '變更 PIN'}</h2>${forced ? '<div class="banner warn" style="font-size:13px">這組 PIN 是別人幫你設定的,請改成只有你知道的 PIN 才能繼續使用。</div>' : ''}
    <label class="f"><span>目前 PIN</span><input type="password" id="op"></label><label class="f"><span>新 PIN(4–12 碼)</span><input type="password" id="np"></label><label class="f"><span>再輸入一次新 PIN</span><input type="password" id="np2"></label>
    <div class="modal-f">${forced ? '<button class="btn" id="pout">登出</button>' : '<button class="btn" data-act="close">取消</button>'}<button class="btn pri" id="pgo">變更</button></div>`, { locked: forced });
  if (forced) $('#pout', m).onclick = () => { closeModal(); logout(); };
  $('#pgo', m).onclick = () => {
    if ($('#np', m).value !== $('#np2', m).value) return toast('兩次輸入的新 PIN 不一致', true);
    run(() => api('changePin', { oldPin: $('#op', m).value, newPin: $('#np', m).value }), 'PIN 已變更').then(async () => {
      closeModal();
      if (forced) { S.user = await api('me'); store.set('user', S.user); enterApp(); }
    }).catch(() => { });
  };
}

