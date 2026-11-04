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
const MAX_FILE = 3 * 1024 * 1024;   /* лимит ответа функции ~3.5 МБ */
const ZIP_BUDGET_MS = 480000;        /* функция живёт 600 с — оставляем запас на загрузку */
const MAX_BATCH = 2.5 * 1024 * 1024; /* пачка превью: base64 + JSON укладываются в лимит */

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
async function disk(token, method, endpoint, params) {
  const qs = new URLSearchParams(params || {}).toString();
  const url = API + endpoint + (qs ? '?' + qs : '');
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { method, headers: { Authorization: 'OAuth ' + token, Accept: 'application/json' } });
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

async function ensureDir(token, path) {
  const parts = path.replace(/^disk:/, '').split('/').filter(Boolean);
  let cur = 'disk:';
  for (const p of parts) {
    cur += '/' + p;
    const r = await disk(token, 'PUT', '/resources', { path: cur });
    if (r.status !== 201 && r.status !== 409) return { ok: false, status: r.status, error: r.data.message || r.data.description };
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
    const r = await disk(token, 'POST', '/resources/copy', { from: it.from, path: it.path, overwrite: 'false' });
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

function localHeader(nameBuf, crc, size, dt) {
  const h = Buffer.alloc(30);
  h.writeUInt32LE(0x04034b50, 0);
  h.writeUInt16LE(20, 4);
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

function endRecord(count, cdSize, cdOffset) {
  const h = Buffer.alloc(22);
  h.writeUInt32LE(0x06054b50, 0);
  h.writeUInt16LE(count, 8);
  h.writeUInt16LE(count, 10);
  h.writeUInt32LE(cdSize, 12);
  h.writeUInt32LE(cdOffset, 16);
  return h;
}

/** Скачать один файл Диска целиком (сервер-сервер, без Origin). */
async function readDiskFile(token, path) {
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

async function doZip(token, target, entries) {
  const t0 = Date.now();
  const dt = dosDateTime(new Date());
  const items = entries.map((e) => ({ from: e.from, name: Buffer.from(String(e.name).replace(/^\/+/, ''), 'utf8'), size: +e.size || 0 }));
  if (!items.length) return { status: 400, result: { error: 'Нет файлов' } };
  if (items.some((x) => !x.size)) return { status: 400, result: { error: 'Нет размеров файлов' } };
  let total = 22;
  for (const x of items) total += 30 + x.name.length + x.size + 46 + x.name.length;
  if (total >= 0xFFFFFFFF || items.length >= 0xFFFF) return { status: 413, result: { error: 'Архив больше 4 ГБ — нужна разбивка на части' } };

  const parent = target.slice(0, target.lastIndexOf('/'));
  const d = await ensureDir(token, parent);
  if (!d.ok) return { status: d.status || 500, result: { error: 'Не удалось создать папку ' + parent + ': ' + d.error } };
  const up = await disk(token, 'GET', '/resources/upload', { path: target, overwrite: 'true' });
  if (up.status !== 200) return { status: up.status, result: { error: 'Загрузка на Диск не выдана: ' + (up.data.message || up.status) } };

  const out = await openUpload(up.data.href, total);
  /* читаем вперёд до 4 файлов, пишем строго по порядку */
  const AHEAD = 4;
  const pending = [];
  let next = 0;
  function pump() {
    while (next < items.length && pending.length < AHEAD) {
      const x = items[next++];
      const p = readDiskFile(token, x.from);
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
    if (r.status !== 201 && r.status !== 202) throw new Error('Диск не принял архив: HTTP ' + r.status + ' ' + r.body.slice(0, 200));
    console.log(JSON.stringify({ ev: 'zip', files: items.length, bytes: total, ms: Date.now() - t0 }));
    return { status: 200, result: { path: target, bytes: total, files: items.length, ms: Date.now() - t0 } };
  } catch (e) {
    out.abort();
    return { status: 422, result: { error: String(e && e.message || e), ms: Date.now() - t0 } };
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
      if (img.buf.length > MAX_FILE) return json(413, { error: 'Превью слишком большое' }, h);
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
    if (a === 'zip') {
      if (event.httpMethod !== 'POST') return json(405, { error: 'Нужен POST' }, h);
      let body = event.body || '';
      if (event.isBase64Encoded) body = Buffer.from(body, 'base64').toString('utf8');
      let req;
      try { req = JSON.parse(body); } catch (e) { return json(400, { error: 'Тело не JSON' }, h); }
      if (!req.target || !/\.zip$/i.test(req.target)) return json(400, { error: 'Нет target .zip' }, h);
      const r = await doZip(token, req.target, Array.isArray(req.entries) ? req.entries : []);
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
        const target = 'disk:/_ContentPulse/проверка_скорости.bin';
        await ensureDir(token, 'disk:/_ContentPulse');
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

    return json(400, { error: 'Неизвестное действие: ' + a }, h);
  } catch (e) {
    return json(500, { error: 'Ошибка прослойки: ' + (e && e.message || e) }, h);
  }
};
