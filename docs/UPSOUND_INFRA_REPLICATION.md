# Инфраструктура UpSound AI: снимок и порядок воспроизведения

Что реально развёрнуто у UpSound AI в Railway и Supabase — снято **с живых
консолей 03.09.2026**, не по памяти и не по коду. Документ нужен, чтобы
инфраструктуру Dizzit AI собрать по той же схеме и не изобретать её заново.

Три родственных документа, чтобы не путать:

| Документ | О чём |
| --- | --- |
| [`UPSOUND_ARCHITECTURE.md`](UPSOUND_ARCHITECTURE.md) | Архитектура **кода** UpSound: очереди, саги, сервисы, модули |
| **этот файл** | Что **развёрнуто**: сервисы Railway, переменные, схема Supabase, бакеты |
| [`PLATFORM_ARCHITECTURE.md`](PLATFORM_ARCHITECTURE.md) | Проектное решение **для Dizzit**: слои, порты, провайдеры, безопасность |

> ## Про секреты
>
> **В этом файле нет ни одного значения секрета — только имена переменных.**
> В консоли Railway значения замаскированы (`*******`), и раскрывать их не
> требовалось: для воспроизведения нужна структура, а не содержимое. Никогда
> не копируйте сюда значения — документ лежит в репозитории.
>
> Снятие делалось **только чтением**. Единственная выполненная команда —
> `SELECT` к `information_schema` в SQL-редакторе Supabase, чтобы получить
> список колонок; данные не менялись.

---

## 1. Railway: топология production

Проект `UpSound AI`, окружения **production** и **staging**. В production —
**19 сервисов**.

| Сервис | Роль | Что делает |
| --- | --- | --- |
| **API Backend** | `web` | FastAPI. Домен `api.upsound.ai`, том `api-backend-volume` |
| **Scheduler** | `scheduler` | APScheduler: продления, синк цен, уборка, reaper'ы |
| **Telegram Bot** | `telegram` | Поллинг бота и тех-алертов |
| **RabbitMQ-Prod** | брокер | Управляемый RabbitMQ, том `rabbitmq-prod-volume` |
| **Redis** | кэш + транспорт | Управляемый Redis, том `redis-volume` |
| **RabbitMQ Publisher Prod** | `rabbitmq_publisher` | Публикует PG-outbox в RabbitMQ |
| **Cover Generation RabbitMQ Worker Prod** | воркер | Одна очередь |
| **Neuro Photoshoot RabbitMQ Worker Prod** | воркер | Одна очередь |
| **Song Studio RabbitMQ Worker Prod** | воркер | Одна очередь |
| **Studio Audio RabbitMQ Worker Prod** | воркер | Одна очередь |
| **Audio Processing RabbitMQ Worker Prod** | воркер | Одна очередь |
| **Artist Analysis RabbitMQ Worker Prod** | воркер | Одна очередь |
| **Artist Brand RabbitMQ Worker Prod** | воркер | Одна очередь |
| **Release Generation RabbitMQ Worker Prod** | воркер | Одна очередь |
| **Reels Storyboard RabbitMQ Worker Prod** | воркер | Одна очередь |
| **Broadcast RabbitMQ Worker Prod** | воркер | Одна очередь |
| **Resize Cut RabbitMQ Worker Prod** | воркер | Одна очередь |
| **Yandex Ingestion RabbitMQ Worker Prod** | воркер | Одна очередь |

**Двенадцать воркеров — двенадцать очередей.** Ровно правило «один воркер —
одна очередь»: тяжёлая генерация не должна вытеснять лёгкие операции. Это
самая заметная черта топологии, и она стоит денег — двенадцать постоянно
работающих контейнеров.

### Как устроен деплой (проверено на API Backend)

| Параметр | Значение |
| --- | --- |
| Репозиторий | `borissuvorov/upsound-ai-backend`, ветка `main` |
| Автодеплой | По пушу в ветку. «Wait for CI» выключен |
| Билдер | **Dockerfile**, значение задано в `/railway.json` |
| Pre-deploy, start command, restart policy | Тоже из `/railway.json` |
| Регион | **EU West (Amsterdam)** |
| Реплики | 1. Больше нельзя — к сервису примонтирован том |
| Приватная сеть | `web.railway.internal` (короткое имя `web`) |
| Публичные адреса | `api.upsound.ai` + `web-production-4b5da.up.railway.app` |
| Restart policy | On Failure |

Ключевой вывод: **вся конфигурация деплоя — в репозитории (`railway.json`),
а не в кликах по консоли.** Билдер, pre-deploy-команда (миграции Alembic) и
start-команда версионируются вместе с кодом. Это то, что делает
воспроизводимым весь остальной ад из девятнадцати сервисов.

> Railway помечает Config-as-Code как устаревший: существующие файлы работают
> до **2026-12-01**, новые сервисы подключить уже нельзя (с 2026-08-28).
> Для Dizzit это значит: **закладываться на `railway.json` не надо** —
> начинать сразу с Infrastructure as Code либо держать конфиг в Dockerfile
> и переменных.

### Переменные: сколько и чем отличаются роли

| Сервис | Своих переменных | Добавлено Railway |
| --- | --- | --- |
| API Backend (`web`) | **258** | 11 |
| Cover Generation Worker | **192** | 7 |

Роли получают **почти одинаковый набор**; воркеру не нужны платёжные и
админские переменные. Различают роль ровно две:

- `PROCESS_ROLE` — что поднимать в контейнере;
- `QUEUE_WORKER_QUEUE_NAME` — какую очередь слушает этот воркер.

**Семь переменных есть в staging, но отсутствуют в production:**
`FRONTEND_BASE_URL`, `QUEUE_ADMISSION_MODE`, `QUEUE_BROKER_DEFAULT`,
`PAYKEEPER_TEST_USER_IDS`, `PAYKEEPER_TEST_MODE`,
`ALLOW_REAL_PAYMENT_PROVIDER_IN_DEV`, `BROADCAST_SIMULATION_ENABLED`.

Тестовые флаги в проде и не нужны. А вот `QUEUE_ADMISSION_MODE` и
`QUEUE_BROKER_DEFAULT` — не тестовые: в проде они работают на умолчании из
кода. Стоит проверить, что умолчание — то, которое вы хотите, потому что
admission control это защита от перегрузки, и «на умолчании» — не то же самое,
что «осознанно выбрано».

---

## 2. Каталог переменных окружения

Полный список имён с API Backend, сгруппированный по назначению. Это самая
переносимая часть документа: имена показывают, **какие решения вообще
приходится параметризовать**, когда сервис доживает до продакшена.

### Роль процесса и окружение
```
PROCESS_ROLE · PROJECT_NAME · ENVIRONMENT · DEPLOYMENT_ENVIRONMENT
DEBUG · LOG_LEVEL · API_HOST · API_PORT
BACKGROUND_WORKERS_ENABLED · RAILWAY_DEPLOYMENT_DRAINING_SECONDS
```

### База данных
```
DATABASE_URL · DATABASE_APPLICATION_NAME
DATABASE_POOL_SIZE · DATABASE_MAX_OVERFLOW · DATABASE_POOL_TIMEOUT_SEC
DATABASE_STARTUP_TIMEOUT_SEC · DATABASE_STARTUP_RETRY_INTERVAL_SEC
DATABASE_STATEMENT_TIMEOUT_SEC · DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_SEC
DATABASE_HEALTHCHECK_TIMEOUT_SEC · DATABASE_OUTAGE_CAPTURE_ENABLED
RUN_DB_MIGRATIONS_ON_STARTUP
```
Восемь таймаутов и лимитов на один пул — это не избыточность. Каждый из них
появился после конкретного инцидента: зависший statement, повисшая
транзакция, старт до готовности базы.

### Redis: ДВА разных URL
```
REDIS_URL                          общий кэш, лимитеры, лизы, локи шедулера
QUEUE_REDIS_URL                    транспорт очередей
REDIS_STATUS_SUMMARY_CACHE_TTL_SECONDS · REDIS_ADMIN_SUMMARY_CACHE_TTL_SECONDS
```
Подтверждено консолью: переменные разные и заданы обе.

### Очереди — по переменной на домен
```
QUEUE_RABBITMQ_URL · QUEUE_REDIS_FIRST_ENABLED · QUEUE_WORKER_QUEUE_NAME

QUEUE_<DOMAIN>_BROKER               redis | rabbitmq — выбор транспорта НА КАЖДУЮ очередь
QUEUE_<DOMAIN>_REDIS_FIRST_ENABLED  переключатель миграции на Redis-first

DOMAIN ∈ { ARTIST_ANALYSIS · ARTIST_BRAND · AUDIO_PROCESSING · BROADCAST ·
           COVER_GENERATION · NEURO_PHOTOSHOOT · REELS_STORYBOARD ·
           RELEASE_GENERATION · RESIZE_CUT · SONG_STUDIO · STUDIO_AUDIO ·
           YANDEX_INGESTION }

QUEUE_RESIZE_CUT_WEB_ROLLOUT_READY  отдельный флаг раскатки
```
**Двенадцать доменов × две переменные.** Транспорт выбирается на каждую
очередь отдельно — так переезд с Redis на RabbitMQ шёл по одной очереди за
раз, с возможностью откатить любую.

### Admission control и потолки параллелизма
```
HEAVY_JOB_MAX_ACTIVE_GLOBAL · AUDIO_MAX_ACTIVE_JOBS_GLOBAL

IMAGE_GENERATION_MAX_ACTIVE_PROVIDER_CALLS_GLOBAL
IMAGE_GENERATION_CAPACITY_LEASE_TTL_SECONDS
IMAGE_GENERATION_CAPACITY_WAIT_TIMEOUT_SECONDS
IMAGE_GENERATION_CAPACITY_RETRY_AFTER_SECONDS
IMAGE_GENERATION_CAPACITY_REDIS_FAIL_POLICY      ← поведение при недоступном Redis
IMAGE_GENERATION_CAPACITY_ALLOW_LOCAL_DEGRADED

TEXT_LLM_CAPACITY_LEASE_TTL_SECONDS · TEXT_LLM_CAPACITY_WAIT_TIMEOUT_SECONDS
TEXT_LLM_CAPACITY_RETRY_AFTER_SECONDS · TEXT_LLM_CAPACITY_REDIS_FAIL_POLICY
TEXT_LLM_CAPACITY_ALLOW_LOCAL_DEGRADED
TEXT_LLM_GEMINI_MAX_ACTIVE_GLOBAL · TEXT_LLM_OPENROUTER_MAX_ACTIVE_GLOBAL
TEXT_LLM_XAI_MAX_ACTIVE_GLOBAL                   ← потолок НА КАЖДОГО провайдера

NEURO_PHOTOSHOOT_ADMISSION_MAX_QUEUE_DEPTH
NEURO_PHOTOSHOOT_ADMISSION_MAX_ACTIVE_JOBS_GLOBAL
NEURO_PHOTOSHOOT_ADMISSION_MAX_OLDEST_QUEUED_AGE_SECONDS
NEURO_PHOTOSHOOT_ADMISSION_RETRY_AFTER_SECONDS
NEURO_PHOTOSHOOT_MAX_ACTIVE_JOBS_PER_USER
NEURO_PHOTOSHOOT_MAX_ACTIVE_PROVIDER_CALLS_GLOBAL
NEURO_PHOTOSHOOT_MAX_ACTIVE_SLOTS_PER_JOB

COVER_MAX_ACTIVE_JOBS_GLOBAL · COVER_MAX_ACTIVE_VARIANTS_GLOBAL
COVER_MAX_ACTIVE_VARIANTS_PER_JOB · COVER_MAX_ACTIVE_PROVIDER_CALLS_PER_USER
COVER_MAX_ACTIVE_GENERATE_VARIANTS_PER_RELEASE
COVER_PROMPT_MAX_CONCURRENCY_GLOBAL · COVER_PROMPT_MAX_CONCURRENCY_PER_JOB
COVER_IMAGE_PROVIDER_TIMEOUT_SECONDS
COVER_IMAGE_GENERATION_ATTEMPT_TIMEOUT_SECONDS
COVER_IMAGE_GENERATION_MAX_ATTEMPTS
COVER_QUEUE_STUCK_ALERT_MIN_AGE_SECONDS · COVER_QUEUE_DEPTH_LOG_INTERVAL_SECONDS
COVER_SANITIZER_CAPACITY_SLOTS · COVER_SANITIZER_CONCURRENCY
COVER_SANITIZER_ENQUEUE_WINDOW · COVER_SANITIZER_QUEUE_ENABLED
```
**Это самый поучительный блок каталога.** Потолки стоят на четырёх разных
уровнях сразу: глобально, на пользователя, на задачу и на провайдера. Плюс
у каждого лиза есть явная политика на случай недоступного Redis
(`*_REDIS_FAIL_POLICY`) — то есть вопрос «что делать, если счётчик недоступен»
решён заранее, а не в момент инцидента.

### AI-провайдеры
```
AI_PROVIDER_MODE                     режим слоя (боевой / заглушка)

OPENROUTER_API_KEY · OPENROUTER_GEMINI_MODEL · OPENROUTER_REELS_MODEL
GEMINI_API_KEY · GEMINI_MODEL · GEMINI_TRANSPORT_TIMEOUT_SECONDS
QWEN_API_KEY · QWEN_BASE_URL
XAI_API_KEY
LAOZHANG_API_KEY
KIE_API_KEY · KIE_COVER_API_KEY      ← отдельный ключ на домен: раздельные лимиты и учёт
APIMODELS_API_KEY
EVOLINK_API_KEY
ELEVENLABS_API_KEY · ELEVENLABS_STT_MODEL · ELEVENLABS_STT_TIMEOUT_SEC
```
**Здесь прямое пересечение со Dizzit:** OpenRouter, Laozhang, Kie.ai и
API Models уже заведены и работают. Ключи можно завести те же (или отдельные —
см. §7), а модель конфигурации переносится один в один: **ключ + базовый URL +
имя модели на роль**, а не один ключ на всё.

Отдельно: `KIE_API_KEY` и `KIE_COVER_API_KEY` — **два ключа одного
провайдера** под разные функции. Так расход и лимиты видно по фичам, а не
общей кучей.

### Хранилище файлов
```
STORAGE_PROVIDER · STORAGE_PUBLIC_BASE_URL · ASSET_DELIVERY_MODE

R2_ACCOUNT_ID · R2_BUCKET_NAME · R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY · R2_PUBLIC_URL

SUPABASE_BUCKET_NAME · SUPABASE_STORAGE_PUBLIC_BUCKET · SUPABASE_STORAGE_PRIVATE_BUCKET
SUPABASE_STORAGE_S3_ENDPOINT · SUPABASE_STORAGE_S3_REGION
SUPABASE_STORAGE_S3_ACCESS_KEY_ID · SUPABASE_STORAGE_S3_SECRET_ACCESS_KEY
```
Заведены **оба** провайдера — Supabase Storage и Cloudflare R2, — переключение
через `STORAGE_PROVIDER`. Доступ к Supabase Storage идёт по **S3-протоколу**,
а не через клиентскую библиотеку: то есть код работает с обоими одинаково.

### Авторизация и доступ
```
SUPABASE_URL · SUPABASE_KEY · SUPABASE_SERVICE_KEY · SUPABASE_JWT_SECRET
ADMIN_URL · ADMIN_PASSWORD · ADMIN_SECRET_KEY
EXTENSION_TOKEN_SECRET · EXTENSION_LEGACY_AUTH_ENABLED
AUTH_TIMING_LOG
```

### Наблюдаемость
```
SENTRY_DSN · SENTRY_ENVIRONMENT · SENTRY_TRACES_SAMPLE_RATE
SENTRY_PROFILES_SAMPLE_RATE · SENTRY_SEND_DEFAULT_PII · SENTRY_ALERTS_WEBHOOK_SECRET

OTEL_SERVICE_NAME · OTEL_SERVICE_NAMESPACE · OTEL_RESOURCE_ATTRIBUTES
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT · OTEL_EXPORTER_OTLP_TRACES_HEADERS
OTEL_EXPORTER_OTLP_LOGS_ENDPOINT · OTEL_EXPORTER_OTLP_LOGS_HEADERS
OTEL_TRACES_SAMPLER · OTEL_TRACES_SAMPLER_ARG · OTEL_PROPAGATORS
OTEL_FASTAPI_EXCLUDED_URLS

OBSERVABILITY_ENABLED · OBSERVABILITY_PLATFORM · OBSERVABILITY_PROJECT
OBSERVABILITY_COMPONENT
BACKEND_APP_METRICS_ENABLED · BACKEND_METRICS_TOKEN
POSTHOG_API_KEY · ENABLE_POSTHOG_ERROR_TRACKING
ERROR_EVENTS_WRITE_POLICY

TELEGRAM_BOT_TOKEN · TELEGRAM_TECH_BOT_TOKEN · TELEGRAM_ADMIN_CHAT_ID
TELEGRAM_POLLING_ENABLED · TELEGRAM_LOGIN_WINDOW_CLOSES_ON
```
`SENTRY_SEND_DEFAULT_PII` — отдельная переменная, то есть отправка личных
данных в Sentry это осознанное решение, а не побочный эффект.

### Платежи
```
PAYMENT_PROVIDER · PAYMENT_PRIMARY_PROVIDER · PAYMENT_FALLBACK_PROVIDER

ALFA_ENABLED · ALFA_PROFILE · ALFA_AUTH_MODE · ALFA_PAYMENT_MODE
ALFA_API_BASE_URL_PROD · ALFA_API_BASE_URL_TEST
ALFA_API_USERNAME · ALFA_API_PASSWORD · ALFA_TIMEOUT_SECONDS
ALFA_CALLBACK_URL · ALFA_CALLBACK_SECRET · ALFA_CALLBACK_SIGNATURE_MODE
ALFA_CALLBACK_REQUIRE_SIGNATURE · ALFA_CALLBACK_RSA_PUBLIC_KEY_PEM
ALFA_CALLBACK_REJECT_UNSIGNED_IN_PRODUCTION
ALFA_ALLOW_UNSIGNED_CALLBACKS_LOCAL_ONLY          ← «только локально» прямо в имени
ALFA_ALLOWED_PAYMENT_HOSTS · ALFA_CARD_BINDINGS_ENABLED
ALFA_RECURRING_ENABLED · ALFA_PREAUTHORIZATION · ALFA_SEND_ORDER_BUNDLE
ALFA_FISCALIZATION_CONFIGURATION_CONFIRMED

TBANK_TERMINAL_KEY · TBANK_SECRET_KEY · TBANK_SANDBOX
TOCHKA_API_BASE_URL · TOCHKA_API_TOKEN · TOCHKA_PAYMENT_MODE
TOCHKA_WEBHOOK_URL · TOCHKA_WEBHOOK_PUBLIC_KEY_JSON
TOCHKA_SUCCESS_URL · TOCHKA_FAIL_URL
PAYKEEPER_BASE_URL · PAYKEEPER_USERNAME · PAYKEEPER_PASSWORD
PAYKEEPER_SECRET · PAYKEEPER_CALLBACK_URL

PAYMENT_ALERT_CRITICAL_TELEGRAM_CHAT_IDS · PAYMENT_ALERT_SUCCESS_TELEGRAM_CHAT_IDS
PAYMENT_ALERT_SUCCESS_TELEGRAM_ENABLED · PAYMENT_ALERT_NONCRITICAL_TELEGRAM_ENABLED
```
Обратите внимание на **четыре отдельные переменные вокруг подписи одного
колбэка** Альфы. Разрешение неподписанных вызовов существует только как флаг
с `LOCAL_ONLY` в самом имени — так его не включат в проде «на пять минут».

### Живой прогресс (SSE)
```
ARTIST_ANALYSIS_LIVE_STREAMING_ENABLED · PITCHING_LIVE_STREAMING_ENABLED
PROMOTION_PLAN_LIVE_STREAMING_ENABLED · TRACK_ANALYSIS_LIVE_STREAMING_ENABLED
REELS_LIVE_STREAMING_ENABLED · REELS_LIVE_STREAMING_EMIT_INTERVAL_MS
```
Каждый стрим — под своим флагом, с настраиваемой частотой отправки кадров.

---

## 3. Supabase: организация и проекты

Организация `welcome@upsound.org's Org`, план **PRO**, четыре проекта:

| Проект | Регион | Размер | Назначение |
| --- | --- | --- | --- |
| **UpSound AI** | AWS eu-central-1 | SMALL | Продакшн основного сервиса |
| UpSound Staging | AWS eu-central-1 | MICRO | Стейджинг |
| UpSound CRM | AWS eu-west-1 | SMALL | Отдельный продукт (`borissuvorov/UpSound-CRM-backend`) |
| Boris-Projects | AWS eu-west-1 | NANO | Песочница |

Правило, которое стоит перенять: **отдельный проект Supabase на продукт и на
окружение.** Не схема внутри одной базы — отдельный проект. Тогда стейджинг
нельзя случайно уронить продовой миграцией.

> Регионы разъехались: Railway держит `web` в **EU West (Амстердам)**, а база
> UpSound AI — в **eu-central-1 (Франкфурт)**. Это лишние миллисекунды на
> каждый запрос к базе. Для Dizzit имеет смысл поставить приложение и базу в
> один регион с самого начала.

## 4. Схема базы UpSound AI

**50 таблиц в `public`.** Группировка по назначению:

### Пользователи, доступ, деньги
| Таблица | Колонок | Строк | Размер |
| --- | --- | --- | --- |
| `users` | 48 | 136 | 328 kB |
| `roles` · `user_roles` · `admin_users` | 9 / 5 / 6 | 0 / 12 / 11 | — |
| `subscriptions` | 28 | 134 | 248 kB |
| `token_transactions` | 18 | 772 | 520 kB |
| `payments` | 36 | 56 | 272 kB |
| `waitlist` | 20 | 1 644 | 824 kB |
| `user_activity_logs` | 12 | 1 934 | 752 kB |
| `admin_settings` | 4 | 34 | 80 kB |

### Учёт расходов на ИИ — самое переносимое
| Таблица | Колонок | Строк | Размер |
| --- | --- | --- | --- |
| `ai_usage_log` | 25 | **146 973** | **97 MB** |
| `ai_model_pricing` | 17 | 271 | 312 kB |

Сто сорок семь тысяч записей — по строке на каждый вызов модели. Это и есть
«учёт стоимости с первого дня» в натуральную величину.

### Доменные данные и состояние генераций
`artists` · `artist_content` · `artist_photos` · `artist_cover_references` ·
`artist_pitch_references` · `releases` · `release_content` · `analyses` ·
`playlists` · `release_playlist_recommendations` · `promotion_plans` ·
`promotion_plan_sections` · `pitch_references`

Обложки: `cover_references` (48 колонок, **218 MB**) · `cover_analysis`
(39 MB) · `generated_covers` (82 MB) · `cover_generation_log` (101 MB) ·
`cover_processing_log` (41 465 строк) · `cover_generation_state` ·
`cover_generation_lock` · `cover_clusters` · `cover_cluster_membership` ·
`cover_cluster_fallback_membership` · `cover_mockups` · `mockup_templates`

Reels: `reels_video_scripts` · `reels_generation_traces` · `reels_barrels` ·
`reels_barrel_variants` · `reels_analyzed_clips` · `reels_weights_cache` ·
`reels_artist_video_history`

Прочее: `audio_processing_jobs` · `broadcast_messages` · `broadcast_recipients`

Служебное: `alembic_version` (миграции) ·
`cover_analysis_backup_20260224` · `cover_reference_status_backup_20260224`

### Три наблюдения по схеме

**1. Общей таблицы `jobs` нет.** Durable-состояние задач хранится
по-доменно: `cover_generation_state`, `audio_processing_jobs`,
`reels_generation_traces`. Redis держит транспорт и оперативный статус, а
Postgres — терминальное состояние конкретного домена.

Для Dizzit это **аргумент сделать иначе**: у нас инструментов будет три-четыре,
а не двенадцать, и одна таблица `jobs` с полем `kind` даст общий список задач,
общий reaper и общий admin-экран. По-доменные таблицы окупаются на масштабе
UpSound, а на нашем — только размножают код.

**2. RLS выключен на всех 50 таблицах.** Значит вся авторизация живёт в
бэкенде, который ходит в базу под `SUPABASE_SERVICE_KEY`. Это рабочая схема —
но она означает, что **любая утечка service-ключа даёт полный доступ ко всем
данным всех пользователей**, без второго рубежа. В консоли Supabase на этой
странице висит подсказка «включить RLS автоматически для новых таблиц» — она
не активирована.

**3. Есть таблицы-бэкапы с датой в имени** (`..._backup_20260224`), нулевые
по строкам, но занимающие 13 MB и 416 kB. След ручной миграции, который забыли
убрать.

### `ai_usage_log` — шаблон для нашего UsageRecorder

Полный список колонок:

```
 1 id                 bigint
 2 user_id            bigint
 3 artist_id          bigint          ← доменная привязка
 4 release_id         integer
 5 analysis_id        bigint
 6 operation_type     varchar
 7 content_type       varchar
 8 provider           varchar
 9 model              varchar
10 tokens_input       integer
11 tokens_output      integer
12 tokens_total       integer
13 cost_usd           numeric
14 duration_ms        integer
15 status             varchar
16 error_message      varchar
17 request_metadata   jsonb
18 created_at         timestamptz
19 provider_slug      varchar
20 feature            varchar          ← какая фича потратила
21 request_id         uuid
22 unit_counts        jsonb            ← не только токены: секунды, картинки, кадры
23 cost_rub           numeric
24 fx_rate_used       numeric          ← курс, по которому считали
25 unit_prices_used   jsonb            ← СНИМОК ЦЕН на момент вызова
```

Позиции 19–25 дописаны позже (видно по порядку) — и именно они самые ценные:

- **`unit_prices_used` и `fx_rate_used` — снимок цен и курса в момент вызова.**
  Без них пересчёт истории поедет, как только провайдер поменяет прайс. С ними
  строка лога самодостаточна.
- **`unit_counts` (jsonb) вместо только токенов.** Картинки, секунды звука и
  кадры не считаются в токенах — под это нужна свободная форма.
- **`feature` и `provider_slug`** — разрез «сколько съела вот эта кнопка».

Для Dizzit это ложится один в один: `cost_usd` + `cost_rub` + `fx_rate_used` +
`unit_prices_used` + `unit_counts` — берём как есть, меняются только доменные
привязки (вместо `artist_id`/`release_id` — `project_id`/`job_id`).

### `ai_model_pricing`

```
 1 id            integer          6 description   text        15 unit      varchar
 2 provider      varchar          7 is_active     boolean     16 price     numeric
 3 model         varchar          8 created_at    timestamp   17 currency  varchar
 4 input_price   double           9 updated_at    timestamp
 5 output_price  double
```
Колонки 10–14 не снимались. Видно, что таблица пережила расширение: рядом со
старыми `input_price`/`output_price` (только про токены) появились
универсальные `unit` + `price` + `currency` — для генераций, которые считаются
не в токенах. 271 строка = столько комбинаций «провайдер + модель» в обороте.

### `token_transactions` — леджер

```
 1 id                        bigint      10 created_at                timestamptz
 2 user_id                   bigint      11 token_source              enum
 3 analysis_id               bigint      12 feature_key               varchar
 4 amount                    integer     13 subscription_id           bigint
 …                                       14 source_payment_id         bigint
 8 cost_rubles               numeric     15 subscription_period_start timestamptz
 9 description               varchar     16 subscription_period_end   timestamptz
                                         17 subscription_period_key   varchar
                                         18 idempotency_key           varchar
```
`idempotency_key` — последняя колонка, то есть добавлена после запуска. Ровно
та защита, без которой ретрай списывает дважды. **Заводить сразу, а не 18-й
колонкой.**

`amount` — `integer`: токены целые, дробей нет. `token_source` — enum, а не
строка.

## 5. Расширения Postgres

Включены ровно пять:

```
uuid-ossp          1.1     генерация UUID
pgcrypto           1.3     криптофункции
pg_stat_statements 1.11    статистика запросов (Query Performance)
vector             0.8.0   pgvector — эмбеддинги, схема public
plpgsql            1.0     базовое
```
Остальные ~60 доступны, но не установлены. `pg_cron` **не включён** —
расписание держит отдельный сервис `Scheduler`, а не база. Для Dizzit это
правильный образец: планировщик в приложении виден в логах и деплоится вместе
с кодом.

## 6. Хранилище файлов

Шесть бакетов:

| Бакет | Доступ | Лимит размера | Разрешённые типы | Политик |
| --- | --- | --- | --- | --- |
| `brand-assets` | **PUBLIC** | не задан (512 MB) | **любые** | 0 |
| `upsound-covers` | **PUBLIC** | 512 MB | **любые** | 0 |
| `cover-references` | **PUBLIC** | не задан (512 MB) | **любые** | 0 |
| `upsound-private-assets` | приватный | не задан (512 MB) | **любые** | 0 |
| `artist-tracks` | приватный | 50 MB | **любые** | 0 |
| `tracks` | приватный | 50 MB | audio/mpeg, wav, ogg, mp4, png, jpeg, webp | 2 |

Публичный и приватный бакеты разведены — это верно. Но два места стоит
сделать иначе у себя:

- **MIME ограничен только у `tracks`.** В остальные пять можно положить файл
  любого типа. Список разрешённых типов — это защита в одну строку конфигурации,
  и ставить её надо на все бакеты.
- **Лимит размера у трёх бакетов не задан** — работает умолчание 512 MB.
  Осознанный лимит и умолчание это разные вещи.

Политик доступа почти нигде нет — следствие того же решения, что и с RLS:
доступ идёт через бэкенд с сервисным ключом.

## 7. Авторизация

Из всех провайдеров Supabase Auth включён **только Email**. Phone, SAML,
Web3, Google, Apple, GitHub и остальные два десятка — выключены. Своих
OAuth-провайдеров нет.

То есть весь вход — email + пароль / magic link, а бэкенд валидирует
Supabase JWT (`SUPABASE_JWT_SECRET`). Просто и достаточно; для Dizzit
повторяем ровно это.

---

## 8. Что переносим в Dizzit AI

Схема UpSound рассчитана на двенадцать доменов генерации, четыре платёжных
провайдера и полсотни таблиц. Копировать её целиком в сервис с двумя
инструментами — значит получить обслуживание, которое съест всё время
разработки. Ниже разбор по трём корзинам.

### Копируем один в один

| Механизм UpSound | Как у нас |
| --- | --- |
| **`PROCESS_ROLE`: один образ, разные роли** | `web` · `worker` · `scheduler` из одного Dockerfile |
| **Два URL Redis: `REDIS_URL` и `QUEUE_REDIS_URL`** | Так же. Один инстанс, разные префиксы — но переменные разные |
| **`ai_usage_log` со снимком цен** | `unit_counts` · `unit_prices_used` · `fx_rate_used` — берём как есть |
| **`ai_model_pricing` с `unit`/`price`/`currency`** | Сразу в универсальном виде, без стадии «только токены» |
| **`idempotency_key` в леджере** | Сразу, а не 18-й колонкой |
| **Ключ + базовый URL + модель на роль** | `GatewayProfile` из `PLATFORM_ARCHITECTURE.md` — ровно эта модель |
| **Отдельные ключи на функцию** (`KIE_API_KEY` / `KIE_COVER_API_KEY`) | Отдельный ключ на инструмент: расход виден по фичам |
| **`*_REDIS_FAIL_POLICY` у каждого лиза** | Политика «что если счётчик недоступен» задаётся, а не подразумевается |
| **Флаг неподписанных вебхуков с `LOCAL_ONLY` в имени** | Так же: имя переменной должно мешать включить её в проде |
| **Конфигурация деплоя в репозитории** | Но не `railway.json` (устаревает 01.12.2026) — Dockerfile + IaC |
| **Отдельный проект Supabase на окружение** | `dizzit-prod` и `dizzit-staging` — отдельными проектами |
| **Только Email в Supabase Auth** | Остальные провайдеры выключены |
| **`pg_cron` не включать** | Расписание — в сервисе `scheduler`, вместе с кодом |

### Упрощаем

| У UpSound | У нас | Почему |
| --- | --- | --- |
| 19 сервисов, 12 воркеров | **3 сервиса**: web + worker + scheduler | Два инструмента, три-четыре типа задач. Двенадцать контейнеров нечем занять |
| RabbitMQ + Redis, транспорт на каждую очередь | **Только Redis** (BullMQ), без RabbitMQ | Второй брокер появился как миграция под нагрузкой, которой у нас нет. `QUEUE_<DOMAIN>_BROKER` заводить незачем |
| Очередь на домен + `QUEUE_<DOMAIN>_*` × 12 | Одна-две очереди: `image:v1`, `mesh:v1` | Разделять стоит по стоимости и длительности, а не по инструменту |
| По-доменные таблицы состояния задач | **Одна `jobs` с полем `kind`** | Общий список, общий reaper, общий admin-экран |
| 4 платёжных провайдера, ~40 переменных | Ни одного, пока не понадобится | Половина биллинг-саги хуже её отсутствия |
| 258 переменных | ~40 на старте | Каждая переменная UpSound появилась из инцидента. Наши появятся из наших |
| Sentry + OTel + Prometheus + PostHog + Telegram-алерты | **Sentry сразу**, остальное — со второй ролью | |

### Делаем иначе

| У UpSound | У нас | Почему |
| --- | --- | --- |
| **RLS выключен на всех 50 таблицах** | **RLS включён**, плюс автовключение для новых таблиц | Утечка service-ключа не должна означать доступ ко всем данным всех пользователей. Второй рубеж стоит дёшево, если ставить сразу |
| **MIME ограничен только в 1 бакете из 6** | Список типов **на каждом** бакете | Одна строка конфигурации против «в бакет можно положить что угодно» |
| **Лимит размера не задан у 3 бакетов** | Явный лимит везде | Умолчание 512 MB — не решение, а его отсутствие |
| Регионы приложения и базы разъехались (Амстердам ↔ Франкфурт) | **Один регион** для Railway и Supabase | Лишние миллисекунды на каждый запрос, бесплатно устраняются на старте |
| `QUEUE_ADMISSION_MODE` не задан в production | Задаём явно | Admission control — защита от перегрузки; «на умолчании» ≠ «выбрано» |
| Таблицы-бэкапы `..._backup_20260224` живут в схеме | Бэкапы — вне рабочей схемы, с TTL | 13 MB нулевых строк — след, который никто не убрал |
| Конфиг деплоя в `railway.json` | Dockerfile + IaC | Config-as-Code Railway отключается 01.12.2026 |

## 9. Порядок заведения инфраструктуры

От несущего к необязательному. Каждый шаг проверяется до перехода к следующему.

**Шаг 1. Supabase.**
Два проекта: `dizzit-prod` и `dizzit-staging`, **один регион с Railway**.
Расширения: `uuid-ossp`, `pgcrypto`, `pg_stat_statements`. `vector` — только
когда появится поиск по эмбеддингам, не заранее.
**Сразу включить автовключение RLS для новых таблиц** — это одна кнопка на
странице Database → Tables, и позже её будет мучительно догонять.
Переменные: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_KEY`,
`SUPABASE_SERVICE_KEY`, `SUPABASE_JWT_SECRET`.

**Шаг 2. Миграции.**
Аналог Alembic (для TypeScript — Drizzle или Prisma Migrate), запуск в
pre-deploy. Первые таблицы: `users`, `jobs`, `job_attempts`, `artifacts`,
`ai_usage_log`, `ai_model_pricing`, `token_transactions`.
`ai_usage_log` и `token_transactions` — сразу в финальном виде из §4.

**Шаг 3. Хранилище.**
Бакеты `dizzit-public` и `dizzit-private`. На каждом — **лимит размера и
список MIME**. Доступ по S3-протоколу, чтобы позже можно было уйти на R2 без
правок кода. Ретеншен и orphan-аудит закладывать сразу: без них через полгода
в бакете лежит гигабайт файлов, на которые никто не ссылается.

**Шаг 4. Auth.**
Supabase Auth, только Email. Подтверждение почты включить.

**Шаг 5. Redis.**
Один инстанс, **две переменные**: `REDIS_URL` (кэш, лимитеры, лизы) и
`QUEUE_REDIS_URL` (транспорт). Разные префиксы ключей.

**Шаг 6. Railway: три сервиса.**
Один репозиторий, один Dockerfile, `PROCESS_ROLE` ∈ `web` | `worker` |
`scheduler`. Регион — тот же, что у Supabase. Приватная сеть для внутренних
вызовов, публичный домен только у `web`.

**Шаг 7. Первый провайдер.**
OpenRouter: `OPENROUTER_API_KEY` + модель на роль. Вместе с ним — и не позже —
`ai_usage_log`, `ai_model_pricing` и потолок расходов. Заглушка
(`AI_PROVIDER_MODE=fake`) должна работать с первого дня.

**Шаг 8. Дешёвые шлюзы и Meshy.**
`LAOZHANG_API_KEY`, `KIE_API_KEY`, `APIMODELS_API_KEY`, `MESHY_API_KEY` —
каждый со своим потолком параллелизма и trust-уровнем. Вебхуки Meshy — с
проверкой подписи с первого дня.

**Шаг 9. Наблюдаемость.**
`SENTRY_DSN` — сразу. OTel — когда появится вторая роль. PostHog — когда
появятся пользователи.

**Шаг 10. Биллинг.**
Только если генерации станут платными. Сага целиком или не начинать.

## 10. Ключи провайдеров: заводить новые, а не переиспользовать

У UpSound уже есть рабочие ключи OpenRouter, Laozhang, Kie.ai и API Models.
Соблазн подставить их в Dizzit понятен, но:

- **общий потолок расходов.** Утечка или скачок в Dizzit бьёт по бюджету
  UpSound, и наоборот;
- **общий rate limit** провайдера: два сервиса начинают отбирать квоту друг
  у друга, и отладка выглядит как случайные отказы;
- **не разделить учёт.** Расход по `ai_usage_log` перестаёт отвечать на
  вопрос «сколько стоит Dizzit»;
- **ротация становится общей.** Скомпрометированный ключ придётся менять в
  двух продуктах одновременно.

Отдельные ключи на продукт — и, как у UpSound с `KIE_COVER_API_KEY`, отдельные
ключи на дорогие функции внутри продукта.

## 11. Что осталось непроверенным

Честный список — чтобы никто не принял предположение за факт:

- **Настройки воркеров и `Scheduler`** (команда старта, реплики, регион)
  открывались только у `API Backend`. Значения `PROCESS_ROLE` у каждого
  сервиса не смотрелись — роли в §1 выведены из имён сервисов и списка
  переменных.
- **Значения переменных** не раскрывались намеренно. Какой именно транспорт
  выбран у каждой очереди (`redis` или `rabbitmq`), из снимка не видно.
- **Содержимое `railway.json`** (pre-deploy и start command) — консоль
  показывает только «задано в файле».
- **Колонки 10–14 `ai_model_pricing` и 5–7 `token_transactions`** не попали
  в выборку.
- **Расписание бэкапов, Replication, миграции** в Supabase не открывались.
- **Метрики и логи** сервисов не смотрелись: нагрузка, расход, частота
  ошибок остались за кадром.

Всё это добирается за один заход, если понадобится.
