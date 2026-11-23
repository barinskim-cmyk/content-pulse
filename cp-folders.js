/* Папка артикула в исходниках ↔ карточка. Сданные этапы сюда не входят. */
var CP_EXTRA_FRAMES = 'Лишние кадры';
var CP_ARTICLE_SYNC_MS = 45000;

function cpSixCode(name) {
  return (/^(\d{6})(?!\d)/.exec(String(name || '')) || [])[1] || '';
}

function cpSourceArticle(relative) {
  var segments = String(relative || '').split('/');
  if (segments[0] === CP_EXTRA_FRAMES) return null;
  for (var i = segments.length - 1; i >= 0; i--) {
    var code = cpSixCode(segments[i]);
    if (code) return { code: code, dir: segments.slice(0, i + 1).join('/') };
  }
  return null;
}

function cpLinkedArticle(card) {
  return card && card.cpArticleDir && cpSourceArticle(card.cpArticleDir);
}

function cpArticleJobs(path, id) {
  return Object.keys(CPQ.ops).map(function (key) { return CPQ.ops[key]; }).filter(function (entry) {
    return entry.shoot.path === path && /^article-(edit|brak)$/.test(entry.op.kind) && (!id || entry.op.card === id);
  });
}

function cpReleaseArticleJobs(path, card) {
  var held = cpArticleJobs(path, card).filter(function (entry) { return entry.op.held; });
  if (!held.length) return;
  held.forEach(function (entry) { entry.op.held = false; });
  cpqSave(held[0].shoot, function (m) {
    held.forEach(function (entry) { if (m.q[entry.op.id]) m.q[entry.op.id].held = false; });
  });
  cpqKick();
}

function cpStageRootsForEdit(shoot) {
  var settings = CP.settings || {};
  return [
    { key: 'approval', path: settings.approve || '' },
    { key: 'retouch', path: settings.retouch || (!cpCatalog() ? shoot.path + '/' + CPDisk.RETOUCH_DIR : ''), fixed: !settings.retouch && !cpCatalog() }
  ].filter(function (entry) { return entry.path; });
}

function cpQueueArticleEdit(card, pid, direction, fromDisk, migration) {
  var art = cpLinkedArticle(card), photo = cbPhotoById(pid), shoot = CP.shoot;
  if (!art || !photo || !photo.disk || !shoot || CP.readOnly || (photo.kind || 'photo') === 'ref') return;
  var root = shoot.path.replace(/\/+$/, ''), src = photo.disk;
  if (src.indexOf(root + '/') !== 0) return;
  var dest = root + '/' + art.dir;
  var inFolder = src.indexOf(dest + '/') === 0;
  var jobs = cpArticleJobs(shoot.path, card.id);
  if (jobs.some(function (entry) { return entry.op.kind === 'article-brak'; })) {
    if (!fromDisk) cbToast('Дождитесь переименования папки артикула. Состав обновится по Диску.');
    return;
  }
  var related = jobs.filter(function (entry) { return entry.op.pid === pid; });
  var last = related.length ? related[related.length - 1].op : null;
  if (last && last.direction === direction) return;
  if (last && last.held) {
    cpqDrop(last.id);
    return;
  }
  var dependency = !fromDisk && last ? last.id : '';
  if (!dependency && !fromDisk && ((direction === 'add' && inFolder) || (direction === 'remove' && !inFolder))) return;
  if (direction === 'remove' && !photo.md5) {
    cbToast('Кадр не перемещён: обновите съёмку, чтобы проверить файл на Диске.');
    return;
  }
  CPQ.add(shoot, {
    kind: 'article-edit', label: (direction === 'add' ? 'Добавить в артикул ' : 'Убрать из артикула ') + art.code,
    card: card.id, pid: pid, root: root, article: art.dir, code: art.code, direction: direction,
    source: src, name: photo.name, digest: photo.md5 || '',
    stageRoots: migration ? [] : cpStageRootsForEdit(shoot),
    fromDisk: !!fromDisk, held: !fromDisk, waitsFor: dependency ? [dependency] : [], undoPrevious: dependency,
    after: { type: 'article-edit' }
  });
}

/* Пишем только проверенный файл и никогда не замещаем файл с другим содержимым. */
function cpArticleMeta(path) {
  return CPDisk.meta(path).catch(function (e) { if (e && e.status === 404) return null; throw e; });
}

function cpArticleMediaOp(from, to, digest, moving) {
  return Promise.all([cpArticleMeta(from), cpArticleMeta(to)]).then(function (state) {
    var source = state[0], target = state[1];
    if (!source && moving && target && digest && target.md5 === digest) return to;
    if (!source || (digest && source.md5 !== digest)) throw { message: 'Файл изменился на Диске: ' + CPDisk.showPath(from), conflict: true };
    var check = digest || source.md5 || '';
    if (target && !moving && check && target.md5 === check) return to;
    if (target && moving && check && target.md5 === check) {
      return CPDisk.trash([from]).then(function (out) {
        if (out && out[0] && /^(done|gone)$/.test(out[0].status)) return to;
        throw { message: 'Не удалось убрать повторный экземпляр; кадр уже есть в «Лишних кадрах»' };
      });
    }
    if (target) {
      var dot = to.lastIndexOf('.'), end = dot > to.lastIndexOf('/') ? dot : to.length;
      var next = to.slice(0, end) + '_' + (check || cpHash(from)).slice(0, 8) + to.slice(end);
      if (to === next || /_[a-f0-9]{8}$/.test(to.slice(0, end))) throw { message: 'Два разных файла с одним именем: ' + CPDisk.showPath(to), conflict: true };
      return cpArticleMediaOp(from, next, check, moving);
    }
    return CPDisk.ensureDir(cpParentDir(to)).then(function () {
      return moving ? CPDisk.proxyMove([{ from: from, path: to }]) : CPDisk.proxyCopy([{ from: from, path: to }], []);
    }).then(function (out) {
      var r = (out.results || [])[0];
      if (r && r.status === 'done') return to;
      if (moving && r && /^(timeout|gone)$/.test(r.status)) {
        return Promise.all([cpArticleMeta(from), cpArticleMeta(to)]).then(function (after) {
          if (!after[0] && after[1] && check && after[1].md5 === check) return to;
          throw { message: 'Диск пока не подтвердил перенос' };
        });
      }
      if (!moving && r && r.status === 'exists') {
        return cpArticleMeta(to).then(function (after) {
          if (after && check && after.md5 === check) return to;
          throw { message: 'Путь занят: ' + CPDisk.showPath(to), conflict: true };
        });
      }
      throw { message: (r && r.error) || 'Диск не подтвердил операцию' };
    });
  });
}

function cpArticleUpdateStages(op, shoot, source) {
  if (!op.stageRoots.length) return Promise.resolve();
  return cpDictReady().then(function () {
    var letters = cpRetoucherTags();
    return op.stageRoots.reduce(function (chain, stage) {
      return chain.then(function () {
        var find = stage.fixed ? Promise.resolve([{ path: stage.path }]) : cpFindShootIn(stage.path, shoot.name, 3);
        var paths = [];
        return find.then(function (roots) {
          paths = roots.map(function (x) { return x.path; });
          return cpRtListDirs(paths, letters, cpShootType(shoot.name));
        }).then(function (byCode) {
          var parent = op.article.indexOf('/') === -1 ? '' : cpParentDir(op.article);
          var folders = (byCode[op.code] || []).filter(function (d) {
            return paths.some(function (path) { return d.parent === path + (parent ? '/' + parent : ''); });
          });
          return folders.reduce(function (p, folder) {
            return p.then(function () {
              return CPDisk.walkPhotos(folder.path, false, 2, true).then(function (files) {
                var digest = op.digest, same = files.filter(function (file) { return digest && file.md5 === digest; });
                var named = same.filter(function (file) { return cpStem(file.name) === cpStem(op.name); });
                if (op.direction === 'add') {
                  var added = named.length ? Promise.resolve() : cpArticleMediaOp(source, folder.path + '/' + op.name, op.digest, false);
                  return added.then(function () { op.reached = stage.key; });
                }
                var matches = named.length ? named : same.length === 1 ? same : [];
                return matches.reduce(function (done, file) {
                  return done.then(function () {
                    var hidden = stage.path + '/_Лишние кадры/' + shoot.name + '/' + op.article;
                    return cpArticleMediaOp(file.path, hidden + file.path.slice(folder.path.length), op.digest, true);
                  });
                }, Promise.resolve());
              });
            });
          }, Promise.resolve());
        });
      });
    }, Promise.resolve());
  });
}

function cpRunArticleEdit(op, shoot) {
  var target = op.root + '/' + op.article + '/' + op.name;
  if (op.undoPrevious) return Promise.resolve({ ok: false, err: 'Не подтверждён предыдущий перенос этого кадра', stuck: true });
  var archive = op.root + '/' + CP_EXTRA_FRAMES + '/' + op.article;
  var articlePath = op.root + '/' + op.article;
  var relative = op.source.indexOf(articlePath + '/') === 0 ? op.source.slice(articlePath.length) : '/' + op.name;
  var work = op.resultPath || op.fromDisk ? Promise.resolve(op.resultPath || op.source)
    : op.direction === 'add' ? cpArticleMediaOp(op.source, target, op.digest, false)
      : cpArticleMediaOp(op.source, archive + relative, op.digest, true);
  return work.then(function (path) {
    op.resultPath = path;
    return cpArticleUpdateStages(op, shoot, path);
  }).then(function () { return { ok: true }; }, function (e) {
    return { ok: false, err: e && e.message || 'Не удалось синхронизировать папку', stuck: !!(e && e.conflict) };
  });
}

CPQ.after['article-edit'] = function (op, m, shoot) {
  Object.keys(CPQ.ops).forEach(function (id) {
    var entry = CPQ.ops[id], next = entry.op;
    if (entry.shoot.path !== shoot.path || next.undoPrevious !== op.id) return;
    next.source = op.resultPath;
    next.undoPrevious = '';
    m.q[id] = next;
  });
  m.status = m.status || {};
  var current = m.status[op.pid];
  if (op.direction === 'add') {
    if (!op.fromDisk) {
      var copies = m.articleCopies = m.articleCopies || {};
      (copies[op.card] = copies[op.card] || {})[op.pid] = op.resultPath;
    }
    if (op.reached && (!current || current.s === 'removed')) {
      m.status[op.pid] = { s: op.reached, card: op.card, by: op.by, ts: new Date().toISOString() };
    }
  } else if (current && current.card === op.card && /^(approval|retouch)$/.test(current.s)) {
    if (((m.downloads || {})[op.pid] || {}).n) {
      m.status[op.pid] = Object.assign({}, current, { s: 'removed', was: current.s });
    } else delete m.status[op.pid];
  }
};

function cpArticleIsBrak(path) { return /_брак$/i.test(path || ''); }
function cpArticleWithoutBrak(path) { return String(path || '').replace(/_брак$/i, ''); }
function cpWholeLinkedCard(card, pids) {
  return !!(cpLinkedArticle(card) && !card.cpFolderMissing && (pids || []).length &&
    cpCardPids(card).every(function (id) { return pids.indexOf(id) !== -1; }));
}

function cpQueueArticleBrak(card, active, info) {
  var shoot = CP.shoot, art = cpLinkedArticle(card);
  if (!shoot || !art || CP.readOnly || card.cpFolderMissing) return;
  var jobs = cpArticleJobs(shoot.path, card.id);
  if (jobs.some(function (entry) { return entry.op.kind === 'article-brak'; })) return;
  var root = active ? cpBrakRoot(shoot.name) : '';
  if (active && !root) return;
  var source = shoot.path.replace(/\/+$/, '') + '/' + art.dir;
  var bare = cpArticleWithoutBrak(art.dir);
  var rel = active ? bare + '_брак' : bare;
  if (cpArticleIsBrak(art.dir) === active) rel = art.dir;
  var id = cpqId();
  var version = new Date().toISOString().replace(/[:.]/g, '-') + '-' + id;
  cpReleaseArticleJobs(shoot.path, card.id);
  CPQ.add(shoot, {
    id: id, kind: 'article-brak', label: (active ? 'В брак: ' : 'Снять брак: ') + art.code,
    card: card.id, pids: cpCardPids(card), source: source, target: shoot.path.replace(/\/+$/, '') + '/' + rel,
    archive: active ? root + '/_Версии/' + version + '/' + rel : '',
    assignment: info || {}, waitsFor: jobs.map(function (entry) { return entry.op.id; }), after: { type: 'article-brak' }
  });
}

function cpRunArticleBrak(op) {
  return Promise.all([cpArticleMeta(op.source), cpArticleMeta(op.target)]).then(function (meta) {
    if (op.source !== op.target && meta[0] && meta[1]) throw { conflict: true, message: 'Обе папки артикула уже есть на Диске' };
    if (!meta[0] && !meta[1]) throw { conflict: true, message: 'Папка артикула исчезла с Диска' };
    var copy = op.archive ? cpArticleMeta(op.archive).then(function (exists) {
      if (exists && exists.type === 'dir') return;
      return CPDisk.proxyCopy([{ from: meta[0] ? op.source : op.target, path: op.archive }], []).then(function (out) {
        var result = (out.results || [])[0];
        if (!result || !/^(done|exists)$/.test(result.status)) throw { message: result && result.error || 'Диск пока не подтвердил архивную копию' };
        return cpArticleMeta(op.archive).then(function (folder) {
          if (!folder || folder.type !== 'dir') throw { message: 'Архивная копия ещё не видна на Диске' };
        });
      });
    }) : Promise.resolve();
    return copy.then(function () {
      if (op.source === op.target || !meta[0]) return;
      return CPDisk.proxyMove([{ from: op.source, path: op.target }]).then(function (out) {
        return Promise.all([cpArticleMeta(op.source), cpArticleMeta(op.target)]).then(function (after) {
          if (!after[0] && after[1] && after[1].type === 'dir') return;
          throw { message: ((out.results || [])[0] || {}).error || 'Диск пока не подтвердил переименование папки' };
        });
      });
    });
  }).then(function () { return { ok: true }; }, function (e) {
    return { ok: false, err: e && e.message || 'Не удалось сохранить брак', stuck: !!(e && e.conflict) };
  });
}

CPQ.after['article-brak'] = function (op, m, shoot) {
  var records = m.articleBrak = m.articleBrak || {}, now = new Date().toISOString(), info = op.assignment;
  var prior = records[op.card];
  var status = { s: 'reshoot', by: op.by, ts: now, kind: info.kind, note: info.note };
  if (op.archive) {
    m.cardStatus[op.card] = status;
    records[op.card] = { path: op.archive };
    op.pids.forEach(function (id) { m.status[id] = Object.assign({ card: op.card }, status); });
  } else {
    delete records[op.card];
    if ((m.cardStatus[op.card] || {}).s === 'reshoot') delete m.cardStatus[op.card];
    op.pids.forEach(function (id) {
      if ((m.status[id] || {}).s === 'reshoot' && m.status[id].card === op.card) delete m.status[id];
    });
  }
  if (!op.archive && !prior && op.source === op.target) return;
  m.events = m.events || [];
  m.events.push({ ts: now, action: op.archive ? 'to_reshoot' : 'clear_status', actor: op.by, items: [], note: op.target });
  if (CP.shoot && CP.shoot.path === shoot.path) {
    cpOutputAppend([[now.slice(0, 10), now.slice(11, 16), shoot.name, cpFolderBase(op.target),
      op.pids.length, cpBrakKindLabel(info.kind), info.note || '', op.by, op.archive ? 'в брак' : 'снято']], CP_BRAK_FILE, CP_BRAK_HEAD);
  }
};
CPQ.redraw['article-brak'] = true;

/* Состав проверяется по полному снимку исходников, с учётом локальной очереди. */
function cpReconcileArticleCard(card, incoming, fresh, renamed) {
  var m = cpMeta(), previous = cpCardPids(card), byPath = Object.create(null);
  incoming.forEach(function (photo) { byPath[photo.disk] = photo.id; });
  var jobs = cpArticleJobs(CP.shoot.path, card.id), removed = {}, held = {};
  jobs.forEach(function (entry) {
    var op = entry.op;
    if (op.direction === 'remove') { delete held[op.pid]; removed[op.pid] = true; }
    if (op.direction === 'add') { delete removed[op.pid]; held[op.pid] = true; }
  });
  var savedCopies = (m.articleCopies || {})[card.id] || {}, copies = Object.assign({}, savedCopies);
  Object.keys(copies).forEach(function (old) {
    var mapped = byPath[copies[old]], status = m.status[old];
    if (!mapped || mapped === old) return;
    if (status && status.card === card.id) {
      if (!m.status[mapped]) m.status[mapped] = status;
      delete m.status[old];
    }
    delete savedCopies[old];
  });
  var expected = incoming.map(function (photo) { return photo.id; }).filter(function (id) { return !removed[id]; });
  var ordered = previous.map(function (id) { return byPath[copies[id]] || id; }).filter(function (id, i, ids) {
    return ids.indexOf(id) === i && (expected.indexOf(id) !== -1 || held[id] || (!fresh && !removed[id]));
  });
  expected.forEach(function (id) { if (ordered.indexOf(id) === -1) ordered.push(id); });
  if (!card.cpFolderLinked) {
    card.cpFolderLinked = true;
    previous.forEach(function (id) {
      if (expected.indexOf(id) === -1 && !held[id]) cpQueueArticleEdit(card, id, 'add', false, true);
    });
    ordered = previous.slice();
    expected.forEach(function (id) { if (ordered.indexOf(id) === -1) ordered.push(id); });
    if (jobs.length || cpArticleJobs(CP.shoot.path, card.id).length) cpReleaseArticleJobs(CP.shoot.path, card.id);
  } else if (fresh && !renamed) {
    previous.forEach(function (id) {
      if (ordered.indexOf(byPath[copies[id]] || id) === -1 && !removed[id]) cpQueueArticleEdit(card, id, 'remove', true);
    });
    expected.forEach(function (id) {
      var own = previous.some(function (old) { return byPath[copies[old]] === id; });
      if (previous.indexOf(id) === -1 && !own && !held[id]) cpQueueArticleEdit(card, id, 'add', true);
    });
  }
  if (card.mode === 'auto') card.pids = ordered;
  else {
    var remaining = ordered.slice();
    (card.slots || []).forEach(function (slot) {
      var id = byPath[copies[slot.pid]] || slot.pid, index = remaining.indexOf(id);
      slot.pid = index === -1 ? null : remaining.splice(index, 1)[0];
    });
    (card.slots || []).forEach(function (slot) { if (!slot.pid && remaining.length) slot.pid = remaining.shift(); });
    /* Если на Диск добавили больше, чем вмещает шаблон, кадры остаются доступны. */
    remaining.forEach(function (id) { card.slots.push({ pid: id, orient: 'v', row: card.slots.length, name: '' }); });
  }
  var changed = previous.join('|') !== cpCardPids(card).join('|');
  return { changed: changed, added: expected.filter(function (id) { return previous.indexOf(id) === -1; }).length };
}

/* Свежий снимок после очереди или ручной работы коллег на Диске. */
var cpArticleRefreshTimer = null, cpArticleReading = false;
function cpArticleRefresh(path) {
  if (!CP.shoot || CP.shoot.path !== path || CP.readOnly || cpArticleReading
    || document.hidden || CP.saving || App.dirty || cpArticleJobs(path).some(function (x) { return !x.op.stuck; })) return;
  cpArticleReading = true;
  return cpSyncPhotos(false).catch(function (e) {
    if (window.console) console.warn('[CP] папки артикулов не прочитались', e && e.message);
  }).then(function () { cpArticleReading = false; });
}

function cpArticleRefreshSoon(path) {
  clearTimeout(cpArticleRefreshTimer);
  cpArticleRefreshTimer = setTimeout(function () { cpArticleRefresh(path); }, 1600);
}

setInterval(function () {
  var shelf = document.getElementById('cpShelf');
  if (!CP.shoot || document.hidden || !shelf || shelf.classList.contains('cp-open')) return;
  if (CP_SHOOT_VIEW.key === 'source') cpArticleRefresh(CP.shoot.path);
  else if (!CP_SHOOT_VIEW.loading && !document.querySelector('#cpShootStagePreview img')) cpShowShootStage(CP_SHOOT_VIEW.key, true);
}, CP_ARTICLE_SYNC_MS);

function cpConfirmArticleLeave() {
  if (!CP.shoot) return true;
  var path = CP.shoot.path;
  if (!cpArticleJobs(path).length && !Object.values(CPQ.ops).some(function (entry) {
    return entry.shoot.path === path && entry.op.kind === 'stage-trash';
  })) return true;
  cpReleaseArticleJobs(path);
  if (!CP.readOnly) cpBackupSave(path, cbProjectData(), CP.rev);
  return confirm('Изменения карточек ещё не сохранены на Диске. Синхронизация запущена. Переключиться сейчас?');
}

(function () {
  var show = window.cpShowShelf;
  window.cpShowShelf = function () {
    if (!cpConfirmArticleLeave()) return;
    return show.apply(this, arguments);
  };
})();

/* Переключатели внутри открытой съёмки. Вкладки этапов не меняют App.cards. */
var CP_SHOOT_STAGE_LABELS = {
  source: 'Исходники', approval: 'Отбор', retouch: 'Ретушь', review: 'Отретушировано', site: 'Сайт'
};
var CP_SHOOT_VIEW = { key: 'source', request: 0, chosen: '' };

(function () {
  var work = document.getElementById('cbWork'), tabs = work.querySelector('.cb-tabs');
  var bar = document.createElement('nav');
  bar.id = 'cpShootStageTabs';
  bar.className = 'cp-shoot-stage-tabs';
  bar.hidden = true;
  bar.setAttribute('aria-label', 'Этапы съёмки');
  tabs.parentNode.insertBefore(bar, tabs);
  var view = document.createElement('section');
  view.id = 'cpShootStageView';
  view.hidden = true;
  tabs.parentNode.insertBefore(view, tabs);
  var css = document.createElement('style');
  css.textContent = '.cp-shoot-stage-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid #3a3a37}'
    + '.cp-shoot-stage-tabs[hidden],#cpShootStageView[hidden]{display:none}'
    + '.cp-shoot-stage-tabs button,.cp-stage-view-articles button,.cp-stage-view-refresh{padding:5px 10px;border-radius:5px}'
    + '.cp-shoot-stage-tabs .cp-on,.cp-stage-view-articles .cp-on{background:#392b20;color:#f2dfc8;border-color:#C9956B}'
    + 'body.cp-viewing-stage .cb-tray,body.cp-viewing-stage .cb-resizer,body.cp-viewing-stage #cbOutline,body.cp-viewing-stage .cb-strip,body.cp-viewing-stage #cbWork>.cb-tabs,body.cp-viewing-stage #cbTabCards,body.cp-viewing-stage #cbTabConts,body.cp-viewing-stage #cbBtnAdd{display:none!important}'
    + '.cp-stage-view-head,.cp-stage-view-articles{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 12px}'
    + '.cp-stage-view-articles small{color:#dac2a9}.cp-stage-view-files{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}'
    + '.cp-stage-view-files button{text-align:left;overflow-wrap:anywhere;padding:10px}.cp-stage-view-files small{display:block;color:#dac2a9}'
    + '#cpShootStagePreview img{display:block;max-width:100%;max-height:65vh;margin:0 auto 16px;object-fit:contain}';
  document.head.appendChild(css);
  bar.addEventListener('click', function (e) {
    var button = e.target.closest('[data-cp-shoot-stage]');
    if (button) cpShowShootStage(button.getAttribute('data-cp-shoot-stage'));
  });
  view.addEventListener('click', function (e) {
    var article = e.target.closest('[data-cp-stage-article]'), refresh = e.target.closest('[data-cp-stage-refresh]'), file = e.target.closest('[data-cp-stage-preview]');
    if (refresh) cpShowShootStage(CP_SHOOT_VIEW.key, true);
    if (article) {
      CP_SHOOT_VIEW.chosen = article.getAttribute('data-cp-stage-article');
      cpRenderShootStage();
    }
    if (file) cpPreviewShootStageFile(+file.getAttribute('data-cp-stage-preview'));
    var trash = e.target.closest('[data-cp-stage-trash]');
    if (trash) cpTrashShootStageFile(+trash.getAttribute('data-cp-stage-trash'));
  });
})();

function cpShootStageRoot(key) {
  var roots = CP.settings || {};
  return roots[CP_STAGE_SETTING[key]] || (key === 'retouch' && !cpCatalog() ? cpRetouchBase(CP.shoot.path, CP.shoot.name) : '');
}

function cpRenderShootStageTabs() {
  var bar = document.getElementById('cpShootStageTabs');
  bar.hidden = !CP.shoot;
  if (!CP.shoot) return;
  bar.innerHTML = Object.keys(CP_SHOOT_STAGE_LABELS).filter(function (key) {
    return key === 'source' || cpShootStageRoot(key);
  }).map(function (key) {
    var active = key === CP_SHOOT_VIEW.key;
    return '<button type="button" data-cp-shoot-stage="' + key + '" aria-pressed="' + active + '"' + (active ? ' class="cp-on"' : '') + '>'
      + CP_SHOOT_STAGE_LABELS[key] + '</button>';
  }).join('');
}

function cpShowShootStage(key, refresh) {
  if (!CP.shoot || (!refresh && key === CP_SHOOT_VIEW.key)) return;
  if (!refresh && !cpConfirmArticleLeave()) return;
  var shoot = CP.shoot, selected = cbCardById(CP.activeCard), previous = CP_SHOOT_VIEW;
  var root = key === 'source' ? '' : cpShootStageRoot(key);
  var mode = { key: key, chosen: previous.key === 'source' && selected ? selected.cpArticle || cpSixCode(selected.title) : previous.chosen, files: [], loading: !!root };
  CP_SHOOT_VIEW = mode;
  document.body.classList.toggle('cp-viewing-stage', key !== 'source');
  document.getElementById('cpShootStageView').hidden = key === 'source';
  cpRenderShootStageTabs();
  if (key === 'source') return;
  cpRenderShootStage();
  if (!root) return;
  var low = shoot.name.toLowerCase(), stageKey = key;
  var fixed = key === 'retouch' && !((CP.settings || {}).retouch);
  var scan = function (path) { return cpFindShootIn(path, shoot.name, key === 'site' ? 6 : 3); };
  var find = fixed ? Promise.resolve([{ path: root }]) : key === 'site' && (CP.settings.siteMore || []).length
    ? cpPool([root].concat(CP.settings.siteMore), 2, scan).then(function (groups) { return [].concat.apply([], groups); })
    : scan(root);
  if (key === 'site' && CP.stageFor === CP.archive && (((CP.stagePaths || {}).site || {})[low] || []).length && !refresh) {
    find = Promise.resolve(CP.stagePaths.site[low].map(function (path) { return { path: path }; }));
  }
  find.then(function (roots) {
    return cpPool(roots, 2, function (entry) {
      return CPDisk.walkPhotos(entry.path, false, 4, true).then(function (files) { return { root: entry.path, files: files, dirs: files.dirs || [] }; },
        function (e) { if (e && e.status === 404) return { root: entry.path, files: [], dirs: [] }; throw e; });
    });
  }).then(function (stageFiles) {
    if (CP_SHOOT_VIEW !== mode || CP.shoot !== shoot) return;
    var sel = { path: shoot.path, name: shoot.name, stage: stageKey, stageFiles: stageFiles, data: cbProjectData() };
    cpStageTagIndex(sel);
    var letters = cpRetoucherTags(), type = cpShootType(shoot.name);
    mode.files = [];
    mode.groups = Object.create(null);
    stageFiles.forEach(function (group) {
      group.dirs.forEach(function (dir) {
        var article = cpRtArtDir(group.root, dir + '/x', letters, type);
        if (article && article.path === dir && !mode.groups[article.code]) mode.groups[article.code] = [];
      });
      group.files.forEach(function (file) {
        var article = cpRtArtDir(group.root, file.path, letters, type);
        var code = article ? article.code : cpFileArticleCode(file.name, letters);
        var meta = { file: file, code: code, letter: article && article.letter || '', index: mode.files.length, rel: file.path.slice(group.root.length + 1) };
        mode.files.push(meta);
        (mode.groups[code] = mode.groups[code] || []).push(meta);
      });
    });
    mode.loading = false;
    cpRenderShootStage();
  }).catch(function (e) {
    if (CP_SHOOT_VIEW !== mode) return;
    mode.loading = false; mode.error = e && e.message || 'Не удалось прочитать папки';
    cpRenderShootStage();
  });
}

function cpRenderShootStage() {
  var view = document.getElementById('cpShootStageView'), mode = CP_SHOOT_VIEW;
  if (mode.key === 'source') return;
  var h = '<div class="cp-stage-view-head"><strong>' + CP_SHOOT_STAGE_LABELS[mode.key] + '</strong>'
    + '<button type="button" data-cp-stage-refresh class="cp-stage-view-refresh">Обновить</button></div>';
  if (mode.loading) { view.innerHTML = h + '<p>Читаю папки на Диске…</p>'; return; }
  if (mode.error) { view.innerHTML = h + '<p>' + cbEsc(mode.error) + '</p>'; return; }
  var codes = Object.keys(mode.groups || {}).filter(Boolean).sort();
  if (!mode.files.length && !codes.length) { view.innerHTML = h + '<p>На этом этапе у съёмки пока нет файлов.</p>'; return; }
  if (mode.chosen && !mode.groups[mode.chosen]) mode.chosen = '';
  if (codes.length) h += '<div class="cp-stage-view-articles">'
    + '<button type="button" data-cp-stage-article=""' + (!mode.chosen ? ' class="cp-on"' : '') + '>Все папки</button>'
    + codes.map(function (code) {
      var group = mode.groups[code], tags = Object.create(null);
      group.forEach(function (x) {
        if (x.letter) tags[x.letter] = true;
        if (x.file.cpStageStatus) tags[x.file.cpStageStatus] = true;
      });
      return '<button type="button" data-cp-stage-article="' + cbEsc(code) + '"' + (code === mode.chosen ? ' class="cp-on"' : '') + '>'
        + cbEsc(code) + ' <small>' + group.length + (Object.keys(tags).length ? ' · ' + cbEsc(Object.keys(tags).join(' · ')) : '') + '</small></button>';
    }).join('') + '</div>';
  var list = mode.chosen ? mode.groups[mode.chosen] : mode.files;
  h += '<div id="cpShootStagePreview"></div>';
  if (!list.length) h += '<p>Папка артикула пуста.</p>';
  else h += '<div class="cp-stage-view-files">' + list.map(function (x) {
    return '<button type="button" data-cp-stage-preview="' + x.index + '">'
      + cbEsc(x.file.name) + '<small>' + cbEsc(x.rel) + (x.file.cpStageStatus ? ' · ' + cbEsc(x.file.cpStageStatus) : '') + '</small></button>';
  }).join('') + '</div>';
  view.innerHTML = h;
}

function cpPreviewShootStageFile(index) {
  var mode = CP_SHOOT_VIEW, item = mode.files[index], box = document.getElementById('cpShootStagePreview');
  if (!item || !box) return;
  box.innerHTML = '<p>' + cbEsc(item.file.name) + '</p>'
    + (CP.readOnly ? '' : '<button type="button" data-cp-stage-trash="' + index + '">Убрать с этапа</button>')
    + '<div class="cp-stage-preview-image">Загружаю превью…</div>';
  var preview = box.querySelector('.cp-stage-preview-image');
  CPDisk.proxyPreview(item.file.path, 'XL').then(function (blob) {
    if (CP_SHOOT_VIEW !== mode || document.getElementById('cpShootStagePreview') !== box) return;
    var image = document.createElement('img'), url = URL.createObjectURL(blob);
    image.alt = item.file.name;
    image.onload = image.onerror = function () { URL.revokeObjectURL(url); };
    image.src = url;
    preview.replaceChildren(image);
  }).catch(function () {
    if (CP_SHOOT_VIEW === mode && document.getElementById('cpShootStagePreview') === box) box.textContent = 'Превью недоступно: ' + item.file.name;
  });
}

function cpTrashShootStageFile(index) {
  var mode = CP_SHOOT_VIEW, item = mode.files[index];
  if (!CP.shoot || CP.readOnly || mode.key === 'source' || !item) return;
  var path = item.file.path;
  if (Object.values(CPQ.ops).some(function (entry) { return entry.op.kind === 'stage-trash' && entry.op.path === path; })) return;
  if (!confirm('Убрать «' + item.file.name + '» с этапа «' + CP_SHOOT_STAGE_LABELS[mode.key] + '» в Корзину Диска?')) return;
  CPQ.add(CP.shoot, {
    kind: 'stage-trash', label: 'Убрать с этапа: ' + item.file.name, stage: mode.key,
    path: path, digest: item.file.md5 || '', size: item.file.size, rid: item.file.resource_id || '',
    after: { type: 'stage-trash' }
  });
}

function cpRunStageTrash(op) {
  return cpArticleMeta(op.path).then(function (meta) {
    if (!meta) return { ok: true };
    if (meta.type !== 'file' || meta.size !== op.size || (op.digest && op.digest !== meta.md5)
      || (op.rid && op.rid !== meta.resource_id)) {
      return { ok: false, stuck: true, err: 'Файл заменили на Диске. Обновите этап и проверьте его.' };
    }
    return CPDisk.trash([op.path]).then(function (out) {
      var result = (out || [])[0];
      return result && /^(done|gone)$/.test(result.status) ? { ok: true } : { ok: false, err: 'Диск не подтвердил удаление' };
    });
  }).catch(function (e) { return { ok: false, err: e && e.message || 'Не удалось открыть файл на Диске' }; });
}

CPQ.after['stage-trash'] = function (op, m) {
  if (op.stage !== 'review') return;
  Object.values(m.rv || {}).forEach(function (list) {
    var latest = list[list.length - 1];
    if (!latest || !/^(review|rework)$/.test(latest.status)) return;
    latest.files = (latest.files || []).filter(function (f) { return f.path !== op.path; });
    if (!latest.files.length) latest.status = 'removed';
  });
};
CPQ.redraw['stage-trash'] = true;

CP.openedHooks.push(function () {
  CP_SHOOT_VIEW = { key: 'source', chosen: '' };
  document.body.classList.remove('cp-viewing-stage');
  document.getElementById('cpShootStageView').hidden = true;
  cpRenderShootStageTabs();
  cpEnsureSettings().then(cpRenderShootStageTabs, function () { });
});
