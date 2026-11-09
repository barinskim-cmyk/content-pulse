/* ============================================================
   cp-site.js — вкладка «Сайт» на витрине: «Не скачано» и «Ближайшие даты»

   Маша, 09.11.2026: «во вкладке „Сайт“ нужно, чтобы были фильтры „Не скачано“
   (то, что никогда не было скачано из „Сайта“) и фильтр с ближайшими датами».

   Сайт: 05_САЙТ/<дата>/<съёмка>/<артикул>. У каждой папки <дата>/<съёмка> —
   метка на Диске (custom_properties): cp_dl — когда скачали отсюда, cp_dl_by — кто.
   Метку ставит «Скачать всё из 05_САЙТ» в панели съёмки (скачали всё, что там
   лежит). Приехало новое в ту же дату («На сайт») — метка снимается: снова «не
   скачано». Метка живёт на сервере — видна всем, кто открывает витрину.

   «Ближайшие даты» — папки дат за последние CP.siteRecentDays дней; в «Сайте»
   съёмки всегда идут от свежей даты к старой.
   ============================================================ */

CP.siteSub = cpGet('cp_site_sub', '') || '';
CP.siteRecentDays = 7;

/** Дата папки «Сайта» (родитель папки съёмки) как ГГГГ-ММ-ДД; '' — не дата. */
function cpSiteDateOf(path) {
  var nm = cpFolderBase(String(path || '').slice(0, String(path || '').lastIndexOf('/')));
  var z = function (n) { n = String(+n); return n.length < 2 ? '0' + n : n; };
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(nm);
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{2}|\d{4}))?$/.exec(nm);
  if (m) return (m[3] ? (m[3].length === 2 ? '20' + m[3] : m[3]) : String(new Date().getFullYear())) + '-' + z(m[2]) + '-' + z(m[1]);
  return '';
}

/** Папки съёмки в «Сайте»: [{path, date, dl, by}], свежие сверху. */
function cpSiteFolders(name) {
  var low = String(name).toLowerCase();
  var paths = (CP.stagePaths && CP.stagePaths.site && CP.stagePaths.site[low]) || [];
  var info = (CP.stageInfo && CP.stageInfo.site) || {};
  return paths.map(function (p) {
    var pr = (info[p] && info[p].props) || {};
    return { path: p, date: cpSiteDateOf(p), dl: pr.cp_dl || '', by: pr.cp_dl_by || '' };
  }).sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : 0; });
}

function cpSiteRecentFrom() {
  var d = new Date(Date.now() - (CP.siteRecentDays - 1) * 864e5), z = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
}

function cpSiteMatch(name, sub) {
  var fs = cpSiteFolders(name);
  if (sub === 'new') return fs.some(function (f) { return !f.dl; });
  if (sub === 'recent') { var from = cpSiteRecentFrom(); return fs.some(function (f) { return f.date && f.date >= from; }); }
  return true;
}

function cpSiteFmt(date) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || ''); return m ? m[3] + '.' + m[2] + '.' + m[1] : date || 'без даты'; }

cpRenderShoots = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    var list = document.getElementById('cpShelfList');
    if (!list || CP.stageFilter !== 'site' || !CP.shoots) return r;
    var rows = Array.prototype.slice.call(list.querySelectorAll('.cp-shoot'));
    if (!rows.length) return r;
    var sub = CP.siteSub, n = { '': 0, 'new': 0, recent: 0 };
    var latest = {};
    rows.forEach(function (b) {
      var name = b.getAttribute('data-name'), fs = cpSiteFolders(name);
      latest[name] = fs.length ? fs[0].date : '';
      n['']++;
      if (cpSiteMatch(name, 'new')) n['new']++;
      if (cpSiteMatch(name, 'recent')) n.recent++;
      if (!cpSiteMatch(name, sub)) b.style.display = 'none';
      /* под съёмкой: даты в «Сайте» и скачано ли */
      if (fs.length && !b.querySelector('.cp-site-dates')) {
        b.insertAdjacentHTML('beforeend', '<div class="cp-site-dates">' + fs.map(function (f) {
          return '<span class="' + (f.dl ? 'cp-site-dl' : 'cp-site-new') + '">' + cbEsc(cpSiteFmt(f.date)) + ' · '
            + (f.dl ? 'скачано ' + cbEsc(cpFmtDate(f.dl)) + (f.by ? ' · ' + cbEsc(f.by) : '') : 'не скачано') + '</span>';
        }).join('') + '</div>');
      }
    });
    /* от свежей даты к старой */
    rows.slice().sort(function (a, b) {
      var x = latest[a.getAttribute('data-name')] || '', y = latest[b.getAttribute('data-name')] || '';
      return x < y ? 1 : x > y ? -1 : 0;
    }).forEach(function (b) { list.appendChild(b); });
    var chip = function (k, label) {
      return '<button class="cp-fchip' + (sub === k ? ' cp-on' : '') + '" data-cp-site-sub="' + k + '">' + label + ' <small>' + n[k] + '</small></button>';
    };
    list.insertAdjacentHTML('afterbegin', '<div class="cp-site-subs" id="cpSiteSubs">' + chip('', 'Все') + chip('new', 'Не скачано')
      + chip('recent', 'Ближайшие даты <small>(' + CP.siteRecentDays + ' дней)</small>') + '</div>');
    if (!rows.some(function (b) { return b.style.display !== 'none'; })) {
      list.insertAdjacentHTML('beforeend', '<div class="cp-empty">' + (sub === 'new' ? 'Всё, что лежит в «Сайте», уже скачано' : 'За последние ' + CP.siteRecentDays + ' дней в «Сайт» ничего не приходило') + '</div>');
    }
    return r;
  };
})(cpRenderShoots);

document.getElementById('cpShelfList').addEventListener('click', function (e) {
  var b = e.target.closest('[data-cp-site-sub]');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  CP.siteSub = b.getAttribute('data-cp-site-sub');
  cpSet('cp_site_sub', CP.siteSub);
  cpRenderShoots();
}, true);

/** Скачали из «Сайта» — пометить папки <дата>/<съёмка> (только те, что ушли в архив целиком). */
function cpSiteMarkDownloaded(roots) {
  if (!roots.length) return Promise.resolve();
  var now = new Date().toISOString(), who = cpActor();
  var info = (CP.stageInfo = CP.stageInfo || {}).site = CP.stageInfo.site || {};
  roots.forEach(function (p) {
    var it = info[p] = info[p] || { props: {} };
    it.props = Object.assign({}, it.props, { cp_dl: now, cp_dl_by: who });
  });
  if (CP.shoots && CP.stageFilter === 'site') cpRenderShoots();
  return cpPool(roots, 3, function (p) {
    return CPDisk.proxyProps(p, { cp_dl: now, cp_dl_by: who }).catch(function (e) {
      if (window.console) console.warn('[CP] метка «скачано» не записалась', p, e && (e.body || e.message || e));
    });
  });
}

/** В «Сайт» приехало новое — у папки даты снова «не скачано». */
function cpSiteMarkNew(paths) {
  var info = (CP.stageInfo = CP.stageInfo || {}).site = CP.stageInfo.site || {};
  paths.forEach(function (p) { if (info[p] && info[p].props) info[p].props = Object.assign({}, info[p].props, { cp_dl: null, cp_dl_by: null }); });
  return cpPool(paths, 3, function (p) { return CPDisk.proxyProps(p, { cp_dl: null, cp_dl_by: null }).catch(function () { }); });
}

(function cpSiteCss() {
  var st = document.createElement('style');
  st.textContent = '.cp-site-subs{grid-column:1/-1;display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0 0 4px}'
    + '.cp-site-subs .cp-fchip{font:inherit;font-size:12px;padding:3px 10px;border-radius:12px;border:1px solid #3a3a37;background:transparent;color:#cfcac2;cursor:pointer}'
    + '.cp-site-subs .cp-fchip small{color:#8a877f}.cp-site-subs .cp-fchip.cp-on{border-color:#C9956B;background:#2b231c;color:#f2e2cf}'
    + '.cp-site-dates{display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:6px;font-size:11px}'
    + '.cp-site-new{color:#e7c9a8}.cp-site-dl{color:#8a877f}';
  document.head.appendChild(st);
})();
