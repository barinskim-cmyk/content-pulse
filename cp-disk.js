/* ============================================================
   cp-disk.js — клиент REST API Яндекс Диска для браузера.
   Content Pulse 2.0: склад = Диск клиента, приложение только
   читает папки, тянет превью, скачивает, копирует на ретушь и
   хранит общий файл отбора _contentpulse.json в папке съёмки.

   Без зависимостей, ES5 + Promise/fetch (Chrome, Edge, Safari).

   Типовые ошибки API и что с ними делаем:
     409  папки нет / файл уже есть      -> ensureDir, overwrite
     423, 429, 5xx                       -> повтор с растущей паузой
     202  асинхронная операция           -> waitOperation
     507  нет места                      -> ошибка пользователю
     ссылки download/upload живут недолго -> берём перед каждым файлом
   ============================================================ */

var CPDisk = (function () {
  var API = 'https://cloud-api.yandex.net/v1/disk';
  var RETRY = { 423: 1, 429: 1, 500: 1, 502: 1, 503: 1, 504: 1 };
  var PHOTO_RE = /\.(jpe?g)$/i;
  var STATE_FILE = '_contentpulse.json';
  var RETOUCH_DIR = 'Ретушь';
  var MAX_RETRIES = 5;

  var token = '';
  var proxy = '';   /* адрес прослойки (Yandex Cloud Function) */

  /** Ошибка API: статус + полное тело ответа (для диагностики). */
  function DiskError(status, body, url) {
    var msg = body;
    try { var d = JSON.parse(body); msg = d.message || d.description || body; } catch (e) { }
    this.name = 'DiskError';
    this.status = status;
    this.body = body;
    this.url = url;
    this.message = 'Яндекс Диск ' + (status || 'сеть') + ': ' + msg;
  }
  DiskError.prototype = Object.create(Error.prototype);

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function backoff(attempt, retryAfter) {
    var ra = parseFloat(retryAfter);
    if (!isNaN(ra)) return ra * 1000;
    return 600 * Math.pow(2, attempt) + Math.random() * 300;
  }

  function qs(params) {
    var out = [];
    Object.keys(params || {}).forEach(function (k) {
      if (params[k] === undefined || params[k] === null) return;
      out.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
    });
    return out.length ? '?' + out.join('&') : '';
  }

  /**
   * fetch с повторами. opts: {method, body, auth (default true), as: 'json'|'blob'|'text'|'raw'}
   */
  function req(url, opts) {
    opts = opts || {};
    var attempt = 0;
    var maxRetries = opts.retries === undefined ? MAX_RETRIES : opts.retries;
    function run() {
      var headers = {};
      if (opts.auth !== false && token) headers['Authorization'] = 'OAuth ' + token;
      if (opts.contentType) headers['Content-Type'] = opts.contentType;
      return fetch(url, { method: opts.method || 'GET', headers: headers, body: opts.body })
        .then(function (resp) {
          if (resp.ok) {
            if (opts.as === 'raw') return resp;
            if (opts.as === 'blob') return resp.blob();
            if (opts.as === 'text') return resp.text();
            return resp.text().then(function (t) {
              var data = t ? JSON.parse(t) : {};
              data._status = resp.status;
              return data;
            });
          }
          return resp.text().then(function (body) {
            if (RETRY[resp.status] && attempt < maxRetries) {
              var wait = backoff(attempt++, resp.headers.get('Retry-After'));
              return sleep(wait).then(run);
            }
            throw new DiskError(resp.status, body, url);
          });
        }, function (netErr) {
          /* сеть оборвалась или CORS — повторяем, потом сдаёмся */
          if (attempt < maxRetries) return sleep(backoff(attempt++)).then(run);
          throw new DiskError(0, String(netErr && netErr.message || netErr), url);
        });
    }
    return run();
  }

  function api(endpoint, params, method) {
    return req(API + endpoint + qs(params), { method: method || 'GET' });
  }

  /* ---------- чтение ---------- */

  function info() { return api('', {}); }

  /** Содержимое одной папки, все страницы. */
  function listDir(path, previewSize) {
    var out = [], page = 500;
    function next(offset) {
      return api('/resources', {
        path: path, limit: page, offset: offset, sort: 'name',
        preview_size: previewSize || null, preview_crop: previewSize ? 'false' : null
      }).then(function (d) {
        var emb = d._embedded || {};
        var items = emb.items || [];
        out = out.concat(items);
        var total = emb.total || 0;
        if (items.length && offset + items.length < total) return next(offset + items.length);
        return out;
      });
    }
    return next(0);
  }

  /** Витрина: папки съёмок в архиве, свежие сверху. */
  function listShoots(archive) {
    return listDir(archive).then(function (items) {
      return items.filter(function (r) { return r.type === 'dir' && r.name.charAt(0) !== '_'; })
        .sort(function (a, b) { return a.modified < b.modified ? 1 : -1; });
    });
  }

  /**
   * Все JPEG съёмки рекурсивно; служебные «_*» и «Ретушь» пропускаем.
   * Папки обходим в несколько потоков (по умолчанию 4) — на съёмках с
   * десятками папок последовательный обход шёл минутами.
   * previewSize === false — без ссылок на превью (их отдаёт прослойка).
   */
  function walkPhotos(root, previewSize, parallel) {
    var out = [], queue = [root], active = 0, limit = parallel || 4, failed = null;
    var ps = previewSize === false ? null : (previewSize || 'XL');
    return new Promise(function (resolve, reject) {
      function pump() {
        if (failed) return;
        if (!queue.length && !active) {
          out.sort(function (a, b) { return a.path < b.path ? -1 : 1; });
          resolve(out);
          return;
        }
        while (active < limit && queue.length) {
          var path = queue.shift();
          active++;
          listDir(path, ps).then(function (items) {
            items.forEach(function (r) {
              if (r.type === 'dir') {
                if (r.name.charAt(0) === '_' || r.name === RETOUCH_DIR) return;
                queue.push(r.path);
              } else if (PHOTO_RE.test(r.name)) {
                out.push(r);
              }
            });
            active--;
            pump();
          }, function (e) { failed = e; reject(e); });
        }
      }
      pump();
    });
  }

  /** Превью приватного файла: нужна авторизация. */
  /* сеть/CORS не повторяем долго: при отказе есть запасной путь через скачивание */
  function previewBlob(previewUrl) { return req(previewUrl, { as: 'blob', retries: 1 }); }

  function downloadHref(path) {
    return api('/resources/download', { path: path }).then(function (d) { return d.href; });
  }

  /** Скачать файл целиком. Ссылку берём свежую перед каждым файлом. */
  function downloadBlob(path, expectedSize) {
    var attempt = 0;
    function run() {
      return downloadHref(path).then(function (href) {
        return req(href, { auth: false, as: 'blob' });
      }).then(function (blob) {
        if (expectedSize && blob.size !== expectedSize) {
          if (attempt++ < MAX_RETRIES) return run();
          throw new DiskError(0, 'Файл скачался не полностью: ' + path, path);
        }
        return blob;
      });
    }
    return run();
  }

  /* ---------- запись ---------- */

  function ensureDir(path) {
    var parts = path.replace(/^disk:/, '').split('/').filter(Boolean);
    var cur = 'disk:';
    return parts.reduce(function (p, part) {
      return p.then(function () {
        cur += '/' + part;
        return api('/resources', { path: cur }, 'PUT').catch(function (e) {
          if (e.status !== 409) throw e;
        });
      });
    }, Promise.resolve());
  }

  function uploadBlob(path, blob, overwrite) {
    return api('/resources/upload', { path: path, overwrite: overwrite === false ? 'false' : 'true' })
      .then(function (d) {
        return req(d.href, { method: 'PUT', body: blob, auth: false, as: 'text' });
      });
  }

  function waitOperation(href) {
    var t0 = Date.now();
    function poll() {
      return req(href).then(function (d) {
        if (d.status === 'success') return 'success';
        if (d.status === 'failed') throw new DiskError(0, 'Операция на Диске не удалась', href);
        if (Date.now() - t0 > 600000) throw new DiskError(0, 'Операция на Диске не завершилась вовремя', href);
        return sleep(1000).then(poll);
      });
    }
    return poll();
  }

  /**
   * Копия на Диске. Возвращает 'done' | 'exists'.
   * Основной путь — POST /resources/copy. Если браузер не пропускает POST
   * (CORS), запасной путь: скачать и залить копию.
   */
  function copy(src, dst) {
    return api('/resources/copy', { from: src, path: dst, overwrite: 'false' }, 'POST')
      .then(function (d) {
        if (d._status === 202 && d.href) return waitOperation(d.href).then(function () { return 'done'; });
        return 'done';
      }, function (e) {
        if (e.status === 409) return 'exists';
        if (e.status === 0) {   /* POST не прошёл из браузера — копируем через скачивание */
          return downloadBlob(src).then(function (blob) { return uploadBlob(dst, blob, false); })
            .then(function () { return 'done'; }, function (e2) {
              if (e2.status === 409) return 'exists';
              throw e2;
            });
        }
        throw e;
      });
  }

  /* ---------- общий файл отбора ---------- */

  function statePath(shoot) { return shoot.replace(/\/+$/, '') + '/' + STATE_FILE; }

  /** Ревизия файла отбора (md5 на Диске) или '' если файла нет. */
  function stateRev(shoot) {
    return api('/resources', { path: statePath(shoot) }).then(function (m) { return m.md5 || m.modified || ''; },
      function (e) { if (e.status === 404) return ''; throw e; });
  }

  /* ---------- прослойка ----------
     Сервер файлов Яндекса не отдаёт содержимое страницам с чужих сайтов,
     а копирование (POST) не проходит из браузера. Это делает прослойка. */

  function proxyReq(params, opts) {
    opts = opts || {};
    var attempt = 0;
    var url = proxy + qs(params);
    function run() {
      var init = { method: opts.method || 'GET', headers: { 'X-Disk-Token': token } };
      if (opts.body !== undefined) {
        init.body = JSON.stringify(opts.body);
        init.headers['Content-Type'] = 'application/json';
      }
      return fetch(url, init).then(function (resp) {
        if (resp.ok) return opts.as === 'json' ? resp.json() : resp.blob();
        return resp.text().then(function (body) {
          if (RETRY[resp.status] && attempt < 3) return sleep(backoff(attempt++)).then(run);
          throw new DiskError(resp.status, body, url);
        });
      }, function (netErr) {
        if (attempt < 2) return sleep(backoff(attempt++)).then(run);
        throw new DiskError(0, String(netErr && netErr.message || netErr), url);
      });
    }
    return run();
  }

  function proxyPreview(path, size) { return proxyReq({ a: 'preview', path: path, size: size || 'XL' }); }
  function proxyFile(path) { return proxyReq({ a: 'file', path: path }); }
  /** Собрать ZIP из файлов Диска и положить на Диск: entries [{from, name, size}] -> {path, bytes, files, ms} */
  function proxyZip(target, entries) {
    return proxyReq({ a: 'zip' }, { method: 'POST', body: { target: target, entries: entries }, as: 'json' });
  }
  /** Диагностика: как Яндекс отвечает на ссылку скачивания path. */
  function proxyDlTest(path) { return proxyReq({ a: 'dltest', path: path }, { as: 'json' }); }
  /** Пачка превью: -> {items:[{path, type, data(base64)} | {path, status, error}]} */
  function proxyPreviews(paths, size) {
    return proxyReq({ a: 'previews' }, { method: 'POST', body: { paths: paths, size: size || 'XL' }, as: 'json' });
  }
  /** items: [{from, path}], dirs: [папки создать заранее] -> {results:[{from, status}]} */
  function proxyCopy(items, dirs) {
    return proxyReq({ a: 'copy' }, { method: 'POST', body: { items: items, dirs: dirs || [] }, as: 'json' });
  }

  /** {data, rev}; data = null если отбора ещё нет. */
  function readState(shoot) {
    return stateRev(shoot).then(function (rev) {
      if (!rev) return { data: null, rev: '' };
      return (proxy ? proxyFile(statePath(shoot)) : downloadBlob(statePath(shoot))).then(function (b) { return b.text(); })
        .then(function (t) { return { data: JSON.parse(t), rev: rev }; });
    });
  }

  /**
   * Записать отбор, если с момента чтения его никто не менял.
   * Конфликт -> reject({conflict:true, data, rev}) со свежей версией.
   */
  function writeState(shoot, data, baseRev) {
    return stateRev(shoot).then(function (rev) {
      if (rev !== baseRev) {
        return readState(shoot).then(function (cur) {
          throw { conflict: true, data: cur.data, rev: cur.rev };
        });
      }
      var blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      return uploadBlob(statePath(shoot), blob, true).then(function () { return stateRev(shoot); });
    });
  }

  function safeName(name) {
    var s = String(name || '').replace(/[<>:"\/\\|?*\x00-\x1f]/g, '_').replace(/^[\s.]+|[\s.]+$/g, '');
    return s || '_';
  }

  return {
    setToken: function (t) { token = t || ''; },
    setProxy: function (u) { proxy = (u || '').replace(/\/+$/, ''); },
    hasProxy: function () { return !!proxy; },
    proxyPreview: proxyPreview, proxyPreviews: proxyPreviews, proxyDlTest: proxyDlTest, proxyZip: proxyZip, proxyFile: proxyFile, proxyCopy: proxyCopy,
    hasToken: function () { return !!token; },
    DiskError: DiskError,
    STATE_FILE: STATE_FILE, RETOUCH_DIR: RETOUCH_DIR,
    info: info, listDir: listDir, listShoots: listShoots, walkPhotos: walkPhotos,
    previewBlob: previewBlob, downloadHref: downloadHref, downloadBlob: downloadBlob,
    ensureDir: ensureDir, uploadBlob: uploadBlob, copy: copy, waitOperation: waitOperation,
    readState: readState, writeState: writeState, stateRev: stateRev, safeName: safeName
  };
})();
