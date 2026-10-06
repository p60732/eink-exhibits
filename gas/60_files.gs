/**
 * 【檔案積木】60_files.gs
 * 輸入:前端上傳的照片(base64)
 * 責任:把照片存進雲端硬碟的「展品照片」資料夾,回傳可直接顯示的連結
 * 輸出:{ url, id }
 * 禁止:不做業務判斷(誰能上傳由守門調度決定);試算表只存連結,不存圖片本身
 */
var Files = (function () {
  var FOLDER = '展品照片';
  var MAX_B64 = 400000;                       // 約 300KB 的圖;前端會先縮圖
  var OK_TYPE = { jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

  function folder_() {
    var id = PropertiesService.getScriptProperties().getProperty('PHOTO_FOLDER');
    if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* 被刪掉就重建 */ } }
    var it = DriveApp.getFoldersByName(FOLDER);
    var f = it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER);
    PropertiesService.getScriptProperties().setProperty('PHOTO_FOLDER', f.getId());
    return f;
  }

  function err_(msg) { var e = new Error(msg); e.userFacing = true; return e; }

  /** 這個檔案現在是不是「知道連結的人都看得到」。問不出來就當成不是(寧可多報一次) */
  function isPublic_(file) {
    var a;
    try { a = String(file.getSharingAccess()); } catch (e) { return false; }
    return a === String(DriveApp.Access.ANYONE_WITH_LINK) || a === String(DriveApp.Access.ANYONE);
  }
  /** 設成公開並**回報有沒有真的設成功**(設定這個動作本身可能無聲無息地沒生效) */
  function share_(file) {
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
    catch (e) { /* 失敗也不急著報,下面那行會去問實際狀態,以那個為準 */ }
    return isPublic_(file);
  }
  /** 從存起來的照片網址抓出雲端硬碟的檔案 id;不是雲端硬碟的網址回傳空字串 */
  function photoId(url) {
    var u = String(url || '');
    var m = u.match(/[?&]id=([A-Za-z0-9_-]{20,})/) || u.match(/\/d\/([A-Za-z0-9_-]{20,})/);
    return m ? m[1] : '';
  }
  /**
   * 體檢一張照片的共用設定(fix 為真就順便修)。
   * 回傳 ok / fixed / private / missing / skip —— skip 是「不是雲端硬碟的網址」,不歸我們管。
   */
  function checkPhoto(url, fix) {
    var id = photoId(url);
    if (!id) return 'skip';
    var file;
    try { file = DriveApp.getFileById(id); } catch (e) { return 'missing'; }
    if (isPublic_(file)) return 'ok';
    if (!fix) return 'private';
    return share_(file) ? 'fixed' : 'private';
  }

  /** 存一張照片,回傳可直接放進 <img src> 的連結 */
  function saveImage(name, b64, ext) {
    var data = String(b64 || '');
    if (!data) throw err_('沒有收到照片內容');
    if (data.length > MAX_B64) throw err_('照片太大,請重新選一張(系統會自動縮圖,若仍過大請改用較小的圖)');
    var kind = String(ext || 'jpeg').toLowerCase().replace(/[^a-z]/g, '');
    var mime = OK_TYPE[kind];
    if (!mime) throw err_('只接受 JPG / PNG / WebP');
    var safe = String(name || '照片').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
    var blob = Utilities.newBlob(Utilities.base64Decode(data), mime, safe + '.' + (kind === 'jpg' ? 'jpeg' : kind));
    var file = folder_().createFile(blob);
    /**
     * 共用設定**設完要驗,驗不過就把剛建的檔案丟掉再報錯**。
     * 以前這裡是 try/catch 吞掉:設失敗照樣回傳網址,照片在上傳者自己的瀏覽器
     * (正登入著同一個 Google 帳號)看得起來一切正常,**別人一律看不到**。
     * 上傳的人完全沒有感覺,出問題的是別人 —— 這是最難查的一種。
     * 丟掉檔案是為了不要在雲端硬碟留下一堆沒人用、也沒人知道存在的孤兒照片。
     */
    if (!share_(file)) {
      try { file.setTrashed(true); } catch (e) { /* 丟不掉就算了,至少不要回傳一個別人看不到的網址 */ }
      throw err_('這張照片沒辦法設成「知道連結的人都可以看」,別人會看不到,所以沒有存起來。'
        + '請確認這個 Google 帳號允許用連結分享檔案。');
    }
    return { id: file.getId(), url: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1000' };
  }

  return { saveImage: saveImage, checkPhoto: checkPhoto, photoId: photoId };
})();

/** 首次使用照片上傳前,在編輯器手動執行一次以取得雲端硬碟權限 */
function authorizeDrive() {
  assertOwner_();
  var f = Files.saveImage('授權測試', Utilities.base64Encode(Utilities.newBlob('x').getBytes()), 'png');
  DriveApp.getFileById(f.id).setTrashed(true);
  console.log('雲端硬碟權限已取得,「展品照片」資料夾已就緒');
}
