/* ============================================================
   cp-stages.js — витрина: что нужно сделать со съёмкой (06.11.2026)

   Маша: «важно сейчас сделать фильтр отбор / ретушь / согласование,
   чтобы можно было фильтровать съёмки по принципу того, что нужно
   сделать с ними — или с их частью; имеется в виду на витрине».

   Сводка съёмки — одна строка в свойствах её папки на Диске
   (custom_properties.cp_sum, пишет прослойка). Витрина получает её тем
   же запросом, что и список съёмок, — без чтения каждого отбора.
   Пишется после каждого сохранения отбора (если поменялась). У съёмок
   без сводки витрина в фоне читает отбор сама, считает и записывает —
   один раз, дальше сводка уже лежит в папке.

   Стадии артикула (Маша, 06.11: «отбор — это когда артикулы в папке есть,
   а карточки не собраны и на согласование не отправлены; всё, что до
   согласования, — отбор»; «скачано, загружено»):
     отбор        — артикул есть в папках съёмки, а карточки нет, или
                    карточка есть, но не отправлена дальше;
     согласование — карточка на согласовании;
     ретушь       — отправлена на ретушь, ретушёр ещё не забрал все кадры;
     забрали      — у карточки появился ретушёр (буква); вместо
                    «скачано», которое временно не показываем;
     проверка     — ретушь сдана на приёмку, ждёт согласования
                    (на доработке — снова «ретушь»);
     загружено    — согласовано и лежит в «Сайте» (или нашлось там при
                    проверке сдачи);
     брак         — карточка в браке (пересъём).
   Артикулы — папки артикулов по «Структуре съёмок» и карточки товара
   (по коду); у артикула с несколькими карточками — самая дальняя стадия.
   В съёмках без папок артикулов (имидж) артикул — карточка с кадрами.

   Фильтры в шапке (съёмка попадает во все подходящие):
     Отбор — есть артикулы в отборе (или отбора нет совсем);
     Согласование — есть карточки или кадры на согласовании;
     Ретушь — есть карточки на ретуши, которые ещё никто не забрал;
     Проверка — есть сданная ретушь, которую ещё не согласовали;
     Не начаты — ни одной карточки с кадрами; Сданы — все артикулы
     загружены (или в браке); В работе — остальные.
   ============================================================ */

var CP_SUM_KEY = 'cp_sum';
CP.sumWritten = {};       /* путь съёмки -> последняя записанная строка сводки */
CP.stageFilter = cpGet('cp_stage', '') || '';

/** Коды артикулов по папкам съёмки (как у карточек товара по папкам, cp-rules.js). */
function cpArticleCodes(shootPath, shootName, files) {
  var codes = {};
  var type = typeof cpShootType === 'function' ? cpShootType(shootName) : null;
  if (!type || !files || type.roles.indexOf('артикул') === -1) return codes;
  var root = shootPath.replace(/\/+$/, '') + '/';
  var rel = function (p) { return p.indexOf(root) === 0 ? p.slice(root.length) : ''; };
  (files.dirs || []).forEach(function (d) {
    var r = rel(d);
    if (!r) return;
    var f = cpFacets(type, r + '/x');
    if (f.code && f.articlePath === r) codes[f.code] = true;
  });
  files.forEach(function (f) {
    var x = cpFacets(type, rel(f.path));
    if (x.code && x.articlePath) codes[x.code] = true;
  });
  return codes;
}

/**
 * Сводка съёмки. data — отбор (может быть null: отбора нет),
 * codes — коды артикулов по папкам ({} — неизвестно или их нет).
 */
function cpShootSummary(data, codes) {
  data = data || {};
  codes = codes || {};
  var letters = typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
  var hasLetter = function (c) { return (c.tags || []).some(function (t) { return letters.indexOf(t) !== -1; }); };
  var cp = (data.meta || {}).cp || {};
  var status = cp.status || {}, cardStatus = cp.cardStatus || {}, dl = cp.downloads || {}, del = cp.delivered || {}, rv = cp.rv || {};
  var s = { cards: 0, filled: 0, empty: 0, rt: 0, ra: 0, ap: 0, rs: 0, del: Object.keys(del).length, rc: 0, rv: 0, k: [0, 0, 0, 0, 0, 0, 0] };
  Object.keys(rv).forEach(function (id) { var l = rv[id] || []; if (l.length && l[l.length - 1].status === 'review') s.rv++; });
  var cards = data.cards || [];
  var pidsOf = function (c) { return c.mode === 'auto' ? (c.pids || []) : (c.slots || []).map(function (x) { return x.pid; }).filter(Boolean); };
  var stageOf = function (c) {
    var ps = pidsOf(c), cs = cardStatus[c.id] && cardStatus[c.id].s;
    var vl = rv[c.id] || [], last = vl[vl.length - 1];
    if (cs === 'reshoot') return 6;
    if (del[c.id]) return 5;
    if (last && last.status === 'review') return 4;
    if (last && last.status === 'rework') return 2;
    if (hasLetter(c)) return 3;
    if (cs === 'retouch') return 2;
    if (cs === 'approval') return 1;
    return 0;
  };
  /* артикулы: папки + карточки товара по коду; стадия — самая дальняя из его карточек */
  var art = {};
  Object.keys(codes).forEach(function (code) { art[code] = 0; });
  var product = cards.filter(function (c) { return c.cpArticle || c.cpAuto; });
  if (product.length || Object.keys(codes).length) {
    product.forEach(function (c) {
      var code = c.cpArticle || c.title || c.id;
      art[code] = Math.max(art[code] || 0, stageOf(c));
    });
    Object.keys(art).forEach(function (code) { s.k[art[code]]++; });
  } else {
    cards.forEach(function (c) { if (pidsOf(c).length) s.k[stageOf(c)]++; });
  }
  cards.forEach(function (c) {
    s.cards++;
    var pids = pidsOf(c);
    if (pids.length) s.filled++;
    else if (c.cpArticle || c.cpAuto) s.empty++;
    if (cardStatus[c.id] && cardStatus[c.id].s === 'approval') s.ap++;
    if (pids.length && cardStatus[c.id] && cardStatus[c.id].s === 'retouch') s.rc++;
  });
  Object.keys(status).forEach(function (pid) {
    var st = status[pid].s;
    if (st === 'retouch') { s.ra++; if (!(dl[pid] && dl[pid].n)) s.rt++; }
    else if (st === 'reshoot') s.rs++;
    else if (st === 'approval' && !s.ap) s.ap = -1;   /* кадры на согласовании без карточки */
  });
  if (s.ap < 0) s.ap = 1;
  return s;
}

function cpSumEncode(s) {
  return 'v5;n=' + s.cards + ';f=' + s.filled + ';e=' + s.empty + ';rt=' + s.rt + ';ra=' + s.ra + ';ap=' + s.ap + ';rs=' + s.rs + ';d=' + s.del + ';rc=' + s.rc + ';rv=' + s.rv + ';k=' + s.k.join(',');
}

/* старые версии сводки (без стадий артикулов по папкам) не берём — пересчитываются в фоне */
function cpSumDecode(str) {
  if (!str || !/^v5;/.test(str)) return null;
  var m = {}, k = [0, 0, 0, 0, 0, 0, 0];
  str.split(';').slice(1).forEach(function (kv) {
    var p = kv.split('=');
    if (p[0] === 'k') k = p[1].split(',').map(function (x) { return +x || 0; });
    else m[p[0]] = +p[1] || 0;
  });
  return { cards: m.n || 0, filled: m.f || 0, empty: m.e || 0, rt: m.rt || 0, ra: m.ra || 0, ap: m.ap || 0, rs: m.rs || 0, del: m.d || 0, rc: m.rc || 0, rv: m.rv || 0, k: k };
}

/** Что нужно сделать со съёмкой (для фильтров). */
function cpStagesOf(sum) {
  if (!sum) return null;
  return {
    select: sum.k[0] > 0 || sum.filled === 0,
    approval: sum.ap > 0,
    retouch: sum.k[2] + sum.k[3] > 0,
    review: sum.rv > 0,
    site: sum.k[5] > 0
  };
}

/* ---------- запись сводки после сохранения отбора ---------- */

/** Записать сводку; папки съёмки берутся из обхода (он кэшируется на 5 минут). */
function cpWriteSummary(shootPath, data, force, shootName) {
  if (!CPDisk.hasProxy()) return Promise.resolve();
  var name = shootName || shootPath.split('/').pop();
  return cpWalk(shootPath).then(function (files) { return files; }, function () { return null; }).then(function (files) {
    var str = cpSumEncode(cpShootSummary(data, cpArticleCodes(shootPath, name, files)));
    if (!force && CP.sumWritten[shootPath] === str) return;
    return CPDisk.proxyProps(shootPath, { cp_sum: str }).then(function () {
      CP.sumWritten[shootPath] = str;
      /* витрина уже загружена — обновляем строку этой съёмки */
      (CP.shoots || []).forEach(function (d) {
        if (d.path === shootPath) { d.custom_properties = d.custom_properties || {}; d.custom_properties.cp_sum = str; }
      });
    }, function (e) {
      if (window.console) console.warn('[CP] сводка съёмки не записалась', shootPath, e && (e.body || e.message));
    });
  });
}

CPDisk.writeState = (function (orig) {
  return function (shoot, data, rev) {
    return orig.apply(this, arguments).then(function (r) {
      cpWriteSummary(String(shoot).replace(/\/+$/, ''), data);
      return r;
    });
  };
})(CPDisk.writeState);

/* ---------- витрина: фильтр и строка «что нужно сделать» ---------- */

function cpSumOf(d) {
  return cpSumDecode(d.custom_properties && d.custom_properties[CP_SUM_KEY]) || d.cpSum || null;
}

/* ---------- фильтры витрины = этапы = папки на Диске ----------
   Маша, 06.11.2026: «название фильтра совпадает с названием папки на
   Диске… наш фильтр — это папка… есть съёмки активные, которые ждут
   чего-то; их нейминг появляется на соответствующем этапе». Фильтры:
     <папка архива> (01_ИСХОДНИКИ) — все съёмки;
     Отбор — промежуточный этап внутри исходников (по сводке отбора);
     <папка согласования> (02_…), <ретуши> (03_…), <проверки> (04_…),
     <сайта> (05_…) — съёмки, у которых папка есть в этой папке этапа
     (очерёдность «!_», «1_» в начале имени не мешает; в «Сайте» съёмка
     может лежать глубже: дата / буква_номер / съёмка).
   Папка этапа не задана — фильтр по сводке отбора, с обычным названием. */

CP.stagePresence = {};   /* ключ этапа -> {имя съёмки в нижнем регистре: true} */

var CP_STAGE_SETTING = { approval: 'approve', retouch: 'retouch', review: 'retouched', site: 'site' };
var CP_STAGE_DEFAULT = { approval: 'Согласование', retouch: 'Ретушь', review: 'Проверка ретуши', site: 'Сайт' };

function cpFolderBase(path) { return path ? String(path).replace(/\/+$/, '').split('/').pop() : ''; }
function cpStageLabel(key) { return cpFolderBase(CP.settings && CP.settings[CP_STAGE_SETTING[key]]) || CP_STAGE_DEFAULT[key]; }

/** Папка даты в «Сайте» старше окна опроса (cp-site.js: CP.siteRecentDays, 7 дней). Не дата — не старая. */
function cpSiteTooOld(name) {
  if (typeof cpSiteDateName !== 'function' || typeof cpSiteRecentFrom !== 'function') return false;
  var d = cpSiteDateName(name);
  return !!d && d < cpSiteRecentFrom();
}

/** Какие съёмки лежат в папках этапов: по одному обходу на этап (до 3 уровней). */
function cpScanStages() {
  var s = CP.settings || {}, archive = CP.archive;
  var known = {};
  (CP.shoots || []).forEach(function (d) { known[d.name.toLowerCase()] = true; });
  var shootLike = /^\d{4}-\d{2}-\d{2}_./;
  return Promise.all(Object.keys(CP_STAGE_SETTING).map(function (key) {
    var root = s[CP_STAGE_SETTING[key]];
    if (!root) return Promise.resolve([key, null]);
    var names = {}, where = {}, info = {};
    var level = function (paths, depth) {
      if (!paths.length || depth > 3) return Promise.resolve();
      return cpPool(paths, 4, function (p) { return cpListDirs(p); }).then(function (lists) {
        var next = [];
        lists.forEach(function (ds) {
          (ds || []).forEach(function (x) {
            var bare = x.name.replace(/^(!|\d{1,2})_/, '');
            if (known[bare.toLowerCase()] || shootLike.test(bare)) {
              names[bare.toLowerCase()] = true;
              (where[bare.toLowerCase()] = where[bare.toLowerCase()] || []).push(x.path);
              info[x.path] = { props: x.custom_properties || {}, modified: x.modified || '' };   /* метки папки (скачано из «Сайта» и т. п.) */
            }
            else if (x.name.charAt(0) !== '_') {
              /* «Сайт»: в папки дат старше 7 дней не заходим (Маша, 10.11) — сданное раньше видно по отметкам программы */
              if (key === 'site' && cpSiteTooOld(x.name)) return;
              next.push(x.path);
            }
          });
        });
        return level(next, depth + 1);
      });
    };
    return level([root], 1).then(function () { return [key, names, where, info]; }, function () { return [key, null, null, null]; });
  })).then(function (pairs) {
    if (CP.archive !== archive) return;
    CP.stagePresence = {};
    CP.stagePaths = {};
    CP.stageInfo = {};
    pairs.forEach(function (kv) { if (kv[1]) { CP.stagePresence[kv[0]] = kv[1]; CP.stagePaths[kv[0]] = kv[2]; CP.stageInfo[kv[0]] = kv[3] || {}; } });
    cpRenderShoots();
    if (typeof cpCountStageArts === 'function') cpCountStageArts();
  });
}

/** В каких фильтрах съёмка; null — ещё не знаем (сводка считается). */
function cpStagesFor(d) {
  var sum = cpSumOf(d);
  var st = sum ? cpStagesOf(sum) : (d.cpSumDone ? { select: true, approval: false, retouch: false, review: false, site: false } : null);
  var name = d.name.toLowerCase(), any = false;
  Object.keys(CP_STAGE_SETTING).forEach(function (key) {
    var pres = CP.stagePresence[key];
    if (!pres) return;
    st = st || { select: false, approval: false, retouch: false, review: false, site: false };
    st[key] = !!pres[name];
    any = true;
  });
  /* Ретушь — конечная точка копий: съёмка, у которой всё сдано на сайт и в работе ничего не осталось,
     из фильтра ретуши пропадает, хотя её папка там ещё лежит. */
  if (st && st.retouch && sum && sum.k[5] > 0 && sum.k[2] + sum.k[3] + sum.k[4] === 0) st.retouch = false;
  return st;
}

function cpStageList() {
  return [
    { key: '', label: cpFolderBase(CP.archive) || 'Исходники' },
    { key: 'select', label: 'Отбор' },
    { key: 'approval', label: cpStageLabel('approval') },
    { key: 'retouch', label: cpStageLabel('retouch') },
    { key: 'review', label: cpStageLabel('review') },
    { key: 'site', label: cpStageLabel('site') }
  ];
}

(function cpStageBar() {
  var bar = document.getElementById('cpShelfBar');
  if (!bar) return;
  var box = document.createElement('span');
  box.className = 'cp-stages';
  box.id = 'cpStages';
  var search = document.getElementById('cpShelfSearch');
  bar.insertBefore(box, search ? search.nextSibling : null);
  box.addEventListener('click', function (e) {
    var b = e.target.closest('[data-cp-stage]');
    if (!b) return;
    CP.stageFilter = b.getAttribute('data-cp-stage');
    cpSet('cp_stage', CP.stageFilter);
    cpRenderShoots();
  });
})();

function cpRenderStageBar() {
  var box = document.getElementById('cpStages');
  if (!box) return;
  var hide = CP.settings && CP.settings.retouch;
  var shoots = (CP.shoots || []).filter(function (d) { return d.path !== hide; });
  var list = cpStageList();
  var counts = { '': shoots.length }, pending = 0;
  list.forEach(function (x) { if (x.key) counts[x.key] = 0; });
  shoots.forEach(function (d) {
    if (!cpSumOf(d) && !d.cpSumDone) pending++;
    var st = cpStagesFor(d);
    if (st) list.forEach(function (x) { if (x.key && st[x.key]) counts[x.key]++; });
  });
  if (list.every(function (x) { return x.key !== CP.stageFilter; })) CP.stageFilter = '';
  box.innerHTML = list.map(function (s) {
    return '<button data-cp-stage="' + s.key + '"' + (CP.stageFilter === s.key ? ' class="cp-on"' : '') + '>' + cbEsc(s.label)
      + ' <small>' + counts[s.key] + '</small></button>';
  }).join('') + (pending ? '<small class="cp-stages-wait" title="Съёмки без сводки: читаю их отборы">считаю ' + pending + '…</small>' : '');
}

var CP_ART_STAGES = [
  { label: 'отбор', cls: 'k1' }, { stage: 'approval', cls: 'k2' }, { stage: 'retouch', cls: 'k3' },
  { label: 'забрали', cls: 'k4' }, { stage: 'review', cls: 'k7' }, { stage: 'site', cls: 'k5' }, { label: 'брак', cls: 'k6' }
];
function cpArtLabel(i) { var x = CP_ART_STAGES[i]; return x.stage ? cpStageLabel(x.stage) : x.label; }

/** Под съёмкой: сколько артикулов на какой стадии — полоска и подписи с числами. */
function cpArtBar(sum) {
  var k = sum.k || [], n = k.reduce(function (a, b) { return a + b; }, 0);
  if (!n) return '';
  return '<div class="cp-artbar"><div class="cp-artbar-line">' + k.map(function (x, i) {
    return x ? '<i class="cp-' + CP_ART_STAGES[i].cls + '" style="flex:' + x + '" title="' + cbEsc(cpArtLabel(i)) + ': ' + x + '"></i>' : '';
  }).join('') + '</div><div class="cp-artbar-leg">артикулов ' + n + k.map(function (x, i) {
    return x ? ' · <span><i class="cp-' + CP_ART_STAGES[i].cls + '"></i>' + cbEsc(cpArtLabel(i)) + ' <b>' + x + '</b></span>' : '';
  }).join('') + (sum.empty ? ' · <span class="cp-warn" title="Карточка заведена по папке артикула, но кадров JPG в папке нет. Откройте съёмку — такая карточка помечена «нет кадров».">пустых карточек <b>' + sum.empty + '</b></span>' : '')
    + '</div></div>';
}

cpRenderShoots = (function (orig) {
  return function () {
    var all = CP.shoots, f = CP.stageFilter;
    if (f && all) {
      CP.shoots = all.filter(function (d) { var st = cpStagesFor(d); return st && st[f]; });
    }
    try { orig.apply(this, arguments); } finally { CP.shoots = all; }
    cpRenderStageBar();
    if (f && all && !all.some(function (d) { var st = cpStagesFor(d); return st && st[f]; })) {
      var pend = all.some(function (d) { return !cpSumOf(d) && !d.cpSumDone; });
      document.getElementById('cpShelfList').innerHTML = '<div class="cp-empty">' + (pend ? 'Считаю, что нужно сделать со съёмками…' : 'Таких съёмок нет') + '</div>';
    }
    /* под названием съёмки — что в ней ждёт */
    var byPath = {};
    (all || []).forEach(function (d) { byPath[d.path] = d; });
    Array.prototype.forEach.call(document.querySelectorAll('#cpShelfList .cp-shoot'), function (b) {
      var d = byPath[b.getAttribute('data-path')];
      var sum = d && cpSumOf(d);
      var meta = b.querySelector('.cp-shoot-meta');
      if (!meta || meta.querySelector('.cp-todo')) return;
      var parts = [];
      /* по папкам этапов (каталог) — где лежат артикулы, видно на полоске; здесь только отбор */
      var phys = d && typeof cpArtPhys === 'function' && cpArtPhys(d);
      if (!sum) parts.push(d && d.cpSumDone ? '<span class="cp-todo-s">отбора нет</span>' : '<span class="cp-todo-w">считаю…</span>');
      else {
        if (sum.filled === 0) parts.push('<span class="cp-todo-s">отбора нет</span>');
        else if (sum.k[0]) parts.push('<span class="cp-todo-s">в отборе: ' + sum.k[0] + ' арт.</span>');
        if (!phys) {
          if (sum.k[2]) parts.push('<span class="cp-todo-r">ждут ретушёра: ' + sum.k[2] + ' арт.</span>');
          if (sum.ap) parts.push('<span class="cp-todo-a">на согласовании: ' + sum.ap + '</span>');
          if (sum.rv) parts.push('<span class="cp-todo-r">ретушь на проверке: ' + sum.rv + '</span>');
        }
      }
      if (parts.length) meta.insertAdjacentHTML('beforeend', '<span class="cp-todo">' + parts.join(' · ') + '</span>');
      if (phys) b.insertAdjacentHTML('beforeend', cpArtBarPhys(sum, phys));
      else if (sum) b.insertAdjacentHTML('beforeend', cpArtBar(sum));
    });
  };
})(cpRenderShoots);

/* ---------- фон: сводка для съёмок, где её ещё нет ---------- */

var _cpFillRun = 0;
function cpFillSummaries() {
  var run = ++_cpFillRun;
  var archive = CP.archive;
  var todo = (CP.shoots || []).filter(function (d) { return !cpSumOf(d) && !d.cpSumDone; });
  if (!todo.length || !CPDisk.hasProxy()) { cpRenderStageBar(); return; }
  var i = 0, timer = null;
  function redraw() { if (!timer) timer = setTimeout(function () { timer = null; if (run === _cpFillRun) cpRenderShoots(); }, 400); }
  function next() {
    if (run !== _cpFillRun || CP.archive !== archive || i >= todo.length) return Promise.resolve();
    var d = todo[i++];
    /* отбор + папки съёмки (артикулы по папкам — и там, где отбора ещё нет) */
    return Promise.all([
      CPDisk.readState(d.path).catch(function () { return null; }),
      cpWalk(d.path).catch(function () { return null; })
    ]).then(function (r) {
      var data = r[0] && r[0].data;
      var codes = cpArticleCodes(d.path, d.name, r[1]);
      d.cpSumDone = true;
      if (!data && !Object.keys(codes).length) return;   /* ни отбора, ни папок артикулов */
      d.cpSum = cpShootSummary(data, codes);
      return cpWriteSummary(d.path, data, true, d.name);
    }).then(function () { redraw(); return next(); });
  }
  /* «забрали» считается по буквам ретушёров из словаря — сначала словарь */
  var dictReady = typeof cpLoadDict === 'function' ? Promise.resolve(cpLoadDict()).catch(function () { return null; }) : Promise.resolve();
  return dictReady.then(function () { return Promise.all([next(), next(), next()]); }).then(function () { if (run === _cpFillRun) cpRenderShoots(); });
}

cpLoadShoots = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    Promise.resolve(r).then(function () {
      cpFillSummaries();
      var ready = typeof cpEnsureSettings === 'function' ? cpEnsureSettings() : Promise.resolve();
      ready.then(cpScanStages, function () { });
    });
    return r;
  };
})(cpLoadShoots);
/* кнопка «Обновить» была привязана к старой функции */
document.getElementById('cpShelfRefresh').onclick = function () { cpLoadShoots(); };

(function cpStagesCss() {
  var css = ''
    + '.cp-stages{display:inline-flex;gap:4px;flex-wrap:wrap}'
    + '.cp-stages button small{color:#a3a09a;margin-left:2px}'
    + '.cp-stages button.cp-on{border-color:#C9956B;color:#e7c9a8}'
    + '.cp-stages-wait{color:#a3a09a;font-size:11px;align-self:center;margin-left:4px}'
    + '.cp-stages-sep{width:1px;background:#2f2f2c;margin:0 4px}'
    + '.cp-artbar{margin-top:8px;font-size:10px;color:#a3a09a}'
    + '.cp-artbar-line{display:flex;height:10px;border-radius:2px;overflow:hidden;background:#232321;margin-bottom:6px}'
    + '.cp-artbar-line i{display:block;min-width:2px}'
    + '.cp-artbar-leg{white-space:normal;line-height:1.7}.cp-artbar-leg span{white-space:nowrap}.cp-artbar-leg b{color:#f2f2f1;font-weight:600}'
    + '.cp-artbar-leg span i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;vertical-align:0}'
    + '.cp-k1{background:#8a7a64}.cp-k2{background:#5b7aa0}.cp-k3{background:#C9956B}.cp-k4{background:#9a8a3c}.cp-k5{background:#5f8a63}.cp-k6{background:#b5533c}.cp-k7{background:#7a6a9a}'
    + '.cp-todo{display:block;margin-top:3px;white-space:normal}.cp-todo span{white-space:nowrap}.cp-todo-s{color:#cfcac2}.cp-todo-r{color:#e7c9a8}.cp-todo-a{color:#a9c3e0}.cp-todo-d{color:#9fc2a3}.cp-todo-w{color:#6d6d6c}';
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
})();

/* сменили архив — панель прежней съёмки закрываем */
document.getElementById('cpArchiveApply').addEventListener('click', function () {
  if (CP.sel && CP.archive && CP.sel.path.indexOf(CP.archive.replace(/\/+$/, '') + '/') !== 0) {
    CP.sel = null;
    if (typeof cpRenderPanel === 'function') cpRenderPanel();
  }
});
