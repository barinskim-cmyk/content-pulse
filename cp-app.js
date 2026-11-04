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

var CP_CONFIG = {
  /* ClientID приложения на oauth.yandex.ru (не секрет). */
  clientId: '36df38c93cb944318c0084640c77d76a',
  defaultArchive: 'disk:/Архив',
  previewSize: 'XL',
  previewParallel: 6,
  downloadParallel: 3,
  pollMs: 30000
};

var CP_STATUS = {
  retouch: { label: 'Ретушь', short: 'РЕТУШЬ' },
  reshoot: { label: 'Пересъём', short: 'ПЕРЕСЪЁМ' },
  approval: { label: 'Согласование', short: 'СОГЛАС.' }
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
  previews: {},        /* disk path -> ссылка превью из последнего обхода */
  files: [],           /* последний обход папки съёмки на Диске */
  editSeq: 0           /* счётчик правок: сохранение снимает dirty, только если новых не было */
};

/* ---------- хранение настроек ---------- */

function cpGet(k, d) { try { var v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } }
function cpSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { } }
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
    + '.cp-act{position:absolute;right:4px;bottom:4px;display:none;padding:2px 7px;font-size:11px;z-index:3;background:#1d1d1bdd}'
    + '.cb-slot.cb-filled:hover .cp-act,.cb-cont-item:hover .cp-act,.cb-thumb:hover .cp-act{display:block}'
    + '.cb-thumb{position:relative}'
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
    + '.cp-log-item small{color:#a3a09a;font-family:"IBM Plex Mono",monospace}';
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
    + '  <div class="cp-brand">CONTENT PULSE<small>ВИТРИНА СЪЁМОК</small></div>'
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

  /* пункты в меню «Файл» */
  var file = document.getElementById('cbMenuFile');
  var first = file.firstElementChild;
  var block = document.createElement('div');
  block.innerHTML = ''
    + '<button id="cpMenuShelf">Витрина съёмок</button>'
    + '<button id="cpMenuRefresh">Обновить съёмку (новые части)</button>'
    + '<button id="cpMenuDlSel">Скачать отбор по карточкам...</button>'
    + '<button id="cpMenuDlAll">Скачать всю съёмку...</button>'
    + '<button id="cpMenuLog">Журнал действий</button>'
    + '<div class="cb-pop-sep"></div>';
  while (block.firstChild) file.insertBefore(block.firstChild, first);

  /* то, что в режиме Диска не нужно или сбивает с толку */
  ['cbMenuNew', 'cbBtnOpen', 'cbMenuRename', 'cbBtnPick', 'cbBtnFolder', 'cbBtnWatch',
    'cbBtnLocate', 'cbBtnSelected'].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.style.display = 'none';
  });

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
  list.innerHTML = '<div class="cp-empty">Загружаю съёмки из ' + cbEsc(CP.archive) + '...</div>';
  return CPDisk.listShoots(CP.archive).then(function (dirs) {
    CP.shoots = dirs;
    cpRenderShoots();
  }, function (e) {
    if (e.status === 404) {
      list.innerHTML = '<div class="cp-empty">Папка ' + cbEsc(CP.archive)
        + ' не найдена на Диске. Укажите путь к архиву выше, например disk:/Архив</div>';
      return;
    }
    cpHandleError(e, 'Не удалось прочитать архив');
  });
}

function cpFmtDate(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  return d.toLocaleDateString('ru-RU') + ' ' + d.toLocaleTimeString('ru-RU').slice(0, 5);
}

function cpRenderShoots() {
  var q = document.getElementById('cpShelfSearch').value.trim().toLowerCase();
  var list = document.getElementById('cpShelfList');
  var items = CP.shoots.filter(function (d) { return !q || d.name.toLowerCase().indexOf(q) !== -1; });
  if (!items.length) {
    list.innerHTML = '<div class="cp-empty">' + (CP.shoots.length ? 'Ничего не найдено' : 'В архиве пока нет папок съёмок') + '</div>';
    return;
  }
  list.innerHTML = items.map(function (d) {
    return '<button class="cp-shoot" data-path="' + cbEsc(d.path) + '" data-name="' + cbEsc(d.name) + '">'
      + '<div class="cp-shoot-name">' + cbEsc(d.name) + '</div>'
      + '<div class="cp-shoot-meta">изменена ' + cpFmtDate(d.modified) + '</div></button>';
  }).join('');
}

document.getElementById('cpShelfList').addEventListener('click', function (e) {
  var b = e.target.closest('.cp-shoot');
  if (!b) return;
  cpOpenShoot(b.getAttribute('data-path'), b.getAttribute('data-name'));
});
document.getElementById('cpShelfSearch').oninput = cpRenderShoots;
document.getElementById('cpShelfRefresh').onclick = cpLoadShoots;
document.getElementById('cpArchiveApply').onclick = function () {
  var v = document.getElementById('cpArchiveInput').value.trim();
  if (!v) return;
  if (v.indexOf('disk:') !== 0) v = 'disk:/' + v.replace(/^\/+/, '');
  CP.archive = v;
  cpSet('cp_archive', v);
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
  if (!m.status) m.status = {};
  if (!m.cardStatus) m.cardStatus = {};
  if (!m.events) m.events = [];
  return m;
}

function cpOpenShoot(path, name) {
  if (App.dirty && CP.shoot) cbAutosaveNow();
  cbBusyShow('Открываю съёмку ' + name + '...', 0.1);
  CPDisk.readState(path).then(function (st) {
    CP.shoot = { path: path, name: name };
    CP.rev = st.rev;
    CP.files = [];
    cpApplyRemote(st.data || cpBlankProject(name));
    cpSetTitle();
    cbBusyShow('Читаю файлы съёмки...', 0.4);
    return cpSyncPhotos(true);
  }).then(function (added) {
    cbBusyHide();
    document.getElementById('cpShelf').classList.remove('cp-open');
    cbToast('Съёмка открыта: ' + name + (added ? ' · новых файлов: ' + added : ''));
    cpStartPoll();
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
    if (CP.previews[p.disk]) { p.preview = CP.previews[p.disk]; cpQueueThumb(p); }
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
function cpSyncPhotos(initial) {
  return CPDisk.walkPhotos(CP.shoot.path, CP_CONFIG.previewSize).then(function (files) {
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
  App.photos.forEach(function (p) { if (p.disk && !p.dataUrl && p.preview) cpQueueThumb(p); });
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

function cpQueueThumb(p) {
  if (p._queued) return;
  p._queued = true;
  CP.queue.push(p);
  cpPumpThumbs();
}

function cpPumpThumbs() {
  while (CP.loadingThumbs < CP_CONFIG.previewParallel && CP.queue.length) {
    (function (p) {
      CP.loadingThumbs++;
      CPDisk.previewBlob(p.preview).then(function (blob) {
        var url = URL.createObjectURL(blob);
        return new Promise(function (res) {
          var img = new Image();
          img.onload = function () { res({ url: url, w: img.naturalWidth, h: img.naturalHeight }); };
          img.onerror = function () { res({ url: url, w: 0, h: 0 }); };
          img.src = url;
        });
      }).then(function (t) {
        CP.thumbs[p.disk] = t;
        /* фото могло быть пересоздано при применении чужого отбора */
        App.photos.forEach(function (q) {
          if (q.disk === p.disk) { q.dataUrl = t.url; q.w = t.w; q.h = t.h; }
        });
        cpRenderSoon();
      }).catch(function (e) {
        p._queued = false;
        if (e && e.status === 401) cpHandleError(e);
      }).then(function () {
        CP.loadingThumbs--;
        cpPumpThumbs();
      });
    })(CP.queue.shift());
  }
}

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
  return function () { CP.editSeq++; return orig.apply(this, arguments); };
})(cbMarkDirty);

var _cbAutosaveOrig = cbAutosaveNow;
cbAutosaveNow = function () {
  if (!CP.shoot) return _cbAutosaveOrig();
  if (!App.dirty || CP.saving) return;
  CP.saving = true;
  var seq = CP.editSeq;
  var data = cbProjectData();
  CPDisk.writeState(CP.shoot.path, data, CP.rev).then(function (rev) {
    CP.rev = rev;
    CP.saving = false;
    /* за время записи могли быть новые правки — тогда сохраняем ещё раз */
    if (CP.editSeq === seq) cbClearDirty();
    else cbScheduleAutosave();
    var el = document.getElementById('cbMode');
    if (el) el.textContent = 'на Диске · ' + new Date().toLocaleTimeString('ru-RU').slice(0, 5);
  }, function (e) {
    CP.saving = false;
    if (e && e.conflict) {
      CP.rev = e.rev;
      cpApplyRemote(e.data);
      cbToast('Отбор изменил другой пользователь — загружена его версия. Повторите последнее действие.');
      return;
    }
    cpHandleError(e, 'Не удалось сохранить отбор на Диск');
    cbScheduleAutosave();
  });
};

cbSaveProject = function () {
  if (!CP.shoot) { cbToast('Сначала откройте съёмку на витрине'); return; }
  App.dirty = true;
  cbAutosaveNow();
};

/* Чужие изменения: раз в pollMs проверяем ревизию, пока у нас нет своих правок. */
function cpStartPoll() {
  clearInterval(CP.pollTimer);
  CP.pollTimer = setInterval(function () {
    if (!CP.shoot || App.dirty || CP.saving || document.hidden) return;
    CPDisk.stateRev(CP.shoot.path).then(function (rev) {
      if (!rev || rev === CP.rev || App.dirty) return;
      return CPDisk.readState(CP.shoot.path).then(function (st) {
        if (App.dirty) return;
        CP.rev = st.rev;
        cpApplyRemote(st.data);
        cbToast('Отбор обновлён: изменения коллег');
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
  to_retouch: 'отправил(а) на ретушь', to_reshoot: 'отправил(а) на пересъём',
  to_approval: 'отправил(а) на согласование', clear_status: 'снял(а) статус',
  download_shoot: 'скачал(а) всю съёмку', download_selection: 'скачал(а) отбор'
};

function cpSetStatus(pids, status, cardId) {
  var m = cpMeta();
  var stamp = { by: cpActor(), ts: new Date().toISOString() };
  pids.forEach(function (pid) {
    if (status) m.status[pid] = { s: status, by: stamp.by, ts: stamp.ts };
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
  cpSetStatus(pids, status, cardId);
  if (status !== 'retouch') {
    cpEvent('to_' + status, cpPhotoNames(pids), extra);
    cpAfterStatus();
    cbToast(CP_STATUS[status].label + ': ' + pids.length + ' кадр(ов)');
    return;
  }
  /* ретушь: подстраховка — копии в <съёмка>/Ретушь/<дата>/ */
  var folder = CP.shoot.path + '/' + CPDisk.RETOUCH_DIR + '/' + new Date().toISOString().slice(0, 10);
  var files = pids.map(function (pid) { return cbPhotoById(pid); }).filter(function (p) { return p.disk; });
  var copied = 0, existed = 0, failed = [];
  cbBusyShow('Копирую на ретушь: 0 / ' + files.length, 0.05);
  CPDisk.ensureDir(folder).then(function () {
    return files.reduce(function (chain, p, i) {
      return chain.then(function () {
        return CPDisk.copy(p.disk, folder + '/' + p.name).then(function (r) {
          if (r === 'exists') existed++; else copied++;
        }, function (e) { failed.push(p.name + ': ' + e.message); })
          .then(function () { cbBusyShow('Копирую на ретушь: ' + (i + 1) + ' / ' + files.length, (i + 1) / files.length); });
      });
    }, Promise.resolve());
  }).then(function () {
    cbBusyHide();
    extra.folder = folder.replace(/^disk:/, '');
    extra.copied = copied;
    if (existed) extra.existed = existed;
    if (failed.length) extra.failed = failed;
    cpEvent('to_retouch', cpPhotoNames(pids), extra);
    cpAfterStatus();
    cbToast('На ретушь: ' + copied + ' скопировано' + (existed ? ', уже было ' + existed : '')
      + (failed.length ? ', ошибок ' + failed.length : '') + ' → ' + extra.folder);
    if (failed.length && window.console) console.error('[CP] retouch copy failed', failed);
  }).catch(function (e) {
    cpEvent('to_retouch', cpPhotoNames(pids), { note: 'статус поставлен, копирование не удалось: ' + e.message });
    cpAfterStatus();
    cpHandleError(e, 'Копирование на ретушь не удалось (статус поставлен)');
  });
}

function cpAfterStatus() {
  cbRenderTray(); cbRenderCards(); cbRenderConts();
  cpUpdateStatusLine();
}

function cpUpdateStatusLine() {
  var el = document.getElementById('cpStatusLine');
  if (!el) return;
  if (!CP.shoot) { el.textContent = ''; return; }
  var m = cpMeta(), n = { retouch: 0, reshoot: 0, approval: 0 };
  Object.keys(m.status).forEach(function (pid) { if (n[m.status[pid].s] !== undefined) n[m.status[pid].s]++; });
  el.textContent = 'ретушь ' + n.retouch + ' · пересъём ' + n.reshoot + ' · согласование ' + n.approval;
}

/* бейджи статусов и кнопка действий — поверх отрисовки Cardboard */
function cpBadgeHTML(pid) {
  var st = CP.shoot && cpMeta().status[pid];
  if (!st || !CP_STATUS[st.s]) return '';
  return '<span class="cp-badge cp-' + st.s + '" title="' + cbEsc(CP_STATUS[st.s].label + ' · ' + st.by + ' · ' + cpFmtDate(st.ts)) + '">'
    + CP_STATUS[st.s].short + '</span>';
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
    el.insertAdjacentHTML('beforeend', cpBadgeHTML(pid)
      + '<button class="cp-act" data-cp-pid="' + pid + '" title="Действия с кадром">...</button>');
  });
  if (rootId === 'cbCards') {
    Array.prototype.forEach.call(root.querySelectorAll('.cb-card'), function (cardEl) {
      var head = cardEl.querySelector('.cb-card-head');
      var cid = cardEl.getAttribute('data-cid');
      if (!head || head.querySelector('[data-cp-card]')) return;
      var st = cpMeta().cardStatus[cid];
      var label = st && CP_STATUS[st.s] ? CP_STATUS[st.s].label : 'Действия';
      var btn = document.createElement('button');
      btn.className = 'cb-mini';
      btn.setAttribute('data-cp-card', cid);
      btn.textContent = label;
      btn.title = st ? (st.by + ' · ' + cpFmtDate(st.ts)) : 'Действия со всей карточкой';
      if (st) btn.style.borderColor = '#C9956B';
      head.insertBefore(btn, head.querySelector('[data-act="tpl"]'));
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
function cpOpenMenu(anchor, title, onPick) {
  var menu = document.getElementById('cpMenu');
  menu.innerHTML = '<div class="cp-menu-title">' + cbEsc(title) + '</div>'
    + '<button data-s="retouch">На ретушь (копия в папку Ретушь)</button>'
    + '<button data-s="reshoot">На пересъём</button>'
    + '<button data-s="approval">На согласование</button>'
    + '<button data-s="">Снять статус</button>';
  menu.classList.add('cp-open');
  var r = anchor.getBoundingClientRect();
  var w = menu.offsetWidth, h = menu.offsetHeight;
  menu.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
  menu.style.top = (r.bottom + h + 8 > innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4) + 'px';
  menu.onclick = function (e) {
    var b = e.target.closest('button[data-s]');
    if (!b) return;
    menu.classList.remove('cp-open');
    onPick(b.getAttribute('data-s'));
  };
}

document.addEventListener('click', function (e) {
  var menu = document.getElementById('cpMenu');
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

function cpCanPickFolder() { return typeof window.showDirectoryPicker === 'function'; }

function cpGetDir(parent, name) { return parent.getDirectoryHandle(CPDisk.safeName(name), { create: true }); }

/* Папки создаём один раз на путь: параллельные скачивания иначе
   одновременно создают одну папку и браузер отвечает ошибкой типа. */
var _cpDirCache = null;
function cpDirPath(root, parts) {
  if (!_cpDirCache || _cpDirCache.root !== root) _cpDirCache = { root: root, map: {} };
  var key = '', chain = Promise.resolve(root);
  parts.forEach(function (part) {
    key += '/' + CPDisk.safeName(part);
    if (!_cpDirCache.map[key]) {
      _cpDirCache.map[key] = chain.then(function (d) { return cpGetDir(d, part); });
    }
    chain = _cpDirCache.map[key];
  });
  return chain;
}

/** jobs: [{disk, size, dir: [папки], file}] -> скачать с докачкой и прогрессом. */
function cpRunDownloads(root, jobs, label) {
  var done = 0, skipped = 0, failed = [], idx = 0, total = jobs.length;
  return new Promise(function (resolve) {
    var active = 0;
    function report() {
      cbBusyShow(label + ': ' + (done + skipped + failed.length) + ' / ' + total, (done + skipped + failed.length) / Math.max(1, total));
    }
    function next() {
      if (idx >= total && !active) { resolve({ done: done, skipped: skipped, failed: failed }); return; }
      while (active < CP_CONFIG.downloadParallel && idx < total) {
        (function (job) {
          active++;
          cpDirPath(root, job.dir).then(function (dir) {
            return dir.getFileHandle(CPDisk.safeName(job.file), { create: false }).then(function (fh) {
              return fh.getFile().then(function (f) { return f.size === job.size; });
            }, function () { return false; }).then(function (same) {
              if (same) { skipped++; return; }
              return CPDisk.downloadBlob(job.disk, job.size).then(function (blob) {
                return dir.getFileHandle(CPDisk.safeName(job.file), { create: true }).then(function (fh) {
                  return fh.createWritable().then(function (w) {
                    return w.write(blob).then(function () { return w.close(); });
                  });
                });
              }).then(function () { done++; });
            });
          }).catch(function (e) { failed.push(job.file + ': ' + (e && e.message || e)); })
            .then(function () { active--; report(); next(); });
        })(jobs[idx++]);
      }
    }
    report();
    next();
  });
}

function cpPickRoot() {
  if (!cpCanPickFolder()) {
    cbToast('Скачивание папкой работает в Chrome или Edge');
    return Promise.reject(null);
  }
  return window.showDirectoryPicker({ mode: 'readwrite', id: 'cp-download' });
}

function cpFinishDownload(res, action, extra) {
  cbBusyHide();
  extra = extra || {};
  extra.count = res.done;
  if (res.skipped) extra.note = 'уже были: ' + res.skipped;
  if (res.failed.length) extra.failed = res.failed;
  cpEvent(action, [], extra);
  cbToast('Скачано: ' + res.done + (res.skipped ? ' · уже было: ' + res.skipped : '')
    + (res.failed.length ? ' · ошибок: ' + res.failed.length + ' (повторите — докачаются только они)' : ''));
  if (res.failed.length && window.console) console.error('[CP] download failed', res.failed);
}

function cpDownloadAll() {
  cbCloseAllPops();
  if (!CP.shoot) { cbToast('Сначала откройте съёмку'); return; }
  var root = CP.shoot.path.replace(/\/+$/, '') + '/';
  var jobs = App.photos.filter(function (p) { return p.disk && !p.missing; }).map(function (p) {
    var rel = p.disk.indexOf(root) === 0 ? p.disk.slice(root.length) : p.name;
    var parts = rel.split('/');
    var file = parts.pop();
    return { disk: p.disk, size: p.size, dir: [CP.shoot.name].concat(parts), file: file };
  });
  if (!jobs.length) { cbToast('В съёмке нет файлов'); return; }
  cpPickRoot().then(function (dir) {
    return cpRunDownloads(dir, jobs, 'Скачиваю съёмку');
  }).then(function (res) { cpFinishDownload(res, 'download_shoot'); }, function (e) {
    if (e && e.name !== 'AbortError') cpHandleError(e, 'Скачивание');
  });
}

function cpPad(n) { return (n < 10 ? '0' : '') + n; }

function cpDownloadSelection() {
  cbCloseAllPops();
  if (!CP.shoot) { cbToast('Сначала откройте съёмку'); return; }
  var base = CP.shoot.name + ' — отбор';
  var jobs = [];
  App.cards.forEach(function (card, ci) {
    var folder = cpPad(ci + 1) + ' ' + (card.title || card.category || 'Карточка');
    var order = 0;
    function add(pid, slotName) {
      var p = pid ? cbPhotoById(pid) : null;
      if (!p || !p.disk || p.missing) return;
      order++;
      jobs.push({ disk: p.disk, size: p.size, dir: [base, folder],
        file: cpPad(order) + '_' + p.name });   /* порядок слотов = номер; имя файла исходное */
    }
    if (card.mode === 'auto') (card.pids || []).forEach(function (pid) { add(pid, ''); });
    else (card.slots || []).forEach(function (s) { add(s.pid, s.name || ''); });
  });
  App.containers.forEach(function (cont, ki) {
    var folder = cpPad(ki + 1) + ' ' + (cont.title || 'Блок');
    cont.photoIds.forEach(function (pid, i) {
      var p = cbPhotoById(pid);
      if (!p || !p.disk || p.missing) return;
      jobs.push({ disk: p.disk, size: p.size, dir: [base, 'Доп контент', folder], file: cpPad(i + 1) + '_' + p.name });
    });
  });
  if (!jobs.length) { cbToast('В карточках и доп. контенте пока нет кадров с Диска'); return; }
  cpPickRoot().then(function (dir) {
    return cpRunDownloads(dir, jobs, 'Скачиваю отбор');
  }).then(function (res) { cpFinishDownload(res, 'download_selection', { note: 'карточек: ' + App.cards.length }); }, function (e) {
    if (e && e.name !== 'AbortError') cpHandleError(e, 'Скачивание');
  });
}

document.getElementById('cpMenuDlAll').onclick = cpDownloadAll;
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
  if (mode === 'launcher' || mode === 'new') { cpShowShelf(); return; }
  return _cbProjModalOpenOrig(mode, startup);
};

cbSetProjectName = (function (orig) {
  return function (name) { orig(name); cpSetTitle(); };
})(cbSetProjectName);

cpReadToken();
cpSetTitle();
