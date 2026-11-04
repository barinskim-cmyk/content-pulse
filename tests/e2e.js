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
const DIRS = new Set(['disk:/Архив', 'disk:/Архив/LM-1043', 'disk:/Архив/LM-1043/part2', 'disk:/Архив/LM-2001']);
const FILES = new Map([
  ['disk:/Архив/LM-1043/a.jpg', Buffer.from('A'.repeat(100))],
  ['disk:/Архив/LM-1043/b.jpg', Buffer.from('B'.repeat(200))],
  ['disk:/Архив/LM-1043/part2/c.jpg', Buffer.from('C'.repeat(300))],
]);
const log = [];
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
    const p = q.path;
    if (u.pathname === '/v1/disk' || u.pathname === '/v1/disk/') return json(200, { user: { login: 'masha', display_name: 'Маша' } });
    if (u.pathname === '/v1/disk/resources' && m === 'GET') {
      if (DIRS.has(p)) {
        const kids = [...DIRS, ...FILES.keys()].filter(x => x !== p && x.slice(0, x.lastIndexOf('/')) === p).sort();
        const off = +q.offset || 0, lim = +q.limit || 20;
        return json(200, { ...meta(p), _embedded: { items: kids.slice(off, off + lim).map(meta), total: kids.length } });
      }
      if (FILES.has(p)) return json(200, meta(p));
      return json(404, { message: 'not found' });
    }
    if (u.pathname === '/v1/disk/resources' && m === 'PUT') { if (DIRS.has(p)) return json(409, { message: 'exists' }); DIRS.add(p); return json(201, {}); }
    if (u.pathname === '/v1/disk/resources/download') return json(200, { href: 'https://downloader.disk.yandex.ru/dl?p=' + encodeURIComponent(p) });
    if (u.pathname === '/v1/disk/resources/upload') return json(200, { href: 'https://uploader1.disk.yandex.net/up?p=' + encodeURIComponent(p) });
    if (u.pathname === '/v1/disk/resources/copy' && m === 'POST') {
      if (FILES.has(q.path)) return json(409, { message: 'exists' });
      FILES.set(q.path, FILES.get(q.from)); return json(201, {});
    }
    return json(400, { message: 'bad ' + u.pathname });
  }
  if (u.host === 'downloader.disk.yandex.ru') {
    if (u.pathname.startsWith('/preview') && process.env.BLOCK_PREVIEW) return r.abort('failed');
    if (u.pathname.startsWith('/preview')) return r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'image/png' }, body: png(30, 20) });
    return r.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/octet-stream' }, body: FILES.get(q.p) });
  }
  if (u.host === 'uploader1.disk.yandex.net') { FILES.set(q.p, req.postDataBuffer()); return r.fulfill({ status: 201, headers: CORS, body: '' }); }
  return r.continue();
}

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
  await ctx.route(/yandex\.(ru|net)/, route);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));

  /* вход: токен приходит в #access_token */
  await page.goto(base + '#access_token=TESTTOKEN&token_type=bearer');
  await page.waitForSelector('.cp-shoot', { timeout: 8000 });
  check('после входа токен убран из адреса', !(await page.url()).includes('access_token'));
  check('витрина: две съёмки из архива', (await page.$$('.cp-shoot')).length === 2);
  check('витрина: имя пользователя', (await page.textContent('#cpUser')) === 'Маша');

  await page.fill('#cpShelfSearch', '1043');
  check('поиск по коду', (await page.$$('.cp-shoot')).length === 1);

  await page.click('.cp-shoot');
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
  check('карточка собрана, на кадрах кнопка действий', (await page.$$('#cbCards .cp-act')).length >= 1);

  /* действие с карточкой: на ретушь -> копии в Ретушь/<дата>/ */
  await page.click('#cbCards [data-cp-card]');
  await page.click('#cpMenu button[data-s="retouch"]');
  await page.waitForFunction(() => App.projectMeta.cp.events.some(e => e.action === 'to_retouch'), null, { timeout: 8000 });
  const today = new Date().toISOString().slice(0, 10);
  check('ретушь: копии в папке Ретушь/' + today, FILES.has('disk:/Архив/LM-1043/Ретушь/' + today + '/a.jpg'));
  check('ретушь: оригиналы на месте', FILES.has('disk:/Архив/LM-1043/a.jpg'));
  check('бейдж статуса на кадре', (await page.$$('#cbCards .cp-badge.cp-retouch')).length >= 1);
  check('строка статусов', (await page.textContent('#cpStatusLine')).includes('ретушь'));
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
  check('конфликт: чужая версия не затёрта, подтянута', true);
  await page.waitForTimeout(300);
  check('конфликт: новая часть съёмки не потерялась', await page.evaluate(() => App.photos.some(p => /d\.jpg$/.test(p.disk || ''))));

  /* журнал */
  await page.evaluate(() => document.getElementById('cpMenuLog').click());
  check('журнал показывает действие', (await page.textContent('#cpLogList')).includes('на ретушь'));

  /* скачивание отбора: подменяем выбор папки на OPFS (настоящая FS API в Chromium) */
  const dl = await page.evaluate(async () => {
    /* подставная папка в памяти: проверяем свою логику, а не файловую систему тестового браузера */
    const files = {};
    function dirH(path) {
      return { kind: 'directory', name: path,
        getDirectoryHandle: async (n) => dirH(path + n + '/'),
        getFileHandle: async (n, o) => {
          const key = path + n;
          if (!(key in files) && !(o && o.create)) { const e = new Error('nf'); e.name = 'NotFoundError'; throw e; }
          return { getFile: async () => ({ size: files[key] || 0 }),
            createWritable: async () => ({ write: async (b) => { files[key] = b.size; }, close: async () => {} }) };
        } };
    }
    window.showDirectoryPicker = async () => dirH('');
    document.getElementById('cpMenuDlSel').click();
    for (let i = 0; i < 80; i++) {
      await new Promise(r => setTimeout(r, 100));
      if (App.projectMeta.cp.events.some(e => e.action === 'download_selection')) break;
    }
    return Object.keys(files).map(k => k + ':' + files[k]).sort();
  });
  check('скачан отбор по карточкам: папка карточки, порядок, размеры', dl.some(x => /LM-1043 — отбор\/01 Лук 1.*\/01_a\.jpg:\d+$/.test(x)), dl.join(' | '));

  check('без ошибок JS на странице', errors.length === 0, errors.join(' | '));
  await page.screenshot({ path: path.join(ROOT, 'tests', 'shot-shoot.png') });
  await page.evaluate(() => cpShowShelf());
  await page.waitForSelector('.cp-shoot');
  await page.screenshot({ path: path.join(ROOT, 'tests', 'shot-shelf.png') });

  await browser.close(); srv.close();
  const failed = results.filter(r => !r[1]);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' PASS');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
