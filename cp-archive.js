/* ============================================================
   cp-archive.js — 00_АРХИВ: закрытые съёмки уходят с витрины

   Маша, 09.11.2026: «витрина зарастает съёмками, которых слишком много.
   Нужна папка архива 00, куда отправляются исходники после того, как
   завершён цикл: все артикулы попали в папку сайт либо в брак. Брак
   должен сохраняться, чтобы потом посчитать, вытащить, посмотреть».

   - Под съёмкой в исходниках — «готова к архиву», когда у неё есть
     артикулы и все они на сайте или в браке (по сводке съёмки).
   - В панели съёмки — «В архив»: папка съёмки переезжает целиком
     01_ИСХОДНИКИ/<съёмка> → 00_АРХИВ/<съёмка>. Отбор (_contentpulse.json:
     карточки, статусы, брак с видом и комментарием) едет вместе с ней.
     Перенос — через проверку по Диску; не прошёл — в очередь переносов.
     Не готова — спрашиваем, что не так, и переносим только с согласия.
     Пока у съёмки есть незавершённые переносы — в архив нельзя.
   - Фильтр «00_АРХИВ» — последним в строке: при запуске не читается,
     список грузится по клику. Под каждой съёмкой — сколько на сайте и в
     браке. Брак всех съёмок — в 00_АРХИВ/_БРАК (cp-brak.js) и в брак.csv.
   Решения по умолчанию (Маша не ответила, 09.11): переносит руководитель
   кнопкой; архив — отдельный фильтр по клику.
   Префикс: cpArch*.
   ============================================================ */

CP.archShoots = null;     /* список съёмок архива (грузится по клику на фильтр) */
CP.archRoot = '';

function cpArchRoot() { return (typeof cpCatalog === 'function' && cpCatalog() && CP.settings && CP.settings.archive) || ''; }

/** Сколько артикулов и где: {n, site, brak, rest} по сводке съёмки; null — сводки нет. */
function cpArchCount(d) {
  var sum = d && cpSumOf(d);
  if (!sum || !sum.k) return null;
  var n = sum.k.reduce(function (a, b) { return a + b; }, 0);
  var site = sum.k[5] || 0, brak = sum.k[6] || 0;
  /* Сдают на сайт пока руками, без отметок программы (Маша, 10.11.2026) — считаем и по самой папке
     сайта: сколько артикулов съёмки там лежит (все даты; cp-catalog.js). Берём большее из двух. */
  var phys = typeof cpCatalog === 'function' && cpCatalog() && CP.stageArtsFor === CP.archive ? (CP.stageArts.site || {})[d.name.toLowerCase()] : null;
  if (phys) site = Math.max(site, Math.min(Math.max(0, n - brak), Object.keys(phys).length));
  return { n: n, site: site, brak: brak, rest: n - site - brak };
}
function cpArchReady(d) { var c = cpArchCount(d); return !!(c && c.n > 0 && c.rest === 0); }

/* ---------- фильтр «00_АРХИВ» ---------- */

cpStageList = (function (orig) {
  return function () {
    var list = orig.apply(this, arguments);
    var root = cpArchRoot();
    if (root) list.push({ key: 'archive', label: cpFolderBase(root) });
    return list;
  };
})(cpStageList);

function cpArchLoad() {
  var root = cpArchRoot();
  if (!root) return;
  CP.archRoot = root;
  CPDisk.listDir(root).then(function (items) {
    if (CP.archRoot !== root) return;
    CP.archShoots = items.filter(function (r) { return r.type === 'dir' && r.name.charAt(0) !== '_'; })
      .sort(function (a, b) { return a.modified < b.modified ? 1 : -1; });
    if (CP.stageFilter === 'archive') cpRenderShoots();
  }, function (e) { cpHandleError(e, 'Не удалось прочитать архив'); });
}

cpRenderShoots = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    var list = document.getElementById('cpShelfList');
    var chip = document.querySelector('#cpStages [data-cp-stage="archive"] small');
    if (chip) chip.textContent = CP.archShoots && CP.archRoot === cpArchRoot() ? CP.archShoots.length : '';
    if (!list) return r;
    if (CP.stageFilter !== 'archive') {
      /* исходники: подсказать, какие съёмки готовы к архиву */
      if (!CP.stageFilter && cpArchRoot()) {
        var byPath = {};
        (CP.shoots || []).forEach(function (d) { byPath[d.path] = d; });
        Array.prototype.forEach.call(list.querySelectorAll('.cp-shoot'), function (b) {
          var d = byPath[b.getAttribute('data-path')], meta = b.querySelector('.cp-shoot-meta');
          if (d && meta && cpArchReady(d) && !meta.querySelector('.cp-arch-ready')) meta.insertAdjacentHTML('beforeend', ' <span class="cp-arch-ready">готова к архиву</span>');
        });
      }
      return r;
    }
    if (!CP.archShoots || CP.archRoot !== cpArchRoot()) {
      list.innerHTML = '<div class="cp-empty">Читаю ' + cbEsc(cpFolderBase(cpArchRoot())) + '…</div>';
      cpArchLoad();
      return r;
    }
    var q = (document.getElementById('cpShelfSearch').value || '').trim().toLowerCase();
    var items = CP.archShoots.filter(function (d) { return !q || d.name.toLowerCase().indexOf(q) !== -1; });
    list.innerHTML = items.length ? items.map(function (d) {
      var c = cpArchCount(d);
      return '<button class="cp-shoot' + (CP.sel && CP.sel.path === d.path ? ' cp-shoot-sel' : '') + '" data-path="' + cbEsc(d.path) + '" data-name="' + cbEsc(d.name) + '" data-mod="' + cbEsc(d.modified || '') + '">'
        + '<div class="cp-shoot-name">' + cbEsc(d.name) + '</div>'
        + '<div class="cp-shoot-meta">в архиве · ' + cpFmtDate(d.modified)
        + (c ? ' · артикулов ' + c.n + ' · на сайте ' + c.site + (c.brak ? ' · <span class="cp-arch-brak">брак ' + c.brak + '</span>' : '') : '') + '</div></button>';
    }).join('') : '<div class="cp-empty">' + (CP.archShoots.length ? 'Ничего не найдено' : 'В архиве пока пусто') + '</div>';
    return r;
  };
})(cpRenderShoots);

/* ---------- «В архив» ---------- */

cpRenderPanel = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    var sel = CP.sel, root = cpArchRoot();
    var acts = document.querySelector('#cpPanel .cp-panel-actions');
    if (!sel || !root || !acts || CP.stageFilter || sel.path.indexOf(root + '/') === 0 || acts.querySelector('[data-cp-arch-go]')) return r;
    var d = (CP.shoots || []).filter(function (x) { return x.path === sel.path; })[0];
    var ready = d && cpArchReady(d);
    acts.insertAdjacentHTML('beforeend', '<button data-cp-arch-go' + (ready ? ' class="cp-arch-btn-ready"' : '')
      + ' title="Переместить съёмку целиком в ' + cbEsc(cpFolderBase(root)) + ' — с витрины она уйдёт, отбор и брак останутся с ней">В архив</button>');
    return r;
  };
})(cpRenderPanel);

document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('[data-cp-arch-go]');
  if (!b || !CP.sel) return;
  e.preventDefault();
  cpArchiveShoot(CP.sel);
});

/** Есть ли у съёмки незавершённые переносы (в этом браузере или в её отборе). */
function cpArchBusy(sel) {
  var mine = Object.keys(CPQ.ops).some(function (id) { return CPQ.ops[id].shoot.path === sel.path; });
  var q = sel.data && sel.data.meta && sel.data.meta.cp && sel.data.meta.cp.q;
  return mine || !!(q && Object.keys(q).length);
}

/* ---------- «В архив» целиком (Маша, 10.11.2026) ----------
   «Съёмка, у которой все артикулы на сайте или в браке, переносится в архив и отовсюду удаляется,
   кроме сайта / готово. Готовое тоже копируется в архив — в папку «Готово» внутри папки съёмки:
   исходный и готовый материал в одной точке, легко хранить на прекрасное далёко. Внутри — «Брак»
   (что забраковали) и «Готово» (что не забраковали)». Запуск — кнопкой с подтверждением.
   Порядок — сначала то, что нужно сохранить, потом уборка; убираем только после проверки:
     1. 01_ИСХОДНИКИ/<съёмка> → 00_АРХИВ/<съёмка>; ждём, пока папки в исходниках не станет;
     2. каждая папка съёмки в «Сайте» / «Готово» копируется в 00_АРХИВ/<съёмка>/Готово/<дата_буква_номер>;
     3. брак 00_АРХИВ/_БРАК/<съёмка> переезжает в 00_АРХИВ/<съёмка>/Брак;
     4. только если 2 прошло целиком — копии в 02 и 03 в Корзину Диска (30 дней можно вернуть).
   Сайт не трогаем: через неделю после архива его папки можно будет убрать — отметка archivedAt. */

/** Где лежит съёмка на этапе (по последней сверке витрины): [пути]. */
function cpArchStagePaths(key, name) {
  return ((CP.stagePaths || {})[key] || {})[String(name).toLowerCase()] || [];
}

/** Папка в «Сайте» → имя внутри «Готово»: путь от корня папки сайта до папки съёмки через «_». */
function cpArchDoneName(sitePath, shootName) {
  var roots = [CP.settings && CP.settings.site].concat((CP.settings && CP.settings.siteMore) || []).filter(Boolean);
  var root = roots.filter(function (r) { return sitePath.indexOf(r.replace(/\/+$/, '') + '/') === 0; })[0] || '';
  var rel = root ? sitePath.slice(root.replace(/\/+$/, '').length + 1) : sitePath.split('/').pop();
  var segs = rel.split('/');
  segs.pop();   /* сама папка съёмки */
  if (root && roots.indexOf(root) > 0) segs.unshift(cpFolderBase(root));
  return CPDisk.safeName(segs.join('_') || 'сайт');
}

/** Ждать, пока папки не станет (Диск переносит большие папки в фоне). */
function cpWaitGone(path, tries) {
  return CPDisk.meta(path).then(function () {
    if (tries <= 1) return false;
    return new Promise(function (r) { setTimeout(r, CP.waitThereMs || 5000); }).then(function () { return cpWaitGone(path, tries - 1); });
  }, function (e) { return !!(e && e.status === 404); });
}

function cpArchiveShoot(sel) {
  var root = cpArchRoot();
  if (!root) { cpCatStageMissing('archive'); return; }
  if (cpArchBusy(sel)) { cbToast('У съёмки ещё идут переносы на Диске — дождитесь, потом «В архив»'); return; }
  var d = (CP.shoots || []).filter(function (x) { return x.path === sel.path; })[0], c = cpArchCount(d);
  var why = !c ? 'сводки по артикулам нет — не знаю, всё ли сдано'
    : !c.n ? 'в съёмке нет артикулов'
      : c.rest ? 'не на сайте и не в браке: ' + c.rest + ' из ' + c.n + ' артикулов' : '';
  var site = cpArchStagePaths('site', sel.name);
  var junk = cpArchStagePaths('approval', sel.name).concat(cpArchStagePaths('retouch', sel.name))
    .filter(function (p) { return p.indexOf(root.replace(/\/+$/, '') + '/') !== 0 && p !== sel.path; });
  var base = root.replace(/\/+$/, '') + '/' + sel.name;
  var msg = 'Перенести съёмку «' + sel.name + '» в ' + cpFolderBase(root) + '?\n\n'
    + (why ? 'Она ещё не закрыта: ' + why + '.\n\n' : 'Все артикулы на сайте (' + c.site + ') или в браке (' + c.brak + ').\n\n')
    + '1. Исходники переедут целиком: ' + CPDisk.showPath(base) + '\n'
    + '2. Готовое скопируется в «Готово» внутри неё: ' + (site.length ? site.length + ' папк(и) из сайта' : 'в сайте этой съёмки не найдено') + '\n'
    + '3. Брак переедет в «Брак» внутри неё\n'
    + '4. В Корзину Диска (30 дней можно вернуть): ' + (junk.length ? junk.map(function (p) { return CPDisk.showPath(p); }).join(', ') : 'нечего') + '\n'
    + (junk.length && !site.length ? '   — только если готовое найдено; сейчас не найдено, поэтому копии в 02/03 останутся\n' : '')
    + '\nСайт не трогается.';
  if (!window.confirm(msg)) return;
  var shoot = { path: sel.path, name: sel.name };
  var ready = CP.shoot && CP.shoot.path === sel.path ? cpFlushSave() : Promise.resolve();
  var report = [], moved = '';
  cbBusyShow('Переношу в архив: ' + sel.name + '...', 0.2);
  ready.then(function () {
    return cpMoveFolder(sel.path, base);
  }).then(function (to) {
    moved = to;
    /* «В архиве» — только когда в исходниках папки больше нет: раньше хватало того, что она появилась
       в архиве, и при оборванном фоновом переносе съёмка оказывалась разорвана надвое (Маша, 10.11) */
    cbBusyShow('Проверяю, что исходники переехали целиком...', 0.4);
    return cpWaitGone(sel.path, 18).then(function (gone) {
      if (!gone) throw { message: 'Диск ещё переносит или перенос оборвался: папка в исходниках осталась (' + CPDisk.showPath(sel.path) + ')' };
    });
  }).then(function () {
    if (CP.shoot && CP.shoot.path === sel.path) { CP.shoot = null; cpShowShelf(); }
    /* 2. готовое — копией в «Готово» */
    cbBusyShow('Копирую готовое в архив...', 0.6);
    var used = {};
    var items = site.map(function (p) {
      var nm = cpArchDoneName(p, sel.name), k = 2;
      while (used[nm]) nm = cpArchDoneName(p, sel.name) + '_' + (k++);
      used[nm] = true;
      return { from: p, path: moved + '/Готово/' + nm };
    });
    if (!items.length) return 0;
    return CPDisk.proxyCopy(items, [moved + '/Готово']).then(function (r) {
      var res = (r && r.results) || [];
      return Promise.all(items.map(function (it, i) {
        var st = res[i] && res[i].status;
        if (st === 'done' || st === 'exists') return true;
        return cpWaitThere(it.path, st === 'timeout' ? 18 : 2);
      })).then(function (oks) {
        var bad = items.filter(function (it, i) { return !oks[i]; });
        if (bad.length) report.push('готовое скопировалось не всё: ' + bad.map(function (it) { return CPDisk.showPath(it.from); }).join(', '));
        return items.length - bad.length === items.length ? items.length : -1;
      });
    }, function (e) { report.push('готовое не скопировалось: ' + ((e && e.message) || e)); return -1; });
  }).then(function (doneCopied) {
    /* 3. брак — внутрь съёмки */
    var brak = root.replace(/\/+$/, '') + '/_БРАК/' + CPDisk.safeName(sel.name);
    var stepBrak = CPDisk.meta(brak).then(function () {
      cbBusyShow('Переношу брак...', 0.75);
      return cpMoveFolder(brak, moved + '/Брак').then(function () { return 1; }, function (e) { report.push('брак не перенёсся: ' + ((e && e.message) || e)); return 0; });
    }, function () { return 0; });
    return stepBrak.then(function () { return doneCopied; });
  }).then(function (doneCopied) {
    /* 4. уборка 02/03 — только если готовое сохранено целиком */
    if (!junk.length) return 0;
    if (doneCopied <= 0) { report.push('копии в 02/03 оставлены: готовое ' + (doneCopied === 0 ? 'не найдено' : 'сохранилось не целиком')); return 0; }
    cbBusyShow('Убираю копии из 02 и 03 в Корзину...', 0.9);
    return CPDisk.trash(junk).then(function (res) {
      var bad = res.filter(function (x) { return x.status === 'failed'; });
      if (bad.length) report.push('в Корзину не ушло: ' + bad.map(function (x) { return CPDisk.showPath(x.path); }).join(', '));
      return junk.length - bad.length;
    }, function (e) { report.push('копии в 02/03 не убраны: ' + ((e && e.message) || e)); return 0; });
  }).then(function (trashed) {
    cbBusyHide();
    var now = new Date().toISOString();
    cpMutateState({ path: moved, name: sel.name }, function (data) {
      var m = data.meta.cp;
      m.archivedAt = now;
      m.archiveSite = site;   /* какие папки сайта скопированы — их можно будет убрать через неделю */
      m.events.push({ ts: now, action: 'to_archive', actor: cpActor(), items: [], note: 'в архив: ' + CPDisk.showPath(moved)
        + (site.length ? '; готовое: ' + site.length : '') + (trashed ? '; из 02/03 в Корзину: ' + trashed : '')
        + (why ? ' (не закрыта: ' + why + ')' : '') + (report.length ? '; ' + report.join('; ') : '') });
    }).catch(function () { });
    cbToast('В архиве: ' + sel.name + (report.length ? '. Не всё получилось: ' + report.join('; ') : ''));
    CP.sel = null;
    CP.archShoots = null;
    cpLoadShoots();
  }, function (e) {
    cbBusyHide();
    if (moved) {
      /* папка в архиве появилась, а в исходниках осталась — честно говорим, дальше ничего не убираем */
      cbToast('Перенос в архив не закончился: ' + ((e && e.message) || e) + '. Ничего не удалено. Откройте 00_АРХИВ и 01_ИСХОДНИКИ на Диске и проверьте, что где лежит.');
      cpLoadShoots();
      return;
    }
    CPQ.add(shoot, { kind: 'move', label: 'В архив: ' + sel.name, items: [{ from: sel.path, path: base }], err: (e && e.message) || '' });
    cbToast('В архив сразу не перенеслось — переношу повторно, не закрывайте страницу (плашка сверху)');
  });
}

/* ---------- «Доперенести в архив» (Маша, 10.11.2026: «важно перенести в архив то, что мы нажали
   перенести в архив») ----------
   До 2.0.106 «В архив» считался готовым, как только папка появлялась в архиве, и при оборванном фоновом
   переносе Диска съёмка оставалась разорванной: часть в 00_АРХИВ/<съёмка>, часть в 01_ИСХОДНИКИ/<съёмка>.
   Такая съёмка узнаётся по имени: она есть и в исходниках, и в архиве. Доносим остаток по одному:
     - чего в архиве нет — переносим туда (папки — целиком);
     - папка есть и там, и там — заходим внутрь и доносим её содержимое;
     - файл есть и там, и там: тот же (md5) — копия в исходниках лишняя, в Корзину; разный — не трогаем,
       называем в итоге;
     - в исходниках ничего не осталось — пустую папку съёмки в Корзину.
   Ничего не удаляется навсегда: в Корзину уходят только лишние копии того, что уже есть в архиве. */

CP.archNames = null;   /* имена съёмок архива (строчными) — грузятся вместе с витриной */
function cpArchNamesLoad() {
  var root = cpArchRoot();
  if (!root) { CP.archNames = null; return Promise.resolve(); }
  return CPDisk.listDir(root).then(function (items) {
    var m = {};
    items.forEach(function (r) { if (r.type === 'dir' && r.name.charAt(0) !== '_') m[r.name.toLowerCase()] = r.path; });
    CP.archNames = m;
    CP.archNamesFor = root;
    cpRenderShoots();
  }, function () { });
}
function cpArchSplit(d) {
  return !!(d && CP.archNames && CP.archNamesFor === cpArchRoot() && CP.archNames[d.name.toLowerCase()]);
}
cpLoadShoots = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    Promise.resolve(r).then(function () {
      var ready = typeof cpEnsureSettings === 'function' ? cpEnsureSettings() : Promise.resolve();
      ready.then(cpArchNamesLoad, function () { });
    });
    return r;
  };
})(cpLoadShoots);
document.getElementById('cpShelfRefresh').addEventListener('click', function () { setTimeout(cpArchNamesLoad, 50); });

cpRenderShoots = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    var list = document.getElementById('cpShelfList');
    if (!list || CP.stageFilter === 'archive' || !CP.archNames) return r;
    var byPath = {};
    (CP.shoots || []).forEach(function (d) { byPath[d.path] = d; });
    Array.prototype.forEach.call(list.querySelectorAll('.cp-shoot'), function (b) {
      var d = byPath[b.getAttribute('data-path')];
      if (!cpArchSplit(d) || b.querySelector('.cp-arch-split')) return;
      b.insertAdjacentHTML('beforeend', '<div class="cp-transit cp-arch-split">перенос в архив не закончен: часть уже в ' + cbEsc(cpFolderBase(cpArchRoot()))
        + ' — выберите съёмку и нажмите «Доперенести в архив»</div>');
    });
    return r;
  };
})(cpRenderShoots);

cpRenderPanel = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    var sel = CP.sel, acts = document.querySelector('#cpPanel .cp-panel-actions');
    if (!sel || !acts || CP.stageFilter || acts.querySelector('[data-cp-arch-finish]')) return r;
    var d = (CP.shoots || []).filter(function (x) { return x.path === sel.path; })[0];
    if (!cpArchSplit(d)) return r;
    var go = acts.querySelector('[data-cp-arch-go]');
    if (go) go.remove();
    acts.insertAdjacentHTML('beforeend', '<button class="cb-primary" data-cp-arch-finish title="Перенос в архив оборвался: донести в архив то, что осталось в исходниках">Доперенести в архив</button>');
    return r;
  };
})(cpRenderPanel);

document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('[data-cp-arch-finish]');
  if (!b || !CP.sel) return;
  e.preventDefault();
  cpArchFinish(CP.sel);
});

function cpArchFinish(sel) {
  var to = CP.archNames && CP.archNames[sel.name.toLowerCase()];
  if (!to) return;
  if (cpArchBusy(sel)) { cbToast('У съёмки ещё идут переносы на Диске — дождитесь'); return; }
  if (!window.confirm('Доперенести «' + sel.name + '» в архив?\n\nЧасть съёмки уже в ' + CPDisk.showPath(to) + ', часть осталась в ' + CPDisk.showPath(sel.path) + '.\n\n'
    + 'Что осталось в исходниках, переедет в архив. Файлы, которые уже есть в архиве (те же самые), — лишние копии, уйдут в Корзину Диска. '
    + 'Если в архиве под тем же именем лежит другой файл — не трогаю, назову в итоге.')) return;
  if (CP.shoot && CP.shoot.path === sel.path) { CP.shoot = null; cpShowShelf(); }
  var moved = 0, extra = [], clash = [], failed = [];
  var listAll = function (p) {
    return CPDisk.listDir(p).then(null, function (e) { if (e && e.status === 404) return []; throw e; });
  };
  /* один уровень: from — папка в исходниках, dst — соответствующая папка в архиве */
  var level = function (from, dst, depth) {
    return Promise.all([listAll(from), listAll(dst)]).then(function (two) {
      var have = {};
      two[1].forEach(function (x) { have[x.name] = x; });
      var mv = [], deeper = [];
      two[0].forEach(function (x) {
        var y = have[x.name];
        if (!y) { mv.push({ from: x.path, path: dst + '/' + x.name }); return; }
        if (x.type === 'dir' && y.type === 'dir') { if (depth < 8) deeper.push([x.path, y.path]); else clash.push(CPDisk.showPath(x.path)); return; }
        if (x.type !== 'dir' && y.type !== 'dir' && x.md5 && x.md5 === y.md5) extra.push(x.path);
        else if (x.name === CPDisk.STATE_FILE) extra.push(x.path);   /* отбор в архиве — тот, что сохранён перед переносом */
        else clash.push(CPDisk.showPath(x.path));
      });
      var step = mv.length ? CPDisk.proxyMove(mv).then(function (r) {
        (r.results || []).forEach(function (res, i) {
          if (res.status === 'done' || res.status === 'gone') moved++;
          else failed.push(CPDisk.showPath(mv[i].from) + ': ' + (res.error || res.status));
        });
      }) : Promise.resolve();
      return step.then(function () {
        return deeper.reduce(function (pr, pair) { return pr.then(function () { return level(pair[0], pair[1], depth + 1); }); }, Promise.resolve());
      });
    });
  };
  cbBusyShow('Доношу в архив: ' + sel.name + '...', 0.3);
  level(sel.path, to, 1).then(function () {
    cbBusyShow('Убираю лишние копии...', 0.7);
    return extra.length ? CPDisk.trash(extra).then(function (res) {
      res.forEach(function (x) { if (x.status === 'failed') failed.push(CPDisk.showPath(x.path) + ': в Корзину не ушло'); });
    }) : null;
  }).then(function () {
    /* в исходниках не осталось ни одного файла — пустые папки в Корзину */
    return CPDisk.walkPhotos ? listDeep(sel.path) : null;
    function listDeep(p) {
      var files = 0;
      var walk = function (q, depth) {
        return listAll(q).then(function (items) {
          var ds = [];
          items.forEach(function (x) { if (x.type === 'dir') ds.push(x.path); else files++; });
          if (depth > 8) return;
          return ds.reduce(function (pr, d) { return pr.then(function () { return walk(d, depth + 1); }); }, Promise.resolve());
        });
      };
      return walk(p, 1).then(function () {
        if (files) return;
        return CPDisk.trash([sel.path]).then(function (res) { if (res[0] && res[0].status === 'failed') failed.push('пустая папка в исходниках не убрана'); });
      });
    }
  }).then(function () {
    cbBusyHide();
    var now = new Date().toISOString();
    cpMutateState({ path: to, name: sel.name }, function (data) {
      data.meta.cp.events.push({ ts: now, action: 'to_archive', actor: cpActor(), items: [], note: 'доперенесено в архив: перенесено ' + moved
        + ', лишних копий в Корзину ' + extra.length + (clash.length ? '; не тронуто (разные файлы с одним именем): ' + clash.join(', ') : '') + (failed.length ? '; не получилось: ' + failed.join('; ') : '') });
    }).catch(function () { });
    cbToast('Доперенесено в архив: ' + moved + ', лишних копий в Корзину: ' + extra.length
      + (clash.length ? '. Остались в исходниках (в архиве другой файл с тем же именем): ' + clash.slice(0, 4).join(', ') + (clash.length > 4 ? '…' : '') : '')
      + (failed.length ? '. Не получилось: ' + failed.slice(0, 3).join('; ') : ''));
    CP.sel = null;
    CP.archShoots = null;
    cpLoadShoots();
  }, function (e) {
    cbBusyHide();
    cpHandleError(e, 'Доперенести в архив');
    cpLoadShoots();
  });
}

(function cpArchCss() {
  var st = document.createElement('style');
  st.textContent = '.cp-arch-ready{color:#9fc2a3}.cp-arch-brak{color:#f2b8a0}.cp-panel-actions .cp-arch-btn-ready{border-color:#9fc2a3;color:#cfe5d2}';
  document.head.appendChild(st);
})();
