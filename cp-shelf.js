/* ============================================================
   cp-shelf.js — панель съёмки на витрине.

   Клик по съёмке выбирает её, справа открывается панель:
     - папки следующего уровня (луки, части) с тегами;
     - фильтры: папка, тег, статус, скачано / не скачано;
     - «Присвоить тег» — съёмке или выбранным папкам (теги из словаря);
     - «Открыть» — отбор; «Скачать» — ровно то, что отфильтровано.

   Скачивание: копии раскладываются в служебной папке
   <_ContentPulse>/выгрузки/<код съёмки>_<тег>_<N>/ — кадры из карточек
   по папкам карточек, остальные по исходным папкам; имена файлов
   исходные (по ним потом сверяем возвращённую ретушь). Яндекс отдаёт
   папку архивом, браузер скачивает обычной загрузкой. После этого у
   кадров появляется отметка «скачано» (кто, когда, какая выгрузка,
   сколько раз) — статус при этом не меняется.

   Словарь тегов — простой файл <_ContentPulse>/теги.txt:
     строка = тег; [Группа] — заголовок группы; # — комментарий.

   Подключается после cp-app.js. Префикс: cp*.
   ============================================================ */

var CP_TAGS_FILE = 'теги.txt';
var CP_EXPORTS_DIR = 'выгрузки';

var CP_DICT_TEMPLATE = [
  '# Словарь тегов Content Pulse.',
  '# Один тег в строке. [Название] — группа тегов. Строки с # — комментарии.',
  '# Присвоить можно только теги из этого файла.',
  '',
  '[Ретушёры]',
  'Яна',
  '',
  '[Срочность]',
  'Срочно',
  ''
].join('\n');

(function cpShelfCss() {
  var css = ''
    + '.cp-shelf-body{flex:1;display:flex;min-height:0}'
    + '.cp-shelf-body .cp-shelf-list{flex:1}'
    + '.cp-shoot-sel{border-color:#C9956B !important;background:#221d18 !important}'
    + '.cp-panel{width:400px;max-width:46vw;border-left:1px solid #2a2a28;background:#161615;display:none;flex-direction:column;min-height:0}'
    + '.cp-panel.cp-open{display:flex}'
    + '.cp-panel-head{padding:16px 18px 12px;border-bottom:1px solid #2a2a28;display:flex;gap:10px;align-items:flex-start}'
    + '.cp-panel-head b{display:block;font-size:15px;word-break:break-word}'
    + '.cp-panel-head small{color:#a3a09a;font-family:"IBM Plex Mono",monospace;font-size:11px}'
    + '.cp-panel-head .cp-sp{flex:1}'
    + '.cp-panel-body{flex:1;overflow:auto;padding:6px 18px 18px}'
    + '.cp-panel h4{font-size:10px;letter-spacing:.12em;color:#a3a09a;font-weight:600;margin:16px 0 8px;text-transform:uppercase}'
    + '.cp-panel-actions{display:flex;gap:8px;padding:12px 18px;border-top:1px solid #2a2a28;align-items:center}'
    + '.cp-panel-actions .cp-sum{flex:1;color:#a3a09a;font-size:11px;line-height:1.4}'
    + '.cp-fold{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #1f1f1d;font-size:12px}'
    + '.cp-fold label{flex:1;display:flex;gap:8px;align-items:center;cursor:pointer;word-break:break-word}'
    + '.cp-fold small{color:#a3a09a;font-family:"IBM Plex Mono",monospace}'
    + '.cp-chip{display:inline-flex;align-items:center;gap:4px;background:#2b241d;border:1px solid #5a4632;color:#e7c9a8;border-radius:10px;padding:1px 4px 1px 8px;font-size:11px;margin:2px 4px 2px 0}'
    + '.cp-chip button{background:none;border:none;color:#a3a09a;padding:0 4px;font-size:12px;line-height:1}'
    + '.cp-chip.cp-chip-inh{opacity:.6}'
    + '.cp-row{display:flex;gap:8px;align-items:center;margin:6px 0}'
    + '.cp-row select{flex:1;background:#1d1d1b;border:1px solid #2a2a28;color:#f2f2f1;padding:6px 8px;border-radius:3px;font:inherit}'
    + '.cp-row > span{width:84px;color:#a3a09a;font-size:12px}'
    + '.cp-note{color:#a3a09a;font-size:11px;line-height:1.5;margin:8px 0}'
    + '.cp-warn{color:#e7c9a8}'
    + '.cp-panel a{color:#C9956B}';
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
})();

(function cpShelfDom() {
  var list = document.getElementById('cpShelfList');
  var body = document.createElement('div');
  body.className = 'cp-shelf-body';
  list.parentNode.insertBefore(body, list);
  body.appendChild(list);
  var panel = document.createElement('div');
  panel.className = 'cp-panel';
  panel.id = 'cpPanel';
  body.appendChild(panel);
})();

/* ---------- служебная папка и словарь тегов ---------- */

function cpServicePath(name) { return CP_CONFIG.serviceDir.replace(/\/+$/, '') + (name ? '/' + name : ''); }

/** Словарь: [{tag, group}]. null — файла нет. Кэшируется до перезагрузки витрины. */
function cpLoadDict(force) {
  if (CP.dict !== undefined && CP.dict !== null && !force) return Promise.resolve(CP.dict);
  return CPDisk.proxyFile(cpServicePath(CP_TAGS_FILE)).then(function (b) { return b.text(); }).then(function (txt) {
    var out = [], group = '';
    txt.split(/\r?\n/).forEach(function (line) {
      var l = line.trim();
      if (!l || l.charAt(0) === '#') return;
      var g = /^\[(.+)\]$/.exec(l);
      if (g) { group = g[1].trim(); return; }
      if (!out.some(function (x) { return x.tag.toLowerCase() === l.toLowerCase(); })) out.push({ tag: l, group: group });
    });
    CP.dict = out;
    return out;
  }, function (e) {
    if (e && e.status === 404) { CP.dict = null; return null; }
    throw e;
  });
}

function cpCreateDict() {
  cbBusyShow('Создаю словарь тегов...', 0.5);
  CPDisk.ensureDir(cpServicePath()).then(function () {
    return CPDisk.uploadBlob(cpServicePath(CP_TAGS_FILE), new Blob([CP_DICT_TEMPLATE], { type: 'text/plain' }), false);
  }).then(function () {
    cbBusyHide();
    cbToast('Словарь создан: ' + cpServicePath(CP_TAGS_FILE).replace(/^disk:/, '') + ' — впишите туда свои теги');
    return cpLoadDict(true);
  }).then(cpRenderPanel).catch(function (e) { cpHandleError(e, 'Не удалось создать словарь'); });
}

/* ---------- выбор съёмки ---------- */

/** Подсветить выбранную съёмку, не перерисовывая список (иначе теряется двойной клик). */
function cpMarkSelected() {
  Array.prototype.forEach.call(document.querySelectorAll('#cpShelfList .cp-shoot'), function (b) {
    b.classList.toggle('cp-shoot-sel', !!(CP.sel && b.getAttribute('data-path') === CP.sel.path));
  });
}

function cpSelectShoot(path, name, modified) {
  CP.sel = { path: path, name: name, modified: modified, loading: true,
    folders: {}, status: '', tag: '', dl: '', data: null, rev: '', files: [], dirs: [] };
  cpMarkSelected();
  cpRenderPanel();
  var sel = CP.sel;
  Promise.all([
    CPDisk.readState(path).catch(function (e) { if (e && e.status === 401) throw e; return { data: null, rev: null, error: e }; }),
    CPDisk.walkPhotos(path, false),
    CPDisk.listDir(path),
    cpLoadDict().catch(function () { return null; })
  ]).then(function (r) {
    if (CP.sel !== sel) return;   /* успели выбрать другую */
    sel.data = r[0].data;
    sel.rev = r[0].rev;
    sel.stateError = r[0].error || null;
    sel.files = r[1];
    sel.dirs = r[2].filter(function (x) { return x.type === 'dir' && x.name.charAt(0) !== '_' && x.name !== CPDisk.RETOUCH_DIR; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, undefined, { numeric: true }); });
    sel.loading = false;
    cpRenderPanel();
  }).catch(function (e) {
    sel.loading = false;
    sel.error = e;
    cpRenderPanel();
    cpHandleError(e, 'Не удалось прочитать съёмку');
  });
}

/* ---------- вычисления по данным съёмки ---------- */

function cpSelMeta(data) {
  var m = (data && data.meta && data.meta.cp) || {};
  return { status: m.status || {}, downloads: m.downloads || {}, folderTags: m.folderTags || {}, events: m.events || [] };
}

function cpRelOf(shootPath, disk) {
  var root = shootPath.replace(/\/+$/, '') + '/';
  return disk.indexOf(root) === 0 ? disk.slice(root.length) : disk;
}

/** Индекс кадров съёмки: disk -> {pid, rel, dir, status, dl, tags[], cards[]} */
function cpPhotoIndex(sel) {
  var data = sel.data || {}, meta = cpSelMeta(data);
  var pidByDisk = {}, cardTags = {}, cardsOf = {};
  (data.photos || []).forEach(function (p) { if (p.disk) pidByDisk[p.disk] = p.id; });
  (data.cards || []).forEach(function (c, ci) {
    var pids = c.mode === 'auto' ? (c.pids || []) : (c.slots || []).map(function (s) { return s.pid; });
    pids.forEach(function (pid) {
      if (!pid) return;
      (cardsOf[pid] = cardsOf[pid] || []).push(ci);
      (c.tags || []).forEach(function (t) { (cardTags[pid] = cardTags[pid] || {})[t] = true; });
    });
  });
  var idx = {};
  sel.files.forEach(function (f) {
    var rel = cpRelOf(sel.path, f.path);
    var dir = rel.indexOf('/') === -1 ? '' : rel.slice(0, rel.lastIndexOf('/'));
    var pid = pidByDisk[f.path] || null;
    var tags = {};
    Object.keys(meta.folderTags).forEach(function (fp) {
      if (fp === '' || dir === fp || dir.indexOf(fp + '/') === 0) (meta.folderTags[fp] || []).forEach(function (t) { tags[t] = true; });
    });
    if (pid && cardTags[pid]) Object.keys(cardTags[pid]).forEach(function (t) { tags[t] = true; });
    idx[f.path] = { file: f, pid: pid, rel: rel, dir: dir,
      status: pid && meta.status[pid] ? meta.status[pid].s : '',
      dl: pid && meta.downloads[pid] ? meta.downloads[pid].n : 0,
      tags: Object.keys(tags), cards: pid ? (cardsOf[pid] || []) : [] };
  });
  return idx;
}

/** Кадры, проходящие фильтры панели. */
function cpFiltered(sel) {
  var idx = cpPhotoIndex(sel);
  var folders = Object.keys(sel.folders).filter(function (k) { return sel.folders[k]; });
  return Object.keys(idx).map(function (k) { return idx[k]; }).filter(function (x) {
    if (folders.length && !folders.some(function (f) { return x.dir === f || x.dir.indexOf(f + '/') === 0; })) return false;
    if (sel.status === 'none' && x.status) return false;
    if (sel.status && sel.status !== 'none' && x.status !== sel.status) return false;
    if (sel.tag && x.tags.indexOf(sel.tag) === -1) return false;
    if (sel.dl === 'yes' && !x.dl) return false;
    if (sel.dl === 'no' && x.dl) return false;
    return true;
  });
}

/* ---------- отрисовка панели ---------- */

function cpTagChips(tags, removable, inherited) {
  return tags.map(function (t) {
    return '<span class="cp-chip' + (inherited ? ' cp-chip-inh' : '') + '">' + cbEsc(t)
      + (removable ? '<button data-cp-untag="' + cbEsc(t) + '" title="Снять тег">×</button>' : '') + '</span>';
  }).join('');
}

function cpDictOptions(selected, firstLabel) {
  var html = '<option value="">' + cbEsc(firstLabel) + '</option>', group = null;
  (CP.dict || []).forEach(function (d) {
    if (d.group !== group) {
      if (group !== null) html += '</optgroup>';
      html += '<optgroup label="' + cbEsc(d.group || 'Без группы') + '">';
      group = d.group;
    }
    html += '<option value="' + cbEsc(d.tag) + '"' + (d.tag === selected ? ' selected' : '') + '>' + cbEsc(d.tag) + '</option>';
  });
  if (group !== null) html += '</optgroup>';
  return html;
}

function cpRenderPanel() {
  var panel = document.getElementById('cpPanel');
  var sel = CP.sel;
  if (!sel) { panel.classList.remove('cp-open'); return; }
  panel.classList.add('cp-open');
  var head = '<div class="cp-panel-head"><div><b>' + cbEsc(sel.name) + '</b>'
    + '<small>' + (sel.modified ? 'изменена ' + cpFmtDate(sel.modified) : '') + '</small></div>'
    + '<span class="cp-sp"></span><button data-cp-p="close" title="Закрыть панель">×</button></div>';
  if (sel.loading) {
    panel.innerHTML = head + '<div class="cp-panel-body"><div class="cp-note">Читаю папки и отбор съёмки...</div></div>';
    return;
  }
  if (sel.error) {
    panel.innerHTML = head + '<div class="cp-panel-body"><div class="cp-note cp-warn">Не удалось прочитать съёмку: '
      + cbEsc(sel.error.message || sel.error) + '</div></div>';
    return;
  }
  var meta = cpSelMeta(sel.data);
  var idx = cpPhotoIndex(sel);
  var countIn = function (fp) {
    return Object.keys(idx).filter(function (k) { var d = idx[k].dir; return d === fp || d.indexOf(fp + '/') === 0; }).length;
  };
  var body = '';

  /* теги всей съёмки */
  body += '<h4>Теги съёмки</h4><div>' + (meta.folderTags[''] && meta.folderTags[''].length
    ? cpTagChips(meta.folderTags[''], true) : '<span class="cp-note">нет</span>') + '</div>';

  /* папки следующего уровня */
  body += '<h4>Папки · ' + sel.dirs.length + '</h4>';
  if (!sel.dirs.length) body += '<div class="cp-note">Вложенных папок нет — все кадры лежат в корне съёмки.</div>';
  sel.dirs.forEach(function (d) {
    var fp = d.name;
    var own = meta.folderTags[fp] || [];
    body += '<div class="cp-fold"><label><input type="checkbox" data-cp-fold="' + cbEsc(fp) + '"'
      + (sel.folders[fp] ? ' checked' : '') + '><span>' + cbEsc(d.name) + ' <small>· ' + countIn(fp) + '</small></span></label>'
      + '<span>' + cpTagChips(own, true).replace(/data-cp-untag=/g, 'data-cp-fold-untag="' + cbEsc(fp) + '" data-cp-untag=') + '</span></div>';
  });

  /* присвоить тег */
  body += '<h4>Присвоить тег</h4>';
  if (CP.dict === null) {
    body += '<div class="cp-note cp-warn">Словарь тегов не найден: ' + cbEsc(cpServicePath(CP_TAGS_FILE).replace(/^disk:/, ''))
      + '.<br>Теги берутся только из него — так они одинаковые у всех.</div>'
      + '<button data-cp-p="mkdict">Создать словарь-образец</button>';
  } else {
    var nf = Object.keys(sel.folders).filter(function (k) { return sel.folders[k]; }).length;
    body += '<div class="cp-row"><select id="cpAssignTag">' + cpDictOptions('', 'Выберите тег из словаря') + '</select>'
      + '<button data-cp-p="assign">' + (nf ? 'Папкам (' + nf + ')' : 'Всей съёмке') + '</button></div>'
      + '<div class="cp-note">Тег папки действует на все её кадры и вложенные папки. Словарь: '
      + cbEsc(cpServicePath(CP_TAGS_FILE).replace(/^disk:/, '')) + ' · <a href="#" data-cp-p="reloaddict">перечитать</a></div>';
  }

  /* фильтры */
  body += '<h4>Фильтры для скачивания</h4>';
  body += '<div class="cp-row"><span>Тег</span><select id="cpFTag">' + cpDictOptions(sel.tag, 'Все') + '</select></div>';
  body += '<div class="cp-row"><span>Статус</span><select id="cpFStatus">'
    + [['', 'Все'], ['retouch', 'Ретушь'], ['approval', 'Согласование'], ['reshoot', 'Пересъём'], ['none', 'Без статуса']]
      .map(function (o) { return '<option value="' + o[0] + '"' + (sel.status === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('')
    + '</select></div>';
  body += '<div class="cp-row"><span>Скачано</span><select id="cpFDl">'
    + [['', 'Все'], ['no', 'Не скачано'], ['yes', 'Скачано']]
      .map(function (o) { return '<option value="' + o[0] + '"' + (sel.dl === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('')
    + '</select></div>';
  if (sel.stateError) body += '<div class="cp-note cp-warn">Отбор съёмки не прочитался — статусы и карточки не учитываются.</div>';
  else if (!sel.data) body += '<div class="cp-note">Съёмку ещё не открывали в Content Pulse: карточек и статусов пока нет.</div>';

  var items = cpFiltered(sel);
  var inCards = items.filter(function (x) { return x.cards.length; }).length;
  var again = items.filter(function (x) { return x.dl; }).length;
  var sum = 'Будет скачано: <b>' + items.length + '</b> из ' + Object.keys(idx).length
    + (inCards ? ' · в карточках ' + inCards : '') + (again ? '<br><span class="cp-warn">уже скачивали: ' + again + '</span>' : '');

  panel.innerHTML = head + '<div class="cp-panel-body">' + body + '</div>'
    + '<div class="cp-panel-actions"><div class="cp-sum">' + sum + '</div>'
    + '<button data-cp-p="open">Открыть</button>'
    + '<button class="cb-primary" data-cp-p="download"' + (items.length ? '' : ' disabled') + '>Скачать</button></div>';
}

/* ---------- изменения отбора с витрины (чтение-правка-запись) ---------- */

/** fn(data) правит свежие данные отбора; при конфликте — один повтор на свежей версии. */
function cpMutateState(sel, fn) {
  function attempt(retry) {
    return CPDisk.readState(sel.path).then(function (st) {
      var data = st.data || cpBlankProject(sel.name);
      data.meta = data.meta || {};
      data.meta.cp = data.meta.cp || {};
      ['status', 'downloads', 'folderTags', 'cardStatus'].forEach(function (k) { data.meta.cp[k] = data.meta.cp[k] || {}; });
      data.meta.cp.events = data.meta.cp.events || [];
      fn(data);
      return CPDisk.writeState(sel.path, data, st.rev).then(function (rev) {
        sel.data = data; sel.rev = rev;
        return data;
      });
    }).catch(function (e) {
      if (e && e.conflict && retry) return attempt(false);
      throw e;
    });
  }
  return attempt(true).then(function (data) {
    /* если эта съёмка открыта — подтянуть изменения в отбор */
    if (CP.shoot && CP.shoot.path === sel.path && !App.dirty) {
      return CPDisk.readState(sel.path).then(function (st) { CP.rev = st.rev; cpApplyRemote(st.data); return data; });
    }
    return data;
  });
}

function cpShelfEvent(data, action, extra) {
  var ev = { ts: new Date().toISOString(), action: action, actor: cpActor(), items: [] };
  Object.keys(extra || {}).forEach(function (k) { if (extra[k] !== undefined) ev[k] = extra[k]; });
  data.meta.cp.events.push(ev);
  if (data.meta.cp.events.length > 3000) data.meta.cp.events.splice(0, data.meta.cp.events.length - 3000);
}

function cpAssignTag(tag, folders) {
  var sel = CP.sel;
  var targets = folders.length ? folders : [''];
  cbBusyShow('Присваиваю тег «' + tag + '»...', 0.5);
  cpMutateState(sel, function (data) {
    targets.forEach(function (fp) {
      var list = data.meta.cp.folderTags[fp] = data.meta.cp.folderTags[fp] || [];
      if (list.indexOf(tag) === -1) list.push(tag);
    });
    cpShelfEvent(data, 'tag_folder', { tag: tag, folders: targets.map(function (f) { return f || '(вся съёмка)'; }) });
  }).then(function () {
    cbBusyHide();
    cbToast('Тег «' + tag + '» → ' + (folders.length ? folders.join(', ') : 'вся съёмка'));
    cpRenderPanel();
  }).catch(function (e) { cpHandleError(e, 'Не удалось присвоить тег'); });
}

function cpRemoveTag(tag, folder) {
  var sel = CP.sel;
  cpMutateState(sel, function (data) {
    var list = data.meta.cp.folderTags[folder] || [];
    data.meta.cp.folderTags[folder] = list.filter(function (t) { return t !== tag; });
    if (!data.meta.cp.folderTags[folder].length) delete data.meta.cp.folderTags[folder];
    cpShelfEvent(data, 'untag_folder', { tag: tag, folders: [folder || '(вся съёмка)'] });
  }).then(cpRenderPanel).catch(function (e) { cpHandleError(e, 'Не удалось снять тег'); });
}

/* ---------- скачивание отфильтрованного ---------- */

function cpExportName(sel) {
  var parts = [CPDisk.safeName(sel.name)];
  if (sel.tag) parts.push(CPDisk.safeName(sel.tag));
  else if (sel.status && sel.status !== 'none' && CP_STATUS[sel.status]) parts.push(CP_STATUS[sel.status].label);
  var base = parts.join('_');
  return CPDisk.listDir(cpServicePath(CP_EXPORTS_DIR)).then(function (items) {
    var max = 0;
    items.forEach(function (x) {
      if (x.name.indexOf(base + '_') !== 0) return;
      var n = parseInt(x.name.slice(base.length + 1), 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return base + '_' + (max + 1);
  }, function (e) {
    if (e && e.status === 404) return base + '_1';
    throw e;
  });
}

function cpShelfDownload() {
  var sel = CP.sel;
  var items = cpFiltered(sel);
  if (!items.length) { cbToast('Под фильтры не попало ни одного кадра'); return; }
  var data = sel.data || {};
  var cards = data.cards || [];
  var name, root;
  var used = {};
  cbBusyShow('Готовлю выгрузку...', 0.05);
  cpExportName(sel).then(function (n) {
    name = n;
    root = cpServicePath(CP_EXPORTS_DIR) + '/' + name;
    var dirs = {}, copies = items.map(function (x) {
      var parts;
      if (x.cards.length) {
        var c = cards[x.cards[0]];
        parts = [cpPad(x.cards[0] + 1) + ' ' + (c.title || c.category || 'Карточка')];
      } else {
        parts = x.dir ? x.dir.split('/') : [];
      }
      var dir = root + (parts.length ? '/' + parts.map(CPDisk.safeName).join('/') : '');
      dirs[dir] = true;
      var fname = x.file.name, key = dir + '/' + fname, k = 2;
      while (used[key]) { fname = x.file.name.replace(/(\.[^.]+)?$/, '_' + (k++) + '$1'); key = dir + '/' + fname; }
      used[key] = true;
      return { from: x.file.path, path: key };
    });
    return CPDisk.ensureDir(cpServicePath(CP_EXPORTS_DIR)).then(function () {
      return cpCopyOnDisk(copies, Object.keys(dirs), 'Раскладываю выгрузку');
    });
  }).then(function (r) {
    cbBusyShow('Яндекс собирает архив...', 1);
    return CPDisk.downloadHref(root).then(function (href) {
      cpNativeDownload(href);
      return r;
    });
  }).then(function (r) {
    /* отметка «скачано» — статус не меняем */
    var stamp = { by: cpActor(), ts: new Date().toISOString(), export: name };
    var filters = { tag: sel.tag || undefined, status: sel.status || undefined, dl: sel.dl || undefined,
      folders: Object.keys(sel.folders).filter(function (k) { return sel.folders[k]; }) };
    return cpMutateState(sel, function (d) {
      var pidByDisk = {};
      (d.photos || []).forEach(function (p) { if (p.disk) pidByDisk[p.disk] = p.id; });
      items.forEach(function (x) {
        var pid = pidByDisk[x.file.path];
        if (!pid) {   /* кадр ещё не в отборе — заводим запись, чтобы помнить скачивание */
          pid = 'p' + (d.nextId = (d.nextId || 1) + 1) + 'x';
          d.photos = d.photos || [];
          d.photos.push({ id: pid, name: x.file.name, disk: x.file.path, size: x.file.size, md5: x.file.md5, w: 0, h: 0, kind: 'photo' });
          pidByDisk[x.file.path] = pid;
        }
        var cur = d.meta.cp.downloads[pid];
        d.meta.cp.downloads[pid] = { n: (cur ? cur.n : 0) + 1, first: cur ? cur.first : stamp, last: stamp };
      });
      cpShelfEvent(d, 'download', { export: name, count: r.done + r.exists, filters: filters,
        again: items.filter(function (x) { return x.dl; }).length || undefined,
        failed: r.failed.length ? r.failed : undefined });
    }).then(function () {
      cbBusyHide();
      cpRenderPanel();
      cbToast('Скачивание началось: ' + name + ' · ' + (r.done + r.exists) + ' кадр(ов)'
        + (r.failed.length ? ' · не скопировано: ' + r.failed.length : '') + '. Кадры отмечены как скачанные.');
    });
  }).catch(function (e) { cpHandleError(e, 'Скачивание'); });
}

/* ---------- события панели ---------- */

document.getElementById('cpPanel').addEventListener('click', function (e) {
  var sel = CP.sel;
  var untag = e.target.closest('[data-cp-untag]');
  if (untag) {
    e.preventDefault();
    var folder = untag.getAttribute('data-cp-fold-untag') || '';
    var tag = untag.getAttribute('data-cp-untag');
    if (confirm('Снять тег «' + tag + '» с ' + (folder ? 'папки «' + folder + '»' : 'всей съёмки') + '?')) cpRemoveTag(tag, folder);
    return;
  }
  var b = e.target.closest('[data-cp-p]');
  if (!b) return;
  e.preventDefault();
  var act = b.getAttribute('data-cp-p');
  if (act === 'close') { CP.sel = null; cpRenderPanel(); cpMarkSelected(); }
  else if (act === 'open') cpOpenShoot(sel.path, sel.name);
  else if (act === 'download') cpShelfDownload();
  else if (act === 'mkdict') cpCreateDict();
  else if (act === 'reloaddict') cpLoadDict(true).then(cpRenderPanel, function (er) { cpHandleError(er, 'Словарь'); });
  else if (act === 'assign') {
    var tag = document.getElementById('cpAssignTag').value;
    if (!tag) { cbToast('Выберите тег из словаря'); return; }
    cpAssignTag(tag, Object.keys(sel.folders).filter(function (k) { return sel.folders[k]; }));
  }
});

document.getElementById('cpPanel').addEventListener('change', function (e) {
  var sel = CP.sel;
  if (!sel) return;
  var t = e.target;
  if (t.hasAttribute('data-cp-fold')) sel.folders[t.getAttribute('data-cp-fold')] = t.checked;
  else if (t.id === 'cpFTag') sel.tag = t.value;
  else if (t.id === 'cpFStatus') sel.status = t.value;
  else if (t.id === 'cpFDl') sel.dl = t.value;
  else return;
  cpRenderPanel();
});
