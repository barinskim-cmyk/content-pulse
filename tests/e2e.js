/* E2E: страница + подменённый REST API Яндекс Диска (page.route).
   Запуск: node tests/e2e.js  (нужен playwright, предустановлен) */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const results = [];
const check = (name, ok, extra) => { results.push([name, !!ok]); console.log((ok ? 'PASS ' : 'FAIL ') + name + (extra ? ' — ' + extra : '')); };

/* --- маленький валидный JPEG-подобный PNG для превью (браузеру всё равно) --- */
function png(w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h, 0x80);
  for (let y = 0; y < h; y++) raw[y * (w * 3 + 1)] = 0;
  const chunk = (t, d) => { const b = Buffer.alloc(8 + d.length + 4); b.writeUInt32BE(d.length, 0); b.write(t, 4); d.copy(b, 8);
    const crc = require('zlib').crc32 ? zlib.crc32(Buffer.concat([Buffer.from(t), d])) : 0; b.writeUInt32BE(crc >>> 0, 8 + d.length); return b; };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/* --- состояние фейкового Диска --- */
const DIRS = new Set(['disk:', 'disk:/Архив', 'disk:/Архив/LM-1043', 'disk:/Архив/LM-1043/part2', 'disk:/Архив/LM-2001',
  /* съёмки по структуре SK: моделька (лук/артикул) и оптика (бренд/артикул) */
  'disk:/Архив/2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST', 'disk:/Архив/2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST/1', 'disk:/Архив/2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST/1/74595_модель',
  'disk:/Архив/2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST/1/74596_модель', 'disk:/Архив/2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST/видео',
  'disk:/Архив/2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST/1/74598_модель',
  'disk:/КАТАЛОГ', 'disk:/КАТАЛОГ/00_АРХИВ', 'disk:/КАТАЛОГ/00_АРХИВ/2026-11-01_SV_ПРЕДМЕТКА',
  'disk:/Архив/2026-09-21_SV_ОПТИКА_N', 'disk:/Архив/2026-09-21_SV_ОПТИКА_N/maxmara_оптика', 'disk:/Архив/2026-09-21_SV_ОПТИКА_N/maxmara_оптика/75327_оптика_N',
  /* общий диск Яндекс 360 (метка TESTVD): свои адреса API, пути vd:<метка>:disk:/… */
  'vd:TESTVD:disk:', 'vd:TESTVD:disk:/01_ИСХОДНИКИ', 'vd:TESTVD:disk:/01_ИСХОДНИКИ/2026-11-06_SV_ПРЕДМЕТКА_VD',
  'vd:TESTVD:disk:/01_ИСХОДНИКИ/2026-11-06_SV_ПРЕДМЕТКА_VD/zarina', 'vd:TESTVD:disk:/01_ИСХОДНИКИ/2026-11-06_SV_ПРЕДМЕТКА_VD/zarina/76001_предм']);
const FILES = new Map([
  ['disk:/Архив/LM-1043/a.jpg', Buffer.from('A'.repeat(100))],
  ['disk:/Архив/LM-1043/b.jpg', Buffer.from('B'.repeat(200))],
  ['disk:/Архив/LM-1043/part2/c.jpg', Buffer.from('C'.repeat(300))],
  ['disk:/Архив/2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST/1/IMG_0101.jpg', Buffer.from('M'.repeat(120))],
  ['disk:/Архив/2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST/1/74595_модель/manekin.jpg', Buffer.from('N'.repeat(130))],
  ['disk:/Архив/2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST/1/74596_модель/manekin2.jpg', Buffer.from('Q'.repeat(140))],
  ['disk:/Архив/2026-09-21_SV_ОПТИКА_N/maxmara_оптика/75327_оптика_N/s1.jpg', Buffer.from('S'.repeat(150))],
  ['disk:/Архив/2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST/видео/clip.mp4', Buffer.from('V'.repeat(500))],
  ['disk:/Архив/2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST/видео/.DS_Store', Buffer.from('x')],
  ['vd:TESTVD:disk:/01_ИСХОДНИКИ/2026-11-06_SV_ПРЕДМЕТКА_VD/zarina/76001_предм/p1.jpg', Buffer.from('P'.repeat(110))],
  ['vd:TESTVD:disk:/01_ИСХОДНИКИ/2026-11-06_SV_ПРЕДМЕТКА_VD/zarina/76001_предм/p2.jpg', Buffer.from('R'.repeat(115))],
]);
const VD_CALLS = [];
const log = [];
const DOWNLOADS = [];
const DOWNLOADS_REFERER = [];
const ZIPS = new Map();
const FRESH = new Map();   /* как у Яндекса: новый файл появляется в списке папки не сразу */
const CLOUD = new Map();
const MPU = new Map();
const MPU_PARTS = [];
const WHOLE = [];   /* ключ в бакете -> путь архива */   /* путь .zip на Диске -> имена внутри архива */
const PREVIEW_CALLS = { single: 0, batch: 0, big: 0 };
/* режим «превью заблокировано»: файлы — настоящие картинки, их будут уменьшать в браузере */
if (process.env.BLOCK_PREVIEW) for (const k of [...FILES.keys()]) FILES.set(k, png(60, 40));
const md5 = (b) => require('crypto').createHash('md5').update(b).digest('hex');
const meta = (p) => {
  const name = p.split('/').pop();
  if (DIRS.has(p)) return { path: p, name, type: 'dir', modified: '2026-11-0' + (p.length % 9) + 'T10:00:00+00:00' };
  const b = FILES.get(p);
  return { path: p, name, type: 'file', size: b.length, md5: md5(b), modified: '2026-11-04T10:00:00+00:00',
    preview: 'https://downloader.disk.yandex.ru/preview/x?p=' + encodeURIComponent(p) };
};
const API = 'https://cloud-api.yandex.net/v1/disk';
const CORS = { 'Access-Control-Allow-Origin': '*' };

async function route(r) {
  const req = r.request();
  const u = new URL(req.url());
  const q = Object.fromEntries(u.searchParams);
  const m = req.method();
  const json = (code, obj) => r.fulfill({ status: code, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(obj) });
  log.push(m + ' ' + u.pathname + ' ' + (q.path || q.p || ''));
  if (u.host === 'cloud-api.yandex.net') {
    if (req.headers()['authorization'] !== 'OAuth TESTTOKEN') return json(401, { message: 'no auth' });
    const p = /(^|:)disk:\/$/.test(q.path || '') ? q.path.slice(0, -1) : q.path;   /* корень диска: «disk:/» = «disk:» */
    if (u.pathname === '/v1/disk' || u.pathname === '/v1/disk/') return json(200, { user: { login: 'masha', display_name: 'Маша' } });
    /* общий диск: только свои адреса и только пути vd:…; в списках пути — без метки (худший случай) */
    let pn = u.pathname, vdMode = false;
    const vdPath = /^vd:/.test(q.path || '') || /^vd:/.test(q.from || '');
    if (pn.indexOf('/v1/disk/virtual-disks/resources') === 0) {
      if (!vdPath) return json(400, { error: 'DiskPathFormatError', message: 'нужен путь общего диска' });
      VD_CALLS.push(m + ' ' + pn);
      pn = pn.replace('/virtual-disks', '');
      vdMode = true;
    } else if (pn.indexOf('/v1/disk/resources') === 0 && vdPath) return json(400, { error: 'DiskPathFormatError', message: 'путь общего диска — в /virtual-disks' });
    const vmeta = x => { const o = meta(x); if (vdMode) o.path = o.path.replace(/^vd:[^:]+:/, ''); return o; };
    if (pn === '/v1/disk/resources' && m === 'GET') {
      if (DIRS.has(p)) {
        const kids = [...DIRS, ...FILES.keys()].filter(x => x !== p && x.slice(0, x.lastIndexOf('/')) === p && !(FRESH.has(x) && Date.now() - FRESH.get(x) < 3000)).sort();
        const off = +q.offset || 0, lim = +q.limit || 20;
        return json(200, { ...vmeta(p), _embedded: { items: kids.slice(off, off + lim).map(vmeta), total: kids.length } });
      }
      if (FILES.has(p)) return json(200, vmeta(p));
      return json(404, { message: 'not found' });
    }
    if (pn === '/v1/disk/resources' && m === 'PUT') { if (DIRS.has(p)) return json(409, { message: 'exists' }); DIRS.add(p); return json(201, {}); }
    /* с октября 2026 Яндекс не отдаёт папки архивом */
    if (pn === '/v1/disk/resources/download' && DIRS.has(p)) return json(500, { error: 'InternalServerError', message: 'Ошибка сервера.' });
    if (pn === '/v1/disk/resources/download') return json(200, { href: 'https://downloader.disk.yandex.ru/dl?p=' + encodeURIComponent(p) });
    if (pn === '/v1/disk/resources/upload') return json(200, { href: 'https://uploader1.disk.yandex.net/up?p=' + encodeURIComponent(p) });
    if (pn === '/v1/disk/resources/copy' && m === 'POST') {
      if (FILES.has(q.path)) return json(409, { message: 'exists' });
      FILES.set(q.path, FILES.get(q.from)); return json(201, {});
    }
    return json(400, { message: 'bad ' + u.pathname });
  }
  if (u.host === 'downloader.disk.yandex.ru') {
    /* как настоящий Яндекс 360: запросы со страницы (fetch с Origin) — 403, обычная загрузка браузера — да */
    if (req.headers()['origin'] && req.resourceType() !== 'document') return r.fulfill({ status: 403, body: 'forbidden' });
    /* и загрузки со страницы чужого сайта (Referer) — тоже 403: страница обязана не слать Referer */
    if (req.headers()['referer']) { DOWNLOADS_REFERER.push(req.headers()['referer']); return r.fulfill({ status: 403, body: 'referer not allowed' }); }
    DOWNLOADS.push(q.p);
    return r.fulfill({ status: 200, headers: { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="x.zip"' }, body: 'ZIP' });
  }
  if (u.host === 'functions.yandexcloud.net') {
    if (m === 'OPTIONS') return r.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-headers': 'X-Disk-Token, Content-Type', 'access-control-allow-methods': 'GET, POST, OPTIONS' }, body: '' });
    if (req.headers()['x-disk-token'] !== 'TESTTOKEN') return json(401, { error: 'no token' });
    if (q.a === 'previews' && m === 'POST') {
      PREVIEW_CALLS.batch++;
      const b = JSON.parse(req.postData() || '{}');
      const img = png(30, 20).toString('base64');
      return json(200, { items: (b.paths || []).map(p => process.env.BLOCK_PREVIEW ? { path: p, status: 502, error: 'blocked' }
        : FILES.has(p) ? { path: p, type: 'image/png', data: img } : { path: p, status: 404, error: 'nf' }) });
    }
    if (q.a === 'preview') {
      if (q.size === '2400x2400') PREVIEW_CALLS.big++; else PREVIEW_CALLS.single++;
      if (process.env.BLOCK_PREVIEW) return json(502, { error: 'blocked' });
      return r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'image/png' }, body: png(30, 20) });
    }
    if (q.a === 'file') {
      if (process.env.FAIL_STATE_DL && /_contentpulse\.json$/.test(q.path)) return json(502, { error: 'fail' });
      if (!FILES.has(q.path)) return json(404, { error: 'nf' });
      return r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/octet-stream' }, body: FILES.get(q.path) });
    }
    if (q.a === 'bench' && m === 'POST') {
      const b = JSON.parse(req.postData() || '{}');
      const reads = b.files.map(p => ({ file: p.split('/').pop(), ms_link: 120, ms_file: 300, mb: 12.5, mb_s: 41.7, status: 200 }));
      return json(200, { reads, parallel: { files: reads.length, ms: 400, mb: 37.5, mb_s: 93.7, errors: [] }, upload: { status: 201, mb: 8, ms: 900, mb_s: 8.9 } });
    }
    if (q.a === 'mpu' && m === 'POST') {
      const b = JSON.parse(req.postData() || '{}');
      if (b.op === 'start') { const key = 'exports/mpu' + (MPU.size + 1) + '/file'; MPU.set(key, { parts: {} }); return json(200, { key, uploadId: 'U' + MPU.size }); }
      if (b.op === 'whole') { const key = 'exports/whole' + (MPU.size + 1) + '/file'; MPU.set(key, {}); CLOUD.set(key, b.from); WHOLE.push(b.from);
        return json(200, { url: 'https://storage.yandexcloud.net/content-pulse-exports-test/' + key + '?X-Amz-Signature=x', store: 'cloud' }); }
      if (b.op === 'part' && process.env.NO_RANGE && b.start > 0) return json(422, { error: 'Диск не отдаёт файл кусками', code: 'range_unsupported' });
      if (b.op === 'part') {
        const u = MPU.get(b.key); const f = FILES.get(b.from);
        if (!u || !f) return json(422, { error: 'нет' });
        u.from = b.from; u.parts[b.n] = f.slice(b.start, b.end + 1); MPU_PARTS.push(b.n);
        return json(200, { n: b.n, etag: '"e' + b.n + '"' });
      }
      if (b.op === 'done') {
        const u = MPU.get(b.key);
        const whole = Buffer.concat(Object.keys(u.parts).sort((a, c) => a - c).map(k => u.parts[k]));
        if (!whole.equals(FILES.get(u.from))) return json(502, { error: 'собрано неверно' });
        CLOUD.set(b.key, u.from);
        return json(200, { url: 'https://storage.yandexcloud.net/content-pulse-exports-test/' + b.key + '?X-Amz-Signature=x', store: 'cloud' });
      }
      return json(200, { ok: true });
    }
    if (q.a === 'zip' && m === 'POST') {
      const b = JSON.parse(req.postData() || '{}');
      for (const e of b.entries) {
        if (!FILES.has(e.from)) return json(422, { error: 'нет файла ' + e.from });
        if (FILES.get(e.from).length !== e.size) return json(422, { error: 'размер изменился ' + e.from });
      }
      const parts = b.target.split('/'); for (let i = 2; i < parts.length; i++) DIRS.add(parts.slice(0, i).join('/'));
      ZIPS.set(b.target, b.entries.map(e => e.name));
      /* как настоящая прослойка с хранилищем: архив в облаке, ссылка подписана */
      const key = 'exports/' + ZIPS.size + '.zip';
      CLOUD.set(key, b.target);
      return json(200, { path: b.target, bytes: 1, files: b.entries.length, ms: 5, store: 'cloud',
        url: 'https://storage.yandexcloud.net/content-pulse-exports-test/' + key + '?X-Amz-Signature=x&name=' + encodeURIComponent(b.target.split('/').pop()) });
    }
    if (q.a === 'copy' && m === 'POST') {
      const b = JSON.parse(req.postData() || '{}');
      if (FAIL_COPY) return json(200, { results: (b.items || []).map(it => FAIL_COPY.test(it.path) ? { from: it.from, status: 'failed', error: 'тест: Диск не ответил' } : (FILES.has(it.path) ? { from: it.from, status: 'exists' } : (FILES.set(it.path, FILES.get(it.from)), { from: it.from, status: 'done' }))) });
      (b.dirs || []).forEach(d => { const parts = d.split('/'); for (let i = 2; i <= parts.length; i++) DIRS.add(parts.slice(0, i).join('/')); });
      const results = (b.items || []).map(it => {
        const parent = it.path.slice(0, it.path.lastIndexOf('/'));
        const parts = parent.split('/'); for (let i = 2; i <= parts.length; i++) DIRS.add(parts.slice(0, i).join('/'));
        if (FILES.has(it.path)) return { from: it.from, status: 'exists' };
        FILES.set(it.path, FILES.get(it.from)); return { from: it.from, status: 'done' };
      });
      return json(200, { results });
    }
    return json(400, { error: 'bad' });
  }
  if (u.host === 'storage.yandexcloud.net') {
    const key = u.pathname.split('/').slice(2).join('/');
    if (!CLOUD.has(key) || !q['X-Amz-Signature']) return r.fulfill({ status: 403, body: 'AccessDenied' });
    DOWNLOADS.push(CLOUD.get(key));
    return r.fulfill({ status: 200, headers: { 'content-type': 'application/zip', 'content-disposition': 'attachment; filename="x.zip"' }, body: 'PK' });
  }
  if (u.host === 'uploader1.disk.yandex.net') { if (!FILES.has(q.p)) FRESH.set(q.p, Date.now()); FILES.set(q.p, req.postDataBuffer()); return r.fulfill({ status: 201, headers: CORS, body: '' }); }
  return r.continue();
}

let FAIL_COPY = null;   /* копирование этих путей «падает» — проверка «докопировать» */

(async () => {
  const srv = http.createServer((req, res) => {
    const f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/content-pulse\/?/, '/') || '/');
    const file = fs.existsSync(f) && fs.statSync(f).isFile() ? f : path.join(ROOT, 'index.html');
    res.writeHead(200, { 'content-type': file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8' });
    res.end(fs.readFileSync(file));
  }).listen(0);
  const base = 'http://127.0.0.1:' + srv.address().port + '/content-pulse/';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.route(/yandex\.(ru|net)|yandexcloud\.net/, route);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  /* вход: токен приходит в #access_token */
  await page.goto(base + '#access_token=TESTTOKEN&token_type=bearer');
  await page.waitForSelector('.cp-shoot', { timeout: 8000 });
  check('после входа токен убран из адреса', !(await page.url()).includes('access_token'));
  check('витрина: все съёмки из архива', (await page.$$('.cp-shoot')).length === 4);
  check('витрина: имя пользователя', (await page.textContent('#cpUser')) === 'Маша');
  check('на витрине виден номер версии', /^2\.0\.\d+$/.test(await page.textContent('#cpVersion')));

  await page.fill('#cpShelfSearch', '1043');
  check('поиск по коду', (await page.$$('.cp-shoot')).length === 1);

  await page.dblclick('.cp-shoot');
  await page.waitForFunction(() => !document.getElementById('cpShelf').classList.contains('cp-open'));
  await page.waitForFunction(() => App.photos.filter(p => p.dataUrl).length === 3, null, { timeout: 8000 });
  check('съёмка: 3 JPEG включая часть в подпапке, превью загружены', true);
  check('галерея отрисована', (await page.$$('#cbTrayGrid .cb-thumb')).length === 3);
  await page.selectOption('#cpFolderFilter', 'part2');
  check('фильтр по папке: только содержимое part2', (await page.$$('#cbTrayGrid .cb-thumb')).length === 1);
  await page.selectOption('#cpFolderFilter', '/');
  check('фильтр: только корень съёмки', (await page.$$('#cbTrayGrid .cb-thumb')).length === 2);
  await page.selectOption('#cpFolderFilter', '');
  check('фильтр сброшен: все папки', (await page.$$('#cbTrayGrid .cb-thumb')).length === 3);
  await page.waitForFunction(() => !App.dirty, null, { timeout: 8000 });
  check('общий файл отбора создан на Диске', FILES.has('disk:/Архив/LM-1043/_contentpulse.json'));

  /* карточка из шаблона + кадр в слот (через модель — drag&drop эмулировать дорого) */
  await page.evaluate(() => {
    var tpl = App.templates[0];
    cbAddCardFromTpl(tpl.id);
    var c = App.cards[0];
    c.title = 'Лук 1';
    if (c.mode === 'auto') c.pids = [App.photos[0].id, App.photos[1].id];
    else { c.slots[0].pid = App.photos[0].id; if (c.slots[1]) c.slots[1].pid = App.photos[1].id; }
    cbMarkDirty(); cbRenderCards(); cbRenderTray();
  });
  check('карточка собрана, на кадрах кнопки «на ретушь» и «ещё»', (await page.$$('#cbCards .cp-acts .cp-act-rt')).length >= 1 && (await page.$$('#cbCards .cp-acts .cp-act-more')).length >= 1);
  check('в шапке карточки сразу «На ретушь»', (await page.$$('#cbCards [data-cp-card-retouch]')).length === 1);

  /* действие с карточкой: на ретушь -> копии в <съёмка>/Ретушь/ (папка ретуши не задана) */
  await page.click('#cbCards [data-cp-card-retouch]');
  await page.waitForFunction(() => App.projectMeta.cp.events.some(e => e.action === 'to_retouch'), null, { timeout: 8000 });
  check('ретушь без настройки: копии в <съёмка>/Ретушь/', FILES.has('disk:/Архив/LM-1043/Ретушь/a.jpg'));
  check('ретушь: оригиналы на месте', FILES.has('disk:/Архив/LM-1043/a.jpg'));
  check('бейдж статуса на кадре', (await page.$$('#cbCards .cp-badge.cp-retouch')).length >= 1);
  check('строка статусов', (await page.textContent('#cpStatusLine')).includes('ретушь'));
  check('после отправки в шапке карточки «В ретуши»', (await page.textContent('#cbCards [data-cp-card-retouch]')).trim() === 'В ретуши');

  /* просмотр крупно: двойной клик в галерее, листание, лайк */
  await page.dblclick('#cbTrayGrid .cb-thumb');
  await page.waitForSelector('#cpLb.cp-open', { timeout: 5000 });
  await page.waitForFunction(() => /крупно/.test(document.getElementById('cpLbNote').textContent) && Object.keys(CP.big).length >= 1, null, { timeout: 8000 });
  check('двойной клик в галерее открывает кадр крупно (превью 2400 px)', PREVIEW_CALLS.big >= 1);
  const first = await page.textContent('#cpLbName');
  await page.keyboard.press('ArrowRight');
  check('стрелка листает к следующему кадру', (await page.textContent('#cpLbName')) !== first && (await page.textContent('#cpLbCount')).startsWith('2 /'));
  await page.keyboard.press('l');
  check('L ставит лайк', await page.evaluate(() => Object.keys(cpMeta().likes).length === 1) && (await page.textContent('#cpLb [data-lb="like"]')) === 'Убрать лайк');
  await page.keyboard.press('Escape');
  check('Esc закрывает просмотр', !(await page.$('#cpLb.cp-open')));
  await page.waitForTimeout(500);
  check('лайк виден на кадре в галерее', (await page.$$('#cbTrayGrid .cp-badge.cp-like')).length === 1);
  await page.check('#cpLikedOnly');
  check('фильтр «только лайки»', (await page.$$('#cbTrayGrid .cb-thumb')).length === 1);
  await page.uncheck('#cpLikedOnly');
  await page.waitForFunction(() => !App.dirty, null, { timeout: 8000 });
  check('лайк сохранён в отборе на Диске', Object.keys(JSON.parse(FILES.get('disk:/Архив/LM-1043/_contentpulse.json').toString()).meta.cp.likes || {}).length === 1);
  await page.waitForFunction(() => !App.dirty, null, { timeout: 8000 });
  const saved = JSON.parse(FILES.get('disk:/Архив/LM-1043/_contentpulse.json').toString());
  check('отбор сохранён на Диск: карточка, статусы, журнал с автором',
    saved.cards.length === 1 && Object.keys(saved.meta.cp.status).length >= 1
    && saved.meta.cp.events.some(e => e.action === 'to_retouch' && e.actor === 'Маша'));
  check('превью в файл отбора не попадают', saved.photos.every(p => !p.dataUrl));
  check('копии из Ретушь не попали в галерею', await page.evaluate(() => App.photos.every(p => !/Ретушь/.test(p.disk || ''))));

  /* новая часть съёмки */
  FILES.set('disk:/Архив/LM-1043/part2/d.jpg', process.env.BLOCK_PREVIEW ? png(60, 40) : Buffer.from('D'.repeat(50)));
  await page.evaluate(() => { document.getElementById('cpMenuRefresh').click(); });
  await page.waitForFunction(() => App.photos.length === 4, null, { timeout: 8000 });
  check('обновить съёмку: подтянута новая часть', true);

  /* конфликт: кто-то другой изменил файл отбора */
  const other = JSON.parse(FILES.get('disk:/Архив/LM-1043/_contentpulse.json').toString());
  other.cards[0].title = 'Лук 1 (правка коллеги)';
  FILES.set('disk:/Архив/LM-1043/_contentpulse.json', Buffer.from(JSON.stringify(other)));
  await page.evaluate(() => { App.cards[0].category = 'моя правка'; cbMarkDirty(); cbAutosaveNow(); });
  await page.waitForFunction(() => App.cards[0] && App.cards[0].title === 'Лук 1 (правка коллеги)', null, { timeout: 8000 });
  await page.waitForFunction(() => !App.dirty, null, { timeout: 8000 });
  {
    const st = JSON.parse(FILES.get('disk:/Архив/LM-1043/_contentpulse.json').toString());
    check('конфликт: правки склеены по полям — заголовок коллеги и моя категория', st.cards[0].title === 'Лук 1 (правка коллеги)' && st.cards[0].category === 'моя правка', JSON.stringify([st.cards[0].title, st.cards[0].category]));
  }
  await page.waitForTimeout(300);
  check('конфликт: новая часть съёмки не потерялась', await page.evaluate(() => App.photos.some(p => /d\.jpg$/.test(p.disk || ''))));

  /* журнал */
  await page.evaluate(() => document.getElementById('cpMenuLog').click());
  check('журнал показывает действие', (await page.textContent('#cpLogList')).includes('на ретушь'));

  /* скачивание отбора: подменяем выбор папки на OPFS (настоящая FS API в Chromium) */
  await page.evaluate(() => document.getElementById('cpMenuDlSel').click());
  await page.waitForFunction(() => App.projectMeta.cp.events.some(e => e.action === 'download_selection'), null, { timeout: 10000 });
  await page.waitForTimeout(500);
  const zSel = ZIPS.get('disk:/_ContentPulse/выгрузки/LM-1043_отбор_1.zip') || [];
  check('архив отбора собран прослойкой: папки карточек и порядок', zSel.some(n => /^LM-1043_отбор_1\/01 Лук 1[^/]*\/01_a\.jpg$/.test(n)) && zSel.some(n => /\/02_b\.jpg$/.test(n)), zSel.join(' | '));
  check('архив отбора скачивается обычной загрузкой браузера', DOWNLOADS.some(p => /выгрузки\/LM-1043_отбор_1\.zip$/.test(p)), DOWNLOADS.join(' | '));
  check('ссылку на папку у Яндекса не просим (папки он не отдаёт)', !log.some(l => /resources\/download disk:\/_ContentPulse\/выгрузки\/[^.]*$/.test(l)));

  /* вся съёмка большая: части по размеру */
  await page.evaluate(() => { CP.zipTarget = 250; document.getElementById('cpMenuDlAll').click(); });
  await page.waitForFunction(() => App.projectMeta.cp.events.some(e => e.action === 'download_shoot'), null, { timeout: 10000 });
  const zAll = [...ZIPS.keys()].filter(k => /LM-1043_вся съёмка_1_ч\d+\.zip$/.test(k));
  const allNames = zAll.flatMap(k => ZIPS.get(k));
  check('вся съёмка частями _ч1, _ч2...: все кадры с исходными папками', zAll.length >= 2 && allNames.length === 4 && allNames.some(n => n === 'LM-1043_вся съёмка_1/part2/c.jpg'), zAll.join(' | ') + ' :: ' + allNames.join(' | '));
  check('карточка: кнопка на каждую часть', await page.evaluate(n => document.querySelectorAll('#cpDlCard a.cp-dlcard-btn').length === n, zAll.length));
  await page.evaluate(() => { CP.zipTarget = 400 * 1024 * 1024; });

  /* повторное открытие той же съёмки: отбор читается с Диска */
  await page.evaluate(() => { cpShowShelf(); });
  await page.waitForSelector('.cp-shoot');
  await page.fill('#cpShelfSearch', '1043');
  await page.dblclick('.cp-shoot');
  await page.waitForFunction(() => !document.getElementById('cpShelf').classList.contains('cp-open') && App.cards.length === 1, null, { timeout: 8000 });
  check('повторное открытие: карточки и статусы на месте', await page.evaluate(() => !CP.readOnly && Object.keys(App.projectMeta.cp.status).length >= 1));

  /* отбор не скачивается (как в Safari) — съёмка всё равно открывается, без сохранения */
  process.env.FAIL_STATE_DL = '1';
  await page.evaluate(() => { cpShowShelf(); });
  await page.waitForSelector('.cp-shoot');
  await page.fill('#cpShelfSearch', '1043');
  await page.dblclick('.cp-shoot');
  await page.waitForFunction(() => !document.getElementById('cpShelf').classList.contains('cp-open'), null, { timeout: 20000 });
  const before = FILES.get('disk:/Архив/LM-1043/_contentpulse.json').toString();
  await page.evaluate(() => { cbMarkDirty(); cbAutosaveNow(); });
  await page.waitForTimeout(500);
  check('отбор не прочитан: кадры открыты, режим без сохранения, файл на Диске не тронут',
    await page.evaluate(() => CP.readOnly && App.photos.length >= 4) && FILES.get('disk:/Архив/LM-1043/_contentpulse.json').toString() === before);
  delete process.env.FAIL_STATE_DL;

  /* ---------- панель витрины ---------- */
  await page.evaluate(() => { cpShowShelf(); });
  await page.waitForSelector('.cp-shoot');
  await page.fill('#cpShelfSearch', '1043');
  await page.click('.cp-shoot');
  await page.waitForSelector('#cpPanel.cp-open [data-cp-fold]', { timeout: 10000 });
  check('клик выбирает съёмку, а не открывает: панель справа с папками',
    await page.evaluate(() => document.getElementById('cpShelf').classList.contains('cp-open') && CP.sel && CP.sel.dirs.length === 1));
  check('у папок и всей съёмки — «+» для тега', (await page.$$('#cpPanel [data-cp-addtag]')).length === 2);
  check('что внутри съёмки видно сразу: «на ретуши»', /на ретуши 2/.test(await page.textContent('#cpPanel .cp-fold-all')));
  await page.click('[data-cp-p="mkdict"]');
  await page.waitForFunction(() => CP.dict && CP.dict.length, null, { timeout: 8000 });
  check('словарь тегов создан в служебной папке', FILES.has('disk:/_ContentPulse/теги.txt'));
  await page.click('[data-cp-addtag="part2"]');
  await page.waitForSelector('#cpTagPop.cp-open [data-cp-poptag="Яна"]', { timeout: 5000 });
  check('«+» у папки открывает словарь тегов', true);
  await page.click('#cpTagPop [data-cp-poptag="Яна"]');
  await page.waitForFunction(() => CP.sel && CP.sel.data && CP.sel.data.meta.cp.folderTags.part2, null, { timeout: 8000 });
  await page.check('[data-cp-fold="part2"]');
  check('галочки работают и на скачивании: «Скачать отмеченные», счёт по отмеченным', /Скачать отмеченные/.test(await page.textContent('[data-cp-p="download"]'))
    && /из отмеченных папок: 1/.test(await page.textContent('#cpPanel .cp-sum')) && await page.evaluate(() => cpFiltered(CP.sel).every(x => x.dir === 'part2')));
  check('тег сразу нескольким: выбор появляется, когда отмечены папки', !!(await page.$('#cpAssignTag')) && /Отмеченным \(1\)/.test(await page.textContent('[data-cp-p="assign"]')));
  const st1 = JSON.parse(FILES.get('disk:/Архив/LM-1043/_contentpulse.json').toString());
  check('тег папки записан в отбор на Диске', (st1.meta.cp.folderTags.part2 || []).includes('Яна'));
  await page.selectOption('#cpFTag', 'Яна');
  check('фильтр по тегу папки: только её кадры (наследование)', await page.evaluate(() => cpFiltered(CP.sel).length === 2 && cpFiltered(CP.sel).every(x => x.dir === 'part2')));
  await page.uncheck('[data-cp-fold="part2"]');
  await page.selectOption('#cpFTag', '');
  await page.selectOption('#cpFStatus', 'retouch');
  check('фильтр по статусу «Ретушь»', await page.evaluate(() => cpFiltered(CP.sel).length === 2));
  await page.click('[data-cp-p="download"]');
  await page.waitForFunction(() => CP.sel && CP.sel.data && Object.keys(CP.sel.data.meta.cp.downloads).length === 2, null, { timeout: 10000 });
  const ex1 = ZIPS.get('disk:/_ContentPulse/выгрузки/LM-1043_Ретушь_1.zip') || [];
  check('выгрузка: LM-1043_Ретушь_1.zip, папка карточки, исходные имена файлов', ex1.some(n => /^LM-1043_Ретушь_1\/01 Лук 1[^/]*\/a\.jpg$/.test(n)), [...ZIPS.keys()].join(' | '));
  check('архив выгрузки скачивается обычной загрузкой', DOWNLOADS.some(p => /выгрузки\/LM-1043_Ретушь_1\.zip$/.test(p)));
  check('карточка «Архив готов» с кнопкой «Скачать ZIP»', await page.evaluate(() => {
    const b = document.querySelector('#cpDlCard a.cp-dlcard-btn');
    return !!b && getComputedStyle(document.getElementById('cpDlCard')).display !== 'none' && /LM-1043_%D0%A0|LM-1043_Ретушь_1/.test(decodeURIComponent(b.href)) && b.target === '_blank';
  }));
  check('после скачивания — отметка «скачано», статус не поменялся', await page.evaluate(() => {
    const m = CP.sel.data.meta.cp; return Object.values(m.downloads).every(d => d.n === 1) && Object.values(m.status).every(s => s.s === 'retouch'); }));
  await page.selectOption('#cpFDl', 'no');
  check('фильтр «не скачано» исключает скачанное', await page.evaluate(() => cpFiltered(CP.sel).length === 0));
  await page.selectOption('#cpFDl', '');
  await page.click('[data-cp-p="download"]');
  await page.waitForFunction(() => Object.values(CP.sel.data.meta.cp.downloads).every(d => d.n === 2), null, { timeout: 10000 });
  check('повторное скачивание разрешено: _2 и счётчик ×2', ZIPS.has('disk:/_ContentPulse/выгрузки/LM-1043_Ретушь_2.zip'));
  await page.selectOption('#cpFStatus', '');
  await page.check('[data-cp-fold="part2"]');
  await page.screenshot({ path: path.join(ROOT, 'tests', 'shot-panel.png') });
  await page.uncheck('[data-cp-fold="part2"]');
  await page.click('[data-cp-p="bench"]');
  await page.waitForSelector('#cpDlCard textarea.cp-report', { timeout: 8000 });
  check('замер скорости Диска: отчёт с чтением, параллелью и загрузкой', await page.evaluate(() => {
    const t = document.querySelector('#cpDlCard textarea.cp-report').value;
    return /По одному/.test(t) && /Параллельно 3/.test(t) && /Загрузка на Диск: 8 МБ/.test(t);
  }));
  await page.evaluate(() => { document.getElementById('cpDlCard').style.display = 'none'; });
  check('превью грузятся пачками через прослойку', PREVIEW_CALLS.batch > 0 && PREVIEW_CALLS.single === 0, JSON.stringify(PREVIEW_CALLS));

  /* ---------- папка ретуши из настроек на Диске ---------- */
  await page.click('#cpGear');
  check('настройки спрятаны за шестерёнкой: архив, ретушь, файлы', await page.evaluate(() =>
    !!document.querySelector('#cpSettings.cp-open #cpArchiveInput') && !!document.querySelector('#cpSettings #cpRetouchInput')
    && document.querySelectorAll('#cpSettings [data-cp-setfile]').length === 3 && !document.querySelector('#cpShelfBar #cpArchiveInput')));
  await page.screenshot({ path: path.join(ROOT, 'tests', 'shot-settings.png') });
  await page.fill('#cpRetouchInput', 'Архив/РЕТУШЬ');
  await page.click('#cpRetouchApply');
  await page.waitForFunction(() => CP.settings && CP.settings.retouch === 'disk:/Архив/РЕТУШЬ', null, { timeout: 8000 });
  const setTxt = (FILES.get('disk:/_ContentPulse/настройки.txt') || '').toString();
  check('настройка ретуши записана в _ContentPulse/настройки.txt', /^ретушь = disk:\/Архив\/РЕТУШЬ$/m.test(setTxt) && /# ретушь —/.test(setTxt), setTxt.slice(-80));
  await page.dblclick('.cp-shoot');
  await page.waitForFunction(() => CP.shoot && !document.getElementById('cpShelf').classList.contains('cp-open') && App.photos.length >= 4, null, { timeout: 10000 });
  await page.evaluate(() => { const p = App.photos.find(x => /part2\/c\.jpg$/.test(x.disk || '')); cpDoAction('retouch', [p.id]); });
  await page.waitForFunction(() => App.projectMeta.cp.events.some(e => e.action === 'to_retouch' && /РЕТУШЬ/.test(e.folder || '')), null, { timeout: 8000 });
  check('ретушь с настройкой: <папка ретуши>/<съёмка>/<исходная папка>/<имя>', FILES.has('disk:/Архив/РЕТУШЬ/LM-1043/part2/c.jpg'));
  await page.evaluate(() => cpShowShelf());
  await page.fill('#cpShelfSearch', '');
  await page.waitForFunction(() => document.querySelectorAll('.cp-shoot').length >= 2);
  check('папка ретуши в архиве не показывается как съёмка', await page.evaluate(() =>
    CP.shoots.some(s => s.name === 'РЕТУШЬ') && [...document.querySelectorAll('.cp-shoot')].every(b => b.dataset.name !== 'РЕТУШЬ')));
  await page.fill('#cpShelfSearch', '1043');

  /* ---------- структура съёмок из файла на Диске ---------- */
  await page.click('#cpGear');
  await page.click('#cpSettings [data-cp-setfile="1"]');
  await page.waitForFunction(() => /\[Модельная\]/.test(document.getElementById('cpFilesText').value), null, { timeout: 8000 });
  await page.click('[data-cp-f="save"]');
  await page.waitForFunction(() => CP.rules && CP.rules.length === 3, null, { timeout: 8000 });
  check('структура.txt создана из редактора и прочитана', FILES.has('disk:/_ContentPulse/структура.txt'));
  await page.click('[data-cp-f="close"]');
  await page.fill('#cpShelfSearch', 'МОДЕЛЬ');
  await page.click('.cp-shoot');
  await page.waitForSelector('#cpPanel.cp-open [data-cp-fold]', { timeout: 10000 });
  check('тип съёмки по названию виден на панели', (await page.textContent('#cpPanel .cp-panel-head small')).includes('Модельная'));
  await page.dblclick('.cp-shoot');
  await page.waitForFunction(() => CP.shoot && /МОДЕЛЬ/.test(CP.shoot.name) && App.photos.length === 3 && !document.getElementById('cpShelf').classList.contains('cp-open'), null, { timeout: 10000 });
  /* карточки товара по папкам артикулов — по кнопке, пустая папка — пустая карточка */
  await page.waitForTimeout(600);
  check('карточки товара сами не появляются — есть кнопка «Собрать карточки по папкам»', await page.evaluate(() =>
    App.cards.filter(c => c.cpAuto).length === 0 && !!document.querySelector('#cbCards .cp-collect')));
  await page.click('#cbCards .cp-collect');
  await page.waitForFunction(() => App.cards.filter(c => c.cpAuto).length === 3, null, { timeout: 8000 });
  await page.evaluate(() => { document.querySelector('#cbCards .cb-card[data-cid="' + App.cards.find(c => c.title === '74595').id + '"]').click(); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(ROOT, 'tests', 'shot-collect.png') });
  check('на каждую папку артикула — своя карточка товара с её кадрами', await page.evaluate(() => {
    var by = {}; App.cards.filter(c => c.cpAuto).forEach(c => { by[c.title] = cpCardPids(c).map(pid => cbPhotoById(pid).name); });
    return by['74595'] && by['74595'].join() === 'manekin.jpg' && by['74596'] && by['74596'].join() === 'manekin2.jpg' && by['74598'] && by['74598'].length === 0;
  }), JSON.stringify(await page.evaluate(() => App.cards.map(c => [c.title, cpCardPids(c).length]))));
  check('у карточки товара нет кнопки «Удалить» (удалять карточки товара: нет)', await page.evaluate(() => {
    var el = document.querySelector('#cbCards .cb-card[data-cid="' + App.cards.find(c => c.title === '74598').id + '"]');
    var del = el.querySelector('[data-act="del"]');
    var n = App.cards.length;
    del.click();
    return del.style.display === 'none' && App.cards.length === n;
  }));
  await page.evaluate(() => {
    var c = App.cards.find(x => x.title === '74596');
    c.pids = [];
    cbMarkDirty(); cbRenderCards();
  });
  await page.evaluate(() => cpSyncPhotos(false));
  await page.click('#cbCards .cp-collect');
  check('повторная сборка: дублей нет, убранный руками кадр не возвращается', await page.evaluate(() =>
    App.cards.filter(c => c.cpAuto).length === 3 && App.cards.find(x => x.title === '74596').pids.length === 0));
  /* галерея следует за карточкой: только её лук; галочка «по карточке» — выключить */
  await page.evaluate(() => { document.querySelector('#cbCards .cb-card[data-cid="' + App.cards.find(c => c.title === '74598').id + '"]').click(); });
  await page.waitForFunction(() => CP.folder === '1' && CP.folderByCard, null, { timeout: 3000 }).catch(() => {});
  check('нажал на карточку — в галерее только её лук, карточка выделена', await page.evaluate(() =>
    CP.folder === '1' && document.getElementById('cpFolderFilter').value === '1' && !!document.querySelector('#cbCards .cb-card.cp-card-active')),
    await page.evaluate(() => JSON.stringify([CP.folder, CP.folderByCard, CP.activeCard])));
  await page.uncheck('#cpFollowCard');
  check('галочка «по карточке» снята — галерея показывает всё', await page.evaluate(() => CP.folder === '' && document.getElementById('cpFolderFilter').value === ''));
  await page.evaluate(() => { document.querySelector('#cbCards .cb-card[data-cid="' + App.cards.find(c => c.title === '74595').id + '"]').click(); });
  await page.waitForTimeout(100);
  check('без галочки нажатие на карточку галерею не переключает', await page.evaluate(() => CP.folder === ''));
  await page.check('#cpFollowCard');
  await page.evaluate(() => { CP.folder = ''; CP.folderByCard = false; cbRenderTray(); });
  await page.click('#cbCards .cb-card[data-cid="' + (await page.evaluate(() => App.cards.find(c => c.title === '74595').id)) + '"] [data-cp-card-brak]');
  check('«В брак» на карточке — пересъём для карточки и её кадров', await page.evaluate(() => {
    var c = App.cards.find(x => x.title === '74595'), m = cpMeta();
    return m.cardStatus[c.id].s === 'reshoot' && cpCardPids(c).every(pid => m.status[pid].s === 'reshoot') && !!document.querySelector('#cbCards .cp-badge.cp-reshoot');
  }));
  await page.evaluate(() => {
    var tpl = App.templates[0];
    cbAddCardFromTpl(tpl.id);
    var c = App.cards[App.cards.length - 1];
    var man = App.photos.find(p => /74595_модель/.test(p.disk)), model = App.photos.find(p => /IMG_0101/.test(p.disk));
    if (c.mode === 'auto') c.pids = [model.id, man.id];
    else { c.slots[0].pid = model.id; if (c.slots[1]) c.slots[1].pid = man.id; else c.slots[0].pid = man.id; }
    cbMarkDirty(); cbRenderCards();
  });
  check('обтравка из папки артикула ставит карточке артикул', await page.evaluate(() => {
    var c = App.cards[App.cards.length - 1];
    return c.title === '74595' && c.cpArticle === '74595' && !!document.querySelector('#cbCards .cp-art');
  }));
  await page.evaluate(() => {
    var c = App.cards[App.cards.length - 1];
    var m2 = App.photos.find(p => /74596_модель/.test(p.disk));
    if (c.mode === 'auto') c.pids.push(m2.id); else { var s = c.slots.find(x => !x.pid) || c.slots[c.slots.length - 1]; s.pid = m2.id; }
    cbMarkDirty(); cbRenderCards();
  });
  check('кадры двух артикулов в карточке — предупреждение, а не выбор молча', await page.evaluate(() => {
    var c = App.cards[App.cards.length - 1];
    return /74595/.test(c.cpArticle) && /74596/.test(c.cpArticle) && !!document.querySelector('#cbCards .cp-art-warn');
  }));
  await page.evaluate(() => {
    var c = App.cards[App.cards.length - 1];
    c.title = 'Мой заголовок';
    cbMarkDirty(); cbRenderCards();
  });
  check('пока состав карточки тот же, ручной заголовок остаётся', await page.evaluate(() => App.cards[App.cards.length - 1].title === 'Мой заголовок'));
  await page.evaluate(() => {
    var c = App.cards[App.cards.length - 1];
    var m2 = App.photos.find(p => /74596_модель/.test(p.disk));
    if (c.mode === 'auto') c.pids = c.pids.filter(x => x !== m2.id); else c.slots.forEach(x => { if (x.pid === m2.id) x.pid = null; });
    cbMarkDirty(); cbRenderCards();
  });
  check('состав артикулов поменялся — карточка снова называется по артикулу', await page.evaluate(() => App.cards[App.cards.length - 1].title === '74595'));
  check('в строке съёмки виден тип', (await page.textContent('#cpStatusLine')).includes('Модельная'));
  check('лишний уровень папок не мешает найти артикул по коду', await page.evaluate(() => {
    var t = cpShootType(CP.shoot.name);
    return cpFacets(t, 'часть 1/2/74597_модель/x.jpg').code === '74597' && !cpFacets(t, '2/IMG_1.jpg').code;
  }));
  await page.waitForFunction(() => !App.dirty, null, { timeout: 8000 });
  const stM = JSON.parse(FILES.get('disk:/Архив/2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST/_contentpulse.json').toString());
  check('у карточки записана папка артикула', stM.cards.some(c => c.cpArticleDir === '1/74595_модель'));
  check('артикул карточки сохранён в отборе', stM.cards.some(c => c.cpArticle === '74595'), JSON.stringify(stM.cards.map(c => [c.title, c.cpArticle])));

  /* ретушь модельки: <папка ретуши>/<съёмка>/<лук>/<артикул>/; кадр из корня лука — в папку артикула своей карточки */
  const RT = 'disk:/Архив/РЕТУШЬ/2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST/';
  await page.evaluate(() => { var c = App.cards[App.cards.length - 1]; cpDoAction('retouch', cpCardPids(c), c.id); });
  await page.waitForFunction(() => App.projectMeta.cp.events.some(e => e.action === 'to_retouch' && e.card === '74595'), null, { timeout: 8000 });
  check('на ретушь: папка съёмки, лук и артикул созданы сами; кадр лука — в папке артикула карточки',
    FILES.has(RT + '1/74595_модель/IMG_0101.jpg') && FILES.has(RT + '1/74595_модель/manekin.jpg') && !FILES.has(RT + '1/IMG_0101.jpg'),
    [...FILES.keys()].filter(k => k.indexOf(RT) === 0).join(' | '));
  /* не скопировалось — видно в строке съёмки, «докопировать» дотягивает */
  FAIL_COPY = /manekin2/;
  await page.evaluate(() => { var c = App.cards.find(x => x.title === '74596'); c.pids.push(App.photos.find(p => /manekin2/.test(p.disk)).id); cpDoAction('retouch', cpCardPids(c), c.id); });
  await page.waitForSelector('#cpRetouchMissing', { timeout: 8000 }).catch(() => {});
  check('не скопировалось на ретушь — в строке съёмки «не скопировано: 1 — докопировать»', /не скопировано на ретушь: 1/.test(await page.textContent('#cpStatusLine')), await page.textContent('#cpStatusLine'));
  FAIL_COPY = null;
  await page.click('#cpRetouchMissing');
  await page.waitForFunction(() => !document.getElementById('cpRetouchMissing'), null, { timeout: 8000 }).catch(() => {});
  check('«докопировать»: кадр в папке ретуши, предупреждение ушло', FILES.has(RT + '1/74596_модель/manekin2.jpg') && !(await page.$('#cpRetouchMissing')));
  /* сверка: копию в папке ретуши удалили — «Сверить папку ретуши» кладёт заново, остальное не трогает */
  FILES.delete(RT + '1/74595_модель/manekin.jpg');
  await page.evaluate(() => document.getElementById('cpMenuRetouchSync').click());
  await page.waitForFunction(() => App.projectMeta.cp.events.some(e => e.action === 'retouch_sync' && /скопировано 1, уже было 2/.test(e.note || '')), null, { timeout: 8000 }).catch(() => {});
  check('«Сверить папку ретуши»: недостающее докопировано, остальное — «уже было»', FILES.has(RT + '1/74595_модель/manekin.jpg'),
    JSON.stringify(await page.evaluate(() => App.projectMeta.cp.events.filter(e => e.action === 'retouch_sync').map(e => e.note))));

  /* все файлы: видео тоже уходит в архив */
  await page.waitForFunction(() => !App.dirty && !CP.saving, null, { timeout: 8000 });
  await page.evaluate(() => cpShowShelf());
  await page.fill('#cpShelfSearch', 'МОДЕЛЬ');
  await page.click('.cp-shoot');
  await page.waitForSelector('#cpPanel.cp-open #cpFAll', { timeout: 10000 });
  await page.evaluate(() => { CP.directMin = 400; CP.directPart = 200; });   /* clip.mp4 (500 байт) — «крупный» */
  await page.selectOption('#cpFAll', 'all');
  await page.waitForFunction(() => CP.sel && CP.sel.allList && /других файлов: 1/.test(document.querySelector('#cpPanel .cp-sum').textContent), null, { timeout: 8000 });
  check('«Все файлы»: видео посчитано, мусор (.DS_Store) — нет', true);
  await page.click('[data-cp-p="download"]');
  await page.waitForFunction(() => [...document.querySelectorAll('#cpDlCard a.cp-dlcard-btn')].some(a => a.textContent === 'clip.mp4'), null, { timeout: 10000 });
  for (let i = 0; i < 30 && !DOWNLOADS.some(p => /видео\/clip\.mp4$/.test(p)); i++) await page.waitForTimeout(100);
  check('крупное видео — отдельной ссылкой, перенесено частями и скачивается', MPU_PARTS.length === 3 && DOWNLOADS.some(p => /видео\/clip\.mp4$/.test(p)), MPU_PARTS.join(',') + ' :: ' + DOWNLOADS.slice(-3).join(' | '));
  await page.evaluate(() => { CP.directMin = 200 * 1024 * 1024; CP.directPart = 256 * 1024 * 1024; });
  const zVid = [...ZIPS.entries()].filter(([k]) => /МОДЕЛЬ_МУЖ_TEST_1\.zip$/.test(k)).flatMap(([, v]) => v);
  check('карточка артикула в выгрузке — исходная папка артикула с луком', zVid.some(n => /_1\/1\/74595_модель\/IMG_0101\.jpg$/.test(n)) && zVid.some(n => /_1\/1\/74595_модель\/manekin\.jpg$/.test(n)), zVid.join(' | '));
  check('«Все файлы»: кадры в архиве, видео в архив не попало', !zVid.some(n => /clip\.mp4$/.test(n)) && zVid.filter(n => /\.jpg$/.test(n)).length === 3, zVid.join(' | '));

  /* дерево папок на панели: раскрыть до последнего уровня, отметить одну вложенную, статусы вложенных */
  await page.selectOption('#cpFAll', '');
  check('папки с вложенными — кнопка «папок: N», вложенные скрыты', await page.evaluate(() =>
    /папок: 3/.test(document.querySelector('[data-cp-exp="1"]').textContent) && !document.querySelector('[data-cp-fold="1/74595_модель"]')));
  await page.click('[data-cp-exp="1"]');
  check('раскрыл лук: артикулы со счётом и статусами (на ретуши), пустая папка — тоже', await page.evaluate(() => {
    var row = n => document.querySelector('[data-cp-fold="' + n + '"]').closest('.cp-fold');
    return /на ретуши 2/.test(row('1/74595_модель').textContent) && /· 2/.test(row('1/74595_модель').textContent) && /· 0/.test(row('1/74598_модель').textContent) && /на ретуши 1/.test(row('1/74596_модель').textContent);
  }), await page.evaluate(() => [...document.querySelectorAll('#cpPanel .cp-fold-sub')].map(r => r.textContent).join(' | ')));
  await page.check('[data-cp-fold="1/74596_модель"]');
  check('отмечена вложенная папка — в скачивание идёт только она', /Будет скачано: 1 из 3/.test(await page.textContent('#cpPanel .cp-sum')), await page.textContent('#cpPanel .cp-sum'));
  await page.check('[data-cp-fold="1"]');
  check('отметил лук — вложенные отмечены вместе с ним и заблокированы', await page.evaluate(() =>
    document.querySelector('[data-cp-fold="1/74596_модель"]').checked && document.querySelector('[data-cp-fold="1/74596_модель"]').disabled && !CP.sel.folders['1/74596_модель']));
  await page.uncheck('[data-cp-fold="1"]');
  await page.check('[data-cp-fold="1/74595_модель"]');
  const zipsBefore = ZIPS.size;
  await page.click('[data-cp-p="download"]');
  await page.waitForFunction(n => window.__zipsDone === undefined || true, zipsBefore);
  await page.waitForTimeout(1500);
  const zSub = [...ZIPS.entries()].filter(([k]) => /МОДЕЛЬ_МУЖ_TEST_2\.zip$/.test(k)).flatMap(([, v]) => v);
  check('«Скачать отмеченные» по вложенной папке: в архиве только её кадры', zSub.length === 2 && zSub.every(n => /74595_модель\//.test(n)), zSub.join(' | '));
  await page.screenshot({ path: path.join(ROOT, 'tests', 'shot-tree-open.png') });
  await page.click('[data-cp-p="expall"]');
  check('«свернуть все» сворачивает дерево', await page.evaluate(() => !document.querySelector('[data-cp-fold="1/74595_модель"]')));
  check('у свёрнутой папки видно, что внутри отмечено', /отмечено 1/.test(await page.textContent('[data-cp-exp="1"]')));
  await page.screenshot({ path: path.join(ROOT, 'tests', 'shot-tree.png') });

  /* оптика: выгрузка как в папках */
  await page.evaluate(() => cpShowShelf());
  await page.fill('#cpShelfSearch', 'ОПТИКА');
  await page.click('.cp-shoot');
  await page.waitForSelector('#cpPanel.cp-open [data-cp-fold]', { timeout: 10000 });
  check('оптика: тип и «выгрузка как в папках» на панели', /Оптика, выгрузка как в папках/.test(await page.textContent('#cpPanel .cp-panel-head small')));
  await page.click('[data-cp-p="download"]');
  await page.waitForFunction(() => [...document.querySelectorAll('#cpDlCard a.cp-dlcard-btn')].some(a => /ОПТИКА/.test(decodeURIComponent(a.href))), null, { timeout: 10000 });
  const zOpt = ZIPS.get('disk:/_ContentPulse/выгрузки/2026-09-21_SV_ОПТИКА_N_1.zip') || [];
  check('оптика: в архиве исходные папки бренда и артикула', zOpt.includes('2026-09-21_SV_ОПТИКА_N_1/maxmara_оптика/75327_оптика_N/s1.jpg'), [...ZIPS.keys()].join(' | ') + ' :: ' + zOpt.join(' | '));
  await page.fill('#cpShelfSearch', '1043');

  /* ---------- отбор после ретуши и скачивания ---------- */
  await page.evaluate(() => cpShowShelf());
  await page.fill('#cpShelfSearch', '1043');
  await page.dblclick('.cp-shoot');
  await page.waitForFunction(() => CP.shoot && CP.shoot.name === 'LM-1043' && !document.getElementById('cpShelf').classList.contains('cp-open') && App.cards.length, null, { timeout: 10000 });
  await page.waitForTimeout(300);
  const g = await page.evaluate(() => {
    var c = App.cards[0], m = cpMeta();
    var a = App.photos.find(p => /\/a\.jpg$/.test(p.disk));
    return { a: a.id, dl: (m.downloads[a.id] || {}).n || 0, st: (m.status[a.id] || {}).s, cst: (m.cardStatus[c.id] || {}).s, mode: c.mode };
  });
  check('исходное: кадр a скачан и на ретуши, карточка на ретуши', g.dl >= 1 && g.st === 'retouch' && g.cst === 'retouch', JSON.stringify(g));
  await page.evaluate(() => {
    var c = App.cards[0];
    var a = App.photos.find(p => /\/a\.jpg$/.test(p.disk));
    if (c.mode === 'auto') c.pids = c.pids.filter(x => x !== a.id); else c.slots.forEach(s => { if (s.pid === a.id) s.pid = null; });
    cbMarkDirty(); cbRenderCards();
  });
  check('убрали скачанный кадр — «Удалено из отбора», карточка «изменена после скачивания»', await page.evaluate(() => {
    var a = App.photos.find(p => /\/a\.jpg$/.test(p.disk));
    return cpMeta().status[a.id].s === 'removed' && !!App.cards[0].cpChangedAfterDl && !!document.querySelector('#cbCards .cp-card-warn');
  }));
  await page.evaluate(() => {
    var c = App.cards[0];
    var d = App.photos.find(p => /\/d\.jpg$/.test(p.disk));
    if (c.mode === 'auto') c.pids.push(d.id); else { var s = c.slots.find(x => !x.pid); s.pid = d.id; }
    cbMarkDirty(); cbRenderCards();
  });
  await page.waitForFunction(() => {
    var d = App.photos.find(p => /\/d\.jpg$/.test(p.disk));
    return cpMeta().status[d.id] && cpMeta().status[d.id].s === 'retouch';
  }, null, { timeout: 8000 });
  check('добавили в карточку на ретуши — кадр сам ушёл на ретушь (и копия)', FILES.has('disk:/Архив/РЕТУШЬ/LM-1043/part2/d.jpg'));
  check('журнал: изменение после скачивания и удалённое', await page.evaluate(() => {
    var ev = cpMeta().events.map(e => e.action);
    return ev.includes('changed_after_download') && ev.includes('removed_after_download') && ev.includes('added_to_retouch_card');
  }));
  /* убрали из карточки — статус, полученный от неё, снимается; брак остаётся; в другой карточке на ретуши — ретушь */
  const gs = await page.evaluate(() => {
    var tpl = App.templates[0];
    cbAddCardFromTpl(tpl.id); var A = App.cards[App.cards.length - 1];
    cbAddCardFromTpl(tpl.id); var B = App.cards[App.cards.length - 1];
    var b = App.photos.find(p => /\/b\.jpg$/.test(p.disk)), c = App.photos.find(p => /\/c\.jpg$/.test(p.disk));
    var put = (card, ids) => { if (card.mode === 'auto') card.pids = ids.slice(); else ids.forEach((id, i) => { if (card.slots[i]) card.slots[i].pid = id; }); };
    var take = (card, id) => { if (card.mode === 'auto') card.pids = card.pids.filter(x => x !== id); else card.slots.forEach(s => { if (s.pid === id) s.pid = null; }); };
    put(A, [b.id, c.id]); cbMarkDirty(); cbRenderCards();
    cpDoAction('approval', [b.id], A.id);
    cpDoAction('reshoot', [c.id], A.id);
    var before = [cpMeta().status[b.id] && cpMeta().status[b.id].s, cpMeta().status[c.id] && cpMeta().status[c.id].s];
    take(A, b.id); take(A, c.id); cbMarkDirty(); cbRenderCards();
    var after = [cpMeta().status[b.id] ? cpMeta().status[b.id].s : '', cpMeta().status[c.id] ? cpMeta().status[c.id].s : ''];
    /* кадр на согласовании в карточке A переносим в карточку B, которая на ретуши */
    put(A, [b.id]); cbMarkDirty(); cbRenderCards();
    cpDoAction('approval', [b.id], A.id);
    cpSetStatus([], 'retouch', B.id); cbMarkDirty(); cbRenderCards();
    take(A, b.id); put(B, [b.id]); cbMarkDirty(); cbRenderCards();
    return { before, after, A: A.id, B: B.id, b: b.id };
  });
  check('убрали из карточки: «на согласовании» снято, брак остался', gs.before.join() === 'approval,reshoot' && gs.after.join() === ',reshoot', JSON.stringify(gs));
  await page.waitForFunction(b => cpMeta().status[b] && cpMeta().status[b].s === 'retouch', gs.b, { timeout: 8000 }).catch(() => {});
  check('перенесли в карточку на ретуши — статус прежней карточки снят, кадр ушёл на ретушь', await page.evaluate(x => cpMeta().status[x.b].s === 'retouch' && cpMeta().status[x.b].card === x.B, gs));
  await page.evaluate(x => { App.cards = App.cards.filter(c => c.id !== x.A && c.id !== x.B); delete cpMeta().cardStatus[x.B]; cbMarkDirty(); cbRenderCards(); }, gs);

  /* теги словаря прямо на шапке карточки; в группе «один» — один тег */
  await page.evaluate(() => { CP.dict = cpParseDict('[Ретушёры: один]\nY\nU\n[Срочность]\nСрочно\n[Служебные: не в карточке]\nтест'); cbRenderCards(); });
  check('на шапке карточки все теги словаря, кроме групп «не в карточке»', await page.evaluate(() => {
    var b = [...document.querySelectorAll('#cbCards .cb-card:first-child [data-cp-cardtag]')].map(x => x.getAttribute('data-cp-cardtag'));
    return ['Y', 'U', 'Срочно'].every(t => b.includes(t)) && !b.includes('тест');
  }));
  await page.click('#cbCards .cb-card:first-child [data-cp-cardtag="Y"]');
  await page.click('#cbCards .cb-card:first-child [data-cp-cardtag="U"]');
  await page.click('#cbCards .cb-card:first-child [data-cp-cardtag="Срочно"]');
  check('нажал — тег стоит; в группе «один» выбранный заменяет прежний', await page.evaluate(() => {
    var t = App.cards[0].tags || [];
    return t.includes('U') && !t.includes('Y') && t.includes('Срочно') && !!document.querySelector('#cbCards .cb-card:first-child .cp-tg-on[data-cp-cardtag="U"]');
  }), JSON.stringify(await page.evaluate(() => App.cards[0].tags)));
  await page.locator('#cbCards .cb-card').first().locator('.cb-card-head').screenshot({ path: path.join(ROOT, 'tests', 'shot-cardhead.png') });
  await page.click('#cbCards .cb-card:first-child [data-cp-cardtag="Срочно"]');
  check('повторное нажатие снимает тег', await page.evaluate(() => !(App.cards[0].tags || []).includes('Срочно')));
  /* большой «+» */
  const nCards = await page.evaluate(() => App.cards.length);
  await page.click('#cbCards .cp-addcard:not(.cp-collect)');
  check('большой «+» в поле карточек создаёт карточку-автоленту', await page.evaluate(n => App.cards.length === n + 1 && App.cards[App.cards.length - 1].mode === 'auto', nCards));
  await page.evaluate(() => { var b = App.photos.find(p => /\/b\.jpg$/.test(p.disk)); cpAddAutoCard(b.id); });
  check('кадр, брошенный на «+», сразу в новой карточке', await page.evaluate(() => App.cards[App.cards.length - 1].pids.length === 1));
  await page.waitForFunction(() => !App.dirty, null, { timeout: 8000 });

  /* ---------- надёжное сохранение ---------- */
  check('в строке съёмки видно, что отбор сохранён', /сохранено \d\d:\d\d/.test(await page.textContent('#cpStatusLine')), await page.textContent('#cpStatusLine'));
  const SP = 'disk:/Архив/LM-1043/_contentpulse.json';
  const SNAPDIR = 'disk:/_ContentPulse/версии отборов/LM-1043/';
  check('перед записью отбора сохранилась его версия в «версии отборов»', [...FILES.keys()].some(k => k.indexOf(SNAPDIR) === 0 && /\.json$/.test(k)),
    [...FILES.keys()].filter(k => /версии/.test(k)).join(' | '));
  /* кто-то другой успел сохранить отбор: добавил свою карточку */
  {
    const other = JSON.parse(FILES.get(SP).toString());
    const c0 = JSON.parse(JSON.stringify(other.cards[0]));
    c0.id = 'ext1'; c0.title = 'Чужая карточка'; c0.pids = []; (c0.slots || []).forEach(s => s.pid = null);
    other.cards.push(c0);
    FILES.set(SP, Buffer.from(JSON.stringify(other)));
  }
  await page.evaluate(() => { App.cards[0].title = 'Моя правка'; cbMarkDirty(); cbAutosaveNow(); });
  await page.waitForFunction(() => !App.dirty && App.cards.some(c => c.title === 'Чужая карточка'), null, { timeout: 10000 }).catch(() => {});
  {
    const st = JSON.parse(FILES.get(SP).toString());
    check('конфликт: версии склеены — и моя правка, и чужая карточка на Диске', st.cards.some(c => c.title === 'Моя правка') && st.cards.some(c => c.title === 'Чужая карточка'),
      JSON.stringify(st.cards.map(c => c.title)));
    check('конфликт записан в журнал', st.meta.cp.events.some(e => e.action === 'merged'));
  }
  /* правки не успели сохраниться (закрыли вкладку) — при открытии возвращаются */
  await page.evaluate(() => {
    var d = cbProjectData();
    var c = JSON.parse(JSON.stringify(d.cards[0])); c.id = 'bak1'; c.title = 'Из копии в браузере';
    d.cards.push(c);
    cpBackupSave(CP.shoot.path, d, CP.rev);
  });
  await page.evaluate(() => cpShowShelf());
  await page.fill('#cpShelfSearch', 'МОДЕЛЬ');
  await page.dblclick('.cp-shoot');
  await page.waitForFunction(() => CP.shoot && /МОДЕЛЬ/.test(CP.shoot.name) && !document.getElementById('cpShelf').classList.contains('cp-open'), null, { timeout: 10000 });
  await page.evaluate(() => cpShowShelf());
  await page.fill('#cpShelfSearch', '1043');
  await page.dblclick('.cp-shoot');
  await page.waitForFunction(() => CP.shoot && CP.shoot.name === 'LM-1043' && App.cards.some(c => c.title === 'Из копии в браузере') && !App.dirty, null, { timeout: 10000 }).catch(() => {});
  check('несохранённые правки из браузера восстановлены и записаны на Диск', JSON.parse(FILES.get(SP).toString()).cards.some(c => c.title === 'Из копии в браузере')
    && await page.evaluate(() => !localStorage.getItem('cp_bak:' + CP.shoot.path)));
  /* версии: сохранить сейчас, поправить, вернуть */
  await page.evaluate(() => document.getElementById('cpMenuVersions').click());
  await page.waitForSelector('#cpVers.cp-open', { timeout: 3000 });
  await page.waitForTimeout(1100);
  await page.click('#cpVersNow');
  await page.waitForFunction(() => document.querySelectorAll('#cpVersList [data-cp-vers]').length >= 2, null, { timeout: 8000 });
  await page.click('#cpVersClose');
  await page.waitForTimeout(1100);
  await page.evaluate(() => { App.cards[0].title = 'После версии'; cbMarkDirty(); cbAutosaveNow(); });
  await page.waitForFunction(() => !App.dirty, null, { timeout: 8000 });
  check('правка после версии на Диске', JSON.parse(FILES.get(SP).toString()).cards[0].title === 'После версии');
  await page.evaluate(() => document.getElementById('cpMenuVersions').click());
  await page.waitForFunction(() => document.querySelectorAll('#cpVersList [data-cp-vers]').length >= 2, null, { timeout: 8000 });
  page.once('dialog', d => d.accept());
  await page.click('#cpVersList [data-cp-vers]');
  await page.waitForFunction(() => App.cards[0].title !== 'После версии' && !App.dirty, null, { timeout: 10000 }).catch(() => {});
  {
    const st = JSON.parse(FILES.get(SP).toString());
    const snaps = [...FILES.keys()].filter(k => k.indexOf(SNAPDIR) === 0).sort();
    const lastSnap = JSON.parse(FILES.get(snaps[snaps.length - 1]).toString());
    check('«Вернуть»: отбор на Диске — как в версии, правка после неё ушла', st.cards[0].title === 'Моя правка' && st.cards.some(c => c.title === 'Из копии в браузере'), JSON.stringify(st.cards.map(c => c.title)));
    check('перед возвратом текущий отбор тоже сохранён версией', lastSnap.cards[0].title === 'После версии', snaps.join(' | '));
    check('возврат версии — в журнале', st.meta.cp.events.some(e => e.action === 'restore_version'));
  }
  await page.screenshot({ path: path.join(ROOT, 'tests', 'shot-versions.png') });

  /* служебная папка рядом с архивом: КАТАЛОГ/_ContentPulse, настройки переезжают из корня */
  await page.evaluate(() => cpShowShelf());
  await page.click('#cpGear');
  await page.fill('#cpArchiveInput', 'КАТАЛОГ/00_АРХИВ');
  await page.click('#cpArchiveApply');
  await page.waitForFunction(() => CP_CONFIG.serviceDir === 'disk:/КАТАЛОГ/_ContentPulse' && CP.dict && CP.dict.length, null, { timeout: 10000 });
  check('служебная папка — рядом с архивом, в КАТАЛОГ', await page.evaluate(() => /КАТАЛОГ\/_ContentPulse/.test(document.getElementById('cpSetServiceDir').textContent)));
  check('файлы настроек скопированы из корня в КАТАЛОГ/_ContentPulse', ['теги.txt', 'структура.txt', 'настройки.txt'].every(n => FILES.has('disk:/КАТАЛОГ/_ContentPulse/' + n)) && FILES.has('disk:/_ContentPulse/теги.txt'),
    [...FILES.keys()].filter(k => /КАТАЛОГ/.test(k)).join(' | '));
  /* общий диск Яндекс 360: вставили адрес из браузера — витрина, съёмка, отбор, ретушь идут через /virtual-disks */
  await page.fill('#cpShelfSearch', '');
  await page.fill('#cpArchiveInput', 'https://disk.yandex.ru/client/aa/d_TESTVD/01_%D0%98%D0%A1%D0%A5%D0%9E%D0%94%D0%9D%D0%98%D0%9A%D0%98');
  await page.click('#cpArchiveApply');
  await page.waitForFunction(() => CP.archive === 'vd:TESTVD:disk:/01_ИСХОДНИКИ' && [...document.querySelectorAll('.cp-shoot')].some(b => b.dataset.name === '2026-11-06_SV_ПРЕДМЕТКА_VD'), null, { timeout: 10000 }).catch(() => {});
  check('общий диск: адрес …/client/aa/d_<метка>/… понят, съёмки на витрине', await page.evaluate(() =>
    CP.archive === 'vd:TESTVD:disk:/01_ИСХОДНИКИ' && [...document.querySelectorAll('.cp-shoot')].some(b => b.dataset.name === '2026-11-06_SV_ПРЕДМЕТКА_VD')),
    await page.evaluate(() => CP.archive + ' :: ' + document.getElementById('cpShelfList').textContent.slice(0, 200)));
  await page.waitForFunction(() => CP_CONFIG.serviceDir === 'vd:TESTVD:disk:/_ContentPulse' && CP.dict && CP.dict.length, null, { timeout: 10000 }).catch(() => {});
  check('общий диск: служебная папка рядом с архивом, теги и структура переехали, папка ретуши — нет',
    FILES.has('vd:TESTVD:disk:/_ContentPulse/теги.txt') && FILES.has('vd:TESTVD:disk:/_ContentPulse/структура.txt') && !FILES.has('vd:TESTVD:disk:/_ContentPulse/настройки.txt')
    && /Общий диск\/_ContentPulse/.test(await page.textContent('#cpSetServiceDir')),
    [...FILES.keys()].filter(k => /^vd:/.test(k)).join(' | ') + ' :: ' + await page.textContent('#cpSetServiceDir'));
  await page.keyboard.press('Escape');
  await page.fill('#cpShelfSearch', 'VD');
  await page.dblclick('.cp-shoot');
  await page.waitForFunction(() => CP.shoot && /ПРЕДМЕТКА_VD/.test(CP.shoot.name) && App.photos.filter(p => p.dataUrl).length === 2, null, { timeout: 10000 }).catch(() => {});
  check('общий диск: съёмка открылась, кадры и превью есть', await page.evaluate(() => App.photos.filter(p => p.dataUrl).length === 2 && App.photos.every(p => /^vd:TESTVD:disk:\//.test(p.disk))),
    await page.evaluate(() => JSON.stringify(App.photos.map(p => p.disk))));
  await page.evaluate(() => {
    var tpl = App.templates[0]; cbAddCardFromTpl(tpl.id); var c = App.cards[App.cards.length - 1];
    var p1 = App.photos.find(p => /p1\.jpg$/.test(p.disk));
    if (c.mode === 'auto') c.pids = [p1.id]; else c.slots[0].pid = p1.id;
    cbMarkDirty(); cbRenderCards();
    cpDoAction('retouch', [p1.id], c.id);
  });
  await page.waitForFunction(() => !App.dirty && App.projectMeta.cp.events.some(e => e.action === 'to_retouch'), null, { timeout: 10000 }).catch(() => {});
  const VDS = 'vd:TESTVD:disk:/01_ИСХОДНИКИ/2026-11-06_SV_ПРЕДМЕТКА_VD';
  check('общий диск: отбор сохранён в папке съёмки, копия на ретушь — со структурой', FILES.has(VDS + '/_contentpulse.json') && FILES.has(VDS + '/Ретушь/zarina/76001_предм/p1.jpg'),
    [...FILES.keys()].filter(k => /^vd:/.test(k)).join(' | '));
  check('общий диск: запросы — только через /virtual-disks, ни одного пути общего диска в обычный API',
    VD_CALLS.some(c => /^GET /.test(c)) && VD_CALLS.some(c => /upload/.test(c)) && !log.some(l => / \/v1\/disk\/resources(\/\w+)? vd:/.test(l)),
    log.filter(l => / \/v1\/disk\/resources(\/\w+)? vd:/.test(l)).slice(0, 3).join(' | '));
  /* проверка доступа: метка с «d_» и без, выжимка ответов, без токена */
  await page.evaluate(() => cpShowShelf());
  await page.click('#cpGear');
  await page.click('#cpDiag');
  await page.waitForFunction(() => /готово/.test(document.getElementById('cpDiagText').value), null, { timeout: 10000 });
  {
    const t = await page.inputValue('#cpDiagText');
    check('«Проверить доступ»: общий диск по метке, список папок, нет токена', /общий диск TESTVD, корень: HTTP 200/.test(t) && /dir  01_ИСХОДНИКИ/.test(t) && /d_TESTVD/.test(t) && !/TESTTOKEN/.test(t), t.slice(0, 900).replace(/\n/g, ' ⏎ '));
  }
  await page.click('#cpDiagClose');
  check('«vd:<метка>» без «disk:» понимается', await page.evaluate(() => cpNormArchive('vd:abc123') === 'vd:abc123:disk:/' && cpNormArchive('disk:/vd:abc123') === 'vd:abc123:disk:/'));
  await page.click('#cpGear');
  await page.fill('#cpArchiveInput', 'Архив');
  await page.click('#cpArchiveApply');
  await page.waitForFunction(() => CP_CONFIG.serviceDir === 'disk:/_ContentPulse', null, { timeout: 5000 });
  await page.keyboard.press('Escape');
  await page.fill('#cpShelfSearch', '1043');

  check('служебная папка не видна на витрине', await page.evaluate(() => CP.shoots.every(s => s.name.charAt(0) !== '_')));

  check('загрузки архивов уходят без Referer', DOWNLOADS_REFERER.length === 0, DOWNLOADS_REFERER.join(' | '));
  check('без ошибок JS на странице', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: path.join(ROOT, 'tests', 'shot-shoot.png') });
  await page.evaluate(() => cpShowShelf());
  await page.waitForSelector('.cp-shoot');
  await page.screenshot({ path: path.join(ROOT, 'tests', 'shot-shelf.png') });

  /* медленная сеть: наши файлы грузятся дольше таймера лаунчера Cardboard — всё равно витрина, а не «Проекты» */
  {
    const slow = await ctx.newPage();
    await slow.route(/cp-disk\.js/, async r => { await new Promise(res => setTimeout(res, 900)); r.continue(); });
    await slow.goto(base);
    await slow.waitForFunction(() => window.CP && CP.booted, null, { timeout: 10000 });
    await slow.waitForTimeout(400);
    check('медленная загрузка: открыта витрина, лаунчер «Проекты» закрыт', await slow.evaluate(() =>
      document.getElementById('cpShelf').classList.contains('cp-open') && !document.getElementById('cbProjModal').classList.contains('cb-open')));
    const fast = await ctx.newPage();
    let shelfLoads = 0;
    fast.on('request', rq => { if (/\/v1\/disk\/resources\?/.test(rq.url()) && /path=disk%3A%2F%D0%90%D1%80%D1%85%D0%B8%D0%B2&/.test(rq.url())) shelfLoads++; });
    await fast.goto(base);
    await fast.waitForSelector('.cp-shoot', { timeout: 8000 });
    await fast.waitForTimeout(600);
    check('обычная загрузка: витрина читается один раз', shelfLoads === 1, 'запросов архива: ' + shelfLoads);
    await slow.close(); await fast.close();
  }

  await browser.close(); srv.close();
  const failed = results.filter(r => !r[1]);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' PASS');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
