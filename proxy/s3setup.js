/* Настройка бакета для архивов выгрузки (один раз) и проверка подписи.
   Запуск: S3_KEY_ID=... S3_SECRET=... S3_BUCKET=... node proxy/s3setup.js
   Создаёт закрытый бакет (если нет), правило «удалять exports/ через 3 дня»,
   кладёт тестовый объект и скачивает его по подписанной ссылке. */
const https = require('https');
const crypto = require('crypto');
const { S3, s3Sign, s3Presign, openS3Upload } = require('./index.js')._s3;

function call(method, key, query, headers, body) {
  const signed = s3Sign(method, key, query, headers);
  return new Promise((resolve, reject) => {
    const req = https.request({ method, hostname: S3.host, path: signed.path,
      headers: Object.assign({}, signed.headers, body ? { 'Content-Length': Buffer.byteLength(body) } : {}) }, (r) => {
      let t = ''; r.on('data', (c) => { t += c; }); r.on('end', () => resolve({ status: r.statusCode, body: t }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

(async () => {
  let r = await call('PUT', '', {}, {});
  console.log('bucket', r.status, r.body.slice(0, 200));
  const xml = '<?xml version="1.0" encoding="UTF-8"?><LifecycleConfiguration><Rule><ID>exports</ID><Status>Enabled</Status>'
    + '<Filter><Prefix>exports/</Prefix></Filter><Expiration><Days>' + (+process.env.EXPORT_DAYS || 3) + '</Days></Expiration>'
    + '<AbortIncompleteMultipartUpload><DaysAfterInitiation>1</DaysAfterInitiation></AbortIncompleteMultipartUpload></Rule></LifecycleConfiguration>';
  const md5 = crypto.createHash('md5').update(xml).digest('base64');
  r = await call('PUT', '', { lifecycle: '' }, { 'content-md5': md5, 'content-type': 'application/xml' }, xml);
  console.log('lifecycle', r.status, r.body.slice(0, 200));
  const data = Buffer.from('content-pulse test ' + new Date().toISOString());
  const up = await openS3Upload('exports/_test.zip', data.length);
  await up.write(data);
  const u = await up.end();
  console.log('put', u.status, u.body.slice(0, 200));
  const url = s3Presign('exports/_test.zip', 600, 'Проверка_тест 1.zip');
  const g = await new Promise((res) => https.get(url, (resp) => { let t = ''; resp.on('data', (c) => { t += c; }); resp.on('end', () => res({ status: resp.statusCode, cd: resp.headers['content-disposition'], body: t })); }));
  console.log('get', g.status, g.cd, g.body.slice(0, 80));
})().catch((e) => { console.error(e); process.exit(1); });
