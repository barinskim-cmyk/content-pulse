/* ============================================================
   cp-guard.js — отбор после отправки на ретушь и скачивания,
   теги карточек и быстрое создание карточки.

   Правила (договорённость с Машей, 05.11.2026):
     - карточку, из которой уже скачивали, менять можно, но с
       предупреждением: на шапке «изменена после скачивания», тост,
       запись в журнал; отменить — Cmd+Z;
     - кадр, который скачали на ретушь и потом убрали из отбора
       (нет ни в одной карточке и доп. контенте), получает статус
       «Удалено из отбора» — ретушёр видит, что его делать не надо;
       ещё не скачанный — просто снимается с ретуши;
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
  var changed = false, warnCards = [], removedDl = [], unretouched = [], inherit = [];
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
    removed.forEach(function (pid) {
      if (cpInSelection(pid)) return;          /* перенесли в другую карточку */
      var st = m.status[pid], d = m.downloads[pid];
      if (!st || st.s !== 'retouch') return;
      if (d && d.n) {
        m.status[pid] = { s: 'removed', by: actor, ts: ts, card: cid, was: 'retouch' };
        removedDl.push(pid);
      } else {
        delete m.status[pid];                  /* ещё не забрали — просто снимаем с ретуши */
        unretouched.push(pid);
      }
      changed = true;
    });
    /* добавили в карточку, которая уже на ретуши — кадр тоже уходит на ретушь */
    if (card && cst && cst.s === 'retouch') {
      var fresh = added.filter(function (pid) {
        var st = m.status[pid];
        var p = cbPhotoById(pid);
        return p && (p.kind || 'photo') !== 'ref' && (!st || st.s === 'removed');
      });
      if (fresh.length) inherit.push({ card: card, pids: fresh });
    }
  });
  if (warnCards.length) {
    warnCards.forEach(function (w) {
      cpEvent('changed_after_download', [], { card: w.title, downloaded: w.n }, true);
    });
    cbToast('Внимание: из карточки «' + warnCards[0].title + '» уже скачивали ' + warnCards[0].n
      + ' кадр(ов). Убранные помечены «Удалено из отбора», добавленные уйдут как не скачанные. Отменить — Cmd+Z.');
  }
  if (removedDl.length) cpEvent('removed_after_download', cpPhotoNames(removedDl), {}, true);
  if (unretouched.length) cpEvent('clear_status', cpPhotoNames(unretouched), { note: 'убраны из карточки до скачивания' }, true);
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
      var box = document.createElement('span');
      box.className = 'cp-card-tags';
      box.style.display = 'contents';
      (card.tags || []).forEach(function (t) {
        box.insertAdjacentHTML('beforeend', '<span class="cp-card-tag">' + cbEsc(t)
          + '<button data-cp-card-untag="' + cbEsc(t) + '" data-cid="' + card.id + '" title="Снять тег">×</button></span>');
      });
      if (card.cpChangedAfterDl) {
        box.insertAdjacentHTML('beforeend', '<span class="cp-card-warn" title="' + cbEsc(card.cpChangedAfterDl.by + ' · ' + cpFmtDate(card.cpChangedAfterDl.ts))
          + '">изменена после скачивания</span>');
      }
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
}

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
    if (plus) { e.preventDefault(); cpAddAutoCard(); return; }
    var un = e.target.closest('[data-cp-card-untag]');
    if (un) {
      e.preventDefault(); e.stopPropagation();
      cpCardTag(cbCardById(un.getAttribute('data-cid')), un.getAttribute('data-cp-card-untag'), false);
    }
  });
  root.addEventListener('dragover', function (e) {
    var plus = e.target.closest('.cp-addcard');
    if (!plus) return;
    e.preventDefault();
    plus.classList.add('cp-over');
  });
  root.addEventListener('dragleave', function (e) {
    var plus = e.target.closest('.cp-addcard');
    if (plus) plus.classList.remove('cp-over');
  });
  root.addEventListener('drop', function (e) {
    var plus = e.target.closest('.cp-addcard');
    if (!plus) return;
    e.preventDefault(); e.stopPropagation();
    plus.classList.remove('cp-over');
    var data = e.dataTransfer.getData('text/plain') || '';
    cpAddAutoCard(data.indexOf('photo:') === 0 ? data.slice(6) : null);
  }, true);
})();

/* ---------- теги карточки ---------- */

/** Пункты тегов для меню «ещё» карточки. */
function cpCardTagMenu(card) {
  if (CP.dict === undefined) cpLoadDict().catch(function () { });
  var html = '<div class="cp-menu-sub">Тег карточки</div>';
  if (!CP.dict || !CP.dict.length) {
    html += '<button data-x="nodict">' + (CP.dict === undefined ? 'Словарь загружается...' : 'Словаря тегов нет — «Файлы настроек» на витрине') + '</button>';
  } else {
    var have = card.tags || [];
    CP.dict.forEach(function (d) {
      var on = have.indexOf(d.tag) !== -1;
      html += '<button data-x="tag" data-tag="' + cbEsc(d.tag) + '"' + (on ? ' class="cp-on"' : '') + '>'
        + (on ? 'Снять тег ' : 'Тег ') + cbEsc(d.tag) + (d.group ? ' · ' + cbEsc(d.group) : '') + '</button>';
    });
  }
  return {
    html: html,
    onClick: function (b) {
      if (b.getAttribute('data-x') !== 'tag') return;
      var tag = b.getAttribute('data-tag');
      cpCardTag(card, tag, (card.tags || []).indexOf(tag) === -1);
    }
  };
}

function cpCardTag(card, tag, on) {
  if (!card || !tag) return;
  card.tags = (card.tags || []).filter(function (t) { return t !== tag; });
  if (on) card.tags.push(tag);
  cpEvent(on ? 'card_tag' : 'card_untag', [], { card: card.title, tag: tag }, true);
  cbMarkDirty();
  cbRenderCards();
}

if (CPDisk.hasToken()) cpLoadDict().catch(function () { });
