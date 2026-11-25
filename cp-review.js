/* ============================================================
   cp-review.js — 04_ОТРЕТУШИРОВАНО: сдача, проверка, на сайт

   Маша, 06.11.2026: «ретушёр открывает вкладку „Отретушировано“ и просто
   тупо, как будто бы на Диск, заливает то, что он сделал. Это должно
   открываться как наша съёмка. Старший ретушёр открывает съёмку, видит
   новые папки, просматривает и отправляет либо на доработку, либо на сайт —
   прямо по карточкам. В „Отретушировано“ только актуальное и
   непроверенное; что прошло — переезжает на сайт. Внутри „Сайта“ — папки
   с датами. Даты для выработки ретушёров — внутри».

   Решения Маши (06.11):
   - кто сдал — буква, которую ретушёр выбирает при сдаче. Сама подставляется
     только из имён папок («…_Y_1», «…_03_РЕТУШЬ_Y_дата», «Y_74595_…»); иначе
     её нужно нажать — с прошлого раза не запоминается (Маша, 10.11);
   - кто и когда — внутри: таблица _ContentPulse/выработка.csv и скрытая
     метка на папке артикула; в именах папок дат нет;
   - доработка — остаётся в 04 с припиской «_доработка», новая версия
     ложится рядом, папка с доработкой уходит в Корзину;
   - сайт — 05_САЙТ/<дата>/<съёмка>/<артикул>.

   Раскладка в 04 — как в исходниках: 04/<съёмка>/<папка артикула>/файлы.
   Работает, когда в каталоге есть папка «отретушировано» (настройка
   retouched); без неё — прежняя приёмка в <съёмка>/_приёмка.
   ============================================================ */

var CP_OUTPUT_FILE = 'выработка.csv';
var CP_OUTPUT_HEAD_OLD = 'дата;время;ретушёр;съёмка;карточка;кадров;событие;кто;версия';
var CP_OUTPUT_HEAD_V2 = CP_OUTPUT_HEAD_OLD + ';способ';   /* способ — как отправили на сайт (2.0.98) */
/* ключ (2.0.119) — у строк о сдаче, найденной на Диске (сдали руками): папка и день. По нему строка пишется
   один раз, сколько бы компьютеров эту сдачу ни заметили. У строк о действиях в программе он пустой. */
var CP_OUTPUT_HEAD = CP_OUTPUT_HEAD_V2 + ';ключ';

/** Поля строки CSV (с кавычками, как пишет cpOutputAppend). */
function cpCsvFields(line) {
  var out = [], cur = '', q = false;
  for (var i = 0; i < line.length; i++) {
    var ch = line.charAt(i);
    if (q) { if (ch === '"') { if (line.charAt(i + 1) === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ';') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function cpReviewRoot() { return (CP.settings && CP.settings.retouched) || ''; }

/** Папка карточки в 04: как папка артикула в исходниках, иначе как в выгрузке. */
/* Папка карточки в 04 и на сайте — та же, что у её артикула в исходниках, со всей структурой: бренд/артикул
   (предметка, оптика), лук/артикул (модельная). Маша, 18.11.2026: «при загрузке просто поартикульно он теряет
   структуру папок типа бренда; важно, чтобы при сдаче на сайт сохранялась структура: бренд, внутри бренда
   артикул». Карточка, собранная руками, свою папку не помнит (cpArticleDir) — папка находится по её кадрам:
   все кадры из одной папки артикула — значит, эта. Иначе — как раньше, по названию карточки.
   data/shoot — отбор и съёмка, когда карточка не из открытой съёмки (окно «Сдать» с витрины). */
function cpRvDirFor(card, idx, data, shoot) {
  var dir = card && (card.cpArticleDir || cpCardArtDirByPhotos(card, data, shoot));
  if (dir) return dir.split('/').map(CPDisk.safeName).join('/');
  return CPDisk.safeName(cpCardExportFolder(card || { title: 'Карточка' }, idx < 0 ? 0 : idx));
}

/* Папка артикула в 04 и на сайте — с буквой ретушёра, который сдал, как в 03 (Маша, 18.11.2026, таблица:
   «04_ОТРЕТУШИРОВАНО / съёмка / maxmara_оптика / U_75327_оптика»). Прежняя буква в имени заменяется. */
function cpRvLettered(rel, letter) {
  var segs = String(rel || '').split('/'), last = segs.pop() || '';
  var letters = typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
  var sp = typeof cpLetterSplit === 'function' ? cpLetterSplit(last, letters.indexOf(letter) === -1 && letter ? letters.concat([letter]) : letters) : null;
  if (sp) last = sp.rest;
  segs.push((letter ? CPDisk.safeName(letter) + '_' : '') + last);
  return segs.join('/');
}

/** Папка артикула карточки (путь внутри съёмки) по её кадрам; '' — кадры из разных папок или артикула нет. */
function cpCardArtDirByPhotos(card, data, shoot) {
  shoot = shoot || CP.shoot;
  if (!card || !shoot || typeof cpShootType !== 'function' || typeof cpFacets !== 'function') return '';
  var type = cpShootType(shoot.name);
  if (!type || type.roles.indexOf('артикул') === -1) return '';
  var byId = {};
  ((data && data.photos) || (CP.shoot && CP.shoot.path === shoot.path ? App.photos : []) || []).forEach(function (p) { byId[p.id] = p; });
  var root = String(shoot.path).replace(/\/+$/, '') + '/', dirs = {};
  var pids = card.mode === 'auto' ? (card.pids || []) : (card.slots || []).map(function (x) { return x.pid; }).filter(Boolean);
  pids.forEach(function (pid) {
    var p = byId[pid];
    if (!p || !p.disk || p.disk.indexOf(root) !== 0 || (p.kind || 'photo') === 'ref') return;
    var f = cpFacets(type, p.disk.slice(root.length));
    dirs[f.code && f.articlePath ? f.articlePath : '?'] = true;
  });
  var list = Object.keys(dirs);
  return list.length === 1 && list[0] !== '?' ? list[0] : '';
}

function cpParentDir(p) { return String(p || '').slice(0, String(p || '').lastIndexOf('/')); }
function cpRvDirOf(ver) { return ver.dir || (ver.files && ver.files[0] ? cpParentDir(ver.files[0].path) : ''); }

/* ---------- выработка: строка на каждую сдачу и решение ---------- */

var _cpOutChain = Promise.resolve();
function cpOutputAppend(rows, file, head) {
  if (!rows || !rows.length) return Promise.resolve();
  /* записи в одну таблицу из этой вкладки — по очереди: две одновременные затирали бы друг друга */
  var run = function () { return cpOutputAppendNow(rows, file, head); };
  var p = _cpOutChain.then(run, run);
  _cpOutChain = p.then(null, function () { });
  return p;
}
function cpOutputAppendNow(rows, file, head) {
  file = file || CP_OUTPUT_FILE; head = head || CP_OUTPUT_HEAD;
  var path = cpServicePath(file);
  var esc = function (v) { v = String(v === undefined || v === null ? '' : v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return CPDisk.proxyFile(path).then(function (b) { return b.text(); }, function (e) { if (e && e.status === 404) return ''; throw e; })
    .then(function (old) {
      old = String(old || '').replace(/^﻿/, '').replace(/\s+$/, '');
      if (file === CP_OUTPUT_FILE && old) {
        /* таблица заведена раньше — дописываем в заголовок новые столбцы («способ», «ключ») */
        var nl = old.indexOf('\n'), first = nl < 0 ? old : old.slice(0, nl);
        if (first !== CP_OUTPUT_HEAD && (first === CP_OUTPUT_HEAD_V2 || first === CP_OUTPUT_HEAD_OLD)) old = CP_OUTPUT_HEAD + (nl < 0 ? '' : old.slice(nl));
      }
      var list = rows;
      if (file === CP_OUTPUT_FILE) {
        /* строка с ключом (сдача, найденная на Диске) — один раз */
        var have = {};
        old.split('\n').slice(1).forEach(function (l) { var f = cpCsvFields(l); if (f.length > 10 && f[10]) have[f[10]] = true; });
        list = rows.filter(function (r) { var k = r[10]; if (!k) return true; if (have[k]) return false; have[k] = true; return true; });
        if (!list.length) return;
      }
      var text = list.map(function (r) { return r.map(esc).join(';'); }).join('\n');
      var body = '﻿' + (old || head) + '\n' + text + '\n';   /* BOM — Excel открывает кириллицу */
      return CPDisk.ensureDir(CP_CONFIG.serviceDir).then(function () {
        return CPDisk.uploadBlob(path, new Blob([body], { type: 'text/csv;charset=utf-8' }), true);
      });
    }).catch(function (e) { if (window.console) console.warn('[CP] ' + file + ' не записался', e && (e.body || e.message || e)); });
}

/**
 * Строка выработки о сдаче, найденной на Диске (сдали руками, а не через программу). o: {stamp — дата файла
 * на Диске (время сдачи), day — день (иначе по stamp), letter, shoot, card, files, event, way, v, key}.
 */
function cpDiskRow(o) {
  var t = Date.parse(o.stamp || ''), d = isNaN(t) ? new Date() : new Date(t), z = function (n) { return (n < 10 ? '0' : '') + n; };
  var day = o.day || (d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()));
  return [day, z(d.getHours()) + ':' + z(d.getMinutes()), o.letter || '', o.shoot || '', o.card || '', o.files || 0, o.event || 'сдано', 'Диск', o.v ? 'v' + o.v : '', o.way || '', o.key || ''];
}

function cpOutputRow(ver, shootName, card, event, via) {
  var d = new Date(), z = function (n) { return (n < 10 ? '0' : '') + n; };
  return [cpToday(), z(d.getHours()) + ':' + z(d.getMinutes()), ver.letter || '', shootName, card ? card.title || '' : '', (ver.files || []).length, event, cpActor(), 'v' + ver.v,
    typeof cpRvViaText === 'function' ? cpRvViaText(via) : '', ''];
}

/* ---------- номер дропа (Маша, 18.11.2026) ----------
   «У нас буквы ретушёра, дальше номер дропа. Номер дропа — просто порядок: если этот ретушёр в этот день
   грузит второй раз, это дроп 2; кроме случаев, когда он догружает отдельные картинки артикула — это всё
   ещё дроп 2. Они грузят привычным способом с номером дропа — оставляем. Чтобы ничего не задублировалось.»
   На сайте: <сайт>/<ДД.ММ.ГГ дня дропа>/<буква>/<номер дропа>/<съёмка>/<бренд или лук>/<буква_артикул>.
   - Дроп — это сдача ретушёра в какой-то день: (день, буква, номер). Дата папки на сайте — день дропа, а не
     день, когда старший принял: принятое по частям в разные дни ляжет в одну папку, а не в две.
   - Номер: из имени загруженной папки («…_U_2»), как ретушёры привыкли; иначе — следующий за последним
     дропом этой буквы сегодня (по записи в свойствах папки 04 — общая для всех съёмок, по уже принятым на
     сайт папкам дня и по версиям этой съёмки). Ретушёр видит номер в окне сдачи и может поправить.
   - Догрузка: у карточки уже есть версия от этого ретушёра — новая версия остаётся в её дропе (тот же день
     и номер), куда бы ни сдавалась. «Загрузить в карточку» — тоже.
   - Папка артикула в этом дропе на сайте уже есть — файлы ложатся в неё (одноимённые заменяются), а не в
     новую папку с «_2». */
function cpIsoDots(iso) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || ''); return m ? m[3] + '.' + m[2] + '.' + m[1].slice(2) : String(iso || ''); }
/** День дропа версии (ГГГГ-ММ-ДД). */
function cpDropDay(ver) { return (ver && (ver.dropDate || ver.date)) || cpToday(); }
function cpDropKey(letter) { return 'cp_drop_' + String(letter).split('').map(function (c) { return c.charCodeAt(0).toString(16); }).join(''); }
CP.drops = null;   /* {root, at, props}: последние дропы ретушёров — свойства папки 04 */

function cpDropsLoad(force) {
  var root = cpReviewRoot();
  if (!root || !CPDisk.props) return Promise.resolve({});
  if (!force && CP.drops && CP.drops.root === root && Date.now() - CP.drops.at < 30000) return Promise.resolve(CP.drops.props);
  return CPDisk.props(root).then(function (p) {
    CP.drops = { root: root, at: Date.now(), props: p || {} };
    return CP.drops.props;
  }, function () { return (CP.drops && CP.drops.props) || {}; });
}

/** Номер последнего дропа ретушёра в этот день по записи в папке 04; 0 — не было. */
function cpDropLast(letter, day) {
  var v = ((CP.drops && CP.drops.props) || {})[cpDropKey(letter)] || '';
  var m = /^(\d{4}-\d{2}-\d{2}):(\d+)/.exec(v);
  return m && m[1] === day ? +m[2] : 0;
}

/** Запомнить дроп (в свойствах папки 04): номер только растёт в пределах дня. */
function cpDropsNote(letter, day, n) {
  var root = cpReviewRoot();
  if (!root || !letter || !(+n) || cpDropLast(letter, day) >= +n) return Promise.resolve();
  var props = {};
  props[cpDropKey(letter)] = day + ':' + (+n);
  if (CP.drops && CP.drops.root === root) CP.drops.props[cpDropKey(letter)] = props[cpDropKey(letter)];
  return CPDisk.proxyProps(root, props).catch(function (e) { if (window.console) console.warn('[CP] номер дропа не записался', e && (e.body || e.message)); });
}

/** Дропы дня на сайте: {буква: последний номер} — то, что уже лежит в папке дня (и руками тоже). */
function cpDropsOnSite(day) {
  var site = typeof cpSiteRoot === 'function' ? cpSiteRoot() : '';
  if (!site) return Promise.resolve({});
  var letters = typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
  var dayDir = site.replace(/\/+$/, '') + '/' + cpIsoDots(day);
  return CPDisk.listDir(dayDir, null, 1).then(function (items) {
    var ls = items.filter(function (x) { return x.type === 'dir' && cpLetterOf(x.name, letters); });
    return cpPool(ls, 3, function (x) {
      return CPDisk.listDir(x.path, null, 1).then(function (inner) {
        return { l: cpLetterOf(x.name, letters), n: inner.reduce(function (a, y) { return y.type === 'dir' && /^\d{1,3}$/.test(y.name) ? Math.max(a, +y.name) : a; }, 0) };
      }, function () { return { l: cpLetterOf(x.name, letters), n: 0 }; });
    });
  }, function () { return []; }).then(function (list) {
    var out = {};
    (list || []).forEach(function (x) { out[x.l] = Math.max(out[x.l] || 0, x.n); });
    return out;
  });
}

/** Следующий номер дропа ретушёра сегодня (для окна сдачи). */
function cpDropSuggest(st) {
  var day = cpToday(), l = st.letter, max = cpDropLast(l, day);
  max = Math.max(max, (st.siteDrops || {})[l] || 0);
  var rv = (((st.data || {}).meta || {}).cp || {}).rv || {};
  Object.keys(rv).forEach(function (id) { (rv[id] || []).forEach(function (v) { if (v.letter === l && cpDropDay(v) === day && +v.n) max = Math.max(max, +v.n); }); });
  st.dropMax = max;
  return String(max + 1);
}

/** Дроп карточки в этой сдаче: {date, n, again} — again: догрузка в прежний дроп этого ретушёра. */
function cpDropOf(st, id) {
  var rv = (((st.data || {}).meta || {}).cp || {}).rv || {}, list = rv[id] || [];
  for (var i = list.length - 1; i >= 0; i--) {
    var v = list[i];
    if (v.letter === st.letter && +v.n && (st.nAuto !== false || +v.n === +st.n)) {
      return { date: cpDropDay(v), n: String(+v.n), again: true };
    }
  }
  return { date: cpToday(), n: String(st.n || '1'), again: false };
}

/** Папка съёмки в 04: уже есть (в том числе с номером очереди «1_…») — она, иначе новая по имени съёмки. */
function cpReviewShootDir(root, name) {
  var plain = root.replace(/\/+$/, '') + '/' + CPDisk.safeName(name);
  return cpFindShootIn(root, name, 1).then(function (found) {
    if (!found.length) return plain;
    var exact = found.filter(function (f) { return f.path === plain; })[0];
    var marked = found.filter(function (f) { return f.path !== plain; })[0];
    return (marked || exact).path;
  }, function () { return plain; });
}

/** Имя партии и путь артикула одинаково устроены в 04 и на сайте. */
function cpReviewDropDir(root, name, letter, drop) {
  return root.replace(/\/+$/, '') + '/' + cpIsoDots(drop.date) + '/' + CPDisk.safeName(letter)
    + '/' + CPDisk.safeName(drop.n) + '/' + CPDisk.safeName(name);
}

function cpReviewVersionPath(root, from) {
  root = root.replace(/\/+$/, '');
  if (!from || from.indexOf(root + '/') !== 0) return null;
  var parts = from.slice(root.length + 1).split('/');
  var depth = parts.length > 4 && cpSiteDateName(parts[0]) && /^\d+$/.test(parts[2]) ? 4 : 1;
  return { shoot: root + '/' + parts.slice(0, depth).join('/'), rel: parts.slice(depth).join('/'),
    date: depth === 4 ? cpSiteDateName(parts[0]) : '', letter: depth === 4 ? parts[1] : '', n: depth === 4 ? parts[2] : '' };
}

function cpReviewRel(root, from) {
  var path = cpReviewVersionPath(root, from);
  return path ? path.rel : '';
}

var CP_STAGE_MOVE_MS = 25000;

function cpStageMoveExact(from, path, verify) {
  function check(message) {
    return Promise.all([cpArticleMeta(from), cpArticleMeta(path)]).then(function (state) {
      if (!state[0] && state[1] && (!verify || verify(state[1]))) return;
      throw { message: (message || 'Не удалось поставить папку на место') + ': ' + CPDisk.showPath(path), plain: true, conflict: !!(state[0] && state[1]) };
    });
  }
  return CPDisk.proxyMove([{ from: from, path: path }], CP_STAGE_MOVE_MS).then(function (out) {
    var r = (out.results || [])[0];
    if (r && r.status === 'done') return;
    return check(r && r.error);
  }, function (e) { return check(e && e.message); });
}

/* Сначала проверенная копия в служебной папке, затем замена целевой.
   При сбое установки прежняя папка возвращается на место. */
var CP_STAGE_REPLACING = Object.create(null);
function cpReplaceStageArticle(items, to, markDelivery, prepared) {
  if (!items.length) return Promise.reject({ message: 'В артикуле нет файлов', plain: true });
  var digest = function (meta) { return meta.sha256 || meta.md5 || [meta.size, meta.modified].join(':'); };
  var wait = CP_STAGE_REPLACING[to] || Promise.resolve();
  var task = wait.catch(function () { }).then(function () {
    return cpPool(items, 4, function (it) {
      return (it.meta ? Promise.resolve(it.meta) : CPDisk.meta(it.from)).then(function (meta) {
        return { from: it.from, rel: it.path.slice(to.length), digest: digest(meta), md5: meta.md5 };
      });
    }).then(function (files) {
      var parent = cpParentDir(to), key = cpHash(to + JSON.stringify(files.map(function (f) {
        return { from: f.from, rel: f.rel, digest: f.digest };
      })));
      /* У каждой замены своя резервная папка: фоновая уборка не затронет следующую попытку. */
      var staging = prepared || parent + '/_cp_new_' + key, backup = parent + '/_cp_old_' + key + '_' + cpqId();
      return cpArticleMeta(to).then(function (current) {
        if (!current || (current.custom_properties || {}).cp_stage_copy !== key) return { current: current, same: false };
        return CPDisk.walkPhotos(to, false, 4, true).then(function (existing) {
          var expected = Object.create(null);
          files.forEach(function (file) { expected[file.rel] = file.digest; });
          var same = existing.length === files.length && existing.every(function (file) {
            return expected[file.path.slice(to.length)] === digest(file);
          });
          return { current: current, same: same };
        });
      }).then(function (state) {
        if (state.same) return;
        var ready = prepared ? Promise.resolve() : cpqChunks(files, CPQ.copyChunk).reduce(function (p, chunk) {
          return p.then(function () {
            var batch = chunk.map(function (f) { return { from: f.from, path: staging + f.rel }; });
            return cpStageCopyBatch(batch, [staging]).then(function (out) {
              return cpPool(batch, 4, function (it, i) {
                var r = (out.results || [])[i];
                if (r && r.status === 'done') return Promise.resolve();
                if (!r || r.status !== 'exists') return Promise.reject({ message: (r && r.error || 'Не скопировался файл') + ': ' + CPDisk.showPath(to + chunk[i].rel), plain: true });
                return CPDisk.meta(it.path).then(function (m) {
                  if (digest(m) !== chunk[i].digest) throw { message: 'Промежуточная копия отличается от исходника', plain: true };
                });
              });
            });
          });
        }, Promise.resolve());
        return ready.then(function () {
          var props = { cp_stage_copy: key };
          if (markDelivery) props.cp_mv = String(Date.now());
          if (prepared) props.cp_up = String(Date.now());
          return CPDisk.proxyProps(staging, props, 15000).catch(function (e) {
            return CPDisk.meta(staging).then(function (meta) {
              var actual = meta.custom_properties || {};
              if (!Object.keys(props).every(function (name) { return actual[name] === props[name]; })) throw e;
            });
          });
        }).then(function () {
          return (state.current ? cpStageMoveExact(to, backup) : Promise.resolve()).then(function () {
            return cpStageMoveExact(staging, to, function (meta) {
              return meta.type === 'dir' && (meta.custom_properties || {}).cp_stage_copy === key;
            }).catch(function (e) {
              return Promise.all([cpArticleMeta(to), cpArticleMeta(backup)]).then(function (after) {
                if (!after[0] && after[1]) return cpStageMoveExact(backup, to);
              }).then(function () { throw e; });
            });
          });
        }).then(function () {
          if (state.current) CPDisk.trash([backup], 30000).then(function (results) {
            var result = results[0];
            if (!result || !/^(done|gone)$/.test(result.status)) throw new Error((result && result.error) || 'Корзина не подтвердилась');
          }).catch(function (e) { if (window.console) console.warn('[CP] резервная папка осталась на Диске', backup, e.message); });
        });
      }).then(function () { return files.map(function (file) { return file.md5; }); });
    });
  });
  CP_STAGE_REPLACING[to] = task;
  var release = function () { if (CP_STAGE_REPLACING[to] === task) delete CP_STAGE_REPLACING[to]; };
  task.then(release, release);
  return task;
}

function cpCopyToSite(from, to) {
  return CPDisk.walkPhotos(from, false, 4, true).then(function (files) {
    return cpReplaceStageArticle(files.map(function (f) {
      return { from: f.path, path: to + f.path.slice(from.length), meta: f };
    }), to, true);
  });
}

/* окно сдачи: сразу узнать, какие дропы у ретушёров уже есть сегодня (запись в 04 и папки дня на сайте) */
cpAcceptOpen = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    var st = CP.accept;
    if (st && cpReviewRoot()) {
      Promise.all([cpDropsLoad(true), cpDropsOnSite(cpToday())]).then(function (res) {
        if (CP.accept !== st) return;
        st.siteDrops = res[1] || {};
        if (st.data && st.files.length) cpAcceptPlan();
      });
    }
    return r;
  };
})(cpAcceptOpen);

/* ---------- сдача: в 04/<съёмка>/<папка артикула> ---------- */

/* В одной папке сохраняем разные кадры с одинаковым именем. Один и тот
   же файл, добавленный дважды по тому же пути, отправляем один раз. */
async function cpRetouchUploadNames(files) {
  var norm = function (name) { return name.normalize('NFC').toLowerCase(); };
  var items = files.map(function (item) {
    var sub = (item.sub || []).map(CPDisk.safeName);
    var name = CPDisk.safeName(item.name || item.file.name);
    return { file: item.file, rel: sub.concat(name).join('/') };
  });
  var reserved = new Set(items.map(function (item) { return norm(item.rel); }));
  var used = new Set(), included = new Map(), hashes = new WeakMap(), out = [];
  function hash(file) {
    if (!hashes.has(file)) {
      hashes.set(file, file.arrayBuffer().then(function (buf) { return crypto.subtle.digest('SHA-256', buf); })
        .then(function (digest) { return Array.from(new Uint8Array(digest)).join(','); }));
    }
    return hashes.get(file);
  }
  for (var i = 0; i < items.length; i++) {
    var item = items[i], key = norm(item.rel), copies = included.get(key) || [];
    var sameSize = copies.filter(function (file) { return file.size === item.file.size; });
    if (sameSize.indexOf(item.file) !== -1) continue;
    if (sameSize.length && window.crypto && crypto.subtle) {
      var sums = await Promise.all([hash(item.file)].concat(sameSize.map(hash)));
      if (sums.indexOf(sums[0], 1) !== -1) continue;
    }
    copies.push(item.file);
    included.set(key, copies);
    var rel = item.rel;
    if (used.has(key)) {
      var dot = rel.lastIndexOf('.'), end = dot > rel.lastIndexOf('/') ? dot : rel.length;
      var stem = rel.slice(0, end), ext = rel.slice(end), n = 2;
      do { rel = stem + '_' + n++ + ext; }
      while (used.has(norm(rel)) || reserved.has(norm(rel)));
    }
    used.add(norm(rel));
    out.push({ file: item.file, name: cpFolderBase(rel), rel: rel });
  }
  return out;
}

var cpAcceptUploadLegacy = cpAcceptUpload;
cpAcceptUpload = function () {
  var root = cpReviewRoot();
  if (!root) { if (cpCatStageMissing('retouched')) return; return cpAcceptUploadLegacy(); }
  var st = CP.accept, plan = st && st.plan;
  if (!plan || st.uploading) return;
  var li = document.getElementById('cpAccLetter'), ni = document.getElementById('cpAccN');
  if (li) st.letter = li.value.trim();
  if (ni) st.n = ni.value.trim();
  if (!st.letter) { cpAcceptNeedLetter(); return; }
  if (!st.n) st.n = '1';
  if (!/^[1-9]\d*$/.test(st.n)) { cbToast('Укажите номер дропа цифрами, например 1'); return; }
  var batch = cpToday() + '_' + st.letter + '_' + st.n;
  var label = cpFolderBase(root), cards = st.data.cards || [];
  var groups = [], files = [], uploaded = new Set(), failed = new Map(), installed = [];
  var dirs = new Set(), loaded = {}, total = 0, current = '';
  var mb = function (b) { return (b / 1048576).toFixed(b < 10485760 ? 1 : 0); };
  var show = function () {
    var sum = Object.values(loaded).reduce(function (a, b) { return a + b; }, 0);
    var text = 'Загружаю в ' + label + ': файлов ' + uploaded.size + ' из ' + files.length + ' · ' + mb(sum) + ' из ' + mb(total) + ' МБ'
      + (total ? ' (' + Math.round(100 * sum / total) + '%)' : '') + (current ? ' · ' + current : '');
    cbBusyShow(text, 0.02 + 0.96 * (total ? sum / total : 0));
    var pe = document.getElementById('cpAccProg');
    if (pe) pe.innerHTML = '<div class="cp-acc-bar"><i style="width:' + Math.round(100 * sum / Math.max(1, total)) + '%"></i></div><div>' + cbEsc(text) + '</div>';
  };
  var fail = function (id, error) {
    var list = failed.get(id) || [];
    list.push(error && (error.message || error.status) || String(error));
    failed.set(id, list);
  };
  var go = document.querySelector('[data-cp-acc="go"]');
  if (go) { go.disabled = true; go.textContent = 'Загружаю...'; }
  var planBox = document.getElementById('cpAccPlan');
  if (planBox && !document.getElementById('cpAccProg')) planBox.insertAdjacentHTML('beforeend', '<div class="cp-acc-prog" id="cpAccProg"></div>');
  st.uploading = true;
  cbBusyShow('Готовлю папки в ' + label + '...', 0.01);
  return cpPool(Object.keys(plan.groups), 3, function (id) {
    var idx = cards.findIndex(function (card) { return card.id === id; });
    var drop = cpDropOf(st, id), base = cpReviewDropDir(root, st.name, st.letter, drop);
    var dir = base + '/' + cpRvLettered(cpRvDirFor(cards[idx], idx, st.data, { path: st.path, name: st.name }), st.letter);
    return cpRetouchUploadNames(plan.groups[id]).then(function (named) {
      var stage = cpParentDir(dir) + '/_cp_upload_' + cpqId();
      return { id: id, drop: drop, base: base, dir: dir, stage: stage, files: named };
    });
  }).then(function (ready) {
    groups = ready;
    groups.forEach(function (g) {
      var dir = g.dir.normalize('NFC').toLowerCase();
      if (dirs.has(dir)) throw { plain: true, message: 'Две карточки ссылаются на одну папку артикула: ' + CPDisk.showPath(g.dir) };
      dirs.add(dir);
      g.files.forEach(function (f) {
        f.card = g.id;
        f.path = g.dir + '/' + f.rel;
        f.from = g.stage + '/' + f.rel;
        files.push(f);
        total += f.file.size;
      });
    });
    var parents = Array.from(new Set(files.map(function (f) { return cpParentDir(f.from); })));
    return cpPool(parents, 3, function (p) { return CPDisk.ensureDir(p); });
  }).then(function () {
    show();
    return cpPool(files, 3, function (f, i) {
      current = f.name;
      return cpUpSure(f.from, f.file, true, function (b) { loaded[i] = b; show(); })
        .then(function () { uploaded.add(f); }, function (e) { fail(f.card, f.name + ': ' + (e && (e.message || e.status) || e)); })
        .then(function () { loaded[i] = f.file.size; show(); });
    });
  }).then(function () {
    cbBusyShow('Проверяю и заменяю папки артикулов...', 0.97);
    return cpPool(groups, 2, function (g) {
      if (failed.has(g.id)) return Promise.resolve();
      return cpReplaceStageArticle(g.files, g.dir, false, g.stage).then(function (digests) {
        g.digests = digests;
        installed.push(g);
      }, function (e) { fail(g.id, e); });
    });
  }).then(function () {
    if (!installed.length) throw { plain: true, message: 'Комплект не заменился. ' + Array.from(failed.values()).flat().slice(0, 3).join('; ') };
    var who = cpActor(), now = new Date().toISOString(), rows = [], oldDirs = new Set();
    var apply = function (data) {
      var m = data.meta.cp, rv = m.rv = m.rv || {};
      rows = [];
      oldDirs.clear();
      installed.forEach(function (g) {
        var list = rv[g.id] = rv[g.id] || [], prev = cpLastRv(list), previousPath = prev && cpRvDirOf(prev);
        if (previousPath && previousPath !== g.dir && (previousPath.indexOf(root + '/') === 0
          || previousPath.indexOf(st.path + '/' + CP_ACCEPT_DIR + '/') === 0)) oldDirs.add(previousPath);
        if (prev && /^(review|rework)$/.test(prev.status)) prev.status = 'replaced';
        var dp = g.drop;
        var resultFiles = g.files.map(function (f, i) { return { path: f.path, name: f.name, size: f.file.size, md5: g.digests[i] }; });
        var ver = { v: list.length + 1, batch: dp.date + '_' + st.letter + '_' + dp.n, letter: st.letter,
          n: dp.n, dropDate: dp.date, date: cpToday(), by: who, ts: now, files: resultFiles, status: 'review', dir: g.dir };
        if (dp.again) ver.again = true;
        list.push(ver);
        var card = (data.cards || []).find(function (c) { return c.id === g.id; });
        rows.push(cpOutputRow(ver, st.name, card, 'сдано'));
      });
      Object.values(rv).forEach(function (list) { var last = cpLastRv(list); if (last) oldDirs.delete(cpRvDirOf(last)); });
      (m.events = m.events || []).push({ ts: now, actor: who, action: 'rt_upload',
        items: installed.flatMap(function (g) { return g.files.map(function (f) { return f.name; }); }),
        note: 'сдача ' + batch + ' в ' + label + ': карточек ' + installed.length + (failed.size ? ', не заменились ' + failed.size : '')
          + ' · буква ' + st.letter + (st.letterAuto ? ' — из имени папки' : st.letterHow === 'took' ? ' — выбрана, забирал(а) эти артикулы' : ' — выбрана при сдаче')
          + (st.found ? ' · съёмка найдена по артикулам' : '') });
    };
    var saved;
    if (CP.shoot && CP.shoot.path === st.path) {
      apply({ meta: { cp: cpMeta() }, cards: App.cards });
      cbMarkDirty();
      cbRenderCards();
      cbRenderOutline();
      saved = cpFlushSave();
    } else saved = cpMutateState({ path: st.path, name: st.name }, apply);
    return saved.then(function () {
      if (installed.some(function (g) { return !g.drop.again; })) cpDropsNote(st.letter, cpToday(), st.n);
      var effects = installed.map(function (g) {
        return CPDisk.proxyProps(g.dir, { cp_rt: st.letter, cp_rt_date: cpToday(), cp_up: null }).catch(function () { });
      });
      effects.push(cpOutputAppend(rows));
      if (oldDirs.size) effects.push(CPDisk.trash(Array.from(oldDirs)));
      return Promise.all(effects);
    });
  }).then(function () {
    cbBusyHide();
    var count = installed.reduce(function (total, g) { return total + g.files.length; }, 0);
    var msg = 'Загружено в ' + label + ': ' + count + ' файл(ов)' + (failed.size ? ', не заменились карточки: ' + failed.size : '') + ' — сдача ' + batch;
    cbToast(msg);
    if (CP.accept === st && failed.size) {
      var retry = new Set(Array.from(failed.keys()).flatMap(function (id) { return plan.groups[id].map(function (f) { return f.file; }); }));
      st.files = st.files.filter(function (x) { return retry.has(x.file); });
      cpAcceptPlan();
    } else if (CP.accept === st) {
      var planEl = document.getElementById('cpAccPlan');
      if (planEl) planEl.innerHTML = '<div class="cp-acc-done">' + cbEsc(msg) + '.</div>';
      st.files = [];
    }
    cpReviewPresent(st.name, Array.from(new Set(installed.map(function (g) { return g.base; }))));
  }).catch(function (e) {
    cbBusyHide();
    var retry = document.querySelector('[data-cp-acc="go"]');
    if (retry && CP.accept === st) { retry.disabled = false; retry.textContent = 'Загрузить в ' + label; }
    if (e && e.plain) { cbToast('Сдать ретушь: ' + e.message); return; }
    cpHandleError(e, 'Сдача ретуши');
  }).finally(function () {
    st.uploading = false;
    var staged = groups.map(function (g) { return g.stage; });
    if (staged.length) CPDisk.trash(staged).catch(function () { });
  });
};

/**
 * Съёмка только что появилась в 04 — показать её в фильтре сразу, не дожидаясь
 * списка папок: Яндекс показывает новую папку в списке не мгновенно. Потом
 * сверяемся с Диском ещё дважды.
 */
function cpReviewPresent(shootName, dir) {
  var low = String(shootName).toLowerCase();
  CP.stagePresence = CP.stagePresence || {};
  CP.stagePaths = CP.stagePaths || {};
  (CP.stagePresence.review = CP.stagePresence.review || {})[low] = true;
  var w = CP.stagePaths.review = CP.stagePaths.review || {};
  (Array.isArray(dir) ? dir : [dir]).forEach(function (path) {
    if (!(w[low] || []).includes(path)) w[low] = (w[low] || []).concat([path]);
    if (typeof cpStageNote === 'function') cpStageNote('review', shootName, path);
  });
  if (typeof cpRefreshShootReview === 'function') cpRefreshShootReview(shootName, dir);
  if (CP.shoots) cpRenderShoots();
  [4000, 15000].forEach(function (ms) {
    setTimeout(function () { if (typeof cpScanStages === 'function' && CP.shoots) cpScanStages(); }, ms);
  });
}

/* в окне сдачи: кнопка — «Загрузить в 04_…»; съёмку нашли по артикулам — сверху вопрос «сдаём сюда?» */
cpAcceptPlan = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    var st = CP.accept, root = cpReviewRoot();
    var b = document.querySelector('[data-cp-acc="go"]');
    if (root && b) b.textContent = 'Загрузить в ' + cpFolderBase(root);
    var box = document.getElementById('cpAccPlan');
    if (st && st.found && box && !document.getElementById('cpAccFound')) {
      var cur = st.found.list.filter(function (x) { return x.d.path === st.path; })[0];
      var others = st.found.list.filter(function (x) { return x.d.path !== st.path; });
      box.insertAdjacentHTML('afterbegin', '<div class="cp-acc-found" id="cpAccFound">Папки артикулов без папки съёмки. Артикул' + (st.found.codes.length > 1 ? 'ы' : '') + ' '
        + cbEsc(st.found.codes.slice(0, 12).join(', ')) + (st.found.codes.length > 12 ? '…' : '') + ' — в съёмке <b>' + cbEsc(st.name) + '</b>'
        + (cur && cur.miss.length ? ' (нет в ней: ' + cbEsc(cur.miss.slice(0, 8).join(', ')) + ')' : '') + '. Сдаём в неё? Да — выберите своё имя и нажмите «Загрузить»; нет — закройте окно.'
        + (others.length ? '<br>Эти артикулы есть и в других съёмках: ' + others.map(function (x) {
          return '<a href="#" data-cp-acc-shoot="' + cbEsc(x.d.path) + '">' + cbEsc(x.d.name) + '</a>';
        }).join(', ') : '') + '</div>');
    }
    return r;
  };
})(cpAcceptPlan);

/* ---------- на сайт: копия артикула из 04 в 05 ---------- */

/** Убрать опустевшие папки от dir вверх до stop (не включая). */
function cpTrashEmptyUp(dir, stop) {
  if (!dir || dir === stop || dir.indexOf(stop + '/') !== 0) return Promise.resolve();
  return CPDisk.listDir(dir).then(function (items) {
    if (items.length) return;
    return CPDisk.trash([dir]).then(function () { return cpTrashEmptyUp(cpParentDir(dir), stop); });
  }, function () { });
}

/* Перенести папку и убедиться, что она на новом месте (Маша, 09.11: «статус должен
   свидетельствовать, что всё в нужное место переехало»). Статус ставит вызывающий —
   только после того, как эта функция вернула путь. Диск переносит большие папки в
   фоне: если прослойка не дождалась (timeout), ждём сами до 90 с и проверяем. */
function cpMoveFolder(from, to, tries, base) {
  return CPDisk.proxyMove([{ from: from, path: to }]).then(function (r) {
    var st = r && r.results && r.results[0];
    /* на новом месте такая папка уже есть — приписка «_2», «_3» к ИСХОДНОМУ имени: раньше перед припиской
       срезалось любое окончание «_цифры», и «LOOK_12» уезжала под чужим именем «LOOK_2» */
    if (st && st.status === 'exists' && (tries || 0) < 5) return cpMoveFolder(from, (base || to) + '_' + ((tries || 0) + 2), (tries || 0) + 1, base || to);
    var why = (st && (st.error || st.status)) || 'не перенеслось';
    var done = st && st.status === 'done';
    return cpWaitThere(to, done ? 1 : (why === 'timeout' ? 18 : 2)).then(function (ok) {
      if (ok) return to;
      throw { message: CPDisk.showPath(from) + ': ' + (done ? 'Диск ответил «перенесено», но на новом месте папки нет' : why) + ' — статус не поставлен, повторите', plain: true };
    });
  });
}

/** Есть ли путь на Диске; tries > 1 — повторять раз в 5 с. */
function cpWaitThere(path, tries) {
  return CPDisk.meta(path).then(function () { return true; }, function (e) {
    if ((e && e.status !== 404) || tries <= 1) return false;
    return new Promise(function (res) { setTimeout(res, CP.waitThereMs || 5000); }).then(function () { return cpWaitThere(path, tries - 1); });
  });
}

var cpRvApproveLegacy = cpRvApprove;
cpRvApprove = function (ids, via) {
  var root = cpReviewRoot(), site = typeof cpSiteRoot === 'function' ? cpSiteRoot() : '';
  if (!root) { if (cpCatStageMissing('retouched')) return; return cpRvApproveLegacy(ids, via); }
  if (!site) { cbToast('Нет папки сайта в каталоге: шестерёнка на витрине'); return; }
  var rv = cpRv(), shoot = CP.shoot, todo = [], skip = [];
  var ok = ids.filter(function (id) {
    var last = cpLastRv(rv[id]);
    if (!last || last.status !== 'review' || !cpRvDirOf(last) || cpRvHasReworkMarks(last)) {
      /* раньше — молча; теперь говорим, почему карточка не уехала */
      var c0 = cbCardById(id);
      skip.push((c0 && (c0.title || c0.category) || 'карточка') + ' — ' + (!last ? 'ретушь не сдана'
        : last.status === 'approved' ? 'уже на сайте' : last.status === 'rework' ? 'на доработке, ждёт новой версии'
        : cpRvHasReworkMarks(last) ? 'в просмотре есть кадры «на доработку» — завершите просмотр или снимите отметки' : 'нет папки версии в 04'));
      return false;
    }
    return true;
  });
  if (skip.length) cbToast('Не отправлено на сайт: ' + skip.join('; '));
  if (!ok.length) return;
  var who = cpActor(), now = new Date().toISOString(), rows = [], copied = [], queued = [];
  cbBusyShow('Отправляю на сайт...', 0.3);
  /* номер дропа у версий, сданных руками в 04 (его там нет), — последний дроп этой буквы в тот день */
  return cpDropsLoad().then(function () {
    ok.forEach(function (id) {
      var last = cpLastRv(rv[id]);
      var card = cbCardById(id), idx = App.cards.indexOf(card), from = cpRvDirOf(last);
      /* На сайт (Маша, 18.11.2026): «папка с датой ДД.ММ.ГГ, дальше буква ретушёра, который сдал, дальше номер
         дропа, дальше папка съёмки, внутри неё бренд (или лук), если есть, и только потом папка артикула — всё, что
         над артикулом в исходниках, сохраняется». Структура — из 04 (она там та же, что в исходниках). */
      var rel = cpReviewRel(root, from) || cpRvDirFor(card || { title: id }, idx);
      rel = rel.split('/').map(function (sg) { return sg.replace(/_доработка$/i, ''); }).join('/');
      var l = last.letter || (card && typeof cpCardLetter === 'function' ? cpCardLetter(card) : '');
      if (l) rel = cpRvLettered(rel, l);   /* папка артикула — с буквой (U_75327_оптика), как в 03 и 04 */
      var day = cpDropDay(last), n = String(+last.n || cpDropLast(l, day) || 1);
      var dayDir = site.replace(/\/+$/, '') + '/' + cpIsoDots(day);
      var to = dayDir + (l ? '/' + CPDisk.safeName(l) + '/' + n : '') + '/' + CPDisk.safeName(shoot.name) + '/' + rel;
      todo.push({ id: id, last: last, from: from, to: to, card: card, dayDir: dayDir });
    });
    /* Карточки копируются независимо. Статус появляется только после успешной копии. */
    return todo.reduce(function (p, t) {
      return p.then(function () {
        return cpCopyToSite(t.from, t.to).then(function () {
          copied.push(t);
        }, function (e) {
          queued.push(t);
          CPQ.add(shoot, { kind: 'site-copy', label: 'На сайт: ' + (t.card ? t.card.title || t.card.category || 'карточка' : t.id), items: [{ from: t.from, path: t.to }],
            after: { type: 'rv-approve', id: t.id, from: t.from, to: t.to, who: who, date: cpToday(), via: cpRvViaOf(via, t.id) }, err: (e && e.message) || '' });
        });
      });
    }, Promise.resolve());
  }).then(function () {
    cbBusyHide();
    var m = cpMeta();
    copied.forEach(function (t) {
      cpRvApplyApproved(m, t.id, t.from, t.to, who, now, cpToday(), cpRvViaOf(via, t.id));
      rows.push(cpOutputRow(t.last, shoot.name, t.card, 'принято', cpRvViaOf(via, t.id)));
    });
    if (copied.length) {
      var mids = copied.map(function (t) { return t.id; });
      cpEvent('rt_approve', [], { card: copied.map(function (t) { return t.card ? t.card.title : t.id; }).join(', '), via: cpRvViaKeys(via, mids),
        note: 'на сайт: ' + CPDisk.showPath(cpSiteShootDir(copied[0].to, shoot.name)) + cpRvViaNote(via, mids) });
      cbToast('На сайт: карточек ' + copied.length + ' → ' + CPDisk.showPath(cpSiteShootDir(copied[0].to, shoot.name))
        + (queued.length ? '. Не скопировались сразу: ' + queued.length + ' — копирую повторно (плашка сверху)' : ''));
    } else if (queued.length) cbToast('Не скопировалось сразу: ' + queued.length + ' — копирую повторно, не закрывайте страницу (плашка сверху)');
    cbRenderCards();
    cbRenderOutline();
    if (!copied.length) return;
    /* в «Сайте» новое: съёмка сразу в его фильтре, у папки даты — снова «не скачано» */
    var siteDirs = [], days = [];
    copied.forEach(function (t) {
      var d = cpSiteShootDir(t.to, shoot.name);
      if (siteDirs.indexOf(d) === -1) siteDirs.push(d);
      if (days.indexOf(t.dayDir) === -1) days.push(t.dayDir);
    });
    siteDirs.forEach(function (d) { cpReviewPresentStage('site', shoot.name, d); });
    if (typeof cpSiteMarkNew === 'function') cpSiteMarkNew(siteDirs);
    /* дроп мог лечь в папку прошлого дня — отметка на папке дня, чтобы её перечитали и на других компьютерах */
    days.forEach(function (d) { CPDisk.proxyProps(d, { cp_touch: String(Date.now()) }).catch(function () { }); });
    if (typeof cpMirrorAfterDelivery === 'function') cpMirrorAfterDelivery();
    return cpOutputAppend(rows);
  }).catch(function (e) {
    cbBusyHide();
    cbRenderCards();
    cpHandleError(e, 'Отправка на сайт');
  });
};

/** Папка дня на сайте: ДД.ММ.ГГ (18.11.26) — как их заводят на Диске руками. */
function cpSiteDay() {
  var d = new Date(), z = function (n) { return (n < 10 ? '0' : '') + n; };
  return z(d.getDate()) + '.' + z(d.getMonth() + 1) + '.' + String(d.getFullYear()).slice(2);
}

/** Папка съёмки на сайте по папке карточки там (сайт/дата/съёмка/бренд/артикул -> сайт/дата/съёмка). */
function cpSiteShootDir(to, shootName) {
  var seg = '/' + CPDisk.safeName(shootName), i = String(to).lastIndexOf(seg + '/');
  return i >= 0 ? to.slice(0, i + seg.length) : cpParentDir(to);
}

/** Записать в отбор: версия ретуши карточки на сайте (to — папка в 05). Общая для сразу и для очереди. */
function cpRvApplyApproved(m, id, from, to, who, ts, date, via) {
  var last = cpLastRv((m.rv || {})[id]);
  if (!last) return;
  if (via) last.via = via;
  delete last.ready;
  last.dir = from;
  last.status = 'approved'; last.rby = who; last.rts = ts; last.site = CPDisk.showPath(to);
  var rec = { files: (last.files || []).length, letter: last.letter, date: date, at: CPDisk.showPath(to), out: last.letter + '_' + last.n, ts: ts };
  m.delivered = m.delivered || {};
  m.delivered[id] = rec;
  /* у артикула бывает две карточки — сдан артикул целиком (только в открытой съёмке: нужны карточки) */
  var card = CP.shoot && typeof cbCardById === 'function' ? cbCardById(id) : null;
  if (card && typeof cpArtKey === 'function') {
    var folder = card.cpArticleDir || cpCardArtDirByPhotos(card);
    App.cards.forEach(function (c) {
      if (c.id === id || cpArtKey(c) !== cpArtKey(card) || m.delivered[c.id]) return;
      var other = c.cpArticleDir || cpCardArtDirByPhotos(c);
      if (!folder || !other || folder === other) m.delivered[c.id] = rec;
    });
  }
}

CPQ.after['rv-approve'] = function (op, m, shoot) {
  var a = op.after;
  cpRvApplyApproved(m, a.id, a.from, a.to, a.who, new Date().toISOString(), a.date, a.via);
  var last = cpLastRv((m.rv || {})[a.id]), card = CP.shoot && CP.shoot.path === shoot.path ? cbCardById(a.id) : null;
  if (last) cpOutputAppend([cpOutputRow(last, shoot.name, card || { title: a.id }, 'принято', a.via)]);
  if (CP.shoot && CP.shoot.path === shoot.path) {
    if (typeof cpSiteMarkNew === 'function') cpSiteMarkNew([cpSiteShootDir(a.to, shoot.name)]);
    if (typeof cpMirrorAfterDelivery === 'function') cpMirrorAfterDelivery();
  }
};

/* ---------- на доработку: остаётся в 04 с припиской «_доработка» ---------- */

var cpRvReworkLegacy = cpRvRework;
cpRvRework = function (id, note) {
  var root = cpReviewRoot();
  if (!root) { if (cpCatStageMissing('retouched')) return; return cpRvReworkLegacy(id, note); }
  var last = cpLastRv(cpRv()[id]);
  if (!last) return;
  if (note === undefined) note = prompt('Что доработать? (увидит ретушёр)', '');
  if (note === null) return;
  var from = cpRvDirOf(last), card = cbCardById(id);
  var to = from.replace(/_доработка$/i, '') + '_доработка';
  /* метка «переименовывает программа» едет с папкой — зеркало не примет это за доработку руками (cp-mirror.js) */
  var step = from && from !== to ? CPDisk.proxyProps(from, { cp_mv: String(Date.now()) }).catch(function () { }).then(function () { return cpStageMoveExact(from, to).then(function () { return to; }); }) : Promise.resolve(from);
  return step.then(function (dir) {
    if (dir && dir !== from) {
      last.files.forEach(function (f) { if (f.path.indexOf(from + '/') === 0) f.path = dir + f.path.slice(from.length); });
      last.dir = dir;
    }
    last.status = 'rework'; last.rby = cpActor(); last.rts = new Date().toISOString(); last.note = note.trim();
    cpRvReworkDone(card, id, last);
  }, function (e) {
    if (e && e.conflict) { cbToast('Папка доработки уже есть. Сверьте съёмку с Диском.'); return; }
    /* папка не переименовалась — переименование в очередь; статус «на доработке» появится,
       когда папка на Диске получит приписку (Маша, 10.11: сначала перенос, потом статус) */
    CPQ.add(CP.shoot, { kind: 'move', label: 'На доработку: ' + (card ? card.title || 'карточка' : id), items: [{ from: from, path: to }],
      after: { type: 'rv-rework', id: id, from: from, to: to, note: note.trim(), by: cpActor(), card: card ? card.title || '' : '' }, err: (e && e.message) || '' });
    cbToast('Папка не переименовалась сразу — повторяю; «на доработке» появится, когда она получит приписку на Диске (плашка сверху)');
  }).catch(function (e) {
    cpHandleError(e, 'На доработку');
  });
};

function cpRvReworkDone(card, id, last) {
    cpEvent('rt_rework', [], { card: card ? card.title : id, note: last.note || '' });
    cbRenderCards();
    cbRenderOutline();
    if (typeof cpRefreshShootReview === 'function') cpRefreshShootReview(CP.shoot.name);
    return cpOutputAppend([cpOutputRow(last, CP.shoot.name, card, 'доработка' + (last.note ? ': ' + last.note : ''))]);
}

CPQ.after['rv-rework'] = function (op, m, shoot) {
  var a = op.after, last = cpLastRv((m.rv || {})[a.id]);
  if (!last) return;
  (last.files || []).forEach(function (f) { if (f.path.indexOf(a.from + '/') === 0) f.path = a.to + f.path.slice(a.from.length); });
  last.dir = a.to;
  /* папка переименована — теперь и статус (в старых записях очереди решение уже записано) */
  if (last.status !== 'rework') {
    var now = new Date().toISOString();
    last.status = 'rework'; last.rby = a.by || cpActor(); last.rts = now; last.note = a.note || '';
    (m.events = m.events || []).push({ ts: now, action: 'rt_rework', actor: last.rby, items: [], card: a.card || a.id, note: last.note });
    cpOutputAppend([cpOutputRow(last, shoot.name, { title: a.card || a.id }, 'доработка' + (last.note ? ': ' + last.note : ''))]);
  }
};

/* на карточке: «Согласовать ретушь» → «На сайт» (в каталоге с папкой отретушированного) */
cbRenderCards = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    if (!cpReviewRoot()) return r;
    Array.prototype.forEach.call(document.querySelectorAll('#cbCards [data-cp-rva="approve"]'), function (b) { b.textContent = 'На сайт'; });
    return r;
  };
})(cbRenderCards);

/* ---------- на согласование: копия в 02 ----------
   Маша, 08.11: «отобрала тестовую съёмку, отправила на согласование — в папке
   „Отбор“ ничего не появилось». Шаг 2 отражения сервера: статус «на согласовании»
   — это копия кадра в папке согласования (02_ОТБОР), структура как в исходниках,
   кадр карточки артикула — в папке артикула. При переходе на другой этап
   копия в 02 остаётся. Очистка 02 применяется только при снятии статуса.
   Сверка идёт после каждой правки отбора: какие кадры на согласовании и какие
   копии лежат в 02 (meta.cp.ap2: кадр → путь копии). */

function cpApproveRoot() { return (CP.settings && CP.settings.approve) || ''; }

var _cpApTimer = null, _cpApBusy = false;
function cpApprovalSoon() {
  if (!cpApproveRoot() || !CP.shoot || CP.readOnly) return;
  clearTimeout(_cpApTimer);
  _cpApTimer = setTimeout(cpApprovalSync, 400);
}

function cpApprovalSync() {
  var root = cpApproveRoot();
  if (!root || !CP.shoot || CP.readOnly) return Promise.resolve();
  if (_cpApBusy) { cpApprovalSoon(); return Promise.resolve(); }
  var m = cpMeta(), ap2 = m.ap2 = m.ap2 || {};
  var shootPath = CP.shoot.path.replace(/\/+$/, ''), shootName = CP.shoot.name;
  var base = root.replace(/\/+$/, '') + '/' + CPDisk.safeName(shootName);
  var want = Object.keys(m.status).filter(function (pid) {
    var status = m.status[pid];
    return status.s === 'approval' && (!status.card || (!cpDrafts()[status.card] && !cpArticleJobs(shootPath, status.card).length));
  });
  var inQueue = CPQ.pendingFrom();
  var copy = want.filter(function (pid) { var p0 = cbPhotoById(pid); return !ap2[pid] && !(p0 && inQueue[p0.disk]); }).map(function (pid) {
    var p = cbPhotoById(pid);
    if (!p || !p.disk || p.missing || (p.kind || 'photo') === 'ref') return null;
    var card = m.status[pid].card ? cbCardById(m.status[pid].card) : null;
    return { pid: pid, from: p.disk, path: base + '/' + cpRetouchRel(p, card, shootPath) };
  }).filter(Boolean);
  var drop = Object.keys(ap2).filter(function (pid) { return !m.status[pid]; });
  if (!copy.length && !drop.length) return Promise.resolve();
  _cpApBusy = true;
  var label = cpFolderBase(root), path = CP.shoot.path, msgs = [];
  var step = copy.length ? cpCopyOnDisk(copy.map(function (x) { return { from: x.from, path: x.path }; }), [base], 'Копирую на согласование').then(function (r) {
    cbBusyHide();
    var failed = {};
    (r.failedFrom || []).forEach(function (f) { failed[f] = true; });
    copy.forEach(function (x) { if (!failed[x.from] && CP.shoot && CP.shoot.path === path) cpMeta().ap2[x.pid] = x.path; });
    /* не скопированное — в очередь: копирует, пока не скопирует, потом отмечает в ap2 */
    var left = copy.filter(function (x) { return failed[x.from]; });
    if (left.length) {
      var map = {};
      left.forEach(function (x) { map[x.from] = [x.pid, x.path]; });
      CPQ.add(CP.shoot, { kind: 'copy', label: 'На согласование: ' + left.length + ' кадр(ов)', items: left.map(function (x) { return { from: x.from, path: x.path }; }), dirs: [base], after: { type: 'ap2', map: map } });
    }
    msgs.push('на согласование в ' + label + ': ' + (r.done + r.exists) + (r.failed.length ? ', не скопировано ' + r.failed.length : ''));
    if (typeof cpReviewPresentStage === 'function') cpReviewPresentStage('approval', shootName, base);
  }) : Promise.resolve();
  return step.then(function () {
    if (!drop.length) return;
    var paths = drop.map(function (pid) { return ap2[pid]; });
    return CPDisk.trash(paths).then(function (res) {
      var ok = res.filter(function (x) { return x.status === 'done' || x.status === 'gone'; }).map(function (x) { return x.path; });
      var bad = res.filter(function (x) { return x.status !== 'done' && x.status !== 'gone'; }).map(function (x) { return x.path; });
      if (bad.length) CPQ.add(CP.shoot, { kind: 'trash', label: 'Снять с согласования (в Корзину): ' + bad.length, paths: bad, after: { type: 'ap2-drop', paths: bad, cleared: true } });
      if (CP.shoot && CP.shoot.path === path) drop.forEach(function (pid) { if (ok.indexOf(ap2[pid]) !== -1) delete cpMeta().ap2[pid]; });
      msgs.push('из ' + label + ' в Корзину: ' + ok.length);
      /* опустевшие папки в 02 — тоже в Корзину (до папки 02 включительно не трогаем) */
      var dirs = {};
      ok.forEach(function (pth) { dirs[cpParentDir(pth)] = true; });
      return Object.keys(dirs).reduce(function (pr, d) { return pr.then(function () { return cpTrashEmptyUp(d, root.replace(/\/+$/, '')); }); }, Promise.resolve());
    });
  }).then(function () {
    _cpApBusy = false;
    if (msgs.length && CP.shoot && CP.shoot.path === path) {
      cpEvent('approval_sync', [], { note: msgs.join('; ') }, true);
      cbToast(msgs.join(' · '));
      cbMarkDirty();
    }
  }, function (e) {
    _cpApBusy = false;
    cbBusyHide();
    cpHandleError(e, 'Копия на согласование');
  });
}

/**
 * На согласование (Маша, 10.11.2026): сначала копия в 02, потом статус — «статус появляется на
 * основании того, что что-то наличествует на Диске в нужном месте». groups: [{cardId, pids}].
 * Что не скопировалось сразу, уходит в очередь и получает статус, когда доедет (CPQ.after.st).
 */
function cpApprovalSend(groups, opts) {
  opts = opts || {};
  var root = cpApproveRoot();
  if (!root || !CP.shoot || CP.readOnly) return;
  var shoot = { path: CP.shoot.path, name: CP.shoot.name }, shootPath = shoot.path.replace(/\/+$/, '');
  var base = root.replace(/\/+$/, '') + '/' + CPDisk.safeName(shoot.name);
  var who = cpActor(), m = cpMeta(), going = cpGoingFrom('approval');
  var items = [], seen = {}, cardOf = {}, already = [], wait = 0;
  groups.forEach(function (g) {
    var card = g.cardId ? cbCardById(g.cardId) : null;
    (g.pids || []).forEach(function (pid) {
      var p = cbPhotoById(pid);
      if (!p || !p.disk || p.missing || (p.kind || 'photo') === 'ref' || seen[pid]) return;
      seen[pid] = true;
      cardOf[pid] = g.cardId || null;
      /* копия уже в 02 и статус стоит — второй раз не копируем */
      var full = !opts.quiet && card && card.cpArticleDir && cpCardPids(card).every(function (id) {
        var source = cbPhotoById(id);
        return g.pids.indexOf(id) !== -1 && source && source.disk && !source.missing && !going[source.disk];
      });
      if (!full && m.status[pid] && m.status[pid].s === 'approval' && (m.ap2 || {})[pid]) { already.push(pid); return; }
      if (going[p.disk]) { wait++; return; }
      var target = base + '/' + cpRetouchRel(p, card, shootPath);
      items.push({ pid: pid, from: p.disk, path: target, articleRoot: full ? cpStageArticleRoot(base, target, card) : '' });
    });
  });
  var label = cpFolderBase(root);
  /* статус — кадрам, чья копия на месте, и карточкам, у которых такие кадры есть */
  var mark = function (okItems) {
    var mm = cpMeta(), ts = new Date().toISOString(), okPid = {};
    mm.ap2 = mm.ap2 || {};
    okItems.forEach(function (x) {
      mm.status[x.pid] = { s: 'approval', by: who, ts: ts, card: cardOf[x.pid] || undefined };
      mm.ap2[x.pid] = x.path;
      okPid[x.pid] = true;
    });
    already.forEach(function (pid) { okPid[pid] = true; });
    var nCards = 0;
    groups.forEach(function (g) {
      if (!g.cardId || !(g.pids || []).some(function (pid) { return okPid[pid]; })) return;
      var cs = mm.cardStatus[g.cardId];
      if (!(cs && cs.s === 'approval')) { mm.cardStatus[g.cardId] = { s: 'approval', by: who, ts: ts }; nCards++; }
    });
    return nCards;
  };
  var names = function (list) { return cpPhotoNames(list.map(function (x) { return x.pid; })); };
  var cardNames = groups.map(function (g) { var c = g.cardId ? cbCardById(g.cardId) : null; return c ? c.title || c.category || 'карточка' : ''; }).filter(Boolean).join(', ');
  var after = function (list) {
    var a = { type: 'st', s: 'approval', by: who, map: {}, cards: {}, ap2: {} };
    list.forEach(function (x) { a.map[x.from] = x.pid; if (cardOf[x.pid]) a.cards[x.pid] = cardOf[x.pid]; a.ap2[x.pid] = x.path; });
    return a;
  };
  var queue = function (list, err) {
    CPQ.add(shoot, { kind: 'copy', label: 'На согласование: ' + list.length + ' кадр(ов)', items: list.map(cpStageCopyItem), dirs: [base], after: after(list), err: err || '' });
  };
  var done = function (okItems, queued) {
    var same = CP.shoot && CP.shoot.path === shoot.path;
    if (!same) return;
    var nCards = mark(okItems);
    if (okItems.length || nCards) {
      cpEvent(opts.event || 'to_approval', names(okItems), { card: cardNames || undefined, folder: CPDisk.showPath(base), note: opts.note || undefined });
      if (typeof cpReviewPresentStage === 'function') cpReviewPresentStage('approval', shoot.name, base);
    }
    cpAfterStatus();
    if (typeof cbRenderOutline === 'function') cbRenderOutline();
    if (opts.quiet) return;
    if (!okItems.length && !queued && !nCards) { cbToast(already.length || wait ? 'Уже на согласовании' + (wait ? ' (часть ещё копируется)' : '') : 'На согласование не отправлено: этих кадров нет на Диске'); return; }
    cbToast('На согласование в ' + label + ': ' + okItems.length + ' кадр(ов)' + (already.length ? ', уже были ' + already.length : '')
      + (queued ? '. Не скопировалось сразу: ' + queued + ' — копирую повторно, статус появится, когда файлы будут на месте' : ''));
  };
  if (!items.length) { done([], 0); return; }
  _cpApBusy = true;
  cpCopyOnDisk(items.map(cpStageCopyItem), [base], 'Копирую на согласование').then(function (r) {
    cbBusyHide();
    _cpApBusy = false;
    var bad = {};
    (r.failedFrom || []).forEach(function (f) { bad[f] = true; });
    var left = items.filter(function (x) { return bad[x.from]; });
    if (left.length) queue(left, r.failed && r.failed[0]);
    done(items.filter(function (x) { return !bad[x.from]; }), left.length);
  }, function (e) {
    cbBusyHide();
    _cpApBusy = false;
    queue(items, (e && e.message) || '');
    done([], items.length);
  });
}

CPQ.after['ap2'] = function (op, m) {
  m.ap2 = m.ap2 || {};
  Object.keys(op.after.map || {}).forEach(function (from) { var v = op.after.map[from]; m.ap2[v[0]] = v[1]; });
};
CPQ.after['ap2-drop'] = function (op, m) {
  m.ap2 = m.ap2 || {};
  Object.keys(m.ap2).forEach(function (pid) { if ((op.after.paths || []).indexOf(m.ap2[pid]) !== -1) delete m.ap2[pid]; });
};

/* открыли съёмку — то, что уже было на согласовании до этой версии, тоже ляжет в 02 */
CP.openedHooks = CP.openedHooks || [];
CP.openedHooks.push(function () {
  var ready = typeof cpEnsureSettings === 'function' ? cpEnsureSettings() : Promise.resolve();
  ready.then(function () { setTimeout(cpApprovalSoon, 1500); });
});

/* после любой правки отбора — сверить согласование с папкой 02 */
cbMarkDirty = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    if (!_cpApBusy) cpApprovalSoon();
    return r;
  };
})(cbMarkDirty);

/** Съёмка появилась в папке этапа — сразу в фильтре, потом сверка с Диском. */
function cpReviewPresentStage(key, shootName, dir) {
  var low = String(shootName).toLowerCase();
  CP.stagePresence = CP.stagePresence || {};
  CP.stagePaths = CP.stagePaths || {};
  (CP.stagePresence[key] = CP.stagePresence[key] || {})[low] = true;
  var w = CP.stagePaths[key] = CP.stagePaths[key] || {};
  if (!(w[low] || []).some(function (p) { return p === dir; })) w[low] = (w[low] || []).concat([dir]);
  if (typeof cpStageNote === 'function') cpStageNote(key, shootName, dir);
}

/* ---------- ручные фильтры карточек съёмки ---------- */

CP.viewStage = '';

function cpCardOnStage(card, key) {
  var m = cpMeta(), cs = m.cardStatus[card.id] && m.cardStatus[card.id].s, del = (m.delivered || {})[card.id];
  var last = cpLastRv(cpRv()[card.id]), ls = last ? last.status : '';
  if (key === 'approval') return cs === 'approval';
  if (key === 'retouch') return cs === 'retouch' && !del && ls !== 'review' && ls !== 'rework';
  if (key === 'review') return ls === 'review' || ls === 'rework';
  if (key === 'site') return !!del;
  if (key === 'reshoot') return cs === 'reshoot';
  return true;
}

CP.openedHooks = CP.openedHooks || [];
CP.openedHooks.push(function () {
  CP.viewStage = '';
  CP.cardFolders = null;
  CP.showSrc = true;
  var bar = document.getElementById('cpViewBar');
  if (bar) bar.open = false;
  CP.rvOnly = false;
  CP.viewReveal = {};
  cbRenderCards();
});

cbRenderCards = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    if (!CP.shoot) return r;
    var root = document.getElementById('cbCards');
    var bar = document.getElementById('cpViewBar');
    var key = CP.viewStage;
    if (key) Array.prototype.forEach.call(root.querySelectorAll('.cb-card'), function (el) {
      var c = cbCardById(el.getAttribute('data-cid'));
      if (c && !cpCardOnStage(c, key)) el.style.display = 'none';
    });
    if (!bar) {
      bar = document.createElement('details');
      bar.id = 'cpViewBar';
      bar.className = 'cp-viewbar';
      var anchor = document.getElementById('cpRvBar') || root;
      anchor.parentNode.insertBefore(bar, anchor);
      bar.addEventListener('change', function (e) {
        var el = e.target;
        if (el.id === 'cpCardStage') { CP.viewStage = el.value; CP.rvOnly = false; }
        else if (el.id === 'cpRvOnly') { CP.rvOnly = el.checked; CP.viewStage = ''; }
        else if (el.hasAttribute('data-cp-src')) CP.showSrc = !el.checked;
        else if (el.id === 'cpCardFolder') { cpSetCardFolders(el.value ? [el.value] : null); return; }
        else return;
        CP.viewReveal = {};
        cbRenderCards();
        cbRenderOutline();
      });
      bar.addEventListener('click', function (e) {
        if (!e.target.closest('[data-cp-view-all]')) return;
        CP.viewStage = ''; CP.rvOnly = false; CP.showSrc = true; CP.viewReveal = {};
        cpSetCardFolders(null);
      });
    }
    var folders = Object.create(null);
    App.cards.forEach(function (c) { if (c.cpArticleDir) folders[c.cpArticleDir] = true; });
    App.photos.forEach(function (p) { if (p.disk) { var dir = cpRelDir(p); if (dir) folders[dir] = true; } });
    var active = !!(key || CP.rvOnly || (CP.cardFolders && CP.cardFolders.length) || !CP.showSrc);
    bar.innerHTML = '<summary>Фильтр карточек' + (active ? ' · включён' : '') + '</summary><div class="cp-view-controls">'
      + '<label>Этап <select id="cpCardStage"><option value="">Все этапы</option>'
      + [['approval', 'На согласовании'], ['retouch', 'На ретуши'], ['site', 'На сайте'], ['reshoot', 'В браке']].map(function (o) {
        return '<option value="' + o[0] + '"' + (key === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
      }).join('') + '</select></label>'
      + '<label>Папка <select id="cpCardFolder"><option value="">Все папки</option>' + Object.keys(folders).sort().map(function (dir) {
        return '<option value="' + cbEsc(dir) + '"' + (CP.cardFolders && CP.cardFolders.indexOf(dir) !== -1 ? ' selected' : '') + '>' + cbEsc(dir) + '</option>';
      }).join('') + '</select></label>'
      + '<label><input type="checkbox" id="cpRvOnly"' + (CP.rvOnly ? ' checked' : '') + '> Ретушь на проверке</label>'
      + '<label><input type="checkbox" data-cp-src' + (CP.showSrc ? '' : ' checked') + '> Только загруженная ретушь</label>'
      + (active ? '<button type="button" data-cp-view-all>Сбросить</button>' : '') + '</div>';
    return r;
  };
})(cbRenderCards);

/* ---------- навигация справа: клик по карточке, которой нет в этом виде ----------
   Ретушёр, 18.11: «если кликать по карточкам „сдано“, то ничего не происходит». Открыто из этапа —
   карточки, которые ушли дальше (сдано, на сайте) или ещё не дошли, в середине скрыты, а в навигации
   остаются: видно, что сделано. Клик по такой — она показывается на своём месте с пометкой, почему
   её обычно здесь нет, и кнопкой «Скрыть». В навигации такие приглушены. То же для галочки
   «Ретушь на проверке». */
CP.viewReveal = {};

function cpCardWhereText(card) {
  var m = cpMeta(), id = card.id, del = (m.delivered || {})[id];
  if (del) return 'сдано' + (del.letter ? ' · ' + del.letter : '') + (del.date ? ' · ' + del.date : '');
  var last = cpLastRv(cpRv()[id]);
  if (last) return last.status === 'review' ? 'ретушь на проверке' : last.status === 'rework' ? 'на доработке' : 'на сайте';
  var cs = m.cardStatus[id] && m.cardStatus[id].s;
  return cs === 'retouch' ? 'на ретуши' : cs === 'approval' ? 'на согласовании' : cs === 'reshoot' ? 'в браке' : 'без статуса';
}

/* почему карточка скрыта в этом виде ('' — не скрыта) */
function cpCardHiddenWhy(card) {
  if (!card || !CP.shoot) return '';
  if (CP.viewStage && !cpCardOnStage(card, CP.viewStage)) return 'сейчас не в «' + cpStageLabel(CP.viewStage) + '»: ' + cpCardWhereText(card);
  if (CP.rvOnly) {
    var list = cpRv()[card.id], ls = list && list.length ? list[list.length - 1].status : '';
    if (ls !== 'review' && ls !== 'rework') return 'не на проверке (включено «Ретушь на проверке»): ' + cpCardWhereText(card);
  }
  return '';
}

cbRenderCards = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    var root = document.getElementById('cbCards');
    if (!CP.shoot || !root) return r;
    Array.prototype.forEach.call(root.querySelectorAll('.cb-card'), function (el) {
      var id = el.getAttribute('data-cid'), card = cbCardById(id);
      var why = CP.viewReveal[id] && card && cpCardMatchesFolders(card) ? cpCardHiddenWhy(card) : '';
      var note = el.querySelector(':scope > .cp-reveal-note');
      el.classList.toggle('cp-revealed', !!why);
      if (!why) { if (note) note.remove(); return; }
      el.style.display = '';
      var html = '<span>Обычно здесь не видна — ' + cbEsc(why) + '. Показана по клику в навигации.</span>'
        + '<button data-cp-unreveal="' + cbEsc(id) + '">Скрыть</button>';
      if (note) note.innerHTML = html;
      else el.insertAdjacentHTML('afterbegin', '<div class="cp-reveal-note">' + html + '</div>');
    });
    return r;
  };
})(cbRenderCards);

document.getElementById('cbCards').addEventListener('click', function (e) {
  var b = e.target.closest('[data-cp-unreveal]');
  if (!b) return;
  e.preventDefault();
  delete CP.viewReveal[b.getAttribute('data-cp-unreveal')];
  cbRenderCards();
});

cbRenderOutline = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    var host = document.getElementById('cbOutline');
    if (!CP.shoot || !host || App.activeTab === 'conts') return r;
    var nOff = 0;
    Array.prototype.forEach.call(host.querySelectorAll('.cp-oi'), function (row) {
      var btn = row.querySelector('.cb-outline-item'), id = btn && btn.getAttribute('data-target'), card = id ? cbCardById(id) : null;
      if (!card) return;
      var why = cpCardHiddenWhy(card), off = !!why && !CP.viewReveal[id];
      row.classList.toggle('cp-oi-off', off);
      if (off && row.style.display !== 'none') nOff++;
      btn.title = (card.title || '') + (why ? ' — ' + why + (off ? '. В этом виде скрыта: клик — показать карточку' : '. Показана по клику') : '');
    });
    var hint = host.querySelector('.cp-oi-hint');
    if (!nOff) { if (hint) hint.remove(); return r; }
    var txt = 'Приглушены карточки, которых сейчас нет ' + (CP.viewStage ? 'в «' + cpStageLabel(CP.viewStage) + '»' : 'среди «на проверке»') + ' (' + nOff + '): клик — показать';
    if (!hint) {
      var title = host.querySelector('.cb-outline-title');
      hint = document.createElement('div');
      hint.className = 'cp-oi-hint';
      if (title) title.parentNode.insertBefore(hint, title.nextSibling); else host.insertBefore(hint, host.firstChild);
    }
    hint.textContent = txt;
    return r;
  };
})(cbRenderOutline);

/* клик в навигации: скрытую — показать; найденную — подсветить на секунду */
document.getElementById('cbOutline').addEventListener('click', function (e) {
  var btn = e.target.closest('.cb-outline-item');
  if (!btn || !CP.shoot || App.activeTab === 'conts') return;
  var id = btn.getAttribute('data-target'), card = cbCardById(id);
  if (!card) return;
  if (!CP.viewReveal[id] && cpCardHiddenWhy(card)) {
    CP.viewReveal[id] = true;
    cbRenderCards();
  }
  setTimeout(function () {
    var el = document.querySelector('#cbCards .cb-card[data-cid="' + id + '"]');
    if (!el) return;
    el.classList.remove('cp-flash');
    void el.offsetWidth;
    el.classList.add('cp-flash');
    setTimeout(function () { el.classList.remove('cp-flash'); }, 1400);
  }, 0);
}, true);

/* ---------- панель съёмки в фильтре этапа: что лежит в папке этапа сейчас ----------
   Маша, 06.11: «в боковой менюшке отображается всё, что есть в исходниках, а не
   то, что есть в той папке, которую я открыла на этапе сайт или ретушь. Должна
   отображаться та структура, которая там прямо сейчас лежит, чтобы быстро
   посмотреть и понять, что там есть». */

cpSelectShoot = (function (orig) {
  return function (path, name, modified) {
    var key = CP.stageFilter;
    var paths = key && typeof CP_STAGE_SETTING !== 'undefined' && CP_STAGE_SETTING[key] && CP.stagePaths && CP.stagePaths[key]
      ? CP.stagePaths[key][String(name).toLowerCase()] : null;
    if (!paths || !paths.length) return orig.apply(this, arguments);
    /* Панель и архив скачивания используют только папки выбранного этапа. */
    CP.sel = { path: path, name: name, modified: modified, stage: key, stagePaths: paths.slice(), loading: true, open: {}, folders: {}, files: [], dirs: [],
      media: '', brak: '' };
    cpMarkSelected();
    cpRenderPanel();
    var sel = CP.sel;
    sel.stageTags = {};
    var repaint = false;
    sel.stageFolderPreview = [];
    var walk = function (p) {
      var preview = { root: p, files: [], dirs: [] };
      var onDirs = key === 'retouch' ? function (dirs) {
        if (CP.sel !== sel) return;
        if (!preview.dirs.length) sel.stageFolderPreview.push(preview);
        preview.dirs = preview.dirs.concat(dirs);
        if (repaint) return;
        repaint = true;
        requestAnimationFrame(function () {
          repaint = false;
          if (CP.sel === sel && sel.loading) cpRenderPanel();
        });
      } : null;
      return CPDisk.walkPhotos(p, false, 4, true, null, onDirs).then(function (files) { return { root: p, files: files, dirs: files.dirs || [] }; },
        function (e) { return { root: p, files: [], dirs: preview.dirs, error: e }; });
    };
    Promise.all([
      Promise.all(sel.stagePaths.map(walk)),
      /* отбор съёмки — чьи это карточки (теги ретушёров и прочие) */
      CPDisk.readState(path).then(function (st) { return st.data; }, function () { return null; }),
      cpLoadDict().catch(function () { return null; })
    ]).then(function (r) {
      if (CP.sel !== sel) return;
      sel.stageFiles = r[0];
      sel.data = r[1];
      sel.loading = false;
      cpStageTagIndex(sel);
      cpRenderPanel();
    });
  };
})(cpSelectShoot);

/* Теги в папке этапа (Маша, 08.11: «в ретуши — сверху теги, которые есть: тыкнуть тег и
   скачать по тегу; проставлено моё имя — скачала с именем, или всё, что без имени»).
   У каждого файла этапа — теги его карточки (по кадру отбора: путь внутри съёмки или имя)
   и буква ретушёра из имени папки («Y_74595_…»); ещё — кадр, карточка, брак. */
var CP_NO_RT = '__без_ретушёра__';

/* ---------- папка ретуши: кто скачал ----------
   Маша, 10.11.2026: «из папки ретушь нельзя скачать, не поставив галку тега — иначе непонятно,
   кто скачал, кто забрал и что вообще произошло»; «скачанное не показываем в том, что можно
   забрать, — фильтр сверху «показать скачанное»: один ретушёр скачал, но заболел, не отдал —
   чтобы другой мог скачать с переменой буквы; а когда ретушёр идёт за тем, что ещё не скачивали,
   лишнего шума нет»; «галка внизу перед кнопкой «Скачать» — скачать уже скачанные: потерял
   файлы — загрузил ещё раз, но чтобы случайно не взял то, что уже скачал, и не делал дважды».
   В панели съёмки в фильтре папки ретуши:
     - сверху «Кто скачивает» — буквы ретушёров из словаря; без буквы кнопка «Скачать» не
       работает (букв в словаре нет — правило не действует, скачивается как раньше);
     - скачали — каждому файлу в отборе съёмки пишется запись «скачано» (meta.cp.rtdl: буква,
       кто, когда, какой архив, сколько раз), карточкам этих файлов ставится буква ретушёра,
       в журнал — событие. Папки на Диске программа не переименовывает;
     - скачанное и забранное (буква в имени папки — «Y_74595_…») в списке и в счётчиках не
       показывается, пока не отмечено «показать скачанное»;
     - даже показанное скачанное в архив не попадает, пока не отмечено «и уже скачанные»;
       скачали с другой буквой — запись и буква карточки меняются на новую. */

/** Ключ файла этапа: путь внутри папки съёмки на этапе без буквы ретушёра и «_доработка» в
    именах папок, строчными. -> {key, letter, segs, name} */
function cpStageKey(rel, letters) {
  var segs = String(rel || '').split('/'), name = segs.pop(), letter = '';
  segs = segs.map(function (sg) {
    var sp = cpLetterSplit(sg, letters);
    if (sp) { letter = sp.letter; return sp.rest; }
    return sg.replace(/_доработка$/i, '');
  });
  return { key: segs.concat([name]).join('/').toLowerCase(), letter: letter, segs: segs, name: name };
}

/* Запись «скачано» относится к тому файлу, который скачали: копию из папки ретуши могли убрать
   (артикул сдан — в Корзину) и позже положить заново — это уже другой файл с тем же путём, и он
   снова «не скачан». Различаем по номеру файла на Диске (resource_id; у копии он новый). */
function cpRidShort(f) { var r = String((f && f.resource_id) || ''); return r ? r.slice(-16) : ''; }

/** Файл папки ретуши уже скачан (запись в отборе) или забран (буква в имени папки). */
/* Буква в имени папки (Y_74595_модель) — с 2.0.111 это «назначено ретушёру», программа сама подписывает
   папку, когда карточке ставят букву. Скачанным это не считается: такая папка видна всем, пока буква
   не выбрана, и своему ретушёру; прячется только у другого ретушёра. Скачанное — по записи «скачано». */
function cpStageTook(sel, f) {
  var tk = f.cpTook;
  if (tk && tk.folder && (!sel.who || tk.l === sel.who)) return f.cpDone ? { l: '', done: true } : null;   /* сданное (дошло до 04 / сайта) прячем всегда */
  return tk || null;
}
function cpStageTaken(sel, f) { return sel.stage === 'retouch' && !!cpStageTook(sel, f); }
/** Все файлы видны, пока пользователь не включил фильтр. */
function cpStageShown(sel, f) { return !cpStageTaken(sel, f) || !sel.hideTaken; }

function cpStageTagIndex(sel) {
  var data = sel.data || {}, photos = data.photos || [], cards = data.cards || [];
  var m = (data.meta && data.meta.cp) || {}, status = m.status || {}, cst = m.cardStatus || {};
  var src = String(sel.path || '').replace(/\/+$/, '') + '/';
  var letters = typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
  var byRel = {}, byStem = {}, tagsOf = {}, cardOf = {}, cardsByCode = Object.create(null), cardsById = Object.create(null);
  photos.forEach(function (p) {
    if (!p.disk) return;
    var rel = p.disk.indexOf(src) === 0 ? p.disk.slice(src.length) : p.name;
    byRel[rel.toLowerCase()] = p.id;
    var st = cpStem(p.name || rel.split('/').pop());
    (byStem[st] = byStem[st] || []).push(p.id);
  });
  cards.forEach(function (c) {
    cardsById[c.id] = c;
    String(c.cpArticle || cpArtCode(null, c.title) || '').split(/,\s*/).filter(Boolean).forEach(function (code) {
      (cardsByCode[code] = cardsByCode[code] || []).push(c.id);
    });
    var pids = c.mode === 'auto' ? (c.pids || []) : (c.slots || []).map(function (x) { return x.pid; }).filter(Boolean);
    pids.forEach(function (pid) {
      (tagsOf[pid] = tagsOf[pid] || {}); (c.tags || []).forEach(function (t) { tagsOf[pid][t] = true; });
      (cardOf[pid] = cardOf[pid] || []).push(c.id);   /* у артикула бывает две карточки */
    });
  });
  var rtdl = sel.stage === 'retouch' ? (m.rtdl || {}) : null;
  /* сдано: у карточки есть загруженная ретушь или она на сайте (отметки отбора), либо папка этого
     артикула уже лежит в 04 / на сайте (по папкам) — забирать такое из ретуши незачем */
  var delivered = m.delivered || {}, low = String(sel.name || '').toLowerCase(), doneCodes = {};
  if (rtdl && typeof cpArtsAhead === 'function' && CP.stageArtsFor === CP.archive) doneCodes = cpArtsAhead(low, 'retouch');
  var stype = typeof cpShootType === 'function' ? cpShootType(sel.name) : null;
  var isDone = function (k, cards) {
    if (cpStageHasRv(sel, cards) || (cards || []).some(function (c) { return delivered[c]; })) return true;
    for (var i = k.segs.length - 1; i >= 0; i--) {
      var code = typeof cpArtCode === 'function' ? cpArtCode(stype, k.segs[i]) : '';
      if (code) return !!doneCodes[code];
    }
    return false;
  };
  var later = CP.stageArtsFor === CP.archive ? CP.stageArts : {};
  var hasStageCode = function (stage, code) {
    return !!code && (((later[stage] || {})[low] || {})[code] !== undefined);
  };
  var index = function (x) {
    x.files.forEach(function (f) {
      var rel = f.path.indexOf(x.root + '/') === 0 ? f.path.slice(x.root.length + 1) : f.name;
      var k = cpStageKey(rel, letters), name = k.name, tags = {};
      if (k.letter) tags[k.letter] = true;
      var pid = byRel[k.key];
      if (!pid) { var c = byStem[cpStem(name)] || []; if (c.length === 1) pid = c[0]; }
      var article = cpRtArtDir(x.root, f.path, letters, stype), code = article && article.code || cpArtCode(stype, name);
      f.cpCards = pid ? cardOf[pid] || [] : cardsByCode[code] || [];
      if (pid && tagsOf[pid]) Object.keys(tagsOf[pid]).forEach(function (t) { tags[t] = true; });
      if (!pid) f.cpCards.forEach(function (id) { (cardsById[id].tags || []).forEach(function (t) { tags[t] = true; }); });
      /* папка ретуши: запись «скачано» из отбора; буква в имени папки — забрали руками на Диске */
      f.cpKey = k.key;
      f.cpTook = null;
      if (rtdl) {
        var rec = rtdl[k.key], rid = cpRidShort(f);
        if (rec && rec.rid && rid && rec.rid !== rid) rec = null;   /* на этом месте лежит уже другая копия */
        f.cpTook = rec || (k.letter ? { l: k.letter, folder: true } : null);
        if (rec && rec.l) tags[rec.l] = true;
        f.cpDone = isDone(k, f.cpCards);
        if (f.cpDone && !f.cpTook) f.cpTook = { l: '', done: true };
      }
      if (letters.length && !Object.keys(tags).some(function (t) { return letters.indexOf(t) !== -1; })) tags[CP_NO_RT] = true;
      f.cpTags = Object.keys(tags);
      f.cpPid = pid || '';
      f.cpStageStatus = '';
      if (sel.stage !== 'site' && (hasStageCode('site', code) || f.cpCards.some(function (id) { return delivered[id]; }))) f.cpStageStatus = 'На сайте';
      else if (sel.stage === 'retouch' && f.cpDone) f.cpStageStatus = 'Отретушировано';
      else if (sel.stage === 'approval' && (hasStageCode('review', code) || cpStageHasRv(sel, f.cpCards))) f.cpStageStatus = 'Отретушировано';
      else if (sel.stage === 'approval' && (hasStageCode('retouch', code) || f.cpCards.some(function (id) { return cst[id] && cst[id].s === 'retouch'; }))) f.cpStageStatus = 'На ретуши';
      f.cpBrak = !!((pid && status[pid] && status[pid].s === 'reshoot') || f.cpCards.some(function (c) { return cst[c] && cst[c].s === 'reshoot'; }));
      if (f.cpBrak) {
        f.cpStageStatus = 'В браке';
        if (rtdl) {
          f.cpDone = true;
          if (!f.cpTook) f.cpTook = { l: '', done: true };
        }
      }
    });
  };
  (sel.stageFiles || []).forEach(index);
}

/** Файл этапа проходит отмеченные теги (отмечено несколько — подходит любой). */
function cpStageTagOk(sel, f) {
  var on = Object.keys(sel.stageTags || {}).filter(function (k) { return sel.stageTags[k]; });
  return !on.length || (f.cpTags || []).some(function (t) { return on.indexOf(t) !== -1; });
}

/** Все фильтры панели этапа: теги, видео, брак; в папке ретуши — без уже скачанного, пока не попросили. */
function cpStageOk(sel, f) {
  if (cpStageTaken(sel, f) && !sel.againTaken) return false;
  if (!cpStageTagOk(sel, f)) return false;
  var v = typeof cpIsVideo === 'function' && cpIsVideo(f.name);
  if (sel.media === 'video' && !v) return false;
  if (sel.media === 'novideo' && v) return false;
  if (sel.brak === 'no' && f.cpBrak) return false;
  if (sel.brak === 'only' && !f.cpBrak) return false;
  return true;
}

/** Пути внутри архива для группы папок этапа: несколько папок («Сайт» по датам) — дата сверху. */
function cpStagePre(sel, groups, x) {
  if (groups.length < 2) return '';
  var stageRoot = String((CP.settings || {})[CP_STAGE_SETTING[sel.stage]] || '').replace(/\/+$/, '');
  var par = cpParentDir(x.root);
  return (par.indexOf(stageRoot + '/') === 0 ? par.slice(stageRoot.length + 1) : par.split('/').pop()) + '/';
}

/** Кадр сдан ретушёром — у его карточки (любой из карточек артикула) есть загруженная версия. */
function cpStageHasRv(sel, cards) {
  var rv = (sel.data && sel.data.meta && sel.data.meta.cp && sel.data.meta.cp.rv) || {};
  return (cards || []).some(function (c) { return rv[c] && rv[c].length; });
}

/* Файлы для скачивания всегда берутся из открытой папки этапа. */
function cpStagePool(sel) {
  var out = [], groups = sel.stageFiles || [];
  groups.forEach(function (x) {
    var pre = cpStagePre(sel, groups, x);
    x.files.forEach(function (f) {
      if (f.name === CPDisk.STATE_FILE || !cpStageShown(sel, f)) return;
      out.push({ f: f, name: pre + (f.path.indexOf(x.root + '/') === 0 ? f.path.slice(x.root.length + 1) : f.name) });
    });
  });
  return out;
}

function cpStageChips(sel) {
  var n = {}, letters = typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
  cpStagePool(sel).forEach(function (x) { (x.f.cpTags || []).forEach(function (t) { n[t] = (n[t] || 0) + 1; }); });
  var keys = Object.keys(n);
  if (!keys.length) return '';
  var order = (CP.dict || []).map(function (d) { return d.tag; });
  keys.sort(function (a, b) {
    var ra = letters.indexOf(a) !== -1 ? 0 : a === CP_NO_RT ? 1 : 2, rb = letters.indexOf(b) !== -1 ? 0 : b === CP_NO_RT ? 1 : 2;
    var ia = order.indexOf(a), ib = order.indexOf(b);
    return ra - rb || (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib) || a.localeCompare(b);
  });
  var any = Object.keys(sel.stageTags || {}).some(function (k) { return sel.stageTags[k]; });
  return '<div class="cp-fchips"><span class="cp-fchips-l">' + (any ? 'Скачать с тегами (любой из отмеченных):' : 'Теги — отметьте, чтобы скачать только их:') + '</span>'
    + keys.map(function (t) {
      return '<button class="cp-fchip' + (sel.stageTags[t] ? ' cp-on' : '') + '" data-cp-stag="' + cbEsc(t) + '">' + cbEsc(t === CP_NO_RT ? 'без ретушёра' : t) + ' <small>' + n[t] + '</small></button>';
    }).join('') + (any ? '<a href="#" data-cp-stag-reset="1">сбросить</a>' : '') + '</div>';
}

/** Папка ретуши: «Кто скачивает» (буква обязательна) и «показать скачанное». */
function cpStageWhoChips(sel, taken) {
  if (sel.stage !== 'retouch') return '';
  var letters = typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
  var h = '';
  if (letters.length) {
    h += '<div class="cp-fchips cp-stg-who"><span class="cp-fchips-l">Кто скачивает — отметьте свою букву' + (sel.who ? ':' : ' (без неё скачать нельзя):') + '</span>'
      + letters.map(function (t) {
        return '<button class="cp-fchip' + (sel.who === t ? ' cp-on' : '') + '" data-cp-swho="' + cbEsc(t) + '">' + cbEsc(t) + '</button>';
      }).join('') + '</div>';
  } else {
    h += '<div class="cp-note cp-warn">Букв ретушёров нет в словаре тегов (группа «[Ретушёры: один]») — скачивание не подписывается буквой.</div>';
  }
  if (taken) {
    h += '<div class="cp-fchips"><label class="cp-stg-ck" title="Что уже скачали, что назначено другому ретушёру (его буква в имени папки) или сдали (ретушь уже в отретушированном или на сайте). Отметьте, чтобы видеть только то, что ещё можно забрать">'
      + '<input type="checkbox" data-cp-staken="1"' + (sel.hideTaken ? ' checked' : '') + '> скрыть скачанное и сданное <small>' + taken + '</small></label></div>';
  }
  return h;
}

/** Охват, видео, брак — над тегами. */
function cpStageScopeChips(sel) {
  var chip = function (attr, key, on, label, n) {
    return '<button class="cp-fchip' + (on ? ' cp-on' : '') + '" ' + attr + '="' + key + '">' + label + (n === undefined ? '' : ' <small>' + n + '</small>') + '</button>';
  };
  var h = '';
  var pool = cpStagePool(sel), nv = 0, nb = 0;
  pool.forEach(function (x) { if (typeof cpIsVideo === 'function' && cpIsVideo(x.f.name)) nv++; if (x.f.cpBrak) nb++; });
  if (nv || sel.media) {
    h += '<div class="cp-fchips"><span class="cp-fchips-l">' + (sel.media ? 'Скачать:' : 'Скачается всё. Или отметьте:') + '</span>'
      + chip('data-cp-smedia', 'video', sel.media === 'video', 'только видео', nv)
      + chip('data-cp-smedia', 'novideo', sel.media === 'novideo', 'без видео', pool.length - nv) + '</div>';
  }
  if (sel.stage === 'review' || nb || sel.brak) {
    h += '<div class="cp-fchips"><span class="cp-fchips-l">Брак:</span>'
      + chip('data-cp-sbrak', 'no', sel.brak === 'no', 'без брака', pool.length - nb)
      + chip('data-cp-sbrak', 'only', sel.brak === 'only', 'только брак', nb) + '</div>';
  }
  return h;
}

document.getElementById('cpPanel').addEventListener('click', function (e) {
  var sel = CP.sel;
  if (!sel || !sel.stage) return;
  var b = e.target.closest('[data-cp-stag]'), r = e.target.closest('[data-cp-stag-reset]');
  var md = e.target.closest('[data-cp-smedia]'), bk = e.target.closest('[data-cp-sbrak]');
  var wh = e.target.closest('[data-cp-swho]');
  if (!b && !r && !md && !bk && !wh) return;
  e.preventDefault();
  if (wh) { var w = wh.getAttribute('data-cp-swho'); sel.who = sel.who === w ? '' : w; }
  else if (r) sel.stageTags = {};
  else if (b) { var t = b.getAttribute('data-cp-stag'); sel.stageTags[t] = !sel.stageTags[t]; }
  else if (md) { var k = md.getAttribute('data-cp-smedia'); sel.media = sel.media === k ? '' : k; }
  else if (bk) { var k2 = bk.getAttribute('data-cp-sbrak'); sel.brak = sel.brak === k2 ? '' : k2; }
  cpRenderPanel();
});

/* Видимость в списке и состав архива настраиваются отдельно. */
document.getElementById('cpPanel').addEventListener('change', function (e) {
  var sel = CP.sel;
  if (!sel || sel.stage !== 'retouch') return;
  var tk = e.target.closest('[data-cp-staken]'), ag = e.target.closest('[data-cp-sagain]');
  if (!tk && !ag) return;
  if (tk) { sel.hideTaken = tk.checked; if (tk.checked) sel.againTaken = false; }
  else { sel.againTaken = ag.checked; if (ag.checked) sel.hideTaken = false; }   /* что скачается повторно — должно быть видно */
  cpRenderPanel();
});

(function cpStageRtCss() {
  var st = document.createElement('style');
  st.textContent = '.cp-stg-ck{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#cfcac2;cursor:pointer}'
    + '.cp-stg-ck small{color:#8a877f}.cp-stg-ck input{accent-color:#C9956B}'
    + '.cp-panel-actions .cp-stg-again{order:5;margin-left:auto}.cp-panel-actions .cp-stg-again + .cb-primary{margin-left:0}'
    + '.cp-stg-who .cp-fchip{min-width:34px;font-weight:600}';
  document.head.appendChild(st);
})();

(function cpStageChipCss() {
  if (document.getElementById('cpStageChipCss') || document.getElementById('cpMediaChipCss')) return;
  var st = document.createElement('style');
  st.id = 'cpStageChipCss';
  st.textContent = '.cp-fchips{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:0 0 14px;padding-bottom:12px;border-bottom:1px solid #2a2a28}'
    + '.cp-fchips-l{font-size:12px;color:#a3a09a;width:100%}'
    + '.cp-fchip{font:inherit;font-size:12px;padding:3px 9px;border-radius:12px;border:1px solid #3a3a37;background:transparent;color:#cfcac2;cursor:pointer}'
    + '.cp-fchip small{color:#8a877f;margin-left:2px}'
    + '.cp-fchip.cp-on{border-color:#C9956B;background:#2b231c;color:#f2e2cf}.cp-fchip.cp-on small{color:#e7c9a8}'
    + '.cp-fchips a{font-size:12px;color:#C9956B}';
  document.head.appendChild(st);
})();

/** Дерево папки этапа: {kids: {путь: [дети]}, agg: {путь: {n, bytes}}, files, bytes}. */
function cpStageTree(sel) {
  var stageRoot = String((CP.settings || {})[CP_STAGE_SETTING[sel.stage]] || '').replace(/\/+$/, '');
  var all = {}, agg = {}, nFiles = 0, bytes = 0;
  var rt = sel.stage === 'retouch', taken = 0;
  var many = sel.stageFiles.length > 1;
  sel.stageFiles.forEach(function (x) {
    /* папка ретуши: папку, где всё уже скачано, не показываем вместе с её файлами */
    var has = {}, vis = {};
    if (rt) {
      x.files.forEach(function (f) {
        if (f.name === CPDisk.STATE_FILE) return;
        var rel0 = f.path.indexOf(x.root + '/') === 0 ? f.path.slice(x.root.length + 1) : f.name;
        var ps = cpParentDir(rel0) ? cpParentDir(rel0).split('/') : [], shown = cpStageShown(sel, f);
        for (var i = 1; i <= ps.length; i++) { var d = ps.slice(0, i).join('/'); has[d] = true; if (shown) vis[d] = true; }
      });
    }
    /* в «Сайте» съёмка лежит в нескольких датах — дата и есть верхний уровень */
    var pre = '';
    if (many) {
      var par = cpParentDir(x.root);
      pre = par.indexOf(stageRoot + '/') === 0 ? par.slice(stageRoot.length + 1) : par.split('/').pop();
    }
    var add = function (rel) {
      var full = pre ? (rel ? pre + '/' + rel : pre) : rel;
      if (!full) return '';
      var parts = full.split('/');
      for (var i = 1; i <= parts.length; i++) all[parts.slice(0, i).join('/')] = true;
      return full;
    };
    if (pre) add('');
    x.dirs.forEach(function (d) {
      if (d.indexOf(x.root + '/') !== 0) return;
      var r = d.slice(x.root.length + 1);
      if (rt && has[r] && !vis[r]) return;
      add(r);
    });
    x.files.forEach(function (f) {
      if (f.name === CPDisk.STATE_FILE) return;
      var rel = f.path.indexOf(x.root + '/') === 0 ? f.path.slice(x.root.length + 1) : f.name;
      var tk = rt ? cpStageTook(sel, f) : null, hide = !!tk && sel.hideTaken;
      if (tk) taken++;
      var dir = hide ? (pre ? pre + (cpParentDir(rel) ? '/' + cpParentDir(rel) : '') : cpParentDir(rel)) : (add(cpParentDir(rel)) || '');
      if (!hide) { nFiles++; bytes += f.size || 0; }
      var parts = dir ? dir.split('/') : [];
      for (var i = 0; i <= parts.length; i++) {
        var k = parts.slice(0, i).join('/');
        var a = agg[k] || (agg[k] = { n: 0, bytes: 0 });
        if (hide) { a.hid = (a.hid || 0) + 1; continue; }
        a.n++; a.bytes += f.size || 0;
        /* запись «скачано» из отбора: кто (буква) и когда — в отметку у папки */
        if (f.cpStageStatus) {
          var byStage = a.byStage = a.byStage || {};
          byStage[f.cpStageStatus] = (byStage[f.cpStageStatus] || 0) + 1;
        }
        if (tk && !tk.folder && !tk.done) {
          a.dl = (a.dl || 0) + 1;
          a.dlBy = a.dlBy || {};
          a.dlBy[tk.l || tk.by || '?'] = true;
          if (!a.dlTs || (tk.ts || '') > a.dlTs) a.dlTs = tk.ts || '';
        }
      }
    });
  });
  var kids = {};
  Object.keys(all).forEach(function (r) {
    var par = r.indexOf('/') === -1 ? '' : r.slice(0, r.lastIndexOf('/'));
    (kids[par] = kids[par] || []).push(r);
  });
  Object.keys(kids).forEach(function (k) { kids[k].sort(function (a, b) { return a.split('/').pop().localeCompare(b.split('/').pop(), undefined, { numeric: true }); }); });
  return { kids: kids, agg: agg, files: nFiles, bytes: bytes, taken: taken };
}

cpRenderPanel = (function (orig) {
  return function () {
    var sel = CP.sel;
    if (!sel || !sel.stage) return orig.apply(this, arguments);
    var panel = document.getElementById('cpPanel');
    panel.classList.add('cp-open');
    var label = cpStageLabel(sel.stage);
    var head = '<div class="cp-panel-head"><div><b>' + cbEsc(sel.name) + '</b><small>в папке ' + cbEsc(label) + ' — что лежит там сейчас</small></div>'
      + '<span class="cp-sp"></span><button data-cp-p="close" title="Закрыть панель">×</button></div>';
    var acts = '<button data-cp-p="open">Открыть</button>' + (sel.stage === 'review' ? '<button data-cp-accept title="Загрузить готовую ретушь">Сдать</button>' : '');
    if (sel.loading) {
      var preview = (sel.stageFolderPreview || []).map(function (x) {
        return x.dirs.map(function (d) { return d.slice(x.root.length + 1); }).sort(function (a, b) { return a.localeCompare(b, undefined, { numeric: true }); })
          .map(function (d) { return '<div class="cp-fold">' + cbEsc(d) + '</div>'; }).join('');
      }).join('');
      panel.innerHTML = head + '<div class="cp-panel-body"><div class="cp-note">Читаю папку ' + cbEsc(label) + '…</div>' + preview
        + '</div><div class="cp-panel-actions"><div class="cp-sum"></div>' + acts + '</div>';
      return;
    }
    var t = cpStageTree(sel);
    var picked = 0, pickedBytes = 0, anyTag = Object.keys(sel.stageTags || {}).some(function (k) { return sel.stageTags[k]; });
    var narrowed = anyTag || sel.media || sel.brak;
    cpStagePool(sel).forEach(function (x) { if (cpStageOk(sel, x.f)) { picked++; pickedBytes += x.f.size || 0; } });
    var rt = sel.stage === 'retouch', rtLetters = rt && typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
    if (rt && sel.who && rtLetters.indexOf(sel.who) === -1) sel.who = '';
    var needWho = rt && rtLetters.length > 0 && !sel.who;
    var body = cpStageWhoChips(sel, t.taken) + cpStageScopeChips(sel) + cpStageChips(sel) + '<div class="cp-fold cp-fold-all"><span class="cp-fold-name">' + cbEsc(label) + ' <small>· файлов ' + t.files + ' · ' + cpMb(t.bytes) + '</small></span></div>';
    var top = t.kids[''] || [];
    var errs = sel.stageFiles.filter(function (x) { return x.error; });
    if (!top.length && !errs.length) body += '<div class="cp-note">' + (t.files ? 'Вложенных папок нет — файлы лежат прямо в папке съёмки.'
      : rt && t.taken ? 'Забирать нечего: всё, что здесь лежит, уже скачано или сдано. Снимите фильтр «скрыть скачанное и сданное», чтобы увидеть все папки.' : 'Папка пустая.') + '</div>';
    var letters = typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
    if (top.length === 1 && sel.open[top[0]] === undefined) sel.open[top[0]] = true;   /* одна папка — сразу раскрыта */
    var row = function (fp, depth) {
      var ch = t.kids[fp] || [], open = !!(sel.open && sel.open[fp]);
      var a = t.agg[fp] || { n: 0, bytes: 0 };
      var nm = fp.split('/').pop(), marks = '';
      var lm = cpLetterSplit(nm, letters);
      if (lm) marks += '<span class="cp-state cp-state-retouch">забрал ' + cbEsc(lm.letter) + '</span>';
      if (/_доработка$/i.test(nm)) marks += '<span class="cp-state cp-state-reshoot">на доработке</span>';
      if (rt && a.dl) {
        marks += '<span class="cp-state cp-state-dl" title="Скачано из папки ретуши' + (a.dlTs ? ': ' + cbEsc(cpFmtDate(a.dlTs)) : '') + '">'
          + (a.dl >= a.n ? 'скачано' : 'скачано ' + a.dl + ' из ' + a.n) + ': ' + cbEsc(Object.keys(a.dlBy || {}).join(', '))
          + (a.dlTs ? ' · ' + cbEsc(cpFmtDate(a.dlTs).slice(0, 5)) : '') + '</span>';
      }
      Object.keys(a.byStage || {}).forEach(function (stage) {
        marks += '<span class="cp-state cp-state-dl">' + cbEsc(stage) + (a.byStage[stage] === a.n ? '' : ' · ' + a.byStage[stage] + ' из ' + a.n) + '</span>';
      });
      if (rt && a.hid) marks += '<span class="cp-state" title="В этой папке есть файлы, которые уже скачали или сдали, — они скрыты">уже скачано или сдано: ' + a.hid + '</span>';
      body += '<div class="cp-fold' + (depth ? ' cp-fold-sub' : '') + '" style="padding-left:' + (depth * 18) + 'px"><span>' + cbEsc(nm)
        + ' <small>· ' + a.n + (a.bytes ? ' · ' + cpMb(a.bytes) : '') + '</small></span>'
        + (ch.length ? '<button class="cp-fold-exp" data-cp-exp="' + cbEsc(fp) + '">' + (open ? 'свернуть' : 'папок: ' + ch.length) + '</button>' : '')
        + '<span class="cp-fold-props">' + marks + '</span></div>';
      if (open) ch.forEach(function (c) { row(c, depth + 1); });
    };
    top.forEach(function (fp) { row(fp, 0); });
    if (errs.length) body += '<div class="cp-note cp-warn">Не прочиталось: ' + errs.map(function (x) { return cbEsc(CPDisk.showPath(x.root)); }).join(', ') + '</div>';
    body += '<div class="cp-note">' + sel.stagePaths.map(function (p) { return cbEsc(CPDisk.showPath(p)); }).join('<br>') + '</div>';
    panel.setAttribute('data-path', sel.path);
    var hidden = rt && sel.hideTaken ? t.taken : 0;
    var sum = (rt && sel.hideTaken ? 'Можно забрать' : 'Здесь файлов') + ': <b>' + t.files + '</b> · ' + cpMb(t.bytes)
      + (hidden ? ' · уже скачано или сдано (скрыто): ' + hidden : '')
      + (narrowed || (rt && !sel.hideTaken && t.taken) ? ' · к скачиванию: <b>' + picked + '</b> · ' + cpMb(pickedBytes) : '');
    /* перед кнопкой «Скачать»: взять и то, что уже скачивали (потерял файлы, забирает другой ретушёр) */
    var again = rt && t.taken ? '<label class="cp-stg-ck cp-stg-again" title="Без галки уже скачанное в архив не попадёт — чтобы не взять в работу второй раз. '
      + 'С галкой — попадёт (и сданное тоже); скачали с другой буквой — артикул переходит к ней"><input type="checkbox" data-cp-sagain="1"' + (sel.againTaken ? ' checked' : '') + '> и уже скачанные <small>' + t.taken + '</small></label>' : '';
    var btn = needWho ? 'Отметьте свою букву — без неё не скачать'
      : (rt && sel.who ? (anyTag ? 'Скачать по тегам как ' : 'Скачать как ') + cbEsc(sel.who)
        : anyTag ? 'Скачать по тегам' : 'Скачать всё из ' + cbEsc(label)) + ' · ' + picked;
    panel.innerHTML = head + '<div class="cp-panel-body">' + body + '</div><div class="cp-panel-actions"><div class="cp-sum">' + sum + '</div>'
      + acts + again + '<button class="cb-primary" data-cp-stdl="1"' + (picked && !needWho ? '' : ' disabled') + '>' + btn + '</button></div>';
  };
})(cpRenderPanel);

/* В архиве папка артикула подписана той же буквой, что и копия в 03. */
function cpStageZipName(groups, entry, who, letters, type) {
  if (!who) return entry.name;
  var group = groups.filter(function (x) { return entry.f.path.indexOf(x.root + '/') === 0; })[0];
  var article = group && cpRtArtDir(group.root, entry.f.path, letters, type);
  if (!article) return entry.name;
  var tail = cpFolderBase(article.path) + entry.f.path.slice(article.path.length);
  return entry.name.slice(-tail.length) === tail
    ? entry.name.slice(0, -tail.length) + who + '_' + article.bare + entry.f.path.slice(article.path.length)
    : entry.name;
}

/* «Скачать отсюда»: что выбрано в панели этапа, одним архивом со структурой */
document.getElementById('cpPanel').addEventListener('click', function (e) {
  if (!e.target.closest('[data-cp-stdl]') || !CP.sel || !CP.sel.stage || !CP.sel.stageFiles) return;
  e.preventDefault();
  var sel = CP.sel;
  cpDownloadStageFiles(sel, cpStagePool(sel).filter(function (x) { return cpStageOk(sel, x.f); }));
});

function cpDownloadStageFiles(sel, selected) {
  var entries = [], got = [];
  var rt = sel.stage === 'retouch', who = rt ? (sel.who || '') : '';
  if (rt && !who && typeof cpRetoucherTags === 'function' && cpRetoucherTags().length) { cbToast('Отметьте вверху свою букву — без неё из папки ретуши не скачать'); return; }
  var names = Object.create(null), letters = who ? cpRetoucherTags() : [], type = who ? cpShootType(sel.name) : null;
  var archiveNames = selected.map(function (x) {
    var name = cpStageZipName(sel.stageFiles, x, who, letters, type);
    names[name] = (names[name] || 0) + 1;
    return name;
  });
  selected.forEach(function (x, i) {
    var name = archiveNames[i];
    entries.push({ from: x.f.path, size: x.f.size, name: names[name] === 1 ? name : x.name });
    got.push(x.f);
  });
  if (!entries.length) { cbToast('Нечего скачивать'); return; }
  var name = CPDisk.safeName(sel.name);
  return cpExportBundle(name, entries, cpStageLabel(sel.stage) + ': файлов ' + entries.length + '.' + (rt ? ' После скачивания файлы отмечаются как скачанные' + (who ? ' (' + who + ')' : '') + '.' : ''))
    .then(function (r) {
      if (rt) return cpStageMarkTaken(sel, got.filter(function (f) { return r.included.has(f.path); }), who, name, r);
    })
    .catch(function (err) { cpHandleError(err, 'Скачивание'); });
}

/** Скачали из папки ретуши: запись у каждого файла, буква — карточкам, событие в журнал. */
function cpStageMarkTaken(sel, files, who, name, r) {
  if (!files.length) return Promise.resolve();
  var letters = typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
  var actor = cpActor(), now = new Date().toISOString();
  var again = files.filter(function (f) { return cpStageTook(sel, f); }).length;
  /* записи о файлах, которых в папке ретуши давно нет (старше 30 дней), убираем — чтобы отбор не рос */
  var live = {}, whole = !(sel.stageFiles || []).some(function (x) { return x.error; });
  (sel.stageFiles || []).forEach(function (x) { x.files.forEach(function (f) { if (f.cpKey) live[f.cpKey] = true; }); });
  var old = new Date(Date.now() - 30 * 86400000).toISOString();
  return cpMutateState(sel, function (d) {
    var m = d.meta.cp, map = m.rtdl = m.rtdl || {};
    if (whole) Object.keys(map).forEach(function (k) { if (!live[k] && (map[k].ts || '') < old) delete map[k]; });
    var cardIds = {};
    files.forEach(function (f) {
      var cur = map[f.cpKey], rid = cpRidShort(f);
      if (cur && cur.rid && rid && cur.rid !== rid) cur = null;   /* прежняя запись — о другой копии */
      var rec = { l: who, by: actor, ts: now, export: name, n: (cur && cur.n ? cur.n : 0) + 1 };
      if (rid) rec.rid = rid;
      map[f.cpKey] = rec;
      (f.cpCards || []).forEach(function (id) { cardIds[id] = true; });
    });
    /* «забрал»: буква ретушёра у карточки; другая буква (забирает второй ретушёр) заменяется */
    var titles = [], moved = [];
    (d.cards || []).forEach(function (c) {
      if (!cardIds[c.id]) return;
      titles.push(c.title || 'карточка');
      if (!who) return;
      var was = (c.tags || []).filter(function (t) { return letters.indexOf(t) !== -1 && t !== who; });
      if (was.length) moved.push((c.title || 'карточка') + ' (' + was.join(', ') + ' → ' + who + ')');
      c.tags = (c.tags || []).filter(function (t) { return letters.indexOf(t) === -1 && t !== who; });
      c.tags.push(who);
    });
    var note = [];
    if (who) note.push('буква ' + who);
    if (again) note.push('повторно: ' + again);
    if (moved.length) note.push('сменили ретушёра: ' + moved.join(', '));
    cpShelfEvent(d, 'download_retouch', { export: name, count: (r && r.files) || files.length, parts: r && r.parts ? r.parts.length : undefined,
      card: titles.length ? titles.join(', ') : undefined, letter: who || undefined, note: note.join(' · ') || undefined });
  }).then(function () {
    /* буква ретушёра — и в имени папки артикула в 03 (K_23466…), чтобы на Диске было видно, кто забрал */
    return (who ? cpRtRenameTaken(sel, files, who) : Promise.resolve(null)).then(function (rn) {
      if (!rn || !rn.ok.length) return rn;
      var confirmed = rn.ok.filter(function (x) { return !rn.bad.some(function (b) { return b.x.code === x.code; }); });
      if (!confirmed.length) return rn;
      return cpMutateState(sel, function (d) {
        var base = d.meta.cp.rtLetter = d.meta.cp.rtLetter || {};
        confirmed.forEach(function (x) {
          if (!base[x.code] || (base[x.code].ts || '') <= now) base[x.code] = { l: x.letter, ts: now };
        });
      }).then(function () { return rn; }, function (e) {
        if (window.console) console.warn('[CP] отметка о букве папки не записалась', e);
        return rn;
      });
    }).then(function (rn) {
      if (CP.sel !== sel) return rn;
      sel.againTaken = false;
      /* пути в 03 поменялись — поправить их в панели на месте (выбранная буква и галки остаются) */
      if (rn && rn.ok.length) rn.ok.forEach(function (x) {
        (sel.stageFiles || []).forEach(function (g) {
          g.files.forEach(function (f) { if (f.path.indexOf(x.from + '/') === 0) f.path = x.to + f.path.slice(x.from.length); });
          (g.dirs || []).forEach(function (d, i) {
            if (typeof d === 'string') { if (d === x.from || d.indexOf(x.from + '/') === 0) g.dirs[i] = x.to + d.slice(x.from.length); }
            else if (d && d.path && (d.path === x.from || d.path.indexOf(x.from + '/') === 0)) { d.path = x.to + d.path.slice(x.from.length); if (d.path === x.to) d.name = x.to.split('/').pop(); }
          });
        });
      });
      cpStageTagIndex(sel);
      cpRenderPanel();
      cbToast('Скачано из папки ретуши: файлов ' + files.length + (who ? ' — отмечено за ' + who : '') + '. В списке осталось то, что ещё не забрали.'
        + (rn && rn.bad.length ? ' Папки в ретуши не переименованы под букву: ' + rn.bad.length + '.' : ''));
      return rn;
    });
  }, function (e) {
    if (window.console) console.error('[CP] отметка «скачано» не записалась', e && (e.body || e.message || e));
    cbToast('Архив собран, но отметка «скачано' + (who ? ' (' + who + ')' : '') + '» не записалась в отбор съёмки — другим эти файлы всё ещё видны как не забранные.');
  });
}

/** Скачали из панели ретуши: папки артикулов этих файлов в 03 — под букву ретушёра (K_23466…). */
function cpRtRenameTaken(sel, files, who) {
  var letters = typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
  if (!who || letters.indexOf(who) === -1 || typeof cpRtArtDir !== 'function') return Promise.resolve(null);
  var stype = typeof cpShootType === 'function' ? cpShootType(sel.name) : null, seen = {}, list = [], aligned = [];
  files.forEach(function (f) {
    var x = (sel.stageFiles || []).filter(function (g) { return f.path.indexOf(g.root + '/') === 0; })[0];
    var d = x ? cpRtArtDir(x.root, f.path, letters, stype) : null;
    if (!d || seen[d.path]) return;
    seen[d.path] = true;
    var change = { code: d.code, from: d.path, to: d.letter === who ? d.path : cpRtDirTarget(d, who), letter: who };
    (d.letter === who ? aligned : list).push(change);
  });
  if (!list.length && !aligned.length) return Promise.resolve(null);
  return cpRtMove(list).then(function (r) {
    r.ok = r.ok.concat(aligned);
    if (r.bad.length && window.console) console.warn('[CP] буква ретушёра: папки в 03 не переименованы', r.bad);
    return r;
  }, function (e) { if (window.console) console.warn('[CP] буква ретушёра', e); return null; });
}

/* ---------- витрина, фильтр «отретушировано»: перетащить папку как на Диск ---------- */

/** Съёмка по имени перетащенной папки: «<съёмка>», «<съёмка>_Y_1», «<съёмка>_отбор_2». */
function cpShootByFolder(top) {
  var norm = function (s) { return String(s || '').normalize('NFC').trim().toLowerCase(); };
  var full = norm(top), bare = full.replace(/^(?:!|\d{1,2})_/, '').replace(/\s*\+\s*$/, '');
  var best = null;
  (CP.shoots || []).forEach(function (d) {
    var n = norm(d.name);
    if ((full === n || full.indexOf(n + '_') === 0 || bare === n || bare.indexOf(n + '_') === 0) && (!best || n.length > norm(best.name).length)) best = d;
  });
  return best;
}

/* Сдача просто папками артикулов (Маша, 10.11.2026: «ретушёр должен мочь загрузить просто
   папками артикулов, без дополнительных данных; программа находит, в какой съёмке есть такой
   артикул — может быть в нескольких — и спрашивает: эту съёмку сдаём, ты — тот ретушёр, который
   забирал? Человек ставит «да» — и подгружается в нужную съёмку»).
   Где искать: артикулы, которые сейчас лежат в папке ретуши или в отретушированном (сверка
   витрины с Диском, CP.stageArts) — то есть в работе. */

/** Коды артикулов из перетащенных папок (буква ретушёра в начале имени не мешает); нет папок — из имён файлов. */
function cpDropCodes(files) {
  var codes = {}, order = [];
  var letters = typeof cpRetoucherTags === 'function' ? cpRetoucherTags() : [];
  var add = function (c) { if (c && !codes[c]) { codes[c] = true; order.push(c); } };
  files.forEach(function (x) {
    var segs = String(x.rel || '').split('/'), name = segs.pop(), got = '';
    for (var i = segs.length - 1; i >= 0 && !got; i--) {
      var sg = segs[i], lm = cpLetterSplit(sg, letters);
      if (lm) sg = lm.rest;
      got = cpArtCode(null, sg);
    }
    if (!got) got = cpFileArticleCode(name, letters);
    add(got);
  });
  return order;
}

/** Съёмки, где эти артикулы сейчас в работе: {codes, list: [{d, hit: [коды], miss: [коды]}]} — лучшая первой. */
function cpShootsByArticles(files) {
  var codes = cpDropCodes(files), list = [];
  if (!codes.length) return { codes: codes, list: list };
  (CP.shoots || []).forEach(function (d) {
    var low = d.name.toLowerCase(), have = {};
    ['retouch', 'review'].forEach(function (key) {
      if (!(CP.stagePresence && CP.stagePresence[key] && CP.stagePresence[key][low])) return;
      var c = ((CP.stageArts || {})[key] || {})[low];
      if (c) Object.keys(c).forEach(function (k) { have[k] = true; });
    });
    var hit = codes.filter(function (c) { return have[c]; });
    if (hit.length) list.push({ d: d, hit: hit, miss: codes.filter(function (c) { return !have[c]; }) });
  });
  list.sort(function (a, b) { return b.hit.length - a.hit.length || (a.d.modified < b.d.modified ? 1 : -1); });
  return { codes: codes, list: list };
}

/** Открыть окно сдачи для найденной съёмки (found — из cpShootsByArticles). */
function cpAcceptOpenFound(found, d, files) {
  cpAcceptOpen(d.path, d.name);
  if (!CP.accept) return;
  CP.accept.found = found;
  CP.accept.foundFiles = files;
  cpAcceptAdd(files);
}

/* При неоднозначном имени или неизвестном артикуле сохраняем файлы и даём выбрать съёмку. */
function cpAcceptChoose(found, files) {
  var box = document.getElementById('cpAccept');
  if (!box) { box = document.createElement('div'); box.id = 'cpAccept'; box.className = 'cp-files'; document.body.appendChild(box); }
  var list = found.list.slice(), paths = Object.create(null);
  list.forEach(function (x) { paths[x.d.path] = true; });
  var selected = CP.sel && CP.sel.path;
  var all = (CP.shoots || []).slice();
  if (selected) all.sort(function (a, b) { return Number(b.path === selected) - Number(a.path === selected); });
  all.forEach(function (d) {
    if (!paths[d.path]) list.push({ d: d, hit: [], miss: found.codes.slice() });
  });
  if (!list.length) { cbToast('Список съёмок ещё пуст. Обновите витрину и попробуйте снова.'); return; }
  CP.accept = null;
  CP.acceptChoice = { found: found, list: list, files: files };
  var message = found.list.length ? 'Артикулы есть в нескольких съёмках. Выберите нужную.'
    : found.codes.length ? 'Не нашлось съёмки по артикулам ' + found.codes.slice(0, 6).join(', ') + '. Выберите съёмку.'
      : 'По этим файлам нельзя определить съёмку. Выберите её по названию.';
  box.innerHTML = '<div class="cp-files-box"><div class="cp-files-head"><b>Сдать ретушь · выбрать съёмку</b><button data-cp-acc-x="1" title="Закрыть">×</button></div>'
    + '<div class="cp-acc-body"><p>' + cbEsc(message) + '</p><input id="cpAccShootSearch" type="search" placeholder="Название съёмки" aria-label="Название съёмки">'
    + '<div class="cp-acc-shoots">' + list.map(function (x, i) {
      return '<button data-cp-acc-pick="' + i + '"><b>' + cbEsc(x.d.name) + '</b>'
        + (x.hit.length ? '<small>артикулов: ' + x.hit.length + ' из ' + found.codes.length
          + (x.miss.length ? ' · нет: ' + cbEsc(x.miss.slice(0, 6).join(', ')) : '') + '</small>' : '') + '</button>';
    }).join('') + '</div><div id="cpAccNoShoots" hidden>Нет съёмок с таким названием.</div></div></div>';
  box.classList.add('cp-open');
  var search = document.getElementById('cpAccShootSearch');
  search.addEventListener('input', function () {
    var q = search.value.trim().toLowerCase(), count = 0;
    Array.prototype.forEach.call(box.querySelectorAll('[data-cp-acc-pick]'), function (button, i) {
      button.hidden = list[i].d.name.toLowerCase().indexOf(q) === -1;
      if (!button.hidden) count++;
    });
    document.getElementById('cpAccNoShoots').hidden = count > 0;
  });
  search.focus();
}

document.addEventListener('click', function (e) {
  var pick = e.target.closest('[data-cp-acc-pick]'), x = e.target.closest('[data-cp-acc-x]'), sw = e.target.closest('[data-cp-acc-shoot]');
  if (x) { document.getElementById('cpAccept').classList.remove('cp-open'); CP.acceptChoice = null; return; }
  if (pick && CP.acceptChoice) {
    var ch = CP.acceptChoice, it = ch.list[+pick.getAttribute('data-cp-acc-pick')];
    CP.acceptChoice = null;
    if (it && it.hit.length) cpAcceptOpenFound(ch.found, it.d, ch.files);
    else if (it) { cpAcceptOpen(it.d.path, it.d.name); cpAcceptAdd(ch.files); }
    return;
  }
  if (sw && CP.accept && CP.accept.found) {
    e.preventDefault();
    var found = CP.accept.found, files = CP.accept.foundFiles || CP.accept.files, path = sw.getAttribute('data-cp-acc-shoot');
    var to = found.list.filter(function (y) { return y.d.path === path; })[0];
    if (to) cpAcceptOpenFound(found, to.d, files);
  }
});

function cpReviewDrop(files) {
  if (!files.length) return;
  var path = String(files[0].rel || ''), top = path.indexOf('/') === -1 ? '' : path.split('/')[0];
  var named = top && files.every(function (f) { return String(f.rel || '').indexOf(top + '/') === 0; }) ? cpShootByFolder(top) : null;
  if (named) { cpAcceptOpen(named.path, named.name); cpAcceptAdd(files); return; }
  var found = cpShootsByArticles(files);
  if (found.list.length === 1 && !found.list[0].miss.length) cpAcceptOpenFound(found, found.list[0].d, files);
  else cpAcceptChoose(found, files);
}

cpRenderShoots = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    var root = cpReviewRoot(), list = document.getElementById('cpShelfList');
    if (!list || CP.stageFilter !== 'review' || !root || document.getElementById('cpRvDrop')) return r;
    list.insertAdjacentHTML('afterbegin', '<div class="cp-rv-drop" id="cpRvDrop">Перетащите готовую ретушь или '
      + '<label class="cp-acc-pick">выберите папку<input type="file" id="cpRvDropPick" webkitdirectory multiple hidden></label> · '
      + '<label class="cp-acc-pick">выберите файлы<input type="file" id="cpRvFilesPick" multiple hidden></label></div>');
    var z = document.getElementById('cpRvDrop');
    ['cpRvDropPick', 'cpRvFilesPick'].forEach(function (id) {
      var pick = document.getElementById(id);
      pick.onchange = function () {
        cpReviewDrop(Array.prototype.slice.call(pick.files).map(function (f) { return { file: f, rel: f.webkitRelativePath || f.name }; }));
        pick.value = '';
      };
    });
    z.addEventListener('dragover', function (e) { e.preventDefault(); z.classList.add('cp-over'); });
    z.addEventListener('dragleave', function () { z.classList.remove('cp-over'); });
    z.addEventListener('drop', function (e) {
      e.preventDefault();
      z.classList.remove('cp-over');
      cpDropFiles(e.dataTransfer).then(cpReviewDrop);
    });
    return r;
  };
})(cpRenderShoots);

/* ---------- новая версия прямо в карточку ----------
   Маша, 09.11: «если попросили что-то поправить — чтобы можно было прямо в эту карточку
   засунуть: когда отправляется на доработку, появляется кнопка „загрузить“ прямо в карточке,
   ты карточку переделал и эти же фотки туда перетащил, переделанные. Они заменились».
   И: «ретушёр мог догрузить недостающий кадр непосредственно в карточку, перетаскивает».
   Файл с тем же именем (без «01_» и расширения) заменяет старый, новый — добавляется,
   остальные файлы версии остаются. Получается следующая версия «на проверке»; папка
   «_доработка» снова называется как артикул. */

function cpRvCardUpload(id, files) {
  files = (files || []).filter(function (x) { return x && x.file && !CP_JUNK_FILE.test(x.file.name); });
  if (!files.length || !CP.shoot) return Promise.resolve();
  var shoot = CP.shoot;
  return cpRetouchUploadNames(files).then(function (jobs) {
    if (CP.shoot === shoot && jobs.length) return cpRvCardUploadNamed(id, jobs);
  }).catch(function (e) { cpHandleError(e, 'Загрузка в карточку'); });
}

function cpRvCardUploadNamed(id, jobs) {
  var root = cpReviewRoot(), list = cpRv()[id], last = cpLastRv(list);
  if (!root || !last || (last.status !== 'review' && last.status !== 'rework')) { cbToast('Загрузить в карточку можно, когда она на проверке или на доработке'); return Promise.resolve(); }
  var card = cbCardById(id), idx = App.cards.indexOf(card), shoot = { path: CP.shoot.path, name: CP.shoot.name };
  var base = root.replace(/\/+$/, '') + '/' + CPDisk.safeName(shoot.name);
  var from = cpRvDirOf(last) || base + '/' + cpRvDirFor(card, idx);
  var target = from.replace(/_доработка$/i, '');
  /* кто сдаёт: буква этой версии, иначе — кто забирал карточку; с прошлого раза букву не берём */
  var letter = last.letter || (card && typeof cpCardLetter === 'function' ? cpCardLetter(card) : '') || '', wasRework = last.status === 'rework';
  var olds = last.files.map(function (f) { return { path: f.path, name: f.name, size: f.size }; });
  var claimed = new Set();
  jobs.forEach(function (j) {
    var sameName = olds.filter(function (o) { return !claimed.has(o) && o.name.toLowerCase() === j.name.toLowerCase(); });
    var sameStem = olds.filter(function (o) { return !claimed.has(o) && cpStem(o.name) === cpStem(j.name); });
    var replaced = sameName.length === 1 ? sameName[0] : sameStem.length === 1 ? sameStem[0] : null;
    if (replaced) { j.replaces = replaced; claimed.add(replaced); }
  });
  var total = jobs.reduce(function (a, j) { return a + j.file.size; }, 0), loaded = {}, ok = [], failed = [], dir = target;
  var mb = function (b) { return (b / 1048576).toFixed(b < 10485760 ? 1 : 0); };
  var show = function (text, frac) {
    cbBusyShow(text, frac);
    var box = document.querySelector('[data-cp-rvup="' + id + '"] .cp-rv-prog');
    if (box) box.innerHTML = '<div class="cp-acc-bar"><i style="width:' + Math.round(frac * 100) + '%"></i></div><div>' + cbEsc(text) + '</div>';
  };
  var prog = function () {
    var sum = 0;
    Object.keys(loaded).forEach(function (k) { sum += loaded[k]; });
    var frac = total ? sum / total : 0;
    show('Загружаю в карточку: файлов ' + ok.length + ' из ' + jobs.length + ' · ' + mb(sum) + ' из ' + mb(total) + ' МБ (' + Math.round(frac * 100) + '%)', 0.02 + 0.96 * frac);
  };
  show('Готовлю папку карточки...', 0.01);
  /* папка на доработке снова называется как артикул */
  var step = from !== target ? Promise.all([cpArticleMeta(from), cpArticleMeta(target)]).then(function (state) {
    if (state[1]) throw { plain: true, message: 'Рабочая папка уже существует, сверьте съёмку с Диском и повторите' };
    if (state[0]) return cpStageMoveExact(from, target).then(function () { return target; });
    olds = [];
    jobs.forEach(function (job) { job.replaces = null; });
    return CPDisk.ensureDir(target).then(function () { return target; });
  }) : CPDisk.ensureDir(target).then(function () { return target; });
  return step.then(function (d) {
    dir = d;
    olds.forEach(function (o) { if (o.path.indexOf(from + '/') === 0) o.path = dir + o.path.slice(from.length); });
    prog();
    /* метка «загружает программа» (cp-mirror.js) — снимается после записи версии */
    return CPDisk.proxyProps(dir, { cp_up: String(Date.now()) }).catch(function () { });
  }).then(function () {
    return cpPool(jobs, 3, function (j, i) {
      return cpUpSure(dir + '/' + j.name, j.file, true, function (b) { loaded[i] = b; prog(); })
        .then(function () { loaded[i] = j.file.size; ok.push(j); }, function (e) { loaded[i] = j.file.size; failed.push(j.name + ': ' + (e && (e.message || e.status))); })
        .then(prog);
    });
  }).then(function () {
    cbBusyHide();
    if (!ok.length) throw { message: 'ничего не загрузилось: ' + failed.slice(0, 3).join('; '), plain: true };
    var newPaths = {};
    ok.forEach(function (j) { newPaths[(dir + '/' + j.name).toLowerCase()] = true; });
    /* Успешная догрузка заменяет только свой кадр, остальные остаются. */
    var gone = ok.map(function (j) { return j.replaces; }).filter(Boolean);
    var keep = olds.filter(function (o) { return gone.indexOf(o) === -1 && !newPaths[o.path.toLowerCase()]; });
    var trash = gone.filter(function (o) { return !newPaths[o.path.toLowerCase()]; }).map(function (o) { return o.path; });
    var who = cpActor(), now = new Date().toISOString(), row = null;
    var nFiles = keep.concat(ok.map(function (j) { return { path: dir + '/' + j.name, name: j.name, size: j.file.size }; }));
    var kind = wasRework ? 'новая версия после доработки' : 'догрузка в карточку';
    var apply = function (data) {
      var m = data.meta.cp, rv = m.rv = m.rv || {};
      var l2 = rv[id] = rv[id] || [], p2 = cpLastRv(l2);
      if (p2 && p2.status === 'review') p2.status = 'replaced';
      /* догрузка в карточку — тот же дроп, что у версии, в которую грузят (день и номер) */
      var ver = { v: l2.length + 1, batch: cpDropDay(last) + '_' + letter + '_' + (last.n || '1'), letter: letter, n: last.n || '1', dropDate: cpDropDay(last), date: cpToday(), by: who, ts: now,
        files: nFiles, status: 'review', dir: dir, kind: kind, added: ok.length - gone.length, replaced: gone.length };
      /* кадры, которые старший уже отметил «на сайт» и которые не заменяли, второй раз смотреть не нужно */
      var fmOld = (p2 && p2.fm) || (last && last.fm) || {}, fmNew = {};
      keep.forEach(function (o) { if (fmOld[o.name] && fmOld[o.name].s === 'ok') fmNew[o.name] = fmOld[o.name]; });
      if (Object.keys(fmNew).length) ver.fm = fmNew;
      l2.push(ver);
      var c = (data.cards || []).filter(function (x) { return x.id === id; })[0];
      row = cpOutputRow(ver, shoot.name, c, kind + ': заменено ' + gone.length + ', добавлено ' + Math.max(0, ok.length - gone.length));
      (m.events = m.events || []).push({ ts: now, actor: who, action: 'rt_upload_card', items: ok.map(function (j) { return j.name; }),
        card: c ? c.title : id, note: kind + ': файлов ' + ok.length + (failed.length ? ', не загрузилось ' + failed.length : '') });
    };
    var saved;
    if (CP.shoot && CP.shoot.path === shoot.path) {
      apply({ meta: { cp: cpMeta() }, cards: App.cards });
      cbMarkDirty();
      cbRenderCards();
      cbRenderOutline();
      saved = Promise.resolve();
    } else saved = cpMutateState(shoot, apply);
    return saved.then(function () {
      CPDisk.proxyProps(dir, { cp_rt: letter, cp_rt_date: cpToday() }).catch(function () { });
      return Promise.all([row ? cpOutputAppend([row]) : null, trash.length ? CPDisk.trash(trash).catch(function () { }) : null,
        CPDisk.proxyProps(dir, { cp_up: null }).catch(function () { })]);
    }).then(function () {
      cbToast((wasRework ? 'Новая версия загружена' : 'Загружено в карточку') + ': заменено ' + gone.length + ', добавлено ' + Math.max(0, ok.length - gone.length)
        + (failed.length ? ', не загрузилось ' + failed.length : '') + ' — карточка снова на проверке');
      if (failed.length && window.console) console.error('[CP] не загрузилось', failed);
      cpReviewPresent(shoot.name, (cpReviewVersionPath(root, dir) || {}).shoot || base);
    });
  }).catch(function (e) {
    cbBusyHide();
    var box = document.querySelector('[data-cp-rvup="' + id + '"] .cp-rv-prog');
    if (box) box.textContent = '';
    if (e && e.plain) { cbToast('Загрузить в карточку: ' + e.message); return; }
    cpHandleError(e, 'Загрузка в карточку');
  });
}

/* кнопка в карточке — выбор файлов */
document.getElementById('cbCards').addEventListener('click', function (e) {
  var b = e.target.closest('[data-cp-rvpick]');
  if (!b) return;
  e.preventDefault(); e.stopPropagation();
  var inp = b.parentNode.querySelector('[data-cp-rvfile]');
  if (inp) inp.click();
}, true);
document.getElementById('cbCards').addEventListener('change', function (e) {
  var inp = e.target.closest && e.target.closest('[data-cp-rvfile]');
  if (!inp) return;
  var id = inp.getAttribute('data-cp-rvfile');
  var files = Array.prototype.slice.call(inp.files || []).map(function (f) { return { file: f, rel: f.name }; });
  inp.value = '';
  cpRvCardUpload(id, files);
});

/* перетаскивание файлов на карточку на проверке/доработке — в её версию, не в галерею */
function cpRvDropCard(e) {
  var dt = e.dataTransfer;
  if (!dt || !dt.types || Array.prototype.indexOf.call(dt.types, 'Files') === -1) return null;
  var el = e.target.closest && e.target.closest('.cb-card');
  return el && el.querySelector('[data-cp-rvup]') ? el : null;
}
document.getElementById('cbCards').addEventListener('dragover', function (e) {
  var el = cpRvDropCard(e);
  Array.prototype.forEach.call(document.querySelectorAll('.cb-card.cp-rv-over'), function (x) { if (x !== el) x.classList.remove('cp-rv-over'); });
  if (!el) { document.body.classList.remove('cp-rv-dragging'); return; }
  e.preventDefault(); e.stopPropagation();
  el.classList.add('cp-rv-over');
  document.body.classList.add('cp-rv-dragging');
}, true);
document.getElementById('cbCards').addEventListener('dragleave', function (e) {
  var el = e.target.closest && e.target.closest('.cb-card');
  if (el && !(e.relatedTarget && el.contains(e.relatedTarget))) { el.classList.remove('cp-rv-over'); document.body.classList.remove('cp-rv-dragging'); }
}, true);
document.getElementById('cbCards').addEventListener('drop', function (e) {
  var el = cpRvDropCard(e);
  if (!el) return;
  e.preventDefault(); e.stopPropagation();
  el.classList.remove('cp-rv-over');
  document.body.classList.remove('cp-rv-dragging');
  if (typeof dragDepth !== 'undefined') dragDepth = 0;
  document.body.classList.remove('cb-file-drag');
  var id = el.querySelector('[data-cp-rvup]').getAttribute('data-cp-rvup');
  cpDropFiles(e.dataTransfer).then(function (files) { return cpRvCardUpload(id, files); });
}, true);

/* ---------- ручной режим просмотра только загруженной ретуши ---------- */
CP.showSrc = true;
cbRenderCards = (function (orig) {
  return function () {
    var r = orig.apply(this, arguments);
    var root = document.getElementById('cbCards');
    if (!CP.shoot || !root) return r;
    var rv = cpRv(), del = cpMeta().delivered || {};
    Array.prototype.forEach.call(root.querySelectorAll('.cb-card'), function (el) {
      var id = el.getAttribute('data-cid');
      el.classList.toggle('cp-src-hidden', !CP.showSrc);
      if (!CP.showSrc && !cpLastRv(rv[id]) && !el.querySelector('.cp-rv-none')) {
        var head = el.querySelector('.cb-card-head'), d = del[id];
        if (head) head.insertAdjacentHTML('afterend', '<div class="cp-rv-none">Загруженной версии ретуши в отборе нет'
          + (d && d.at ? ' · сдано в ' + cbEsc(d.at) : '') + (CP.showSrc ? '' : ' — исходные кадры скрыты') + '</div>');
      }
    });
    return r;
  };
})(cbRenderCards);

(function cpReviewCss() {
  var st = document.createElement('style');
  st.textContent = '.cp-viewbar{font-size:13px;color:#cfcac2;margin:0 0 10px;padding:8px 10px;border:1px solid #3a3a37;border-radius:4px;background:#1a1a18}'
    + '.cp-viewbar summary{cursor:pointer}.cp-view-controls{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding-top:8px}.cp-view-controls select{max-width:220px}'
    + '.cp-acc-shoots [hidden]{display:none}'
    + '.cp-reveal-note{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:12px;color:#e7c9a8;background:#211c17;border:1px dashed #5a4632;border-radius:4px;padding:6px 10px;margin:0 0 8px}'
    + '.cp-reveal-note button{padding:2px 10px;font-size:12px}'
    + '.cb-card.cp-flash{box-shadow:0 0 0 2px #C9956B;transition:box-shadow .3s}'
    + '.cp-oi-off{opacity:.5}.cp-oi-off:hover{opacity:.85}'
    + '.cp-oi-hint{font-size:10px;line-height:1.4;color:#8c8c8b;padding:0 14px 8px}'
    + '.cp-viewbar b{color:#e7c9a8}'
    + '.cp-acc-prog{font-size:12px;color:#cfcac2;display:flex;flex-direction:column;gap:6px;margin-top:10px}'
    + '.cp-acc-bar{height:8px;background:#232321;border-radius:4px;overflow:hidden}.cp-acc-bar i{display:block;height:100%;background:#C9956B;transition:width .2s}'
    + '.cp-rv-drop{grid-column:1/-1;border:2px dashed #3a3a37;border-radius:6px;padding:22px 16px;text-align:center;color:#a3a09a;font-size:13px;line-height:1.6}'
    + '.cp-rv-drop.cp-over{border-color:#C9956B;color:#e7c9a8;background:#1d1a17}'
    + '.cb-card.cp-src-hidden>.cb-page{display:none}'
    + '.cb-card.cp-src-hidden .cp-rv-t{width:180px;height:180px}'
    + '.cp-rv-none{margin:8px 0;font-size:12px;color:#a3a09a}';
  document.head.appendChild(st);
})();
