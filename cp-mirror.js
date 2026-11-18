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
  /* буквы ретушёров — из словаря тегов: он должен быть прочитан до сверки (18.11.2026: сверка шла без
     словаря, и буквы в именах папок молча не читались — ни в теги, ни обратно) */
  var letters = [];
  if (!quiet) cbBusyShow('Сверяю с Диском: папки этапов...', 0.2);
  CP.mirrorBusy = (CP.mirrorBusy || 0) + 1;
  var idled = false, idle = function () { if (!idled) { idled = true; CP.mirrorBusy = Math.max(0, (CP.mirrorBusy || 0) - 1); } };
  return (typeof cpDictReady === 'function' ? cpDictReady() : Promise.resolve()).then(function () {
    letters = typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
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
    });
  }).then(function (rs) {
    if (!quiet) cbBusyHide();
    idle();
    if (!CP.shoot || CP.shoot.path !== shoot.path) return null;
    var idx = cpMirrorIndex();
    var res = cpMirrorApply(rs, letters, idx);
    CP.mirror = res;
    cpUpdateStatusLine();
    if (!quiet || res.changed.length) cbToast(res.changed.length ? 'Сверено с Диском: ' + res.changed.join(', ') : 'Сверено с Диском' + (res.issues ? ', расхождений: ' + res.issues : ' — всё совпадает'));
    /* сданное на сайт — из ретуши в Корзину */
    var rt = rs.filter(function (r) { return r.stage.key === 'retouch'; })[0];
    var plan = rt ? cpRetouchCleanupPlan(rt.found, idx, letters, cpDonePids(true)) : [];
    /* папки под букву ретушёра — кроме тех, что сейчас уходят в Корзину (сдано на сайт) */
    var gone = function (p) { return plan.some(function (t) { return p === t || p.indexOf(t + '/') === 0 || t.indexOf(p + '/') === 0; }); };
    var ren = (res.rtRenames || []).filter(function (x) { return !gone(x.from); });
    var step = plan.length ? cpRetouchTrash(plan, quiet).then(function (n) { res.trashed = n; }) : Promise.resolve();
    return step.then(function () { return ren.length ? cpRtRename(ren, quiet) : 0; }).then(function () { return res; });
  }).catch(function (e) {
    if (!quiet) cbBusyHide();
    idle();
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
    var sp = cpLetterSplit(sg, letters);
    if (sp) { letter = sp.letter; return sp.rest; }
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

/** День (ГГГГ-ММ-ДД, по местному времени) из даты Диска «2026-11-18T10:00:00+00:00»; '' — нет даты. */
function cpIsoDayOf(stamp) {
  var t = Date.parse(stamp || '');
  if (isNaN(t)) return '';
  var d = new Date(t), z = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
}

/**
 * Что говорит путь в «Сайте»: дата / буква ретушёра / номер дропа / съёмка / … -> {date: ГГГГ-ММ-ДД, letter, n}.
 * Понимает и «дата / U_2 / …», и папки, разложенные руками без буквы или без номера ('' — нет).
 */
function cpSitePathInfo(path) {
  var out = { date: '', letter: '', n: '' };
  var roots = [CP.settings && CP.settings.site].concat((CP.settings && CP.settings.siteMore) || []).filter(Boolean);
  var root = roots.filter(function (r) { return String(path).indexOf(String(r).replace(/\/+$/, '') + '/') === 0; })[0];
  var segs = (root ? String(path).slice(String(root).replace(/\/+$/, '').length + 1) : String(path)).split('/');
  var letters = typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
  for (var i = 0; i < segs.length - 1; i++) {
    var sg = segs[i];
    if (!out.date) { var d = typeof cpSiteDateName === 'function' ? cpSiteDateName(sg) : ''; if (d) out.date = d; continue; }
    if (!out.letter) {
      var l = cpLetterOf(sg, letters);
      if (l) { out.letter = l; continue; }
      var lm = /^([A-Za-zА-Яа-яЁё]{1,3})_(\d{1,3})$/.exec(sg);
      if (lm && cpLetterOf(lm[1], letters)) { out.letter = cpLetterOf(lm[1], letters); out.n = lm[2]; continue; }
      break;
    }
    if (!out.n && /^\d{1,3}$/.test(sg)) { out.n = sg; continue; }
    break;
  }
  return out;
}

/** Разложить найденные файлы по кадрам отбора и выставить статусы. */
function cpMirrorApply(rs, letters, idx) {
  var m = cpMeta(), who = 'Диск', now = new Date().toISOString();
  idx = idx || cpMirrorIndex();
  var cardOf = idx.cardOf;
  var pres = {}, unmatched = [], artPres = {};
  rs.forEach(function (r) {
    (r.found || []).forEach(function (f) {
      f.files.forEach(function (file) {
        if (file.name === CPDisk.STATE_FILE) return;
        var segs = file.path.slice(f.path.length + 1).split('/');
        var name = segs.pop();
        var mt = cpMirrorMatch(idx, segs, name, letters), p = mt.p, letter = mt.letter;
        /* артикул файла — по ближайшей папке артикула, иначе по началу имени файла («74595_1.jpg») */
        var code = '', stype = typeof cpShootType === 'function' && CP.shoot ? cpShootType(CP.shoot.name) : null, artDir = '';
        for (var si = segs.length - 1; si >= 0 && !code; si--) {
          var sg = segs[si], lsp = cpLetterSplit(sg, letters);
          if (lsp) sg = lsp.rest;
          code = typeof cpArtCode === 'function' ? cpArtCode(stype, sg) : '';
          if (code) artDir = f.path + '/' + segs.slice(0, si + 1).join('/');
        }
        if (!code && typeof cpArtCode === 'function') { code = cpArtCode(stype, name); if (code) artDir = file.path.slice(0, file.path.lastIndexOf('/')); }
        if (code) {
          var ap = (artPres[code] = artPres[code] || {});
          if (!ap[r.stage.key]) ap[r.stage.key] = { path: file.path, letter: letter, n: 0, byDir: {} };
          var apk = ap[r.stage.key];
          apk.n++;
          if (!apk.letter && letter) apk.letter = letter;
          /* файлы артикула на этапе по папкам — для версии ретуши, сданной руками (имена файлов у ретушёров свои) */
          var bd = apk.byDir[artDir] = apk.byDir[artDir] || { files: [], mod: '', letter: letter };
          bd.files.push({ path: file.path, name: file.name, size: file.size });
          if ((file.modified || '') > bd.mod) bd.mod = file.modified || '';
        }
        if (!p) { unmatched.push({ stage: r.stage.label, path: file.path }); return; }
        var pr = pres[p.id] = pres[p.id] || {};
        pr[r.stage.key] = { path: file.path, name: file.name, size: file.size, letter: letter, prio: f.prio, key: mt.rel,
          rid: typeof cpRidShort === 'function' ? cpRidShort(file) : '' };
      });
    });
  });
  var changed = [], nStat = 0, nLetter = 0, nRv = 0, nSite = 0;
  /* буква ретушёра ⇄ имя папки артикула в 03: сначала сверка букв, потом статусы и версии */
  var rtSync = cpRtLetterReconcile(rs, letters, idx);
  nLetter = rtSync.nCards;
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
  /* Карточка товара — по артикулу, даже если ни один файл на этапе не узнан как её кадр (Маша, 11.11.2026:
     «открываю из исходников — не вижу в карточке, что уже есть на сайте и в ретуши»). Ретушёры
     переименовывают файлы («74595_1.jpg») и раскладывают их по партиям, и по имени кадр не находится;
     а папка артикула (или код в начале имени файла) на этапе есть. Тогда статус и «загружено» ставятся
     карточке этого артикула. Кадрам ничего не ставим — не знаем, какие именно. */
  App.cards.forEach(function (c) {
    if (!c.cpArticle || c.cpArticle.indexOf(',') !== -1) return;
    var ap = artPres[c.cpArticle];
    if (!ap) return;
    var cs = m.cardStatus[c.id];
    var want = ap.retouch || ap.review || ap.site ? 'retouch' : ap.approval ? 'approval' : '';
    if (want && !(cs && (cs.s === 'reshoot' || cpStatusRank(cs.s) >= cpStatusRank(want)))) { m.cardStatus[c.id] = { s: want, by: who, ts: now }; nStat++; }
    var lt = cpCardLetter(c) || (ap.site && ap.site.letter) || '';   /* буква ретушёра — по сверке папок 03 (cpRtLetterReconcile) */
    if (ap.site && !(m.delivered || {})[c.id]) {
      m.delivered = m.delivered || {};
      var sp0 = ap.site.path, si0 = cpSitePathInfo(sp0);
      /* сдали на сайт руками: кто, когда и какой дроп — по пути (дата / буква / номер дропа / …) */
      m.delivered[c.id] = { files: ap.site.n, letter: si0.letter || ap.site.letter || lt || '', date: si0.date || cpToday(), drop: si0.n || undefined,
        at: CPDisk.showPath(sp0.slice(0, sp0.lastIndexOf('/'))), out: 'Диск', ts: now, byArt: true };
      nSite++;
    }
    /* Сдали в 04 руками (Маша, 18.11.2026: «если кто-то загрузил на Диск, вместо того чтобы закинуть через
       программу, мы точно так же считываем, что и куда загружено, — программа просто зеркало»): папка
       артикула в 04, файлов которой нет ни в одной версии, — версия ретуши «с Диска» на проверку. Буква — из
       имени папки (U_75327…), день — по самому свежему файлу в ней. Имена файлов у ретушёров свои — по папке
       артикула, а не по кадрам. */
    var rvDirs = ap.review ? ap.review.byDir : {};
    var newDir = Object.keys(rvDirs).filter(function (d) { return !/_доработка$/i.test(d) && rvDirs[d].files.some(function (f) { return !knownAny[f.path]; }); })[0];
    if (newDir && !(m.cardStatus[c.id] && m.cardStatus[c.id].s === 'reshoot')) {
      var rvA = rvDirs[newDir], rvl = cpRv(), lst = rvl[c.id] = rvl[c.id] || [], lastV = lst[lst.length - 1];
      if (!(lastV && lastV.status === 'review')) {
        var dayA = cpIsoDayOf(rvA.mod) || cpToday();
        if (lastV && lastV.status === 'rework') lastV.status = 'replaced';   /* сдали новую версию после доработки руками */
        lst.push({ v: lst.length + 1, batch: 'Диск', letter: rvA.letter || cpCardLetter(c) || '', n: '', date: dayA, dropDate: dayA, by: who, ts: now,
          files: rvA.files.slice(), status: 'review', dir: newDir, byArt: true });
        rvA.files.forEach(function (f) { knownAny[f.path] = true; });
        nRv++;
      }
    }
  });
  App.cards.forEach(function (c) {
    var pids = cpCardPids(c).filter(function (pid) { return pres[pid]; });
    if (!pids.length) return;
    var cs = m.cardStatus[c.id];
    var anyR = pids.some(function (pid) { return pres[pid].retouch; }), anyA = pids.some(function (pid) { return pres[pid].approval; });
    var want = anyR ? 'retouch' : anyA ? 'approval' : '';
    if (want && !(cs && (cs.s === 'reshoot' || cpStatusRank(cs.s) >= cpStatusRank(want)))) { m.cardStatus[c.id] = { s: want, by: who, ts: now }; nStat++; }
    /* буква ретушёра у карточки уже сверена с именами папок 03 (cpRtLetterReconcile) */
    var letter = cpCardLetter(c) || '';
    pids.forEach(function (pid) { if (!letter && pres[pid].retouch && pres[pid].retouch.letter) letter = pres[pid].retouch.letter; });
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
      var sp = pres[site[0]].site.path, spi = cpSitePathInfo(sp);
      m.delivered[c.id] = { files: site.length, letter: spi.letter || pres[site[0]].site.letter || letter || cpCardLetter(c) || '', date: spi.date || cpToday(), drop: spi.n || undefined,
        at: CPDisk.showPath(sp.slice(0, sp.lastIndexOf('/'))), out: 'Диск', ts: now };
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
  if (!changed.length && rtSync.baseChanged) cbMarkDirty();   /* запомнили, какие буквы на Диске сейчас */
  if (changed.length) {
    cpEvent('mirror', [], { note: 'сверка с Диском: ' + changed.join(', ') }, true);
    cbMarkDirty();
    cbRenderCards();
    cbRenderOutline();
    cbRenderTray();
  }
  return { ts: now, changed: changed, missing: missing, unmatched: unmatched, rtRenames: rtSync.renames, roots: rs.map(function (r) { return { label: r.stage.label, found: (r.found || []).map(function (f) { return CPDisk.showPath(f.path); }) }; }), issues: missing.length + unmatched.length };
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
  /* Сверка идёт, когда файлы съёмки прочитаны (18.11.2026). Раньше условием было «файлы уже прочитаны»
     в сам момент открытия, а у съёмки с сохранённым отбором они в этот момент ещё читаются (кадры
     показываются сразу из отбора): сверка при открытии такой съёмки не шла вовсе — ни статусы по папкам
     этапов, ни буквы ретушёров из имён папок, ни переименование папки под букву карточки. Работало только
     у съёмки, открытой впервые, и по «Файл → Сверить с Диском». */
  ready.then(function () {
    return typeof cpWalk === 'function' ? cpWalk(path).then(null, function () { return null; }) : null;
  }).then(function () {
    if (CP.shoot && CP.shoot.path === path && ((typeof cpPhotoCount === 'function' && cpPhotoCount()) || (CP.files && CP.files.length))) return cpMirrorSync(true);
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

/* ---------- буква ретушёра ⇄ имя папки артикула в 03 ----------
   Маша, 17.11.2026: «синхронизация тегов ретушёра должна происходить и на Диске: буква перед
   артикулом — K_23466, и наоборот: если в папке появилась буква, она должна присвоиться как тег».
   Точка отсчёта — m.rtLetter[код артикула] = {l, ts}: какая буква была у папки артикула в 03 при
   последней сверке (общая для всех — лежит в отборе съёмки). На Диске появилась или сменилась буква
   (папку переименовали руками) — карточка берёт букву Диска; пропавшая с Диска буква с карточки не
   снимается (2.0.112) — папка подписывается снова; изменилось в программе (буква на
   карточке, буква отмеченным в списке справа, скачали из панели ретуши) — папка артикула в 03
   переименовывается: «K_<прежнее имя>» или без буквы. Изменилось и там, и там — побеждает Диск, кроме
   свежего скачивания из панели ретуши (запись rtdl новее точки отсчёта): это действие позже.
   18.11.2026 (Маша: «буква на этапе ретуши появляется в имени папки»): раньше буквы сверялись только при
   открытии съёмки. Теперь у карточки с буквой папка в 03 сразу создаётся с буквой; букву, поставленную
   после отправки на ретушь, папка получает сразу же (быстрая сверка букв — cpRtRefresh); буква в имени
   папки читается в любом регистре и раскладке (cpLetterSplit, cp-deliver.js). */

CP.rtDirs = null;      /* код артикула -> [{code, path, parent, bare, letter}]: папки артикулов в 03 открытой съёмки */
CP.rtDirsFor = '';     /* путь съёмки, к которой относится CP.rtDirs */
CP.rtRoots = null;     /* папки этой съёмки в 03 (обычно одна) — для быстрой сверки букв */
CP.rtSyncAt = 0;       /* когда папки съёмки в 03 читали в последний раз */
CP.mirrorBusy = 0;     /* идёт полная сверка открытой съёмки — буквы решит она */

/** Папка артикула для файла в 03: ближайшая к файлу папка, чьё имя без буквы ретушёра — код артикула. */
function cpRtArtDir(root, filePath, letters, stype) {
  if (!root || String(filePath).indexOf(root + '/') !== 0) return null;
  var segs = filePath.slice(root.length + 1).split('/');
  segs.pop();
  for (var i = segs.length - 1; i >= 0; i--) {
    var sg = segs[i], letter = '', bare = sg, sp = cpLetterSplit(sg, letters);
    if (sp) { letter = sp.letter; bare = sp.rest; }
    var code = typeof cpArtCode === 'function' ? cpArtCode(stype, bare) : '';
    if (code) return { code: code, path: root + '/' + segs.slice(0, i + 1).join('/'), parent: root + (i ? '/' + segs.slice(0, i).join('/') : ''), bare: bare, letter: letter };
  }
  return null;
}

/** Новое имя папки артикула: буква + «_» + имя без буквы; без буквы — просто имя. */
function cpRtDirTarget(d, letter) { return d.parent + '/' + (letter ? letter + '_' : '') + d.bare; }

/** Карточки артикула открытой съёмки. */
function cpRtCards(code) { return App.cards.filter(function (c) { return c.cpArticle === code; }); }

/** Путь в 03 с учётом буквы: папка артикула уже переименована (Y_74595_модель) — путь ведёт в неё, а не рядом. */
function cpRtLetteredPath(target, shootPath) { return cpRtCopyPath(target, shootPath, true); }

/**
 * Папка съёмки в 03, в которую класть: уже существующая — в том числе с номером очереди перед именем
 * («1_2026-09-21_SV_…», Маша, 18.11.2026), иначе по имени съёмки. Раньше программа клала копии в папку
 * по имени, и рядом с «1_…» появлялась вторая папка той же съёмки.
 */
function cpRtRootOf(shootPath, plain) {
  if (!plain) { try { plain = cpRetouchBase(shootPath, CP.shoot ? CP.shoot.name : ''); } catch (e) { return ''; } }
  if (!CP.rtRoots || !CP.rtRoots.length || CP.rtDirsFor !== shootPath) return plain;
  var marked = CP.rtRoots.filter(function (r) { return r !== plain; })[0];
  return marked || plain;
}

/**
 * Куда класть копию в 03. Папка артикула там уже есть (с буквой ретушёра или без) — в неё. Папки ещё нет,
 * а у карточки артикула стоит буква — сразу в «K_<имя папки>» (Маша, 18.11.2026: «буква на этапе ретуши
 * появляется в имени папки»). Список папок съёмки в 03 неизвестен — путь не трогаем: гадать, есть ли там
 * папка, нельзя — получатся две папки одного артикула.
 */
function cpRtCopyPath(target, shootPath, onlyExisting) {
  if (!CP.rtDirs || !shootPath || CP.rtDirsFor !== shootPath || !CP.shoot || CP.shoot.path !== shootPath) return target;
  var letters = typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
  var plain, folder;
  try { plain = cpRetouchBase(shootPath, CP.shoot.name); } catch (e) { return target; }
  folder = cpRtRootOf(shootPath, plain);
  /* папка съёмки в 03 — с номером очереди: путь, построенный по имени съёмки, ведёт в неё */
  if (folder !== plain && target.indexOf(plain + '/') === 0) target = folder + target.slice(plain.length);
  if (!letters.length) return target;
  var d = cpRtArtDir(folder, target, letters, typeof cpShootType === 'function' ? cpShootType(CP.shoot.name) : null);
  if (!d) return target;
  var list = CP.rtDirs[d.code] || [];
  var have = list.filter(function (x) { return x.parent === d.parent && x.bare === d.bare; })[0];
  if (have) return have.path + target.slice(d.path.length);
  if (onlyExisting || list.length) return target;
  var cards = cpRtCards(d.code), letter = cards.length ? cpRtProgLetter(cards, undefined) : '';
  return letter ? cpRtDirTarget(d, letter) + target.slice(d.path.length) : target;
}

/** Копии легли в 03: их папки артикулов — в список папок съёмки, буква из имени новой папки — в точку отсчёта. */
function cpRtCopied(paths, shootPath) {
  if (!CP.shoot || CP.shoot.path !== shootPath || !CP.rtDirs || CP.rtDirsFor !== shootPath) return;
  var letters = typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
  if (!letters.length) return;
  var folder;
  try { folder = cpRtRootOf(shootPath, cpRetouchBase(shootPath, CP.shoot.name)); } catch (e) { return; }
  var stype = typeof cpShootType === 'function' ? cpShootType(CP.shoot.name) : null;
  var m = cpMeta(), base = m.rtLetter = m.rtLetter || {}, now = new Date().toISOString(), fresh = false;
  (paths || []).forEach(function (p) {
    var d = cpRtArtDir(folder, p, letters, stype);
    if (!d) return;
    var list = CP.rtDirs[d.code] = CP.rtDirs[d.code] || [];
    if (list.some(function (x) { return x.path === d.path; })) return;
    list.push(d);
    fresh = true;
    if (list.length === 1) base[d.code] = { l: d.letter, ts: now };   /* папку только что создали с этим именем */
  });
  if (fresh) cpRtLetterSoon();   /* букву карточке могли поставить, пока копировалось */
}

/**
 * Буква артикула в программе. У артикула бывает несколько карточек, и у части из них буквы нет вовсе —
 * это не «букву сняли» (2.0.111 так считал и снимал букву у всех карточек и у папки; Маша, 17.11.2026:
 * «у трёх артикулов их сняли»). Новая буква — та, что отличается от прежней; снята — только когда
 * буквы нет ни у одной карточки артикула.
 */
function cpRtProgLetter(cards, bl) {
  var ls = cards.map(function (c) { return cpCardLetter(c) || ''; }).filter(Boolean);
  if (bl === undefined) return ls[0] || '';
  var dev = ls.filter(function (l) { return l !== bl; });
  if (dev.length) return dev[0];
  return ls.length ? bl : '';
}

/** Карточкам — одна буква ретушёра (или никакой). Сколько карточек изменилось. */
function cpRtSetCards(cards, letter, letters) {
  var n = 0;
  cards.forEach(function (c) {
    var had = (c.tags || []).filter(function (t) { return letters.indexOf(t) !== -1; });
    if (had.length === (letter ? 1 : 0) && (!letter || had[0] === letter)) return;
    c.tags = (c.tags || []).filter(function (t) { return letters.indexOf(t) === -1; });
    if (letter) c.tags.push(letter);
    n++;
  });
  return n;
}

/**
 * Решение по буквам. dirs — папки артикулов в 03 ({код: [папки]}), recs — свежие скачивания из панели ретуши
 * ({код: запись rtdl}), skip — артикулы, которые сейчас не трогаем. Карточкам ставит букву Диска сразу;
 * что переименовать на Диске — возвращает (renames).
 */
function cpRtDecide(dirs, recs, letters, skip) {
  var out = { nCards: 0, renames: [], baseChanged: false };
  var m = cpMeta(), base = m.rtLetter = m.rtLetter || {}, now = new Date().toISOString();
  Object.keys(dirs).forEach(function (code) {
    if (skip && skip[code]) return;
    var cards = cpRtCards(code);
    if (!cards.length) return;
    var list = dirs[code];
    var diskL = (list.filter(function (d) { return d.letter; })[0] || {}).letter || '';
    var b = base[code], bl = b ? b.l : undefined, rec = recs && recs[code];
    var progL = cpRtProgLetter(cards, bl);
    var fromRec = !!rec && (!b || (rec.ts || '') >= (b.ts || ''));
    if (fromRec) { progL = rec.l; out.nCards += cpRtSetCards(cards, progL, letters); }
    var mixed = list.some(function (d) { return d.letter !== diskL; });
    /* с Диска буква только приходит (появилась или стала другой); пропавшую из имени папки букву не снимаем
       с карточки — папку подписываем снова (копия легла рядом без буквы, папку пересоздали и т. п.) */
    var diskChanged = !!diskL && diskL !== bl;
    var want = progL;
    if (diskChanged && !fromRec) {           /* на Диске поменяли руками — карточка берёт букву Диска */
      want = diskL;
      out.nCards += cpRtSetCards(cards, diskL, letters);
    } else out.nCards += cpRtSetCards(cards, progL, letters);   /* лишние буквы у карточки (две сразу) — одна */
    if (want === diskL && !mixed) {
      if (bl !== diskL) { base[code] = { l: diskL, ts: now }; out.baseChanged = true; }
      return;
    }
    list.forEach(function (d) { if (d.letter !== want) out.renames.push({ code: code, from: d.path, to: cpRtDirTarget(d, want), letter: want }); });
  });
  return out;
}

/**
 * Сверка букв при полной сверке съёмки: папки артикулов в 03 (по свежему списку файлов) против букв карточек.
 */
function cpRtLetterReconcile(rs, letters, idx) {
  var out = { nCards: 0, renames: [], baseChanged: false };
  var rt = (rs || []).filter(function (r) { return r.stage && r.stage.key === 'retouch'; })[0];
  if (!rt || !letters || !letters.length || !CP.shoot) return out;
  var m = cpMeta();
  var stype = typeof cpShootType === 'function' ? cpShootType(CP.shoot.name) : null;
  var dirs = {}, recs = {};
  (rt.found || []).forEach(function (f) {
    (f.files || []).forEach(function (file) {
      if (file.name === CPDisk.STATE_FILE) return;
      var d = cpRtArtDir(f.path, file.path, letters, stype);
      if (!d) return;
      var list = dirs[d.code] = dirs[d.code] || [];
      if (!list.some(function (x) { return x.path === d.path; })) list.push(d);
      /* скачали из панели ретуши (cp-review.js, запись rtdl) — действие в программе со своим временем */
      if (m.rtdl && idx) {
        var segs = file.path.slice(f.path.length + 1).split('/'), name = segs.pop();
        var rec = m.rtdl[cpMirrorMatch(idx, segs, name, letters).rel], rid = typeof cpRidShort === 'function' ? cpRidShort(file) : '';
        if (rec && rec.rid && rid && rec.rid !== rid) rec = null;   /* запись о прежней копии */
        if (rec && rec.l && letters.indexOf(rec.l) !== -1 && (!recs[d.code] || (rec.ts || '') > (recs[d.code].ts || ''))) recs[d.code] = rec;
      }
    });
  });
  CP.rtDirs = dirs;
  CP.rtDirsFor = CP.shoot.path;
  CP.rtRoots = (rt.found || []).map(function (f) { return f.path; });
  CP.rtSyncAt = Date.now();
  return cpRtDecide(dirs, recs, letters, null);
}

/** Папки артикулов в 03 — только списки папок, без файлов: {код: [папки]}. В папку артикула не заходим. */
function cpRtListDirs(roots, letters, stype) {
  var dirs = {};
  function level(paths, depth) {
    if (!paths.length || depth > 4) return Promise.resolve();
    return cpPool(paths, 4, function (p) { return cpListDirs(p).then(function (ds) { return { p: p, ds: ds }; }); }).then(function (lists) {
      var next = [];
      lists.forEach(function (o) {
        (o.ds || []).forEach(function (x) {
          if (x.name.charAt(0) === '_') return;
          var letter = '', bare = x.name, sp = cpLetterSplit(x.name, letters);
          if (sp) { letter = sp.letter; bare = sp.rest; }
          var code = typeof cpArtCode === 'function' ? cpArtCode(stype, bare) : '';
          if (!code) { next.push(x.path); return; }
          (dirs[code] = dirs[code] || []).push({ code: code, path: x.path, parent: o.p, bare: bare, letter: letter });
        });
      });
      return level(next, depth + 1);
    });
  }
  return level(roots, 1).then(function () { return dirs; });
}

/**
 * Быстрая сверка букв открытой съёмки (18.11.2026): читаются только списки папок съёмки в 03 — несколько
 * запросов, без файлов. Нужна, чтобы буква становилась именем папки сразу, а не при следующем открытии
 * съёмки: перед копированием на ретушь (копия ложится в папку с буквой), после него, когда букву поставили
 * артикулу, чья папка программе ещё не известна, и раз в полторы минуты — так буквы, которые ретушёры
 * дописали в имена папок на Диске, становятся тегами без «Сверить с Диском». Артикулы со свежим
 * скачиванием из панели ретуши (запись rtdl новее точки отсчёта) не трогает — их решает полная сверка:
 * ей видны сами файлы.
 */
var _cpRtRefreshP = null;
function cpRtRefresh() {
  if (!CP.shoot || CP.readOnly) return Promise.resolve(null);
  if (_cpRtRefreshP) return _cpRtRefreshP;
  var shoot = CP.shoot, letters = [], stype = null;
  var here = function () { return CP.shoot && CP.shoot.path === shoot.path; };
  var p = cpDictReady().then(function () {
    return typeof cpEnsureSettings === 'function' ? cpEnsureSettings() : null;
  }).then(function () {
    if (!here()) return null;
    letters = cpRetoucherTags();
    var st = cpStageRoots().filter(function (r) { return r.stage.key === 'retouch'; })[0];
    if (!st || !letters.length) { CP.rtDirs = {}; CP.rtDirsFor = shoot.path; CP.rtRoots = []; CP.rtSyncAt = Date.now(); return null; }
    stype = typeof cpShootType === 'function' ? cpShootType(shoot.name) : null;
    var find = function () {
      if (st.fixed) return Promise.resolve([st.fixed]);
      return cpFindShootIn(st.root, shoot.name, 3).then(function (found) { return found.map(function (f) { return f.path; }); });
    };
    var read = function (roots) { return cpRtListDirs(roots, letters, stype).then(function (dirs) { return { roots: roots, dirs: dirs }; }); };
    var cached = CP.rtRoots && CP.rtDirsFor === shoot.path && CP.rtRoots.length ? CP.rtRoots.slice() : null;
    return (cached ? read(cached) : find().then(read)).then(function (o) {
      /* папку съёмки в 03 могли переименовать («!_…» — очерёдность) — ищем её заново */
      return cached && !Object.keys(o.dirs).length ? find().then(read) : o;
    }).then(function (o) {
      if (!here()) return null;
      var m = cpMeta(), base = m.rtLetter || {}, skip = {};
      Object.keys(m.rtdl || {}).forEach(function (rel) {
        var rec = m.rtdl[rel];
        if (!rec || !rec.l || letters.indexOf(rec.l) === -1) return;
        var segs = rel.split('/');
        segs.pop();
        for (var i = segs.length - 1; i >= 0; i--) {
          var sp = cpLetterSplit(segs[i], letters), code = cpArtCode(stype, sp ? sp.rest : segs[i]);
          if (!code) continue;
          if (!base[code] || (rec.ts || '') >= (base[code].ts || '')) skip[code] = true;
          break;
        }
      });
      CP.rtDirs = o.dirs;
      CP.rtDirsFor = shoot.path;
      CP.rtRoots = o.roots;
      CP.rtSyncAt = Date.now();
      var res = cpRtDecide(o.dirs, null, letters, skip);
      if (res.nCards) {
        cpEvent('mirror', [], { note: 'сверка с Диском: букв ретушёров ' + res.nCards + ' — из имён папок в 03' }, true);
        cbMarkDirty();
        cbRenderCards();
        cbRenderOutline();
      } else if (res.baseChanged) cbMarkDirty();   /* запомнили, какие буквы на Диске сейчас */
      return (res.renames.length ? cpRtRename(res.renames, true) : Promise.resolve(0)).then(function () { return res; });
    });
  });
  var done = function () { if (_cpRtRefreshP === p) _cpRtRefreshP = null; };
  _cpRtRefreshP = p;
  p.then(done, function (e) { done(); if (window.console) console.warn('[CP] буквы ретушёров: папки в 03 не прочитались', e && (e.body || e.message || e)); });
  return p;
}

/** Переименовать папки на Диске [{from, to}]: {ok: [...], bad: [{x, why}]}. */
function cpRtMove(list) {
  var ok = [], bad = [];
  return list.reduce(function (p, x) {
    return p.then(function () {
      return CPDisk.proxyMove([{ from: x.from, path: x.to }]).then(function (r) {
        var st = r && r.results && r.results[0], s = st && st.status;
        if (s === 'done') return true;
        if (s === 'gone') return null;   /* папки уже нет (убрали в Корзину, переименовали) — нечего переименовывать */
        if (s === 'timeout' && typeof cpWaitThere === 'function') return cpWaitThere(x.to, 6);
        throw { message: s === 'exists' ? 'папка «' + x.to.split('/').pop() + '» уже есть' : ((st && st.error) || s || 'не переименовалась') };
      }).then(function (yes) {
        if (yes) ok.push(x); else if (yes === false) bad.push({ x: x, why: 'Диск не подтвердил' });
      }, function (e) { bad.push({ x: x, why: (e && (e.message || e.status)) || '' }); });
    });
  }, Promise.resolve()).then(function () { return { ok: ok, bad: bad }; });
}

/** Переименовать папки артикулов в 03 под буквы карточек открытой съёмки и запомнить точку отсчёта. */
function cpRtRename(list, quiet) {
  if (!list || !list.length || CP.readOnly || !CP.shoot) return Promise.resolve(0);
  var shoot = CP.shoot;
  CP.rtPushing = true;
  return cpRtMove(list).then(function (r) {
    CP.rtPushing = false;
    if (CP.shoot !== shoot) return r.ok.length;
    var m = cpMeta(), base = m.rtLetter = m.rtLetter || {}, now = new Date().toISOString();
    r.ok.forEach(function (x) {
      base[x.code] = { l: x.letter, ts: now };
      ((CP.rtDirs || {})[x.code] || []).forEach(function (d) { if (d.path === x.from) { d.path = x.to; d.letter = x.letter; } });
    });
    if (r.ok.length) {
      cpEvent('retouch_letter', r.ok.map(function (x) { return x.to.split('/').pop(); }), { note: 'буква ретушёра в имени папки в 03: '
        + r.ok.map(function (x) { return x.from.split('/').pop() + ' → ' + x.to.split('/').pop(); }).join(', ') }, true);
      cbMarkDirty();
    }
    if (r.bad.length) {
      if (window.console) console.warn('[CP] буква ретушёра: папки в 03 не переименованы', r.bad);
      if (!quiet) cbToast('Не получилось переименовать папки в ретуши под букву ретушёра: ' + r.bad.map(function (b) { return b.x.from.split('/').pop() + ' — ' + b.why; }).join('; '));
    }
    return r.ok.length;
  }, function (e) { CP.rtPushing = false; throw e; });
}

/* Буква поменялась в программе — папка в 03 переименовывается следом (по списку папок последней сверки). */
var cpRtPushTimer = null;
function cpRtLetterSoon() {
  if (CP.readOnly || !CP.shoot || CP.mirrorBusy) return;
  clearTimeout(cpRtPushTimer);
  cpRtPushTimer = setTimeout(cpRtLetterPush, CP.rtPushMs || 1500);
}
function cpRtLetterPush() {
  if (!CP.shoot || CP.readOnly || CP.mirrorBusy) return Promise.resolve(0);
  if (CP.rtPushing || _cpRtRefreshP) { cpRtLetterSoon(); return Promise.resolve(0); }
  var letters = typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
  if (!letters.length) return Promise.resolve(0);
  var m = cpMeta(), base = m.rtLetter || {}, list = [], aligned = false;
  var known = CP.rtDirs && CP.rtDirsFor === CP.shoot.path ? CP.rtDirs : null;
  /* букву поставили артикулу на ретуши, а его папка в 03 программе не известна (папки съёмки в 03 ещё не
     читали или артикул отправили только что) — быстрая сверка: она прочитает папки и переименует */
  var cst = m.cardStatus || {};
  var blind = App.cards.some(function (c) {
    return c.cpArticle && cst[c.id] && cst[c.id].s === 'retouch' && cpCardLetter(c) && !(known && known[c.cpArticle]);
  });
  if (blind && Date.now() - (CP.rtTriedAt || 0) > (CP.rtRetryMs || 20000)) {
    CP.rtTriedAt = Date.now();
    return cpRtRefresh().then(function () { return 0; }, function () { return 0; });
  }
  if (!known) return Promise.resolve(0);
  Object.keys(known).forEach(function (code) {
    var b = base[code];
    if (!b) return;   /* артикул ещё не сверялся — решит сверка */
    var cards = cpRtCards(code);
    if (!cards.length) return;
    var progL = cpRtProgLetter(cards, b.l);
    if (cpRtSetCards(cards, progL, letters)) aligned = true;   /* остальные карточки артикула — та же буква */
    if (progL === b.l && known[code].every(function (d) { return d.letter === progL; })) return;
    known[code].forEach(function (d) { if (d.letter !== progL) list.push({ code: code, from: d.path, to: cpRtDirTarget(d, progL), letter: progL }); });
  });
  if (aligned) { cbRenderCards(); cbRenderOutline(); if (!list.length) cbMarkDirty(); }
  return list.length ? cpRtRename(list, false) : Promise.resolve(0);
}
cbMarkDirty = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    try { cpRtLetterSoon(); } catch (e) { if (window.console) console.error('[CP] буква ретушёра', e); }
    return r;
  };
})(cbMarkDirty);

/* Открытая съёмка: буквы, которые ретушёры дописали в имена папок на Диске, становятся тегами карточек сами —
   раз в полторы минуты и когда вернулись на вкладку. Только у съёмок, чьи артикулы лежат в 03. */
CP.rtPollMs = 90000;
function cpRtPollDue(ms) {
  var shelf = document.getElementById('cpShelf');
  return !!(ms && CP.shoot && !CP.readOnly && document.visibilityState !== 'hidden' && !CP.mirrorBusy && !CP.rtPushing
    && !(shelf && shelf.classList.contains('cp-open'))
    && CP.rtDirs && CP.rtDirsFor === CP.shoot.path && Object.keys(CP.rtDirs).length && Date.now() - (CP.rtSyncAt || 0) > ms);
}
setInterval(function () { if (cpRtPollDue(CP.rtPollMs)) cpRtRefresh(); }, 30000);
document.addEventListener('visibilitychange', function () { if (cpRtPollDue(Math.min(CP.rtPollMs, 30000))) cpRtRefresh(); });

CP_ACTION_LABEL.retouch_letter = 'буква ретушёра — в имени папки артикула в 03';
