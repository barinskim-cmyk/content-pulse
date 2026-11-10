/* ============================================================
   cp-mirror.js — статус = где лежит файл (шаг 1: Диск → программа)

   Маша, 06.11.2026: «реализовать концепт отражения сервера: статус —
   физическая величина наличия чего-то где-то, чтобы работало в обе
   стороны». Этапы — папки (настройки.txt, шестерёнка):
       согласование   = …/02_СОГЛАСОВАНИЕ
       ретушь         = …/03_РЕТУШЬ          (без настройки — <съёмка>/Ретушь)
       отретушировано = …/04_ОТРЕТУШИРОВАНО
       сайт           = …/05_САЙТ
   00_АРХИВ не читаем. Внутри этапа ищется папка съёмки (на первом уровне
   или глубже — в «Сайте» бывает дата / буква_номер / съёмка; очерёдность
   в начале имени — «!_», «1_» — не мешает). Структура внутри — как в
   исходниках; буква ретушёра в начале имени папки (Y_74595_модель) —
   это тег карточки. По этапам едет только то, что в карточках товара.

   Сверка (при открытии съёмки и «Файл → Сверить с Диском»):
     - файл лежит на этапе → у кадра и карточки ставится этот статус
       (если в программе стоит более ранний или никакого);
       ретушь: буква в имени папки → тег карточки;
       отретушировано: версия ретуши «на проверке»;
       сайт: карточка «загружено»;
     - статус в программе есть, а файла на этапе нет, и файлы на Диске,
       которых нет в отборе, — расхождения: список и кнопки «Снять статусы
       без файлов» / «Докопировать на Диск». Сама программа статусы не
       снимает.

   Ретушь — конечная точка копий (Маша, 06.11): папка из 03 никуда не
   едет, ретушёры отдают результат в 04. Как только артикул сдан на сайт,
   его папка в 03 уходит в Корзину Диска (выбор Маши: «артикул сдан — в
   Корзину»; 30 дней можно восстановить). Оригиналы остаются в 01, готовое —
   в 05. Если в папке есть и несданные кадры, в Корзину уходят только
   сданные файлы; опустела папка съёмки — уходит и она.
   ============================================================ */

var CP_DISK_STAGES = [
  { key: 'approval', setting: 'approve', label: 'Согласование', rank: 1 },
  { key: 'retouch', setting: 'retouch', label: 'Ретушь', rank: 2 },
  { key: 'review', setting: 'retouched', label: 'Отретушировано', rank: 3 },
  { key: 'site', setting: 'site', label: 'Сайт', rank: 4 }
];
var CP_PRIO_RE = /^(!|\d{1,2})_/;
CP.mirror = null;   /* последняя сверка открытой съёмки */

CP_SETTING_KEYS['согласование'] = 'approve';
CP_SETTING_KEYS['отретушировано'] = 'retouched';

function cpStatusRank(s) { return { approval: 1, retouch: 2 }[s] || 0; }

/** Найти папки съёмки внутри этапа: на первом уровне, иначе глубже (до 3), не заходя в чужие съёмки. */
function cpFindShootIn(root, shootName, maxDepth) {
  maxDepth = maxDepth || 3;
  var want = shootName.toLowerCase(), found = [];
  var shootLike = /^\d{4}-\d{2}-\d{2}_./;
  function level(paths, depth) {
    if (!paths.length || depth > maxDepth) return Promise.resolve();
    return cpPool(paths, 4, function (p) { return cpListDirs(p); }).then(function (lists) {
      var next = [];
      lists.forEach(function (ds) {
        (ds || []).forEach(function (x) {
          var bare = x.name.replace(CP_PRIO_RE, '').replace(/\s*\+\s*$/, '');   /* « +» в конце — пометка руками, съёмка та же */
          if (bare.toLowerCase() === want) found.push({ path: x.path, name: x.name, prio: (CP_PRIO_RE.exec(x.name) || [])[1] || '' });
          else if (!shootLike.test(bare) && x.name.charAt(0) !== '_') next.push(x.path);
        });
      });
      return found.length ? null : level(next, depth + 1);
    });
  }
  return level([root], 1).then(function () { return found; });
}

/** Корни этапов для открытой съёмки: [{stage, root, shootDirs?}] */
function cpStageRoots() {
  var s = CP.settings || {};
  return CP_DISK_STAGES.map(function (st) {
    var root = s[st.setting] || '';
    if (st.key === 'retouch' && !root) return { stage: st, root: '', fixed: CP.shoot.path.replace(/\/+$/, '') + '/' + RETOUCH_DIR_NAME() };
    return { stage: st, root: root };
  }).filter(function (x) { return x.root || x.fixed; });
}

function RETOUCH_DIR_NAME() { return 'Ретушь'; }

/** Сверить открытую съёмку с папками этапов. */
function cpMirrorSync(quiet) {
  if (!CP.shoot || CP.readOnly) return Promise.resolve(null);
  var shoot = CP.shoot;
  var roots = cpStageRoots();
  if (!roots.length) return Promise.resolve(null);
  var letters = typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
  if (!quiet) cbBusyShow('Сверяю с Диском: папки этапов...', 0.2);
  return cpPool(roots, 2, function (r) {
    /* «Сайт»: дата / буква / номер / съёмка — искать по всей папке сайта при каждом открытии съёмки долго;
       витрина уже нашла, где лежит эта съёмка (и в старых датах тоже), — берём её список */
    var seen = r.stage.key === 'site' && CP.stageFor === CP.archive ? ((CP.stagePaths || {}).site || {})[shoot.name.toLowerCase()] : null;
    var dirs = r.fixed ? Promise.resolve([{ path: r.fixed, name: RETOUCH_DIR_NAME(), prio: '' }])
      : seen && seen.length ? Promise.resolve(seen.map(function (pth) { var nm = pth.split('/').pop(); return { path: pth, name: nm, prio: (CP_PRIO_RE.exec(nm) || [])[1] || '' }; }))
        : cpFindShootIn(r.root, shoot.name, r.stage.key === 'site' ? 5 : 3);
    return dirs.then(function (found) {
      return cpPool(found, 2, function (f) {
        return CPDisk.walkPhotos(f.path, false, 4, true).then(function (files) { f.files = files; return f; }, function (e) {
          if (e && e.status === 404) { f.files = []; return f; }
          throw e;
        });
      }).then(function (list) { r.found = list; return r; });
    });
  }).then(function (rs) {
    if (!quiet) cbBusyHide();
    if (!CP.shoot || CP.shoot.path !== shoot.path) return null;
    var idx = cpMirrorIndex();
    var res = cpMirrorApply(rs, letters, idx);
    CP.mirror = res;
    cpUpdateStatusLine();
    if (!quiet || res.changed.length) cbToast(res.changed.length ? 'Сверено с Диском: ' + res.changed.join(', ') : 'Сверено с Диском' + (res.issues ? ', расхождений: ' + res.issues : ' — всё совпадает'));
    /* сданное на сайт — из ретуши в Корзину */
    var rt = rs.filter(function (r) { return r.stage.key === 'retouch'; })[0];
    var plan = rt ? cpRetouchCleanupPlan(rt.found, idx, letters, cpDonePids(true)) : [];
    if (!plan.length) return res;
    return cpRetouchTrash(plan, quiet).then(function (n) { res.trashed = n; return res; });
  }).catch(function (e) {
    if (!quiet) cbBusyHide();
    if (window.console) console.warn('[CP] сверка с Диском', e && (e.body || e.message || e));
    if (!quiet) cpHandleError(e, 'Сверка с Диском');
    return null;
  });
}

/** Кадры отбора открытой съёмки: по пути внутри съёмки и по «стеблю» имени. */
function cpMirrorIndex() {
  var shootPath = CP.shoot.path.replace(/\/+$/, '');
  var byRel = {}, byStem = {}, cardOf = {};
  App.photos.forEach(function (p) {
    if (!p.disk || (p.kind || 'photo') === 'ref') return;
    var rel = p.disk.indexOf(shootPath + '/') === 0 ? p.disk.slice(shootPath.length + 1) : p.name;
    byRel[rel.toLowerCase()] = p;
    var st = cpStem(p.name);
    (byStem[st] = byStem[st] || []).push(p);
  });
  App.cards.forEach(function (c) { cpCardPids(c).forEach(function (pid) { if (!cardOf[pid]) cardOf[pid] = c; }); });
  return { byRel: byRel, byStem: byStem, cardOf: cardOf };
}

/** Файл в папке этапа → кадр отбора. raw — папки от папки съёмки на этапе. {p, letter} */
function cpMirrorMatch(idx, raw, name, letters) {
  var letter = '';
  var segs = raw.map(function (sg) {
    var mm = /^([A-Za-zА-Яа-яЁё]{1,3})_(.+)$/.exec(sg);
    if (mm && letters.indexOf(mm[1]) !== -1) { letter = mm[1]; return mm[2]; }
    return sg.replace(/_доработка$/i, '');
  });
  var rel = segs.concat([name]).join('/').toLowerCase();
  var p = idx.byRel[rel];
  if (!p) {
    var cands = idx.byStem[cpStem(name)] || [];
    var dir = segs.join('/');
    p = cands.length === 1 ? cands[0] : cands.filter(function (c) {
      var card = idx.cardOf[c.id];
      return cpRelDir(c) === dir || (card && card.cpArticleDir === dir);
    })[0];
  }
  return { p: p || null, letter: letter, rel: rel };
}

/** Кадры, чьи карточки сданы на сайт (и нет несданной карточки на ретуши / согласовании с ними). */
/** Артикул карточки: код артикула или код в названии; у одного артикула бывает две карточки. */
function cpArtKey(c) {
  return c.cpArticle || (/(?:^|[^\d])(\d{4,7})(?!\d)/.exec(c.title || '') || [])[1] || c.id;
}

/* byProgram — только карточки, которые на сайт отправила сама программа (кнопкой «На сайт»), а не те,
   что сверка нашла в папке сайта на Диске. Для уборки ретуши в Корзину нужно именно это: пока ретушёры
   сдают в «Сайт» руками, «лежит в папке сайта» ещё не значит «принято», а находка сверки — догадка по
   именам (Маша, 10.11.2026: «он удалил всё из папки ретушь… правда ли они все отретушированы?»). */
function cpDonePids(byProgram) {
  var m = cpMeta(), del = m.delivered || {}, done = {}, keep = {}, delArt = {};
  var is = function (c) { var d = del[c.id]; return !!d && !(byProgram && d.out === 'Диск'); };
  /* сдан артикул — сданы все его карточки (собранная кнопкой и собранная руками) */
  App.cards.forEach(function (c) { if (is(c)) delArt[cpArtKey(c)] = true; });
  App.cards.forEach(function (c) {
    var pids = cpCardPids(c);
    if (is(c) || delArt[cpArtKey(c)]) pids.forEach(function (pid) { done[pid] = true; });
    else {
      var cs = m.cardStatus[c.id];
      if (cs && (cs.s === 'retouch' || cs.s === 'approval')) pids.forEach(function (pid) { keep[pid] = true; });
    }
  });
  Object.keys(keep).forEach(function (pid) { delete done[pid]; });
  return done;
}

/**
 * Что из папок съёмки в 03 отправить в Корзину: папка целиком, если в ней
 * есть сданные кадры и нет несданных (файлы, которых нет в отборе, едут
 * вместе с папкой); иначе — только сданные файлы.
 */
function cpRetouchCleanupPlan(found, idx, letters, done) {
  var out = [];
  (found || []).forEach(function (f) {
    var tree = { path: f.path, dirs: {}, files: [] };
    (f.files || []).forEach(function (file) {
      if (file.name === CPDisk.STATE_FILE || file.path.indexOf(f.path + '/') !== 0) return;
      var raw = file.path.slice(f.path.length + 1).split('/');
      var name = raw.pop();
      var mt = cpMirrorMatch(idx, raw, name, letters);
      var node = tree, cur = f.path;
      raw.forEach(function (sg) { cur += '/' + sg; node = node.dirs[sg] = node.dirs[sg] || { path: cur, dirs: {}, files: [] }; });
      node.files.push({ path: file.path, state: mt.p ? (done[mt.p.id] ? 'done' : 'live') : 'other' });
    });
    (function count(n) {
      n.d = 0; n.l = 0;
      n.files.forEach(function (x) { if (x.state === 'done') n.d++; else if (x.state === 'live') n.l++; });
      Object.keys(n.dirs).forEach(function (k) { var c = count(n.dirs[k]); n.d += c.d; n.l += c.l; });
      return n;
    })(tree);
    (function pick(n) {
      if (!n.d) return;
      if (!n.l) { out.push(n.path); return; }
      n.files.forEach(function (x) { if (x.state === 'done') out.push(x.path); });
      Object.keys(n.dirs).forEach(function (k) { pick(n.dirs[k]); });
    })(tree);
  });
  return out;
}

/** Сданное — из ретуши в Корзину Диска. */
function cpRetouchTrash(paths, quiet) {
  if (!paths.length) return Promise.resolve(0);
  return CPDisk.trash(paths).then(function (res) {
    var ok = res.filter(function (x) { return x.status === 'done' || x.status === 'gone'; });
    var bad = res.filter(function (x) { return x.status === 'failed'; });
    if (ok.length) {
      cpEvent('retouch_trash', ok.map(function (x) { return x.path.split('/').pop(); }), { note: 'сдано на сайт — из ретуши в Корзину Диска: ' + ok.map(function (x) { return CPDisk.showPath(x.path); }).join(', ') });
      cbToast('Сданное убрано из ретуши в Корзину Диска: ' + ok.length + (bad.length ? ', не получилось: ' + bad.length : ''));
    } else if (bad.length && !quiet) cbToast('Не получилось убрать сданное из ретуши: ' + (bad[0].error || ''));
    if (bad.length && window.console) console.warn('[CP] в Корзину не ушло', bad);
    if (bad.length && CP.shoot) CPQ.add(CP.shoot, { kind: 'trash', label: 'Убрать сданное из ретуши: ' + bad.length, paths: bad.map(function (x) { return x.path; }) });
    return ok.length;
  }, function (e) {
    if (window.console) console.warn('[CP] в Корзину', e && (e.body || e.message || e));
    if (!quiet) cpHandleError(e, 'Убрать сданное из ретуши');
    return 0;
  });
}

/** Разложить найденные файлы по кадрам отбора и выставить статусы. */
function cpMirrorApply(rs, letters, idx) {
  var m = cpMeta(), who = 'Диск', now = new Date().toISOString();
  idx = idx || cpMirrorIndex();
  var cardOf = idx.cardOf;
  var pres = {}, unmatched = [];
  rs.forEach(function (r) {
    (r.found || []).forEach(function (f) {
      f.files.forEach(function (file) {
        if (file.name === CPDisk.STATE_FILE) return;
        var segs = file.path.slice(f.path.length + 1).split('/');
        var name = segs.pop();
        var mt = cpMirrorMatch(idx, segs, name, letters), p = mt.p, letter = mt.letter;
        if (!p) { unmatched.push({ stage: r.stage.label, path: file.path }); return; }
        var pr = pres[p.id] = pres[p.id] || {};
        pr[r.stage.key] = { path: file.path, name: file.name, size: file.size, letter: letter, prio: f.prio, key: mt.rel,
          rid: typeof cpRidShort === 'function' ? cpRidShort(file) : '' };
      });
    });
  });
  var changed = [], nStat = 0, nLetter = 0, nRv = 0, nSite = 0;
  /* кадры: согласование / ретушь по факту, если в программе стоит более раннее */
  Object.keys(pres).forEach(function (pid) {
    var pr = pres[pid], st = m.status[pid], card = cardOf[pid];
    var want = pr.retouch ? 'retouch' : pr.approval ? 'approval' : '';
    if (!want || (st && (st.s === 'reshoot' || cpStatusRank(st.s) >= cpStatusRank(want)))) return;
    m.status[pid] = { s: want, by: who, ts: now, card: card ? card.id : undefined };
    nStat++;
  });
  /* файлы 04, уже записанные в версиях любой карточки: у артикула бывает две карточки — вторая
     не получает «версию с Диска» из тех же файлов (и карточка в браке — тоже) */
  var knownAny = {}, rvAll = cpRv();
  Object.keys(rvAll).forEach(function (id) { (rvAll[id] || []).forEach(function (v) { (v.files || []).forEach(function (f) { knownAny[f.path] = true; }); }); });
  /* карточки: статус, буква ретушёра, версия ретуши, «загружено» */
  App.cards.forEach(function (c) {
    var pids = cpCardPids(c).filter(function (pid) { return pres[pid]; });
    if (!pids.length) return;
    var cs = m.cardStatus[c.id];
    var anyR = pids.some(function (pid) { return pres[pid].retouch; }), anyA = pids.some(function (pid) { return pres[pid].approval; });
    var want = anyR ? 'retouch' : anyA ? 'approval' : '';
    if (want && !(cs && (cs.s === 'reshoot' || cpStatusRank(cs.s) >= cpStatusRank(want)))) { m.cardStatus[c.id] = { s: want, by: who, ts: now }; nStat++; }
    var letter = '', dlTs = '';
    pids.forEach(function (pid) { if (pres[pid].retouch && pres[pid].retouch.letter) letter = pres[pid].retouch.letter; });
    /* из папки ретуши скачали программой (cp-review.js, запись rtdl) — буква по последней записи:
       папку на Диске при этом не переименовывают, и буква из её имени вернула бы прежнего ретушёра */
    pids.forEach(function (pid) {
      var x = pres[pid].retouch, rec = x && m.rtdl ? m.rtdl[x.key] : null;
      if (rec && rec.rid && x.rid && rec.rid !== x.rid) rec = null;   /* запись о прежней копии */
      if (rec && rec.l && (rec.ts || '') >= dlTs) { dlTs = rec.ts || ''; letter = rec.l; }
    });
    if (letter && (c.tags || []).indexOf(letter) === -1) { c.tags = cpTagsWith(c.tags, letter); nLetter++; }
    var rvFiles = pids.filter(function (pid) { return pres[pid].review; }).map(function (pid) { var x = pres[pid].review; return { path: x.path, name: x.name, size: x.size }; });
    if (rvFiles.length && !(cs && cs.s === 'reshoot') && rvFiles.some(function (f) { return !knownAny[f.path]; })) {
      var rv = cpRv(), list = rv[c.id] = rv[c.id] || [], last = list[list.length - 1];
      var known = {};
      list.forEach(function (v) { (v.files || []).forEach(function (f) { known[f.path] = true; }); });
      if (rvFiles.some(function (f) { return !known[f.path]; }) && !(last && last.status === 'review')) {
        list.push({ v: list.length + 1, batch: 'Диск', letter: letter || (cpCardLetter(c) || ''), n: '', date: cpToday(), by: who, ts: now, files: rvFiles, status: 'review' });
        nRv++;
      }
    }
    var site = pids.filter(function (pid) { return pres[pid].site; });
    if (site.length && !(m.delivered || {})[c.id]) {
      m.delivered = m.delivered || {};
      var sp = pres[site[0]].site.path;
      m.delivered[c.id] = { files: site.length, letter: letter || cpCardLetter(c) || '', date: cpToday(), at: CPDisk.showPath(sp.slice(0, sp.lastIndexOf('/'))), out: 'Диск', ts: now };
      nSite++;
    }
  });
  if (nStat) changed.push('статусов ' + nStat);
  if (nLetter) changed.push('букв ретушёров ' + nLetter);
  if (nRv) changed.push('версий ретуши ' + nRv);
  if (nSite) changed.push('загружено ' + nSite);
  /* расхождения: статус есть, файла на этапе нет (только этапы с папками) */
  var has = {};
  rs.forEach(function (r) { has[r.stage.key] = true; });
  var missing = [], done = cpDonePids();
  Object.keys(m.status).forEach(function (pid) {
    var st = m.status[pid];
    if (done[pid]) return;   /* сдано на сайт — в ретуши его и не должно быть */
    if ((st.s === 'approval' || st.s === 'retouch') && has[st.s] && !(pres[pid] && (pres[pid][st.s] || (st.s === 'approval' && pres[pid].retouch)))) {
      var p = cbPhotoById(pid);
      if (p && p.disk) missing.push({ pid: pid, s: st.s, name: p.name });
    }
  });
  if (changed.length) {
    cpEvent('mirror', [], { note: 'сверка с Диском: ' + changed.join(', ') }, true);
    cbMarkDirty();
    cbRenderCards();
    cbRenderOutline();
    cbRenderTray();
  }
  return { ts: now, changed: changed, missing: missing, unmatched: unmatched, roots: rs.map(function (r) { return { label: r.stage.label, found: (r.found || []).map(function (f) { return CPDisk.showPath(f.path); }) }; }), issues: missing.length + unmatched.length };
}

/* ---------- расхождения: панель ---------- */

function cpMirrorPanel() {
  var res = CP.mirror;
  var box = document.getElementById('cpMirrorBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'cpMirrorBox';
    box.className = 'cp-log';
    document.body.appendChild(box);
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cp-mr]');
      if (!b) return;
      var act = b.getAttribute('data-cp-mr');
      if (act === 'close') box.classList.remove('cp-open');
      else if (act === 'again') cpMirrorSync(false).then(cpMirrorPanel);
      else if (act === 'clear') cpMirrorClearMissing();
      else if (act === 'copy') cpMirrorCopyMissing();
    });
  }
  var html = '<div class="cp-log-head"><b>Сверка с Диском</b><button data-cp-mr="again">Сверить ещё раз</button><button data-cp-mr="close">Закрыть</button></div><div class="cp-log-list">';
  if (!res) html += '<div class="cp-empty">Сверки ещё не было — папки этапов не заданы или съёмка не открыта</div>';
  else {
    html += '<div class="cp-vers-note">' + res.roots.map(function (r) {
      return cbEsc(r.label) + ': ' + (r.found.length ? r.found.map(cbEsc).join(', ') : 'папки съёмки нет');
    }).join('<br>') + '</div>';
    if (res.changed.length) html += '<div class="cp-log-item">Взято с Диска: ' + cbEsc(res.changed.join(', ')) + '</div>';
    if (res.missing.length) {
      html += '<div class="cp-log-item"><b>Статус есть, файла на Диске нет (' + res.missing.length + ')</b><br>' + res.missing.slice(0, 40).map(function (x) {
        return cbEsc(x.name) + ' <small>' + (x.s === 'approval' ? 'согласование' : 'ретушь') + '</small>';
      }).join(', ') + '<div class="cp-mr-act"><button data-cp-mr="copy">Докопировать на Диск</button><button data-cp-mr="clear">Снять статусы без файлов</button></div></div>';
    }
    if (res.unmatched.length) {
      html += '<div class="cp-log-item"><b>На Диске есть, в отборе нет (' + res.unmatched.length + ')</b><br>' + res.unmatched.slice(0, 40).map(function (x) {
        return cbEsc(CPDisk.showPath(x.path)) + ' <small>' + cbEsc(x.stage) + '</small>';
      }).join('<br>') + '</div>';
    }
    if (!res.issues) html += '<div class="cp-empty">Расхождений нет</div>';
  }
  box.innerHTML = html + '</div>';
  box.classList.add('cp-open');
}

function cpMirrorClearMissing() {
  var res = CP.mirror;
  if (!res || !res.missing.length) return;
  var m = cpMeta(), names = [];
  res.missing.forEach(function (x) { if (m.status[x.pid] && m.status[x.pid].s === x.s) { delete m.status[x.pid]; names.push(x.name); } });
  cpEvent('clear_status', names, { note: 'сверка с Диском: файлов на этапе нет — статус снят' });
  res.missing = [];
  res.issues = res.unmatched.length;
  cpAfterStatus();
  cpMirrorPanel();
}

function cpMirrorCopyMissing() {
  var res = CP.mirror;
  if (!res || !res.missing.length) return;
  var rt = res.missing.filter(function (x) { return x.s === 'retouch'; }).map(function (x) { return x.pid; });
  var ap = res.missing.filter(function (x) { return x.s === 'approval'; }).map(function (x) { return x.pid; });
  var jobs = [];
  if (rt.length) jobs.push(cpRetouchCopy(rt, null, 'Докопирую на ретушь'));
  if (ap.length) {
    var root = (CP.settings || {}).approve;
    var shootPath = CP.shoot.path.replace(/\/+$/, '');
    var dir = root.replace(/\/+$/, '') + '/' + CPDisk.safeName(CP.shoot.name);
    var items = ap.map(function (pid) { var p = cbPhotoById(pid); return { from: p.disk, path: dir + '/' + cpRetouchRel(p, null, shootPath) }; });
    jobs.push(cpCopyOnDisk(items, [dir], 'Докопирую на согласование'));
  }
  Promise.all(jobs).then(function () { return cpMirrorSync(true); }).then(function () { cpMirrorPanel(); })
    .catch(function (e) { cpHandleError(e, 'Не удалось докопировать'); });
}

/* строка съёмки: итог сверки */
cpUpdateStatusLine = (function (orig) {
  return function () {
    orig.apply(this, arguments);
    var el = document.getElementById('cpStatusLine');
    if (!el || !CP.shoot || !CP.mirror) return;
    var a = document.createElement('button');
    a.className = 'cp-link ' + (CP.mirror.issues ? 'cp-save-err' : 'cp-save-ok');
    a.id = 'cpMirrorLink';
    a.textContent = CP.mirror.issues ? 'Диск: расхождений ' + CP.mirror.issues : 'Диск: сверено ' + new Date(CP.mirror.ts).toLocaleTimeString('ru-RU').slice(0, 5);
    a.onclick = cpMirrorPanel;
    el.appendChild(document.createTextNode(' · '));
    el.appendChild(a);
  };
})(cpUpdateStatusLine);

/* сверка при открытии съёмки (тихо) и из меню «Файл» */
CP.openedHooks = CP.openedHooks || [];
CP.openedHooks.push(function (path) {
  CP.mirror = null;
  var ready = typeof cpEnsureSettings === 'function' ? cpEnsureSettings() : Promise.resolve();
  ready.then(function () {
    if (CP.shoot && CP.shoot.path === path && CP.files && CP.files.length) return cpMirrorSync(true);
  });
});

(function cpMirrorMenu() {
  var anchor = document.getElementById('cpMenuRetouchSync');
  if (!anchor) return;
  var b = document.createElement('button');
  b.id = 'cpMenuMirror';
  b.textContent = 'Сверить с Диском';
  anchor.parentNode.insertBefore(b, anchor);
  b.onclick = function () {
    cbCloseAllPops();
    if (!CP.shoot) { cbToast('Сначала откройте съёмку'); return; }
    var ready = typeof cpEnsureSettings === 'function' ? cpEnsureSettings() : Promise.resolve();
    ready.then(function () {
      if (!cpStageRoots().length) { cbToast('Папки этапов не заданы: шестерёнка на витрине'); return; }
      return cpMirrorSync(false).then(function () { cpMirrorPanel(); });
    });
  };
})();

/* ---------- папки этапов в шестерёнке ---------- */

(function cpStageSettings() {
  var ret = document.getElementById('cpSetRetouch');
  if (!ret) return;
  var rows = [
    { key: 'согласование', field: 'approve', label: 'Согласование (02)', before: ret.previousElementSibling },
    { key: 'отретушировано', field: 'retouched', label: 'Отретушировано (04)', after: ret }
  ];
  rows.forEach(function (r) {
    var html = '<h5>' + r.label + '</h5><div class="cp-set-line"><input id="cpSet_' + r.field + '" spellcheck="false" placeholder="не задана">'
      + '<button data-cp-stage-save="' + r.key + '" data-cp-field="' + r.field + '">Сохранить</button></div>';
    if (r.before) r.before.insertAdjacentHTML('beforebegin', html);
    else r.after.insertAdjacentHTML('afterend', html);
  });
  document.getElementById('cpSettings').addEventListener('click', function (e) {
    var b = e.target.closest('[data-cp-stage-save]');
    if (!b) return;
    var inp = document.getElementById('cpSet_' + b.getAttribute('data-cp-field'));
    var raw = inp.value.trim(), v = raw ? cpNormArchive(raw) : '';
    b.disabled = true;
    cpSaveSetting(b.getAttribute('data-cp-stage-save'), v).then(function () {
      cbToast(v ? 'Папка этапа: ' + CPDisk.showPath(v) : 'Папка этапа не задана');
    }).catch(function (err) { cpHandleError(err, 'Не удалось сохранить настройку'); }).then(function () { b.disabled = false; });
  });
  cpSettingsToUi = (function (orig) {
    return function () {
      orig.apply(this, arguments);
      ['approve', 'retouched'].forEach(function (f) {
        var inp = document.getElementById('cpSet_' + f);
        if (inp && document.activeElement !== inp) inp.value = (CP.settings && CP.settings[f]) || '';
      });
    };
  })(cpSettingsToUi);
})();

CP_ACTION_LABEL.retouch_trash = 'сдано на сайт — убрано из ретуши в Корзину';
CP_ACTION_LABEL.mirror = 'сверка с Диском';

/** После сдачи на сайт: сразу сверить (тихо) — сданное уйдёт из ретуши в Корзину. */
function cpRetouchCleanupSoon() {
  var path = CP.shoot && CP.shoot.path;
  var ready = typeof cpEnsureSettings === 'function' ? cpEnsureSettings() : Promise.resolve();
  return ready.then(function () {
    if (!CP.shoot || CP.shoot.path !== path) return null;
    return cpMirrorSync(true);
  });
}

(function cpMirrorCss() {
  var st = document.createElement('style');
  st.textContent = '.cp-mr-act{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}';
  document.head.appendChild(st);
})();
