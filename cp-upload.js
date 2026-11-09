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
   ============================================================ */

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
      if (act === 'close') { if (CP.srcUp.busy) return; box.classList.remove('cp-open'); CP.srcUp = null; }
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
  CP.srcUp = { target: target || null, files: [], plan: null, busy: false };
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
  mk.then(function () {
    show();
    return cpPool(notVideo, 3, function (i) { return put(jobs[i], i); });
  }).then(function () {
    return cpPool(video, 1, function (i) { return put(jobs[i], i); });
  }).then(function () {
    cbBusyHide();
    st.busy = false;
    var names = st.plan.groups.map(function (g) { return g.mode === 'new' ? g.top : g.shoot.name; });
    st.done = 'Загружено файлов: ' + ok.length + (failed.length ? ', не загрузилось ' + failed.length + ' (' + failed.slice(0, 3).join('; ') + ')' : '') + ' → ' + names.join(', ');
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

/* ---------- витрина: полоска «Загрузить съёмку» во вкладке исходников ---------- */

cpRenderShoots = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    var list = document.getElementById('cpShelfList');
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
    + '.cp-su-new{color:#9fc2a3}.cp-su-part{color:#e7c9a8}.cp-su-counts{color:#cfcac2;font-size:12px}';
  document.head.appendChild(st);
})();
