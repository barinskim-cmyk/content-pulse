/* ============================================================
   cp-catalogs.js — несколько папок-каталогов и переключение между ними

   Маша, 09.11.2026: «у руководителя должна быть возможность подключить
   несколько папок, в которых точно такая же структура, но одни будут имиджи,
   другие каталог, третья — какая-нибудь имиджевая предметка. Добавлять эти
   папки и переключаться между ними — легко». Список общий для всех
   (решение по умолчанию — Маша не ответила).

   - Слева на витрине — переключатель папок. В нём:
       · соседние папки с той же структурой — находятся сами: те, что лежат
         рядом с текущей и внутри которых есть папки этапов 01–05;
       · папки, добавленные руками: «+ Добавить папку…» — ссылка из браузера
         или путь. Список пишется в настройки.txt каждой из этих папок
         (строка «ещё папки = …»), поэтому его видят все, у кого есть доступ.
   - Выбрали папку — витрина открывает её, как если бы путь вставили в
     шестерёнке: свои этапы, своя служебная папка и свои настройки.
   Префикс: cpCats*.
   ============================================================ */

var CP_CATS_KEY = 'ещё папки';
CP.catsFound = null;     /* {parent, list:[{name, path}]} — соседние каталоги */

/** Родительская папка; у папки в корне Диска (или общего диска) — сам корень «disk:/». */
function cpCatsParent(p) {
  p = String(p || '').replace(/\/+$/, '');
  var i = p.lastIndexOf('/'), r = p.indexOf(':/');
  if (r < 0 || i <= r) return '';
  return i === r + 1 ? p.slice(0, r + 2) : p.slice(0, i);
}
function cpCatsName(p) { return String(p || '').replace(/\/+$/, '').split('/').pop() || p; }

/** Папки, добавленные руками: из «ещё папки = a ; b» в настройках текущей папки. */
function cpCatsManual() {
  var m = new RegExp('^\\s*' + CP_CATS_KEY + '\\s*=\\s*(.*)$', 'im').exec(CP.settingsText || '');
  return m ? m[1].split(';').map(function (x) { return cpNormArchive(x.trim()); }).filter(Boolean) : [];
}

/** Все папки для переключателя: текущая, соседние каталоги, добавленные руками — без повторов. */
function cpCatsAll() {
  var cur = String(CP.archive || '').replace(/\/+$/, ''), seen = {}, out = [];
  function add(p, how) { p = String(p || '').replace(/\/+$/, ''); if (!p || seen[p]) return; seen[p] = true; out.push({ path: p, name: cpCatsName(p), how: how }); }
  add(cur, 'current');
  if (CP.catsFound && CP.catsFound.parent === cpCatsParent(cur)) CP.catsFound.list.forEach(function (x) { add(x.path, 'sibling'); });
  cpCatsManual().forEach(function (p) { add(p, 'manual'); });
  return out;
}

/** Найти соседние каталоги (раз на родительскую папку): рядом с текущей, внутри — этапы 01–05. */
function cpCatsDiscover() {
  var cur = String(CP.archive || '').replace(/\/+$/, ''), parent = cpCatsParent(cur);
  if (!parent || (CP.catsFound && CP.catsFound.parent === parent)) { cpCatsRender(); return; }
  CP.catsFound = { parent: parent, list: [] };
  CPDisk.listDir(parent).then(function (items) {
    /* все каталоги родительской папки, включая текущий: перешли в соседний — из него видно и этот */
    var dirs = items.filter(function (x) { return x.type === 'dir' && x.name.charAt(0) !== '_'; }).slice(0, 20);
    return Promise.all(dirs.map(function (d) {
      /* текущую не перечитываем: каталог ли она, уже известно (витрина читает её один раз) */
      if (d.path.replace(/\/+$/, '') === cur) return cpCatalog() ? { name: d.name, path: d.path } : null;
      return CPDisk.listDir(d.path).then(function (inner) { return cpCatLike(inner) ? { name: d.name, path: d.path } : null; }, function () { return null; });
    }));
  }).then(function (found) {
    if (!CP.catsFound || CP.catsFound.parent !== parent) return;
    CP.catsFound.list = (found || []).filter(Boolean);
    cpCatsRender();
  }, function () { cpCatsRender(); });
}

/* ---------- переключатель ---------- */

function cpCatsRender() {
  var bar = document.getElementById('cpShelfBar');
  if (!bar || !CPDisk.hasToken()) return;
  var box = document.getElementById('cpCats');
  if (!box) {
    box = document.createElement('span');
    box.id = 'cpCats';
    bar.insertBefore(box, bar.firstChild);
    box.addEventListener('change', function (e) {
      var s = e.target.closest('select');
      if (!s) return;
      if (s.value === '+') { s.value = String(CP.archive || '').replace(/\/+$/, ''); cpCatsAdd(); return; }
      cpCatsOpen(s.value);
    });
  }
  var all = cpCatsAll();
  if (all.length < 2 && !cpCatalog()) { box.innerHTML = ''; return; }
  var cur = String(CP.archive || '').replace(/\/+$/, '');
  box.innerHTML = '<select title="Папка съёмок: каталог, имиджи и т. п. — у каждой свои этапы и настройки">'
    + all.map(function (x) { return '<option value="' + cbEsc(x.path) + '"' + (x.path === cur ? ' selected' : '') + '>' + cbEsc(x.name) + '</option>'; }).join('')
    + '<option value="+">+ Добавить папку…</option></select>';
}

/** Открыть папку: как если бы путь вставили в шестерёнке. */
function cpCatsOpen(path) {
  var inp = document.getElementById('cpArchiveInput'), btn = document.getElementById('cpArchiveApply');
  if (!inp || !btn || !path) return;
  CP.stageFilter = '';
  CP.sel = null;
  CP.archShoots = null;
  inp.value = path;
  btn.click();
}

/** Добавить папку руками: проверить, что внутри этапы, записать в «ещё папки» обеих папок. */
function cpCatsAdd() {
  var raw = window.prompt('Ссылка на папку (из адресной строки Яндекс Диска) или путь.\nВнутри должны быть папки этапов: 01_ИСХОДНИКИ, 02…, как в текущей.', '');
  if (!raw) return;
  var path = cpNormArchive(raw).replace(/\/+$/, ''), cur = String(CP.archive || '').replace(/\/+$/, '');
  if (!path || path === cur) return;
  cbBusyShow('Проверяю папку...', 0.3);
  CPDisk.listDir(path).then(function (items) {
    cbBusyHide();
    if (!cpCatLike(items)) { cbToast('В папке нет этапов 01–05 — это не каталог. «Исправить папки» можно сделать, открыв её через шестерёнку.'); return; }
    var mine = cpCatsManual();
    if (mine.indexOf(path) === -1) mine.push(path);
    return cpSaveSetting(CP_CATS_KEY, mine.join(' ; ')).then(function () {
      cpCatsRender();
      cbToast('Папка добавлена: ' + cpCatsName(path) + ' — её видят все, у кого есть доступ к этой папке');
      return cpCatsMirror(path, cur);
    });
  }, function (e) {
    cbBusyHide();
    cbToast(e && e.status === 404 ? 'Такой папки нет (или у вашего аккаунта нет к ней доступа)' : 'Не удалось открыть папку: ' + ((e && e.message) || e));
  });
}

/** Дописать текущую папку в «ещё папки» добавленной — чтобы из неё тоже можно было вернуться. */
function cpCatsMirror(path, back) {
  var file = path + '/_ContentPulse/' + CP_SETTINGS_FILE;
  return CPDisk.proxyFile(file).then(function (b) { return b.text(); }, function (e) { if (e && e.status === 404) return ''; throw e; }).then(function (text) {
    var re = new RegExp('^(\\s*' + CP_CATS_KEY + '\\s*=\\s*)(.*)$', 'im'), m = re.exec(text || '');
    var list = m ? m[2].split(';').map(function (x) { return x.trim(); }).filter(Boolean) : [];
    if (list.some(function (x) { return cpNormArchive(x).replace(/\/+$/, '') === back; })) return;
    list.push(back);
    text = m ? text.replace(re, '$1' + list.join(' ; ')) : (text ? text.replace(/\s*$/, '\n') : '') + CP_CATS_KEY + ' = ' + list.join(' ; ') + '\n';
    return CPDisk.ensureDir(path + '/_ContentPulse').then(function () {
      return CPDisk.uploadBlob(file, new Blob([text], { type: 'text/plain;charset=utf-8' }), true);
    });
  }).catch(function (e) { if (window.console) console.warn('[CP] обратная ссылка не записалась', e && (e.message || e)); });
}

/* витрина прочитана — найти соседей и нарисовать переключатель */
cpLoadShoots = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    Promise.resolve(r).then(function () {
      var ready = typeof cpEnsureSettings === 'function' ? cpEnsureSettings() : Promise.resolve();
      ready.then(cpCatsDiscover, cpCatsDiscover);
    });
    return r;
  };
})(cpLoadShoots);

(function cpCatsCss() {
  var st = document.createElement('style');
  st.textContent = '#cpCats select{background:#1d1d1b;border:1px solid #C9956B;color:#f2f2f1;padding:6px 8px;border-radius:3px;font:inherit;font-weight:600;max-width:240px}';
  document.head.appendChild(st);
})();
