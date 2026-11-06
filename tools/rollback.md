# Откат Content Pulse к прошлой версии

Список версий — CHANGELOG.md (номер, время, что поменялось, версия прослойки).
Номер текущей версии виден на витрине под названием.

## Программа (страница на GitHub Pages)

Откатываем новой версией, а не стиранием истории — так можно вернуться обратно.

    git checkout v2.0.N -- cp-disk.js cp-app.js cp-shelf.js cp-rules.js cp-guard.js index.html tests/e2e.js
    git add -A cp-*.js index.html tests/e2e.js
    python3 tools/release.py "Откат к 2.0.N: <почему>" msg.txt

Через 1–2 минуты страница обновится (проверить номер на витрине).

## Прослойка (Yandex Cloud Function content-pulse-proxy)

У каждой выкладки своя версия функции; страница вызывает ту, у которой метка
`$latest`. Вернуть прежнюю — переставить метку на её id из колонки «Прослойка»
(API serverless-functions: POST /functions/v1/versions/<id>:setTag, tag=$latest)
или выложить proxy/index.js нужной версии: `git checkout v2.0.N -- proxy/index.js`
и `python3 proxy/deploy.py <ключ> <folder_id> <s3.json>`.

## Отборы съёмок

Отбор каждой съёмки — отдельно от программы: «Файл → Версии отбора» в самой съёмке.
