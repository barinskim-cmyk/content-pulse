#!/usr/bin/env python3
"""Выпуск версии Content Pulse: одна правка — одна версия (просьба Маши, 06.11.2026).

    git add <изменённые файлы>
    python3 tools/release.py "Что поменялось — по-русски" commit-msg.txt [версия-прослойки]

Одним коммитом: следующий номер 2.0.N из tools/versions.tsv ставится в
CP_VERSION (cp-app.js, его видно на витрине) и в ?v= у скриптов
(index.html — браузер берёт свежие файлы), строка дописывается в
versions.tsv, пересобирается CHANGELOG.md; в конце заголовка коммита —
«(2.0.N)». Метки git (tags) отсюда на GitHub не отправляются (прокси
пускает только ветку), поэтому коммит версии записывается в versions.tsv:
у прошлых версий — сразу, у новой — при следующем выпуске (ищется по
«(2.0.N)» в заголовке). Версию прослойки (Yandex Cloud) передавать,
если её выкладывали в этой правке — печатает proxy/deploy.py.

    python3 tools/release.py --changelog   — только пересобрать CHANGELOG.md

Откат — tools/rollback.md.
"""
import datetime
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TSV = os.path.join(ROOT, 'tools', 'versions.tsv')
TRAILER = ('\n\nCo-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>\n'
           'Claude-Session: https://claude.ai/code/session_01XBZXsNBhar4okTBs7seNFi\n')
GIT = ['git', '-c', 'user.email=noreply@anthropic.com', '-c', 'user.name=Claude']


def sh(*args):
    return subprocess.run(list(args), cwd=ROOT, check=True, capture_output=True, text=True).stdout.strip()


def rows():
    out = []
    for line in open(TSV, encoding='utf-8'):
        if line.strip():
            p = line.rstrip('\n').split('\t')
            out.append((p + [''] * 5)[:5])   # номер, когда (МСК), что поменялось, версия прослойки, коммит
    return out


def changelog():
    head = ['# Версии Content Pulse 2.0', '',
            'Каждая правка — отдельная версия; номер видно на витрине под названием. '
            'Откатиться — сказать «верни версию 2.0.N»: код этой версии вернётся новой версией '
            '(история не теряется), прослойка в Yandex Cloud — на версию из колонки «Прослойка». '
            'Как это делается — tools/rollback.md.', '',
            '| Версия | Когда (МСК) | Что поменялось | Прослойка | Коммит |', '|---|---|---|---|---|']
    body, proxy = [], ''
    for n, when, text, pv, commit in rows():
        if pv:
            proxy = pv
        body.append('| 2.0.%s | %s | %s | %s | %s |' % (n, when, text, ('**' + pv + '**') if pv else (proxy or '—'), commit or 'последний'))
    open(os.path.join(ROOT, 'CHANGELOG.md'), 'w', encoding='utf-8').write('\n'.join(head + body[::-1]) + '\n')


def main():
    text, msgfile = sys.argv[1], sys.argv[2]
    pv = sys.argv[3] if len(sys.argv) > 3 else ''
    backfill()
    n = int(rows()[-1][0]) + 1
    ver = '2.0.%d' % n
    app = os.path.join(ROOT, 'cp-app.js')
    s = open(app, encoding='utf-8').read()
    s2 = re.sub(r"var CP_VERSION = '[^']*';", "var CP_VERSION = '%s';" % ver, s)
    if s2 == s and "var CP_VERSION = '%s';" % ver not in s:
        sys.exit('CP_VERSION не найден в cp-app.js')
    open(app, 'w', encoding='utf-8').write(s2)
    idx = os.path.join(ROOT, 'index.html')
    h = open(idx, encoding='utf-8').read()
    open(idx, 'w', encoding='utf-8').write(re.sub(r'(cp-[a-z]+\.js\?v=)[0-9a-z.]+', r'\g<1>' + ver, h))
    when = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=3)).strftime('%d.%m.%Y %H:%M')
    with open(TSV, 'a', encoding='utf-8') as f:
        f.write('%d\t%s\t%s\t%s\t\n' % (n, when, text, pv))
    changelog()
    sh('git', 'add', 'cp-app.js', 'index.html', 'tools/versions.tsv', 'CHANGELOG.md')
    msg = re.sub(r'\n*Co-Authored-By:.*', '', open(msgfile, encoding='utf-8').read().strip(), flags=re.S)
    first, _, rest = msg.partition('\n')
    sh(*GIT, 'commit', '-q', '-m', '%s (%s)%s%s' % (first, ver, '\n' + rest if rest else '', TRAILER))
    sh('git', 'push', '-q', 'origin', 'main')
    print(ver, sh('git', 'rev-parse', '--short', 'HEAD'))


def backfill():
    """Дописать коммиты версиям, у которых его ещё нет (ищем «(2.0.N)» в заголовке)."""
    rs, changed = rows(), False
    for r in rs:
        if not r[4]:
            h = sh('git', 'log', '--format=%h', '-F', '--grep', '(2.0.%s)' % r[0], '-n', '1')
            if h:
                r[4], changed = h, True
    if changed:
        open(TSV, 'w', encoding='utf-8').write(''.join('\t'.join(r) + '\n' for r in rs))


if __name__ == '__main__':
    if sys.argv[1:2] == ['--changelog']:
        backfill()
        changelog()
    else:
        main()
