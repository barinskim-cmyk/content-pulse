/* ============================================================
   cp-upload.js — загрузка съёмки в исходники (01_ИСХОДНИКИ)

   Маша, 09.11.2026: «добавь загрузку папкой в исходники, чтобы фотографам тоже
   не нужно было заходить в Диск; с опцией добавить часть к съёмке (например,
   видео); заливаться по очереди — сначала фото, потом видео. Если фотограф
   закидывает съёмку с тем же названием, которое уже есть, + _1, _2, _3 — это
   часть той же съёмки: просто добавить в неё по структуре — кадры в
   конкретный лук и т. д.».

   Витрина, вкладка исходников: полоска «Загрузить съёмку» — перетащить папку
   (одну или несколько) или выбрать. Папка называется как новая съёмка — ляжет
   рядом с остальными; как съёмка, которая уже есть (или с _1, _2… на конце) —
   её файлы добавятся в ту съёмку по её папкам (лук → лук, артикул → артикул).
   В панели съёмки — «Догрузить»: что угодно в эту съёмку (папка «видео»,
   отдельные файлы), независимо от имени.
   Порядок: сначала кадры, потом прочее, видео — последним и по одному.
   Исходники не перезаписываются: файл с тем же путём и размером уже есть —
   пропускается; тот же путь, другой размер — ложится рядом с «_2».

   Через Облако (09.11, проверка скорости у Маши: Облако в 4 потока 38 МБ/с — 15 ГБ
   за ~7 мин, Диск в 4 потока 8 МБ/с — ~31 мин; «можем ли сначала выгружать в Облако,
   а оттуда оно само закинет на Диск, когда комп выключен»): файлы уходят в бакет
   в 4 потока (большие — кусками по 64 МБ), и сразу после каждого Диск получает
   команду «сохранить файл из интернета» по подписанной ссылке (3 дня) — забирает
   сам, на своей стороне. Как всё легло в Облако — компьютер можно выключать.
   Что ещё едет, записано в служебной папке (_в_пути/<время>.json); витрина при
   открытии сверяет: доехало — вычёркивает, не вышло — просит Диск ещё раз, на
   съёмке — «едет на Диск: N из M». Напрямую на Диск — тоже 4 потока (8 МБ/с
   против 2 в один поток), кадры, потом видео.
   Выбора способа в окне нет (Маша, 09.11: «галка не нужна, мы просто выбираем
   оптимальный способ»): всегда через Облако; Облако недоступно — сами напрямую.
   ============================================================ */

CP.srcVia = '';   /* '' — сами (Облако, если есть прослойка); 'disk' — только напрямую (проверки) */

var CP_IMAGE_RE = /\.(jpe?g|png|tiff?|heic|heif|webp|psd|dng|cr2|cr3|nef|arw|raf|orf|rw2|srw|pef|3fr|iiq|x3f)$/i;

/** Папка исходников, куда ложатся новые съёмки. */
function cpSrcRoot() {
  if (typeof cpCatalog === 'function' && cpCatalog() && typeof cpCatDirs === 'function') {
    var d = cpCatDirs('source')[0];
    if (d) return d.path.replace(/\/+$/, '');
  }
  return String(CP.archive || '').replace(/\/+$/, '');
}

/** Съёмка, частью которой считается папка: то же имя или имя + «_1», «_2»… */
function cpSrcShootFor(top) {
  var t = String(top || '').toLowerCase(), byName = {};
  (CP.shoots || []).forEach(function (d) { byName[d.name.toLowerCase()] = d; });
  if (byName[t]) return byName[t];
  var m = /^(.*)_(\d{1,3})$/.exec(t);
  return m && byName[m[1]] ? byName[m[1]] : null;
}

function cpSrcKind(name) {
  if (typeof cpIsVideo === 'function' && cpIsVideo(name)) return 'video';
  return CP_IMAGE_RE.test(name) ? 'photo' : 'other';
}

/* ---------- окно загрузки ---------- */

/** target: null — по именам папок (витрина); {path, name} — «Догрузить» в эту съёмку. */
function cpSrcOpen(target) {
  var box = document.getElementById('cpSrcUp');
  if (!box) {
    box = document.createElement('div');
    box.id = 'cpSrcUp';
    box.className = 'cp-files';
    document.body.appendChild(box);
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cp-su]');
      if (!b || !CP.srcUp) return;
      var act = b.getAttribute('data-cp-su');
      if (act === 'close') {
        if (CP.srcUp.busy) return;
        var left = CP.srcUp.transitItems && CP.srcUp.transitItems.some(function (x) { return x.st !== 'done' && x.st !== 'lost'; });
        box.classList.remove('cp-open'); CP.srcUp = null;
        if (left) setTimeout(cpTransitScan, 500);   /* дальше за «в пути» следит витрина */
      }
      else if (act === 'reset') { CP.srcUp.files = []; CP.srcUp.plan = null; cpSrcRender(); }
      else if (act === 'go') cpSrcUpload();

    });
    box.addEventListener('change', function (e) {
      var inp = e.target;
      if (!inp.hasAttribute || !inp.hasAttribute('data-cp-su-pick') || !CP.srcUp) return;
      cpSrcAdd(Array.prototype.slice.call(inp.files || []).map(function (f) { return { file: f, rel: f.webkitRelativePath || f.name }; }));
      inp.value = '';
    });
    box.addEventListener('dragover', function (e) { e.preventDefault(); e.stopPropagation(); var z = box.querySelector('.cp-acc-drop'); if (z) z.classList.add('cp-over'); });
    box.addEventListener('dragleave', function (e) { var z = box.querySelector('.cp-acc-drop'); if (z && !box.contains(e.relatedTarget)) z.classList.remove('cp-over'); });
    box.addEventListener('drop', function (e) {
      e.preventDefault(); e.stopPropagation();
      if (typeof dragDepth !== 'undefined') dragDepth = 0;
      document.body.classList.remove('cb-file-drag');
      if (!CP.srcUp || CP.srcUp.busy) return;
      cpDropFiles(e.dataTransfer).then(cpSrcAdd);
    });
  }
  CP.srcUp = { target: target || null, files: [], plan: null, busy: false,
    via: CPDisk.hasProxy() && CP.srcVia !== 'disk' ? 'cloud' : 'disk' };
  box.classList.add('cp-open');
  cpSrcRender();
}

function cpSrcAdd(files) {
  var st = CP.srcUp;
  if (!st) return;
  files = (files || []).filter(function (x) { return x && x.file && !CP_JUNK_FILE.test(x.file.name); });
  if (!files.length) return;
  st.files = st.files.concat(files);
  st.plan = null;
  cpSrcRender();
  cpSrcPlan().then(cpSrcRender, function (e) { st.planError = (e && (e.message || e.body)) || String(e); cpSrcRender(); });
}

/** Разбор: куда что ляжет. {groups: [{mode, shoot, target, jobs, skipped, renamed}]} */
function cpSrcPlan() {
  var st = CP.srcUp, root = cpSrcRoot();
  var groups = {}, order = [], loose = [];
  st.files.forEach(function (x) {
    var segs = x.rel.split('/').filter(Boolean);
    if (st.target) {
      /* «Догрузить»: папка с именем съёмки (или её частью) — по её структуре, иначе — как есть */
      var key = st.target.path;
      if (!groups[key]) { groups[key] = { mode: 'part', shoot: st.target, target: st.target.path.replace(/\/+$/, ''), items: [] }; order.push(key); }
      groups[key].items.push({ x: x, segs: segs });
      return;
    }
    if (segs.length < 2) { loose.push(x.rel); return; }
    var top = segs[0], d = cpSrcShootFor(top);
    var k = d ? d.path : 'new:' + top.toLowerCase();
    if (!groups[k]) {
      groups[k] = d ? { mode: 'part', shoot: d, top: top, target: d.path.replace(/\/+$/, ''), items: [] }
        : { mode: 'new', shoot: { name: top }, top: top, target: root + '/' + CPDisk.safeName(top), items: [] };
      order.push(k);
    }
    groups[k].items.push({ x: x, segs: segs.slice(1) });
  });
  if (st.target) {
    var g0 = groups[st.target.path];
    var tops = {};
    g0.items.forEach(function (it) { tops[it.segs[0]] = it.segs.length > 1; });
    var only = Object.keys(tops);
    var d0 = only.length === 1 && tops[only[0]] ? cpSrcShootFor(only[0]) : null;
    if (d0 && d0.path === st.target.path) g0.items.forEach(function (it) { it.segs = it.segs.slice(1); });
  }
  var list = order.map(function (k) { return groups[k]; });
  /* что уже лежит в съёмке — чтобы не перезаписать исходники */
  return Promise.all(list.map(function (g) {
    if (g.mode !== 'part') return Promise.resolve([]);
    return CPDisk.walkPhotos(g.target, false, 4, true).catch(function (e) { if (e && e.status === 404) return []; throw e; });
  })).then(function (have) {
    list.forEach(function (g, gi) {
      var exist = {};
      (have[gi] || []).forEach(function (f) { exist[f.path.toLowerCase()] = f.size; });
      g.jobs = []; g.skipped = []; g.renamed = 0;
      var used = {};
      g.items.forEach(function (it) {
        var rel = it.segs.map(CPDisk.safeName).join('/');
        var dest = g.target + '/' + rel, low = dest.toLowerCase();
        if (exist[low] !== undefined && exist[low] === it.x.file.size) { g.skipped.push(rel); return; }
        if (exist[low] !== undefined || used[low]) {
          var dot = dest.lastIndexOf('.'), stem = dot > dest.lastIndexOf('/') ? dest.slice(0, dot) : dest, ext = stem === dest ? '' : dest.slice(dot), n = 2;
          while (exist[(stem + '_' + n + ext).toLowerCase()] !== undefined || used[(stem + '_' + n + ext).toLowerCase()]) n++;
          dest = stem + '_' + n + ext; low = dest.toLowerCase();
          g.renamed++;
        }
        used[low] = true;
        g.jobs.push({ file: it.x.file, dest: dest, kind: cpSrcKind(it.x.file.name) });
      });
      /* сначала кадры, потом прочее, видео — последним */
      var rank = { photo: 0, other: 1, video: 2 };
      g.jobs.sort(function (a, b) { return rank[a.kind] - rank[b.kind] || (a.dest < b.dest ? -1 : 1); });
    });
    st.plan = { groups: list, loose: loose };
  });
}

function cpSrcCount(jobs) {
  var c = { photo: { n: 0, b: 0 }, other: { n: 0, b: 0 }, video: { n: 0, b: 0 } };
  jobs.forEach(function (j) { c[j.kind].n++; c[j.kind].b += j.file.size; });
  return c;
}

function cpSrcRender() {
  var box = document.getElementById('cpSrcUp'), st = CP.srcUp;
  if (!box || !st) return;
  var label = typeof cpSourceLabel === 'function' ? cpSourceLabel() : 'исходники';
  var title = st.target ? 'Догрузить в съёмку · ' + st.target.name : 'Загрузить в ' + label;
  var h = '<div class="cp-files-box"><div class="cp-files-head"><b>' + cbEsc(title) + '</b><button data-cp-su="close" title="Закрыть">×</button></div><div class="cp-acc-body">';
  if (!st.busy && !st.done) {
    h += '<div class="cp-acc-drop">' + (st.target
      ? 'Перетащите сюда папку (например, «видео») или файлы — лягут в эту съёмку. Папка с именем съёмки (или «…_1», «…_2») — по её структуре.'
      : 'Перетащите сюда папку съёмки — как на Диск. Можно несколько. Папка с именем съёмки, которая уже есть, или с «_1», «_2» на конце — это её часть: файлы добавятся в неё по её папкам.')
      + '<br><label class="cp-acc-pick">выбрать папку<input type="file" data-cp-su-pick webkitdirectory multiple hidden></label>'
      + (st.target ? ' · <label class="cp-acc-pick">выбрать файлы<input type="file" data-cp-su-pick multiple hidden></label>' : '') + '</div>';
  }
  h += '<div id="cpSrcPlan">';
  if (st.files.length && !st.plan && !st.planError) h += '<div class="cp-note">Сверяю с тем, что уже лежит на Диске…</div>';
  if (st.planError) h += '<div class="cp-acc-warn">Не получилось прочитать съёмку на Диске: ' + cbEsc(st.planError) + '</div>';
  if (st.plan) {
    var all = 0, bytes = 0;
    st.plan.groups.forEach(function (g) {
      var c = cpSrcCount(g.jobs);
      all += g.jobs.length;
      g.jobs.forEach(function (j) { bytes += j.file.size; });
      h += '<div class="cp-su-group"><div><b>' + cbEsc(g.mode === 'new' ? g.top : g.shoot.name) + '</b> · '
        + (g.mode === 'new' ? '<span class="cp-su-new">новая съёмка</span>' : '<span class="cp-su-part">' + (st.target ? 'догрузка' : 'часть съёмки' + (g.top && g.top.toLowerCase() !== g.shoot.name.toLowerCase() ? ' (из «' + cbEsc(g.top) + '»)' : '')) + ' — добавится в её папки</span>')
        + '</div><div class="cp-su-counts">'
        + (c.photo.n ? 'кадров ' + c.photo.n + ' · ' + cpMb(c.photo.b) : '')
        + (c.other.n ? (c.photo.n ? ' · ' : '') + 'прочих файлов ' + c.other.n + ' · ' + cpMb(c.other.b) : '')
        + (c.video.n ? (c.photo.n || c.other.n ? ' · ' : '') + 'видео ' + c.video.n + ' · ' + cpMb(c.video.b) + ' (после кадров)' : '')
        + (!g.jobs.length ? 'новых файлов нет' : '') + '</div>'
        + (g.skipped.length ? '<div class="cp-note">Уже есть на Диске (тот же файл) — пропущу: ' + g.skipped.length + '</div>' : '')
        + (g.renamed ? '<div class="cp-note">С тем же именем, но другие — лягут рядом с «_2»: ' + g.renamed + '</div>' : '')
        + '<div class="cp-note">' + cbEsc(CPDisk.showPath(g.target)) + '</div></div>';
    });
    if (st.plan.loose.length) h += '<div class="cp-acc-warn">Отдельные файлы без папки съёмки не загрузятся (' + st.plan.loose.length + '): перетащите папку съёмки или нажмите «Догрузить» в панели нужной съёмки.</div>';
    if (st.busy || st.done) h += '<div class="cp-acc-prog" id="cpSrcProg">' + (st.progress || '') + '</div>';
    if (st.done) h += '<div class="cp-acc-done">' + cbEsc(st.done) + '</div>';
    if (!st.busy && !st.done && st.via === 'cloud') {
      h += '<div class="cp-note">Файлы быстро уходят в Облако, а Диск забирает их оттуда сам. Когда здесь будет «всё в Облаке», компьютер можно выключать: на Диск доедет без него.</div>';
    }
    if (st.transit) h += '<div class="cp-acc-prog">' + st.transit + '</div>';
    if (!st.busy && !st.done) {
      h += '<div class="cp-files-foot"><div class="cp-sum">Файлов: ' + all + ' · ' + cpMb(bytes) + '</div><button data-cp-su="reset">Сбросить</button>'
        + '<button class="cb-primary" data-cp-su="go"' + (all ? '' : ' disabled') + '>Загрузить</button></div>';
    }
  }
  h += '</div></div></div>';
  box.innerHTML = h;
}

/* ---------- загрузка ---------- */

function cpSrcUpload() {
  var st = CP.srcUp;
  if (!st || !st.plan || st.busy) return;
  var jobs = [];
  st.plan.groups.forEach(function (g) { g.jobs.forEach(function (j) { j.group = g; jobs.push(j); }); });
  if (!jobs.length) return;
  st.busy = true;
  var total = jobs.reduce(function (a, j) { return a + j.file.size; }, 0), loaded = {}, ok = [], failed = [], now = '';
  var show = function () {
    var sum = 0;
    Object.keys(loaded).forEach(function (k) { sum += loaded[k]; });
    var frac = total ? sum / total : 0;
    var text = 'Загружаю: файлов ' + ok.length + ' из ' + jobs.length + ' · ' + cpMb(sum) + ' из ' + cpMb(total) + ' (' + Math.round(frac * 100) + '%)' + (now ? ' · ' + now : '');
    st.progress = '<div class="cp-acc-bar"><i style="width:' + Math.round(frac * 100) + '%"></i></div><div>' + cbEsc(text) + '</div>';
    cbBusyShow(text, 0.02 + 0.96 * frac);
    var pe = document.getElementById('cpSrcProg');
    if (pe) pe.innerHTML = st.progress;
  };
  cpSrcRender();
  cbBusyShow('Готовлю папки…', 0.01);
  /* папки: от верхних к вложенным, каждая один раз */
  var dirs = {};
  st.plan.groups.forEach(function (g) {
    dirs[g.target] = true;
    g.jobs.forEach(function (j) {
      for (var d = cpParentDir(j.dest); d.length > g.target.length; d = cpParentDir(d)) dirs[d] = true;
    });
  });
  var byDepth = {};
  Object.keys(dirs).forEach(function (d) { var n = d.split('/').length; (byDepth[n] = byDepth[n] || []).push(d); });
  var levels = Object.keys(byDepth).map(Number).sort(function (a, b) { return a - b; });
  var mk = levels.reduce(function (p, n, i) {
    return p.then(function () {
      /* верхняя папка — с родителями (папка исходников может ещё не существовать), остальные — по одной */
      return cpPool(byDepth[n], 4, function (d) { return i === 0 ? CPDisk.ensureDir(d) : CPDisk.mkdir(d); });
    });
  }, Promise.resolve());
  var put = function (j, i) {
    now = j.dest.split('/').pop();
    var tries = 0;
    var once = function () {
      return CPDisk.uploadBlob(j.dest, j.file, false, function (b) { loaded[i] = b; show(); }).catch(function (e) {
        /* сеть оборвалась или Диск ответил 5xx — ещё раз; файл уже есть (409) — значит, загрузился */
        if (e && e.status === 409) return;
        if (tries < 2 && (!e || !e.status || e.status >= 500)) { tries++; loaded[i] = 0; return new Promise(function (r) { setTimeout(r, 1500 * tries); }).then(once); }
        throw e;
      });
    };
    return once().then(function () { loaded[i] = j.file.size; ok.push(j); },
      function (e) { loaded[i] = j.file.size; failed.push(j.dest.split('/').pop() + ': ' + ((e && (e.message || e.status)) || e)); }).then(show);
  };
  var idx = jobs.map(function (j, i) { return i; });
  var notVideo = idx.filter(function (i) { return jobs[i].kind !== 'video'; }), video = idx.filter(function (i) { return jobs[i].kind === 'video'; });
  var direct = function () {
    /* напрямую: 4 потока (проверка скорости: 8 МБ/с против 2 в один поток); кадры, потом видео */
    return cpPool(notVideo, 4, function (i) { return put(jobs[i], i); }).then(function () {
      return cpPool(video, 4, function (i) { return put(jobs[i], i); });
    });
  };
  mk.then(function () {
    show();
    if (st.via === 'cloud' && CPDisk.hasProxy()) {
      return cpSrcViaCloud(st, jobs, loaded, ok, failed, show, function (t) { now = t; }).catch(function (e) {
        /* Облако не взялось (ещё ничего не ушло) — грузим напрямую на Диск */
        if (!e || !e.cloudStart) throw e;
        if (window.console) console.warn('[CP] Облако недоступно, грузим напрямую', e.cause);
        st.via = 'disk';
        return direct();
      });
    }
    return direct();
  }).then(function () {
    cbBusyHide();
    st.busy = false;
    var names = st.plan.groups.map(function (g) { return g.mode === 'new' ? g.top : g.shoot.name; });
    st.done = (st.via === 'cloud' && CPDisk.hasProxy() ? 'Всё в Облаке: файлов ' + ok.length + '. Компьютер можно выключать — Диск забирает файлы сам'
      : 'Загружено файлов: ' + ok.length) + (failed.length ? ', не загрузилось ' + failed.length + ' (' + failed.slice(0, 3).join('; ') + ')' : '') + ' → ' + names.join(', ');
    if (failed.length && window.console) console.error('[CP] не загрузилось', failed);
    cbToast(st.done);
    cpSrcRender();
    /* витрина: новая съёмка появилась; в догруженной — новые файлы */
    if (CP.shoots && typeof cpLoadShoots === 'function') setTimeout(cpLoadShoots, 800);
  }).catch(function (e) {
    cbBusyHide();
    st.busy = false;
    st.done = 'Не получилось: ' + ((e && (e.message || e.body)) || e) + (ok.length ? '. Загружено файлов: ' + ok.length + ' — нажмите «Загрузить» в новом окне ещё раз: уже загруженное пропустится' : '');
    cpSrcRender();
    cpHandleError(e, 'Загрузка в исходники');
  });
}

/* ---------- через Облако ---------- */

CP.cloudStreams = 4;

/** Залить jobs в бакет (4 потока, большие — кусками) и попросить Диск забрать каждый файл. */
function cpSrcViaCloud(st, jobs, loaded, ok, failed, show, setNow) {
  var batches = [];
  for (var b = 0; b < jobs.length; b += 50) batches.push(jobs.slice(b, b + 50));
  var fchain = Promise.resolve(), pend = [], timer = null, items = [];
  var flush = function () {
    clearTimeout(timer); timer = null;
    if (!pend.length) return fchain;
    var batch = pend.splice(0, 50);
    fchain = fchain.then(function () {
      return CPDisk.proxyCloudUp({ op: 'fetch', items: batch.map(function (j) { return { key: j.cloud.key, path: j.dest }; }) }).then(function (r) {
        (r.results || []).forEach(function (x, i) { batch[i].fetch = x; });
      }, function (e) {
        batch.forEach(function (j) { j.fetch = { status: 'failed', error: (e && (e.message || e.body)) || String(e) }; });
      }).then(function () {
        batch.forEach(function (j) {
          items.push({ path: j.dest, key: j.cloud.key, size: j.file.size, op: (j.fetch && j.fetch.href) || '', st: j.fetch && j.fetch.status === 'exists' ? 'done' : j.fetch && j.fetch.status === 'started' ? 'going' : 'retry', tries: 1 });
        });
        st.transitItems = items;
        cpTransitSave(st);
      });
    });
    if (pend.length) return flush();
    return fchain;
  };
  var queueFetch = function (j) {
    pend.push(j);
    if (pend.length >= 20) flush();
    else if (!timer) timer = setTimeout(flush, 1500);
  };
  var finishJob = function (j) {
    var done = j.cloud.uploadId
      ? CPDisk.proxyCloudUp({ op: 'done', key: j.cloud.key, uploadId: j.cloud.uploadId, etags: j.etags })
      : Promise.resolve();
    return done.then(function () { ok.push(j); queueFetch(j); }, function (e) {
      failed.push(j.dest.split('/').pop() + ': ' + ((e && (e.message || e.body)) || e));
    });
  };
  st.transitPath = CP_CONFIG.serviceDir.replace(/\/+$/, '') + '/_в_пути/' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
  return cpPool(batches, 3, function (bt) {
    return CPDisk.proxyCloudUp({ op: 'start', files: bt.map(function (j) { return { size: j.file.size }; }) }).then(function (r) {
      bt.forEach(function (j, i) { j.cloud = r.files[i]; });
    });
  }).catch(function (e) { throw { cloudStart: true, cause: e }; }).then(function () {
    var units = [];
    jobs.forEach(function (j) {
      var c = j.cloud;
      j.etags = [];
      if (c.put) { j.left = 1; units.push({ j: j, url: c.put, start: 0, end: j.file.size, n: 0 }); }
      else {
        j.left = c.parts.length;
        c.parts.forEach(function (u, k) { units.push({ j: j, url: u, start: k * c.partSize, end: Math.min(j.file.size, (k + 1) * c.partSize), n: k }); });
      }
    });
    /* прогресс — по кускам: loaded[«uN»] */
    jobs.forEach(function (j, i) { delete loaded[i]; });
    var putUnit = function (u, ui) {
      var key = 'u' + ui, tries = 0;
      if (u.j.broken) { loaded[key] = u.end - u.start; return Promise.resolve(); }
      setNow(u.j.dest.split('/').pop());
      var once = function () {
        return new Promise(function (res, rej) {
          var x = new XMLHttpRequest();
          x.open('PUT', u.url);
          x.upload.onprogress = function (e) { loaded[key] = e.loaded; show(); };
          x.onload = function () { if (x.status >= 200 && x.status < 300) res(x.getResponseHeader('ETag') || ''); else rej({ status: x.status, message: 'Облако: HTTP ' + x.status }); };
          x.onerror = function () { rej({ status: 0, message: 'сеть' }); };
          x.send(u.j.file.slice(u.start, u.end));
        });
      };
      var go = function () {
        return once().catch(function (e) {
          if (tries++ < 3) { loaded[key] = 0; return new Promise(function (r) { setTimeout(r, 1500 * tries); }).then(go); }
          throw e;
        });
      };
      return go().then(function (etag) {
        u.j.etags[u.n] = etag;
        loaded[key] = u.end - u.start;
        show();
        if (--u.j.left === 0) return finishJob(u.j);
      }, function (e) {
        loaded[key] = u.end - u.start;
        if (!u.j.broken) { u.j.broken = true; failed.push(u.j.dest.split('/').pop() + ': ' + ((e && e.message) || e)); }
      });
    };
    return cpPool(units, CP.cloudStreams, putUnit);
  }).then(flush).then(function () {
    /* всё в Облаке; дальше Диск забирает сам — смотрим, пока окно открыто */
    cpTransitWatch(st);
  });
}

/** Записать, что ещё едет на Диск (служебная папка, _в_пути). */
function cpTransitSave(st) {
  if (!st.transitPath || !st.transitItems) return Promise.resolve();
  var body = JSON.stringify({ ts: new Date().toISOString(), by: cpActor(), items: st.transitItems });
  return CPDisk.ensureDir(cpParentDir(st.transitPath)).then(function () {
    return CPDisk.uploadBlob(st.transitPath, new Blob([body], { type: 'application/json' }), true);
  }).catch(function (e) { if (window.console) console.warn('[CP] не записалось «в пути»', e); });
}

/** Сверить, доехало ли: операции Диска, при ошибке — попросить ещё раз (до 3 раз). Возвращает число ещё едущих. */
function cpTransitCheck(items) {
  var todo = items.filter(function (x) { return x.st !== 'done' && x.st !== 'lost'; }).slice(0, 60);
  var again = [];
  return cpPool(todo, 4, function (x) {
    var viaMeta = function () {
      return CPDisk.meta(x.path).then(function (m) { if (m && m.size === x.size) x.st = 'done'; else if (x.st === 'going' && !x.op) x.st = 'retry'; }, function () { if (!x.op) x.st = 'retry'; });
    };
    if (x.st === 'retry') { again.push(x); return Promise.resolve(); }
    if (!x.op) return viaMeta();
    return CPDisk.opStatus(x.op).then(function (s) {
      if (s === 'success') x.st = 'done';
      else if (s === 'failed') { x.st = 'retry'; again.push(x); }
    }, viaMeta);
  }).then(function () {
    again = again.filter(function (x) { if ((x.tries || 1) >= 3) { x.st = 'lost'; return false; } return true; });
    if (!again.length) return;
    return CPDisk.proxyCloudUp({ op: 'fetch', items: again.map(function (x) { return { key: x.key, path: x.path }; }) }).then(function (r) {
      (r.results || []).forEach(function (res, i) {
        var x = again[i];
        x.tries = (x.tries || 1) + 1;
        if (res.status === 'started') { x.st = 'going'; x.op = res.href || ''; }
        else if (res.status === 'exists') x.st = 'done';
      });
    }, function () { });
  }).then(function () {
    return items.filter(function (x) { return x.st !== 'done' && x.st !== 'lost'; }).length;
  });
}

function cpTransitText(items) {
  var n = items.length, d = items.filter(function (x) { return x.st === 'done'; }).length, lost = items.filter(function (x) { return x.st === 'lost'; });
  return 'Диск забирает файлы из Облака: ' + d + ' из ' + n + (lost.length ? ' · не удалось: ' + lost.length + ' (' + lost.slice(0, 3).map(function (x) { return x.path.split('/').pop(); }).join(', ') + ')' : '')
    + (d + lost.length < n ? ' · компьютер можно выключать — витрина доследит при следующем открытии' : ' · всё на Диске');
}

/** Пока окно загрузки открыто — показывать, как Диск забирает файлы. */
function cpTransitWatch(st) {
  if (!st.transitItems || !st.transitItems.length) return;
  var tick = function () {
    if (CP.srcUp !== st) return;
    cpTransitCheck(st.transitItems).then(function (left) {
      st.transit = cbEsc(cpTransitText(st.transitItems));
      var pe = document.querySelector('#cpSrcUp .cp-acc-prog:last-of-type');
      cpSrcRender();
      if (left) { cpTransitSave(st); setTimeout(tick, CP.transitPollMs); }
      else {
        CPDisk.removeTemp(st.transitPath).catch(function () { });
        if (CP.shoots && typeof cpLoadShoots === 'function') cpLoadShoots();
      }
    });
  };
  setTimeout(tick, 1500);
}
CP.transitPollMs = 4000;

/* витрина: что ещё едет на Диск (после выключенного компьютера) — сверить при открытии и раз в минуту */
CP.transit = {};
var _cpTransitBusy = false;
function cpTransitScan() {
  if (_cpTransitBusy || !CPDisk.hasProxy() || !CP_CONFIG.serviceDir) return Promise.resolve();
  _cpTransitBusy = true;
  var dir = CP_CONFIG.serviceDir.replace(/\/+$/, '') + '/_в_пути';
  var mine = CP.srcUp && CP.srcUp.transitPath;
  return CPDisk.listDir(dir).then(function (list) {
    var files = list.filter(function (x) { return x.type !== 'dir' && /\.json$/.test(x.name) && x.path !== mine; });
    var map = {};
    return cpPool(files, 2, function (f) {
      return CPDisk.proxyFile(f.path).then(function (b) { return b.text(); }).then(function (t) {
        var m = JSON.parse(t), items = m.items || [];
        return cpTransitCheck(items).then(function (left) {
          items.forEach(function (x) {
            var sh = (CP.shoots || []).filter(function (d) { return x.path.indexOf(d.path.replace(/\/+$/, '') + '/') === 0; })[0];
            if (!sh) return;
            var e = map[sh.path] = map[sh.path] || { n: 0, done: 0 };
            e.n++;
            if (x.st === 'done') e.done++;
          });
          if (!left) return CPDisk.removeTemp(f.path);
          m.items = items;
          return CPDisk.uploadBlob(f.path, new Blob([JSON.stringify(m)], { type: 'application/json' }), true);
        });
      }).catch(function (e) { if (window.console) console.warn('[CP] «в пути» не прочиталось', f.path, e); });
    }).then(function () {
      CP.transit = map;
      if (CP.shoots) cpRenderShoots();
      return Object.keys(map).some(function (k) { return map[k].done < map[k].n; });
    });
  }, function () { CP.transit = {}; return false; }).then(function (more) {
    _cpTransitBusy = false;
    if (more) setTimeout(cpTransitScan, 60000);
  });
}
if (typeof cpLoadShoots === 'function') {
  cpLoadShoots = (function (orig) {
    return function () {
      var r = orig.apply(this, arguments);
      Promise.resolve(r).then(function () { setTimeout(cpTransitScan, 1500); });
      return r;
    };
  })(cpLoadShoots);
}

/* ---------- витрина: полоска «Загрузить съёмку» во вкладке исходников ---------- */

cpRenderShoots = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    var list = document.getElementById('cpShelfList');
    /* «едет на Диск: N из M» — файлы, которые Диск ещё забирает из Облака */
    if (list) Object.keys(CP.transit || {}).forEach(function (p) {
      var t = CP.transit[p], row = list.querySelector('.cp-shoot[data-path="' + (window.CSS && CSS.escape ? CSS.escape(p) : p) + '"]');
      if (!row || t.done >= t.n || row.querySelector('.cp-transit')) return;
      row.insertAdjacentHTML('beforeend', '<div class="cp-transit">едет на Диск: ' + t.done + ' из ' + t.n + '</div>');
    });
    if (!list || CP.stageFilter || !CP.shoots || document.getElementById('cpSrcDrop')) return r;
    list.insertAdjacentHTML('afterbegin', '<div class="cp-src-drop" id="cpSrcDrop"><b>Загрузить съёмку</b> — перетащите папку сюда или '
      + '<a href="#" data-cp-src-open="1">выберите</a>. Папка с именем съёмки, которая уже есть (или «…_1», «…_2»), — догрузится в неё.</div>');
    return r;
  };
})(cpRenderShoots);

(function () {
  var list = document.getElementById('cpShelfList');
  list.addEventListener('click', function (e) {
    if (!e.target.closest('[data-cp-src-open]')) return;
    e.preventDefault(); e.stopPropagation();
    cpSrcOpen(null);
  }, true);
  list.addEventListener('dragover', function (e) {
    var z = e.target.closest && e.target.closest('#cpSrcDrop');
    if (!z) return;
    e.preventDefault(); e.stopPropagation();
    z.classList.add('cp-over');
    document.body.classList.add('cp-rv-dragging');
  }, true);
  list.addEventListener('dragleave', function (e) {
    var z = e.target.closest && e.target.closest('#cpSrcDrop');
    if (z && !z.contains(e.relatedTarget)) { z.classList.remove('cp-over'); document.body.classList.remove('cp-rv-dragging'); }
  }, true);
  list.addEventListener('drop', function (e) {
    var z = e.target.closest && e.target.closest('#cpSrcDrop');
    if (!z) return;
    e.preventDefault(); e.stopPropagation();
    z.classList.remove('cp-over');
    document.body.classList.remove('cp-rv-dragging');
    if (typeof dragDepth !== 'undefined') dragDepth = 0;
    document.body.classList.remove('cb-file-drag');
    cpDropFiles(e.dataTransfer).then(function (files) { cpSrcOpen(null); cpSrcAdd(files); });
  }, true);
})();

/* панель съёмки в исходниках — «Догрузить» */
cpRenderPanel = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    var sel = CP.sel, acts = document.querySelector('#cpPanel .cp-panel-actions');
    if (!sel || sel.stage || sel.siteDate || CP.stageFilter || !acts || acts.querySelector('[data-cp-srcup]')) return r;
    var open = acts.querySelector('[data-cp-p="open"]');
    var b = '<button data-cp-srcup="1" title="Добавить в эту съёмку папку (например, «видео») или файлы">Догрузить</button>';
    if (open) open.insertAdjacentHTML('afterend', b); else acts.insertAdjacentHTML('beforeend', b);
    return r;
  };
})(cpRenderPanel);

document.getElementById('cpPanel').addEventListener('click', function (e) {
  if (!e.target.closest('[data-cp-srcup]') || !CP.sel) return;
  e.preventDefault();
  cpSrcOpen({ path: CP.sel.path, name: CP.sel.name });
});

(function cpSrcCss() {
  var st = document.createElement('style');
  st.textContent = '.cp-src-drop{grid-column:1/-1;border:1px dashed #3a3a37;border-radius:6px;padding:10px 14px;color:#a3a09a;font-size:12px;line-height:1.6}'
    + '.cp-src-drop b{color:#cfcac2;font-weight:600}.cp-src-drop a{color:#C9956B}'
    + '.cp-src-drop.cp-over{border-color:#C9956B;color:#e7c9a8;background:#1d1a17}'
    + '.cp-su-group{border:1px solid #2f2f2c;border-radius:4px;padding:8px 10px;margin:6px 0;font-size:13px;display:flex;flex-direction:column;gap:4px}'
    + '.cp-su-new{color:#9fc2a3}.cp-su-part{color:#e7c9a8}.cp-su-counts{color:#cfcac2;font-size:12px}'
    + '.cp-transit{margin-top:6px;font-size:12px;color:#e7c9a8}';
  document.head.appendChild(st);
})();
