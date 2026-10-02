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

/** 管理者直接延期。v3.0 之後同仁沒有「申請延期」這條路,要延期就跟管理者說 */
function extendModal(id) {
  const L = findLoan(id);
  if (!L) return toast('請重新整理這一頁', true);
  const m = openModal(`<h2>延長歸還日 ${esc(id)}</h2>
    <p class="sub">${esc(L.event)}・目前歸還日 <b>${esc(L.end)}</b>。系統會檢查多出來的那一段期間還借不借得到。</p>
    <label class="f"><span>新的歸還日 <b>*</b></span><input type="date" id="xd" min="${esc(plusDays(L.end, 1))}" max="${esc(shiftDays(todayStr(), DATE_FWD_DAYS))}" value="${esc(plusDays(L.end, 7))}"></label>
    <label class="f"><span>說明</span><input type="text" id="xn" placeholder="例:展期延後一週"></label>
    <label class="chk"><input type="checkbox" id="xf">數量不足仍延期</label>
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" id="xgo">確定延期</button></div>`);
  $('#xgo', m).onclick = () => {
    const end = $('#xd', m).value, note = $('#xn', m).value;
    if (!end) return toast('請選新的歸還日', true);
    run(() => api('extendLoan', { id, end, note, force: $('#xf', m) && $('#xf', m).checked }), '已延期')
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
    + row('出借', L.outAt) + row('歸還', L.returnedAt) + row('備註', L.note) + '</table>'
    + '<table class="items"><thead><tr><th>品名</th><th>取自</th><th>方式</th><th class="n">數量</th><th>單台編號</th></tr></thead><tbody>' + lines + '</tbody></table>'
    + '<div class="sign"><div>借用人簽名</div><div>展品管理者簽名</div></div>'
    + '</body></html>');
  w.document.close();
  setTimeout(() => w.print(), 300);
}

async function approveModal(id) {
  const L = await getLoan(id);
  const short = (L.check || []).filter(c => c.short);
  /**
   * v3.0 起**核准就是出借**:按下去的那一刻單子變成「出借中」、庫存立刻扣掉、
   * 逐台編號也當場綁定。這跟以前「核准 → 之後再點交」差很多,
   * 所以這裡一定要講明白 —— 不然會有人在東西還沒交出去的時候就先按核准。
   */
  const m = openModal(`<h2>核准 ${esc(L.id)}</h2><p><b>${esc(L.event)}</b>・${esc(L.applicant)}・${esc(L.start)} → ${esc(L.end)}</p>
    <div class="banner warn" style="font-size:13px">核准之後這張單<b>直接變成「出借中」</b>:庫存立刻扣掉,逐台編號也會當場綁好。
      請先確認東西真的在架上、人也來拿了再按。</div>
    ${short.length ? `<div class="banner bad">數量不足:${short.map(s => esc(s.name) + ' 缺 ' + s.short).join('、')}</div><label class="chk" style="margin-bottom:12px"><input type="checkbox" id="af">仍要核准(強制)</label>` : '<div class="banner ok">所有展品在期間內數量足夠</div>'}
    <label class="f"><span>給借用人的備註(選填)</span><input type="text" id="an" placeholder="例:附件與電源線一起帶走了"></label>
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" id="ago">核准,直接出借</button></div>`);
  $('#ago', m).onclick = async () => { await run(() => api('approve', { id, note: $('#an', m).value, force: $('#af', m) && $('#af', m).checked }), '核准完成,展品已交付').then(() => { closeModal(); render(); }).catch(() => { }); };
}
/**
 * 同一條後端路由(reject)被兩種情境共用:待審核的「駁回」、出借中的「取消核准」。
 * 文案不分開的話,按了「取消核准」卻跳出「確認駁回」、成功訊息也寫「已駁回」——
 * 而「東西會被收回來」這件最重要的事反而沒人講。
 */
function rejectModal(id) {
  const L = findLoan(id), back = L && L.status === 'out';
  const m = openModal(`<h2>${back ? '取消核准' : '駁回'} ${esc(id)}</h2>
    ${back ? `<div class="banner warn" style="font-size:13px">這張單已經是「出借中」,取消核准等於<b>把東西收回來</b>:
      綁定的單台編號會放回架上,數量也會還原。<br>已經登記過歸還或短少的單不能這樣取消,請改用「登記歸還」把剩下的登記完。</div>` : ''}
    <label class="f"><span>原因 <b>*</b></span><textarea id="rn" rows="3"></textarea></label>
    <div class="modal-f"><button class="btn" data-act="close">返回</button><button class="btn pri" id="rgo" style="background:var(--bad);border-color:var(--bad);color:#fff">${back ? '確認取消核准' : '確認駁回'}</button></div>`);
  $('#rgo', m).onclick = () => run(() => api('reject', { id, note: $('#rn', m).value }), back ? '已取消核准,東西放回架上' : '已駁回')
    .then(() => { closeModal(); render(); }).catch(() => { });
}
function backSelect(l) {
  const here = nloc(l.location);
  const list = [...new Set([here].concat(SITES, allSites()))];
  return `<label class="meta">還到 <select data-back="${esc(lkey(l))}">${list.map(v => `<option${v === here ? ' selected' : ''}>${esc(v)}</option>`).join('')}</select></label>`;
}
function backOf(m, key) { const el = $(`[data-back="${key}"]`, m); return el ? el.value : ''; }

async function receiveModal(id) {
  const L = await getLoan(id);
  const open = L.lines.filter(l => l.outstanding > 0);
  const m = openModal(`<h2>登記歸還 ${esc(L.id)}</h2><p><b>${esc(L.event)}</b>・${esc(L.applicant)}・應還 ${esc(L.end)} ${L.overdue ? '<span class="pill bad">逾期</span>' : ''}</p>
    ${open.some(l => l.mode !== 'unit') ? `<div class="banner info" style="font-size:13px">
      <b>東西沒有全部回來?把「歸還」的數字改小就好。</b>剩下的會留在這張單上,單子停在「出借中」,之後再登記一次。<br>
      <b>「短少」是確定東西不見了</b> —— 會直接把庫存扣掉,而且<b>不能反悔</b>(要補回來只能走盤點)。還沒確定之前請留在「未還」。
    </div>` : ''}
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
        <label class="meta">短少 <input type="number" min="0" max="${l.outstanding}" value="0" data-rl="${k}" style="width:80px"></label>
        <span data-rest="${k}" class="meta" style="min-width:92px;text-align:right"></span></div>`;
    }).join('')}</div>
    <label class="f" style="margin-top:12px"><span>備註</span><input type="text" id="rn2" placeholder="損壞狀況、短少原因…"></label>
    <p class="meta">逐台編號的展品:每一台選「未還」就會留在單子上,之後再登記。</p>
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" id="rgo2">確認</button></div>`, { wide: true, noFocus: true });
  $$('.seg[data-ru] button', m).forEach(b => b.onclick = () => { $$('button', b.parentNode).forEach(x => x.classList.remove('on')); b.classList.add('on'); });
  /**
   * 數量型的「部分歸還」本來就做得到(把歸還改小就好),但畫面上完全沒講 ——
   * 使用者回報「只能寫短少」(2026-10-02)。猜錯的那條路很傷:
   * 把剩下的填進短少會直接扣庫存,而且不能反悔。
   * 所以這裡即時算出「這次之後還欠幾個」,讓那個數字自己說話。
   */
  const qtyLines = open.filter(l => l.mode !== 'unit');
  const drawRest = () => qtyLines.forEach(l => {
    const k = lkey(l), el = $(`[data-rest="${k}"]`, m);
    if (!el) return;
    const left = l.outstanding - (+$(`[data-rq="${k}"]`, m).value || 0) - (+$(`[data-rl="${k}"]`, m).value || 0);
    el.textContent = left > 0 ? '還欠 ' + left : left === 0 ? '這項還清' : '超過 ' + (-left);
    el.className = left > 0 ? 'meta' : left === 0 ? 'okt' : 'short';
  });
  $$('[data-rq],[data-rl]', m).forEach(i => i.oninput = drawRest);
  drawRest();
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

