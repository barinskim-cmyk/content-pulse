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

   Что нужно сделать (съёмка попадает во все подходящие фильтры):
     Отбор        — отбора ещё нет (ни одной карточки с кадрами)
                    или есть пустые карточки товара (артикулы без кадров);
     Ретушь       — есть кадры на ретуши, которые ещё не скачали;
     Согласование — есть карточки или кадры «на согласовании».
   ============================================================ */

var CP_SUM_KEY = 'cp_sum';
CP.sumWritten = {};       /* путь съёмки -> последняя записанная строка сводки */
CP.stageFilter = cpGet('cp_stage', '') || '';

/** Сводка отбора: {cards, filled, empty, rt, ra, ap, rs, del} */
function cpShootSummary(data) {
  data = data || {};
  var cp = (data.meta || {}).cp || {};
  var status = cp.status || {}, cardStatus = cp.cardStatus || {}, dl = cp.downloads || {}, del = cp.delivered || {};
  var s = { cards: 0, filled: 0, empty: 0, rt: 0, ra: 0, ap: 0, rs: 0, del: Object.keys(del).length };
  (data.cards || []).forEach(function (c) {
    s.cards++;
    var pids = c.mode === 'auto' ? (c.pids || []) : (c.slots || []).map(function (x) { return x.pid; }).filter(Boolean);
    if (pids.length) s.filled++;
    else if (c.cpArticle || c.cpAuto) s.empty++;
    if (cardStatus[c.id] && cardStatus[c.id].s === 'approval') s.ap++;
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
  return 'v1;n=' + s.cards + ';f=' + s.filled + ';e=' + s.empty + ';rt=' + s.rt + ';ra=' + s.ra + ';ap=' + s.ap + ';rs=' + s.rs + ';d=' + s.del;
}

function cpSumDecode(str) {
  if (!str || !/^v1;/.test(str)) return null;
  var m = {};
  str.split(';').slice(1).forEach(function (kv) { var p = kv.split('='); m[p[0]] = +p[1] || 0; });
  return { cards: m.n || 0, filled: m.f || 0, empty: m.e || 0, rt: m.rt || 0, ra: m.ra || 0, ap: m.ap || 0, rs: m.rs || 0, del: m.d || 0 };
}

/** Что нужно сделать: {select, retouch, approval}; none — отбора ещё нет */
function cpStagesOf(sum) {
  if (!sum) return null;
  return {
    select: sum.filled === 0 || sum.empty > 0,
    retouch: sum.rt > 0,
    approval: sum.ap > 0
  };
}

/* ---------- запись сводки после сохранения отбора ---------- */

function cpWriteSummary(shootPath, data, force) {
  if (!CPDisk.hasProxy()) return Promise.resolve();
  var str = cpSumEncode(cpShootSummary(data));
  if (!force && CP.sumWritten[shootPath] === str) return Promise.resolve();
  return CPDisk.proxyProps(shootPath, { cp_sum: str }).then(function () {
    CP.sumWritten[shootPath] = str;
    /* витрина уже загружена — обновляем строку этой съёмки */
    (CP.shoots || []).forEach(function (d) {
      if (d.path === shootPath) { d.custom_properties = d.custom_properties || {}; d.custom_properties.cp_sum = str; }
    });
  }, function (e) {
    if (window.console) console.warn('[CP] сводка съёмки не записалась', shootPath, e && (e.body || e.message));
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

/** Что нужно сделать со съёмкой; отбора нет совсем — нужен отбор; null — ещё не знаем. */
function cpStagesFor(d) {
  var sum = cpSumOf(d);
  if (sum) return cpStagesOf(sum);
  return d.cpSumDone ? { select: true, retouch: false, approval: false } : null;
}

var CP_STAGES = [
  { key: '', label: 'Все' },
  { key: 'select', label: 'Отбор' },
  { key: 'retouch', label: 'Ретушь' },
  { key: 'approval', label: 'Согласование' }
];

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
  var counts = { '': shoots.length, select: 0, retouch: 0, approval: 0 }, pending = 0;
  shoots.forEach(function (d) {
    var st = cpStagesFor(d);
    if (!st) { pending++; return; }
    ['select', 'retouch', 'approval'].forEach(function (k) { if (st[k]) counts[k]++; });
  });
  box.innerHTML = CP_STAGES.map(function (s) {
    return '<button data-cp-stage="' + s.key + '"' + (CP.stageFilter === s.key ? ' class="cp-on"' : '') + '>' + s.label
      + ' <small>' + counts[s.key] + '</small></button>';
  }).join('') + (pending ? '<small class="cp-stages-wait" title="Съёмки без сводки: читаю их отборы">считаю ' + pending + '…</small>' : '');
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
      if (!sum) parts.push(d && d.cpSumDone ? '<span class="cp-todo-s">отбора нет</span>' : '<span class="cp-todo-w">считаю…</span>');
      else {
        if (sum.filled === 0) parts.push('<span class="cp-todo-s">отбора нет</span>');
        else if (sum.empty) parts.push('<span class="cp-todo-s">пустых карточек: ' + sum.empty + '</span>');
        if (sum.rt) parts.push('<span class="cp-todo-r">ретушь: ' + sum.rt + '</span>');
        if (sum.ap) parts.push('<span class="cp-todo-a">согласование: ' + sum.ap + '</span>');
        if (sum.del) parts.push('<span class="cp-todo-d">сдано: ' + sum.del + '</span>');
      }
      if (parts.length) meta.insertAdjacentHTML('beforeend', '<span class="cp-todo">' + parts.join(' · ') + '</span>');
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
    return CPDisk.readState(d.path).then(function (st) {
      d.cpSumDone = true;
      if (!st || !st.data) return;   /* отбора ещё нет */
      d.cpSum = cpShootSummary(st.data);
      return cpWriteSummary(d.path, st.data, true);
    }, function () { d.cpSumDone = true; }).then(function () { redraw(); return next(); });
  }
  return Promise.all([next(), next(), next()]).then(function () { if (run === _cpFillRun) cpRenderShoots(); });
}

cpLoadShoots = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    Promise.resolve(r).then(function () { cpFillSummaries(); });
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
