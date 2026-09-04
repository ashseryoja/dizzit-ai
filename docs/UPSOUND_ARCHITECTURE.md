# Архитектура UpSound AI — что воссоздавать под Dizzit AI

Документ описывает продакшн-архитектуру UpSound AI (репозитории `upsound_ai` —
backend, `upsound_frontend` — frontend) настолько подробно, чтобы её можно было
воспроизвести на **новых аккаунтах сервисов**: очереди, воркеры, генерации,
биллинг, хранилище, наблюдаемость.

Всё, что ниже, — снято с кода на 09.08.2026, а не пересказано по памяти. Пути к
файлам даны, чтобы можно было открыть оригинал и свериться.

Соответствие доменов: там, где у UpSound «генерация обложки / питчинга / рилс»,
у Сметы AI — «расчёт сметы по чату и приложенным макетам». Механика одна:
**долгая AI-операция, за которую списываются токены, выполняется вне HTTP-запроса.**

---

## 1. Топология процессов

Один и тот же образ и репозиторий разворачиваются несколькими сервисами. Роль
выбирается переменной `PROCESS_ROLE`, диспетчер — `runners/railway.py`.

| Роль | Что делает | Ключевой env |
| --- | --- | --- |
| `web` | Только FastAPI HTTP API. Воркеров, шедулера и Telegram-поллинга не поднимает | — |
| `redis_queue_worker` | Один воркер = одна очередь Redis/arq | `QUEUE_WORKER_QUEUE_NAME` |
| `rabbitmq_publisher` | Публикует PG-outbox в RabbitMQ | `QUEUE_RABBITMQ_URL` |
| `rabbitmq_queue_worker` | Один воркер = одна очередь RabbitMQ | `QUEUE_WORKER_QUEUE_NAME`, `QUEUE_RABBITMQ_URL` |
| `scheduler` | APScheduler: продления подписок, синк цен, уборка, мониторинг | `REDIS_URL` |
| `telegram` | Поллинг бота и тех-алертов | `TELEGRAM_POLLING_ENABLED=true` |

Правила, которые дались опытом (`docs/runtime-roles.md`):

- **Один воркер — одна очередь.** Не «универсальный воркер на все очереди»:
  тяжёлая генерация иначе забивает слоты лёгким операциям.
- **Шедулеру нужен общий `REDIS_URL`**, а не `QUEUE_REDIS_URL` — это разные
  вещи. Без него шедулер **всё равно стартует**, и отказ получается тихим:
  продления подписок просто не выполняются.
- **Денежные джобы fail-closed.** `process_subscriptions` зарегистрирован с
  `fail_open=False`: при недоступном Redis он НЕ выполняется — лучше пропустить
  день продлений, чем рискнуть двойным списанием. Остальные maintenance-джобы
  fail-open.
- **Лимитер LLM нужен каждой роли, которая может звать модель** — включая
  `telegram` (обработчики бота зовут модель напрямую). Роль без общего
  `REDIS_URL` начинает отбивать пользовательские AI-вызовы; роль с ДРУГИМИ
  лимитами ломает глобальный потолок.

**Для Сметы AI минимальный набор:** `web` + один `queue_worker` (разбор макетов
и расчёт) + `scheduler` (уборка, ретеншен файлов). Telegram-роль не нужна.

---

## 2. Очереди: контракт задач

Каноническая спецификация — `docs/task_queue/job-contract-v1.md`, реализация —
пакет `services/task_queue/` (~70 модулей). Ключевые решения:

- **Redis + arq** — основной транспорт; RabbitMQ (aio-pika) добавлен вторым
  и выбирается **на каждую очередь** через `QUEUE_<DOMAIN>_BROKER`
  (`redis` | `rabbitmq`) с фолбэком `QUEUE_BROKER_DEFAULT`.
- **Доставка at-least-once**, не exactly-once. Это принято явно: защита — не
  «не доставить дважды», а идемпотентность и fencing на стороне эффекта.
- **Имена очередей версионированы**: `cover_generation:v1`, `song_studio:v1`,
  `artist_analysis:v1`, `neuro_photoshoot:v1`, `reels_storyboard:v1`,
  `release_generation:v1`, `audio_processing:v1`, `studio_audio:v1`,
  `artist_brand:v1`, `broadcast:v1`, `resize_cut:v1`, `yandex_ingestion:v1`.
  `schema_version` в конверте обязателен.
- **Redis — транспорт и оперативное состояние. PostgreSQL — durable-состояние**:
  биллинг, аудит, ссылки на провайдера, терминальное бизнес-состояние,
  финальный пользовательский результат. Объектное хранилище — бинарники.
- **Сбой enqueue в Redis НЕ падает молча в PostgreSQL-очередь.** Тихий фолбэк
  запрещён контрактом: иначе задача уходит в путь, за которым никто не следит.
- В Redis **не кладут** бинарные данные, креды, сырые ответы провайдера и
  большие payload'ы.

### Жизненный цикл статуса

Внутренних состояний двенадцать (`services/task_queue/status_models.py`):

```
accepted → reserved → enqueue_pending → queued → running → finalizing → completed
                                          ↓         ↓  ↘
                                   cancel_requested  retry_scheduled → queued
                                          ↓         ↓
                                     cancelled    failed / expired
```

Разрешённые переходы заданы таблицей в `status_transitions.py`; **терминальные
состояния неизменяемы** (`completed`, `failed`, `cancelled`, `expired`) —
попытка перехода из них бросает `StatusTerminalImmutableError`.

Наружу отдаётся **проекция из пяти** статусов: `queued`, `running`, `completed`,
`failed`, `cancelled`. Внутренняя кухня (`reserved`, `finalizing`,
`retry_scheduled`) во фронтенд не течёт.

### Идентичность

Четыре разных идентификатора, которые нельзя путать:

| Поле | Что это |
| --- | --- |
| `operation_id` | Бизнес-операция. К ней привязан биллинг |
| `job_id` | Единица очереди. Непрозрачный, не является бизнес-идемпотентностью |
| `entity_id` | Доменная сущность (релиз, артист, — у нас: расчёт/чат) |
| `idempotency_key` | Обязателен при enqueue, скоупится юзером и видом операции |

Плюс `attempt_number` и `attempt_id` — **fencing-токен попытки**. Обычный
`attempt_count` для этого не годится: он счётчик, а не токен.

Родительские и дочерние задачи: один `operation_id`, свой `job_id` на каждую
единицу очереди, `parent_job_id` и стабильный `child_key` (так устроена
нейрофотосессия: родительская задача + слоты).

### Ошибки наружу

В публичный статус идут только `error.code`, `category`, `public_message_code`
и непрозрачный `diagnostic_reference`. **Сырой текст исключения или ответа
провайдера наружу не отдаётся никогда** — это и утечка, и мусор в интерфейсе.

---

## 3. Admission control: как не положить систему

`services/task_queue/admission.py` + `heavy_job_admission.py`. До постановки в
очередь проверяется, можно ли вообще принять работу:

- `QUEUE_GLOBAL_MAX_DEPTH`, `QUEUE_PER_QUEUE_MAX_DEPTH` — глубина очередей;
- `QUEUE_PER_USER_OUTSTANDING_LIMIT` — сколько задач у одного пользователя в полёте;
- `QUEUE_ADMISSION_MAX_ESTIMATED_WAIT_SECONDS`, `..._MAX_OLDEST_WAIT_SECONDS` —
  прогноз ожидания (EWMA по фактическим временам, `QUEUE_ADMISSION_ETA_EWMA_ALPHA`);
- при отказе — `AdmissionRejectedError` с `retry_after`, который **виден
  пользователю** («очередь занята, попробуйте через N секунд»), а не 500-ка.

Отдельно — потолки на **параллельные вызовы провайдера**, а не только на
очередь: `IMAGE_GENERATION_MAX_ACTIVE_PROVIDER_CALLS_GLOBAL`,
`TEXT_LLM_<PROVIDER>_MAX_ACTIVE_GLOBAL` (Gemini / OpenRouter / Qwen / xAI),
`NEURO_PHOTOSHOOT_MAX_ACTIVE_PROVIDER_CALLS_GLOBAL`. Реализованы Redis-лизами
(`redis_lease.py`, `distributed_capacity.py`) с TTL и политикой на случай
недоступного Redis (`*_REDIS_FAIL_POLICY`) — **в проде fail-closed**.

**Зачем это Смете AI:** разбор PDF/чертежа через vision-модель — это тот же
дорогой вызов с лимитом по параллелизму. Без потолка десять одновременных
загрузок съедают всю квоту провайдера.

---

## 4. Биллинг: сага reserve → enqueue → commit

`docs/task_queue/billing-saga-v1.md`, `services/task_queue/billing_saga.py`,
`services/site_token_billing.py`.

Проблема, которую она решает: **деньги списываются за работу, которая может не
выполниться, выполниться дважды или зависнуть.**

Порядок:

1. **Reserve** — резерв токенов до постановки в очередь. Durable, в PostgreSQL.
2. **Enqueue-confirm** — подтверждение резерва после успешной постановки.
   Если результат enqueue **неопределённый** (таймаут, обрыв) — резерв
   НЕ освобождается: неизвестно, ушла задача или нет.
3. **Authorize** — воркер перед выполнением авторизуется против того же
   резерва. Ретрай использует **тот же** резерв, а не создаёт новый.
4. **Commit** — списание по факту успеха, идемпотентное по `external_id`.
5. **Release / Refund** — компенсация при отказе, тоже идемпотентная.
6. **Manual review** — терминальное состояние для случаев, которые
   автоматика разрешить не может.
7. **Replay gate** — блокировка повторного проигрывания уже завершённой операции.
8. **Reconciliation** — обязательный сверочный проход
   (`billing_reconciliation.py`, `billing_reservation_reaper.py`).

Хранилища: баланс — на `subscriptions` (+ зеркало в `users.tokens_balance`),
история — `site_token_transactions` с уникальным `external_id`. Второй таблицы
баланса сага не заводит. Разграничение зон — `docs/adr/token-ledger-ownership.md`.

Наименьшая единица — **1 токен, целое число**. Никаких дробей.

---

## 5. Ретраи, DLQ, реконсиляция

- `retry_policy.py` / `retry_coordinator.py` — политика повторов, `QUEUE_WORKER_MAX_TRIES`.
- `dlq.py`, `postgres_dlq_store.py`, `dlq_ingester.py` — dead-letter в PostgreSQL,
  а не в Redis: разбор упавших задач должен переживать перезапуск Redis.
- `execution_guard.py`, `finalization_guard.py`, `idempotency.py` — durable-гарды:
  при at-least-once доставке именно они не дают эффекту примениться дважды.
- `claim_heartbeat.py` — воркер держит heartbeat на взятой задаче; пропал —
  задачу подберут заново.
- **Reaper'ы** (отдельные джобы шедулера) добирают то, что провалилось между
  стульями: `abandoned_enqueue_reaper.py`, `cover_job_reaper.py`,
  `billing_reservation_reaper.py`, `creation_flows_reaper.py`,
  `ai_price_fetch_run_reaper.py`, `operation_state_reconciler.py`.

Без reaper'ов система выглядит рабочей, но копит зависшие операции: задача
«застряла в running» не чинится сама.

---

## 6. Живой прогресс: SSE + polling

Долгая генерация показывается пользователю двумя способами.

**SSE-стримы** — на каждый домен свой сервис: `artist_analysis_live_stream.py`,
`pitching_live_stream.py`, `promotion_plan_live_stream.py`,
`reels_live_stream.py`, `studio_lyrics_live_stream.py`,
`single_attempt_live_stream.py`. Кадрирование — `sse_stream_framing.py`.
Включаются флагами `*_LIVE_STREAMING_ENABLED` с частотой `*_EMIT_INTERVAL_MS`.

**Redis pub/sub** — `job_events:{queue}:{entity_id}`, статус —
`job_status:{queue}:{job_id}` с TTL (`services/redis_status.py`).

**Фронтенд** — `src/components/generation-center.tsx`: единый центр задач,
React Query поверх polling, индикаторы в сайдбаре
(`hooks/use-sidebar-generation-indicators.ts`) — спиннер активной генерации и
точка непросмотренного результата. Ключевая деталь: `usePauseWhenHidden` —
polling останавливается в скрытой вкладке.

**Для Сметы AI:** «ИИ думает» в чате — это ровно тот же паттерн. Пока разбор
идёт на сервере, статус приходит по SSE; ответ дописывается в сообщение.

---

## 7. Хранилище файлов

Три провайдера, выбор через `STORAGE_PROVIDER`:

- **Supabase Storage** — публичный и приватный бакеты
  (`SUPABASE_STORAGE_PUBLIC_BUCKET`, `..._PRIVATE_BUCKET`), доступ по S3-протоколу
  (`SUPABASE_STORAGE_S3_ENDPOINT`, ключи, регион) — `supabase_s3_storage.py`.
- **Cloudflare R2** — `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, ключи, `R2_PUBLIC_URL`
  (`r2_storage.py`).
- Локальный — для разработки.

Вокруг хранилища выстроена дисциплина, которой обычно не занимаются, пока не
станет больно:

- `storage_reference_registration.py` — регистрация ссылок на объекты;
- `storage_orphan_audit.py`, `storage_orphan_references.py` — поиск осиротевших
  файлов и висящих ссылок;
- `storage_retention_policy.py` — ретеншен;
- `storage_integrity_monitor.py` — целостность;
- `storage_cleanup_dry_run.py` — уборка сначала «на сухую»;
- `asset_delivery.py`, `ranged_asset_cache.py` — раздача с Range-запросами;
- `relay_upload_store.py` — приём больших загрузок в обход основного роута.

**Для Сметы AI это прямо профильно:** пользователь грузит PDF, чертежи, фото.
Файл никогда не идёт в очередь целиком — в задачу кладётся `StorageReference`,
а сам файл лежит в бакете. Подписанные URL в payload и статус **не попадают**.

---

## 8. AI-провайдеры

Единый вход — `services/llm_gateway.py`, поверх него:

| Провайдер | Файл | Роль |
| --- | --- | --- |
| Google Gemini | `gemini.py`, `gemini_text_stream.py` | Основной текст, стриминг |
| OpenRouter | `openrouter.py`, `openrouter_image_service.py`, `openrouter_models.py` | Фолбэк текста, vision, картинки |
| Qwen | `qwen.py` | Отдельный бюджет «размышлений» (`QWEN_THINKING_BUDGET`) |
| xAI | `xai.py` | Дополнительный текстовый |
| FAL / KIE / Laozhang / Evolink | env-ключи | Генерация изображений и медиа |

Обвязка, без которой это не живёт в проде:

- `llm_provider_errors.py` — таксономия ошибок провайдера;
- `ai_provider_health_watchdog.py` — здоровье провайдера;
- `ai_fallback_alerts.py` — алерты при уходе на фолбэк;
- `ai_spend_watchdog.py` — сторож расходов;
- `ai_usage_recorder.py` / `ai_usage_service.py` / `ai_usage_tracker.py` —
  учёт токенов и стоимости по каждому вызову;
- `generation_pricing_service.py` + `config_pricing/` — **цены генераций
  считаются из фактической стоимости провайдера**, а не проставляются руками;
  ежедневный синк (`GENERATION_PRICING_DAILY_SYNC_ENABLED`), алерты на скачок
  (`PRICING_ALERT_THRESHOLD_PERCENT`), курсы валют (`FX_SOURCE`,
  `OPENEXCHANGERATES_API_KEY`);
- `fake_ai_provider.py` / `services/fake_ai/` — детерминированная заглушка для
  тестов и локальной разработки без ключей;
- `ai_debug_storage.py` + `STORE_AI_DEBUG_PAYLOADS` — сохранение payload'ов для
  разбора, с политикой ретеншена (`docs/AI_DEBUG_PAYLOAD_RETENTION_POLICY.md`).

**Для Сметы AI:** тот же слой, только модели другие — vision для чертежей и
фото, текстовая для сборки позиций. Учёт стоимости обязателен с первого дня:
разбор одного PDF на 40 листов стоит заметных денег.

---

## 9. Данные

- **PostgreSQL** (Supabase) — источник правды. SQLAlchemy 2.x async + asyncpg,
  миграции Alembic (`alembic/`), pgvector для эмбеддингов.
- Пул и таймауты: `DATABASE_POOL_SIZE`, `DATABASE_MAX_OVERFLOW`,
  `DATABASE_STARTUP_TIMEOUT_SEC`, `DATABASE_HEALTHCHECK_TIMEOUT_SEC`.
- Миграции на деплое: `preDeployCommand: python scripts/run_alembic_upgrade.py`;
  стартовые миграции — только для роли `web` и только при
  `RUN_DB_MIGRATIONS_ON_STARTUP=true`.
- Мониторинг: `postgres_monitoring.py`, `postgres_pgss_measurement.py`,
  `database_outage_reporter.py`, `docs/POSTGRES_MONITORING.md`.
- **Redis** — две разные вещи, которые нельзя смешивать:
  `QUEUE_REDIS_URL` (транспорт очередей) и `REDIS_URL` (общий кэш, лимитеры,
  локи шедулера, admission). `QUEUE_REDIS_URL` **не заменяет** `REDIS_URL`.
- **RabbitMQ** — второй транспорт, `QUEUE_RABBITMQ_URL`, топология в
  `rabbitmq_topology.py`, публикация из PG-outbox.

---

## 10. Авторизация

- **Supabase Auth** — email/пароль, magic links. `SUPABASE_URL`, `SUPABASE_KEY`,
  `SUPABASE_JWT_SECRET`.
- Фронтенд шлёт Supabase JWT; `src/lib/api-client.ts` кэширует токен в памяти с
  проверкой expiry, на 401 сам делает `refreshSession()`, флаг `isRefreshing`
  снимает гонку параллельных обновлений.
- Backend валидирует JWT (`services/auth.py`), кэширует identity в Redis
  (`auth_identity_cache.py`, `auth_user_cache.py`).
- Роли: `admin`, `owner`, `employee`; проверки — `employee_access.py`,
  `admin_access_cache.py`.
- Согласия пользователя — `consent_service.py` + гейт на фронтенде.

---

## 11. Платежи

Четыре провайдера, переключаются через `PAYMENT_PRIMARY_PROVIDER` /
`PAYMENT_FALLBACK_PROVIDER`: **Т-Банк** (`tbank_api.py`), **Альфа**
(`alfa_api.py`, `alfa_webhooks.py`), **Точка** (`tochka_api.py`), **PayKeeper**.

Что важнее самих интеграций:

- **Подпись вебхуков обязательна** (`ALFA_CALLBACK_REQUIRE_SIGNATURE`,
  RSA-ключ; `TOCHKA_WEBHOOK_PUBLIC_KEY_JSON`). Разрешение неподписанных
  колбэков существует только как явный локальный флаг.
- `payment_reconciliation.py` — сверка платежей;
- `payment_events.py`, `payment_analytics.py`, `payment_support.py` — события,
  аналитика, поддержка;
- `promo_codes.py`, `subscription.py` — промокоды и подписки.

---

## 12. Наблюдаемость

- **Sentry** — `SENTRY_DSN`, окружение, релиз, сэмплирование трейсов и профилей.
- **OpenTelemetry** — OTLP-экспорт трейсов и логов, инструментирование FastAPI,
  httpx и SQLAlchemy.
- **Prometheus** — `prometheus-client`, `BACKEND_APP_METRICS_ENABLED`,
  `BACKEND_METRICS_TOKEN`.
- **PostHog** — продуктовая аналитика (`product_analytics.py`) и LLM-события
  (`posthog_llm.py`).
- Очереди: `queue_observability.py`, `observability_models.py`,
  `docs/task_queue/observability-v1.md`.
- Алерты в Telegram — отдельный тех-бот (`TELEGRAM_TECH_BOT_TOKEN`).

---

## 13. Фронтенд

Next.js 15 (App Router) + TypeScript strict, React Query (серверное состояние),
Zustand с persist (клиентское), Tailwind + shadcn/ui, Playwright для E2E.

Паттерны, которые стоит перенести:

1. **Весь API — в `services/`**, никаких прямых `axios` из компонентов.
   Пути — константы `API_ENDPOINTS`, не строки по месту.
2. **Логика — в хуках**, компонент рендерит. Размер компонента — 100–150 строк.
3. **Таймаут 120 секунд** на клиенте для AI-операций.
4. **Graceful fallback**: сетевой сбой ревалидации ≠ разлогин. При валидной
   сессии в кэше кабинет остаётся смонтированным, а не гасится заглушкой на
   первом же сетевом чихе.
5. `/content/{type}` возвращает **массив** — берётся `data[0]`. Мелочь, на
   которой спотыкаются регулярно.
6. При logout — чистить и кэш токена (`clearTokenCache()`), и localStorage
   Zustand-сторов вручную.

### Девять вопросов перед кодом

`docs/DESIGN_CHECKLIST.md` — обязательны к ответу на любое изменение:

повтор · одновременность · деньги · видимость состояния · задачи в полёте ·
неизвестный исход · след решения · выход и отмена · пределы

Замер по 875 блокирующим замечаниям ревью: **59% попадали хотя бы в один из
первых четырёх классов.** Это не бюрократия, а список того, что ломается чаще
всего.

---

## 14. Порядок восстановления на новых аккаунтах

Что заводить и в каком порядке — от несущего к необязательному.

**Шаг 1. База и авторизация.**
Supabase-проект → `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_KEY`,
`SUPABASE_JWT_SECRET`. Alembic-миграции в `preDeployCommand`.

**Шаг 2. Хранилище.**
Бакеты Supabase Storage (публичный + приватный) или R2. Сразу заложить
`storage_reference_registration` и ретеншен: без них через полгода в бакете
лежит гигабайт файлов, на которые никто не ссылается.

**Шаг 3. Redis.**
ДВА URL: `REDIS_URL` (кэш, лимитеры, локи) и `QUEUE_REDIS_URL` (транспорт).
Можно один инстанс с разными префиксами (`QUEUE_REDIS_PREFIX`), но переменные
разные — иначе перепутается на первом же инциденте.

**Шаг 4. Очереди и воркеры.**
Один сервис Railway на роль. Первая очередь: `estimate_generation:v1`.
`QUEUE_WORKER_QUEUE_NAME=estimate_generation:v1`,
`QUEUE_ESTIMATE_GENERATION_REDIS_FIRST_ENABLED=true`.

**Шаг 5. AI-провайдер.**
Ключ (Gemini / OpenRouter / любой OpenAI-совместимый) + учёт стоимости с
первого дня. Заглушка `fake_ai` для тестов — сразу, не потом.

**Шаг 6. Биллинг.** Нужен, только если расчёты платные. Сага целиком — резерв,
подтверждение, коммит, компенсация, сверка. Половина саги хуже, чем её
отсутствие: получится «списали и не сделали» без следа.

**Шаг 7. Наблюдаемость.** Sentry — сразу. OTel и Prometheus — когда появится
вторая роль. PostHog — когда появятся пользователи.

**Шаг 8. Платежи.** Последними. Подпись вебхуков — с первого дня, не «потом».

---

## 15. Что переносится в Смету AI напрямую

| Механизм UpSound | Аналог в Смете AI |
| --- | --- |
| Очередь `cover_generation:v1` | `estimate_generation:v1` — разбор макетов и сборка сметы |
| Родительская задача + слоты (нейрофотосессия) | Один расчёт + задача на страницу/лист чертежа |
| `admission` по глубине очереди и лимиту на пользователя | То же: загрузка 40-страничного PDF не должна съедать всю квоту |
| Потолок параллельных вызовов провайдера | Vision-разбор чертежей — самый дорогой вызов |
| Биллинг-сага reserve → commit | Если расчёт платный |
| SSE + generation-center | «ИИ думает» в чате, прогресс по страницам |
| `StorageReference` вместо файла в payload | PDF и чертежи в бакете, в очередь — ссылка |
| Ретеншен и orphan-аудит хранилища | Профильно: пользователи грузят тяжёлые файлы |
| `fake_ai` провайдер | Локальная разработка без ключей (сейчас — `estimate-engine.ts`) |
| Учёт стоимости генераций | Разбор одного проекта = заметные деньги |

---

## 16. Ошибки, которых стоит избежать

Собрано из решений и инцидентов, зафиксированных в документации UpSound.

1. **Тихий фолбэк.** Если Redis-enqueue не удался — не перекладывать задачу в
   другой путь молча. Отказ должен быть виден.
2. **Один URL Redis на всё.** `REDIS_URL` и `QUEUE_REDIS_URL` разведены не от
   любви к переменным: лимитер LLM и транспорт очередей масштабируются
   по-разному и падают по-разному.
3. **Универсальный воркер.** Тяжёлая генерация вытесняет лёгкие операции.
4. **Fail-open на деньгах.** Для денежных джобов — только fail-closed.
5. **Сырые ошибки провайдера наружу.** Утечка и мусор в интерфейсе.
6. **Файлы в payload очереди.** Только ссылки.
7. **`attempt_count` как fencing-токен.** Это счётчик. Нужен `attempt_id`.
8. **Отсутствие reaper'ов.** Система выглядит рабочей и копит зависшие операции.
9. **Половина биллинг-саги.** Резерв без компенсации = «списали и не сделали».
10. **Неверсионированные очереди.** Раскатка меняющегося формата задачи без
    версии в имени очереди ломает задачи, уже лежащие в ней.

---

## 17. Где смотреть оригинал

| Тема | Файл |
| --- | --- |
| Контракт задач | `upsound_ai/docs/task_queue/job-contract-v1.md` |
| Биллинг-сага | `upsound_ai/docs/task_queue/billing-saga-v1.md` |
| Роли процессов | `upsound_ai/docs/runtime-roles.md` |
| Наблюдаемость очередей | `upsound_ai/docs/task_queue/observability-v1.md` |
| Переход на RabbitMQ | `upsound_ai/docs/task_queue/rabbitmq-cutover-runbook.md` |
| Откат Redis-first | `upsound_ai/docs/task_queue/redis-first-rollback-runbook.md` |
| Деплой на Railway | `upsound_ai/docs/RAILWAY_DEPLOYMENT_GUIDE.md` |
| Настройка Supabase | `upsound_ai/docs/SUPABASE_SETUP_GUIDE.md` |
| Хранилище | `upsound_ai/docs/supabase-storage-setup.md`, `storage_retention_policy.md` |
| Модели LLM | `upsound_ai/docs/LLM_MODELS.md` |
| Мониторинг стоимости | `upsound_ai/docs/COST_MONITORING.md` |
| Чек-лист перед кодом | `upsound_frontend/docs/DESIGN_CHECKLIST.md` |
| Правила ревью | `upsound_frontend/docs/REVIEW_RUBRIC.md` |
| Полный список env | `upsound_ai/.env.example` (~80 КБ, с комментариями) |
