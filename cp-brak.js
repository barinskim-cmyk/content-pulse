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

/** После того как статус «брак» поставлен: вид и комментарий в отбор, копии в _БРАК, уборка 03, строка в брак.csv. */
function cpBrakApply(groups, info, before) {
  if (!CP.shoot) return;
  var shoot = CP.shoot, m = cpMeta(), who = cpActor(), now = new Date().toISOString();
  var root = cpBrakRoot(shoot.name);
  m.brak = m.brak || {};
  var copy = [], map = {}, trash = [], rows = [], rtBase = '';
  try { rtBase = cpRetouchBase(shoot.path, shoot.name); } catch (e) { rtBase = ''; }
  groups.forEach(function (g) {
    var card = g.cardId ? cbCardById(g.cardId) : null;
    g.pids.forEach(function (pid) {
      var p = cbPhotoById(pid);
      if (m.status[pid]) { m.status[pid].kind = info.kind; m.status[pid].note = info.note; }
      if (!p || !p.disk || p.missing) return;
      var rel = cpRetouchRel(p, card, shoot.path);
      if (root && !m.brak[pid]) { copy.push({ from: p.disk, path: root + '/' + rel }); map[p.disk] = [pid, root + '/' + rel]; }
      /* был на ретуши — копия в 03 больше не нужна */
      if (rtBase && before[pid] === 'retouch') trash.push(rtBase + '/' + rel);
    });
    if (g.cardId && m.cardStatus[g.cardId]) { m.cardStatus[g.cardId].kind = info.kind; m.cardStatus[g.cardId].note = info.note; }
    var d = new Date(), z = function (n) { return (n < 10 ? '0' : '') + n; };
    rows.push([cpToday(), z(d.getHours()) + ':' + z(d.getMinutes()), shoot.name, card ? card.title || card.category || '' : (g.pids.length === 1 && cbPhotoById(g.pids[0]) ? cbPhotoById(g.pids[0]).name : ''),
      g.pids.length, cpBrakKindLabel(info.kind), info.note, who, 'в брак']);
  });
  cpEvent('to_reshoot_info', [], { note: 'брак ' + cpBrakKindLabel(info.kind) + (info.note ? ': ' + info.note : '') + (root ? ' → ' + CPDisk.showPath(root) : '') }, true);
  cbMarkDirty();
  if (copy.length) CPQ.add(shoot, { kind: 'copy', label: 'В брак: ' + copy.length + ' кадр(ов)', items: copy, dirs: [root], after: { type: 'brak', map: map } });
  if (trash.length) CPQ.add(shoot, { kind: 'trash', label: 'Брак — убрать из ретуши: ' + trash.length, paths: trash });
  cpOutputAppend(rows, CP_BRAK_FILE, CP_BRAK_HEAD);
  cpAfterStatus();
}

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
      cpBrakAsk(card ? (card.title || card.category || 'карточка') + ' · кадров ' + pids.length : (p0 ? p0.name : 'кадр'), function (info) {
        var before = cpBrakSnapshot(pids);
        orig.apply(self, args);
        cpBrakApply([{ cardId: cardId, pids: pids }], info, before);
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
        var before = cpBrakSnapshot(all);
        orig.apply(self, args);
        cpBrakApply(groups, info, before);
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
