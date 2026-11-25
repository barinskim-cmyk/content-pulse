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
    return entry.shoot.path === path && /^article-(edit|brak|save|send)$/.test(entry.op.kind) && (!id || entry.op.card === id);
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
        throw { message: 'Не удалось убрать повторный экземпляр; тот же кадр уже есть в целевой папке' };
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
          var folders = cpStageArticleDirs(byCode[op.code], paths, op.article);
          return folders.reduce(function (p, folder) {
            return p.then(function () {
              return CPDisk.walkPhotos(folder.path, false, 2, true).then(function (files) {
                var digest = op.digest, same = files.filter(function (file) { return digest && file.md5 === digest; });
                var named = same.filter(function (file) { return cpStem(file.name) === cpStem(op.name); });
                if (op.direction === 'add') {
                  var articleRoot = op.root + '/' + op.article + '/';
                  var relative = source.indexOf(articleRoot) === 0 ? source.slice(articleRoot.length) : op.name;
                  var target = folder.path + '/' + relative;
                  var have = named.find(function (file) { return cpParentDir(file.path) === cpParentDir(target); });
                  var added = have ? Promise.resolve(have.path) : cpArticleMediaOp(source, target, op.digest, false);
                  return added.then(function (path) {
                    op.reached = stage.key;
                    if (stage.key === 'approval') op.approvedPath = path;
                  });
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

/* В модельной структуре лук — непосредственная родительская папка артикула. */
function cpModelArticleLook(shootName, relative) {
  var type = cpShootType(shootName);
  return type && type.roles.indexOf('лук') !== -1 && relative.indexOf('/') !== -1 ? cpParentDir(relative) : '';
}

function cpRunArticleEdit(op, shoot) {
  var target = op.root + '/' + op.article + '/' + op.name;
  if (op.undoPrevious) return Promise.resolve({ ok: false, err: 'Не подтверждён предыдущий перенос этого кадра', stuck: true });
  var removalDir = op.root + '/' + (op.look || CP_EXTRA_FRAMES + '/' + op.article);
  var articlePath = op.root + '/' + op.article;
  var relative = !op.look && op.source.indexOf(articlePath + '/') === 0 ? op.source.slice(articlePath.length) : '/' + op.name;
  var work = op.resultPath || op.fromDisk ? Promise.resolve(op.resultPath || op.source)
    : op.direction === 'add' ? cpArticleMediaOp(op.source, target, op.digest, false)
      : cpArticleMediaOp(op.source, removalDir + relative, op.digest, true);
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
    if (op.approvedPath) (m.ap2 = m.ap2 || {})[op.pid] = op.approvedPath;
    if (op.reached && (!current || current.s === 'removed')) {
      m.status[op.pid] = { s: op.reached, card: op.card, by: op.by, ts: new Date().toISOString() };
    }
  } else if (current && current.card === op.card && /^(approval|retouch)$/.test(current.s)) {
    if (m.ap2) delete m.ap2[op.pid];
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
  if (!cpCommitArticleDraft(card.id)) return;
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
  if (cpDrafts()[card.id]) return { changed: false, added: 0 };
  var m = cpMeta(), previous = cpCardPids(card), byPath = Object.create(null);
  incoming.forEach(function (photo) { byPath[photo.disk] = photo.id; });
  var jobs = cpArticleJobs(CP.shoot.path, card.id), removed = {}, held = {};
  cpArticlePendingEdits(CP.shoot.path, card.id).forEach(function (op) {
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
    if (m.ap2 && m.ap2[old]) {
      if (!m.ap2[mapped]) m.ap2[mapped] = m.ap2[old];
      delete m.ap2[old];
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
  else if (!CP_SHOOT_VIEW.loading && !CP_SHOOT_VIEW.checking && !CP_SHOOT_VIEW.working && !CP.lb && !CP.rvv) cpShowShootStage(CP_SHOOT_VIEW.key, true, false, true);
}, CP_ARTICLE_SYNC_MS);

function cpConfirmArticleLeave() {
  if (!CP.shoot) return true;
  var path = CP.shoot.path;
  cpCommitOtherDrafts();
  if (!Object.keys(cpDrafts()).length && !cpArticleJobs(path).length && !Object.values(CPQ.ops).some(function (entry) {
    return entry.shoot.path === path && entry.op.kind === 'stage-trash';
  })) return true;
  cpReleaseArticleJobs(path);
  if (!CP.readOnly) cpBackupSave(path, cpArticleSharedData(cbProjectData()), CP.rev);
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
var CP_SHOOT_STAGE_STATUS = { approval: 'В отборе', retouch: 'На ретуши', review: 'Отретушировано', site: 'На сайте' };
var CP_STAGE_STATUS_ORDER = ['В браке', 'На сайте', 'На доработке', 'Отретушировано', 'На ретуши', 'В отборе'];
var CP_SHOOT_VIEW = { key: 'source', chosen: '' };
var CP_SHELF_STAGE_POSITION = null;

function cpRememberShelfStages() {
  var first = document.querySelector('#cpStages button');
  if (!first || !first.getClientRects().length) return;
  var rect = first.getBoundingClientRect();
  CP_SHELF_STAGE_POSITION = { left: rect.left, top: rect.top, width: window.innerWidth };
}

function cpPlaceShootStages() {
  var row = document.getElementById('cpShootStageRow');
  var p = CP_SHELF_STAGE_POSITION;
  var topbar = document.querySelector('.cb-topbar');
  if (!row || row.hidden) return;
  var aligned = p && p.width === window.innerWidth;
  row.style.paddingLeft = aligned ? p.left + 'px' : '';
  row.style.paddingTop = aligned ? Math.max(0, p.top - topbar.getBoundingClientRect().bottom) + 'px' : '';
  document.body.style.setProperty('--cp-shoot-stage-height', row.offsetHeight + 'px');
}

(function () {
  var work = document.getElementById('cbWork'), tabs = work.querySelector('.cb-tabs');
  var row = document.createElement('div');
  row.id = 'cpShootStageRow';
  row.className = 'cp-shelf-bar';
  row.hidden = true;
  var bar = document.createElement('nav');
  bar.id = 'cpShootStageTabs';
  bar.className = 'cp-stages';
  bar.setAttribute('aria-label', 'Этапы съёмки');
  row.appendChild(bar);
  var main = document.querySelector('.cb-main');
  main.parentNode.insertBefore(row, main);
  var view = document.createElement('section');
  view.id = 'cpShootStageView';
  view.hidden = true;
  tabs.parentNode.insertBefore(view, tabs);
  var css = document.createElement('style');
  css.textContent = '#cpShootStageRow[hidden],#cpShootStageView[hidden]{display:none}'
    + '#cpShootStageRow:not([hidden])+.cb-main{height:calc(100vh - 52px - var(--cp-shoot-stage-height,0px))}'
    + 'body.cp-viewing-stage :is(.cb-tray,#cbResizer,#cbStripTray,#cbWork>.cb-tabs,#cbTabCards,#cbTabConts,#cbBtnAdd),body.cp-viewing-stage:not(.cp-stage-workflow) :is(#cbOutline,#cbOutlineResizer,#cbStripOutline){display:none!important}'
    + '.cp-stage-view-head,.cp-stage-card small{color:#a3a09a}.cp-stage-view-head{display:flex;gap:8px;align-items:flex-start;margin-bottom:12px}'
    + '.cp-stage-view-head details{flex:1;margin:0}.cp-stage-card .cb-card-head strong{color:#e7c9a8;font-weight:700}'
    + '.cp-stage-workflow .cb-outline-item small{display:block;margin:3px 0 0;color:#a3a09a;white-space:normal}.cp-stage-workflow .cp-obar-l button[aria-pressed=true]{border-color:#C9956B;color:#e7c9a8}'
    + '.cp-stage-look>h2{max-width:820px;margin:22px auto 10px;font-size:16px}'
    + '.cp-stage-look-outline{margin:12px 14px 4px;color:#e7c9a8;font-size:11px}.cp-stage-look-total{margin:0 0 12px;color:#a3a09a;font-size:12px}'
    + '.cp-stage-review-actions:not(:empty){display:flex;align-items:center;flex-wrap:wrap;gap:6px;margin-bottom:10px}.cp-stage-review-actions p{flex-basis:100%;margin:0 0 4px;color:#e7c9a8;overflow-wrap:anywhere}'
    + '.cp-stage-card .cb-slot{border-radius:0;padding:0}.cp-stage-card button.cb-slot:hover,.cp-stage-card button.cb-slot:focus-visible{outline:2px solid #C9956B;outline-offset:-2px}'
    + '.cp-stage-card button.cb-slot:focus-visible img{opacity:.85}.cp-stage-card .cb-slot-tag{pointer-events:none}';
  document.head.appendChild(css);
  window.addEventListener('resize', function () { cpRememberShelfStages(); cpPlaceShootStages(); });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(cpPlaceShootStages).observe(row);
  bar.addEventListener('click', function (e) {
    var button = e.target.closest('[data-cp-shoot-stage]');
    if (button) cpShowShootStage(button.getAttribute('data-cp-shoot-stage'));
  });
  view.addEventListener('click', function (e) {
    if (e.target.closest('[data-cp-stage-refresh]')) cpShowShootStage(CP_SHOOT_VIEW.key, true);
    if (e.target.closest('[data-cp-stage-submit]') && !CP.readOnly) cpAcceptOpen(CP.shoot.path, CP.shoot.name);
    var action = e.target.closest('[data-cp-stage-review]');
    if (action) cpShootStageReviewAction(action);
    var file = e.target.closest('[data-cp-stage-preview]');
    if (file) cpPreviewShootStageFile(+file.getAttribute('data-cp-stage-preview'));
  });
  view.addEventListener('change', function (e) {
    if (e.target.matches('[data-cp-stage-replace]')) {
      var mode = CP_SHOOT_VIEW, shoot = CP.shoot, input = e.target, card = mode.cards[+input.closest('article').dataset.cpStageRow];
      var review = card && cpShootStageReview(card);
      var files = Array.from(input.files || []).map(function (file) { return { file: file, rel: file.name }; });
      input.value = '';
      if (review && files.length && !CP.readOnly && !mode.working) {
        mode.working = true;
        cpRvCardUpload(review.id, files).finally(function () {
          mode.working = false;
          if (CP.shoot === shoot && CP_SHOOT_VIEW === mode) cpRefreshShootReview(shoot.name);
        });
      }
      return;
    }
    if (!e.target.matches('[data-cp-stage-article]')) return;
    CP_SHOOT_VIEW.filter = e.target.value;
    cpRenderShootStage();
  });
  var outline = document.getElementById('cbOutline');
  outline.addEventListener('change', function (e) {
    var check = e.target.closest('[data-cp-stage-check]'), mode = CP_SHOOT_VIEW;
    if (!check) return;
    var card = mode.cards[+check.dataset.cpStageCheck];
    if (check.checked) mode.checked.add(card.id); else mode.checked.delete(card.id);
    cpRenderShootStageOutline();
    outline.querySelector('[data-cp-stage-check="' + card.index + '"]')?.focus({ preventScroll: true });
  });
  outline.addEventListener('click', function (e) {
    var button = e.target.closest('[data-cp-stage-nav],[data-cp-stage-all],[data-cp-stage-letter],[data-cp-stage-download]');
    if (!button) return;
    e.preventDefault();
    var mode = CP_SHOOT_VIEW, data = button.dataset;
    if (data.cpStageNav !== undefined) {
      view.querySelector('[data-cp-stage-row="' + data.cpStageNav + '"]')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else if (data.cpStageAll !== undefined) {
      var cards = cpShootStageVisible().filter(function (card) { return card.files.length; });
      var all = cards.every(function (card) { return mode.checked.has(card.id); });
      cards.forEach(function (card) { if (all) mode.checked.delete(card.id); else mode.checked.add(card.id); });
      cpRenderShootStageOutline();
    } else if (data.cpStageLetter !== undefined) cpSetShootStageLetter(data.cpStageLetter);
    else cpDownloadShootStage();
  });
})();

function cpShootStageRoot(key) {
  var roots = CP.settings || {};
  return roots[CP_STAGE_SETTING[key]] || (key === 'retouch' && !cpCatalog() ? cpRetouchBase(CP.shoot.path, CP.shoot.name) : '');
}

function cpRenderShootStageTabs() {
  var bar = document.getElementById('cpShootStageTabs');
  document.getElementById('cpShootStageRow').hidden = !CP.shoot;
  if (!CP.shoot) return;
  var labels = Object.fromEntries(cpStageList().map(function (stage) { return [stage.key, stage.label]; }));
  bar.innerHTML = Object.keys(CP_SHOOT_STAGE_LABELS).filter(function (key) {
    return key === 'source' || cpShootStageRoot(key);
  }).map(function (key) {
    var active = key === CP_SHOOT_VIEW.key;
    return '<button type="button" data-cp-shoot-stage="' + key + '" aria-pressed="' + active + '"' + (active ? ' class="cp-on"' : '') + '>'
      + cbEsc(labels[key === 'source' ? '' : key] || CP_SHOOT_STAGE_LABELS[key]) + '</button>';
  }).join('');
  cpPlaceShootStages();
}

function cpShowShootStage(key, refresh, opening, quiet) {
  if (!CP.shoot || (!refresh && key === CP_SHOOT_VIEW.key)) return;
  if (!refresh && !opening && !cpConfirmArticleLeave()) return;
  var shoot = CP.shoot, selected = cbCardById(CP.activeCard), previous = CP_SHOOT_VIEW;
  var root = key === 'source' ? '' : cpShootStageRoot(key);
  var mode = { key: key, chosen: previous.key === 'source' && selected ? selected.cpArticle || cpSixCode(selected.title) : previous.chosen,
    filter: key === previous.key ? previous.filter : '', checked: key === previous.key ? new Set(previous.checked) : new Set(), files: [], cards: [], loading: !!root, pending: [] };
  function show() {
    cpDisposeShootStage();
    CP_SHOOT_VIEW = mode;
    document.body.classList.toggle('cp-viewing-stage', key !== 'source');
    document.body.classList.toggle('cp-stage-workflow', key === 'retouch' || key === 'review');
    var view = document.getElementById('cpShootStageView');
    view.hidden = key === 'source';
    cpRenderShootStageTabs();
    if (key === 'source') { view.replaceChildren(); cbRenderOutline(); }
    else cpRenderShootStage();
  }
  function stillHere() { return CP_SHOOT_VIEW === (quiet ? previous : mode) && CP.shoot === shoot; }
  if (quiet) previous.checking = true;
  else show();
  if (!root) return;
  var low = shoot.name.toLowerCase(), stageKey = key;
  var fixed = key === 'retouch' && !((CP.settings || {}).retouch);
  var scan = function (path) { return cpFindShootIn(path, shoot.name, key === 'site' ? 6 : key === 'review' ? 4 : 3, true); };
  var indexed = (!refresh || quiet) && CP.stageFor === CP.archive && ((CP.stagePaths || {})[key] || {})[low];
  if (quiet && (!indexed || !indexed.length)) indexed = previous.roots;
  var find = indexed && indexed.length ? Promise.resolve(indexed.map(function (path) { return { path: path }; }))
    : fixed ? Promise.resolve([{ path: root }]) : key === 'site' && (CP.settings.siteMore || []).length
      ? cpPool([root].concat(CP.settings.siteMore), 2, scan).then(function (groups) { return [].concat.apply([], groups); }) : scan(root);
  return Promise.all([find, cpDictReady()]).then(function (result) {
    var roots = result[0];
    var paths = Array.from(new Set(roots.map(function (entry) { return entry.path; })));
    mode.roots = paths;
    return cpPool(paths, 2, function (path) {
      return CPDisk.walkPhotos(path, CPDisk.hasProxy() ? false : CP_CONFIG.previewSize, 4, true).then(function (files) { return { root: path, files: files, dirs: files.dirs || [] }; },
        function (e) { if (e && e.status === 404) return { root: path, files: [], dirs: [] }; throw e; });
    });
  }).then(function (stageFiles) {
    if (!stillHere()) return;
    var sel = { path: shoot.path, name: shoot.name, stage: stageKey, stageFiles: stageFiles, data: cbProjectData() };
    cpStageTagIndex(sel);
    mode.stageFiles = stageFiles;
    var letters = cpRetoucherTags(), type = cpShootType(shoot.name), cards = new Map(), seen = new Set();
    var model = type && type.roles.some(function (role) { return role === 'лук' || role === 'образ'; });
    function cardFor(article, parent, code) {
      var dir = article ? cpParentDir('/' + parent).slice(1) : parent;
      var keyPath = key === 'retouch' ? (article ? (dir ? dir + '/' : '') + article.bare : parent)
        : cpStageKey((parent ? parent + '/' : '') + 'file', letters).segs.map(function (seg) {
        return seg.replace(/_доработка$/i, '');
      }).join('/');
      var id = keyPath.toLowerCase() + '\n' + code;
      var look = key === 'retouch' && (model || /^\d+$/.test(cpFolderBase(dir))) ? dir : '';
      if (!cards.has(id)) cards.set(id, { id: id, code: code, rel: keyPath, look: look, files: [], dirs: new Map(), tags: new Set(), statuses: new Set() });
      var card = cards.get(id);
      if (article) {
        card.dirs.set(article.path, article);
        if (article.letter) card.tags.add(article.letter);
      }
      if (article && /_доработка$/i.test(article.bare)) card.statuses.add('На доработке');
      return card;
    }
    stageFiles.forEach(function (group) {
      group.dirs.forEach(function (dir) {
        var article = cpRtArtDir(group.root, dir + '/x', letters, type);
        if (article && article.path === dir) cardFor(article, dir.slice(group.root.length + 1), article.code);
      });
      group.files.forEach(function (file) {
        if (seen.has(file.path)) return;
        seen.add(file.path);
        var article = cpRtArtDir(group.root, file.path, letters, type);
        var code = article ? article.code : cpFileArticleCode(file.name, letters);
        var rel = file.path.slice(group.root.length + 1), dir = article ? article.path.slice(group.root.length + 1) : rel.split('/').slice(0, -1).join('/');
        var card = cardFor(article, dir, code);
        var batch = (key === 'review' || key === 'site') && cpReviewVersionPath(root, group.root + '/article');
        if (batch && letters.indexOf(batch.letter) !== -1) card.tags.add(batch.letter);
        var image = /^image\//i.test(file.mime_type || '') || /\.(jpe?g|png|webp|gif|avif|heic|heif|tiff?|bmp|psd)$/i.test(file.name);
        var meta = { file: file, index: mode.files.length, rel: rel, card: card, image: image,
          photo: { disk: file.path, name: file.name, size: file.size, preview: file.preview } };
        mode.files.push(meta);
        card.files.push(meta);
        if (!article || key !== 'retouch') {
          if (file.cpTook && file.cpTook.l) card.tags.add(file.cpTook.l);
          (file.cpTags || []).filter(function (tag) { return letters.indexOf(tag) !== -1; }).forEach(function (tag) { card.tags.add(tag); });
        }
        if (file.cpStageStatus) card.statuses.add(file.cpStageStatus);
      });
    });
    mode.cards = Array.from(cards.values()).sort(function (a, b) {
      return a.look.localeCompare(b.look, 'ru', { numeric: true }) || a.code.localeCompare(b.code, 'ru', { numeric: true })
        || a.rel.localeCompare(b.rel, 'ru', { numeric: true });
    });
    mode.hasLooks = key === 'retouch' && (model || mode.cards.some(function (card) { return !!card.look; }));
    mode.cards.forEach(function (card, i) { card.index = i; });
    if (key === 'review' && !CP.rvv && !CP.readOnly) cpIndexShootStageReview(mode, shoot);
    mode.loading = false;
    mode.signature = JSON.stringify(mode.cards.map(function (card) {
      return [card.rel, card.code, Array.from(card.tags), Array.from(card.statuses), card.files.map(function (item) {
        var f = item.file;
        return [f.path, f.md5, f.modified, f.size, f.resource_id];
      })];
    }));
    if (!quiet) cpRenderShootStage();
    else if (!CP.lb && !CP.rvv && !previous.working && previous.signature !== mode.signature) {
      mode.filter = previous.filter;
      mode.checked = new Set(previous.checked);
      var work = document.getElementById('cbWork'), scroll = work.scrollTop;
      show();
      work.scrollTop = scroll;
    }
  }).catch(function (e) {
    if (quiet || !stillHere()) return;
    mode.loading = false; mode.error = e && e.message || 'Не удалось прочитать папки';
    cpRenderShootStage();
  }).finally(function () { previous.checking = false; });
}

function cpRenderShootStage() {
  var view = document.getElementById('cpShootStageView'), mode = CP_SHOOT_VIEW;
  if (mode.key === 'source') return;
  var codes = Array.from(new Set(mode.cards.map(function (card) { return card.code; }).filter(Boolean)));
  if (mode.filter && codes.indexOf(mode.filter) === -1) mode.filter = '';
  var h = '<div class="cp-stage-view-head">';
  if (codes.length) h += '<details class="cp-viewbar"' + (mode.filter ? ' open' : '') + '><summary>Фильтр карточек</summary>'
    + '<div class="cp-view-controls"><label>Артикул <select data-cp-stage-article><option value="">Все карточки</option>'
    + codes.map(function (code) { return '<option' + (mode.filter === code ? ' selected' : '') + '>' + cbEsc(code) + '</option>'; }).join('')
    + '</select></label></div></details>';
  if (mode.key === 'review' && !CP.readOnly) h += '<button type="button" class="cb-primary" data-cp-stage-submit>Сдать ретушь</button>';
  h += '<button type="button" data-cp-stage-refresh>Обновить</button></div>';
  cpRenderShootStageOutline();
  if (mode.loading) { view.innerHTML = h + '<p role="status">Читаю папки на Диске…</p>'; return; }
  if (mode.error) { view.innerHTML = h + '<p role="alert">' + cbEsc(mode.error) + '</p>'; return; }
  if (!mode.cards.length) { view.innerHTML = h + '<p>На этом этапе у съёмки пока нет файлов.</p>'; return; }
  if (mode.observer) mode.observer.disconnect();
  var visible = cpShootStageVisible();
  function renderCard(card) {
    var parent = card.rel.split('/').slice(0, -1).join('/');
    return '<article class="cb-card cp-stage-card" data-cp-stage-row="' + card.index + '" data-cp-stage-code="' + cbEsc(card.code) + '"><header class="cb-card-head">'
      + '<b>' + cbEsc(card.code || card.rel || 'Кадры съёмки') + '</b>'
      + (card.code && parent && !card.look ? '<small>' + cbEsc(parent) + '</small>' : '')
      + '<span class="cb-spacer"></span>'
      + (card.tags.size ? '<b title="Ретушёры">' + cbEsc(Array.from(card.tags).sort().join(' · ')) + '</b>' : '')
      + '<strong>' + cbEsc(cpShootStageCardStatus(card)) + '</strong></header>'
      + (mode.key === 'review' ? '<div class="cp-stage-review-actions"></div>' : '') + '<div class="cp-stage-card-page"></div></article>';
  }
  var groups = cpShootStageLooks(visible);
  view.innerHTML = h + (mode.hasLooks ? '<p class="cp-stage-look-total">Образов ' + groups.filter(function (group) { return group[0]; }).length
    + ' · карточек ' + visible.filter(function (card) { return card.code; }).length + '</p>' : '')
    + groups.map(function (group) {
      var html = group[1].map(renderCard).join('');
      return mode.hasLooks ? '<section class="cp-stage-look" data-cp-stage-look="' + cbEsc(group[0]) + '"><h2>'
        + cbEsc(cpShootStageLookLabel(group[0])) + '</h2>' + html + '</section>' : html;
    }).join('');
  if (mode.key === 'review') cpUpdateShootStageReviewCards();
  function loadCard(page, card) {
    Promise.all(card.files.filter(function (item) { return item.image; }).map(function (item) {
      return cpQueueStageThumb(mode, item);
    })).then(function () {
      if (CP_SHOOT_VIEW !== mode || !page.isConnected || page.contains(document.activeElement)) return;
      page.innerHTML = cpShootStageCardPages(card);
    });
  }
  var pages = Array.from(view.querySelectorAll('.cp-stage-card-page')), byPage = new Map();
  if (typeof IntersectionObserver !== 'undefined') {
    mode.observer = new IntersectionObserver(function (entries, observer) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting || CP_SHOOT_VIEW !== mode) return;
        observer.unobserve(entry.target);
        loadCard(entry.target, byPage.get(entry.target));
      });
    }, { root: document.getElementById('cbWork'), rootMargin: '350px' });
  }
  pages.forEach(function (page) {
    var card = mode.cards[+page.closest('[data-cp-stage-row]').dataset.cpStageRow];
    page.innerHTML = cpShootStageCardPages(card);
    if (mode.observer) { byPage.set(page, card); mode.observer.observe(page); }
    else loadCard(page, card);
  });
}

function cpShootStageVisible() {
  var mode = CP_SHOOT_VIEW;
  return (mode.cards || []).filter(function (card) { return !mode.filter || card.code === mode.filter; });
}

function cpShootStageLooks(cards) {
  var groups = new Map();
  cards.forEach(function (card) {
    if (!groups.has(card.look)) groups.set(card.look, []);
    groups.get(card.look).push(card);
  });
  return Array.from(groups);
}

function cpShootStageLookLabel(path) {
  return path ? 'Образ ' + path : 'Без образа';
}

function cpShootStageSources(card, mode) {
  var same = card.code ? cpRtCards(card.code) : [];
  var dirOf = function (c) { return String(c.cpArticleDir || cpCardArtDirByPhotos(c) || '').replace(/_брак$/i, '').toLowerCase(); };
  var exact = same.filter(function (c) { return dirOf(c) === card.rel.toLowerCase(); });
  if (exact.length) return exact;
  var peers = (mode || CP_SHOOT_VIEW).cards.filter(function (other) { return other.code === card.code; });
  return same.length === 1 && peers.length === 1 ? same : [];
}

/* У одной карточки на экране могут быть кадры из нескольких дропов. Решение
   применяется к той версии, чья папка записана в её последней сдаче. */
function cpShootStageReview(card) {
  var rv = cpRv();
  var matches = cpShootStageSources(card).map(function (c) { return { id: c.id, version: cpLastRv(rv[c.id]) }; })
    .filter(function (x) { return x.version && card.dirs.has(cpRvDirOf(x.version)); });
  return matches.length === 1 ? matches[0] : null;
}

function cpShootStageCardStatus(card) {
  if (CP_SHOOT_VIEW.key === 'review') {
    var review = cpShootStageReview(card);
    if (review) {
      var state = { review: 'На проверке', rework: 'На доработке', approved: 'На сайте' }[review.version.status];
      if (state) return state;
    }
  }
  return CP_STAGE_STATUS_ORDER.find(function (s) { return card.statuses.has(s); }) || CP_SHOOT_STAGE_STATUS[CP_SHOOT_VIEW.key];
}

function cpRenderShootStageOutline() {
  var mode = CP_SHOOT_VIEW, host = document.getElementById('cbOutline');
  if (mode.key !== 'retouch' && mode.key !== 'review') return;
  var rt = mode.key === 'retouch', cards = cpShootStageVisible(), marked = cards.filter(function (card) { return mode.checked.has(card.id); });
  var selectable = cards.filter(function (card) { return card.files.length > 0; });
  var locked = CP.readOnly || mode.working;
  var all = selectable.length && selectable.every(function (card) { return mode.checked.has(card.id); });
  var html = '<div class="cb-outline-title">Карточки'
    + (rt && selectable.length && !locked ? ' <a href="#" data-cp-stage-all>' + (all ? 'снять все' : 'отметить все') + '</a>' : '') + '</div>';
  if (!cards.length) html += '<div class="cb-outline-empty">' + (mode.loading ? 'Читаю папки…' : 'Карточек пока нет') + '</div>';
  function renderCard(card) {
    var name = card.code || card.rel || 'Кадры съёмки';
    var parent = cpParentDir('/' + card.rel).slice(1);
    var label = rt ? (Array.from(card.tags).sort().join(' · ') || 'Без ретушёра') : cpShootStageCardStatus(card);
    var downloaded = rt && card.files.length && card.files.every(function (item) { return item.file.cpTook && !item.file.cpTook.folder && !item.file.cpTook.done; });
    return '<div class="cp-oi">' + (rt ? '<input type="checkbox" class="cp-oi-ck" data-cp-stage-check="' + card.index + '" aria-label="Отметить ' + cbEsc(name) + '"'
      + (mode.checked.has(card.id) ? ' checked' : '') + (locked || !card.files.length ? ' disabled' : '') + '>' : '')
      + '<button type="button" class="cb-outline-item" data-cp-stage-nav="' + card.index + '" title="' + cbEsc(card.rel || name) + '">'
      + '<span class="cb-outline-num">' + (card.index + 1) + '.</span>' + cbEsc(name) + '<span class="cb-outline-count">' + card.files.length + '</span>'
      + '<small>' + cbEsc((card.code && parent && !card.look ? parent + ' · ' : '') + label + (downloaded ? ' · скачано' : '')) + '</small></button></div>';
  }
  html += cpShootStageLooks(cards).map(function (group) {
    return (mode.hasLooks ? '<h3 class="cp-stage-look-outline">' + cbEsc(cpShootStageLookLabel(group[0])) + '</h3>' : '')
      + group[1].map(renderCard).join('');
  }).join('');
  if (rt && marked.length) {
    html += '<div class="cp-obar"><div class="cp-obar-n">Отмечено: ' + marked.length + '</div><div class="cp-obar-l">'
      + cpRetoucherTags().map(function (letter) {
        var on = marked.every(function (card) { return card.tags.size === 1 && card.tags.has(letter); });
        return '<button type="button" data-cp-stage-letter="' + cbEsc(letter) + '" aria-pressed="' + on + '"'
          + (locked ? ' disabled' : '') + ' title="' + (on ? 'Снять букву ' : 'Назначить ') + cbEsc(letter) + '">' + cbEsc(letter) + '</button>';
      }).join('') + '</div><button type="button" class="cb-primary" data-cp-stage-download' + (locked ? ' disabled' : '') + '>Скачать отмеченные</button></div>';
  }
  if (host.cpStageOutlineHTML !== html) {
    host.innerHTML = html;
    host.cpStageOutlineHTML = html;
  }
}

cbRenderOutline = (function (orig) {
  return function () {
    if (CP_SHOOT_VIEW.key === 'retouch' || CP_SHOOT_VIEW.key === 'review') {
      cpRenderShootStageOutline();
      if (CP_SHOOT_VIEW.key === 'review') cpUpdateShootStageReviewCards();
      return;
    }
    document.getElementById('cbOutline').cpStageOutlineHTML = '';
    return orig.apply(this, arguments);
  };
})(cbRenderOutline);

function cpSetShootStageLetter(tag) {
  var mode = CP_SHOOT_VIEW, shoot = CP.shoot, letters = cpRetoucherTags();
  var cards = cpShootStageVisible().filter(function (card) { return mode.checked.has(card.id); });
  if (mode.key !== 'retouch' || mode.working || CP.readOnly || !cards.length || letters.indexOf(tag) === -1) return;
  var letter = cards.every(function (card) { return card.tags.size === 1 && card.tags.has(tag); }) ? '' : tag;
  var moves = cards.flatMap(function (card) {
    return Array.from(card.dirs.values()).filter(function (dir) { return dir.letter !== letter; }).map(function (dir) {
      return { code: dir.code, from: dir.path, to: cpRtDirTarget(dir, letter), letter: letter, card: card };
    });
  });
  if (CP.rtPushing) { cbToast('Дождитесь завершения назначения ретушёра.'); return; }
  mode.working = CP.rtPushing = true;
  cbBusyShow(letter ? 'Назначаю ретушёра ' + letter + '…' : 'Снимаю букву ретушёра…', 0.5);
  cpRtMove(moves).then(function (result) {
    if (CP.shoot !== shoot) return;
    var m = cpMeta(), ts = new Date().toISOString(), updated = 0;
    cards.forEach(function (card) {
      if (moves.some(function (move) { return move.card === card && result.ok.indexOf(move) === -1; })) return;
      var source = cpShootStageSources(card);
      if (!source.length && !card.dirs.size) return;
      cpRtSetCards(source, letter, letters);
      if (card.code && mode.cards.filter(function (c) { return c.code === card.code; }).length === 1) {
        (m.rtLetter = m.rtLetter || {})[card.code] = { l: letter, ts: ts };
      }
      updated++;
    });
    result.ok.forEach(function (move) {
      ((CP.rtDirs || {})[move.code] || []).forEach(function (dir) {
        if (dir.path === move.from) { dir.path = move.to; dir.letter = letter; }
      });
    });
    if (updated) cpEvent(letter ? 'card_tag' : 'card_untag', [], { tag: tag, note: 'Карточек обновлено: ' + updated });
    var unconfirmed = moves.length - result.ok.length;
    cbToast((letter ? 'Назначено ' + letter : 'Буква снята') + ' · карточек ' + updated
      + (unconfirmed ? ' · не подтвердилось переименование папок ' + unconfirmed : ''));
  }).catch(function (e) { cpHandleError(e, 'Назначение ретушёра'); }).finally(function () {
    mode.working = CP.rtPushing = false;
    cbBusyHide();
    if (CP_SHOOT_VIEW === mode && CP.shoot === shoot) cpShowShootStage('retouch', true);
  });
}

function cpDownloadShootStage() {
  var mode = CP_SHOOT_VIEW, shoot = CP.shoot, letters = cpRetoucherTags();
  var cards = cpShootStageVisible().filter(function (card) { return mode.checked.has(card.id); });
  if (mode.key !== 'retouch' || mode.working || CP.readOnly || !cards.length) return;
  var who = letters.find(function (letter) {
    return cards.every(function (card) { return card.tags.size === 1 && card.tags.has(letter); });
  }) || '';
  if (letters.length && !who) { cbToast('Назначьте одну букву отмеченным карточкам.'); return; }
  var sel = { path: shoot.path, name: shoot.name, stage: 'retouch', stageFiles: mode.stageFiles, who: who, data: cbProjectData(), againTaken: true };
  var selected = new Set();
  cards.forEach(function (card) {
    var ids = cpShootStageSources(card).map(function (c) { return c.id; });
    card.files.forEach(function (item) { item.file.cpCards = ids; selected.add(item.file.path); });
  });
  mode.working = true;
  cpRenderShootStageOutline();
  cpFlushSave().then(function () {
    if (CP_SHOOT_VIEW !== mode || CP.shoot !== shoot) return;
    return cpDownloadStageFiles(sel, cpStagePool(sel).filter(function (entry) { return selected.has(entry.f.path); }));
  }).finally(function () {
    mode.working = false;
    if (CP_SHOOT_VIEW === mode && CP.shoot === shoot) cpShowShootStage('retouch', true);
  });
}

function cpUpdateShootStageReviewCards() {
  var mode = CP_SHOOT_VIEW;
  document.querySelectorAll('#cpShootStageView [data-cp-stage-row]').forEach(function (node) {
    var card = mode.cards[+node.dataset.cpStageRow], box = node.querySelector('.cp-stage-review-actions');
    if (!card || !box) return;
    var review = cpShootStageReview(card), ver = review && review.version;
    var html = '';
    if (ver) {
      if (ver.status === 'rework' && ver.note) html += '<p>' + cbEsc(ver.note) + '</p>';
      if ((ver.files || []).length) html += '<button type="button" data-cp-stage-review="inspect">' + (ver.status === 'review' ? 'Проверить' : 'Посмотреть') + '</button>';
      var pending = Object.values(CPQ.ops).some(function (entry) {
        return CP.shoot.path === entry.shoot.path && entry.op.after && entry.op.after.id === review.id && /^rv-(approve|rework)$/.test(entry.op.after.type);
      });
      if (pending) html += '<small>В очереди</small>';
      else if (!CP.readOnly && /^(review|rework)$/.test(ver.status)) {
        html += '<button type="button" data-cp-stage-review="replace">Заменить кадры</button><input type="file" multiple hidden data-cp-stage-replace>';
        if (ver.status === 'review') html += '<button type="button" class="cb-primary" data-cp-stage-review="approve">На сайт</button>'
          + '<button type="button" data-cp-stage-review="rework">На доработку</button>';
      }
    }
    var status = cpShootStageCardStatus(card), label = node.querySelector('.cb-card-head strong');
    if (label.textContent !== status) label.textContent = status;
    if (box.cpReviewHTML !== html) { box.innerHTML = html; box.cpReviewHTML = html; }
  });
}

function cpShootStageReviewAction(button) {
  var mode = CP_SHOOT_VIEW, card = mode.cards[+button.closest('article').dataset.cpStageRow];
  var review = card && cpShootStageReview(card), action = button.dataset.cpStageReview;
  if (!review || mode.key !== 'review') return;
  if (action === 'inspect') { cpRvvOpen(review.id, 0, true); return; }
  if (CP.readOnly || mode.working) return;
  if (action === 'replace') { button.parentNode.querySelector('[data-cp-stage-replace]').click(); return; }
  if (review.version.status !== 'review') return;
  mode.working = true;
  var pending = action === 'approve' ? cpRvApprove([review.id], 'card') : cpRvRework(review.id);
  Promise.resolve(pending).finally(function () {
    mode.working = false;
    if (CP_SHOOT_VIEW === mode) {
      cpRenderShootStageOutline();
      cpUpdateShootStageReviewCards();
      if (action === 'rework' && review.version.status === 'rework') cpRefreshShootReview(CP.shoot.name);
    }
  });
}

/* Читаем ручные сдачи из уже загруженных папок 04. Если один артикул лежит
   в нескольких дропах, версия должна быть привязана к конкретной папке. */
function cpIndexShootStageReview(mode, shoot) {
  var m = cpMeta(), rv = m.rv || {}, known = {}, now = new Date().toISOString(), rows = [], logged = {};
  Object.values(rv).forEach(function (versions) { versions.forEach(function (version) {
    (version.files || []).forEach(function (file) { known[file.path] = true; });
  }); });
  var indexed = cpMirrorArts(mode.stageFiles.map(function (group) { return { path: group.root, files: group.files }; }), cpRetoucherTags(), cpShootType(shoot.name));
  var changed = false;
  mode.cards.forEach(function (card) {
    var src = cpShootStageSources(card, mode), art = indexed[card.code];
    if (!art || src.length !== 1) return;
    var c = src[0], last = cpLastRv(rv[c.id]), own = last && cpRvDirOf(last).replace(/_доработка$/i, '');
    var dirs = Object.keys(art.byDir).filter(function (dir) { return card.dirs.has(dir); });
    if (dirs.length > 1) dirs = dirs.filter(function (dir) { return dir.replace(/_доработка$/i, '') === own; });
    if (!dirs.length) return;
    var matching = { letter: art.letter, byDir: Object.fromEntries(dirs.map(function (dir) { return [dir, art.byDir[dir]]; })) };
    if (cpMirrorReworkByHand(m, c, matching, shoot.name, now, rows, logged)) changed = true;
    else if (cpMirrorRvFromDisk(m, c, matching, shoot.name, cpCardLetter(c), now, rows, logged, known)) changed = true;
  });
  if (changed) cbMarkDirty();
  if (rows.length) cpOutputAppend(rows);
}

function cpRefreshShootReview(shootName, dirs) {
  var mode = CP_SHOOT_VIEW;
  if (!CP.shoot || CP.shoot.name !== shootName || mode.key !== 'review') return;
  mode.roots = Array.from(new Set((mode.roots || []).concat(dirs || [])));
  if (!mode.working && !mode.loading && !CP.lb && !CP.rvv) cpShowShootStage('review', true, false, true);
}

function cpShootStageCardPages(card) {
  if (!card.files.length) return '<div class="cb-empty-hint">Папка артикула пуста.</div>';
  var sourceCards = card.code ? cpRtCards(card.code) : [];
  var template = sourceCards.find(function (c) {
    return String(c.cpArticleDir || '').toLowerCase() === card.rel.toLowerCase();
  }) || (sourceCards.length === 1 ? sourceCards[0] : null);
  var ordered = card.files.slice().sort(function (a, b) { return a.rel.localeCompare(b.rel, 'ru', { numeric: true }); });
  var available = ordered.slice(), known = new Map();
  if (template) cpCardPids(template).forEach(function (id) {
    var n = available.findIndex(function (item) { return item.file.cpPid === id; });
    if (n !== -1) known.set(id, available.splice(n, 1)[0]);
  });
  function slot(item, label) {
    if (!item) return '<div class="cb-slot"><span class="cb-slot-hint">' + cbEsc(label || '') + '</span></div>';
    var p = item.photo;
    return '<button type="button" class="cb-slot cb-filled" data-cp-stage-preview="' + item.index + '" aria-label="' + cbEsc(p.name) + '" title="' + cbEsc(p.name) + '">'
      + (p.dataUrl ? '<img src="' + p.dataUrl + '" alt="">' : '<span class="cb-slot-hint">' + cbEsc(item.image && !item.failed ? 'Загрузка…' : p.name) + '</span>')
      + (label ? '<span class="cb-slot-tag">' + cbEsc(label) + '</span>' : '') + '</button>';
  }
  var bg = template && template.bg ? ' style="background:' + cbEsc(template.bg) + '"' : '';
  if (!template || template.mode === 'auto') {
    var auto = Array.from(known.values()).concat(available);
    return cpShootStageAutoPage(auto, template && template.hasHero, bg, slot);
  }
  var sourceSlots = template.slots || [];
  var placed = sourceSlots.map(function (s) {
    var item = known.get(s.pid);
    known.delete(s.pid);
    return item || available.shift();
  });
  var slots = sourceSlots.map(function (s, i) { return Object.assign({}, s, { pid: placed[i] ? String(placed[i].index) : null }); });
  var photos = new Map(placed.filter(Boolean).map(function (item) { return [String(item.index), item.photo]; }));
  var layout = Object.assign({}, template, { slots: slots });
  var html = sourceSlots.length ? cbPageHTML(template.canvas, cbManualBoxes(layout, function (id) { return photos.get(id); }), function (i) {
    return slot(placed[i], sourceSlots[i].name);
  }, bg) : '';
  return html + (available.length ? cpShootStageAutoPage(available, false, bg, slot) : '');
}

function cpShootStageAutoPage(items, hasHero, bg, slot) {
  var aspects = items.map(function (item) {
    var p = item.photo, source = item.file.cpPid && cbPhotoById(item.file.cpPid);
    if (p.w > 0 && p.h > 0) return p.w / p.h;
    return source && source.w > 0 && source.h > 0 ? source.w / source.h : 0.75;
  });
  var page = cbAutoBestGeom({ hasHero: hasHero }, aspects);
  return cbPageHTML(page.canvas, page.geom, function (i) { return slot(items[i]); }, bg);
}

var cpStageThumbActive = 0;

function cpQueueStageThumb(mode, item) {
  if (!item.ready) item.ready = new Promise(function (done) {
    mode.pending.push({ item: item, done: done });
    cpPumpStageThumbs();
  });
  return item.ready;
}

function cpPumpStageThumbs() {
  var mode = CP_SHOOT_VIEW;
  while (cpStageThumbActive < 4 && mode.pending && mode.pending.length) {
    (function (job) {
      cpStageThumbActive++;
      cpLoadThumb(job.item.photo).then(function (thumb) {
        if (CP_SHOOT_VIEW !== mode || !thumb.w) {
          URL.revokeObjectURL(thumb.url);
          job.item.failed = true;
          return;
        }
        var p = job.item.photo;
        p.dataUrl = thumb.url; p.w = thumb.w; p.h = thumb.h;
        var button = document.querySelector('#cpShootStageView [data-cp-stage-preview="' + job.item.index + '"]');
        if (button) {
          var img = document.createElement('img');
          img.alt = ''; img.src = thumb.url;
          var hint = button.querySelector('.cb-slot-hint');
          if (hint) hint.replaceWith(img);
        }
      }).catch(function () { job.item.failed = true; }).then(function () {
        job.done();
        cpStageThumbActive--;
        cpPumpStageThumbs();
      });
    })(mode.pending.shift());
  }
}

function cpDisposeShootStage() {
  var mode = CP_SHOOT_VIEW;
  if (CP.lb && CP.lb.stage) cpLbClose();
  if (mode.observer) mode.observer.disconnect();
  (mode.pending || []).splice(0).forEach(function (job) { job.done(); });
  (mode.files || []).forEach(function (item) { if (item.photo.dataUrl) URL.revokeObjectURL(item.photo.dataUrl); });
}

function cpPreviewShootStageFile(index) {
  var item = CP_SHOOT_VIEW.files[index];
  if (!item) return;
  var list = Array.from(document.querySelectorAll('#cpShootStageView [data-cp-stage-preview]')).map(function (node) {
    return CP_SHOOT_VIEW.files[+node.getAttribute('data-cp-stage-preview')];
  }).filter(function (frame) { return frame.card === item.card; });
  cpLbOpen(list, list.indexOf(item), true);
}

function cpTrashShootStageFile(index) {
  var mode = CP_SHOOT_VIEW, item = mode.files[index];
  if (!CP.shoot || CP.readOnly || mode.key === 'source' || !item) return;
  var path = item.file.path;
  if (Object.values(CPQ.ops).some(function (entry) { return entry.op.kind === 'stage-trash' && entry.op.path === path; })) return;
  if (!confirm('Убрать «' + item.file.name + '» с этапа «' + CP_SHOOT_STAGE_LABELS[mode.key] + '» в Корзину Диска?')) return;
  cpLbClose();
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

function cpResetShootStage() {
  cpDisposeShootStage();
  CP_SHOOT_VIEW = { key: 'source', chosen: '' };
  document.body.classList.remove('cp-viewing-stage', 'cp-stage-workflow');
  var view = document.getElementById('cpShootStageView');
  view.hidden = true;
  view.replaceChildren();
  cpRenderShootStageTabs();
  if (CP.shoot) cbRenderOutline();
}

CP.openedHooks.push(function (path, stage) {
  cpResetShootStage();
  var shoot = CP.shoot;
  function showRequestedStage() {
    if (CP.shoot !== shoot) return;
    cpRenderShootStageTabs();
    if (CP_SHOOT_STAGE_STATUS[stage] && cpShootStageRoot(stage) && CP_SHOOT_VIEW.key === 'source') cpShowShootStage(stage, false, true);
  }
  if (CP.settings) showRequestedStage();
  else cpEnsureSettings().then(showRequestedStage, function () { });
});
