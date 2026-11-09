/* ============================================================
   cp-speed.js — проверка скорости загрузки: Диск или Облако

   Маша, 09.11.2026: «15 гигабайт грузится как сволочь долго; можем ли мы сначала
   выгружать в Яндекс Облако, а оттуда оно само закинет на Диск, когда комп
   выключен? Мне главное провести тест и понять, куда быстрее зальются мои
   15 гигабайт — нужно не дольше 15 минут». Проверки — по очереди.

   Шестерёнка → «Проверить скорость загрузки». По очереди, каждая ~CP.speedMs:
     1. Диск, 1 поток (так сейчас идут видео);
     2. Диск, 4 потока;
     3. Облако, 4 потока;
     4. Облако, 8 потоков.
   Пробные файлы — случайные байты. На Диске — во временной папке в служебной
   (после проверки — в Корзину), в Облаке — exports/, бакет сам удалит через 3 дня.
   Итог: МБ/с, Мбит/с и сколько займут 15 ГБ; вывод — куда грузить и упирается ли
   всё в интернет.
   ============================================================ */

CP.speedMs = 15000;
CP.speedChunk = 32 * 1024 * 1024;
CP.speedGoalGb = 15;

var _cpSpeedBlob = null;
function cpSpeedBlob() {
  if (_cpSpeedBlob && _cpSpeedBlob.size === CP.speedChunk) return _cpSpeedBlob;
  var a = new Uint8Array(CP.speedChunk);
  for (var i = 0; i < a.length; i += 65536) crypto.getRandomValues(a.subarray(i, Math.min(a.length, i + 65536)));
  _cpSpeedBlob = new Blob([a]);
  return _cpSpeedBlob;
}

/** PUT с отменой; onProgress(байт отправлено). */
function cpSpeedPut(url, blob, onProgress, xhrs) {
  return new Promise(function (resolve, reject) {
    var x = new XMLHttpRequest();
    xhrs.push(x);
    x.open('PUT', url);
    x.upload.onprogress = function (e) { onProgress(e.loaded); };
    x.onload = function () { if (x.status >= 200 && x.status < 300) { onProgress(blob.size); resolve(); } else reject(new Error('HTTP ' + x.status)); };
    x.onerror = function () { reject(new Error('сеть')); };
    x.onabort = function () { resolve('abort'); };
    x.send(blob);
  });
}

/** Одна проверка: n потоков грузят пробный файл по кругу, пока не выйдет время. next() — адрес для следующего файла. */
function cpSpeedPhase(n, next, onTick) {
  var blob = cpSpeedBlob(), sent = {}, xhrs = [], done = false, errors = [], k = 0;
  var t0 = Date.now(), deadline = t0 + CP.speedMs;
  var total = function () { var s = 0; Object.keys(sent).forEach(function (i) { s += sent[i]; }); return s; };
  var stream = function () {
    if (done || Date.now() > deadline) return Promise.resolve();
    var id = k++;
    return next().then(function (url) {
      if (done) return;
      return cpSpeedPut(url, blob, function (b) { sent[id] = b; }, xhrs);
    }).then(stream, function (e) { errors.push(e && e.message || String(e)); if (errors.length < 6) return stream(); });
  };
  var timer = setInterval(function () { onTick(total(), Date.now() - t0); }, 300);
  var stop = new Promise(function (r) { setTimeout(r, CP.speedMs); }).then(function () {
    done = true;
    var bytes = total(), ms = Date.now() - t0;
    xhrs.forEach(function (x) { try { x.abort(); } catch (e) { } });
    return { bytes: bytes, ms: ms };
  });
  for (var i = 0; i < n; i++) stream();
  return stop.then(function (r) {
    clearInterval(timer);
    r.errors = errors;
    return r;
  });
}

function cpSpeedFmt(r) {
  var mbs = r.bytes / 1048576 / (r.ms / 1000);
  var min = mbs > 0 ? CP.speedGoalGb * 1024 / mbs / 60 : Infinity;
  return { mbs: mbs, mbit: mbs * 8.388608, min: min };
}

function cpSpeedOpen() {
  var box = document.getElementById('cpSpeedBox');
  if (!box) {
    box = document.createElement('div');
    box.id = 'cpSpeedBox';
    box.className = 'cp-files';
    document.body.appendChild(box);
    box.addEventListener('click', function (e) {
      var b = e.target.closest('[data-cp-sp]');
      if (!b) return;
      if (b.getAttribute('data-cp-sp') === 'close') { if (CP.speed && CP.speed.busy) return; box.classList.remove('cp-open'); }
      else if (b.getAttribute('data-cp-sp') === 'go') cpSpeedRun();
    });
  }
  CP.speed = { busy: false, rows: [], note: '' };
  box.classList.add('cp-open');
  cpSpeedRender();
}

var CP_SPEED_PHASES = [
  { key: 'disk1', label: 'Диск, 1 поток', where: 'disk', n: 1, hint: 'так сейчас идут видео' },
  { key: 'disk4', label: 'Диск, 4 потока', where: 'disk', n: 4 },
  { key: 'cloud4', label: 'Облако, 4 потока', where: 'cloud', n: 4 },
  { key: 'cloud8', label: 'Облако, 8 потоков', where: 'cloud', n: 8 }
];

function cpSpeedRender() {
  var box = document.getElementById('cpSpeedBox'), st = CP.speed;
  if (!box || !st) return;
  var h = '<div class="cp-files-box"><div class="cp-files-head"><b>Скорость загрузки: Диск или Облако</b><button data-cp-sp="close" title="Закрыть">×</button></div><div class="cp-acc-body">'
    + '<div class="cp-note">По очереди, по ' + Math.round(CP.speedMs / 1000) + ' секунд: Диск в 1 и 4 потока, Облако в 4 и 8 потоков. Грузятся пробные файлы, потом удаляются. '
    + 'Пока идёт проверка, лучше ничего больше не качать и не заливать — иначе цифры занизятся.</div>'
    + '<table class="cp-speed"><tr><th></th><th>МБ/с</th><th>Мбит/с</th><th>' + CP.speedGoalGb + ' ГБ займут</th></tr>';
  CP_SPEED_PHASES.forEach(function (ph) {
    var r = st.rows[ph.key];
    var f = r && r.res ? cpSpeedFmt(r.res) : null;
    h += '<tr' + (r && r.now ? ' class="cp-speed-now"' : '') + '><td>' + cbEsc(ph.label) + (ph.hint ? ' <small>(' + ph.hint + ')</small>' : '') + '</td>'
      + (r && r.error ? '<td colspan="3" class="cp-acc-warn">' + cbEsc(r.error) + '</td>'
        : f ? '<td>' + f.mbs.toFixed(1) + '</td><td>' + Math.round(f.mbit) + '</td><td' + (f.min <= 15 ? ' class="cp-speed-ok"' : '') + '>' + (isFinite(f.min) ? '≈ ' + Math.ceil(f.min) + ' мин' : '—') + '</td>'
          : r && r.now ? '<td colspan="3">' + cbEsc(r.now) + '</td>' : '<td colspan="3" class="cp-speed-wait">—</td>') + '</tr>';
  });
  h += '</table>';
  if (st.note) h += '<div class="cp-speed-note">' + st.note + '</div>';
  if (!st.busy) h += '<div class="cp-files-foot"><span class="cp-sp"></span><button class="cb-primary" data-cp-sp="go">' + (Object.keys(st.rows).length ? 'Проверить ещё раз' : 'Начать проверку') + '</button></div>';
  h += '</div></div>';
  box.innerHTML = h;
}

function cpSpeedRun() {
  var st = CP.speed;
  if (!st || st.busy) return;
  st.busy = true; st.rows = {}; st.note = '';
  cpSpeedRender();
  var tmp = CP_CONFIG.serviceDir.replace(/\/+$/, '') + '/_проверка_скорости_' + Date.now();
  var cloudUrls = null, ci = 0, di = 0;
  var res = {};
  var getCloud = function () {
    if (cloudUrls && ci < cloudUrls.length) return Promise.resolve(cloudUrls[ci++]);
    return CPDisk.proxySpeedUrls(60).then(function (d) { cloudUrls = d.urls || []; ci = 0; return cloudUrls[ci++]; });
  };
  var getDisk = function () { return CPDisk.uploadHref(tmp + '/' + (di++) + '.bin', true); };
  var ready = CPDisk.ensureDir(tmp);
  var chain = CP_SPEED_PHASES.reduce(function (p, ph) {
    return p.then(function () {
      st.rows[ph.key] = { now: 'готовлю…' };
      cpSpeedRender();
      var pre = ph.where === 'disk' ? ready : (CPDisk.hasProxy() ? getCloud().then(function (u) { ci--; return u; }) : Promise.reject(new Error('прослойка не подключена')));
      return pre.then(function () {
        return cpSpeedPhase(ph.n, ph.where === 'disk' ? getDisk : getCloud, function (bytes, ms) {
          st.rows[ph.key] = { now: 'идёт: ' + (bytes / 1048576 / Math.max(ms / 1000, 0.3)).toFixed(1) + ' МБ/с · ' + Math.round(ms / 1000) + ' из ' + Math.round(CP.speedMs / 1000) + ' с' };
          cpSpeedRender();
        });
      }).then(function (r) {
        res[ph.key] = r;
        st.rows[ph.key] = r.bytes ? { res: r } : { error: 'ничего не загрузилось' + (r.errors.length ? ': ' + r.errors[0] : '') };
        cpSpeedRender();
      }, function (e) {
        st.rows[ph.key] = { error: (e && (e.message || e.body)) || String(e) };
        cpSpeedRender();
      });
    });
  }, Promise.resolve());
  chain.then(function () {
    st.busy = false;
    st.note = cpSpeedVerdict(res);
    cpSpeedRender();
    /* пробные файлы на Диске — в Корзину одной папкой */
    CPDisk.trash([tmp]).catch(function () { });
  });
}

/** Вывод: куда грузить и во что упираемся. */
function cpSpeedVerdict(res) {
  var v = function (k) { return res[k] && res[k].bytes ? cpSpeedFmt(res[k]).mbs : 0; };
  var d1 = v('disk1'), d4 = v('disk4'), c4 = v('cloud4'), c8 = v('cloud8');
  var disk = Math.max(d1, d4), cloud = Math.max(c4, c8), best = Math.max(disk, cloud);
  if (!best) return 'Не получилось измерить — проверьте интернет и попробуйте ещё раз.';
  var mins = function (mbs) { return Math.ceil(CP.speedGoalGb * 1024 / mbs / 60); };
  var out = [];
  if (cloud > disk * 1.3) out.push('<b>Облако быстрее Диска в ' + (cloud / disk).toFixed(1) + ' раза</b>: ' + CP.speedGoalGb + ' ГБ — около ' + mins(cloud) + ' мин против ' + mins(disk) + ' мин. Загрузка через Облако имеет смысл.');
  else if (disk > cloud * 1.3) out.push('<b>Диск не медленнее Облака</b> (' + mins(disk) + ' мин против ' + mins(cloud) + ') — грузить через Облако смысла нет.');
  else out.push('<b>Диск и Облако примерно одинаковы</b> (' + mins(disk) + ' и ' + mins(cloud) + ' мин) — похоже, всё упирается в интернет на отдачу, Облако не ускорит.');
  if (d4 > d1 * 1.5) out.push('Диск в 4 потока быстрее, чем в 1, в ' + (d4 / d1).toFixed(1) + ' раза — видео стоит грузить по несколько сразу.');
  if (mins(best) > 15) out.push('Даже лучший вариант — около ' + mins(best) + ' мин на ' + CP.speedGoalGb + ' ГБ: чтобы уложиться в 15 минут, нужна отдача от ~' + Math.ceil(CP.speedGoalGb * 1024 / 900 * 8.4) + ' Мбит/с.');
  return out.join('<br>');
}

/* кнопка в шестерёнке, в «Проверке» */
(function () {
  var diag = document.getElementById('cpDiag');
  if (!diag) return;
  diag.insertAdjacentHTML('afterend', '<button id="cpSpeed">Проверить скорость загрузки</button>');
  document.getElementById('cpSpeed').addEventListener('click', function () {
    var box = document.getElementById('cpSettings');
    if (box) box.classList.remove('cp-open');
    var g = document.getElementById('cpGear');
    if (g) g.classList.remove('cp-on');
    cpSpeedOpen();
  });
})();

(function cpSpeedCss() {
  var st = document.createElement('style');
  st.textContent = '.cp-speed{width:100%;border-collapse:collapse;margin:10px 0;font-size:13px}'
    + '.cp-speed th{font-weight:400;color:#8a877f;text-align:right;padding:4px 8px;font-size:12px}.cp-speed th:first-child{text-align:left}'
    + '.cp-speed td{padding:6px 8px;border-top:1px solid #2a2a28;text-align:right}.cp-speed td:first-child{text-align:left}'
    + '.cp-speed td small{color:#8a877f}.cp-speed-now td{color:#e7c9a8}.cp-speed-wait{color:#5f5d58}.cp-speed-ok{color:#9fc2a3}'
    + '.cp-speed-note{margin-top:8px;padding:10px 12px;border:1px solid #3a3a37;border-radius:4px;font-size:13px;line-height:1.6;color:#e6e2da}';
  document.head.appendChild(st);
})();
