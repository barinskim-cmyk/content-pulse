/* ============================================================
   cp-accept.js — приём ретуши (Маша, 06.11.2026)

   «Тыкаешь на съёмку, тыкаешь кнопку «Сдать» и перетаскиваешь туда папку,
   которую скачал и отретушировал… После этого нужно согласование старшего
   ретушёра: всё согласованное копируется в папку «Сайт» на сдачу, а всё,
   что нет, ждёт повторной загрузки. Таскать любой кусок — картинками
   отдельными или полной папкой… Галочка «Ретушь готова» показывает только
   карточки, для которых загружена версия ретуши, и кнопка «Согласовать
   ретушь» появляется только после того, как ретушь загружена».

   1. «Сдать» (панель съёмки на витрине и список карточек в съёмке):
      перетащить папку / папки карточек / картинки. Карточка находится по
      имени папки (имя карточки или код артикула), отдельная картинка — по
      имени исходника (без «01_» и расширения). Файлы ложатся на приёмку:
         <съёмка>/_приёмка/<дата>_<буква>_<номер>/<папка карточки>/<файл>
      Буква и номер — из имени скачанного архива («…_Y_1»), иначе выбрать.
      У карточки появляется версия ретуши (1, 2, …) «на проверке».
   2. В съёмке: галочка «Ретушь готова» — только карточки с загруженной
      ретушью; на карточке — картинки версии и «Согласовать ретушь» /
      «На доработку».
   3. Согласовано — файлы версии копируются в
         <Сайт>/<дата>/<буква>_<номер>/<съёмка>/<папка карточки>/
      карточка — «загружено». На доработку — ждёт следующей версии.

   Отбор хранит версии в meta.cp.rv: {id карточки: [{v, batch, letter, n,
   date, by, ts, files:[{path,name,size}], status: review|approved|rework,
   rby, rts, note, site}]}.
   ============================================================ */

var CP_ACCEPT_DIR = '_приёмка';
var CP_JUNK_FILE = /^(\.DS_Store|\._.*|Thumbs\.db|desktop\.ini)$/i;
CP.rvOnly = false;

function cpRv(meta) { return (meta || cpMeta()).rv || ((meta || cpMeta()).rv = {}); }
function cpLastRv(list) { return list && list.length ? list[list.length - 1] : null; }

function cpToday() {
  var d = new Date(), z = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
}

/* ---------- файлы из перетаскивания или выбора ---------- */

function cpEntryFiles(entry, prefix) {
  return new Promise(function (resolve) {
    if (entry.isFile) {
      entry.file(function (f) { resolve([{ file: f, rel: prefix + f.name }]); }, function () { resolve([]); });
      return;
    }
    if (!entry.isDirectory) { resolve([]); return; }
    var reader = entry.createReader(), all = [];
    (function readMore() {
      reader.readEntries(function (batch) {
        if (!batch.length) {
          Promise.all(all.map(function (e) { return cpEntryFiles(e, prefix + entry.name + '/'); }))
            .then(function (lists) { resolve([].concat.apply([], lists)); });
          return;
        }
        all = all.concat(Array.prototype.slice.call(batch));
        readMore();
      }, function () { resolve([]); });
    })();
  });
}

function cpDropFiles(dt) {
  var items = dt.items ? Array.prototype.slice.call(dt.items) : [];
  var entries = items.map(function (it) { return it.webkitGetAsEntry ? it.webkitGetAsEntry() : null; }).filter(Boolean);
  if (entries.length) {
    return Promise.all(entries.map(function (e) { return cpEntryFiles(e, ''); })).then(function (l) { return [].concat.apply([], l); });
  }
  return Promise.resolve(Array.prototype.slice.call(dt.files || []).map(function (f) { return { file: f, rel: f.name }; }));
}

/* ---------- разбор: какая карточка, буква, номер ---------- */

function cpStem(name) {
  return String(name).replace(/\.[^.]+$/, '').replace(/^\d{1,3}_/, '').toLowerCase();
}

/**
 * files: [{file, rel}], data: отбор съёмки. ->
 * {letter, n, groups: {cardId: [{file, name}]}, unmatched: [rel], top}
 */
function cpPlanUpload(files, data) {
  files = files.filter(function (x) { return !CP_JUNK_FILE.test(x.file.name); });
  var segs = files.map(function (x) { return x.rel.split('/'); });
  var tops = {};
  segs.forEach(function (s) { tops[s[0]] = true; });
  var top = '';
  /* одна общая папка, внутри — папки карточек: это скачанный архив */
  if (Object.keys(tops).length === 1 && segs.every(function (s) { return s.length >= 3; })) {
    top = segs[0][0];
    segs = segs.map(function (s) { return s.slice(1); });
  }
  var lm = /_([A-Za-zА-Яа-яЁё]{1,3})_(\d+)$/.exec(top) || [];
  var cards = data.cards || [];
  var photosById = {};
  (data.photos || []).forEach(function (p) { photosById[p.id] = p; });
  var byFolder = {}, byStem = {};
  cards.forEach(function (c, i) {
    var f = cpCardExportFolder(c, i).toLowerCase();
    byFolder[f] = c;
    var pids = c.mode === 'auto' ? (c.pids || []) : (c.slots || []).map(function (s) { return s.pid; }).filter(Boolean);
    pids.forEach(function (pid) {
      var p = photosById[pid];
      if (p && !byStem[cpStem(p.name)]) byStem[cpStem(p.name)] = c;
    });
  });
  var cardOfFolder = function (name) {
    var n = name.toLowerCase();
    if (byFolder[n]) return byFolder[n];
    var code = (/(?:^|[^\d])(\d{4,7})(?!\d)/.exec(name) || [])[1];
    return code ? cards.filter(function (c) { return c.cpArticle === code || String(c.title || '').indexOf(code) !== -1; })[0] : null;
  };
  var groups = {}, unmatched = [];
  files.forEach(function (x, i) {
    var s = segs[i];
    /* карточка — по самой глубокой папке, которая на неё похожа (лук/артикул/файл тоже подходит), иначе по имени кадра */
    var card = null;
    for (var k = s.length - 2; k >= 0 && !card; k--) card = cardOfFolder(s[k]);
    card = card || byStem[cpStem(x.file.name)] || null;
    if (!card) { unmatched.push(s.join('/')); return; }
    (groups[card.id] = groups[card.id] || []).push({ file: x.file, name: x.file.name });
  });
  return { letter: lm[1] || '', n: lm[2] || '', groups: groups, unmatched: unmatched, top: top };
}

/* ---------- окно «Сдать ретушь» ---------- */

function cpAcceptOpen(shootPath, shootName) {
  var box = document.getElementById('cpAccept');
  if (!box) {
    box = document.createElement('div');
    box.id = 'cpAccept';
    box.className = 'cp-files';
    document.body.appendChild(box);
  }
  var st = { path: shootPath, name: shootName, data: null, plan: null, files: [] };
  CP.accept = st;
  box.innerHTML = '<div class="cp-files-box"><div class="cp-files-head"><b>Сдать ретушь · ' + cbEsc(shootName) + '</b>'
    + '<button data-cp-acc="close" title="Закрыть">×</button></div>'
    + '<div class="cp-acc-body"><div class="cp-acc-drop" id="cpAccDrop">Перетащите сюда папку, которую скачали и отретушировали, папки карточек или отдельные картинки'
    + '<br><label class="cp-acc-pick">выбрать папку<input type="file" id="cpAccDir" webkitdirectory multiple hidden></label> · '
    + '<label class="cp-acc-pick">выбрать файлы<input type="file" id="cpAccFiles" multiple hidden></label></div>'
    + '<div id="cpAccPlan"></div></div></div>';
  box.classList.add('cp-open');
  /* отбор нужен для поиска карточек: открытая съёмка — из памяти, иначе с Диска */
  var ready = (CP.shoot && CP.shoot.path === shootPath)
    ? Promise.resolve(cbProjectData())
    : CPDisk.readState(shootPath).then(function (r) { return r.data || cpBlankProject(shootName); });
  ready.then(function (data) { st.data = data; if (st.files.length) cpAcceptPlan(); }, function (e) { cpHandleError(e, 'Не удалось прочитать отбор съёмки'); });
  var drop = document.getElementById('cpAccDrop');
  drop.addEventListener('dragover', function (e) { e.preventDefault(); drop.classList.add('cp-over'); });
  drop.addEventListener('dragleave', function () { drop.classList.remove('cp-over'); });
  drop.addEventListener('drop', function (e) {
    e.preventDefault();
    drop.classList.remove('cp-over');
    cpDropFiles(e.dataTransfer).then(function (files) { cpAcceptAdd(files); });
  });
  var pick = function (inp) {
    inp.onchange = function () {
      cpAcceptAdd(Array.prototype.slice.call(inp.files).map(function (f) { return { file: f, rel: f.webkitRelativePath || f.name }; }));
      inp.value = '';
    };
  };
  pick(document.getElementById('cpAccDir'));
  pick(document.getElementById('cpAccFiles'));
}

function cpAcceptAdd(files) {
  var st = CP.accept;
  if (!st || !files.length) return;
  st.files = st.files.concat(files);
  if (st.data) cpAcceptPlan();
}

function cpAcceptPlan() {
  var st = CP.accept;
  var plan = st.plan = cpPlanUpload(st.files, st.data);
  var meta = ((st.data.meta || {}).cp) || {};
  var rv = meta.rv || {};
  var letters = typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
  if (!st.letter) st.letter = plan.letter;
  if (!st.n) st.n = plan.n;
  if (!st.n && st.letter) {
    /* номер сдачи этого ретушёра в съёмке — следующий */
    var max = 0;
    Object.keys(rv).forEach(function (cid) { (rv[cid] || []).forEach(function (v) { if (v.letter === st.letter) max = Math.max(max, +v.n || 0); }); });
    st.n = String(max + 1);
  }
  var cards = st.data.cards || [];
  var ids = Object.keys(plan.groups);
  var bytes = 0, count = 0;
  ids.forEach(function (id) { plan.groups[id].forEach(function (f) { bytes += f.file.size; count++; }); });
  var html = '<div class="cp-acc-row">Ретушёр: ' + (letters.length ? letters.map(function (t) {
    return '<button data-cp-acc-l="' + cbEsc(t) + '"' + (st.letter === t ? ' class="cp-on"' : '') + '>' + cbEsc(t) + '</button>';
  }).join('') : '<input id="cpAccLetter" value="' + cbEsc(st.letter) + '" placeholder="буква" style="width:60px">')
    + ' · номер сдачи <input id="cpAccN" value="' + cbEsc(st.n) + '" style="width:50px">'
    + (plan.top ? ' <small>из «' + cbEsc(plan.top) + '»</small>' : '') + '</div>';
  html += '<div class="cp-acc-list">' + ids.map(function (id) {
    var c = cards.filter(function (x) { return x.id === id; })[0];
    var last = cpLastRv(rv[id]);
    return '<div><b>' + cbEsc(c ? c.title || 'карточка' : id) + '</b> · файлов ' + plan.groups[id].length
      + (last ? ' <small>сейчас версия ' + last.v + ' · ' + (last.status === 'approved' ? 'согласована' : last.status === 'rework' ? 'на доработке' : 'на проверке') + '</small>' : '') + '</div>';
  }).join('') + '</div>';
  if (plan.unmatched.length) {
    html += '<div class="cp-acc-warn">Не нашлась карточка (' + plan.unmatched.length + '), эти файлы не загрузятся: '
      + plan.unmatched.slice(0, 12).map(cbEsc).join(', ') + (plan.unmatched.length > 12 ? '…' : '') + '</div>';
  }
  html += '<div class="cp-files-foot"><div class="cp-sum">Карточек: ' + ids.length + ' · файлов: ' + count + ' · ' + (bytes / 1048576).toFixed(1) + ' МБ</div>'
    + '<button data-cp-acc="reset">Сбросить</button>'
    + '<button class="cb-primary" data-cp-acc="go"' + (count ? '' : ' disabled') + '>Загрузить на приёмку</button></div>';
  document.getElementById('cpAccPlan').innerHTML = html;
}

document.addEventListener('click', function (e) {
  var b = e.target.closest('[data-cp-acc],[data-cp-acc-l]');
  if (!b || !CP.accept) return;
  if (b.hasAttribute('data-cp-acc-l')) { CP.accept.letter = b.getAttribute('data-cp-acc-l'); CP.accept.n = ''; cpAcceptPlan(); return; }
  var act = b.getAttribute('data-cp-acc');
  if (act === 'close') { document.getElementById('cpAccept').classList.remove('cp-open'); CP.accept = null; }
  else if (act === 'reset') { CP.accept.files = []; CP.accept.letter = ''; CP.accept.n = ''; document.getElementById('cpAccPlan').innerHTML = ''; }
  else if (act === 'go') cpAcceptUpload();
});

function cpAcceptUpload() {
  var st = CP.accept, plan = st.plan;
  var li = document.getElementById('cpAccLetter'), ni = document.getElementById('cpAccN');
  if (li) st.letter = li.value.trim();
  if (ni) st.n = ni.value.trim();
  if (!st.letter) { cbToast('Выберите букву ретушёра'); return; }
  if (!st.n) st.n = '1';
  var batch = cpToday() + '_' + st.letter + '_' + st.n;
  var base = st.path.replace(/\/+$/, '') + '/' + CP_ACCEPT_DIR + '/' + CPDisk.safeName(batch);
  var cards = st.data.cards || [];
  var jobs = [], dirs = {};
  Object.keys(plan.groups).forEach(function (id) {
    var idx = -1;
    cards.forEach(function (c, i) { if (c.id === id) idx = i; });
    var folder = CPDisk.safeName(cpCardExportFolder(cards[idx], idx));
    var used = {};
    plan.groups[id].forEach(function (f) {
      var name = CPDisk.safeName(f.name), k = 2;
      while (used[name]) name = name.replace(/(\.[^.]+)?$/, '_' + (k++) + '$1');
      used[name] = true;
      dirs[base + '/' + folder] = true;
      jobs.push({ card: id, file: f.file, path: base + '/' + folder + '/' + name, name: name });
    });
  });
  var total = jobs.reduce(function (a, j) { return a + j.file.size; }, 0), done = 0, ok = [], failed = [];
  cbBusyShow('Загружаю на приёмку: 0 из ' + jobs.length + '...', 0.02);
  var dirList = Object.keys(dirs);
  dirList.reduce(function (p, d) { return p.then(function () { return CPDisk.ensureDir(d); }); }, Promise.resolve()).then(function () {
    return cpPool(jobs, 3, function (j) {
      return CPDisk.uploadBlob(j.path, j.file, true).then(function () { ok.push(j); }, function (e) { failed.push(j.name + ': ' + (e && (e.message || e.status))); })
        .then(function () {
          done += j.file.size;
          cbBusyShow('Загружаю на приёмку: ' + (ok.length + failed.length) + ' из ' + jobs.length + ' · ' + (done / 1048576).toFixed(0) + ' из ' + (total / 1048576).toFixed(0) + ' МБ', 0.02 + 0.95 * (total ? done / total : 1));
        });
    });
  }).then(function () {
    cbBusyHide();
    if (!ok.length) throw { message: 'ничего не загрузилось: ' + failed.slice(0, 3).join('; '), plain: true };
    /* версии карточек: по одной на каждую карточку из этой сдачи */
    var byCard = {};
    ok.forEach(function (j) { (byCard[j.card] = byCard[j.card] || []).push({ path: j.path, name: j.name, size: j.file.size }); });
    var who = cpActor(), now = new Date().toISOString();
    var apply = function (data) {
      var m = data.meta.cp, rv = m.rv = m.rv || {};
      Object.keys(byCard).forEach(function (id) {
        var list = rv[id] = rv[id] || [];
        list.push({ v: list.length + 1, batch: batch, letter: st.letter, n: st.n, date: cpToday(), by: who, ts: now, files: byCard[id], status: 'review' });
      });
      (m.events = m.events || []).push({ ts: now, actor: who, action: 'rt_upload', items: ok.map(function (j) { return j.name; }),
        note: 'сдача ' + batch + ': карточек ' + Object.keys(byCard).length + ', файлов ' + ok.length + (failed.length ? ', не загрузилось ' + failed.length : '') });
    };
    if (CP.shoot && CP.shoot.path === st.path) {
      apply({ meta: { cp: cpMeta() } });
      cbMarkDirty();
      cbRenderCards();
      cbRenderOutline();
      return;
    }
    return cpMutateState({ path: st.path, name: st.name }, apply);
  }).then(function () {
    var msg = 'Загружено на приёмку: ' + ok.length + ' файл(ов)' + (failed.length ? ', не загрузилось ' + failed.length : '') + ' — сдача ' + batch;
    cbToast(msg);
    if (failed.length && window.console) console.error('[CP] не загрузилось на приёмку', failed);
    document.getElementById('cpAccPlan').innerHTML = '<div class="cp-acc-done">' + cbEsc(msg) + '. Старший ретушёр увидит её в съёмке по галочке «Ретушь готова».</div>';
    CP.accept.files = [];
  }).catch(function (e) {
    cbBusyHide();
    if (e && e.plain) { cbToast('Сдать ретушь: ' + e.message); return; }
    cpHandleError(e, 'Загрузка на приёмку');
  });
}

/* кнопка «Сдать» на панели съёмки (витрина) */
cpRenderPanel = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    var panel = document.getElementById('cpPanel'), sel = CP.sel;
    var act = panel && panel.querySelector('.cp-panel-actions');
    if (act && sel && !sel.loading && !act.querySelector('[data-cp-accept]')) {
      act.insertAdjacentHTML('afterbegin', '<button data-cp-accept title="Загрузить отретушированное на приёмку">Сдать</button>');
    }
    return r;
  };
})(cpRenderPanel);

document.getElementById('cpPanel').addEventListener('click', function (e) {
  if (!e.target.closest('[data-cp-accept]') || !CP.sel) return;
  e.preventDefault();
  cpAcceptOpen(CP.sel.path, CP.sel.name);
});

/* ---------- в съёмке: «Ретушь готова», версии на карточке, согласование ---------- */

cbRenderCards = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    if (!CP.shoot) return r;
    var root = document.getElementById('cbCards');
    var rv = cpRv();
    /* галочка «Ретушь готова» над карточками (рядом со списком, не внутри него) */
    var bar = document.getElementById('cpRvBar');
    if (!bar && root) {
      bar = document.createElement('div');
      bar.id = 'cpRvBar';
      bar.className = 'cp-rvbarw';
      root.parentNode.insertBefore(bar, root);
      bar.addEventListener('change', function (e) {
        if (e.target.id !== 'cpRvOnly') return;
        CP.rvOnly = e.target.checked;
        cbRenderCards();
      });
      bar.addEventListener('click', function (e) {
        if (!e.target.closest('[data-cp-o="accept"]') || !CP.shoot) return;
        e.preventDefault();
        cpAcceptOpen(CP.shoot.path, CP.shoot.name);
      });
    }
    if (bar) {
      var nRv = Object.keys(rv).filter(function (k) { return (rv[k] || []).length; }).length;
      bar.innerHTML = '<label class="cp-rvbar"><input type="checkbox" id="cpRvOnly"' + (CP.rvOnly ? ' checked' : '')
        + '> Ретушь готова — только карточки с загруженной ретушью <small>(' + nRv + ')</small></label>'
        + '<button class="cp-rvup" data-cp-o="accept">Сдать ретушь</button>';
    }
    Array.prototype.forEach.call(root.querySelectorAll('.cb-card'), function (el) {
      var id = el.getAttribute('data-cid');
      var list = rv[id];
      /* «Ретушь готова» — то, что ждёт проверки или доработки; принятое на сайт уже не показываем */
      var lastS = list && list.length ? list[list.length - 1].status : '';
      if (CP.rvOnly && lastS !== 'review' && lastS !== 'rework') el.style.display = 'none';
      var last = cpLastRv(list);
      if (!last || el.querySelector('.cp-rv')) return;
      var head = el.querySelector('.cb-card-head');
      var state = last.status === 'approved' ? '<span class="cp-rv-ok">согласовано · ' + cbEsc(last.rby || '') + '</span>'
        : last.status === 'rework' ? '<span class="cp-rv-bad">на доработке' + (last.note ? ': ' + cbEsc(last.note) : '') + ' — ждёт новой версии</span>'
          : '<span class="cp-rv-wait">на проверке</span>';
      var html = '<div class="cp-rv" data-cp-rv="' + id + '"><div class="cp-rv-head"><b>Ретушь v' + last.v + '</b> · ' + cbEsc(last.letter + '_' + last.n)
        + ' · ' + cbEsc(cpFmtDate(last.ts)) + ' · файлов ' + last.files.length + ' · ' + state + '<span class="cp-sp"></span>'
        + (last.status === 'review' ? '<button class="cb-primary" data-cp-rva="approve">Согласовать ретушь</button><button data-cp-rva="rework">На доработку</button>' : '')
        + '</div><div class="cp-rv-thumbs">' + last.files.map(function (f, i) {
          return '<button class="cp-rv-t" data-cp-rvt="' + i + '" title="' + cbEsc(f.name) + '"><img data-cp-rvsrc="' + cbEsc(f.path) + '" alt=""></button>';
        }).join('') + '</div></div>';
      if (head) head.insertAdjacentHTML('afterend', html);
    });
    cpRvLoadThumbs();
    return r;
  };
})(cbRenderCards);

CP.rvThumb = {};   /* путь -> objectURL превью */
function cpRvLoadThumbs() {
  var imgs = Array.prototype.slice.call(document.querySelectorAll('img[data-cp-rvsrc]'));
  var need = [];
  imgs.forEach(function (img) {
    var p = img.getAttribute('data-cp-rvsrc');
    if (CP.rvThumb[p] && CP.rvThumb[p] !== 'wait') img.src = CP.rvThumb[p];
    else if (!CP.rvThumb[p] && need.indexOf(p) === -1) need.push(p);
  });
  if (!need.length || !CPDisk.hasProxy()) return;
  need.forEach(function (p) { CP.rvThumb[p] = 'wait'; });
  CPDisk.proxyPreviews(need, 'M').then(function (res) {
    (res.items || res || []).forEach(function (it) {
      if (!it || !it.path) return;
      if (it.data) CP.rvThumb[it.path] = 'data:' + (it.type || 'image/jpeg') + ';base64,' + it.data;
      else delete CP.rvThumb[it.path];
    });
    Array.prototype.forEach.call(document.querySelectorAll('img[data-cp-rvsrc]'), function (img) {
      var u = CP.rvThumb[img.getAttribute('data-cp-rvsrc')];
      if (u && u !== 'wait') img.src = u;
    });
  }, function () { need.forEach(function (p) { delete CP.rvThumb[p]; }); });
}

document.getElementById('cbCards').addEventListener('click', function (e) {
  var t = e.target.closest('[data-cp-rvt]');
  if (t) {
    e.preventDefault(); e.stopPropagation();
    var box = t.closest('[data-cp-rv]');
    var last = cpLastRv(cpRv()[box.getAttribute('data-cp-rv')]);
    cpRvView(last, +t.getAttribute('data-cp-rvt'));
    return;
  }
  var a = e.target.closest('[data-cp-rva]');
  if (!a) return;
  e.preventDefault(); e.stopPropagation();
  var id = a.closest('[data-cp-rv]').getAttribute('data-cp-rv');
  if (a.getAttribute('data-cp-rva') === 'approve') cpRvApprove([id]);
  else cpRvRework(id);
}, true);

/** Согласовать ретушь: копии в «Сайт», карточка — «загружено». */
function cpRvApprove(ids) {
  var site = typeof cpSiteRoot === 'function' ? cpSiteRoot() : '';
  if (!site) { cbToast('Не задана папка «Сайт»: шестерёнка на витрине → «Папка сдачи (сайт)»'); return; }
  var rv = cpRv(), shoot = CP.shoot;
  var items = [], dirs = {}, todo = [];
  ids.forEach(function (id) {
    var last = cpLastRv(rv[id]);
    if (!last || last.status !== 'review') return;
    var card = cbCardById(id), idx = App.cards.indexOf(card);
    var dir = site.replace(/\/+$/, '') + '/' + cpToday() + '/' + CPDisk.safeName(last.letter + '_' + last.n) + '/' + CPDisk.safeName(shoot.name)
      + '/' + CPDisk.safeName(cpCardExportFolder(card || { title: id }, idx < 0 ? 0 : idx));
    dirs[dir] = true;
    last.files.forEach(function (f) { items.push({ from: f.path, path: dir + '/' + f.name }); });
    todo.push({ id: id, last: last, dir: dir });
  });
  if (!todo.length) return;
  cbBusyShow('Согласовано — копирую в «Сайт»...', 0.3);
  CPDisk.proxyCopy(items, Object.keys(dirs)).then(function (r) {
    cbBusyHide();
    var res = (r && r.results) || [], bad = res.filter(function (x) { return x.status !== 'done' && x.status !== 'exists'; });
    if (bad.length) throw { message: 'в «Сайт» не скопировалось ' + bad.length + ': ' + (bad[0].error || ''), plain: true };
    var m = cpMeta(), who = cpActor(), now = new Date().toISOString();
    m.delivered = m.delivered || {};
    todo.forEach(function (t) {
      t.last.status = 'approved'; t.last.rby = who; t.last.rts = now; t.last.site = CPDisk.showPath(t.dir);
      m.delivered[t.id] = { files: t.last.files.length, letter: t.last.letter, date: cpToday(), at: CPDisk.showPath(t.dir), out: t.last.letter + '_' + t.last.n, ts: now };
    });
    cpEvent('rt_approve', [], { card: todo.map(function (t) { var c = cbCardById(t.id); return c ? c.title : t.id; }).join(', '), note: 'в «Сайт»: ' + CPDisk.showPath(todo[0].dir) });
    cbRenderCards();
    cbRenderOutline();
    cbToast('Ретушь согласована, файлы в «Сайте»: карточек ' + todo.length);
    if (typeof cpRetouchCleanupSoon === 'function') cpRetouchCleanupSoon();
  }).catch(function (e) {
    cbBusyHide();
    if (e && e.plain) { cbToast('Согласование: ' + e.message); return; }
    cpHandleError(e, 'Согласование ретуши');
  });
}

function cpRvRework(id) {
  var last = cpLastRv(cpRv()[id]);
  if (!last) return;
  var note = prompt('Что доработать? (увидит ретушёр)', '');
  if (note === null) return;
  last.status = 'rework'; last.rby = cpActor(); last.rts = new Date().toISOString(); last.note = note.trim();
  var c = cbCardById(id);
  cpEvent('rt_rework', [], { card: c ? c.title : id, note: last.note || '' });
  cbRenderCards();
  cbRenderOutline();
}

/* просмотр версии ретуши крупно: стрелки, Esc */
function cpRvView(ver, i) {
  if (!ver) return;
  var box = document.getElementById('cpRvLb');
  if (!box) {
    box = document.createElement('div');
    box.id = 'cpRvLb';
    box.className = 'cp-lb';
    box.innerHTML = '<div class="cp-lb-head"><b id="cpRvLbName"></b><span class="cp-sp"></span><small id="cpRvLbN"></small><button data-cp-rvl="close">Закрыть</button></div>'
      + '<div class="cp-lb-stage"><img id="cpRvLbImg" alt=""></div>';
    document.body.appendChild(box);
    box.addEventListener('click', function (e) { if (e.target.closest('[data-cp-rvl="close"]')) box.classList.remove('cp-open'); });
    document.addEventListener('keydown', function (e) {
      if (!box.classList.contains('cp-open') || !CP.rvLb) return;
      if (e.key === 'Escape') box.classList.remove('cp-open');
      if (e.key === 'ArrowRight') show(CP.rvLb.i + 1);
      if (e.key === 'ArrowLeft') show(CP.rvLb.i - 1);
    });
  }
  function show(k) {
    var v = CP.rvLb.ver, n = v.files.length;
    CP.rvLb.i = (k + n) % n;
    var f = v.files[CP.rvLb.i];
    document.getElementById('cpRvLbName').textContent = f.name;
    document.getElementById('cpRvLbN').textContent = (CP.rvLb.i + 1) + ' из ' + n;
    var img = document.getElementById('cpRvLbImg');
    img.src = CP.rvThumb[f.path] && CP.rvThumb[f.path] !== 'wait' ? CP.rvThumb[f.path] : '';
    CPDisk.proxyPreview(f.path, '2400x2400').then(function (b) {
      if (CP.rvLb && v.files[CP.rvLb.i] === f) img.src = URL.createObjectURL(b);
    }, function () { });
  }
  CP.rvLb = { ver: ver, i: i };
  box.classList.add('cp-open');
  show(i);
}

/* в списке карточек справа — «Сдать ретушь» и «на проверке» */
cbRenderOutline = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    if (!CP.shoot) return r;
    var rv = cpRv();
    Array.prototype.forEach.call(document.querySelectorAll('#cbOutline [data-cp-ck]'), function (ck) {
      var last = cpLastRv(rv[ck.getAttribute('data-cp-ck')]);
      var btn = ck.parentNode.querySelector('.cb-outline-item');
      if (!last || !btn || btn.querySelector('.cp-oi-rv')) return;
      btn.insertAdjacentHTML('beforeend', '<span class="cp-oi-rv cp-oi-rv-' + last.status + '">' + (last.status === 'review' ? 'проверка' : last.status === 'rework' ? 'доработка' : 'v' + last.v + ' ок') + '</span>');
    });
    var bar = document.getElementById('cpObar');
    if (bar && !bar.querySelector('[data-cp-o="accept"]')) bar.insertAdjacentHTML('beforeend', '<button data-cp-o="accept" title="Загрузить отретушированное на приёмку">Сдать ретушь</button>');
    return r;
  };
})(cbRenderOutline);

document.getElementById('cbOutline').addEventListener('click', function (e) {
  if (!e.target.closest('[data-cp-o="accept"]') || !CP.shoot) return;
  e.preventDefault(); e.stopPropagation();
  cpAcceptOpen(CP.shoot.path, CP.shoot.name);
}, true);

(function cpAcceptCss() {
  var css = ''
    + '.cp-acc-body{flex:1;overflow:auto;padding:14px 16px;display:flex;flex-direction:column;gap:12px}'
    + '.cp-acc-drop{border:2px dashed #3a3a37;border-radius:6px;padding:28px 16px;text-align:center;color:#a3a09a;line-height:1.8}'
    + '.cp-acc-drop.cp-over{border-color:#C9956B;color:#e7c9a8;background:#1d1a17}'
    + '.cp-acc-pick{color:#C9956B;cursor:pointer;text-decoration:underline}'
    + '.cp-acc-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}.cp-acc-row button.cp-on{border-color:#C9956B;color:#e7c9a8}'
    + '.cp-acc-list{display:flex;flex-direction:column;gap:4px;font-size:13px}.cp-acc-list small{color:#a3a09a}'
    + '.cp-acc-warn{color:#f2b8a0;font-size:12px}.cp-acc-done{color:#9fc2a3}'
    + '.cp-rvbarw{display:flex;gap:12px;align-items:center;margin:0 0 12px}'
    + '.cp-rvbar{display:inline-flex;gap:8px;align-items:center;color:#cfcac2;font-size:13px;cursor:pointer}.cp-rvbar small{color:#a3a09a}'
    + '.cp-rv{border:1px solid #3a3a37;border-radius:4px;padding:8px 10px;margin:8px 0;background:#1a1a18}'
    + '.cp-rv-head{display:flex;gap:6px;align-items:center;flex-wrap:wrap;font-size:12px;color:#cfcac2}'
    + '.cp-rv-ok{color:#9fc2a3}.cp-rv-bad{color:#f2b8a0}.cp-rv-wait{color:#e7c9a8}'
    + '.cp-rv-thumbs{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}'
    + '.cp-rv-t{padding:0;border:1px solid #2f2f2c;background:#232321;width:96px;height:96px;cursor:zoom-in}.cp-rv-t img{width:100%;height:100%;object-fit:contain;display:block}'
    + '.cp-oi-rv{font-size:10px;margin-left:6px;border-radius:8px;padding:0 5px;border:1px solid #3a3a37}'
    + '.cp-oi-rv-review{color:#e7c9a8;border-color:#5a4632}.cp-oi-rv-rework{color:#f2b8a0;border-color:#8a4a32}.cp-oi-rv-approved{color:#9fc2a3;border-color:#3d5a40}';
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
})();
