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
const UPLOADS = [];   /* что и в каком порядке залито на Диск */
const FRESH = new Map();   /* как у Яндекса: новый файл появляется в списке папки не сразу */
const CLOUD = new Map();
const MPU = new Map();
const MPU_PARTS = [];
const WHOLE = [];   /* ключ в бакете -> путь архива */   /* путь .zip на Диске -> имена внутри архива */
const PREVIEW_CALLS = { single: 0, batch: 0, big: 0 };
/* режим «превью заблокировано»: файлы — настоящие картинки, их будут уменьшать в браузере */
if (process.env.BLOCK_PREVIEW) for (const k of [...FILES.keys()]) FILES.set(k, png(60, 40));
const md5 = (b) => require('crypto').createHash('md5').update(b).digest('hex');
const TRASHED = [], MOVED = [], ZIPPART_CALLS = [];
const CRC_CALLS = [], ZIP_SLICES = [];
let ZIPPART_FAIL_ONCE = null, ZIPPART_BAD = null;   /* ZIPPART_BAD — файл, который Яндекс не отдаёт (HTTP 500) */   /* оборвать один кусок архива — страница должна повторить */   /* что ушло в Корзину Диска / перенесено между этапами */
const PROPS = new Map();   /* custom_properties папок (сводка съёмки) */
const meta = (p) => {
  const name = p.split('/').pop();
  if (DIRS.has(p)) return { path: p, name, type: 'dir', modified: '2026-11-0' + (p.length % 9) + 'T10:00:00+00:00', ...(PROPS.has(p) ? { custom_properties: PROPS.get(p) } : {}) };
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
    if (pn === '/v1/disk/resources/upload') {
      /* как у Яндекса: нет папки — 409; файл есть, а перезаписывать нельзя — 409 */
      if (!DIRS.has(p.slice(0, p.lastIndexOf('/')))) return json(409, { error: 'DiskPathDoesntExistsError', message: 'нет папки' });
      if (q.overwrite === 'false' && FILES.has(p)) return json(409, { error: 'DiskResourceAlreadyExistsError', message: 'exists' });
      return json(200, { href: 'https://uploader1.disk.yandex.net/up?p=' + encodeURIComponent(p) });
    }
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
    if (q.a === 'props' && m === 'POST') {
      const b = JSON.parse(req.postData() || '{}');
      if (!DIRS.has(b.path)) return json(404, { error: 'нет папки' });
      PROPS.set(b.path, Object.assign({}, PROPS.get(b.path) || {}, b.props));
      return json(200, { ok: true });
    }
    if (q.a === 'trash' && m === 'POST') {
      const b = JSON.parse(req.postData() || '{}');
      return json(200, { results: (b.paths || []).map(p => {
        TRASHED.push(p);
        const pre = p + '/'; let any = false;
        for (const k of [...FILES.keys()]) if (k === p || k.indexOf(pre) === 0) { FILES.delete(k); any = true; }
        for (const d of [...DIRS]) if (d === p || d.indexOf(pre) === 0) { DIRS.delete(d); any = true; }
        return { path: p, status: any ? 'done' : 'gone' };
      }) });
    }
    if (q.a === 'move' && m === 'POST') {
      const b = JSON.parse(req.postData() || '{}');
      return json(200, { results: (b.items || []).map(it => {
        if (FILES.has(it.path) || DIRS.has(it.path)) return { from: it.from, status: 'exists' };
        if (DIRS.has(it.from)) {   /* папка целиком: всё внутри едет с ней */
          const pre = it.from + '/';
          for (const d of [...DIRS]) if (d === it.from || d.indexOf(pre) === 0) { DIRS.delete(d); DIRS.add(it.path + d.slice(it.from.length)); }
          for (const k of [...FILES.keys()]) if (k.indexOf(pre) === 0) { FILES.set(it.path + k.slice(it.from.length), FILES.get(k)); FILES.delete(k); }
          MOVED.push(it.from + ' -> ' + it.path);
          return { from: it.from, status: 'done' };
        }
        if (!FILES.has(it.from)) return { from: it.from, status: 'gone' };
        const parts = it.path.split('/'); for (let i = 2; i < parts.length; i++) DIRS.add(parts.slice(0, i).join('/'));
        FILES.set(it.path, FILES.get(it.from)); FILES.delete(it.from); MOVED.push(it.from + ' -> ' + it.path);
        return { from: it.from, status: 'done' };
      }) });
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
        if (u && u.zip) {
          /* один архив из кусков: в бакете — один файл */
          if (!/\.zip$/.test(b.filename || '') || (b.parts || []).length !== u.calls) return json(502, { error: 'куски архива не сошлись' });
          ZIPS.set(u.target, u.names); CLOUD.set(b.key, u.target);
          return json(200, { url: 'https://storage.yandexcloud.net/content-pulse-exports-test/' + b.key + '?X-Amz-Signature=x&name=' + encodeURIComponent(b.filename), store: 'cloud' });
        }
        const whole = Buffer.concat(Object.keys(u.parts).sort((a, c) => a - c).map(k => u.parts[k]));
        if (!whole.equals(FILES.get(u.from))) return json(502, { error: 'собрано неверно' });
        CLOUD.set(b.key, u.from);
        return json(200, { url: 'https://storage.yandexcloud.net/content-pulse-exports-test/' + b.key + '?X-Amz-Signature=x', store: 'cloud' });
      }
      return json(200, { ok: true });
    }
    if (q.a === 'crc' && m === 'POST') {
      const b = JSON.parse(req.postData() || '{}');
      if (!FILES.has(b.from)) return json(422, { error: 'нет файла', from: b.from });
      CRC_CALLS.push(b.from + ' ' + b.start + '-' + b.end);
      return json(200, { crc: 0, n: b.end - b.start + 1 });
    }
    if (q.a === 'zippart' && m === 'POST') {
      const b = JSON.parse(req.postData() || '{}');
      const u = MPU.get(b.key);
      if (!u) return json(404, { error: 'нет загрузки' });
      for (const e of b.entries) {
        if (!FILES.has(e.from)) return json(422, { error: 'нет файла ' + e.from });
        if (FILES.get(e.from).length !== e.size) return json(422, { error: 'размер изменился ' + e.from });
        if (e.start !== undefined && !(e.start >= 0 && e.end < e.size && e.end >= e.start)) return json(400, { error: 'кусок за пределами файла' });
      }
      if (b.n !== (u.calls || 0) + 1 || b.offset !== (u.next || 0)) return json(400, { error: 'кусок не по порядку' });
      const bad = b.entries.find(e => e.from === ZIPPART_BAD);
      if (bad) return json(422, { error: bad.from.split('/').pop() + ': файл не отдан, HTTP 500', from: bad.from });
      if (ZIPPART_FAIL_ONCE && !ZIPPART_FAIL_ONCE.done) { ZIPPART_FAIL_ONCE.done = true; return json(422, { error: 'IMG_0101.jpg: terminated' }); }
      ZIPPART_CALLS.push(b.n);
      b.entries.filter(e => e.start !== undefined).forEach(e => ZIP_SLICES.push(e.name + ' ' + e.start + '-' + e.end + (e.head ? ' head' : '')));
      u.zip = true; u.target = b.target; u.calls = b.n; u.names = (u.names || []).concat(b.entries.filter(e => e.start === undefined || e.head).map(e => e.name));
      let off = b.offset;
      const done = [];
      b.entries.forEach(e => {
        if (e.start === undefined) { done.push({ name: e.name, size: e.size, crc: 1, offset: off }); off += 30 + Buffer.byteLength(e.name) + e.size; return; }
        if (e.head) { done.push({ name: e.name, size: e.size, crc: e.crc, offset: off }); off += 30 + Buffer.byteLength(e.name); }
        off += e.end - e.start + 1;
      });
      u.next = off;
      if (b.final && (b.done || []).length + done.length !== u.names.length) return json(400, { error: 'оглавление неполное' });
      return json(200, { n: b.n, etag: '"z' + b.n + '"', next: off, bytes: off - b.offset, done });
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
  if (u.host === 'uploader1.disk.yandex.net') { UPLOADS.push(q.p); if (!FILES.has(q.p)) FRESH.set(q.p, Date.now()); FILES.set(q.p, req.postDataBuffer()); return r.fulfill({ status: 201, headers: CORS, body: '' }); }
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
  /* у кадра в отборе нет размера (старая съёмка) — размер спросим у Диска, кадр не потеряется */
  await page.evaluate(() => { App.photos.find(p => /\/a\.jpg$/.test(p.disk || '')).size = undefined; document.getElementById('cpMenuDlSel').click(); });
  await page.waitForFunction(() => App.projectMeta.cp.events.some(e => e.action === 'download_selection'), null, { timeout: 10000 });
  await page.waitForTimeout(500);
  const zSel = ZIPS.get('disk:/_ContentPulse/выгрузки/LM-1043_отбор_1.zip') || [];
  check('архив отбора собран прослойкой: папки карточек и порядок', zSel.some(n => /^LM-1043_отбор_1\/01 Лук 1[^/]*\/01_a\.jpg$/.test(n)) && zSel.some(n => /\/02_b\.jpg$/.test(n)), zSel.join(' | '));
  check('архив отбора скачивается обычной загрузкой браузера', DOWNLOADS.some(p => /выгрузки\/LM-1043_отбор_1\.zip$/.test(p)), DOWNLOADS.join(' | '));
  check('ссылку на папку у Яндекса не просим (папки он не отдаёт)', !log.some(l => /resources\/download disk:\/_ContentPulse\/выгрузки\/[^.]*$/.test(l)));

  /* вся съёмка большая: собирается за несколько вызовов, но архив — ОДИН (Маша, 06.11: «разбил на два куска»);
     один кусок обрывается на середине (Яндекс: «terminated») — страница повторяет его сама */
  ZIPPART_FAIL_ONCE = {};
  const callsBefore = ZIPPART_CALLS.length;
  await page.evaluate(() => { CP.zipTarget = 250; CP.zipPartMin = 100; CP.directMin = 150; document.getElementById('cpMenuDlAll').click(); });
  await page.waitForFunction(() => App.projectMeta.cp.events.some(e => e.action === 'download_shoot'), null, { timeout: 10000 });
  const zParts = [...ZIPS.keys()].filter(k => /LM-1043_вся съёмка_1_ч\d+\.zip$/.test(k));
  const allNames = ZIPS.get('disk:/_ContentPulse/выгрузки/LM-1043_вся съёмка_1.zip') || [];
  check('вся съёмка — один архив, собран за несколько вызовов; кадры крупнее порога видео — тоже в архиве', !zParts.length && ZIPPART_CALLS.length - callsBefore >= 2
    && allNames.length === 4 && allNames.some(n => n === 'LM-1043_вся съёмка_1/part2/c.jpg'), JSON.stringify([ZIPPART_CALLS.slice(callsBefore), allNames, zParts]));
  check('карточка: одна кнопка «Скачать ZIP»', await page.evaluate(() => document.querySelectorAll('#cpDlCard a.cp-dlcard-btn').length === 1 && /Скачать ZIP/.test(document.getElementById('cpDlCard').textContent)));
  check('один архив скачивается', DOWNLOADS.some(p => /выгрузки\/LM-1043_вся съёмка_1\.zip$/.test(p)), DOWNLOADS.join(' | '));
  check('кусок архива оборвался — повторён, архив всё равно собран целиком', ZIPPART_FAIL_ONCE.done && allNames.length === 4);
  ZIPPART_FAIL_ONCE = null;
  /* Яндекс не отдаёт один файл (HTTP 500) — архив собирается без него, в карточке сказано, какой */
  ZIPPART_BAD = 'disk:/Архив/LM-1043/part2/c.jpg';
  await page.evaluate(() => { CP.zipTarget = 250; CP.zipPartMin = 100; document.getElementById('cpMenuDlAll').click(); });
  for (let i = 0; i < 80 && !ZIPS.has('disk:/_ContentPulse/выгрузки/LM-1043_вся съёмка_2.zip'); i++) await page.waitForTimeout(100);
  const zBad = ZIPS.get('disk:/_ContentPulse/выгрузки/LM-1043_вся съёмка_2.zip') || [];
  await page.waitForFunction(() => /Не попали/.test((document.getElementById('cpDlCard') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
  check('файл, который Яндекс не отдаёт, — архив без него, в карточке «Не попали: c.jpg»', zBad.length === 3 && !zBad.some(n => /c\.jpg$/.test(n))
    && /Не попали[^.]*c\.jpg/.test(await page.textContent('#cpDlCard')), JSON.stringify(zBad) + ' ' + await page.textContent('#cpDlCard'));
  ZIPPART_BAD = null;
  /* выборка больше порога — несколько архивов по папкам целиком (Маша, 08.11: 8,4 ГБ одним архивом
     не скачивается; «по папкам целиком»), внутри у всех частей одна корневая папка */
  const dlBefore = DOWNLOADS.length;
  await page.evaluate(() => { CP.zipTarget = 250; CP.zipPartMin = 100; CP.zipSplitAt = 400; CP.zipPartSize = 360; document.getElementById('cpMenuDlAll').click(); });
  await page.waitForFunction(() => /Часть 2 из/.test((document.getElementById('cpDlCard') || {}).textContent || '') && !/Собираю/.test(document.getElementById('cpDlCard').textContent), null, { timeout: 15000 }).catch(() => {});
  const spl = [...ZIPS.entries()].filter(([k]) => /LM-1043_вся съёмка_3_ч\d+\.zip$/.test(k));
  const splAll = spl.flatMap(([, v]) => v);
  const withA = (spl.find(([, v]) => v.some(n => /\/a\.jpg$/.test(n))) || [, []])[1];
  check('большая выборка: несколько архивов _ч1, _ч2…, папки целиком, одна корневая папка внутри',
    spl.length >= 2 && splAll.length === 4 && splAll.every(n => n.indexOf('LM-1043_вся съёмка_3/') === 0)
    && !withA.some(n => /part2\//.test(n)), JSON.stringify(spl));
  check('карточка: кнопки «Часть 1 из N», каждая часть скачивается', await page.evaluate(() => document.querySelectorAll('#cpDlCard a.cp-dlcard-btn').length >= 2
    && /Часть 1 из/.test(document.getElementById('cpDlCard').textContent)) && DOWNLOADS.length - dlBefore === spl.length, DOWNLOADS.slice(dlBefore).join(' | '));
  await page.evaluate(() => { CP.zipSplitAt = 3.2 * 1024 * 1024 * 1024; CP.zipPartSize = 3 * 1024 * 1024 * 1024; });
  await page.evaluate(() => { CP.zipTarget = 400 * 1024 * 1024; CP.zipPartMin = 6 * 1024 * 1024; });
  await page.evaluate(() => { CP.zipTarget = 400 * 1024 * 1024; CP.zipPartMin = 6 * 1024 * 1024; CP.directMin = 48 * 1024 * 1024; });

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
  /* фильтров в панели нет: что скачивается, решает папка (Маша, 08.11) — из исходников всё; отбор по тегу/статусу остался внутри */
  check('в панели исходников нет фильтров-чипов и списков; кнопка «Скачать всё из Архив» (с галочками — «отмеченные папки»)', !(await page.$('#cpPanel .cp-fchips')) && !(await page.$('#cpFTag')) && !(await page.$('#cpFStatus'))
    && /Скачать отмеченные папки/.test(await page.textContent('[data-cp-p="download"]')));
  await page.evaluate(() => { CP.sel.tags = { 'Яна': true }; cpRenderPanel(); });
  check('фильтр по тегу папки: только её кадры (наследование)', await page.evaluate(() => cpFiltered(CP.sel).length === 2 && cpFiltered(CP.sel).every(x => x.dir === 'part2')));
  await page.uncheck('[data-cp-fold="part2"]');
  check('без галочек — «Скачать всё из Архив» и число', /Скачать всё из Архив · \d+/.test(await page.textContent('[data-cp-p="download"]')), await page.textContent('[data-cp-p="download"]'));
  await page.evaluate(() => { CP.sel.tags = {}; CP.sel.statuses = { retouch: true }; cpRenderPanel(); });
  check('отбор по статусу «на ретуши» (внутренний)', await page.evaluate(() => cpFiltered(CP.sel).length === 2));
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
  check('«скачано» временно нигде не показывается: нет фильтра, чипа и значка', !(await page.$('#cpFDl')) && !(await page.$('.cp-state-dl')) && !(await page.$('.cp-badge.cp-dl')));
  await page.click('[data-cp-p="download"]');
  await page.waitForFunction(() => Object.values(CP.sel.data.meta.cp.downloads).every(d => d.n === 2), null, { timeout: 10000 });
  check('повторное скачивание разрешено: _2 и счётчик ×2', ZIPS.has('disk:/_ContentPulse/выгрузки/LM-1043_Ретушь_2.zip'));
  await page.evaluate(() => { CP.sel.statuses = {}; cpRenderPanel(); });
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
  await page.waitForFunction(() => document.querySelectorAll('.cp-shoot').length >= 2 && CP.settings && CP.settings.retouch);
  await page.evaluate(() => cpRenderShoots());
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
  check('пустая карточка по папке без кадров помечена «нет кадров» (с подсказкой, какая папка)', await page.evaluate(() => {
    var el = document.querySelector('#cbCards .cb-card[data-cid="' + App.cards.find(c => c.title === '74598').id + '"]');
    var chip = el.querySelector('.cp-empty-art');
    var full = document.querySelector('#cbCards .cb-card[data-cid="' + App.cards.find(c => c.title === '74595').id + '"] .cp-empty-art');
    return chip && chip.textContent === 'нет кадров' && /74598/.test(chip.title) && !full;
  }));
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

  /* галочки в списке карточек: буква ретушёра отмеченным, «Скачать отмеченные» — архив <съёмка>_<буква>_<N> */
  await page.evaluate(() => { CP.dict = cpParseDict('[Ретушёры: один]\nY\nU'); cbRenderOutline(); });
  const ck = await page.evaluate(() => [App.cards.find(c => c.title === '74595').id, App.cards.find(c => c.title === '74596').id]);
  await page.check('[data-cp-ck="' + ck[0] + '"]');
  await page.check('[data-cp-ck="' + ck[1] + '"]');
  check('список карточек: галочки, «Отмечено: 2», буквы ретушёров', /Отмечено: 2/.test(await page.textContent('#cpObar')) && !!(await page.$('[data-cp-letter="Y"]')));
  await page.click('[data-cp-letter="Y"]');
  await page.screenshot({ path: path.join(ROOT, 'tests', 'shot-outline.png') });
  check('буква Y поставлена обеим отмеченным', await page.evaluate(ids => ids.every(id => (cbCardById(id).tags || []).indexOf('Y') !== -1), ck));
  await page.click('[data-cp-o="download"]');
  for (let i = 0; i < 40 && ![...ZIPS.keys()].some(k => /МОДЕЛЬ_МУЖ_TEST_Y_1\.zip$/.test(k)); i++) await page.waitForTimeout(100);
  {
    const z = [...ZIPS.entries()].filter(([k]) => /МОДЕЛЬ_МУЖ_TEST_Y_1\.zip$/.test(k)).flatMap(([, v]) => v);
    check('«Скачать отмеченные»: архив <съёмка>_Y_1, папки карточек 74595 и 74596', z.length === 2 && z.some(n => /_Y_1\/74595\/(\d+_)?manekin\.jpg$/.test(n)) && z.some(n => /_Y_1\/74596\/(\d+_)?manekin2\.jpg$/.test(n)), [...ZIPS.keys()].join(' | ') + ' :: ' + z.join(' | '));
  }
  await page.waitForFunction(() => cpMeta().events.some(e => e.action === 'download_cards'), null, { timeout: 5000 }).catch(() => {});
  check('скачанное отмечено (кто, архив), в журнале', await page.evaluate(() => {
    var p = App.photos.find(x => /manekin2/.test(x.disk));
    return cpMeta().downloads[p.id] && cpMeta().downloads[p.id].last.export === '2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST_Y_1' && cpMeta().events.some(e => e.action === 'download_cards');
  }));
  /* сдача: Сайт / дата / буква_номер / съёмка / артикулы */
  ['disk:/Сайт', 'disk:/Сайт/06.11.2026', 'disk:/Сайт/06.11.2026/Y_1', 'disk:/Сайт/06.11.2026/Y_1/2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST',
    'disk:/Сайт/06.11.2026/Y_1/2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST/74595', 'disk:/Сайт/06.11.2026/Y_1/2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST/99999_чужой'].forEach(d => DIRS.add(d));
  FILES.set('disk:/Сайт/06.11.2026/Y_1/2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST/74595/74595_1.jpg', Buffer.from('F'.repeat(90)));
  FILES.set('disk:/Сайт/06.11.2026/Y_1/2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST/74595/74595_2.tif', Buffer.from('G'.repeat(90)));
  FILES.set('disk:/Сайт/06.11.2026/Y_1/2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST/99999_чужой/x.jpg', Buffer.from('H'.repeat(90)));
  await page.evaluate(() => { CP.settings = Object.assign(CP.settings || {}, { site: 'disk:/Сайт' }); });
  await page.click('[data-cp-o="site"]');
  await page.waitForSelector('#cpSiteRep.cp-open', { timeout: 10000 }).catch(() => {});
  {
    const rep = await page.textContent('#cpSiteRep').catch(() => '');
    check('«Проверить сдачу»: 74595 сдана (Y, 2 файла), 74596 — нет, лишняя папка показана',
      await page.evaluate(ids => { var d = cpMeta().delivered; return d[ids[0]] && d[ids[0]].letter === 'Y' && d[ids[0]].files === 2 && !d[ids[1]]; }, ck)
      && /Не сдано \(1\)/.test(rep) && /74596/.test(rep) && /без карточки/.test(rep) && /99999_чужой/.test(rep), rep.slice(0, 400));
    check('на шапке сданной карточки — «Сдано · Y», в списке — «сдано»', await page.evaluate(id =>
      /Сдано · Y/.test(document.querySelector('#cbCards .cb-card[data-cid="' + id + '"] .cb-card-head').textContent)
      && /сдано/.test(document.querySelector('[data-cp-ck="' + id + '"]').parentNode.textContent), ck[0]));
  }
  /* сдан 74595 — его папка в ретуши ушла в Корзину Диска, несданный 74596 остался */
  for (let i = 0; i < 80 && !TRASHED.includes(RT + '1/74595_модель'); i++) await page.waitForTimeout(100);
  check('артикул сдан — его папка в ретуши в Корзине Диска, несданный — на месте', TRASHED.includes(RT + '1/74595_модель') && !FILES.has(RT + '1/74595_модель/manekin.jpg')
    && FILES.has(RT + '1/74596_модель/manekin2.jpg') && !TRASHED.some(p => /74596/.test(p)), JSON.stringify(TRASHED));
  check('сданное в ретушь не докопируется', await page.evaluate(() => { var done = cpDonePids(); var c = App.cards.find(x => x.title === '74595'); return cpCardPids(c).every(pid => done[pid]); }));
  await page.screenshot({ path: path.join(ROOT, 'tests', 'shot-site.png') });
  await page.click('[data-cp-sr="close"]');
  /* приём ретуши: «Сдать» — папка архива и отдельная картинка, на приёмку; «Ретушь готова»; согласовать — в «Сайт»; на доработку */
  {
    const acc = await page.evaluate(() => {
      cpAcceptOpen(CP.shoot.path, CP.shoot.name);
      var f = (n) => new File(['RETOUCHED-' + n], n, { type: 'image/tiff' });
      cpAcceptAdd([
        { file: f('01_manekin2.tif'), rel: '2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST_Y_1/74596/01_manekin2.tif' },
        { file: f('.DS_Store'), rel: '2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST_Y_1/.DS_Store/x' },
        { file: f('IMG_0101.tif'), rel: '2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST_Y_1/лишнее/IMG_0101.tif' },
        { file: f('чужой.jpg'), rel: '2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST_Y_1/лишнее/чужой.jpg' }
      ]);
      return new Promise(r => setTimeout(() => r({ plan: CP.accept.plan && { letter: CP.accept.letter, n: CP.accept.n, cards: Object.keys(CP.accept.plan.groups).length, un: CP.accept.plan.unmatched }, today: cpToday(),
        text: document.getElementById('cpAccPlan').textContent }), 300));
    });
    check('«Сдать»: буква и номер из имени архива, карточки по папке и по имени кадра, чужое — списком', acc.plan && acc.plan.letter === 'Y' && acc.plan.n === '1' && acc.plan.cards === 2 && acc.plan.un.length === 1 && /Не нашлась карточка \(1\)/.test(acc.text), JSON.stringify(acc));
    await page.click('[data-cp-acc="go"]');
    await page.waitForFunction(() => Object.keys(cpMeta().rv || {}).length === 2, null, { timeout: 10000 }).catch(() => {});
    const SH = 'disk:/Архив/2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST';
    const acceptPath = SH + '/_приёмка/' + acc.today + '_Y_1/74596/01_manekin2.tif';
    check('загружено на приёмку: <съёмка>/_приёмка/<дата>_Y_1/<карточка>/, версии «на проверке»', FILES.has(acceptPath)
      && await page.evaluate(() => Object.values(cpMeta().rv).every(l => l.length === 1 && l[0].status === 'review' && l[0].letter === 'Y')), [...FILES.keys()].filter(k => /_приёмка/.test(k)).join(' | '));
    await page.click('[data-cp-acc="close"]');
    const ids = await page.evaluate(() => Object.keys(cpMeta().rv));
    check('на карточке с ретушью — версия, картинки и «Согласовать ретушь»; без ретуши — кнопки нет', await page.evaluate(x =>
      x.every(id => document.querySelector('[data-cp-rv="' + id + '"] [data-cp-rva="approve"]')) && document.querySelectorAll('[data-cp-rva="approve"]').length === x.length, ids));
    await page.check('#cpRvOnly');
    check('«Ретушь готова»: видны только карточки с загруженной ретушью', await page.evaluate(x =>
      [...document.querySelectorAll('#cbCards .cb-card')].every(el => (getComputedStyle(el).display !== 'none') === x.includes(el.getAttribute('data-cid'))), ids));
    const c96 = await page.evaluate(() => App.cards.find(c => c.title === '74596').id);
    await page.click('[data-cp-rv="' + c96 + '"] [data-cp-rva="approve"]');
    await page.waitForFunction(id => cpMeta().rv[id][0].status === 'approved', c96, { timeout: 8000 }).catch(() => {});
    check('согласовано: файлы в «Сайт / дата / Y_1 / съёмка / карточка», карточка загружена', FILES.has('disk:/Сайт/' + acc.today + '/Y_1/2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST/74596/01_manekin2.tif')
      && await page.evaluate(id => !!cpMeta().delivered[id] && cpMeta().rv[id][0].status === 'approved', c96), [...FILES.keys()].filter(k => /Сайт\/2026/.test(k)).join(' | '));
    /* артикул сдан — его папка в ретуши уходит в Корзину Диска (выбор Маши, 06.11) */
    for (let i = 0; i < 80 && !TRASHED.includes(RT.slice(0, -1)); i++) await page.waitForTimeout(100);
    check('сдана вся съёмка — папка съёмки в ретуши тоже в Корзине, в журнале — что ушло', TRASHED.includes(RT.slice(0, -1)) && ![...FILES.keys()].some(k => k.indexOf(RT) === 0)
      && await page.evaluate(() => cpMeta().events.some(e => e.action === 'retouch_trash')), JSON.stringify(TRASHED));
    const other = ids.find(i => i !== c96);
    page.once('dialog', d => d.accept('свет пересвечен'));
    await page.click('[data-cp-rv="' + other + '"] [data-cp-rva="rework"]');
    await page.waitForTimeout(200);
    check('на доработку: заметка, кнопок согласования нет, ждёт новой версии', await page.evaluate(id => cpMeta().rv[id][0].status === 'rework' && cpMeta().rv[id][0].note === 'свет пересвечен'
      && !document.querySelector('[data-cp-rv="' + id + '"] [data-cp-rva]') && /доработке/.test(document.querySelector('[data-cp-rv="' + id + '"]').textContent), other));
    await page.screenshot({ path: path.join(ROOT, 'tests', 'shot-accept.png') });
    await page.uncheck('#cpRvOnly');
  }

  /* на согласование — копия в 02 (Маша, 08.11: «отправила на согласование — в папке „Отбор“ ничего не появилось»);
     сняли статус — копия в Корзину; на ретушь — из 02 в Корзину, в 03 — копия из исходников */
  {
    const AP = 'disk:/Этапы/02_ОТБОР', SN = '2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST';
    ['disk:/Этапы', AP].forEach(d => DIRS.add(d));
    const NEWF = 'disk:/Архив/' + SN + '/1/IMG_0105.jpg';
    FILES.set(NEWF, Buffer.from('W'.repeat(110)));
    await page.evaluate(() => cpSyncPhotos(false));
    await page.waitForFunction(() => App.photos.some(p => p.name === 'IMG_0105.jpg'), null, { timeout: 8000 }).catch(() => {});
    const ph = await page.evaluate(ap => {
      CP.settings.approve = ap;
      const inCard = {}; App.cards.forEach(c => cpCardPids(c).forEach(pid => { inCard[pid] = true; }));
      const p = App.photos.find(x => x.disk && !x.missing && /\.jpg$/i.test(x.name) && !cpMeta().status[x.id] && !inCard[x.id]);
      return p ? { id: p.id, rel: p.disk.slice(CP.shoot.path.length + 1) } : null;
    }, AP);
    check('есть кадр без статуса и карточки для проверки согласования', !!ph, '');
    const ap2 = AP + '/' + SN + '/' + ph.rel;
    await page.evaluate(id => cpDoAction('approval', [id], null), ph.id);
    for (let i = 0; i < 60 && !FILES.has(ap2); i++) await page.waitForTimeout(100);
    await page.waitForFunction(id => (cpMeta().ap2 || {})[id], ph.id, { timeout: 5000 }).catch(() => {});
    check('«на согласование» — копия в 02_ОТБОР/<съёмка>/<как в исходниках>, путь запомнен', FILES.has(ap2) && await page.evaluate(id => !!cpMeta().ap2[id], ph.id), ap2);
    await page.evaluate(id => cpDoAction('', [id], null), ph.id);
    for (let i = 0; i < 60 && FILES.has(ap2); i++) await page.waitForTimeout(100);
    check('сняли статус — копия из 02 в Корзине', !FILES.has(ap2) && TRASHED.includes(ap2), JSON.stringify(TRASHED.slice(-3)));
    await page.evaluate(id => cpDoAction('approval', [id], null), ph.id);
    for (let i = 0; i < 60 && !FILES.has(ap2); i++) await page.waitForTimeout(100);
    await page.waitForFunction(id => (cpMeta().ap2 || {})[id], ph.id, { timeout: 5000 }).catch(() => {});
    await page.evaluate(id => cpDoAction('retouch', [id], null), ph.id);
    const rt3 = 'disk:/Архив/РЕТУШЬ/' + SN + '/' + ph.rel;
    for (let i = 0; i < 60 && (FILES.has(ap2) || !FILES.has(rt3)); i++) await page.waitForTimeout(100);
    check('с согласования на ретушь: из 02 — в Корзину, в 03 — копия (перенос)', !FILES.has(ap2) && FILES.has(rt3), JSON.stringify([FILES.has(ap2), FILES.has(rt3)]));
    await page.evaluate(id => { delete CP.settings.approve; cpSetStatus([id], null, null); cbMarkDirty(); }, ph.id);
    FILES.delete(rt3); FILES.delete(NEWF);
    await page.evaluate(() => cpSyncPhotos(false));
  }

  /* 04_ОТРЕТУШИРОВАНО (Маша, 06.11): сдача в папку этапа как в исходниках, «На сайт» — перенос в 05/<дата>/<съёмка>/<артикул>,
     «На доработку» — «_доработка» в 04, новая версия — рядом, старая папка в Корзину; выработка — таблица в служебной папке */
  {
    const RV = 'disk:/Этапы/04_ОТРЕТУШИРОВАНО', ST = 'disk:/Этапы/05_САЙТ', SN = '2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST';
    ['disk:/Этапы', RV, ST].forEach(d => DIRS.add(d));
    const prev = await page.evaluate(([rv, st]) => { const p = { site: CP.settings.site, retouched: CP.settings.retouched };
      Object.assign(CP.settings, { retouched: rv, site: st }); localStorage.setItem('cp_rt_letter', 'U'); return p; }, [RV, ST]);
    const today = await page.evaluate(() => cpToday());
    const up = async (list) => {
      await page.evaluate(l => {
        cpAcceptOpen(CP.shoot.path, CP.shoot.name);
        cpAcceptAdd(l.map(x => ({ file: new File(['RT-' + x[1]], x[1], { type: 'image/tiff' }), rel: x[0] + '/' + x[1] })));
      }, list);
      await page.waitForFunction(() => document.querySelector('[data-cp-acc="go"]'), null, { timeout: 5000 });
      const txt = await page.textContent('#cpAccPlan');
      /* что видно по ходу загрузки — прогресс в окне сдачи */
      await page.evaluate(() => { window.__prog = []; new MutationObserver(() => { const e = document.getElementById('cpAccProg'); if (e && e.textContent) window.__prog.push(e.textContent); })
        .observe(document.getElementById('cpAccPlan'), { childList: true, subtree: true, characterData: true }); });
      await page.click('[data-cp-acc="go"]');
      await page.waitForFunction(() => /Загружено в/.test((document.getElementById('cpAccPlan') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
      await page.click('[data-cp-acc="close"]');
      return txt;
    };
    const t1 = await up([['готово/74595', 'manekin.tif'], ['готово/74596', 'manekin2.tif']]);
    const inRv = n => [...FILES.keys()].filter(k => k.indexOf(RV + '/' + SN + '/') === 0 && k.endsWith('/' + n));
    check('сдача в 04: кнопка «Загрузить в 04_ОТРЕТУШИРОВАНО», буква с прошлого раза (U), файлы — 04/<съёмка>/<папка артикула>/',
      /Загрузить в 04_ОТРЕТУШИРОВАНО/.test(t1) && inRv('manekin.tif').length === 1 && inRv('manekin2.tif').length === 1 && /\/74595[^/]*\/manekin\.tif$/.test(inRv('manekin.tif')[0]),
      JSON.stringify([t1, inRv('manekin.tif'), inRv('manekin2.tif')]));
    /* карточки, которым досталась эта сдача (у артикула бывает две карточки — смотрим по версиям) */
    const prog = await page.evaluate(() => window.__prog);
    check('по ходу загрузки видно прогресс в окне сдачи (файлы, МБ, %), заставка «Загружаю» — поверх окна', prog.some(t => /Загружаю в 04_ОТРЕТУШИРОВАНО: файлов \d+ из 2 .* МБ \(\d+%\)/.test(t)) && prog.some(t => /\(100%\)/.test(t))
      && await page.evaluate(() => +getComputedStyle(document.getElementById('cbBusy')).zIndex > +getComputedStyle(document.getElementById('cpAccept')).zIndex), JSON.stringify(prog.slice(-3)));
    check('после сдачи съёмка сразу в фильтре 04 (не ждём, пока Диск покажет новую папку)', await page.evaluate(n => !!(CP.stagePresence.review || {})[n.toLowerCase()], SN));
    const ids = await page.evaluate(() => { const rv = cpMeta().rv, f = n => Object.keys(rv).find(id => { const l = rv[id].slice(-1)[0]; return l && l.letter === 'U' && l.files.some(x => x.name === n); });
      return { a: f('manekin.tif'), b: f('manekin2.tif') }; });
    check('на карточке — «На сайт» и «На доработку»', await page.evaluate(i => /На сайт/.test(document.querySelector('[data-cp-rv="' + i + '"] [data-cp-rva="approve"]').textContent), ids.b));
    /* панель съёмки в 04 (Маша, 09.11): «сдано — с ретушью» (что в 04), «не сдано — без ретуши» (кадры из 03 у карточек
       без версии), всё; «без брака / только брак» */
    {
      const RT0 = 'disk:/Этапы/03_ТЕСТ/' + SN, STF = 'disk:/Архив/' + SN + '/_contentpulse.json';
      ['disk:/Этапы/03_ТЕСТ', RT0, RT0 + '/1', RT0 + '/1/74595_модель', RT0 + '/1/99999'].forEach(d => DIRS.add(d));
      FILES.set(RT0 + '/1/74595_модель/manekin.jpg', Buffer.from('M'.repeat(33)));
      FILES.set(RT0 + '/1/99999/zzz.jpg', Buffer.from('Z'.repeat(34)));
      for (let i = 0; i < 60; i++) { try { const st = JSON.parse(FILES.get(STF).toString()); if (st.meta.cp.rv && st.meta.cp.rv[ids.a]) break; } catch (e) { } await page.waitForTimeout(100); }
      for (const k of [...FRESH.keys()]) if (k.indexOf(RV) === 0) FRESH.delete(k);   /* свежие файлы Диск показывает не сразу — здесь не ждём */
      await page.evaluate(([rv, rt, sn]) => { const low = sn.toLowerCase(); CP.stagePaths = CP.stagePaths || {};
        (CP.stagePaths.review = CP.stagePaths.review || {})[low] = [rv + '/' + sn]; (CP.stagePaths.retouch = CP.stagePaths.retouch || {})[low] = [rt];
        CP.stageFilter = 'review'; cpSelectShoot(CP.shoot.path, CP.shoot.name, ''); }, [RV, RT0, SN]);
      await page.waitForFunction(() => /Сдано — с ретушью/.test((document.getElementById('cpPanel') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
      const pt = await page.textContent('#cpPanel');
      check('04: «Сдано — с ретушью 2 · Не сдано — без ретуши 1 · Всё 3», по умолчанию — сдано; чипы брака', /Сдано — с ретушью\s*2/.test(pt) && /Не сдано — без ретуши\s*1/.test(pt) && /Всё\s*3/.test(pt)
        && /без брака/.test(pt) && /только брак/.test(pt) && await page.evaluate(() => CP.sel.scope === 'done'), pt.slice(0, 600));
      const nBrak = () => page.evaluate(() => +(/\d+/.exec(document.querySelector('#cpPanel [data-cp-sbrak="only"] small').textContent) || [0])[0]);
      const b0 = await nBrak();
      await page.evaluate(() => { CP.sel.data.photos.filter(x => /^manekin2?\.jpg$/.test(x.name)).forEach(p => { CP.sel.data.meta.cp.status[p.id] = { s: 'reshoot' }; }); cpStageTagIndex(CP.sel); cpRenderPanel(); });
      check('кадры в браке — «только брак 2», «без брака 0» (было ' + b0 + ')', await nBrak() === 2 && /без брака\s*0/.test(await page.textContent('#cpPanel')), await page.textContent('#cpPanel'));
      await page.evaluate(() => document.querySelector('#cpPanel [data-cp-scope="todo"]').click());
      const zb = new Set(ZIPS.keys());
      await page.evaluate(() => document.querySelector('[data-cp-stdl]').click());
      for (let i = 0; i < 80 && ![...ZIPS.keys()].some(k => !zb.has(k)); i++) await page.waitForTimeout(100);
      const zt = [...ZIPS.entries()].filter(([k]) => !zb.has(k)).flatMap(([, v]) => v);
      check('«Не сдано — без ретуши»: из 03 только кадры карточек без версии (99999/zzz.jpg, не 74595)', zt.length === 1 && /\/1\/99999\/zzz\.jpg$/.test(zt[0]), JSON.stringify(zt));
      [RT0 + '/1/74595_модель/manekin.jpg', RT0 + '/1/99999/zzz.jpg'].forEach(f => FILES.delete(f));
      [RT0 + '/1/74595_модель', RT0 + '/1/99999', RT0 + '/1', RT0, 'disk:/Этапы/03_ТЕСТ'].forEach(d => DIRS.delete(d));
      await page.evaluate(sn => { delete CP.stagePaths.retouch[sn.toLowerCase()]; CP.stageFilter = ''; CP.sel = null; cpRenderPanel(); }, SN);
    }
    /* открыли съёмку из фильтра 04 — видны только карточки этого этапа; отправленное на сайт сразу пропадает */
    const vis = () => page.evaluate(() => [...document.querySelectorAll('#cbCards .cb-card')].filter(el => el.style.display !== 'none').map(el => el.getAttribute('data-cid')));
    await page.evaluate(() => { CP.stageFilter = 'review'; CP.openedHooks.forEach(f => { try { f(CP.shoot.path); } catch (e) { } }); });
    const v1 = await vis();
    check('открыто из 04: видны только карточки на проверке, полоска «только карточки этого этапа»', v1.length === 2 && v1.includes(ids.a) && v1.includes(ids.b)
      && /Открыто из 04_ОТРЕТУШИРОВАНО/.test(await page.textContent('#cpViewBar')), JSON.stringify(v1));
    check('в 04 исходные кадры скрыты — видна только загруженная версия; кнопка «Показать исходные кадры»', await page.evaluate(i => {
      const el = document.querySelector('.cb-card[data-cid="' + i + '"]'), pg = el.querySelector(':scope > .cb-page');
      return el.classList.contains('cp-src-hidden') && (!pg || getComputedStyle(pg).display === 'none') && !!el.querySelector('.cp-rv-t')
        && /Показать исходные кадры/.test(document.getElementById('cpViewBar').textContent); }, ids.a));
    await page.click('[data-cp-src]');
    check('«Показать исходные кадры» — раскладка с исходниками снова видна', await page.evaluate(i => {
      const pg = document.querySelector('.cb-card[data-cid="' + i + '"] > .cb-page'); return !!pg && getComputedStyle(pg).display !== 'none'; }, ids.a));
    await page.click('[data-cp-src]');
    /* в ретуши лежит копия 74596 — после «На сайт» она сразу уходит в Корзину */
    const RT3 = 'disk:/Архив/РЕТУШЬ/' + SN;
    [RT3, RT3 + '/1', RT3 + '/1/74596_модель'].forEach(d => DIRS.add(d));
    FILES.set(RT3 + '/1/74596_модель/manekin2.jpg', Buffer.from('Q'.repeat(140)));
    await page.click('[data-cp-rv="' + ids.b + '"] [data-cp-rva="approve"]');
    const siteB = ST + '/' + today + '/' + SN + '/74596/manekin2.tif';
    for (let i = 0; i < 60 && !FILES.has(siteB); i++) await page.waitForTimeout(100);
    await page.waitForFunction(i => cpMeta().rv[i].slice(-1)[0].status === 'approved', ids.b, { timeout: 5000 }).catch(() => {});
    check('«На сайт»: папка артикула переехала в 05/<дата>/<съёмка>/<артикул>, в 04 её больше нет', FILES.has(siteB) && !inRv('manekin2.tif').length
      && await page.evaluate(i => cpMeta().rv[i].slice(-1)[0].status === 'approved' && !!cpMeta().delivered[i], ids.b), JSON.stringify([...FILES.keys()].filter(k => /Этапы/.test(k))));
    for (let i = 0; i < 60 && FILES.has(RT3 + '/1/74596_модель/manekin2.jpg'); i++) await page.waitForTimeout(100);
    check('«На сайт» — копия артикула в 03_РЕТУШЬ сразу в Корзине (и при второй карточке того же артикула)', !FILES.has(RT3 + '/1/74596_модель/manekin2.jpg') && TRASHED.some(p => p.indexOf(RT3) === 0), JSON.stringify(TRASHED.slice(-3)));
    const v2 = await vis();
    check('отправили на сайт — карточка сразу пропала из этого вида', v2.length === 1 && v2[0] === ids.a, JSON.stringify([v2, ids, await page.evaluate(v => v.map(id => { const c = cbCardById(id), l = (cpMeta().rv[id] || []).slice(-1)[0];
      return [id, c && c.title, l && l.status, !!(cpMeta().delivered || {})[id], (cpMeta().cardStatus[id] || {}).s]; }), v2)]));
    page.once('dialog', d => d.accept('тени'));
    await page.click('[data-cp-rv="' + ids.a + '"] [data-cp-rva="rework"]');
    for (let i = 0; i < 60 && !inRv('manekin.tif').some(k => /_доработка\//.test(k)); i++) await page.waitForTimeout(100);
    await page.waitForFunction(i => cpMeta().rv[i].slice(-1)[0].status === 'rework', ids.a, { timeout: 5000 }).catch(() => {});
    check('«На доработку»: папка в 04 с припиской «_доработка», заметка на карточке', inRv('manekin.tif').some(k => /_доработка\/manekin\.tif$/.test(k))
      && await page.evaluate(i => { const l = cpMeta().rv[i].slice(-1)[0]; return l.status === 'rework' && l.note === 'тени' && /_доработка$/.test(l.dir); }, ids.a), JSON.stringify(inRv('manekin.tif')));
    /* новая версия прямо в карточку (Маша, 09.11): на доработке — кнопка «Загрузить новую версию»,
       тот же файл заменяется, папка «_доработка» снова называется как артикул */
    check('на доработке в карточке — кнопка «Загрузить новую версию»', /Загрузить новую версию/.test(await page.textContent('[data-cp-rvup="' + ids.a + '"]')));
    const dirA = await page.evaluate(i => cpMeta().rv[i].slice(-1)[0].dir.replace(/_доработка$/, ''), ids.a);
    await page.setInputFiles('[data-cp-rvfile="' + ids.a + '"]', { name: 'manekin.tif', mimeType: 'image/tiff', buffer: Buffer.from('RT2-manekin.tif') });
    await page.waitForFunction(i => { const l = cpMeta().rv[i].slice(-1)[0]; return l.status === 'review' && !/_доработка$/.test(l.dir); }, ids.a, { timeout: 8000 }).catch(() => {});
    check('новая версия в карточку: файл заменён, папка снова без «_доработка», версия на проверке', String(FILES.get(dirA + '/manekin.tif') || '') === 'RT2-manekin.tif'
      && !inRv('manekin.tif').some(k => /_доработка\//.test(k)) && await page.evaluate(i => { const l = cpMeta().rv[i]; const v = l[l.length - 1];
        return v.status === 'review' && v.kind === 'новая версия после доработки' && v.files.length === 1 && l[l.length - 2].status === 'rework'; }, ids.a),
      JSON.stringify([inRv('manekin.tif'), await page.evaluate(i => cpMeta().rv[i], ids.a)]));
    /* не хватает кадра: в карточке есть кадр, которого нет среди загруженных — тревога; догрузили перетаскиванием — тревоги нет */
    const pid2 = await page.evaluate(i => { const p = App.photos.find(x => x.name === 'manekin2.jpg'); const c = cbCardById(i);
      if (c.mode === 'auto') c.pids.push(p.id); else c.slots.push({ pid: p.id });
      if (!cpMeta().status[p.id]) cpMeta().status[p.id] = { s: 'retouch' };
      cbRenderCards(); cbRenderOutline(); return p.id; }, ids.a);
    const missA = await page.evaluate(i => cpRvMissingOf(i, cpMeta().rv[i].slice(-1)[0]), ids.a);
    check('в карточке не хватает кадра — красная строка «Не хватает кадр…: …manekin2.jpg» и метка в списке', /Не хватает кадр[^:]*:[^—]*manekin2\.jpg/.test(await page.textContent('[data-cp-rv="' + ids.a + '"]'))
      && new RegExp('не хватает ' + missA.count).test(await page.textContent('#cbOutline')), await page.textContent('[data-cp-rv="' + ids.a + '"]'));
    await page.evaluate(([i, names]) => {
      const dt = new DataTransfer(); names.forEach(n => dt.items.add(new File(['RT-' + n], n.replace(/\.jpg$/i, '.tif'), { type: 'image/tiff' })));
      const el = document.querySelector('.cb-card[data-cid="' + i + '"] .cp-rv-thumbs');
      el.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
      window.__ov = document.querySelector('.cb-card[data-cid="' + i + '"]').classList.contains('cp-rv-over');
      el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }, [ids.a, missA.names]);
    const nA = 1 + missA.names.length;
    await page.waitForFunction(([i, n]) => cpMeta().rv[i].slice(-1)[0].files.length === n, [ids.a, nA], { timeout: 8000 }).catch(() => {});
    check('перетащили недостающие кадры на карточку — добавлены в версию (не в галерею), тревоги нет', await page.evaluate(([i, n]) => window.__ov && cpMeta().rv[i].slice(-1)[0].files.length === n
      && cpMeta().rv[i].slice(-2)[0].status === 'replaced' && !document.querySelector('[data-cp-rv="' + i + '"] .cp-rv-miss') && !App.photos.some(p => p.name === 'manekin2.tif'), [ids.a, nA])
      && FILES.has(dirA + '/manekin2.tif'), JSON.stringify([missA, await page.evaluate(i => cpMeta().rv[i].slice(-1)[0], ids.a)]));
    await page.evaluate(([i, pid]) => { const c = cbCardById(i); if (c.mode === 'auto') c.pids = c.pids.filter(x => x !== pid); else c.slots = c.slots.filter(s => s.pid !== pid); cbRenderCards(); }, [ids.a, pid2]);
    /* сдача той же карточки папкой — это новая версия целиком: файл прошлой версии, которого нет в новой, уходит в Корзину */
    await up([['готово/74595', 'manekin.tif']]);
    for (let i = 0; i < 60 && FILES.has(dirA + '/manekin2.tif'); i++) await page.waitForTimeout(100);
    check('сдали папкой без файла — в 04 его больше нет (только последняя версия)', !FILES.has(dirA + '/manekin2.tif') && FILES.has(dirA + '/manekin.tif'),
      JSON.stringify([TRASHED.slice(-3), await page.evaluate(i => cpMeta().rv[i].slice(-2), ids.a)]));
    page.once('dialog', d => d.accept('тени ещё'));
    await page.click('[data-cp-rv="' + ids.a + '"] [data-cp-rva="rework"]');
    for (let i = 0; i < 60 && !inRv('manekin.tif').some(k => /_доработка\//.test(k)); i++) await page.waitForTimeout(100);
    await up([['готово/74595', 'manekin.tif']]);
    for (let i = 0; i < 60 && !TRASHED.some(p => /_доработка$/.test(p)); i++) await page.waitForTimeout(100);
    check('новая версия после доработки — рядом, папка с доработкой ушла в Корзину', inRv('manekin.tif').length === 1 && !/_доработка/.test(inRv('manekin.tif')[0]) && TRASHED.some(p => /_доработка$/.test(p))
      && await page.evaluate(i => cpMeta().rv[i].slice(-1)[0].status === 'review', ids.a), JSON.stringify([inRv('manekin.tif'), TRASHED.slice(-3)]));
    await page.click('[data-cp-rv="' + ids.a + '"] [data-cp-rva="approve"]');
    for (let i = 0; i < 80 && !TRASHED.includes(RV + '/' + SN); i++) await page.waitForTimeout(100);
    check('всё на сайте — папка съёмки в 04 опустела и ушла в Корзину', FILES.has(ST + '/' + today + '/' + SN + '/74595/manekin.tif') && TRASHED.includes(RV + '/' + SN), JSON.stringify(TRASHED.slice(-4)));
    for (let i = 0; i < 40 && !/принято[\s\S]*принято/.test((FILES.get('disk:/_ContentPulse/выработка.csv') || '').toString()); i++) await page.waitForTimeout(100);
    const out = (FILES.get('disk:/_ContentPulse/выработка.csv') || '').toString();
    check('выработка: таблица в служебной папке — сдано ×4, доработка, в карточку, принято ×2, с буквой и датой', /^\uFEFFдата;время;ретушёр/.test(out) && (out.match(/;сдано;/g) || []).length === 4
      && /;новая версия после доработки: заменено 1, добавлено 0;/.test(out) && /;догрузка в карточку: заменено 0, добавлено \d;/.test(out)
      && (out.match(/;принято;/g) || []).length === 2 && /;доработка: тени;/.test(out) && out.split('\n').some(l => l.indexOf(today + ';') === 0 && /;U;/.test(l)), out);
    await page.click('[data-cp-view-all]');
    check('«Показать все карточки» — снова все, полоски нет', !(await page.$('#cpViewBar')) && (await vis()).length > 2);
    await page.evaluate(p => { CP.stageFilter = ''; CP.viewStage = ''; CP.settings.site = p.site; if (p.retouched) CP.settings.retouched = p.retouched; else delete CP.settings.retouched; cbRenderCards(); }, prev);
  }

  /* статус = где лежит файл (шаг 1): сверка съёмки с папками этапов */
  {
    const RTS = 'disk:/Архив/РЕТУШЬ/2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST/';
    /* сдачу на время убираем (иначе сверка уберёт сданное из ретуши) и кладём ретушь заново:
       ретушёр переименовал папку артикула: U_74596_модель — буква на Диске */
    await page.evaluate(() => { window.__del = cpMeta().delivered; cpMeta().delivered = {}; });
    [RTS.slice(0, -1), RTS + '1', RTS + '1/U_74596_модель', RTS + '1/74595_модель'].forEach(d => DIRS.add(d));
    FILES.set(RTS + '1/U_74596_модель/manekin2.jpg', Buffer.from('Q'.repeat(140)));
    FILES.set(RTS + '1/74595_модель/manekin.jpg', Buffer.from('N'.repeat(130)));
    FILES.set(RTS + '1/чужой.jpg', Buffer.from('Z'.repeat(40)));   /* IMG_0101 на ретуши нет */
    /* папка согласования: съёмка с очерёдностью «!_» */
    const AP = 'disk:/Этапы/02_СОГЛАСОВАНИЕ', APS = AP + '/!_2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST';
    ['disk:/Этапы', AP, APS, APS + '/1', APS + '/1/74595_модель'].forEach(d => DIRS.add(d));
    FILES.set(APS + '/1/74595_модель/manekin.jpg', Buffer.from('M'.repeat(40)));
    const img = await page.evaluate(() => {
      CP.dict = cpParseDict('[Ретушёры: один]\nY\nU');
      CP.settings = Object.assign(CP.settings || {}, { approve: 'disk:/Этапы/02_СОГЛАСОВАНИЕ' });
      var p = App.photos.find(x => /IMG_0101/.test(x.disk));
      window.__prevImgStatus = cpMeta().status[p.id];
      cpMeta().status[p.id] = { s: 'approval', by: 'тест', ts: new Date().toISOString() };
      return p.id;
    });
    const res = await page.evaluate(() => cpMirrorSync(false).then(r => r && { changed: r.changed, missing: r.missing.map(x => x.name + ':' + x.s), unmatched: r.unmatched.map(x => x.path), roots: r.roots }));
    const c96 = await page.evaluate(() => App.cards.find(c => c.title === '74596'));
    check('сверка: буква из имени папки на Диске (U_74596_модель) стала тегом карточки', (c96.tags || []).includes('U') && !(c96.tags || []).includes('Y'), JSON.stringify([c96.tags, res]));
    check('сверка: папка съёмки найдена и с очерёдностью «!_», чужой файл на Диске — в расхождениях', res && res.roots.some(r => r.label === 'Согласование' && r.found.some(f => /!_2026-10-27/.test(f))) && res.unmatched.some(x => /чужой\.jpg$/.test(x)), JSON.stringify(res));
    check('сверка: статус есть, файла нет — в расхождениях, сама не снимает', res && res.missing.includes('IMG_0101.jpg:approval') && await page.evaluate(id => cpMeta().status[id].s === 'approval', img), JSON.stringify(res));
    check('в строке съёмки — «Диск: расхождений N»', /Диск: расхождений \d/.test(await page.textContent('#cpStatusLine')), await page.textContent('#cpStatusLine'));
    await page.click('#cpMirrorLink');
    await page.waitForSelector('#cpMirrorBox.cp-open', { timeout: 3000 });
    await page.click('[data-cp-mr="clear"]');
    check('«Снять статусы без файлов»', await page.evaluate(id => !cpMeta().status[id], img));
    await page.click('[data-cp-mr="close"]');
    /* файл появился на этапе — статус ставится сам */
    DIRS.add(APS + '/1');
    FILES.set(APS + '/1/IMG_0101.jpg', Buffer.from('I'.repeat(40)));
    await page.evaluate(() => cpMirrorSync(true));
    check('файл лежит в согласовании — кадр «на согласовании» (поставил Диск)', await page.evaluate(id => cpMeta().status[id] && cpMeta().status[id].s === 'approval' && cpMeta().status[id].by === 'Диск', img));
    await page.evaluate(id => { delete CP.settings.approve; CP.mirror = null; if (window.__prevImgStatus) cpMeta().status[id] = window.__prevImgStatus; cpMeta().delivered = window.__del; cbMarkDirty(); }, img);
  }

  /* статус пачкой: отмеченные в списке справа — в брак, на согласование, снять, на ретушь */
  await page.evaluate(() => { CP.checked = {}; cbRenderOutline(); });
  const bt = await page.evaluate(() => [App.cards.find(c => c.title === '74596').id, App.cards.find(c => c.title === '74598').id, App.photos.find(p => /manekin2/.test(p.disk)).id]);
  await page.check('[data-cp-ck="' + bt[0] + '"]');
  await page.check('[data-cp-ck="' + bt[1] + '"]');
  await page.click('[data-cp-batch="reshoot"]');
  check('пачкой «В брак»: обе карточки и их кадры', await page.evaluate(x => { var m = cpMeta(); return m.cardStatus[x[0]].s === 'reshoot' && m.cardStatus[x[1]].s === 'reshoot' && m.status[x[2]].s === 'reshoot'; }, bt));
  await page.click('[data-cp-batch="approval"]');
  check('пачкой «На согласование»', await page.evaluate(x => { var m = cpMeta(); return m.cardStatus[x[0]].s === 'approval' && m.status[x[2]].s === 'approval'; }, bt));
  await page.click('[data-cp-batch=""]');
  check('пачкой «Снять статус»', await page.evaluate(x => { var m = cpMeta(); return !m.cardStatus[x[0]] && !m.cardStatus[x[1]] && !m.status[x[2]]; }, bt));
  await page.click('[data-cp-batch="retouch"]');
  await page.waitForFunction(x => cpMeta().status[x[2]] && cpMeta().status[x[2]].s === 'retouch' && cpMeta().events.some(e => e.action === 'to_retouch' && /74596, 74598/.test(e.card || '')), bt, { timeout: 8000 }).catch(() => {});
  check('пачкой «На ретушь»: статусы и одна запись в журнале с копированием', await page.evaluate(x => cpMeta().cardStatus[x[0]].s === 'retouch' && cpMeta().events.some(e => e.action === 'to_retouch' && /74596, 74598/.test(e.card || '') && e.folder), bt));
  /* повторно «На ретушь» в том же составе — не отправляется и не перезаписывается */
  {
    const before = await page.evaluate(x => [cpMeta().status[x[2]].ts, cpMeta().events.filter(e => e.action === 'to_retouch').length], bt);
    await page.waitForTimeout(20);
    await page.click('[data-cp-batch="retouch"]');
    await page.waitForTimeout(300);
    const after = await page.evaluate(x => [cpMeta().status[x[2]].ts, cpMeta().events.filter(e => e.action === 'to_retouch').length], bt);
    check('повторно «На ретушь» в том же составе — без повторной записи', before[0] === after[0] && before[1] === after[1], JSON.stringify([before, after]));
  }
  await page.evaluate(() => { CP.checked = {}; cbRenderOutline(); });

  /* все файлы: видео тоже уходит в архив */
  await page.waitForFunction(() => !App.dirty && !CP.saving, null, { timeout: 8000 });
  await page.evaluate(() => cpShowShelf());
  await page.fill('#cpShelfSearch', 'МОДЕЛЬ');
  await page.click('.cp-shoot');
  await page.waitForSelector('#cpPanel.cp-open [data-cp-p="download"]', { timeout: 10000 });
  await page.evaluate(() => { CP.directMin = 400; CP.directPart = 200; });   /* clip.mp4 (500 байт) — «крупный» */
  /* из исходников скачивается всё — видео и прочие файлы считаются сами */
  await page.waitForFunction(() => CP.sel && CP.sel.allList && /других файлов: 1/.test(document.querySelector('#cpPanel .cp-sum').textContent), null, { timeout: 8000 });
  check('«Все файлы»: видео посчитано, мусор (.DS_Store) — нет', true);
  /* видео: «только видео» / «без видео», ничего не отмечено — всё */
  check('сверху — «только видео 1» и «без видео»; ничего не отмечено — «Скачать всё из Архив»', await page.evaluate(() =>
    /только видео 1/.test(document.querySelector('[data-cp-media="video"]').textContent) && !!document.querySelector('[data-cp-media="novideo"]')
    && /Скачать всё из Архив/.test(document.querySelector('[data-cp-p="download"]').textContent)));
  await page.click('[data-cp-media="video"]');
  check('«только видео» — кадров нет, кнопка «Скачать только видео · 1»', /Скачать только видео · 1/.test(await page.textContent('[data-cp-p="download"]')) && await page.evaluate(() => cpFiltered(CP.sel).length === 0));
  await page.click('[data-cp-media="novideo"]');
  check('«без видео» — видео не скачивается', /Скачать без видео/.test(await page.textContent('[data-cp-p="download"]')) && await page.evaluate(() => cpFilteredOthers(CP.sel).every(x => !/\.mp4$/.test(x.file.name)) && cpFiltered(CP.sel).length > 0));
  await page.click('[data-cp-media="novideo"]');
  await page.click('[data-cp-p="download"]');
  await page.waitForFunction(() => [...document.querySelectorAll('#cpDlCard a.cp-dlcard-btn')].some(a => a.textContent === 'clip.mp4'), null, { timeout: 10000 });
  for (let i = 0; i < 30 && !DOWNLOADS.some(p => /видео\/clip\.mp4$/.test(p)); i++) await page.waitForTimeout(100);
  check('крупное видео — отдельной ссылкой, перенесено частями и скачивается', MPU_PARTS.length === 3 && DOWNLOADS.some(p => /видео\/clip\.mp4$/.test(p)), MPU_PARTS.join(',') + ' :: ' + DOWNLOADS.slice(-3).join(' | '));
  await page.evaluate(() => { CP.directMin = 3.9 * 1024 * 1024 * 1024; CP.directPart = 256 * 1024 * 1024; });
  /* видео — в том же архиве, кусками (Маша, 08.11: «на 5 ГБ 15 архивов»): clip.mp4 (500 байт) — «большой», куски по 200 */
  const zVid = [...ZIPS.entries()].filter(([k]) => /МОДЕЛЬ_МУЖ_TEST_1\.zip$/.test(k)).flatMap(([, v]) => v);
  {
    /* новый архив — новый ключ или тот же ключ с новым содержимым (номер скачивания мог не успеть вырасти) */
    const crcBefore = CRC_CALLS.length, slBefore = ZIP_SLICES.length, zBefore = new Map(ZIPS);
    const fresh = () => [...ZIPS.keys()].find(k => !zBefore.has(k) || zBefore.get(k) !== ZIPS.get(k));
    await page.evaluate(() => { CP.zipBigMin = 300; CP.zipSlice = 200; CP.zipTarget = 250; CP.zipPartMin = 100; });
    await page.click('[data-cp-p="download"]');
    for (let i = 0; i < 80 && !fresh(); i++) await page.waitForTimeout(100);
    const zk = fresh();
    const zn = zk ? ZIPS.get(zk) : [];
    check('видео — в том же архиве одним файлом: контрольная сумма по кускам (3), в архив тремя кусками, отдельных ссылок нет',
      zn.filter(n => /видео\/clip\.mp4$/.test(n)).length === 1 && CRC_CALLS.length - crcBefore === 3 && ZIP_SLICES.length - slBefore === 3
      && ZIP_SLICES.slice(slBefore).filter(x => / head$/.test(x)).length === 1
      && !(await page.evaluate(() => [...document.querySelectorAll('#cpDlCard a.cp-dlcard-btn')].some(a => a.textContent === 'clip.mp4'))),
      JSON.stringify([zk, zn, CRC_CALLS.slice(crcBefore), ZIP_SLICES.slice(slBefore)]));
    await page.evaluate(() => { CP.zipBigMin = 64 * 1024 * 1024; CP.zipSlice = 256 * 1024 * 1024; CP.zipTarget = 400 * 1024 * 1024; CP.zipPartMin = 6 * 1024 * 1024; });
  }
  check('«скачать всё» из исходников: структура как на Диске, кадр карточки артикула — в папке артикула (и кадр лука, попавший в карточку)',
    zVid.some(n => /_1\/1\/74595_модель\/IMG_0101\.jpg$/.test(n)) && zVid.some(n => /_1\/1\/74595_модель\/manekin\.jpg$/.test(n)) && !zVid.some(n => /_1\/74595\//.test(n)), zVid.join(' | '));
  check('«Все файлы»: кадры в архиве, видео в архив не попало', !zVid.some(n => /clip\.mp4$/.test(n)) && zVid.filter(n => /\.jpg$/.test(n)).length === 3, zVid.join(' | '));

  /* дерево папок на панели: раскрыть до последнего уровня, отметить одну вложенную, статусы вложенных */
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
  const zipsBefore = new Set(ZIPS.keys());
  await page.click('[data-cp-p="download"]');
  for (let i = 0; i < 60 && ![...ZIPS.keys()].some(k => !zipsBefore.has(k)); i++) await page.waitForTimeout(100);
  const zSub = [...ZIPS.entries()].filter(([k]) => !zipsBefore.has(k)).flatMap(([, v]) => v);
  check('«Скачать отмеченные» по вложенной папке: в архиве только её кадры', zSub.length === 2 && zSub.every(n => /_\d+\/1\/74595_модель\//.test(n)), zSub.join(' | '));
  await page.screenshot({ path: path.join(ROOT, 'tests', 'shot-tree-open.png') });
  await page.click('[data-cp-p="expall"]');
  check('«свернуть все» сворачивает дерево', await page.evaluate(() => !document.querySelector('[data-cp-fold="1/74595_модель"]')));
  check('у свёрнутой папки видно, что внутри отмечено', /отмечено 1/.test(await page.textContent('[data-cp-exp="1"]')));
  await page.screenshot({ path: path.join(ROOT, 'tests', 'shot-tree.png') });
  /* панель скачивания можно скрыть */
  await page.click('#cpPanelToggle');
  check('«Скрыть панель»: панели съёмки нет', await page.evaluate(() => document.body.classList.contains('cp-panel-off') && getComputedStyle(document.getElementById('cpPanel')).display === 'none'));
  await page.click('#cpPanelToggle');
  /* отмеченная папка + «Открыть»: галерея и карточки сразу по ней */
  await page.click('[data-cp-exp="1"]');
  await page.uncheck('[data-cp-fold="1/74595_модель"]').catch(() => {});
  await page.check('[data-cp-fold="1/74596_модель"]');
  await page.click('[data-cp-p="open"]');
  await page.waitForFunction(() => !document.getElementById('cpShelf').classList.contains('cp-open') && CP.cardFolders, null, { timeout: 10000 }).catch(() => {});
  check('открыли с отмеченной папкой: галерея и карточки по ней', await page.evaluate(() => {
    var vis = id => getComputedStyle(document.querySelector('#cbCards .cb-card[data-cid="' + id + '"]')).display !== 'none';
    var a = App.cards.find(c => c.title === '74595'), b = App.cards.find(c => c.title === '74596');
    return CP.folder === '1/74596_модель' && vis(b.id) && !vis(a.id);
  }), await page.evaluate(() => JSON.stringify([CP.folder, CP.cardFolders])));
  await page.click('[data-cp-o="nofilter"]');
  check('«все карточки» снимает фильтр', await page.evaluate(() => !CP.cardFolders && [...document.querySelectorAll('#cbCards .cb-card')].every(el => el.style.display !== 'none')));
  /* «Назад» в браузере — на витрину, «Вперёд» — обратно в съёмку */
  await page.evaluate(() => history.back());
  await page.waitForFunction(() => document.getElementById('cpShelf').classList.contains('cp-open'), null, { timeout: 5000 }).catch(() => {});
  check('«Назад» в браузере из съёмки — витрина', await page.evaluate(() => document.getElementById('cpShelf').classList.contains('cp-open') && !!CP.shoot));
  await page.evaluate(() => history.forward());
  await page.waitForFunction(() => !document.getElementById('cpShelf').classList.contains('cp-open'), null, { timeout: 5000 }).catch(() => {});
  check('«Вперёд» — снова в съёмке', await page.evaluate(() => !document.getElementById('cpShelf').classList.contains('cp-open') && /МОДЕЛЬ/.test(CP.shoot.name)));

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
  for (let i = 0; i < 50 && !FILES.has('disk:/Архив/РЕТУШЬ/LM-1043/part2/d.jpg'); i++) await page.waitForTimeout(100);
  check('добавили в карточку на ретуши — кадр сам ушёл на ретушь (и копия)', FILES.has('disk:/Архив/РЕТУШЬ/LM-1043/part2/d.jpg'), [...FILES.keys()].filter(k => /РЕТУШЬ\/LM-1043/.test(k)).join(' | '));
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

  /* витрина: что нужно сделать — Отбор / Ретушь / Согласование (сводка в свойствах папки съёмки) */
  {
    const mk = (name, status, cardStatus, delivered, tags) => {
      const dir = 'disk:/Архив/' + name;
      DIRS.add(dir);
      FILES.set(dir + '/x.jpg', Buffer.from('X'.repeat(50)));
      FILES.set(dir + '/_contentpulse.json', Buffer.from(JSON.stringify({ app: 'cardboard', version: 3, name, nextId: 5,
        photos: [{ id: 'p1', name: 'x.jpg', disk: dir + '/x.jpg' }], cards: [{ id: 'c1', title: 'K', mode: 'auto', pids: ['p1'], tags: tags || [] }], containers: [], templates: [],
        meta: { cp: { status: status ? { p1: { s: status, by: 't', ts: '2026-11-06T10:00:00Z', card: 'c1' } } : {}, cardStatus: cardStatus ? { c1: { s: cardStatus, by: 't', ts: '2026-11-06T10:00:00Z' } } : {}, downloads: {}, likes: {}, folderTags: {}, events: [], delivered: delivered ? { c1: { files: 1, letter: 'Y', date: '06.11.2026' } } : {} } } })));
    };
    mk('2026-11-04_СДАНА', 'retouch', 'retouch', true);
    /* папка сданной съёмки ещё лежит в ретуши — но в фильтре ретуши её быть не должно */
    DIRS.add('disk:/Архив/РЕТУШЬ/2026-11-04_СДАНА'); FILES.set('disk:/Архив/РЕТУШЬ/2026-11-04_СДАНА/x.jpg', Buffer.from('X'.repeat(50)));
    DIRS.add('disk:/Архив/РЕТУШЬ/2026-11-03_ЗАБРАЛИ'); FILES.set('disk:/Архив/РЕТУШЬ/2026-11-03_ЗАБРАЛИ/x.jpg', Buffer.from('X'.repeat(50)));
    mk('2026-11-03_ЗАБРАЛИ', 'retouch', 'retouch', false, ['Y']);
    mk('2026-11-05_ЖДЁТ_РЕТУШИ', 'retouch', 'retouch');
    mk('2026-11-05_ЖДЁТ_СОГЛАСОВАНИЯ', 'approval', 'approval');
    PROPS.delete('disk:/Архив/LM-1043');
    await page.evaluate(() => { CP.dict = cpParseDict('[Ретушёры: один]\nY\nU'); cpShowShelf(); });
    await page.fill('#cpShelfSearch', '');
    await page.evaluate(() => cpRenderShoots());
    await page.waitForFunction(() => document.getElementById('cpStages') && !document.querySelector('.cp-stages-wait') && CP.shoots.length > 3, null, { timeout: 20000 }).catch(() => {});
    /* «забрали» зависит от словаря (буквы ретушёров): пересчитать с ним */
    PROPS.delete('disk:/Архив/2026-11-03_ЗАБРАЛИ');
    await page.evaluate(() => { CP.dict = cpParseDict('[Ретушёры: один]\nY\nU'); return cpLoadShoots(); });
    await page.waitForFunction(() => !document.querySelector('.cp-stages-wait') && CP.shoots.some(d => d.name === '2026-11-03_ЗАБРАЛИ' && (d.cpSum || (d.custom_properties || {}).cp_sum)), null, { timeout: 20000 }).catch(() => {});
    check('сводка съёмок без неё — посчитана в фоне и записана в свойства папок', PROPS.has('disk:/Архив/LM-1043') && /^v5;/.test(PROPS.get('disk:/Архив/LM-1043').cp_sum)
      && /rt=1/.test((PROPS.get('disk:/Архив/2026-11-05_ЖДЁТ_РЕТУШИ') || {}).cp_sum || ''), JSON.stringify([...PROPS.entries()]));
    const shownFor = async key => { await page.click('[data-cp-stage="' + key + '"]'); return page.evaluate(() => [...document.querySelectorAll('#cpShelfList .cp-shoot')].map(b => b.dataset.name)); };
    const rt = await shownFor('retouch');
    check('фильтр папки ретуши: съёмки, у которых папка лежит в РЕТУШЬ; без папки на Диске — нет', rt.includes('2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST') && rt.includes('LM-1043') && !rt.includes('2026-11-05_ЖДЁТ_РЕТУШИ'), rt.join(' | '));
    check('фильтр ретуши: полностью сданная съёмка скрыта, хотя папка в ретуши лежит; недоделанная — видна', !rt.includes('2026-11-04_СДАНА') && rt.includes('2026-11-03_ЗАБРАЛИ'), rt.join(' | '));
    const ap = await shownFor('approval');
    check('фильтр «Согласование»', ap.includes('2026-11-05_ЖДЁТ_СОГЛАСОВАНИЯ') && !ap.includes('2026-11-05_ЖДЁТ_РЕТУШИ'), ap.join(' | '));
    const sl = await shownFor('select');
    check('фильтр «Отбор»: съёмки без отбора (LM-2001) — тут, готовые — нет', sl.includes('LM-2001') && !sl.includes('2026-11-05_ЖДЁТ_РЕТУШИ'), sl.join(' | '));
    await page.click('[data-cp-stage=""]');
    check('под съёмкой — что ждёт: «ретушь: 1», «отбора нет»', await page.evaluate(() => {
      var row = n => [...document.querySelectorAll('#cpShelfList .cp-shoot')].find(b => b.dataset.name === n);
      return /ждут ретушёра: 1/.test(row('2026-11-05_ЖДЁТ_РЕТУШИ').textContent) && /отбора нет/.test(row('LM-2001').textContent)
        && /отбор 1/.test((row('2026-09-21_SV_ОПТИКА_N').querySelector('.cp-artbar') || {}).textContent || '');
    }));
    check('фильтры названы как папки на Диске: архив, Отбор, РЕТУШЬ…', /^Архив\s*\d+Отбор/.test((await page.textContent('#cpStages')).trim()) && /РЕТУШЬ\s*\d+/.test(await page.textContent('#cpStages')), await page.textContent('#cpStages'));
    /* задали папку согласования — фильтр называется как она и показывает съёмки, у которых там есть папка */
    await page.evaluate(() => { CP.settings.approve = 'disk:/Этапы/02_СОГЛАСОВАНИЕ'; return cpScanStages(); });
    const ap2 = await shownFor('approval');
    check('папка согласования: фильтр «02_СОГЛАСОВАНИЕ», съёмка с «!_» в нём, без папки — нет', /02_СОГЛАСОВАНИЕ\s*1/.test(await page.textContent('#cpStages')) && ap2.includes('2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST') && !ap2.includes('2026-11-05_ЖДЁТ_СОГЛАСОВАНИЯ'), JSON.stringify([ap2, await page.textContent('#cpStages')]));
    await page.evaluate(() => { delete CP.settings.approve; return cpScanStages(); });
    await page.click('[data-cp-stage=""]');
    check('под съёмкой — артикулы по стадиям: полоска и числа', await page.evaluate(() => {
      var row = n => [...document.querySelectorAll('#cpShelfList .cp-shoot')].find(b => b.dataset.name === n);
      var a = row('2026-11-04_СДАНА').querySelector('.cp-artbar'), b = row('2026-11-05_ЖДЁТ_РЕТУШИ').querySelector('.cp-artbar'), c = row('2026-11-05_ЖДЁТ_СОГЛАСОВАНИЯ').querySelector('.cp-artbar');
      return a && /артикулов 1/.test(a.textContent) && /Сайт 1/.test(a.textContent) && b && /РЕТУШЬ 1/.test(b.textContent) && c && /Согласование 1/.test(c.textContent) && !row('LM-2001').querySelector('.cp-artbar')
        && /артикулов 3/.test(row('2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST').querySelector('.cp-artbar').textContent) && /Сайт 1/.test(row('2026-10-27_SV_МОДЕЛЬ_МУЖ_TEST').querySelector('.cp-artbar').textContent)
        && /забрали 1/.test(row('2026-11-03_ЗАБРАЛИ').querySelector('.cp-artbar').textContent) && !/скачано/.test(document.getElementById('cpShelfList').textContent);
    }), await page.evaluate(() => [...document.querySelectorAll('#cpShelfList .cp-artbar')].map(x => x.textContent).join(' | ')));
    await page.screenshot({ path: path.join(ROOT, 'tests', 'shot-stages.png') });
    await page.fill('#cpShelfSearch', '1043');
    await page.evaluate(() => cpRenderShoots());
  }

  /* один путь — КАТАЛОГ: этапы по папкам, фильтры = папки, 00_АРХИВ не читаем, недостающие — кнопкой */
  {
    const K = 'disk:/КАТАЛОГ';
    [K + '/01_ИСХОДНИКИ', K + '/01_ИСХОДНИКИ/2026-11-06_SV_КАТ', K + '/02_ОТБОР', K + '/02_ОТБОР/2026-11-06_SV_КАТ', K + '/03_РЕТУШЬ', K + '/04_САЙТ', K + '/04_САЙТ/01.11', K + '/ПРОЧЕЕ'].forEach(d => DIRS.add(d));
    FILES.set(K + '/04_САЙТ/01.11/s.jpg', Buffer.from('S'.repeat(30)));
    FILES.set(K + '/01_ИСХОДНИКИ/2026-11-06_SV_КАТ/k1.jpg', Buffer.from('K'.repeat(60)));
    FILES.set(K + '/02_ОТБОР/2026-11-06_SV_КАТ/k1.jpg', Buffer.from('K'.repeat(60)));
    /* в ретуши — две папки артикулов, одну ретушёр Y уже забрал */
    [K + '/03_РЕТУШЬ/2026-11-06_SV_КАТ', K + '/03_РЕТУШЬ/2026-11-06_SV_КАТ/Y_74001_модель', K + '/03_РЕТУШЬ/2026-11-06_SV_КАТ/74002_модель'].forEach(d => DIRS.add(d));
    FILES.set(K + '/03_РЕТУШЬ/2026-11-06_SV_КАТ/Y_74001_модель/k1.jpg', Buffer.from('K'.repeat(60)));
    FILES.set(K + '/03_РЕТУШЬ/2026-11-06_SV_КАТ/74002_модель/k2.jpg', Buffer.from('K'.repeat(60)));
    await page.fill('#cpShelfSearch', '');
    await page.click('#cpGear');
    await page.fill('#cpArchiveInput', 'КАТАЛОГ');
    await page.click('#cpArchiveApply');
    await page.waitForFunction(() => CP.catalogList && CP.shoots && CP.shoots.some(s => s.name === '2026-11-06_SV_КАТ') && /02_ОТБОР\s*1/.test(document.getElementById('cpStages').textContent), null, { timeout: 10000 }).catch(() => {});
    const st = await page.evaluate(() => ({ sd: CP_CONFIG.serviceDir, shoots: CP.shoots.map(s => s.name), stages: document.getElementById('cpStages').textContent, s: CP.settings }));
    check('каталог: служебная папка внутри, съёмки только из исходников (00_АРХИВ не читаем)', st.sd === K + '/_ContentPulse' && st.shoots.includes('2026-11-06_SV_КАТ') && !st.shoots.includes('2026-11-01_SV_ПРЕДМЕТКА') && !st.shoots.includes('02_ОТБОР'), JSON.stringify(st));
    /* другой браузер (или Windows): «каталог» в нём ещё не запомнен — витрина узнаёт его сама */
    await page.evaluate(() => { cpSet('cp_catalog', ''); CP_CONFIG.serviceDir = 'disk:/_ContentPulse'; return cpLoadShoots(); });
    await page.waitForFunction(() => /^01_ИСХОДНИКИ/.test(document.getElementById('cpStages').textContent.trim()), null, { timeout: 8000 }).catch(() => {});
    check('каталог не запомнен в браузере — узнаётся сам: фильтры по папкам, служебная папка внутри каталога', await page.evaluate(k => cpGet('cp_catalog', '') === k
      && CP_CONFIG.serviceDir === k + '/_ContentPulse' && /^01_ИСХОДНИКИ/.test(document.getElementById('cpStages').textContent.trim()), K), await page.textContent('#cpStages'));
    check('что значит папка — по смыслу имени, потом по номеру: 04_САЙТ — сайт', await page.evaluate(() => cpCatRoleOf('04_САЙТ', {}) === 'site' && cpCatRoleOf('04_ОТРЕТУШИРОВАНО', {}) === 'review'
      && cpCatRoleOf('03_РЕТУШЬ', {}) === 'retouch' && cpCatRoleOf('00_АРХИВ', {}) === 'skip' && cpCatRoleOf('02_ОТБОР', {}) === 'approval' && cpCatRoleOf('05_X', {}) === 'site' && cpCatRoleOf('ПРОЧЕЕ', {}) === 'skip'));
    check('каталог: фильтры = папки (01, 02_ОТБОР, 03, 04_САЙТ — по имени это сайт), нет «отретушировано» — нет фильтра, внутреннего «Отбора» нет',
      /^01_ИСХОДНИКИ\s*\d+02_ОТБОР/.test(st.stages.trim()) && !/Отбор в/.test(st.stages) && /02_ОТБОР\s*1/.test(st.stages) && /03_РЕТУШЬ/.test(st.stages) && /04_САЙТ/.test(st.stages) && !/ОТРЕТУШ|Согласование|ПРОЧЕЕ/.test(st.stages)
      && st.s.approve === K + '/02_ОТБОР' && st.s.retouch === K + '/03_РЕТУШЬ' && st.s.site === K + '/04_САЙТ' && !st.s.retouched, st.stages);
    await page.evaluate(() => { CP.dict = cpParseDict('[Ретушёры: один]\nY\nU'); return cpCountStageArts(); });
    await page.waitForFunction(() => { const b = [...document.querySelectorAll('#cpShelfList .cp-shoot')].find(x => x.dataset.name === '2026-11-06_SV_КАТ'); return b && /03_РЕТУШЬ/.test(b.textContent); }, null, { timeout: 8000 }).catch(() => {});
    const katCard = await page.evaluate(() => { const b = [...document.querySelectorAll('#cpShelfList .cp-shoot')].find(x => x.dataset.name === '2026-11-06_SV_КАТ'); return b ? b.textContent : ''; });
    check('под съёмкой — где сейчас её артикулы, по папкам: 02_ОТБОР есть, 03_РЕТУШЬ 2 (забрали 1)', /02_ОТБОР есть/.test(katCard) && /03_РЕТУШЬ 2 \(забрали 1\)/.test(katCard) && !/ждут ретушёра/.test(katCard), katCard);
    /* в фильтре этапа панель съёмки показывает, что лежит в папке этапа сейчас */
    await page.keyboard.press('Escape');
    await page.click('[data-cp-stage="retouch"]');
    await page.click('#cpShelfList .cp-shoot[data-name="2026-11-06_SV_КАТ"]');
    await page.waitForFunction(() => /файлов 2/.test((document.getElementById('cpPanel') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
    const pan = await page.textContent('#cpPanel');
    check('панель в фильтре 03_РЕТУШЬ: структура папки этапа — Y_74001_модель (забрал Y), 74002_модель, файлов 2; не исходники', /в папке 03_РЕТУШЬ/.test(pan)
      && /Y_74001_модель/.test(pan) && /забрал Y/.test(pan) && /74002_модель/.test(pan) && /Здесь файлов: 2/.test(pan) && !/k1\.jpg · 1/.test(pan) && /Скачать всё из 03_РЕТУШЬ · 2/.test(pan), pan.slice(0, 400));
    /* теги сверху: буква ретушёра из имени папки и «без ретушёра»; отметил тег — скачивается только он */
    check('панель этапа: сверху теги — Y 1, «без ретушёра» 1', await page.evaluate(() => {
      const t = [...document.querySelectorAll('#cpPanel [data-cp-stag]')].map(b => b.textContent.trim());
      return t.includes('Y 1') && t.includes('без ретушёра 1'); }), await page.evaluate(() => [...document.querySelectorAll('#cpPanel [data-cp-stag]')].map(b => b.textContent.trim()).join(' | ')));
    await page.click('#cpPanel [data-cp-stag="Y"]');
    check('отметила тег Y — кнопка «Скачать по тегам · 1»', /Скачать по тегам · 1/.test(await page.textContent('[data-cp-stdl]')), await page.textContent('[data-cp-stdl]'));
    await page.click('[data-cp-stdl]');
    await page.waitForFunction(() => /Архив готов/.test((document.getElementById('cpDlCard') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    const zY = [...ZIPS.entries()].filter(([k]) => /2026-11-06_SV_КАТ_03_РЕТУШЬ_Y_/.test(k)).flatMap(([, v]) => v);
    check('скачалось только с тегом Y — папка Y_74001_модель, без 74002', zY.length === 1 && /Y_74001_модель\/k1\.jpg$/.test(zY[0]), JSON.stringify([...ZIPS.keys()].slice(-2)) + ' ' + zY.join(' | '));
    await page.click('[data-cp-p="close"]');
    /* 02_ОТБОР (Маша, 09.11): «только отбор» или «все файлы съёмки», с видео / без видео */
    {
      const CLIP = K + '/01_ИСХОДНИКИ/2026-11-06_SV_КАТ/clip.mov';
      FILES.set(CLIP, Buffer.from('V'.repeat(70)));
      await page.click('[data-cp-stage="approval"]');
      await page.click('#cpShelfList .cp-shoot[data-name="2026-11-06_SV_КАТ"]');
      await page.waitForFunction(() => /Только отбор/.test((document.getElementById('cpPanel') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
      check('02: чипы «Только отбор 1» и «Все файлы съёмки», по умолчанию — только отбор', await page.evaluate(() => {
        const on = document.querySelector('#cpPanel [data-cp-scope].cp-on'); return on && on.getAttribute('data-cp-scope') === 'stage' && /Только отбор\s*1/.test(on.textContent) && !!document.querySelector('#cpPanel [data-cp-scope="all"]'); }),
        await page.textContent('#cpPanel'));
      await page.click('#cpPanel [data-cp-scope="all"]');
      await page.waitForFunction(() => /Все файлы съёмки\s*2/.test((document.getElementById('cpPanel') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
      check('«Все файлы съёмки» — исходники (кадр и видео), чипы «только видео 1 · без видео 1»', await page.evaluate(() => {
        const t = document.getElementById('cpPanel').textContent; return /Все файлы съёмки\s*2/.test(t) && /только видео\s*1/.test(t) && /без видео\s*1/.test(t) && /Скачать файлы съёмки · 2/.test(t); }), await page.textContent('#cpPanel'));
      await page.click('#cpPanel [data-cp-smedia="video"]');
      const zb = new Set(ZIPS.keys());
      await page.click('[data-cp-stdl]');
      for (let i = 0; i < 80 && ![...ZIPS.keys()].some(k => !zb.has(k)); i++) await page.waitForTimeout(100);
      const zv = [...ZIPS.entries()].filter(([k]) => !zb.has(k)).flatMap(([, v]) => v);
      check('из 02 скачали «все файлы съёмки, только видео» — в архиве clip.mov', zv.length === 1 && /\/clip\.mov$/.test(zv[0]) && [...ZIPS.keys()].some(k => !zb.has(k) && /_02_ОТБОР_все файлы\+видео_/.test(k)), JSON.stringify([[...ZIPS.keys()].filter(k => !zb.has(k)), zv]));
      FILES.delete(CLIP);
      await page.click('[data-cp-p="close"]');
      await page.click('[data-cp-stage="retouch"]');
    }
    /* удалили папку съёмки из этапа на Диске — при следующей сверке (сама, раз в 45 с) съёмка из фильтра пропадает */
    DIRS.delete(K + '/02_ОТБОР/2026-11-06_SV_КАТ'); FILES.delete(K + '/02_ОТБОР/2026-11-06_SV_КАТ/k1.jpg');
    await page.evaluate(() => cpScanStages());
    await page.waitForFunction(() => /02_ОТБОР\s*0/.test(document.getElementById('cpStages').textContent), null, { timeout: 5000 }).catch(() => {});
    check('удалили папку съёмки из 02_ОТБОР на Диске — из фильтра пропала (по папкам, не по отметкам программы)', /02_ОТБОР\s*0/.test(await page.textContent('#cpStages')), await page.textContent('#cpStages'));
    await page.click('[data-cp-stage=""]');
    await page.click('#cpGear');
    check('каталог: в шестерёнке — папки и что они значат, отдельные поля этапов скрыты', await page.evaluate(() =>
      document.querySelectorAll('#cpCatBox [data-cp-cat]').length === 6 && document.querySelector('[data-cp-cat="ПРОЧЕЕ"]').value === 'не показывать'
      && document.querySelector('[data-cp-cat="00_АРХИВ"]').value === 'не показывать' && getComputedStyle(document.getElementById('cpRetouchInput')).display === 'none' || !document.getElementById('cpRetouchInput').offsetParent));
    const miss = await page.textContent('#cpCatMissing');
    check('каталог: «нет 04_ОТРЕТУШИРОВАНО; 04_САЙТ → 05_САЙТ» — на витрине, сама ничего не делает', /нет: 04_ОТРЕТУШИРОВАНО/.test(miss) && /04_САЙТ → 05_САЙТ/.test(miss) && !DIRS.has(K + '/04_ОТРЕТУШИРОВАНО') && DIRS.has(K + '/04_САЙТ'), miss);
    page.once('dialog', d => d.accept());
    await page.click('#cpCatBox [data-cp-cat-make]');
    await page.waitForFunction(() => document.querySelector('[data-cp-stage="review"]') && !document.getElementById('cpCatMissing'), null, { timeout: 10000 }).catch(() => {});
    check('«Исправить папки»: 04_ОТРЕТУШИРОВАНО создана, 04_САЙТ → 05_САЙТ со всем, что внутри; фильтры по новым именам',
      DIRS.has(K + '/04_ОТРЕТУШИРОВАНО') && DIRS.has(K + '/05_САЙТ') && !DIRS.has(K + '/04_САЙТ') && FILES.has(K + '/05_САЙТ/01.11/s.jpg')
      && /04_ОТРЕТУШИРОВАНО/.test(await page.textContent('#cpStages')) && /05_САЙТ/.test(await page.textContent('#cpStages'))
      && await page.evaluate(k => CP.settings.site === k + '/05_САЙТ' && CP.settings.retouched === k + '/04_ОТРЕТУШИРОВАНО', K), JSON.stringify([MOVED.slice(-2), await page.textContent('#cpStages')]));
    /* 00_АРХИВ включили как исходники: строка в настройках, его съёмки на витрине */
    await page.selectOption('[data-cp-cat="00_АРХИВ"]', 'исходники');
    await page.waitForFunction(() => CP.shoots && CP.shoots.some(s => s.name === '2026-11-01_SV_ПРЕДМЕТКА') && CP.shoots.some(s => s.name === '2026-11-06_SV_КАТ'), null, { timeout: 10000 }).catch(() => {});
    const setTxt = (FILES.get(K + '/_ContentPulse/настройки.txt') || '').toString();
    check('00_АРХИВ = «исходники»: строка в настройках, его съёмки на витрине', /^этап 00_АРХИВ = исходники$/m.test(setTxt)
      && await page.evaluate(() => CP.shoots.some(s => s.name === '2026-11-01_SV_ПРЕДМЕТКА')), setTxt.slice(-120));
    await page.selectOption('[data-cp-cat="00_АРХИВ"]', 'не показывать');
    await page.waitForFunction(() => CP.shoots && !CP.shoots.some(s => s.name === '2026-11-01_SV_ПРЕДМЕТКА'), null, { timeout: 10000 }).catch(() => {});
    check('снова «не показывать» — съёмок архива нет', await page.evaluate(() => !CP.shoots.some(s => s.name === '2026-11-01_SV_ПРЕДМЕТКА')));
    /* «Сайт» (Маша, 09.11): плитки дат — «важна дата и что в эту дату сдано»; «скачано» — по папке артикула,
       по умолчанию качается всё за дату, галочкой — пропустить уже скачанное */
    {
      const today = await page.evaluate(() => cpToday());
      const S5 = K + '/05_САЙТ', A = '2026-11-06_SV_КАТ', B = '2026-11-07_SV_КАТ2', D2 = S5 + '/2026-10-20';
      [K + '/01_ИСХОДНИКИ/' + B, S5 + '/' + today, S5 + '/' + today + '/' + A, S5 + '/' + today + '/' + A + '/74001', D2, D2 + '/' + B, D2 + '/' + B + '/75001', D2 + '/' + B + '/75002'].forEach(d => DIRS.add(d));
      FILES.set(K + '/01_ИСХОДНИКИ/' + B + '/b1.jpg', Buffer.from('B'.repeat(40)));
      FILES.set(S5 + '/' + today + '/' + A + '/74001/k1.jpg', Buffer.from('R'.repeat(50)));
      FILES.set(D2 + '/' + B + '/75001/b1.jpg', Buffer.from('R'.repeat(45)));
      FILES.set(D2 + '/' + B + '/75002/b2.jpg', Buffer.from('R'.repeat(46)));
      if (await page.isVisible('#cpArchiveInput')) await page.keyboard.press('Escape');
      await page.click('#cpShelfRefresh');
      await page.waitForFunction(b => CP.shoots && CP.shoots.some(s => s.name === b), B, { timeout: 10000 }).catch(() => {});
      await page.click('[data-cp-stage="site"]');
      const tiles = () => page.evaluate(() => [...document.querySelectorAll('#cpShelfList [data-cp-date]')].map(b => b.getAttribute('data-cp-date').split('/').pop()));
      const chips = () => page.evaluate(() => [...document.querySelectorAll('[data-cp-site-sub]')].map(b => b.textContent.replace(/\s+/g, ' ').trim()).join(' | '));
      const tileTxt = d => page.evaluate(d => { const b = [...document.querySelectorAll('#cpShelfList [data-cp-date]')].find(x => x.getAttribute('data-cp-date').endsWith('/' + d)); return b ? b.textContent : ''; }, d);
      await page.waitForFunction(() => document.querySelectorAll('#cpShelfList [data-cp-date]').length >= 3 && !/читаю/.test(document.getElementById('cpShelfList').textContent), null, { timeout: 10000 }).catch(() => {});
      const t0 = await tiles(), c0 = await chips();
      check('«Сайт»: плитки дат, свежие сверху (сегодня, 01.11, 2026-10-20); чипы «Все даты 3 · Не скачано 3 · Ближайшие даты 1»', JSON.stringify(t0) === JSON.stringify([today, '01.11', '2026-10-20'])
        && /Все даты 3/.test(c0) && /Не скачано 3/.test(c0) && /Ближайшие даты \(7 дней\) 1/.test(c0), JSON.stringify([t0, c0]));
      const tt = await tileTxt('2026-10-20');
      check('в плитке даты — съёмки, артикулы, «не скачано 2 из 2»', /20\.10\.2026/.test(tt) && tt.indexOf(B) !== -1 && /артикулов 2/.test(tt) && /не скачано 2 из 2/.test(tt), tt);
      check('на вкладке «05_САЙТ» — число дат', /05_САЙТ\s*3/.test(await page.textContent('#cpStages')), await page.textContent('#cpStages'));
      await page.screenshot({ path: path.join(ROOT, 'tests', 'shot-site.png') });
      await page.click('[data-cp-site-sub="recent"]');
      check('«Ближайшие даты» — только то, что пришло за 7 дней', JSON.stringify(await tiles()) === JSON.stringify([today]), JSON.stringify(await tiles()));
      await page.click('[data-cp-site-sub=""]');
      /* выбрали дату — справа съёмка → артикулы, «не скачано»; «Скачать всё за 20.10.2026» */
      await page.click('#cpShelfList [data-cp-date$="/2026-10-20"]');
      await page.waitForFunction(() => /75002/.test((document.getElementById('cpPanel') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
      const p1 = await page.textContent('#cpPanel');
      check('панель даты: съёмка → артикулы 75001, 75002 «не скачано», кнопка «Скачать всё за 20.10.2026 · 2»', p1.indexOf(B) !== -1 && /75001/.test(p1) && /75002/.test(p1) && /не скачано/.test(p1)
        && /Скачать всё за 20\.10\.2026 · 2/.test(p1) && !/пропустить уже скачанное/.test(p1), p1.slice(0, 500));
      const zb = new Set(ZIPS.keys());
      await page.click('[data-cp-site-dl]');
      for (let i = 0; i < 80 && !((PROPS.get(D2 + '/' + B + '/75002') || {}).cp_dl); i++) await page.waitForTimeout(100);
      const z1 = [...ZIPS.entries()].filter(([k]) => !zb.has(k)).flatMap(([, v]) => v);
      check('скачали дату: в архиве съёмка/артикул/файл; метка «скачано» на каждой папке артикула на Диске (кто)', z1.length === 2 && z1.some(n => n.endsWith('/' + B + '/75001/b1.jpg'))
        && (PROPS.get(D2 + '/' + B + '/75001') || {}).cp_dl_by === 'Маша' && !!(PROPS.get(D2 + '/' + B + '/75002') || {}).cp_dl, JSON.stringify([z1, PROPS.get(D2 + '/' + B + '/75001')]));
      await page.waitForFunction(() => /всё скачано/.test(([...document.querySelectorAll('#cpShelfList [data-cp-date]')].find(x => x.getAttribute('data-cp-date').endsWith('/2026-10-20')) || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
      check('плитка даты — «всё скачано · когда · кто», в панели у артикулов «скачано»', /всё скачано[^]*Маша/.test(await tileTxt('2026-10-20')) && /скачано \d/.test(await page.textContent('#cpPanel')), await tileTxt('2026-10-20'));
      /* в ту же дату приехал новый артикул — он «не скачано»; с галочкой качается только он */
      DIRS.add(D2 + '/' + B + '/75003'); FILES.set(D2 + '/' + B + '/75003/b3.jpg', Buffer.from('R'.repeat(47)));
      await page.click('#cpShelfRefresh');
      await page.click('[data-cp-stage="site"]').catch(() => {});
      await page.waitForFunction(() => /не скачано 1 из 3/.test(([...document.querySelectorAll('#cpShelfList [data-cp-date]')].find(x => x.getAttribute('data-cp-date').endsWith('/2026-10-20')) || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
      check('новый артикул в той же дате — «не скачано 1 из 3» (метки читаются с Диска)', /не скачано 1 из 3/.test(await tileTxt('2026-10-20')), await tileTxt('2026-10-20'));
      await page.click('#cpShelfList [data-cp-date$="/2026-10-20"]');
      await page.waitForFunction(() => /75003/.test((document.getElementById('cpPanel') || {}).textContent || ''), null, { timeout: 8000 }).catch(() => {});
      check('по умолчанию качается всё за дату (3), галочка «пропустить уже скачанное (2)»', /Скачать всё за 20\.10\.2026 · 3/.test(await page.textContent('#cpPanel')) && /пропустить уже скачанное \(2\)/.test(await page.textContent('#cpPanel')), await page.textContent('#cpPanel'));
      await page.check('[data-cp-site-skip]');
      check('галочка — «Скачать нескачанное · 1»', /Скачать нескачанное · 1/.test(await page.textContent('[data-cp-site-dl]')), await page.textContent('[data-cp-site-dl]'));
      const zb2 = new Set(ZIPS.keys());
      await page.click('[data-cp-site-dl]');
      for (let i = 0; i < 80 && !((PROPS.get(D2 + '/' + B + '/75003') || {}).cp_dl); i++) await page.waitForTimeout(100);
      const z2 = [...ZIPS.entries()].filter(([k]) => !zb2.has(k)).flatMap(([, v]) => v);
      check('скачалось только новое: 75003', z2.length === 1 && z2[0].endsWith('/75003/b3.jpg'), JSON.stringify(z2));
      await page.click('[data-cp-p="close"]').catch(() => {});
      await page.click('[data-cp-site-sub="new"]');
      check('«Не скачано» — дат, где всё скачано, нет', JSON.stringify(await tiles()) === JSON.stringify([today, '01.11']), JSON.stringify([await tiles(), await chips()]));
      await page.click('[data-cp-site-sub=""]');
      await page.click('[data-cp-stage=""]');
      if (!(await page.isVisible('#cpArchiveInput'))) await page.click('#cpGear');
    }
    await page.screenshot({ path: path.join(ROOT, 'tests', 'shot-catalog.png') });
    await page.fill('#cpArchiveInput', 'Архив');
    await page.click('#cpArchiveApply');
    await page.waitForFunction(() => CP_CONFIG.serviceDir === 'disk:/_ContentPulse' && !CP.catalogList, null, { timeout: 8000 }).catch(() => {});
    check('обычный архив снова — не каталог', await page.evaluate(() => CP_CONFIG.serviceDir === 'disk:/_ContentPulse' && !document.getElementById('cpSettings').classList.contains('cp-cat')));
    await page.keyboard.press('Escape');
  }

  /* загрузка в исходники (Маша, 09.11): папкой, как на Диск; «…_2» — часть той же съёмки; сначала кадры, потом видео */
  {
    await page.evaluate(() => { CP.stageFilter = ''; cpRenderShoots(); });
    check('исходники: сверху полоска «Загрузить съёмку»', /Загрузить съёмку/.test(await page.textContent('#cpSrcDrop').catch(() => '')));
    /* перетащили отдельный файл — окно открылось, файл без папки съёмки не загрузится */
    await page.evaluate(() => {
      const dt = new DataTransfer(); dt.items.add(new File(['x'], 'x.jpg', { type: 'image/jpeg' }));
      document.getElementById('cpSrcDrop').dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    });
    await page.waitForFunction(() => /без папки съёмки не загрузятся \(1\)/.test((document.getElementById('cpSrcUp') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    check('перетащили файл без папки — окно «Загрузить в Архив», «без папки съёмки не загрузятся (1)», в галерею не попал', /Загрузить в Архив/.test(await page.textContent('#cpSrcUp'))
      && /без папки съёмки не загрузятся \(1\)/.test(await page.textContent('#cpSrcUp')) && await page.evaluate(() => !App.photos.some(p => p.name === 'x.jpg')), await page.textContent('#cpSrcUp'));
    /* новая съёмка папкой: кадры, потом видео */
    const NEW = '2026-11-09_SV_НОВАЯ', up0 = UPLOADS.length;
    await page.evaluate(n => {
      CP.srcUp.files = []; CP.srcUp.plan = null;
      cpSrcAdd([[n + '/видео/v.mp4', 'V'.repeat(90)], [n + '/1/a.jpg', 'A'.repeat(30)], [n + '/1/74001/b.jpg', 'B'.repeat(31)], [n + '/.DS_Store', 'x']]
        .map(x => ({ file: new File([x[1]], x[0].split('/').pop()), rel: x[0] })));
    }, NEW);
    await page.waitForFunction(() => /кадров 2/.test((document.getElementById('cpSrcUp') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    const pl = await page.textContent('#cpSrcUp');
    await page.screenshot({ path: path.join(ROOT, 'tests', 'shot-srcup.png') });
    check('новая папка — «новая съёмка», кадров 2, видео 1 (после кадров), мусор не считается', /новая съёмка/.test(pl) && /кадров 2/.test(pl) && /видео 1 · .*после кадров/.test(pl) && /Файлов: 3/.test(pl), pl);
    await page.click('[data-cp-su="go"]');
    await page.waitForFunction(() => /Загружено файлов: 3/.test((document.getElementById('cpSrcUp') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    const order = UPLOADS.slice(up0);
    check('залито в Архив/<съёмка>/… со структурой, видео — последним', FILES.has('disk:/Архив/' + NEW + '/1/74001/b.jpg') && FILES.has('disk:/Архив/' + NEW + '/видео/v.mp4')
      && order.length === 3 && /v\.mp4$/.test(order[2]) && !order.some(p => /DS_Store/.test(p)), JSON.stringify(order));
    await page.waitForFunction(n => CP.shoots && CP.shoots.some(s => s.name === n), NEW, { timeout: 8000 }).catch(() => {});
    check('новая съёмка сразу на витрине', await page.evaluate(n => CP.shoots.some(s => s.name === n), NEW));
    await page.click('[data-cp-su="close"]');
    /* «LM-1043_2» — часть LM-1043: добавляется в её папки; тот же файл — пропуск, то же имя с другим размером — рядом «_2» */
    const bBefore = FILES.get('disk:/Архив/LM-1043/b.jpg').toString();
    await page.evaluate(() => {
      cpSrcOpen(null);
      cpSrcAdd([['LM-1043_2/part2/e.jpg', 'E'.repeat(20)], ['LM-1043_2/a.jpg', 'A'.repeat(100)], ['LM-1043_2/b.jpg', 'Q'.repeat(77)]]
        .map(x => ({ file: new File([x[1]], x[0].split('/').pop()), rel: x[0] })));
    });
    await page.waitForFunction(() => /часть съёмки/.test((document.getElementById('cpSrcUp') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    const pp = await page.textContent('#cpSrcUp');
    check('«LM-1043_2» — часть съёмки LM-1043: тот же файл — пропуск, другой с тем же именем — рядом «_2»', /LM-1043/.test(pp) && /часть съёмки \(из «LM-1043_2»\)/.test(pp)
      && /пропущу: 1/.test(pp) && /рядом с «_2»: 1/.test(pp) && /Файлов: 2/.test(pp), pp);
    await page.click('[data-cp-su="go"]');
    await page.waitForFunction(() => /Загружено файлов: 2/.test((document.getElementById('cpSrcUp') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
    check('догружено в LM-1043 по структуре: part2/e.jpg, b_2.jpg; исходник b.jpg не тронут', FILES.has('disk:/Архив/LM-1043/part2/e.jpg') && FILES.has('disk:/Архив/LM-1043/b_2.jpg')
      && FILES.get('disk:/Архив/LM-1043/b.jpg').toString() === bBefore && !FILES.has('disk:/Архив/LM-1043_2/a.jpg'), JSON.stringify(UPLOADS.slice(-3)));
    await page.click('[data-cp-su="close"]');
    /* «Догрузить» в панели съёмки: папка «видео» — в эту съёмку, как есть */
    await page.click('#cpShelfList .cp-shoot[data-name="LM-2001"]');
    await page.waitForSelector('#cpPanel [data-cp-srcup]', { timeout: 8000 }).catch(() => {});
    await page.click('#cpPanel [data-cp-srcup]');
    await page.evaluate(() => cpSrcAdd([{ file: new File(['C'.repeat(55)], 'clip2.mov'), rel: 'видео/clip2.mov' }]));
    await page.waitForFunction(() => /догрузка/.test((document.getElementById('cpSrcUp') || {}).textContent || ''), null, { timeout: 5000 }).catch(() => {});
    check('«Догрузить» в панели съёмки: окно «Догрузить в съёмку · LM-2001», видео 1', /Догрузить в съёмку · LM-2001/.test(await page.textContent('#cpSrcUp')) && /видео 1/.test(await page.textContent('#cpSrcUp')), await page.textContent('#cpSrcUp'));
    await page.click('[data-cp-su="go"]');
    for (let i = 0; i < 60 && !FILES.has('disk:/Архив/LM-2001/видео/clip2.mov'); i++) await page.waitForTimeout(100);
    check('догружено: LM-2001/видео/clip2.mov', FILES.has('disk:/Архив/LM-2001/видео/clip2.mov'));
    await page.click('[data-cp-su="close"]');
    await page.click('[data-cp-p="close"]').catch(() => {});
  }

  /* вышла новая версия: плашка «Обновить» — страница с ?v=<версия>, мимо кэша Safari */
  {
    const real = await page.evaluate(() => CP_VERSION);
    const got = await page.evaluate(() => { CP_VERSION = '2.0.1'; return cpCheckUpdate(); });
    const txt = await page.textContent('#cpUpdate').catch(() => '');
    check('новая версия на сервере — плашка «Вышла версия … Обновить»', got === real && /Вышла версия/.test(txt) && txt.indexOf(real) !== -1, txt);
    await page.click('[data-cp-upd="later"]');
    await page.evaluate(v => { CP_VERSION = v; }, real);
    check('та же версия — плашки нет', await page.evaluate(() => cpCheckUpdate().then(v => v === null && !document.getElementById('cpUpdate'))));
  }

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
    /* голая ссылка, а Safari отдал старую страницу из кэша — сама переходит на свежую (?v=), без круга */
    const old = await ctx.newPage();
    let appLoads = 0;
    await old.route(/cp-app\.js/, async r => {
      appLoads++;
      if (appLoads > 1) return r.continue();
      const res = await r.fetch();
      r.fulfill({ response: res, body: (await res.text()).replace(/var CP_VERSION = '[^']*';/, "var CP_VERSION = '2.0.1';") });
    });
    await old.goto(base);
    await old.waitForURL(/\?v=\d/, { timeout: 10000 }).catch(() => {});
    await old.waitForFunction(() => window.CP && CP.booted, null, { timeout: 10000 }).catch(() => {});
    await old.waitForTimeout(800);
    const real = await page.evaluate(() => CP_VERSION).catch(() => '');
    check('старая страница из кэша — сама перешла на свежую (?v=…), без плашки и без перезагрузок по кругу', new RegExp('\\?v=' + real.replace(/\./g, '\\.') + '$').test(old.url())
      && await old.evaluate(r => CP_VERSION === r && !document.getElementById('cpUpdate'), real) && appLoads === 2, old.url() + ' · загрузок cp-app.js: ' + appLoads);
    await old.close();
  }

  await browser.close(); srv.close();
  const failed = results.filter(r => !r[1]);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' PASS');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
