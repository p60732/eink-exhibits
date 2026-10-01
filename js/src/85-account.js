/* ===================== 帳號相關的視窗:補 Email / 變更 PIN =====================
   v3.0(2026-10-01)之前這裡還放著同仁端的「簽收領取 / 申請歸還 / 當面確認」三個視窗。
   新流程裡同仁只在「填單申請」這一步出現,那三個入口連同後端路由一起拿掉了,
   剩下的兩個視窗都跟身分有關,所以檔名改成 85-account.js。 */
function emailModal() {
  const m = openModal(`<h2>請先補一下你的 Email</h2>
    <div class="banner warn" style="font-size:13px">你的帳號還沒有 Email。借用核准、逾期提醒這些通知都是寄 Email 的,沒有就收不到。填一次就好。</div>
    <label class="f"><span>Email</span><input type="email" id="myml" placeholder="請填公司信箱"></label>
    <div class="modal-f"><button class="btn" id="mlout">登出</button><button class="btn pri" id="mlgo">儲存</button></div>`, { locked: true });
  $('#mlout', m).onclick = () => { closeModal(); logout(); };
  $('#mlgo', m).onclick = () => {
    run(() => api('setMyEmail', { email: $('#myml', m).value.trim() }), 'Email 已存好').then(u => {
      S.user = u; store.set('user', u); closeModal(); enterApp();
    }).catch(() => { });
  };
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

