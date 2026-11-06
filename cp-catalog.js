/* ============================================================
   cp-catalog.js — один путь: КАТАЛОГ со всеми этапами

   Маша, 06.11.2026: «Указываем один-единственный путь к папке, где лежат
   съёмки — в нашем случае КАТАЛОГ, внутри которой папка исходники и так
   далее. Если каких-то папок не хватает, мы их создаём.» «Конфиг их
   компании: мы просто задаём, какие папки имеют место отображаться.»

   - В шестерёнке «Папка съёмок» — КАТАЛОГ. Если внутри есть папки с
     номером этапа (01_…, 02_…), это каталог: служебная папка —
     КАТАЛОГ/_ContentPulse, съёмки — из папок-исходников.
   - Что значит папка — по смыслу имени (АРХИВ, ИСХОДНИКИ, ОТБОР, РЕТУШЬ,
     ОТРЕТУШИРОВАНО, САЙТ), иначе по номеру в начале имени:
       00 — архив, не читаем; 01 — исходники;
       02 — согласование (у SK это 02_ОТБОР: что ушло на согласование);
       03 — ретушь; 04 — отретушировано (проверка ретуши); 05 — сайт.
     Поменять — в шестерёнке, пишется в настройки.txt строкой
     «этап <папка> = исходники | согласование | ретушь | отретушировано |
     сайт | не показывать».
   - Фильтры витрины — эти папки, по их именам; нет папки — нет фильтра.
   - Недостающие папки этапов создаются только кнопкой «Создать».
   ============================================================ */

var CP_CAT_ROLES = [
  { role: 'source', word: 'исходники', setting: '', def: '01_ИСХОДНИКИ' },
  { role: 'approval', word: 'согласование', setting: 'approve', def: '02_ОТБОР' },
  { role: 'retouch', word: 'ретушь', setting: 'retouch', def: '03_РЕТУШЬ' },
  { role: 'review', word: 'отретушировано', setting: 'retouched', def: '04_ОТРЕТУШИРОВАНО' },
  { role: 'site', word: 'сайт', setting: 'site', def: '05_САЙТ' }
];
var CP_CAT_SKIP_WORD = 'не показывать';
var CP_CAT_NUM = { '00': 'skip', '01': 'source', '02': 'approval', '03': 'retouch', '04': 'review', '05': 'site' };
/* по смыслу имени — раньше номера: у SK «04_САЙТ» — это сайт, а не 04-й этап по умолчанию.
   Маша, 06.11: «в исходниках показывает всё, что лежит в архиве, а должен только исходники» —
   архив (00_АРХИВ) не читаем; включить можно в шестерёнке. */
var CP_CAT_WORDS = [
  [/архив/i, 'skip'], [/исходн/i, 'source'], [/отретуш|проверк/i, 'review'], [/ретуш/i, 'retouch'],
  [/сайт|site/i, 'site'], [/отбор|соглас/i, 'approval']
];
var CP_CAT_RE = /^(\d{2})[_ .\-]/;
CP.catalogList = null;   /* папки открытого каталога: [{name, path}] */

/** Путь каталога, если открыт каталог; иначе ''. */
function cpCatalog() {
  var c = cpGet('cp_catalog', '');
  return c && c === String(CP.archive || '').replace(/\/+$/, '') ? c : '';
}

/** Что значит папка каталога: роль или 'skip'. */
function cpCatRoleOf(name, settings) {
  var cfg = ((settings || CP.settings || {}).stageRoles) || {};
  var r = cfg[String(name).toLowerCase()];
  if (r) return r;
  for (var i = 0; i < CP_CAT_WORDS.length; i++) if (CP_CAT_WORDS[i][0].test(name)) return CP_CAT_WORDS[i][1];
  var m = CP_CAT_RE.exec(name);
  return (m && CP_CAT_NUM[m[1]]) || 'skip';
}

/** Папки каталога с этой ролью (исходники: сначала 01, потом прочие). */
function cpCatDirs(role, settings) {
  var list = (CP.catalogList || []).filter(function (d) { return cpCatRoleOf(d.name, settings) === role; });
  if (role === 'source') list.sort(function (a, b) { return (/^01/.test(b.name) ? 1 : 0) - (/^01/.test(a.name) ? 1 : 0) || (a.name < b.name ? -1 : 1); });
  return list;
}

/** Папки этапов из каталога — в настройки (ими пользуются ретушь, сверка, фильтры). */
function cpCatMerge(settings) {
  if (!settings || !cpCatalog() || !CP.catalogList) return settings;
  CP_CAT_ROLES.forEach(function (r) {
    if (!r.setting) return;
    var d = cpCatDirs(r.role, settings)[0];
    if (d) settings[r.setting] = d.path;
    else delete settings[r.setting];
  });
  settings.catalog = cpCatalog();
  return settings;
}

function cpCatMissing() {
  return CP_CAT_ROLES.filter(function (r) { return !cpCatDirs(r.role).length; });
}

/* служебная папка каталога — внутри него */
cpServiceDirFor = (function (orig) {
  return function (archive) {
    var a = String(archive || '').replace(/\/+$/, '');
    if (a && a === cpGet('cp_catalog', '')) return a + '/_ContentPulse';
    return orig.apply(this, arguments);
  };
})(cpServiceDirFor);
CP_CONFIG.serviceDir = cpServiceDirFor(cpGet('cp_archive', CP_CONFIG.defaultArchive));

/* настройки: строки «этап <папка> = <что это>» */
cpParseSettings = (function (orig) {
  return function (text) {
    var out = orig.apply(this, arguments);
    var roles = {};
    String(text || '').split(/\r?\n/).forEach(function (line) {
      if (/^\s*#/.test(line)) return;
      var m = /^\s*этап\s+(.+?)\s*=\s*(.*?)\s*$/i.exec(line);
      if (!m || !m[2]) return;
      var w = m[2].toLowerCase();
      var r = CP_CAT_ROLES.filter(function (x) { return x.word === w; })[0];
      roles[m[1].toLowerCase()] = r ? r.role : 'skip';
    });
    out.stageRoles = roles;
    return cpCatMerge(out);
  };
})(cpParseSettings);

/* съёмки каталога: из всех папок-исходников */
(function () {
  var listOrig = CPDisk.listShoots;
  CPDisk.listShoots = function (archive) {
    var cat = String(archive || '').replace(/\/+$/, '');
    if (!cat || cat !== cpGet('cp_catalog', '')) { CP.catalogList = null; cpCatRender(); return listOrig(archive); }
    var ready = typeof cpEnsureSettings === 'function' ? cpEnsureSettings() : Promise.resolve();
    return ready.then(function () { return CPDisk.listDir(cat); }).then(function (items) {
      CP.catalogList = items.filter(function (x) { return x.type === 'dir' && x.name.charAt(0) !== '_'; })
        .map(function (x) { return { name: x.name, path: x.path }; })
        .sort(function (a, b) { return a.name < b.name ? -1 : 1; });
      cpCatMerge(CP.settings);
      return Promise.all(cpCatDirs('source').map(function (d) {
        return listOrig(d.path).catch(function (e) { if (e && e.status === 404) return []; throw e; });
      }));
    }).then(function (lists) {
      cpCatRender();
      return [].concat.apply([], lists).sort(function (a, b) { return a.modified < b.modified ? 1 : -1; });
    });
  };
})();

/* ретушь в каталоге без папки ретуши — в КАТАЛОГ/03_РЕТУШЬ, а не внутрь съёмки в исходниках */
cpRetouchBase = (function (orig) {
  return function (shootPath, shootName) {
    var cat = cpCatalog();
    if (cat && CP.catalogList && !(CP.settings || {}).retouch) return cat + '/03_РЕТУШЬ/' + shootName;
    return orig.apply(this, arguments);
  };
})(cpRetouchBase);

/* фильтры витрины: только папки каталога, по их именам */
cpStageList = (function (orig) {
  return function () {
    var list = orig.apply(this, arguments);
    if (!cpCatalog() || !CP.catalogList) return list;
    var src = cpCatDirs('source');
    /* Маша, 06.11: «отбор в исходниках — фильтр пока не нужен; это скорее атрибут
       того, что лежит в исходниках» — он виден под съёмкой и внутри неё (карточки) */
    return list.filter(function (x) {
      return !x.key || (x.key !== 'select' && CP.settings && CP.settings[CP_STAGE_SETTING[x.key]]);
    }).map(function (x) {
      if (x.key === '' && src.length) return { key: '', label: src[0].name };
      return x;
    });
  };
})(cpStageList);

/* ---------- шестерёнка: папки каталога и что они значат ---------- */

function cpCatRender() {
  var box = document.getElementById('cpCatBox');
  var settings = document.getElementById('cpSettings');
  var cat = cpCatalog();
  if (settings) settings.classList.toggle('cp-cat', !!(cat && CP.catalogList));
  var sd = document.getElementById('cpSetServiceDir');
  if (sd) {
    sd.textContent = CPDisk.showPath(CP_CONFIG.serviceDir);
    if (sd.nextSibling && sd.nextSibling.nodeType === 3) sd.nextSibling.textContent = cat ? ' — внутри каталога' : ' — рядом с архивом';
  }
  var miss = cat && CP.catalogList ? cpCatMissing() : [];
  cpCatNotice(miss);
  if (!box) return;
  if (!cat || !CP.catalogList) {
    box.innerHTML = '<div class="cp-set-dir">Укажите выше папку, где лежат все этапы (01_ИСХОДНИКИ, 02…, 05_САЙТ), — программа прочитает их сама</div>';
    return;
  }
  var opts = CP_CAT_ROLES.map(function (r) { return r.word; }).concat([CP_CAT_SKIP_WORD]);
  var html = CP.catalogList.map(function (d) {
    var role = cpCatRoleOf(d.name);
    var cur = role === 'skip' ? CP_CAT_SKIP_WORD : CP_CAT_ROLES.filter(function (r) { return r.role === role; })[0].word;
    return '<div class="cp-cat-row"><span class="cp-cat-name">' + cbEsc(d.name) + '</span><select data-cp-cat="' + cbEsc(d.name) + '">'
      + opts.map(function (w) { return '<option' + (w === cur ? ' selected' : '') + '>' + cbEsc(w) + '</option>'; }).join('') + '</select></div>';
  }).join('');
  if (miss.length) {
    html += '<div class="cp-set-dir">Нет папок для: ' + miss.map(function (r) { return cbEsc(r.word) + ' (' + cbEsc(r.def) + ')'; }).join(', ')
      + '</div><div class="cp-set-line"><button data-cp-cat-make="1">Создать недостающие</button></div>';
  }
  box.innerHTML = html;
}

/** Строка на витрине: каких этапов в каталоге нет. */
function cpCatNotice(miss) {
  var el = document.getElementById('cpCatMissing');
  if (!miss.length) { if (el) el.remove(); return; }
  if (!el) {
    var bar = document.getElementById('cpShelfBar');
    if (!bar) return;
    el = document.createElement('span');
    el.id = 'cpCatMissing';
    el.className = 'cp-cat-miss';
    bar.appendChild(el);
    el.addEventListener('click', function (e) { if (e.target.closest('[data-cp-cat-make]')) cpCatMake(); });
  }
  el.innerHTML = 'В каталоге нет: ' + miss.map(function (r) { return cbEsc(r.def); }).join(', ') + ' <button class="cp-link" data-cp-cat-make="1">Создать</button>';
}

function cpCatMake() {
  var cat = cpCatalog();
  if (!cat) return;
  var miss = cpCatMissing();
  if (!miss.length) return;
  var made = [];
  miss.reduce(function (p, r) {
    return p.then(function () { return CPDisk.ensureDir(cat + '/' + r.def).then(function () { made.push(r.def); }); });
  }, Promise.resolve()).then(function () {
    cbToast('Созданы папки: ' + made.join(', '));
    return cpLoadShoots();
  }).catch(function (e) { cpHandleError(e, 'Не удалось создать папки этапов'); });
}

(function cpCatSettingsDom() {
  var box = document.getElementById('cpSettings');
  var arch = document.getElementById('cpSetArchive');
  if (!box || !arch) return;
  var h = arch.previousElementSibling;
  if (h && h.tagName === 'H5') h.textContent = 'Папка съёмок (КАТАЛОГ со всеми этапами)';
  arch.insertAdjacentHTML('afterend', '<h5>Папки каталога — что показывать</h5><div id="cpCatBox"></div>');
  /* отдельные папки этапов в каталоге не нужны — берутся из него */
  ['cpRetouchInput', 'cpSet_approve', 'cpSet_retouched', 'cpSiteInput'].forEach(function (id) {
    var inp = document.getElementById(id);
    var line = inp && inp.closest('.cp-set-line');
    if (!line) return;
    line.classList.add('cp-stage-row');
    if (line.previousElementSibling && line.previousElementSibling.tagName === 'H5') line.previousElementSibling.classList.add('cp-stage-row');
  });
  box.addEventListener('change', function (e) {
    var sel = e.target.closest('[data-cp-cat]');
    if (!sel) return;
    var name = sel.getAttribute('data-cp-cat');
    sel.disabled = true;
    cpSaveSetting('этап ' + name, sel.value).then(function () {
      cbToast(name + ': ' + sel.value);
      return cpLoadShoots();
    }).catch(function (err) { cpHandleError(err, 'Не удалось сохранить настройку'); }).then(function () { sel.disabled = false; });
  });
  box.addEventListener('click', function (e) { if (e.target.closest('[data-cp-cat-make]')) cpCatMake(); });

  /* «Сохранить» у папки съёмок: сначала смотрим, каталог ли это */
  var btn = document.getElementById('cpArchiveApply');
  var applyOrig = btn && btn.onclick;
  if (!btn || !applyOrig) return;
  btn.onclick = function () {
    var self = this;
    var v = cpNormArchive(document.getElementById('cpArchiveInput').value);
    if (!v) return;
    btn.disabled = true;
    CPDisk.listDir(v).then(function (items) {
      var isCat = items.some(function (x) { var m = x.type === 'dir' && CP_CAT_RE.exec(x.name); return m && /^0[1-5]$/.test(m[1]); });
      cpSet('cp_catalog', isCat ? v.replace(/\/+$/, '') : '');
    }, function () { cpSet('cp_catalog', ''); }).then(function () {
      btn.disabled = false;
      applyOrig.call(self);
    });
  };
})();

(function cpCatCss() {
  var st = document.createElement('style');
  st.textContent = '#cpSettings.cp-cat .cp-stage-row{display:none}'
    + '.cp-cat-row{display:flex;align-items:center;gap:8px;margin:3px 0}.cp-cat-name{flex:1;font-size:12px}'
    + '.cp-cat-row select{background:#1d1d1b;color:inherit;border:1px solid #3a3a37;border-radius:4px;font:inherit;font-size:12px;padding:2px 4px}'
    + '.cp-cat-miss{font-size:12px;color:#d9a441}';
  document.head.appendChild(st);
})();
