/* ===================== 借用單動作 ===================== */
async function getLoan(id) { const all = await api('loans', { filter: 'all' }); return all.find(l => l.id === id); }
/* ===================== 延期 / 轉借 / 改單 / 列印 ===================== */
const plusDays = (d, k) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() + k); return t.toISOString().slice(0, 10); };
const findLoan = id => (S._loans || []).find(l => l.id === id) || null;

/** 批次核准:一次核准多張,沒過的逐張說明原因 */
function bulkApprove(ids) {
  const m = openModal(`<h2>批次核准 ${ids.length} 張</h2>
    <p class="sub">數量不足的那幾張會被跳過,結束後會告訴你是哪幾張、為什麼。</p>
    <label class="f"><span>共同備註</span><input type="text" id="bn" placeholder="選填,會寫進每一張的審核備註"></label>
    <label class="chk"><input type="checkbox" id="bf">數量不足仍核准</label>
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn brand" id="bgo">確定核准</button></div>`);
  $('#bgo', m).onclick = async () => {
    const r = await run(() => api('approveMany', { ids, note: $('#bn', m).value, force: $('#bf', m).checked })).catch(() => null);
    if (!r) return;
    const rows = r.fail.map(f => '<div class="line"><span class="nm mono">' + esc(f.id) + '</span><span class="short">' + esc(f.error) + '</span></div>').join('');
    openModal(`<h2>批次核准結果</h2>
      <div class="banner ${r.fail.length ? 'warn' : 'ok'}">成功 ${r.ok} 張${r.fail.length ? ',有 ' + r.fail.length + ' 張沒過' : ''}。</div>
      ${rows ? '<h2>沒過的</h2><div class="lines">' + rows + '</div>' : ''}
      <div class="modal-f"><button class="btn pri" data-act="close-render">完成</button></div>`);
  };
}

/** 修改待審核的申請:把它載回「借用申請」繼續編輯 */
function editLoan(id) {
  const L = findLoan(id);
  if (!L) return toast('請重新整理這一頁', true);
  if (S.showPick) return toast('你正在為「' + S.showPick.name + '」挑展品,請先按「完成,回到展覽」', true);
  S.editing = { id: L.id, no: L.id };
  S.cart = L.lines.map(ln => ({ itemId: ln.itemId, location: ln.location || '', qty: ln.qty }));
  S.plan = { start: L.start, end: L.end };
  saveCart();
  store.set(uk('draft'), { event: L.event, venue: L.venue, note: L.note });
  go('plan');
}
function cancelEdit() { S.editing = null; S.cart = []; store.del(uk('draft')); saveCart(); go('mine'); }

/** 同仁申請延期 / 管理者直接延期 */
function extendModal(id, asAdmin) {
  const L = findLoan(id);
  if (!L) return toast('請重新整理這一頁', true);
  const m = openModal(`<h2>${asAdmin ? '延長歸還日' : '申請延長歸還日'} ${esc(id)}</h2>
    <p class="sub">${esc(L.event)}・目前歸還日 <b>${esc(L.end)}</b>。系統會檢查多出來的那一段期間還借不借得到。</p>
    <label class="f"><span>新的歸還日 <b>*</b></span><input type="date" id="xd" min="${esc(plusDays(L.end, 1))}" max="${esc(shiftDays(todayStr(), DATE_FWD_DAYS))}" value="${esc(plusDays(L.end, 7))}"></label>
    <label class="f"><span>說明</span><input type="text" id="xn" placeholder="例:展期延後一週"></label>
    ${asAdmin ? '<label class="chk"><input type="checkbox" id="xf">數量不足仍延期</label>' : ''}
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" id="xgo">${asAdmin ? '確定延期' : '送出申請'}</button></div>`);
  $('#xgo', m).onclick = () => {
    const end = $('#xd', m).value, note = $('#xn', m).value;
    if (!end) return toast('請選新的歸還日', true);
    const call = asAdmin
      ? api('extendLoan', { id, end, note, force: $('#xf', m) && $('#xf', m).checked })
      : api('requestExtend', { id, end, note });
    run(() => call, asAdmin ? '已延期' : '已送出,請等管理者確認')
      .then(() => { closeModal(); if (!asAdmin) onsiteModal(id, 'extend'); else render(); }).catch(() => { });
  };
}

/** 同仁申請把借用轉給別人 */
function transferModal(id) {
  const L = findLoan(id);
  if (!L) return toast('請重新整理這一頁', true);
  const m = openModal(`<h2>轉借 ${esc(id)}</h2>
    <p class="sub">${esc(L.event)}・目前借用人 <b>${esc(L.applicant)}</b>。轉出去之後歸還責任就在對方身上,逾期也算他的。</p>
    <label class="f"><span>要轉給誰(工號) <b>*</b></span><input type="text" id="td" autocapitalize="characters" placeholder="例:10477"></label>
    <label class="f"><span>說明</span><input type="text" id="tn" placeholder="例:我出差,後續由他負責"></label>
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" id="tgo">送出申請</button></div>`);
  $('#tgo', m).onclick = () => {
    const emp = $('#td', m).value.trim().toUpperCase();
    if (!emp) return toast('請填寫要轉給誰的工號', true);
    run(() => api('requestTransfer', { id, emp, note: $('#tn', m).value }), '已送出,請等管理者確認')
      .then(() => { closeModal(); onsiteModal(id, 'transfer'); }).catch(() => { });
  };
}

/** 管理者處理延期 / 轉借申請 */
function decideModal(id, agree) {
  const L = findLoan(id), req = L && L.request;
  if (!req) return toast('請重新整理這一頁', true);
  const what = req.type === 'extend' ? '延期' : '轉借';
  const detail = req.type === 'extend'
    ? '把歸還日從 ' + L.end + ' 延到 ' + req.end
    : '把借用人從 ' + L.applicant + ' 換成 ' + (req.toName || '');
  const m = openModal(`<h2>${agree ? '同意' : '不同意'}${what} ${esc(id)}</h2>
    <p class="sub">${esc(L.event)}・${esc(req.by)} 申請${esc(detail)}${req.note ? '(' + esc(req.note) + ')' : ''}</p>
    <label class="f"><span>${agree ? '備註' : '原因'}${agree ? '' : ' <b>*</b>'}</span><input type="text" id="dn"></label>
    ${agree && req.type === 'extend' ? '<label class="chk"><input type="checkbox" id="df">數量不足仍延期</label>' : ''}
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn ${agree ? 'pri' : 'danger'}" id="dgo">${agree ? '確定' : '不同意'}</button></div>`);
  $('#dgo', m).onclick = () => {
    const note = $('#dn', m).value;
    if (!agree && !note.trim()) return toast('請填寫原因', true);
    run(() => api('decideRequest', { id, ok: agree, note, force: $('#df', m) && $('#df', m).checked }), agree ? '已處理' : '已回覆')
      .then(() => { closeModal(); render(); }).catch(() => { });
  };
}

/** 把借用單印成一張可簽名的單據 */
function printLoan(id) {
  const L = findLoan(id);
  if (!L) return toast('請重新整理這一頁', true);
  const row = (k, v) => '<tr><th>' + esc(k) + '</th><td>' + esc(v || '—') + '</td></tr>';
  const lines = L.lines.map(ln => '<tr><td>' + esc(ln.name) + '</td><td>' + esc(nloc(ln.location)) + '</td><td>' + esc(ln.mode === 'unit' ? '逐台編號' : '數量') + '</td>'
    + '<td class="n">' + ln.qty + '</td><td>' + esc((ln.units || []).join('、')) + '</td></tr>').join('');
  const w = window.open('', '_blank', 'width=900,height=1000');
  if (!w) return toast('瀏覽器擋掉了列印視窗,請允許彈出視窗', true);
  w.document.write('<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><title>' + esc(L.id) + ' 借用單</title>'
    + '<style>body{font:14px/1.6 system-ui,"Noto Sans TC",sans-serif;color:#333F48;margin:36px;max-width:760px}'
    + 'h1{font-size:20px;margin:0 0 4px;color:#C8102E}.sub{color:#6b7280;font-size:12px;margin:0 0 18px}'
    + 'table{width:100%;border-collapse:collapse;margin-bottom:18px}th,td{border:1px solid #d8dce0;padding:7px 10px;text-align:left;vertical-align:top}'
    + 'th{background:#f4f5f7;width:96px;font-weight:600}td.n{text-align:right;width:56px}'
    + '.items th{width:auto;background:#f4f5f7}.sign{margin-top:36px;display:flex;gap:40px}'
    + '.sign div{flex:1;border-top:1px solid #333F48;padding-top:7px;font-size:12px;color:#6b7280}'
    + '@media print{body{margin:0}}' + PRINT_BAR_CSS + '</style></head><body>'
    + PRINT_BAR
    + '<h1>展品借用單 ' + esc(L.id) + '</h1><div class="sub">' + esc(L.statusLabel) + '・列印於 ' + esc(todayStr()) + '</div>'
    + '<table>' + row('活動', L.event) + row('借用人', L.applicant + (L.dept ? '・' + L.dept : '')) + row('聯絡', L.contact)
    + row('地點', L.venue) + row('用途', L.purpose) + row('期間', L.start + ' → ' + L.end)
    + row('點交', L.outAt) + row('歸還', L.returnedAt) + row('備註', L.note) + '</table>'
    + '<table class="items"><thead><tr><th>品名</th><th>取自</th><th>方式</th><th class="n">數量</th><th>單台編號</th></tr></thead><tbody>' + lines + '</tbody></table>'
    + '<div class="sign"><div>借用人簽名</div><div>展品管理者簽名</div></div>'
    + '</body></html>');
  w.document.close();
  setTimeout(() => w.print(), 300);
}

async function approveModal(id) {
  const L = await getLoan(id);
  const short = (L.check || []).filter(c => c.short);
  const m = openModal(`<h2>核准 ${esc(L.id)}</h2><p><b>${esc(L.event)}</b>・${esc(L.applicant)}・${esc(L.start)} → ${esc(L.end)}</p>
    ${short.length ? `<div class="banner bad">數量不足:${short.map(s => esc(s.name) + ' 缺 ' + s.short).join('、')}</div><label class="chk" style="margin-bottom:12px"><input type="checkbox" id="af">仍要核准(強制)</label>` : '<div class="banner ok">所有展品在期間內數量足夠</div>'}
    <label class="f"><span>給借用人的備註(選填)</span><input type="text" id="an" placeholder="例:請於 9:00 到湖口倉領取"></label>
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" id="ago">核准</button></div>`);
  $('#ago', m).onclick = async () => { await run(() => api('approve', { id, note: $('#an', m).value, force: $('#af', m) && $('#af', m).checked }), '已核准').then(() => { closeModal(); render(); }).catch(() => { }); };
}
function rejectModal(id) {
  const m = openModal(`<h2>駁回 / 取消 ${esc(id)}</h2><label class="f"><span>原因 <b>*</b></span><textarea id="rn" rows="3"></textarea></label>
    <div class="modal-f"><button class="btn" data-act="close">返回</button><button class="btn pri" id="rgo" style="background:var(--bad);border-color:var(--bad);color:#fff">確認駁回</button></div>`);
  $('#rgo', m).onclick = () => run(() => api('reject', { id, note: $('#rn', m).value }), '已駁回').then(() => { closeModal(); render(); }).catch(() => { });
}
async function checkoutModal(id) {
  const L = await getLoan(id);
  const unitLines = L.lines.filter(l => l.mode === 'unit');
  const pools = {}, byItem = {};
  await Promise.all([...new Set(unitLines.map(l => l.itemId))].map(async iid => { byItem[iid] = (await api('units', { itemId: iid })).filter(u => u.status === 'in'); }));
  unitLines.forEach(l => { pools[lkey(l)] = (byItem[l.itemId] || []).filter(u => nloc(u.location) === nloc(l.location)); });
  const pick = {}; unitLines.forEach(l => pick[lkey(l)] = []);
  const m = openModal(`<h2>${L.request ? '確認領取' : '點交出借'} ${esc(L.id)}</h2>${L.request ? `<div class="banner warn" style="font-size:13px">${esc(L.request.by)} 已送出簽收,以下為他選的編號,核對實物後確認。</div>` : ''}<p><b>${esc(L.event)}</b>・借用人 ${esc(L.applicant)}・應還 ${esc(L.end)}</p>
    ${unitLines.length ? `<div class="row" style="margin-bottom:10px"><input type="text" id="cscan" placeholder="輸入 / 刷編號後 Enter" style="flex:1"><button class="btn" id="ccam">${ICON.scan}掃描</button><button class="btn" id="cauto">自動指派</button></div>` : ''}
    <div class="lines">${L.lines.map(l => { const k = lkey(l), where = esc(nloc(l.location)); return l.mode === 'unit' ? `<div class="line" style="display:block"><div class="row"><b style="flex:1">${esc(l.name)} <span class="pill">${where}</span></b><span data-pc="${esc(k)}" class="short">已選 0 / ${l.qty}</span></div>
      <div class="chips">${pools[k].map(u => `<span class="chipk" data-pick="${u.id}" data-it="${esc(k)}">${esc(u.id)}${u.serial ? ' <small>' + esc(u.serial) + '</small>' : ''}</span>`).join('') || '<span class="short">' + where + ' 沒有在庫的單台</span>'}</div></div>`
      : `<div class="line"><span class="nm">${esc(l.name)}<br><span class="meta">${where}</span></span><span class="q">× ${l.qty}</span></div>`; }).join('')}</div>
    <label class="f" style="margin-top:12px"><span>點交備註</span><input type="text" id="cn" placeholder="外觀、配件狀況…"></label>
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" id="cgo">確認出借</button></div>`, { wide: true, noFocus: true });
  const upd = () => unitLines.forEach(l => { const el = $(`[data-pc="${lkey(l)}"]`, m); const n = pick[lkey(l)].length; el.textContent = `已選 ${n} / ${l.qty}`; el.className = n === +l.qty ? 'okt' : 'short'; });
  const toggle = (uid, force) => {
    const el = $(`[data-pick="${uid}"]`, m); if (!el) return false;
    const it = el.dataset.it, arr = pick[it], has = arr.includes(uid);
    const line = unitLines.find(l => lkey(l) === it);
    if (has && force !== true) arr.splice(arr.indexOf(uid), 1);
    else if (!has) { if (arr.length >= +line.qty) { toast(line.name + ' 已選滿', true); return false; } arr.push(uid); }
    el.classList.toggle('on', arr.includes(uid)); upd(); return true;
  };
  // 使用者已送出簽收 → 用他選的編號;否則自動挑前 N 台
  const preset = L.request && L.request.type === 'pickup' ? L.request.units || {} : null;
  const autoPick = () => {
    unitLines.forEach(l => {
      pick[lkey(l)].slice().forEach(uid => toggle(uid));                  // 先清掉
      pools[lkey(l)].slice(0, l.qty).forEach(u => toggle(u.id, true));
    });
    toast('已自動指派可用的編號,要換哪一台再自己點');
  };
  unitLines.forEach(l => (preset ? (preset[lkey(l)] || preset[l.itemId] || []) : pools[lkey(l)].slice(0, l.qty).map(u => u.id)).forEach(uid => toggle(uid)));
  if ($('#cauto', m)) $('#cauto', m).onclick = autoPick;
  $$('[data-pick]', m).forEach(el => el.onclick = () => toggle(el.dataset.pick));
  const sc = $('#cscan', m);
  if (sc) {
    sc.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); const c = sc.value.trim().toUpperCase(); if (!toggle(c, true)) toast('此單沒有可選的 ' + c, true); sc.value = ''; } };
    $('#ccam', m).onclick = () => {
      unitLines.forEach(l => { pick[lkey(l)].slice().forEach(u => toggle(u)); });
      openScanner(code => { if (!toggle(code, true)) toast('不在可選清單:' + code, true); });
    };
  }
  $('#cgo', m).onclick = () => run(() => api('checkout', { id, units: pick, note: $('#cn', m).value }), '已點交出借').then(() => { closeModal(); render(); }).catch(() => { });
}
/** 歸還時可以選還到哪個廠區(預設還回原本借出的那一點) */
function backSelect(l) {
  const here = nloc(l.location);
  const list = [...new Set([here].concat(SITES, allSites()))];
  return `<label class="meta">還到 <select data-back="${esc(lkey(l))}">${list.map(v => `<option${v === here ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;
}
function backOf(m, key) { const el = $(`[data-back="${key}"]`, m); return el ? el.value : ''; }

async function receiveModal(id) {
  const L = await getLoan(id);
  const open = L.lines.filter(l => l.outstanding > 0);
  const m = openModal(`<h2>${L.request ? '確認歸還' : '登記歸還'} ${esc(L.id)}</h2>${L.request ? `<div class="banner warn" style="font-size:13px">${esc(L.request.by)} 已送出歸還,以下為他填的狀況,核對實物後可修改再確認。</div>` : ''}<p><b>${esc(L.event)}</b>・${esc(L.applicant)}・應還 ${esc(L.end)} ${L.overdue ? '<span class="pill bad">逾期</span>' : ''}</p>
    <div class="lines">${open.map(l => {
      const k = esc(lkey(l)), back = backSelect(l);
      if (l.mode === 'unit') {
        const pend = l.units.filter(u => !l.returnedUnits.includes(u) && !l.lostUnits.includes(u));
        return `<div class="line" style="display:block"><div class="row"><b style="flex:1">${esc(l.name)}</b>${back}</div>${pend.map(u => `<div class="row" style="margin:6px 0"><span class="mono" style="min-width:70px">${esc(u)}</span>
          <div class="seg" data-ru="${u}" data-it="${k}">${[['in', '歸還'], ['repair', '送修'], ['lost', '遺失'], ['', '未還']].map(([kk, t], i) => `<button type="button" data-v="${kk}" class="${i === 0 ? 'on' : ''}">${t}</button>`).join('')}</div></div>`).join('')}</div>`;
      }
      // 損壞是「還回來了但壞了」,是歸還數裡面的子集,所以上限綁在歸還數上
      return `<div class="line"><span class="nm">${esc(l.name)}<br><span class="meta">未還 ${l.outstanding}</span></span>${back}
        <label class="meta">歸還 <input type="number" min="0" max="${l.outstanding}" value="${l.outstanding}" data-rq="${k}" style="width:80px"></label>
        <label class="meta">其中損壞 <input type="number" min="0" max="${l.outstanding}" value="0" data-rd="${k}" style="width:80px"></label>
        <label class="meta">短少 <input type="number" min="0" max="${l.outstanding}" value="0" data-rl="${k}" style="width:80px"></label></div>`;
    }).join('')}</div>
    <label class="f" style="margin-top:12px"><span>備註</span><input type="text" id="rn2" placeholder="損壞狀況、短少原因…"></label>
    <p class="meta">「未還」的項目會保留在借用單上,之後可再登記。</p>
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" id="rgo2">確認</button></div>`, { wide: true, noFocus: true });
  $$('.seg[data-ru] button', m).forEach(b => b.onclick = () => { $$('button', b.parentNode).forEach(x => x.classList.remove('on')); b.classList.add('on'); });
  if (L.request && L.request.type === 'return') {
    const rq = {}; (L.request.lines || []).forEach(x => { rq[x.itemId + '@' + nloc(x.location)] = x; if (!(x.itemId in rq)) rq[x.itemId] = x; });
    $$('.seg[data-ru]', m).forEach(sg => {
      const x = rq[sg.dataset.it] || rq[String(sg.dataset.it).split('@')[0]], r = x && (x.unitResults || []).find(u => u.id === sg.dataset.ru);
      const v = r ? r.result : '';
      $$('button', sg).forEach(b => b.classList.toggle('on', b.dataset.v === v));
    });
    open.filter(l => l.mode !== 'unit').forEach(l => { const x = rq[lkey(l)] || rq[l.itemId] || { returned: 0, lost: 0 }; $(`[data-rq="${lkey(l)}"]`, m).value = x.returned || 0; $(`[data-rl="${lkey(l)}"]`, m).value = x.lost || 0; });
  }
  $('#rgo2', m).onclick = () => {
    const lines = open.map(l => { const k = lkey(l), to = backOf(m, k); return l.mode === 'unit'
      ? { itemId: l.itemId, location: nloc(l.location), to: to, unitResults: $$(`.seg[data-it="${k}"]`, m).map(sg => ({ id: sg.dataset.ru, result: $('button.on', sg).dataset.v })).filter(r => r.result) }
      : { itemId: l.itemId, location: nloc(l.location), to: to, returned: +$(`[data-rq="${k}"]`, m).value || 0,
          damaged: +$(`[data-rd="${k}"]`, m).value || 0, lost: +$(`[data-rl="${k}"]`, m).value || 0 }; });
    const over = lines.find(x => (x.damaged || 0) > (x.returned || 0));
    if (over) return toast('「其中損壞」不能大於「歸還」的數量', true);
    run(() => api('receive', { id, lines, note: $('#rn2', m).value })).then(r => { toast(r.status === 'returned' ? '已全部歸還' : '已登記部分歸還'); closeModal(); render(); }).catch(() => { });
  };
}

