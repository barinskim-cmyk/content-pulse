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
  return { n: n, site: sum.k[5] || 0, brak: sum.k[6] || 0, rest: n - (sum.k[5] || 0) - (sum.k[6] || 0) };
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

function cpArchiveShoot(sel) {
  var root = cpArchRoot();
  if (!root) { cpCatStageMissing('archive'); return; }
  if (cpArchBusy(sel)) { cbToast('У съёмки ещё идут переносы на Диске — дождитесь, потом «В архив»'); return; }
  var d = (CP.shoots || []).filter(function (x) { return x.path === sel.path; })[0], c = cpArchCount(d);
  var why = !c ? 'сводки по артикулам нет — не знаю, всё ли сдано'
    : !c.n ? 'в съёмке нет артикулов'
      : c.rest ? 'не на сайте и не в браке: ' + c.rest + ' из ' + c.n + ' артикулов' : '';
  var msg = 'Перенести съёмку «' + sel.name + '» в ' + cpFolderBase(root) + '?\n\n'
    + (why ? 'Она ещё не закрыта: ' + why + '.\n\n' : 'Все артикулы на сайте (' + c.site + ') или в браке (' + c.brak + ').\n\n')
    + 'Папка переедет целиком, вместе с отбором и отметками брака. С витрины исходников съёмка уйдёт, найти её можно в фильтре «' + cpFolderBase(root) + '».';
  if (!window.confirm(msg)) return;
  var to = root.replace(/\/+$/, '') + '/' + sel.name;
  var shoot = { path: sel.path, name: sel.name };
  var ready = CP.shoot && CP.shoot.path === sel.path ? cpFlushSave() : Promise.resolve();
  cbBusyShow('Переношу в архив: ' + sel.name + '...', 0.3);
  ready.then(function () {
    return cpMoveFolder(sel.path, to).then(function (moved) {
      cbBusyHide();
      if (CP.shoot && CP.shoot.path === sel.path) { CP.shoot = null; cpShowShelf(); }
      /* запись в отборе уехавшей съёмки: кто и когда отправил в архив */
      cpMutateState({ path: moved, name: sel.name }, function (data) {
        data.meta.cp.events.push({ ts: new Date().toISOString(), action: 'to_archive', actor: cpActor(), items: [], note: 'в архив: ' + CPDisk.showPath(moved) + (why ? ' (не закрыта: ' + why + ')' : '') });
      }).catch(function () { });
      cbToast('В архиве: ' + sel.name);
      CP.sel = null;
      CP.archShoots = null;
      cpLoadShoots();
    }, function (e) {
      cbBusyHide();
      CPQ.add(shoot, { kind: 'move', label: 'В архив: ' + sel.name, items: [{ from: sel.path, path: to }], err: (e && e.message) || '' });
      cbToast('В архив сразу не перенеслось — переношу повторно, не закрывайте страницу (плашка сверху)');
    });
  });
}

(function cpArchCss() {
  var st = document.createElement('style');
  st.textContent = '.cp-arch-ready{color:#9fc2a3}.cp-arch-brak{color:#f2b8a0}.cp-panel-actions .cp-arch-btn-ready{border-color:#9fc2a3;color:#cfe5d2}';
  document.head.appendChild(st);
})();
