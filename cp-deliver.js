/* ============================================================
   cp-deliver.js — выдача ретушёрам и сдача (тест в SK, 06.11.2026)

   1. Галочки в списке карточек справа: отметил карточки, поставил букву
      ретушёра (одна на всех отмеченных), «Скачать отмеченные» — архив
      «<съёмка>_<буква>_<N>»: N — номер выгрузки этого ретушёра в съёмке;
      кадры помечаются скачанными (кто, когда, какой архив).
   2. Сдача через папку «Сайт» (настройка «сайт» в настройки.txt, поле в
      шестерёнке). Ретушёры кладут готовое сами:
         Сайт / дата / буква_номер выгрузки / съёмка / артикулы / файлы
      «Проверить сдачу» читает эту папку, находит папку текущей съёмки,
      сопоставляет папки артикулов с карточками отбора (по коду артикула,
      иначе по имени карточки) и отмечает каждую «сдано» — с буквой,
      датой и числом файлов. Видно, что сдано, чего не хватает и какие
      папки в «Сайте» не нашли своей карточки.
   3. Фильтр карточек по папке: открыли съёмку с отмеченными на панели
      папками — галерея и карточки сразу по ним; «все карточки» — снять.
   4. «Назад» в браузере из съёмки возвращает на витрину.
   5. Панель скачивания на витрине можно скрыть.
   ============================================================ */

CP.checked = {};          /* id карточки -> true: отмечена в списке справа */
CP.cardFolders = null;    /* фильтр карточек по папкам съёмки: ['1', '1/74595_модель'] */

/* ---------- буквы ретушёров: группа словаря с «ретуш» в названии ---------- */

function cpRetoucherTags() {
  var groups = CP.dictGroups || {};
  var g = Object.keys(groups).filter(function (n) { return /ретуш/i.test(n); })[0];
  if (!g) return [];
  return (CP.dict || []).filter(function (d) { return d.group === g; }).map(function (d) { return d.tag; });
}

function cpCardLetter(card) {
  var rt = cpRetoucherTags();
  return (card.tags || []).filter(function (t) { return rt.indexOf(t) !== -1; })[0] || '';
}

function cpDelivered() {
  var m = cpMeta();
  return m.delivered || (m.delivered = {});
}

/* ---------- список карточек справа: галочки и действия ---------- */

cbRenderOutline = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    try { cpOutlineDecorate(); } catch (e) { if (window.console) console.error('[CP] список карточек', e); }
    return r;
  };
})(cbRenderOutline);

function cpCardMatchesFolders(card) {
  if (!CP.cardFolders || !CP.cardFolders.length) return true;
  var dirs = [];
  if (card.cpArticleDir) dirs.push(card.cpArticleDir);
  cpCardPids(card).forEach(function (pid) {
    var p = cbPhotoById(pid);
    if (p && p.disk) dirs.push(cpRelDir(p));
  });
  if (!dirs.length) return true;   /* пустую (новую) карточку не прячем */
  return CP.cardFolders.some(function (f) {
    return dirs.some(function (d) { return d === f || d.indexOf(f + '/') === 0; });
  });
}

function cpOutlineDecorate() {
  var host = document.getElementById('cbOutline');
  if (!host || !CP.shoot || App.activeTab === 'conts') return;
  var del = cpDelivered(), dl = cpMeta().downloads;
  Array.prototype.forEach.call(host.querySelectorAll('.cb-outline-item'), function (btn) {
    var id = btn.getAttribute('data-target');
    var card = cbCardById(id);
    if (!card || btn.parentNode.classList.contains('cp-oi')) return;
    var row = document.createElement('div');
    row.className = 'cp-oi';
    if (!cpCardMatchesFolders(card)) row.style.display = 'none';
    var ck = document.createElement('input');
    ck.type = 'checkbox';
    ck.className = 'cp-oi-ck';
    ck.setAttribute('data-cp-ck', id);
    ck.checked = !!CP.checked[id];
    ck.title = 'Отметить для буквы ретушёра и скачивания';
    btn.parentNode.insertBefore(row, btn);
    row.appendChild(ck);
    row.appendChild(btn);
    var pids = cpCardPids(card);
    var marks = '';
    var letter = cpCardLetter(card);
    if (letter) marks += '<b class="cp-oi-l">' + cbEsc(letter) + '</b>';
    if (del[id]) marks += '<span class="cp-oi-ok" title="Сдано: ' + cbEsc(del[id].at || '') + '">сдано</span>';
    else if (CP_SHOW_DL && pids.length && pids.every(function (pid) { return dl[pid] && dl[pid].n; })) marks += '<span class="cp-oi-dl">скач.</span>';
    if (marks) btn.insertAdjacentHTML('beforeend', '<span class="cp-oi-m">' + marks + '</span>');
  });
  var title = host.querySelector('.cb-outline-title');
  var visible = App.cards.filter(cpCardMatchesFolders);
  var n = Object.keys(CP.checked).filter(function (k) { return CP.checked[k] && cbCardById(k); }).length;
  if (title && !title.querySelector('.cp-oi-all')) {
    title.insertAdjacentHTML('beforeend', ' <a href="#" class="cp-oi-all" data-cp-o="all">'
      + (n && n >= visible.length ? 'снять' : 'отметить все') + '</a>'
      + (CP.cardFolders && CP.cardFolders.length ? ' <a href="#" data-cp-o="nofilter" title="Сейчас видны карточки папок: ' + cbEsc(CP.cardFolders.join(', ')) + '">все карточки</a>' : ''));
  }
  var bar = document.getElementById('cpObar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'cpObar';
    bar.className = 'cp-obar';
    host.appendChild(bar);
  } else host.appendChild(bar);
  var letters = cpRetoucherTags();
  var html = '';
  if (n) {
    html += '<div class="cp-obar-n">Отмечено: ' + n + '</div>';
    if (letters.length) {
      html += '<div class="cp-obar-l">' + letters.map(function (t) {
        return '<button data-cp-letter="' + cbEsc(t) + '" title="Поставить отмеченным карточкам букву ' + cbEsc(t) + ' (повторно — снять)">' + cbEsc(t) + '</button>';
      }).join('') + '</div>';
    } else html += '<div class="cp-obar-hint">Букв ретушёров нет в словаре тегов: группа «[Ретушёры: один]» в «Словаре тегов»</div>';
    html += '<div class="cp-obar-s">'
      + '<button data-cp-batch="retouch" title="Отправить отмеченные карточки на ретушь (с копиями в папку ретуши)">На ретушь</button>'
      + '<button data-cp-batch="approval" title="Отправить отмеченные карточки на согласование">На согласование</button>'
      + '<button data-cp-batch="reshoot" title="Отмеченные карточки — в брак (пересъём)">В брак</button>'
      + '<button data-cp-batch="" title="Снять статус с отмеченных карточек и их кадров">Снять статус</button></div>';
    html += '<button class="cb-primary" data-cp-o="download">Скачать отмеченные</button>';
  }
  /* в каталоге сданное видно по папке 05 (сверка с Диском) — старая проверка по «Сайт/дата/буква_номер» не нужна */
  if (!(typeof cpCatalog === 'function' && cpCatalog())) {
    html += '<button data-cp-o="site" title="Прочитать папку «Сайт» и отметить сданные карточки">Проверить сдачу</button>';
  }
  bar.innerHTML = html;
}

document.getElementById('cbOutline').addEventListener('change', function (e) {
  var ck = e.target.closest('[data-cp-ck]');
  if (!ck) return;
  CP.checked[ck.getAttribute('data-cp-ck')] = ck.checked;
  cbRenderOutline();
});

document.getElementById('cbOutline').addEventListener('click', function (e) {
  var b = e.target.closest('[data-cp-o],[data-cp-letter],[data-cp-batch]');
  if (!b) return;
  e.preventDefault();
  e.stopPropagation();
  if (b.hasAttribute('data-cp-letter')) { cpSetLetter(b.getAttribute('data-cp-letter')); return; }
  if (b.hasAttribute('data-cp-batch')) { cpBatchStatus(b.getAttribute('data-cp-batch') || null); return; }
  var act = b.getAttribute('data-cp-o');
  if (act === 'all') {
    var vis = App.cards.filter(cpCardMatchesFolders);
    var allOn = vis.length && vis.every(function (c) { return CP.checked[c.id]; });
    CP.checked = {};
    if (!allOn) vis.forEach(function (c) { CP.checked[c.id] = true; });
    cbRenderOutline();
  } else if (act === 'nofilter') {
    cpSetCardFolders(null);
  } else if (act === 'download') cpDownloadChecked();
  else if (act === 'site') cpCheckSite();
}, true);

function cpCheckedCards() {
  return App.cards.filter(function (c) { return CP.checked[c.id]; });
}

/** Статус пачкой: отмеченным карточкам и их кадрам — ретушь (одним копированием),
    согласование, брак или снять. По одной — как раньше, на шапке карточки. */
function cpBatchStatus(status) {
  var cards = cpCheckedCards();
  if (!cards.length) return;
  if ((status === 'retouch' || status === 'approval') && typeof cpCatStageMissing === 'function'
    && cpCatStageMissing(status === 'retouch' ? 'retouch' : 'approve')) return;
  var all = [], names = [], same = [];
  var m = cpMeta();
  cards.forEach(function (c) {
    var pids = cpCardPids(c).filter(function (pid) { var p = cbPhotoById(pid); return p && (p.kind || 'photo') !== 'ref'; });
    if (status === 'retouch') {
      /* уже на ретуши в этом же составе — повторно не отправляем и не перезаписываем;
         добавили кадры после отправки — уходят только они */
      var cst = m.cardStatus[c.id];
      var fresh = pids.filter(function (pid) { return !(m.status[pid] && m.status[pid].s === 'retouch'); });
      if (cst && cst.s === 'retouch' && !fresh.length) { same.push(c.title || 'карточка'); return; }
      if (!(cst && cst.s === 'retouch')) cpSetStatus([], 'retouch', c.id);
      cpSetStatus(fresh, 'retouch', c.id);
      pids = fresh;
    } else cpSetStatus(pids, status, c.id);
    pids.forEach(function (pid) { if (all.indexOf(pid) === -1) all.push(pid); });
    names.push(c.title || c.category || 'карточка');
  });
  if (status === 'retouch' && !names.length) {
    cbToast('Уже на ретуши в этом составе — повторно не отправляю: ' + same.join(', '));
    return;
  }
  var extra = { card: names.join(', ') };
  if (same.length) extra.note = 'уже были на ретуши в этом составе, не отправлялись: ' + same.join(', ');
  if (status !== 'retouch') {
    cpEvent(status ? 'to_' + status : 'clear_status', cpPhotoNames(all), extra);
    cpAfterStatus();
    cbRenderOutline();
    cbToast((status ? CP_STATUS[status].label : 'Статус снят') + ': карточек ' + cards.length + ', кадров ' + all.length);
    return;
  }
  if (!all.length) { cpEvent('to_retouch', [], extra); cpAfterStatus(); cbRenderOutline(); return; }
  cpRetouchCopy(all, null, 'Копирую на ретушь: карточек ' + names.length).then(function (r) {
    extra.folder = CPDisk.showPath(r.folder);
    extra.copied = r.done;
    if (r.exists) extra.existed = r.exists;
    if (r.failed.length) extra.failed = r.failed;
    cpEvent('to_retouch', cpPhotoNames(all), extra);
    cpAfterStatus();
    cbRenderOutline();
    cbToast('На ретушь: карточек ' + names.length + (same.length ? ' (уже были на ретуши: ' + same.length + ')' : '') + ', скопировано ' + r.done + (r.exists ? ', уже было ' + r.exists : '')
      + (r.failed.length ? ', не скопировано ' + r.failed.length + ' — см. строку съёмки' : ''));
  }).catch(function (e) {
    cpEvent('to_retouch', cpPhotoNames(all), { card: extra.card, note: 'статус поставлен, копирование не удалось: ' + e.message });
    cpAfterStatus();
    cbRenderOutline();
    cpHandleError(e, 'Копирование на ретушь не удалось (статус поставлен, «докопировать» — в строке съёмки)');
  });
}

/** Буква ретушёра всем отмеченным; если она уже у всех — снять. */
function cpSetLetter(tag) {
  var cards = cpCheckedCards();
  if (!cards.length) return;
  var off = cards.every(function (c) { return (c.tags || []).indexOf(tag) !== -1; });
  cards.forEach(function (c) {
    c.tags = off ? (c.tags || []).filter(function (t) { return t !== tag; }) : cpTagsWith(c.tags, tag);
  });
  cpEvent(off ? 'card_untag' : 'card_tag', [], { tag: tag, card: cards.map(function (c) { return c.title; }).join(', ') }, true);
  cbMarkDirty();
  cbRenderCards();
  cbRenderOutline();
}

/** Скачать отмеченные карточки: папки карточек, архив «<съёмка>_<буква>_<N>». */
function cpDownloadChecked() {
  var cards = cpCheckedCards();
  if (!cards.length) { cbToast('Отметьте карточки галочками в списке справа'); return; }
  var ids = {};
  cards.forEach(function (c) { ids[c.id] = true; });
  var jobs = cpSelectionJobs(ids);
  if (!jobs.length) { cbToast('В отмеченных карточках нет кадров с Диска'); return; }
  var shoot = CP.shoot;
  var stype = typeof cpShootType === 'function' ? cpShootType(shoot.name) : null;
  var seen = {};
  var entries = (stype && stype.exportMode === 'folders')
    ? jobs.filter(function (j) { if (seen[j.disk]) return false; seen[j.disk] = true; return true; })
      .map(function (j) { return { from: j.disk, size: j.size, name: cpRelInShoot(j.disk) }; })
    : jobs.map(function (j) { return { from: j.disk, size: j.size, name: j.dir.map(CPDisk.safeName).join('/') + '/' + CPDisk.safeName(j.file) }; });
  var letters = cards.map(cpCardLetter).filter(function (x, i, a) { return x && a.indexOf(x) === i; });
  var base = CPDisk.safeName(shoot.name) + (letters.length === 1 ? '_' + letters[0] : '');
  var pids = jobs.map(function (j) {
    var p = App.photos.filter(function (x) { return x.disk === j.disk; })[0];
    return p && p.id;
  }).filter(Boolean);
  cpNextExportName(base, cpMeta().events).then(function (name) {
    return cpExportBundle(name, entries, 'Карточек: ' + cards.length + ', кадров: ' + entries.length + '.').then(function (r) {
      if (!CP.shoot || CP.shoot.path !== shoot.path) return;
      var m = cpMeta(), now = new Date().toISOString(), who = cpActor();
      pids.forEach(function (pid) {
        var cur = m.downloads[pid];
        var stamp = { by: who, ts: now, export: name };
        m.downloads[pid] = { n: (cur ? cur.n : 0) + 1, first: cur ? cur.first : stamp, last: stamp };
      });
      cpEvent('download_cards', cpPhotoNames(pids), { export: name, count: r.files, parts: r.parts.length,
        card: cards.map(function (c) { return c.title + (cpCardLetter(c) ? ' (' + cpCardLetter(c) + ')' : ''); }).join(', ') });
      cbMarkDirty();
      cbRenderCards();
      cbRenderOutline();
    });
  }).catch(function (e) { cpHandleError(e, 'Скачивание отмеченных карточек'); });
}

/* ---------- сдача: папка «Сайт» ---------- */

function cpSiteRoot() { return (CP.settings && CP.settings.site) || ''; }

function cpListDirs(path) {
  return CPDisk.listDir(path).then(function (items) {
    return items.filter(function (it) { return it.type === 'dir'; });
  }, function (e) { if (e && e.status === 404) return []; throw e; });
}

/* в несколько потоков, по порядку результатов */
function cpPool(list, n, fn) {
  var out = new Array(list.length), i = 0;
  function next() {
    if (i >= list.length) return Promise.resolve();
    var k = i++;
    return fn(list[k], k).then(function (r) { out[k] = r; return next(); });
  }
  var runners = [];
  for (var j = 0; j < Math.min(n, list.length); j++) runners.push(next());
  return Promise.all(runners).then(function () { return out; });
}

/** Найти в «Сайте» папки текущей съёмки: [{path, date, letter, n}] */
function cpFindSiteShoots(root, shootName) {
  var want = shootName.toLowerCase();
  return cpListDirs(root).then(function (dates) {
    return cpPool(dates, 4, function (d) {
      return cpListDirs(d.path).then(function (outs) {
        return cpPool(outs, 4, function (o) {
          return cpListDirs(o.path).then(function (shoots) {
            var lm = /^([A-Za-zА-Яа-яЁё]{1,3})[\s_.-]*(\d+)?/.exec(o.name) || [];
            return shoots.filter(function (s) {
              var n = s.name.toLowerCase();
              return n === want || n.indexOf(want) !== -1;
            }).map(function (s) { return { path: s.path, date: d.name, letter: lm[1] || o.name, n: lm[2] || '', out: o.name }; });
          });
        });
      });
    });
  }).then(function (nested) {
    var flat = [];
    (nested || []).forEach(function (a) { (a || []).forEach(function (b) { (b || []).forEach(function (x) { flat.push(x); }); }); });
    return flat;
  });
}

function cpCheckSite() {
  if (!CP.shoot) return;
  var shoot = CP.shoot;
  var root;
  (typeof cpEnsureSettings === 'function' ? cpEnsureSettings() : Promise.resolve()).then(function () {
    root = cpSiteRoot();
    if (!root) throw { message: 'не задана папка «Сайт»: шестерёнка на витрине → «Папка сдачи (сайт)»', plain: true };
    cbBusyShow('Читаю папку сдачи «' + CPDisk.showPath(root) + '»...', 0.2);
    return cpFindSiteShoots(root, shoot.name);
  }).then(function (found) {
    return cpPool(found, 3, function (f) {
      return CPDisk.walkPhotos(f.path, false, 4, true).then(function (files) { f.files = files; return f; });
    });
  }).then(function (found) {
    cbBusyHide();
    if (!CP.shoot || CP.shoot.path !== shoot.path) return;
    /* папки артикулов: код артикула — первая группа цифр в имени папки (снизу вверх) */
    var folders = {};
    found.forEach(function (f) {
      f.files.forEach(function (file) {
        var rel = file.path.slice(f.path.length + 1);
        var segs = rel.split('/');
        segs.pop();
        if (!segs.length) return;
        var code = '', seg = segs[0];
        for (var i = segs.length - 1; i >= 0; i--) {
          var m = /(?:^|[^\d])(\d{4,7})(?!\d)/.exec(segs[i]);
          if (m) { code = m[1]; seg = segs[i]; break; }
        }
        var key = f.path + '|' + (code || seg);
        var x = folders[key] || (folders[key] = { code: code, name: seg, at: f.path + '/' + segs.join('/'), files: 0, date: f.date, letter: f.letter, out: f.out });
        x.files++;
      });
    });
    var del = {}, unmatched = [];
    Object.keys(folders).forEach(function (k) {
      var x = folders[k];
      /* все карточки этого артикула (бывает, что их две: собранная кнопкой и руками) */
      var cards = App.cards.filter(function (c) {
        return (x.code && (c.cpArticle === x.code || String(c.title || '').indexOf(x.code) !== -1)) || (!x.code && c.title === x.name);
      });
      if (!cards.length) { unmatched.push(x); return; }
      cards.forEach(function (card) {
        var cur = del[card.id];
        del[card.id] = { files: (cur ? cur.files : 0) + x.files, letter: x.letter, date: x.date, at: CPDisk.showPath(x.at), out: x.out, ts: new Date().toISOString() };
      });
    });
    cpMeta().delivered = del;
    var withPhotos = App.cards.filter(function (c) { return cpCardPids(c).length; });
    var missing = withPhotos.filter(function (c) { return !del[c.id]; });
    var nDel = Object.keys(del).length;
    cpEvent('site_check', [], { note: 'сдано карточек: ' + nDel + ' из ' + withPhotos.length + (unmatched.length ? ', папок без карточки: ' + unmatched.length : '') }, true);
    cbMarkDirty();
    cbRenderCards();
    cbRenderOutline();
    cpShowSiteReport(found, del, missing, unmatched, withPhotos.length, root);
    if (nDel && typeof cpRetouchCleanupSoon === 'function') cpRetouchCleanupSoon();
  }).catch(function (e) {
    cbBusyHide();
    if (e && e.plain) { cbToast('Проверить сдачу: ' + e.message); return; }
    cpHandleError(e, 'Проверка сдачи');
  });
}

function cpShowSiteReport(found, del, missing, unmatched, total, root) {
  var box = document.getElementById('cpSiteRep');
  if (!box) {
    box = document.createElement('div');
    box.className = 'cp-log';
    box.id = 'cpSiteRep';
    document.body.appendChild(box);
  }
  var nDel = Object.keys(del).length;
  var html = '<div class="cp-log-head"><b>Сдача · ' + nDel + ' из ' + total + '</b><button data-cp-sr="close">Закрыть</button></div><div class="cp-log-list">';
  html += '<div class="cp-vers-note">Папка сдачи: ' + cbEsc(CPDisk.showPath(root)) + '. Папок этой съёмки в ней: ' + found.length
    + (found.length ? ' (' + found.map(function (f) { return cbEsc(f.date + ' / ' + f.out); }).join(', ') + ')' : '') + '.</div>';
  if (missing.length) {
    html += '<div class="cp-log-item"><b>Не сдано (' + missing.length + ')</b><br>' + missing.map(function (c) {
      return cbEsc(c.title) + (cpCardLetter(c) ? ' <small>' + cbEsc(cpCardLetter(c)) + '</small>' : '');
    }).join(', ') + '</div>';
  }
  if (nDel) {
    html += '<div class="cp-log-item"><b>Сдано (' + nDel + ')</b>' + App.cards.filter(function (c) { return del[c.id]; }).map(function (c) {
      var d = del[c.id];
      return '<br>' + cbEsc(c.title) + ' <small>' + cbEsc(d.letter + ' · ' + d.date + ' · файлов ' + d.files) + '</small>';
    }).join('') + '</div>';
  }
  if (unmatched.length) {
    html += '<div class="cp-log-item"><b>Папки в «Сайте» без карточки в отборе (' + unmatched.length + ')</b>' + unmatched.map(function (x) {
      return '<br>' + cbEsc(x.name) + ' <small>' + cbEsc(x.letter + ' · ' + x.date + ' · файлов ' + x.files) + '</small>';
    }).join('') + '</div>';
  }
  if (!found.length) html += '<div class="cp-empty">Папок этой съёмки в «Сайте» пока нет. Ожидаемая раскладка: Сайт / дата / буква_номер / ' + cbEsc(CP.shoot.name) + ' / артикулы</div>';
  box.innerHTML = html + '</div>';
  box.classList.add('cp-open');
}

document.addEventListener('click', function (e) {
  var b = e.target.closest('[data-cp-sr="close"]');
  if (b) document.getElementById('cpSiteRep').classList.remove('cp-open');
});

/* «сдано» на шапке карточки */
cbRenderCards = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    if (!CP.shoot) return r;
    var del = cpDelivered();
    Array.prototype.forEach.call(document.querySelectorAll('#cbCards .cb-card'), function (el) {
      var id = el.getAttribute('data-cid');
      var card = cbCardById(id);
      el.style.display = card && !cpCardMatchesFolders(card) ? 'none' : '';
      var head = el.querySelector('.cb-card-head');
      if (!head || !del[id] || head.querySelector('.cp-card-del')) return;
      head.insertAdjacentHTML('beforeend', '<span class="cp-card-del" title="' + cbEsc(del[id].at) + '">Сдано · '
        + cbEsc(del[id].letter) + ' · ' + cbEsc(del[id].date) + '</span>');
    });
    return r;
  };
})(cbRenderCards);

/* ---------- папка сдачи в шестерёнке ---------- */

(function cpSiteSetting() {
  var ret = document.getElementById('cpSetRetouch');
  if (!ret) return;
  ret.insertAdjacentHTML('afterend', '<h5>Папка сдачи (сайт)</h5><div class="cp-set-line" id="cpSetSite">'
    + '<input id="cpSiteInput" spellcheck="false" placeholder="не задана" title="Куда ретушёры сдают готовое: Сайт / дата / буква_номер / съёмка / артикулы. Общая настройка, хранится в настройки.txt">'
    + '<button id="cpSiteApply">Сохранить</button></div>');
  var inp = document.getElementById('cpSiteInput');
  document.getElementById('cpSiteApply').onclick = function () {
    var raw = inp.value.trim();
    var v = raw ? cpNormArchive(raw) : '';
    var btn = this;
    btn.disabled = true;
    cpSaveSetting('сайт', v).then(function () {
      cbToast(v ? 'Папка сдачи: ' + CPDisk.showPath(v) : 'Папка сдачи не задана');
    }).catch(function (e) { cpHandleError(e, 'Не удалось сохранить настройку'); })
      .then(function () { btn.disabled = false; });
  };
  cpSettingsToUi = (function (orig) {
    return function () {
      orig.apply(this, arguments);
      if (document.activeElement !== inp) inp.value = (CP.settings && CP.settings.site) || '';
    };
  })(cpSettingsToUi);
  if (CPDisk.hasToken() && typeof cpEnsureSettings === 'function') cpEnsureSettings().then(function () { cpSettingsToUi(); }, function () { });
})();

/* ---------- фильтр карточек по папкам; открыть съёмку с отмеченными папками ---------- */

function cpSetCardFolders(list) {
  CP.cardFolders = list && list.length ? list.slice() : null;
  cbRenderCards();
  cbRenderOutline();
}

cpOpenShootNow = (function (orig) {
  return function (path, name) {
    /* отмеченные на панели папки этой съёмки — фильтр галереи и карточек после открытия */
    var sel = CP.sel;
    var folders = sel && sel.path === path ? Object.keys(sel.folders || {}).filter(function (k) { return sel.folders[k]; }) : [];
    CP.checked = {};
    CP.cardFolders = null;
    /* «Назад» в браузере: одна запись истории на съёмку (вторая съёмка её заменяет) */
    if (!CP.fromHistory) {
      try {
        if (history.state && history.state.cpShoot) history.replaceState({ cpShoot: path, name: name }, '');
        else history.pushState({ cpShoot: path, name: name }, '');
      } catch (e) { }
    }
    CP.fromHistory = false;
    CP.openFolders = { path: path, folders: folders };
    return orig.apply(this, arguments);
  };
})(cpOpenShootNow);

CP.openedHooks = CP.openedHooks || [];
CP.openedHooks.push(function (path) {
  var o = CP.openFolders;
  CP.openFolders = null;
  if (!o || o.path !== path || !o.folders.length) return;
  CP.folder = o.folders[0];
  CP.folderByCard = true;   /* в списке папок галереи — отдельным пунктом, если глубже второго уровня */
  CP.cardFolders = o.folders;
  cbRenderTray();
  cbRenderCards();
  cbRenderOutline();
});

window.addEventListener('popstate', function (e) {
  var st = e.state || {};
  var shelf = document.getElementById('cpShelf');
  if (st.cpShoot) {
    if (CP.shoot && CP.shoot.path === st.cpShoot) shelf.classList.remove('cp-open');
    else { CP.fromHistory = true; cpOpenShoot(st.cpShoot, st.name); }
  } else if (CP.shoot && !shelf.classList.contains('cp-open')) cpShowShelf();
});

/* ---------- панель скачивания на витрине можно скрыть ---------- */

function cpPanelHidden() { return cpGet('cp_panel_off', '') === '1'; }

(function cpPanelToggle() {
  var bar = document.getElementById('cpShelfBar');
  if (!bar) return;
  var b = document.createElement('button');
  b.id = 'cpPanelToggle';
  bar.insertBefore(b, bar.querySelector('.cp-set') || null);
  function sync() {
    var off = cpPanelHidden();
    document.body.classList.toggle('cp-panel-off', off);
    b.textContent = off ? 'Показать панель' : 'Скрыть панель';
    b.title = off ? 'Показывать панель съёмки (папки, теги, скачивание) по клику на съёмку' : 'Не показывать панель съёмки: двойной клик — открыть съёмку';
  }
  b.onclick = function () { cpSet('cp_panel_off', cpPanelHidden() ? '' : '1'); sync(); };
  sync();
})();

(function cpDeliverCss() {
  var css = ''
    + '.cp-oi{display:flex;align-items:center;gap:2px}.cp-oi .cb-outline-item{flex:1;min-width:0}'
    + '.cp-oi-ck{margin:0 0 0 10px;accent-color:#C9956B;flex:none}'
    + '.cp-oi-m{display:inline-flex;gap:4px;margin-left:6px;vertical-align:middle}'
    + '.cp-oi-l{font-size:10px;color:#e7c9a8;border:1px solid #5a4632;border-radius:8px;padding:0 5px}'
    + '.cp-oi-ok{font-size:10px;color:#9fc2a3}.cp-oi-dl{font-size:10px;color:#a3a09a}'
    + '.cb-outline-title a{color:#C9956B;font-size:10px;letter-spacing:0;text-transform:none;margin-left:6px}'
    + '.cp-obar{position:sticky;bottom:0;background:#161615;border-top:1px solid #2a2a28;padding:10px 12px;display:flex;flex-direction:column;gap:8px;margin-top:10px}'
    + '.cp-obar-n{font-size:11px;color:#a3a09a}.cp-obar-hint{font-size:10px;color:#a3a09a}'
    + '.cp-obar-l{display:flex;flex-wrap:wrap;gap:4px}.cp-obar-l button{min-width:28px;padding:3px 6px}'
    + '.cp-obar-s{display:grid;grid-template-columns:1fr 1fr;gap:4px}.cp-obar-s button{padding:4px 4px;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}'
    + '.cp-card-del{font-size:10px;color:#9fc2a3;border:1px solid #3d5a40;border-radius:10px;padding:1px 8px;margin-left:6px}'
    + 'body.cp-panel-off #cpPanel{display:none!important}';
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
})();
