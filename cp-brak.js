/* ============================================================
   cp-brak.js — брак: вид, комментарий, папка _БРАК в архиве

   Маша, 09.11.2026: «коллега отправила фотографии в брак — они никуда не
   уехали; непонятно, куда уезжает брак». «В архиве — подпапка брак, в
   которую переносится забракованная карточка, сохраняя структуру съёмки.
   Брак бывает двух видов — по стилю и по фото (технике выполнения). Каждый
   раз при переносе в брак — поле, как в ретуши, с комментарием, чтобы потом
   на это опираться». «Пометка о браке должна сохраняться, чтобы легко
   посчитать, вытащить, посмотреть».

   «В брак» (кадр, карточка, пачка отмеченных, просмотр крупно):
     1. окно: вид брака (стиль / фото — техника) и комментарий;
     2. отметка в отборе: статус «брак» + вид + комментарий + кто + когда;
     3. копия кадров в  КАТАЛОГ/00_АРХИВ/_БРАК/<съёмка>/<папки как в исходниках>
        (кадр карточки артикула — в папку артикула). Исходники в 01 не трогаем;
        без каталога — в <служебная папка>/брак/<съёмка>/;
     4. копии этих кадров в ретуши (03) — в Корзину; на согласовании (02)
        их убирает сверка согласования (статус больше не «согласование»);
     5. строка в _ContentPulse/брак.csv: дата, съёмка, карточка, кадров, вид,
        комментарий, кто — для подсчёта по всем съёмкам.
   Всё, что двигает файлы, идёт через очередь переносов (cp-queue.js):
   переносит, пока не перенесёт. «Снять статус» с брака — копия из _БРАК в
   Корзину и строка «снято» в брак.csv.

   Отбор хранит копии в meta.cp.brak: {кадр: путь копии в _БРАК}.
   Префикс: cpBrak*.
   ============================================================ */

var CP_BRAK_KINDS = [['style', 'по стилю'], ['photo', 'по фото — техника выполнения']];
var CP_BRAK_FILE = 'брак.csv';
var CP_BRAK_HEAD = 'дата;время;съёмка;карточка;кадров;вид;комментарий;кто;событие';

function cpBrakKindLabel(k) { var x = CP_BRAK_KINDS.filter(function (y) { return y[0] === k; })[0]; return x ? x[1] : ''; }

/** Куда кладём брак этой съёмки. В каталоге без 00_АРХИВ — '' (тост уже показан). */
function cpBrakRoot(shootName) {
  if (typeof cpCatalog === 'function' && cpCatalog()) {
    if (cpCatStageMissing('archive')) return '';
    return CP.settings.archive.replace(/\/+$/, '') + '/_БРАК/' + CPDisk.safeName(shootName);
  }
  return CP_CONFIG.serviceDir.replace(/\/+$/, '') + '/брак/' + CPDisk.safeName(shootName);
}

/* ---------- окно ---------- */

(function cpBrakCss() {
  var st = document.createElement('style');
  st.textContent = '#cpBrak{position:fixed;inset:0;background:#0b0b0acc;z-index:4500;display:none;align-items:center;justify-content:center}'
    + '#cpBrak.cp-open{display:flex}#cpBrak .cp-brak-p{background:#1d1d1b;border:1px solid #8a4a32;border-radius:6px;padding:16px 18px;width:min(440px,calc(100vw - 32px));color:#f2f2f1}'
    + '#cpBrak h3{font-size:14px;font-weight:600;margin-bottom:10px}#cpBrak label{display:flex;gap:8px;align-items:center;font-size:12.5px;margin:6px 0;cursor:pointer}'
    + '#cpBrak textarea{width:100%;min-height:70px;margin-top:8px;background:#131313;border:1px solid #2a2a28;color:#f2f2f1;border-radius:3px;padding:6px 8px;font:inherit;font-size:12.5px}'
    + '#cpBrak .cp-brak-f{display:flex;gap:8px;justify-content:flex-end;margin-top:12px}#cpBrak .cp-brak-err{color:#f2b8a0;font-size:11.5px;min-height:14px;margin-top:4px}';
  document.head.appendChild(st);
})();

/** Спросить вид и комментарий. cb({kind, note}) — только если нажали «В брак». */
function cpBrakAsk(title, cb) {
  if (CP.brakAuto) return cb(CP.brakAuto);   /* только для автотестов (tests/e2e.js) */
  var box = document.getElementById('cpBrak');
  if (!box) { box = document.createElement('div'); box.id = 'cpBrak'; document.body.appendChild(box); }
  box.innerHTML = '<div class="cp-brak-p"><h3>В брак: ' + cbEsc(title) + '</h3>'
    + CP_BRAK_KINDS.map(function (k) { return '<label><input type="radio" name="cpBrakKind" value="' + k[0] + '"> Брак ' + cbEsc(k[1]) + '</label>'; }).join('')
    + '<textarea id="cpBrakNote" placeholder="Что не так (увидят в архиве брака)"></textarea>'
    + '<div class="cp-brak-err" id="cpBrakErr"></div>'
    + '<div class="cp-brak-f"><button data-cp-brak-x>Отмена</button><button class="cb-primary" data-cp-brak-go>В брак</button></div></div>';
  box.classList.add('cp-open');
  box.onclick = function (e) {
    if (e.target === box || e.target.closest('[data-cp-brak-x]')) { box.classList.remove('cp-open'); return; }
    if (!e.target.closest('[data-cp-brak-go]')) return;
    var k = box.querySelector('input[name="cpBrakKind"]:checked');
    if (!k) { document.getElementById('cpBrakErr').textContent = 'Выберите вид брака'; return; }
    box.classList.remove('cp-open');
    cb({ kind: k.value, note: document.getElementById('cpBrakNote').value.trim() });
  };
}

/* ---------- применить ---------- */

/**
 * В брак (Маша, 10.11.2026): сначала копия в _БРАК, потом статус — «статус появляется на основании
 * того, что что-то наличествует на Диске в нужном месте». groups: [{cardId, pids}], info: {kind, note}.
 * Скопировалось — кадр (и карточка) в браке, копия из 03 уходит в Корзину, строка в брак.csv.
 * Не скопировалось сразу — копия в очередь, статус появится, когда она доедет (CPQ.after['brak-st']).
 */
function cpBrakSend(groups, info) {
  if (!CP.shoot) return;
  var shoot = { path: CP.shoot.path, name: CP.shoot.name }, m = cpMeta(), who = cpActor();
  var root = cpBrakRoot(shoot.name);
  if (!root) return;
  m.brak = m.brak || {};
  var rtBase = '';
  try { rtBase = cpRetouchBase(shoot.path, shoot.name); } catch (e) { rtBase = ''; }
  var items = [], cardOf = {}, relOf = {}, was = {}, seen = {}, nofile = 0;
  groups.forEach(function (g) {
    var card = g.cardId ? cbCardById(g.cardId) : null;
    (g.pids || []).forEach(function (pid) {
      var p = cbPhotoById(pid);
      if (!p || (p.kind || 'photo') === 'ref' || seen[pid]) return;
      seen[pid] = true;
      cardOf[pid] = g.cardId || null;
      was[pid] = m.status[pid] ? m.status[pid].s : '';
      if (!p.disk || p.missing) { nofile++; return; }
      relOf[pid] = cpRetouchRel(p, card, shoot.path);
      items.push({ pid: pid, from: p.disk, path: m.brak[pid] || (root + '/' + relOf[pid]) });
    });
  });
  var d = new Date(), z = function (n) { return (n < 10 ? '0' : '') + n; };
  var finish = function (okItems, queued) {
    if (!CP.shoot || CP.shoot.path !== shoot.path) return;
    var mm = cpMeta(), ts = new Date().toISOString(), okPid = {}, trash = [], rows = [], names = [], nCards = 0;
    mm.brak = mm.brak || {};
    okItems.forEach(function (x) {
      mm.status[x.pid] = { s: 'reshoot', by: who, ts: ts, card: cardOf[x.pid] || undefined, kind: info.kind, note: info.note };
      mm.brak[x.pid] = x.path;
      okPid[x.pid] = true;
      /* был на ретуши — копия в 03 больше не нужна */
      if (rtBase && was[x.pid] === 'retouch') trash.push(rtBase + '/' + relOf[x.pid]);
    });
    groups.forEach(function (g) {
      var card = g.cardId ? cbCardById(g.cardId) : null;
      var withFile = (g.pids || []).filter(function (pid) { return relOf[pid] !== undefined; });
      var okN = withFile.filter(function (pid) { return okPid[pid]; }).length;
      /* карточка в браке, когда её кадры лежат в _БРАК (или кадров с файлами в ней нет вовсе) */
      if (g.cardId && (okN || !withFile.length)) { mm.cardStatus[g.cardId] = { s: 'reshoot', by: who, ts: ts, kind: info.kind, note: info.note }; nCards++; }
      if (!okN && !(g.cardId && !withFile.length)) return;
      if (card) names.push(card.title || card.category || 'карточка');
      rows.push([cpToday(), z(d.getHours()) + ':' + z(d.getMinutes()), shoot.name, card ? card.title || card.category || '' : (withFile.length === 1 && cbPhotoById(withFile[0]) ? cbPhotoById(withFile[0]).name : ''),
        okN, cpBrakKindLabel(info.kind), info.note, who, 'в брак']);
    });
    if (okItems.length || nCards) {
      cpEvent('to_reshoot', cpPhotoNames(okItems.map(function (x) { return x.pid; })), names.length ? { card: names.join(', ') } : {});
      cpEvent('to_reshoot_info', [], { note: 'брак ' + cpBrakKindLabel(info.kind) + (info.note ? ': ' + info.note : '') + ' → ' + CPDisk.showPath(root) }, true);
      if (trash.length) CPQ.add(shoot, { kind: 'trash', label: 'Брак — убрать из ретуши: ' + trash.length, paths: trash });
      cpOutputAppend(rows, CP_BRAK_FILE, CP_BRAK_HEAD);
    }
    cpAfterStatus();
    if (typeof cbRenderOutline === 'function') cbRenderOutline();
    if (!okItems.length && !queued && !nCards) { cbToast('В брак не отправлено: этих кадров нет на Диске'); return; }
    cbToast(CP_STATUS.reshoot.label + ': ' + (nCards > 1 ? 'карточек ' + nCards + ', ' : '') + okItems.length + ' кадр(ов)'
      + (queued ? '. Не скопировалось в брак сразу: ' + queued + ' — копирую повторно, статус появится, когда файлы будут на месте' : ''));
  };
  var queue = function (list, err) {
    var a = { type: 'brak-st', by: who, kind: info.kind, note: info.note, map: {}, cards: {} };
    list.forEach(function (x) { a.map[x.from] = [x.pid, x.path]; if (cardOf[x.pid]) a.cards[x.pid] = cardOf[x.pid]; });
    CPQ.add(shoot, { kind: 'copy', label: 'В брак: ' + list.length + ' кадр(ов)', items: list.map(function (x) { return { from: x.from, path: x.path }; }), dirs: [root], after: a, err: err || '' });
  };
  if (!items.length) { finish([], 0); return; }
  cpCopyOnDisk(items.map(function (x) { return { from: x.from, path: x.path }; }), [root], 'Копирую в брак').then(function (r) {
    cbBusyHide();
    var bad = {};
    (r.failedFrom || []).forEach(function (f) { bad[f] = true; });
    var left = items.filter(function (x) { return bad[x.from]; });
    if (left.length) queue(left, r.failed && r.failed[0]);
    finish(items.filter(function (x) { return !bad[x.from]; }), left.length);
  }, function (e) {
    cbBusyHide();
    queue(items, (e && e.message) || '');
    finish([], items.length);
  });
}

/* копии брака из очереди доехали — кадры и карточки получают статус */
CPQ.after['brak-st'] = function (op, m) {
  var a = op.after, now = new Date().toISOString(), cards = {}, n = 0;
  m.brak = m.brak || {}; m.status = m.status || {}; m.cardStatus = m.cardStatus || {};
  Object.keys(a.map || {}).forEach(function (from) {
    var v = a.map[from], pid = v[0], cid = (a.cards || {})[pid] || null;
    m.status[pid] = { s: 'reshoot', by: a.by || cpActor(), ts: now, card: cid || undefined, kind: a.kind, note: a.note };
    m.brak[pid] = v[1];
    if (cid) cards[cid] = true;
    n++;
  });
  Object.keys(cards).forEach(function (cid) { m.cardStatus[cid] = { s: 'reshoot', by: a.by || cpActor(), ts: now, kind: a.kind, note: a.note }; });
  if (n) (m.events = m.events || []).push({ ts: now, action: 'to_reshoot', actor: a.by || cpActor(), items: [], note: 'файлы в браке — статус поставлен: кадров ' + n });
};
CPQ.redraw['brak-st'] = true;

CPQ.after['brak'] = function (op, m) {
  m.brak = m.brak || {};
  Object.keys(op.after.map || {}).forEach(function (from) { var v = op.after.map[from]; m.brak[v[0]] = v[1]; });
};
CPQ.after['brak-drop'] = function (op, m) {
  m.brak = m.brak || {};
  (op.after.pids || []).forEach(function (pid) { delete m.brak[pid]; });
};

/** Сняли статус с брака — копия из _БРАК в Корзину, строка «снято». */
function cpBrakUndo(pids, cardId) {
  if (!CP.shoot) return;
  var m = cpMeta(), paths = [], gone = [];
  pids.forEach(function (pid) { if (m.brak && m.brak[pid]) { paths.push(m.brak[pid]); gone.push(pid); } });
  if (!paths.length) return;
  CPQ.add(CP.shoot, { kind: 'trash', label: 'Снят брак — убрать из _БРАК: ' + paths.length, paths: paths, after: { type: 'brak-drop', pids: gone } });
  var card = cardId ? cbCardById(cardId) : null, d = new Date(), z = function (n) { return (n < 10 ? '0' : '') + n; };
  cpOutputAppend([[cpToday(), z(d.getHours()) + ':' + z(d.getMinutes()), CP.shoot.name, card ? card.title || '' : '', gone.length, '', '', cpActor(), 'снято']], CP_BRAK_FILE, CP_BRAK_HEAD);
}

function cpBrakSnapshot(pids) {
  var m = cpMeta(), out = {};
  pids.forEach(function (pid) { out[pid] = m.status[pid] ? m.status[pid].s : ''; });
  return out;
}

/* «В брак» по одной (кадр, карточка, просмотр крупно) — сначала окно */
cpDoAction = (function (orig) {
  return function (status, pids, cardId) {
    var self = this, args = arguments;
    if (status === 'reshoot') {
      if (!pids || !pids.length) return orig.apply(self, args);
      if (!cpBrakRoot(CP.shoot ? CP.shoot.name : '')) return;
      var card = cardId ? cbCardById(cardId) : null, p0 = cbPhotoById(pids[0]);
      if (!pids.some(function (pid) { var p = cbPhotoById(pid); return p && (p.kind || 'photo') !== 'ref'; })) return orig.apply(self, args);
      cpBrakAsk(card ? (card.title || card.category || 'карточка') + ' · кадров ' + pids.length : (p0 ? p0.name : 'кадр'), function (info) {
        cpBrakSend([{ cardId: cardId, pids: pids }], info);   /* копия в _БРАК -> статус */
      });
      return;
    }
    /* сняли брак или поставили другой статус — копия из _БРАК больше не брак */
    if (pids && pids.length) {
      var was = pids.filter(function (pid) { var s = cpMeta().status[pid]; return s && s.s === 'reshoot'; });
      var r = orig.apply(self, args);
      if (was.length) cpBrakUndo(was, cardId);
      return r;
    }
    return orig.apply(self, args);
  };
})(cpDoAction);

/* «В брак» пачкой (список карточек справа) — одно окно на всю пачку */
cpBatchStatus = (function (orig) {
  return function (status) {
    var self = this, args = arguments;
    var cards = cpCheckedCards();
    var groups = cards.map(function (c) {
      return { cardId: c.id, pids: cpCardPids(c).filter(function (pid) { var p = cbPhotoById(pid); return p && (p.kind || 'photo') !== 'ref'; }) };
    });
    var all = [].concat.apply([], groups.map(function (g) { return g.pids; }));
    if (status === 'reshoot' && cards.length) {
      if (!cpBrakRoot(CP.shoot ? CP.shoot.name : '')) return;
      cpBrakAsk('карточек ' + cards.length + ' · кадров ' + all.length, function (info) {
        cpBrakSend(groups, info);   /* копия в _БРАК -> статус */
      });
      return;
    }
    if (cards.length) {
      var was = groups.map(function (g) { return { cardId: g.cardId, pids: g.pids.filter(function (pid) { var s = cpMeta().status[pid]; return s && s.s === 'reshoot'; }) }; });
      var r = orig.apply(self, args);
      was.forEach(function (g) { if (g.pids.length) cpBrakUndo(g.pids, g.cardId); });
      return r;
    }
    return orig.apply(self, args);
  };
})(cpBatchStatus);
