/* ============================================================
   cp-queue.js — очередь переносов: переносим, пока не перенесём

   Маша, 09.11.2026: «отправила на сайт — ничего не отправилось»; «лучше пусть
   оно переносит до тех пор, пока не перенесёт; до тех пор любая попытка
   закрыть — плашка, что изменения не сохранены»; «главное, чтобы цикл не
   зависал».

   Любое действие, которое двигает файлы на Диске (копия на согласование или
   ретушь, перенос 04 → 05, «_доработка», уборка в Корзину), сначала пробует
   сделать это сразу. Не вышло — действие ложится в очередь:
     - очередь хранится в файле отбора съёмки (meta.cp.q): переживает
       перезагрузку, её подхватит любой, кто откроет эту съёмку;
     - повтор с паузой 5 → 10 → 20 → 40 → 60 с (дальше раз в минуту) — без
       конца, но без частых запросов: цикл не зависает и не долбит Диск;
     - после 3 неудач — красная плашка сверху: что не переносится и почему;
     - ошибка, которую повтор не исправит (исходника нет на Диске), — плашка
       «нужен человек» с кнопкой «Убрать из очереди»;
     - пока в очереди что-то есть (или отбор не записан на Диск), закрыть или
       перезагрузить страницу молча нельзя — браузер переспросит.
   Каждое действие проверяет результат по Диску: копия/перенос — путь на новом
   месте есть; Корзина — исходника нет. Поэтому два человека, открывшие одну
   съёмку, не мешают друг другу: второй увидит, что всё уже на месте.

   op = {id, kind: 'copy'|'move'|'trash', label, items:[{from, path}] | paths:[],
         dirs:[], after:{type, ...}, by, ts, tries, err, next, stuck}
   after — что записать в отбор, когда перенос подтвердился (CPQ.after[type]).
   Префикс: cpq*, объект CPQ.
   ============================================================ */

var CPQ = {
  ops: {},          /* id -> {shoot:{path,name}, op} — всё, что сейчас в работе в этом браузере */
  running: false,
  timer: null,
  after: {},        /* type -> function (op, meta, shootPath) — модули регистрируют свои */
  delays: [5000, 10000, 20000, 40000, 60000],
  redraw: { 'rv-approve': true, 'rv-rework': true },
  alarmAfter: 3,
  copyChunk: 50,    /* копий за один вызов прослойки */
  moveChunk: 100    /* переносов за один вызов */
};

function cpqChunks(list, n) {
  var out = [];
  for (var i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

function cpqId() { return 'q' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

/** Сколько переносов в работе (во всех съёмках, которые этот браузер видел). */
function cpqCount() { return Object.keys(CPQ.ops).length; }

/** Записать очередь съёмки в её отбор: открыта — в текущий, иначе — прямо в файл на Диске. */
function cpqSave(shoot, fn) {
  if (CP.shoot && CP.shoot.path === shoot.path && !CP.readOnly) {
    var m = cpMeta();
    m.q = m.q || {};
    fn(m);
    cbMarkDirty();
    return Promise.resolve();
  }
  if (typeof cpMutateState !== 'function') return Promise.resolve();
  return cpMutateState({ path: shoot.path, name: shoot.name }, function (data) {
    var m = data.meta.cp;
    m.q = m.q || {};
    fn(m);
  }).catch(function (e) { if (window.console) console.error('[CPQ] очередь не записалась', shoot.path, e); });
}

/** Поставить перенос в очередь (и сразу попробовать). */
CPQ.add = function (shoot, op) {
  op.id = op.id || cpqId();
  op.by = op.by || cpActor();
  op.ts = op.ts || new Date().toISOString();
  op.tries = op.tries || 0;
  op.next = 0;
  CPQ.ops[op.id] = { shoot: { path: shoot.path, name: shoot.name }, op: op };
  cpqSave(shoot, function (m) { m.q[op.id] = op; });
  cpqRender();
  cpqKick();
  return op.id;
};

/** Подхватить очередь открытой съёмки из её отбора (вызывается при открытии и при обновлении отбора). */
CPQ.adopt = function () {
  if (!CP.shoot) return;
  var q = (cpMeta().q) || {};
  Object.keys(q).forEach(function (id) {
    if (!CPQ.ops[id]) CPQ.ops[id] = { shoot: { path: CP.shoot.path, name: CP.shoot.name }, op: q[id] };
  });
  cpqRender();
  cpqKick();
};

/** Пути, которые уже стоят в очереди на копирование (чтобы не ставить второй раз). */
CPQ.pendingFrom = function (filter) {
  var set = {};
  Object.keys(CPQ.ops).forEach(function (id) {
    var op = CPQ.ops[id].op;
    if (filter && !filter(op)) return;
    (op.items || []).forEach(function (it) { set[it.from] = true; });
  });
  return set;
};

/* Статус после переноса (Маша, 10.11.2026): копии доехали — кадры получают статус, ради которого
   их копировали (ретушь, согласование), карточки — тоже. after = {type:'st', s, by, map:{исходник: кадр},
   card | cards:{кадр: карточка}, ap2:{кадр: путь копии в 02}}. Брак, поставленный за это время, не перетираем. */
CPQ.after.st = function (op, m) {
  var a = op.after, now = new Date().toISOString(), n = 0, cards = {};
  m.status = m.status || {}; m.cardStatus = m.cardStatus || {};
  Object.keys(a.map || {}).forEach(function (from) {
    var pid = a.map[from], cur = m.status[pid];
    var cid = (a.cards && a.cards[pid]) || a.card || null;
    if (cur && cur.s === 'reshoot') return;
    m.status[pid] = { s: a.s, by: a.by || cpActor(), ts: now, card: cid || undefined };
    if (a.ap2 && a.ap2[pid]) { m.ap2 = m.ap2 || {}; m.ap2[pid] = a.ap2[pid]; }
    if (cid) cards[cid] = true;
    n++;
  });
  Object.keys(cards).forEach(function (cid) {
    var cs = m.cardStatus[cid];
    if (cs && (cs.s === a.s || cs.s === 'reshoot')) return;
    m.cardStatus[cid] = { s: a.s, by: a.by || cpActor(), ts: now };
  });
  if (n) (m.events = m.events || []).push({ ts: now, action: 'to_' + a.s, actor: a.by || cpActor(), items: [], note: 'файлы на месте — статус поставлен: кадров ' + n });
};
CPQ.redraw.st = true;

function cpqKick(delay) {
  clearTimeout(CPQ.timer);
  CPQ.timer = setTimeout(cpqTick, delay || 0);
}

/** Один шаг: взять ближайший готовый перенос, попробовать, назначить следующий шаг. */
function cpqTick() {
  if (CPQ.running) return;
  var now = Date.now(), ids = Object.keys(CPQ.ops), pick = null, soonest = Infinity;
  ids.forEach(function (id) {
    var o = CPQ.ops[id].op;
    if (o.stuck) return;
    if ((o.next || 0) <= now) { if (!pick) pick = id; }
    else soonest = Math.min(soonest, o.next);
  });
  if (!pick) {
    if (soonest < Infinity) cpqKick(Math.max(500, soonest - now));
    return;
  }
  var ent = CPQ.ops[pick], op = ent.op;
  CPQ.running = true;
  cpqRun(op).then(function (res) {
    CPQ.running = false;
    if (res.ok) return cpqDone(ent);
    op.tries = (op.tries || 0) + 1;
    op.err = res.err || 'не перенеслось';
    op.stuck = !!res.stuck;
    op.next = Date.now() + CPQ.delays[Math.min(op.tries - 1, CPQ.delays.length - 1)];
    /* в отбор пишем не каждый повтор — только когда сменилась ошибка или включилась тревога */
    if (op.tries === 1 || op.tries === CPQ.alarmAfter || op.stuck) cpqSave(ent.shoot, function (m) { m.q[op.id] = op; });
  }, function (e) {
    CPQ.running = false;
    op.tries = (op.tries || 0) + 1;
    op.err = (e && (e.message || e.status)) || String(e);
    op.next = Date.now() + CPQ.delays[Math.min(op.tries - 1, CPQ.delays.length - 1)];
  }).then(function () {
    cpqRender();
    cpqKick(200);
  });
}

/** Выполнить перенос и проверить результат по Диску. -> {ok} | {ok:false, err, stuck} */
function cpqRun(op) {
  /* Пачками: прослойка берёт за вызов не больше 1000 копий и 200 переносов, остальное молча
     отбрасывает. Раньше файл, о котором прослойка не ответила, считался сделанным — большая
     очередь (тысячи кадров на ретушь после сбоя сети) «заканчивалась», не докопировав хвост.
     Теперь файл без ответа остаётся в очереди. */
  if (op.kind === 'copy') {
    var all = op.items || [], dirs = op.dirs || [], left = [], err = '', gone = 0, firstOk = false;
    return cpqChunks(all, CPQ.copyChunk).reduce(function (p, ch, ci) {
      return p.then(function () {
        return CPDisk.proxyCopy(ch, ci === 0 ? dirs : []).then(function (out) {
          var res = (out && out.results) || [];
          if (ci === 0) firstOk = true;
          ch.forEach(function (it, k) {
            var x = res[k];
            if (x && (x.status === 'done' || x.status === 'exists')) return;
            left.push(it);
            if (!x) { err = err || 'прослойка не ответила про файл'; return; }
            if (x.status === 'gone' || /404|not found|не найден/i.test(String(x.error || ''))) gone++;
            err = x.error || x.status;
          });
        }, function (e) {
          /* пачка не прошла целиком — она остаётся в очереди, остальные пробуем */
          ch.forEach(function (it) { left.push(it); });
          err = (e && (e.message || e.status)) || String(e);
        });
      });
    }, Promise.resolve()).then(function () {
      op.items = left;
      if (firstOk) op.dirs = [];
      if (!left.length) return { ok: true };
      return { ok: false, err: 'не скопировано ' + left.length + ': ' + err, stuck: gone === left.length };
    });
  }
  if (op.kind === 'move') {
    var mAll = op.items || [], mLeft = [], mErr = '', mGone = 0;
    return cpqChunks(mAll, CPQ.moveChunk).reduce(function (p, ch) {
      return p.then(function () {
        return CPDisk.proxyMove(ch).then(function (out) { return (out && out.results) || []; }, function (e) {
          mErr = (e && (e.message || e.status)) || String(e);
          return [];
        }).then(function (r) {
          return Promise.all(ch.map(function (it, i) {
            var x = r[i] || {};
            if (x.status === 'done') return cpqThere(it.path).then(function (y) { return y ? null : 'на новом месте нет'; });
            /* исходника нет — значит, уже перенесли (мы раньше или коллега); проверяем новое место */
            return cpqThere(it.path).then(function (y) {
              if (y) return null;
              return x.status === 'gone' ? 'GONE' : (x.error || x.status || mErr || 'не перенеслось');
            });
          })).then(function (errs) {
            errs.forEach(function (e, i) { if (e) { mLeft.push(ch[i]); if (e === 'GONE') mGone++; else mErr = e; } });
          });
        });
      });
    }, Promise.resolve()).then(function () {
      op.items = mLeft;
      if (!mLeft.length) return { ok: true };
      return { ok: false, err: mGone === mLeft.length ? 'нет ни на старом, ни на новом месте' : mErr, stuck: mGone === mLeft.length };
    });
  }
  if (op.kind === 'trash') {
    return CPDisk.trash(op.paths).then(function (res) {
      var left = res.filter(function (x) { return x.status !== 'done' && x.status !== 'gone'; }).map(function (x) { return x.path; });
      op.paths = left;
      return left.length ? { ok: false, err: 'в Корзину не ушло ' + left.length } : { ok: true };
    });
  }
  return Promise.resolve({ ok: false, err: 'неизвестный перенос', stuck: true });
}

function cpqThere(path) {
  return CPDisk.meta(path).then(function () { return true; }, function () { return false; });
}

/** Перенос подтвердился: убрать из очереди, записать результат в отбор. */
function cpqDone(ent) {
  var op = ent.op;
  delete CPQ.ops[op.id];
  return cpqSave(ent.shoot, function (m) {
    delete m.q[op.id];
    var fn = op.after && CPQ.after[op.after.type];
    if (fn) { try { fn(op, m, ent.shoot); } catch (e) { if (window.console) console.error('[CPQ] after', e); } }
    (m.events = m.events || []).push({ ts: new Date().toISOString(), action: 'queue_done', actor: cpActor(), items: [], note: op.label + (op.tries ? ' — с ' + (op.tries + 1) + '-й попытки' : '') });
  }).then(function () {
    /* перерисовать только если поменялось видимое (статус ретуши на карточке); служебные отметки
       (копии в 02, в _БРАК) на экран не влияют — лишняя перерисовка сбивает работу с карточками */
    if (CP.shoot && CP.shoot.path === ent.shoot.path && op.after && CPQ.redraw[op.after.type]) cpAfterStatus();
    if (op.tries) cbToast('Перенеслось: ' + op.label);
  });
}

/** Убрать застрявший перенос руками (только после решения человека). */
function cpqDrop(id) {
  var ent = CPQ.ops[id];
  if (!ent) return;
  delete CPQ.ops[id];
  cpqSave(ent.shoot, function (m) {
    delete m.q[id];
    (m.events = m.events || []).push({ ts: new Date().toISOString(), action: 'queue_drop', actor: cpActor(), items: [], note: 'убрано из очереди: ' + ent.op.label + ' — ' + (ent.op.err || '') });
  });
  cpqRender();
}

/* ---------- плашка ---------- */

(function cpqCss() {
  var st = document.createElement('style');
  st.textContent = '#cpQueue{position:fixed;left:50%;top:8px;transform:translateX(-50%);z-index:5000;max-width:min(760px,calc(100vw - 24px));'
    + 'background:#2a2416;border:1px solid #C9956B;color:#f2f2f1;border-radius:6px;padding:8px 12px;font-size:12px;line-height:1.5;display:none;box-shadow:0 6px 24px #000a}'
    + '#cpQueue.cp-on{display:block}#cpQueue.cp-alarm{background:#4a1d17;border-color:#d9534f}'
    + '#cpQueue b{font-weight:600}#cpQueue .cpq-row{margin-top:4px;color:#e9d6c8}#cpQueue button{margin-left:8px;font-size:11px;padding:2px 8px}';
  document.head.appendChild(st);
  var box = document.createElement('div');
  box.id = 'cpQueue';
  document.body.appendChild(box);
  box.addEventListener('click', function (e) {
    var b = e.target.closest('[data-cpq]');
    if (!b) return;
    var act = b.getAttribute('data-cpq');
    if (act === 'now') { Object.keys(CPQ.ops).forEach(function (id) { CPQ.ops[id].op.next = 0; CPQ.ops[id].op.stuck = false; }); cpqKick(); }
    else if (act === 'drop') {
      var id = b.getAttribute('data-id'), ent = CPQ.ops[id];
      if (ent && confirm('Убрать из очереди «' + ent.op.label + '»?\nПеренос не будет сделан — проверьте Диск руками.')) cpqDrop(id);
    }
  });
})();

function cpqRender() {
  var box = document.getElementById('cpQueue');
  if (!box) return;
  var ids = Object.keys(CPQ.ops);
  if (!ids.length) { box.className = ''; box.innerHTML = ''; return; }
  var alarm = ids.some(function (id) { var o = CPQ.ops[id].op; return o.stuck || (o.tries || 0) >= CPQ.alarmAfter; });
  box.className = 'cp-on' + (alarm ? ' cp-alarm' : '');
  var html = alarm
    ? '<b>Перенос не проходит — не закрывайте страницу.</b> Программа повторяет сама; если не пройдёт — проверьте Диск.'
    : '<b>Переношу на Диске: ' + ids.length + '</b> — не закрывайте страницу, пока не закончится.';
  html += '<button data-cpq="now">Повторить сейчас</button>';
  ids.slice(0, 6).forEach(function (id) {
    var o = CPQ.ops[id].op, ent = CPQ.ops[id];
    html += '<div class="cpq-row">' + cbEsc(o.label) + ' · ' + cbEsc(ent.shoot.name)
      + (o.tries ? ' · попыток ' + o.tries + (o.err ? ': ' + cbEsc(String(o.err).slice(0, 140)) : '') : '')
      + (o.stuck ? ' · <b>повтор не поможет</b><button data-cpq="drop" data-id="' + id + '">Убрать из очереди</button>' : '') + '</div>';
  });
  if (ids.length > 6) html += '<div class="cpq-row">и ещё ' + (ids.length - 6) + '</div>';
  box.innerHTML = html;
}

/* ---------- не уходить, пока не сохранено и не перенесено ---------- */
window.addEventListener('beforeunload', function (e) {
  if (cpqCount() || (CP.shoot && (App.dirty || CP.saving))) {
    e.preventDefault();
    e.returnValue = 'Изменения ещё не сохранены на Диске';
    return e.returnValue;
  }
});

/* открыли съёмку — подхватить её очередь */
CP.openedHooks = CP.openedHooks || [];
CP.openedHooks.push(function () { CPQ.adopt(); });
