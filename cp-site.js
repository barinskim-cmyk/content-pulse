/* ============================================================
   cp-site.js — вкладка «Сайт» на витрине: папки дат и «скачано»

   Маша, 09.11.2026: «на сайте нужно, чтобы были показаны папки дат, потому что
   так непонятно: важна не сама съёмка, а дата и что в эту дату сдано. Когда мы
   говорим, скачано или нет, — скачано из конкретной папки, скачивал это кто-то
   или нет». Решения Маши: «скачано» — по папке артикула (приехало новое в ту же
   дату — оно «не скачано», можно докачать только его); при скачивании по
   умолчанию качается всё из этой даты, галочкой — пропустить уже скачанное.

   Сайт: 05_САЙТ/<дата>/<съёмка>/<артикул>/файлы. На витрине во вкладке «Сайт» —
   плитки дат (свежие сверху): какие съёмки, сколько артикулов и сколько из них
   не скачано. Выбрали дату — справа дерево: съёмки → артикулы, у каждого
   «скачано когда · кто» или «не скачано», кнопка «Скачать».

   «Скачано» — метка на папке артикула на Диске (custom_properties cp_dl — когда,
   cp_dl_by — кто): видна всем, кто открывает витрину. Папка артикула — та, где
   лежат файлы; файлы прямо в папке даты — метка на ней самой.
   ============================================================ */

CP.siteSub = cpGet('cp_site_sub', '') || '';
if (CP.siteSub !== 'new' && CP.siteSub !== 'recent') CP.siteSub = '';
CP.siteRecentDays = 7;
CP.siteScanMax = 30;        /* сразу читаем столько свежих дат; старые — когда их открыли */
CP.siteDates = null;        /* [{path, name, date}] */
CP.siteDatesAt = 0;
CP.siteScan = {};           /* путь даты -> {at, files, dirs, props, error} */

function cpSiteRootPath() { return String((CP.settings && CP.settings.site) || '').replace(/\/+$/, ''); }

/** Имя папки как дата ГГГГ-ММ-ДД; '' — не дата. */
function cpSiteDateName(nm) {
  var z = function (n) { n = String(+n); return n.length < 2 ? '0' + n : n; };
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(nm || '');
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2}|\d{4}))?$/.exec(nm || '');
  if (m) return (m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : String(new Date().getFullYear())) + '-' + z(m[2]) + '-' + z(m[1]);
  return '';
}
function cpSiteFmt(date) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || ''); return m ? m[3] + '.' + m[2] + '.' + m[1] : date || ''; }

function cpSiteRecentFrom() {
  var d = new Date(Date.now() - (CP.siteRecentDays - 1) * 864e5), z = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
}

/* ---------- чтение «Сайта» ---------- */

var _cpSiteBusy = false;
/** Список дат и (в фоне) содержимое свежих. */
function cpSiteRefresh(force) {
  var root = cpSiteRootPath();
  if (!root || _cpSiteBusy) return Promise.resolve();
  if (CP.siteDatesRoot !== root) { CP.siteDates = null; CP.siteScan = {}; CP.siteDatesAt = 0; }
  if (!force && CP.siteDates && Date.now() - CP.siteDatesAt < 40000) return Promise.resolve();
  _cpSiteBusy = true;
  return cpListDirs(root).then(function (ds) {
    CP.siteDatesRoot = root;
    CP.siteDates = ds.filter(function (d) { return d.name.charAt(0) !== '_'; }).map(function (d) {
      return { path: d.path, name: d.name, date: cpSiteDateName(d.name) };
    }).sort(function (a, b) { var x = a.date || a.name, y = b.date || b.name; return x < y ? 1 : x > y ? -1 : 0; });
    CP.siteDatesAt = Date.now();
    cpSiteRerender();
    /* Маша, 10.11.2026: «читать 7 дней на витрине». Сами (раз в 40 с) перечитываются только даты
       за последние CP.siteRecentDays дней — «Сайт» копится навсегда, и опрос рос вместе с ним.
       Даты старше (до CP.siteScanMax самых свежих) читаются один раз за сессию — чтобы «Не скачано»
       оставалось верным; перечитать их — «Обновить» или открыть дату. */
    var from = cpSiteRecentFrom();
    var need = CP.siteDates.filter(function (d, i) {
      var sc = CP.siteScan[d.path], recent = !!d.date && d.date >= from;
      if (force) return recent || i < CP.siteScanMax;
      if (recent) return !sc || Date.now() - sc.at > 40000;
      return i < CP.siteScanMax && !sc;
    });
    return cpPool(need, 2, function (d) { return cpSiteScanDate(d.path).then(cpSiteRerender); });
  }).catch(function (e) {
    if (window.console) console.warn('[CP] «Сайт» не прочитался', e && (e.body || e.message || e));
  }).then(function () { _cpSiteBusy = false; });
}

/** Содержимое одной даты: все файлы, папки и их метки. */
function cpSiteScanDate(path) {
  return CPDisk.walkPhotos(path, false, 4, true).then(function (files) {
    CP.siteScan[path] = { at: Date.now(), files: files.filter(function (f) { return f.name !== CPDisk.STATE_FILE; }), dirs: files.dirs || [], props: files.dirProps || {} };
  }, function (e) {
    CP.siteScan[path] = { at: Date.now(), files: [], dirs: [], props: {}, error: e };
  });
}

var _cpSiteRerender = null;
function cpSiteRerender() {
  clearTimeout(_cpSiteRerender);
  _cpSiteRerender = setTimeout(function () {
    if (CP.stageFilter === 'site' && CP.shoots) cpRenderShoots();
    if (CP.sel && CP.sel.siteDate) cpRenderPanel();
  }, 60);
}

/** Сводка даты: съёмки, артикулы (папки с файлами) и что скачано. */
function cpSiteSummary(datePath) {
  var sc = CP.siteScan[datePath];
  if (!sc) return null;
  var units = {}, shoots = {};
  sc.files.forEach(function (f) {
    var dir = cpParentDir(f.path);
    var u = units[dir] || (units[dir] = { path: dir, files: [], bytes: 0 });
    u.files.push(f);
    u.bytes += f.size || 0;
    var rel = dir.length > datePath.length ? dir.slice(datePath.length + 1) : '';
    if (rel) shoots[rel.split('/')[0]] = true;
  });
  var list = Object.keys(units).sort().map(function (k) {
    var u = units[k], pr = cpSiteMarkOf(sc, datePath, u.path);
    u.dl = pr.cp_dl || ''; u.by = pr.cp_dl_by || '';
    return u;
  });
  return {
    units: list, shoots: Object.keys(shoots).sort(),
    nNew: list.filter(function (u) { return !u.dl; }).length,
    files: sc.files.length, bytes: list.reduce(function (a, u) { return a + u.bytes; }, 0),
    last: list.reduce(function (a, u) { return u.dl && (!a || u.dl > a.dl) ? u : a; }, null)
  };
}

/** Метка «скачано» папки артикула (или папки выше — так помечали в 2.0.72). */
function cpSiteMarkOf(sc, datePath, dir) {
  for (var d = dir; d && d.length >= datePath.length; d = cpParentDir(d)) {
    var pr = sc.props[d] || (d === datePath ? sc.rootProps : null);
    if (pr && pr.cp_dl) return pr;
    if (d === datePath) break;
  }
  return {};
}

function cpSiteMatch(d, sub, q, i) {
  var sum = cpSiteSummary(d.path);
  if (q) {
    var hay = (d.name + ' ' + cpSiteFmt(d.date) + ' ' + (sum ? sum.shoots.join(' ') : '')).toLowerCase();
    if (hay.indexOf(q) === -1) return false;
  }
  /* не прочитана: свежая — показываем, пока читается; старая (дальше CP.siteScanMax) — пока не открыли, не знаем */
  if (sub === 'new') return sum ? sum.nNew > 0 : i < CP.siteScanMax;
  if (sub === 'recent') return !!d.date && d.date >= cpSiteRecentFrom();
  return true;
}

/* ---------- витрина: плитки дат ---------- */

cpRenderShoots = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    var list = document.getElementById('cpShelfList');
    /* во вкладке «Сайт» считаем даты, а не съёмки */
    var tab = document.querySelector('#cpStages [data-cp-stage="site"] small');
    if (tab && CP.siteDates && CP.siteDatesRoot === cpSiteRootPath()) tab.textContent = CP.siteDates.length;
    if (!list || CP.stageFilter !== 'site' || !cpSiteRootPath()) return r;
    if (!CP.siteDates) {
      list.innerHTML = '<div class="cp-empty">Читаю папку ' + cbEsc(cpStageLabel('site')) + '…</div>';
      cpSiteRefresh();
      return r;
    }
    cpSiteRefresh();
    var q = (document.getElementById('cpShelfSearch').value || '').trim().toLowerCase(), sub = CP.siteSub;
    var n = { '': 0, 'new': 0, recent: 0 };
    CP.siteDates.forEach(function (d, i) {
      if (cpSiteMatch(d, '', q, i)) n['']++;
      if (cpSiteMatch(d, 'new', q, i)) n['new']++;
      if (cpSiteMatch(d, 'recent', q, i)) n.recent++;
    });
    var chip = function (k, label) {
      return '<button class="cp-fchip' + (sub === k ? ' cp-on' : '') + '" data-cp-site-sub="' + k + '">' + label + ' <small>' + n[k] + '</small></button>';
    };
    var html = '<div class="cp-site-subs" id="cpSiteSubs">' + chip('', 'Все даты') + chip('new', 'Не скачано')
      + chip('recent', 'Ближайшие даты <small>(' + CP.siteRecentDays + ' дней)</small>') + '</div>';
    var shown = CP.siteDates.filter(function (d, i) { return cpSiteMatch(d, sub, q, i); });
    html += shown.map(function (d) {
      var sum = cpSiteSummary(d.path), sel = CP.sel && CP.sel.siteDate === d.path;
      var meta = sum ? (sum.shoots.length ? 'съёмок ' + sum.shoots.length + ' · ' : '') + 'артикулов ' + sum.units.length + ' · файлов ' + sum.files + ' · ' + cpMb(sum.bytes) : 'читаю…';
      var state = !sum ? '' : !sum.units.length ? '<span class="cp-site-dl">пусто</span>'
        : sum.nNew ? '<span class="cp-site-new">не скачано ' + sum.nNew + ' из ' + sum.units.length + '</span>'
          : '<span class="cp-site-dl">всё скачано' + (sum.last ? ' · ' + cbEsc(cpFmtDate(sum.last.dl)) + (sum.last.by ? ' · ' + cbEsc(sum.last.by) : '') : '') + '</span>';
      return '<button class="cp-date' + (sel ? ' cp-date-sel' : '') + '" data-cp-date="' + cbEsc(d.path) + '">'
        + '<div class="cp-date-name">' + cbEsc(d.date ? cpSiteFmt(d.date) : d.name) + (d.date && d.name !== d.date ? ' <small>' + cbEsc(d.name) + '</small>' : '') + '</div>'
        + '<div class="cp-date-meta">' + meta + '</div>'
        + (sum && sum.shoots.length ? '<div class="cp-date-shoots">' + sum.shoots.slice(0, 4).map(cbEsc).join('<br>') + (sum.shoots.length > 4 ? '<br>и ещё ' + (sum.shoots.length - 4) : '') + '</div>' : '')
        + (state ? '<div class="cp-site-dates">' + state + '</div>' : '') + '</button>';
    }).join('');
    if (!shown.length) html += '<div class="cp-empty">' + (!CP.siteDates.length ? 'В папке ' + cbEsc(cpStageLabel('site')) + ' пока пусто'
      : sub === 'new' ? 'Всё, что лежит в ' + cbEsc(cpStageLabel('site')) + ', уже скачано' : sub === 'recent' ? 'За последние ' + CP.siteRecentDays + ' дней ничего не приходило' : 'Ничего не найдено') + '</div>';
    list.innerHTML = html;
    return r;
  };
})(cpRenderShoots);

document.getElementById('cpShelfList').addEventListener('click', function (e) {
  var b = e.target.closest('[data-cp-site-sub]');
  if (b) {
    e.preventDefault(); e.stopPropagation();
    CP.siteSub = b.getAttribute('data-cp-site-sub');
    cpSet('cp_site_sub', CP.siteSub);
    cpRenderShoots();
    return;
  }
  var t = e.target.closest('[data-cp-date]');
  if (!t) return;
  e.preventDefault(); e.stopPropagation();
  cpSiteSelectDate(t.getAttribute('data-cp-date'));
}, true);

/* ---------- панель даты ---------- */

function cpSiteSelectDate(path) {
  var d = (CP.siteDates || []).filter(function (x) { return x.path === path; })[0] || { path: path, name: cpFolderBase(path), date: cpSiteDateName(cpFolderBase(path)) };
  CP.sel = { siteDate: path, name: d.name, date: d.date, open: {}, skipDl: false, folders: {}, files: [], dirs: [] };
  cpRenderShoots();
  cpRenderPanel();
  /* открыли дату — её содержимое свежее (старые даты читаются только сейчас) */
  var sel = CP.sel;
  cpSiteScanDate(path).then(function () { if (CP.sel === sel) { cpRenderPanel(); cpRenderShoots(); } });
}

/** Файлы даты, которые скачаются сейчас (с галочкой — без уже скачанного). */
function cpSitePicked(sel, sum) {
  var out = [];
  (sum ? sum.units : []).forEach(function (u) { if (!(sel.skipDl && u.dl)) out.push(u); });
  return out;
}

cpRenderPanel = (function (orig) {
  return function () {
    var sel = CP.sel;
    if (!sel || !sel.siteDate) return orig.apply(this, arguments);
    var panel = document.getElementById('cpPanel');
    panel.classList.add('cp-open');
    var label = cpStageLabel('site'), title = sel.date ? cpSiteFmt(sel.date) : sel.name;
    var head = '<div class="cp-panel-head"><div><b>' + cbEsc(title) + '</b><small>в папке ' + cbEsc(label) + ' — что сдано в этот день</small></div>'
      + '<span class="cp-sp"></span><button data-cp-p="close" title="Закрыть панель">×</button></div>';
    var sum = cpSiteSummary(sel.siteDate);
    if (!sum) {
      panel.innerHTML = head + '<div class="cp-panel-body"><div class="cp-note">Читаю папку…</div></div><div class="cp-panel-actions"><div class="cp-sum"></div></div>';
      return;
    }
    var root = sel.siteDate, body = '';
    /* съёмка → артикулы; артикулы, лежащие глубже (бренд/артикул), — путь целиком */
    var groups = {}, order = [];
    sum.units.forEach(function (u) {
      var rel = u.path.length > root.length ? u.path.slice(root.length + 1) : '';
      var top = rel ? rel.split('/')[0] : '';
      if (!groups[top]) { groups[top] = []; order.push(top); }
      groups[top].push({ u: u, rel: rel ? rel.split('/').slice(1).join('/') : '' });
    });
    order.forEach(function (top) {
      var g = groups[top], nNew = g.filter(function (x) { return !x.u.dl; }).length;
      if (sel.open[top] === undefined) sel.open[top] = order.length === 1;   /* одна съёмка — сразу раскрыта */
      var open = sel.open[top];
      if (top) {
        body += '<div class="cp-fold"><span>' + cbEsc(top) + ' <small>· артикулов ' + g.length + (nNew ? ' · <b class="cp-site-new">не скачано ' + nNew + '</b>' : ' · скачано') + '</small></span>'
          + '<button class="cp-fold-exp" data-cp-exp="' + cbEsc(top) + '">' + (open ? 'свернуть' : 'показать') + '</button></div>';
      }
      if (open || !top) g.forEach(function (x) {
        body += '<div class="cp-fold cp-fold-sub" style="padding-left:' + (top ? 18 : 0) + 'px"><span>' + cbEsc(x.rel || (top ? '(файлы в папке съёмки)' : '(файлы в папке даты)'))
          + ' <small>· ' + x.u.files.length + ' · ' + cpMb(x.u.bytes) + '</small></span><span class="cp-fold-props">'
          + (x.u.dl ? '<span class="cp-site-dl">скачано ' + cbEsc(cpFmtDate(x.u.dl)) + (x.u.by ? ' · ' + cbEsc(x.u.by) : '') + '</span>' : '<span class="cp-site-new">не скачано</span>')
          + '</span></div>';
      });
    });
    if (!sum.units.length) body += '<div class="cp-note">Папка пустая.</div>';
    var sc = CP.siteScan[sel.siteDate];
    if (sc && sc.error) body += '<div class="cp-note cp-warn">Не прочиталась: ' + cbEsc(CPDisk.showPath(sel.siteDate)) + '</div>';
    body += '<div class="cp-note">' + cbEsc(CPDisk.showPath(sel.siteDate)) + '</div>';
    var picked = cpSitePicked(sel, sum), nFiles = 0, bytes = 0;
    picked.forEach(function (u) { nFiles += u.files.length; bytes += u.bytes; });
    var nDone = sum.units.length - sum.nNew;
    panel.innerHTML = head + '<div class="cp-panel-body">' + body + '</div><div class="cp-panel-actions"><div class="cp-sum">Артикулов: <b>' + sum.units.length + '</b>'
      + (sum.nNew ? ' · не скачано <b>' + sum.nNew + '</b>' : ' · всё скачано') + ' · файлов ' + sum.files + ' · ' + cpMb(sum.bytes) + '</div>'
      + (nDone ? '<label class="cp-site-skip"><input type="checkbox" data-cp-site-skip' + (sel.skipDl ? ' checked' : '') + '> пропустить уже скачанное (' + nDone + ')</label>' : '')
      + '<button class="cb-primary" data-cp-site-dl="1"' + (nFiles ? '' : ' disabled') + '>' + (sel.skipDl ? 'Скачать нескачанное' : 'Скачать всё за ' + cbEsc(title)) + ' · ' + nFiles + ' файл(ов)</button></div>';
  };
})(cpRenderPanel);

document.getElementById('cpPanel').addEventListener('change', function (e) {
  var sel = CP.sel;
  if (!sel || !sel.siteDate || !e.target.hasAttribute('data-cp-site-skip')) return;
  sel.skipDl = e.target.checked;
  cpRenderPanel();
});

document.getElementById('cpPanel').addEventListener('click', function (e) {
  var sel = CP.sel;
  if (!sel || !sel.siteDate || !e.target.closest('[data-cp-site-dl]')) return;
  e.preventDefault();
  var sum = cpSiteSummary(sel.siteDate);
  var units = cpSitePicked(sel, sum), root = sel.siteDate, entries = [];
  units.forEach(function (u) {
    u.files.forEach(function (f) { entries.push({ from: f.path, size: f.size, name: f.path.slice(root.length + 1) }); });
  });
  if (!entries.length) return;
  var title = sel.date ? sel.date : sel.name;
  var name = CPDisk.safeName(cpStageLabel('site')) + '_' + CPDisk.safeName(title) + (sel.skipDl ? '_нескачанное' : '');
  cpExportBundle(name, entries, cpStageLabel('site') + ' за ' + (sel.date ? cpSiteFmt(sel.date) : sel.name) + ': артикулов ' + units.length + ', файлов ' + entries.length + '.')
    .then(function () { return cpSiteMarkDownloaded(root, units.map(function (u) { return u.path; })); })
    .catch(function (err) { cpHandleError(err, 'Скачивание'); });
});

/** Скачали — пометить папки артикулов (метка на Диске, видна всем). */
function cpSiteMarkDownloaded(datePath, dirs) {
  if (!dirs.length) return Promise.resolve();
  var now = new Date().toISOString(), who = cpActor();
  var sc = CP.siteScan[datePath];
  dirs.forEach(function (d) {
    if (!sc) return;
    if (d === datePath) sc.rootProps = Object.assign({}, sc.rootProps || {}, { cp_dl: now, cp_dl_by: who });
    else sc.props[d] = Object.assign({}, sc.props[d] || {}, { cp_dl: now, cp_dl_by: who });
  });
  cpSiteRerender();
  return cpPool(dirs, 3, function (p) {
    return CPDisk.proxyProps(p, { cp_dl: now, cp_dl_by: who }).catch(function (e) {
      if (window.console) console.warn('[CP] метка «скачано» не записалась', p, e && (e.body || e.message || e));
    });
  });
}

/** В «Сайт» приехало новое («На сайт»): старая метка у папки съёмки (2.0.72) снимается, дата перечитывается. */
function cpSiteMarkNew(paths) {
  paths.forEach(function (p) {
    var date = cpParentDir(p);
    delete CP.siteScan[date];
    CP.siteDatesAt = 0;
  });
  return cpPool(paths, 3, function (p) { return CPDisk.proxyProps(p, { cp_dl: null, cp_dl_by: null }).catch(function () { }); });
}

/* «Обновить» на витрине — «Сайт» тоже перечитывается */
(function () {
  var b = document.getElementById('cpShelfRefresh');
  if (b) b.addEventListener('click', function () { CP.siteDatesAt = 0; CP.siteScan = {}; });
})();

(function cpSiteCss() {
  var st = document.createElement('style');
  st.textContent = '.cp-site-subs{grid-column:1/-1;display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0 0 4px}'
    + '.cp-site-subs .cp-fchip{font:inherit;font-size:12px;padding:3px 10px;border-radius:12px;border:1px solid #3a3a37;background:transparent;color:#cfcac2;cursor:pointer}'
    + '.cp-site-subs .cp-fchip small{color:#8a877f}.cp-site-subs .cp-fchip.cp-on{border-color:#C9956B;background:#2b231c;color:#f2e2cf}'
    + '.cp-date{text-align:left;padding:14px 16px;border:1px solid #2a2a28;background:#1a1a18;border-radius:4px;cursor:pointer;color:#f2f2f1;font:inherit}'
    + '.cp-date:hover{border-color:#C9956B}.cp-date-sel{border-color:#C9956B;background:#221d18}'
    + '.cp-date-name{font-size:16px;font-weight:600}.cp-date-name small{font-size:11px;color:#8a877f;font-weight:400;margin-left:6px}'
    + '.cp-date-meta{margin-top:6px;font-size:12px;color:#a3a09a;line-height:1.5}'
    + '.cp-date-shoots{margin-top:8px;font-size:12px;color:#cfcac2;line-height:1.5;word-break:break-word}'
    + '.cp-site-dates{display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:8px;font-size:12px}'
    + '.cp-site-new{color:#e7c9a8}.cp-site-dl{color:#8a877f}'
    + '.cp-site-skip{display:inline-flex;gap:6px;align-items:center;font-size:12px;color:#cfcac2;cursor:pointer}';
  document.head.appendChild(st);
})();
