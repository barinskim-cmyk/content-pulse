/* ============================================================
   cp-guard.js — отбор после отправки на ретушь и скачивания,
   теги карточек и быстрое создание карточки.

   Правила (договорённость с Машей, 05.11.2026):
     - карточку, из которой уже скачивали, менять можно, но с
       предупреждением: на шапке «изменена после скачивания», тост,
       запись в журнал; отменить — Cmd+Z;
     - кадр, убранный из карточки, теряет статус, который получил от
       неё (ретушь, согласование и т. п.): если кадр остался в другой
       карточке со своим статусом — тот статус не трогаем. Брак
       (пересъём) остаётся всегда (06.11.2026);
     - исключение: кадр уже на ретуши и ретушёр его скачал — статус
       «Удалено из отбора», чтобы ретушёр видел, что делать не надо;
     - кадр, добавленный в карточку, которая уже на ретуши, сам
       уходит на ретушь (статус, копия в папку ретуши, теги карточки
       действуют на него) и считается «не скачано» — ретушёр заберёт
       его фильтром «Ретушь + Не скачано».
   Чужие изменения (подтянутые с Диска) правила не запускают.

   Теги карточки — из словаря, в меню «ещё» карточки; действуют на все
   кадры карточки (фильтры и выгрузка на витрине).

   Большой «+» в поле карточек — новая карточка-автолента; на него
   можно бросить кадр из галереи.

   Подключается после cp-rules.js. Префикс: cp*.
   ============================================================ */

(function cpGuardCss() {
  var css = ''
    + '.cp-addcard{display:flex;align-items:center;justify-content:center;gap:14px;width:100%;min-height:120px;margin:6px 0 24px;'
    + 'border:2px dashed #3a3a37;border-radius:8px;background:transparent;color:#a3a09a;font-size:15px;cursor:pointer}'
    + '.cp-addcard b{font-size:56px;line-height:1;font-weight:300;color:#C9956B}'
    + '.cp-addcard:hover,.cp-addcard.cp-over{border-color:#C9956B;color:#e7c9a8;background:#1d1a17}'
    + '.cp-addcard.cp-collect{min-height:44px;margin:0 0 14px;border:1px solid #5a4632;color:#e7c9a8;font-size:14px}'
    + '.cb-card.cp-card-active{outline:2px solid #C9956B;outline-offset:2px}'
    + '.cp-card-tags{flex-basis:100%;display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-top:2px}'
    + '.cp-tg-name{font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:#a3a09a;margin:0 2px 0 6px}'
    + '.cp-tg-name:first-child{margin-left:0}'
    + '.cp-tg{font-size:12px;min-width:28px;padding:2px 9px;border-radius:12px;border:1px solid #3a3a37;background:transparent;color:#a3a09a;cursor:pointer;line-height:1.4}'
    + '.cp-tg:hover{border-color:#C9956B;color:#e7c9a8}'
    + '.cp-tg.cp-tg-on{background:#C9956B;border-color:#C9956B;color:#141413;font-weight:600}'
    + '.cp-tg.cp-tg-old{background:#5a4632;border-color:#5a4632;color:#e7c9a8}'
    + '.cp-card-tag{font-size:11px;color:#e7c9a8;border:1px solid #5a4632;background:#2b241d;border-radius:10px;padding:1px 4px 1px 8px}'
    + '.cp-card-tag button{background:none;border:none;color:#a3a09a;padding:0 4px;font-size:12px;line-height:1;cursor:pointer}'
    + '.cp-card-warn{font-size:11px;color:#f2b8a0;border:1px solid #8a4a32;background:#2a1a16;border-radius:10px;padding:1px 8px}'
    + '.cp-menu .cp-menu-sub{color:#a3a09a;font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:8px 10px 4px;border-top:1px solid #2a2a28;margin-top:4px}'
    + '.cp-menu button.cp-on{color:#e7c9a8}';
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
})();

/* ---------- состав карточек: что изменилось ---------- */

CP.cardSnap = null;     /* {id карточки: [pid]} — состав на прошлой отрисовке */
CP.snapShoot = '';
CP.guardMute = false;

function cpSnapNow() {
  var s = {};
  App.cards.forEach(function (c) { s[c.id] = cpCardPids(c); });
  return s;
}

/** Кадр есть в отборе: в какой-нибудь карточке или блоке доп. контента. */
function cpInSelection(pid) {
  return App.cards.some(function (c) { return cpCardPids(c).indexOf(pid) !== -1; })
    || App.containers.some(function (k) { return (k.photoIds || []).indexOf(pid) !== -1; });
}

function cpGuardCheck() {
  if (!CP.shoot) { CP.cardSnap = null; return; }
  var now = cpSnapNow();
  var prev = CP.cardSnap;
  CP.cardSnap = now;
  if (!prev || CP.snapShoot !== CP.shoot.path || CP.guardMute) { CP.snapShoot = CP.shoot.path; return; }
  var m = cpMeta();
  var actor = cpActor(), ts = new Date().toISOString();
  var changed = false, warnCards = [], removedDl = [], unretouched = [], inherit = [], removals = [], additions = [];
  var ids = {};
  Object.keys(prev).forEach(function (k) { ids[k] = true; });
  Object.keys(now).forEach(function (k) { ids[k] = true; });
  Object.keys(ids).forEach(function (cid) {
    var a = prev[cid] || [], b = now[cid] || [];
    var removed = a.filter(function (p) { return b.indexOf(p) === -1; });
    var added = b.filter(function (p) { return a.indexOf(p) === -1; });
    if (!removed.length && !added.length) return;
    var card = cbCardById(cid);
    var cst = m.cardStatus[cid];
    /* из карточки уже скачивали — предупреждаем и помечаем карточку */
    var wasDl = a.filter(function (p) { return m.downloads[p] && m.downloads[p].n; });
    if (wasDl.length) {
      warnCards.push({ card: card, title: card ? card.title : 'удалённая карточка', n: wasDl.length });
      if (card) card.cpChangedAfterDl = { by: actor, ts: ts };
      changed = true;
    }
    removed.forEach(function (pid) { removals.push({ pid: pid, cid: cid }); });
    /* согласование и ретушь — атрибуты карточки: добавленный кадр их получает */
    if (card && cst && (cst.s === 'retouch' || cst.s === 'approval') && added.length) additions.push({ card: card, pids: added, s: cst.s });
  });
  /* сначала убранные: теряют статус, полученный от карточки, — кроме брака */
  removals.forEach(function (r) {
    var pid = r.pid, st = m.status[pid], d = m.downloads[pid];
    if (!st || st.s === 'reshoot' || st.s === 'removed') return;
    var still = cpInSelection(pid);
    /* кадр остался в отборе, а статус ему ставили не через эту карточку — он не её */
    if (still && st.card !== r.cid) return;
    if (st.s === 'retouch' && d && d.n) {
      m.status[pid] = { s: 'removed', by: actor, ts: ts, card: r.cid, was: 'retouch' };
      removedDl.push(pid);
    } else {
      delete m.status[pid];
      unretouched.push(pid);
    }
    changed = true;
  });
  /* потом добавленные в карточку, которая уже на ретуши: кадр тоже уходит на ретушь */
  additions.forEach(function (x) {
    var fresh = x.pids.filter(function (pid) {
      var st = m.status[pid];
      var p = cbPhotoById(pid);
      return p && (p.kind || 'photo') !== 'ref' && (!st || st.s === 'removed');
    });
    if (!fresh.length) return;
    if (x.s === 'approval') {
      fresh.forEach(function (pid) { m.status[pid] = { s: 'approval', by: actor, ts: ts, card: x.card.id }; });
      cpEvent('added_to_approval_card', cpPhotoNames(fresh), { card: x.card.title }, true);
      changed = true;
    } else inherit.push({ card: x.card, pids: fresh });
  });
  if (warnCards.length) {
    warnCards.forEach(function (w) {
      cpEvent('changed_after_download', [], { card: w.title, downloaded: w.n }, true);
    });
    cbToast('Внимание: из карточки «' + warnCards[0].title + '» уже скачивали ' + warnCards[0].n
      + ' кадр(ов). Убранные помечены «Удалено из отбора», добавленные уйдут как не скачанные. Отменить — Cmd+Z.');
  }
  if (removedDl.length) cpEvent('removed_after_download', cpPhotoNames(removedDl), {}, true);
  if (unretouched.length) cpEvent('clear_status', cpPhotoNames(unretouched), { note: 'убраны из карточки — статус снят' }, true);
  if (changed) cbMarkDirty();
  inherit.forEach(function (x) {
    /* статус, копия в папку ретуши и запись в журнал — как при отправке */
    cpDoAction('retouch', x.pids, x.card.id);
    cpEvent('added_to_retouch_card', cpPhotoNames(x.pids), { card: x.card.title }, true);
  });
}

/* чужая версия отбора — не наши правки: правила не запускаем */
(function cpGuardHooks() {
  var applyOrig = window.cpApplyRemote;
  window.cpApplyRemote = function () {
    CP.guardMute = true;
    try { return applyOrig.apply(this, arguments); }
    finally { CP.guardMute = false; CP.cardSnap = CP.shoot ? cpSnapNow() : null; CP.snapShoot = CP.shoot ? CP.shoot.path : ''; }
  };
  var renderOrig = window.cbRenderCards;
  window.cbRenderCards = function () {
    try { cpGuardCheck(); } catch (e) { if (window.console) console.error('[CP] правила отбора', e); }
    var r = renderOrig.apply(this, arguments);
    cpGuardDecorate();
    return r;
  };
})();

/* ---------- шапка карточки: теги и предупреждение ---------- */

function cpGuardDecorate() {
  var root = document.getElementById('cbCards');
  if (!root) return;
  if (CP.shoot) {
    Array.prototype.forEach.call(root.querySelectorAll('.cb-card'), function (el) {
      var card = cbCardById(el.getAttribute('data-cid'));
      var head = el.querySelector('.cb-card-head');
      if (!card || !head || head.querySelector('.cp-card-tags')) return;
      var box = document.createElement('div');
      box.className = 'cp-card-tags';
      if (card.cpChangedAfterDl) {
        box.insertAdjacentHTML('beforeend', '<span class="cp-card-warn" title="' + cbEsc(card.cpChangedAfterDl.by + ' · ' + cpFmtDate(card.cpChangedAfterDl.ts))
          + '">изменена после скачивания</span>');
      }
      box.insertAdjacentHTML('beforeend', cpCardTagChips(card));
      head.appendChild(box);
    });
  }
  if (!root.querySelector('.cp-addcard')) {
    var plus = document.createElement('button');
    plus.className = 'cp-addcard';
    plus.title = 'Новая карточка — автолента. Можно бросить сюда кадр из галереи.';
    plus.innerHTML = '<b>+</b><span>Новая карточка</span>';
    root.appendChild(plus);
  }
  var can = typeof cpCollectAvailable === 'function' && cpCollectAvailable();
  var col = root.querySelector('.cp-collect');
  if (can && !col) {
    col = document.createElement('button');
    col.className = 'cp-addcard cp-collect';
    col.title = 'На каждую папку артикула — карточка товара со всеми кадрами папки. Собранное руками не трогает, повторное нажатие только дополняет.';
    col.innerHTML = '<span>Собрать карточки по папкам артикулов</span>';
    root.insertBefore(col, root.firstChild);
  } else if (!can && col) col.remove();
  /* выбранная карточка — с рамкой */
  Array.prototype.forEach.call(root.querySelectorAll('.cb-card'), function (el) {
    el.classList.toggle('cp-card-active', !!CP.activeCard && el.getAttribute('data-cid') === CP.activeCard);
  });
}

/* ---------- галерея следует за карточкой ----------
   Нажали на карточку — в галерее остаётся только лук (папка), к которому
   она относится: по папке артикула карточки, а у карточки без артикула —
   по общей папке её кадров. Пустая карточка папку не меняет. Галочка
   «по карточке» рядом с фильтром папок выключает это: тогда галерея
   показывает то, что выбрано в списке папок (например, «Все папки»). */

function cpCardFolder(card) {
  if (!card || !CP.shoot) return null;
  var type = typeof cpShootType === 'function' ? cpShootType(CP.shoot.name) : null;
  var lookIdx = type ? type.roles.indexOf('лук') : -1;
  if (card.cpArticleDir) {
    var seg = card.cpArticleDir.split('/');
    /* модельная (лук/артикул): весь лук; предметка (бренд/артикул): сама папка артикула */
    return lookIdx !== -1 && seg.length > 1 ? seg.slice(0, -1).join('/') : card.cpArticleDir;
  }
  var dirs = [];
  cpCardPids(card).forEach(function (pid) {
    var p = cbPhotoById(pid);
    if (p && p.disk) dirs.push(cpRelDir(p));
  });
  if (!dirs.length) return null;
  if (dirs.every(function (d) { return d === ''; })) return '/';
  var common = dirs[0].split('/');
  dirs.slice(1).forEach(function (d) {
    var s = d.split('/'), i = 0;
    while (i < common.length && common[i] === s[i]) i++;
    common = common.slice(0, i);
  });
  common = common.filter(Boolean);
  if (!common.length) return '';
  var depth = lookIdx !== -1 ? lookIdx + 1 : type ? type.roles.length : 1;
  return common.slice(0, depth).join('/');
}

function cpFollowOn() { return cpGet('cp_follow_card', '1') !== '0'; }

function cpSetActiveCard(id) {
  CP.activeCard = id || null;
  Array.prototype.forEach.call(document.querySelectorAll('#cbCards .cb-card'), function (el) {
    el.classList.toggle('cp-card-active', !!CP.activeCard && el.getAttribute('data-cid') === CP.activeCard);
  });
  if (!CP.shoot || !cpFollowOn()) return;
  var f = cpCardFolder(cbCardById(id));
  if (f === null || f === CP.folder) return;
  CP.folder = f;
  CP.folderByCard = true;
  cbRenderTray();
}

(function cpFollowCard() {
  var sel = document.getElementById('cpFolderFilter');
  if (sel) {
    var lab = document.createElement('label');
    lab.className = 'cp-liked-only';
    lab.title = 'Нажали на карточку — в галерее только её лук. Снимите галочку, чтобы галерея не переключалась сама';
    lab.innerHTML = '<input type="checkbox" id="cpFollowCard"> по карточке';
    sel.parentNode.appendChild(lab);
    var box = document.getElementById('cpFollowCard');
    box.checked = cpFollowOn();
    box.onchange = function () {
      cpSet('cp_follow_card', this.checked ? '1' : '0');
      if (this.checked && CP.activeCard) cpSetActiveCard(CP.activeCard);
      else if (!this.checked && CP.folderByCard) { CP.folder = ''; CP.folderByCard = false; cbRenderTray(); }
    };
  }
  document.getElementById('cbCards').addEventListener('click', function (e) {
    if (!CP.shoot || e.target.closest('.cp-addcard')) return;
    var el = e.target.closest('.cb-card');
    if (!el) return;
    var id = el.getAttribute('data-cid');
    /* карточку могли только что удалить этим же нажатием */
    setTimeout(function () { if (cbCardById(id)) cpSetActiveCard(id); }, 0);
  });
})();

/* ---------- новая карточка-автолента ---------- */

function cpAutoTemplate() {
  return cbTplById('seed_auto_flat')
    || App.templates.filter(function (t) { return t.mode === 'auto' && !t.hasHero; })[0]
    || App.templates.filter(function (t) { return t.mode === 'auto'; })[0]
    || null;
}

function cpAddAutoCard(pid) {
  var t = cpAutoTemplate();
  if (!t) { cbToast('Нет шаблона автоленты — создайте карточку из галереи шаблонов'); return; }
  cbAddCardFromTpl(t.id);
  var card = App.cards[App.cards.length - 1];
  if (card) CP.activeCard = card.id;
  if (pid && card && card.mode === 'auto') {
    card.pids.push(pid);
    cbMarkDirty();
    cbRenderCards();
    cbRenderTray();
  }
  var el = document.querySelector('#cbCards .cb-card[data-cid="' + card.id + '"]');
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

(function cpPlusEvents() {
  var root = document.getElementById('cbCards');
  root.addEventListener('click', function (e) {
    var plus = e.target.closest('.cp-addcard');
    if (plus && plus.classList.contains('cp-collect')) { e.preventDefault(); cpCollectCards(); return; }
    if (plus) { e.preventDefault(); cpAddAutoCard(); return; }
    var tg = e.target.closest('[data-cp-cardtag]');
    if (tg) {
      e.preventDefault(); e.stopPropagation();
      var c = cbCardById(tg.getAttribute('data-cid'));
      var t = tg.getAttribute('data-cp-cardtag');
      cpCardTag(c, t, !(c && (c.tags || []).indexOf(t) !== -1));
    }
  });
  root.addEventListener('dragover', function (e) {
    var plus = e.target.closest('.cp-addcard');
    if (!plus || plus.classList.contains('cp-collect')) return;
    e.preventDefault();
    plus.classList.add('cp-over');
  });
  root.addEventListener('dragleave', function (e) {
    var plus = e.target.closest('.cp-addcard');
    if (plus) plus.classList.remove('cp-over');
  });
  root.addEventListener('drop', function (e) {
    var plus = e.target.closest('.cp-addcard');
    if (!plus || plus.classList.contains('cp-collect')) return;
    e.preventDefault(); e.stopPropagation();
    plus.classList.remove('cp-over');
    var data = e.dataTransfer.getData('text/plain') || '';
    cpAddAutoCard(data.indexOf('photo:') === 0 ? data.slice(6) : null);
  }, true);
})();

/* ---------- теги карточки ---------- */

/**
 * Все теги словаря прямо на шапке карточки: нажал — тег стоит, ещё раз — снят.
 * Группы «не в карточке» не показываются; в группе «один» выбирается один тег.
 * Теги, которых больше нет в словаре, видны и снимаются.
 */
function cpCardTagChips(card) {
  var have = card.tags || [];
  var html = '', group = null;
  (CP.dict || []).forEach(function (d) {
    var g = (CP.dictGroups || {})[d.group] || { card: true, single: false };
    if (!g.card) return;
    if (d.group !== group) {
      group = d.group;
      if (group) html += '<span class="cp-tg-name">' + cbEsc(group) + '</span>';
    }
    var on = have.indexOf(d.tag) !== -1;
    html += '<button class="cp-tg' + (on ? ' cp-tg-on' : '') + '" data-cp-cardtag="' + cbEsc(d.tag) + '" data-cid="' + card.id + '"'
      + ' aria-pressed="' + on + '" title="' + (on ? 'Снять тег' : 'Поставить тег') + (g.single ? ' (из группы — один)' : '') + '">' + cbEsc(d.tag) + '</button>';
  });
  have.forEach(function (t) {
    if ((CP.dict || []).some(function (d) { return d.tag === t; })) return;
    html += '<button class="cp-tg cp-tg-on cp-tg-old" data-cp-cardtag="' + cbEsc(t) + '" data-cid="' + card.id + '" aria-pressed="true" title="Тега нет в словаре — снять">' + cbEsc(t) + '</button>';
  });
  return html;
}

function cpCardTag(card, tag, on) {
  if (!card || !tag) return;
  card.tags = on ? cpTagsWith(card.tags, tag) : (card.tags || []).filter(function (t) { return t !== tag; });
  cpEvent(on ? 'card_tag' : 'card_untag', [], { card: card.title, tag: tag }, true);
  cbMarkDirty();
  cbRenderCards();
}

if (CPDisk.hasToken()) cpLoadDict().then(function () { if (CP.shoot) cbRenderCards(); }, function () { });

/* ---------- запуск ----------
   Окна проектов Cardboard больше нет. Витрину открываем здесь, в последнем
   файле, — не дожидаясь таймера «лаунчера» в index.html (на медленной сети
   наши файлы грузятся дольше него). */
(function cpBoot() {
  CP.booted = true;
  if (!CP.shoot) cpShowShelf();
})();

/* подсказка пустой галереи — про съёмки с Диска, а не про импорт и Capture One */
cbRenderTray = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    var empty = document.querySelector('#cbTrayGrid .cb-tray-empty');
    if (empty && App.trayTab !== 'ref') {
      empty.innerHTML = CP.shoot
        ? (CP.folder || CP.likedOnly ? 'Здесь кадров нет — выберите «Все папки»' : 'Кадров нет: съёмка ещё читается с Диска или папка пуста')
        : 'Откройте съёмку на витрине:<br>Файл → Витрина съёмок';
    }
    return r;
  };
})(cbRenderTray);

/* ---------- новая версия: сказать и обновить в один клик ----------
   Маша, 06.11: «как в этом Safari нормально сбросить кэш — он хранит
   артефакты старых версий». Страницу (index.html) GitHub отдаёт с кэшем
   на 10 минут, а Safari по Cmd+R берёт её из кэша — и старые скрипты.
   Раз в 5 минут и при возврате на вкладку спрашиваем свежую страницу
   мимо кэша; вышла новее — плашка «Обновить». Клик открывает адрес с
   номером версии (?v=…): для браузера это другая страница, её он берёт
   с сервера, а скрипты уже с новыми номерами. */
CP.updateAt = 0;
function cpCheckUpdate() {
  CP.updateAt = Date.now();
  var url = location.pathname + '?check=' + Date.now();
  return fetch(url, { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : ''; }).then(function (html) {
    var m = /cp-app\.js\?v=([0-9.]+)/.exec(html || '');
    if (!m || m[1] === CP_VERSION) return null;
    var cur = CP_VERSION.split('.').map(Number), nv = m[1].split('.').map(Number);
    for (var i = 0; i < Math.max(cur.length, nv.length); i++) {
      if ((nv[i] || 0) > (cur[i] || 0)) break;
      if ((nv[i] || 0) < (cur[i] || 0)) return null;
    }
    if (!cpAutoUpdate(m[1])) cpShowUpdate(m[1]);
    return m[1];
  }).catch(function () { return null; });
}

/* Только что открыли старую страницу (Safari взял её из кэша по голой ссылке) — сразу
   перейти на свежую, без плашки (Маша, 09.11: «по голой ссылке должна последняя версия
   показываться»). Только в первые секунды и без несохранённых правок; на одну версию —
   одна попытка (если и по ?v= пришла старая — покажем плашку, а не будем перезагружать по кругу). */
CP.loadedAt = Date.now();
function cpAutoUpdate(ver) {
  if (Date.now() - CP.loadedAt > 30000 || (typeof App !== 'undefined' && App.dirty)) return false;
  var tried = '';
  try { tried = sessionStorage.getItem('cp_upd_tried') || ''; } catch (e) { }
  if (tried === ver || new RegExp('[?&]v=' + ver.replace(/\./g, '\\.') + '(&|$)').test(location.search)) return false;
  try { sessionStorage.setItem('cp_upd_tried', ver); } catch (e) { }
  location.replace(location.pathname + '?v=' + encodeURIComponent(ver) + location.hash);
  return true;
}

function cpShowUpdate(ver) {
  var el = document.getElementById('cpUpdate');
  if (!el) {
    el = document.createElement('div');
    el.id = 'cpUpdate';
    el.className = 'cp-update';
    document.body.appendChild(el);
    el.addEventListener('click', function (e) {
      if (e.target.closest('[data-cp-upd="go"]')) {
        if (typeof App !== 'undefined' && App.dirty) { cbToast('Сохраняю правки на Диск — нажмите «Обновить» ещё раз через пару секунд'); return; }
        location.replace(location.pathname + '?v=' + encodeURIComponent(el.getAttribute('data-ver')) + location.hash);
      } else if (e.target.closest('[data-cp-upd="later"]')) el.remove();
    });
  }
  el.setAttribute('data-ver', ver);
  el.innerHTML = 'Вышла версия <b>' + cbEsc(ver) + '</b> (у вас ' + cbEsc(CP_VERSION) + ') <button class="cb-primary" data-cp-upd="go">Обновить</button><button data-cp-upd="later">Позже</button>';
}

setInterval(function () { if (document.visibilityState !== 'hidden') cpCheckUpdate(); }, 5 * 60 * 1000);
document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && Date.now() - CP.updateAt > 60000) cpCheckUpdate(); });
cpCheckUpdate();   /* сразу при открытии: старая страница из кэша — сама перейдёт на свежую */

(function cpUpdateCss() {
  var st = document.createElement('style');
  st.textContent = '.cp-update{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:5000;display:flex;gap:10px;align-items:center;'
    + 'background:#1d1a17;border:1px solid #C9956B;color:#f2f2f1;border-radius:6px;padding:8px 12px;font-size:13px;box-shadow:0 6px 24px #000a}'
    + '.cp-update b{color:#e7c9a8}';
  document.head.appendChild(st);
})();
