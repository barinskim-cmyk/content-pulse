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

   Копии в ретуши остаются доступны после сдачи на сайт.
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
function cpFindShootIn(root, shootName, maxDepth, allLevels) {
  if (CPDisk.isReadyFolder(cpFolderBase(root))) return Promise.resolve([]);
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
      return found.length && !allLevels ? null : level(next, depth + 1);
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
        : cpFindShootIn(r.root, shoot.name, r.stage.key === 'site' ? 5 : r.stage.key === 'review' ? 4 : 3, r.stage.key === 'review');
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
    /* сданное руками (в 04 и на сайт) — в выработку, один раз */
    if (res.rows && res.rows.length && typeof cpOutputAppend === 'function') cpOutputAppend(res.rows);
    cpUpdateStatusLine();
    if (!quiet || res.changed.length) cbToast(res.changed.length ? 'Сверено с Диском: ' + res.changed.join(', ') : 'Сверено с Диском' + (res.issues ? ', расхождений: ' + res.issues : ' — всё совпадает'));
    var ren = res.rtRenames || [];
    return (ren.length ? cpRtRename(ren, quiet) : Promise.resolve()).then(function () { return res; });
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

function cpDonePids() {
  var m = cpMeta(), del = m.delivered || {}, done = {}, keep = {}, delArt = {};
  var is = function (c) { return !!del[c.id]; };
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

/* Программа сама загружает в 04 (cp_up) или переносит на сайт (cp_mv) — метка на папке артикула на это время.
   Пока она свежая, папку не считаем сданной руками: другой компьютер видит её раньше, чем программа запишет
   версию в отбор. Метка старше этого срока (вкладку закрыли посреди загрузки) — уже как сданное руками. */
CP.mirrorBusyMs = { up: 6 * 3600000, mv: 3600000 };
function cpMirrorDirEntry(files, dir, letter) {
  var pr = ((files && files.dirProps) || {})[dir] || {};
  return { files: [], mod: '', letter: letter, up: pr.cp_up || '', mv: pr.cp_mv || '' };
}
function cpMirrorBusy(bd, kind) {
  var t = +(bd && bd[kind]) || 0;
  return t > 0 && Date.now() - t < CP.mirrorBusyMs[kind];
}

/**
 * Сдали на сайт руками (или старший перенёс руками из 04): «загружено» у карточки — кто сдал, день и дроп
 * по пути на сайте; версия на проверке — принята. Строка в выработку — одна на папку артикула на сайте.
 * art — {letter, byDir: {папка артикула: {files, mod}}}.
 */
function cpMirrorSiteDelivered(m, c, art, shootName, letterHint, now, rows, rowDone) {
  var dir = Object.keys(art.byDir).filter(function (x) { return !cpMirrorBusy(art.byDir[x], 'mv'); })[0];
  if (!dir) return false;   /* программа сейчас сама переносит эту папку на сайт */
  var bd = art.byDir[dir], spi = cpSitePathInfo(dir + '/x');
  var day = spi.date || cpIsoDayOf(bd.mod) || cpToday(), key = 'сайт|' + dir;
  var letter = spi.letter || bd.letter || art.letter || letterHint || '';
  var rv = m.rv = m.rv || {}, lst = rv[c.id] || [], last = lst[lst.length - 1];
  var accepted = !!(last && last.status === 'review');
  if (accepted) { last.status = 'approved'; last.rby = 'Диск'; last.rts = now; last.site = CPDisk.showPath(dir); }
  m.delivered = m.delivered || {};
  m.delivered[c.id] = { files: bd.files.length, letter: letter, date: day, drop: spi.n || undefined, at: CPDisk.showPath(dir), out: 'Диск', ts: now, byArt: true };
  if (rowDone[key]) return true;
  rowDone[key] = true;
  rows.push(cpDiskRow({ stamp: bd.mod, day: day, letter: letter, shoot: shootName, card: c.title || c.cpArticle || '', files: bd.files.length,
    event: accepted ? 'принято' : 'сдано', way: (accepted ? 'руками перенесено в ' : 'руками сразу в ') + cpStageLabel('site'), v: accepted ? last.v : '', key: key }));
  return true;
}

/**
 * На доработку руками: к папке версии в 04 дописали «_доработка» (как делает кнопка «На доработку») — версия
 * «на доработке», строка в выработку. true — отметили.
 */
function cpMirrorReworkByHand(m, c, art, shootName, now, rows, rowDone) {
  var lst = ((m.rv || {})[c.id]) || [], last = lst[lst.length - 1];
  if (!last || last.status !== 'review' || !last.dir || /_доработка$/i.test(last.dir)) return false;
  var want = (last.dir + '_доработка').toLowerCase(), dirs = (art && art.byDir) || {};
  var hit = Object.keys(dirs).filter(function (d) { return d.toLowerCase() === want && !cpMirrorBusy(dirs[d], 'mv'); })[0];
  if (!hit) return false;
  var from = last.dir, bd = dirs[hit], day = cpIsoDayOf(bd.mod) || cpToday(), key = 'доработка|' + hit + '|' + day;
  (last.files || []).forEach(function (f) { if (f.path.indexOf(from + '/') === 0) f.path = hit + f.path.slice(from.length); });
  last.dir = hit; last.status = 'rework'; last.rby = 'Диск'; last.rts = now; last.note = last.note || '';
  if (!rowDone[key]) {
    rowDone[key] = true;
    rows.push(cpDiskRow({ stamp: bd.mod, day: day, letter: last.letter || '', shoot: shootName, card: c.title || c.cpArticle || '', files: (last.files || []).length,
      event: 'доработка', way: 'руками на Диске («_доработка» в имени папки)', v: last.v, key: key }));
  }
  return true;
}

/**
 * Сдали в 04 руками (Маша, 18.11.2026: «если кто-то загрузил на Диск, вместо того чтобы закинуть через программу,
 * мы точно так же считываем, что и куда загружено, — программа просто зеркало»): папка артикула в 04, файлов
 * которой нет ни в одной версии, — версия ретуши «с Диска» на проверку. Буква — из имени папки (U_75327…),
 * день — по самому свежему файлу в ней. Имена файлов у ретушёров свои — по папке артикула, а не по кадрам.
 * true — версия добавлена.
 */
function cpMirrorRvFromDisk(m, c, art, shootName, letterHint, now, rows, rowDone, knownAny) {
  var dirs = art.byDir || {};
  if (((m.cardStatus || {})[c.id] || {}).s === 'reshoot') return false;
  var rv = m.rv || {}, lst = rv[c.id] || [], last = lst[lst.length - 1];
  var current = last && last.dir, saved = current && dirs[current], replacement = false;
  if (saved && !/_доработка$/i.test(current) && !cpMirrorBusy(saved, 'up')) {
    var old = new Map((last.files || []).map(function (f) { return [f.path, f]; }));
    replacement = saved.files.some(function (f) {
      var prev = old.get(f.path);
      if (!prev || f.size !== prev.size) return true;
      if (f.md5 && prev.md5) return f.md5 !== prev.md5;
      return Date.parse(f.modified || '') > Date.parse(last.ts || '') + 1000;
    });
  }
  if (!replacement && last && last.status === 'review') return false;
  var newDir = replacement ? current : Object.keys(dirs).find(function (d) {
    return !/_доработка$/i.test(d) && !cpMirrorBusy(dirs[d], 'up') && dirs[d].files.some(function (f) { return !knownAny[f.path]; });
  });
  if (!newDir) return false;
  var bd = dirs[newDir], path = cpReviewVersionPath(cpReviewRoot(), newDir) || {};
  var day = path.date || cpIsoDayOf(bd.mod) || cpToday(), key = '04|' + newDir + '|' + day;
  if (replacement) key += '|' + cpHash(JSON.stringify(bd.files.map(function (f) { return [f.path, f.md5 || f.modified || f.size]; }).sort()));
  if (last && /^(review|rework)$/.test(last.status)) last.status = 'replaced';
  var ver = { v: lst.length + 1, batch: 'Диск', letter: path.letter || bd.letter || art.letter || letterHint || '', n: path.n || '', date: day, dropDate: day, by: 'Диск', ts: now,
    files: bd.files.slice(), status: 'review', dir: newDir, byArt: true, key: key };
  m.rv = rv;
  (rv[c.id] = lst).push(ver);
  bd.files.forEach(function (f) { knownAny[f.path] = true; });
  if (!rowDone[key]) {
    rowDone[key] = true;
    rows.push(cpDiskRow({ stamp: bd.mod, day: day, letter: ver.letter, shoot: shootName, card: c.title || c.cpArticle || '', files: bd.files.length, event: 'сдано',
      way: 'руками в ' + cpStageLabel('review'), v: ver.v, key: key }));
  }
  return true;
}

/* ---------- зеркало всех съёмок (Маша, 18.11.2026) ----------
   «При открытии программы мы смотрим на статус всего и обновляем этот статус исходя из того, что сейчас
   находится на сервере, в каких папках что находится.» Раньше отбор съёмки сверялся с папками этапов только
   при открытии самой съёмки. Теперь после каждой сверки витрины с Диском (при загрузке и раз в 40 секунд)
   у каждой съёмки, которая лежит на этапах, берётся отпечаток: какие артикулы в 02/03/04/на сайте, с какими
   буквами и в каких папках. Совпал с прошлым (cp_mir в свойствах папки съёмки) — ничего не делается и к Диску
   не идёт. Не совпал — читается отбор съёмки и папки 04 и сайта, и в отбор записывается то, что лежит на
   Диске: статус карточек по папкам этапов, буква ретушёра из имени папки в 03, версия ретуши, сданная в 04
   руками, «загружено» и «принято» по сайту. Сданное руками — строкой в выработку (с ключом: один раз).
   Открытую в этой вкладке съёмку сверяет сама съёмка (cpMirrorSync). Съёмку, которую в программе ещё не
   открывали (отбора нет), не трогаем — только строки в выработку. */
CP.mirrorAll = !window.cpNoMirrorAll;   /* автотесты выключают, где фоновые записи им мешают */
CP.mirrorAllBusy = false;

function cpHash(str) {
  var h = 5381;
  for (var i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Отпечаток того, что лежит на этапах у съёмки; '' — ни на одном этапе её нет. */
function cpMirrorSig(low) {
  var parts = [];
  ['approval', 'retouch', 'review', 'site'].forEach(function (k) {
    if (!((CP.stagePresence || {})[k] || {})[low]) return;
    var a = ((CP.stageArts || {})[k] || {})[low];
    var codes = a ? Object.keys(a).sort().map(function (c) { return c + ':' + (a[c] || ''); }) : ['?'];
    var dm = (((CP.stageDirs || {})[k] || {})[low]) || {};
    var dirs = Object.keys(dm).sort().map(function (c) { return dm[c].slice().sort().join(','); });
    parts.push(k + '=' + codes.join(',') + '#' + dirs.join(';'));
  });
  return parts.length ? cpHash(parts.join('|')) : '';
}

/** Файлы этапа по артикулам: {код: {letter, byDir: {папка артикула: {files, mod, letter}}}}. */
function cpMirrorArts(found, letters, stype) {
  var out = {};
  (found || []).forEach(function (f) {
    (f.files || []).forEach(function (file) {
      if (file.name === CPDisk.STATE_FILE) return;
      var segs = file.path.slice(f.path.length + 1).split('/'), name = segs.pop(), code = '', artDir = '', letter = '';
      segs.forEach(function (sg) { var l = cpLetterSplit(sg, letters); if (l) letter = l.letter; });
      for (var si = segs.length - 1; si >= 0 && !code; si--) {
        var sp = cpLetterSplit(segs[si], letters);
        code = cpArtCode(stype, sp ? sp.rest : segs[si]);
        if (code) artDir = f.path + '/' + segs.slice(0, si + 1).join('/');
      }
      if (!code) { code = cpArtCode(stype, name); if (code) artDir = file.path.slice(0, file.path.lastIndexOf('/')); }
      if (!code) return;
      var a = out[code] = out[code] || { letter: '', byDir: {} };
      if (!a.letter && letter) a.letter = letter;
      var bd = a.byDir[artDir] = a.byDir[artDir] || cpMirrorDirEntry(f.files, artDir, letter);
      bd.files.push({ path: file.path, name: file.name, size: file.size, md5: file.md5, modified: file.modified });
      if ((file.modified || '') > bd.mod) bd.mod = file.modified || '';
    });
  });
  return out;
}

/**
 * Отбор съёмки (data) — по тому, что лежит на этапах (ph: approval/retouch — {код: буква} по сверке витрины;
 * review/site — cpMirrorArts по самим папкам). Только по артикулам. -> {changed, rows}
 */
function cpMirrorDataApply(data, d, ph, letters) {
  data.meta = data.meta || {};
  var m = data.meta.cp = data.meta.cp || {};
  m.cardStatus = m.cardStatus || {};
  var now = new Date().toISOString(), rows = [], rowDone = {}, n = { st: 0, l: 0, rv: 0, site: 0 };
  var cards = data.cards || [];
  var rv = m.rv || {}, knownAny = {};
  Object.keys(rv).forEach(function (id) { (rv[id] || []).forEach(function (v) { (v.files || []).forEach(function (f) { knownAny[f.path] = true; }); }); });
  var letterOf = function (c) { return (c.tags || []).filter(function (t) { return letters.indexOf(t) !== -1; })[0] || ''; };
  /* буква ретушёра из имени папки в 03 -> тег карточек артикула (с Диска буква только приходит, как в cpRtDecide) */
  var base = m.rtLetter = m.rtLetter || {};
  Object.keys(ph.retouch || {}).forEach(function (code) {
    var dl = ph.retouch[code];
    if (!dl || letters.indexOf(dl) === -1) return;
    var cs = cards.filter(function (c) { return cpRtCardCode(c) === code; });
    if (!cs.length || (base[code] && base[code].l === dl)) return;
    cs.forEach(function (c) {
      if (letterOf(c) === dl && (c.tags || []).filter(function (t) { return letters.indexOf(t) !== -1; }).length === 1) return;
      c.tags = (c.tags || []).filter(function (t) { return letters.indexOf(t) === -1; });
      c.tags.push(dl);
      n.l++;
    });
    base[code] = { l: dl, ts: now };
    n.base = true;
  });
  cards.forEach(function (c) {
    var code = c.cpArticle;
    if (!code || code.indexOf(',') !== -1) return;
    var inA = !!(ph.approval && ph.approval[code] !== undefined), inR = !!(ph.retouch && ph.retouch[code] !== undefined);
    var rvA = ph.review && ph.review[code], stA = ph.site && ph.site[code];
    var cs = m.cardStatus[c.id];
    var want = inR || rvA || stA ? 'retouch' : inA ? 'approval' : '';
    if (want && !(cs && (cs.s === 'reshoot' || cpStatusRank(cs.s) >= cpStatusRank(want)))) { m.cardStatus[c.id] = { s: want, by: 'Диск', ts: now }; n.st++; }
    if (stA && !(m.delivered || {})[c.id] && cpMirrorSiteDelivered(m, c, stA, d.name, letterOf(c), now, rows, rowDone)) n.site++;
    if (rvA && cpMirrorReworkByHand(m, c, rvA, d.name, now, rows, rowDone)) n.rv++;
    if (rvA && cpMirrorRvFromDisk(m, c, rvA, d.name, letterOf(c), now, rows, rowDone, knownAny)) n.rv++;
  });
  var changed = n.st + n.l + n.rv + n.site > 0;
  if (changed) {
    var note = [];
    if (n.st) note.push('статусов ' + n.st);
    if (n.l) note.push('букв ретушёров ' + n.l);
    if (n.rv) note.push('версий ретуши ' + n.rv);
    if (n.site) note.push('загружено ' + n.site);
    (m.events = m.events || []).push({ ts: now, actor: 'Диск', action: 'mirror', items: [], note: 'сверка с Диском (витрина): ' + note.join(', ') });
  }
  return { changed: changed || !!n.base, rows: rows };
}

/** Строки выработки у съёмки, которую в программе не открывали: что сдано руками в 04 и на сайт. */
function cpMirrorRowsNoState(d, ph) {
  var rows = [], done = {};
  Object.keys(ph.review || {}).forEach(function (code) {
    var dirs = ph.review[code].byDir;
    Object.keys(dirs).forEach(function (dir) {
      if (/_доработка$/i.test(dir)) return;
      var bd = dirs[dir], day = cpIsoDayOf(bd.mod) || cpToday(), key = '04|' + dir + '|' + day;
      if (done[key]) return;
      done[key] = true;
      rows.push(cpDiskRow({ stamp: bd.mod, day: day, letter: bd.letter || ph.review[code].letter, shoot: d.name, card: code, files: bd.files.length, event: 'сдано',
        way: 'руками в ' + cpStageLabel('review'), key: key }));
    });
  });
  Object.keys(ph.site || {}).forEach(function (code) {
    var dir = Object.keys(ph.site[code].byDir)[0], bd = ph.site[code].byDir[dir], spi = cpSitePathInfo(dir + '/x'), key = 'сайт|' + dir;
    if (done[key]) return;
    done[key] = true;
    rows.push(cpDiskRow({ stamp: bd.mod, day: spi.date || cpIsoDayOf(bd.mod), letter: spi.letter || bd.letter || ph.site[code].letter, shoot: d.name, card: code,
      files: bd.files.length, event: 'сдано', way: 'руками сразу в ' + cpStageLabel('site'), key: key }));
  });
  return rows;
}

/** Одна съёмка: прочитать отбор и папки 04 и сайта, записать в отбор то, что на Диске. */
function cpMirrorBgShoot(d, sig, letters) {
  var low = d.name.toLowerCase(), stype = typeof cpShootType === 'function' ? cpShootType(d.name) : null;
  var ph = { approval: ((CP.stageArts || {}).approval || {})[low] || null, retouch: ((CP.stageArts || {}).retouch || {})[low] || null };
  var walk = function (key) {
    var paths = ((CP.stagePaths || {})[key] || {})[low] || [];
    if (!((CP.stagePresence || {})[key] || {})[low] || !paths.length) return Promise.resolve({});
    return cpPool(paths, 1, function (p) {
      return CPDisk.walkPhotos(p, false, 2, true, 3).then(function (files) { return { path: p, files: files }; }, function () { return { path: p, files: [] }; });
    }).then(function (found) { return cpMirrorArts(found, letters, stype); });
  };
  var mark = function () {
    return CPDisk.proxyProps(d.path, { cp_mir: sig }).then(function () {
      d.custom_properties = d.custom_properties || {};
      d.custom_properties.cp_mir = sig;
    }, function () { });
  };
  var data0 = null;
  return CPDisk.bg(3, function () { return CPDisk.readState(d.path); }).then(function (st) {
    data0 = st && st.data;
    return Promise.all([walk('review'), walk('site')]);
  }).then(function (w) {
    ph.review = w[0]; ph.site = w[1];
    if (!data0) return cpOutputAppend(cpMirrorRowsNoState(d, ph)).then(mark);
    var res = cpMirrorDataApply(cpClone(data0), d, ph, letters);
    if (!res.changed) return mark();
    /* сводку для витрины после записи отбор считает по папкам съёмки — обход заранее, в последнюю очередь */
    return (typeof cpWalk === 'function' ? cpWalk(d.path, false, 3).then(null, function () { return null; }) : Promise.resolve()).then(function () {
      return cpMutateState({ path: d.path, name: d.name }, function (data) { res = cpMirrorDataApply(data, d, ph, letters); });
    }).then(function () { return cpOutputAppend(res.rows); }).then(mark);
  });
}

function cpMirrorAll() {
  if (!CP.mirrorAll || CP.mirrorAllBusy || typeof cpCatalog !== 'function' || !cpCatalog() || CP.stageArtsFor !== CP.archive || !CP.shoots || !CPDisk.hasProxy()) return Promise.resolve();
  var letters = typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
  var archive = CP.archive, todo = [];
  CP.shoots.forEach(function (d) {
    if (CP.shoot && CP.shoot.path === d.path) return;   /* открытую сверяет сама съёмка */
    var sig = cpMirrorSig(d.name.toLowerCase());
    if (!sig || ((d.custom_properties || {}).cp_mir || '') === sig) return;
    todo.push({ d: d, sig: sig });
  });
  if (!todo.length) return Promise.resolve();
  CP.mirrorAllBusy = true;
  var any = false;
  return todo.reduce(function (p, t) {
    return p.then(function () {
      if (CP.archive !== archive || !CP.mirrorAll) return;
      any = true;
      return cpMirrorBgShoot(t.d, t.sig, letters).catch(function (e) { if (window.console) console.warn('[CP] зеркало: съёмка не сверилась', t.d.name, e && (e.body || e.message || e)); });
    });
  }, Promise.resolve()).then(function () {
    CP.mirrorAllBusy = false;
    if (any && CP.archive === archive) cpRenderShoots();
  }, function () { CP.mirrorAllBusy = false; });
}

/* после каждой сверки витрины с Диском (папки этапов и артикулы на них прочитаны) */
cpScanStages = (function (orig) {
  return function () {
    return Promise.resolve(orig.apply(this, arguments)).then(function (r) {
      setTimeout(function () { cpMirrorAll(); }, 0);
      return r;
    });
  };
})(cpScanStages);

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
          var bd = apk.byDir[artDir] = apk.byDir[artDir] || cpMirrorDirEntry(f.files, artDir, letter);
          bd.files.push({ path: file.path, name: file.name, size: file.size, md5: file.md5, modified: file.modified });
          if ((file.modified || '') > bd.mod) bd.mod = file.modified || '';
        }
        if (!p) { unmatched.push({ stage: r.stage.label, path: file.path }); return; }
        var pr = pres[p.id] = pres[p.id] || {};
        pr[r.stage.key] = { path: file.path, name: file.name, size: file.size, modified: file.modified || '', mv: (((f.files.dirProps || {})[file.path.slice(0, file.path.lastIndexOf('/'))]) || {}).cp_mv || '', letter: letter, prio: f.prio, key: mt.rel,
          rid: typeof cpRidShort === 'function' ? cpRidShort(file) : '' };
      });
    });
  });
  var changed = [], nStat = 0, nLetter = 0, nRv = 0, nSite = 0, rows = [], rowDone = {};
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
    /* сдали на сайт руками: кто, когда и какой дроп — по пути (дата / буква / номер дропа / …); строка в выработку */
    if (ap.site && !(m.delivered || {})[c.id] && cpMirrorSiteDelivered(m, c, ap.site, CP.shoot.name, lt, now, rows, rowDone)) nSite++;
    /* на доработку руками («_доработка» в имени папки в 04) и сдали в 04 руками — версия ретуши «с Диска»; строки в выработку */
    if (ap.review && cpMirrorReworkByHand(m, c, ap.review, CP.shoot.name, now, rows, rowDone)) nRv++;
    if (ap.review && cpMirrorRvFromDisk(m, c, ap.review, CP.shoot.name, cpCardLetter(c), now, rows, rowDone, knownAny)) nRv++;
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
        var rvMod = pids.reduce(function (a2, pid) { var x = pres[pid].review; return x && x.modified > a2 ? x.modified : a2; }, '');
        var rvDay = cpIsoDayOf(rvMod) || cpToday(), rvDir = rvFiles[0].path.slice(0, rvFiles[0].path.lastIndexOf('/')), rvKey = '04|' + rvDir + '|' + rvDay;
        list.push({ v: list.length + 1, batch: 'Диск', letter: letter || (cpCardLetter(c) || ''), n: '', date: rvDay, dropDate: rvDay, by: who, ts: now, files: rvFiles, status: 'review', key: rvKey });
        if (!rowDone[rvKey]) { rowDone[rvKey] = true; rows.push(cpDiskRow({ stamp: rvMod, day: rvDay, letter: letter || cpCardLetter(c) || '', shoot: CP.shoot.name, card: c.title || '', files: rvFiles.length, event: 'сдано', way: 'руками в ' + cpStageLabel('review'), v: list.length, key: rvKey })); }
        nRv++;
      }
    }
    var site = pids.filter(function (pid) { return pres[pid].site; });
    if (site.length && !(m.delivered || {})[c.id]) {
      var sArt = { letter: pres[site[0]].site.letter || '', byDir: {} };
      site.forEach(function (pid) {
        var x = pres[pid].site, sd = x.path.slice(0, x.path.lastIndexOf('/'));
        var bd = sArt.byDir[sd] = sArt.byDir[sd] || { files: [], mod: '', letter: x.letter || '', mv: x.mv || '' };
        bd.files.push({ path: x.path, name: x.name, size: x.size });
        if ((x.modified || '') > bd.mod) bd.mod = x.modified || '';
      });
      if (cpMirrorSiteDelivered(m, c, sArt, CP.shoot.name, letter || cpCardLetter(c) || '', now, rows, rowDone)) nSite++;
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
  return { ts: now, changed: changed, missing: missing, unmatched: unmatched, rtRenames: rtSync.renames, rows: rows, roots: rs.map(function (r) { return { label: r.stage.label, found: (r.found || []).map(function (f) { return CPDisk.showPath(f.path); }) }; }), issues: missing.length + unmatched.length };
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

/** После сдачи на сайт перечитать этапы открытой съёмки. */
function cpMirrorAfterDelivery() {
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
function cpRtCardCode(card) { return card.cpArticle || cpArtCode(null, card.title); }
function cpRtCards(code) { return App.cards.filter(function (c) { return cpRtCardCode(c) === code; }); }

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
    var fromRec = !!rec && (!b || (rec.ts || '') > (b.ts || ''));
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
          if (!base[code] || (rec.ts || '') > (base[code].ts || '')) skip[code] = true;
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
    var code = cpRtCardCode(c);
    return code && cst[c.id] && cst[c.id].s === 'retouch' && cpCardLetter(c) && !(known && known[code]);
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
