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
  var total = jobs.reduce(function (a, j) { return a + j.file.size; }, 0), done = 0, ok = [], failed = [];
  cbBusyShow('Загружаю в ' + label + ': 0 из ' + jobs.length + '...', 0.02);
  Object.keys(dirs).reduce(function (p, d) { return p.then(function () { return CPDisk.ensureDir(d); }); }, Promise.resolve()).then(function () {
    return cpPool(jobs, 3, function (j) {
      return CPDisk.uploadBlob(j.path, j.file, true).then(function () { ok.push(j); }, function (e) { failed.push(j.name + ': ' + (e && (e.message || e.status))); })
        .then(function () {
          done += j.file.size;
          cbBusyShow('Загружаю в ' + label + ': ' + (ok.length + failed.length) + ' из ' + jobs.length + ' · ' + (done / 1048576).toFixed(0) + ' из ' + (total / 1048576).toFixed(0) + ' МБ', 0.02 + 0.95 * (total ? done / total : 1));
        });
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
    if (!CP.shoot && typeof cpScanStages === 'function') cpScanStages();
  }).catch(function (e) {
    cbBusyHide();
    if (e && e.plain) { cbToast('Сдать ретушь: ' + e.message); return; }
    cpHandleError(e, 'Сдача ретуши');
  });
};

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
      m.delivered[t.id] = { files: t.last.files.length, letter: t.last.letter, date: cpToday(), at: CPDisk.showPath(t.to), out: t.last.letter + '_' + t.last.n, ts: now };
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
    list.insertAdjacentHTML('afterbegin', '<div class="cp-rv-drop" id="cpRvDrop">Перетащите сюда папку с готовой ретушью — как на Диск. '
      + 'Съёмка найдётся по имени папки (как назывался скачанный архив), файлы лягут в ' + cbEsc(cpFolderBase(root)) + '.</div>');
    var z = document.getElementById('cpRvDrop');
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
  st.textContent = '.cp-rv-drop{grid-column:1/-1;border:2px dashed #3a3a37;border-radius:6px;padding:22px 16px;text-align:center;color:#a3a09a;font-size:13px;line-height:1.6}'
    + '.cp-rv-drop.cp-over{border-color:#C9956B;color:#e7c9a8;background:#1d1a17}';
  document.head.appendChild(st);
})();
