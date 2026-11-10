# Rust Player Tracker

Русскоязычный интерфейс для списка Steam-профилей и мониторинга Rust-серверов.

## Что уже есть

- Проверка SteamID64 и ссылок Steam-профилей.
- Сохранение списка игроков в браузере.
- Cloudflare Worker как безопасный прокси к API серверов.
- Ключ API хранится в секрете Worker, а не в публичном HTML.

## Подключение API серверов

Для мониторинга серверов используется API BattleMetrics.ru. Создай API-ключ в своём аккаунте BattleMetrics.ru. Не отправляй ключ в чат, GitHub или файл `index.html`.

### Развёртывание Worker

1. Создай Worker в Cloudflare Dashboard.
2. Загрузи в него содержимое файла `worker.js` из этого репозитория.
3. В настройках Worker открой **Settings → Variables and Secrets**.
4. Добавь секрет с именем `BATTLEMETRICS_API_KEY` и вставь туда свой новый API-ключ.
5. Опубликуй Worker и сохрани его адрес вида `https://имя-worker.твой-аккаунт.workers.dev`.

Worker предоставляет:
- `GET /api/servers?q=название` — поиск Rust-серверов.
- `GET /api/servers/ID` — данные конкретного сервера.

Ответы кэшируются на 15 секунд. API-ключ не передаётся в браузер.

## Rust+ Companion

Rust+ подключается через Cloudflare Durable Objects — отдельный домашний компьютер или Discord не нужны.

1. Войди на сайте через Steam.
2. Вкладка **Rust+ Companion** → войди на официальной странице Facepunch.
3. Установи расширение из папки `extension`, импортируй токен и сохрани его.
4. В игре открой меню Rust+ и нажми **Pair with Server**.
5. Вернись на сайт и нажми **Найти игровую привязку**. Worker читает историю Facepunch, сохраняет найденную привязку в личном Durable Object и соединяется с `wss://companion-rust.facepunch.com/socket/{serverId}`.

Для автоматической публикации Worker используются GitHub Actions secrets `CLOUDFLARE_API_TOKEN` и `CLOUDFLARE_ACCOUNT_ID`. Для Steam-сессий используется Cloudflare Worker secret `STEAM_SESSION_SECRET`. Не добавляй токены или другие секреты в GitHub.

Текущие Rust+ запросы: информация о сервере, команда, карта и метки. Живое соединение ещё нужно проверить на реальном сервере после игровой привязки. Cloudflare Free имеет лимиты, поэтому постоянную работу 24/7 не гарантируем. Подробности — в [CLOUDFLARE_RUSTPLUS_TEST.md](CLOUDFLARE_RUSTPLUS_TEST.md).

## Важно

- Если ранее опубликованный ключ API был отправлен в чат или попал в публичный репозиторий, отзови его и выпусти новый.
- Не добавляй секреты в Git.
- BattleMetrics API показывает статус и подтверждённый онлайн серверов. Это не является гарантией определения присутствия конкретного Steam-пользователя на сервере.
- При отображении данных BattleMetrics добавь ссылку на BattleMetrics.ru в интерфейс сайта.

## Локальный интерфейс

Открой `index.html` или включи GitHub Pages для репозитория.
