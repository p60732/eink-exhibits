/* ===================== 事件分派 ===================== */
const ACT = {
  'go': el => { closeModal(); if (el.dataset.f === 'approved') S.loanFilter = 'approved'; go(el.dataset.v); },
  'go-loans': el => { S.loanFilter = el.dataset.f; go('loans'); },
  'open-loan': el => { S.loanFilter = el.dataset.st; if (/逾期/.test(el.textContent)) S.loanFilter = 'overdue'; if (/待確認/.test(el.textContent)) S.loanFilter = 'request'; S._focusLoan = el.dataset.id; go('loans'); },
  'lf': el => { S.loanFilter = el.dataset.f; render(); },
  /**
   * 單張借用單的收合。只動 DOM,不重畫 —— 重畫要再跑一次篩選與排版,
   * 點一下等半秒就太鈍了,而且畫面會閃一下。
   */
  'loan-fold': el => {
    const id = el.dataset.id, card = el.closest('.loan');
    const open = !S.openLoans.has(id);
    open ? S.openLoans.add(id) : S.openLoans.delete(id);
    if (card) card.classList.toggle('open', open);
    el.textContent = open ? '−' : '+';
    el.setAttribute('aria-expanded', String(open));
    el.setAttribute('aria-label', (open ? '收合' : '展開') + '這張單的細項');
    el.title = open ? '收合細項' : '展開細項';
  },
  /** 一次展開 / 收合畫面上所有的單 */
  'loan-foldall': () => {
    const cards = $$('.loan');
    const anyClosed = cards.some(c => !c.classList.contains('open'));
    cards.forEach(c => {
      const b = $('[data-act=loan-fold]', c); if (!b) return;
      const id = b.dataset.id;
      anyClosed ? S.openLoans.add(id) : S.openLoans.delete(id);
      c.classList.toggle('open', anyClosed);
      b.textContent = anyClosed ? '−' : '+';
      b.setAttribute('aria-expanded', String(anyClosed));
    });
    const t = $('[data-act=loan-foldall]'); if (t) t.textContent = anyClosed ? '全部收合' : '全部展開';
  },
  // 封存過的舊單預設收起來,點一下展開(含歷史資料時才會出現這一條)
  'hist-toggle': () => { S.histOpen = !S.histOpen; render(); },
  'close': () => closeModal(),
  'close-render': () => { closeModal(); render(); },
  // 總覽:展開 / 收起各廠區的數字。再點同一塊磚就收起來
  'site-break': el => { const f = el.dataset.f; S.dashSite = (f && S.dashSite === f) ? '' : f; drawSiteBreak(); },
  'site-go': el => { S.filters.loc = el.dataset.loc; S.filters.cat = ''; go('catalog'); },
  'export': () => run(exportStock),
  'logs-csv': () => exportLogs(),
  'add-cart': el => {
    const id = el.dataset.id, q = $('#q-' + id).value, where = ($('#loc-' + id) || {}).value || '';
    addToCart(id, q, where);
    toast('已加入借用申請' + (where ? '(' + where + ')' : ''));
    el.textContent = `加入申請(已選 ${S.cart.filter(c => c.itemId === id).reduce((a, c) => a + c.qty, 0)})`;
  },
  'use-range': () => { S.plan.start = S.filters.start; S.plan.end = S.filters.end; saveCart(); go('plan'); },
  'rm-cart': el => { S.cart = S.cart.filter(c => ckey(c) !== el.dataset.id); saveCart(); S.cart.length ? S._recheck() : render(); },
  'cq': el => { const c = S.cart.find(x => ckey(x) === el.dataset.id); c.qty = Math.max(1, c.qty + +el.dataset.d); saveCart(); S._recheck(); },
  /* ---- 展覽檔期 ---- */
  'show-new': () => { S.showId = 'new'; S.showLines = []; go('shows'); },
  'show-open': el => { S.showId = el.dataset.id; S.showLines = null; go('shows'); },
  'show-back': () => { S.showId = null; S.showLines = null; S.showPick = null; store.del(uk('showpick')); store.del(uk('showlines')); render(); },
  'show-filter': el => { S.showFilter = el.dataset.f; render(); },
  /** 去目錄挑選:檔期已經定好,目錄會直接用那個區間算可借量 */
  /**
   * 去目錄挑選。先把表單存起來再走 ——
   * 不存的話目錄會用「後端那一版」的舊檔期算可借量,而且使用者剛改的場地/日期會在回來時被蓋掉。
   */
  'show-pick': async () => {
    if (S.editing) return toast('你正在修改申請 ' + S.editing.no + ',請先儲存或放棄再來挑展品', true);
    const f = $('#shform');
    if (!f) return;
    const fd = Object.fromEntries(new FormData(f));
    if (!fd.name || !fd.from || !fd.to) return toast('請先填好名稱與檔期起訖', true);
    const saved = await run(() => api('saveShow', { show: { ...fd, id: S.showId === 'new' ? '' : S.showId, lines: showDraftLines() } })).catch(() => null);
    if (!saved) return;
    S.showId = saved.id;
    S.showLines = saved.lines.map(l => ({ itemId: l.itemId, location: l.location, qty: l.qty, note: l.note || '' }));
    S.showPick = { id: saved.id, name: saved.name, from: saved.from, to: saved.to };
    store.set(uk('showpick'), S.showPick);
    saveShowLines();
    go('catalog');
  },
  'show-add-cat': el => {
    const id = el.dataset.id, q = Math.max(1, parseInt(($('#q-' + id) || {}).value, 10) || 1);
    const where = (($('#loc-' + id) || {}).value || '').trim() || '未指定';
    S.showLines = mergeShowLines(S.showLines || [], [{ itemId: id, location: where, qty: q, note: '' }]);
    saveShowLines();
    toast('已加入展覽' + (where !== '未指定' ? '(' + where + ')' : ''));
    S._catDraw();
  },
  /**
   * 挑完直接存檔,不留「還沒存的清單」這種狀態。
   * 存檔前先跟後端要一次現況 —— 中途重新整理過的話記憶體裡沒有場地 / 承辦人,
   * 拿空值寫回去會把那幾欄清掉。只有這次挑的「清單」是我們要覆蓋的東西。
   */
  'show-pick-done': async () => {
    const p2 = S.showPick;
    const cur = await run(() => api('show', { id: p2.id })).catch(() => null);
    if (!cur) {                                         // 這一場已經不存在了,留在挑選模式只會卡住
      exitPick(); S.showId = null; S.showLines = null;
      return go('shows');
    }
    const ok = await run(() => api('saveShow', { show: {
      id: cur.id, name: cur.name, from: cur.from, to: cur.to,
      venue: cur.venue, owner: cur.owner, note: cur.note, lines: showDraftLines()
    } }), '已加入需求清單').catch(() => null);
    if (!ok) return;                                    // 存不進去就別把挑好的東西丟掉
    S.showPick = null; store.del(uk('showpick')); store.del(uk('showlines'));
    S.showId = p2.id; S.showLines = null;
    go('shows');
  },
  'show-rm': el => { S.showLines.splice(+el.dataset.i, 1); saveShowLines(); S._showRecheck(); },
  'show-paste': () => showPasteDialog(),
  'show-paste-ok': () => {
    const r = parsePaste($('#sp-txt').value);
    if (r.lines.length) S.showLines = mergeShowLines(S.showLines || [], r.lines);
    if (r.bad.length) {
      // 對不到的行留在畫面上讓人修,不要整批退回
      $('#sp-out').innerHTML = `<div class="banner bad" style="margin-top:10px"><b>有 ${r.bad.length} 行對不到</b>(其餘 ${r.lines.length} 行已加入):<br>`
        + r.bad.map(b => `第 ${b.n} 行「${esc(b.text)}」— ${esc(b.why)}`).join('<br>') + `</div>`;
      $('#sp-txt').value = r.bad.map(b => b.text).join('\n');
    } else closeModal();
    if (r.lines.length) toast('已加入 ' + r.lines.length + ' 項');
    saveShowLines(); S._showRecheck();
  },
  'show-status': async el => {
    const st = el.dataset.s;
    const ask = { confirmed: '確認檔期?確認之後,還沒開單的部分會先幫你卡住,別場借不走。',
      draft: '改回規劃中?卡住的部分會全部釋放。', closed: '結案?底下的借用單必須都已經結束。',
      cancelled: '取消這場展覽?卡住的部分會全部釋放。' }[st];
    if (!confirmInline(ask)) return;
    try {
      await api('setShowStatus', { id: S.showId, status: st });
      toast('已更新');
      if (st === 'closed' || st === 'cancelled') exitPick();   // 結案 / 取消之後清單不能再改,挑選模式要收掉
      S.showLines = null; render();
    } catch (e) {
      // 有缺口不直接擋,但要管理者明確認帳(後端會把缺口寫進異動紀錄)
      if (st === 'confirmed' && /缺/.test(e.message)) {
        return openModal(`<h2>這個檔期有缺口</h2><p>${esc(e.message)}</p>
          <div class="modal-f"><button class="btn" data-act="close">回去調整</button>
          <button class="btn pri" data-act="show-force">知道有缺口,仍要確認</button></div>`);
      }
      if (!e.silent) toast(e.message, true);
    }
  },
  'show-force': async () => {
    closeModal();
    await run(() => api('setShowStatus', { id: S.showId, status: 'confirmed', force: true }), '已確認檔期(有缺口)').catch(() => { });
    S.showLines = null; render();
  },
  'show-gen': async () => {
    if (!confirmInline('依地點產生借用單?每個還需要開單的地點各開一張,直接成為已核准。')) return;
    const r = await run(() => api('createLoansFromShow', { id: S.showId })).catch(() => null);
    if (!r) return;
    S.showLines = null;
    const ids = r.ids.join('、');
    openModal(`<h2>已產生 ${r.ok} 張借用單</h2>${ids ? `<p class="mono">${esc(ids)}</p>` : ''}
      ${r.fail.length ? `<div class="banner bad">有 ${r.fail.length} 個地點沒成功:<br>`
        + r.fail.map(f => esc(f.location) + ':' + esc(f.error)).join('<br>') + '</div>' : ''}
      <div class="modal-f"><button class="btn pri" data-act="close-render">知道了</button></div>`);
  },
  'show-del': () => {
    if (!confirmInline('刪除這場展覽?此動作無法復原。')) return;
    run(() => api('deleteShow', { id: S.showId }), '已刪除')
      .then(() => { exitPick(); S.showId = null; S.showLines = null; render(); }).catch(() => { });
  },
  /** 匯出結算清單:未歸還的要追討,通常是丟進 Excel 逐項對 */
  'settle-csv': () => {
    const SE = S._settle;
    if (!SE) return toast('沒有結算資料', true);
    const nm = SE.name || '';
    downloadCSV(`展後結算_${nm}_${todayStr()}.csv`,
      [['展覽', nm], ['檔期', (SE.from || '') + ' ~ ' + (SE.to || '')], ['場地', SE.venue || ''], ['產生日', todayStr()], [],
       ['展品編號', '品名', '廠區', '規劃', '實際借出', '已歸還', '短少', '未歸還', '借用單']]
        .concat((SE.lines || []).map(r => [r.itemId, r.name, r.location, r.planned, r.issued, r.returned, r.lost, r.unreturned, (r.loans || []).join(' ')]))
        .concat([['', '合計', '', SE.totals.planned, SE.totals.issued, SE.totals.returned, SE.totals.lost, SE.totals.unreturned, '']]));
  },
  /** 批次登記歸還:撤場時一次把底下出借中的單都結案(v3.0 之後沒有「申請歸還」這一步了)*/
  'show-return': async () => {
    const v = await cachedGet('show|' + S.showId, 'show', { id: S.showId });
    const out = (v.loans || []).filter(L => L.status === 'out');
    if (!out.length) return toast('底下沒有出借中的借用單', true);
    openModal(`<h2>批次登記歸還</h2>
      <p class="meta">預設整批全還、還回原本借出的廠區,送出之後這幾張單就結案了,申請人會收到 Email。
        要改數量、標短少或損壞,請改用每張單自己的「登記歸還」。</p>
      ${out.map(L => `<label class="chk"><input type="checkbox" class="sr-id" value="${esc(L.id)}" checked>
        <span class="mono">${esc(L.id)}</span> ${esc(L.applicant)}・${L.lines.length} 項</label>`).join('')}
      <label class="f" style="margin-top:8px"><span>備註</span><input type="text" id="sr-note" value="撤場" maxlength="100"></label>
      <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" data-act="show-return-ok">登記歸還</button></div>`);
  },
  'show-return-ok': async () => {
    const ids = $$('.sr-id').filter(c => c.checked).map(c => c.value);
    if (!ids.length) return toast('請先勾選要登記歸還的借用單', true);
    const r = await run(() => api('returnMany', { id: S.showId, ids: ids, note: $('#sr-note').value })).catch(() => null);
    if (!r) return;
    closeModal();
    toast('已登記歸還 ' + r.ok + ' 張' + (r.fail.length ? ',' + r.fail.length + ' 張沒成功' : ''));
    S.showLines = null;
    if (r.fail.length) openModal(`<h2>有 ${r.fail.length} 張沒送出</h2>
      <div class="banner bad">${r.fail.map(f => esc(f.id) + ':' + esc(f.error)).join('<br>')}</div>
      <div class="modal-f"><button class="btn pri" data-act="close-render">知道了</button></div>`);
    else render();
  },
  /** 整理歷史:一定要先看清楚會搬走什麼,再按下去 */
  'arch-open': async () => {
    const pv = await run(() => api('archivePreview', { includePlain: true })).catch(() => null);
    if (!pv) return;
    S._arch = pv;
    const showBits = pv.shows.map(x => `<label class="chk"><input type="checkbox" class="ar-s" value="${esc(x.id)}" checked>
      <b>${esc(x.name)}</b> <span class="meta">${fmtD(x.from)}~${fmtD(x.to)} · ${x.ids.length} 張</span></label>`).join('');
    openModal(`<h2>整理歷史單</h2>
      <p class="meta">把已經結束的舊借用單搬到「借用單歷史」工作表,讓平常翻單快一點。
        <b>只有「已結案展覽底下」而且本身已經結束(已歸還 / 已取消 / 已駁回)的單會被搬。</b>
        搬過去的單還查得到 —— 在借用單頁勾「含歷史資料」就會一起列出來。</p>
      <div class="banner warn">搬完之後,那幾場展覽就不能再重新開啟了(結算會改看結案當下的快照)。</div>
      ${pv.shows.length ? `<div style="margin-top:8px"><b>已結案的展覽</b>${showBits}</div>`
        : '<div class="meta" style="margin-top:8px">目前沒有已結案展覽的單可以搬。</div>'}
      ${pv.plain.length ? `<label class="chk" style="margin-top:8px"><input type="checkbox" id="ar-plain">
        一併搬走沒掛展覽的一般舊單(${pv.plain.length} 張)</label>` : ''}
      <div class="modal-f"><button class="btn" data-act="close">取消</button>
        <button class="btn pri" data-act="arch-go" ${pv.total ? '' : 'disabled'}>搬走選取的單</button></div>`);
  },
  'arch-go': async () => {
    const pv = S._arch || { shows: [], plain: [] };
    const on = new Set($$('.ar-s').filter(c => c.checked).map(c => c.value));
    let ids = pv.shows.filter(x => on.has(x.id)).reduce((a, x) => a.concat(x.ids), []);
    const plain = !!($('#ar-plain') && $('#ar-plain').checked);
    if (plain) ids = ids.concat(pv.plain);
    if (!ids.length) return toast('請先勾選要搬走的項目', true);
    if (!confirmInline(`要把 ${ids.length} 張借用單搬到歷史工作表嗎?`)) return;
    const r = await run(() => api('archiveLoans', { ids, includePlain: plain })).catch(() => null);
    if (!r) return;
    closeModal();
    openModal(`<h2>已搬走 ${r.moved} 張</h2>
      ${r.skipped ? `<p class="meta">另有 ${r.skipped} 張本來就已經在歷史表裡(上次搬到一半中斷過),這次跳過。</p>` : ''}
      <p class="meta">要查這些單,請在借用單頁勾選「含歷史資料」。</p>
      <div class="modal-f"><button class="btn pri" data-act="close-render">知道了</button></div>`);
  },
  /** 缺口是誰佔著:最早還的排最前面,那通常就是最喬得動的那一張 */
  'who': async el => {
    const itemId = el.dataset.i, where = el.dataset.w;
    // 展覽頁用展覽檔期,借用申請頁用購物車上的日期
    const inShow = S.view === 'shows' && S.showId && S.showId !== 'new';
    const f = inShow ? $('#shform') : null;
    const from = f ? new FormData(f).get('from') : S.plan.start;
    const to = f ? new FormData(f).get('to') : S.plan.end;
    if (!from || !to) return toast('請先填好日期', true);
    const r = await run(() => api('holders', { itemId, location: where, from, to,
      excludeId: S.editing ? S.editing.id : '', excludeShowId: inShow ? S.showId : '' })).catch(() => null);
    if (!r) return;
    const line = (a, b) => `<div class="list-row"><div class="t">${a}</div>${b}</div>`;
    const loans = r.loans.map(L => {
      const who = L.applicant ? `${esc(L.applicant)}${L.dept ? '・' + esc(L.dept) : ''}` : '(借用人僅管理者可見)';
      const ev = L.event ? ' — ' + esc(L.event) : '';
      return line(`<div><span class="mono">${esc(L.id)}</span> ${esc(L.statusLabel)}${L.overdue ? ' <span class="short">逾期</span>' : ''}</div>
        <div class="meta">${who}${ev}<br>${fmtD(L.start)} → ${fmtD(L.end)} 歸還</div>`, `<b>${L.qty}</b>`);
    }).join('');
    const shows = r.shows.map(x => line(`<div>${esc(x.name)} <span class="pill approved">展覽卡位</span></div>
      <div class="meta"><span class="mono">${esc(x.id)}</span>・${fmtD(x.from)} ~ ${fmtD(x.to)}</div>`, `<b>${x.qty}</b>`)).join('');
    const at = where ? '(' + where + ')' : '';          // 純文字,插值前先算進區域變數
    openModal(`<h2>${esc(r.name)}${esc(at)} 是誰佔著</h2>
      <p class="meta">${esc(from)} ~ ${esc(to)}・總共 ${r.capacity} 台,這段期間還借得到 <b>${r.available}</b> 台。</p>
      ${loans ? `<div style="margin-top:10px"><b>借用單佔 ${r.loanQty} 台</b><div class="meta" style="margin:4px 0">依歸還日排序,最早還的在最上面。</div>${loans}</div>` : ''}
      ${shows ? `<div style="margin-top:14px"><b>其他展覽卡著 ${r.showQty} 台</b><div class="meta" style="margin:4px 0">這些是還沒開成借用單、被展覽先卡住的部分。</div>${shows}</div>` : ''}
      ${!loans && !shows ? '<div class="banner info">沒有人佔著 —— 這個品項在這個廠區本來就沒有那麼多台,要補只能進貨。</div>' : ''}
      <div class="modal-f"><button class="btn pri" data-act="close">知道了</button></div>`);
  },
  'sheet-print': async () => {
    const d = await run(() => api('showSheet', { id: S.showId })).catch(() => null);
    if (d) printShowSheet(d);
  },
  'sheet-csv': async () => {
    const d = await run(() => api('showSheet', { id: S.showId })).catch(() => null);
    if (d) showSheetCSV(d);
  },
  'show-extend': async () => {
    const v = await cachedGet('show|' + S.showId, 'show', { id: S.showId });
    const live = (v.loans || []).filter(L => ['approved', 'out'].includes(L.status));
    if (!live.length) return toast('底下沒有可以延期的借用單(只有已核准 / 出借中的單能延)', true);
    const newEnd = esc(v.to);
    openModal(`<h2>批次延期</h2>
      <p class="meta">改檔期不會自動改單。勾選要一起延的,系統會逐張檢查延長那一段的庫存,一張失敗不影響其他張。</p>
      <label class="f"><span>新的歸還日</span><input type="date" id="se-end" ${DLIM()} value="${newEnd}"></label>
      ${live.map(L => `<label class="chk"><input type="checkbox" class="se-id" value="${esc(L.id)}" ${L.end < v.to ? 'checked' : ''}>
        <span class="mono">${esc(L.id)}</span> ${esc(L.applicant)}・${fmtD(L.start)} → ${fmtD(L.end)}</label>`).join('')}
      <label class="chk" style="margin-top:8px"><input type="checkbox" id="se-force">庫存不足仍延期</label>
      <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" data-act="show-extend-ok">送出</button></div>`);
  },
  'show-extend-ok': async () => {
    const ids = $$('.se-id').filter(c => c.checked).map(c => c.value);
    if (!ids.length) return toast('請先勾選要延期的借用單', true);
    const r = await run(() => api('extendMany', { ids: ids, end: $('#se-end').value, note: '展期延長', force: $('#se-force').checked })).catch(() => null);
    if (!r) return;
    closeModal();
    toast('已延期 ' + r.ok + ' 張' + (r.fail.length ? ',' + r.fail.length + ' 張沒成功' : ''));
    S.showLines = null;
    if (r.fail.length) openModal(`<h2>有 ${r.fail.length} 張沒延成功</h2>
      <div class="banner bad">${r.fail.map(f => esc(f.id) + ':' + esc(f.error)).join('<br>')}</div>
      <div class="modal-f"><button class="btn pri" data-act="close-render">知道了</button></div>`);
    else render();
  },
  'clear-cart': () => { if (confirmInline('清空申請清單?')) { S.cart = []; saveCart(); render(); } },
  'copy-plan': async () => {
    const all = S.items.length ? S.items : await api('catalog');
    const nm = Object.fromEntries(all.map(i => [i.id, i.name]));
    const chk = S.plan.start && S.plan.end ? await api('check', { start: S.plan.start, end: S.plan.end, lines: S.cart }).catch(() => []) : [];
    const ck = Object.fromEntries(chk.map(c => [c.itemId + '@' + (c.location || ''), c]));
    const ps = S.plan.start || '?', pe = S.plan.end || '?';   // 純文字(剪貼簿),顯示時再經 esc()
    const txt = `借用申請 ${ps} ~ ${pe}\n` + S.cart.map(c => {
      const k = ck[ckey(c)], at = c.location ? '(' + c.location + ')' : '';
      return `・${nm[c.itemId] || c.itemId}${at} × ${c.qty}` + (k ? (k.short ? `(缺 ${k.short})` : '(足夠)') : '');
    }).join('\n');
    try { await navigator.clipboard.writeText(txt); toast('已複製,可貼到 Email / 通訊軟體'); } catch (e) { openModal(`<h2>清單</h2><textarea rows="10">${esc(txt)}</textarea><div class="modal-f"><button class="btn" data-act="close">關閉</button></div>`); }
  },
  'approve': el => approveModal(el.dataset.id),
  'edit-loan': el => editLoan(el.dataset.id),
  'cancel-edit': () => cancelEdit(),
  'extend': el => extendModal(el.dataset.id),
  'req-ok': el => decideModal(el.dataset.id, true),
  'req-no': el => decideModal(el.dataset.id, false),
  'print-loan': el => printLoan(el.dataset.id),
  'reject': el => rejectModal(el.dataset.id),
  'checkout': el => checkoutModal(el.dataset.id),
  'receive': el => receiveModal(el.dataset.id),
  'cancel': el => { if (confirmInline('確定取消這筆申請?')) run(() => api('cancelLoan', { id: el.dataset.id }), '已取消').then(render).catch(() => { }); },
  'edit-item': el => itemModal(el.dataset.id, el.dataset.cat),
  'units': el => unitsModal(el.dataset.id),
  'archive': el => {
    const off = el.dataset.on === '1';                 // on=1 代表「現在要下架」
    // 下架會讓它從目錄消失、借不到,要問一次;重新上架是補救動作,不用問
    if (off && !confirmInline('確定要下架這個展品?\n\n下架之後不會出現在目錄,也借不到,但歷史紀錄都留著,隨時可以重新上架。')) return;
    return run(() => api('archiveItem', { id: el.dataset.id, archived: off }), off ? '已下架' : '已上架').then(render).catch(() => { });
  },
  'import': () => importModal(),
  'edit-user': el => userModal(el.dataset.id),
  'import-users': () => importUsersModal(),
  'lookup-code': el => lookupModal(el.dataset.code),
  'multi-clear': () => { S.multi.clear(); S._catDraw(); },
  'multi-go': () => {
    S.multi.forEach(id => {
      if (S.cart.find(c => c.itemId === id)) return;
      const i = S.items.find(x => x.id === id), gs = i ? (i.sites || []) : [];
      const pick = $('#loc-' + id);                                   // 卡片上選了哪一點就用哪一點
      S.cart.push({ itemId: id, location: (pick && pick.value) || (gs.length === 1 ? gs[0].location : ''), qty: 1 });
    });
    S.multi.clear(); saveCart(); go('plan');
  },
  'pick-cat': el => {
    const v = el.dataset.cat;
    if (S.view === 'catalog') { S.filters.cat = v; S._catDraw(); }
    else { S.cat = v; (S.view === 'items' ? S._itemDraw : S._countDraw)(); }
  },
  'cats': () => catsModal(),
  'out-who': el => outWhoModal(el.dataset.id),
  'count-cam': () => openScanner(c => { S._countMark(c); }),
  'count-submit': () => S._countSubmit(),
};
function confirmInline(msg) { return window.confirm(msg); }
document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el) { if (!e.target.closest('.menu')) $('#menu-pop').classList.add('hidden'); return; }
  if (el.tagName === 'A') e.preventDefault();
  const f = ACT[el.dataset.act]; if (!f) return;
  /**
   * 連點防呆:同一顆按鈕在上一次還沒結束之前不再觸發,而且看得出來正在送。
   * 連線層也會擋掉「一模一樣又還在路上」的寫入(真正保證不會變成兩筆的是那一層),
   * 這裡這一層是給眼睛看的 —— 按下去沒反應會讓人一直按。
   */
  if (el.dataset.busy === '1') return;
  const r = f(el);
  if (r && typeof r.then === 'function') {
    el.dataset.busy = '1'; el.setAttribute('aria-busy', 'true');
    r.catch(() => { }).then(() => { delete el.dataset.busy; el.removeAttribute('aria-busy'); });
  }
});
document.addEventListener('keydown', e => { const m = $('#modal-bg'); if (e.key === 'Escape' && !$('#scanner-bg') && !(m && m.dataset.locked)) closeModal(); });
/* 主題(淺色 / 深色),記在這台裝置 */
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  $('#m-theme').textContent = t === 'dark' ? '淺色模式' : '深色模式';
  store.set('theme', t);
}
applyTheme(store.get('theme', 'light'));
$('#m-theme').onclick = () => { $('#menu-pop').classList.add('hidden'); applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark'); };
$('#lookup-btn').onclick = () => lookupModal();
$('#menu-btn').onclick = () => $('#menu-pop').classList.toggle('hidden');
$('#m-view').onclick = () => { $('#menu-pop').classList.add('hidden'); setAsUser(!S.asUser); };
$('#viewas-btn').onclick = () => setAsUser(false);
$('#m-pin').onclick = () => { $('#menu-pop').classList.add('hidden'); pinModal(); };
$('#m-out').onclick = () => { $('#menu-pop').classList.add('hidden'); logout(); };
