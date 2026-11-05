/* ============================================================
   cp-rules.js — правила структуры папок клиента и редактор
   служебных файлов.

   Всё, что зависит от бренда или студии, живёт в простом файле на
   Диске клиента: <_ContentPulse>/структура.txt. Программа только
   читает его:
     - тип съёмки — по слову в названии папки съёмки;
     - роли уровней папок от папки съёмки: лук, бренд, артикул;
     - как взять код артикула из названия папки;
     - ставить ли карточке артикул по кадру из папки артикула;
     - как раскладывать выгрузку: по карточкам или как в папках.
   Нет файла — кладём на Диск образец и работаем по нему; тип не
   распознан — всё работает как раньше.

   Формат (строки «название: значение», # — комментарий):
     [Модельная]
     название содержит: _МОДЕЛЬ
     папки: лук/артикул
     код артикула: цифры 4-7
     артикул карточке: из папки артикула
     выгрузка: по карточкам

   Редактор: кнопка «Файлы настроек» на витрине — словарь тегов,
   структура и настройки правятся прямо со страницы.

   Подключается после cp-shelf.js. Префикс: cp*.
   ============================================================ */

var CP_RULES_FILE = 'структура.txt';

var CP_RULES_TEMPLATE = [
  '# Структура съёмок: как Content Pulse читает папки. Правьте здесь, не в программе.',
  '# Тип съёмки определяется по названию папки съёмки: первый тип сверху,',
  '# у которого совпало слово из «название содержит» (регистр не важен).',
  '#',
  '# папки — роль каждого уровня от папки съёмки вниз: лук, бренд, артикул; * — уровень без роли.',
  '# код артикула — «цифры 4-7»: код = первые 4–7 цифр в названии папки артикула.',
  '# артикул карточке — «из папки артикула»: кадр из папки артикула в карточке ставит ей артикул.',
  '# выгрузка — «по карточкам» (папки карточек) или «как в папках» (исходные папки и имена).',
  '#   Карточка с артикулом ложится в выгрузку папкой артикула с исходным именем (с луком): 1/74595_модель.',
  '# имена в выгрузке — «исходные» или «с номером» (01_, 02_ — порядок кадров в карточке).',
  '',
  '[Модельная]',
  'название содержит: _МОДЕЛЬ',
  'папки: лук/артикул',
  'код артикула: цифры 4-7',
  'артикул карточке: из папки артикула',
  'выгрузка: по карточкам',
  '',
  '[Предметка]',
  'название содержит: _ПРЕДМЕТКА',
  'папки: бренд/артикул',
  'код артикула: цифры 4-7',
  'выгрузка: как в папках',
  '',
  '[Оптика]',
  'название содержит: _ОПТИКА',
  'папки: бренд/артикул',
  'код артикула: цифры 4-7',
  'выгрузка: как в папках',
  ''
].join('\n');

/* ---------- чтение правил ---------- */

function cpParseRules(text) {
  var types = [], cur = null;
  String(text || '').split(/\r?\n/).forEach(function (line) {
    var l = line.replace(/\s+#.*$/, '').trim();
    if (!l || l.charAt(0) === '#') return;
    var h = /^\[(.+)\]$/.exec(l);
    if (h) {
      cur = { name: h[1].trim(), match: [], roles: [], codeRe: /^(\d{4,7})(?!\d)/, cardArticle: false, exportMode: 'cards' };
      types.push(cur);
      return;
    }
    var m = /^([^:]+):\s*(.*)$/.exec(l);
    if (!m || !cur) return;
    var key = m[1].trim().toLowerCase(), val = m[2].trim();
    if (key === 'название содержит') {
      cur.match = val.split(',').map(function (x) { return x.trim().toUpperCase(); }).filter(Boolean);
    } else if (key === 'папки') {
      cur.roles = val.split('/').map(function (x) { return x.trim().toLowerCase(); });
    } else if (key === 'код артикула') {
      var d = /(\d+)\s*[-–]\s*(\d+)/.exec(val);
      if (val.charAt(0) === '^') { try { cur.codeRe = new RegExp(val); } catch (e) { } }
      else if (d) cur.codeRe = new RegExp('^(\\d{' + d[1] + ',' + d[2] + '})(?!\\d)');
    } else if (key === 'артикул карточке') {
      cur.cardArticle = !/^(нет|no|-)$/i.test(val);
    } else if (key === 'выгрузка') {
      cur.exportMode = /папк/i.test(val) ? 'folders' : 'cards';
    } else if (key === 'имена в выгрузке') {
      cur.exportNames = /номер/i.test(val) ? 'numbered' : 'original';
    }
  });
  return types.filter(function (t) { return t.match.length; });
}

var _cpRulesP = null;
/** Правила структуры: CP.rules = [типы] или [] (файла нет). */
function cpLoadRules(force) {
  if (_cpRulesP && !force) return _cpRulesP;
  _cpRulesP = cpReadServiceFile(CP_RULES_FILE, force).then(function (t) {
    CP.rulesText = t;
    CP.rules = cpParseRules(t);
  }, function (e) {
    if (e && e.status === 404) {
      /* Файла нет — кладём образец на Диск и сразу работаем по нему.
         Дальше правила меняются только в файле (кнопка «Файлы настроек»). */
      CP.rulesText = CP_RULES_TEMPLATE;
      CP.rules = cpParseRules(CP_RULES_TEMPLATE);
      CP.rulesCreated = true;
      return CPDisk.ensureDir(CP_CONFIG.serviceDir).then(function () {
        return CPDisk.uploadBlob(cpServicePath(CP_RULES_FILE), new Blob([CP_RULES_TEMPLATE], { type: 'text/plain;charset=utf-8' }), false);
      }).catch(function (er) { if (window.console) console.warn('[CP] образец структуры не записался', er && (er.body || er.message)); });
    }
    CP.rulesText = '';
    CP.rules = [];
    _cpRulesP = null;
    if (window.console) console.warn('[CP] структура не прочиталась', e && (e.body || e.message));
  }).then(function () {
    if (CP.shoot && typeof cbRenderCards === 'function') { cbRenderCards(); cpUpdateStatusLine(); }
    return CP.rules;
  });
  return _cpRulesP;
}

/** Тип съёмки по названию папки или null. */
function cpShootType(name) {
  if (!CP.rules || !name) return null;
  var up = String(name).toUpperCase();
  for (var i = 0; i < CP.rules.length; i++) {
    var t = CP.rules[i];
    if (t.match.some(function (w) { return up.indexOf(w) !== -1; })) return t;
  }
  return null;
}

/** Роли папок для пути внутри съёмки 'лук/артикул/кадр.jpg': {лук, бренд, артикул, code}. */
function cpFacets(type, rel) {
  var out = {};
  if (!type || !rel) return out;
  var dirs = rel.split('/').slice(0, -1);
  type.roles.forEach(function (role, i) {
    if (role === '*' || dirs[i] === undefined) return;
    out[role] = dirs[i];
    if (role === 'артикул') out.articlePath = dirs.slice(0, i + 1).join('/');
  });
  if (out['артикул']) {
    var m = type.codeRe.exec(out['артикул']);
    out.code = m ? m[1] : '';
  }
  /* Лишний уровень папок (часть, день) сдвигает роли — тогда артикул ищем
     по коду: ближайшая к кадру папка, чьё имя начинается с кода. Папки
     луков («1», «2») под код не подходят. */
  if (!out.code && type.roles.indexOf('артикул') !== -1) {
    for (var i = dirs.length - 1; i >= 0; i--) {
      var mm = type.codeRe.exec(dirs[i]);
      if (mm) { out['артикул'] = dirs[i]; out.code = mm[1]; out.articlePath = dirs.slice(0, i + 1).join('/'); break; }
    }
  }
  return out;
}

function cpRelPath(p) {
  if (!p || !p.disk || !CP.shoot) return '';
  var root = CP.shoot.path.replace(/\/+$/, '') + '/';
  return p.disk.indexOf(root) === 0 ? p.disk.slice(root.length) : p.name;
}

/* ---------- артикул карточки ---------- */

/**
 * Артикул карточки по кадрам из папок артикулов: как только в карточке
 * появляется такой кадр, её заголовок («Название / артикул») становится
 * кодом артикула. Возвращает true, если что-то поменялось.
 */
function cpAutoArticles() {
  if (!CP.shoot) return false;
  var type = cpShootType(CP.shoot.name);
  if (!type || !type.cardArticle) return false;
  var changed = false;
  CP.artLogged = CP.artLogged || {};
  App.cards.forEach(function (card) {
    var codes = [], rels = [], paths = [];
    cpCardPids(card).forEach(function (pid) {
      var p = cbPhotoById(pid);
      var rel = cpRelPath(p);
      var f = cpFacets(type, rel);
      rels.push(rel + ' → ' + (f.code || 'нет'));
      if (f.code && codes.indexOf(f.code) === -1) { codes.push(f.code); paths.push(f.articlePath || ''); }
    });
    var auto = codes.join(', ');
    /* папка артикула (с луком) — по ней карточка ложится в выгрузку с исходным именем */
    var dir = codes.length === 1 ? paths[0] : '';
    if ((card.cpArticleDir || '') !== dir) { card.cpArticleDir = dir; changed = true; }
    var prev = card.cpArticle || '';
    /* для разбора по консоли: какие пути и что из них вышло (один раз на состав) */
    var sig = card.id + '|' + rels.join(';');
    if (rels.length && !CP.artLogged[sig] && window.console) {
      CP.artLogged[sig] = true;
      console.info('[CP] артикул карточки «' + card.title + '» (' + type.name + '): ' + rels.join(' | '));
    }
    /* карточки из прошлой версии: артикул уже записан, а заголовок не ставился */
    if (auto && auto === prev && !card.cpArtTitled) {
      card.title = auto;
      card.cpArtTitled = true;
      changed = true;
      return;
    }
    if (auto === prev) return;
    /* В карточке появился кадр из папки артикула (или состав артикулов
       поменялся) — карточка называется по артикулу. Пока состав тот же,
       заголовок не трогаем: его можно поправить руками. */
    if (auto) { card.title = auto; card.cpArtTitled = true; }
    else if (card.title === prev) card.title = '';
    card.cpArticle = auto;
    changed = true;
  });
  return changed;
}

(function cpRulesHooks() {
  var orig = window.cbRenderCards;
  window.cbRenderCards = function () {
    var ch = false;
    try { ch = cpAutoArticles(); } catch (e) { if (window.console) console.error('[CP] артикул карточки', e); }
    var r = orig.apply(this, arguments);
    if (ch) cbMarkDirty();
    cpDecorateArticles();
    return r;
  };
})();

function cpDecorateArticles() {
  if (!CP.shoot) return;
  var type = cpShootType(CP.shoot.name);
  if (!type || !type.cardArticle) return;
  Array.prototype.forEach.call(document.querySelectorAll('#cbCards .cb-card'), function (el) {
    var card = cbCardById(el.getAttribute('data-cid'));
    var head = el.querySelector('.cb-card-head');
    if (!card || !head || head.querySelector('.cp-art') || !card.cpArticle) return;
    var many = card.cpArticle.indexOf(',') !== -1;
    var chip = document.createElement('span');
    chip.className = 'cp-art' + (many ? ' cp-art-warn' : '');
    chip.textContent = many ? 'артикулы: ' + card.cpArticle : 'арт. ' + card.cpArticle;
    chip.title = many ? 'В карточке кадры из папок разных артикулов' : 'Артикул по папке, из которой кадр в карточке';
    head.appendChild(chip);
  });
}

/* ---------- редактор служебных файлов ---------- */

var CP_SERVICE_FILES = [
  { name: CP_TAGS_FILE, label: 'Словарь тегов', template: function () { return CP_DICT_TEMPLATE; } },
  { name: CP_RULES_FILE, label: 'Структура съёмок', template: function () { return CP_RULES_TEMPLATE; } },
  { name: CP_SETTINGS_FILE, label: 'Настройки', template: function () { return CP_SETTINGS_TEMPLATE; } }
];

(function cpRulesCss() {
  var css = ''
    + '.cp-art{font-size:11px;color:#e7c9a8;border:1px solid #5a4632;background:#2b241d;border-radius:10px;padding:1px 8px}'
    + '.cp-art-warn{color:#f2b8a0;border-color:#8a4a32}'
    + '.cp-files{position:fixed;inset:0;z-index:3500;background:#000a;display:none;align-items:center;justify-content:center}'
    + '.cp-files.cp-open{display:flex}'
    + '.cp-files-box{width:760px;max-width:calc(100vw - 32px);height:min(640px,calc(100vh - 40px));background:#1d1d1b;border:1px solid #3a3a37;border-radius:6px;display:flex;flex-direction:column;color:#f2f2f1}'
    + '.cp-files-head{display:flex;gap:8px;align-items:center;padding:12px 16px;border-bottom:1px solid #2a2a28}'
    + '.cp-files-head b{flex:1}'
    + '.cp-files-tabs{display:flex;gap:6px;padding:10px 16px 0}'
    + '.cp-files-tabs button.cp-on{border-color:#C9956B;color:#e7c9a8}'
    + '.cp-files textarea{flex:1;margin:10px 16px;background:#141413;border:1px solid #3a3a37;color:#f2f2f1;font:12px/1.5 "IBM Plex Mono",monospace;padding:10px;resize:none}'
    + '.cp-files-foot{display:flex;gap:8px;align-items:center;padding:0 16px 14px}'
    + '.cp-files-foot .cp-sum{flex:1;color:#a3a09a;font-size:11px}';
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);
})();

(function cpFilesDom() {
  var box = document.createElement('div');
  box.className = 'cp-files';
  box.id = 'cpFiles';
  box.innerHTML = '<div class="cp-files-box">'
    + '<div class="cp-files-head"><b>Файлы настроек на Диске</b><button data-cp-f="close" title="Закрыть">×</button></div>'
    + '<div class="cp-files-tabs">' + CP_SERVICE_FILES.map(function (f, i) {
      return '<button data-cp-f="tab" data-i="' + i + '">' + cbEsc(f.label) + '</button>';
    }).join('') + '</div>'
    + '<textarea id="cpFilesText" spellcheck="false"></textarea>'
    + '<div class="cp-files-foot"><div class="cp-sum" id="cpFilesNote"></div>'
    + '<button data-cp-f="close">Закрыть</button><button class="cb-primary" data-cp-f="save">Сохранить на Диск</button></div>'
    + '</div>';
  document.body.appendChild(box);

  var btn = document.createElement('button');
  btn.id = 'cpFilesOpen';
  btn.textContent = 'Файлы настроек';
  btn.title = 'Словарь тегов, структура съёмок и настройки — простые файлы в служебной папке _ContentPulse рядом с архивом';
  document.getElementById('cpShelfBar').appendChild(btn);
  btn.onclick = function () { cpFilesOpen(0); };

  box.addEventListener('click', function (e) {
    var b = e.target.closest('[data-cp-f]');
    if (e.target === box) { box.classList.remove('cp-open'); return; }
    if (!b) return;
    var a = b.getAttribute('data-cp-f');
    if (a === 'close') box.classList.remove('cp-open');
    else if (a === 'tab') cpFilesOpen(parseInt(b.getAttribute('data-i'), 10));
    else if (a === 'save') cpFilesSave();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && box.classList.contains('cp-open')) box.classList.remove('cp-open');
  });
})();

CP.filesIdx = 0;

function cpFilesOpen(i) {
  var box = document.getElementById('cpFiles');
  var f = CP_SERVICE_FILES[i];
  CP.filesIdx = i;
  box.classList.add('cp-open');
  Array.prototype.forEach.call(box.querySelectorAll('[data-cp-f="tab"]'), function (b) {
    b.classList.toggle('cp-on', parseInt(b.getAttribute('data-i'), 10) === i);
  });
  var ta = document.getElementById('cpFilesText');
  var note = document.getElementById('cpFilesNote');
  ta.value = '';
  ta.disabled = true;
  note.textContent = 'Читаю ' + f.name + '...';
  cpReadServiceFile(f.name, true).then(function (t) {
    if (CP.filesIdx !== i) return;
    ta.value = t;
    note.textContent = CP_CONFIG.serviceDir.replace(/^disk:/, '') + '/' + f.name;
  }, function (e) {
    if (CP.filesIdx !== i) return;
    if (e && e.status === 404) {
      ta.value = f.template();
      note.textContent = 'Файла ещё нет — ниже образец. «Сохранить» создаст ' + f.name + ' в ' + CP_CONFIG.serviceDir.replace(/^disk:/, '');
    } else {
      note.textContent = 'Не прочитался: ' + ((e && (e.body || e.message)) || e);
    }
  }).then(function () { ta.disabled = false; ta.focus(); });
}

function cpFilesSave() {
  var f = CP_SERVICE_FILES[CP.filesIdx];
  var text = document.getElementById('cpFilesText').value;
  var note = document.getElementById('cpFilesNote');
  note.textContent = 'Сохраняю ' + f.name + '...';
  CPDisk.ensureDir(CP_CONFIG.serviceDir).then(function () {
    return CPDisk.uploadBlob(cpServicePath(f.name), new Blob([text], { type: 'text/plain;charset=utf-8' }), true);
  }).then(function () {
    /* Применяем сохранённый текст сразу: Диск показывает новый файл в списке
       папки не мгновенно, перечитывание могло вернуть «файла нет». */
    _cpSvcList = null;
    if (f.name === CP_RULES_FILE) {
      CP.rulesText = text;
      CP.rules = cpParseRules(text);
      _cpRulesP = Promise.resolve(CP.rules);
    } else if (f.name === CP_TAGS_FILE) {
      CP.dict = cpParseDict(text);
    } else if (f.name === CP_SETTINGS_FILE) {
      CP.settingsText = text;
      CP.settings = cpParseSettings(text);
      _cpSettingsP = Promise.resolve();
      cpSettingsToUi();
    }
  }).then(function () {
    note.textContent = 'Сохранено: ' + f.name;
    cbToast('Сохранено на Диск: ' + f.name);
    if (CP.sel) cpRenderPanel();
    if (CP.shoot) cbRenderCards();
  }).catch(function (e) {
    note.textContent = 'Не сохранилось: ' + ((e && (e.body || e.message)) || e);
    cpHandleError(e, 'Сохранение ' + f.name);
  });
}

if (CPDisk.hasToken()) cpLoadRules();

/** Служебная папка сменилась (другой архив) — перечитать настройки оттуда. */
function cpServiceReset() {
  _cpSvcList = null;
  _cpRulesP = null;
  _cpSettingsP = null;
  CP.dict = undefined;
  CP.rules = null;
  CP.settings = null;
  var sd = document.getElementById('cpSetServiceDir');
  if (sd) sd.textContent = CP_CONFIG.serviceDir.replace(/^disk:/, '');
  cpEnsureSettings();
  cpLoadRules();
  cpLoadDict().then(function () { if (CP.shoot) cbRenderCards(); if (CP.sel) cpRenderPanel(); }, function () { });
}

/* ---------- настройки за шестерёнкой ----------
   Архив, папка ретуши и файлы настроек убраны с витрины в одну кнопку
   в правом верхнем углу, чтобы не мешали. Элементы переносятся как есть,
   их обработчики остаются прежними. */

(function cpSettingsMenu() {
  var css = ''
    + '.cp-gear{width:34px;height:34px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:1px solid #5a4632;border-radius:17px;background:transparent;color:#C9956B;cursor:pointer}'
    + '.cp-gear:hover,.cp-gear.cp-on{background:#2b241d}'
    + '.cp-gear svg{width:18px;height:18px}'
    + '.cp-settings{position:fixed;z-index:3400;width:440px;max-width:calc(100vw - 24px);background:#1d1d1b;border:1px solid #3a3a37;border-radius:6px;padding:14px 16px;box-shadow:0 10px 32px #000a;display:none;color:#f2f2f1}'
    + '.cp-settings.cp-open{display:block}'
    + '.cp-settings h5{margin:12px 0 6px;font-size:10px;letter-spacing:.12em;color:#a3a09a;font-weight:600;text-transform:uppercase}'
    + '.cp-settings h5:first-child{margin-top:0}'
    + '.cp-set-line{display:flex;gap:8px;align-items:center;flex-wrap:wrap}'
    + '.cp-settings input{flex:1;min-width:0;width:auto !important;background:#141413;border:1px solid #3a3a37;color:#f2f2f1;padding:8px 10px;border-radius:3px;font:inherit;font-size:13px}'
    + '.cp-settings input:focus{outline:none;border-color:#C9956B}'
    + '.cp-set-dir{font-size:11px;color:#a3a09a;margin:-2px 0 8px;font-family:"IBM Plex Mono",monospace;word-break:break-all}';
  var st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  var gear = document.createElement('button');
  gear.className = 'cp-gear';
  gear.id = 'cpGear';
  gear.title = 'Настройки';
  gear.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + '<circle cx="12" cy="12" r="3"></circle>'
    + '<path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"></path></svg>';
  document.querySelector('#cpShelf .cp-shelf-head').appendChild(gear);

  var box = document.createElement('div');
  box.className = 'cp-settings';
  box.id = 'cpSettings';
  box.innerHTML = '<h5>Архив съёмок</h5><div class="cp-set-line" id="cpSetArchive"></div>'
    + '<h5>Папка ретуши</h5><div class="cp-set-line" id="cpSetRetouch"></div>'
    + '<h5>Файлы настроек</h5><div class="cp-set-dir">лежат в <span id="cpSetServiceDir">' + cbEsc(CP_CONFIG.serviceDir.replace(/^disk:/, '')) + '</span> — рядом с архивом</div><div class="cp-set-line">'
    + CP_SERVICE_FILES.map(function (f, i) { return '<button data-cp-setfile="' + i + '">' + cbEsc(f.label) + '</button>'; }).join('')
    + '</div>';
  document.body.appendChild(box);

  /* переносим поля с витрины (обработчики остаются) */
  var arch = document.getElementById('cpSetArchive');
  var ai = document.getElementById('cpArchiveInput'), ab = document.getElementById('cpArchiveApply');
  if (ai && ai.previousElementSibling && /Архив/.test(ai.previousElementSibling.textContent)) ai.previousElementSibling.remove();
  if (ai) arch.appendChild(ai);
  if (ab) arch.appendChild(ab);
  var ret = document.getElementById('cpSetRetouch');
  var ri = document.getElementById('cpRetouchInput'), rb = document.getElementById('cpRetouchApply');
  var wrap = ri && ri.closest('.cp-set');
  if (ri) ret.appendChild(ri);
  if (rb) ret.appendChild(rb);
  if (wrap) wrap.remove();
  var fo = document.getElementById('cpFilesOpen');
  if (fo) fo.remove();

  function place() {
    var r = gear.getBoundingClientRect();
    box.style.top = (r.bottom + 8) + 'px';
    box.style.right = Math.max(12, innerWidth - r.right) + 'px';
  }
  function close() { box.classList.remove('cp-open'); gear.classList.remove('cp-on'); }
  gear.onclick = function (e) {
    e.stopPropagation();
    if (box.classList.contains('cp-open')) { close(); return; }
    place();
    box.classList.add('cp-open');
    gear.classList.add('cp-on');
  };
  box.addEventListener('click', function (e) {
    var f = e.target.closest('[data-cp-setfile]');
    if (f) { close(); cpFilesOpen(parseInt(f.getAttribute('data-cp-setfile'), 10)); }
  });
  document.addEventListener('click', function (e) {
    if (box.classList.contains('cp-open') && !e.target.closest('#cpSettings') && !e.target.closest('#cpGear')) close();
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  addEventListener('resize', function () { if (box.classList.contains('cp-open')) place(); });

  /* без входа шестерёнку не показываем */
  var showOrig = window.cpShowShelf;
  window.cpShowShelf = function () {
    var r = showOrig.apply(this, arguments);
    gear.style.display = CPDisk.hasToken() ? '' : 'none';
    return r;
  };
  gear.style.display = CPDisk.hasToken() ? '' : 'none';
})();
