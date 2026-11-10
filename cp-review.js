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
   - кто сдал — буква, которую ретушёр выбирает при сдаче. Сама подставляется
     только из имён папок («…_Y_1», «…_03_РЕТУШЬ_Y_дата», «Y_74595_…»); иначе
     её нужно нажать — с прошлого раза не запоминается (Маша, 10.11);
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
var CP_OUTPUT_HEAD_OLD = 'дата;время;ретушёр;съёмка;карточка;кадров;событие;кто;версия';
var CP_OUTPUT_HEAD = CP_OUTPUT_HEAD_OLD + ';способ';   /* способ — как отправили на сайт (2.0.98) */

function cpReviewRoot() { return (CP.settings && CP.settings.retouched) || ''; }

/** Папка карточки в 04: как папка артикула в исходниках, иначе как в выгрузке. */
function cpRvDirFor(card, idx) {
  if (card && card.cpArticleDir) return card.cpArticleDir.split('/').map(CPDisk.safeName).join('/');
  return CPDisk.safeName(cpCardExportFolder(card || { title: 'Карточка' }, idx < 0 ? 0 : idx));
}

function cpParentDir(p) { return String(p || '').slice(0, String(p || '').lastIndexOf('/')); }
function cpRvDirOf(ver) { return ver.dir || (ver.files && ver.files[0] ? cpParentDir(ver.files[0].path) : ''); }

/* ---------- выработка: строка на каждую сдачу и решение ---------- */

function cpOutputAppend(rows, file, head) {
  if (!rows.length) return Promise.resolve();
  file = file || CP_OUTPUT_FILE; head = head || CP_OUTPUT_HEAD;
  var path = cpServicePath(file);
  var esc = function (v) { v = String(v === undefined || v === null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  var text = rows.map(function (r) { return r.map(esc).join(';'); }).join('\n');
  return CPDisk.proxyFile(path).then(function (b) { return b.text(); }, function (e) { if (e && e.status === 404) return ''; throw e; })
    .then(function (old) {
      old = String(old || '').replace(/^﻿/, '').replace(/\s+$/, '');
      /* таблица заведена до столбца «способ» — дописываем его в заголовок */
      if (file === CP_OUTPUT_FILE && old.indexOf(CP_OUTPUT_HEAD_OLD) === 0 && old.indexOf(CP_OUTPUT_HEAD) !== 0) old = CP_OUTPUT_HEAD + old.slice(CP_OUTPUT_HEAD_OLD.length);
      var body = '﻿' + (old || head) + '\n' + text + '\n';   /* BOM — Excel открывает кириллицу */
      return CPDisk.ensureDir(CP_CONFIG.serviceDir).then(function () {
        return CPDisk.uploadBlob(path, new Blob([body], { type: 'text/csv;charset=utf-8' }), true);
      });
    }).catch(function (e) { if (window.console) console.warn('[CP] ' + file + ' не записался', e && (e.body || e.message || e)); });
}

function cpOutputRow(ver, shootName, card, event, via) {
  var d = new Date(), z = function (n) { return (n < 10 ? '0' : '') + n; };
  return [cpToday(), z(d.getHours()) + ':' + z(d.getMinutes()), ver.letter || '', shootName, card ? card.title || '' : '', (ver.files || []).length, event, cpActor(), 'v' + ver.v,
    typeof cpRvViaText === 'function' ? cpRvViaText(via) : ''];
}

/* ---------- сдача: в 04/<съёмка>/<папка артикула> ---------- */

var cpAcceptUploadLegacy = cpAcceptUpload;
cpAcceptUpload = function () {
  var root = cpReviewRoot();
  if (!root) { if (cpCatStageMissing('retouched')) return; return cpAcceptUploadLegacy(); }
  var st = CP.accept, plan = st.plan;
  var li = document.getElementById('cpAccLetter'), ni = document.getElementById('cpAccN');
  if (li) st.letter = li.value.trim();
  if (ni) st.n = ni.value.trim();
  if (!st.letter) { cpAcceptNeedLetter(); return; }
  if (!st.n) st.n = '1';
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
      return cpUpSure(j.path, j.file, true, function (b) { loaded[i] = b; show(); })
        .then(function () { loaded[i] = j.file.size; ok.push(j); }, function (e) { loaded[i] = j.file.size; failed.push(j.name + ': ' + (e && (e.message || e.status))); })
        .then(show);
    });
  }).then(function () {
    cbBusyHide();
    if (!ok.length) throw { message: 'ничего не загрузилось: ' + failed.slice(0, 3).join('; '), plain: true };
    var byCard = {};
    ok.forEach(function (j) { (byCard[j.card] = byCard[j.card] || []).push({ path: j.path, name: j.name, size: j.file.size }); });
    var who = cpActor(), now = new Date().toISOString(), rows = [], oldDirs = [], stale = {};
    var apply = function (data) {
      var m = data.meta.cp, rv = m.rv = m.rv || {};
      Object.keys(byCard).forEach(function (id) {
        var list = rv[id] = rv[id] || [];
        var prev = cpLastRv(list);
        /* новая версия после доработки: папка с доработкой больше не нужна */
        if (prev && prev.status === 'rework' && cpRvDirOf(prev) && cpRvDirOf(prev) !== dirOf[id]) oldDirs.push(cpRvDirOf(prev));
        if (prev && prev.status === 'review') prev.status = 'replaced';
        /* прошлая версия в той же папке — её файлы, которых нет в новой, уберём (Маша, 09.11:
           «ретушёр удалил один файл, загрузил — файл всё равно был») */
        if (prev && prev.status !== 'approved' && cpRvDirOf(prev) === dirOf[id]) stale[id] = (prev.files || []).map(function (f) { return f.path; });
        var ver = { v: list.length + 1, batch: batch, letter: st.letter, n: st.n, date: cpToday(), by: who, ts: now, files: byCard[id], status: 'review', dir: dirOf[id] };
        list.push(ver);
        var card = (data.cards || []).filter(function (c) { return c.id === id; })[0];
        rows.push(cpOutputRow(ver, st.name, card, 'сдано'));
      });
      (m.events = m.events || []).push({ ts: now, actor: who, action: 'rt_upload', items: ok.map(function (j) { return j.name; }),
        note: 'сдача ' + batch + ' в ' + label + ': карточек ' + Object.keys(byCard).length + ', файлов ' + ok.length + (failed.length ? ', не загрузилось ' + failed.length : '')
          + ' · буква ' + st.letter + (st.letterAuto ? ' — из имени папки' : st.letterHow === 'took' ? ' — выбрана, забирал(а) эти артикулы' : ' — выбрана при сдаче')
          + (st.found ? ' · съёмка найдена по артикулам' : '') });
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
      /* по списку прошлой версии, а не по папке: Диск показывает свежие файлы в списке не сразу */
      var old = [];
      Object.keys(stale).forEach(function (id) {
        var keep = {};
        byCard[id].forEach(function (f) { keep[f.path.toLowerCase()] = true; });
        stale[id].forEach(function (pth) { if (!keep[pth.toLowerCase()] && old.indexOf(pth) === -1) old.push(pth); });
      });
      if (old.length) jobs2.push(CPDisk.trash(old).catch(function () { }));
      return Promise.all(jobs2);
    });
  }).then(function () {
    var msg = 'Загружено в ' + label + ': ' + ok.length + ' файл(ов)' + (failed.length ? ', не загрузилось ' + failed.length : '') + ' — сдача ' + batch;
    cbToast(msg);
    if (failed.length && window.console) console.error('[CP] не загрузилось', failed);
    var planEl = document.getElementById('cpAccPlan');
    if (planEl) planEl.innerHTML = '<div class="cp-acc-done">' + cbEsc(msg) + '. Старший ретушёр увидит её в съёмке: фильтр ' + cbEsc(label) + ', галочка «Ретушь на проверке».</div>';
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
  if (typeof cpStageNote === 'function') cpStageNote('review', shootName, dir);
  if (CP.shoots) cpRenderShoots();
  [4000, 15000].forEach(function (ms) {
    setTimeout(function () { if (typeof cpScanStages === 'function' && CP.shoots) cpScanStages(); }, ms);
  });
}

/* в окне сдачи: кнопка — «Загрузить в 04_…»; съёмку нашли по артикулам — сверху вопрос «сдаём сюда?» */
cpAcceptPlan = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    var st = CP.accept, root = cpReviewRoot();
    var b = document.querySelector('[data-cp-acc="go"]');
    if (root && b) b.textContent = 'Загрузить в ' + cpFolderBase(root);
    var box = document.getElementById('cpAccPlan');
    if (st && st.found && box && !document.getElementById('cpAccFound')) {
      var cur = st.found.list.filter(function (x) { return x.d.path === st.path; })[0];
      var others = st.found.list.filter(function (x) { return x.d.path !== st.path; });
      box.insertAdjacentHTML('afterbegin', '<div class="cp-acc-found" id="cpAccFound">Папки артикулов без папки съёмки. Артикул' + (st.found.codes.length > 1 ? 'ы' : '') + ' '
        + cbEsc(st.found.codes.slice(0, 12).join(', ')) + (st.found.codes.length > 12 ? '…' : '') + ' — в съёмке <b>' + cbEsc(st.name) + '</b>'
        + (cur && cur.miss.length ? ' (нет в ней: ' + cbEsc(cur.miss.slice(0, 8).join(', ')) + ')' : '') + '. Сдаём в неё? Да — выберите своё имя и нажмите «Загрузить»; нет — закройте окно.'
        + (others.length ? '<br>Эти артикулы есть и в других съёмках: ' + others.map(function (x) {
          return '<a href="#" data-cp-acc-shoot="' + cbEsc(x.d.path) + '">' + cbEsc(x.d.name) + '</a>';
        }).join(', ') : '') + '</div>');
    }
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

/* Перенести папку и убедиться, что она на новом месте (Маша, 09.11: «статус должен
   свидетельствовать, что всё в нужное место переехало»). Статус ставит вызывающий —
   только после того, как эта функция вернула путь. Диск переносит большие папки в
   фоне: если прослойка не дождалась (timeout), ждём сами до 90 с и проверяем. */
function cpMoveFolder(from, to, tries, base) {
  return CPDisk.proxyMove([{ from: from, path: to }]).then(function (r) {
    var st = r && r.results && r.results[0];
    /* на новом месте такая папка уже есть — приписка «_2», «_3» к ИСХОДНОМУ имени: раньше перед припиской
       срезалось любое окончание «_цифры», и «LOOK_12» уезжала под чужим именем «LOOK_2» */
    if (st && st.status === 'exists' && (tries || 0) < 5) return cpMoveFolder(from, (base || to) + '_' + ((tries || 0) + 2), (tries || 0) + 1, base || to);
    var why = (st && (st.error || st.status)) || 'не перенеслось';
    var done = st && st.status === 'done';
    return cpWaitThere(to, done ? 1 : (why === 'timeout' ? 18 : 2)).then(function (ok) {
      if (ok) return to;
      throw { message: CPDisk.showPath(from) + ': ' + (done ? 'Диск ответил «перенесено», но на новом месте папки нет' : why) + ' — статус не поставлен, повторите', plain: true };
    });
  });
}

/** Есть ли путь на Диске; tries > 1 — повторять раз в 5 с. */
function cpWaitThere(path, tries) {
  return CPDisk.meta(path).then(function () { return true; }, function (e) {
    if ((e && e.status !== 404) || tries <= 1) return false;
    return new Promise(function (res) { setTimeout(res, CP.waitThereMs || 5000); }).then(function () { return cpWaitThere(path, tries - 1); });
  });
}

var cpRvApproveLegacy = cpRvApprove;
cpRvApprove = function (ids, via) {
  var root = cpReviewRoot(), site = typeof cpSiteRoot === 'function' ? cpSiteRoot() : '';
  if (!root) { if (cpCatStageMissing('retouched')) return; return cpRvApproveLegacy(ids, via); }
  if (!site) { cbToast('Нет папки сайта в каталоге: шестерёнка на витрине'); return; }
  var rv = cpRv(), shoot = CP.shoot, todo = [], skip = [];
  ids.forEach(function (id) {
    var last = cpLastRv(rv[id]);
    if (!last || last.status !== 'review' || !cpRvDirOf(last) || cpRvHasReworkMarks(last)) {
      /* раньше — молча; теперь говорим, почему карточка не уехала */
      var c0 = cbCardById(id);
      skip.push((c0 && (c0.title || c0.category) || 'карточка') + ' — ' + (!last ? 'ретушь не сдана'
        : last.status === 'approved' ? 'уже на сайте' : last.status === 'rework' ? 'на доработке, ждёт новой версии'
        : cpRvHasReworkMarks(last) ? 'в просмотре есть кадры «на доработку» — завершите просмотр или снимите отметки' : 'нет папки версии в 04'));
      return;
    }
    var card = cbCardById(id), idx = App.cards.indexOf(card);
    var to = site.replace(/\/+$/, '') + '/' + cpToday() + '/' + CPDisk.safeName(shoot.name) + '/' + CPDisk.safeName(cpCardExportFolder(card || { title: id }, idx < 0 ? 0 : idx));
    todo.push({ id: id, last: last, from: cpRvDirOf(last), to: to, card: card });
  });
  if (skip.length) cbToast('Не отправлено на сайт: ' + skip.join('; '));
  if (!todo.length) return;
  var base = root.replace(/\/+$/, '') + '/' + CPDisk.safeName(shoot.name);
  var who = cpActor(), now = new Date().toISOString(), rows = [], moved = [], queued = [];
  cbBusyShow('Отправляю на сайт...', 0.3);
  /* каждая карточка — отдельно: одна не перенеслась — остальные всё равно получают статус,
     а она уходит в очередь (cp-queue.js) и переносится, пока не перенесётся */
  todo.reduce(function (p, t) {
    return p.then(function () {
      return cpMoveFolder(t.from, t.to).then(function (to) {
        t.to = to;
        moved.push(t);
      }, function (e) {
        queued.push(t);
        CPQ.add(shoot, { kind: 'move', label: 'На сайт: ' + (t.card ? t.card.title || t.card.category || 'карточка' : t.id), items: [{ from: t.from, path: t.to }],
          after: { type: 'rv-approve', id: t.id, from: t.from, to: t.to, who: who, date: cpToday(), base: base, via: cpRvViaOf(via, t.id) }, err: (e && e.message) || '' });
      });
    });
  }, Promise.resolve()).then(function () {
    cbBusyHide();
    var m = cpMeta();
    moved.forEach(function (t) {
      cpRvApplyApproved(m, t.id, t.from, t.to, who, now, cpToday(), cpRvViaOf(via, t.id));
      rows.push(cpOutputRow(t.last, shoot.name, t.card, 'принято', cpRvViaOf(via, t.id)));
    });
    if (moved.length) {
      var mids = moved.map(function (t) { return t.id; });
      cpEvent('rt_approve', [], { card: moved.map(function (t) { return t.card ? t.card.title : t.id; }).join(', '), via: cpRvViaKeys(via, mids),
        note: 'на сайт: ' + CPDisk.showPath(cpParentDir(moved[0].to)) + cpRvViaNote(via, mids) });
      cbToast('На сайт: карточек ' + moved.length + ' → ' + CPDisk.showPath(cpParentDir(moved[0].to))
        + (queued.length ? '. Не перенеслись сразу: ' + queued.length + ' — переношу повторно (плашка сверху)' : ''));
    } else if (queued.length) cbToast('Не перенеслось сразу: ' + queued.length + ' — переношу повторно, не закрывайте страницу (плашка сверху)');
    cbRenderCards();
    cbRenderOutline();
    if (!moved.length) return;
    /* в «Сайте» новое: съёмка сразу в его фильтре, у папки даты — снова «не скачано» */
    var siteDirs = [];
    moved.forEach(function (t) { var d = cpParentDir(t.to); if (siteDirs.indexOf(d) === -1) siteDirs.push(d); });
    siteDirs.forEach(function (d) { cpReviewPresentStage('site', shoot.name, d); });
    if (typeof cpSiteMarkNew === 'function') cpSiteMarkNew(siteDirs);
    if (typeof cpRetouchCleanupSoon === 'function') cpRetouchCleanupSoon();
    return Promise.all([cpOutputAppend(rows)].concat(moved.map(function (t) { return cpTrashEmptyUp(cpParentDir(t.from), cpParentDir(base)); })));
  }).catch(function (e) {
    cbBusyHide();
    cbRenderCards();
    cpHandleError(e, 'Отправка на сайт');
  });
};

/** Записать в отбор: версия ретуши карточки на сайте (to — папка в 05). Общая для сразу и для очереди. */
function cpRvApplyApproved(m, id, from, to, who, ts, date, via) {
  var last = cpLastRv((m.rv || {})[id]);
  if (!last) return;
  if (via) last.via = via;
  delete last.ready;
  (last.files || []).forEach(function (f) { if (f.path.indexOf(from + '/') === 0) f.path = to + f.path.slice(from.length); });
  last.dir = to;
  last.status = 'approved'; last.rby = who; last.rts = ts; last.site = CPDisk.showPath(to);
  var rec = { files: (last.files || []).length, letter: last.letter, date: date, at: CPDisk.showPath(to), out: last.letter + '_' + last.n, ts: ts };
  m.delivered = m.delivered || {};
  m.delivered[id] = rec;
  /* у артикула бывает две карточки — сдан артикул целиком (только в открытой съёмке: нужны карточки) */
  var card = CP.shoot && typeof cbCardById === 'function' ? cbCardById(id) : null;
  if (card && typeof cpArtKey === 'function') App.cards.forEach(function (c) { if (c.id !== id && cpArtKey(c) === cpArtKey(card) && !m.delivered[c.id]) m.delivered[c.id] = rec; });
}

CPQ.after['rv-approve'] = function (op, m, shoot) {
  var a = op.after;
  cpRvApplyApproved(m, a.id, a.from, a.to, a.who, new Date().toISOString(), a.date, a.via);
  var last = cpLastRv((m.rv || {})[a.id]), card = CP.shoot && CP.shoot.path === shoot.path ? cbCardById(a.id) : null;
  if (last) cpOutputAppend([cpOutputRow(last, shoot.name, card || { title: a.id }, 'принято', a.via)]);
  if (a.base) cpTrashEmptyUp(cpParentDir(a.from), cpParentDir(a.base));
  if (CP.shoot && CP.shoot.path === shoot.path) {
    if (typeof cpSiteMarkNew === 'function') cpSiteMarkNew([cpParentDir(a.to)]);
    if (typeof cpRetouchCleanupSoon === 'function') cpRetouchCleanupSoon();
  }
};

/* ---------- на доработку: остаётся в 04 с припиской «_доработка» ---------- */

var cpRvReworkLegacy = cpRvRework;
cpRvRework = function (id, note) {
  var root = cpReviewRoot();
  if (!root) { if (cpCatStageMissing('retouched')) return; return cpRvReworkLegacy(id, note); }
  var last = cpLastRv(cpRv()[id]);
  if (!last) return;
  if (note === undefined) note = prompt('Что доработать? (увидит ретушёр)', '');
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
    cpRvReworkDone(card, id, last);
  }, function (e) {
    /* папка не переименовалась — переименование в очередь; статус «на доработке» появится,
       когда папка на Диске получит приписку (Маша, 10.11: сначала перенос, потом статус) */
    CPQ.add(CP.shoot, { kind: 'move', label: 'На доработку: ' + (card ? card.title || 'карточка' : id), items: [{ from: from, path: to }],
      after: { type: 'rv-rework', id: id, from: from, to: to, note: note.trim(), by: cpActor(), card: card ? card.title || '' : '' }, err: (e && e.message) || '' });
    cbToast('Папка не переименовалась сразу — повторяю; «на доработке» появится, когда она получит приписку на Диске (плашка сверху)');
  }).catch(function (e) {
    cpHandleError(e, 'На доработку');
  });
};

function cpRvReworkDone(card, id, last) {
    cpEvent('rt_rework', [], { card: card ? card.title : id, note: last.note || '' });
    cbRenderCards();
    cbRenderOutline();
    return cpOutputAppend([cpOutputRow(last, CP.shoot.name, card, 'доработка' + (last.note ? ': ' + last.note : ''))]);
}

CPQ.after['rv-rework'] = function (op, m, shoot) {
  var a = op.after, last = cpLastRv((m.rv || {})[a.id]);
  if (!last) return;
  (last.files || []).forEach(function (f) { if (f.path.indexOf(a.from + '/') === 0) f.path = a.to + f.path.slice(a.from.length); });
  last.dir = a.to;
  /* папка переименована — теперь и статус (в старых записях очереди решение уже записано) */
  if (last.status !== 'rework') {
    var now = new Date().toISOString();
    last.status = 'rework'; last.rby = a.by || cpActor(); last.rts = now; last.note = a.note || '';
    (m.events = m.events || []).push({ ts: now, action: 'rt_rework', actor: last.rby, items: [], card: a.card || a.id, note: last.note });
    cpOutputAppend([cpOutputRow(last, shoot.name, { title: a.card || a.id }, 'доработка' + (last.note ? ': ' + last.note : ''))]);
  }
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
  var inQueue = CPQ.pendingFrom();
  var copy = want.filter(function (pid) { var p0 = cbPhotoById(pid); return !ap2[pid] && !(p0 && inQueue[p0.disk]); }).map(function (pid) {
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
    /* не скопированное — в очередь: копирует, пока не скопирует, потом отмечает в ap2 */
    var left = copy.filter(function (x) { return failed[x.from]; });
    if (left.length) {
      var map = {};
      left.forEach(function (x) { map[x.from] = [x.pid, x.path]; });
      CPQ.add(CP.shoot, { kind: 'copy', label: 'На согласование: ' + left.length + ' кадр(ов)', items: left.map(function (x) { return { from: x.from, path: x.path }; }), dirs: [base], after: { type: 'ap2', map: map } });
    }
    msgs.push('на согласование в ' + label + ': ' + (r.done + r.exists) + (r.failed.length ? ', не скопировано ' + r.failed.length : ''));
    if (typeof cpReviewPresentStage === 'function') cpReviewPresentStage('approval', shootName, base);
  }) : Promise.resolve();
  return step.then(function () {
    if (!drop.length) return;
    var paths = drop.map(function (pid) { return ap2[pid]; });
    return CPDisk.trash(paths).then(function (res) {
      var ok = res.filter(function (x) { return x.status === 'done' || x.status === 'gone'; }).map(function (x) { return x.path; });
      var bad = res.filter(function (x) { return x.status !== 'done' && x.status !== 'gone'; }).map(function (x) { return x.path; });
      if (bad.length) CPQ.add(CP.shoot, { kind: 'trash', label: 'Снять с согласования (в Корзину): ' + bad.length, paths: bad, after: { type: 'ap2-drop', paths: bad } });
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

/**
 * На согласование (Маша, 10.11.2026): сначала копия в 02, потом статус — «статус появляется на
 * основании того, что что-то наличествует на Диске в нужном месте». groups: [{cardId, pids}].
 * Что не скопировалось сразу, уходит в очередь и получает статус, когда доедет (CPQ.after.st).
 */
function cpApprovalSend(groups, opts) {
  opts = opts || {};
  var root = cpApproveRoot();
  if (!root || !CP.shoot || CP.readOnly) return;
  var shoot = { path: CP.shoot.path, name: CP.shoot.name }, shootPath = shoot.path.replace(/\/+$/, '');
  var base = root.replace(/\/+$/, '') + '/' + CPDisk.safeName(shoot.name);
  var who = cpActor(), m = cpMeta(), going = cpGoingFrom('approval');
  var items = [], seen = {}, cardOf = {}, already = [], wait = 0;
  groups.forEach(function (g) {
    var card = g.cardId ? cbCardById(g.cardId) : null;
    (g.pids || []).forEach(function (pid) {
      var p = cbPhotoById(pid);
      if (!p || !p.disk || p.missing || (p.kind || 'photo') === 'ref' || seen[pid]) return;
      seen[pid] = true;
      cardOf[pid] = g.cardId || null;
      /* копия уже в 02 и статус стоит — второй раз не копируем */
      if (m.status[pid] && m.status[pid].s === 'approval' && (m.ap2 || {})[pid]) { already.push(pid); return; }
      if (going[p.disk]) { wait++; return; }
      items.push({ pid: pid, from: p.disk, path: base + '/' + cpRetouchRel(p, card, shootPath) });
    });
  });
  var label = cpFolderBase(root);
  /* статус — кадрам, чья копия на месте, и карточкам, у которых такие кадры есть */
  var mark = function (okItems) {
    var mm = cpMeta(), ts = new Date().toISOString(), okPid = {};
    mm.ap2 = mm.ap2 || {};
    okItems.forEach(function (x) {
      mm.status[x.pid] = { s: 'approval', by: who, ts: ts, card: cardOf[x.pid] || undefined };
      mm.ap2[x.pid] = x.path;
      okPid[x.pid] = true;
    });
    already.forEach(function (pid) { okPid[pid] = true; });
    var nCards = 0;
    groups.forEach(function (g) {
      if (!g.cardId || !(g.pids || []).some(function (pid) { return okPid[pid]; })) return;
      var cs = mm.cardStatus[g.cardId];
      if (!(cs && cs.s === 'approval')) { mm.cardStatus[g.cardId] = { s: 'approval', by: who, ts: ts }; nCards++; }
    });
    return nCards;
  };
  var names = function (list) { return cpPhotoNames(list.map(function (x) { return x.pid; })); };
  var cardNames = groups.map(function (g) { var c = g.cardId ? cbCardById(g.cardId) : null; return c ? c.title || c.category || 'карточка' : ''; }).filter(Boolean).join(', ');
  var after = function (list) {
    var a = { type: 'st', s: 'approval', by: who, map: {}, cards: {}, ap2: {} };
    list.forEach(function (x) { a.map[x.from] = x.pid; if (cardOf[x.pid]) a.cards[x.pid] = cardOf[x.pid]; a.ap2[x.pid] = x.path; });
    return a;
  };
  var queue = function (list, err) {
    CPQ.add(shoot, { kind: 'copy', label: 'На согласование: ' + list.length + ' кадр(ов)', items: list.map(function (x) { return { from: x.from, path: x.path }; }), dirs: [base], after: after(list), err: err || '' });
  };
  var done = function (okItems, queued) {
    var same = CP.shoot && CP.shoot.path === shoot.path;
    if (!same) return;
    var nCards = mark(okItems);
    if (okItems.length || nCards) {
      cpEvent(opts.event || 'to_approval', names(okItems), { card: cardNames || undefined, folder: CPDisk.showPath(base), note: opts.note || undefined });
      if (typeof cpReviewPresentStage === 'function') cpReviewPresentStage('approval', shoot.name, base);
    }
    cpAfterStatus();
    if (typeof cbRenderOutline === 'function') cbRenderOutline();
    if (opts.quiet) return;
    if (!okItems.length && !queued && !nCards) { cbToast(already.length || wait ? 'Уже на согласовании' + (wait ? ' (часть ещё копируется)' : '') : 'На согласование не отправлено: этих кадров нет на Диске'); return; }
    cbToast('На согласование в ' + label + ': ' + okItems.length + ' кадр(ов)' + (already.length ? ', уже были ' + already.length : '')
      + (queued ? '. Не скопировалось сразу: ' + queued + ' — копирую повторно, статус появится, когда файлы будут на месте' : ''));
  };
  if (!items.length) { done([], 0); return; }
  _cpApBusy = true;
  cpCopyOnDisk(items.map(function (x) { return { from: x.from, path: x.path }; }), [base], 'Копирую на согласование').then(function (r) {
    cbBusyHide();
    _cpApBusy = false;
    var bad = {};
    (r.failedFrom || []).forEach(function (f) { bad[f] = true; });
    var left = items.filter(function (x) { return bad[x.from]; });
    if (left.length) queue(left, r.failed && r.failed[0]);
    done(items.filter(function (x) { return !bad[x.from]; }), left.length);
  }, function (e) {
    cbBusyHide();
    _cpApBusy = false;
    queue(items, (e && e.message) || '');
    done([], items.length);
  });
}

CPQ.after['ap2'] = function (op, m) {
  m.ap2 = m.ap2 || {};
  Object.keys(op.after.map || {}).forEach(function (from) { var v = op.after.map[from]; m.ap2[v[0]] = v[1]; });
};
CPQ.after['ap2-drop'] = function (op, m) {
  m.ap2 = m.ap2 || {};
  Object.keys(m.ap2).forEach(function (pid) { if ((op.after.paths || []).indexOf(m.ap2[pid]) !== -1) delete m.ap2[pid]; });
};

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
  if (typeof cpStageNote === 'function') cpStageNote(key, shootName, dir);
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
    /* охват скачивания (Маша, 09.11): в 02 — «отбор» или «все файлы съёмки»; в 04 — «сдано (с ретушью)»,
       «не сдано (без ретуши — кадры из 03)» или всё */
    CP.sel = { path: path, name: name, modified: modified, stage: key, stagePaths: paths.slice(), loading: true, open: {}, folders: {}, files: [], dirs: [],
      scope: key === 'review' ? 'done' : 'stage', media: '', brak: '' };
    cpMarkSelected();
    cpRenderPanel();
    var sel = CP.sel, low = String(name).toLowerCase();
    sel.stageTags = {};
    var walk = function (p) {
      return CPDisk.walkPhotos(p, false, 4, true).then(function (files) { return { root: p, files: files, dirs: files.dirs || [] }; },
        function (e) { return { root: p, files: [], dirs: [], error: e }; });
    };
    var rtPaths = key === 'review' && CP.stagePaths.retouch ? (CP.stagePaths.retouch[low] || []) : [];
    Promise.all([
      Promise.all(sel.stagePaths.map(walk)),
      /* отбор съёмки — чьи это карточки (теги ретушёров и прочие) */
      CPDisk.readState(path).then(function (st) { return st.data; }, function () { return null; }),
      cpLoadDict().catch(function () { return null; }),
      Promise.all(rtPaths.map(walk))
    ]).then(function (r) {
      if (CP.sel !== sel) return;
      sel.stageFiles = r[0];
      sel.data = r[1];
      sel.rtFiles = r[3];
      sel.loading = false;
      cpStageTagIndex(sel);
      cpRenderPanel();
    });
  };
})(cpSelectShoot);

/* Теги в папке этапа (Маша, 08.11: «в ретуши — сверху теги, которые есть: тыкнуть тег и
   скачать по тегу; проставлено моё имя — скачала с именем, или всё, что без имени»).
   У каждого файла этапа — теги его карточки (по кадру отбора: путь внутри съёмки или имя)
   и буква ретушёра из имени папки («Y_74595_…»); ещё — кадр, карточка, брак. */
var CP_NO_RT = '__без_ретушёра__';

/* ---------- папка ретуши: кто скачал ----------
   Маша, 10.11.2026: «из папки ретушь нельзя скачать, не поставив галку тега — иначе непонятно,
   кто скачал, кто забрал и что вообще произошло»; «скачанное не показываем в том, что можно
   забрать, — фильтр сверху «показать скачанное»: один ретушёр скачал, но заболел, не отдал —
   чтобы другой мог скачать с переменой буквы; а когда ретушёр идёт за тем, что ещё не скачивали,
   лишнего шума нет»; «галка внизу перед кнопкой «Скачать» — скачать уже скачанные: потерял
   файлы — загрузил ещё раз, но чтобы случайно не взял то, что уже скачал, и не делал дважды».
   В панели съёмки в фильтре папки ретуши:
     - сверху «Кто скачивает» — буквы ретушёров из словаря; без буквы кнопка «Скачать» не
       работает (букв в словаре нет — правило не действует, скачивается как раньше);
     - скачали — каждому файлу в отборе съёмки пишется запись «скачано» (meta.cp.rtdl: буква,
       кто, когда, какой архив, сколько раз), карточкам этих файлов ставится буква ретушёра,
       в журнал — событие. Папки на Диске программа не переименовывает;
     - скачанное и забранное (буква в имени папки — «Y_74595_…») в списке и в счётчиках не
       показывается, пока не отмечено «показать скачанное»;
     - даже показанное скачанное в архив не попадает, пока не отмечено «и уже скачанные»;
       скачали с другой буквой — запись и буква карточки меняются на новую. */

/** Ключ файла этапа: путь внутри папки съёмки на этапе без буквы ретушёра и «_доработка» в
    именах папок, строчными. -> {key, letter, segs, name} */
function cpStageKey(rel, letters) {
  var segs = String(rel || '').split('/'), name = segs.pop(), letter = '';
  segs = segs.map(function (sg) {
    var mm = /^([A-Za-zА-Яа-яЁё]{1,3})_(.+)$/.exec(sg);
    if (mm && letters.indexOf(mm[1]) !== -1) { letter = mm[1]; return mm[2]; }
    return sg.replace(/_доработка$/i, '');
  });
  return { key: segs.concat([name]).join('/').toLowerCase(), letter: letter, segs: segs, name: name };
}

/* Запись «скачано» относится к тому файлу, который скачали: копию из папки ретуши могли убрать
   (артикул сдан — в Корзину) и позже положить заново — это уже другой файл с тем же путём, и он
   снова «не скачан». Различаем по номеру файла на Диске (resource_id; у копии он новый). */
function cpRidShort(f) { var r = String((f && f.resource_id) || ''); return r ? r.slice(-16) : ''; }

/** Файл папки ретуши уже скачан (запись в отборе) или забран (буква в имени папки). */
function cpStageTaken(sel, f) { return sel.stage === 'retouch' && !!f.cpTook; }
/** Виден в панели: скачанное из папки ретуши прячем, пока не отмечено «показать скачанное». */
function cpStageShown(sel, f) { return !cpStageTaken(sel, f) || !!sel.showTaken; }

function cpStageTagIndex(sel) {
  var data = sel.data || {}, photos = data.photos || [], cards = data.cards || [];
  var m = (data.meta && data.meta.cp) || {}, status = m.status || {}, cst = m.cardStatus || {};
  var src = String(sel.path || '').replace(/\/+$/, '') + '/';
  var letters = typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
  var byRel = {}, byStem = {}, tagsOf = {}, cardOf = {};
  photos.forEach(function (p) {
    if (!p.disk) return;
    var rel = p.disk.indexOf(src) === 0 ? p.disk.slice(src.length) : p.name;
    byRel[rel.toLowerCase()] = p.id;
    var st = cpStem(p.name || rel.split('/').pop());
    (byStem[st] = byStem[st] || []).push(p.id);
  });
  cards.forEach(function (c) {
    var pids = c.mode === 'auto' ? (c.pids || []) : (c.slots || []).map(function (x) { return x.pid; }).filter(Boolean);
    pids.forEach(function (pid) {
      (tagsOf[pid] = tagsOf[pid] || {}); (c.tags || []).forEach(function (t) { tagsOf[pid][t] = true; });
      (cardOf[pid] = cardOf[pid] || []).push(c.id);   /* у артикула бывает две карточки */
    });
  });
  var rtdl = sel.stage === 'retouch' ? (m.rtdl || {}) : null;
  /* сдано: у карточки есть загруженная ретушь или она на сайте (отметки отбора), либо папка этого
     артикула уже лежит в 04 / на сайте (по папкам) — забирать такое из ретуши незачем */
  var delivered = m.delivered || {}, low = String(sel.name || '').toLowerCase(), doneCodes = {};
  if (rtdl && typeof cpArtsAhead === 'function' && CP.stageArtsFor === CP.archive) doneCodes = cpArtsAhead(low, 'retouch');
  var stype = typeof cpShootType === 'function' ? cpShootType(sel.name) : null;
  var isDone = function (k, cards) {
    if (cpStageHasRv(sel, cards) || (cards || []).some(function (c) { return delivered[c]; })) return true;
    for (var i = k.segs.length - 1; i >= 0; i--) {
      var code = typeof cpArtCode === 'function' ? cpArtCode(stype, k.segs[i]) : '';
      if (code) return !!doneCodes[code];
    }
    return false;
  };
  var index = function (x, own) {
    x.files.forEach(function (f) {
      var rel = f.path.indexOf(x.root + '/') === 0 ? f.path.slice(x.root.length + 1) : f.name;
      var k = cpStageKey(rel, letters), name = k.name, tags = {};
      if (k.letter) tags[k.letter] = true;
      var pid = byRel[k.key];
      if (!pid) { var c = byStem[cpStem(name)] || []; if (c.length === 1) pid = c[0]; }
      if (pid && tagsOf[pid]) Object.keys(tagsOf[pid]).forEach(function (t) { tags[t] = true; });
      /* папка ретуши: запись «скачано» из отбора; буква в имени папки — забрали руками на Диске */
      f.cpKey = k.key;
      f.cpTook = null;
      if (rtdl && own) {
        var rec = rtdl[k.key], rid = cpRidShort(f);
        if (rec && rec.rid && rid && rec.rid !== rid) rec = null;   /* на этом месте лежит уже другая копия */
        f.cpTook = rec || (k.letter ? { l: k.letter, folder: true } : null);
        if (rec && rec.l) tags[rec.l] = true;
        f.cpDone = isDone(k, pid ? cardOf[pid] || [] : []);
        if (f.cpDone && !f.cpTook) f.cpTook = { l: '', done: true };
      }
      if (letters.length && !Object.keys(tags).some(function (t) { return letters.indexOf(t) !== -1; })) tags[CP_NO_RT] = true;
      f.cpTags = Object.keys(tags);
      f.cpPid = pid || '';
      f.cpCards = pid ? cardOf[pid] || [] : [];
      f.cpBrak = !!(pid && ((status[pid] && status[pid].s === 'reshoot') || f.cpCards.some(function (c) { return cst[c] && cst[c].s === 'reshoot'; })));
    });
  };
  (sel.stageFiles || []).forEach(function (x) { index(x, true); });
  (sel.rtFiles || []).forEach(function (x) { index(x, false); });
  (sel.srcFiles || []).forEach(function (x) { index(x, false); });
}

/** Файл этапа проходит отмеченные теги (отмечено несколько — подходит любой). */
function cpStageTagOk(sel, f) {
  var on = Object.keys(sel.stageTags || {}).filter(function (k) { return sel.stageTags[k]; });
  return !on.length || (f.cpTags || []).some(function (t) { return on.indexOf(t) !== -1; });
}

/** Все фильтры панели этапа: теги, видео, брак; в папке ретуши — без уже скачанного, пока не попросили. */
function cpStageOk(sel, f) {
  if (cpStageTaken(sel, f) && !sel.againTaken) return false;
  if (!cpStageTagOk(sel, f)) return false;
  var v = typeof cpIsVideo === 'function' && cpIsVideo(f.name);
  if (sel.media === 'video' && !v) return false;
  if (sel.media === 'novideo' && v) return false;
  if (sel.brak === 'no' && f.cpBrak) return false;
  if (sel.brak === 'only' && !f.cpBrak) return false;
  return true;
}

/** Пути внутри архива для группы папок этапа: несколько папок («Сайт» по датам) — дата сверху. */
function cpStagePre(sel, groups, x) {
  if (groups.length < 2) return '';
  var stageRoot = String((CP.settings || {})[CP_STAGE_SETTING[sel.stage]] || '').replace(/\/+$/, '');
  var par = cpParentDir(x.root);
  return (par.indexOf(stageRoot + '/') === 0 ? par.slice(stageRoot.length + 1) : par.split('/').pop()) + '/';
}

/** Кадр сдан ретушёром — у его карточки (любой из карточек артикула) есть загруженная версия. */
function cpStageHasRv(sel, cards) {
  var rv = (sel.data && sel.data.meta && sel.data.meta.cp && sel.data.meta.cp.rv) || {};
  return (cards || []).some(function (c) { return rv[c] && rv[c].length; });
}

/** Что можно скачать при текущем охвате: [{f, name}] (до фильтров тегов, видео, брака). */
function cpStagePool(sel, scope) {
  var out = [], sc = scope || sel.scope || 'stage';
  var add = function (groups, prefix, keep) {
    (groups || []).forEach(function (x) {
      var pre = cpStagePre(sel, groups, x);
      x.files.forEach(function (f) {
        if (f.name === CPDisk.STATE_FILE || (keep && !keep(f)) || !cpStageShown(sel, f)) return;
        out.push({ f: f, name: prefix + pre + (f.path.indexOf(x.root + '/') === 0 ? f.path.slice(x.root.length + 1) : f.name) });
      });
    });
  };
  if (sel.stage === 'review') {
    var todo = function (f) { return !cpStageHasRv(sel, f.cpCards); };
    if (sc === 'done' || sc === 'both') add(sel.stageFiles, sc === 'both' ? 'с ретушью/' : '');
    if (sc === 'todo' || sc === 'both') add(sel.rtFiles, sc === 'both' ? 'без ретуши/' : '', todo);
    return out;
  }
  if (sc === 'all') { add(sel.srcFiles, ''); return out; }
  add(sel.stageFiles, '');
  return out;
}

function cpStageChips(sel) {
  var n = {}, letters = typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
  cpStagePool(sel).forEach(function (x) { (x.f.cpTags || []).forEach(function (t) { n[t] = (n[t] || 0) + 1; }); });
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

/** Папка ретуши: «Кто скачивает» (буква обязательна) и «показать скачанное». */
function cpStageWhoChips(sel, taken) {
  if (sel.stage !== 'retouch') return '';
  var letters = typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
  var h = '';
  if (letters.length) {
    h += '<div class="cp-fchips cp-stg-who"><span class="cp-fchips-l">Кто скачивает — отметьте свою букву' + (sel.who ? ':' : ' (без неё скачать нельзя):') + '</span>'
      + letters.map(function (t) {
        return '<button class="cp-fchip' + (sel.who === t ? ' cp-on' : '') + '" data-cp-swho="' + cbEsc(t) + '">' + cbEsc(t) + '</button>';
      }).join('') + '</div>';
  } else {
    h += '<div class="cp-note cp-warn">Букв ретушёров нет в словаре тегов (группа «[Ретушёры: один]») — скачивание не подписывается буквой.</div>';
  }
  if (taken) {
    h += '<div class="cp-fchips"><label class="cp-stg-ck" title="Что уже скачали, забрали (буква в имени папки) или сдали (ретушь уже в отретушированном или на сайте). По умолчанию скрыто, чтобы было видно только то, что ещё можно забрать">'
      + '<input type="checkbox" data-cp-staken="1"' + (sel.showTaken ? ' checked' : '') + '> показать скачанное и сданное <small>' + taken + '</small></label></div>';
  }
  return h;
}

/** Охват, видео, брак — над тегами. */
function cpStageScopeChips(sel) {
  var chip = function (attr, key, on, label, n) {
    return '<button class="cp-fchip' + (on ? ' cp-on' : '') + '" ' + attr + '="' + key + '">' + label + (n === undefined ? '' : ' <small>' + n + '</small>') + '</button>';
  };
  var cnt = function (sc) { return cpStagePool(sel, sc).length; };
  var h = '';
  if (sel.stage === 'review') {
    h += '<div class="cp-fchips"><span class="cp-fchips-l">Что скачать:</span>'
      + chip('data-cp-scope', 'done', sel.scope === 'done', 'Сдано — с ретушью', cnt('done'))
      + chip('data-cp-scope', 'todo', sel.scope === 'todo', 'Не сдано — без ретуши', cnt('todo'))
      + chip('data-cp-scope', 'both', sel.scope === 'both', 'Всё', cnt('both')) + '</div>';
  } else if (sel.stage === 'approval') {
    h += '<div class="cp-fchips"><span class="cp-fchips-l">Что скачать:</span>'
      + chip('data-cp-scope', 'stage', sel.scope === 'stage', 'Только отбор', cnt('stage'))
      + chip('data-cp-scope', 'all', sel.scope === 'all', 'Все файлы съёмки', sel.srcFiles ? cnt('all') : (sel.srcLoading ? '…' : undefined)) + '</div>';
  }
  var pool = cpStagePool(sel), nv = 0, nb = 0;
  pool.forEach(function (x) { if (typeof cpIsVideo === 'function' && cpIsVideo(x.f.name)) nv++; if (x.f.cpBrak) nb++; });
  if (nv || sel.media || sel.scope === 'all') {
    h += '<div class="cp-fchips"><span class="cp-fchips-l">' + (sel.media ? 'Скачать:' : 'Скачается всё. Или отметьте:') + '</span>'
      + chip('data-cp-smedia', 'video', sel.media === 'video', 'только видео', nv)
      + chip('data-cp-smedia', 'novideo', sel.media === 'novideo', 'без видео', pool.length - nv) + '</div>';
  }
  if (sel.stage === 'review' || nb || sel.brak) {
    h += '<div class="cp-fchips"><span class="cp-fchips-l">Брак:</span>'
      + chip('data-cp-sbrak', 'no', sel.brak === 'no', 'без брака', pool.length - nb)
      + chip('data-cp-sbrak', 'only', sel.brak === 'only', 'только брак', nb) + '</div>';
  }
  return h;
}

document.getElementById('cpPanel').addEventListener('click', function (e) {
  var sel = CP.sel;
  if (!sel || !sel.stage) return;
  var b = e.target.closest('[data-cp-stag]'), r = e.target.closest('[data-cp-stag-reset]');
  var sc = e.target.closest('[data-cp-scope]'), md = e.target.closest('[data-cp-smedia]'), bk = e.target.closest('[data-cp-sbrak]');
  var wh = e.target.closest('[data-cp-swho]');
  if (!b && !r && !sc && !md && !bk && !wh) return;
  e.preventDefault();
  if (wh) { var w = wh.getAttribute('data-cp-swho'); sel.who = sel.who === w ? '' : w; }
  else if (r) sel.stageTags = {};
  else if (b) { var t = b.getAttribute('data-cp-stag'); sel.stageTags[t] = !sel.stageTags[t]; }
  else if (md) { var k = md.getAttribute('data-cp-smedia'); sel.media = sel.media === k ? '' : k; }
  else if (bk) { var k2 = bk.getAttribute('data-cp-sbrak'); sel.brak = sel.brak === k2 ? '' : k2; }
  else if (sc) {
    sel.scope = sc.getAttribute('data-cp-scope');
    /* «все файлы съёмки» — читаем исходники, когда попросили */
    if (sel.scope === 'all' && !sel.srcFiles && !sel.srcLoading) {
      sel.srcLoading = true;
      CPDisk.walkPhotos(sel.path, false, 4, true).then(function (files) { return [{ root: sel.path.replace(/\/+$/, ''), files: files, dirs: files.dirs || [] }]; },
        function (err) { return [{ root: sel.path, files: [], dirs: [], error: err }]; }).then(function (g) {
        sel.srcFiles = g; sel.srcLoading = false;
        cpStageTagIndex(sel);
        if (CP.sel === sel) cpRenderPanel();
      });
    }
  }
  cpRenderPanel();
});

/* галки «показать скачанное» (сверху) и «и уже скачанные» (перед кнопкой «Скачать») */
document.getElementById('cpPanel').addEventListener('change', function (e) {
  var sel = CP.sel;
  if (!sel || sel.stage !== 'retouch') return;
  var tk = e.target.closest('[data-cp-staken]'), ag = e.target.closest('[data-cp-sagain]');
  if (!tk && !ag) return;
  if (tk) { sel.showTaken = tk.checked; if (!tk.checked) sel.againTaken = false; }
  else { sel.againTaken = ag.checked; if (ag.checked) sel.showTaken = true; }   /* что скачается повторно — должно быть видно */
  cpRenderPanel();
});

(function cpStageRtCss() {
  var st = document.createElement('style');
  st.textContent = '.cp-stg-ck{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#cfcac2;cursor:pointer}'
    + '.cp-stg-ck small{color:#8a877f}.cp-stg-ck input{accent-color:#C9956B}'
    + '.cp-panel-actions .cp-stg-again{order:5;margin-left:auto}.cp-panel-actions .cp-stg-again + .cb-primary{margin-left:0}'
    + '.cp-stg-who .cp-fchip{min-width:34px;font-weight:600}';
  document.head.appendChild(st);
})();

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
  var rt = sel.stage === 'retouch', taken = 0;
  var many = sel.stageFiles.length > 1;
  sel.stageFiles.forEach(function (x) {
    /* папка ретуши: папку, где всё уже скачано, не показываем вместе с её файлами */
    var has = {}, vis = {};
    if (rt) {
      x.files.forEach(function (f) {
        if (f.name === CPDisk.STATE_FILE) return;
        var rel0 = f.path.indexOf(x.root + '/') === 0 ? f.path.slice(x.root.length + 1) : f.name;
        var ps = cpParentDir(rel0) ? cpParentDir(rel0).split('/') : [], shown = cpStageShown(sel, f);
        for (var i = 1; i <= ps.length; i++) { var d = ps.slice(0, i).join('/'); has[d] = true; if (shown) vis[d] = true; }
      });
    }
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
    x.dirs.forEach(function (d) {
      if (d.indexOf(x.root + '/') !== 0) return;
      var r = d.slice(x.root.length + 1);
      if (rt && has[r] && !vis[r]) return;
      add(r);
    });
    x.files.forEach(function (f) {
      if (f.name === CPDisk.STATE_FILE) return;
      var rel = f.path.indexOf(x.root + '/') === 0 ? f.path.slice(x.root.length + 1) : f.name;
      var tk = rt ? f.cpTook : null, hide = !!tk && !sel.showTaken;
      if (tk) taken++;
      var dir = hide ? (pre ? pre + (cpParentDir(rel) ? '/' + cpParentDir(rel) : '') : cpParentDir(rel)) : (add(cpParentDir(rel)) || '');
      if (!hide) { nFiles++; bytes += f.size || 0; }
      var parts = dir ? dir.split('/') : [];
      for (var i = 0; i <= parts.length; i++) {
        var k = parts.slice(0, i).join('/');
        var a = agg[k] || (agg[k] = { n: 0, bytes: 0 });
        if (hide) { a.hid = (a.hid || 0) + 1; continue; }
        a.n++; a.bytes += f.size || 0;
        /* запись «скачано» из отбора: кто (буква) и когда — в отметку у папки */
        if (f.cpDone) a.done = (a.done || 0) + 1;
        if (tk && !tk.folder && !tk.done) {
          a.dl = (a.dl || 0) + 1;
          a.dlBy = a.dlBy || {};
          a.dlBy[tk.l || tk.by || '?'] = true;
          if (!a.dlTs || (tk.ts || '') > a.dlTs) a.dlTs = tk.ts || '';
        }
      }
    });
  });
  var kids = {};
  Object.keys(all).forEach(function (r) {
    var par = r.indexOf('/') === -1 ? '' : r.slice(0, r.lastIndexOf('/'));
    (kids[par] = kids[par] || []).push(r);
  });
  Object.keys(kids).forEach(function (k) { kids[k].sort(function (a, b) { return a.split('/').pop().localeCompare(b.split('/').pop(), undefined, { numeric: true }); }); });
  return { kids: kids, agg: agg, files: nFiles, bytes: bytes, taken: taken };
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
    var narrowed = anyTag || sel.media || sel.brak || (sel.scope && sel.scope !== 'stage' && sel.scope !== 'done');
    cpStagePool(sel).forEach(function (x) { if (cpStageOk(sel, x.f)) { picked++; pickedBytes += x.f.size || 0; } });
    var rt = sel.stage === 'retouch', rtLetters = rt && typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
    if (rt && sel.who && rtLetters.indexOf(sel.who) === -1) sel.who = '';
    var needWho = rt && rtLetters.length > 0 && !sel.who;
    var body = cpStageWhoChips(sel, t.taken) + cpStageScopeChips(sel) + cpStageChips(sel) + '<div class="cp-fold cp-fold-all"><span class="cp-fold-name">' + cbEsc(label) + ' <small>· файлов ' + t.files + ' · ' + cpMb(t.bytes) + '</small></span></div>';
    var top = t.kids[''] || [];
    if (!top.length) body += '<div class="cp-note">' + (t.files ? 'Вложенных папок нет — файлы лежат прямо в папке съёмки.'
      : rt && t.taken ? 'Забирать нечего: всё, что здесь лежит, уже скачано или сдано. Посмотреть — «показать скачанное и сданное» вверху.' : 'Папка пустая.') + '</div>';
    var letters = typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
    if (top.length === 1 && sel.open[top[0]] === undefined) sel.open[top[0]] = true;   /* одна папка — сразу раскрыта */
    var row = function (fp, depth) {
      var ch = t.kids[fp] || [], open = !!(sel.open && sel.open[fp]);
      var a = t.agg[fp] || { n: 0, bytes: 0 };
      var nm = fp.split('/').pop(), marks = '';
      var lm = /^([A-Za-zА-Яа-яЁё]{1,3})_/.exec(nm);
      if (lm && letters.indexOf(lm[1]) !== -1) marks += '<span class="cp-state cp-state-retouch">забрал ' + cbEsc(lm[1]) + '</span>';
      if (/_доработка$/i.test(nm)) marks += '<span class="cp-state cp-state-reshoot">на доработке</span>';
      if (rt && a.dl) {
        marks += '<span class="cp-state cp-state-dl" title="Скачано из папки ретуши' + (a.dlTs ? ': ' + cbEsc(cpFmtDate(a.dlTs)) : '') + '">'
          + (a.dl >= a.n ? 'скачано' : 'скачано ' + a.dl + ' из ' + a.n) + ': ' + cbEsc(Object.keys(a.dlBy || {}).join(', '))
          + (a.dlTs ? ' · ' + cbEsc(cpFmtDate(a.dlTs).slice(0, 5)) : '') + '</span>';
      }
      if (rt && a.done) marks += '<span class="cp-state cp-state-dl" title="Ретушь по этому артикулу уже сдана (лежит в отретушированном или на сайте)">' + (a.done >= a.n ? 'сдано' : 'сдано ' + a.done + ' из ' + a.n) + '</span>';
      if (rt && a.hid) marks += '<span class="cp-state" title="В этой папке есть файлы, которые уже скачали или сдали, — они скрыты">уже скачано или сдано: ' + a.hid + '</span>';
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
    var hidden = rt && !sel.showTaken ? t.taken : 0;
    var sum = (rt ? (sel.showTaken ? 'Здесь файлов' : 'Можно забрать') : 'Здесь файлов') + ': <b>' + t.files + '</b> · ' + cpMb(t.bytes)
      + (hidden ? ' · уже скачано или сдано (скрыто): ' + hidden : '')
      + (narrowed || (rt && sel.showTaken && t.taken) ? ' · к скачиванию: <b>' + picked + '</b> · ' + cpMb(pickedBytes) : '');
    /* перед кнопкой «Скачать»: взять и то, что уже скачивали (потерял файлы, забирает другой ретушёр) */
    var again = rt && t.taken ? '<label class="cp-stg-ck cp-stg-again" title="Без галки уже скачанное в архив не попадёт — чтобы не взять в работу второй раз. '
      + 'С галкой — попадёт (и сданное тоже); скачали с другой буквой — артикул переходит к ней"><input type="checkbox" data-cp-sagain="1"' + (sel.againTaken ? ' checked' : '') + '> и уже скачанные <small>' + t.taken + '</small></label>' : '';
    var btn = needWho ? 'Отметьте свою букву — без неё не скачать'
      : (sel.scope === 'all' ? 'Скачать файлы съёмки'
        : sel.scope === 'todo' ? 'Скачать без ретуши' : sel.scope === 'both' ? 'Скачать всё: с ретушью и без'
        : rt && sel.who ? (anyTag ? 'Скачать по тегам как ' : 'Скачать как ') + cbEsc(sel.who)
        : anyTag ? 'Скачать по тегам' : 'Скачать всё из ' + cbEsc(label)) + ' · ' + picked;
    panel.innerHTML = head + '<div class="cp-panel-body">' + body + '</div><div class="cp-panel-actions"><div class="cp-sum">' + sum + '</div>'
      + acts + again + '<button class="cb-primary" data-cp-stdl="1"' + (picked && !needWho ? '' : ' disabled') + '>' + btn + '</button></div>';
  };
})(cpRenderPanel);

/* «Скачать отсюда»: что выбрано в панели этапа, одним архивом со структурой */
document.getElementById('cpPanel').addEventListener('click', function (e) {
  if (!e.target.closest('[data-cp-stdl]') || !CP.sel || !CP.sel.stage || !CP.sel.stageFiles) return;
  e.preventDefault();
  var sel = CP.sel, entries = [], got = [];
  var rt = sel.stage === 'retouch', who = rt ? (sel.who || '') : '';
  if (rt && !who && typeof cpRetoucherTags === 'function' && cpRetoucherTags().length) { cbToast('Отметьте вверху свою букву — без неё из папки ретуши не скачать'); return; }
  cpStagePool(sel).forEach(function (x) { if (cpStageOk(sel, x.f)) { entries.push({ from: x.f.path, size: x.f.size, name: x.name }); got.push(x.f); } });
  if (!entries.length) { cbToast('Нечего скачивать'); return; }
  var on = Object.keys(sel.stageTags || {}).filter(function (k) { return sel.stageTags[k] && k !== who; }).map(function (t) { return t === CP_NO_RT ? 'без ретушёра' : t; });
  if (who) on.unshift(who);
  var extra = { all: 'все файлы', todo: 'без ретуши', both: 'с ретушью и без' }[sel.scope] || '';
  if (sel.media) extra += (extra ? '+' : '') + (sel.media === 'video' ? 'видео' : 'без видео');
  if (sel.brak) extra += (extra ? '+' : '') + (sel.brak === 'only' ? 'брак' : 'без брака');
  var name = CPDisk.safeName(sel.name) + '_' + CPDisk.safeName(cpStageLabel(sel.stage)) + (extra ? '_' + CPDisk.safeName(extra) : '')
    + (on.length ? '_' + CPDisk.safeName(on.join('+')) : '') + '_' + cpToday();
  cpExportBundle(name, entries, cpStageLabel(sel.stage) + ': файлов ' + entries.length + '.' + (rt ? ' После скачивания файлы отмечаются как скачанные' + (who ? ' (' + who + ')' : '') + '.' : ''))
    .then(function (r) { return rt ? cpStageMarkTaken(sel, got, who, name, r) : null; })
    .catch(function (err) { cpHandleError(err, 'Скачивание'); });
});

/** Скачали из папки ретуши: запись у каждого файла, буква — карточкам, событие в журнал. */
function cpStageMarkTaken(sel, files, who, name, r) {
  var letters = typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
  var actor = cpActor(), now = new Date().toISOString();
  var again = files.filter(function (f) { return f.cpTook; }).length;
  /* записи о файлах, которых в папке ретуши давно нет (старше 30 дней), убираем — чтобы отбор не рос */
  var live = {}, whole = !(sel.stageFiles || []).some(function (x) { return x.error; });
  (sel.stageFiles || []).forEach(function (x) { x.files.forEach(function (f) { if (f.cpKey) live[f.cpKey] = true; }); });
  var old = new Date(Date.now() - 30 * 86400000).toISOString();
  return cpMutateState(sel, function (d) {
    var m = d.meta.cp, map = m.rtdl = m.rtdl || {};
    if (whole) Object.keys(map).forEach(function (k) { if (!live[k] && (map[k].ts || '') < old) delete map[k]; });
    var cardIds = {};
    files.forEach(function (f) {
      var cur = map[f.cpKey], rid = cpRidShort(f);
      if (cur && cur.rid && rid && cur.rid !== rid) cur = null;   /* прежняя запись — о другой копии */
      var rec = { l: who, by: actor, ts: now, export: name, n: (cur && cur.n ? cur.n : 0) + 1 };
      if (rid) rec.rid = rid;
      map[f.cpKey] = rec;
      (f.cpCards || []).forEach(function (id) { cardIds[id] = true; });
    });
    /* «забрал»: буква ретушёра у карточки; другая буква (забирает второй ретушёр) заменяется */
    var titles = [], moved = [];
    (d.cards || []).forEach(function (c) {
      if (!cardIds[c.id]) return;
      titles.push(c.title || 'карточка');
      if (!who) return;
      var was = (c.tags || []).filter(function (t) { return letters.indexOf(t) !== -1 && t !== who; });
      if (was.length) moved.push((c.title || 'карточка') + ' (' + was.join(', ') + ' → ' + who + ')');
      c.tags = (c.tags || []).filter(function (t) { return letters.indexOf(t) === -1 && t !== who; });
      c.tags.push(who);
    });
    var note = [];
    if (who) note.push('буква ' + who);
    if (again) note.push('повторно: ' + again);
    if (moved.length) note.push('сменили ретушёра: ' + moved.join(', '));
    cpShelfEvent(d, 'download_retouch', { export: name, count: (r && r.files) || files.length, parts: r && r.parts ? r.parts.length : undefined,
      card: titles.length ? titles.join(', ') : undefined, letter: who || undefined, note: note.join(' · ') || undefined });
  }).then(function () {
    if (CP.sel !== sel) return;
    sel.againTaken = false;
    cpStageTagIndex(sel);
    cpRenderPanel();
    cbToast('Скачано из папки ретуши: файлов ' + files.length + (who ? ' — отмечено за ' + who : '') + '. В списке осталось то, что ещё не забрали.');
  }, function (e) {
    if (window.console) console.error('[CP] отметка «скачано» не записалась', e && (e.body || e.message || e));
    cbToast('Архив собран, но отметка «скачано' + (who ? ' (' + who + ')' : '') + '» не записалась в отбор съёмки — другим эти файлы всё ещё видны как не забранные.');
  });
}

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

/* Сдача просто папками артикулов (Маша, 10.11.2026: «ретушёр должен мочь загрузить просто
   папками артикулов, без дополнительных данных; программа находит, в какой съёмке есть такой
   артикул — может быть в нескольких — и спрашивает: эту съёмку сдаём, ты — тот ретушёр, который
   забирал? Человек ставит «да» — и подгружается в нужную съёмку»).
   Где искать: артикулы, которые сейчас лежат в папке ретуши или в отретушированном (сверка
   витрины с Диском, CP.stageArts) — то есть в работе. */

/** Коды артикулов из перетащенных папок (буква ретушёра в начале имени не мешает); нет папок — из имён файлов. */
function cpDropCodes(files) {
  var codes = {}, order = [];
  var letters = typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
  var add = function (c) { if (c && !codes[c]) { codes[c] = true; order.push(c); } };
  files.forEach(function (x) {
    var segs = String(x.rel || '').split('/'), name = segs.pop(), got = '';
    for (var i = segs.length - 1; i >= 0 && !got; i--) {
      var sg = segs[i], lm = /^([A-Za-zА-Яа-яЁё]{1,3})_(.+)$/.exec(sg);
      if (lm && letters.indexOf(lm[1]) !== -1) sg = lm[2];
      got = cpArtCode(null, sg);
    }
    if (!got && !segs.length) got = cpArtCode(null, name);
    add(got);
  });
  return order;
}

/** Съёмки, где эти артикулы сейчас в работе: {codes, list: [{d, hit: [коды], miss: [коды]}]} — лучшая первой. */
function cpShootsByArticles(files) {
  var codes = cpDropCodes(files), list = [];
  if (!codes.length) return { codes: codes, list: list };
  (CP.shoots || []).forEach(function (d) {
    var low = d.name.toLowerCase(), have = {};
    ['retouch', 'review'].forEach(function (key) {
      if (!(CP.stagePresence && CP.stagePresence[key] && CP.stagePresence[key][low])) return;
      var c = ((CP.stageArts || {})[key] || {})[low];
      if (c) Object.keys(c).forEach(function (k) { have[k] = true; });
    });
    var hit = codes.filter(function (c) { return have[c]; });
    if (hit.length) list.push({ d: d, hit: hit, miss: codes.filter(function (c) { return !have[c]; }) });
  });
  list.sort(function (a, b) { return b.hit.length - a.hit.length || (a.d.modified < b.d.modified ? 1 : -1); });
  return { codes: codes, list: list };
}

/** Открыть окно сдачи для найденной съёмки (found — из cpShootsByArticles). */
function cpAcceptOpenFound(found, d, files) {
  cpAcceptOpen(d.path, d.name);
  if (!CP.accept) return;
  CP.accept.found = found;
  CP.accept.foundFiles = files;
  cpAcceptAdd(files);
}

/** Артикулы нашлись в нескольких съёмках — сначала спросить, в какую сдаём (ничего не выбрано заранее). */
function cpAcceptChoose(found, files) {
  var box = document.getElementById('cpAccept');
  if (!box) { box = document.createElement('div'); box.id = 'cpAccept'; box.className = 'cp-files'; document.body.appendChild(box); }
  CP.accept = null;
  CP.acceptChoice = { found: found, files: files };
  box.innerHTML = '<div class="cp-files-box"><div class="cp-files-head"><b>Сдать ретушь · в какую съёмку?</b><button data-cp-acc-x="1" title="Закрыть">×</button></div>'
    + '<div class="cp-acc-body"><div class="cp-acc-found">Папки артикулов без папки съёмки: ' + cbEsc(found.codes.slice(0, 12).join(', ')) + (found.codes.length > 12 ? '…' : '')
    + '. Такие артикулы сейчас в работе в нескольких съёмках — выберите, в какую сдаём:'
    + '<div class="cp-acc-shoots">' + found.list.map(function (x, i) {
      return '<button data-cp-acc-pick="' + i + '"><b>' + cbEsc(x.d.name) + '</b><small>артикулов из ваших папок: ' + x.hit.length + ' из ' + found.codes.length
        + (x.miss.length ? ' · нет: ' + cbEsc(x.miss.slice(0, 6).join(', ')) : '') + '</small></button>';
    }).join('') + '</div></div></div></div>';
  box.classList.add('cp-open');
}

document.addEventListener('click', function (e) {
  var pick = e.target.closest('[data-cp-acc-pick]'), x = e.target.closest('[data-cp-acc-x]'), sw = e.target.closest('[data-cp-acc-shoot]');
  if (x) { document.getElementById('cpAccept').classList.remove('cp-open'); CP.acceptChoice = null; return; }
  if (pick && CP.acceptChoice) {
    var ch = CP.acceptChoice, it = ch.found.list[+pick.getAttribute('data-cp-acc-pick')];
    CP.acceptChoice = null;
    if (it) cpAcceptOpenFound(ch.found, it.d, ch.files);
    return;
  }
  if (sw && CP.accept && CP.accept.found) {
    e.preventDefault();
    var found = CP.accept.found, files = CP.accept.foundFiles || CP.accept.files, path = sw.getAttribute('data-cp-acc-shoot');
    var to = found.list.filter(function (y) { return y.d.path === path; })[0];
    if (to) cpAcceptOpenFound(found, to.d, files);
  }
});

function cpReviewDrop(files) {
  if (!files.length) return;
  var top = files[0].rel.split('/')[0];
  var d = files.every(function (f) { return f.rel.split('/')[0] === top; }) ? cpShootByFolder(top) : null;
  if (d) { cpAcceptOpen(d.path, d.name); cpAcceptAdd(files); return; }
  /* папки артикулов без папки съёмки — ищем съёмку по артикулам */
  var found = cpShootsByArticles(files);
  if (!found.list.length) {
    cbToast(found.codes.length ? 'Не нашла съёмку, где артикул' + (found.codes.length > 1 ? 'ы ' : ' ') + found.codes.slice(0, 6).join(', ') + ' сейчас в ретуши. Выберите съёмку и нажмите «Сдать»'
      : 'Не нашла съёмку по имени папки «' + top + '». Выберите съёмку и нажмите «Сдать»');
    return;
  }
  if (found.list.length === 1) cpAcceptOpenFound(found, found.list[0].d, files);
  else cpAcceptChoose(found, files);
}

cpRenderShoots = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    var root = cpReviewRoot(), list = document.getElementById('cpShelfList');
    if (!list || CP.stageFilter !== 'review' || !root || document.getElementById('cpRvDrop')) return r;
    list.insertAdjacentHTML('afterbegin', '<div class="cp-rv-drop" id="cpRvDrop">Перетащите сюда папку с готовой ретушью — как на Диск '
      + '(или <label class="cp-acc-pick">выберите папку<input type="file" id="cpRvDropPick" webkitdirectory multiple hidden></label>). '
      + 'Можно скачанный архив целиком, можно просто папки артикулов: съёмка найдётся по имени папки или по артикулам, файлы лягут в ' + cbEsc(cpFolderBase(root)) + '.</div>');
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

/* ---------- новая версия прямо в карточку ----------
   Маша, 09.11: «если попросили что-то поправить — чтобы можно было прямо в эту карточку
   засунуть: когда отправляется на доработку, появляется кнопка „загрузить“ прямо в карточке,
   ты карточку переделал и эти же фотки туда перетащил, переделанные. Они заменились».
   И: «ретушёр мог догрузить недостающий кадр непосредственно в карточку, перетаскивает».
   Файл с тем же именем (без «01_» и расширения) заменяет старый, новый — добавляется,
   остальные файлы версии остаются. Получается следующая версия «на проверке»; папка
   «_доработка» снова называется как артикул. */

function cpRvCardUpload(id, files) {
  files = (files || []).filter(function (x) { return x && x.file && !CP_JUNK_FILE.test(x.file.name); });
  if (!files.length || !CP.shoot) return Promise.resolve();
  var root = cpReviewRoot(), list = cpRv()[id], last = cpLastRv(list);
  if (!root || !last || (last.status !== 'review' && last.status !== 'rework')) { cbToast('Загрузить в карточку можно, когда она на проверке или на доработке'); return Promise.resolve(); }
  var card = cbCardById(id), idx = App.cards.indexOf(card), shoot = { path: CP.shoot.path, name: CP.shoot.name };
  var base = root.replace(/\/+$/, '') + '/' + CPDisk.safeName(shoot.name);
  var from = cpRvDirOf(last) || base + '/' + cpRvDirFor(card, idx);
  var target = from.replace(/_доработка$/i, '');
  /* кто сдаёт: буква этой версии, иначе — кто забирал карточку; с прошлого раза букву не берём */
  var letter = last.letter || (card && typeof cpCardLetter === 'function' ? cpCardLetter(card) : '') || '', wasRework = last.status === 'rework';
  var used = {}, jobs = [];
  files.forEach(function (x) {
    var name = CPDisk.safeName(x.file.name), k = 2;
    while (used[name.toLowerCase()]) name = name.replace(/(\.[^.]+)?$/, '_' + (k++) + '$1');
    used[name.toLowerCase()] = true;
    jobs.push({ file: x.file, name: name });
  });
  var olds = last.files.map(function (f) { return { path: f.path, name: f.name, size: f.size }; });
  var replaced = {};
  jobs.forEach(function (j) {
    olds.forEach(function (o) { if (cpStem(o.name) === cpStem(j.name)) replaced[o.path] = true; });
  });
  var total = jobs.reduce(function (a, j) { return a + j.file.size; }, 0), loaded = {}, ok = [], failed = [], dir = target;
  var mb = function (b) { return (b / 1048576).toFixed(b < 10485760 ? 1 : 0); };
  var show = function (text, frac) {
    cbBusyShow(text, frac);
    var box = document.querySelector('[data-cp-rvup="' + id + '"] .cp-rv-prog');
    if (box) box.innerHTML = '<div class="cp-acc-bar"><i style="width:' + Math.round(frac * 100) + '%"></i></div><div>' + cbEsc(text) + '</div>';
  };
  var prog = function () {
    var sum = 0;
    Object.keys(loaded).forEach(function (k) { sum += loaded[k]; });
    var frac = total ? sum / total : 0;
    show('Загружаю в карточку: файлов ' + ok.length + ' из ' + jobs.length + ' · ' + mb(sum) + ' из ' + mb(total) + ' МБ (' + Math.round(frac * 100) + '%)', 0.02 + 0.96 * frac);
  };
  show('Готовлю папку карточки...', 0.01);
  /* папка на доработке снова называется как артикул */
  var step = from !== target ? cpMoveFolder(from, target).catch(function () {
    /* папки «_доработка» уже нет на Диске — старых файлов не сохранить, грузим новые */
    olds = []; return CPDisk.ensureDir(target).then(function () { return target; });
  }) : CPDisk.ensureDir(target).then(function () { return target; });
  return step.then(function (d) {
    dir = d;
    olds.forEach(function (o) { if (o.path.indexOf(from + '/') === 0) { var np = dir + o.path.slice(from.length); if (replaced[o.path]) { replaced[np] = true; } o.path = np; } });
    prog();
    return cpPool(jobs, 3, function (j, i) {
      return cpUpSure(dir + '/' + j.name, j.file, true, function (b) { loaded[i] = b; prog(); })
        .then(function () { loaded[i] = j.file.size; ok.push(j); }, function (e) { loaded[i] = j.file.size; failed.push(j.name + ': ' + (e && (e.message || e.status))); })
        .then(prog);
    });
  }).then(function () {
    cbBusyHide();
    if (!ok.length) throw { message: 'ничего не загрузилось: ' + failed.slice(0, 3).join('; '), plain: true };
    var okNames = {};
    ok.forEach(function (j) { okNames[cpStem(j.name)] = true; });
    var newPaths = {};
    ok.forEach(function (j) { newPaths[(dir + '/' + j.name).toLowerCase()] = true; });
    /* заменяем только то, что действительно загрузилось */
    var gone = olds.filter(function (o) { return replaced[o.path] && okNames[cpStem(o.name)]; });
    var keep = olds.filter(function (o) { return gone.indexOf(o) === -1 && !newPaths[o.path.toLowerCase()]; });
    var trash = gone.filter(function (o) { return !newPaths[o.path.toLowerCase()]; }).map(function (o) { return o.path; });
    var who = cpActor(), now = new Date().toISOString(), row = null;
    var nFiles = keep.concat(ok.map(function (j) { return { path: dir + '/' + j.name, name: j.name, size: j.file.size }; }));
    var kind = wasRework ? 'новая версия после доработки' : 'догрузка в карточку';
    var apply = function (data) {
      var m = data.meta.cp, rv = m.rv = m.rv || {};
      var l2 = rv[id] = rv[id] || [], p2 = cpLastRv(l2);
      if (p2 && p2.status === 'review') p2.status = 'replaced';
      var ver = { v: l2.length + 1, batch: cpToday() + '_' + letter + '_' + (last.n || '1'), letter: letter, n: last.n || '1', date: cpToday(), by: who, ts: now,
        files: nFiles, status: 'review', dir: dir, kind: kind, added: ok.length - gone.length, replaced: gone.length };
      /* кадры, которые старший уже отметил «на сайт» и которые не заменяли, второй раз смотреть не нужно */
      var fmOld = (p2 && p2.fm) || (last && last.fm) || {}, fmNew = {};
      keep.forEach(function (o) { if (fmOld[o.name] && fmOld[o.name].s === 'ok') fmNew[o.name] = fmOld[o.name]; });
      if (Object.keys(fmNew).length) ver.fm = fmNew;
      l2.push(ver);
      var c = (data.cards || []).filter(function (x) { return x.id === id; })[0];
      row = cpOutputRow(ver, shoot.name, c, kind + ': заменено ' + gone.length + ', добавлено ' + Math.max(0, ok.length - gone.length));
      (m.events = m.events || []).push({ ts: now, actor: who, action: 'rt_upload_card', items: ok.map(function (j) { return j.name; }),
        card: c ? c.title : id, note: kind + ': файлов ' + ok.length + (failed.length ? ', не загрузилось ' + failed.length : '') });
    };
    var saved;
    if (CP.shoot && CP.shoot.path === shoot.path) {
      apply({ meta: { cp: cpMeta() }, cards: App.cards });
      cbMarkDirty();
      cbRenderCards();
      cbRenderOutline();
      saved = Promise.resolve();
    } else saved = cpMutateState(shoot, apply);
    return saved.then(function () {
      CPDisk.proxyProps(dir, { cp_rt: letter, cp_rt_date: cpToday() }).catch(function () { });
      return Promise.all([row ? cpOutputAppend([row]) : null, trash.length ? CPDisk.trash(trash).catch(function () { }) : null]);
    }).then(function () {
      cbToast((wasRework ? 'Новая версия загружена' : 'Загружено в карточку') + ': заменено ' + gone.length + ', добавлено ' + Math.max(0, ok.length - gone.length)
        + (failed.length ? ', не загрузилось ' + failed.length : '') + ' — карточка снова на проверке');
      if (failed.length && window.console) console.error('[CP] не загрузилось', failed);
      cpReviewPresent(shoot.name, base);
    });
  }).catch(function (e) {
    cbBusyHide();
    var box = document.querySelector('[data-cp-rvup="' + id + '"] .cp-rv-prog');
    if (box) box.textContent = '';
    if (e && e.plain) { cbToast('Загрузить в карточку: ' + e.message); return; }
    cpHandleError(e, 'Загрузка в карточку');
  });
}

/* кнопка в карточке — выбор файлов */
document.getElementById('cbCards').addEventListener('click', function (e) {
  var b = e.target.closest('[data-cp-rvpick]');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  var inp = b.parentNode.querySelector('[data-cp-rvfile]');
  if (inp) inp.click();
}, true);
document.getElementById('cbCards').addEventListener('change', function (e) {
  var inp = e.target.closest && e.target.closest('[data-cp-rvfile]');
  if (!inp) return;
  var id = inp.getAttribute('data-cp-rvfile');
  var files = Array.prototype.slice.call(inp.files || []).map(function (f) { return { file: f, rel: f.name }; });
  inp.value = '';
  cpRvCardUpload(id, files);
});

/* перетаскивание файлов на карточку на проверке/доработке — в её версию, не в галерею */
function cpRvDropCard(e) {
  var dt = e.dataTransfer;
  if (!dt || !dt.types || Array.prototype.indexOf.call(dt.types, 'Files') === -1) return null;
  var el = e.target.closest && e.target.closest('.cb-card');
  return el && el.querySelector('[data-cp-rvup]') ? el : null;
}
document.getElementById('cbCards').addEventListener('dragover', function (e) {
  var el = cpRvDropCard(e);
  Array.prototype.forEach.call(document.querySelectorAll('.cb-card.cp-rv-over'), function (x) { if (x !== el) x.classList.remove('cp-rv-over'); });
  if (!el) { document.body.classList.remove('cp-rv-dragging'); return; }
  e.preventDefault(); e.stopPropagation();
  el.classList.add('cp-rv-over');
  document.body.classList.add('cp-rv-dragging');
}, true);
document.getElementById('cbCards').addEventListener('dragleave', function (e) {
  var el = e.target.closest && e.target.closest('.cb-card');
  if (el && !(e.relatedTarget && el.contains(e.relatedTarget))) { el.classList.remove('cp-rv-over'); document.body.classList.remove('cp-rv-dragging'); }
}, true);
document.getElementById('cbCards').addEventListener('drop', function (e) {
  var el = cpRvDropCard(e);
  if (!el) return;
  e.preventDefault(); e.stopPropagation();
  el.classList.remove('cp-rv-over');
  document.body.classList.remove('cp-rv-dragging');
  if (typeof dragDepth !== 'undefined') dragDepth = 0;
  document.body.classList.remove('cb-file-drag');
  var id = el.querySelector('[data-cp-rvup]').getAttribute('data-cp-rvup');
  cpDropFiles(e.dataTransfer).then(function (files) { return cpRvCardUpload(id, files); });
}, true);

/* ---------- в 04 и 05 — только загруженная версия, исходники скрыты ----------
   Маша, 09.11: «важно, чтобы везде отображалась последняя загруженная версия и не
   отображались исходники». Открыто из «Отретушировано» или «Сайта» — у карточки не видно
   раскладки с исходными кадрами, только файлы последней версии (крупнее). Кнопка над
   карточками показывает исходники обратно, если нужно сравнить. */
CP.showSrc = false;
cbRenderCards = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    var key = CP.viewStage, root = document.getElementById('cbCards');
    if (!CP.shoot || !root || (key !== 'review' && key !== 'site')) return r;
    var rv = cpRv(), del = cpMeta().delivered || {};
    Array.prototype.forEach.call(root.querySelectorAll('.cb-card'), function (el) {
      var id = el.getAttribute('data-cid');
      el.classList.toggle('cp-src-hidden', !CP.showSrc);
      if (!cpLastRv(rv[id]) && !el.querySelector('.cp-rv-none')) {
        var head = el.querySelector('.cb-card-head'), d = del[id];
        if (head) head.insertAdjacentHTML('afterend', '<div class="cp-rv-none">Загруженной версии ретуши в отборе нет'
          + (d && d.at ? ' · сдано в ' + cbEsc(d.at) : '') + (CP.showSrc ? '' : ' — исходные кадры скрыты') + '</div>');
      }
    });
    var bar = document.getElementById('cpViewBar');
    if (bar && !bar.querySelector('[data-cp-src]')) {
      bar.insertAdjacentHTML('beforeend', '<button data-cp-src="1">' + (CP.showSrc ? 'Скрыть исходные кадры' : 'Показать исходные кадры') + '</button>');
      bar.querySelector('[data-cp-src]').addEventListener('click', function () { CP.showSrc = !CP.showSrc; cbRenderCards(); });
    }
    return r;
  };
})(cbRenderCards);

(function cpReviewCss() {
  var st = document.createElement('style');
  st.textContent = '.cp-viewbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:13px;color:#cfcac2;margin:0 0 10px;padding:8px 10px;border:1px solid #3a3a37;border-radius:4px;background:#1a1a18}'
    + '.cp-viewbar b{color:#e7c9a8}'
    + '.cp-acc-prog{font-size:12px;color:#cfcac2;display:flex;flex-direction:column;gap:6px;margin-top:10px}'
    + '.cp-acc-bar{height:8px;background:#232321;border-radius:4px;overflow:hidden}.cp-acc-bar i{display:block;height:100%;background:#C9956B;transition:width .2s}'
    + '.cp-rv-drop{grid-column:1/-1;border:2px dashed #3a3a37;border-radius:6px;padding:22px 16px;text-align:center;color:#a3a09a;font-size:13px;line-height:1.6}'
    + '.cp-rv-drop.cp-over{border-color:#C9956B;color:#e7c9a8;background:#1d1a17}'
    + '.cb-card.cp-src-hidden>.cb-page{display:none}'
    + '.cb-card.cp-src-hidden .cp-rv-t{width:180px;height:180px}'
    + '.cp-rv-none{margin:8px 0;font-size:12px;color:#a3a09a}';
  document.head.appendChild(st);
})();
