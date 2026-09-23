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
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); }
    catch (e) { /* 組織政策可能不允許公開;連結仍可在組織內顯示 */ }
    return { id: file.getId(), url: 'https://drive.google.com/thumbnail?id=' + file.getId() + '&sz=w1000' };
  }

  return { saveImage: saveImage };
})();

/** 首次使用照片上傳前,在編輯器手動執行一次以取得雲端硬碟權限 */
function authorizeDrive() {
  assertOwner_();
  var f = Files.saveImage('授權測試', Utilities.base64Encode(Utilities.newBlob('x').getBytes()), 'png');
  DriveApp.getFileById(f.id).setTrashed(true);
  console.log('雲端硬碟權限已取得,「展品照片」資料夾已就緒');
}
