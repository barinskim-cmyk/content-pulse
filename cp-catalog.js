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
   - Недостающие папки этапов создаются, а папки с номером не по порядку
     переименовываются (04_САЙТ → 05_САЙТ) — только кнопкой «Исправить»,
     с подтверждением.
   ============================================================ */

var CP_CAT_ROLES = [
  { role: 'source', word: 'исходники', setting: '', def: '01_ИСХОДНИКИ' },
  { role: 'approval', word: 'согласование', setting: 'approve', def: '02_ОТБОР' },
  { role: 'retouch', word: 'ретушь', setting: 'retouch', def: '03_РЕТУШЬ' },
  { role: 'review', word: 'отретушировано', setting: 'retouched', def: '04_ОТРЕТУШИРОВАНО' },
  { role: 'site', word: 'сайт', setting: 'site', def: '05_САЙТ' }
];
/* 00_АРХИВ — не этап, а место для закрытых съёмок и брака (Маша, 09.11): в фильтры
   витрины не входит, но «Исправить папки» его создаёт, а брак и «В архив» пишут в него */
var CP_CAT_ARCHIVE = { role: 'archive', word: 'архив', setting: 'archive', def: '00_АРХИВ' };
function cpCatRoleDef(role) { return CP_CAT_ROLES.concat([CP_CAT_ARCHIVE]).filter(function (r) { return r.role === role || r.setting === role; })[0] || null; }
var CP_CAT_SKIP_WORD = 'не показывать';
var CP_CAT_NUM = { '00': 'archive', '01': 'source', '02': 'approval', '03': 'retouch', '04': 'review', '05': 'site' };
/* по смыслу имени — раньше номера: у SK «04_САЙТ» — это сайт, а не 04-й этап по умолчанию.
   Маша, 06.11: «в исходниках показывает всё, что лежит в архиве, а должен только исходники» —
   архив (00_АРХИВ) не читаем; включить можно в шестерёнке. */
var CP_CAT_WORDS = [
  [/архив/i, 'archive'], [/исходн/i, 'source'], [/отретуш|проверк/i, 'review'], [/ретуш/i, 'retouch'],
  [/сайт|site/i, 'site'], [/отбор|соглас/i, 'approval']
];
var CP_CAT_RE = /^(\d{2})[_ .\-]/;
CP.catalogList = null;   /* папки открытого каталога: [{name, path}] */

/** Путь каталога, если открыт каталог; иначе ''. */
/** Папка похожа на каталог: внутри есть папки этапов с номерами 01–05. */
function cpCatLike(items) {
  return (items || []).some(function (x) { var m = x.type === 'dir' && CP_CAT_RE.exec(x.name); return m && /^0[1-5]$/.test(m[1]); });
}

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
  CP_CAT_ROLES.concat([CP_CAT_ARCHIVE]).forEach(function (r) {
    if (!r.setting) return;
    var d = cpCatDirs(r.role, settings)[0];
    if (d) settings[r.setting] = d.path;
    else delete settings[r.setting];
  });
  settings.catalog = cpCatalog();
  return settings;
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
      var r = CP_CAT_ROLES.concat([CP_CAT_ARCHIVE]).filter(function (x) { return x.word === w; })[0];
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
    if (cat && cat !== cpGet('cp_catalog', '')) {
      /* каталог ли это — смотрим всегда, а не только по «Сохранить» в шестерёнке (Маша, 09.11: открыла
         в другом браузере — фильтры снова «Архив / Отбор / Согласование…», как в старой версии) */
      return CPDisk.listDir(cat).then(function (items) {
        if (cpCatLike(items)) {
          cpSet('cp_catalog', cat);
          var sd = cpServiceDirFor(cat);
          if (sd !== CP_CONFIG.serviceDir) { CP_CONFIG.serviceDir = sd; if (typeof cpServiceReset === 'function') cpServiceReset(); }
          return CPDisk.listShoots(archive);
        }
        CP.catalogList = null;
        cpCatRender();
        /* обычный архив: те же папки, что дал бы listOrig, без второго запроса */
        return items.filter(function (r) { return r.type === 'dir' && r.name.charAt(0) !== '_'; })
          .sort(function (a, b) { return a.modified < b.modified ? 1 : -1; });
      });
    }
    if (!cat) { CP.catalogList = null; cpCatRender(); return listOrig(archive); }
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

/* ---------- нет папки этапа — сказать, а не уходить в старую схему ----------
   Разбор кода 09.11.2026, пункт 3. Раньше без папки этапа в каталоге молча
   включались старые пути: ретушь — в <съёмка>/Ретушь, сдача — в
   <съёмка>/_приёмка, «Согласовать ретушь» — копией в «Сайт/дата/буква_номер».
   Теперь в каталоге каждое действие этапа проверяет его папку: нет — тост
   «создайте её: Исправить папки» и ничего не делается. Обычный архив (не
   каталог) работает по-старому — для него эти пути и задуманы. */
var CP_CAT_STAGE_ACTION = { approve: 'на согласование', retouch: 'на ретушь', retouched: 'сдача и проверка ретуши', site: 'на сайт', archive: 'брак и закрытые съёмки' };

/** true — каталог открыт, а папки этапа нет (тост уже показан, действие делать нельзя). */
function cpCatStageMissing(setting) {
  if (!cpCatalog() || (CP.settings || {})[setting]) return false;
  var role = cpCatRoleDef(setting);
  cbToast(!CP.catalogList
    ? 'Каталог ещё не прочитан — вернитесь на витрину и повторите. Ничего не сделано.'
    : 'В каталоге нет папки этапа «' + (role ? role.def : setting) + '» (' + (CP_CAT_STAGE_ACTION[setting] || '')
      + '). Создайте её: «Исправить папки» на витрине. Ничего не сделано.');
  return true;
}

/* ретушь: в каталоге — только в его папку ретуши; нет её — ошибка, а не <съёмка>/Ретушь */
cpRetouchBase = (function (orig) {
  return function (shootPath, shootName) {
    if (cpCatalog()) {
      var r = (CP.settings || {}).retouch;
      if (!r) throw new Error('в каталоге нет папки ретуши (03) — «Исправить папки» на витрине');
      return r + '/' + shootName;   /* как в cp-app.js: путь тот же, что ищет сверка */
    }
    return orig.apply(this, arguments);
  };
})(cpRetouchBase);

/* окно «Сдать»: в каталоге без 04 не открываем (иначе — старая приёмка в <съёмка>/_приёмка) */
cpAcceptOpen = (function (orig) {
  return function () {
    if (cpCatStageMissing('retouched')) return;
    return orig.apply(this, arguments);
  };
})(cpAcceptOpen);

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

/* ---------- под съёмкой: где сейчас её артикулы (по папкам этапов) ----------
   Маша, 06.11: «когда мы открываем исходники, наши статусы съёмок — это то,
   куда ещё скопированы какие-то артикулы отсюда, где они ещё находятся».
   Считаем по самим папкам: в папке съёмки на этапе — папки артикулов (код в
   начале имени; буква ретушёра «Y_74595_…» — значит забрали). Нет папок
   артикулов, а файлы есть — «есть». Отбор и брак — из отбора программы. */

CP.stageArts = {};   /* этап -> {имя съёмки: {код: буква|''} | null — папки артикулов не нашлись} */
var _cpArtsRun = 0;

function cpCountStageArts() {
  var run = ++_cpArtsRun, archive = CP.archive;
  if (!cpCatalog() || !CP.stagePaths) return Promise.resolve();
  var known = {};
  (CP.shoots || []).forEach(function (d) { known[d.name.toLowerCase()] = d.name; });
  var letters = typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
  var jobs = [];
  Object.keys(CP.stagePaths).forEach(function (key) {
    var w = CP.stagePaths[key] || {};
    Object.keys(w).forEach(function (low) { if (known[low]) jobs.push({ key: key, low: low, name: known[low], paths: w[low] }); });
  });
  var fresh = {};
  return cpPool(jobs, 4, function (j) {
    var type = typeof cpShootType === 'function' ? cpShootType(j.name) : null;
    var re = (type && type.codeRe) || /^(\d{4,7})(?!\d)/;
    var codes = {}, found = false;
    function walk(paths, depth) {
      if (!paths.length || depth > 4) return Promise.resolve();
      return cpPool(paths, 4, function (p) { return cpListDirs(p); }).then(function (lists) {
        var next = [];
        lists.forEach(function (ds) {
          (ds || []).forEach(function (x) {
            if (x.name.charAt(0) === '_') return;
            var name = x.name.replace(/^(!|\d{1,2})_(?=\D)/, ''), letter = '';
            var lm = /^([A-Za-zА-Яа-яЁё]{1,3})_(.+)$/.exec(name);
            if (lm && letters.indexOf(lm[1]) !== -1) { letter = lm[1]; name = lm[2]; }
            var m = re.exec(name);
            if (m) { found = true; codes[m[1]] = codes[m[1]] || letter; }
            else next.push(x.path);
          });
        });
        return walk(next, depth + 1);
      });
    }
    return walk(j.paths, 1).then(function () {
      (fresh[j.key] = fresh[j.key] || {})[j.low] = found ? codes : null;
    }, function () { });
  }).then(function () {
    if (run !== _cpArtsRun || CP.archive !== archive) return;
    CP.stageArts = fresh;
    CP.stageArtsFor = archive;
    cpRenderShoots();
  });
}

/** Где лежат артикулы съёмки: [{key, label, n (-1 — есть, но без папок артикулов), took}] или null. */
function cpArtPhys(d) {
  if (!cpCatalog() || CP.stageArtsFor !== CP.archive) return null;
  var low = d.name.toLowerCase(), out = [];
  ['approval', 'retouch', 'review', 'site'].forEach(function (key) {
    if (!(CP.settings && CP.settings[CP_STAGE_SETTING[key]])) return;
    var pres = CP.stagePresence[key] && CP.stagePresence[key][low];
    /* «Сайт» читается за последние 7 дней: что сдано раньше, берём из сводки отбора (отметки программы) */
    var sum = key === 'site' && typeof cpSumOf === 'function' ? cpSumOf(d) : null;
    var byMarks = sum && sum.k ? (sum.k[5] || 0) : 0;
    if (!pres) {
      if (byMarks) out.push({ key: key, label: cpStageLabel(key), n: byMarks, took: 0, marks: true });
      return;
    }
    var c = (CP.stageArts[key] || {})[low];
    var codes = c ? Object.keys(c) : [];
    var n = c ? codes.length : -1;
    if (n >= 0 && byMarks > n) n = byMarks;
    out.push({ key: key, label: cpStageLabel(key), n: n, took: c ? codes.filter(function (k) { return c[k]; }).length : 0 });
  });
  return out;
}

var CP_PHYS_CLS = { approval: 'k2', retouch: 'k3', review: 'k7', site: 'k5' };

function cpArtBarPhys(sum, phys) {
  var n = sum ? sum.k.reduce(function (a, b) { return a + b; }, 0) : 0;
  var placed = phys.reduce(function (a, x) { return a + Math.max(0, x.n); }, 0);
  var brak = sum ? sum.k[6] : 0;
  var line = '';
  if (n || placed) {
    var rest = Math.max(0, n - placed - brak);
    line = '<div class="cp-artbar-line">' + (rest ? '<i class="cp-k1" style="flex:' + rest + '" title="только в исходниках: ' + rest + '"></i>' : '')
      + phys.map(function (x) { return x.n > 0 ? '<i class="cp-' + CP_PHYS_CLS[x.key] + '" style="flex:' + x.n + '" title="' + cbEsc(x.label) + ': ' + x.n + '"></i>' : ''; }).join('')
      + (brak ? '<i class="cp-k6" style="flex:' + brak + '" title="брак: ' + brak + '"></i>' : '') + '</div>';
  }
  var leg = [];
  if (n) leg.push('артикулов ' + n);
  if (sum && sum.filled) leg.push('<span><i class="cp-k1"></i>отобрано <b>' + sum.filled + '</b></span>');
  if (sum && sum.empty) leg.push('<span class="cp-warn" title="Карточка заведена по папке артикула, но кадров JPG в папке нет (пустая, только видео или другой формат). Откройте съёмку — такая карточка помечена «нет кадров».">пустых карточек <b>' + sum.empty + '</b></span>');
  phys.forEach(function (x) {
    leg.push('<span><i class="cp-' + CP_PHYS_CLS[x.key] + '"></i>' + cbEsc(x.label) + ' <b>' + (x.n < 0 ? 'есть' : x.n) + '</b>' + (x.took ? ' (забрали ' + x.took + ')' : '') + '</span>');
  });
  if (brak) leg.push('<span><i class="cp-k6"></i>брак <b>' + brak + '</b></span>');
  if (!leg.length) return '';
  return '<div class="cp-artbar">' + line + '<div class="cp-artbar-leg">' + leg.join(' · ') + '</div></div>';
}

/* В каталоге фильтр этапа — только то, что лежит в его папке сейчас (не отметки программы):
   удалили папку с Диска — съёмка из фильтра пропадает. */
cpStagesFor = (function (orig) {
  return function (d) {
    var st = orig.apply(this, arguments);
    if (!cpCatalog() || !st) return st;
    var low = d.name.toLowerCase();
    Object.keys(CP_STAGE_SETTING).forEach(function (key) {
      st[key] = !!(CP.settings && CP.settings[CP_STAGE_SETTING[key]] && CP.stagePresence[key] && CP.stagePresence[key][low]);
    });
    return st;
  };
})(cpStagesFor);

/* Витрина сама сверяется с Диском: раз в 45 секунд и когда вернулись на вкладку —
   что добавили или удалили другие, видно без «Обновить» (Маша, 06.11). */
CP.stageScanAt = 0;
cpScanStages = (function (orig) {
  return function () { CP.stageScanAt = Date.now(); return orig.apply(this, arguments); };
})(cpScanStages);
function cpShelfLive() {
  var shelf = document.getElementById('cpShelf');
  return cpCatalog() && CP.shoots && shelf && shelf.classList.contains('cp-open') && document.visibilityState !== 'hidden';
}
setInterval(function () { if (cpShelfLive() && Date.now() - CP.stageScanAt > 40000) cpScanStages(); }, 15000);
document.addEventListener('visibilitychange', function () { if (cpShelfLive() && Date.now() - CP.stageScanAt > 8000) cpScanStages(); });

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
  var plan = cat && CP.catalogList ? cpCatPlan() : { create: [], rename: [] };
  cpCatNotice(plan);
  if (!box) return;
  if (!cat || !CP.catalogList) {
    box.innerHTML = '<div class="cp-set-dir">Укажите выше папку, где лежат все этапы (01_ИСХОДНИКИ, 02…, 05_САЙТ), — программа прочитает их сама</div>';
    return;
  }
  var opts = CP_CAT_ROLES.concat([CP_CAT_ARCHIVE]).map(function (r) { return r.word; }).concat([CP_CAT_SKIP_WORD]);
  var html = CP.catalogList.map(function (d) {
    var role = cpCatRoleOf(d.name);
    var cur = role === 'skip' ? CP_CAT_SKIP_WORD : cpCatRoleDef(role).word;
    return '<div class="cp-cat-row"><span class="cp-cat-name">' + cbEsc(d.name) + '</span><select data-cp-cat="' + cbEsc(d.name) + '">'
      + opts.map(function (w) { return '<option' + (w === cur ? ' selected' : '') + '>' + cbEsc(w) + '</option>'; }).join('') + '</select></div>';
  }).join('');
  if (plan.create.length || plan.rename.length) {
    html += '<div class="cp-set-dir">' + cpCatPlanText(plan) + '</div><div class="cp-set-line"><button data-cp-cat-make="1">Исправить папки</button></div>';
  }
  box.innerHTML = html;
}

/**
 * Порядок этапов: каких папок нет и у каких неверный номер.
 * Маша, 06.11: «если какой-то этап пропущен, мы его создаём, но при этом
 * следующий нужно переименовать, чтобы он был не 04, а 05».
 * Номер — место роли в цепочке: 01 исходники, 02 согласование (отбор),
 * 03 ретушь, 04 отретушировано, 05 сайт. Папки без номера и «не показывать»
 * не трогаем. Если папка с нужным именем уже есть — не переименовываем.
 * -> {create:[{role, name}], rename:[{dir, to, role}]}
 */
function cpCatPlan() {
  var plan = { create: [], rename: [] };
  if (!CP.catalogList) return plan;
  var taken = {};
  CP.catalogList.forEach(function (d) { taken[d.name.toLowerCase()] = true; });
  CP_CAT_ROLES.forEach(function (r, i) {
    var num = (i + 1 < 10 ? '0' : '') + (i + 1);
    var d = cpCatDirs(r.role)[0];
    if (!d) { if (!taken[r.def.toLowerCase()]) plan.create.push({ role: r, name: r.def }); return; }
    var m = CP_CAT_RE.exec(d.name);
    if (!m || m[1] === num) return;
    var to = num + d.name.slice(2);
    if (taken[to.toLowerCase()]) return;
    plan.rename.push({ dir: d, to: to, role: r });
  });
  if (!cpCatDirs('archive').length && !taken[CP_CAT_ARCHIVE.def.toLowerCase()]) plan.create.push({ role: CP_CAT_ARCHIVE, name: CP_CAT_ARCHIVE.def });
  return plan;
}

function cpCatPlanText(plan) {
  var parts = [];
  if (plan.create.length) parts.push('нет: ' + plan.create.map(function (c) { return cbEsc(c.name); }).join(', '));
  if (plan.rename.length) parts.push('номер не по порядку: ' + plan.rename.map(function (x) { return cbEsc(x.dir.name) + ' → ' + cbEsc(x.to); }).join(', '));
  return 'В каталоге ' + parts.join('; ');
}

/** Строка на витрине: каких этапов нет, какие не по порядку. */
function cpCatNotice(plan) {
  var el = document.getElementById('cpCatMissing');
  if (!plan.create.length && !plan.rename.length) { if (el) el.remove(); return; }
  if (!el) {
    var bar = document.getElementById('cpShelfBar');
    if (!bar) return;
    el = document.createElement('span');
    el.id = 'cpCatMissing';
    el.className = 'cp-cat-miss';
    bar.appendChild(el);
    el.addEventListener('click', function (e) { if (e.target.closest('[data-cp-cat-make]')) cpCatMake(); });
  }
  el.innerHTML = cpCatPlanText(plan) + ' <button class="cp-link" data-cp-cat-make="1">Исправить</button>';
}

/** Создать недостающие папки этапов и переименовать те, что с неверным номером. */
function cpCatMake() {
  var cat = cpCatalog();
  if (!cat) return;
  var plan = cpCatPlan();
  if (!plan.create.length && !plan.rename.length) return;
  var lines = plan.rename.map(function (x) { return 'переименовать ' + x.dir.name + ' → ' + x.to; })
    .concat(plan.create.map(function (c) { return 'создать ' + c.name; }));
  if (!window.confirm('Папки каталога:\n' + lines.join('\n') + '\n\nВсё, что лежит внутри, остаётся на месте. Продолжить?')) return;
  var done = [], failed = [];
  var renames = plan.rename.slice().sort(function (a, b) { return a.to < b.to ? 1 : -1; });   /* с конца — не наступаем друг на друга */
  var cfg = (CP.settings && CP.settings.stageRoles) || {};
  cbBusyShow('Привожу папки каталога в порядок...', 0.3);
  var chain = renames.reduce(function (p, x) {
    return p.then(function () {
      return CPDisk.proxyMove([{ from: x.dir.path, path: cat + '/' + x.to }]).then(function (r) {
        var st = r && r.results && r.results[0];
        if (st && st.status === 'done') {
          done.push(x.dir.name + ' → ' + x.to);
          /* в настройках папка была записана по старому имени — переносим строку */
          if (cfg[x.dir.name.toLowerCase()]) return cpSaveSetting('этап ' + x.to, x.role.word);
        } else failed.push(x.dir.name + ': ' + ((st && (st.error || st.status)) || 'не переименована'));
      });
    });
  }, Promise.resolve());
  chain.then(function () {
    return plan.create.reduce(function (p, c) {
      return p.then(function () { return CPDisk.ensureDir(cat + '/' + c.name).then(function () { done.push('создана ' + c.name); }); });
    }, Promise.resolve());
  }).then(function () {
    cbBusyHide();
    if (window.console) console.info('[CP] папки каталога:', done, failed);
    cbToast((done.length ? 'Готово: ' + done.join(', ') : '') + (failed.length ? (done.length ? '. ' : '') + 'Не получилось: ' + failed.join(', ') : ''));
    return cpLoadShoots();
  }).catch(function (e) { cbBusyHide(); cpHandleError(e, 'Не удалось привести папки каталога в порядок'); });
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
      cpSet('cp_catalog', cpCatLike(items) ? v.replace(/\/+$/, '') : '');
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
