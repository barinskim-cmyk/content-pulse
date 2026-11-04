#!/usr/bin/env python3
"""Выкладка прослойки Content Pulse в Yandex Cloud Functions.

Запуск:  python3 proxy/deploy.py <authorized_key.json> <folder_id>

Что делает:
  1. По авторизованному ключу сервисного аккаунта получает IAM-токен.
  2. Находит или создаёт функцию content-pulse-proxy.
  3. Выкладывает новую версию из proxy/index.js (nodejs18, 256 МБ, 120 с).
  4. Делает функцию публичной (вызывать может страница без входа в облако;
     без токена Яндекс Диска функция ничего не делает).
Печатает адрес вызова.
"""
import base64
import io
import json
import os
import sys
import time
import urllib.error
import urllib.request
import zipfile

import jwt

FN_NAME = 'content-pulse-proxy'
HERE = os.path.dirname(os.path.abspath(__file__))
FN_API = 'https://serverless-functions.api.cloud.yandex.net/functions/v1'
OP_API = 'https://operation.api.cloud.yandex.net/operations'


def iam_token(key_path):
    k = json.load(open(key_path))
    now = int(time.time())
    payload = {'aud': 'https://iam.api.cloud.yandex.net/iam/v1/tokens', 'iss': k['service_account_id'],
               'iat': now, 'exp': now + 3600}
    enc = jwt.encode(payload, k['private_key'], algorithm='PS256', headers={'kid': k['id']})
    r = call('POST', 'https://iam.api.cloud.yandex.net/iam/v1/tokens', {'jwt': enc})
    return r['iamToken']


def call(method, url, body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    if token:
        req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            t = resp.read().decode()
            return json.loads(t) if t else {}
    except urllib.error.HTTPError as e:
        raise SystemExit('%s %s -> %s %s' % (method, url, e.code, e.read().decode()))


def wait(op, token):
    while not op.get('done'):
        time.sleep(2)
        op = call('GET', OP_API + '/' + op['id'], token=token)
    if 'error' in op:
        raise SystemExit('Операция не удалась: %s' % json.dumps(op['error'], ensure_ascii=False))
    return op.get('response', {})


def main():
    key_path, folder = sys.argv[1], sys.argv[2]
    tok = iam_token(key_path)

    found = call('GET', FN_API + '/functions?folderId=%s&filter=name="%s"' % (folder, FN_NAME), token=tok)
    fns = found.get('functions', [])
    if fns:
        fn = fns[0]
    else:
        op = call('POST', FN_API + '/functions', {'folderId': folder, 'name': FN_NAME,
                                                  'description': 'Content Pulse: прослойка к Яндекс Диску'}, token=tok)
        fn = wait(op, tok)
    print('function', fn['id'])

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        z.write(os.path.join(HERE, 'index.js'), 'index.js')
    op = call('POST', FN_API + '/versions', {
        'functionId': fn['id'], 'runtime': 'nodejs18', 'entrypoint': 'index.handler',
        'resources': {'memory': str(256 * 1024 * 1024)}, 'executionTimeout': '120s',
        'content': base64.b64encode(buf.getvalue()).decode(),
    }, token=tok)
    ver = wait(op, tok)
    print('version', ver.get('id'))

    op = call('POST', FN_API + '/functions/%s:setAccessBindings' % fn['id'], {
        'accessBindings': [{'roleId': 'functions.functionInvoker',
                            'subject': {'id': 'allUsers', 'type': 'system'}}]}, token=tok)
    wait(op, tok)
    print('url', 'https://functions.yandexcloud.net/' + fn['id'])


if __name__ == '__main__':
    main()
