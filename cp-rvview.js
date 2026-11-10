/* ============================================================
   cp-rvview.js — просмотр сданной ретуши (приёмка старшим ретушёром)

   Маша, 10.11.2026: «просмотровик для ретуши открывает маленькую картинку в
   уголке. Надо, чтобы он работал так же, как просмотр галереи в исходниках,
   только без лайков. Чтобы на доработку можно было отправить одну конкретную
   картинку с комментарием, а не всю карточку. И на сайт. При этом на сайт
   копируется только тогда, когда вся карточка отмечена; пока её полностью
   не согласовали — не копируется. Отправляем после того, как завершили
   просмотр».
   Три способа, работают все (и записывается, каким отправили):
     1. Листаю кадры всех карточек на проверке. Косяк — «На доработку» и
        что не так; всё хорошо — «На сайт» на каждом кадре. Отмечены все
        кадры карточки — она готова.
     2. Листаю, отмечаю только косяки. Долистала карточку до конца без
        замечаний — вопрос «Отправить карточку на сайт?».
     3. Смотрю карточки сверху, открываю кадр-другой, чтобы увеличить, и
        жму «На сайт» на самой карточке — или отмечаю галочками в списке
        справа и жму «На сайт» там.
   Закрыли просмотр — готовые карточки уезжают на сайт, карточки с
   замечаниями — на доработку (замечания по кадрам — в примечании версии и
   на миниатюрах). Отметки по кадрам хранятся в версии ретуши (fm), поэтому
   не теряются, если страницу закрыли посреди просмотра: над карточками
   остаётся кнопка «Завершить просмотр».

   Подключается после cp-review.js. Префикс: cpRvv*.
   ============================================================ */

CP.rvv = null;   /* {list: [{id, i}], k, ro, seen: {id: {имя: true}}, asked: {id: true}, bar: ''|'note'|'ask'} */

/* ---------- отметки по кадрам ---------- */

function cpRvvMark(ver, f) { return ((ver && ver.fm) || {})[f.name] || null; }

/** {ok, rework, total} по кадрам версии. */
function cpRvvCounts(ver) {
  var c = { ok: 0, rework: 0, total: (ver && ver.files || []).length };
  (ver && ver.files || []).forEach(function (f) {
    var m = cpRvvMark(ver, f);
    if (m && m.s === 'ok') c.ok++;
    else if (m && m.s === 'rework') c.rework++;
  });
  return c;
}

/** Замечания по кадрам одной строкой — в примечание версии «на доработке». */
function cpRvvNotes(ver) {
  return (ver.files || []).map(function (f) {
    var m = cpRvvMark(ver, f);
    return m && m.s === 'rework' ? f.name + (m.note ? ' — ' + m.note : '') : '';
  }).filter(Boolean).join('; ');
}

/** Карточки, по которым просмотр не завершён: {site: [id], rework: [id]}. */
function cpRvvPending() {
  var rv = cpRv(), out = { site: [], rework: [] };
  App.cards.forEach(function (c) {
    var last = cpLastRv(rv[c.id]);
    if (!last || last.status !== 'review') return;
    var n = cpRvvCounts(last);
    if (n.rework) out.rework.push(c.id);
    else if (last.ready || (n.total && n.ok === n.total)) out.site.push(c.id);
  });
  return out;
}

/** Завершить просмотр: с замечаниями — на доработку, готовые — на сайт (по способам). */
function cpRvvFinish() {
  if (!CP.shoot) return;
  var rv = cpRv(), pend = cpRvvPending();
  if (!pend.site.length && !pend.rework.length) return;
  pend.rework.forEach(function (id) {
    var last = cpLastRv(rv[id]);
    delete last.ready;
    cpRvRework(id, cpRvvNotes(last));
  });
  /* способ — у каждой карточки свой: все кадры отмечены или «Отправить» на вопрос в конце карточки */
  var via = {};
  pend.site.forEach(function (id) {
    var last = cpLastRv(rv[id]), n = cpRvvCounts(last);
    via[id] = n.total && n.ok === n.total ? 'viewer_marks' : (last.ready && last.ready.via) || 'viewer_ask';
  });
  if (pend.site.length) cpRvApprove(pend.site, via);
  cbToast('Просмотр завершён: на сайт — ' + pend.site.length + ', на доработку — ' + pend.rework.length);
}

/* ---------- окно ---------- */

(function cpRvvDom() {
  var lb = document.createElement('div');
  lb.className = 'cp-lb';
  lb.id = 'cpRvv';
  lb.innerHTML = '<div class="cp-lb-head">'
    + '<div><b id="cpRvvName"></b><br><small id="cpRvvSub"></small></div><span id="cpRvvMark"></span>'
    + '<span class="cp-sp"></span><small id="cpRvvCount"></small>'
    + '<button data-rvv="prev" title="Предыдущий кадр (стрелка влево)">Назад</button>'
    + '<button data-rvv="next" title="Следующий кадр (стрелка вправо)">Вперёд</button>'
    + '<button data-rvv="rework" title="Этот кадр — на доработку, с комментарием для ретушёра (клавиша D)">На доработку</button>'
    + '<button data-rvv="ok" class="cb-primary" title="Этот кадр принят. Карточка уедет на сайт, когда приняты все её кадры и просмотр закрыт (клавиша Enter)">На сайт</button>'
    + '<button data-rvv="close" title="Закрыть просмотр: готовые карточки — на сайт, с замечаниями — на доработку (Esc)">Закрыть</button></div>'
    + '<div class="cp-rvv-bar" id="cpRvvBar"></div>'
    + '<div class="cp-lb-body" id="cpRvvBody"><img id="cpRvvImg" alt=""><div class="cp-lb-note" id="cpRvvNote"></div></div>';
  document.body.appendChild(lb);
  var st = document.createElement('style');
  st.textContent = '.cp-rvv-bar{display:none;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 16px;border-bottom:1px solid #2a2a28;background:#1d1a17;font-size:13px}'
    + '.cp-rvv-bar.cp-open{display:flex}.cp-rvv-bar textarea{flex:1;min-width:260px;height:44px;background:#141413;border:1px solid #3a3a37;color:#f2f2f1;padding:6px 8px;border-radius:3px;font:inherit}'
    + '.cp-rvv-m{font-size:11px;border-radius:10px;padding:2px 9px;border:1px solid #3a3a37;color:#a3a09a}'
    + '.cp-rvv-m.cp-ok{color:#9fc2a3;border-color:#3d5a40}.cp-rvv-m.cp-bad{color:#f2b8a0;border-color:#8a4a32}'
    + '.cp-rv-t.cp-rvv-ok{border-color:#5a8a60;box-shadow:inset 0 -3px 0 #5a8a60}.cp-rv-t.cp-rvv-bad{border-color:#b0603f;box-shadow:inset 0 -3px 0 #b0603f}'
    + '.cp-rvv-sum{font-size:11px;color:#a3a09a;margin-left:6px}.cp-rvv-sum b{color:#e7c9a8;font-weight:500}'
    + '.cp-rvv-fin{margin-left:auto}'
    + '#cbToast{z-index:4200}';   /* подсказки видны и поверх окна просмотра */
  document.head.appendChild(st);
  lb.addEventListener('click', function (e) {
    var b = e.target.closest('[data-rvv]');
    if (b) {
      var a = b.getAttribute('data-rvv');
      if (a === 'close') cpRvvClose();
      else if (a === 'prev') cpRvvStep(-1);
      else if (a === 'next') cpRvvStep(1);
      else if (a === 'ok') cpRvvOk();
      else if (a === 'rework') cpRvvNoteOpen();
      else if (a === 'note-save') cpRvvNoteSave();
      else if (a === 'bar-close') cpRvvBar('');
      else if (a === 'ask-yes') cpRvvAskAnswer(true);
      else if (a === 'ask-no') cpRvvAskAnswer(false);
      return;
    }
    if (e.target.id === 'cpRvvImg') {
      document.getElementById('cpRvvBody').classList.toggle('cp-full');
      cpRvvNote();
    }
  });
  document.addEventListener('keydown', function (e) {
    if (!CP.rvv) return;
    var inText = e.target && e.target.id === 'cpRvvText';
    if (e.key === 'Escape') { if (CP.rvv.bar) cpRvvBar(''); else cpRvvClose(); }
    else if (inText) { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) cpRvvNoteSave(); else return; }
    else if (CP.rvv.bar === 'ask') { if (e.key === 'Enter') cpRvvAskAnswer(true); else return; }
    else if (e.key === 'ArrowLeft') cpRvvStep(-1);
    else if (e.key === 'ArrowRight') cpRvvStep(1);
    else if (e.key === 'Enter' && !CP.rvv.ro) cpRvvOk();
    else if (e.code === 'KeyD' && !CP.rvv.ro) cpRvvNoteOpen();
    else return;
    e.preventDefault();
    e.stopPropagation();   /* горячие клавиши Cardboard под окном просмотра не срабатывают */
  }, true);
})();

/** Кадры всех карточек, чья ретушь сейчас на проверке, по порядку карточек. */
function cpRvvList() {
  var rv = cpRv(), list = [];
  App.cards.forEach(function (c) {
    var last = cpLastRv(rv[c.id]);
    if (!last || last.status !== 'review') return;
    (last.files || []).forEach(function (f, i) { list.push({ id: c.id, i: i }); });
  });
  return list;
}

/** Открыть просмотр с кадра i версии ver (её карточка находится сама). */
function cpRvvOpenVer(ver, i) {
  var rv = cpRv(), id = '';
  Object.keys(rv).forEach(function (k) { if ((rv[k] || []).indexOf(ver) !== -1) id = k; });
  if (!id) return;
  cpRvvOpen(id, i);
}

function cpRvvOpen(id, i) {
  var last = cpLastRv(cpRv()[id]);
  if (!last || !(last.files || []).length) return;
  var ro = last.status !== 'review';
  /* на проверке — листаются все карточки на проверке; иначе (на доработке, на сайте) — только эта, без кнопок */
  var list = ro ? last.files.map(function (f, k) { return { id: id, i: k }; }) : cpRvvList();
  var k = 0;
  list.forEach(function (x, n) { if (x.id === id && x.i === (i || 0)) k = n; });
  CP.rvv = { list: list, k: k, ro: ro, seen: {}, asked: {}, bar: '' };
  document.getElementById('cpRvv').classList.add('cp-open');
  document.getElementById('cpRvvBody').classList.remove('cp-full');
  cpRvvBar('');
  cpRvvShow();
}

function cpRvvCur() {
  var v = CP.rvv;
  if (!v) return null;
  var x = v.list[v.k];
  if (!x) return null;
  var ver = cpLastRv(cpRv()[x.id]);
  return ver && ver.files[x.i] ? { id: x.id, i: x.i, ver: ver, f: ver.files[x.i], card: cbCardById(x.id) } : null;
}

function cpRvvNote(text) {
  var note = document.getElementById('cpRvvNote');
  if (text !== undefined) note.setAttribute('data-t', text);
  var full = document.getElementById('cpRvvBody').classList.contains('cp-full');
  note.textContent = (note.getAttribute('data-t') || '') + (full ? ' · 100 % — клик, чтобы вписать' : ' · клик — 100 %')
    + ' · стрелки — листать' + (CP.rvv && !CP.rvv.ro ? ' · Enter — на сайт · D — на доработку' : '') + ' · Esc — закрыть';
}

function cpRvvShow() {
  var cur = cpRvvCur();
  if (!cur) { cpRvvClose(); return; }
  var v = CP.rvv, ver = cur.ver, f = cur.f, n = cpRvvCounts(ver);
  (v.seen[cur.id] = v.seen[cur.id] || {})[f.name] = true;
  var cards = [];
  v.list.forEach(function (x) { if (cards.indexOf(x.id) === -1) cards.push(x.id); });
  document.getElementById('cpRvvName').textContent = f.name;
  document.getElementById('cpRvvSub').textContent = 'карточка ' + ((cur.card && (cur.card.title || cur.card.category)) || '—')
    + ' · кадр ' + (cur.i + 1) + ' из ' + ver.files.length + ' · ретушь v' + ver.v + (ver.letter ? ' · ' + ver.letter : '')
    + (v.ro ? ' · ' + (ver.status === 'rework' ? 'на доработке' : ver.status === 'approved' ? 'на сайте' : ver.status) : ' · принято ' + n.ok + (n.rework ? ', на доработку ' + n.rework : ''));
  document.getElementById('cpRvvCount').textContent = (v.k + 1) + ' / ' + v.list.length + (cards.length > 1 ? ' · карточка ' + (cards.indexOf(cur.id) + 1) + ' из ' + cards.length : '');
  var m = cpRvvMark(ver, f);
  document.getElementById('cpRvvMark').innerHTML = !m ? '' : m.s === 'ok' ? '<span class="cp-rvv-m cp-ok">на сайт</span>'
    : '<span class="cp-rvv-m cp-bad">на доработку' + (m.note ? ': ' + cbEsc(m.note) : '') + '</span>';
  var okb = document.querySelector('#cpRvv [data-rvv="ok"]'), rwb = document.querySelector('#cpRvv [data-rvv="rework"]');
  okb.style.display = rwb.style.display = v.ro ? 'none' : '';
  okb.textContent = m && m.s === 'ok' ? 'Принят — снять' : 'На сайт';
  rwb.textContent = m && m.s === 'rework' ? 'На доработке — изменить' : 'На доработку';
  var img = document.getElementById('cpRvvImg');
  var path = f.path;
  /* файл с тем же именем могли заменить новой версией — крупное превью прошлой версии не показываем */
  CP.rvvBigOf = CP.rvvBigOf || {};
  if (CP.rvvBigOf[path] !== ver.ts) { delete CP.big[path]; CP.rvvBigOf[path] = ver.ts; }
  var big = CP.big[path];
  if (big) { img.src = big; cpRvvNote('крупно'); }
  else {
    var th = CP.rvThumb && CP.rvThumb[path] && CP.rvThumb[path] !== 'wait' ? CP.rvThumb[path] : '';
    if (th) img.src = th; else img.removeAttribute('src');
    cpRvvNote('загружаю крупно...');
    cpLoadBig(path).then(function (url) {
      var c2 = cpRvvCur();
      if (!c2 || c2.f.path !== path) return;
      img.src = url;
      cpRvvNote('крупно');
    }, function (e) {
      var c2 = cpRvvCur();
      if (c2 && c2.f.path === path) cpRvvNote('крупное превью не загрузилось: ' + ((e && (e.status || e.message)) || e));
    });
  }
  /* соседний кадр — заранее */
  var nx = v.list[(v.k + 1) % v.list.length], nv = nx ? cpLastRv(cpRv()[nx.id]) : null, nf = nv && nv.files[nx.i];
  if (nf && !CP.big[nf.path]) cpLoadBig(nf.path).catch(function () { });
}

/** Полоса под шапкой: '' — скрыть, 'note' — комментарий к доработке, 'ask' — вопрос про карточку. */
function cpRvvBar(kind, html) {
  var bar = document.getElementById('cpRvvBar');
  if (CP.rvv) CP.rvv.bar = kind || '';
  bar.classList.toggle('cp-open', !!kind);
  bar.innerHTML = kind ? html : '';
}

function cpRvvStep(d) {
  var v = CP.rvv;
  if (!v) return;
  if (v.bar) cpRvvBar('');
  var cur = v.list[v.k], n = v.list.length, to = (v.k + d + n) % n;
  /* долистали карточку до конца — может быть, пора спросить про сайт */
  if (!v.ro && d > 0 && cur && (v.list[to].id !== cur.id || to <= v.k) && cpRvvCardAsk(cur.id, to)) return;
  v.k = to;
  cpRvvShow();
}

/** Карточку просмотрели целиком, замечаний нет, а «на сайт» отмечены не все кадры — спросить. true — ждём ответа. */
function cpRvvCardAsk(id, to) {
  var v = CP.rvv, ver = cpLastRv(cpRv()[id]);
  if (!ver || ver.status !== 'review' || v.asked[id] || ver.ready) return false;
  var n = cpRvvCounts(ver);
  if (n.rework || n.ok === n.total) return false;
  var seen = v.seen[id] || {};
  if (!ver.files.every(function (f) { return seen[f.name]; })) return false;
  v.asked[id] = true;
  v.askFor = { id: id, to: to };
  var c = cbCardById(id);
  cpRvvBar('ask', '<span>Карточка <b>' + cbEsc((c && (c.title || c.category)) || 'без названия') + '</b> просмотрена, замечаний нет. Отправить её на сайт?</span>'
    + '<button class="cb-primary" data-rvv="ask-yes">Отправить</button><button data-rvv="ask-no">Не сейчас</button>');
  return true;
}

function cpRvvAskAnswer(yes) {
  var v = CP.rvv;
  if (!v || !v.askFor) return;
  var a = v.askFor, ver = cpLastRv(cpRv()[a.id]);
  v.askFor = null;
  if (yes && ver && ver.status === 'review') {
    ver.ready = { by: cpActor(), ts: new Date().toISOString(), via: 'viewer_ask' };
    cbMarkDirty();
  }
  cpRvvBar('');
  v.k = a.to;
  cpRvvShow();
}

/** «На сайт» на кадре: принят (повторно — снять отметку). */
function cpRvvOk() {
  var cur = cpRvvCur();
  if (!cur || CP.rvv.ro) return;
  var fm = cur.ver.fm = cur.ver.fm || {}, m = fm[cur.f.name];
  if (m && m.s === 'ok') { delete fm[cur.f.name]; cbMarkDirty(); cpRvvShow(); return; }
  fm[cur.f.name] = { s: 'ok', by: cpActor(), ts: new Date().toISOString() };
  cbMarkDirty();
  var n = cpRvvCounts(cur.ver);
  if (n.ok === n.total) cbToast('Карточка ' + ((cur.card && cur.card.title) || '') + ': приняты все кадры — уедет на сайт, когда закроете просмотр');
  /* дальше — следующий кадр; на последнем остаёмся, чтобы было видно отметку */
  if (CP.rvv.list.length > 1) cpRvvStep(1); else cpRvvShow();
}

function cpRvvNoteOpen() {
  var cur = cpRvvCur();
  if (!cur || CP.rvv.ro) return;
  var m = cpRvvMark(cur.ver, cur.f);
  cpRvvBar('note', '<span>Что доработать в этом кадре? (увидит ретушёр)</span><textarea id="cpRvvText" placeholder="например: убрать складку на рукаве"></textarea>'
    + '<button class="cb-primary" data-rvv="note-save" title="Ctrl+Enter">На доработку</button>'
    + (m && m.s === 'rework' ? '<button data-rvv="note-save" data-rvv-clear="1">Снять отметку</button>' : '') + '<button data-rvv="bar-close">Отмена</button>');
  var ta = document.getElementById('cpRvvText');
  ta.value = m && m.s === 'rework' ? m.note || '' : '';
  ta.focus();
  /* «Снять отметку» — та же кнопка сохранения, но с пустой отметкой */
  var clr = document.querySelector('#cpRvvBar [data-rvv-clear]');
  if (clr) clr.addEventListener('click', function (e) { e.stopPropagation(); cpRvvNoteSave(true); });
}

function cpRvvNoteSave(clear) {
  var cur = cpRvvCur();
  if (!cur || CP.rvv.ro) return;
  var ta = document.getElementById('cpRvvText');
  var fm = cur.ver.fm = cur.ver.fm || {};
  if (clear === true) delete fm[cur.f.name];
  else {
    fm[cur.f.name] = { s: 'rework', note: ta ? ta.value.trim() : '', by: cpActor(), ts: new Date().toISOString() };
    delete cur.ver.ready;   /* с замечанием карточка на сайт не едет */
  }
  cbMarkDirty();
  cpRvvBar('');
  if (clear === true || CP.rvv.list.length < 2) cpRvvShow(); else cpRvvStep(1);
}

function cpRvvClose() {
  var v = CP.rvv;
  CP.rvv = null;
  document.getElementById('cpRvv').classList.remove('cp-open');
  document.getElementById('cpRvvImg').removeAttribute('src');
  document.getElementById('cpRvvBar').classList.remove('cp-open');
  if (!v) return;
  if (!v.ro) cpRvvFinish();
  cbRenderCards();
  cbRenderOutline();
}

/* ---------- на карточках: отметки на миниатюрах, итог, «Завершить просмотр» ---------- */

cbRenderCards = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    if (!CP.shoot) return r;
    var rv = cpRv();
    Array.prototype.forEach.call(document.querySelectorAll('#cbCards .cp-rv[data-cp-rv]'), function (box) {
      var last = cpLastRv(rv[box.getAttribute('data-cp-rv')]);
      if (!last) return;
      Array.prototype.forEach.call(box.querySelectorAll('[data-cp-rvt]'), function (t) {
        var f = last.files[+t.getAttribute('data-cp-rvt')], m = f ? cpRvvMark(last, f) : null;
        t.classList.toggle('cp-rvv-ok', !!m && m.s === 'ok');
        t.classList.toggle('cp-rvv-bad', !!m && m.s === 'rework');
        if (f) t.title = f.name + (m ? (m.s === 'ok' ? ' — принят' : ' — на доработку' + (m.note ? ': ' + m.note : '')) : '');
      });
      var head = box.querySelector('.cp-rv-head'), n = cpRvvCounts(last);
      if (head && last.status === 'review' && (n.ok || n.rework || last.ready) && !head.querySelector('.cp-rvv-sum')) {
        var sp = head.querySelector('.cp-sp');
        var txt = 'просмотр: принято <b>' + n.ok + '</b> из ' + n.total + (n.rework ? ', на доработку <b>' + n.rework + '</b>' : '')
          + (!n.rework && (last.ready || n.ok === n.total) ? ' — готова на сайт' : '');
        var el = document.createElement('span');
        el.className = 'cp-rvv-sum';
        el.innerHTML = txt;
        head.insertBefore(el, sp);
      }
    });
    /* просмотр закрыли не до конца (или страницу закрыли посреди него) — кнопка над карточками */
    var bar = document.getElementById('cpRvBar'), pend = CP.rvv ? { site: [], rework: [] } : cpRvvPending();
    if (bar) {
      var old = bar.querySelector('.cp-rvv-fin');
      if (old) old.remove();
      if (pend.site.length || pend.rework.length) {
        bar.insertAdjacentHTML('beforeend', '<button class="cb-primary cp-rvv-fin" data-cp-rvv-fin="1" title="Отметки по кадрам сделаны, а карточки ещё не отправлены">Завершить просмотр: на сайт '
          + pend.site.length + ', на доработку ' + pend.rework.length + '</button>');
      }
    }
    return r;
  };
})(cbRenderCards);

document.addEventListener('click', function (e) {
  if (!e.target.closest('[data-cp-rvv-fin]') || !CP.shoot) return;
  e.preventDefault();
  cpRvvFinish();
  cbRenderCards();
});

/* ---------- галочки в списке справа: «На сайт» для отмеченных ---------- */

cbRenderOutline = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    if (!CP.shoot) return r;
    var bar = document.getElementById('cpObar');
    if (!bar || bar.querySelector('[data-cp-o="rvsite"]')) return r;
    var rv = cpRv();
    var ids = Object.keys(CP.checked || {}).filter(function (k) { var l = cpLastRv(rv[k]); return CP.checked[k] && l && l.status === 'review'; });
    if (!ids.length) return r;
    var before = bar.querySelector('[data-cp-o="download"]');
    var html = '<button class="cb-primary" data-cp-o="rvsite" title="Отправить на сайт отмеченные карточки, чья ретушь на проверке">На сайт: ' + ids.length + '</button>';
    if (before) before.insertAdjacentHTML('beforebegin', html); else bar.insertAdjacentHTML('beforeend', html);
    return r;
  };
})(cbRenderOutline);

document.getElementById('cbOutline').addEventListener('click', function (e) {
  if (!e.target.closest('[data-cp-o="rvsite"]') || !CP.shoot) return;
  e.preventDefault(); e.stopPropagation();
  var rv = cpRv();
  var ids = Object.keys(CP.checked || {}).filter(function (k) { var l = cpLastRv(rv[k]); return CP.checked[k] && l && l.status === 'review'; });
  if (ids.length) cpRvApprove(ids, 'batch');
}, true);
