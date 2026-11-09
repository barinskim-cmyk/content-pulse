/* ============================================================
   cp-review.js — 04_ОТРЕТУШИРОВАНО: сдача, проверка, на сайт

   Маша, 06.11.2026: «ретушёр открывает вкладку „Отретушировано“ и просто
   тупо, как будто бы на Диск, заливает то, что он сделал. Это должно
   открываться как наша съёмка. Старший ретушёр открывает съёмку, видит
   новые папки, просматривает и отправляет либо на доработку, либо на сайт —
   прямо по карточкам. В „Отретушировано“ только актуальное и
   непроверенное; что прошло — переезжает на сайт. Внутри „Сайта“ — папки
   с датами. Даты для выработки ретушёров — внутри».

   Решения Маши (06.11):
   - кто сдал — буква, которую ретушёр выбирает при сдаче (компьютер её
     запоминает; из имени скачанного архива «…_Y_1» подставляется сама);
   - кто и когда — внутри: таблица _ContentPulse/выработка.csv и скрытая
     метка на папке артикула; в именах папок дат нет;
   - доработка — остаётся в 04 с припиской «_доработка», новая версия
     ложится рядом, папка с доработкой уходит в Корзину;
   - сайт — 05_САЙТ/<дата>/<съёмка>/<артикул>.

   Раскладка в 04 — как в исходниках: 04/<съёмка>/<папка артикула>/файлы.
   Работает, когда в каталоге есть папка «отретушировано» (настройка
   retouched); без неё — прежняя приёмка в <съёмка>/_приёмка.
   ============================================================ */

var CP_OUTPUT_FILE = 'выработка.csv';
var CP_OUTPUT_HEAD = 'дата;время;ретушёр;съёмка;карточка;кадров;событие;кто;версия';
var CP_RT_LETTER = 'cp_rt_letter';

function cpReviewRoot() { return (CP.settings && CP.settings.retouched) || ''; }

/** Папка карточки в 04: как папка артикула в исходниках, иначе как в выгрузке. */
function cpRvDirFor(card, idx) {
  if (card && card.cpArticleDir) return card.cpArticleDir.split('/').map(CPDisk.safeName).join('/');
  return CPDisk.safeName(cpCardExportFolder(card || { title: 'Карточка' }, idx < 0 ? 0 : idx));
}

function cpParentDir(p) { return String(p || '').slice(0, String(p || '').lastIndexOf('/')); }
function cpRvDirOf(ver) { return ver.dir || (ver.files && ver.files[0] ? cpParentDir(ver.files[0].path) : ''); }

/* ---------- выработка: строка на каждую сдачу и решение ---------- */

function cpOutputAppend(rows) {
  if (!rows.length) return Promise.resolve();
  var path = cpServicePath(CP_OUTPUT_FILE);
  var esc = function (v) { v = String(v === undefined || v === null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  var text = rows.map(function (r) { return r.map(esc).join(';'); }).join('\n');
  return CPDisk.proxyFile(path).then(function (b) { return b.text(); }, function (e) { if (e && e.status === 404) return ''; throw e; })
    .then(function (old) {
      old = String(old || '').replace(/^﻿/, '').replace(/\s+$/, '');
      var body = '﻿' + (old || CP_OUTPUT_HEAD) + '\n' + text + '\n';   /* BOM — Excel открывает кириллицу */
      return CPDisk.ensureDir(CP_CONFIG.serviceDir).then(function () {
        return CPDisk.uploadBlob(path, new Blob([body], { type: 'text/csv;charset=utf-8' }), true);
      });
    }).catch(function (e) { if (window.console) console.warn('[CP] выработка не записалась', e && (e.body || e.message || e)); });
}

function cpOutputRow(ver, shootName, card, event) {
  var d = new Date(), z = function (n) { return (n < 10 ? '0' : '') + n; };
  return [cpToday(), z(d.getHours()) + ':' + z(d.getMinutes()), ver.letter || '', shootName, card ? card.title || '' : '', (ver.files || []).length, event, cpActor(), 'v' + ver.v];
}

/* ---------- сдача: в 04/<съёмка>/<папка артикула> ---------- */

var cpAcceptUploadLegacy = cpAcceptUpload;
cpAcceptUpload = function () {
  var root = cpReviewRoot();
  if (!root) return cpAcceptUploadLegacy();
  var st = CP.accept, plan = st.plan;
  var li = document.getElementById('cpAccLetter'), ni = document.getElementById('cpAccN');
  if (li) st.letter = li.value.trim();
  if (ni) st.n = ni.value.trim();
  if (!st.letter) { cbToast('Выберите букву ретушёра'); return; }
  if (!st.n) st.n = '1';
  cpSet(CP_RT_LETTER, st.letter);
  var batch = cpToday() + '_' + st.letter + '_' + st.n;
  var base = root.replace(/\/+$/, '') + '/' + CPDisk.safeName(st.name);
  var cards = st.data.cards || [];
  var jobs = [], dirs = {}, dirOf = {};
  Object.keys(plan.groups).forEach(function (id) {
    var idx = -1;
    cards.forEach(function (c, i) { if (c.id === id) idx = i; });
    var dir = base + '/' + cpRvDirFor(cards[idx], idx);
    dirOf[id] = dir;
    dirs[dir] = true;
    var used = {};
    plan.groups[id].forEach(function (f) {
      var name = CPDisk.safeName(f.name), k = 2;
      while (used[name]) name = name.replace(/(\.[^.]+)?$/, '_' + (k++) + '$1');
      used[name] = true;
      jobs.push({ card: id, file: f.file, path: dir + '/' + name, name: name });
    });
  });
  var label = cpFolderBase(root);
  var total = jobs.reduce(function (a, j) { return a + j.file.size; }, 0), ok = [], failed = [];
  /* прогресс по байтам: Маша, 06.11 — «важно, чтобы отображалась загрузка, иначе человек
     будет думать, что ничего не происходит» */
  var loaded = {}, now = '';
  var mb = function (b) { return (b / 1048576).toFixed(b < 10485760 ? 1 : 0); };
  var show = function () {
    var sum = 0;
    Object.keys(loaded).forEach(function (k) { sum += loaded[k]; });
    var frac = total ? sum / total : 0;
    var text = 'Загружаю в ' + label + ': файлов ' + ok.length + ' из ' + jobs.length + ' · ' + mb(sum) + ' из ' + mb(total) + ' МБ (' + Math.round(frac * 100) + '%)' + (now ? ' · ' + now : '');
    cbBusyShow(text, 0.02 + 0.96 * frac);
    var pe = document.getElementById('cpAccProg');
    if (pe) pe.innerHTML = '<div class="cp-acc-bar"><i style="width:' + Math.round(frac * 100) + '%"></i></div><div>' + cbEsc(text) + '</div>';
  };
  var go = document.querySelector('[data-cp-acc="go"]');
  if (go) { go.disabled = true; go.textContent = 'Загружаю...'; }
  var planBox = document.getElementById('cpAccPlan');
  if (planBox && !document.getElementById('cpAccProg')) planBox.insertAdjacentHTML('beforeend', '<div class="cp-acc-prog" id="cpAccProg"></div>');
  cbBusyShow('Готовлю папки в ' + label + '...', 0.01);
  Object.keys(dirs).reduce(function (p, d) { return p.then(function () { return CPDisk.ensureDir(d); }); }, Promise.resolve()).then(function () {
    show();
    return cpPool(jobs, 3, function (j, i) {
      now = j.name;
      return CPDisk.uploadBlob(j.path, j.file, true, function (b) { loaded[i] = b; show(); })
        .then(function () { loaded[i] = j.file.size; ok.push(j); }, function (e) { loaded[i] = j.file.size; failed.push(j.name + ': ' + (e && (e.message || e.status))); })
        .then(show);
    });
  }).then(function () {
    cbBusyHide();
    if (!ok.length) throw { message: 'ничего не загрузилось: ' + failed.slice(0, 3).join('; '), plain: true };
    var byCard = {};
    ok.forEach(function (j) { (byCard[j.card] = byCard[j.card] || []).push({ path: j.path, name: j.name, size: j.file.size }); });
    var who = cpActor(), now = new Date().toISOString(), rows = [], oldDirs = [];
    var apply = function (data) {
      var m = data.meta.cp, rv = m.rv = m.rv || {};
      Object.keys(byCard).forEach(function (id) {
        var list = rv[id] = rv[id] || [];
        var prev = cpLastRv(list);
        /* новая версия после доработки: папка с доработкой больше не нужна */
        if (prev && prev.status === 'rework' && cpRvDirOf(prev) && cpRvDirOf(prev) !== dirOf[id]) oldDirs.push(cpRvDirOf(prev));
        if (prev && prev.status === 'review') prev.status = 'replaced';
        var ver = { v: list.length + 1, batch: batch, letter: st.letter, n: st.n, date: cpToday(), by: who, ts: now, files: byCard[id], status: 'review', dir: dirOf[id] };
        list.push(ver);
        var card = (data.cards || []).filter(function (c) { return c.id === id; })[0];
        rows.push(cpOutputRow(ver, st.name, card, 'сдано'));
      });
      (m.events = m.events || []).push({ ts: now, actor: who, action: 'rt_upload', items: ok.map(function (j) { return j.name; }),
        note: 'сдача ' + batch + ' в ' + label + ': карточек ' + Object.keys(byCard).length + ', файлов ' + ok.length + (failed.length ? ', не загрузилось ' + failed.length : '') });
    };
    var saved;
    if (CP.shoot && CP.shoot.path === st.path) {
      apply({ meta: { cp: cpMeta() }, cards: App.cards });
      cbMarkDirty();
      cbRenderCards();
      cbRenderOutline();
      saved = Promise.resolve();
    } else saved = cpMutateState({ path: st.path, name: st.name }, apply);
    return saved.then(function () {
      /* метка на папке: кто и когда сдал (видна программе, в Диске не мешает) */
      Object.keys(byCard).forEach(function (id) { CPDisk.proxyProps(dirOf[id], { cp_rt: st.letter, cp_rt_date: cpToday() }).catch(function () { }); });
      var jobs2 = [cpOutputAppend(rows)];
      if (oldDirs.length) jobs2.push(CPDisk.trash(oldDirs));
      return Promise.all(jobs2);
    });
  }).then(function () {
    var msg = 'Загружено в ' + label + ': ' + ok.length + ' файл(ов)' + (failed.length ? ', не загрузилось ' + failed.length : '') + ' — сдача ' + batch;
    cbToast(msg);
    if (failed.length && window.console) console.error('[CP] не загрузилось', failed);
    var planEl = document.getElementById('cpAccPlan');
    if (planEl) planEl.innerHTML = '<div class="cp-acc-done">' + cbEsc(msg) + '. Старший ретушёр увидит её в съёмке: фильтр ' + cbEsc(label) + ', галочка «Ретушь готова».</div>';
    if (CP.accept) CP.accept.files = [];
    cpReviewPresent(st.name, base);
  }).catch(function (e) {
    cbBusyHide();
    var go2 = document.querySelector('[data-cp-acc="go"]');
    if (go2) { go2.disabled = false; go2.textContent = 'Загрузить в ' + label; }
    if (e && e.plain) { cbToast('Сдать ретушь: ' + e.message); return; }
    cpHandleError(e, 'Сдача ретуши');
  });
};

/**
 * Съёмка только что появилась в 04 — показать её в фильтре сразу, не дожидаясь
 * списка папок: Яндекс показывает новую папку в списке не мгновенно. Потом
 * сверяемся с Диском ещё дважды.
 */
function cpReviewPresent(shootName, dir) {
  var low = String(shootName).toLowerCase();
  CP.stagePresence = CP.stagePresence || {};
  CP.stagePaths = CP.stagePaths || {};
  (CP.stagePresence.review = CP.stagePresence.review || {})[low] = true;
  var w = CP.stagePaths.review = CP.stagePaths.review || {};
  if (!(w[low] || []).some(function (p) { return p === dir; })) w[low] = (w[low] || []).concat([dir]);
  if (CP.shoots) cpRenderShoots();
  [4000, 15000].forEach(function (ms) {
    setTimeout(function () { if (typeof cpScanStages === 'function' && CP.shoots) cpScanStages(); }, ms);
  });
}

/* в окне сдачи: буква с прошлого раза, кнопка — «Загрузить в 04_…» */
cpAcceptPlan = (function (orig) {
  return function () {
    var st = CP.accept;
    if (st && !st.letter && !(st.plan && st.plan.letter) && st.files.length) {
      var plan = cpPlanUpload(st.files, st.data);
      if (!plan.letter) st.letter = cpGet(CP_RT_LETTER, '');
    }
    var r = orig.apply(this, arguments);
    var root = cpReviewRoot();
    var b = document.querySelector('[data-cp-acc="go"]');
    if (root && b) b.textContent = 'Загрузить в ' + cpFolderBase(root);
    return r;
  };
})(cpAcceptPlan);

/* ---------- на сайт: папка артикула переезжает 04 → 05/<дата>/<съёмка>/<артикул> ---------- */

/** Убрать опустевшие папки от dir вверх до stop (не включая). */
function cpTrashEmptyUp(dir, stop) {
  if (!dir || dir === stop || dir.indexOf(stop + '/') !== 0) return Promise.resolve();
  return CPDisk.listDir(dir).then(function (items) {
    if (items.length) return;
    return CPDisk.trash([dir]).then(function () { return cpTrashEmptyUp(cpParentDir(dir), stop); });
  }, function () { });
}

function cpMoveFolder(from, to, tries) {
  return CPDisk.proxyMove([{ from: from, path: to }]).then(function (r) {
    var st = r && r.results && r.results[0];
    if (st && st.status === 'done') return to;
    if (st && st.status === 'exists' && (tries || 0) < 5) return cpMoveFolder(from, to.replace(/_\d+$/, '') + '_' + ((tries || 0) + 2), (tries || 0) + 1);
    throw { message: CPDisk.showPath(from) + ': ' + ((st && (st.error || st.status)) || 'не перенеслось'), plain: true };
  });
}

var cpRvApproveLegacy = cpRvApprove;
cpRvApprove = function (ids) {
  var root = cpReviewRoot(), site = typeof cpSiteRoot === 'function' ? cpSiteRoot() : '';
  if (!root) return cpRvApproveLegacy(ids);
  if (!site) { cbToast('Нет папки сайта в каталоге: шестерёнка на витрине'); return; }
  var rv = cpRv(), shoot = CP.shoot, todo = [];
  ids.forEach(function (id) {
    var last = cpLastRv(rv[id]);
    if (!last || last.status !== 'review' || !cpRvDirOf(last)) return;
    var card = cbCardById(id), idx = App.cards.indexOf(card);
    var to = site.replace(/\/+$/, '') + '/' + cpToday() + '/' + CPDisk.safeName(shoot.name) + '/' + CPDisk.safeName(cpCardExportFolder(card || { title: id }, idx < 0 ? 0 : idx));
    todo.push({ id: id, last: last, from: cpRvDirOf(last), to: to, card: card });
  });
  if (!todo.length) return;
  var base = root.replace(/\/+$/, '') + '/' + CPDisk.safeName(shoot.name);
  var who = cpActor(), now = new Date().toISOString(), rows = [], moved = [];
  cbBusyShow('Отправляю на сайт...', 0.3);
  todo.reduce(function (p, t) {
    return p.then(function () {
      return cpMoveFolder(t.from, t.to).then(function (to) {
        t.to = to;
        moved.push(t);
        t.last.files.forEach(function (f) { if (f.path.indexOf(t.from + '/') === 0) f.path = to + f.path.slice(t.from.length); });
        t.last.dir = to;
      });
    });
  }, Promise.resolve()).then(function () {
    cbBusyHide();
    var m = cpMeta();
    m.delivered = m.delivered || {};
    moved.forEach(function (t) {
      t.last.status = 'approved'; t.last.rby = who; t.last.rts = now; t.last.site = CPDisk.showPath(t.to);
      var rec = { files: t.last.files.length, letter: t.last.letter, date: cpToday(), at: CPDisk.showPath(t.to), out: t.last.letter + '_' + t.last.n, ts: now };
      m.delivered[t.id] = rec;
      /* у артикула бывает две карточки — сдан артикул целиком */
      if (t.card && typeof cpArtKey === 'function') App.cards.forEach(function (c) { if (c.id !== t.id && cpArtKey(c) === cpArtKey(t.card) && !m.delivered[c.id]) m.delivered[c.id] = rec; });
      rows.push(cpOutputRow(t.last, shoot.name, t.card, 'принято'));
    });
    cpEvent('rt_approve', [], { card: moved.map(function (t) { return t.card ? t.card.title : t.id; }).join(', '), note: 'на сайт: ' + CPDisk.showPath(cpParentDir(moved[0].to)) });
    cbRenderCards();
    cbRenderOutline();
    cbToast('На сайт: карточек ' + moved.length + ' → ' + CPDisk.showPath(cpParentDir(moved[0].to)));
    if (typeof cpRetouchCleanupSoon === 'function') cpRetouchCleanupSoon();
    return Promise.all([cpOutputAppend(rows)].concat(moved.map(function (t) { return cpTrashEmptyUp(cpParentDir(t.from), cpParentDir(base)); })));
  }).catch(function (e) {
    cbBusyHide();
    if (moved.length) cbRenderCards();
    if (e && e.plain) { cbToast('На сайт: ' + e.message); return; }
    cpHandleError(e, 'Отправка на сайт');
  });
};

/* ---------- на доработку: остаётся в 04 с припиской «_доработка» ---------- */

var cpRvReworkLegacy = cpRvRework;
cpRvRework = function (id) {
  var root = cpReviewRoot();
  if (!root) return cpRvReworkLegacy(id);
  var last = cpLastRv(cpRv()[id]);
  if (!last) return;
  var note = prompt('Что доработать? (увидит ретушёр)', '');
  if (note === null) return;
  var from = cpRvDirOf(last), card = cbCardById(id);
  var to = from.replace(/_доработка$/i, '') + '_доработка';
  var step = from && from !== to ? cpMoveFolder(from, to) : Promise.resolve(from);
  step.then(function (dir) {
    if (dir && dir !== from) {
      last.files.forEach(function (f) { if (f.path.indexOf(from + '/') === 0) f.path = dir + f.path.slice(from.length); });
      last.dir = dir;
    }
    last.status = 'rework'; last.rby = cpActor(); last.rts = new Date().toISOString(); last.note = note.trim();
    cpEvent('rt_rework', [], { card: card ? card.title : id, note: last.note || '' });
    cbRenderCards();
    cbRenderOutline();
    return cpOutputAppend([cpOutputRow(last, CP.shoot.name, card, 'доработка' + (last.note ? ': ' + last.note : ''))]);
  }).catch(function (e) {
    if (e && e.plain) { cbToast('На доработку: ' + e.message); return; }
    cpHandleError(e, 'На доработку');
  });
};

/* на карточке: «Согласовать ретушь» → «На сайт» (в каталоге с папкой отретушированного) */
cbRenderCards = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    if (!cpReviewRoot()) return r;
    Array.prototype.forEach.call(document.querySelectorAll('#cbCards [data-cp-rva="approve"]'), function (b) { b.textContent = 'На сайт'; });
    return r;
  };
})(cbRenderCards);

/* ---------- на согласование: копия в 02 ----------
   Маша, 08.11: «отобрала тестовую съёмку, отправила на согласование — в папке
   „Отбор“ ничего не появилось». Шаг 2 отражения сервера: статус «на согласовании»
   — это копия кадра в папке согласования (02_ОТБОР), структура как в исходниках,
   кадр карточки артикула — в папке артикула. Сняли статус (руками, убрали кадр
   из карточки, отправили на ретушь) — копия из 02 уходит в Корзину; на ретушь
   кадр копируется из исходников в 03, так что 02 → 03 получается переносом.
   Сверка идёт после каждой правки отбора: какие кадры на согласовании и какие
   копии лежат в 02 (meta.cp.ap2: кадр → путь копии). */

function cpApproveRoot() { return (CP.settings && CP.settings.approve) || ''; }

var _cpApTimer = null, _cpApBusy = false;
function cpApprovalSoon() {
  if (!cpApproveRoot() || !CP.shoot || CP.readOnly) return;
  clearTimeout(_cpApTimer);
  _cpApTimer = setTimeout(cpApprovalSync, 400);
}

function cpApprovalSync() {
  var root = cpApproveRoot();
  if (!root || !CP.shoot || CP.readOnly) return Promise.resolve();
  if (_cpApBusy) { cpApprovalSoon(); return Promise.resolve(); }
  var m = cpMeta(), ap2 = m.ap2 = m.ap2 || {};
  var shootPath = CP.shoot.path.replace(/\/+$/, ''), shootName = CP.shoot.name;
  var base = root.replace(/\/+$/, '') + '/' + CPDisk.safeName(shootName);
  var want = Object.keys(m.status).filter(function (pid) { return m.status[pid].s === 'approval'; });
  var copy = want.filter(function (pid) { return !ap2[pid]; }).map(function (pid) {
    var p = cbPhotoById(pid);
    if (!p || !p.disk || p.missing || (p.kind || 'photo') === 'ref') return null;
    var card = m.status[pid].card ? cbCardById(m.status[pid].card) : null;
    return { pid: pid, from: p.disk, path: base + '/' + cpRetouchRel(p, card, shootPath) };
  }).filter(Boolean);
  var drop = Object.keys(ap2).filter(function (pid) { return !(m.status[pid] && m.status[pid].s === 'approval'); });
  if (!copy.length && !drop.length) return Promise.resolve();
  _cpApBusy = true;
  var label = cpFolderBase(root), path = CP.shoot.path, msgs = [];
  var step = copy.length ? cpCopyOnDisk(copy.map(function (x) { return { from: x.from, path: x.path }; }), [base], 'Копирую на согласование').then(function (r) {
    cbBusyHide();
    var failed = {};
    (r.failedFrom || []).forEach(function (f) { failed[f] = true; });
    copy.forEach(function (x) { if (!failed[x.from] && CP.shoot && CP.shoot.path === path) cpMeta().ap2[x.pid] = x.path; });
    msgs.push('на согласование в ' + label + ': ' + (r.done + r.exists) + (r.failed.length ? ', не скопировано ' + r.failed.length : ''));
    if (typeof cpReviewPresentStage === 'function') cpReviewPresentStage('approval', shootName, base);
  }) : Promise.resolve();
  return step.then(function () {
    if (!drop.length) return;
    var paths = drop.map(function (pid) { return ap2[pid]; });
    return CPDisk.trash(paths).then(function (res) {
      var ok = res.filter(function (x) { return x.status === 'done' || x.status === 'gone'; }).map(function (x) { return x.path; });
      if (CP.shoot && CP.shoot.path === path) drop.forEach(function (pid) { if (ok.indexOf(ap2[pid]) !== -1) delete cpMeta().ap2[pid]; });
      msgs.push('из ' + label + ' в Корзину: ' + ok.length);
      /* опустевшие папки в 02 — тоже в Корзину (до папки 02 включительно не трогаем) */
      var dirs = {};
      ok.forEach(function (pth) { dirs[cpParentDir(pth)] = true; });
      return Object.keys(dirs).reduce(function (pr, d) { return pr.then(function () { return cpTrashEmptyUp(d, root.replace(/\/+$/, '')); }); }, Promise.resolve());
    });
  }).then(function () {
    _cpApBusy = false;
    if (msgs.length && CP.shoot && CP.shoot.path === path) {
      cpEvent('approval_sync', [], { note: msgs.join('; ') }, true);
      cbToast(msgs.join(' · '));
      cbMarkDirty();
    }
  }, function (e) {
    _cpApBusy = false;
    cbBusyHide();
    cpHandleError(e, 'Копия на согласование');
  });
}

/* открыли съёмку — то, что уже было на согласовании до этой версии, тоже ляжет в 02 */
CP.openedHooks = CP.openedHooks || [];
CP.openedHooks.push(function () {
  var ready = typeof cpEnsureSettings === 'function' ? cpEnsureSettings() : Promise.resolve();
  ready.then(function () { setTimeout(cpApprovalSoon, 1500); });
});

/* после любой правки отбора — сверить согласование с папкой 02 */
cbMarkDirty = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    if (!_cpApBusy) cpApprovalSoon();
    return r;
  };
})(cbMarkDirty);

/** Съёмка появилась в папке этапа — сразу в фильтре, потом сверка с Диском. */
function cpReviewPresentStage(key, shootName, dir) {
  var low = String(shootName).toLowerCase();
  CP.stagePresence = CP.stagePresence || {};
  CP.stagePaths = CP.stagePaths || {};
  (CP.stagePresence[key] = CP.stagePresence[key] || {})[low] = true;
  var w = CP.stagePaths[key] = CP.stagePaths[key] || {};
  if (!(w[low] || []).some(function (p) { return p === dir; })) w[low] = (w[low] || []).concat([dir]);
}

/* ---------- съёмка, открытая из фильтра этапа: только карточки этого этапа ----------
   Маша, 06.11: «отправила на сайт — карточка должна сразу испариться из этой
   презентации, её уже не нужно просматривать. В исходниках — не исчезает,
   остаётся со статусом, чтобы в исходниках можно было всё просмотреть».
   Открыли съёмку из фильтра 02 / 03 / 04 / 05 — видны карточки, которые
   сейчас на этом этапе; ушло дальше — пропадает. Из исходников — все. */

CP.viewStage = '';

function cpCardOnStage(card, key) {
  var m = cpMeta(), cs = m.cardStatus[card.id] && m.cardStatus[card.id].s, del = (m.delivered || {})[card.id];
  var last = cpLastRv(cpRv()[card.id]), ls = last ? last.status : '';
  if (key === 'approval') return cs === 'approval';
  if (key === 'retouch') return cs === 'retouch' && !del && ls !== 'review' && ls !== 'rework';
  if (key === 'review') return ls === 'review' || ls === 'rework';
  if (key === 'site') return !!del;
  return true;
}

CP.openedHooks = CP.openedHooks || [];
CP.openedHooks.push(function () {
  var f = CP.stageFilter || '';
  CP.viewStage = f && f !== 'select' && typeof CP_STAGE_SETTING !== 'undefined' && CP_STAGE_SETTING[f] ? f : '';
  CP.rvOnly = false;
  cbRenderCards();
});

cbRenderCards = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    if (!CP.shoot) return r;
    var root = document.getElementById('cbCards');
    var bar = document.getElementById('cpViewBar');
    if (!CP.viewStage) { if (bar) bar.remove(); return r; }
    var key = CP.viewStage, shown = 0;
    Array.prototype.forEach.call(root.querySelectorAll('.cb-card'), function (el) {
      var c = cbCardById(el.getAttribute('data-cid'));
      if (c && !cpCardOnStage(c, key)) el.style.display = 'none';
      else if (el.style.display !== 'none') shown++;
    });
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'cpViewBar';
      bar.className = 'cp-viewbar';
      var anchor = document.getElementById('cpRvBar') || root;
      anchor.parentNode.insertBefore(bar, anchor);
      bar.addEventListener('click', function (e) {
        if (!e.target.closest('[data-cp-view-all]')) return;
        CP.viewStage = '';
        cbRenderCards();
      });
    }
    bar.innerHTML = 'Открыто из <b>' + cbEsc(cpStageLabel(key)) + '</b>: только карточки этого этапа — ' + shown
      + (shown ? '' : ' (всё отсюда уже ушло дальше)') + ' <button data-cp-view-all="1">Показать все карточки</button>';
    return r;
  };
})(cbRenderCards);

/* ---------- панель съёмки в фильтре этапа: что лежит в папке этапа сейчас ----------
   Маша, 06.11: «в боковой менюшке отображается всё, что есть в исходниках, а не
   то, что есть в той папке, которую я открыла на этапе сайт или ретушь. Должна
   отображаться та структура, которая там прямо сейчас лежит, чтобы быстро
   посмотреть и понять, что там есть». */

cpSelectShoot = (function (orig) {
  return function (path, name, modified) {
    var key = CP.stageFilter;
    var paths = key && typeof CP_STAGE_SETTING !== 'undefined' && CP_STAGE_SETTING[key] && CP.stagePaths && CP.stagePaths[key]
      ? CP.stagePaths[key][String(name).toLowerCase()] : null;
    if (!paths || !paths.length) return orig.apply(this, arguments);
    CP.sel = { path: path, name: name, modified: modified, stage: key, stagePaths: paths.slice(), loading: true, open: {}, folders: {}, files: [], dirs: [] };
    cpMarkSelected();
    cpRenderPanel();
    var sel = CP.sel;
    sel.stageTags = {};
    Promise.all([
      Promise.all(sel.stagePaths.map(function (p) {
        return CPDisk.walkPhotos(p, false, 4, true).then(function (files) { return { root: p, files: files, dirs: files.dirs || [] }; },
          function (e) { return { root: p, files: [], dirs: [], error: e }; });
      })),
      /* отбор съёмки — чьи это карточки (теги ретушёров и прочие) */
      CPDisk.readState(path).then(function (st) { return st.data; }, function () { return null; }),
      cpLoadDict().catch(function () { return null; })
    ]).then(function (r) {
      if (CP.sel !== sel) return;
      sel.stageFiles = r[0];
      sel.data = r[1];
      sel.loading = false;
      cpStageTagIndex(sel);
      cpRenderPanel();
    });
  };
})(cpSelectShoot);

/* Теги в папке этапа (Маша, 08.11: «в ретуши — сверху теги, которые есть: тыкнуть тег и
   скачать по тегу; проставлено моё имя — скачала с именем, или всё, что без имени»).
   У каждого файла этапа — теги его карточки (по кадру отбора: путь внутри съёмки или имя)
   и буква ретушёра из имени папки («Y_74595_…»). */
var CP_NO_RT = '__без_ретушёра__';

function cpStageTagIndex(sel) {
  var data = sel.data || {}, photos = data.photos || [], cards = data.cards || [];
  var src = String(sel.path || '').replace(/\/+$/, '') + '/';
  var letters = typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
  var byRel = {}, byStem = {}, tagsOf = {};
  photos.forEach(function (p) {
    if (!p.disk) return;
    var rel = p.disk.indexOf(src) === 0 ? p.disk.slice(src.length) : p.name;
    byRel[rel.toLowerCase()] = p.id;
    var st = cpStem(p.name || rel.split('/').pop());
    (byStem[st] = byStem[st] || []).push(p.id);
  });
  cards.forEach(function (c) {
    var pids = c.mode === 'auto' ? (c.pids || []) : (c.slots || []).map(function (x) { return x.pid; }).filter(Boolean);
    pids.forEach(function (pid) { (tagsOf[pid] = tagsOf[pid] || {}); (c.tags || []).forEach(function (t) { tagsOf[pid][t] = true; }); });
  });
  sel.stageFiles.forEach(function (x) {
    x.files.forEach(function (f) {
      var rel = f.path.indexOf(x.root + '/') === 0 ? f.path.slice(x.root.length + 1) : f.name;
      var segs = rel.split('/'), name = segs.pop(), tags = {};
      segs = segs.map(function (sg) {
        var m = /^([A-Za-zА-Яа-яЁё]{1,3})_(.+)$/.exec(sg);
        if (m && letters.indexOf(m[1]) !== -1) { tags[m[1]] = true; return m[2]; }
        return sg.replace(/_доработка$/i, '');
      });
      var pid = byRel[segs.concat([name]).join('/').toLowerCase()];
      if (!pid) { var c = byStem[cpStem(name)] || []; if (c.length === 1) pid = c[0]; }
      if (pid && tagsOf[pid]) Object.keys(tagsOf[pid]).forEach(function (t) { tags[t] = true; });
      if (letters.length && !Object.keys(tags).some(function (t) { return letters.indexOf(t) !== -1; })) tags[CP_NO_RT] = true;
      f.cpTags = Object.keys(tags);
    });
  });
}

/** Файл этапа проходит отмеченные теги (отмечено несколько — подходит любой). */
function cpStageTagOk(sel, f) {
  var on = Object.keys(sel.stageTags || {}).filter(function (k) { return sel.stageTags[k]; });
  return !on.length || (f.cpTags || []).some(function (t) { return on.indexOf(t) !== -1; });
}

function cpStageChips(sel) {
  var n = {}, letters = typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
  sel.stageFiles.forEach(function (x) { x.files.forEach(function (f) { (f.cpTags || []).forEach(function (t) { n[t] = (n[t] || 0) + 1; }); }); });
  var keys = Object.keys(n);
  if (!keys.length) return '';
  var order = (CP.dict || []).map(function (d) { return d.tag; });
  keys.sort(function (a, b) {
    var ra = letters.indexOf(a) !== -1 ? 0 : a === CP_NO_RT ? 1 : 2, rb = letters.indexOf(b) !== -1 ? 0 : b === CP_NO_RT ? 1 : 2;
    var ia = order.indexOf(a), ib = order.indexOf(b);
    return ra - rb || (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib) || a.localeCompare(b);
  });
  var any = Object.keys(sel.stageTags || {}).some(function (k) { return sel.stageTags[k]; });
  return '<div class="cp-fchips"><span class="cp-fchips-l">' + (any ? 'Скачать с тегами (любой из отмеченных):' : 'Теги — отметьте, чтобы скачать только их:') + '</span>'
    + keys.map(function (t) {
      return '<button class="cp-fchip' + (sel.stageTags[t] ? ' cp-on' : '') + '" data-cp-stag="' + cbEsc(t) + '">' + cbEsc(t === CP_NO_RT ? 'без ретушёра' : t) + ' <small>' + n[t] + '</small></button>';
    }).join('') + (any ? '<a href="#" data-cp-stag-reset="1">сбросить</a>' : '') + '</div>';
}

document.getElementById('cpPanel').addEventListener('click', function (e) {
  var sel = CP.sel;
  if (!sel || !sel.stage) return;
  var b = e.target.closest('[data-cp-stag]'), r = e.target.closest('[data-cp-stag-reset]');
  if (!b && !r) return;
  e.preventDefault();
  if (r) sel.stageTags = {};
  else { var t = b.getAttribute('data-cp-stag'); sel.stageTags[t] = !sel.stageTags[t]; }
  cpRenderPanel();
});

(function cpStageChipCss() {
  if (document.getElementById('cpStageChipCss') || document.getElementById('cpMediaChipCss')) return;
  var st = document.createElement('style');
  st.id = 'cpStageChipCss';
  st.textContent = '.cp-fchips{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 14px;padding-bottom:12px;border-bottom:1px solid #2a2a28}'
    + '.cp-fchips-l{font-size:12px;color:#a3a09a;width:100%}'
    + '.cp-fchip{font:inherit;font-size:12px;padding:3px 9px;border-radius:12px;border:1px solid #3a3a37;background:transparent;color:#cfcac2;cursor:pointer}'
    + '.cp-fchip small{color:#8a877f;margin-left:2px}'
    + '.cp-fchip.cp-on{border-color:#C9956B;background:#2b231c;color:#f2e2cf}.cp-fchip.cp-on small{color:#e7c9a8}'
    + '.cp-fchips a{font-size:12px;color:#C9956B}';
  document.head.appendChild(st);
})();

/** Дерево папки этапа: {kids: {путь: [дети]}, agg: {путь: {n, bytes}}, files, bytes}. */
function cpStageTree(sel) {
  var stageRoot = String((CP.settings || {})[CP_STAGE_SETTING[sel.stage]] || '').replace(/\/+$/, '');
  var all = {}, agg = {}, nFiles = 0, bytes = 0;
  var many = sel.stageFiles.length > 1;
  sel.stageFiles.forEach(function (x) {
    /* в «Сайте» съёмка лежит в нескольких датах — дата и есть верхний уровень */
    var pre = '';
    if (many) {
      var par = cpParentDir(x.root);
      pre = par.indexOf(stageRoot + '/') === 0 ? par.slice(stageRoot.length + 1) : par.split('/').pop();
    }
    var add = function (rel) {
      var full = pre ? (rel ? pre + '/' + rel : pre) : rel;
      if (!full) return '';
      var parts = full.split('/');
      for (var i = 1; i <= parts.length; i++) all[parts.slice(0, i).join('/')] = true;
      return full;
    };
    if (pre) add('');
    x.dirs.forEach(function (d) { if (d.indexOf(x.root + '/') === 0) add(d.slice(x.root.length + 1)); });
    x.files.forEach(function (f) {
      if (f.name === CPDisk.STATE_FILE) return;
      var rel = f.path.indexOf(x.root + '/') === 0 ? f.path.slice(x.root.length + 1) : f.name;
      var dir = add(cpParentDir(rel)) || '';
      nFiles++;
      bytes += f.size || 0;
      var parts = dir ? dir.split('/') : [];
      for (var i = 0; i <= parts.length; i++) {
        var k = parts.slice(0, i).join('/');
        var a = agg[k] || (agg[k] = { n: 0, bytes: 0 });
        a.n++; a.bytes += f.size || 0;
      }
    });
  });
  var kids = {};
  Object.keys(all).forEach(function (r) {
    var par = r.indexOf('/') === -1 ? '' : r.slice(0, r.lastIndexOf('/'));
    (kids[par] = kids[par] || []).push(r);
  });
  Object.keys(kids).forEach(function (k) { kids[k].sort(function (a, b) { return a.split('/').pop().localeCompare(b.split('/').pop(), undefined, { numeric: true }); }); });
  return { kids: kids, agg: agg, files: nFiles, bytes: bytes };
}

cpRenderPanel = (function (orig) {
  return function () {
    var sel = CP.sel;
    if (!sel || !sel.stage) return orig.apply(this, arguments);
    var panel = document.getElementById('cpPanel');
    panel.classList.add('cp-open');
    var label = cpStageLabel(sel.stage);
    var head = '<div class="cp-panel-head"><div><b>' + cbEsc(sel.name) + '</b><small>в папке ' + cbEsc(label) + ' — что лежит там сейчас</small></div>'
      + '<span class="cp-sp"></span><button data-cp-p="close" title="Закрыть панель">×</button></div>';
    var acts = '<button data-cp-p="open">Открыть</button>' + (sel.stage === 'review' ? '<button data-cp-accept title="Загрузить готовую ретушь">Сдать</button>' : '');
    if (sel.loading) {
      panel.innerHTML = head + '<div class="cp-panel-body"><div class="cp-note">Читаю папку ' + cbEsc(label) + '...</div></div><div class="cp-panel-actions"><div class="cp-sum"></div>' + acts + '</div>';
      return;
    }
    var t = cpStageTree(sel);
    var picked = 0, pickedBytes = 0, anyTag = Object.keys(sel.stageTags || {}).some(function (k) { return sel.stageTags[k]; });
    sel.stageFiles.forEach(function (x) { x.files.forEach(function (f) { if (f.name !== CPDisk.STATE_FILE && cpStageTagOk(sel, f)) { picked++; pickedBytes += f.size || 0; } }); });
    var body = cpStageChips(sel) + '<div class="cp-fold cp-fold-all"><span class="cp-fold-name">' + cbEsc(label) + ' <small>· файлов ' + t.files + ' · ' + cpMb(t.bytes) + '</small></span></div>';
    var top = t.kids[''] || [];
    if (!top.length) body += '<div class="cp-note">' + (t.files ? 'Вложенных папок нет — файлы лежат прямо в папке съёмки.' : 'Папка пустая.') + '</div>';
    var letters = typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
    if (top.length === 1 && sel.open[top[0]] === undefined) sel.open[top[0]] = true;   /* одна папка — сразу раскрыта */
    var row = function (fp, depth) {
      var ch = t.kids[fp] || [], open = !!(sel.open && sel.open[fp]);
      var a = t.agg[fp] || { n: 0, bytes: 0 };
      var nm = fp.split('/').pop(), marks = '';
      var lm = /^([A-Za-zА-Яа-яЁё]{1,3})_/.exec(nm);
      if (lm && letters.indexOf(lm[1]) !== -1) marks += '<span class="cp-state cp-state-retouch">забрал ' + cbEsc(lm[1]) + '</span>';
      if (/_доработка$/i.test(nm)) marks += '<span class="cp-state cp-state-reshoot">на доработке</span>';
      body += '<div class="cp-fold' + (depth ? ' cp-fold-sub' : '') + '" style="padding-left:' + (depth * 18) + 'px"><span>' + cbEsc(nm)
        + ' <small>· ' + a.n + (a.bytes ? ' · ' + cpMb(a.bytes) : '') + '</small></span>'
        + (ch.length ? '<button class="cp-fold-exp" data-cp-exp="' + cbEsc(fp) + '">' + (open ? 'свернуть' : 'папок: ' + ch.length) + '</button>' : '')
        + '<span class="cp-fold-props">' + marks + '</span></div>';
      if (open) ch.forEach(function (c) { row(c, depth + 1); });
    };
    top.forEach(function (fp) { row(fp, 0); });
    var errs = sel.stageFiles.filter(function (x) { return x.error; });
    if (errs.length) body += '<div class="cp-note cp-warn">Не прочиталось: ' + errs.map(function (x) { return cbEsc(CPDisk.showPath(x.root)); }).join(', ') + '</div>';
    body += '<div class="cp-note">' + sel.stagePaths.map(function (p) { return cbEsc(CPDisk.showPath(p)); }).join('<br>') + '</div>';
    panel.setAttribute('data-path', sel.path);
    panel.innerHTML = head + '<div class="cp-panel-body">' + body + '</div><div class="cp-panel-actions"><div class="cp-sum">Здесь файлов: <b>' + t.files + '</b> · ' + cpMb(t.bytes)
      + (anyTag ? ' · с отмеченными тегами: <b>' + picked + '</b> · ' + cpMb(pickedBytes) : '') + '</div>'
      + acts + '<button class="cb-primary" data-cp-stdl="1"' + (picked ? '' : ' disabled') + '>' + (anyTag ? 'Скачать по тегам' : 'Скачать всё из ' + cbEsc(label)) + ' · ' + picked + '</button></div>';
  };
})(cpRenderPanel);

/* «Скачать отсюда»: всё, что лежит в папке этапа, одним архивом со структурой */
document.getElementById('cpPanel').addEventListener('click', function (e) {
  if (!e.target.closest('[data-cp-stdl]') || !CP.sel || !CP.sel.stage || !CP.sel.stageFiles) return;
  e.preventDefault();
  var sel = CP.sel, stageRoot = String((CP.settings || {})[CP_STAGE_SETTING[sel.stage]] || '').replace(/\/+$/, '');
  var many = sel.stageFiles.length > 1, entries = [];
  sel.stageFiles.forEach(function (x) {
    var par = cpParentDir(x.root);
    var pre = many ? (par.indexOf(stageRoot + '/') === 0 ? par.slice(stageRoot.length + 1) : par.split('/').pop()) + '/' : '';
    x.files.forEach(function (f) {
      if (f.name === CPDisk.STATE_FILE || !cpStageTagOk(sel, f)) return;
      entries.push({ from: f.path, size: f.size, name: pre + (f.path.indexOf(x.root + '/') === 0 ? f.path.slice(x.root.length + 1) : f.name) });
    });
  });
  var on = Object.keys(sel.stageTags || {}).filter(function (k) { return sel.stageTags[k]; }).map(function (t) { return t === CP_NO_RT ? 'без ретушёра' : t; });
  var name = CPDisk.safeName(sel.name) + '_' + CPDisk.safeName(cpStageLabel(sel.stage)) + (on.length ? '_' + CPDisk.safeName(on.join('+')) : '') + '_' + cpToday();
  cpExportBundle(name, entries, cpStageLabel(sel.stage) + ': файлов ' + entries.length + '.').catch(function (err) { cpHandleError(err, 'Скачивание'); });
});

/* ---------- витрина, фильтр «отретушировано»: перетащить папку как на Диск ---------- */

/** Съёмка по имени перетащенной папки: «<съёмка>», «<съёмка>_Y_1», «<съёмка>_отбор_2». */
function cpShootByFolder(top) {
  var t = String(top || '').toLowerCase(), best = null;
  (CP.shoots || []).forEach(function (d) {
    var n = d.name.toLowerCase();
    if ((t === n || t.indexOf(n + '_') === 0) && (!best || n.length > best.name.length)) best = d;
  });
  return best;
}

function cpReviewDrop(files) {
  if (!files.length) return;
  var top = files[0].rel.split('/')[0];
  var d = files.every(function (f) { return f.rel.split('/')[0] === top; }) ? cpShootByFolder(top) : null;
  if (!d) { cbToast('Не нашла съёмку по имени папки «' + top + '». Выберите съёмку и нажмите «Сдать»'); return; }
  cpAcceptOpen(d.path, d.name);
  cpAcceptAdd(files);
}

cpRenderShoots = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    var root = cpReviewRoot(), list = document.getElementById('cpShelfList');
    if (!list || CP.stageFilter !== 'review' || !root || document.getElementById('cpRvDrop')) return r;
    list.insertAdjacentHTML('afterbegin', '<div class="cp-rv-drop" id="cpRvDrop">Перетащите сюда папку с готовой ретушью — как на Диск '
      + '(или <label class="cp-acc-pick">выберите папку<input type="file" id="cpRvDropPick" webkitdirectory multiple hidden></label>). '
      + 'Съёмка найдётся по имени папки (как назывался скачанный архив), файлы лягут в ' + cbEsc(cpFolderBase(root)) + '.</div>');
    var z = document.getElementById('cpRvDrop');
    var pick = document.getElementById('cpRvDropPick');
    pick.onchange = function () {
      cpReviewDrop(Array.prototype.slice.call(pick.files).map(function (f) { return { file: f, rel: f.webkitRelativePath || f.name }; }));
      pick.value = '';
    };
    z.addEventListener('dragover', function (e) { e.preventDefault(); z.classList.add('cp-over'); });
    z.addEventListener('dragleave', function () { z.classList.remove('cp-over'); });
    z.addEventListener('drop', function (e) {
      e.preventDefault();
      z.classList.remove('cp-over');
      cpDropFiles(e.dataTransfer).then(cpReviewDrop);
    });
    return r;
  };
})(cpRenderShoots);

(function cpReviewCss() {
  var st = document.createElement('style');
  st.textContent = '.cp-viewbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:13px;color:#cfcac2;margin:0 0 10px;padding:8px 10px;border:1px solid #3a3a37;border-radius:4px;background:#1a1a18}'
    + '.cp-viewbar b{color:#e7c9a8}'
    + '.cp-acc-prog{font-size:12px;color:#cfcac2;display:flex;flex-direction:column;gap:6px;margin-top:10px}'
    + '.cp-acc-bar{height:8px;background:#232321;border-radius:4px;overflow:hidden}.cp-acc-bar i{display:block;height:100%;background:#C9956B;transition:width .2s}'
    + '.cp-rv-drop{grid-column:1/-1;border:2px dashed #3a3a37;border-radius:6px;padding:22px 16px;text-align:center;color:#a3a09a;font-size:13px;line-height:1.6}'
    + '.cp-rv-drop.cp-over{border-color:#C9956B;color:#e7c9a8;background:#1d1a17}';
  document.head.appendChild(st);
})();
