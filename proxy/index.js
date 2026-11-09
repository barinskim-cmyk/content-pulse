/* ============================================================
   Content Pulse — прослойка к Яндекс Диску (Yandex Cloud Function).

   Зачем: сервер файлов Яндекса (downloader.disk.yandex.ru) не отдаёт
   содержимое файлов страницам с других сайтов (403 по Origin), а
   копирование (POST) не пропускается из браузера. Прослойка делает
   эти запросы со своего сервера от имени пользователя.

   Токен пользователя приходит в заголовке X-Disk-Token и только
   пересылается Яндексу: нигде не хранится и не пишется в логи.

   Действия (?a=...):
     ping                         проверка связи
     preview  path, size          превью кадра (картинка)
     file     path                небольшой файл целиком (до 3 МБ) — файл отбора
     copy     POST JSON {items:[{from, path}], dirs:[...]}
                                  создать папки и скопировать файлы на Диске,
                                  уже существующие не перезаписываются
   ============================================================ */

'use strict';

const API = 'https://cloud-api.yandex.net/v1/disk';
const ALLOWED_ORIGINS = [
  'https://barinskim-cmyk.github.io',
];
process.on('unhandledRejection', (e) => { console.log(JSON.stringify({ ev: 'unhandled', error: String(e && e.message || e) })); });

const MAX_FILE = 3 * 1024 * 1024;   /* лимит ответа функции ~3.5 МБ */
const ZIP_BUDGET_MS = 480000;        /* функция живёт 600 с — оставляем запас на загрузку */
const MAX_BATCH = 2.5 * 1024 * 1024;
const MAX_PREVIEW = 2.5 * 1024 * 1024; /* пачка превью: base64 + JSON укладываются в лимит */

function cors(origin) {
  const ok = ALLOWED_ORIGINS.indexOf(origin) !== -1 || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin || '');
  return {
    'Access-Control-Allow-Origin': ok ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'X-Disk-Token, Content-Type',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(status, obj, h) {
  return { statusCode: status, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8' }, h), body: JSON.stringify(obj) };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/** Запрос к API Диска с повторами на 423/429/5xx. */
/* Общие диски Яндекс 360: путь vd:<метка>:disk:/... — у них свои адреса
   (/virtual-disks/resources...). Адрес выбираем по пути здесь, в одном месте. */
const VD_RE = /^(vd:[^:\/]+:)disk:/;
function isVd(p) { return VD_RE.test(String(p || '')); }
function rootOf(p) { const m = VD_RE.exec(String(p || '')); return m ? m[1] + 'disk:' : 'disk:'; }

async function disk(token, method, endpoint, params, body) {
  if (endpoint.indexOf('/resources') === 0 && params && (isVd(params.path) || isVd(params.from))) endpoint = '/virtual-disks' + endpoint;
  const qs = new URLSearchParams(params || {}).toString();
  const url = API + endpoint + (qs ? '?' + qs : '');
  for (let attempt = 0; ; attempt++) {
    const headers = { Authorization: 'OAuth ' + token, Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const r = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    if ([423, 429, 500, 502, 503, 504].includes(r.status) && attempt < 4) {
      await sleep(500 * Math.pow(2, attempt));
      continue;
    }
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch (e) { data = { raw: text }; }
    return { status: r.status, data };
  }
}

async function binary(url, token, timeoutMs) {
  const headers = token ? { Authorization: 'OAuth ' + token } : {};
  for (let attempt = 0; ; attempt++) {
    const ac = new AbortController();
    const timer = timeoutMs ? setTimeout(() => ac.abort(), timeoutMs) : null;
    let r;
    try {
      r = await fetch(url, { headers, redirect: 'follow', signal: ac.signal });
      if (![429, 500, 502, 503, 504].includes(r.status) || attempt >= 3) {
        const buf = Buffer.from(await r.arrayBuffer());
        if (timer) clearTimeout(timer);
        return { status: r.status, type: r.headers.get('content-type') || 'application/octet-stream', buf };
      }
    } catch (e) {
      if (timer) clearTimeout(timer);
      if (e && e.name === 'AbortError') throw new Error('нет ответа за ' + Math.round(timeoutMs / 1000) + ' с');
      throw e;
    }
    if (timer) clearTimeout(timer);
    await sleep(500 * Math.pow(2, attempt));
  }
}

async function waitOp(token, href) {
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const r = await fetch(href, { headers: { Authorization: 'OAuth ' + token } });
    const d = await r.json().catch(() => ({}));
    if (d.status === 'success') return 'success';
    if (d.status === 'failed') return 'failed';
    await sleep(1000);
  }
  return 'timeout';
}

/* 409 у Диска значит не только «уже есть»: так же отвечают, когда нет
   родительской папки. Поэтому «уже есть» проверяем отдельным запросом —
   иначе несозданная папка и нескопированный кадр считались бы готовыми. */
async function isThere(token, path, type) {
  const r = await disk(token, 'GET', '/resources', { path, fields: 'type,size' });
  return r.status === 200 && (!type || r.data.type === type);
}

async function ensureDir(token, path) {
  const root = rootOf(path);
  const parts = path.slice(root.length).split('/').filter(Boolean);
  let cur = root;
  for (const p of parts) {
    cur += '/' + p;
    let ok = false, last = null;
    for (let attempt = 0; attempt < 4 && !ok; attempt++) {
      if (attempt) await sleep(400 * attempt);
      const r = await disk(token, 'PUT', '/resources', { path: cur });
      last = r;
      if (r.status === 201) ok = true;
      else if (r.status === 409) ok = await isThere(token, cur, 'dir');
      else break;
    }
    if (!ok) return { ok: false, status: last && last.status, error: (last && (last.data.message || last.data.description)) || 'папка не создалась: ' + cur };
  }
  return { ok: true };
}

/* Копирование пачкой: папки создаём один раз (общий промис на папку),
   сами копии — по 10 параллельно. Последовательно 400 кадров шли минуты. */
async function doCopy(token, items, dirs) {
  const made = {};
  function dirReady(d) {
    if (!made[d]) made[d] = ensureDir(token, d);
    return made[d];
  }
  for (const d of dirs || []) {
    const r = await dirReady(d);
    if (!r.ok) return { status: r.status || 500, result: { error: 'Не удалось создать папку ' + d + ': ' + r.error } };
  }
  const results = new Array(items.length);
  async function one(i) {
    const it = items[i];
    const parent = it.path.slice(0, it.path.lastIndexOf('/'));
    if (parent) {
      const d = await dirReady(parent);
      if (!d.ok) { results[i] = { from: it.from, status: 'failed', error: d.error }; return; }
    }
    let r = await disk(token, 'POST', '/resources/copy', { from: it.from, path: it.path, overwrite: 'false' });
    if (r.status === 409 && !(await isThere(token, it.path))) {
      /* не «уже есть», а нет папки — создаём заново (мимо кэша) и пробуем ещё раз */
      if (parent) {
        made[parent] = ensureDir(token, parent);
        await made[parent];
      }
      r = await disk(token, 'POST', '/resources/copy', { from: it.from, path: it.path, overwrite: 'false' });
      if (r.status === 409 && !(await isThere(token, it.path))) {
        results[i] = { from: it.from, status: 'failed', error: r.data.message || r.data.description || 'не скопировалось (409)' };
        return;
      }
    }
    if (r.status === 201) results[i] = { from: it.from, status: 'done' };
    else if (r.status === 409) results[i] = { from: it.from, status: 'exists' };
    else if (r.status === 202 && r.data.href) {
      const st = await waitOp(token, r.data.href);
      results[i] = { from: it.from, status: st === 'success' ? 'done' : 'failed', error: st === 'success' ? undefined : st };
    } else results[i] = { from: it.from, status: 'failed', error: (r.data.message || r.data.description || ('HTTP ' + r.status)) };
  }
  let next = 0;
  async function worker() { while (next < items.length) { const i = next++; try { await one(i); } catch (e) { results[i] = { from: items[i].from, status: 'failed', error: String(e && e.message || e) }; } } }
  const workers = [];
  for (let w = 0; w < Math.min(10, items.length); w++) workers.push(worker());
  await Promise.all(workers);
  return { status: 200, result: { results } };
}

/* ---------- Корзина и перенос: статус = где лежит файл ----------
   Защита от ошибки страницы: папки первого уровня диска не трогаем
   (нужно не меньше двух частей пути: disk:/03_РЕТУШЬ/съёмка). */
function deepEnough(p, min) {
  const rest = String(p || '').slice(rootOf(p).length).split('/').filter(Boolean);
  return rest.length >= (min || 2) && rest.indexOf('..') === -1;
}

async function doTrash(token, paths) {
  const results = new Array(paths.length);
  async function one(i) {
    const p = paths[i];
    if (!deepEnough(p)) { results[i] = { path: p, status: 'failed', error: 'слишком близко к корню диска' }; return; }
    const r = await disk(token, 'DELETE', '/resources', { path: p, permanently: 'false' });
    if (r.status === 204) results[i] = { path: p, status: 'done' };
    else if (r.status === 404) results[i] = { path: p, status: 'gone' };
    else if (r.status === 202 && r.data.href) {
      const st = await waitOp(token, r.data.href);
      results[i] = { path: p, status: st === 'success' ? 'done' : 'failed', error: st === 'success' ? undefined : st };
    } else results[i] = { path: p, status: 'failed', error: r.data.message || r.data.description || ('HTTP ' + r.status) };
  }
  let next = 0;
  async function worker() { while (next < paths.length) { const i = next++; try { await one(i); } catch (e) { results[i] = { path: paths[i], status: 'failed', error: String(e && e.message || e) }; } } }
  const workers = [];
  for (let w = 0; w < Math.min(6, paths.length); w++) workers.push(worker());
  await Promise.all(workers);
  return { status: 200, result: { results } };
}

async function doMove(token, items) {
  const made = {};
  function dirReady(d) { if (!made[d]) made[d] = ensureDir(token, d); return made[d]; }
  const results = new Array(items.length);
  async function one(i) {
    const it = items[i];
    /* перенос (переименование папки этапа в корне общего диска) — можно и на первом уровне, но не сам корень */
    if (!deepEnough(it.from, 1) || !deepEnough(it.path, 1)) { results[i] = { from: it.from, status: 'failed', error: 'корень диска не переносим' }; return; }
    const parent = it.path.slice(0, it.path.lastIndexOf('/'));
    const d = await dirReady(parent);
    if (!d.ok) { results[i] = { from: it.from, status: 'failed', error: d.error }; return; }
    let r = await disk(token, 'POST', '/resources/move', { from: it.from, path: it.path, overwrite: 'false' });
    if (r.status === 409 && !(await isThere(token, it.path))) {
      made[parent] = ensureDir(token, parent);
      await made[parent];
      r = await disk(token, 'POST', '/resources/move', { from: it.from, path: it.path, overwrite: 'false' });
    }
    if (r.status === 201) results[i] = { from: it.from, status: 'done' };
    else if (r.status === 409) results[i] = { from: it.from, status: (await isThere(token, it.path)) ? 'exists' : 'failed', error: r.data.message || r.data.description };
    else if (r.status === 404) results[i] = { from: it.from, status: 'gone' };
    else if (r.status === 202 && r.data.href) {
      const st = await waitOp(token, r.data.href);
      results[i] = { from: it.from, status: st === 'success' ? 'done' : 'failed', error: st === 'success' ? undefined : st };
    } else results[i] = { from: it.from, status: 'failed', error: r.data.message || r.data.description || ('HTTP ' + r.status) };
  }
  let next = 0;
  async function worker() { while (next < items.length) { const i = next++; try { await one(i); } catch (e) { results[i] = { from: items[i].from, status: 'failed', error: String(e && e.message || e) }; } } }
  const workers = [];
  for (let w = 0; w < Math.min(6, items.length); w++) workers.push(worker());
  await Promise.all(workers);
  return { status: 200, result: { results } };
}

/* ---------- Object Storage (S3) для архивов выгрузки ----------
   Запись на Яндекс Диск сейчас ~0,1 МБ/с, поэтому готовый ZIP кладём в
   закрытый бакет в Yandex Cloud (живёт 3 дня, правило жизненного цикла),
   а странице отдаём подписанную ссылку на те же 3 дня. Ключи — в переменных
   окружения функции, в репозиторий не попадают. */
const crypto = require('crypto');
const S3 = {
  host: 'storage.yandexcloud.net', region: 'ru-central1',
  key: process.env.S3_KEY_ID || '', secret: process.env.S3_SECRET || '', bucket: process.env.S3_BUCKET || '',
};
const S3_LINK_TTL = 3 * 24 * 3600;   /* как и сам архив в бакете — 3 дня */

function s3Ready() { return !!(S3.key && S3.secret && S3.bucket); }
function hmac(k, str) { return crypto.createHmac('sha256', k).update(str, 'utf8').digest(); }
function sha256hex(str) { return crypto.createHash('sha256').update(str, 'utf8').digest('hex'); }
function amzDate(d) { return d.toISOString().replace(/[:-]|\.\d{3}/g, ''); }
function uriEnc(str) { return encodeURIComponent(str).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()); }
function s3Path(key) { return '/' + S3.bucket + '/' + key.split('/').map(uriEnc).join('/'); }
function s3SigningKey(date) {
  let k = hmac('AWS4' + S3.secret, date);
  k = hmac(k, S3.region); k = hmac(k, 's3');
  return hmac(k, 'aws4_request');
}
function s3Query(q) { return Object.keys(q).sort().map((k) => uriEnc(k) + '=' + uriEnc(q[k])).join('&'); }

/** Подписанные заголовки для запроса к бакету (тело не хешируем: UNSIGNED-PAYLOAD). */
function s3Sign(method, key, query, headers) {
  const ad = amzDate(new Date()), date = ad.slice(0, 8);
  const h = { host: S3.host, 'x-amz-date': ad, 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' };
  Object.keys(headers || {}).forEach((n) => { h[n.toLowerCase()] = String(headers[n]).trim(); });
  const names = Object.keys(h).sort();
  const qs = s3Query(query || {});
  const canon = [method, s3Path(key), qs, names.map((n) => n + ':' + h[n] + '\n').join(''), names.join(';'), 'UNSIGNED-PAYLOAD'].join('\n');
  const scope = date + '/' + S3.region + '/s3/aws4_request';
  const sts = ['AWS4-HMAC-SHA256', ad, scope, sha256hex(canon)].join('\n');
  const sig = crypto.createHmac('sha256', s3SigningKey(date)).update(sts, 'utf8').digest('hex');
  h.authorization = 'AWS4-HMAC-SHA256 Credential=' + S3.key + '/' + scope + ', SignedHeaders=' + names.join(';') + ', Signature=' + sig;
  return { path: s3Path(key) + (qs ? '?' + qs : ''), headers: h };
}

/** Ссылка на скачивание объекта: действует ttl секунд, имя файла — русское, как в выгрузке. */
function s3Presign(key, ttl, filename, contentType) {
  const ad = amzDate(new Date()), date = ad.slice(0, 8);
  const scope = date + '/' + S3.region + '/s3/aws4_request';
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '');
  const q = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': S3.key + '/' + scope, 'X-Amz-Date': ad,
    'X-Amz-Expires': String(ttl), 'X-Amz-SignedHeaders': 'host',
    'response-content-disposition': 'attachment; filename="' + ascii + '"; filename*=UTF-8\'\'' + uriEnc(filename),
    'response-content-type': contentType || 'application/zip',
  };
  const qs = s3Query(q);
  const canon = ['GET', s3Path(key), qs, 'host:' + S3.host + '\n', 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const sts = ['AWS4-HMAC-SHA256', ad, scope, sha256hex(canon)].join('\n');
  const sig = crypto.createHmac('sha256', s3SigningKey(date)).update(sts, 'utf8').digest('hex');
  return 'https://' + S3.host + s3Path(key) + '?' + qs + '&X-Amz-Signature=' + sig;
}

/** PUT в бакет потоком с известной длиной. Интерфейс как у openUpload. */
function openS3Upload(key, length, query, contentType) {
  const https = require('https');
  const signed = s3Sign('PUT', key, query || {}, { 'content-type': contentType || 'application/zip' });
  return new Promise((resolve) => {
    const req = https.request({ method: 'PUT', hostname: S3.host, port: 443, path: signed.path,
      headers: Object.assign({}, signed.headers, { 'Content-Length': length }) });
    const done = new Promise((res, rej) => {
      req.on('response', (r) => { let t = ''; r.on('data', (c) => { t += c; }); r.on('end', () => res({ status: r.statusCode === 200 ? 201 : r.statusCode, body: t, etag: r.headers.etag || '' })); });
      req.on('error', rej);
    });
    done.catch(() => { });
    resolve({
      write(buf) {
        return new Promise((res, rej) => {
          const ok = req.write(buf, (e) => (e ? rej(e) : null));
          if (ok) res(); else req.once('drain', res);
        });
      },
      end() { req.end(); return done; },
      abort() { try { req.destroy(); } catch (e) { } },
    });
  });
}

/** Короткий запрос к бакету (тело — строка). */
function s3Call(method, key, query, body, headers) {
  const https = require('https');
  const signed = s3Sign(method, key, query || {}, headers || {});
  return new Promise((resolve, reject) => {
    const req = https.request({ method, hostname: S3.host, port: 443, path: signed.path,
      headers: Object.assign({}, signed.headers, { 'Content-Length': body ? Buffer.byteLength(body) : 0 }) }, (r) => {
      let t = ''; r.on('data', (c) => { t += c; }); r.on('end', () => resolve({ status: r.statusCode, body: t }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

/* ---------- крупные файлы (видео) — отдельной ссылкой, частями ----------
   Большой файл переносим в бакет многочастной загрузкой: каждый вызов
   функции переносит один кусок (Range с Диска -> часть в бакете) за
   секунды, поэтому ни функция, ни браузер не упираются во время ожидания.
   Страница ведёт цикл: start -> part × N -> done (ссылка на 3 дня). */
function mimeOf(fname) {
  const ext = ((/\.([a-z0-9]+)$/i.exec(fname || '') || [])[1] || '').toLowerCase();
  const types = { mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', avi: 'video/x-msvideo', mkv: 'video/x-matroska', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', tif: 'image/tiff', tiff: 'image/tiff', pdf: 'application/pdf', zip: 'application/zip' };
  return types[ext] || 'application/octet-stream';
}

async function doMultipart(token, req) {
  if (!s3Ready()) return { status: 501, result: { error: 'Хранилище не настроено' } };
  const op = req.op;
  if (op === 'start') {
    /* только для настоящего пользователя Диска */
    const me = await disk(token, 'GET', '', { fields: 'user' });
    if (me.status !== 200) return { status: me.status, result: { error: me.data.message || 'Нет доступа к Диску' } };
    const key = 'exports/' + crypto.randomBytes(16).toString('hex') + '/file';
    const r = await s3Call('POST', key, { uploads: '' }, '', { 'content-type': req.type || 'application/octet-stream' });
    const m = /<UploadId>([^<]+)<\/UploadId>/.exec(r.body);
    if (r.status !== 200 || !m) return { status: 502, result: { error: 'Хранилище не начало загрузку: HTTP ' + r.status + ' ' + r.body.slice(0, 200) } };
    return { status: 200, result: { key, uploadId: m[1] } };
  }
  if (op === 'part') {
    const start = +req.start, end = +req.end, len = end - start + 1;
    if (!req.key || !req.uploadId || !(req.n >= 1) || !(len > 0)) return { status: 400, result: { error: 'Нет части' } };
    const href = await diskHref(token, req.from);
    const r = await fetch(href, { redirect: 'follow', headers: { Range: 'bytes=' + start + '-' + end } });
    if (r.status !== 206 && !(r.status === 200 && start === 0 && +r.headers.get('content-length') === len)) {
      try { await r.body?.cancel(); } catch (e) { }
      /* Диск отдаёт файл только целиком — страница перейдёт на перенос одним проходом */
      if (r.status === 200) return { status: 422, result: { error: 'Диск не отдаёт файл кусками', code: 'range_unsupported' } };
      return { status: 422, result: { error: 'Диск не отдал кусок файла: HTTP ' + r.status } };
    }
    const out = await openS3Upload(req.key, len, { partNumber: String(req.n), uploadId: req.uploadId }, 'application/octet-stream');
    let n = 0;
    try {
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const b = Buffer.from(value);
        n += b.length;
        if (n > len) throw new Error('Диск отдал больше, чем просили');
        await out.write(b);
      }
      if (n !== len) throw new Error('Кусок файла пришёл не целиком: ' + n + ' из ' + len);
      const w = await out.end();
      if (w.status !== 201 || !w.etag) throw new Error('Хранилище не приняло часть: HTTP ' + w.status + ' ' + w.body.slice(0, 200));
      return { status: 200, result: { n: req.n, etag: w.etag } };
    } catch (e) {
      out.abort();
      return { status: 422, result: { error: String(e && e.message || e) } };
    }
  }
  if (op === 'done') {
    const parts = (req.parts || []).slice().sort((a, b) => a.n - b.n);
    const xml = '<CompleteMultipartUpload>' + parts.map((p) => '<Part><PartNumber>' + p.n + '</PartNumber><ETag>' + String(p.etag).replace(/[<>&]/g, '') + '</ETag></Part>').join('') + '</CompleteMultipartUpload>';
    const r = await s3Call('POST', req.key, { uploadId: req.uploadId }, xml, { 'content-type': 'application/xml' });
    if (r.status !== 200 || /<Error>/.test(r.body)) return { status: 502, result: { error: 'Хранилище не собрало файл: HTTP ' + r.status + ' ' + r.body.slice(0, 200) } };
    const fname = String(req.filename || 'file');
    return { status: 200, result: { url: s3Presign(req.key, S3_LINK_TTL, fname, mimeOf(fname)), store: 'cloud' } };
  }
  /* запасной путь: файл целиком одним потоком в бакет */
  if (op === 'whole') {
    const t0 = Date.now();
    const href = await diskHref(token, req.from);
    const r = await fetch(href, { redirect: 'follow' });
    if (r.status !== 200) { try { await r.body?.cancel(); } catch (e) { } return { status: 422, result: { error: 'Диск не отдал файл: HTTP ' + r.status } }; }
    const len = +r.headers.get('content-length') || +req.size;
    if (!(len > 0)) return { status: 422, result: { error: 'Неизвестен размер файла' } };
    const fname = String(req.filename || 'file');
    const key = 'exports/' + crypto.randomBytes(16).toString('hex') + '/file';
    const out = await openS3Upload(key, len, {}, mimeOf(fname));
    let n = 0;
    try {
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const b = Buffer.from(value);
        n += b.length;
        await out.write(b);
      }
      if (n !== len) throw new Error('Файл пришёл не целиком: ' + n + ' из ' + len);
      const w = await out.end();
      if (w.status !== 201) throw new Error('Хранилище не приняло файл: HTTP ' + w.status + ' ' + w.body.slice(0, 200));
      console.log(JSON.stringify({ ev: 'whole', bytes: len, ms: Date.now() - t0 }));
      return { status: 200, result: { url: s3Presign(key, S3_LINK_TTL, fname, mimeOf(fname)), store: 'cloud' } };
    } catch (e) {
      out.abort();
      return { status: 422, result: { error: String(e && e.message || e) } };
    }
  }
  if (op === 'abort') {
    await s3Call('DELETE', req.key, { uploadId: req.uploadId }, '');
    return { status: 200, result: { ok: true } };
  }
  return { status: 400, result: { error: 'Неизвестный шаг: ' + op } };
}

/* ---------- ZIP без сжатия (JPEG всё равно не сжимается) ----------
   С октября 2026 Яндекс отключил скачивание папок архивом (ссылка на папку
   отдаёт 500), отдельные файлы скачиваются. Поэтому архив собираем сами:
   читаем кадры по одному, пишем ZIP потоком прямо в загрузку на Диск,
   в служебную папку выгрузок; страница потом скачивает один файл. */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function dosDateTime(d) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2));
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

function localHeader(nameBuf, crc, size, dt, v45) {
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(v45 ? 45 : 20, 4);
  h.writeUInt16LE(0x0800, 6);           /* имена в UTF-8 */
  h.writeUInt16LE(0, 8);                /* без сжатия */
  h.writeUInt16LE(dt.time, 10);
  h.writeUInt16LE(dt.date, 12);
  h.writeUInt32LE(crc, 14);
  h.writeUInt32LE(size, 18);
  h.writeUInt32LE(size, 22);
  h.writeUInt16LE(nameBuf.length, 26);
  h.writeUInt16LE(0, 28);
  return Buffer.concat([h, nameBuf]);
}

function centralHeader(nameBuf, crc, size, offset, dt) {
  const h = Buffer.alloc(46);
  h.writeUInt32LE(0x02014b50, 0);
  h.writeUInt16LE(20, 4);
  h.writeUInt16LE(20, 6);
  h.writeUInt16LE(0x0800, 8);
  h.writeUInt16LE(0, 10);
  h.writeUInt16LE(dt.time, 12);
  h.writeUInt16LE(dt.date, 14);
  h.writeUInt32LE(crc, 16);
  h.writeUInt32LE(size, 20);
  h.writeUInt32LE(size, 24);
  h.writeUInt16LE(nameBuf.length, 28);
  h.writeUInt16LE(0, 30);
  h.writeUInt16LE(0, 32);
  h.writeUInt16LE(0, 34);
  h.writeUInt16LE(0, 36);
  h.writeUInt32LE(0, 38);
  h.writeUInt32LE(offset, 42);
  return Buffer.concat([h, nameBuf]);
}

/* ZIP64: архив больше 4 ГБ одним файлом (Маша, 08.11: «скачать всё — пилит на 30 частей»).
   Каждый файл меньше 4 ГБ, поэтому локальные заголовки прежние; если смещение файла
   дальше 4 ГБ — в оглавлении у него поле 0xFFFFFFFF и дополнительная запись ZIP64 с
   настоящим смещением; в конце — запись ZIP64 об оглавлении и указатель на неё.
   ZIP_FORCE64=1 — включить ZIP64 всегда (для проверки на маленьких архивах). */
const Z64 = 0xFFFFFFFF;
function needs64(offset) { return offset >= Z64 || process.env.ZIP_FORCE64 === '1'; }

function cdEntryLen(nameLen, offset) { return 46 + nameLen + (needs64(offset) ? 12 : 0); }

function centralHeader64(nameBuf, crc, size, offset, dt) {
  if (!needs64(offset)) return centralHeader(nameBuf, crc, size, offset, dt);
  const h = centralHeader(nameBuf, crc, size, 0, dt);
  /* «сделано в Unix, версия 4.5» и права файла 644: так Info-ZIP и Архиватор macOS читают
     русские имена у записей ZIP64 без предупреждений (с «MS-DOS» unzip ругался на имена) */
  h.writeUInt16LE(0x032d, 4);
  h.writeUInt16LE(45, 6);
  h.writeUInt32LE(0x81a40000, 38);
  h.writeUInt16LE(12, 30);              /* длина доп. поля */
  h.writeUInt32LE(Z64, 42);
  const x = Buffer.alloc(12);
  x.writeUInt16LE(0x0001, 0);           /* ZIP64 extended information */
  x.writeUInt16LE(8, 2);
  x.writeBigUInt64LE(BigInt(offset), 4);
  return Buffer.concat([h, x]);
}

function endLen(count, cdSize, cdOffset) {
  return 22 + (count >= 0xFFFF || cdSize >= Z64 || needs64(cdOffset) ? 56 + 20 : 0);
}

function endRecord64(count, cdSize, cdOffset) {
  if (!(count >= 0xFFFF || cdSize >= Z64 || needs64(cdOffset))) return endRecord(count, cdSize, cdOffset);
  const r = Buffer.alloc(56);
  r.writeUInt32LE(0x06064b50, 0);
  r.writeBigUInt64LE(44n, 4);
  r.writeUInt16LE(45, 12);
  r.writeUInt16LE(45, 14);
  r.writeUInt32LE(0, 16);
  r.writeUInt32LE(0, 20);
  r.writeBigUInt64LE(BigInt(count), 24);
  r.writeBigUInt64LE(BigInt(count), 32);
  r.writeBigUInt64LE(BigInt(cdSize), 40);
  r.writeBigUInt64LE(BigInt(cdOffset), 48);
  const loc = Buffer.alloc(20);
  loc.writeUInt32LE(0x07064b50, 0);
  loc.writeUInt32LE(0, 4);
  loc.writeBigUInt64LE(BigInt(cdOffset + cdSize), 8);
  loc.writeUInt32LE(1, 16);
  const e = endRecord(Math.min(count, 0xFFFF), Math.min(cdSize, Z64), Z64);
  if (count >= 0xFFFF) { e.writeUInt16LE(0xFFFF, 8); e.writeUInt16LE(0xFFFF, 10); }
  return Buffer.concat([r, loc, e]);
}

function endRecord(count, cdSize, cdOffset) {
  const h = Buffer.alloc(22);
  h.writeUInt32LE(0x06054b50, 0);
  h.writeUInt16LE(count, 8);
  h.writeUInt16LE(count, 10);
  h.writeUInt32LE(cdSize, 12);
  h.writeUInt32LE(cdOffset, 16);
  return h;
}

/** Скачать один файл Диска целиком; оборвалось соединение (Яндекс: «terminated», сброс) —
    ещё две попытки с новой ссылкой (Маша, 08.11: «ПустоеИмя_11.jpg: terminated»). */
async function readDiskFile(token, path) {
  for (let attempt = 0; ; attempt++) {
    try { return await readDiskFileOnce(token, path); } catch (e) {
      const msg = String(e && e.message || e);
      if (attempt >= 2 || /размер изменился|не выдана \(4\d\d/.test(msg)) throw e;
      console.log(JSON.stringify({ ev: 'read_retry', path: path.split('/').pop(), attempt: attempt + 1, error: msg }));
      await sleep(800 * (attempt + 1));
    }
  }
}

async function readDiskFileOnce(token, path) {
  const t0 = Date.now();
  const link = await disk(token, 'GET', '/resources/download', { path });
  if (link.status !== 200) throw new Error(path.split('/').pop() + ': ссылка не выдана (' + link.status + ' ' + (link.data.message || '') + ')');
  const t1 = Date.now();
  let f;
  try { f = await binary(link.data.href, null, 90000); } catch (e) { throw new Error(path.split('/').pop() + ': ' + e.message); }
  console.log(JSON.stringify({ ev: 'read', ms_link: t1 - t0, ms_file: Date.now() - t1, bytes: f.buf.length, status: f.status }));
  if (f.status !== 200) throw new Error(path.split('/').pop() + ': файл не отдан, HTTP ' + f.status);
  return f.buf;
}

/* Крупные файлы (видео) не держим в памяти: читаем потоком дважды —
   сначала считаем CRC (он нужен в заголовке до данных), потом пишем в архив. */
const BIG_ENTRY = +process.env.ZIP_BIG_ENTRY || 48 * 1024 * 1024;

async function diskHref(token, path) {
  const link = await disk(token, 'GET', '/resources/download', { path });
  if (link.status !== 200) throw new Error(path.split('/').pop() + ': ссылка не выдана (' + link.status + ' ' + (link.data.message || '') + ')');
  return link.data.href;
}

/** Кусок файла Диска [start..end] (включительно) потоком; три попытки, пока ничего не отдали дальше. */
async function streamDiskRange(token, path, start, end, onChunk, retryUntilGiven) {
  const len = end - start + 1;
  for (let attempt = 0; ; attempt++) {
    let given = 0;
    try {
      const href = await diskHref(token, path);
      const r = await fetch(href, { redirect: 'follow', headers: { Range: 'bytes=' + start + '-' + end } });
      if (r.status !== 206 && !(r.status === 200 && start === 0 && +r.headers.get('content-length') === len)) {
        try { await r.body?.cancel(); } catch (e) { }
        if (r.status === 200) { const e = new Error('Диск не отдаёт файл кусками'); e.code = 'range_unsupported'; throw e; }
        throw new Error(path.split('/').pop() + ': кусок файла не отдан, HTTP ' + r.status);
      }
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const b = Buffer.from(value);
        if (given + b.length > len) throw new Error('Диск отдал больше, чем просили');
        given += b.length;
        await onChunk(b, attempt);
      }
      if (given !== len) throw new Error(path.split('/').pop() + ': кусок пришёл не целиком (' + given + ' из ' + len + ')');
      return given;
    } catch (e) {
      if (e && e.code === 'range_unsupported') throw e;
      if (attempt >= 2 || (given && !retryUntilGiven)) throw e;
      console.log(JSON.stringify({ ev: 'range_retry', path: path.split('/').pop(), attempt: attempt + 1, given, error: String(e && e.message || e) }));
      await sleep(800 * (attempt + 1));
    }
  }
}

/** CRC куска файла (для больших файлов страница складывает CRC кусков). req: {from, start, end} */
async function doCrc(token, req) {
  const start = +req.start, end = +req.end;
  if (!req.from || !(end >= start)) return { status: 400, result: { error: 'Нет куска' } };
  let c = -1, at = 0;
  try {
    const n = await streamDiskRange(token, req.from, start, end, (b, attempt) => { if (attempt !== at) { at = attempt; c = -1; } c = crc32Update(c, b); }, true);
    return { status: 200, result: { crc: (c ^ -1) >>> 0, n } };
  } catch (e) {
    return { status: 422, result: { error: String(e && e.message || e), code: e && e.code, from: req.from } };
  }
}

/** Поток файла Диска. retry — можно повторить, пока ничего не отдали дальше (первый проход для CRC). */
async function streamDiskFile(token, path, onChunk, retry) {
  for (let attempt = 0; ; attempt++) {
    let given = 0;
    try { return await streamDiskFileOnce(token, path, (b) => { given += b.length; return onChunk(b, attempt); }); } catch (e) {
      if (!retry || attempt >= 2) throw e;
      console.log(JSON.stringify({ ev: 'stream_retry', path: path.split('/').pop(), attempt: attempt + 1, given, error: String(e && e.message || e) }));
      await sleep(800 * (attempt + 1));
    }
  }
}

async function streamDiskFileOnce(token, path, onChunk) {
  const href = await diskHref(token, path);
  const r = await fetch(href, { redirect: 'follow' });
  if (r.status !== 200) throw new Error(path.split('/').pop() + ': файл не отдан, HTTP ' + r.status);
  let n = 0;
  const reader = r.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const b = Buffer.from(value);
    n += b.length;
    await onChunk(b);
  }
  return n;
}

function crc32Update(c, buf) {
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return c;
}

/** PUT потоком с известной длиной. */
function openUpload(href, length) {
  const https = require('https');
  return new Promise((resolve, reject) => {
    const u = new URL(href);
    const req = https.request({ method: 'PUT', hostname: u.hostname, port: u.port || 443, path: u.pathname + u.search,
      headers: { 'Content-Length': length, 'Content-Type': 'application/zip' } });
    const done = new Promise((res, rej) => {
      req.on('response', (r) => { let t = ''; r.on('data', (c) => { t += c; }); r.on('end', () => res({ status: r.statusCode, body: t })); });
      req.on('error', rej);
    });
    done.catch(() => { });   /* при отмене ошибку никто не ждёт — не роняем процесс */
    resolve({
      write(buf) {
        return new Promise((res, rej) => {
          const ok = req.write(buf, (e) => (e ? rej(e) : null));
          if (ok) res(); else req.once('drain', res);
        });
      },
      end() { req.end(); return done; },
      abort() { try { req.destroy(); } catch (e) { } },
    });
    req.on('error', reject);
  });
}

async function doZip(token, target, entries, store) {
  try {
    return await doZipInner(token, target, entries, store);
  } catch (e) {
    console.log(JSON.stringify({ ev: 'zip_error', error: String(e && e.message || e) }));
    return { status: 422, result: { error: 'Сборка архива: ' + String(e && e.message || e) } };
  }
}

async function doZipInner(token, target, entries, store) {
  const t0 = Date.now();
  const dt = dosDateTime(new Date());
  const items = entries.map((e) => ({ from: e.from, name: Buffer.from(String(e.name).replace(/^\/+/, ''), 'utf8'), size: +e.size || 0 }));
  if (!items.length) return { status: 400, result: { error: 'Нет файлов' } };
  if (items.some((x) => !x.size)) return { status: 400, result: { error: 'Нет размеров файлов' } };
  let total = 22;
  for (const x of items) total += 30 + x.name.length + x.size + 46 + x.name.length;
  if (total >= 0xFFFFFFFF || items.length >= 0xFFFF) return { status: 413, result: { error: 'Архив больше 4 ГБ — нужна разбивка на части' } };

  /* куда пишем: бакет (быстро) или, если он не настроен, Диск */
  let out, s3Key = '';
  if (s3Ready() && store !== 'disk') {
    s3Key = 'exports/' + crypto.randomBytes(16).toString('hex') + '.zip';
    out = await openS3Upload(s3Key, total);
  } else {
    const parent = target.slice(0, target.lastIndexOf('/'));
    const d = await ensureDir(token, parent);
    if (!d.ok) return { status: d.status || 500, result: { error: 'Не удалось создать папку ' + parent + ': ' + d.error } };
    const up = await disk(token, 'GET', '/resources/upload', { path: target, overwrite: 'true' });
    if (up.status !== 200) return { status: up.status, result: { error: 'Загрузка на Диск не выдана: ' + (up.data.message || up.status) } };
    out = await openUpload(up.data.href, total);
  }
  /* читаем вперёд до 4 файлов, пишем строго по порядку */
  const AHEAD = 4;
  const pending = [];
  let next = 0;
  function pump() {
    while (next < items.length && pending.length < AHEAD) {
      const x = items[next++];
      /* крупные читаем потоком в свой черёд, а не заранее в память */
      const p = x.size > BIG_ENTRY ? Promise.resolve(null) : readDiskFile(token, x.from);
      p.catch(() => { });
      pending.push(p);
    }
  }
  let offset = 0;
  const central = [];
  try {
    pump();
    for (let i = 0; i < items.length; i++) {
      const x = items[i];
      if (Date.now() - t0 > ZIP_BUDGET_MS) throw new Error('Яндекс отдаёт файлы слишком медленно: за ' + Math.round((Date.now() - t0) / 1000) + ' с прочитано ' + i + ' из ' + items.length + ' кадров');
      const buf = await pending.shift();
      pump();
      if (buf === null) {
        /* крупный файл: проход 1 — CRC, проход 2 — данные в архив */
        let c = -1;
        let at = 0;
        const n1 = await streamDiskFile(token, x.from, (b, attempt) => { if (attempt !== at) { at = attempt; c = -1; } c = crc32Update(c, b); }, true);
        if (n1 !== x.size) throw new Error(x.from.split('/').pop() + ': размер изменился (' + n1 + ' вместо ' + x.size + '), обновите съёмку');
        const crc = (c ^ -1) >>> 0;
        const lh = localHeader(x.name, crc, x.size, dt);
        await out.write(lh);
        const n2 = await streamDiskFile(token, x.from, (b) => out.write(b));
        if (n2 !== x.size) throw new Error(x.from.split('/').pop() + ': файл изменился во время сборки');
        central.push(centralHeader(x.name, crc, x.size, offset, dt));
        offset += lh.length + x.size;
        console.log(JSON.stringify({ ev: 'big', bytes: x.size, ms: Date.now() - t0 }));
        continue;
      }
      if (buf.length !== x.size) throw new Error(x.from.split('/').pop() + ': размер изменился (' + buf.length + ' вместо ' + x.size + '), обновите съёмку');
      const crc = crc32(buf);
      const lh = localHeader(x.name, crc, x.size, dt);
      await out.write(lh);
      await out.write(buf);
      central.push(centralHeader(x.name, crc, x.size, offset, dt));
      offset += lh.length + buf.length;
    }
    const cd = Buffer.concat(central);
    await out.write(cd);
    await out.write(endRecord(items.length, cd.length, offset));
    const r = await out.end();
    if (r.status !== 201 && r.status !== 202) throw new Error((s3Key ? 'Хранилище' : 'Диск') + ' не принял архив: HTTP ' + r.status + ' ' + r.body.slice(0, 200));
    console.log(JSON.stringify({ ev: 'zip', files: items.length, bytes: total, ms: Date.now() - t0, s3: !!s3Key }));
    const result = { path: target, bytes: total, files: items.length, ms: Date.now() - t0 };
    if (s3Key) {
      result.url = s3Presign(s3Key, S3_LINK_TTL, target.split('/').pop());
      result.store = 'cloud';
      result.expires = new Date(Date.now() + S3_LINK_TTL * 1000).toISOString();
    }
    return { status: 200, result };
  } catch (e) {
    out.abort();
    console.log(JSON.stringify({ ev: 'zip_error', error: String(e && e.message || e), ms: Date.now() - t0 }));
    return { status: 422, result: { error: String(e && e.message || e), ms: Date.now() - t0 } };
  }
}

/* ---------- один архив за несколько вызовов ----------
   Маша, 06.11: выбрали карточки — архив пришёл двумя кусками, а должен
   одним. Части были нужны, чтобы каждый вызов функции шёл ~30 с. Теперь
   части — это куски одной многочастной загрузки в бакет: страница шлёт
   кадры пачками, каждый вызов дописывает свой кусок ZIP (заголовки и
   данные; смещения — по ходу), последний вызов дописывает оглавление.
   Бакет склеивает куски в один файл. Кусок, кроме последнего, — не меньше
   5 МБ (правило хранилища), за этим следит страница.
   req: {key, uploadId, n, ts, offset, entries:[{from,name,size}], final, done:[{name,size,crc,offset}]} */
async function doZipPart(token, req, openPart) {
  const t0 = Date.now();
  if (!req.key || !req.uploadId || !(req.n >= 1)) return { status: 400, result: { error: 'Нет загрузки' } };
  const dt = dosDateTime(new Date(+req.ts || Date.now()));
  const start = +req.offset || 0;
  /* кусок архива — файлы целиком и куски больших файлов (slice: start..end, head — с заголовка,
     crc — посчитан заранее по кускам): так большое видео ложится в архив, а вызов остаётся коротким */
  const items = (Array.isArray(req.entries) ? req.entries : []).map((e) => {
    const x = { from: e.from, name: Buffer.from(String(e.name).replace(/^\/+/, ''), 'utf8'), size: +e.size || 0 };
    if (e.start !== undefined) { x.slice = true; x.start = +e.start; x.end = +e.end; x.head = !!e.head; x.crc = +e.crc >>> 0; }
    return x;
  });
  if (items.some((x) => !x.size || (x.slice && !(x.end >= x.start)))) return { status: 400, result: { error: 'Нет размеров файлов' } };
  if (!items.length && !req.final) return { status: 400, result: { error: 'Нет файлов' } };
  let dataLen = 0;
  for (const x of items) dataLen += x.slice ? (x.head ? 30 + x.name.length : 0) + (x.end - x.start + 1) : 30 + x.name.length + x.size;
  if (items.some((x) => x.size >= Z64)) return { status: 413, result: { error: 'Файл больше 4 ГБ — такой отдаётся отдельной ссылкой' } };
  let cdLen = 0, prev = [], tail = 0;
  if (req.final) {
    prev = (Array.isArray(req.done) ? req.done : []).map((d) => ({ name: Buffer.from(String(d.name).replace(/^\/+/, ''), 'utf8'), size: +d.size, crc: +d.crc >>> 0, offset: +d.offset }));
    for (const d of prev) cdLen += cdEntryLen(d.name.length, d.offset);
    let off = start;
    for (const x of items) {
      if (!x.slice || x.head) cdLen += cdEntryLen(x.name.length, off);
      off += x.slice ? (x.head ? 30 + x.name.length : 0) + (x.end - x.start + 1) : 30 + x.name.length + x.size;
    }
    tail = endLen(prev.length + items.length, cdLen, start + dataLen);
  }
  const partLen = dataLen + (req.final ? cdLen + tail : 0);
  const out = await (openPart || ((len) => openS3Upload(req.key, len, { partNumber: String(req.n), uploadId: req.uploadId }, 'application/octet-stream')))(partLen);
  const AHEAD = 4;
  const pending = [];
  let next = 0;
  function pump() {
    while (next < items.length && pending.length < AHEAD) {
      const x = items[next++];
      const p = x.slice || x.size > BIG_ENTRY ? Promise.resolve(null) : readDiskFile(token, x.from);
      p.catch(() => { });
      pending.push(p);
    }
  }
  let offset = start, cur = '';
  const mine = [];
  try {
    pump();
    for (let i = 0; i < items.length; i++) {
      const x = items[i];
      cur = '';
      if (Date.now() - t0 > ZIP_BUDGET_MS) throw new Error('Яндекс отдаёт файлы слишком медленно: за ' + Math.round((Date.now() - t0) / 1000) + ' с прочитано ' + i + ' из ' + items.length);
      cur = x.from;   /* ошибка дальше — про этот файл: страница может собрать кусок без него */
      const buf = await pending.shift();
      pump();
      let crc;
      if (x.slice) {
        if (x.head) { await out.write(localHeader(x.name, x.crc, x.size, dt, needs64(offset))); mine.push({ name: x.name, size: x.size, crc: x.crc, offset }); offset += 30 + x.name.length; }
        offset += await streamDiskRange(token, x.from, x.start, x.end, (b) => out.write(b), false);
        continue;
      }
      if (buf === null) {
        let c = -1, at = 0;
        const n1 = await streamDiskFile(token, x.from, (b, attempt) => { if (attempt !== at) { at = attempt; c = -1; } c = crc32Update(c, b); }, true);
        if (n1 !== x.size) throw new Error(x.from.split('/').pop() + ': размер изменился (' + n1 + ' вместо ' + x.size + '), обновите съёмку');
        crc = (c ^ -1) >>> 0;
        await out.write(localHeader(x.name, crc, x.size, dt, needs64(offset)));
        const n2 = await streamDiskFile(token, x.from, (b) => out.write(b));
        if (n2 !== x.size) throw new Error(x.from.split('/').pop() + ': файл изменился во время сборки');
      } else {
        if (buf.length !== x.size) throw new Error(x.from.split('/').pop() + ': размер изменился (' + buf.length + ' вместо ' + x.size + '), обновите съёмку');
        crc = crc32(buf);
        await out.write(localHeader(x.name, crc, x.size, dt, needs64(offset)));
        await out.write(buf);
      }
      mine.push({ name: x.name, size: x.size, crc, offset });
      offset += 30 + x.name.length + x.size;
    }
    if (req.final) {
      const cd = Buffer.concat(prev.concat(mine).map((d) => centralHeader64(d.name, d.crc, d.size, d.offset, dt)));
      await out.write(cd);
      await out.write(endRecord64(prev.length + mine.length, cd.length, offset));
    }
    const w = await out.end();
    if (w.status !== 201 || !w.etag) throw new Error('Хранилище не приняло кусок архива: HTTP ' + w.status + ' ' + String(w.body || '').slice(0, 200));
    console.log(JSON.stringify({ ev: 'zippart', n: req.n, files: items.length, bytes: partLen, ms: Date.now() - t0, final: !!req.final }));
    return { status: 200, result: { n: req.n, etag: w.etag, next: offset, bytes: partLen, done: mine.map((d) => ({ name: d.name.toString('utf8'), size: d.size, crc: d.crc, offset: d.offset })) } };
  } catch (e) {
    out.abort();
    console.log(JSON.stringify({ ev: 'zippart_error', error: String(e && e.message || e), ms: Date.now() - t0 }));
    return { status: 422, result: { error: String(e && e.message || e), from: cur || undefined } };
  }
}

module.exports.handler = async function (event) {
  const headers = event.headers || {};
  const origin = headers.Origin || headers.origin || '';
  const h = cors(origin);
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: h, body: '' };

  const q = event.queryStringParameters || {};
  const a = q.a || '';
  if (a === 'ping') return json(200, { ok: true }, h);

  const token = headers['X-Disk-Token'] || headers['x-disk-token'] || '';
  if (!token) return json(401, { error: 'Нет токена Яндекс Диска' }, h);

  try {
    if (a === 'preview') {
      if (!q.path) return json(400, { error: 'Нет path' }, h);
      const meta = await disk(token, 'GET', '/resources', { path: q.path, preview_size: q.size || 'XL', preview_crop: 'false', fields: 'preview,name,type' });
      if (meta.status !== 200) return json(meta.status, { error: meta.data.message || 'Нет файла' }, h);
      if (!meta.data.preview) return json(404, { error: 'У файла нет превью' }, h);
      const img = await binary(meta.data.preview, token);
      if (img.status !== 200) return json(502, { error: 'Превью не отдано: HTTP ' + img.status }, h);
      /* ответ функции в base64 не больше ~3,5 МБ — крупное превью страница возьмёт поменьше */
      if (img.buf.length > MAX_PREVIEW) return json(413, { error: 'Превью слишком большое' }, h);
      return {
        statusCode: 200,
        headers: Object.assign({ 'Content-Type': img.type, 'Cache-Control': 'private, max-age=86400' }, h),
        body: img.buf.toString('base64'),
        isBase64Encoded: true,
      };
    }

    /* Пачка превью одним вызовом: POST {paths:[...до 24], size}.
       Внутри — по 6 параллельно; ответ не больше ~2.5 МБ, остальное
       помечаем 'later', страница дозапросит. */
    if (a === 'previews') {
      if (event.httpMethod !== 'POST') return json(405, { error: 'Нужен POST' }, h);
      let body = event.body || '';
      if (event.isBase64Encoded) body = Buffer.from(body, 'base64').toString('utf8');
      let req;
      try { req = JSON.parse(body); } catch (e) { return json(400, { error: 'Тело не JSON' }, h); }
      const paths = Array.isArray(req.paths) ? req.paths.slice(0, 24) : [];
      const size = req.size || 'XL';
      const out = new Array(paths.length);
      let total = 0, next = 0;
      async function one(i) {
        const path = paths[i];
        try {
          const meta = await disk(token, 'GET', '/resources', { path, preview_size: size, preview_crop: 'false', fields: 'preview,type' });
          if (meta.status !== 200) { out[i] = { path, status: meta.status, error: meta.data.message || 'Нет файла' }; return; }
          if (!meta.data.preview) { out[i] = { path, status: 404, error: 'У файла нет превью' }; return; }
          const img = await binary(meta.data.preview, token);
          if (img.status !== 200) { out[i] = { path, status: 502, error: 'Превью не отдано: HTTP ' + img.status }; return; }
          if (total + img.buf.length > MAX_BATCH) { out[i] = { path, status: 'later' }; return; }
          total += img.buf.length;
          out[i] = { path, type: img.type, data: img.buf.toString('base64') };
        } catch (e) {
          out[i] = { path, status: 500, error: String(e && e.message || e) };
        }
      }
      async function worker() { while (next < paths.length) { const i = next++; await one(i); } }
      await Promise.all([worker(), worker(), worker(), worker(), worker(), worker()]);
      return json(200, { items: out }, h);
    }

    /* Диагностика скачивания: получить ссылку Яндекса на path и попробовать
       её открыть по-разному (как браузер со страницы, как адресная строка,
       с токеном). Тело архива не качаем — только заголовки и начало ответа.
       Токен и подпись ссылки в отчёт не попадают. */
    if (a === 'dltest') {
      if (!q.path) return json(400, { error: 'Нет path' }, h);
      const link = await disk(token, 'GET', '/resources/download', { path: q.path });
      const out = { path: q.path, link: { status: link.status, error: link.status === 200 ? undefined : (link.data.message || link.data.description) } };
      if (link.status !== 200 || !link.data.href) return json(200, out, h);
      const href = link.data.href;
      const u = new URL(href);
      out.link.host = u.host;
      out.link.kind = u.pathname.split('/')[1] || '';
      const page = 'https://barinskim-cmyk.github.io/content-pulse/';
      const variants = [
        ['как адресная строка (без заголовков)', {}],
        ['со страницы: Referer', { Referer: page }],
        ['со страницы: Origin', { Origin: 'https://barinskim-cmyk.github.io' }],
        ['с токеном OAuth', { Authorization: 'OAuth ' + token }],
      ];
      out.tries = [];
      for (const [name, headers] of variants) {
        const t0 = Date.now();
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 20000);
        const row = { name };
        try {
          let url = href, hops = [];
          let r;
          for (let i = 0; i < 5; i++) {
            r = await fetch(url, { headers: Object.assign({ 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15' }, headers), redirect: 'manual', signal: ac.signal });
            if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
              const nx = new URL(r.headers.get('location'), url);
              hops.push(r.status + ' -> ' + nx.host + nx.pathname.split('/').slice(0, 2).join('/'));
              url = nx.toString();
              try { await r.body?.cancel(); } catch (e) { }
              continue;
            }
            break;
          }
          row.status = r.status;
          row.type = r.headers.get('content-type') || '';
          row.disposition = (r.headers.get('content-disposition') || '').slice(0, 120);
          row.length = r.headers.get('content-length') || '';
          if (hops.length) row.redirects = hops;
          if (/text|json|html/.test(row.type) || r.status >= 400) {
            const txt = await r.text();
            row.body = txt.replace(/\s+/g, ' ').slice(0, 300);
          } else {
            try { await r.body?.cancel(); } catch (e) { }
          }
        } catch (e) {
          row.error = String(e && e.name === 'AbortError' ? 'нет ответа за 20 с' : (e && e.message || e));
        }
        clearTimeout(timer);
        row.ms = Date.now() - t0;
        out.tries.push(row);
      }
      return json(200, out, h);
    }

    /* Собрать ZIP из файлов Диска и положить его на Диск:
       POST {target, entries:[{from, name, size}]} */
    if (a === 'mpu') {
      if (event.httpMethod !== 'POST') return json(405, { error: 'Нужен POST' }, h);
      let body = event.body || '';
      if (event.isBase64Encoded) body = Buffer.from(body, 'base64').toString('utf8');
      let req;
      try { req = JSON.parse(body); } catch (e) { return json(400, { error: 'Тело не JSON' }, h); }
      const r = await doMultipart(token, req);
      return json(r.status, r.result, h);
    }

    if (a === 'crc') {
      if (event.httpMethod !== 'POST') return json(405, { error: 'Нужен POST' }, h);
      let body = event.body || '';
      if (event.isBase64Encoded) body = Buffer.from(body, 'base64').toString('utf8');
      let req;
      try { req = JSON.parse(body); } catch (e) { return json(400, { error: 'Тело не JSON' }, h); }
      const r = await doCrc(token, req);
      return json(r.status, r.result, h);
    }

    if (a === 'zippart') {
      if (event.httpMethod !== 'POST') return json(405, { error: 'Нужен POST' }, h);
      if (!s3Ready()) return json(501, { error: 'Хранилище не настроено' }, h);
      let body = event.body || '';
      if (event.isBase64Encoded) body = Buffer.from(body, 'base64').toString('utf8');
      let req;
      try { req = JSON.parse(body); } catch (e) { return json(400, { error: 'Тело не JSON' }, h); }
      const r = await doZipPart(token, req);
      return json(r.status, r.result, h);
    }

    if (a === 'zip') {
      if (event.httpMethod !== 'POST') return json(405, { error: 'Нужен POST' }, h);
      let body = event.body || '';
      if (event.isBase64Encoded) body = Buffer.from(body, 'base64').toString('utf8');
      let req;
      try { req = JSON.parse(body); } catch (e) { return json(400, { error: 'Тело не JSON' }, h); }
      if (!req.target || !/\.zip$/i.test(req.target)) return json(400, { error: 'Нет target .zip' }, h);
      const r = await doZip(token, req.target, Array.isArray(req.entries) ? req.entries : [], req.store);
      return json(r.status, r.result, h);
    }

    /* Замер: как быстро Диск отдаёт кадры этой функции и принимает загрузку.
       POST {files:[до 4 путей]} -> {reads:[...], parallel:{...}, upload:{...}} */
    if (a === 'bench') {
      if (event.httpMethod !== 'POST') return json(405, { error: 'Нужен POST' }, h);
      let body = event.body || '';
      if (event.isBase64Encoded) body = Buffer.from(body, 'base64').toString('utf8');
      let req;
      try { req = JSON.parse(body); } catch (e) { return json(400, { error: 'Тело не JSON' }, h); }
      const files = (Array.isArray(req.files) ? req.files : []).slice(0, 4);
      const out = { reads: [], parallel: null, upload: null };
      async function measure(path) {
        const row = { file: path.split('/').pop() };
        const t0 = Date.now();
        try {
          const link = await disk(token, 'GET', '/resources/download', { path });
          row.ms_link = Date.now() - t0;
          row.link_status = link.status;
          if (link.status !== 200) { row.error = link.data.message || link.data.description || ('HTTP ' + link.status); return row; }
          const t1 = Date.now();
          const f = await binary(link.data.href, null, 40000);
          row.ms_file = Date.now() - t1;
          row.status = f.status;
          row.mb = +(f.buf.length / 1048576).toFixed(2);
          row.mb_s = row.ms_file ? +(row.mb / (row.ms_file / 1000)).toFixed(2) : null;
          if (f.status !== 200) row.body = f.buf.toString('utf8', 0, 200);
        } catch (e) { row.error = String(e && e.message || e); row.ms_total = Date.now() - t0; }
        return row;
      }
      for (const p of files) out.reads.push(await measure(p));
      if (files.length > 1) {
        const t0 = Date.now();
        const rows = await Promise.all(files.map(measure));
        const mb = rows.reduce((a, r) => a + (r.mb || 0), 0);
        out.parallel = { files: rows.length, ms: Date.now() - t0, mb: +mb.toFixed(2), mb_s: +(mb / ((Date.now() - t0) / 1000)).toFixed(2), errors: rows.filter(r => r.error || r.status !== 200).map(r => r.file + ': ' + (r.error || r.status)) };
      }
      try {
        const sdir = /^(vd:[^:\/]+:)?disk:\/(.+\/)?_ContentPulse$/.test(req.dir || '') ? req.dir : 'disk:/_ContentPulse';
        const target = sdir + '/проверка_скорости.bin';
        await ensureDir(token, sdir);
        const t0 = Date.now();
        const up = await disk(token, 'GET', '/resources/upload', { path: target, overwrite: 'true' });
        if (up.status !== 200) out.upload = { error: 'ссылка на загрузку: ' + up.status + ' ' + (up.data.message || '') };
        else {
          const size = 8 * 1048576;
          const w = await openUpload(up.data.href, size);
          await w.write(Buffer.alloc(size, 7));
          const r = await w.end();
          const ms = Date.now() - t0;
          out.upload = { status: r.status, mb: 8, ms, mb_s: +(8 / (ms / 1000)).toFixed(2) };
        }
      } catch (e) { out.upload = { error: String(e && e.message || e) }; }
      return json(200, out, h);
    }

    if (a === 'file') {
      if (!q.path) return json(400, { error: 'Нет path' }, h);
      const meta = await disk(token, 'GET', '/resources', { path: q.path, fields: 'size,type' });
      if (meta.status !== 200) return json(meta.status, { error: meta.data.message || 'Нет файла' }, h);
      if ((meta.data.size || 0) > MAX_FILE) return json(413, { error: 'Файл больше 3 МБ' }, h);
      const link = await disk(token, 'GET', '/resources/download', { path: q.path });
      if (link.status !== 200) return json(link.status, { error: link.data.message || 'Нет ссылки' }, h);
      const f = await binary(link.data.href, null);
      if (f.status !== 200) return json(502, { error: 'Файл не отдан: HTTP ' + f.status }, h);
      return {
        statusCode: 200,
        headers: Object.assign({ 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' }, h),
        body: f.buf.toString('base64'),
        isBase64Encoded: true,
      };
    }

    if (a === 'copy') {
      if (event.httpMethod !== 'POST') return json(405, { error: 'Нужен POST' }, h);
      let body = event.body || '';
      if (event.isBase64Encoded) body = Buffer.from(body, 'base64').toString('utf8');
      let req;
      try { req = JSON.parse(body); } catch (e) { return json(400, { error: 'Тело не JSON' }, h); }
      const items = Array.isArray(req.items) ? req.items.slice(0, 1000) : [];
      const r = await doCopy(token, items, Array.isArray(req.dirs) ? req.dirs.slice(0, 200) : []);
      return json(r.status, r.result, h);
    }

    /* сводка съёмки в свойствах её папки (custom_properties, до 1024 знаков):
       витрина получает её тем же запросом, что и список съёмок */
    if (a === 'props') {
      if (event.httpMethod !== 'POST') return json(405, { error: 'Нужен POST' }, h);
      let body = event.body || '';
      if (event.isBase64Encoded) body = Buffer.from(body, 'base64').toString('utf8');
      let req;
      try { req = JSON.parse(body); } catch (e) { return json(400, { error: 'Тело не JSON' }, h); }
      if (!req.path || !req.props || typeof req.props !== 'object') return json(400, { error: 'Нужны path и props' }, h);
      const props = {};
      Object.keys(req.props).slice(0, 20).forEach(k => { const v = req.props[k]; props[k] = v === null ? null : String(v).slice(0, 900); });
      const r = await disk(token, 'PATCH', '/resources', { path: req.path }, { custom_properties: props });
      return json(r.status === 200 ? 200 : r.status, r.status === 200 ? { ok: true } : { error: r.data.message || r.data.description || 'не записано' }, h);
    }

    /* в Корзину Диска (восстановить можно 30 дней) и перенос между папками этапов */
    if (a === 'trash' || a === 'move') {
      if (event.httpMethod !== 'POST') return json(405, { error: 'Нужен POST' }, h);
      let body = event.body || '';
      if (event.isBase64Encoded) body = Buffer.from(body, 'base64').toString('utf8');
      let req;
      try { req = JSON.parse(body); } catch (e) { return json(400, { error: 'Тело не JSON' }, h); }
      const r = a === 'trash'
        ? await doTrash(token, (Array.isArray(req.paths) ? req.paths : []).slice(0, 200).map(String))
        : await doMove(token, (Array.isArray(req.items) ? req.items : []).slice(0, 200).filter(x => x && x.from && x.path));
      return json(r.status, r.result, h);
    }

    return json(400, { error: 'Неизвестное действие: ' + a }, h);
  } catch (e) {
    return json(500, { error: 'Ошибка прослойки: ' + (e && e.message || e) }, h);
  }
};

/* для скриптов настройки и проверки (proxy/s3setup.js) */
module.exports._s3 = { S3, s3Sign, s3Presign, openS3Upload, s3Ready, s3Call };
module.exports._zip = { doZipPart, doMultipart, doCrc };
