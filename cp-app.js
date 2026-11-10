/* ============================================================
   cp-app.js — Content Pulse 2.0 поверх интерфейса Cardboard.

   Витрина съёмок = папки архива на Яндекс Диске. Открыл съёмку —
   галерея с Диска (превью Яндекса), отбор в карточки как в Cardboard,
   общий отбор хранится в <съёмка>/_contentpulse.json и виден всем.
   Действия над кадром/карточкой: на ретушь (с копией в папку Ретушь),
   на пересъём, на согласование. Скачивание: отбор по карточкам или
   вся съёмка (Chrome/Edge — в выбранную папку со структурой).
   Каждое действие пишется в журнал: кто, что, когда.

   Подключается ПОСЛЕ основного скрипта Cardboard и подменяет
   несколько его функций (лаунчер, сохранение, данные проекта).
   Префикс: cp*. Без эмодзи и иконок.
   ============================================================ */

/* «Скачано» временно нигде не показываем (Маша, 06.11.2026): вместо него —
   «забрали» (у карточки появилась буква ретушёра). Отметки о скачивании
   по-прежнему пишутся — вернуть показ: true. */
var CP_SHOW_DL = false;

/* Номер версии: каждая правка — новая версия (tools/release.py, CHANGELOG.md).
   Виден на витрине под названием — по нему понятно, куда откатываться. */
var CP_VERSION = '2.0.94';

var CP_CONFIG = {
  /* ClientID приложения на oauth.yandex.ru (не секрет). */
  clientId: '36df38c93cb944318c0084640c77d76a',
  /* прослойка в Yandex Cloud (proxy/index.js): превью, файл отбора, копирование */
  proxy: 'https://functions.yandexcloud.net/d4ehdtuc6j9c22657ru1',
  defaultArchive: 'disk:/Архив',
  /* служебная папка Content Pulse на Диске клиента: словарь тегов, настройки, выгрузки */
  serviceDir: 'disk:/_ContentPulse',
  previewSize: 'XL',
  previewParallel: 6,
  previewBatch: 10,      /* превью пачками через прослойку */
  previewBatches: 3,
  downloadParallel: 3,
  pollMs: 30000
};

var CP_STATUS = {
  retouch: { label: 'Ретушь', short: 'РЕТУШЬ' },
  reshoot: { label: 'Брак (пересъём)', short: 'БРАК' },
  approval: { label: 'Согласование', short: 'СОГЛАС.' },
  /* скачали на ретушь, а потом убрали из отбора: ретушёру — не делать */
  removed: { label: 'Удалено из отбора', short: 'УДАЛЕНО' }
};

var CP = {
  user: null,          /* {login, display_name} */
  archive: '',
  shoot: null,         /* {path, name} */
  rev: '',             /* ревизия _contentpulse.json, с которой мы работаем */
  saving: false,
  thumbs: {},          /* disk path -> {url, w, h} */
  queue: [],           /* превью к загрузке */
  loadingThumbs: 0,
  pollTimer: null,
  shoots: [],
  sel: null,           /* выбранная на витрине съёмка (cp-shelf.js) */
  previews: {},        /* disk path -> ссылка превью из последнего обхода */
  folder: '',          /* фильтр галереи по папке съёмки ('' = все, '/' = только корень) */
  previewMode: '',     /* '' | 'preview' | 'download' — как получаем картинки */
  files: [],           /* последний обход папки съёмки на Диске */
  editSeq: 0           /* счётчик правок: сохранение снимает dirty, только если новых не было */
};

/* ---------- хранение настроек ---------- */

function cpGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
function cpSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }

/* Служебная папка _ContentPulse лежит рядом с архивом — в его родительской
   папке (у SK: КАТАЛОГ/_ContentPulse рядом с 00_АРХИВ, 01_ИСХОДНИКИ...),
   чтобы настройки были общими для всех, у кого есть доступ к каталогу.
   Архив прямо в корне Диска — служебная папка тоже в корне, как раньше. */
var CP_LEGACY_SERVICE = 'disk:/_ContentPulse';
function cpServiceDirFor(archive) {
  var a = String(archive || '').replace(/\/+$/, '');
  var root = CPDisk.rootOf(a);   /* 'disk:' или 'vd:<метка>:disk:' — общий диск */
  var i = a.lastIndexOf('/');
  var parent = i > root.length ? a.slice(0, i) : root;
  return parent + '/_ContentPulse';
}
CP_CONFIG.serviceDir = cpServiceDirFor(cpGet('cp_archive', CP_CONFIG.defaultArchive));
function cpDel(k) { try { localStorage.removeItem(k); } catch (e) { } }

/* ---------- стили ---------- */

(function cpInjectCss() {
  var css = ''
    + '.cp-shelf{position:fixed;inset:0;background:#131313;z-index:900;display:none;flex-direction:column}'
    + '.cp-shelf.cp-open{display:flex}'
    + '.cp-shelf-head{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid #2a2a28}'
    + '.cp-brand{font-weight:700;letter-spacing:.14em;font-size:13px}'
    + '.cp-brand small{display:block;font-weight:400;letter-spacing:.08em;color:#a3a09a;font-size:10px;margin-top:2px}'
    + '.cp-shelf-head .cp-sp{flex:1}'
    + '.cp-user{color:#a3a09a;font-size:12px}'
    + '.cp-shelf-bar{display:flex;gap:8px;padding:12px 20px;align-items:center;flex-wrap:wrap}'
    + '.cp-shelf-bar input{background:#1d1d1b;border:1px solid #2a2a28;color:#f2f2f1;padding:6px 10px;border-radius:3px;font:inherit}'
    + '#cpArchiveInput{width:320px}#cpShelfSearch{width:240px}'
    + '.cp-shelf-list{flex:1;overflow:auto;padding:4px 20px 24px;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;align-content:start}'
    + '.cp-shoot{text-align:left;padding:14px 16px;border:1px solid #2a2a28;background:#1a1a18;border-radius:4px;cursor:pointer;color:#f2f2f1}'
    + '.cp-shoot:hover{border-color:#C9956B}'
    + '.cp-shoot-name{font-size:14px;font-weight:600;word-break:break-word}'
    + '.cp-shoot-meta{color:#a3a09a;font-size:11px;margin-top:6px;font-family:"IBM Plex Mono",ui-monospace,Menlo,monospace}'
    + '.cp-empty{color:#a3a09a;padding:24px 0;grid-column:1/-1}'
    + '.cp-login{grid-column:1/-1;justify-self:center;margin:12vh auto 0;max-width:420px;text-align:center;line-height:1.6;color:#d6d4cf}'
    + '.cp-login button{margin-top:16px}'
    + '.cp-link{background:none;border:none;color:#a3a09a;text-decoration:underline;padding:4px;font-size:11px}'
    + '.cp-badge{position:absolute;left:4px;bottom:4px;background:#C9956B;color:#131313;font:600 9px/1 "IBM Plex Mono",monospace;letter-spacing:.06em;padding:3px 5px;border-radius:2px;pointer-events:none;z-index:2}'
    + '.cp-badge.cp-reshoot{background:#d9534f;color:#fff}.cp-badge.cp-approval{background:#e8d27a}'
    + '.cp-badge.cp-removed{background:#5a2a24;color:#f2b8a0}'
    + '.cp-save{font-weight:600}.cp-save-ok{color:#9fc2a3}.cp-save-busy{color:#e7c9a8}.cp-save-err{color:#f2b8a0}'
    + '.cp-badge.cp-dl{left:auto;right:4px;top:4px;bottom:auto;background:#3d6b52;color:#fff}'
    + '.cp-badge.cp-like{top:4px;bottom:auto;left:4px;background:#e7c9a8}'
    + '.cp-badge.cp-badge-inline{position:static;display:inline-block;margin-left:6px;vertical-align:middle}'
    + '.cp-liked-only{display:flex;gap:6px;align-items:center;font-size:11px;color:#a3a09a;margin-top:6px;cursor:pointer;white-space:nowrap;flex:none}'
    + '.cp-filter-row{flex-wrap:wrap;column-gap:14px}.cp-filter-row select{flex:1 1 100%}'
    + '.cp-acts{position:absolute;right:4px;bottom:4px;display:none;gap:3px;z-index:3}'
    + '.cp-acts button{padding:2px 6px;font-size:10px;background:#1d1d1bdd;line-height:1.3}'
    + '.cp-acts .cp-act-rt{border-color:#C9956B;color:#e7c9a8}'
    + '.cp-acts .cp-act-brak{border-color:#8a4a32;color:#f2b8a0}'
    + '.cb-slot.cb-filled:hover .cp-acts,.cb-cont-item:hover .cp-acts,.cb-thumb:hover .cp-acts{display:flex}'
    + '.cp-lb{position:fixed;inset:0;z-index:4000;background:#0b0b0af2;display:none;flex-direction:column;color:#f2f2f1}'
    + '.cp-lb.cp-open{display:flex}'
    + '.cp-lb-head{display:flex;gap:10px;align-items:center;padding:10px 16px;border-bottom:1px solid #2a2a28;flex-wrap:wrap}'
    + '.cp-lb-head b{font-size:13px;word-break:break-all}'
    + '.cp-lb-head small{color:#a3a09a;font:11px "IBM Plex Mono",monospace}'
    + '.cp-lb-head .cp-sp{flex:1}'
    + '.cp-lb-body{flex:1;overflow:auto;display:flex;align-items:center;justify-content:center;min-height:0;position:relative}'
    + '.cp-lb-body img{max-width:100%;max-height:100%;object-fit:contain;cursor:zoom-in;display:block}'
    + '.cp-lb-body.cp-full{display:block}'
    + '.cp-lb-body.cp-full img{max-width:none;max-height:none;cursor:zoom-out;margin:auto}'
    + '.cp-lb-note{position:absolute;left:16px;bottom:12px;color:#a3a09a;font-size:11px;background:#0b0b0acc;padding:3px 8px;border-radius:3px}'
    + '.cb-thumb{position:relative}'
    + '.cp-dlcard{position:fixed;left:20px;bottom:20px;z-index:3000;width:360px;max-width:calc(100vw - 32px);background:#1d1d1b;border:1px solid #C9956B;border-radius:6px;padding:14px 16px;box-shadow:0 8px 32px #000a;display:none;color:#f2f2f1}'
    + '.cp-dlcard-head{display:flex;gap:8px;align-items:flex-start}.cp-dlcard-head b{flex:1;font-size:13px;word-break:break-word}'
    + '.cp-dlcard-head button{background:none;border:none;color:#a3a09a;font-size:18px;line-height:1;padding:0 4px;cursor:pointer}'
    + '.cp-dlcard-note{color:#a3a09a;font-size:11px;line-height:1.5;margin:8px 0}'
    + '.cp-dlcard-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px}'
    + '.cp-dlcard-size{flex:1;color:#a3a09a;font-size:11px}'
    + '.cp-report{width:100%;height:220px;margin:8px 0;background:#141413;border:1px solid #3a3a37;color:#f2f2f1;font:11px/1.4 \"IBM Plex Mono\",monospace;box-sizing:border-box;padding:6px}'
    + '.cp-dlcard-alt{background:none;border:1px solid #3a3a37;color:#f2f2f1;padding:6px 12px;border-radius:3px;font-size:12px;cursor:pointer}'
    + '.cp-dlcard-url{display:none;width:100%;margin-top:8px;background:#141413;border:1px solid #3a3a37;color:#a3a09a;font-size:10px;padding:4px 6px;box-sizing:border-box}'
    + '.cp-dlcard-btn{display:inline-block;margin-top:4px;background:#C9956B;color:#141413;text-decoration:none;padding:7px 14px;border-radius:3px;font-weight:600;font-size:12px}'
    + '.cp-menu{position:fixed;z-index:1000;background:#1d1d1b;border:1px solid #3a3a37;border-radius:4px;padding:4px;display:none;min-width:200px;box-shadow:0 6px 24px #0008}'
    + '.cp-menu.cp-open{display:block}'
    + '.cp-menu button{display:block;width:100%;text-align:left;border:none;background:none;padding:7px 10px}'
    + '.cp-menu button:hover{background:#2a2a28}'
    + '.cp-menu .cp-menu-title{color:#a3a09a;font-size:11px;padding:6px 10px 4px}'
    + '.cp-status-line{color:#a3a09a;font-size:11px;font-family:"IBM Plex Mono",monospace;margin-right:10px;white-space:nowrap}'
    + '.cp-log{position:fixed;right:0;top:0;bottom:0;width:420px;max-width:100vw;background:#161615;border-left:1px solid #2a2a28;z-index:950;display:none;flex-direction:column}'
    + '.cp-log.cp-open{display:flex}'
    + '.cp-log-head{display:flex;align-items:center;padding:12px 14px;border-bottom:1px solid #2a2a28;gap:8px}'
    + '.cp-log-head b{flex:1}'
    + '.cp-log-list{overflow:auto;padding:8px 14px;font-size:12px;line-height:1.5}'
    + '.cp-log-item{padding:8px 0;border-bottom:1px solid #222220}'
    + '.cp-log-item small{color:#a3a09a;font-family:"IBM Plex Mono",monospace}'
    + '.cp-vers-note{color:#a3a09a;padding:6px 0 10px;border-bottom:1px solid #222220}'
    + '.cp-vers-item{display:flex;align-items:center;gap:10px}.cp-vers-item div{flex:1}';
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
})();

/* ---------- разметка: витрина, меню действий, журнал ---------- */

(function cpInjectDom() {
  var shelf = document.createElement('div');
  shelf.className = 'cp-shelf';
  shelf.id = 'cpShelf';
  shelf.innerHTML = ''
    + '<div class="cp-shelf-head">'
    + '  <div class="cp-brand">CONTENT PULSE<small>ВИТРИНА СЪЁМОК · <span id="cpVersion" title="Номер версии программы — список версий в CHANGELOG.md">' + CP_VERSION + '</span></small></div>'
    + '  <div class="cp-sp"></div>'
    + '  <span class="cp-user" id="cpUser"></span>'
    + '  <button id="cpLogout" style="display:none">Выйти</button>'
    + '  <button id="cpShelfClose" style="display:none">Вернуться к съёмке</button>'
    + '</div>'
    + '<div class="cp-shelf-bar" id="cpShelfBar" style="display:none">'
    + '  <span class="cp-user">Архив:</span><input id="cpArchiveInput" spellcheck="false">'
    + '  <button id="cpArchiveApply">Показать</button>'
    + '  <input id="cpShelfSearch" placeholder="Поиск по названию или коду">'
    + '  <button id="cpShelfRefresh">Обновить</button>'
    + '</div>'
    + '<div class="cp-shelf-list" id="cpShelfList"></div>';
  document.body.appendChild(shelf);

  var menu = document.createElement('div');
  menu.className = 'cp-menu';
  menu.id = 'cpMenu';
  document.body.appendChild(menu);

  var log = document.createElement('div');
  log.className = 'cp-log';
  log.id = 'cpLog';
  log.innerHTML = '<div class="cp-log-head"><b>Журнал съёмки</b><button id="cpLogClose">Закрыть</button></div>'
    + '<div class="cp-log-list" id="cpLogList"></div>';
  document.body.appendChild(log);

  var vers = document.createElement('div');
  vers.className = 'cp-log';
  vers.id = 'cpVers';
  vers.innerHTML = '<div class="cp-log-head"><b>Версии отбора</b><button id="cpVersNow">Сохранить версию сейчас</button><button id="cpVersClose">Закрыть</button></div>'
    + '<div class="cp-log-list"><div class="cp-vers-note">Перед правками программа сама кладёт копию отбора в служебную папку — не чаще раза в 30 минут. '
    + '«Вернуть» ставит выбранную версию вместо текущей; текущая перед этим тоже сохраняется версией, так что откат можно откатить.</div>'
    + '<div id="cpVersList"></div></div>';
  document.body.appendChild(vers);

  /* пункты в меню «Файл» */
  var file = document.getElementById('cbMenuFile');
  var first = file.firstElementChild;
  var block = document.createElement('div');
  block.innerHTML = ''
    + '<button id="cpMenuShelf">Витрина съёмок</button>'
    + '<button id="cpMenuRefresh">Обновить съёмку (новые части)</button>'
    + '<button id="cpMenuDlSel">Скачать отбор по карточкам...</button>'
    + '<button id="cpMenuDlAll">Скачать всю съёмку: только фото</button>'
    + '<button id="cpMenuDlAllV">Скачать всю съёмку: все файлы (с видео)</button>'
    + '<button id="cpMenuLog">Журнал действий</button>'
    + '<button id="cpMenuVersions">Версии отбора...</button>'
    + '<button id="cpMenuRetouchSync">Сверить папку ретуши</button>'
    + '<div class="cb-pop-sep"></div>';
  while (block.firstChild) file.insertBefore(block.firstChild, first);


  /* строка статусов рядом с «+ Карточка» */
  var add = document.getElementById('cbBtnAdd');
  var line = document.createElement('span');
  line.className = 'cp-status-line';
  line.id = 'cpStatusLine';
  add.parentNode.parentNode.insertBefore(line, add.parentNode);

  /* бренд в логотипе */
  var word = document.querySelector('.cb-logo-word');
  if (word) word.textContent = 'CONTENT PULSE';
  var sub = document.querySelector('.cb-logo-sub');
  if (sub) sub.textContent = 'ОТБОР';
})();

/* ---------- авторизация ---------- */

function cpRedirectUri() { return location.origin + location.pathname; }

function cpLogin() {
  if (!CP_CONFIG.clientId) {
    cbToast('Не задан ClientID приложения Яндекса');
    return;
  }
  location.href = 'https://oauth.yandex.ru/authorize?response_type=token'
    + '&client_id=' + encodeURIComponent(CP_CONFIG.clientId)
    + '&redirect_uri=' + encodeURIComponent(cpRedirectUri())
    + '&force_confirm=no';
}

function cpLogout() {
  cpDel('cp_token');
  CPDisk.setToken('');
  CP.user = null;
  cpShowShelf();
}

/** Токен из адреса после входа через Яндекс или из хранилища. */
function cpReadToken() {
  var m = /access_token=([^&]+)/.exec(location.hash || '');
  if (m) {
    cpSet('cp_token', decodeURIComponent(m[1]));
    history.replaceState(null, '', location.pathname + location.search);
  }
  var t = cpGet('cp_token', '');
  CPDisk.setToken(t);
  return t;
}

function cpPasteToken() {
  var t = prompt('Вставьте OAuth-токен Яндекс Диска (для отладки):');
  if (!t) return;
  cpSet('cp_token', t.trim());
  CPDisk.setToken(t.trim());
  cpShowShelf();
}

function cpHandleError(e, what) {
  if (e && e.status === 401) {
    cbToast('Вход истёк — войдите заново');
    cpLogout();
    return;
  }
  cbBusyHide();
  var msg = (e && e.message) || String(e);
  cbToast((what ? what + ': ' : '') + msg);
  if (window.console) console.error('[CP]', what, e && e.body ? e.body : e);
}

/* ---------- витрина ---------- */

function cpShowShelf() {
  document.getElementById('cpLog').classList.remove('cp-open');
  var shelf = document.getElementById('cpShelf');
  shelf.classList.add('cp-open');
  document.getElementById('cpShelfClose').style.display = CP.shoot ? '' : 'none';
  if (!CPDisk.hasToken()) {
    document.getElementById('cpShelfBar').style.display = 'none';
    document.getElementById('cpLogout').style.display = 'none';
    document.getElementById('cpUser').textContent = '';
    document.getElementById('cpShelfList').innerHTML = '<div class="cp-login">'
      + 'Витрина съёмок открывает архив на Яндекс Диске компании.<br>'
      + 'Файлы остаются на Диске, приложение только показывает и раскладывает их.'
      + '<br><button class="cb-primary" id="cpLoginBtn">Войти через Яндекс</button>'
      + '<br><button class="cp-link" id="cpPasteBtn">вставить токен вручную</button></div>';
    document.getElementById('cpLoginBtn').onclick = cpLogin;
    document.getElementById('cpPasteBtn').onclick = cpPasteToken;
    return;
  }
  document.getElementById('cpShelfBar').style.display = '';
  document.getElementById('cpLogout').style.display = '';
  if (typeof cpEnsureSettings === 'function') cpEnsureSettings();
  CP.archive = cpGet('cp_archive', CP_CONFIG.defaultArchive);
  document.getElementById('cpArchiveInput').value = CP.archive;
  var who = CP.user ? Promise.resolve(CP.user) : CPDisk.info().then(function (d) {
    CP.user = d.user || { login: '', display_name: '' };
    return CP.user;
  });
  who.then(function (u) {
    document.getElementById('cpUser').textContent = u.display_name || u.login || '';
    return cpLoadShoots();
  }).catch(function (e) { cpHandleError(e, 'Не удалось открыть Диск'); });
}

function cpLoadShoots() {
  var list = document.getElementById('cpShelfList');
  list.innerHTML = '<div class="cp-empty">Загружаю съёмки из ' + cbEsc(CPDisk.showPath(CP.archive)) + '...</div>';
  return CPDisk.listShoots(CP.archive).then(function (dirs) {
    CP.shoots = dirs;
    cpRenderShoots();
  }, function (e) {
    if (e.status === 404) {
      list.innerHTML = '<div class="cp-empty">Папка ' + cbEsc(CPDisk.showPath(CP.archive))
        + ' не найдена на Диске. Откройте папку архива на Яндекс Диске в браузере и вставьте адрес из адресной строки в «Архив съёмок» (шестерёнка) — подходит и личный Диск, и общий диск компании</div>';
      return;
    }
    if (e.status === 403 && CPDisk.isVd(CP.archive)) {
      list.innerHTML = '<div class="cp-empty">Нет доступа к общему диску: у вашего аккаунта нет прав на чтение этого общего диска, '
        + 'или вход в Content Pulse был до того, как их выдали. Попросите администратора Яндекс 360 дать доступ, затем «Выйти» и войти снова.</div>';
      return;
    }
    cpHandleError(e, 'Не удалось прочитать архив');
  });
}

/**
 * Путь к архиву в любом виде -> disk:/A/B.
 * Понимает: disk:/A/B, disk/A/B, /A/B, A/B и ссылку из браузера
 * https://disk.yandex.ru/client/disk/A/B (с %-кодировкой).
 */
function cpNormArchive(raw) {
  var v = String(raw || '').trim();
  if (!v) return '';
  /* общий диск Яндекс 360: адрес из браузера …/client/aa/d_<метка>/<папки>
     (в документации — …/vd/<метка>/…) или уже готовый путь vd:<метка>:disk:/… */
  var vd = /\/client\/(?:aa|vd)\/(?:d_)?([A-Za-z0-9_-]+)\/?([^?#]*)/.exec(v) || /^vd:([^:\/]+):disk:\/?(.*)$/.exec(v)
    || /^(?:disk:\/)?vd:([^:\/]+):?(?:disk:)?\/?(.*)$/.exec(v);   /* «vd:<метка>» без «disk:» */
  if (vd) {
    var rest = vd[2];
    try { rest = decodeURIComponent(rest); } catch (e) { }
    return 'vd:' + vd[1] + ':disk:/' + rest.replace(/^\/+|\/+$/g, '');
  }
  var m = /\/client\/disk\/?(.*)$/.exec(v);
  if (m) v = m[1].split(/[?#]/)[0];
  try { v = decodeURIComponent(v); } catch (e) { }
  v = v.replace(/^disk:/i, '').replace(/^\/+/, '').replace(/^disk\//i, '').replace(/\/+$/, '');
  return 'disk:/' + v;
}

function cpFmtDate(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU').slice(0, 5);
}

function cpRenderShoots() {
  var q = document.getElementById('cpShelfSearch').value.trim().toLowerCase();
  var list = document.getElementById('cpShelfList');
  var hide = CP.settings && CP.settings.retouch;   /* папка ретуши внутри архива — не съёмка */
  var items = CP.shoots.filter(function (d) { return d.path !== hide && (!q || d.name.toLowerCase().indexOf(q) !== -1); });
  if (!items.length) {
    list.innerHTML = '<div class="cp-empty">' + (CP.shoots.length ? 'Ничего не найдено' : 'В архиве пока нет папок съёмок') + '</div>';
    return;
  }
  list.innerHTML = items.map(function (d) {
    return '<button class="cp-shoot' + (CP.sel && CP.sel.path === d.path ? ' cp-shoot-sel' : '') + '" data-path="' + cbEsc(d.path) + '" data-name="' + cbEsc(d.name) + '" data-mod="' + cbEsc(d.modified || '') + '">'
      + '<div class="cp-shoot-name">' + cbEsc(d.name) + '</div>'
      + '<div class="cp-shoot-meta">изменена ' + cpFmtDate(d.modified) + '</div></button>';
  }).join('');
}

/* клик — выбрать съёмку (панель справа), двойной клик — открыть отбор */
document.getElementById('cpShelfList').addEventListener('dblclick', function (e) {
  var b = e.target.closest('.cp-shoot');
  if (!b) return;
  cpOpenShoot(b.getAttribute('data-path'), b.getAttribute('data-name'));
});
document.getElementById('cpShelfList').addEventListener('click', function (e) {
  var b = e.target.closest('.cp-shoot');
  if (!b) return;
  if (typeof cpSelectShoot === 'function') { cpSelectShoot(b.getAttribute('data-path'), b.getAttribute('data-name'), b.getAttribute('data-mod')); return; }
  cpOpenShoot(b.getAttribute('data-path'), b.getAttribute('data-name'));
});
document.getElementById('cpShelfSearch').oninput = cpRenderShoots;
document.getElementById('cpShelfRefresh').onclick = cpLoadShoots;
/* Открыта съёмка, а витрина переходит в другую папку (другой архив или каталог — переключатель
   папок, 2.0.84). Папки этапов (02–05) берутся из настроек папки, открытой на витрине, поэтому
   «Вернуться к съёмке» вело в съёмку, чьи «На ретушь» и «На сайт» ушли бы в этапы ЧУЖОЙ папки.
   Теперь такая съёмка закрывается: её отбор дописывается, переносы из очереди идут дальше сами. */
function cpShootForeign(archive) {
  var a = String(archive || '').replace(/\/+$/, '');
  return !!(CP.shoot && a && CP.shoot.path.indexOf(a + '/') !== 0);
}
function cpCloseShoot() {
  if (!CP.shoot) return;
  clearInterval(CP.pollTimer);
  CP.shoot = null;
  CP.readOnly = false;
  CP.saveState = null;
  cbClearDirty();
  cpSetTitle();
  cpUpdateStatusLine();
  var back = document.getElementById('cpShelfClose');
  if (back) back.style.display = 'none';
}

document.getElementById('cpArchiveApply').onclick = function () {
  var v = cpNormArchive(document.getElementById('cpArchiveInput').value);
  if (!v) return;
  if (cpShootForeign(v)) {
    var btn = this, was = CP.shoot.name;
    if (App.dirty || CP.saving) {
      /* сначала дописать отбор открытой съёмки, потом переходить */
      cbBusyShow('Сохраняю отбор съёмки ' + was + '...', 0.05);
      cpFlushSave().then(function () {
        cbBusyHide();
        var lost = App.dirty || CP.saving;
        cpCloseShoot();
        if (lost) cbToast('Отбор съёмки ' + was + ' не успел сохраниться — правки лежат в этом браузере и вернутся, когда откроете её снова');
        btn.onclick();
      });
      return;
    }
    cpCloseShoot();
    cbToast('Съёмка ' + was + ' закрыта: она из другой папки');
  }
  document.getElementById('cpArchiveInput').value = v;
  CP.archive = v;
  cpSet('cp_archive', v);
  var sd = cpServiceDirFor(v);
  if (sd !== CP_CONFIG.serviceDir) {
    /* настройки (теги, структура) переезжают из прежней служебной папки — см. cpMigrateService */
    cpSet('cp_prev_service', CP_CONFIG.serviceDir);
    CP_CONFIG.serviceDir = sd;
    if (typeof cpServiceReset === 'function') cpServiceReset();
  }
  cpLoadShoots();
};
document.getElementById('cpLogout').onclick = cpLogout;
document.getElementById('cpShelfClose').onclick = function () {
  document.getElementById('cpShelf').classList.remove('cp-open');
};

/* ---------- открыть съёмку ---------- */

function cpBlankProject(name) {
  return { app: 'cardboard', version: 3, name: name, nextId: 1, photos: [], cards: [], containers: [], templates: [], meta: {} };
}

function cpMeta() {
  if (!App.projectMeta) App.projectMeta = {};
  if (!App.projectMeta.cp) App.projectMeta.cp = { status: {}, cardStatus: {}, events: [] };
  var m = App.projectMeta.cp;
  if (!m.downloads) m.downloads = {};   /* pid -> {n, first:{by,ts,export}, last:{...}} */
  if (!m.folderTags) m.folderTags = {}; /* путь папки внутри съёмки ('' = вся) -> [теги] */
  if (!m.status) m.status = {};
  if (!m.cardStatus) m.cardStatus = {};
  if (!m.likes) m.likes = {};           /* pid -> {by, ts}: лайк в галерее для сборки карточек */
  if (!m.events) m.events = [];
  return m;
}

/** Дождаться записи отбора текущей съёмки (не дольше 20 с). */
function cpFlushSave() {
  if (!CP.shoot || CP.readOnly || (!App.dirty && !CP.saving)) return Promise.resolve();
  var t0 = Date.now(), tries = 0;
  return new Promise(function (resolve) {
    (function tick() {
      if (!CP.saving && App.dirty && tries < 2) { tries++; cbAutosaveNow(); }
      if ((!CP.saving && (!App.dirty || tries >= 2)) || Date.now() - t0 > 20000) return resolve();
      setTimeout(tick, 150);
    })();
  });
}

function cpOpenShoot(path, name) {
  /* сначала дописываем отбор открытой съёмки, потом переключаемся */
  if (CP.shoot && CP.shoot.path !== path && (App.dirty || CP.saving)) {
    cbBusyShow('Сохраняю отбор съёмки ' + CP.shoot.name + '...', 0.05);
    return cpFlushSave().then(function () { cpOpenShootNow(path, name); });
  }
  return cpOpenShootNow(path, name);
}

function cpOpenShootNow(path, name) {
  cbBusyShow('Открываю съёмку ' + name + ': читаю сохранённый отбор...', 0.1);
  /* обход папок идёт параллельно с чтением отбора (или уже идёт с витрины) */
  var walk = cpWalk(path);
  walk.catch(function () { });
  /* Отбор не прочитался — всё равно показываем кадры, но не сохраняем,
     чтобы не затереть чужую работу пустым отбором. */
  var stateError = null;
  CPDisk.readState(path).catch(function (e) {
    if (e && e.status === 401) throw e;
    stateError = e;
    if (window.console) console.error('[CP] отбор не прочитался', path, e && (e.body || e.message), e);
    return { data: null, rev: null };
  }).then(function (st) {
    CP.shoot = { path: path, name: name };
    CP.rev = st.rev;
    CP.readOnly = !!stateError;
    CP.base = cpClone(st.data) || null;
    CP.saveState = null;
    CP.files = [];
    CP.folder = '';
    CP.folderByCard = false;
    CP.activeCard = null;
    CP.retouchMissing = {};
    /* в этом браузере остались несохранённые правки этой съёмки — возвращаем их */
    var bak = !stateError ? cpBackupGet(path) : null;
    if (bak && bak.data) {
      var remoteRev = st.rev || '';
      st = { data: bak.rev === remoteRev ? bak.data : cpMerge3(bak.base || null, bak.data, st.data || {}), rev: st.rev, restored: bak.ts };
    }
    /* превью прошлой съёмки больше не нужны */
    CP.queue.forEach(function (q) { delete CP.thumbPending[q.disk]; });
    CP.queue = [];
    cpApplyRemote(st.data || cpBlankProject(name));
    cpSetTitle();
    if (st.restored) {
      cbMarkDirty();
      cpEvent('restored', [], { note: 'восстановлены несохранённые правки от ' + cpFmtDate(st.restored) }, true);
      setTimeout(function () { cbToast('Восстановлены правки, которые не успели сохраниться (' + cpFmtDate(st.restored) + ') — сохраняю.'); }, 400);
    }
    function opened(added) {
      cbBusyHide();
      document.getElementById('cpShelf').classList.remove('cp-open');
      if (stateError) {
        cbToast('Кадры открыты, но сохранённый отбор не прочитался: ' + (stateError.message || stateError)
          + '. Изменения пока не сохраняются, чтобы не затереть чужой отбор.');
      } else {
        cbToast('Съёмка открыта: ' + name + (added ? ' · новых файлов: ' + added : ''));
      }
      cpStartPoll();
      /* модули узнают, что съёмка открыта (фильтр по отмеченным папкам — cp-deliver.js) */
      (CP.openedHooks || []).forEach(function (f) { try { f(path); } catch (e) { if (window.console) console.error('[CP]', e); } });
    }
    /* Съёмку уже открывали: кадры известны из отбора — показываем сразу,
       новые файлы досчитываются в фоне. Новую съёмку ждём целиком. */
    if (cpPhotoCount()) {
      opened(0);
      return cpSyncPhotos(true).then(function (added) {
        if (added) cbToast('В съёмке новые файлы: ' + added);
      });
    }
    cbBusyShow('Открываю съёмку ' + name + ': читаю папки и файлы...', 0.4);
    return cpSyncPhotos(true).then(opened);
  }).catch(function (e) { cpHandleError(e, 'Не удалось открыть съёмку'); });
}

function cpPhotoCount() {
  return App.photos.filter(function (p) { return p.disk; }).length;
}

function cpSetTitle() {
  document.title = (CP.shoot ? CP.shoot.name + ' — ' : '') + 'Content Pulse';
}

/** Применить данные отбора (свои или чужие), сохранив загруженные превью. */
function cpApplyRemote(data) {
  data = data || cpBlankProject(CP.shoot ? CP.shoot.name : 'Съёмка');
  data.name = CP.shoot ? CP.shoot.name : data.name;
  cbApplyProject(data);
  App.photos.forEach(function (p) {
    if (!p.disk) return;
    var t = CP.thumbs[p.disk];
    if (t) { p.dataUrl = t.url; p.w = t.w; p.h = t.h; return; }
    if (CP.previews[p.disk]) p.preview = CP.previews[p.disk];
    if (p.preview || CPDisk.hasProxy()) cpQueueThumb(p);
  });
  cpMeta();
  /* файлы, которых нет в чужой версии (новая часть пришла у нас), не теряем */
  if (CP.files.length && cpMergeFiles().length) cbMarkDirty();
  cbRenderTray(); cbRenderCards(); cbRenderConts();
  cpUpdateStatusLine();
}

/**
 * Сверить галерею с папкой на Диске: добавить новые файлы (части съёмки),
 * пометить пропавшие. Возвращает число новых.
 */
/* Обход папок съёмки запоминаем на 5 минут: выбор на витрине и открытие
   не обходят папки повторно. «Обновить съёмку» всегда читает заново. */
var CP_WALK_TTL = 5 * 60 * 1000;
CP.walkCache = {};

function cpWalk(path, fresh) {
  var c = CP.walkCache[path];
  /* идущий обход тоже переиспользуем: выбрали и сразу открыли — один обход */
  if (!fresh && c && (c.pending || Date.now() - c.ts < CP_WALK_TTL)) return c.promise;
  var entry = { pending: true, ts: 0 };
  /* с прослойкой ссылки на превью не нужны — обход быстрее */
  entry.promise = CPDisk.walkPhotos(path, CPDisk.hasProxy() ? false : CP_CONFIG.previewSize).then(function (files) {
    entry.pending = false;
    entry.ts = Date.now();
    return files;
  }, function (e) {
    if (CP.walkCache[path] === entry) delete CP.walkCache[path];
    throw e;
  });
  CP.walkCache[path] = entry;
  return entry.promise;
}

/** Все файлы съёмки (с видео) — для выгрузки «Все файлы»; тот же кэш на 5 минут. */
function cpWalkAll(path, fresh) {
  var key = 'all:' + path;
  var c = CP.walkCache[key];
  if (!fresh && c && (c.pending || Date.now() - c.ts < CP_WALK_TTL)) return c.promise;
  var entry = { pending: true, ts: 0 };
  entry.promise = CPDisk.walkPhotos(path, false, 4, true).then(function (files) {
    entry.pending = false;
    entry.ts = Date.now();
    return files;
  }, function (e) {
    if (CP.walkCache[key] === entry) delete CP.walkCache[key];
    throw e;
  });
  CP.walkCache[key] = entry;
  return entry.promise;
}

function cpSyncPhotos(initial) {
  return cpWalk(CP.shoot.path, !initial).then(function (files) {
    CP.files = files;
    var added = cpMergeFiles();
    if (added.length) {
      cpEvent(initial ? 'files_found' : 'new_batch', [], { count: added.length });
    }
    cbRenderTray(); cbRenderCards(); cbRenderConts();
    return added.length;
  });
}

/** Сверить App.photos с последним обходом Диска. Возвращает пути новых файлов. */
function cpMergeFiles() {
  var byDisk = {};
  App.photos.forEach(function (p) { if (p.disk) byDisk[p.disk] = p; });
  var seen = {}, added = [];
  CP.files.forEach(function (f) {
    seen[f.path] = true;
    CP.previews[f.path] = f.preview;
    var p = byDisk[f.path];
    if (p) {
      p.preview = f.preview; p.size = f.size; p.md5 = f.md5; p.missing = false;
      return;
    }
    p = { id: cbId(), name: f.name, path: null, disk: f.path, size: f.size, md5: f.md5,
      preview: f.preview, dataUrl: null, w: 0, h: 0, missing: false, kind: 'photo',
      added: new Date().toISOString() };
    var t = CP.thumbs[f.path];
    if (t) { p.dataUrl = t.url; p.w = t.w; p.h = t.h; }
    App.photos.push(p);
    added.push(f.path);
  });
  App.photos.forEach(function (p) { if (p.disk && !seen[p.disk]) p.missing = true; });
  App.photos.forEach(function (p) { if (p.disk && !p.dataUrl && !p.missing && (p.preview || CPDisk.hasProxy())) cpQueueThumb(p); });
  return added;
}

/* ---------- превью ---------- */

var _cpRenderTimer = null;
function cpRenderSoon() {
  if (_cpRenderTimer) return;
  _cpRenderTimer = setTimeout(function () {
    _cpRenderTimer = null;
    cbRenderTray(); cbRenderCards(); cbRenderConts();
  }, 400);
}

/* Очередь превью — по пути на Диске: объекты кадров пересоздаются при
   применении чужого отбора, а грузить одно превью дважды незачем. */
CP.thumbPending = {};
function cpQueueThumb(p) {
  if (!p.disk || CP.thumbs[p.disk] || CP.thumbPending[p.disk]) return;
  CP.thumbPending[p.disk] = true;
  CP.queue.push(p);
  cpPumpThumbs();
}

function cpThumbDone(disk, t) {
  delete CP.thumbPending[disk];
  CP.thumbs[disk] = t;
  App.photos.forEach(function (q) {
    if (q.disk === disk) { q.dataUrl = t.url; q.w = t.w; q.h = t.h; q._thumbState = 'ok'; }
  });
  cpRenderSoon();
}

function cpThumbFailed(disk, e) {
  delete CP.thumbPending[disk];
  App.photos.forEach(function (q) { if (q.disk === disk) q._thumbState = 'failed'; });
  if (window.console) console.error('[CP] превью не загрузилось', disk, e && (e.body || e.message || e.error));
  cpRenderSoon();
}

function cpB64Blob(b64, type) {
  var bin = atob(b64), arr = new Uint8Array(bin.length);
  for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: type || 'image/jpeg' });
}

/* Превью: сначала превью Яндекса; если браузер его не получил (CORS, сеть),
   запасной путь — скачать сам JPEG и уменьшить в браузере. Режим запоминается,
   чтобы не долбить превью, если оно не работает в принципе. */
var CP_THUMB_SIDE = 900;

function cpBlobToThumb(blob, shrink) {
  if (!shrink) {
    var u = URL.createObjectURL(blob);
    return new Promise(function (res) {
      var img = new Image();
      img.onload = function () { res({ url: u, w: img.naturalWidth, h: img.naturalHeight }); };
      img.onerror = function () { res({ url: u, w: 0, h: 0 }); };
      img.src = u;
    });
  }
  return createImageBitmap(blob).then(function (bmp) {
    var k = Math.min(1, CP_THUMB_SIDE / Math.max(bmp.width, bmp.height));
    var cnv = document.createElement('canvas');
    cnv.width = Math.round(bmp.width * k); cnv.height = Math.round(bmp.height * k);
    cnv.getContext('2d').drawImage(bmp, 0, 0, cnv.width, cnv.height);
    var w = bmp.width, h = bmp.height;
    if (bmp.close) bmp.close();
    return new Promise(function (res) {
      cnv.toBlob(function (b) { res({ url: URL.createObjectURL(b), w: w, h: h, blob: b }); }, 'image/jpeg', 0.85);
    });
  });
}

function cpLoadThumb(p) {
  if (CPDisk.hasProxy()) {
    return CPDisk.proxyPreview(p.disk, CP_CONFIG.previewSize).then(function (blob) {
      CP.previewMode = 'proxy';
      return cpBlobToThumb(blob, false);
    });
  }
  if (CP.previewMode !== 'download' && p.preview) {
    return CPDisk.previewBlob(p.preview).then(function (blob) {
      CP.previewMode = 'preview';
      return cpBlobToThumb(blob, false);
    }, function (e) {
      if (e && e.status === 401) throw e;
      if (CP.previewMode !== 'preview') {
        CP.previewMode = 'download';
        if (window.console) console.warn('[CP] превью Яндекса недоступно из браузера, беру сами файлы', e && (e.body || e.message));
      }
      return CPDisk.downloadBlob(p.disk, p.size).then(function (b) { return cpBlobToThumb(b, true); });
    });
  }
  return CPDisk.downloadBlob(p.disk, p.size).then(function (b) { return cpBlobToThumb(b, true); });
}

function cpPumpThumbs() {
  if (CPDisk.hasProxy() && !CP.noBatch) return cpPumpBatches();
  var limit = CP.previewMode === 'download' ? CP_CONFIG.downloadParallel : CP_CONFIG.previewParallel;
  while (CP.loadingThumbs < limit && CP.queue.length) {
    (function (p) {
      CP.loadingThumbs++;
      cpLoadThumb(p).then(function (t) {
        cpThumbDone(p.disk, t);
      }).catch(function (e) {
        if (e && e.status === 401) { cpThumbFailed(p.disk, e); cpHandleError(e); return; }
        if (CPDisk.hasProxy()) cpOwnPreview(p.disk, e); else cpThumbFailed(p.disk, e);
      }).then(function () {
        CP.loadingThumbs--;
        cpPumpThumbs();
      });
    })(CP.queue.shift());
  }
}

/* Через прослойку — пачками: один вызов функции на 10 превью вместо 10. */
function cpPumpBatches() {
  while (CP.loadingThumbs < CP_CONFIG.previewBatches && CP.queue.length) {
    var batch = CP.queue.splice(0, CP_CONFIG.previewBatch).map(function (p) { return p.disk; });
    (function (paths) {
      CP.loadingThumbs++;
      CPDisk.proxyPreviews(paths, CP_CONFIG.previewSize).then(function (out) {
        var jobs = (out.items || []).map(function (it, i) {
          var disk = (it && it.path) || paths[i];
          if (it && it.data) {
            return cpBlobToThumb(cpB64Blob(it.data, it.type), false).then(function (t) { cpThumbDone(disk, t); });
          }
          if (it && it.status === 'later') { CP.queue.push({ disk: disk }); return null; }
          if (it && it.status === 401) {
            cpThumbFailed(disk, it);
            if (!CP._authWarned) { CP._authWarned = true; cpHandleError({ status: 401, message: 'Не авторизован' }); }
            return null;
          }
          cpOwnPreview(disk, it);   /* у Яндекса превью нет или оно не отдалось — делаем своё из самого файла */
          return null;
        });
        return Promise.all(jobs);
      }).catch(function (e) {
        if (e && e.status === 401) { paths.forEach(function (d) { cpThumbFailed(d, e); }); cpHandleError(e); return; }
        /* старая прослойка без пачек — дальше по одному */
        if (e && e.status === 400) CP.noBatch = true;
        if (CP.noBatch) { paths.forEach(function (d) { CP.queue.push({ disk: d }); }); return; }
        paths.forEach(function (d) { cpThumbFailed(d, e); });
      }).then(function () {
        CP.loadingThumbs--;
        cpPumpThumbs();
      });
    })(batch);
  }
}

/* ---------- своё превью, когда у Яндекса его нет ----------
   Маша, 10.11.2026: «у Яндекса иногда глючит превью — картинка на Диске может быть без превью.
   Если превью не загружено, нужно скачать сам файл, сделать из него превью и отправить —
   чтобы все картинки всегда отображались».
   Порядок для кадра без превью:
     1) готовое своё превью из служебной папки: <_ContentPulse>/превью/<2 знака md5>/<md5>.jpg;
     2) нет его — файл переносится в Облако (прослойка, op=whole), страница забирает его оттуда,
        уменьшает до CP_THUMB_SIDE и показывает; уменьшенная копия ложится в служебную папку —
        второй раз (и у коллег) кадр берётся оттуда, без переноса исходника;
     3) Облако не отдало файл странице (нет доступа из браузера) — показываем сам файл по ссылке
        Облака: картинка видна, просто тяжелее.
   Не вышло ничего — «превью не загрузилось», как раньше. По два кадра одновременно: исходники тяжёлые. */
CP.ownQueue = [];
CP.ownBusy = 0;
CP.ownParallel = 2;
CP.ownDirs = {};       /* папки своих превью, которые уже создавали в этой вкладке */
CP.ownStats = { cached: 0, made: 0, direct: 0, failed: 0 };

function cpOwnPreviewPath(md5) {
  return CP_CONFIG.serviceDir.replace(/\/+$/, '') + '/превью/' + String(md5).slice(0, 2) + '/' + md5 + '.jpg';
}

function cpOwnPreview(disk, why) {
  if (!CPDisk.hasProxy()) { cpThumbFailed(disk, why); return; }
  CP.thumbPending[disk] = true;
  CP.ownQueue.push({ disk: disk, why: why });
  cpOwnPump();
}

function cpOwnPump() {
  while (CP.ownBusy < CP.ownParallel && CP.ownQueue.length) {
    (function (job) {
      CP.ownBusy++;
      cpOwnMake(job.disk).then(function (t) {
        cpThumbDone(job.disk, t);
      }, function (e) {
        CP.ownStats.failed++;
        if (window.console) console.warn('[CP] своё превью не получилось', job.disk, e && (e.body || e.message || e));
        cpThumbFailed(job.disk, job.why || e);
      }).then(function () { CP.ownBusy--; cpOwnPump(); });
    })(CP.ownQueue.shift());
  }
}

/** Картинка по ссылке без чтения её данных (когда Облако не отдаёт файл странице). */
function cpImgByUrl(url) {
  return new Promise(function (res, rej) {
    var img = new Image();
    img.onload = function () { res({ url: url, w: img.naturalWidth, h: img.naturalHeight }); };
    img.onerror = function () { rej(new Error('картинка по ссылке не открылась')); };
    img.src = url;
  });
}

function cpOwnMake(disk) {
  var p = App.photos.filter(function (q) { return q.disk === disk; })[0] || {};
  var md5 = p.md5 || '', name = p.name || String(disk).split('/').pop();
  var cached = md5 ? CPDisk.proxyFile(cpOwnPreviewPath(md5)).then(function (b) {
    if (!b || !b.size) throw new Error('пусто');
    return cpBlobToThumb(new Blob([b], { type: 'image/jpeg' }), false).then(function (t) {
      if (!t.w) throw new Error('не картинка');
      CP.ownStats.cached++;
      return t;
    });
  }) : Promise.reject(new Error('нет md5'));
  return cached.catch(function () {
    return CPDisk.proxyMpu({ op: 'whole', from: disk, size: p.size || 0, filename: name }).then(function (out) {
      if (!out || !out.url) throw new Error('Облако не выдало ссылку на файл');
      return fetch(out.url, { cache: 'no-store' }).then(function (r) {
        if (!r.ok) throw new Error('Облако: HTTP ' + r.status);
        return r.blob();
      }).then(function (blob) {
        return cpBlobToThumb(blob, true);
      }).then(function (t) {
        CP.ownStats.made++;
        /* уменьшенную копию — в служебную папку: в следующий раз берём её (ошибка записи не мешает показу) */
        if (md5 && t.blob) {
          var path = cpOwnPreviewPath(md5), dir = path.slice(0, path.lastIndexOf('/'));
          (CP.ownDirs[dir] ? Promise.resolve() : CPDisk.ensureDir(dir).then(function () { CP.ownDirs[dir] = true; }))
            .then(function () { return CPDisk.uploadBlob(path, t.blob, true); })
            .catch(function (e) { if (window.console) console.warn('[CP] своё превью не сохранилось', path, e && (e.body || e.message || e)); });
        }
        return { url: t.url, w: t.w, h: t.h };
      }, function (e) {
        /* файл в Облаке есть, но странице не отдался или не уменьшился — показываем его по ссылке */
        return cpImgByUrl(out.url).then(function (t) { CP.ownStats.direct++; return t; }, function () { throw e; });
      });
    });
  });
}

/* Заглушка вместо «файл не найден» для кадров с Диска, пока превью грузится. */
cbImgHtml = (function (orig) {
  return function (photo) {
    if (photo && photo.disk && !photo.dataUrl) {
      var txt = photo.missing ? 'нет на Диске' : (photo._thumbState === 'failed' ? 'превью не загрузилось' : 'загрузка...');
      return '<div class="cb-missing-box" style="color:#a3a09a" title="' + cbEsc(photo.disk) + '">' + txt + '</div>';
    }
    return orig(photo);
  };
})(cbImgHtml);

/* ---------- данные проекта и сохранение на Диск ---------- */

var _cbProjectDataOrig = cbProjectData;
cbProjectData = function () {
  var d = _cbProjectDataOrig();
  d.app = 'cardboard';
  d.cp = 2;
  d.mode = 'disk';
  d.photos = App.photos.map(function (p) {
    return {
      id: p.id, name: p.name, path: null, w: p.w, h: p.h, kind: p.kind || 'photo',
      disk: p.disk || null, size: p.size || 0, md5: p.md5 || '', added: p.added || null,
      dataUrl: p.disk ? null : p.dataUrl   /* превью Диска не храним, рефы — да */
    };
  });
  return d;
};

cbMarkDirty = (function (orig) {
  return function () {
    CP.editSeq++;
    var r = orig.apply(this, arguments);
    /* «есть несохранённые правки» — сразу в строке съёмки (одна перерисовка на пачку правок) */
    if (CP.shoot && !CP.lineTimer) CP.lineTimer = setTimeout(function () { CP.lineTimer = 0; cpUpdateStatusLine(); }, 50);
    return r;
  };
})(cbMarkDirty);

/* ---------- надёжное сохранение отбора ----------
   1) Конфликт (отбор успел сохранить кто-то другой) больше не затирает наши
      правки: три версии — исходная (что мы читали), наша и чужая — склеиваются
      по карточкам, блокам, шаблонам и статусам; где правили оба — побеждает наша.
   2) Пока запись идёт, копия отбора лежит в этом браузере; не успела
      сохраниться (закрыли вкладку, сбой сети) — при следующем открытии
      съёмки правки восстанавливаются.
   3) Состояние записи видно в строке съёмки. */

function cpClone(x) { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); }
function cpSame(a, b) { return JSON.stringify(a === undefined ? null : a) === JSON.stringify(b === undefined ? null : b); }

function cpMergeById(base, local, remote) {
  var idx = function (arr) { var m = {}; (arr || []).forEach(function (x) { if (x && x.id != null) m[x.id] = x; }); return m; };
  var B = idx(base), L = idx(local), R = idx(remote);
  var out = [], used = {};
  function pick(id) {
    var inB = id in B, inL = id in L, inR = id in R;
    if (inL && inR) {
      if (!inB) return L[id];
      if (cpSame(L[id], B[id])) return R[id];
      if (cpSame(R[id], B[id])) return L[id];
      /* правили оба — склеиваем по полям: наше поле, если мы его меняли, иначе их */
      return cpMergeMap(B[id], L[id], R[id]);
    }
    if (inL) return (!inB || !cpSame(L[id], B[id])) ? L[id] : null;   /* у них удалили, мы не трогали — удаляем */
    if (inR) return (!inB || !cpSame(R[id], B[id])) ? R[id] : null;   /* мы удалили, они не трогали — удаляем */
    return null;
  }
  (remote || []).forEach(function (x) { if (!x || used[x.id]) return; used[x.id] = true; var v = pick(x.id); if (v) out.push(v); });
  (local || []).forEach(function (x) { if (!x || used[x.id]) return; used[x.id] = true; var v = pick(x.id); if (v) out.push(v); });
  return out;
}

function cpMergeMap(base, local, remote) {
  base = base || {}; local = local || {}; remote = remote || {};
  var out = {}, keys = {};
  [base, local, remote].forEach(function (m) { Object.keys(m).forEach(function (k) { keys[k] = true; }); });
  Object.keys(keys).forEach(function (k) {
    var v = !cpSame(local[k], base[k]) ? local[k] : remote[k];
    if (v !== undefined) out[k] = v;
  });
  return out;
}

/* Номера карточек и кадров у Cardboard идут подряд (p12, p13...), и два
   человека, правящие одновременно, выдали бы одинаковые номера разным
   карточкам. Добавляем к номеру метку этой вкладки — номера не пересекаются. */
CP.idTag = '_' + Math.random().toString(36).slice(2, 6);
cbId = function () { return 'p' + (App.nextId++) + CP.idTag; };

/* Один и тот же новый файл Диска могли завести под разными номерами у нас
   и у них — наши ссылки переводим на их номер, чтобы кадр не задвоился. */
function cpRemapLocal(local, remote) {
  var byDisk = {}, haveId = {}, map = {}, n = 0;
  (remote.photos || []).forEach(function (p) { haveId[p.id] = true; if (p.disk) byDisk[p.disk] = p.id; });
  (local.photos || []).forEach(function (p) {
    if (!haveId[p.id] && p.disk && byDisk[p.disk]) { map[p.id] = byDisk[p.disk]; n++; }
  });
  if (!n) return local;
  local = cpClone(local);
  local.photos = local.photos.filter(function (p) { return !map[p.id]; });
  (local.cards || []).forEach(function (c) {
    if (c.pids) c.pids = c.pids.map(function (x) { return map[x] || x; });
    (c.slots || []).forEach(function (sl) { if (sl.pid && map[sl.pid]) sl.pid = map[sl.pid]; });
    if (c.cpAutoSeen) c.cpAutoSeen = c.cpAutoSeen.map(function (x) { return map[x] || x; });
  });
  var cp = (local.meta || {}).cp || {};
  ['status', 'downloads', 'likes'].forEach(function (k) {
    var m = cp[k];
    if (!m) return;
    Object.keys(map).forEach(function (id) { if (id in m) { m[map[id]] = m[id]; delete m[id]; } });
  });
  return local;
}

/** Склеить три версии отбора. base может быть null — тогда просто объединяем. */
function cpMerge3(base, local, remote) {
  base = base || {}; local = local || {}; remote = remote || {};
  local = cpRemapLocal(local, remote);
  var out = cpClone(remote);
  ['cards', 'containers', 'templates'].forEach(function (k) { out[k] = cpMergeById(base[k], local[k], remote[k]); });
  var ph = {}, photos = [];
  (remote.photos || []).concat(local.photos || []).forEach(function (p) { if (p && !ph[p.id]) { ph[p.id] = true; photos.push(p); } });
  out.photos = photos;
  out.nextId = Math.max(+local.nextId || 0, +remote.nextId || 0);
  var bm = (base.meta || {}).cp || {}, lm = (local.meta || {}).cp || {}, rm = (remote.meta || {}).cp || {};
  out.meta = out.meta || {};
  var cp = out.meta.cp = cpClone(rm) || {};
  /* Склеиваются ВСЕ поля отметок, а не перечисленные: новое поле (так было с «brak» в 2.0.82)
     иначе при конфликте молча бралось из чужой версии и наша запись пропадала.
     Поле-словарь (кадр или карточка -> запись) склеивается по записям; остальное — целиком:
     наше, если мы его меняли, иначе их. Журнал (events) — отдельно, ниже. */
  var isMap = function (x) { return !!x && typeof x === 'object' && !Array.isArray(x); };
  var mkeys = {};
  [bm, lm, rm].forEach(function (m) { Object.keys(m).forEach(function (k) { mkeys[k] = true; }); });
  Object.keys(mkeys).forEach(function (k) {
    if (k === 'events') return;
    var vals = [bm[k], lm[k], rm[k]].filter(function (v) { return v !== undefined && v !== null; });
    if (vals.length && vals.every(isMap)) { cp[k] = cpMergeMap(bm[k], lm[k], rm[k]); return; }
    var v = !cpSame(lm[k], bm[k]) ? lm[k] : rm[k];
    if (v === undefined) delete cp[k]; else cp[k] = cpClone(v);
  });
  ['status', 'cardStatus', 'downloads', 'likes', 'folderTags', 'delivered', 'rv', 'ap2', 'q'].forEach(function (k) { if (!isMap(cp[k])) cp[k] = {}; });
  var seen = {}, ev = [];
  (rm.events || []).concat(lm.events || []).forEach(function (e) {
    var key = e.ts + '|' + e.action + '|' + e.actor + '|' + JSON.stringify(e.items || []);
    if (!seen[key]) { seen[key] = true; ev.push(e); }
  });
  ev.sort(function (a, b) { return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0; });
  cp.events = ev;
  return out;
}

function cpBackupKey(path) { return 'cp_bak:' + path; }
function cpBackupSave(path, data, rev) {
  /* base — версия с Диска, от которой шли правки: по ней при восстановлении
     понятно, что поменяли мы, а что потом поменяли другие */
  try { localStorage.setItem(cpBackupKey(path), JSON.stringify({ ts: new Date().toISOString(), rev: rev || '', data: data, base: CP.base || null })); }
  catch (e) { if (window.console) console.warn('[CP] копия отбора в браузере не записалась', e && e.message); }
}
function cpBackupDrop(path) { try { localStorage.removeItem(cpBackupKey(path)); } catch (e) { } }
function cpBackupGet(path) {
  try { var v = localStorage.getItem(cpBackupKey(path)); return v ? JSON.parse(v) : null; } catch (e) { return null; }
}

function cpSaveState(text, kind) {
  CP.saveState = { text: text, kind: kind || '' };
  cpUpdateStatusLine();
}

var _cbAutosaveOrig = cbAutosaveNow;
cbAutosaveNow = function () {
  if (!CP.shoot) return _cbAutosaveOrig();
  if (!App.dirty || CP.saving) return;
  if (CP.readOnly) {
    var el0 = document.getElementById('cbMode');
    if (el0) el0.textContent = 'отбор не сохраняется: не прочитан с Диска';
    return;
  }
  CP.saving = true;
  var seq = CP.editSeq;
  var data = cbProjectData();
  cpBackupSave(CP.shoot.path, data, CP.rev);
  cpSaveState('сохраняю…', 'busy');
  /* Запись могла закончиться, когда уже открыта другая съёмка: тогда её
     ревизию и флаги не трогаем — иначе следующая запись новой съёмки уйдёт
     с чужой ревизией, словит «конфликт» и потеряет правки. */
  var path = CP.shoot.path;
  function sameShoot() { return CP.shoot && CP.shoot.path === path; }
  var baseRev = CP.rev;
  /* перед записью — версия того, что лежит на Диске (раз в 30 минут) */
  cpSnapshot(path, baseRev).then(function () {
    return CPDisk.writeState(path, data, baseRev);
  }).then(function (rev) {
    CP.saving = false;
    if (!sameShoot()) { if (App.dirty) cbScheduleAutosave(); return; }
    CP.rev = rev;
    CP.base = cpClone(data);
    /* за время записи могли быть новые правки — тогда сохраняем ещё раз */
    if (CP.editSeq === seq) { cbClearDirty(); cpBackupDrop(path); cpSaveState('сохранено ' + new Date().toLocaleTimeString('ru-RU').slice(0, 5), 'ok'); }
    else cbScheduleAutosave();
    var el = document.getElementById('cbMode');
    if (el) el.textContent = 'на Диске · ' + new Date().toLocaleTimeString('ru-RU').slice(0, 5);
  }, function (e) {
    CP.saving = false;
    if (!sameShoot()) {
      if (e && e.conflict) cbToast('Последние правки прошлой съёмки не сохранились: её отбор изменил другой пользователь.');
      else cpHandleError(e, 'Не удалось сохранить отбор прошлой съёмки');
      if (App.dirty) cbScheduleAutosave();
      return;
    }
    if (e && e.conflict) {
      /* чужая версия + наши правки: склеиваем и сохраняем ещё раз */
      var merged = cpMerge3(CP.base, cbProjectData(), e.data || {});
      CP.rev = e.rev;
      cpApplyRemote(merged);
      CP.base = cpClone(e.data || {});
      cbMarkDirty();
      cpEvent('merged', [], { note: 'отбор одновременно правили — версии склеены' }, true);
      cbToast('Отбор одновременно правил кто-то ещё — версии склеены, ничего не потеряно.');
      return;
    }
    cpSaveState('не сохранено: ' + ((e && (e.message || e.status)) || 'ошибка') + ' — повторяю', 'err');
    cpHandleError(e, 'Не удалось сохранить отбор на Диск');
    cbScheduleAutosave();
  });
};

/* ---------- версии отбора ----------
   Копия файла отбора съёмки в <служебная папка>/версии отборов/<съёмка>/
   «2026-11-05 07-43-10 Маша.json». Копирует Диск у себя (через прослойку),
   браузер ничего не загружает. Делается перед записью, если с прошлой
   копии этой съёмки прошло 30 минут (и при первой записи после открытия
   страницы). Старые версии программа не удаляет. */

var CP_SNAP_EVERY = 30 * 60 * 1000;
CP.snapAt = {};

function cpSnapDir(shootPath) {
  var name = String(shootPath || '').replace(/\/+$/, '').split('/').pop();
  return CP_CONFIG.serviceDir + '/версии отборов/' + CPDisk.safeName(name);
}

function cpSnapStamp(d) {
  var z = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + ' ' + z(d.getHours()) + '-' + z(d.getMinutes()) + '-' + z(d.getSeconds());
}

/** Версия файла отбора на Диске. Ошибки не мешают записи: только в консоль. */
function cpSnapshot(shootPath, rev, force) {
  if (!rev || !CPDisk.hasProxy()) return Promise.resolve(null);
  var now = Date.now();
  if (!force && CP.snapAt[shootPath] && now - CP.snapAt[shootPath] < CP_SNAP_EVERY) return Promise.resolve(null);
  CP.snapAt[shootPath] = now;
  var dir = cpSnapDir(shootPath);
  var who = cpActor();
  var target = dir + '/' + cpSnapStamp(new Date()) + (who ? ' ' + CPDisk.safeName(who) : '') + '.json';
  var from = shootPath.replace(/\/+$/, '') + '/' + CPDisk.STATE_FILE;
  var job = CPDisk.proxyCopy([{ from: from, path: target }], [dir]).then(function (r) {
    var st = r && r.results && r.results[0];
    if (!st || (st.status !== 'done' && st.status !== 'exists')) throw new Error((st && st.error) || 'копия не создана');
    return target;
  }).catch(function (e) {
    if (window.console) console.warn('[CP] версия отбора не сохранилась', e && (e.body || e.message || e));
    return null;
  });
  /* запись отбора не ждёт копию дольше 8 секунд */
  return Promise.race([job, new Promise(function (r) { setTimeout(function () { r(null); }, 8000); })]);
}

function cpVersLabel(name) {
  var m = /^(\d{4})-(\d\d)-(\d\d) (\d\d)-(\d\d)(?:-\d\d)?\s*(.*)\.json$/.exec(name);
  return m ? { when: m[3] + '.' + m[2] + '.' + m[1] + ' ' + m[4] + ':' + m[5], who: m[6] } : { when: name, who: '' };
}

function cpRenderVersions() {
  var box = document.getElementById('cpVersList');
  box.innerHTML = '<div class="cp-empty">Читаю версии...</div>';
  var path = CP.shoot.path;
  CPDisk.listDir(cpSnapDir(path)).then(function (items) {
    if (!CP.shoot || CP.shoot.path !== path) return;
    items = items.filter(function (it) { return it.type === 'file' && /\.json$/i.test(it.name); })
      .sort(function (a, b) { return a.name < b.name ? 1 : a.name > b.name ? -1 : 0; });
    box.innerHTML = items.map(function (it) {
      var l = cpVersLabel(it.name);
      return '<div class="cp-log-item cp-vers-item"><div><b>' + cbEsc(l.when) + '</b>' + (l.who ? ' · ' + cbEsc(l.who) : '')
        + '<br><small>' + Math.max(1, Math.round((it.size || 0) / 1024)) + ' КБ</small></div>'
        + '<button data-cp-vers="' + cbEsc(it.path) + '">Вернуть</button></div>';
    }).join('') || '<div class="cp-empty">Версий пока нет — первая появится при следующей правке</div>';
  }, function (e) {
    if (e && e.status === 404) { box.innerHTML = '<div class="cp-empty">Версий пока нет — первая появится при следующей правке</div>'; return; }
    box.innerHTML = '<div class="cp-empty">Не удалось прочитать версии: ' + cbEsc(String(e && (e.message || e.status) || e)) + '</div>';
  });
}

/** Поставить версию вместо текущего отбора: текущий сначала тоже уходит в версии. */
function cpRestoreVersion(file) {
  if (!CP.shoot || CP.readOnly) { cbToast('Отбор не прочитан с Диска — возвращать версию нельзя'); return; }
  var l = cpVersLabel(file.split('/').pop());
  if (!confirm('Вернуть отбор к версии ' + l.when + (l.who ? ' (' + l.who + ')' : '') + '?\nТекущий отбор перед этим сохранится отдельной версией.')) return;
  var path = CP.shoot.path;
  cbBusyShow('Возвращаю версию...');
  cpSnapshot(path, CP.rev, true).then(function () {
    return CPDisk.proxyFile(file);
  }).then(function (b) { return b.text(); }).then(function (t) {
    cbBusyHide();
    if (!CP.shoot || CP.shoot.path !== path) return;
    var data = JSON.parse(t);
    /* журнал не теряем: события версии + всё, что было после неё */
    var cur = cpMeta().events || [];
    data.meta = data.meta || {};
    data.meta.cp = data.meta.cp || {};
    var seen = {}, ev = [];
    (data.meta.cp.events || []).concat(cur).forEach(function (e) {
      var k = e.ts + '|' + e.action + '|' + e.actor;
      if (!seen[k]) { seen[k] = true; ev.push(e); }
    });
    ev.sort(function (a, b) { return a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0; });
    data.meta.cp.events = ev;
    cpApplyRemote(data);
    cpEvent('restore_version', [], { note: 'версия от ' + l.when + (l.who ? ' (' + l.who + ')' : '') });
    cbMarkDirty();
    cbScheduleAutosave();
    document.getElementById('cpVers').classList.remove('cp-open');
    cbToast('Отбор возвращён к версии ' + l.when + ' — сохраняю на Диск');
  }).catch(function (e) {
    cbBusyHide();
    cpHandleError(e, 'Не удалось вернуть версию');
  });
}

document.getElementById('cpMenuRetouchSync').onclick = function () {
  cbCloseAllPops();
  if (!CP.shoot) { cbToast('Сначала откройте съёмку'); return; }
  cpRetouchResync(true);
};

document.getElementById('cpMenuVersions').onclick = function () {
  cbCloseAllPops();
  if (!CP.shoot) { cbToast('Сначала откройте съёмку'); return; }
  if (!CPDisk.hasProxy()) { cbToast('Версии работают через облачную прослойку — она не настроена'); return; }
  document.getElementById('cpVers').classList.add('cp-open');
  cpRenderVersions();
};
document.getElementById('cpVersClose').onclick = function () { document.getElementById('cpVers').classList.remove('cp-open'); };
document.getElementById('cpVersNow').onclick = function () {
  if (!CP.shoot) return;
  if (!CP.rev) { cbToast('Отбор этой съёмки ещё ни разу не сохранялся'); return; }
  var b = this;
  b.disabled = true;
  cpSnapshot(CP.shoot.path, CP.rev, true).then(function (t) {
    b.disabled = false;
    cbToast(t ? 'Версия сохранена' : 'Версия не сохранилась — подробности в консоли');
    if (t) setTimeout(cpRenderVersions, 1500);   /* новый файл виден в папке с задержкой */
  });
};
document.getElementById('cpVersList').addEventListener('click', function (e) {
  var b = e.target.closest('[data-cp-vers]');
  if (b) cpRestoreVersion(b.getAttribute('data-cp-vers'));
});

cbSaveProject = function () {
  if (!CP.shoot) { cbToast('Сначала откройте съёмку на витрине'); return; }
  App.dirty = true;
  cbAutosaveNow();
};

/* Чужие изменения: раз в pollMs проверяем ревизию, пока у нас нет своих правок. */
function cpStartPoll() {
  clearInterval(CP.pollTimer);
  CP.pollTimer = setInterval(function () {
    if (!CP.shoot || (App.dirty && !CP.readOnly) || CP.saving || document.hidden) return;
    CPDisk.stateRev(CP.shoot.path).then(function (rev) {
      if (!rev || rev === CP.rev || App.dirty) return;
      return CPDisk.readState(CP.shoot.path).then(function (st) {
        if (App.dirty && !CP.readOnly) return;
        CP.readOnly = false;
        CP.rev = st.rev;
        CP.base = cpClone(st.data);
        cpApplyRemote(st.data);
        cbToast('Отбор обновлён: изменения коллег');
        /* отбор мог не читаться с Диска (тогда карточки по папкам не собирались) — собираем теперь */
        if (typeof cpCollectCards === 'function') { try { cpCollectCards(); } catch (e) { } }
      });
    }).catch(function () { /* тихо: попробуем в следующий раз */ });
  }, CP_CONFIG.pollMs);
}

/* ---------- журнал и статусы ---------- */

function cpActor() {
  return CP.user ? (CP.user.display_name || CP.user.login || '') : '';
}

function cpEvent(action, items, extra, silent) {
  var m = cpMeta();
  var ev = { ts: new Date().toISOString(), action: action, actor: cpActor(), items: items || [] };
  Object.keys(extra || {}).forEach(function (k) { ev[k] = extra[k]; });
  m.events.push(ev);
  if (m.events.length > 3000) m.events.splice(0, m.events.length - 3000);
  if (!silent) cbMarkDirty();
  if (document.getElementById('cpLog').classList.contains('cp-open')) cpRenderLog();
}

var CP_ACTION_LABEL = {
  open: 'открыл(а) съёмку', files_found: 'найдены файлы', new_batch: 'пришла новая часть',
  to_retouch: 'отправил(а) на ретушь', to_reshoot: 'отправил(а) в брак (пересъём)',
  to_approval: 'отправил(а) на согласование', clear_status: 'снял(а) статус',
  download_shoot: 'скачал(а) всю съёмку', download_selection: 'скачал(а) отбор',
  changed_after_download: 'изменил(а) карточку после скачивания',
  merged: 'склеены версии отбора', restored: 'восстановлены несохранённые правки',
  collect_cards: 'собрал(а) карточки по папкам', auto_cards: 'карточки собраны по папкам артикулов',
  restore_version: 'вернул(а) версию отбора',
  retouch_sync: 'докопировал(а) на ретушь',
  added_to_approval_card: 'добавлено в карточку на согласовании — тоже на согласовании',
  rt_upload: 'сдал(а) ретушь на приёмку', rt_approve: 'отправил(а) на сайт', rt_rework: 'вернул(а) ретушь на доработку',
  removed_after_download: 'убрал(а) из отбора уже скачанное',
  added_to_retouch_card: 'добавил(а) кадры в карточку на ретуши',
  card_tag: 'поставил(а) тег карточке', card_untag: 'снял(а) тег с карточки'
};

function cpSetStatus(pids, status, cardId) {
  var m = cpMeta();
  var stamp = { by: cpActor(), ts: new Date().toISOString() };
  pids.forEach(function (pid) {
    if (status) m.status[pid] = { s: status, by: stamp.by, ts: stamp.ts, card: cardId || undefined };
    else delete m.status[pid];
  });
  if (cardId) {
    if (status) m.cardStatus[cardId] = { s: status, by: stamp.by, ts: stamp.ts };
    else delete m.cardStatus[cardId];
  }
}

function cpPhotoNames(pids) {
  return pids.map(function (pid) { var p = cbPhotoById(pid); return p ? p.name : pid; });
}

/** Главное действие: статус + журнал; для ретуши — копия файлов в папку Ретушь. */
function cpDoAction(status, pids, cardId) {
  /* каталог без папки этапа — ничего не делаем (cp-catalog.js) */
  if ((status === 'retouch' || status === 'approval') && typeof cpCatStageMissing === 'function'
    && cpCatStageMissing(status === 'retouch' ? 'retouch' : 'approve')) return;
  pids = pids.filter(function (pid) { var p = cbPhotoById(pid); return p && (p.kind || 'photo') !== 'ref'; });
  if (!pids.length) { cbToast('Нет кадров для действия'); return; }
  var card = cardId ? cbCardById(cardId) : null;
  var extra = card ? { card: card.title || card.category || ('карточка ' + (App.cards.indexOf(card) + 1)) } : {};
  if (!status) {
    cpSetStatus(pids, null, cardId);
    cpEvent('clear_status', cpPhotoNames(pids), extra);
    cpAfterStatus();
    return;
  }
  /* Маша, 10.11.2026: «сначала перенести файлы и только после их переноса присвоить статус —
     статус появляется на основании того, что что-то наличествует на Диске в нужном месте».
     Ретушь и согласование (в каталоге с папкой 02): копия -> проверка -> статус. Что не
     скопировалось сразу, уходит в очередь (cp-queue.js) и получает статус, когда доедет. */
  if (status === 'approval' && typeof cpApprovalSend === 'function' && cpApproveRoot()) {
    cpApprovalSend([{ cardId: cardId || null, pids: pids }]);
    return;
  }
  if (status !== 'retouch') {
    cpSetStatus(pids, status, cardId);
    cpEvent('to_' + status, cpPhotoNames(pids), extra);
    cpAfterStatus();
    cbToast(CP_STATUS[status].label + ': ' + pids.length + ' кадр(ов)');
    return;
  }
  /* уже на ретуши — повторно не отправляем и не перезаписываем (Маша, 06.11.2026) */
  var m0 = cpMeta();
  var fresh = pids.filter(function (pid) { return !(m0.status[pid] && m0.status[pid].s === 'retouch'); });
  if (!fresh.length) { cbToast('Уже на ретуши — повторно не отправляю'); return; }
  var going = cpGoingFrom('retouch');
  fresh = fresh.filter(function (pid) { var p = cbPhotoById(pid); return !(p && p.disk && going[p.disk]); });
  if (!fresh.length) { cbToast('Уже копируется на ретушь — статус появится, когда файлы будут на месте'); return; }
  cpRetouchCopy(fresh, card, 'Копирую на ретушь', { s: 'retouch', card: cardId || null, by: cpActor() }).then(function (r) {
    var ok = r.okPids || [];
    if (ok.length) {
      cpRetouchMark(ok, cardId);
      extra.folder = CPDisk.showPath(r.folder);
      extra.copied = r.done;
      if (r.exists) extra.existed = r.exists;
      cpEvent('to_retouch', cpPhotoNames(ok), extra);
    }
    cpAfterStatus();
    if (!ok.length && !r.queued) { cbToast('На ретушь не отправлено: этих кадров нет на Диске'); return; }
    cbToast('На ретушь: ' + r.done + ' скопировано' + (r.exists ? ', уже было ' + r.exists : '')
      + (r.queued ? '. Не скопировалось сразу: ' + r.queued + ' — копирую повторно, статус появится, когда файлы будут на месте; не закрывайте страницу' : '') + ' → ' + CPDisk.showPath(r.folder));
  }).catch(function (e) {
    cpAfterStatus();
    cpHandleError(e, 'Копирование на ретушь не удалось — статус не поставлен');
  });
}

/** Что уже едет в очереди за статусом s: {путь исходника: true}. */
function cpGoingFrom(s) {
  if (typeof CPQ === 'undefined') return {};
  return CPQ.pendingFrom(function (op) { return op.after && op.after.type === 'st' && op.after.s === s; });
}

/** Статус «на ретуши» кадрам, чьи копии уже в папке ретуши, и их карточке. */
function cpRetouchMark(pids, cardId) {
  var m0 = cpMeta();
  if (cardId && m0.cardStatus[cardId] && m0.cardStatus[cardId].s === 'retouch') {
    cpSetStatus(pids, 'retouch', null);
    pids.forEach(function (pid) { m0.status[pid].card = cardId; });
  } else cpSetStatus(pids, 'retouch', cardId);
}

/* ---------- копии на ретушь ----------
   Куда: <папка ретуши из настроек>/<название съёмки>/<папки как в съёмке>/<имя файла>
   (без настройки — <съёмка>/Ретушь/...). Папка съёмки и все вложенные
   (лук или бренд, артикул) создаются сами.
   Кадр карточки артикула кладётся в папку этого артикула, даже если в
   съёмке он лежит в корне лука: кадры лука становятся кадрами артикула,
   как только их положили в его карточку.
   Что не скопировалось — копится в CP.retouchMissing, в строке съёмки
   появляется «не скопировано на ретушь: N — докопировать». */

function cpRetouchRel(p, card, shootPath) {
  var rel = p.disk.indexOf(shootPath + '/') === 0 ? p.disk.slice(shootPath.length + 1) : p.name;
  var c = card && card.cpArticleDir ? card : App.cards.filter(function (x) {
    return x.cpArticleDir && cpCardPids(x).indexOf(p.id) !== -1;
  })[0];
  if (!c) return rel;
  var d = c.cpArticleDir;
  return rel.indexOf(d + '/') === 0 ? rel : d + '/' + p.name;
}

/* after — {s, by, card | cards: {кадр: карточка}}: статус, который кадры получат, когда копия подтвердится.
   В ответе okPids — кадры, чья копия уже на месте (скопирована сейчас или была); остальные — в очереди. */
function cpRetouchCopy(pids, card, label, after) {
  var files = pids.map(function (pid) { return cbPhotoById(pid); }).filter(function (p) { return p && p.disk && !p.missing; });
  var shootPath = CP.shoot.path, shootName = CP.shoot.name;
  var ready = typeof cpEnsureSettings === 'function' ? cpEnsureSettings() : Promise.resolve();
  var folder = '', byFrom = {}, items = null;
  /* что записать в отбор, когда копии из очереди доедут: статус этим кадрам (CPQ.after.st) */
  var afterFor = function (list) {
    if (!after) return undefined;
    var a = { type: 'st', s: after.s, by: after.by || cpActor(), map: {} };
    if (after.card) a.card = after.card;
    list.forEach(function (it) {
      var pid = byFrom[it.from];
      a.map[it.from] = pid;
      if (after.cards && after.cards[pid]) (a.cards = a.cards || {})[pid] = after.cards[pid];
    });
    return a;
  };
  cbBusyShow(label + ': ' + files.length + ' кадр(ов)...', 0.2);
  return ready.then(function () {
    folder = cpRetouchBase(shootPath, shootName);
    var used = {};
    items = files.map(function (p) {
      var target = folder + '/' + cpRetouchRel(p, card, shootPath);
      /* два разных файла с одним именем в одну папку — второму суффикс, чтобы не потерялся */
      if (used[target] && used[target] !== p.disk) {
        var dot = target.lastIndexOf('.'), n = 2;
        var stem = dot > target.lastIndexOf('/') ? target.slice(0, dot) : target, ext = stem === target ? '' : target.slice(dot);
        while (used[stem + '_' + n + ext]) n++;
        target = stem + '_' + n + ext;
      }
      used[target] = p.disk;
      byFrom[p.disk] = p.id;
      return { from: p.disk, path: target };
    });
    return cpCopyOnDisk(items, [folder], label);
  }).then(function (r) {
    cbBusyHide();
    r.folder = folder;
    if (CP.shoot && CP.shoot.path === shootPath) {
      var miss = CP.retouchMissing = CP.retouchMissing || {};
      files.forEach(function (p) { delete miss[p.id]; });
      (r.failedFrom || []).forEach(function (f) { if (byFrom[f]) miss[byFrom[f]] = true; });
      cpUpdateStatusLine();
    }
    if (r.failed.length && window.console) console.error('[CP] retouch copy failed', r.failed);
    /* не скопированное — в очередь: переносим, пока не перенесём (cp-queue.js) */
    var left = (r.failedFrom || []).map(function (f) { return items.filter(function (it) { return it.from === f; })[0]; }).filter(Boolean);
    var bad = {};
    (r.failedFrom || []).forEach(function (f) { bad[f] = true; });
    r.okPids = files.filter(function (p) { return !bad[p.disk]; }).map(function (p) { return p.id; });
    if (left.length && typeof CPQ !== 'undefined') {
      CPQ.add({ path: shootPath, name: shootName }, { kind: 'copy', label: 'На ретушь: ' + left.length + ' кадр(ов)', items: left, dirs: [folder], after: afterFor(left) });
      r.queued = left.length;
      /* за ними следит очередь — «докопировать» в строке съёмки не нужно */
      left.forEach(function (it) { if (CP.retouchMissing) delete CP.retouchMissing[byFrom[it.from]]; });
      cpUpdateStatusLine();
    }
    return r;
  }, function (e) {
    cbBusyHide();
    if (items && items.length && typeof CPQ !== 'undefined') {
      CPQ.add({ path: shootPath, name: shootName }, { kind: 'copy', label: 'На ретушь: ' + items.length + ' кадр(ов)', items: items, dirs: [folder], err: (e && e.message) || '', after: afterFor(items) });
      return { done: 0, exists: 0, failed: [], folder: folder, queued: items.length, okPids: [] };
    }
    if (CP.shoot && CP.shoot.path === shootPath) {
      var miss = CP.retouchMissing = CP.retouchMissing || {};
      files.forEach(function (p) { miss[p.id] = true; });
      cpUpdateStatusLine();
    }
    throw e;
  });
}

/** Докопировать на ретушь: всё, что не скопировалось, — или (all) все кадры со статусом «на ретуши». */
function cpRetouchResync(all) {
  if (!CP.shoot) return;
  var m = cpMeta().status;
  var pids = all
    ? Object.keys(m).filter(function (pid) { return m[pid].s === 'retouch'; })
    : Object.keys(CP.retouchMissing || {});
  /* сданное на сайт в ретушь не возвращаем — его копии оттуда ушли в Корзину */
  if (typeof cpDonePids === 'function') { var done = cpDonePids(); pids = pids.filter(function (pid) { return !done[pid]; }); }
  if (!pids.length) { cbToast(all ? 'В этой съёмке нет кадров на ретуши' : 'Всё скопировано'); return; }
  cpRetouchCopy(pids, null, all ? 'Сверяю папку ретуши' : 'Докопирую на ретушь').then(function (r) {
    cpEvent('retouch_sync', [], { note: 'скопировано ' + r.done + ', уже было ' + r.exists + (r.failed.length ? ', не скопировано ' + r.failed.length : '') + ' → ' + CPDisk.showPath(r.folder) }, true);
    cbToast((all ? 'Папка ретуши сверена: ' : 'Докопировано: ') + r.done + ' скопировано, уже было ' + r.exists
      + (r.failed.length ? ', не скопировано ' + r.failed.length : ''));
  }).catch(function (e) { cpHandleError(e, 'Не удалось скопировать на ретушь'); });
}

/** Куда копировать на ретушь для съёмки. */
function cpRetouchBase(shootPath, shootName) {
  var root = CP.settings && CP.settings.retouch;
  return root ? root + '/' + shootName : shootPath + '/' + CPDisk.RETOUCH_DIR;
}

/**
 * Скопировать файлы на Диске (через прослойку, пачками по 50 — у функции
 * ограничено время). Возвращает {done, exists, failed:[...]}.
 */
function cpCopyOnDisk(items, dirs, label) {
  var res = { done: 0, exists: 0, failed: [] };
  var chunks = [];
  var CH = 50;
  for (var i = 0; i < items.length; i += CH) chunks.push(items.slice(i, i + CH));
  cbBusyShow(label + ': 0 / ' + items.length, 0.02);
  return chunks.reduce(function (chain, chunk, ci) {
    return chain.then(function () {
      return CPDisk.proxyCopy(chunk, ci === 0 ? dirs : []).then(function (out) {
        (out.results || []).forEach(function (x) {
          if (x.status === 'done') res.done++;
          else if (x.status === 'exists') res.exists++;
          else { res.failed.push(x.from.split('/').pop() + ': ' + (x.error || 'ошибка')); (res.failedFrom = res.failedFrom || []).push(x.from); }
        });
        cbBusyShow(label + ': ' + Math.min(items.length, (ci + 1) * CH) + ' / ' + items.length, (ci + 1) / chunks.length);
      });
    });
  }, Promise.resolve()).then(function () { return res; });
}

function cpAfterStatus() {
  cbRenderTray(); cbRenderCards(); cbRenderConts();
  cpUpdateStatusLine();
  /* статус появляется после копии — кнопки в просмотре крупно обновляем тогда же */
  if (CP.lb && typeof cpLbShow === 'function') cpLbShow();
}

function cpUpdateStatusLine() {
  var el = document.getElementById('cpStatusLine');
  if (!el) return;
  if (!CP.shoot) { el.textContent = ''; return; }
  var m = cpMeta(), n = { retouch: 0, reshoot: 0, approval: 0 };
  Object.keys(m.status).forEach(function (pid) { if (n[m.status[pid].s] !== undefined) n[m.status[pid].s]++; });
  var t = typeof cpShootType === 'function' ? cpShootType(CP.shoot.name) : null;
  el.innerHTML = '';
  var sv = CP.readOnly ? { text: 'отбор не сохраняется: не прочитан с Диска', kind: 'err' } : (App.dirty && !CP.saving ? { text: 'есть несохранённые правки', kind: 'busy' } : CP.saveState);
  if (sv && sv.text) {
    var b = document.createElement('b');
    b.className = 'cp-save cp-save-' + (sv.kind || '');
    b.textContent = sv.text;
    el.appendChild(b);
    el.appendChild(document.createTextNode(' · '));
  }
  el.appendChild(document.createTextNode((t ? t.name + (t.cardArticle ? ', артикул карточки по папке' : '') + ' · ' : '')
    + 'ретушь ' + n.retouch + ' · брак ' + n.reshoot + ' · согласование ' + n.approval));
  var miss = Object.keys(CP.retouchMissing || {}).length;
  if (miss) {
    el.appendChild(document.createTextNode(' · '));
    var a = document.createElement('button');
    a.className = 'cp-link cp-save-err';
    a.id = 'cpRetouchMissing';
    a.textContent = 'не скопировано на ретушь: ' + miss + ' — докопировать';
    a.onclick = function () { cpRetouchResync(false); };
    el.appendChild(a);
  }
}

/* бейджи статусов и кнопка действий — поверх отрисовки Cardboard */
function cpBadgeHTML(pid) {
  if (!CP.shoot) return '';
  var m = cpMeta(), st = m.status[pid], dl = m.downloads[pid], lk = m.likes[pid], html = '';
  if (lk) html += '<span class="cp-badge cp-like" title="' + cbEsc('Лайк · ' + lk.by + ' · ' + cpFmtDate(lk.ts)) + '">ЛАЙК</span>';
  if (st && CP_STATUS[st.s]) {
    html += '<span class="cp-badge cp-' + st.s + '" title="' + cbEsc(CP_STATUS[st.s].label + ' · ' + st.by + ' · ' + cpFmtDate(st.ts)) + '">'
      + CP_STATUS[st.s].short + '</span>';
  }
  if (CP_SHOW_DL && dl && dl.n) {
    html += '<span class="cp-badge cp-dl" title="' + cbEsc('Скачано ' + dl.n + ' раз · последний: ' + dl.last.by + ' · ' + cpFmtDate(dl.last.ts) + ' · ' + dl.last.export) + '">'
      + 'СКАЧАНО' + (dl.n > 1 ? ' ×' + dl.n : '') + '</span>';
  }
  return html;
}

function cpDecorate(rootId) {
  if (!CP.shoot) return;
  var root = document.getElementById(rootId);
  if (!root) return;
  Array.prototype.forEach.call(root.querySelectorAll('.cb-slot.cb-filled, .cb-cont-item, .cb-thumb'), function (el) {
    var pid = cpPidOf(el);
    if (!pid) return;
    var p = cbPhotoById(pid);
    if (!p || (p.kind || 'photo') === 'ref') return;
    if (p.disk) el.title = (cpRelDir(p) ? cpRelDir(p) + '/' : '') + p.name;
    var inRetouch = cpMeta().status[pid] && cpMeta().status[pid].s === 'retouch';
    el.insertAdjacentHTML('beforeend', cpBadgeHTML(pid)
      + '<span class="cp-acts">'
      + (inRetouch ? '' : '<button class="cp-act-rt" data-cp-retouch="' + pid + '" title="Отправить кадр на ретушь">на ретушь</button>')
      + (cpMeta().status[pid] && cpMeta().status[pid].s === 'reshoot' ? '' : '<button class="cp-act-brak" data-cp-brak="' + pid + '" title="Кадр в брак — на пересъём">в брак</button>')
      + '<button class="cp-act-more" data-cp-pid="' + pid + '" title="Другие действия: пересъём, согласование, снять статус">ещё</button></span>');
    el.setAttribute('data-cp-zoom', pid);
  });
  if (rootId === 'cbCards') {
    Array.prototype.forEach.call(root.querySelectorAll('.cb-card'), function (cardEl) {
      var head = cardEl.querySelector('.cb-card-head');
      var cid = cardEl.getAttribute('data-cid');
      if (!head || head.querySelector('[data-cp-card]')) return;
      var st = cpMeta().cardStatus[cid];
      var rt = document.createElement('button');
      rt.className = 'cb-mini cp-card-rt';
      rt.setAttribute('data-cp-card-retouch', cid);
      if (st && st.s === 'retouch') {
        rt.textContent = 'В ретуши';
        rt.title = 'Отправлена на ретушь · ' + st.by + ' · ' + cpFmtDate(st.ts);
        rt.style.borderColor = '#C9956B';
      } else {
        rt.textContent = 'На ретушь';
        rt.title = 'Отправить все кадры карточки на ретушь (с копией в папку ретуши)';
      }
      var bk = document.createElement('button');
      bk.className = 'cb-mini cp-card-brak';
      bk.setAttribute('data-cp-card-brak', cid);
      if (st && st.s === 'reshoot') {
        bk.textContent = 'В браке';
        bk.title = 'В браке' + (st.kind && typeof cpBrakKindLabel === 'function' ? ' ' + cpBrakKindLabel(st.kind) : '') + (st.note ? ': ' + st.note : '') + ' · ' + st.by + ' · ' + cpFmtDate(st.ts);
        bk.style.borderColor = '#d9534f';
      } else {
        bk.textContent = 'В брак';
        bk.title = 'Вся карточка в брак — на пересъём';
      }
      var btn = document.createElement('button');
      btn.className = 'cb-mini';
      btn.setAttribute('data-cp-card', cid);
      btn.textContent = st && CP_STATUS[st.s] && st.s !== 'retouch' && st.s !== 'reshoot' ? CP_STATUS[st.s].label : 'ещё';
      btn.title = 'Другие действия с карточкой: согласование, снять статус';
      if (st && st.s !== 'retouch' && st.s !== 'reshoot') btn.style.borderColor = '#C9956B';
      var before = head.querySelector('[data-act="tpl"]');
      head.insertBefore(rt, before);
      head.insertBefore(bk, before);
      head.insertBefore(btn, before);
    });
  }
}

function cpPidOf(el) {
  if (el.classList.contains('cb-thumb')) return el.getAttribute('data-pid');
  if (el.classList.contains('cb-cont-item')) {
    var cont = cbContById(el.getAttribute('data-kid'));
    return cont ? cont.photoIds[parseInt(el.getAttribute('data-pi'), 10)] : null;
  }
  var card = cbCardById(el.getAttribute('data-cid'));
  if (!card) return null;
  if (el.hasAttribute('data-auto-idx')) return (card.pids || [])[parseInt(el.getAttribute('data-auto-idx'), 10)];
  var s = card.slots[parseInt(el.getAttribute('data-idx'), 10)];
  return s ? s.pid : null;
}

function cpCardPids(card) {
  var out = [];
  if (card.mode === 'auto') out = (card.pids || []).slice();
  else (card.slots || []).forEach(function (s) { if (s.pid) out.push(s.pid); });
  return out;
}

/* ---------- фильтр галереи по папкам съёмки ---------- */

/** Путь кадра внутри съёмки без имени файла: 'Папка 1/Подпапка' или '' для корня. */
function cpRelDir(p) {
  if (!p.disk || !CP.shoot) return '';
  var root = CP.shoot.path.replace(/\/+$/, '') + '/';
  var rel = p.disk.indexOf(root) === 0 ? p.disk.slice(root.length) : p.name;
  var i = rel.lastIndexOf('/');
  return i < 0 ? '' : rel.slice(0, i);
}

function cpPhotoInFolder(p) {
  if (!CP.folder || !p.disk) return true;   /* рефы и локальные — всегда видны */
  var d = cpRelDir(p);
  if (CP.folder === '/') return d === '';
  return d === CP.folder || d.indexOf(CP.folder + '/') === 0;
}

/** Список папок: первый и второй уровень, с числом кадров (включая вложенные). */
function cpRenderFolderFilter() {
  var sel = document.getElementById('cpFolderFilter');
  if (!sel) return;
  var counts = {}, root = 0, total = 0;
  App.photos.forEach(function (p) {
    if (!p.disk || (p.kind || 'photo') === 'ref') return;
    total++;
    var d = cpRelDir(p);
    if (!d) { root++; return; }
    var parts = d.split('/');
    counts[parts[0]] = (counts[parts[0]] || 0) + 1;
    if (parts.length > 1) {
      var k2 = parts[0] + '/' + parts[1];
      counts[k2] = (counts[k2] || 0) + 1;
    }
  });
  var keys = Object.keys(counts).sort(function (a, b) {
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  });
  sel.parentNode.style.display = CP.shoot ? '' : 'none';
  sel.style.display = keys.length ? '' : 'none';
  var nl = CP.shoot ? Object.keys(cpMeta().likes).length : 0;
  var ll = document.getElementById('cpLikedLabel');
  if (ll) ll.textContent = 'только лайки · ' + nl;
  var extra = '';
  if (CP.folder && CP.folder !== '/' && !counts[CP.folder]) {
    if (CP.folderByCard) {
      /* папку выбрала карточка (лук глубже второго уровня или пустой) — показываем её отдельным пунктом */
      var n = App.photos.filter(function (p) { return p.disk && (p.kind || 'photo') !== 'ref' && cpPhotoInFolder(p); }).length;
      extra = '<option value="' + cbEsc(CP.folder) + '">' + cbEsc(CP.folder) + ' · ' + n + '</option>';
    } else CP.folder = '';
  }
  var html = '<option value="">Все папки · ' + total + '</option>' + extra;
  if (root && keys.length) html += '<option value="/">Корень съёмки · ' + root + '</option>';
  keys.forEach(function (k) {
    var lvl2 = k.indexOf('/') !== -1;
    var label = lvl2 ? '\u00a0\u00a0\u00a0\u00a0' + k.slice(k.indexOf('/') + 1) : k;
    html += '<option value="' + cbEsc(k) + '">' + cbEsc(label) + ' · ' + counts[k] + '</option>';
  });
  sel.innerHTML = html;
  sel.value = CP.folder;
}

(function cpInjectFolderFilter() {
  var head = document.querySelector('.cb-tray-head');
  if (!head) return;
  var row = document.createElement('div');
  row.className = 'cb-row cp-filter-row';
  row.style.display = 'none';
  row.style.marginTop = '6px';
  row.innerHTML = '<select id="cpFolderFilter" title="Показать только содержимое папки (со всеми вложенными)" style="width:100%"></select>'
    + '<label class="cp-liked-only" title="Кадры с лайком: двойной клик по кадру → «Лайк» или клавиша L"><input type="checkbox" id="cpLikedOnly"> <span id="cpLikedLabel">только лайки</span></label>';
  head.appendChild(row);
  document.getElementById('cpLikedOnly').onchange = function () {
    CP.likedOnly = this.checked;
    cbRenderTray();
  };
  document.getElementById('cpFolderFilter').onchange = function () {
    CP.folder = this.value;
    CP.folderByCard = false;
    cbRenderTray();
  };
})();

/* галерея: рисуем только кадры выбранной папки (Cardboard об этом не знает —
   на время отрисовки подставляем ему отфильтрованный список) */
cbRenderTray = (function (orig) {
  return function () {
    cpRenderFolderFilter();
    if (!CP.shoot || (!CP.folder && !CP.likedOnly)) return orig.apply(this, arguments);
    var all = App.photos, likes = cpMeta().likes;
    App.photos = all.filter(function (p) {
      return cpPhotoInFolder(p) && (!CP.likedOnly || !p.disk || !!likes[p.id]);
    });
    try { return orig.apply(this, arguments); }
    finally { App.photos = all; }
  };
})(cbRenderTray);

['cbRenderCards', 'cbRenderConts', 'cbRenderTray'].forEach(function (fn) {
  var orig = window[fn];
  var root = { cbRenderCards: 'cbCards', cbRenderConts: 'cbConts', cbRenderTray: 'cbTrayGrid' }[fn];
  window[fn] = function () {
    var r = orig.apply(this, arguments);
    cpDecorate(root);
    return r;
  };
});

/* меню действий */
function cpOpenMenu(anchor, title, onPick, extra) {
  var menu = document.getElementById('cpMenu');
  menu.innerHTML = '<div class="cp-menu-title">' + cbEsc(title) + '</div>'
    + '<button data-s="retouch">На ретушь (копия в папку ретуши)</button>'
    + '<button data-s="reshoot">В брак (пересъём)</button>'
    + '<button data-s="approval">На согласование</button>'
    + '<button data-s="">Снять статус</button>'
    + (extra ? extra.html : '');
  menu.classList.add('cp-open');
  var r = anchor.getBoundingClientRect();
  var w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
  menu.style.top = (r.bottom + h + 8 > innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4) + 'px';
  menu.onclick = function (e) {
    var x = extra && e.target.closest('[data-x]');
    if (x) { menu.classList.remove('cp-open'); extra.onClick(x); return; }
    var b = e.target.closest('button[data-s]');
    if (!b) return;
    menu.classList.remove('cp-open');
    onPick(b.getAttribute('data-s'));
  };
}

document.addEventListener('click', function (e) {
  var menu = document.getElementById('cpMenu');
  var bkPhoto = e.target.closest('[data-cp-brak]');
  var bkCard = e.target.closest('[data-cp-card-brak]');
  if (bkPhoto) {
    e.preventDefault(); e.stopPropagation();
    cpDoAction('reshoot', [bkPhoto.getAttribute('data-cp-brak')], null);
    return;
  }
  if (bkCard) {
    e.preventDefault(); e.stopPropagation();
    var kc = cbCardById(bkCard.getAttribute('data-cp-card-brak'));
    if (!kc) return;
    var kst = cpMeta().cardStatus[kc.id];
    if (kst && kst.s === 'reshoot') { cbToast('Карточка уже в браке: ' + kst.by + ', ' + cpFmtDate(kst.ts) + '. Снять — через «ещё».'); return; }
    cpDoAction('reshoot', cpCardPids(kc), kc.id);
    return;
  }
  var rtPhoto = e.target.closest('[data-cp-retouch]');
  var rtCard = e.target.closest('[data-cp-card-retouch]');
  if (rtPhoto) {
    e.preventDefault(); e.stopPropagation();
    cpDoAction('retouch', [rtPhoto.getAttribute('data-cp-retouch')], null);
    return;
  }
  if (rtCard) {
    e.preventDefault(); e.stopPropagation();
    var rc = cbCardById(rtCard.getAttribute('data-cp-card-retouch'));
    if (!rc) return;
    var cst = cpMeta().cardStatus[rc.id];
    if (cst && cst.s === 'retouch') { cbToast('Карточка уже в ретуши: ' + cst.by + ', ' + cpFmtDate(cst.ts) + '. Снять — через «ещё».'); return; }
    cpDoAction('retouch', cpCardPids(rc), rc.id);
    return;
  }
  var actPhoto = e.target.closest('[data-cp-pid]');
  var actCard = e.target.closest('[data-cp-card]');
  if (actPhoto) {
    e.preventDefault(); e.stopPropagation();
    var pid = actPhoto.getAttribute('data-cp-pid');
    var p = cbPhotoById(pid);
    cpOpenMenu(actPhoto, p ? p.name : 'Кадр', function (s) { cpDoAction(s, [pid], null); });
    return;
  }
  if (actCard) {
    e.preventDefault(); e.stopPropagation();
    var card = cbCardById(actCard.getAttribute('data-cp-card'));
    if (!card) return;
    var pids = cpCardPids(card);
    cpOpenMenu(actCard, 'Карточка: ' + (card.title || 'без названия') + ' · кадров ' + pids.length,
      function (s) { cpDoAction(s, pids, card.id); });
    return;
  }
  if (!e.target.closest('#cpMenu')) menu.classList.remove('cp-open');
}, true);

/* журнал */
function cpRenderLog() {
  var m = cpMeta();
  var html = m.events.slice().reverse().map(function (ev) {
    var what = CP_ACTION_LABEL[ev.action] || ev.action;
    var detail = [];
    if (ev.card) detail.push('карточка «' + ev.card + '»');
    if (ev.items && ev.items.length) detail.push(ev.items.length + ' кадр(ов): ' + ev.items.slice(0, 6).join(', ') + (ev.items.length > 6 ? '...' : ''));
    if (ev.count) detail.push('файлов: ' + ev.count);
    if (ev.folder) detail.push('копии: ' + ev.folder);
    if (ev.note) detail.push(ev.note);
    return '<div class="cp-log-item"><small>' + cpFmtDate(ev.ts) + '</small><br>'
      + '<b>' + cbEsc(ev.actor || 'кто-то') + '</b> ' + cbEsc(what)
      + (detail.length ? '<br><small>' + cbEsc(detail.join(' · ')) + '</small>' : '') + '</div>';
  }).join('');
  document.getElementById('cpLogList').innerHTML = html || '<div class="cp-empty">Пока пусто</div>';
}
document.getElementById('cpMenuLog').onclick = function () {
  cbCloseAllPops();
  if (!CP.shoot) { cbToast('Сначала откройте съёмку'); return; }
  cpRenderLog();
  document.getElementById('cpLog').classList.add('cp-open');
};
document.getElementById('cpLogClose').onclick = function () { document.getElementById('cpLog').classList.remove('cp-open'); };

/* ---------- скачивание ---------- */

/* С октября 2026 Яндекс не отдаёт папки архивом (ссылка на папку — 500),
   отдельные файлы отдаёт, а запись на Диск идёт ~0,1 МБ/с. Поэтому ZIP
   собирает наша прослойка в Yandex Cloud: читает кадры по одному и кладёт
   архив в закрытое хранилище (Object Storage, 3 дня), страница получает
   подписанную ссылку на 3 дня. Без хранилища — запасной путь: архив на
   Диск в <_ContentPulse>/выгрузки/. Большая выборка делится на части так,
   чтобы каждая собиралась за полминуты; части распаковываются в одну папку. */

var CP_EXPORTS = 'выгрузки';
var CP_ZIP_PART_MS = 30000;              /* целимся в ~30 с на часть */
var CP_ZIP_MIN = 40 * 1024 * 1024;
var CP_ZIP_MAX = 1800 * 1024 * 1024;
var CP_ZIP_FILE_MAX = 3.9 * 1024 * 1024 * 1024;   /* ZIP без ZIP64: файл больше не влезет */
CP.zipTarget = 100 * 1024 * 1024;        /* первая часть; дальше — по замеру скорости */

function cpExportsDir() { return CP_CONFIG.serviceDir.replace(/\/+$/, '') + '/' + CP_EXPORTS; }

/** Следующее имя выгрузки <base>_<N>: N считаем по журналу съёмки
    (архивы теперь живут в облаке, на Диске их нет). */
function cpNextExportName(base, events) {
  var max = 0;
  (events || []).forEach(function (ev) {
    var x = ev && ev.export;
    if (!x || x.indexOf(base + '_') !== 0) return;
    var n = parseInt(x.slice(base.length + 1), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return Promise.resolve(base + '_' + (max + 1));
}

function cpMb(b) { return b >= 1024 * 1024 * 1024 ? (b / 1073741824).toFixed(1) + ' ГБ' : Math.max(1, Math.round(b / 1048576)) + ' МБ'; }

/** Ссылка на готовый файл: сразу после загрузки Диск может ещё дообрабатывать его. */
function cpHrefWhenReady(path) {
  var tries = 0;
  function run() {
    return CPDisk.downloadHref(path).catch(function (e) {
      if (tries++ < 6 && e && (e.status === 404 || e.status === 423 || e.status >= 500)) {
        return new Promise(function (r) { setTimeout(r, 2000); }).then(run);
      }
      throw e;
    });
  }
  return run();
}

/**
 * Собрать архив выгрузки и начать скачивание.
 * entries: [{from: путь на Диске, name: путь внутри архива, size}]
 * -> {parts:[{path, href, files, bytes}], files, bytes}
 *
 * Маша, 06.11: «выбрали карточки — разбил архив на два куска, а должен
 * одним». Теперь архив всегда один: прослойка собирает его за несколько
 * вызовов кусками одной загрузки в облако (cpZipOne); больше 4 ГБ — ZIP64.
 * Несколько архивов — только если облака нет.
 */
CP.zipPartMin = 6 * 1024 * 1024;   /* кусок загрузки в облако, кроме последнего, — не меньше 5 МБ */

function cpZipExport(name, entries, note) {
  entries = entries.filter(function (e) { return e.size > 0; });
  var total = entries.reduce(function (a, e) { return a + e.size; }, 0);
  /* один архив любого размера: больше 4 ГБ прослойка пишет ZIP64 (Маша, 08.11: «скачать всё — пилит
     на 30 частей, а нужно одним архивом на пачку») */
  if (CPDisk.hasProxy() && entries.length < 60000) {
    if (total > CP.zipSplitAt) return cpZipSplit(name, entries, note);
    return cpZipOne(name, entries, note).catch(function (e) {
      if (e && e.status === 501) return cpZipParts(name, entries, note);   /* облако не настроено */
      throw e;
    });
  }
  return cpZipParts(name, entries, note);
}

/** Один архив, собранный за несколько вызовов прослойки. */
/* Большие файлы (видео) — в том же архиве, но кусками (Маша, 08.11: «видео скачалось, но
   15 архивов — почему на 5 ГБ 15 архивов?»): раньше каждое видео крупнее 48 МБ шло отдельной
   ссылкой. Теперь файл крупнее CP.zipBigMin режется на куски по CP.zipSlice: сначала прослойка
   считает контрольную сумму каждого куска (CRC складываются здесь), потом куски ложатся в
   архив — каждый вызов короткий. Отдельной ссылкой — только файл больше 4 ГБ. */
CP.zipBigMin = 64 * 1024 * 1024;
CP.zipSlice = 256 * 1024 * 1024;

/** CRC двух кусков подряд: crc1 — первого, crc2 — второго длиной len2 (как crc32_combine в zlib). */
function cpCrcCombine(crc1, crc2, len2) {
  if (len2 <= 0) return crc1 >>> 0;
  var times = function (mat, vec) { var sum = 0, i = 0; vec >>>= 0; while (vec) { if (vec & 1) sum ^= mat[i]; vec >>>= 1; i++; } return sum >>> 0; };
  var square = function (sq, mat) { for (var n = 0; n < 32; n++) sq[n] = times(mat, mat[n]); };
  var even = new Array(32), odd = new Array(32), row = 1;
  odd[0] = 0xedb88320;
  for (var n = 1; n < 32; n++) { odd[n] = row >>> 0; row = (row << 1) >>> 0; }
  square(even, odd);
  square(odd, even);
  crc1 >>>= 0;
  do {
    square(even, odd);
    if (len2 % 2) crc1 = times(even, crc1);
    len2 = Math.floor(len2 / 2);
    if (!len2) break;
    square(odd, even);
    if (len2 % 2) crc1 = times(odd, crc1);
    len2 = Math.floor(len2 / 2);
  } while (len2);
  return (crc1 ^ crc2) >>> 0;
}

/* Большая выборка — несколько архивов по ~3 ГБ, папками целиком (Маша, 08.11: архив на 8,4 ГБ
   собрался целым, но одним файлом не скачивается — оборвалось; «хотя бы 2 архива», «чтобы
   разбивал по папкам целиком»). Внутри у всех частей одна и та же корневая папка — распакованные
   рядом, они складываются в одну съёмку. */
CP.zipSplitAt = 3.2 * 1024 * 1024 * 1024;
CP.zipPartSize = 3 * 1024 * 1024 * 1024;

/** Разложить файлы по частям: папки верхнего уровня целиком; папка больше части — по вложенным, потом по файлам. */
function cpZipGroups(entries, limit) {
  var size = function (list) { return list.reduce(function (a, e) { return a + e.size; }, 0); };
  var split = function (list, depth) {
    /* группы по папке на уровне depth (порядок как в выборке) */
    var order = [], by = {};
    list.forEach(function (e) {
      var segs = e.name.split('/'), key = segs.length - 1 > depth ? segs.slice(0, depth + 1).join('/') : '\u0000файлы:' + segs.slice(0, depth).join('/');
      if (!by[key]) { by[key] = []; order.push(key); }
      by[key].push(e);
    });
    var out = [];
    order.forEach(function (k) {
      var g = by[k];
      if (size(g) <= limit || g.length === 1) out.push(g);
      else if (k.indexOf('\u0000') === 0) {
        /* файлы одной папки — подряд кусками по limit */
        var cur = [], cs = 0;
        g.forEach(function (e) { if (cur.length && cs + e.size > limit) { out.push(cur); cur = []; cs = 0; } cur.push(e); cs += e.size; });
        if (cur.length) out.push(cur);
      } else out = out.concat(split(g, depth + 1));
    });
    return out;
  };
  var groups = split(entries, 0), parts = [], cur = [], cs = 0;
  groups.forEach(function (g) {
    var gs = size(g);
    if (cur.length && cs + gs > limit) { parts.push(cur); cur = []; cs = 0; }
    cur = cur.concat(g); cs += gs;
  });
  if (cur.length) parts.push(cur);
  return parts;
}

function cpZipSplit(name, entries, note) {
  var groups = cpZipGroups(entries, CP.zipPartSize);
  if (groups.length < 2) return cpZipOne(name, entries, note);
  var all = { parts: [], files: 0, bytes: 0, skipped: [] };
  var head = (note ? note + ' ' : '') + 'Выборка большая — ' + groups.length + ' архива(ов) по папкам целиком; распакуйте их рядом — сложатся в одну папку.';
  return groups.reduce(function (chain, g, k) {
    return chain.then(function () {
      return cpZipOne(name + '_ч' + (k + 1), g, head, { root: name, prev: all.parts, multi: true, label: 'Часть ' + (k + 1) + ' из ' + groups.length });
    }).then(function (r) {
      all.parts = all.parts.concat(r.parts);
      all.files += r.files; all.bytes += r.bytes;
      all.skipped = all.skipped.concat(r.skipped || []);
      /* готовая часть сразу качается, пока собирается следующая */
      if (r.parts[0]) cpStartDownload(r.parts[0].href);
      cpDlCard(name, head, all.parts, k + 1 < groups.length ? 'Собираю часть ' + (k + 2) + ' из ' + groups.length + '...' : '');
    });
  }, Promise.resolve()).then(function () {
    cpDlCard(name, head + (all.skipped.length ? ' Не попали — Яндекс не отдаёт файл (проверьте его на Диске): '
      + all.skipped.map(function (x) { return x.name.split('/').pop(); }).slice(0, 10).join(', ') + (all.skipped.length > 10 ? '…' : '') + '.' : ''), all.parts, '');
    return all;
  });
}

/** Один архив, собранный за несколько вызовов прослойки. opts: {root, prev, multi, label} — для частей. */
function cpZipOne(name, entries, note, opts) {
  opts = opts || {};
  var root = opts.root || name, prevParts = opts.prev || [];
  var total = entries.reduce(function (a, e) { return a + e.size; }, 0);
  var target = cpExportsDir() + '/' + name + '.zip';
  var res = { parts: [], files: 0, bytes: 0 };
  var up = null, parts = [], done = [], offset = 0, n = 0, pi = 0, ts = Date.now(), skipped = [];
  /* куски: файл целиком или кусок большого файла */
  var pieces = [];
  var cut = function () {
    pieces = [];
    entries.forEach(function (e) {
      if (e.size > CP.zipBigMin && !e.noSlice) {
        for (var st = 0; st < e.size; st += CP.zipSlice) {
          pieces.push({ e: e, start: st, end: Math.min(e.size, st + CP.zipSlice) - 1, head: st === 0, last: st + CP.zipSlice >= e.size });
        }
      } else pieces.push({ e: e, whole: true, last: true });
    });
  };
  cut();
  var lenOf = function (p) { return p.whole ? p.e.size : p.end - p.start + 1; };
  cpDlCard(name, note, prevParts, 'Собираю архив' + (opts.label ? ' (' + opts.label.toLowerCase() + ')' : '') + '...');

  /* контрольные суммы больших файлов — по кускам */
  function crcBig() {
    var big = entries.filter(function (e) { return e.size > CP.zipBigMin && !e.noSlice; });
    if (!big.length) return Promise.resolve();
    var all = big.reduce(function (a, e) { return a + e.size; }, 0), seen = 0;
    return big.reduce(function (chain, e) {
      return chain.then(function () {
        var sl = pieces.filter(function (p) { return p.e === e; });
        var show = function () {
          var msg = 'Считаю контрольную сумму видео: ' + cpMb(seen) + ' из ' + cpMb(all);
          cbBusyShow(msg, Math.max(0.02, 0.3 * seen / all));
          cpDlCard(name, note, prevParts, msg);
        };
        show();
        /* куски одного файла — по три сразу, суммы складываются по порядку */
        return cpPool(sl, 3, function (p) {
          return CPDisk.proxyCrc({ from: e.from, start: p.start, end: p.end }).then(function (r) {
            seen += p.end - p.start + 1;
            show();
            return r.crc >>> 0;
          });
        }).then(function (crcs) {
          var crc = crcs[0];
          for (var k = 1; k < crcs.length; k++) crc = cpCrcCombine(crc, crcs[k], sl[k].end - sl[k].start + 1);
          e.crc = crc;
        }, function (err) {
          /* Диск не отдаёт файл кусками — этот файл целиком одним вызовом */
          if (err && /range_unsupported/.test(err.body || '')) { e.noSlice = true; return; }
          throw err;
        });
      });
    }, Promise.resolve()).then(cut);
  }

  function nextChunk() {
    var chunk = [], bytes = 0;
    var want = Math.max(CP.zipTarget, CP.zipPartMin);
    while (pi < pieces.length && (!chunk.length || bytes < want)) { chunk.push(pieces[pi]); bytes += lenOf(pieces[pi]); pi++; }
    /* хвост меньше минимального куска — забираем в этот вызов */
    var rest = 0;
    for (var j = pi; j < pieces.length; j++) rest += lenOf(pieces[j]);
    if (rest > 0 && rest < CP.zipPartMin) while (pi < pieces.length) { chunk.push(pieces[pi]); bytes += lenOf(pieces[pi]); pi++; }
    var final = pi >= pieces.length;
    n++;
    var nFiles = function (list) { return list.filter(function (p) { return p.last; }).length; };
    var msg = 'Собираю ' + (opts.label ? opts.label.toLowerCase() : 'архив') + ' ' + name + ': ' + cpMb(res.bytes + bytes) + ' из ' + cpMb(total) + ' · файлов ' + (res.files + nFiles(chunk)) + ' из ' + entries.length;
    cbBusyShow(msg, Math.max(0.03, res.bytes / Math.max(1, total)));
    cpDlCard(name, note, prevParts, msg);
    var t0 = Date.now();
    var tick = setInterval(function () {
      cbBusyShow(msg + ' · ' + Math.round((Date.now() - t0) / 1000) + ' с', Math.max(0.03, res.bytes / Math.max(1, total)));
    }, 1000);
    var asEntry = function (p) {
      var x = { from: p.e.from, name: root + '/' + p.e.name, size: p.e.size };
      if (!p.whole) { x.start = p.start; x.end = p.end; x.head = p.head; x.crc = p.e.crc; }
      return x;
    };
    var body = {
      key: up.key, uploadId: up.uploadId, n: n, ts: ts, offset: offset, target: target, final: final,
      entries: chunk.map(asEntry),
      done: final ? done : undefined
    };
    /* сеть оборвалась посреди куска (Яндекс: «terminated») — тот же кусок ещё раз:
       облако примет его под тем же номером поверх недописанного.
       Яндекс не отдаёт конкретный файл (Маша, 08.11: «ПустоеИмя_2.jpg: файл не отдан,
       HTTP 500» — прослойка уже повторила его трижды) — собираем кусок без него и
       пишем в карточке, что не попало (только целые файлы: кусок большого не выкинешь). */
    var tries = 0;
    var call = function () {
      return CPDisk.proxyZipPart(body).catch(function (e) {
        var txt = String((e && (e.body || e.message)) || e), j = null;
        try { j = JSON.parse(e && e.body); } catch (x) { }
        if (j && j.from && /не отдан|не выдана|terminated|нет ответа/.test(j.error || '') && skipped.length < 30) {
          var bad = null;
          chunk = chunk.filter(function (c) { if (!bad && c.whole && c.e.from === j.from) { bad = c; return false; } return true; });
          if (bad) {
            skipped.push({ name: bad.e.name, why: j.error });
            bytes -= bad.e.size;
            body.entries = chunk.map(asEntry);
            if (!body.entries.length && !final) return null;   /* кусок опустел — его номер возьмёт следующий */
            return call();
          }
        }
        if (tries >= 2 || /размер изменился|изменился во время|больше 4 ГБ|65 тысяч/.test(txt)) throw e;
        tries++;
        msg = 'Сеть оборвалась, повторяю кусок ' + n + ' (' + tries + ' из 2)... · ' + cpMb(res.bytes) + ' из ' + cpMb(total);
        cpDlCard(name, note, prevParts, msg);
        return new Promise(function (r) { setTimeout(r, 1500 * tries); }).then(call);
      });
    };
    return call().then(function (r) {
      clearInterval(tick);
      if (r === null) { n--; return final ? null : nextChunk(); }
      var heads = chunk.filter(function (p) { return p.whole || p.head; }).length;
      if (!r || !r.etag || !Array.isArray(r.done) || r.done.length !== heads) throw new Error('кусок архива ' + n + ' собран не полностью');
      parts.push({ n: r.n, etag: r.etag });
      done = done.concat(r.done);
      offset = r.next;
      res.files += nFiles(chunk);
      res.bytes += bytes;
      var ms = Math.max(1000, Date.now() - t0);
      CP.zipTarget = Math.max(CP_ZIP_MIN, Math.min(CP_ZIP_MAX, Math.round(bytes / ms * CP_ZIP_PART_MS)));
      return final ? null : nextChunk();
    }, function (e) { clearInterval(tick); throw e; });
  }
  return CPDisk.proxyMpu({ op: 'start', type: 'application/zip' }).then(function (st) {
    up = st;
    return crcBig();
  }).then(nextChunk).then(function () {
    return CPDisk.proxyMpu({ op: 'done', key: up.key, uploadId: up.uploadId, parts: parts, filename: name + '.zip' });
  }).then(function (out) {
    if (res.files + skipped.length !== entries.length) throw new Error('в архив попало ' + res.files + ' файлов из ' + entries.length);
    res.parts.push({ path: target, href: out.url, files: res.files, bytes: res.bytes, label: opts.label || 'Скачать ZIP', cloud: true });
    res.skipped = skipped;
    cbBusyHide();
    if (opts.multi) return res;   /* части: карточку и загрузку покажет cpZipSplit */
    cpStartDownload(out.url);
    cpDlCard(name, note + (skipped.length ? ' Не попали — Яндекс не отдаёт файл (проверьте его на Диске): '
      + skipped.map(function (x) { return x.name.split('/').pop(); }).slice(0, 10).join(', ') + (skipped.length > 10 ? '…' : '') + '.' : ''), res.parts, '');
    return res;
  }).catch(function (e) {
    cbBusyHide();
    if (up) CPDisk.proxyMpu({ op: 'abort', key: up.key, uploadId: up.uploadId }).catch(function () { });
    var why = (e && (e.body || e.message)) || e;
    try { var j = JSON.parse(why); if (j && j.error) why = j.error; } catch (x) { }
    if (!(e && e.status === 501 && !up)) cpDlCard(name, note, prevParts, '', 'Не удалось собрать архив: ' + why + '. Нажмите «Скачать» ещё раз — если повторится, напишите, на каком файле.');
    throw e;
  });
}

/** Запасной путь: несколько архивов (больше 4 ГБ или без облака). */
function cpZipParts(name, entries, note) {
  var total = entries.reduce(function (a, e) { return a + e.size; }, 0);
  var single = total <= CP.zipTarget;
  if (total >= CP_ZIP_FILE_MAX) note = (note ? note + ' ' : '') + 'Больше 4 ГБ — несколько архивов, распакуйте их в одну папку.';
  var dir = cpExportsDir();
  var res = { parts: [], files: 0, bytes: 0 };
  var i = 0, k = 0;
  cpDlCard(name, note, [], 'Собираю архив...');
  function nextPart() {
    if (i >= entries.length) return Promise.resolve(res);
    var chunk = [], bytes = 0;
    while (i < entries.length && (!chunk.length || bytes + entries[i].size <= CP.zipTarget)) {
      chunk.push(entries[i]); bytes += entries[i].size; i++;
    }
    k++;
    var target = dir + '/' + name + (single ? '' : '_ч' + k) + '.zip';
    var label = single ? 'архив' : 'часть ' + k;
    var msg = 'Собираю ' + label + ' ' + name + ': ' + chunk.length + ' кадр(ов), ' + cpMb(bytes)
      + ' · готово ' + res.files + ' / ' + entries.length;
    cbBusyShow(msg, Math.max(0.03, res.bytes / Math.max(1, total)));
    cpDlCard(name, note, res.parts, msg);
    var t0 = Date.now();
    /* вызов идёт до нескольких минут — показываем, что время идёт */
    var tick = setInterval(function () {
      var sec = Math.round((Date.now() - t0) / 1000);
      cbBusyShow(msg + ' · ' + sec + ' с', Math.max(0.03, res.bytes / Math.max(1, total)));
    }, 1000);
    return CPDisk.proxyZip(target, chunk.map(function (e) {
      return { from: e.from, name: name + '/' + e.name, size: e.size };
    })).then(function (out) {
      clearInterval(tick);
      /* подстроить размер следующей части под скорость */
      var ms = Math.max(1000, Date.now() - t0);
      CP.zipTarget = Math.max(CP_ZIP_MIN, Math.min(CP_ZIP_MAX, Math.round(bytes / ms * CP_ZIP_PART_MS)));
      /* облако отдаёт готовую ссылку; архив на Диске — ссылку берём у Яндекса */
      return (out.url ? Promise.resolve(out.url) : cpHrefWhenReady(out.path || target)).then(function (href) {
        var part = { path: target, href: href, files: chunk.length, bytes: bytes, label: single ? 'Скачать ZIP' : 'Часть ' + k,
          cloud: !!out.url };
        res.parts.push(part);
        res.files += chunk.length;
        res.bytes += bytes;
        cpStartDownload(href);
        cpDlCard(name, note, res.parts, i < entries.length ? 'Собираю следующую часть...' : '');
        return nextPart();
      });
    }, function (e) { clearInterval(tick); throw e; });
  }
  return nextPart().then(function (r) { cbBusyHide(); return r; }, function (e) {
    cbBusyHide();
    cpDlCard(name, note, res.parts, '', 'Не удалось собрать архив: ' + ((e && (e.body || e.message)) || e));
    throw e;
  });
}

/* Отдельной ссылкой (не в архив) — только видео больше 4 ГБ: такой файл в ZIP не помещается
   одной записью. Остальные видео — в архиве кусками (cpZipOne). Функция переносит такой файл
   в облако кусками по CP.directPart — каждый вызов короткий. */
CP.directMin = 3.9 * 1024 * 1024 * 1024;
CP.directPart = 256 * 1024 * 1024;

function cpDirectExport(e, onProgress) {
  var parts = [], up = null;
  var total = e.size, n = Math.max(1, Math.ceil(total / CP.directPart));
  return CPDisk.proxyMpu({ op: 'start' }).then(function (st) {
    up = st;
    var chain = Promise.resolve();
    for (var i = 0; i < n; i++) {
      (function (i) {
        chain = chain.then(function () {
          var start = i * CP.directPart, end = Math.min(total, start + CP.directPart) - 1;
          if (onProgress) onProgress(start, total);
          return CPDisk.proxyMpu({ op: 'part', key: up.key, uploadId: up.uploadId, n: i + 1, from: e.from, start: start, end: end })
            .then(function (r) { parts.push({ n: r.n, etag: r.etag }); });
        });
      })(i);
    }
    return chain;
  }).then(function () {
    if (onProgress) onProgress(total, total);
    return CPDisk.proxyMpu({ op: 'done', key: up.key, uploadId: up.uploadId, parts: parts, filename: e.name.split('/').pop() });
  }).catch(function (err) {
    if (up) CPDisk.proxyMpu({ op: 'abort', key: up.key, uploadId: up.uploadId }).catch(function () { });
    /* Диск не отдаёт файл кусками — переносим целиком одним вызовом */
    if (err && /range_unsupported/.test(err.body || '')) {
      if (onProgress) onProgress(0, total);
      return CPDisk.proxyMpu({ op: 'whole', from: e.from, size: e.size, filename: e.name.split('/').pop() });
    }
    throw err;
  });
}

/**
 * Выгрузка целиком: обычные файлы — ZIP (частями, если много), крупные
 * (видео) — отдельными ссылками рядом. Возвращает {parts, files, bytes}.
 */
var CP_VIDEO_RE = /\.(mp4|mov|m4v|avi|mkv|mxf|webm|mts|m2ts|r3d|braw)$/i;

/** Размеры файлов, которых нет в отборе (старые съёмки): спросить у Диска. Нет файла — в список «не попало». */
function cpFillSizes(entries) {
  var need = entries.filter(function (e) { return !(e.size > 0); });
  if (!need.length) return Promise.resolve({ entries: entries, lost: [] });
  var lost = [];
  return cpPool(need, 4, function (e) {
    return CPDisk.meta(e.from).then(function (m) { if (m && m.size > 0) e.size = m.size; else lost.push(e); },
      function () { lost.push(e); });
  }).then(function () {
    return { entries: entries.filter(function (e) { return e.size > 0; }), lost: lost };
  });
}

function cpExportBundle(name, entries, note) {
  return cpFillSizes(entries).then(function (fs) {
    var lostNote = fs.lost.length ? ' Не попало (нет на Диске или пустой файл): ' + fs.lost.map(function (e) { return e.name.split('/').pop(); }).slice(0, 10).join(', ') + (fs.lost.length > 10 ? '…' : '') + '.' : '';
    return cpExportBundleSized(name, fs.entries, (note || '') + lostNote);
  });
}

function cpExportBundleSized(name, entries, note) {
  /* отдельной ссылкой — только крупное видео; кадры любого размера — в архиве */
  var isBig = function (e) { return e.size > CP.directMin && CP_VIDEO_RE.test(e.name); };
  var small = entries.filter(function (e) { return !isBig(e); });
  var big = entries.filter(isBig);
  var zipP = small.length ? cpZipExport(name, small, note) : Promise.resolve({ parts: [], files: 0, bytes: 0 });
  return zipP.then(function (res) {
    var chain = Promise.resolve(res);
    big.forEach(function (e, bi) {
      chain = chain.then(function (r) {
        var fname = e.name.split('/').pop();
        var msg = 'Переношу ' + fname + ' (' + (bi + 1) + ' из ' + big.length + ')';
        cpDlCard(name, note, r.parts, msg + '...');
        return cpDirectExport(e, function (done, total) {
          var t = msg + ': ' + cpMb(done) + ' из ' + cpMb(total);
          cbBusyShow(t, done / Math.max(1, total));
        }).then(function (out) {
          r.parts.push({ path: e.from, href: out.url, files: 1, bytes: e.size, label: fname, cloud: true });
          r.files += 1;
          r.bytes += e.size;
          cpStartDownload(out.url);
          cbBusyHide();
          cpDlCard(name, note, r.parts, bi + 1 < big.length ? 'Переношу следующий крупный файл...' : '');
          return r;
        });
      });
    });
    return chain;
  }).catch(function (e) {
    cbBusyHide();
    throw e;
  });
}

/** Обычная загрузка браузера; без Referer — файловый сервер Яндекс 360 строг к чужим страницам. */
function cpStartDownload(href) {
  window.__cpLastDownload = href;
  if (window.console) console.info('[CP] скачивание', href);
  var fr = document.createElement('iframe');
  fr.style.display = 'none';
  fr.referrerPolicy = 'no-referrer';
  fr.setAttribute('referrerpolicy', 'no-referrer');
  fr.src = href;
  document.body.appendChild(fr);
  setTimeout(function () { if (fr.parentNode) fr.parentNode.removeChild(fr); }, 120000);
}

/** Карточка скачивания слева внизу: части архива с кнопками и путь на Диске. */
function cpDlCard(title, note, parts, progress, error) {
  var box = document.getElementById('cpDlCard');
  if (!box) {
    box = document.createElement('div');
    box.id = 'cpDlCard';
    box.className = 'cp-dlcard';
    document.body.appendChild(box);
    box.addEventListener('click', function (e) {
      if (e.target.closest('[data-cp-dlclose]')) { box.style.display = 'none'; return; }
      var cp = e.target.closest('[data-cp-dlcopy]');
      if (!cp) return;
      var link = cp.getAttribute('data-cp-dlcopy');
      var inp = box.querySelector('.cp-dlcard-url');
      inp.value = link;
      function shown() {
        inp.style.display = 'block'; inp.focus(); inp.select();
        cbToast('Ссылка скопирована. Вставьте её в адресную строку новой вкладки.');
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(shown, function () { shown(); try { document.execCommand('copy'); } catch (x) { } });
      else { shown(); try { document.execCommand('copy'); } catch (x) { } }
    });
  }
  var head = parts.length ? (progress ? 'Архив собирается: ' : 'Архив готов: ') : (error ? 'Архив: ' : 'Собираю архив: ');
  var h = '<div class="cp-dlcard-head"><b>' + head + cbEsc(title) + '</b>'
    + '<button data-cp-dlclose title="Закрыть">×</button></div>';
  if (note) h += '<div class="cp-dlcard-note">' + cbEsc(note) + '</div>';
  if (progress) h += '<div class="cp-dlcard-note cp-warn">' + cbEsc(progress) + '</div>';
  if (error) h += '<div class="cp-dlcard-note cp-warn">' + cbEsc(error) + '</div>';
  if (parts.length) {
    h += '<div class="cp-dlcard-note">Загрузка начинается сама. Если не началась — нажмите кнопку; '
      + 'если и так нет — «ссылка» и вставьте её в адресную строку. '
      + (parts[0].cloud ? 'Ссылка и архив в облаке действуют 3 дня.'
        : 'Файлы лежат на Диске: ' + cbEsc(CPDisk.showPath(cpExportsDir()))) + '</div>';
    parts.forEach(function (p) {
      h += '<div class="cp-dlcard-row"><a class="cp-dlcard-btn" href="' + cbEsc(p.href) + '" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">'
        + cbEsc(p.label || 'Скачать ZIP') + '</a>'
        + '<small class="cp-dlcard-size">' + (p.files ? p.files + ' кадр(ов) · ' + cpMb(p.bytes) : '') + '</small>'
        + '<button class="cp-dlcard-alt" data-cp-dlcopy="' + cbEsc(p.href) + '">ссылка</button></div>';
    });
  }
  h += '<input class="cp-dlcard-url" readonly value="">';
  box.innerHTML = h;
  box.style.display = 'block';
}

/** Карточка с текстовым отчётом и кнопкой «Скопировать отчёт». */
function cpReportCard(title, text) {
  cpDlCard(title, '', [], '');
  var box = document.getElementById('cpDlCard');
  var ta = document.createElement('textarea');
  ta.className = 'cp-report';
  ta.readOnly = true;
  ta.value = text;
  var btn = document.createElement('button');
  btn.className = 'cp-dlcard-alt';
  btn.textContent = 'Скопировать отчёт';
  btn.onclick = function () {
    ta.focus(); ta.select();
    var done = function () { cbToast('Отчёт скопирован — пришлите его в чат'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { try { document.execCommand('copy'); } catch (x) { } done(); });
    else { try { document.execCommand('copy'); } catch (x) { } done(); }
  };
  box.appendChild(ta);
  box.appendChild(btn);
}

/** Путь файла относительно съёмки. */
function cpRelInShoot(disk) {
  var root = CP.shoot.path + '/';
  return disk.indexOf(root) === 0 ? disk.slice(root.length) : disk.split('/').pop();
}

function cpDownloadAll(withAll) {
  cbCloseAllPops();
  if (!CP.shoot) { cbToast('Сначала откройте съёмку'); return; }
  var shoot = CP.shoot;
  var files = (CP.files || []).slice();
  if (!files.length && !withAll) { cbToast('Кадры съёмки ещё не прочитаны — подождите или «Обновить съёмку»'); return; }
  var list = withAll ? (cbBusyShow('Считаю все файлы съёмки...', 0.05), cpWalkAll(shoot.path)) : Promise.resolve(files);
  list.then(function (all) {
    /* крупные файлы (видео) уйдут отдельными ссылками — без ограничения по размеру */
    var entries = all.map(function (f) { return { from: f.path, name: cpRelInShoot(f.path), size: f.size }; });
    var photos = entries.filter(function (e) { return CPDisk.isPhoto(e.name); }).length;
    return cpNextExportName(CPDisk.safeName(shoot.name) + '_вся съёмка', cpMeta().events).then(function (name) {
      return cpExportBundle(name, entries, 'Вся съёмка: ' + photos + ' кадр(ов)' + (entries.length > photos ? ' и других файлов: ' + (entries.length - photos) : '') + '.')
        .then(function (r) { cpEvent('download_shoot', [], { count: r.files, export: name, parts: r.parts.length, all: withAll || undefined }); });
    });
  }).catch(function (e) { cpHandleError(e, 'Скачивание съёмки'); });
}

function cpPad(n) { return (n < 10 ? '0' : '') + n; }

/** Раскладка отбора: [{disk, dir:[папки], file}] по карточкам и доп. контенту. */
/* Папка карточки в выгрузке (06.11.2026, тест в SK): карточка артикула —
   папка с именем карточки (в модельке — не исходная структура лук/артикул),
   остальные — «NN название», как раньше. Имя с тегами по шаблону — позже,
   здесь же. */
function cpCardExportFolder(card, index) {
  var title = card.title || card.category || 'Карточка';
  return card.cpArticle ? CPDisk.safeName(title) : cpPad(index + 1) + ' ' + title;
}

function cpSelectionJobs(onlyIds) {
  var jobs = [];
  var stype = typeof cpShootType === 'function' && CP.shoot ? cpShootType(CP.shoot.name) : null;
  /* имена: по умолчанию с номером порядка; в структура.txt можно «исходные» */
  var numbered = !(stype && stype.exportNames === 'original');
  var used = {};
  App.cards.forEach(function (card, ci) {
    if (onlyIds && !onlyIds[card.id]) return;
    var name = cpCardExportFolder(card, ci), base = name, k = 2;
    while (used[name]) name = base + ' (' + (k++) + ')';
    used[name] = true;
    var folder = [name];
    var order = 0;
    function add(pid) {
      var p = pid ? cbPhotoById(pid) : null;
      if (!p || !p.disk || p.missing) return;
      order++;
      jobs.push({ disk: p.disk, size: p.size, dir: folder, file: numbered ? cpPad(order) + '_' + p.name : p.name });   /* порядок слотов = номер */
    }
    if (card.mode === 'auto') (card.pids || []).forEach(add);
    else (card.slots || []).forEach(function (s) { add(s.pid); });
  });
  if (onlyIds) return jobs;
  App.containers.forEach(function (cont, ki) {
    var folder = cpPad(ki + 1) + ' ' + (cont.title || 'Блок');
    cont.photoIds.forEach(function (pid, i) {
      var p = cbPhotoById(pid);
      if (!p || !p.disk || p.missing) return;
      jobs.push({ disk: p.disk, size: p.size, dir: ['Доп контент', folder], file: cpPad(i + 1) + '_' + p.name });
    });
  });
  return jobs;
}

function cpDownloadSelection() {
  cbCloseAllPops();
  if (!CP.shoot) { cbToast('Сначала откройте съёмку'); return; }
  var jobs = cpSelectionJobs();
  if (!jobs.length) { cbToast('В карточках и доп. контенте пока нет кадров с Диска'); return; }
  var shoot = CP.shoot;
  /* правило из структура.txt: выгрузка «как в папках» — исходные папки и имена */
  var stype = typeof cpShootType === 'function' ? cpShootType(shoot.name) : null;
  var seen = {};
  var entries = (stype && stype.exportMode === 'folders')
    ? jobs.filter(function (j) { if (seen[j.disk]) return false; seen[j.disk] = true; return true; })
      .map(function (j) { return { from: j.disk, size: j.size, name: cpRelInShoot(j.disk) }; })
    : jobs.map(function (j) {
      return { from: j.disk, size: j.size, name: (j.dir.length ? j.dir.map(CPDisk.safeName).join('/') + '/' : '') + CPDisk.safeName(j.file) };
    });
  cpNextExportName(CPDisk.safeName(shoot.name) + '_отбор', cpMeta().events).then(function (name) {
    return cpExportBundle(name, entries, 'Отбор по карточкам: ' + entries.length + ' кадр(ов).').then(function (r) {
      cpEvent('download_selection', [], { count: r.files, note: 'карточек: ' + App.cards.length, export: name, parts: r.parts.length });
    });
  }).catch(function (e) { cpHandleError(e, 'Скачивание отбора'); });
}

document.getElementById('cpMenuDlAll').onclick = function () { cpDownloadAll(false); };
document.getElementById('cpMenuDlAllV').onclick = function () { cpDownloadAll(true); };
document.getElementById('cpMenuDlSel').onclick = cpDownloadSelection;
document.getElementById('cpMenuShelf').onclick = function () { cbCloseAllPops(); cpShowShelf(); };
document.getElementById('cpMenuRefresh').onclick = function () {
  cbCloseAllPops();
  if (!CP.shoot) { cbToast('Сначала откройте съёмку'); return; }
  cbBusyShow('Проверяю новые файлы...', 0.3);
  cpSyncPhotos(false).then(function (n) {
    cbBusyHide();
    cbToast(n ? 'Новых файлов: ' + n : 'Новых файлов нет');
  }).catch(function (e) { cpHandleError(e, 'Обновление'); });
};

/* ---------- запуск: вместо лаунчера Cardboard — витрина ---------- */

var _cbProjModalOpenOrig = cbProjModalOpen;
cbProjModalOpen = function (mode, startup) {
  if (mode === 'launcher' || mode === 'new') {
    /* таймер запуска Cardboard: витрину уже открыли при загрузке (cp-guard.js) — не перечитываем */
    if (startup && CP.booted) return;
    cpShowShelf();
    return;
  }
  return _cbProjModalOpenOrig(mode, startup);
};

cbSetProjectName = (function (orig) {
  return function (name) { orig(name); cpSetTitle(); };
})(cbSetProjectName);

CPDisk.setProxy(CP_CONFIG.proxy);
cpReadToken();
cpSetTitle();

/* ---------- просмотр кадра крупно ----------
   Двойной клик по кадру (лента, карточка, доп. контент) открывает его во
   весь экран. Сначала показываем превью ленты, затем крупное превью Яндекса
   по длинной стороне до 2400 px (около половины исходника). Клик по кадру —
   вписать / 100 %. Стрелки — соседние кадры той же ленты или карточки,
   Esc — закрыть. */

var CP_BIG_SIZE = '2400x2400';
var CP_BIG_FALLBACK = 'XXXL';
CP.big = {};          /* путь на Диске -> objectURL крупного превью */
CP.lb = null;         /* {list:[pid], i} */

(function cpLbDom() {
  var lb = document.createElement('div');
  lb.className = 'cp-lb';
  lb.id = 'cpLb';
  lb.innerHTML = '<div class="cp-lb-head">'
    + '<div><b id="cpLbName"></b><br><small id="cpLbPath"></small></div><span id="cpLbBadges"></span>'
    + '<span class="cp-sp"></span><small id="cpLbCount"></small>'
    + '<button data-lb="prev" title="Предыдущий кадр (стрелка влево)">Назад</button>'
    + '<button data-lb="next" title="Следующий кадр (стрелка вправо)">Вперёд</button>'
    + '<button data-lb="like" title="Лайк — чтобы потом быстрее собрать карточку (клавиша L)">Лайк</button>'
    + '<button data-lb="brak" title="Кадр в брак — на пересъём">В брак</button>'
    + '<button data-lb="retouch" class="cp-act-rt" title="Отправить кадр на ретушь">На ретушь</button>'
    + '<button data-lb="close" title="Закрыть (Esc)">Закрыть</button></div>'
    + '<div class="cp-lb-body" id="cpLbBody"><img id="cpLbImg" alt=""><div class="cp-lb-note" id="cpLbNote"></div></div>';
  document.body.appendChild(lb);
  lb.addEventListener('click', function (e) {
    var b = e.target.closest('[data-lb]');
    if (b) {
      var a = b.getAttribute('data-lb');
      if (a === 'close') cpLbClose();
      else if (a === 'prev') cpLbStep(-1);
      else if (a === 'next') cpLbStep(1);
      else if (a === 'like') cpLbLike();
      else if (a === 'brak' && CP.lb) {
        cpDoAction('reshoot', [CP.lb.list[CP.lb.i]], null);
        setTimeout(cpLbShow, 300);
      }
      else if (a === 'retouch' && CP.lb) {
        var pid = CP.lb.list[CP.lb.i];
        cpDoAction('retouch', [pid], null);
        setTimeout(cpLbShow, 300);
      }
      return;
    }
    if (e.target.id === 'cpLbImg') {
      var body = document.getElementById('cpLbBody');
      body.classList.toggle('cp-full');
      cpLbNote();
      return;
    }
    if (e.target.id === 'cpLbBody') cpLbClose();
  });
  document.addEventListener('keydown', function (e) {
    if (!CP.lb) return;
    if (e.key === 'Escape') cpLbClose();
    else if (e.key === 'ArrowLeft') cpLbStep(-1);
    else if (e.key === 'ArrowRight') cpLbStep(1);
    else if (e.code === 'KeyL') cpLbLike();
    else return;
    e.preventDefault();
  });
})();

/* двойной клик по кадру — открыть крупно */
document.addEventListener('dblclick', function (e) {
  if (!CP.shoot || e.target.closest('button, input, select, textarea')) return;
  var el = e.target.closest('.cb-thumb, .cb-slot.cb-filled, .cb-cont-item');
  if (!el) return;
  var pid = cpPidOf(el);
  var p = pid ? cbPhotoById(pid) : null;
  if (!p || !p.disk) return;
  e.preventDefault();
  var list;
  if (el.classList.contains('cb-thumb')) {
    list = Array.prototype.map.call(document.querySelectorAll('#cbTrayGrid .cb-thumb'), function (t) { return t.getAttribute('data-pid'); });
  } else if (el.classList.contains('cb-cont-item')) {
    var cont = cbContById(el.getAttribute('data-kid'));
    list = cont ? cont.photoIds.slice() : [pid];
  } else {
    var card = cbCardById(el.getAttribute('data-cid'));
    list = card ? cpCardPids(card) : [pid];
  }
  list = list.filter(function (x) { var q = cbPhotoById(x); return q && q.disk; });
  var i = list.indexOf(pid);
  if (i === -1) { list = [pid]; i = 0; }
  cpLbOpen(list, i);
}, true);

function cpLbOpen(list, i) {
  CP.lb = { list: list, i: i };
  document.getElementById('cpLb').classList.add('cp-open');
  document.getElementById('cpLbBody').classList.remove('cp-full');
  cpLbShow();
}

function cpLbClose() {
  CP.lb = null;
  document.getElementById('cpLb').classList.remove('cp-open');
  document.getElementById('cpLbImg').removeAttribute('src');
}

/** Лайк кадра в просмотре: общий для всех, хранится в отборе съёмки. */
function cpLbLike() {
  if (!CP.lb) return;
  var pid = CP.lb.list[CP.lb.i];
  var likes = cpMeta().likes;
  if (likes[pid]) delete likes[pid];
  else likes[pid] = { by: cpActor(), ts: new Date().toISOString() };
  cbMarkDirty();
  cpRenderSoon();
  cpLbShow();
}

function cpLbStep(d) {
  if (!CP.lb) return;
  var n = CP.lb.list.length;
  CP.lb.i = (CP.lb.i + d + n) % n;
  cpLbShow();
}

function cpLbNote(text) {
  var note = document.getElementById('cpLbNote');
  if (text !== undefined) note.setAttribute('data-t', text);
  var full = document.getElementById('cpLbBody').classList.contains('cp-full');
  note.textContent = (note.getAttribute('data-t') || '') + (full ? ' · 100 % — клик, чтобы вписать' : ' · клик — 100 %')
    + ' · стрелки — листать · L — лайк · Esc — закрыть';
}

function cpLbShow() {
  if (!CP.lb) return;
  var pid = CP.lb.list[CP.lb.i];
  var p = cbPhotoById(pid);
  if (!p) return;
  var img = document.getElementById('cpLbImg');
  document.getElementById('cpLbName').textContent = p.name;
  document.getElementById('cpLbPath').textContent = cpRelDir(p) || 'корень съёмки';
  document.getElementById('cpLbCount').textContent = (CP.lb.i + 1) + ' / ' + CP.lb.list.length;
  document.getElementById('cpLbBadges').innerHTML = cpBadgeHTML(pid).replace(/cp-badge/g, 'cp-badge cp-badge-inline');
  var lkb = document.querySelector('#cpLb [data-lb="like"]');
  var liked = !!cpMeta().likes[pid];
  lkb.textContent = liked ? 'Убрать лайк' : 'Лайк';
  lkb.style.borderColor = liked ? '#C9956B' : '';
  var st = cpMeta().status[pid];
  var bkb = document.querySelector('#cpLb [data-lb="brak"]');
  bkb.textContent = st && st.s === 'reshoot' ? 'В браке' : 'В брак';
  bkb.disabled = !!(st && st.s === 'reshoot');
  var rt = document.querySelector('#cpLb [data-lb="retouch"]');
  rt.textContent = st && st.s === 'retouch' ? 'В ретуши' : 'На ретушь';
  rt.disabled = !!(st && st.s === 'retouch');
  var big = CP.big[p.disk];
  if (big) { img.src = big; cpLbNote('крупно'); return; }
  if (p.dataUrl) img.src = p.dataUrl; else img.removeAttribute('src');
  cpLbNote('загружаю крупно...');
  var disk = p.disk;
  cpLoadBig(disk).then(function (url) {
    if (!CP.lb || cbPhotoById(CP.lb.list[CP.lb.i]).disk !== disk) return;
    img.src = url;
    cpLbNote('крупно');
  }, function (e) {
    if (!CP.lb || cbPhotoById(CP.lb.list[CP.lb.i]).disk !== disk) return;
    cpLbNote('крупное превью не загрузилось: ' + ((e && (e.status || e.message)) || e));
  });
  /* соседний кадр — заранее, чтобы листалось без ожидания */
  var nx = cbPhotoById(CP.lb.list[(CP.lb.i + 1) % CP.lb.list.length]);
  if (nx && nx.disk && !CP.big[nx.disk]) cpLoadBig(nx.disk).catch(function () { });
}

var _cpBigP = {};
function cpLoadBig(disk) {
  if (CP.big[disk]) return Promise.resolve(CP.big[disk]);
  if (_cpBigP[disk]) return _cpBigP[disk];
  var p = CPDisk.proxyPreview(disk, CP_BIG_SIZE).catch(function (e) {
    if (e && e.status === 413) return CPDisk.proxyPreview(disk, CP_BIG_FALLBACK);
    throw e;
  }).catch(function (e) {
    /* у Яндекса нет превью этого кадра — показываем сам файл: прослойка переносит его в Облако */
    if (!e || e.status === 401) throw e;
    var ph = App.photos.filter(function (q) { return q.disk === disk; })[0] || {};
    return CPDisk.proxyMpu({ op: 'whole', from: disk, size: ph.size || 0, filename: ph.name || 'file.jpg' }).then(function (out) {
      if (!out || !out.url) throw e;
      return cpImgByUrl(out.url).then(function () { return { direct: out.url }; }, function () { throw e; });
    });
  }).then(function (blob) {
    var url = blob && blob.direct ? blob.direct : URL.createObjectURL(blob);
    CP.big[disk] = url;
    delete _cpBigP[disk];
    return url;
  }, function (e) { delete _cpBigP[disk]; throw e; });
  _cpBigP[disk] = p;
  return p;
}
