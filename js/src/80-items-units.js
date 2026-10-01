/* ===================== 展品 / 單台 ===================== */
/** 存放地點:先放公司的兩個廠區,已經用過的其他地點也會一起列出來 */
const SITES = ['新竹', '林口'];
function allSites() {
  const set = new Set();
  (S.items || []).forEach(i => {
    (i.sites || []).forEach(g => { if (g.location) set.add(String(g.location)); });
    String(i.location || '').split('、').forEach(v => { if (v.trim()) set.add(v.trim()); });
  });
  return [...set];
}
function siteOptions(cur) {
  const used = allSites();
  const list = SITES.concat(used.filter(v => !SITES.includes(v)));
  if (cur && !list.includes(cur)) list.push(cur);
  const out = [];
  list.forEach(v => out.push('<option' + (v === cur ? ' selected' : '') + '>' + esc(v) + '</option>'));
  out.push('<option value="__new">+ 新增地點…</option>');
  return out.join('');
}

/** 清單上的分佈:新竹 3 · 林口 2(在庫 / 登記台數;全部借出的那一點會變灰) */
function distLine(i, key) {
  const gs = i.sites || [];
  if (!gs.length) return '—';
  return '<div class="dist">' + gs.map(g => {
    const n = key === 'inStock' ? g.inStock : g.total;
    return `<span class="${n ? '' : 'z'}">${esc(g.location)} <b>${Number(n) || 0}</b></span>`;
  }).join('') + '</div>';
}

/** 編輯展品時的一列「地點 + 台數」 */
function siteRow(where, qty) {
  return `<div class="siterow">
    <select class="sloc">${siteOptions(where || '')}</select>
    <input type="text" class="slocnew hidden" maxlength="60" placeholder="新地點名稱">
    <input type="number" class="sqty" min="0" value="${Number(qty) || 0}">
    <button type="button" class="btn sm ghost sdel" title="移除這一列">✕</button>
  </div>`;
}

/** 把使用者選的照片縮到合理大小再上傳,避免一張 5MB 的原圖塞爆請求 */
function shrinkImage(file, maxPx = 1200) {
  return new Promise((ok, bad) => {
    if (!/^image\//.test(file.type)) return bad(new Error('請選圖片檔'));
    const fr = new FileReader();
    fr.onerror = () => bad(new Error('讀不到這個檔案'));
    fr.onload = () => {
      const im = new Image();
      im.onerror = () => bad(new Error('這個檔案不是可以顯示的圖片'));
      im.onload = () => {
        const r = Math.min(1, maxPx / Math.max(im.width, im.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(im.width * r); cv.height = Math.round(im.height * r);
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        let q = 0.82, out = cv.toDataURL('image/jpeg', q);
        while (out.length > 380000 && q > 0.35) { q -= 0.12; out = cv.toDataURL('image/jpeg', q); }
        if (out.length > 380000) return bad(new Error('這張圖太大,請換一張或先裁小一點'));
        ok(out.split(',')[1]);
      };
      im.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}

function itemModal(id, preCat) {
  const i = id ? S.items.find(x => x.id === id) : { mode: 'qty', qty: 0, category: preCat || (S.cats[0] && S.cats[0].name) || '' };
  const locOpts = siteOptions(i.mode === 'unit' ? String(i.location || '').split('、')[0] : '');   // 先組好,樣板裡就不會出現使用者欄位
  const cur = (i.sites || []).filter(g => g.total || g.countedAt);
  const siteRows = (cur.length ? cur.map(g => siteRow(g.location, g.total)) : [siteRow('', i.qty || 0)]).join('');
  const m = openModal(`<h2>${id ? '編輯展品 ' + esc(id) : '新增展品'}</h2><form id="itf">
    <label class="f"><span>品名 <b>*</b></span><input type="text" name="name" required value="${esc(i.name || '')}"></label>
    <div class="grid2"><label class="f"><span>分類</span><select name="category" id="fcat">${S.cats.map(c => `<option ${c.name === i.category ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}${S.cats.some(c => c.name === i.category) || !i.category ? '' : `<option selected>${esc(i.category)}</option>`}<option value="__new">+ 新增分類…</option></select>
    <input type="text" id="fcatnew" class="hidden" maxlength="40" placeholder="新分類名稱" style="margin-top:6px"></label>
    <label class="f" id="floc-wrap"><span>存放位置</span><select name="location" id="floc">${locOpts}</select>
    <input type="text" id="flocnew" class="hidden" maxlength="60" placeholder="例:湖口 B 倉 A-01" style="margin-top:6px"></label></div>
    <label class="f"><span>追蹤方式</span><div class="seg" id="mseg">${[['unit', '逐台編號(貴重品)'], ['qty', '只記數量(道具 / 配件)']].map(([k, t]) => `<button type="button" data-m="${k}" class="${i.mode === k ? 'on' : ''}" ${id && i.mode === 'unit' && k === 'qty' && i.total ? 'disabled' : ''}>${t}</button>`).join('')}</div></label>
    <label class="f" id="fq"><span>各地點的數量</span><div id="fsites">${siteRows}</div>
      <button type="button" class="btn sm ghost" id="faddsite" style="margin-top:8px">${ICON.plus}再加一個地點</button></label>
    ${id ? '' : '<label class="f" id="fu"><span>建立幾台(會自動產生 E0001 這類編號,可印 QR 標籤)</span><input type="number" min="0" max="200" name="unitCount" value="1"></label>'}
    <label class="f"><span>規格 / 配件</span><input type="text" name="spec" value="${esc(i.spec || '')}"></label>
    <label class="f"><span>照片(選填)</span>
      <div class="photo" id="fphoto"></div>
      <input type="hidden" name="image" id="fimg" value="${esc(i.image || '')}">
      <div class="row" style="gap:8px;margin-top:8px">
        <label class="btn sm">${ICON.plus}選照片 / 拍照<input type="file" accept="image/*" id="ffile" style="display:none"></label>
        <button type="button" class="btn sm ghost" id="furl">改貼網址</button>
        <button type="button" class="btn sm ghost" id="fdel">移除照片</button>
      </div></label>
    <label class="f"><span>備註</span><input type="text" name="note" value="${esc(i.note || '')}"></label>
    <div class="modal-f">${id ? '<button type="button" class="btn danger" id="fdrop">刪除展品</button>' : ''}<span class="spacer"></span><button type="button" class="btn" data-act="close">取消</button><button class="btn pri">儲存</button></div></form>`);
  let mode = i.mode;
  const sync = () => {
    $('#fq', m).classList.toggle('hidden', mode !== 'qty');
    $('#floc-wrap', m).classList.toggle('hidden', mode !== 'unit');      // 逐台編號:這裡只是新增單台時的預設地點
    const fu = $('#fu', m); if (fu) fu.classList.toggle('hidden', mode !== 'unit');
    $$('#mseg button', m).forEach(b => b.classList.toggle('on', b.dataset.m === mode));
  };
  $$('#mseg button', m).forEach(b => b.onclick = () => { mode = b.dataset.m; sync(); }); sync();
  /* 各地點數量:可以增減列,選「+ 新增地點…」就跳出可以自己打的欄位 */
  const box = $('#fsites', m);
  const syncRows = () => $$('.sdel', box).forEach(b => b.classList.toggle('hidden', $$('.siterow', box).length < 2));
  box.onchange = e => {
    const sel = e.target.closest('.sloc'); if (!sel) return;
    const isNew = sel.value === '__new', nw = sel.parentNode.querySelector('.slocnew');
    nw.classList.toggle('hidden', !isNew); if (isNew) nw.focus();
  };
  box.onclick = e => {
    const b = e.target.closest('.sdel'); if (!b) return;
    if ($$('.siterow', box).length > 1) { b.closest('.siterow').remove(); syncRows(); }
  };
  $('#faddsite', m).onclick = () => {
    const used = $$('.sloc', box).map(x => x.value);
    const next = SITES.concat(allSites()).find(v => !used.includes(v)) || '';
    box.insertAdjacentHTML('beforeend', siteRow(next, 0));
    syncRows();
  };
  syncRows();
  /* 照片 */
  const drawPhoto = () => {
    const v = $('#fimg', m).value;
    $('#fphoto', m).innerHTML = v
      ? `<img src="${esc(v)}" alt="展品照片" loading="lazy">`
      : '<div class="ph-empty">還沒有照片</div>';
    $('#fdel', m).classList.toggle('hidden', !v);
  };
  $('#ffile', m).onchange = async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const b64 = await run(() => shrinkImage(f)).catch(() => null);
    if (!b64) return;
    const r = await run(() => api('uploadImage', { name: $('#itf [name=name]', m).value || '展品照片', data: b64, ext: 'jpeg' }), '照片已上傳').catch(() => null);
    if (!r) return;
    $('#fimg', m).value = r.url; drawPhoto();
  };
  $('#furl', m).onclick = () => {
    const v = window.prompt('貼上照片網址(留白代表移除):', $('#fimg', m).value || '');
    if (v === null) return;
    $('#fimg', m).value = v.trim(); drawPhoto();
  };
  $('#fdel', m).onclick = () => { $('#fimg', m).value = ''; drawPhoto(); };
  drawPhoto();
  /* 刪除展品 */
  if ($('#fdrop', m)) $('#fdrop', m).onclick = () => {
    const msg = '確定要永久刪除「' + i.name + '」?\n\n'
      + '借過的展品不能刪(系統會擋下來);沒借過的會連同單台編號一起移除,無法復原。\n'
      + '如果只是暫時不用,請改用「下架」。';
    if (!confirmInline(msg)) return;
    run(() => api('deleteItem', { id }), '已刪除').then(() => { closeModal(); render(); }).catch(() => { });
  };
  const sel = $('#fcat', m), nw = $('#fcatnew', m);
  sel.onchange = () => { const isNew = sel.value === '__new'; nw.classList.toggle('hidden', !isNew); if (isNew) nw.focus(); };
  const loc = $('#floc', m), locNew = $('#flocnew', m);
  loc.onchange = () => { const isNew = loc.value === '__new'; locNew.classList.toggle('hidden', !isNew); if (isNew) locNew.focus(); };
  $('#itf', m).onsubmit = e => {
    e.preventDefault();
    const item = { ...Object.fromEntries(new FormData(e.target)), id: id || '', mode };
    if (item.category === '__new') {
      item.category = nw.value.trim();
      if (!item.category) return toast('請填寫新分類名稱', true);
    }
    if (item.location === '__new') {
      item.location = locNew.value.trim();
      if (!item.location) return toast('請填寫新的存放地點', true);
    }
    if (mode === 'qty') {
      const sites = [], seen = {};
      for (const row of $$('.siterow', m)) {
        const sel = row.querySelector('.sloc');
        const where = (sel.value === '__new' ? row.querySelector('.slocnew').value : sel.value).trim();
        const n = Math.max(0, parseInt(row.querySelector('.sqty').value, 10) || 0);
        if (!n) continue;
        if (!where) return toast('請填寫地點名稱', true);
        if (seen[where]) return toast('「' + where + '」填了兩次,請合併成一列', true);
        seen[where] = 1; sites.push({ location: where, qty: n });
      }
      item.sites = sites;
      delete item.qty; delete item.location;
    } else {
      delete item.sites;
    }
    run(() => api('saveItem', { item }), '已儲存').then(() => { RCACHE.delete('cats'); closeModal(); render(); }).catch(() => { });
  };
}
async function unitsModal(itemId) {
  const it = S.items.find(x => x.id === itemId);
  const us = await api('units', { itemId });
  const m = openModal(`<h2>${esc(it.name)}・單台編號</h2>
    <div class="toolbar"><label class="chk"><input type="checkbox" id="uall">全選</label><button class="btn sm" id="uqr">${ICON.qr}列印選取的 QR 標籤</button><span class="spacer"></span>
    <input type="number" min="1" max="200" value="1" id="uadd-n" style="width:80px"><button class="btn sm pri" id="uadd">${ICON.plus}新增台數</button></div>
    <div class="tbl-wrap"><table><thead><tr><th></th><th>編號</th><th>序號</th><th>狀態</th><th>目前在誰手上</th><th>位置</th><th>備註</th><th></th></tr></thead><tbody>
    ${us.map(u => `<tr data-row="${u.id}"><td><input type="checkbox" data-qr="${u.id}"></td><td class="mono"><a href="#" data-act="lookup-code" data-code="${u.id}">${esc(u.id)}</a></td>
      <td><input type="text" data-f="serial" value="${esc(u.serial)}" style="width:120px"></td>
      <td>${u.status === 'out' ? '<span class="pill out">借出</span>' : `<select data-f="status" style="width:auto">${Object.entries({ in: '在庫', repair: '維修', lost: '遺失', retired: '報廢' }).map(([k, t]) => `<option value="${k}" ${u.status === k ? 'selected' : ''}>${t}</option>`).join('')}</select>`}</td>
      <td>${u.holder ? `${esc(u.holder.applicant)}${u.holder.dept ? '・' + esc(u.holder.dept) : ''}<br><span class="meta">${esc(u.holder.event)}・還 ${esc(u.holder.end)}</span>${u.holder.overdue ? ' <span class="pill bad">逾期</span>' : ''}` : '—'}</td>
      <td><input type="text" data-f="location" value="${esc(u.location)}" style="width:130px"></td><td><input type="text" data-f="note" value="${esc(u.note)}" style="width:140px"></td>
      <td><button class="btn sm" data-save-unit="${u.id}">存</button></td></tr>`).join('') || '<tr><td colspan="8" class="empty">尚無單台</td></tr>'}</tbody></table></div>
    <div class="modal-f"><button class="btn" data-act="close-render">關閉</button></div>`, { wide: true, noFocus: true });
  $('#uall', m).onchange = e => $$('[data-qr]', m).forEach(c => c.checked = e.target.checked);
  $('#uqr', m).onclick = () => { const ids = $$('[data-qr]:checked', m).map(c => c.dataset.qr); if (!ids.length) return toast('請先勾選要列印的編號', true); printLabels(ids.map(id => ({ id, name: it.name, serial: (us.find(u => u.id === id) || {}).serial }))); };
  $('#uadd', m).onclick = () => run(() => api('addUnits', { itemId, count: +$('#uadd-n', m).value }), '已新增').then(() => unitsModal(itemId)).catch(() => { });
  $$('[data-save-unit]', m).forEach(b => b.onclick = () => {
    const tr = b.closest('tr'), unit = { id: b.dataset.saveUnit };
    $$('[data-f]', tr).forEach(f => unit[f.dataset.f] = f.value);
    run(() => api('saveUnit', { unit }), '已更新 ' + unit.id).catch(() => { });
  });
}
async function printLabels(list) {
  await run(() => loadScript('https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js'));
  const tmp = document.createElement('div'); tmp.style.cssText = 'position:absolute;left:-9999px'; document.body.appendChild(tmp);
  const imgs = list.map(x => {
    const d = document.createElement('div'); tmp.appendChild(d);
    new QRCode(d, { text: x.id, width: 256, height: 256, correctLevel: QRCode.CorrectLevel.M });
    const c = d.querySelector('canvas'); return c ? c.toDataURL('image/png') : '';
  });
  tmp.remove();
  const w = window.open('', '_blank');
  if (!w) return toast('請允許彈出視窗以列印標籤', true);
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>QR 標籤</title><style>
    body{font-family:-apple-system,"PingFang TC","Microsoft JhengHei",sans-serif;margin:10mm}
    .g{display:grid;grid-template-columns:repeat(4,1fr);gap:4mm}.l{border:1px dashed #999;padding:3mm;text-align:center;break-inside:avoid}
    .l img{width:32mm;height:32mm}.id{font:700 14px ui-monospace,Menlo,monospace}.n{font-size:10px;color:#333}
    @media print{.tip{display:none}}${PRINT_BAR_CSS}</style></head><body>${PRINT_BAR}<p class="tip">建議用 A4 貼紙列印,或印出後裁切、以透明膠帶貼在展品不顯眼處。</p>
    <div class="g">${list.map((x, i) => `<div class="l"><img src="${imgs[i]}"><div class="id">${esc(x.id)}</div><div class="n">${esc(x.name)}${x.serial ? '<br>' + esc(x.serial) : ''}</div></div>`).join('')}</div>
    <script>setTimeout(function(){window.print()},400)<\/script></body></html>`);
  w.document.close();
}
function importModal() {
  const m = openModal(`<h2>批次匯入展品</h2><p class="sub">從 Excel 直接複製貼上(含或不含標題列皆可)。欄位順序:<br><b>品名、類別、方式(數量 / 逐台)、數量、存放位置、規格、備註</b></p>
    <textarea id="imt" rows="10" placeholder="42吋電子紙看板	大尺寸看板	逐台	4	湖口B倉	含壁掛架&#10;展示立架	陳列道具	數量	20	湖口B倉"></textarea><div class="meta" id="imp"></div>
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" id="imgo">匯入</button></div>`, { wide: true });
  const parse = () => $('#imt', m).value.split(/\r?\n/).map(r => r.split(r.includes('\t') ? '\t' : ',').map(x => x.trim())).filter(r => r[0] && r[0] !== '品名')
    .map(r => ({ name: r[0], category: r[1], mode: r[2], qty: r[3], location: r[4], spec: r[5], note: r[6] }));
  $('#imt', m).oninput = () => { const r = parse(); $('#imp', m).textContent = r.length ? `將匯入 ${r.length} 項(逐台 ${r.filter(x => /逐|unit/i.test(x.mode || '')).length} 項)` : ''; };
  $('#imgo', m).onclick = () => { const rows = parse(); if (!rows.length) return toast('沒有可匯入的資料', true); run(() => api('importItems', { rows })).then(r => { toast(`已匯入 ${r.created} 項`); closeModal(); render(); }).catch(() => { }); };
}
function userModal(id) {
  const u = id ? S._users.find(x => x.id === id) : { role: 'user', active: true };
  const m = openModal(`<h2>${id ? '編輯使用者' : '新增使用者'}</h2><form id="uf">
    <div class="grid2"><label class="f"><span>工號 <b>*</b></span><input type="text" name="empNo" required value="${esc(u.empNo || '')}"></label><label class="f"><span>姓名 <b>*</b></span><input type="text" name="name" required value="${esc(u.name || '')}"></label></div>
    <label class="f"><span>Email(接收通知)<b>*</b></span><input type="email" name="email" value="${esc(u.email || '')}" placeholder="沒有 Email 的話,他送不出借用申請"></label>
    <div class="grid2"><label class="f"><span>角色</span><select name="role" id="ur"><option value="user">使用者(只輸工號)</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>管理者(工號+PIN)</option></select></label>
    <label class="f" id="upf"><span>${u.hasPin ? '重設 PIN(留空不變)' : '管理者 PIN <b>*</b>'}</span><input type="text" name="pin" placeholder="4–12 碼"></label></div>
    ${id ? `<label class="chk"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}>啟用(離職可取消勾選)</label>` : ''}
    <div class="modal-f"><span class="spacer"></span><button type="button" class="btn" data-act="close">取消</button><button class="btn pri">儲存</button></div></form>`);
  const sync = () => $('#upf', m).classList.toggle('hidden', $('#ur', m).value !== 'admin');
  $('#ur', m).onchange = sync; sync();
  $('#uf', m).onsubmit = e => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target));
    if (fd.role !== 'admin') fd.pin = '';
    run(() => api('saveUser', { user: { ...fd, id: id || '', active: id ? !!fd.active : true } }), '已儲存').then(() => { closeModal(); render(); }).catch(() => { });
  };
}
function importUsersModal() {
  const m = openModal(`<h2>匯入人員清單</h2><p class="sub">從 Excel / HR 名單直接複製貼上。欄位順序:<br><b>工號、姓名、Email、在職(選填,填「離職」會停用)</b><br>已存在的工號會更新姓名與 Email,不會動到角色。<br>⚠️ <b>Email 一定要有</b> —— 沒有的話那個人送不出借用申請,核准通知也寄不到。</p>
    <textarea id="iut" rows="10" placeholder="A001	員工001	a001@example.com&#10;A002	員工002	a002@example.com"></textarea><div class="meta" id="iup"></div>
    <div class="modal-f"><button class="btn" data-act="close">取消</button><button class="btn pri" id="iugo">匯入</button></div>`, { wide: true });
  const parse = () => $('#iut', m).value.split(/\r?\n/).map(r => r.split(r.includes('\t') ? '\t' : ',').map(x => x.trim())).filter(r => r[0] && r[1] && r[0] !== '工號')
    // 第 3 欄看內容決定是 Email 還是部門:舊名單是「工號/姓名/部門/Email」,
    // 新的只要「工號/姓名/Email」。含 @ 就是 Email,照位置猜會把信箱填進部門欄。
    .map(r => { const a = r[2] || '', b = r[3] || '';
      const email = /@/.test(a) ? a : (/@/.test(b) ? b : '');
      const dept = /@/.test(a) ? '' : a;
      const act = [b, r[4]].find(x => x && !/@/.test(x)) || '';
      return { empNo: r[0], name: r[1], dept, email, active: act }; });
  $('#iut', m).oninput = () => { const r = parse(); const have = new Set((S._users || []).map(u => String(u.empNo).toUpperCase())); $('#iup', m).textContent = r.length ? `共 ${r.length} 人:新增 ${r.filter(x => !have.has(x.empNo.toUpperCase())).length}、更新 ${r.filter(x => have.has(x.empNo.toUpperCase())).length}` : ''; };
  $('#iugo', m).onclick = () => { const rows = parse(); if (!rows.length) return toast('沒有可匯入的資料', true); run(() => api('importUsers', { rows })).then(r => { toast(`新增 ${r.created} 人、更新 ${r.updated} 人`); closeModal(); render(); }).catch(() => { }); };
}

