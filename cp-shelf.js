/* ============================================================
   cp-shelf.js — панель съёмки на витрине.

   Клик по съёмке выбирает её, справа открывается панель:
     - папки следующего уровня (луки, части) с тегами;
     - фильтры: папка, тег, статус, скачано / не скачано;
     - «Присвоить тег» — съёмке или выбранным папкам (теги из словаря);
     - «Открыть» — отбор; «Скачать» — ровно то, что отфильтровано.

   Скачивание: прослойка собирает ZIP <_ContentPulse>/выгрузки/
   <код съёмки>_<тег>_<N>.zip (большие — частями _ч1, _ч2...) — кадры из
   карточек по папкам карточек, остальные по исходным папкам; имена файлов
   исходные (по ним потом сверяем возвращённую ретушь). Браузер скачивает
   готовый файл обычной загрузкой. После этого у кадров появляется отметка
   «скачано» (кто, когда, какая выгрузка, сколько раз) — статус не меняется.

   Словарь тегов — простой файл <_ContentPulse>/теги.txt:
     строка = тег; [Группа] — заголовок группы; # — комментарий.

   Настройки — простой файл <_ContentPulse>/настройки.txt:
     «название = значение», # — комментарий. Сейчас: ретушь = <папка>.

   Подключается после cp-app.js. Префикс: cp*.
   ============================================================ */

var CP_TAGS_FILE = 'теги.txt';
var CP_EXPORTS_DIR = 'выгрузки';
var CP_SETTINGS_FILE = 'настройки.txt';

var CP_SETTINGS_TEMPLATE = [
  '# Настройки Content Pulse. Одна настройка в строке: название = значение.',
  '# Строки с # — комментарии. Пути — как в адресе Диска, например disk:/КАТАЛОГ/01_РЕТУШЬ',
  '#',
  '# ретушь — куда копировать кадры при отправке на ретушь.',
  '#   Внутри появляется папка съёмки, в ней — исходные папки и имена файлов.',
  '#   Пусто — папка «Ретушь» внутри самой съёмки.',
  'ретушь = ',
  ''
].join('\n');

var CP_DICT_TEMPLATE = [
  '# Словарь тегов Content Pulse.',
  '# Один тег в строке. [Название] — группа тегов. Строки с # — комментарии,',
  '# после тега можно пояснить: «Y  # Юля».',
  '# Настройки группы после двоеточия: [Ретушёры: один] — из группы только один тег;',
  '# [Служебные: не в карточке] — группа не показывается на карточке.',
  '',
  '[Ретушёры: один]',
  'Яна',
  '',
  '[Срочность]',
  'Срочно',
  ''
].join('\n');

(function cpShelfCss() {
  var css = ''
    + '.cp-shelf-body{flex:1;display:flex;min-height:0}'
    + '.cp-shelf-body .cp-shelf-list{flex:1}'
    + '.cp-shoot-sel{border-color:#C9956B !important;background:#221d18 !important}'
    + '.cp-panel{width:400px;max-width:46vw;border-left:1px solid #2a2a28;background:#161615;display:none;flex-direction:column;min-height:0}'
    + '.cp-panel.cp-open{display:flex}'
    + '.cp-panel-head{padding:16px 18px 12px;border-bottom:1px solid #2a2a28;display:flex;gap:10px;align-items:flex-start}'
    + '.cp-panel-head b{display:block;font-size:15px;word-break:break-word}'
    + '.cp-panel-head small{color:#a3a09a;font-family:"IBM Plex Mono",monospace;font-size:11px}'
    + '.cp-panel-head .cp-sp{flex:1}'
    + '.cp-panel-body{flex:1;overflow:auto;padding:6px 18px 18px}'
    + '.cp-panel h4{font-size:10px;letter-spacing:.12em;color:#a3a09a;font-weight:600;margin:16px 0 8px;text-transform:uppercase}'
    + '.cp-panel-actions{display:flex;gap:8px;padding:12px 18px;border-top:1px solid #2a2a28;align-items:center}'
    + '.cp-panel-actions .cp-sum{flex:1;color:#a3a09a;font-size:11px;line-height:1.4}'
    + '.cp-fold{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #1f1f1d;font-size:12px}'
    + '.cp-fold label{flex:1;display:flex;gap:8px;align-items:center;cursor:pointer;word-break:break-word}'
    + '.cp-fold small{color:#a3a09a;font-family:"IBM Plex Mono",monospace}'
    + '.cp-chip{display:inline-flex;align-items:center;gap:4px;background:#2b241d;border:1px solid #5a4632;color:#e7c9a8;border-radius:10px;padding:1px 4px 1px 8px;font-size:11px;margin:2px 4px 2px 0}'
    + '.cp-chip button{background:none;border:none;color:#a3a09a;padding:0 4px;font-size:12px;line-height:1}'
    + '.cp-chip.cp-chip-inh{opacity:.6}'
    + '.cp-row{display:flex;gap:8px;align-items:center;margin:6px 0}'
    + '.cp-row select{flex:1;background:#1d1d1b;border:1px solid #2a2a28;color:#f2f2f1;padding:6px 8px;border-radius:3px;font:inherit}'
    + '.cp-row > span{width:84px;color:#a3a09a;font-size:12px}'
    + '.cp-note{color:#a3a09a;font-size:11px;line-height:1.5;margin:8px 0}'
    + '.cp-warn{color:#e7c9a8}'
    + '.cp-panel a{color:#C9956B}'
    + '.cp-fold{flex-wrap:wrap}'
    + '.cp-fold-all{border-bottom:1px solid #2a2a28;margin-top:10px}'
    + '.cp-fold-name{flex:1;font-weight:600}'
    + '.cp-fold-props{display:flex;flex-wrap:wrap;gap:4px;align-items:center;justify-content:flex-end}'
    + '.cp-fold-sub{border-bottom-color:#1a1a18}.cp-fold-sub label span{color:#cfcac2}'
    + '.cp-fold-exp{background:none;border:1px solid #2f2f2c;color:#a3a09a;font-size:10px;padding:2px 6px;border-radius:2px;cursor:pointer;white-space:nowrap}'
    + '.cp-fold-exp:hover{border-color:#C9956B;color:#e7c9a8}'
    + '.cp-state{font-size:10px;color:#a3a09a;border:1px solid #3a3a37;border-radius:10px;padding:1px 7px;white-space:nowrap}'
    + '.cp-state-retouch{color:#e7c9a8;border-color:#5a4632}.cp-state-dl{color:#9fc2a3;border-color:#3d5a40}'
    + '.cp-state-removed{color:#f2b8a0;border-color:#8a4a32}'
    + '.cp-addtag{width:22px;height:22px;padding:0;border-radius:11px;font-size:15px;line-height:1;color:#C9956B;border:1px solid #5a4632;background:transparent}'
    + '.cp-addtag:hover{background:#2b241d}'
    + '.cp-tagpop{position:fixed;z-index:3600;background:#1d1d1b;border:1px solid #3a3a37;border-radius:4px;padding:4px;min-width:160px;max-height:320px;overflow:auto;box-shadow:0 6px 24px #0008;display:none}'
    + '.cp-tagpop.cp-open{display:block}'
    + '.cp-tagpop small{display:block;color:#a3a09a;font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:6px 8px 2px}'
    + '.cp-tagpop button{display:block;width:100%;text-align:left;border:none;background:none;color:#f2f2f1;padding:5px 8px;font-size:12px;cursor:pointer}'
    + '.cp-tagpop button:hover{background:#2b241d}'
    + '.cp-tagpop button.cp-on{color:#a3a09a}'
    + '.cp-set{display:inline-flex;gap:8px;align-items:center}#cpRetouchInput{width:260px}';
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
})();

(function cpShelfDom() {
  var list = document.getElementById('cpShelfList');
  var body = document.createElement('div');
  body.className = 'cp-shelf-body';
  list.parentNode.insertBefore(body, list);
  body.appendChild(list);
  var panel = document.createElement('div');
  panel.className = 'cp-panel';
  panel.id = 'cpPanel';
  body.appendChild(panel);
})();

/* ---------- служебная папка и словарь тегов ---------- */

function cpServicePath(name) { return CP_CONFIG.serviceDir.replace(/\/+$/, '') + (name ? '/' + name : ''); }

/* Служебные файлы читаем только если они есть в списке папки: так в консоли
   нет лишних 404 и не тратим вызовы прослойки. Список живёт 20 с. */
var _cpSvcList = null;

/* Служебная папка переехала из корня Диска к архиву: один раз копируем
   туда файлы настроек из старой (копия на стороне Яндекса, старая остаётся). */
var _cpMigrateP = null;
function cpMigrateService() {
  var dir = CP_CONFIG.serviceDir.replace(/\/+$/, '');
  if (dir === CP_LEGACY_SERVICE) return Promise.resolve();
  if (_cpMigrateP && _cpMigrateP.dir === dir) return _cpMigrateP;
  var none = function (e) { if (e && e.status === 404) return []; throw e; };
  var p = Promise.all([CPDisk.listDir(dir).catch(none), CPDisk.listDir(CP_LEGACY_SERVICE).catch(none)]).then(function (r) {
    var have = {};
    r[0].forEach(function (x) { have[x.name] = true; });
    var items = r[1].filter(function (x) { return x.type === 'file' && /\.txt$/i.test(x.name) && !have[x.name]; })
      .map(function (x) { return { from: x.path, path: dir + '/' + x.name }; });
    if (!items.length) return;
    return CPDisk.proxyCopy(items, [dir]).then(function (out) {
      var ok = (out.results || []).filter(function (x) { return x.status === 'done' || x.status === 'exists'; }).length;
      /* Диск показывает новые файлы в списке не сразу — список задаём сами */
      var names = {};
      r[0].forEach(function (x) { names[x.name] = true; });
      items.forEach(function (x) { names[x.path.split('/').pop()] = true; });
      _cpSvcList = { ts: Date.now(), p: Promise.resolve(names) };
      if (ok) cbToast('Файлы настроек перенесены в ' + dir.replace(/^disk:/, ''));
    });
  }).catch(function (e) { if (window.console) console.warn('[CP] перенос служебной папки', e && (e.body || e.message)); });
  p.dir = dir;
  _cpMigrateP = p;
  return p;
}

function cpServiceNames(force) {
  if (!force && _cpSvcList && Date.now() - _cpSvcList.ts < 20000) return _cpSvcList.p;
  return cpMigrateService().then(function () {
    if (!force && _cpSvcList && Date.now() - _cpSvcList.ts < 20000) return _cpSvcList.p;
    return cpServiceNamesNow();
  });
}

function cpServiceNamesNow() {
  var entry = { ts: Date.now() };
  entry.p = CPDisk.listDir(CP_CONFIG.serviceDir).then(function (items) {
    var names = {};
    items.forEach(function (x) { names[x.name] = true; });
    return names;
  }, function (e) {
    if (e && e.status === 404) return {};
    _cpSvcList = null;
    throw e;
  });
  _cpSvcList = entry;
  return entry.p;
}

/** Текст служебного файла; нет файла — ошибка со status 404 (без запроса к прослойке). */
function cpReadServiceFile(name, force) {
  return cpServiceNames(force).then(function (names) {
    if (!names[name]) { var e = new Error('нет файла ' + name); e.status = 404; throw e; }
    return CPDisk.proxyFile(cpServicePath(name)).then(function (b) { return b.text(); });
  });
}

/** Разбор словаря: [{tag, group}]. «Y  # Юля» — тег Y, пояснение после #. */
/**
 * Разбор словаря: [{tag, group}] + CP.dictGroups {группа: {card, single}}.
 * Заголовок группы с настройками: [Ретушёры: один] — из группы выбирается
 * только один тег; [Служебные: не в карточке] — группа не показывается на
 * карточке для выбора. По умолчанию группа видна на карточке, тегов — сколько угодно.
 */
function cpParseDict(txt) {
  var out = [], group = '', groups = {};
  String(txt || '').split(/\r?\n/).forEach(function (line) {
    var l = line.replace(/\s+#.*$/, '').trim();
    if (!l || l.charAt(0) === '#') return;
    var g = /^\[(.+)\]$/.exec(l);
    if (g) {
      var parts = g[1].split(':');
      group = parts[0].trim();
      var opts = (parts.slice(1).join(':') || '').toLowerCase();
      groups[group] = {
        card: !/не\s+в\s+карточке|скрыт/.test(opts),
        single: /(^|[\s,])один([\s,]|$)|одиночн/.test(opts)
      };
      return;
    }
    if (!groups[group]) groups[group] = { card: true, single: false };
    if (!out.some(function (x) { return x.tag.toLowerCase() === l.toLowerCase(); })) out.push({ tag: l, group: group });
  });
  CP.dictGroups = groups;
  return out;
}

/** Группа тега и её настройки. */
function cpTagGroup(tag) {
  var d = (CP.dict || []).filter(function (x) { return x.tag === tag; })[0];
  var g = d ? d.group : '';
  return { name: g, opts: (CP.dictGroups || {})[g] || { card: true, single: false } };
}

/** Добавить тег в список с учётом «один из группы»: остальные теги группы убираются. */
function cpTagsWith(list, tag) {
  var tg = cpTagGroup(tag);
  var out = (list || []).filter(function (t) {
    if (t === tag) return false;
    return !(tg.opts.single && tg.name && cpTagGroup(t).name === tg.name);
  });
  out.push(tag);
  return out;
}

/** Словарь: [{tag, group}]. null — файла нет. Кэшируется до перезагрузки витрины. */
function cpLoadDict(force) {
  if (CP.dict !== undefined && CP.dict !== null && !force) return Promise.resolve(CP.dict);
  return cpReadServiceFile(CP_TAGS_FILE, force).then(function (txt) {
    CP.dict = cpParseDict(txt);
    return CP.dict;
  }, function (e) {
    if (e && e.status === 404) { CP.dict = null; return null; }
    throw e;
  });
}

function cpCreateDict() {
  cbBusyShow('Создаю словарь тегов...', 0.5);
  CPDisk.ensureDir(cpServicePath()).then(function () {
    return CPDisk.uploadBlob(cpServicePath(CP_TAGS_FILE), new Blob([CP_DICT_TEMPLATE], { type: 'text/plain' }), false);
  }).then(function () {
    cbBusyHide();
    cbToast('Словарь создан: ' + cpServicePath(CP_TAGS_FILE).replace(/^disk:/, '') + ' — свои теги впишите в «Файлы настроек»');
    _cpSvcList = null;
    CP.dict = cpParseDict(CP_DICT_TEMPLATE);   /* сразу, не ждём, пока Диск покажет файл в списке */
  }).then(cpRenderPanel).catch(function (e) { cpHandleError(e, 'Не удалось создать словарь'); });
}

/* ---------- выбор съёмки ---------- */

/** Подсветить выбранную съёмку, не перерисовывая список (иначе теряется двойной клик). */
function cpMarkSelected() {
  Array.prototype.forEach.call(document.querySelectorAll('#cpShelfList .cp-shoot'), function (b) {
    b.classList.toggle('cp-shoot-sel', !!(CP.sel && b.getAttribute('data-path') === CP.sel.path));
  });
}

function cpSelectShoot(path, name, modified) {
  CP.sel = { path: path, name: name, modified: modified, loading: true,
    folders: {}, open: {}, status: '', tag: '', dl: '', data: null, rev: '', files: [], dirs: [] };
  cpMarkSelected();
  cpRenderPanel();
  var sel = CP.sel;
  /* шаг 1: папки следующего уровня — один запрос, панель сразу живая */
  CPDisk.listDir(path).then(function (items) {
    if (CP.sel !== sel) return;
    sel.dirs = items.filter(function (x) { return x.type === 'dir' && x.name.charAt(0) !== '_' && x.name !== CPDisk.RETOUCH_DIR; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true }); });
    sel.dirsReady = true;
    cpRenderPanel();
  }).catch(function () { /* покажем ошибку после шага 2 */ });
  /* шаг 2: отбор, все кадры (обход папок), словарь */
  Promise.all([
    CPDisk.readState(path).catch(function (e) { if (e && e.status === 401) throw e; return { data: null, rev: null, error: e }; }),
    cpWalk(path),
    cpLoadDict().catch(function () { return null; }),
    typeof cpLoadRules === 'function' ? cpLoadRules() : null
  ]).then(function (r) {
    if (CP.sel !== sel) return;   /* успели выбрать другую */
    sel.data = r[0].data;
    sel.rev = r[0].rev;
    sel.stateError = r[0].error || null;
    sel.files = r[1];
    sel.loading = false;
    cpRenderPanel();
  }).catch(function (e) {
    sel.loading = false;
    sel.error = e;
    cpRenderPanel();
    cpHandleError(e, 'Не удалось прочитать съёмку');
  });
}

/* ---------- настройки на Диске ---------- */

var CP_SETTING_KEYS = { 'ретушь': 'retouch' };

function cpParseSettings(text) {
  var out = {};
  String(text || '').split(/\r?\n/).forEach(function (line) {
    if (/^\s*#/.test(line)) return;
    var m = /^\s*([^=]+?)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) return;
    var key = CP_SETTING_KEYS[m[1].toLowerCase()];
    if (!key || !m[2]) return;
    out[key] = key === 'retouch' ? cpNormArchive(m[2]) : m[2];
  });
  return out;
}

var _cpSettingsP = null;
/** Прочитать настройки один раз за сессию (файла нет — всё по умолчанию). */
function cpEnsureSettings(force) {
  if (_cpSettingsP && !force) return _cpSettingsP;
  _cpSettingsP = cpReadServiceFile(CP_SETTINGS_FILE, force)
    .then(function (t) { CP.settingsText = t; CP.settings = cpParseSettings(t); }, function (e) {
      if (e && e.status === 404) { CP.settingsText = ''; CP.settings = {}; return; }
      _cpSettingsP = null;   /* сеть — попробуем в следующий раз */
      if (!CP.settings) CP.settings = {};
      if (window.console) console.warn('[CP] настройки не прочитались', e && (e.body || e.message));
    }).then(function () { cpSettingsToUi(); if (CP.shoots) cpRenderShoots(); });
  return _cpSettingsP;
}

/** Записать одну настройку, не трогая остальные строки и комментарии. */
function cpSaveSetting(name, value) {
  return cpEnsureSettings(true).then(function () {
    var text = CP.settingsText || CP_SETTINGS_TEMPLATE;
    var lines = text.split(/\r?\n/), done = false;
    var re = new RegExp('^\\s*' + name + '\\s*=', 'i');
    lines = lines.map(function (l) { if (!done && re.test(l)) { done = true; return name + ' = ' + value; } return l; });
    if (!done) lines.push(name + ' = ' + value);
    text = lines.join('\n');
    return CPDisk.ensureDir(CP_CONFIG.serviceDir)
      .then(function () { return CPDisk.uploadBlob(cpServicePath(CP_SETTINGS_FILE), new Blob([text], { type: 'text/plain;charset=utf-8' }), true); })
      .then(function () { CP.settingsText = text; CP.settings = cpParseSettings(text); cpSettingsToUi(); if (CP.shoots) cpRenderShoots(); });
  });
}

function cpSettingsToUi() {
  var inp = document.getElementById('cpRetouchInput');
  if (inp && document.activeElement !== inp) inp.value = (CP.settings && CP.settings.retouch) || '';
}

(function cpSettingsDom() {
  var bar = document.getElementById('cpShelfBar');
  var wrap = document.createElement('span');
  wrap.className = 'cp-set';
  wrap.innerHTML = '<span class="cp-user">Ретушь:</span>'
    + '<input id="cpRetouchInput" spellcheck="false" placeholder="папка Ретушь внутри съёмки" title="Куда копировать кадры при отправке на ретушь. Общая настройка для всех, хранится в настройки.txt в служебной папке">'
    + '<button id="cpRetouchApply">Сохранить</button>';
  bar.appendChild(wrap);
  document.getElementById('cpRetouchApply').onclick = function () {
    var raw = document.getElementById('cpRetouchInput').value.trim();
    var v = raw ? cpNormArchive(raw) : '';
    var btn = this;
    btn.disabled = true;
    cpSaveSetting('ретушь', v).then(function () {
      cbToast(v ? 'Папка ретуши: ' + v.replace(/^disk:/, '') + ' (внутри — папки съёмок)' : 'Ретушь копируется в папку «Ретушь» внутри съёмки');
    }).catch(function (e) { cpHandleError(e, 'Не удалось сохранить настройку'); })
      .then(function () { btn.disabled = false; });
  };
  if (CPDisk.hasToken()) cpEnsureSettings();
})();

/* ---------- вычисления по данным съёмки ---------- */

function cpSelMeta(data) {
  var m = (data && data.meta && data.meta.cp) || {};
  return { status: m.status || {}, downloads: m.downloads || {}, folderTags: m.folderTags || {}, events: m.events || [] };
}

function cpRelOf(shootPath, disk) {
  var root = shootPath.replace(/\/+$/, '') + '/';
  return disk.indexOf(root) === 0 ? disk.slice(root.length) : disk;
}

/** Индекс кадров съёмки: disk -> {pid, rel, dir, status, dl, tags[], cards[]} */
function cpPhotoIndex(sel) {
  var data = sel.data || {}, meta = cpSelMeta(data);
  var pidByDisk = {}, cardTags = {}, cardsOf = {}, artDirOf = {};
  (data.photos || []).forEach(function (p) { if (p.disk) pidByDisk[p.disk] = p.id; });
  (data.cards || []).forEach(function (c, ci) {
    var pids = c.mode === 'auto' ? (c.pids || []) : (c.slots || []).map(function (s) { return s.pid; });
    pids.forEach(function (pid) {
      if (!pid) return;
      (cardsOf[pid] = cardsOf[pid] || []).push(ci);
      if (c.cpArticleDir && !artDirOf[pid]) artDirOf[pid] = c.cpArticleDir;
      (c.tags || []).forEach(function (t) { (cardTags[pid] = cardTags[pid] || {})[t] = true; });
    });
  });
  var idx = {};
  sel.files.forEach(function (f) {
    var rel = cpRelOf(sel.path, f.path);
    var dir = rel.indexOf('/') === -1 ? '' : rel.slice(0, rel.lastIndexOf('/'));
    var pid = pidByDisk[f.path] || null;
    /* кадр лука в карточке артикула относится и к папке этого артикула:
       выбрали папку артикула — он скачивается с ней, её теги и статусы — его */
    var dirs = [dir], ad = pid && artDirOf[pid];
    if (ad && ad !== dir && dir.indexOf(ad + '/') !== 0) dirs.push(ad);
    var tags = {};
    Object.keys(meta.folderTags).forEach(function (fp) {
      if (fp === '' || dirs.some(function (d) { return d === fp || d.indexOf(fp + '/') === 0; })) (meta.folderTags[fp] || []).forEach(function (t) { tags[t] = true; });
    });
    if (pid && cardTags[pid]) Object.keys(cardTags[pid]).forEach(function (t) { tags[t] = true; });
    idx[f.path] = { file: f, pid: pid, rel: rel, dir: dir, dirs: dirs,
      status: pid && meta.status[pid] ? meta.status[pid].s : '',
      dl: pid && meta.downloads[pid] ? meta.downloads[pid].n : 0,
      tags: Object.keys(tags), cards: pid ? (cardsOf[pid] || []) : [] };
  });
  return idx;
}

/**
 * Видео и прочие не-JPEG файлы под фильтры панели (галка «Все файлы»).
 * Действуют папки и теги папок; статус и «скачано» есть только у кадров —
 * при этих фильтрах прочие файлы не берём.
 */
function cpFilteredOthers(sel) {
  if (!sel || !sel.allFiles || !sel.allList || sel.status || sel.dl) return [];
  var meta = cpSelMeta(sel.data || {});
  var folders = Object.keys(sel.folders).filter(function (k) { return sel.folders[k]; });
  return sel.allList.filter(function (f) { return !CPDisk.isPhoto(f.name); }).map(function (f) {
    var rel = cpRelOf(sel.path, f.path);
    var dir = rel.indexOf('/') === -1 ? '' : rel.slice(0, rel.lastIndexOf('/'));
    var tags = {};
    Object.keys(meta.folderTags).forEach(function (fp) {
      if (fp === '' || dir === fp || dir.indexOf(fp + '/') === 0) (meta.folderTags[fp] || []).forEach(function (t) { tags[t] = true; });
    });
    return { file: f, rel: rel, dir: dir, tags: Object.keys(tags) };
  }).filter(function (x) {
    if (folders.length && !folders.some(function (f) { return x.dir === f || x.dir.indexOf(f + '/') === 0; })) return false;
    if (sel.tag && x.tags.indexOf(sel.tag) === -1) return false;
    return true;
  });
}

/** Кадры, проходящие фильтры панели. */
function cpFiltered(sel) {
  var idx = cpPhotoIndex(sel);
  var folders = Object.keys(sel.folders).filter(function (k) { return sel.folders[k]; });
  return Object.keys(idx).map(function (k) { return idx[k]; }).filter(function (x) {
    if (folders.length && !folders.some(function (f) { return x.dirs.some(function (d) { return d === f || d.indexOf(f + '/') === 0; }); })) return false;
    if (sel.status === 'none' && x.status) return false;
    if (sel.status && sel.status !== 'none' && x.status !== sel.status) return false;
    if (sel.tag && x.tags.indexOf(sel.tag) === -1) return false;
    if (sel.dl === 'yes' && !x.dl) return false;
    if (sel.dl === 'no' && x.dl) return false;
    return true;
  });
}

/* ---------- отрисовка панели ---------- */

/** Дерево папок съёмки: родитель (относительный путь, '' — корень) -> дочерние папки. */
function cpFolderTree(sel) {
  var root = sel.path.replace(/\/+$/, '') + '/';
  var all = {};
  (sel.files.dirs || []).forEach(function (d) { if (d.indexOf(root) === 0) all[d.slice(root.length)] = true; });
  sel.files.forEach(function (f) {
    var parts = cpRelOf(sel.path, f.path).split('/');
    parts.pop();
    for (var i = 1; i <= parts.length; i++) all[parts.slice(0, i).join('/')] = true;
  });
  (sel.dirs || []).forEach(function (d) { all[d.name] = true; });
  var kids = {};
  Object.keys(all).forEach(function (r) {
    if (!r) return;
    var par = r.indexOf('/') === -1 ? '' : r.slice(0, r.lastIndexOf('/'));
    (kids[par] = kids[par] || []).push(r);
  });
  Object.keys(kids).forEach(function (k) {
    kids[k].sort(function (a, b) { return a.split('/').pop().localeCompare(b.split('/').pop(), undefined, { numeric: true }); });
  });
  return kids;
}

/** Сводка по каждой папке вместе с вложенными: кадров, на ретуши, скачано... — за один проход. */
function cpFolderAgg(idx) {
  var agg = {};
  Object.keys(idx).forEach(function (k) {
    var x = idx[k], seen = {};
    (x.dirs || [x.dir]).forEach(function (d) {
      var parts = d ? d.split('/') : [];
      for (var i = 1; i <= parts.length; i++) seen[parts.slice(0, i).join('/')] = true;
    });
    Object.keys(seen).forEach(function (fp) {
      var a = agg[fp] || (agg[fp] = { n: 0, retouch: 0, approval: 0, reshoot: 0, removed: 0, dl: 0 });
      a.n++;
      if (x.status && a[x.status] !== undefined) a[x.status]++;
      if (x.dl) a.dl++;
    });
  });
  return agg;
}

/** Что внутри папки (с вложенными): сколько на ретуши, скачано и т. д. fp=null — вся съёмка. */
function cpFolderState(idx, fp) {
  var st = { retouch: 0, approval: 0, reshoot: 0, removed: 0, dl: 0 };
  Object.keys(idx).forEach(function (k) {
    var x = idx[k];
    if (fp !== null && !(x.dir === fp || x.dir.indexOf(fp + '/') === 0)) return;
    if (x.status && st[x.status] !== undefined) st[x.status]++;
    if (x.dl) st.dl++;
  });
  return st;
}

function cpStateChips(st) {
  var out = '';
  [['retouch', 'на ретуши'], ['dl', 'скачано'], ['approval', 'на согласовании'], ['reshoot', 'брак'], ['removed', 'удалено']].forEach(function (c) {
    if (st[c[0]]) out += '<span class="cp-state cp-state-' + c[0] + '">' + c[1] + ' ' + st[c[0]] + '</span>';
  });
  return out;
}

function cpTagChips(tags, removable, inherited) {
  return tags.map(function (t) {
    return '<span class="cp-chip' + (inherited ? ' cp-chip-inh' : '') + '">' + cbEsc(t)
      + (removable ? '<button data-cp-untag="' + cbEsc(t) + '" title="Снять тег">×</button>' : '') + '</span>';
  }).join('');
}

function cpDictOptions(selected, firstLabel) {
  var html = '<option value="">' + cbEsc(firstLabel) + '</option>', group = null;
  (CP.dict || []).forEach(function (d) {
    if (d.group !== group) {
      if (group !== null) html += '</optgroup>';
      html += '<optgroup label="' + cbEsc(d.group || 'Без группы') + '">';
      group = d.group;
    }
    html += '<option value="' + cbEsc(d.tag) + '"' + (d.tag === selected ? ' selected' : '') + '>' + cbEsc(d.tag) + '</option>';
  });
  if (group !== null) html += '</optgroup>';
  return html;
}

function cpRenderPanel() {
  var panel = document.getElementById('cpPanel');
  var sel = CP.sel;
  if (!sel) { panel.classList.remove('cp-open'); return; }
  panel.classList.add('cp-open');
  var stype = typeof cpShootType === 'function' ? cpShootType(sel.name) : null;
  var head = '<div class="cp-panel-head"><div><b>' + cbEsc(sel.name) + '</b>'
    + '<small>' + (sel.modified ? 'изменена ' + cpFmtDate(sel.modified) : '')
    + (stype ? ' · ' + cbEsc(stype.name) + (stype.exportMode === 'folders' ? ', выгрузка как в папках' : '') : '') + '</small></div>'
    + '<span class="cp-sp"></span><button data-cp-p="close" title="Закрыть панель">×</button></div>';
  if (sel.loading) {
    var lb = '<div class="cp-panel-body">';
    if (sel.dirsReady) {
      lb += '<h4>Папки · ' + sel.dirs.length + '</h4>';
      sel.dirs.forEach(function (d) { lb += '<div class="cp-fold"><span>' + cbEsc(d.name) + ' <small>· ...</small></span></div>'; });
    }
    lb += '<div class="cp-note">Считаю кадры во всех папках и читаю отбор... Большие съёмки — до минуты.</div></div>';
    panel.innerHTML = head + lb + '<div class="cp-panel-actions"><div class="cp-sum"></div>'
      + '<button data-cp-p="open">Открыть</button></div>';
    return;
  }
  if (sel.error) {
    panel.innerHTML = head + '<div class="cp-panel-body"><div class="cp-note cp-warn">Не удалось прочитать съёмку: '
      + cbEsc(sel.error.message || sel.error) + '</div></div>';
    return;
  }
  var meta = cpSelMeta(sel.data);
  var idx = cpPhotoIndex(sel);
  var body = '';
  var untagAttr = function (html, fp) { return html.replace(/data-cp-untag=/g, 'data-cp-fold-untag="' + cbEsc(fp) + '" data-cp-untag='); };
  var plus = function (fp) { return '<button class="cp-addtag" data-cp-addtag="' + cbEsc(fp) + '" title="Добавить тег">+</button>'; };

  /* вся съёмка: что внутри и теги */
  body += '<div class="cp-fold cp-fold-all"><span class="cp-fold-name">Вся съёмка <small>· ' + Object.keys(idx).length + '</small></span>'
    + '<span class="cp-fold-props">' + cpStateChips(cpFolderState(idx, null))
    + untagAttr(cpTagChips(meta.folderTags[''] || [], true), '') + plus('') + '</span></div>';

  /* дерево папок до последнего уровня: у каждой — галочка для скачивания,
     что внутри (ретушь, скачано... — вместе с вложенными), теги и «+» */
  var kids = cpFolderTree(sel), agg = cpFolderAgg(idx);
  var top = kids[''] || [];
  var nChecked = Object.keys(sel.folders).filter(function (k) { return sel.folders[k]; }).length;
  var topChecked = top.filter(function (fp) { return sel.folders[fp]; }).length;
  var nested = top.some(function (fp) { return (kids[fp] || []).length; });
  var anyOpen = Object.keys(sel.open || {}).some(function (k) { return sel.open[k]; });
  body += '<h4>Папки · ' + top.length
    + (top.length > 1 ? ' · <a href="#" data-cp-p="foldall">' + (topChecked === top.length ? 'снять все' : 'отметить все') + '</a>' : '')
    + (nested ? ' · <a href="#" data-cp-p="expall">' + (anyOpen ? 'свернуть все' : 'раскрыть все') + '</a>' : '') + '</h4>';
  if (!top.length) body += '<div class="cp-note">Вложенных папок нет — все кадры лежат в корне съёмки.</div>';
  var row = function (fp, depth, above) {
    var ch = kids[fp] || [], open = !!(sel.open && sel.open[fp]), on = !!sel.folders[fp];
    var a = agg[fp] || { n: 0 };
    body += '<div class="cp-fold' + (depth ? ' cp-fold-sub' : '') + '" style="padding-left:' + (depth * 18) + 'px">'
      + '<label><input type="checkbox" data-cp-fold="' + cbEsc(fp) + '"' + (on || above ? ' checked' : '')
      + (above ? ' disabled title="Уже отмечена папка выше — эта скачается вместе с ней"' : '') + '>'
      + '<span>' + cbEsc(fp.split('/').pop()) + ' <small>· ' + a.n + '</small></span></label>'
      + (ch.length ? '<button class="cp-fold-exp" data-cp-exp="' + cbEsc(fp) + '">' + (open ? 'свернуть' : 'папок: ' + ch.length
        + (function () { var n = Object.keys(sel.folders).filter(function (k) { return sel.folders[k] && k.indexOf(fp + '/') === 0; }).length; return n && !on && !above ? ' · отмечено ' + n : ''; })()) + '</button>' : '')
      + '<span class="cp-fold-props">' + cpStateChips(a) + untagAttr(cpTagChips(meta.folderTags[fp] || [], true), fp) + plus(fp) + '</span></div>';
    if (open) ch.forEach(function (c) { row(c, depth + 1, above || on); });
  };
  top.forEach(function (fp) { row(fp, 0, false); });

  /* тег сразу нескольким отмеченным папкам */
  var nf = Object.keys(sel.folders).filter(function (k) { return sel.folders[k]; }).length;
  if (CP.dict === null) {
    body += '<div class="cp-note cp-warn">Словаря тегов нет. <a href="#" data-cp-p="mkdict">Создать</a></div>';
  } else if (nf) {
    body += '<div class="cp-row"><select id="cpAssignTag">' + cpDictOptions('', 'Тег') + '</select>'
      + '<button data-cp-p="assign">Отмеченным (' + nf + ')</button></div>';
  }

  /* фильтры */
  body += '<h4>Фильтры для скачивания</h4>';
  body += '<div class="cp-row"><span>Тег</span><select id="cpFTag">' + cpDictOptions(sel.tag, 'Все') + '</select></div>';
  body += '<div class="cp-row"><span>Статус</span><select id="cpFStatus">'
    + [['', 'Все'], ['retouch', 'Ретушь'], ['approval', 'Согласование'], ['reshoot', 'Брак (пересъём)'], ['removed', 'Удалено из отбора'], ['none', 'Без статуса']]
      .map(function (o) { return '<option value="' + o[0] + '"' + (sel.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('')
    + '</select></div>';
  body += '<div class="cp-row"><span>Скачано</span><select id="cpFDl">'
    + [['', 'Все'], ['no', 'Не скачано'], ['yes', 'Скачано']]
      .map(function (o) { return '<option value="' + o[0] + '"' + (sel.dl === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('')
    + '</select></div>';
  body += '<div class="cp-row"><span>Файлы</span><select id="cpFAll">'
    + '<option value=""' + (sel.allFiles ? '' : ' selected') + '>Только фото</option>'
    + '<option value="all"' + (sel.allFiles ? ' selected' : '') + '>Все файлы (с видео)</option></select></div>';
  if (sel.allFiles && !sel.allList) body += '<div class="cp-note">Считаю видео и прочие файлы...</div>';
  else if (sel.allFiles && (sel.status || sel.dl)) body += '<div class="cp-note">Фильтры «Статус» и «Скачано» есть только у кадров — видео и прочие файлы с ними не скачиваются.</div>';
  if (sel.stateError) body += '<div class="cp-note cp-warn">Отбор съёмки не прочитался — статусы и карточки не учитываются.</div>';
  else if (!sel.data) body += '<div class="cp-note">Съёмку ещё не открывали в Content Pulse: карточек и статусов пока нет.</div>';
  body += '<div class="cp-note"><a href="#" data-cp-p="bench">Проверить скорость Диска</a></div>';

  var items = cpFiltered(sel);
  var inCards = items.filter(function (x) { return x.cards.length; }).length;
  var again = items.filter(function (x) { return x.dl; }).length;
  var others = cpFilteredOthers(sel);
  var othersBytes = others.reduce(function (a, x) { return a + (x.file.size || 0); }, 0);
  var sum = 'Будет скачано: <b>' + items.length + '</b> из ' + Object.keys(idx).length
    + (nChecked ? ' · из отмеченных папок: ' + nChecked : '')
    + (inCards ? ' · в карточках ' + inCards : '')
    + (others.length ? '<br>и других файлов: <b>' + others.length + '</b> · ' + cpMb(othersBytes) : '')
    + (again ? '<br><span class="cp-warn">уже скачивали: ' + again + '</span>' : '');

  /* перерисовка не должна прыгать наверх, когда раскрываешь папку внизу списка */
  var oldBody = panel.querySelector('.cp-panel-body');
  var keepScroll = oldBody && panel.getAttribute('data-path') === sel.path ? oldBody.scrollTop : 0;
  panel.setAttribute('data-path', sel.path);
  panel.innerHTML = head + '<div class="cp-panel-body">' + body + '</div>'
    + '<div class="cp-panel-actions"><div class="cp-sum">' + sum + '</div>'
    + '<button data-cp-p="open">Открыть</button>'
    + '<button class="cb-primary" data-cp-p="download"' + (items.length || others.length ? '' : ' disabled') + '>'
    + (nChecked ? 'Скачать отмеченные' : 'Скачать') + '</button></div>';
  if (keepScroll) panel.querySelector('.cp-panel-body').scrollTop = keepScroll;
}

/* ---------- изменения отбора с витрины (чтение-правка-запись) ---------- */

/** fn(data) правит свежие данные отбора; при конфликте — один повтор на свежей версии. */
function cpMutateState(sel, fn) {
  function attempt(retry) {
    return CPDisk.readState(sel.path).then(function (st) {
      var data = st.data || cpBlankProject(sel.name);
      data.meta = data.meta || {};
      data.meta.cp = data.meta.cp || {};
      ['status', 'downloads', 'folderTags', 'cardStatus'].forEach(function (k) { data.meta.cp[k] = data.meta.cp[k] || {}; });
      data.meta.cp.events = data.meta.cp.events || [];
      fn(data);
      return CPDisk.writeState(sel.path, data, st.rev).then(function (rev) {
        sel.data = data; sel.rev = rev;
        return data;
      });
    }).catch(function (e) {
      if (e && e.conflict && retry) return attempt(false);
      throw e;
    });
  }
  return attempt(true).then(function (data) {
    /* если эта съёмка открыта — подтянуть изменения в отбор */
    if (CP.shoot && CP.shoot.path === sel.path && !App.dirty) {
      return CPDisk.readState(sel.path).then(function (st) { CP.rev = st.rev; cpApplyRemote(st.data); return data; });
    }
    return data;
  });
}

function cpShelfEvent(data, action, extra) {
  var ev = { ts: new Date().toISOString(), action: action, actor: cpActor(), items: [] };
  Object.keys(extra || {}).forEach(function (k) { if (extra[k] !== undefined) ev[k] = extra[k]; });
  data.meta.cp.events.push(ev);
  if (data.meta.cp.events.length > 3000) data.meta.cp.events.splice(0, data.meta.cp.events.length - 3000);
}

function cpAssignTag(tag, folders) {
  var sel = CP.sel;
  var targets = folders.length ? folders : [''];
  cbBusyShow('Присваиваю тег «' + tag + '»...', 0.5);
  cpMutateState(sel, function (data) {
    targets.forEach(function (fp) {
      /* «один из группы» (словарь): другой тег той же группы заменяется */
      data.meta.cp.folderTags[fp] = cpTagsWith(data.meta.cp.folderTags[fp] || [], tag);
    });
    cpShelfEvent(data, 'tag_folder', { tag: tag, folders: targets.map(function (f) { return f || '(вся съёмка)'; }) });
  }).then(function () {
    cbBusyHide();
    cbToast('Тег «' + tag + '» → ' + (folders.length ? folders.join(', ') : 'вся съёмка'));
    cpRenderPanel();
  }).catch(function (e) { cpHandleError(e, 'Не удалось присвоить тег'); });
}

function cpRemoveTag(tag, folder) {
  var sel = CP.sel;
  cpMutateState(sel, function (data) {
    var list = data.meta.cp.folderTags[folder] || [];
    data.meta.cp.folderTags[folder] = list.filter(function (t) { return t !== tag; });
    if (!data.meta.cp.folderTags[folder].length) delete data.meta.cp.folderTags[folder];
    cpShelfEvent(data, 'untag_folder', { tag: tag, folders: [folder || '(вся съёмка)'] });
  }).then(cpRenderPanel).catch(function (e) { cpHandleError(e, 'Не удалось снять тег'); });
}

/* ---------- скачивание отфильтрованного ---------- */

function cpExportName(sel) {
  var parts = [CPDisk.safeName(sel.name)];
  if (sel.tag) parts.push(CPDisk.safeName(sel.tag));
  else if (sel.status && sel.status !== 'none' && CP_STATUS[sel.status]) parts.push(CP_STATUS[sel.status].label);
  var events = (sel.data && sel.data.meta && sel.data.meta.cp && sel.data.meta.cp.events) || [];
  return cpNextExportName(parts.join('_'), events);
}

function cpShelfDownload() {
  var sel = CP.sel;
  /* «все файлы» выбраны, а список видео ещё считается — дождаться, иначе архив уйдёт без них */
  if (sel.allFiles && !sel.allList) {
    cbBusyShow('Считаю видео и прочие файлы...', 0.05);
    cpWalkAll(sel.path).then(function (list) {
      cbBusyHide();
      if (CP.sel !== sel) return;
      sel.allList = list;
      cpRenderPanel();
      cpShelfDownload();
    }, function (e) { cpHandleError(e, 'Не удалось прочитать файлы съёмки'); });
    return;
  }
  var items = cpFiltered(sel);
  if (!items.length) { cbToast('Под фильтры не попало ни одного кадра'); return; }
  var data = sel.data || {};
  var cards = data.cards || [];
  var name;
  var used = {};
  /* раскладка внутри архива: кадры из карточек — по папкам карточек,
     остальные — по исходным папкам; имена файлов исходные */
  var stype = typeof cpShootType === 'function' ? cpShootType(sel.name) : null;
  var asFolders = !!(stype && stype.exportMode === 'folders');   /* правило из структура.txt */
  var numbered = !!(stype && stype.exportNames === 'numbered');
  var entries = items.map(function (x) {
    var parts;
    if (x.cards.length && !asFolders) {
      var c = cards[x.cards[0]];
      /* карточка артикула — исходная папка артикула (с луком), иначе «NN название» */
      parts = c.cpArticleDir ? c.cpArticleDir.split('/') : [cpPad(x.cards[0] + 1) + ' ' + (c.title || c.category || 'Карточка')];
    } else {
      parts = x.dir ? x.dir.split('/') : [];
    }
    var dir = parts.map(CPDisk.safeName).join('/');
    var fname = x.file.name;
    if (numbered && x.cards.length) {
      var cc = cards[x.cards[0]];
      var order = (cc.mode === 'auto' ? (cc.pids || []) : (cc.slots || []).map(function (sl) { return sl.pid; })).filter(Boolean).indexOf(x.pid);
      if (order >= 0) fname = cpPad(order + 1) + '_' + fname;
    }
    var key = (dir ? dir + '/' : '') + fname, k = 2;
    while (used[key]) { fname = x.file.name.replace(/(\.[^.]+)?$/, '_' + (k++) + '$1'); key = (dir ? dir + '/' : '') + fname; }
    used[key] = true;
    return { from: x.file.path, name: key, size: x.file.size };
  });
  /* видео и прочие файлы (галка «Все файлы») — по исходным папкам */
  var others = cpFilteredOthers(sel);
  others.forEach(function (x) {
    if (used[x.rel]) return;
    used[x.rel] = true;
    entries.push({ from: x.file.path, name: x.rel, size: x.file.size });   /* крупные уйдут отдельной ссылкой */
  });
  if (!entries.length) { cbToast('Нечего скачивать'); return; }
  cbBusyShow('Готовлю архив: ' + entries.length + ' файл(ов)...', 0.02);
  cpExportName(sel).then(function (n) {
    name = n;
    return cpExportBundle(name, entries, items.length + ' кадр(ов)' + (others.length ? ' и других файлов: ' + (entries.length - items.length) : '')
      + '. После скачивания кадры отмечаются как скачанные.');
  }).then(function (r) {
    /* отметка «скачано» — статус не меняем */
    var stamp = { by: cpActor(), ts: new Date().toISOString(), export: name };
    var filters = { tag: sel.tag || undefined, status: sel.status || undefined, dl: sel.dl || undefined,
      folders: Object.keys(sel.folders).filter(function (k) { return sel.folders[k]; }) };
    return cpMutateState(sel, function (d) {
      var pidByDisk = {};
      (d.photos || []).forEach(function (p) { if (p.disk) pidByDisk[p.disk] = p.id; });
      items.forEach(function (x) {
        var pid = pidByDisk[x.file.path];
        if (!pid) {   /* кадр ещё не в отборе — заводим запись, чтобы помнить скачивание */
          pid = 'p' + (d.nextId = (d.nextId || 1) + 1) + 'x';
          d.photos = d.photos || [];
          d.photos.push({ id: pid, name: x.file.name, disk: x.file.path, size: x.file.size, md5: x.file.md5, w: 0, h: 0, kind: 'photo' });
          pidByDisk[x.file.path] = pid;
        }
        var cur = d.meta.cp.downloads[pid];
        d.meta.cp.downloads[pid] = { n: (cur ? cur.n : 0) + 1, first: cur ? cur.first : stamp, last: stamp };
      });
      cpShelfEvent(d, 'download', { export: name, count: r.files, parts: r.parts.length, filters: filters,
        again: items.filter(function (x) { return x.dl; }).length || undefined });
    }).then(function () {
      cpRenderPanel();
    });
  }).catch(function (e) { cpHandleError(e, 'Скачивание'); });
}

/* ---------- замер скорости ---------- */

function cpBench() {
  var sel = CP.sel;
  if (!sel || !sel.files || !sel.files.length) { cbToast('Дождитесь, пока досчитаются кадры съёмки'); return; }
  /* три кадра из разных мест списка */
  var f = sel.files, n = f.length;
  var pick = [f[0], f[Math.floor(n / 2)], f[n - 1]].filter(function (x, i, a) { return a.indexOf(x) === i; });
  var t0 = Date.now();
  cbBusyShow('Замеряю скорость Диска на ' + pick.length + ' кадрах...', 0.3);
  var tick = setInterval(function () { cbBusyShow('Замеряю скорость Диска на ' + pick.length + ' кадрах... ' + Math.round((Date.now() - t0) / 1000) + ' с', 0.5); }, 1000);
  CPDisk.proxyBench(pick.map(function (x) { return x.path; }), CP_CONFIG.serviceDir).then(function (r) {
    clearInterval(tick);
    cbBusyHide();
    var lines = ['Content Pulse — замер скорости Диска', new Date().toISOString(), 'съёмка: ' + sel.name + ' · кадров: ' + n, ''];
    lines.push('По одному:');
    (r.reads || []).forEach(function (x) {
      lines.push('  ' + x.file + ': ' + (x.error ? 'ОШИБКА ' + x.error : (x.mb + ' МБ, ссылка ' + x.ms_link + ' мс, файл ' + x.ms_file + ' мс, ' + x.mb_s + ' МБ/с, HTTP ' + x.status + (x.body ? ' ' + x.body : ''))));
    });
    if (r.parallel) lines.push('Параллельно ' + r.parallel.files + ': ' + r.parallel.mb + ' МБ за ' + r.parallel.ms + ' мс = ' + r.parallel.mb_s + ' МБ/с' + (r.parallel.errors.length ? ' · ошибки: ' + r.parallel.errors.join('; ') : ''));
    var u = r.upload || {};
    lines.push('Загрузка на Диск: ' + (u.error ? 'ОШИБКА ' + u.error : (u.mb + ' МБ за ' + u.ms + ' мс = ' + u.mb_s + ' МБ/с, HTTP ' + u.status)));
    lines.push('', 'всего ' + Math.round((Date.now() - t0) / 1000) + ' с · ' + navigator.userAgent);
    cpReportCard('Замер скорости Диска', lines.join('\n'));
  }).catch(function (e) {
    clearInterval(tick);
    cpHandleError(e, 'Замер скорости');
    cpReportCard('Замер скорости Диска', 'ОШИБКА: ' + ((e && (e.status + ' ' + (e.body || e.message))) || e) + '\nчерез ' + Math.round((Date.now() - t0) / 1000) + ' с');
  });
}

/* ---------- «+» у папки: словарь тегов ---------- */

(function cpTagPopDom() {
  var pop = document.createElement('div');
  pop.className = 'cp-tagpop';
  pop.id = 'cpTagPop';
  document.body.appendChild(pop);
  pop.addEventListener('click', function (e) {
    var b = e.target.closest('[data-cp-poptag]');
    if (b) {
      pop.classList.remove('cp-open');
      var fp = pop.getAttribute('data-fp');
      if (b.classList.contains('cp-on')) return;
      cpAssignTag(b.getAttribute('data-cp-poptag'), fp ? [fp] : []);
      return;
    }
    if (e.target.closest('[data-cp-popmk]')) { pop.classList.remove('cp-open'); cpCreateDict(); }
  });
  document.addEventListener('click', function (e) {
    if (!e.target.closest('#cpTagPop') && !e.target.closest('[data-cp-addtag]')) pop.classList.remove('cp-open');
  });
})();

function cpOpenTagPop(anchor, fp) {
  var pop = document.getElementById('cpTagPop');
  var have = (cpSelMeta(CP.sel.data).folderTags[fp] || []);
  var html = '', group = null;
  if (!CP.dict || !CP.dict.length) {
    html = '<button data-cp-popmk>Словаря тегов нет — создать</button>';
  } else {
    CP.dict.forEach(function (d) {
      if (d.group !== group) { group = d.group; if (group) html += '<small>' + cbEsc(group) + '</small>'; }
      var on = have.indexOf(d.tag) !== -1;
      html += '<button data-cp-poptag="' + cbEsc(d.tag) + '"' + (on ? ' class="cp-on" title="Уже стоит"' : '') + '>' + cbEsc(d.tag) + '</button>';
    });
  }
  pop.innerHTML = html;
  pop.setAttribute('data-fp', fp);
  pop.classList.add('cp-open');
  var r = anchor.getBoundingClientRect();
  var w = pop.offsetWidth, h = pop.offsetHeight;
  pop.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
  pop.style.top = (r.bottom + h + 8 > innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4) + 'px';
}

/* ---------- события панели ---------- */

document.getElementById('cpPanel').addEventListener('click', function (e) {
  var sel = CP.sel;
  var untag = e.target.closest('[data-cp-untag]');
  if (untag) {
    e.preventDefault();
    var folder = untag.getAttribute('data-cp-fold-untag') || '';
    var tag = untag.getAttribute('data-cp-untag');
    if (confirm('Снять тег «' + tag + '» с ' + (folder ? 'папки «' + folder + '»' : 'всей съёмки') + '?')) cpRemoveTag(tag, folder);
    return;
  }
  var add = e.target.closest('[data-cp-addtag]');
  if (add) {
    e.preventDefault();
    var openPop = function () { cpOpenTagPop(add, add.getAttribute('data-cp-addtag')); };
    if (CP.dict === undefined) cpLoadDict().then(openPop, openPop); else openPop();
    return;
  }
  var exp = e.target.closest('[data-cp-exp]');
  if (exp) {
    e.preventDefault();
    var fp = exp.getAttribute('data-cp-exp');
    sel.open = sel.open || {};
    sel.open[fp] = !sel.open[fp];
    cpRenderPanel();
    return;
  }
  var b = e.target.closest('[data-cp-p]');
  if (!b) return;
  e.preventDefault();
  var act = b.getAttribute('data-cp-p');
  if (act === 'close') { CP.sel = null; cpRenderPanel(); cpMarkSelected(); }
  else if (act === 'open') cpOpenShoot(sel.path, sel.name);
  else if (act === 'download') cpShelfDownload();
  else if (act === 'foldall') {
    var top = cpFolderTree(sel)[''] || [];
    var allOn = top.every(function (fp) { return sel.folders[fp]; });
    sel.folders = {};
    if (!allOn) top.forEach(function (fp) { sel.folders[fp] = true; });
    cpRenderPanel();
  }
  else if (act === 'expall') {
    var anyOpen = Object.keys(sel.open || {}).some(function (k) { return sel.open[k]; });
    sel.open = {};
    if (!anyOpen) { var kids = cpFolderTree(sel); Object.keys(kids).forEach(function (k) { if (k) sel.open[k] = true; }); }
    cpRenderPanel();
  }
  else if (act === 'bench') cpBench();
  else if (act === 'mkdict') cpCreateDict();
  else if (act === 'reloaddict') cpLoadDict(true).then(cpRenderPanel, function (er) { cpHandleError(er, 'Словарь'); });
  else if (act === 'assign') {
    var tag = document.getElementById('cpAssignTag').value;
    if (!tag) { cbToast('Выберите тег из словаря'); return; }
    cpAssignTag(tag, Object.keys(sel.folders).filter(function (k) { return sel.folders[k]; }));
  }
});

document.getElementById('cpPanel').addEventListener('change', function (e) {
  var sel = CP.sel;
  if (!sel) return;
  var t = e.target;
  if (t.hasAttribute('data-cp-fold')) {
    var fp = t.getAttribute('data-cp-fold');
    sel.folders[fp] = t.checked;
    /* отметили папку — отметки вложенных в ней больше не нужны (она скачается целиком) */
    if (t.checked) Object.keys(sel.folders).forEach(function (k) { if (k.indexOf(fp + '/') === 0) delete sel.folders[k]; });
  }
  else if (t.id === 'cpFTag') sel.tag = t.value;
  else if (t.id === 'cpFStatus') sel.status = t.value;
  else if (t.id === 'cpFDl') sel.dl = t.value;
  else if (t.id === 'cpFAll') {
    sel.allFiles = !!t.value;
    if (sel.allFiles && !sel.allList) {
      cpWalkAll(sel.path).then(function (list) {
        if (CP.sel !== sel) return;
        sel.allList = list;
        cpRenderPanel();
      }, function (e) { cpHandleError(e, 'Не удалось прочитать файлы съёмки'); });
    }
  }
  else return;
  cpRenderPanel();
});
