/* ============================================================
   cp-archive.js — 00_АРХИВ: закрытые съёмки уходят с витрины

   Маша, 09.11.2026: «витрина зарастает съёмками, которых слишком много.
   Нужна папка архива 00, куда отправляются исходники после того, как
   завершён цикл: все артикулы попали в папку сайт либо в брак. Брак
   должен сохраняться, чтобы потом посчитать, вытащить, посмотреть».

   - Под съёмкой в исходниках — «Можно в архив», когда каждый артикул
     или карточка съёмки подтверждены на сайте или в браке.
   - В панели съёмки — «В архив»: папка съёмки переезжает целиком
     01_ИСХОДНИКИ/<съёмка> → 00_АРХИВ/<съёмка>. Отбор (_contentpulse.json:
     карточки, статусы, брак с видом и комментарием) едет вместе с ней.
     Перенос — через проверку по Диску; не прошёл — в очередь переносов.
     Для незавершённой съёмки перенос недоступен. Копии в ретуши
     отправляются в Корзину отдельным действием.
   - Фильтр «00_АРХИВ» — последним в строке: при запуске не читается,
     список грузится по клику. Под каждой съёмкой — сколько на сайте и в
     браке. Брак всех съёмок — в 00_АРХИВ/_БРАК (cp-brak.js) и в брак.csv.
   Префикс: cpArch*.
   ============================================================ */

CP.archShoots = null;     /* список съёмок архива (грузится по клику на фильтр) */
CP.archRoot = '';

function cpArchRoot() { return (typeof cpCatalog === 'function' && cpCatalog() && CP.settings && CP.settings.archive) || ''; }

function cpArchCount(d) {
  var sum = d && cpSumOf(d);
  if (!sum || !sum.k) return null;
  var n = sum.k.reduce(function (a, b) { return a + b; }, 0);
  var site = sum.k[5] || 0, brak = sum.k[6] || 0;
  return { n: n, site: site, brak: brak, rest: n - site - brak };
}

/* Учитываем только артикулы из исходников и карточек этой съёмки.
   Для съёмки без артикулов единица закрытия — карточка с кадрами. */
function cpArchAssess(data, codes, site, rejected) {
  data = data || {};
  var m = (data.meta || {}).cp || {}, units = Object.create(null);
  var cardStatus = m.cardStatus || {}, delivered = m.delivered || {}, versions = m.rv || {};
  Object.keys(codes).forEach(function (code) { units['art:' + code] = []; });
  (data.cards || []).forEach(function (card) {
    var pids = card.mode === 'auto' ? (card.pids || []) : (card.slots || []).map(function (slot) { return slot.pid; }).filter(Boolean);
    var status = (cardStatus[card.id] || {}).s;
    if (card.cpFolderMissing) return;
    if (!card.cpArticle && !pids.length && status !== 'reshoot') return;
    var articles = String(card.cpArticle || '').split(',').map(function (code) { return code.trim(); }).filter(Boolean);
    var ids = articles.length ? articles.map(function (code) { return 'art:' + code; }) : ['card:' + card.id];
    var rv = versions[card.id] || [], last = rv[rv.length - 1];
    var state = status === 'reshoot' ? 'brak' : last && last.status === 'rework' ? 'rework' : delivered[card.id] ? 'site' : 'open';
    ids.forEach(function (id) { (units[id] = units[id] || []).push(state); });
  });
  var result = { n: Object.keys(units).length, site: 0, brak: 0, rest: 0, busy: !!Object.keys(m.q || {}).length, codes: [] };
  Object.keys(units).forEach(function (id) {
    var statuses = units[id], code = id.indexOf('art:') === 0 ? id.slice(4) : '';
    if (code) result.codes.push(code);
    if (statuses.indexOf('rework') !== -1) result.rest++;
    else if ((code && Object.hasOwn(rejected, code)) || (statuses.length && statuses.every(function (st) { return st === 'brak'; }))) result.brak++;
    else if ((code && Object.hasOwn(site, code)) || (!code && statuses[0] === 'site')) result.site++;
    else result.rest++;
  });
  return result;
}

function cpArchIsComplete(c) { return !!(c && c.n > 0 && c.rest === 0 && !c.busy); }
function cpArchReady(d) { return !!(d && cpArchIsComplete(d.cpArchCheck)); }

function cpArchVerify(d, fresh) {
  var low = d.name.toLowerCase(), archive = CP.archive;
  var site = CP.stageArtsFor === archive ? ((CP.stageArts.site || {})[low] || {}) : {};
  var root = cpBrakRoot(d.name);
  var archivedBrak = d.path.indexOf(cpArchRoot() + '/') === 0 ? d.path + '/Брак' : '';
  var missing = function (e) { if (e && e.status === 404) return []; throw e; };
  var read = function (path) { return CPDisk.walkPhotos(path, false, 2, true, fresh ? undefined : 3).then(function (files) { return { path: path, files: files }; }); };
  return Promise.all([
    cpWalk(d.path, true, fresh ? undefined : 3),
    CPDisk.bg(fresh ? undefined : 3, function () { return CPDisk.readState(d.path); }),
    cpDictReady(),
    Promise.all([root, archivedBrak].filter(Boolean).map(function (p) { return read(p).catch(missing); })),
    fresh ? cpPool(cpArchStagePaths('site', d.name), 2, read) : []
  ]).then(function (r) {
    var type = cpShootType(d.name), letters = cpRetoucherTags();
    var rejected = cpMirrorArts(r[3].filter(function (x) { return x.path; }), letters, type);
    if (fresh) site = cpMirrorArts(r[4], letters, type);
    var files = r[0];
    if (archivedBrak) {
      var fromSource = function (p) { return !/^(Брак|Готово)\//.test(p.slice(d.path.length + 1)); };
      files = files.filter(function (file) { return fromSource(file.path); });
      files.dirs = (r[0].dirs || []).filter(function (p) { return fromSource(p + '/'); });
    }
    var data = r[1].data || {}, cards = data.cards || [], m = (data.meta || {}).cp || {};
    var records = m.articleBrak || {}, codes = cpArticleCodes(d.path, d.name, files);
    var suffixPaths = new Set((files.dirs || []).filter(cpArticleIsBrak));
    return cpPool(cards.filter(function (card) { return records[card.id]; }), 3, function (card) {
      return cpArticleMeta(records[card.id].path).then(function (entry) {
        var here = suffixPaths.has(d.path.replace(/\/+$/, '') + '/' + card.cpArticleDir);
        if ((!entry || !here) && m.cardStatus && (m.cardStatus[card.id] || {}).s === 'reshoot') delete m.cardStatus[card.id];
      });
    }).then(function () { return cpArchAssess(data, codes, site, rejected); });
  });
}

/* Сводка отбирает кандидатов. Статус «Можно в архив» появляется после проверки состава. */
function cpArchCheckCandidates() {
  var root = cpArchRoot(), archive = CP.archive;
  if (!root) return;
  return cpListDirs(root + '/_БРАК', 3).catch(function () { return []; }).then(function (dirs) {
    if (CP.archive !== archive) return;
    var rejected = Object.create(null);
    dirs.forEach(function (d) { rejected[d.name.toLowerCase()] = d.modified || 'есть'; });
    var todo = [];
    (CP.shoots || []).forEach(function (d) {
      var low = d.name.toLowerCase(), c = cpArchCount(d), site = ((CP.stageArts.site || {})[low] || {});
      if (!rejected[low] && (!c || !c.n || Math.max(c.site, Object.keys(site).length) + c.brak < c.n)) {
        delete d.cpArchCheck;
        delete d.cpArchStamp;
        return;
      }
      var stamp = JSON.stringify([d.modified, c, Object.keys(site).sort(), rejected[low]]);
      if (d.cpArchStamp === stamp) return;
      d.cpArchStamp = stamp;
      delete d.cpArchCheck;
      todo.push({ shoot: d, stamp: stamp });
    });
    return cpPool(todo, 2, function (x) {
      return cpArchVerify(x.shoot, false).then(function (c) {
        if (x.shoot.cpArchStamp === x.stamp) x.shoot.cpArchCheck = c;
      }, function () { if (x.shoot.cpArchStamp === x.stamp) delete x.shoot.cpArchStamp; });
    }).then(function () {
      if (CP.archive === archive) { cpRenderShoots(); if (CP.sel && !CP.sel.loading) cpRenderPanel(); }
    });
  });
}
cpScanStages = (function (orig) {
  return function () {
    var p = orig.apply(this, arguments);
    p.then(cpArchCheckCandidates).catch(function (e) { if (window.console) console.warn('[CP] готовность к архиву', e); });
    return p;
  };
})(cpScanStages);

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
    CP.archShoots = items.filter(function (r) { return r.type === 'dir' && r.name.charAt(0) !== '_' && !CPDisk.isReadyFolder(r.name); })
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
          if (d && meta && cpArchReady(d) && !meta.querySelector('.cp-arch-ready')) meta.insertAdjacentHTML('beforeend', ' <span class="cp-arch-ready">Можно в архив</span>');
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
    if (!sel || !root || !acts || (CP.stageFilter && CP.stageFilter !== 'archive' && CP.stageFilter !== 'retouch')) return r;
    var archived = sel.path.indexOf(root + '/') === 0;
    var d = (archived ? CP.archShoots || [] : CP.shoots || []).filter(function (x) { return x.path === sel.path; })[0];
    if (!CP.stageFilter && !archived && cpArchReady(d)) {
      acts.insertAdjacentHTML('beforeend', '<button data-cp-arch-go class="cp-arch-btn-ready">В архив</button>');
    }
    if ((archived || cpArchReady(d)) && !sel.loading && cpArchStagePaths('retouch', sel.name).length) {
      acts.insertAdjacentHTML('beforeend', '<button data-cp-rt-clean>Убрать из ретуши</button>');
    }
    return r;
  };
})(cpRenderPanel);

document.addEventListener('click', function (e) {
  var b = e.target.closest && e.target.closest('[data-cp-arch-go]');
  if (!b || !CP.sel) return;
  e.preventDefault();
  cpArchiveShoot(CP.sel);
});

document.addEventListener('click', function (e) {
  if (!e.target.closest || !e.target.closest('[data-cp-rt-clean]') || !CP.sel) return;
  e.preventDefault();
  var sel = CP.sel, root = (CP.settings || {}).retouch, archive = CP.archive;
  if (!root || cpArchBusy(sel)) return;
  cbBusyShow('Проверяю, что съёмка закрыта…', 0.2);
  Promise.all([cpArchVerify(sel, true), cpScanRetouch(archive, CP.settings)]).then(function (r) {
    cbBusyHide();
    if (CP.sel !== sel || CP.archive !== archive) return;
    if (!cpArchIsComplete(r[0])) { cbToast('Убрать из ретуши можно после сдачи всех артикулов на сайт или в брак.'); return; }
    if ((CP.stageFailed || []).indexOf('retouch') !== -1) return;
    var paths = cpArchStagePaths('retouch', sel.name).filter(function (path) { return path.indexOf(root + '/') === 0; });
    if (!paths.length) { cbToast('Папка съёмки в ретуши не найдена.'); return; }
    return cpPool(paths, 2, function (path) {
      return CPDisk.walkPhotos(path, false, 2, true).then(function (files) { return { path: path, files: files }; });
    }).then(function (folders) {
      if (CP.sel !== sel || CP.archive !== archive || (CP.settings || {}).retouch !== root) return;
      var codes = cpMirrorArts(folders, cpRetoucherTags(), cpShootType(sel.name));
      var extra = Object.keys(codes).filter(function (code) { return r[0].codes.indexOf(code) === -1; });
      if (extra.length) { cbToast('В ретуши есть артикулы вне этой съёмки: ' + extra.join(', ') + '. Проверьте папку на Диске.'); return; }
      if (!window.confirm('Убрать копии съёмки «' + sel.name + '» из ретуши в Корзину Диска?\n\n' + paths.map(CPDisk.showPath).join('\n'))) return;
      cbBusyShow('Убираю копии из ретуши…', 0.5);
      return CPDisk.trash(paths).then(function (res) {
        cbBusyHide();
        var bad = res.filter(function (x) { return x.status === 'failed'; });
        cbToast(bad.length ? 'Не удалось убрать папок из ретуши: ' + bad.length : 'Съёмка убрана из ретуши');
        return cpScanRetouch(archive, CP.settings).then(function () { if (CP.sel === sel) cpRenderPanel(); });
      });
    });
  }).catch(function (e) { cbBusyHide(); cpHandleError(e, 'Убрать из ретуши'); });
});

/** Есть ли у съёмки незавершённые переносы (в этом браузере или в её отборе). */
function cpArchBusy(sel) {
  var mine = Object.keys(CPQ.ops).some(function (id) { return CPQ.ops[id].shoot.path === sel.path; });
  var q = sel.data && sel.data.meta && sel.data.meta.cp && sel.data.meta.cp.q;
  return mine || !!(q && Object.keys(q).length);
}

/* Исходники переезжают в архив. Готовое копируется с сайта, брак
   переносится внутрь съёмки. Очистка ретуши запускается отдельной кнопкой. */

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
  cbBusyShow('Проверяю, всё ли дошло до сайта или брака…', 0.2);
  return cpArchVerify(sel, true).then(function (c) {
    cbBusyHide();
    if (CP.sel !== sel) return;
    if (!cpArchIsComplete(c)) { cbToast('Съёмка ещё не готова к архиву. Проверьте сайт и брак.'); return; }
    return cpArchiveVerified(sel, root, c);
  }, function (e) { cbBusyHide(); cpHandleError(e, 'Проверить готовность к архиву'); });
}

function cpArchiveVerified(sel, root, c) {
  var site = cpArchStagePaths('site', sel.name);
  var base = root.replace(/\/+$/, '') + '/' + sel.name;
  var msg = 'Перенести съёмку «' + sel.name + '» в ' + cpFolderBase(root) + '?\n\n'
    + 'На сайте: ' + c.site + ' · В браке: ' + c.brak + '.\n'
    + 'Исходники переедут в архив. Готовые файлы скопируются в «Готово». Копии забракованных артикулов хранятся в «_БРАК».';
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
  }).then(function () {
    /* 3. брак — внутрь съёмки */
    var brak = root.replace(/\/+$/, '') + '/_БРАК/' + CPDisk.safeName(sel.name);
    return Promise.all([cpArticleMeta(brak), cpArticleMeta(brak + '/_Версии')]).then(function (folders) {
      if (!folders[0] || folders[1]) return 0;
      cbBusyShow('Переношу старый брак...', 0.75);
      return cpMoveFolder(brak, moved + '/Брак').then(function () { return 1; });
    }).catch(function (e) { report.push('старый брак не перенёсся: ' + ((e && e.message) || e)); return 0; });
  }).then(function () {
    cbBusyHide();
    var now = new Date().toISOString();
    cpMutateState({ path: moved, name: sel.name }, function (data) {
      var m = data.meta.cp;
      m.archivedAt = now;
      m.archiveSite = site;   /* какие папки сайта скопированы — их можно будет убрать через неделю */
      m.events.push({ ts: now, action: 'to_archive', actor: cpActor(), items: [], note: 'в архив: ' + CPDisk.showPath(moved)
        + (site.length ? '; готовое: ' + site.length : '') + (report.length ? '; ' + report.join('; ') : '') });
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
  return CPDisk.listDir(root, null, 3).then(function (items) {
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
      /* архив — последним, после папок этапов (cp-stages.js, cpAfterStages) */
      ready.then(function () { if (typeof cpAfterStages === 'function' && cpCatalog()) cpAfterStages(cpArchNamesLoad); else cpArchNamesLoad(); }, function () { });
    });
    return r;
  };
})(cpLoadShoots);
document.getElementById('cpShelfRefresh').addEventListener('click', function () {
  if (typeof cpAfterStages === 'function' && cpCatalog()) cpAfterStages(cpArchNamesLoad); else setTimeout(cpArchNamesLoad, 50);
});

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
