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

async function binary(url, token) {
  const headers = token ? { Authorization: 'OAuth ' + token } : {};
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, { headers, redirect: 'follow' });
    if ([429, 500, 502, 503, 504].includes(r.status) && attempt < 3) { await sleep(500 * Math.pow(2, attempt)); continue; }
    return { status: r.status, type: r.headers.get('content-type') || 'application/octet-stream', buf: Buffer.from(await r.arrayBuffer()) };
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

async function doCopy(token, items, dirs) {
  const made = {};
  for (const d of dirs || []) {
    const r = await ensureDir(token, d);
    if (!r.ok) return { status: r.status || 500, result: { error: 'Не удалось создать папку ' + d + ': ' + r.error } };
    made[d] = true;
  }
  const results = [];
  for (const it of items) {
    const parent = it.path.slice(0, it.path.lastIndexOf('/'));
    if (parent && !made[parent]) {
      const r = await ensureDir(token, parent);
      if (!r.ok) { results.push({ from: it.from, status: 'failed', error: r.error }); continue; }
      made[parent] = true;
    }
    const r = await disk(token, 'POST', '/resources/copy', { from: it.from, path: it.path, overwrite: 'false' });
    if (r.status === 201) results.push({ from: it.from, status: 'done' });
    else if (r.status === 409) results.push({ from: it.from, status: 'exists' });
    else if (r.status === 202 && r.data.href) {
      const st = await waitOp(token, r.data.href);
      results.push({ from: it.from, status: st === 'success' ? 'done' : 'failed', error: st === 'success' ? undefined : st });
    } else results.push({ from: it.from, status: 'failed', error: (r.data.message || r.data.description || ('HTTP ' + r.status)) });
  }
  return { status: 200, result: { results } };
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
