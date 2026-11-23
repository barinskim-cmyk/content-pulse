/* Отбор в браузере до подтверждения. Очередь Диска получает только итоговую правку. */
var CP_ARTICLE_DRAFTS = { path: '', cards: Object.create(null) };

function cpDraftKey(path) { return 'cp_article_drafts:' + path; }

function cpDrafts() {
  var path = CP.shoot && CP.shoot.path || '';
  if (CP_ARTICLE_DRAFTS.path !== path) {
    var cards = {};
    try { cards = JSON.parse(localStorage.getItem(cpDraftKey(path)) || '{}') || {}; }
    catch (e) { console.warn('[CP] Черновики не прочитались', e); }
    CP_ARTICLE_DRAFTS = { path: path, cards: Object.assign(Object.create(null), cards) };
  }
  return CP_ARTICLE_DRAFTS.cards;
}

function cpStoreDrafts() {
  if (!CP.shoot) return;
  var drafts = cpDrafts(), key = cpDraftKey(CP.shoot.path);
  try {
    if (Object.keys(drafts).length) localStorage.setItem(key, JSON.stringify(drafts));
    else localStorage.removeItem(key);
  } catch (e) { cbToast('Черновик пока только в открытой вкладке. Сохраните карточку перед закрытием.'); }
}

function cpDraftLayout(card) {
  return { pids: (card.pids || []).slice(), slots: (card.slots || []).map(function (slot) { return slot.pid || null; }) };
}

function cpDraftLayoutSnapshot() {
  var layouts = Object.create(null);
  App.cards.forEach(function (card) { if (cpLinkedArticle(card)) layouts[card.id] = cpDraftLayout(card); });
  return layouts;
}

function cpApplyDraftLayout(card, layout) {
  if (card.mode === 'auto') card.pids = layout.pids.slice();
  else (card.slots || []).forEach(function (slot, i) { slot.pid = layout.slots[i] || null; });
}

function cpTrackArticleDraft(card, before, after, oldLayout) {
  if (!CP.shoot || CP.readOnly) return;
  var drafts = cpDrafts(), draft = drafts[card.id];
  if (!draft) {
    var shared = oldLayout || { pids: before.slice(), slots: before.slice() };
    draft = drafts[card.id] = { before: before.slice(), shared: shared, frames: Object.create(null) };
  }
  draft.desired = cpDraftLayout(card);
  draft.after = after.slice();
  var frameIds = new Set(draft.before.concat(draft.after));
  frameIds.forEach(function (id) {
    var p = cbPhotoById(id);
    if (p && p.disk && !draft.frames[id]) {
      draft.frames[id] = { id: id, disk: p.disk, name: p.name, md5: p.md5 || '', size: p.size, kind: p.kind || 'photo' };
    }
  });
  Object.keys(draft.frames).forEach(function (id) { if (!frameIds.has(id)) delete draft.frames[id]; });
  if (cpSame(draft.before, draft.after) && cpSame(draft.shared, draft.desired)) delete drafts[card.id];
  cpStoreDrafts();
}

/* Завершённый отбор виден коллегам. Черновик остаётся поверх него в этой вкладке. */
function cpArticleSharedData(data) {
  if (!CP.shoot) return data;
  var drafts = cpDrafts();
  data.cards = (data.cards || []).map(function (card) {
    var draft = drafts[card.id], shared = cpClone(card);
    if (draft) cpApplyDraftLayout(shared, draft.shared);
    return shared;
  });
  return data;
}

function cpOverlayArticleDrafts(data) {
  if (!CP.shoot) return data;
  var drafts = cpDrafts();
  if (!Object.keys(drafts).length) return data;
  var photos = Object.create(null);
  data = Object.assign({}, data);
  data.photos = (data.photos || []).slice();
  data.photos.forEach(function (p) { photos[p.id] = p; });
  data.cards = (data.cards || []).map(function (card) {
    var draft = drafts[card.id];
    if (!draft) return card;
    draft.shared = cpDraftLayout(card);
    Object.values(draft.frames).forEach(function (p) {
      if (!photos[p.id]) {
        photos[p.id] = p;
        data.photos.push(Object.assign({}, p));
      }
    });
    var edited = cpClone(card);
    cpApplyDraftLayout(edited, draft.desired);
    return edited;
  });
  return data;
}

function cpArticlePendingEdits(path, card) {
  var ops = Object.values((cpMeta().q || {})).filter(function (op) {
    return op.card === card && !CPQ.ops[op.id] && op.kind === 'article-save';
  });
  cpArticleJobs(path, card).forEach(function (entry) { ops.push(entry.op); });
  return ops.flatMap(function (op) { return op.kind === 'article-save' ? op.edits : op.kind === 'article-edit' ? [op] : []; });
}

function cpCommitArticleDraft(cardId) {
  var shoot = CP.shoot, card = cbCardById(cardId), art = cpLinkedArticle(card), drafts = cpDrafts(), draft = drafts[cardId];
  if (!shoot || CP.readOnly || !art || !draft) return true;
  var root = shoot.path.replace(/\/+$/, ''), prefix = root + '/' + art.dir + '/';
  var jobs = cpArticleJobs(shoot.path, cardId);
  if (jobs.some(function (job) { return job.op.kind === 'article-brak'; })) {
    cbToast('Дождитесь переименования папки артикула, затем сохраните отбор.');
    return false;
  }
  var edits = [], stages = cpStageRootsForEdit(shoot), known = cpArticlePendingEdits(shoot.path, cardId);
  var look = cpModelArticleLook(shoot.name, art.dir);
  var copies = (cpMeta().articleCopies || {})[cardId] || {};
  var add = function (id, direction) {
    var p = draft.frames[id];
    if (!p || p.kind === 'ref' || p.disk.indexOf(root + '/') !== 0) return;
    var previous = known.filter(function (edit) { return edit.pid === id; }).pop();
    var source = direction === 'remove' && copies[id] || p.disk;
    if (direction === 'remove' && !previous && source.indexOf(prefix) !== 0) return;
    edits.push({
      card: cardId, pid: id, direction: direction, source: source, name: p.name, digest: p.md5,
      root: root, article: art.dir, look: look, code: art.code, stageRoots: stages
    });
  };
  draft.before.filter(function (id) { return draft.after.indexOf(id) === -1; }).forEach(function (id) { add(id, 'remove'); });
  draft.after.filter(function (id) { return draft.before.indexOf(id) === -1; }).forEach(function (id) { add(id, 'add'); });
  /* Новые кадры коллеги из общего отбора добавляются поверх нашей правки. */
  var shared = card.mode === 'auto' ? draft.shared.pids : draft.shared.slots.filter(Boolean);
  var imported = shared.filter(function (id) { return draft.before.indexOf(id) === -1 && draft.after.indexOf(id) === -1; });
  if (imported.length) {
    if (card.mode === 'auto') card.pids = card.pids.concat(imported);
    else imported.forEach(function (id) { card.slots.push({ pid: id, orient: 'v', row: card.slots.length, name: '' }); });
  }
  delete drafts[cardId];
  if (CP.cardSnap) CP.cardSnap[cardId] = cpCardPids(card);
  if (CP.cardLayoutSnap) CP.cardLayoutSnap[cardId] = cpDraftLayout(card);
  if (edits.length) {
    cpReleaseArticleJobs(shoot.path, cardId);
    CPQ.add(shoot, { kind: 'article-save', card: cardId, edits: edits, sourceFolder: root + '/' + art.dir, label: 'Сохранить артикул ' + art.code,
      waitsFor: jobs.map(function (entry) { return entry.op.id; }), after: { type: 'article-save' } });
  } else cbMarkDirty();
  cpBackupSave(shoot.path, cpArticleSharedData(cbProjectData()), CP.rev);
  cpStoreDrafts();
  return true;
}

function cpCommitOtherDrafts(keep) {
  Object.keys(cpDrafts()).forEach(function (id) { if (id !== keep) cpCommitArticleDraft(id); });
}

function cpRunArticleSave(op, shoot) {
  return cpArticleMeta(op.sourceFolder).then(function (source) {
    if (!source || source.type !== 'dir') {
      return { ok: false, stuck: true, err: 'Папку артикула переименовали или переместили. Проверьте её на Диске.' };
    }
    return op.edits.reduce(function (chain, edit) {
      return chain.then(function (state) {
        if (!state.ok || edit.done) return state;
        edit.by = op.by;
        return cpResolveArticleEdit(edit, shoot).then(function (result) {
          if (result.ok) edit.done = true;
          return result;
        });
      });
    }, Promise.resolve({ ok: true }));
  }).catch(function (e) { return { ok: false, err: e && e.message || 'Не удалось открыть папку артикула' }; });
}

function cpResolveArticleEdit(edit, shoot) {
  var root = edit.root + '/' + edit.article + '/';
  if (edit.direction === 'remove' && !edit.digest) {
    return Promise.resolve({ ok: false, stuck: true, err: 'Обновите съёмку перед удалением кадра «' + edit.name + '».' });
  }
  return cpArticleMeta(edit.source).then(function (meta) {
    if (edit.direction === 'add' && meta && edit.source.indexOf(root) === 0 && (!edit.digest || edit.digest === meta.md5)) {
      edit.fromDisk = true;
      return cpRunArticleEdit(edit, shoot);
    }
    if (edit.resultPath || (meta && (edit.direction === 'add' || edit.source.indexOf(root) === 0))) return cpRunArticleEdit(edit, shoot);
    /* Если предыдущая очередь сделала копию или переместила кадр, находим его по содержимому. */
    var lookingInParent = edit.direction === 'add' && !!edit.look;
    var search = edit.direction === 'remove' ? root.slice(0, -1)
      : edit.root + '/' + (edit.look || CP_EXTRA_FRAMES + '/' + edit.article);
    return cpArticleMeta(search).then(function (dir) {
      if (!dir) return [];
      if (lookingInParent) return CPDisk.listDir(search).then(function (items) {
        return items.filter(function (item) { return item.type === 'file'; });
      });
      return CPDisk.walkPhotos(search, false, 2, true);
    }).then(function (files) {
      var same = files.filter(function (f) { return edit.digest && f.md5 === edit.digest; });
      var named = same.filter(function (f) { return f.name === edit.name; });
      if (named.length === 1 || (!named.length && same.length === 1)) {
        edit.source = (named[0] || same[0]).path;
        return cpRunArticleEdit(edit, shoot);
      }
      if (edit.direction === 'remove' && !meta && edit.source.indexOf(root) === 0 && !same.length) {
        edit.fromDisk = true;
        return cpRunArticleEdit(edit, shoot);
      }
      return { ok: false, stuck: true, err: 'Проверьте кадр «' + edit.name + '» на Диске: файл переместили или изменили.' };
    });
  }).catch(function (e) {
    return { ok: false, err: e && e.message || 'Не удалось проверить кадр на Диске' };
  });
}

CPQ.after['article-save'] = function (op, m, shoot) {
  op.edits.forEach(function (edit) { CPQ.after['article-edit'](edit, m, shoot); });
};

function cpArticleDraftButtons() {
  var drafts = cpDrafts();
  document.querySelectorAll('#cbCards .cb-card').forEach(function (node) {
    var id = node.dataset.cid, draft = drafts[id], header = node.querySelector('.cb-card-head');
    if (!draft || !header) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'cb-mini cb-primary';
    button.dataset.cpSaveArticle = id;
    button.textContent = 'Сохранить карточку';
    header.appendChild(button);
  });
}

document.getElementById('cbCards').addEventListener('click', function (e) {
  var btn = e.target.closest('[data-cp-save-article]');
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  if (cpCommitArticleDraft(btn.dataset.cpSaveArticle)) cbRenderCards();
}, true);

/* Отправка с изменениями сама становится заданием. Можно уйти из съёмки,
   пока отбор сохраняется. Следующий отбор этого артикула подождёт отправку. */
function cpEnqueueDraftStage(card, status) {
  if (!CP.shoot || CP.readOnly || !cpLinkedArticle(card)) return false;
  var shoot = CP.shoot, art = cpLinkedArticle(card), settings = CP.settings || {};
  var pending = cpArticleJobs(shoot.path, card.id), draft = cpDrafts()[card.id];
  if (!draft && !pending.some(function (entry) { return /^article-(save|send)$/.test(entry.op.kind); })) return false;
  if (!cpCommitArticleDraft(card.id)) return true;
  if (status === 'approval' && !settings.approve) return false;
  var jobs = cpArticleJobs(shoot.path, card.id);
  if (jobs.length && jobs[jobs.length - 1].op.kind === 'article-send' && jobs[jobs.length - 1].op.stage === status) return true;
  var destination = status === 'approval' ? settings.approve + '/' + CPDisk.safeName(shoot.name) : cpRetouchBase(shoot.path, shoot.name);
  CPQ.add(shoot, {
    kind: 'article-send', card: card.id, stage: status, root: status === 'retouch' ? settings.retouch || '' : settings.approve,
    article: art.dir, code: art.code, pids: cpCardPids(card), destination: destination, letter: cpCardLetter(card),
    label: (status === 'retouch' ? 'На ретушь: ' : 'На согласование: ') + art.code,
    waitsFor: jobs.map(function (entry) { return entry.op.id; }), after: { type: 'article-send' }
  });
  cpBackupSave(shoot.path, cpArticleSharedData(cbProjectData()), CP.rev);
  return true;
}

function cpRunArticleSend(op, shoot) {
  var from = shoot.path.replace(/\/+$/, '') + '/' + op.article;
  var parent = op.article.indexOf('/') === -1 ? '' : cpParentDir(op.article) + '/';
  var leaf = cpFolderBase(op.article), letters = [], folder = op.destination;
  return cpDictReady().then(function () {
    letters = cpRetoucherTags();
    if (!op.root) return [];
    return cpFindShootIn(op.root, shoot.name, 3);
  }).then(function (found) {
    if (found.length) folder = (found.find(function (entry) { return entry.path !== op.destination; }) || found[0]).path;
    return cpRtListDirs(found.length ? found.map(function (entry) { return entry.path; }) : [folder], letters, cpShootType(shoot.name));
  }).then(function (byCode) {
    var existing = (byCode[op.code] || []).filter(function (entry) {
      return entry.bare === leaf && (!parent || entry.parent.endsWith('/' + parent.slice(0, -1)));
    });
    if (existing.length > 1) throw { conflict: true, message: 'У артикула несколько папок на выбранном этапе' };
    var tag = op.stage === 'retouch' && op.letter ? op.letter + '_' : '';
    var to = existing.length ? existing[0].path : folder + '/' + parent + tag + leaf;
    return CPDisk.walkPhotos(from, false, 3).then(function (files) {
      if (!files.length) throw { conflict: true, message: 'В артикуле нет кадров для отправки' };
      var items = files.map(function (f) { return { from: f.path, path: to + f.path.slice(from.length), meta: f }; });
      return cpReplaceStageArticle(items, to, false).then(function () {
        op.sentFolder = folder;
        if (op.stage === 'approval') {
          op.approvalFiles = Object.fromEntries(items.map(function (item) { return [item.from, item.path]; }));
        }
        return { ok: true };
      });
    });
  }).catch(function (e) {
    return { ok: false, stuck: !!(e && e.conflict), err: e && e.message || 'Не удалось отправить артикул' };
  });
}

CPQ.after['article-send'] = function (op, m, shoot, data) {
  m.status = m.status || {};
  m.cardStatus = m.cardStatus || {};
  var stamp = { s: op.stage, by: op.by, ts: new Date().toISOString() };
  m.cardStatus[op.card] = stamp;
  var paths = Object.create(null);
  var photos = data ? data.photos || [] : App.photos;
  photos.forEach(function (photo) { paths[photo.id] = photo.disk; });
  op.pids.forEach(function (id) {
    m.status[id] = Object.assign({ card: op.card }, stamp);
    if (op.approvalFiles) {
      var copied = ((m.articleCopies || {})[op.card] || {})[id] || paths[id];
      if (op.approvalFiles[copied]) (m.ap2 = m.ap2 || {})[id] = op.approvalFiles[copied];
    }
  });
  if (CP.shoot && CP.shoot.path === shoot.path) {
    cpStageNote(op.stage, shoot.name, op.sentFolder, [op.code]);
  }
};
CPQ.redraw['article-send'] = true;
