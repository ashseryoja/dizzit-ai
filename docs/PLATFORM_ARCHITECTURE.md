# Архитектура платформы Dizzit AI

Как устроен серверный слой сервиса: провайдеры ИИ, ключи, очередь, хранилище,
безопасность. Документ — **проектное решение до кода**: по нему строится
`src/server/`, и он же служит критерием ревью («так задумано» / «не так»).

Два родственных документа. [`UPSOUND_ARCHITECTURE.md`](UPSOUND_ARCHITECTURE.md) —
продакшн-архитектура **кода** UpSound AI, снятая с рабочего репозитория; здесь
она **не пересказывается**, а сжимается до размера Dizzit: те же принципы,
меньше машинерии. Ссылки вида «правило №N» — на её раздел 16 «Ошибки, которых
стоит избежать». [`UPSOUND_INFRA_REPLICATION.md`](UPSOUND_INFRA_REPLICATION.md) —
снимок того, что реально **развёрнуто** у UpSound в Railway и Supabase, с
разбором «копируем / упрощаем / делаем иначе» и порядком заведения
инфраструктуры.

Принятые решения (зафиксированы, не обсуждаются заново без причины):

| Решение | Выбор |
| --- | --- |
| Рантайм | Один образ Docker, роль процесса — `PROCESS_ROLE` (`web` / `worker` / `scheduler`) |
| Язык сервера | TypeScript, тот же репозиторий |
| Доступ | Авторизация + квоты **с первого дня** |
| Провайдеры | OpenRouter, Laozhang, Kie.ai, API Models (картинки), Meshy.ai (3D из фото) |

**Что уже есть в коде (сентябрь 2026).** Провайдеры картинок подключены
раньше каркаса из §2 — тонким прокси `src/app/api/images/route.ts` →
`src/server/providers.ts` (выбор по окружению, прообраз `container.ts`) →
адаптеры за общим интерфейсом `ImageProvider` (`src/server/image-provider.ts`):
`apimodels.ts` — API Models, `gpt-image-2`, асинхронная задача с опросом
(прообраз `RemoteTaskProvider`, §4.3, пока без вебхука) и `laozhang.ts` —
LaoZhang, OpenAI-совместимый синхронный вызов (прообраз
`OpenAiCompatibleProvider`). Клиентский вход — `src/lib/image-generation.ts`;
промпты собирают движки инструментов на клиенте, без ключа они же считают
локальный canvas-предпросмотр (будущий `FakeProvider`, §4.4). Есть дверь входа
(`middleware.ts`, пароль рабочего пространства — прообраз `AuthGuard`, §5),
Postgres (`server/db.ts`, `records.ts` — таблицы `records`/`assets`) и порт
`ObjectStorage` с R2 и диском (`server/storage.ts`, §3.4). Клиент держит
IndexedDB как кэш и синхронизирует сторы (`lib/server-sync.ts`, §8). Квот,
учёта расходов, очереди и остальных гейтов §5 пока нет — запрос к провайдеру
держится открытым до `maxDuration`.

---

## 0. Три инварианта, из которых следует всё остальное

1. **Ключ провайдера физически не может оказаться в браузере.** Не «мы
   аккуратные», а ошибка сборки и проверка в CI (§6.1).
2. **Ключ не может быть потрачен чужим и не может быть потрачен бесконечно.**
   Между HTTP-запросом и провайдером стоит цепочка гейтов, и потолок расходов
   существует раньше, чем первый ключ (§5, §6.2).
3. **Домен не знает, кто его исполняет.** Провайдер, база, очередь, хранилище —
   сменяемые детали за интерфейсами. Замена провайдера или переезд с
   in-memory на Postgres — правка одного файла `container.ts`, а не сорока.

---

## 1. Топология процессов

Один образ, одна кодовая база, роль выбирается переменной окружения —
ровно паттерн UpSound (`PROCESS_ROLE`), только ролей три, а не шесть.

| Роль | Точка входа | Что делает |
| --- | --- | --- |
| `web` | `next start` | HTTP: UI + контроллеры `/api/v1/**`. Провайдеров **не зовёт** (кроме синхронных на этапе 1) |
| `worker` | `node dist/worker.js` | Потребитель очереди. **Один воркер — одна очередь** (правило №3) |
| `scheduler` | `node dist/scheduler.js` | Reaper'ы, ретеншен файлов, сверка расходов, синк цен |

Инфраструктура:

- **PostgreSQL** — durable-состояние: пользователи, задачи, артефакты, учёт
  расходов, квоты. Источник правды.
- **Redis, ДВА URL** — `REDIS_URL` (кэш, лимитеры, лизы параллелизма, локи
  шедулера) и `QUEUE_REDIS_URL` (транспорт очередей). Разведены намеренно
  (правило №2): падают и масштабируются они по-разному.
- **S3/R2** — бинарники. В очередь и в статус попадает `StorageReference`,
  никогда сам файл (правило №6) и никогда подписанный URL.

Пока нет воркера (этап 1) роль `worker` не поднимается, а очередь — `InlineQueue`,
выполняющая задачу в том же процессе. Это допустимо только до первого настоящего
платного провайдера с временем ответа больше 20 секунд.

---

## 2. Структура каталогов

```
src/
├── app/
│   ├── (main)/…                     существующий клиентский UI, без изменений
│   └── api/v1/
│       ├── jobs/route.ts            POST  создать задачу
│       ├── jobs/[id]/route.ts       GET   статус · DELETE отменить
│       ├── jobs/[id]/events/route.ts GET  SSE-прогресс
│       ├── uploads/route.ts         POST  приём файла → StorageReference
│       ├── assets/[id]/route.ts     GET   подписанная ссылка на результат
│       └── webhooks/[provider]/route.ts  POST колбэки провайдеров
│
├── shared/                          ИЗОМОРФНО. Никаких секретов, никакого I/O
│   ├── contracts/                   zod-схемы запроса/ответа = ЕДИНСТВЕННЫЙ источник DTO-типов
│   └── domain/                      публичные enum'ы: PublicJobStatus, JobKind, коды ошибок
│
├── server/                          ТОЛЬКО СЕРВЕР. `import "server-only"` в каждом barrel
│   ├── config/
│   │   ├── server-config.ts         class ServerConfig — единственное место, где читается process.env
│   │   └── secret.ts                class Secret — строка, которая не печатается в лог
│   │
│   ├── core/                        ДОМЕН. Чистый TS: без сети, без БД, без next/*
│   │   ├── job/
│   │   │   ├── job.ts               class Job — сущность, охраняющая свои инварианты
│   │   │   ├── job-status.ts        машина состояний + проекция наружу
│   │   │   ├── job-attempt.ts       попытка с fencing-токеном attemptId
│   │   │   └── specs/               EnhanceSpec · MaterialSpec · Photo3DSpec — по классу на инструмент
│   │   ├── errors/                  иерархия AppError
│   │   ├── pricing/                 таблица цен, оценка стоимости ДО запуска
│   │   └── ports/                   ИНТЕРФЕЙСЫ: то, что домен требует от мира
│   │
│   ├── application/                 USE CASES — оркестрация, без прямого I/O
│   │   ├── submit-job.use-case.ts
│   │   ├── run-job.use-case.ts      вызывается воркером
│   │   ├── get-job.use-case.ts
│   │   ├── cancel-job.use-case.ts
│   │   └── handle-provider-webhook.use-case.ts
│   │
│   ├── providers/                   АДАПТЕРЫ ИИ — реализуют ports/generation-provider
│   │   ├── base/                    GenerationProvider · SyncGenerationProvider · RemoteTaskProvider
│   │   ├── openai-compatible/       ОДИН класс на OpenRouter / Laozhang / Kie.ai / API Models
│   │   ├── meshy/                   MeshyProvider — свой класс: другая механика и другой артефакт
│   │   ├── fake/                    FakeProvider — детерминированный, для тестов и локалки
│   │   └── routing/                 ProviderRegistry · ProviderRouter · политики выбора
│   │
│   ├── infrastructure/              АДАПТЕРЫ ИНФРЫ — реализуют остальные порты
│   │   ├── persistence/             postgres.job-repository.ts · memory.job-repository.ts
│   │   ├── queue/                   bullmq.queue.ts · inline.queue.ts
│   │   ├── storage/                 s3.storage.ts · local-disk.storage.ts
│   │   ├── ratelimit/               redis.rate-limiter.ts
│   │   ├── capacity/                redis.lease.ts — потолок параллельных вызовов провайдера
│   │   ├── usage/                   postgres.usage-recorder.ts
│   │   └── logging/                 pino.logger.ts с редакцией
│   │
│   ├── http/                        ОБВЯЗКА КОНТРОЛЛЕРА
│   │   ├── route-handler.ts         guard-цепочка → use case → JSON
│   │   ├── problem.ts               AppError → RFC 9457 problem+json
│   │   └── guards/                  Origin · Auth · Schema · RateLimit · Quota · SpendCap · Admission · Idempotency
│   │
│   └── container.ts                 КОМПОЗИЦИОННЫЙ КОРЕНЬ — единственный файл, где встречается `new`
│
└── worker/main.ts                   вторая точка входа: тот же container, роль worker
```

### Правило зависимостей

Стрелки смотрят **только внутрь**:

```
app/api ──▶ http ──▶ application ──▶ core ◀── providers
                                       ▲
                          infrastructure ┘
```

- `core` не импортирует ничего, кроме себя и `shared`. Ни `next`, ни `pg`, ни `fetch`.
- `providers` и `infrastructure` знают о `core` (реализуют его порты), но не друг о друге.
- `application` знает только порты, не реализации.
- `container.ts` знает всех — за это и отвечает.

Проверяется не договорённостью, а линтером: `import/no-restricted-paths` с
зонами. Нарушение = красная сборка.

---

## 3. Домен

### 3.1 Job — сущность с машиной состояний

Внутренних статусов девять, наружу отдаётся проекция из пяти. Внутренняя кухня
(`reserved`, `finalizing`) во фронтенд не течёт — как в UpSound.

```
accepted → reserved → enqueued → running → finalizing → completed
                          ↓         ↓  ↘
                   cancel_requested  retry_scheduled → enqueued
                          ↓         ↓
                     cancelled   failed / expired
```

```ts
// server/core/job/job.ts
export class Job {
  private constructor(private props: JobProps) {}

  /** Единственный способ создать новую задачу. Статус — accepted. */
  static create(input: CreateJobInput): Job

  /** Восстановление из БД: без проверки переходов, состояние уже случилось. */
  static restore(row: JobRow): Job

  get id(): JobId
  get ownerId(): UserId
  get spec(): JobSpec
  /** Ровно то, что уходит клиенту. Ни поля больше. */
  get publicView(): JobPublicDto

  /** Кидает InvalidTransitionError / TerminalImmutableError. */
  transitionTo(next: JobStatus, at: Date): void
  beginAttempt(attemptId: AttemptId, at: Date): JobAttempt
  succeed(artifacts: readonly ArtifactRef[], usage: ProviderUsage, at: Date): void
  fail(error: AppError, at: Date): void
}
```

Ключевое: `Job` — **не структура с публичными полями**. Нельзя присвоить статус
мимо таблицы переходов; терминальные состояния неизменяемы. Репозиторий её
сохраняет и восстанавливает, но не решает за неё.

### 3.2 Четыре идентификатора, которые нельзя путать

| Поле | Что это |
| --- | --- |
| `jobId` | Единица очереди. Непрозрачный, **не** бизнес-идемпотентность |
| `operationId` | Бизнес-операция. К ней привязаны деньги |
| `idempotencyKey` | Обязателен при создании; скоупится пользователем и видом операции |
| `attemptId` | **Fencing-токен** попытки. Не `attemptCount` — тот счётчик (правило №7) |

### 3.3 JobSpec — сюда добавляется новый инструмент

```ts
export abstract class JobSpec {
  abstract readonly kind: JobKind          // "enhance" | "material" | "photo-to-mesh" | …
  abstract readonly capability: Capability
  abstract validate(): void
  /** Цена считается ДО запуска — иначе квоту не проверить. */
  abstract estimateCost(pricing: PricingTable): Cost
  /** Часть ключа идемпотентности: одинаковый вход → одинаковый seed. */
  abstract idempotencySeed(): string
}

export class EnhanceSpec  extends JobSpec { readonly kind = "enhance" … }
export class MaterialSpec extends JobSpec { readonly kind = "material" … }
export class Photo3DSpec  extends JobSpec { readonly kind = "photo-to-mesh" … }
```

### 3.4 Порты

`server/core/ports/` — только `interface` и `abstract class`, ни одной реализации.

```ts
export interface JobRepository {
  save(job: Job): Promise<void>
  findById(id: JobId): Promise<Job | null>
  findByIdempotencyKey(owner: UserId, key: string): Promise<Job | null>
  listByOwner(owner: UserId, page: Page): Promise<Job[]>
  claimStale(olderThan: Date, limit: number): Promise<Job[]>   // для reaper'а
}

export interface JobQueue      { enqueue(job: Job, opts: EnqueueOptions): Promise<QueueRef> }
export interface ObjectStorage { put(...): Promise<StorageReference>; signedUrl(...): Promise<string>; delete(...): Promise<void> }
export interface RateLimiter   { consume(key: string, cost: number): Promise<RateDecision> }
export interface CapacityLease { acquire(key: string, ttlMs: number): Promise<Lease | null> }
export interface UsageRecorder { record(call: ProviderCallRecord): Promise<void> }
export interface Clock         { now(): Date }
export interface IdGenerator   { next(): string }
export interface Logger        { child(b: Bindings): Logger; info(...): void; warn(...): void; error(...): void }
```

Тестирование бесплатно следует из этого: юнит-тесты подставляют `FakeClock`,
`InMemoryJobRepository`, `FakeProvider` — сети в тестах нет вовсе.

---

## 4. Провайдеры — иерархия классов

### 4.1 Порт

```ts
export type Capability =
  | "image.enhance"      // улучшение рендера
  | "image.generate"     // генерация картинки/текстуры
  | "mesh.from-image"    // Meshy: 3D-модель из фото
  | "text.completion"

/** Кому можно отдавать данные пользователя. Влияет на маршрутизацию. */
export type TrustLevel = "first-party" | "major-vendor" | "gateway"

export interface GenerationRequest {
  readonly spec: JobSpec
  /** ССЫЛКИ на объекты в хранилище, не файлы (правило №6). */
  readonly inputs: readonly StorageReference[]
  readonly idempotencyKey: string
}

export interface GenerationOutcome {
  readonly artifacts: readonly ProducedArtifact[]
  readonly usage: ProviderUsage      // единицы + фактическая стоимость
  readonly providerRef: string       // id задачи на стороне провайдера
}
```

### 4.2 Базовый класс — Template Method

Сквозные заботы принадлежат базе. Наследник **не может их забыть**, потому что
они не его.

```ts
export abstract class GenerationProvider {
  abstract readonly id: ProviderId
  abstract readonly capabilities: ReadonlySet<Capability>
  abstract readonly trust: TrustLevel
  abstract readonly pricing: ProviderPricing

  constructor(protected readonly deps: ProviderDeps) {}

  /** Публичный вход. Одинаков для ВСЕХ провайдеров. */
  async execute(req: GenerationRequest, ctx: CallContext): Promise<GenerationOutcome> {
    // 1. проверка capability
    // 2. circuit breaker открыт → ProviderUnavailableError сразу, без вызова
    // 3. лиз слота параллелизма (Redis, TTL) — потолок активных вызовов
    // 4. таймаут: AbortSignal + отмена задачи пользователем
    // 5. → this.invoke(req, ctx)
    // 6. нормализация ошибки: this.classify(raw) → таксономия ProviderError
    // 7. this.deps.usage.record(...) — учёт стоимости ОБЯЗАТЕЛЕН
    // 8. обновление состояния брейкера по исходу
  }

  /** Единственное, что пишет наследник: формат провода. */
  protected abstract invoke(req: GenerationRequest, ctx: CallContext): Promise<RawProviderResult>

  /** Ошибка провайдера → общая таксономия. */
  protected abstract classify(error: unknown): ProviderErrorKind
}
```

### 4.3 Две ветви по механике вызова

```ts
/** Ответ приходит в том же HTTP-запросе. OpenRouter, Laozhang, Kie.ai, API Models. */
export abstract class SyncGenerationProvider extends GenerationProvider {}

/** submit → taskId → poll или вебхук. Meshy, длинные режимы шлюзов. */
export abstract class RemoteTaskProvider extends GenerationProvider {
  protected abstract submit(req: GenerationRequest, ctx: CallContext): Promise<RemoteTaskHandle>
  protected abstract poll(handle: RemoteTaskHandle): Promise<RemoteTaskState>
  /** Проверка подписи колбэка — обязанность наследника, он знает формат. */
  abstract verifyWebhook(rawBody: Buffer, headers: Headers): WebhookVerification

  protected async invoke(req, ctx) { /* submit; затем poll с backoff ИЛИ ожидание вебхука */ }
}
```

### 4.4 Конкретные адаптеры

**Четыре шлюза — один класс.** OpenRouter, Laozhang, Kie.ai и API Models в
основном OpenAI-совместимы. Плодить четыре почти одинаковых класса — ошибка:
разница между ними это **данные**, а не поведение.

```ts
export interface GatewayProfile {
  readonly id: ProviderId
  readonly baseUrl: string
  readonly secretKey: keyof ProviderSecrets
  readonly trust: TrustLevel
  readonly models: Readonly<Record<Capability, ModelBinding>>
  readonly pricing: ProviderPricing
  readonly quirks: GatewayQuirks     // где расходится с эталонным OpenAI API
}

export class OpenAiCompatibleProvider extends SyncGenerationProvider {
  constructor(private readonly profile: GatewayProfile, deps: ProviderDeps) { super(deps) }
  get id() { return this.profile.id }
  get trust() { return this.profile.trust }
  protected async invoke(req, ctx) { /* один код на все четыре */ }
  protected classify(e: unknown) { /* + this.profile.quirks */ }
}
```

```ts
// server/providers/openai-compatible/profiles.ts — данные, не код
export const OPENROUTER: GatewayProfile = { id: "openrouter", trust: "major-vendor", … }
export const LAOZHANG:   GatewayProfile = { id: "laozhang",   trust: "gateway",      … }
export const KIE_AI:     GatewayProfile = { id: "kie-ai",     trust: "gateway",      … }
export const API_MODELS: GatewayProfile = { id: "api-models", trust: "gateway",      … }
```

**Новый дешёвый шлюз = один объект-профиль.** Новый провайдер с иной механикой
= новый класс.

**Meshy — отдельный класс**, потому что у него другая механика (task API),
другой артефакт (`.glb`/`.fbx`, не картинка) и своя таксономия ошибок:

```ts
export class MeshyProvider extends RemoteTaskProvider {
  readonly id = "meshy"
  readonly capabilities = new Set<Capability>(["mesh.from-image"])
  readonly trust: TrustLevel = "major-vendor"
  protected async submit(req, ctx): Promise<RemoteTaskHandle> { … }
  protected async poll(handle): Promise<RemoteTaskState> { … }
  verifyWebhook(raw, headers): WebhookVerification { … }
}
```

**FakeProvider** — детерминированная заглушка на все capability. Пишется
**первым**, не последним: локальная разработка и тесты не должны требовать
ключей и не должны стоить денег. Существующие canvas-движки
(`enhance-engine.ts`, `material-engine.ts`) переезжают внутрь него как
источник правдоподобного результата.

### 4.5 Выбор провайдера — Strategy

```ts
export class ProviderRouter {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly policy: RoutingPolicy,
    private readonly breakers: CircuitBreakerRegistry,
  ) {}

  /** Кандидаты под capability, отсортированные политикой, недоступные отсеяны. */
  resolve(capability: Capability, c: RoutingConstraints): ProviderPlan
}

export interface RoutingConstraints {
  /** Приватные данные не уходят на trust:"gateway". */
  readonly maxTrustDistance: TrustLevel
  readonly pinnedProvider?: ProviderId     // отладка и A/B
  readonly budgetCeiling?: Cost
}

export interface RoutingPolicy { rank(candidates: readonly GenerationProvider[], ctx: RoutingContext): readonly GenerationProvider[] }

export class CheapestFirstPolicy implements RoutingPolicy {}   // картинки: Kie/Laozhang дешевле OpenRouter
export class QualityFirstPolicy  implements RoutingPolicy {}
export class PinnedPolicy        implements RoutingPolicy {}
```

Два правила вокруг фолбэка:

- **Уход на фолбэк алертится.** Тихий фолбэк — правило №1: если основной
  провайдер деградировал, это должно быть видно, а не «стало чуть дороже».
- **Фолбэк не бесконечен.** План — список из ≤3 кандидатов, дальше отказ
  с `retryAfter`, а не перебор всего каталога.

---

## 5. Путь запроса

```
POST /api/v1/jobs
  │
  ├─ OriginGuard        Origin / Sec-Fetch-Site — CSRF
  ├─ AuthGuard          сессия → UserId
  ├─ SchemaGuard        zod-контракт из shared/contracts, ДО любого I/O
  ├─ RateLimitGuard     по IP и по пользователю
  ├─ QuotaGuard         баланс/лимит пользователя          ← fail-closed
  ├─ SpendCapGuard      дневной потолок расходов сервиса   ← fail-closed
  ├─ AdmissionGuard     глубина очереди, задач в полёте у пользователя
  └─ IdempotencyGuard   повтор → тот же job, не второй
  │
  ▼
SubmitJobUseCase
  ├─ Job.create(spec)                     accepted
  ├─ резерв квоты                          reserved
  ├─ queue.enqueue(job)                    enqueued   ← сбой enqueue НЕ освобождает резерв
  └─ вернуть 202 + publicView
  │
  ▼  (роль worker)
RunJobUseCase
  ├─ авторизация против ТОГО ЖЕ резерва (ретрай не создаёт новый)
  ├─ router.resolve(capability, constraints) → план
  ├─ provider.execute(...)                 running → finalizing
  ├─ artifacts → ObjectStorage
  ├─ commit квоты, usage.record            completed
  └─ при отказе: release/refund + failed   ← компенсация, а не «списали и не сделали»
```

Порядок гейтов неслучаен: дешёвые проверки раньше дорогих, деньги — до очереди.
Цепочка одна на все мутирующие роуты; отдельный роут не может «немножко»
пропустить гейт.

Клиенту статус приходит по SSE (`/jobs/{id}/events`) с polling-фолбэком.
Обязательная деталь фронтенда: **polling останавливается в скрытой вкладке**.

---

## 6. Безопасность

### 6.1 Ключ не может попасть в браузер

1. **`import "server-only"`** в каждом barrel-файле `src/server/**`. Импорт из
   клиентского компонента → **ошибка сборки**, а не тихая утечка в бандл.
2. **`process.env` читается ровно в одном файле** — `ServerConfig`. Везде
   остальном запрещён правилом ESLint `no-restricted-properties`.
3. **Секрет — объект, а не строка.** Самая частая утечка ключа — не взлом, а
   `console.log(config)`:

```ts
export class Secret {
  constructor(private readonly value: string) {}
  /** Явный вызов — видно в ревью и грепается. */
  expose(): string { return this.value }
  toString() { return "[redacted]" }
  toJSON()   { return "[redacted]" }
  [Symbol.for("nodejs.util.inspect.custom")]() { return "[redacted]" }
}
```

4. **`ServerConfig` падает на старте**, а не на первом запросе: zod-схема всех
   переменных, `web` и `worker` требуют разного набора. Отсутствующий ключ —
   отказ подняться, а не 500-ка в проде через неделю.
5. **Запрет `NEXT_PUBLIC_*` для секретов + тест в CI**: собрать бандл и
   грепнуть `.next/static` на вхождение значений секретов. Проверка, а не вера.
6. **В образе ключей нет.** Прод берёт их из секрет-хранилища платформы;
   `.env.local` — только локальная разработка, в `.gitignore`.
7. **Ротация без даунтайма**: `ServerConfig` держит `current` и `previous` ключ
   на провайдера.

### 6.2 Ключ не тратится чужими и не тратится бесконечно

- Авторизация + квота на пользователя (гейт-цепочка §5), fail-closed на деньгах
  (правило №4).
- **Потолок параллельных вызовов на провайдера** — лиз в Redis с TTL. При
  недоступном Redis в проде — fail-closed.
- **`SpendWatchdog`**: дневной и месячный потолок в деньгах. Превышение —
  отказ и алерт, а не сюрприз в счёте. Заводится **раньше первого ключа**.
- **Учёт стоимости каждого вызова с первого дня** (`UsageRecorder`). Без него
  через месяц непонятно, какой инструмент съел бюджет.
- Идемпотентность на создании задачи: двойной клик и ретрай сети не создают
  вторую платную генерацию.

### 6.3 Загрузки — самая опасная поверхность

Пользователь грузит картинки, значит принимает участие в формировании того, что
уйдёт наружу и что будет отдано обратно.

- Лимит размера **до** чтения тела; стрим обрывается на превышении.
- Тип определяется по **magic bytes**, а не по `Content-Type` (клиент врёт).
- **Пере-кодирование на сервере** (decode → re-encode, sharp): убивает
  polyglot-файлы и вычищает **EXIF с геолокацией** — это приватность
  пользователя, а не только безопасность.
- Ключ объекта — **сгенерированный id**, никогда не имя файла от пользователя.
- Приватный бакет, короткоживущие подписанные URL,
  `Content-Disposition: attachment`, **отдельный домен** для пользовательского
  контента — чтобы содержимое файла не било по сессии основного домена.
- **Никогда не принимать URL «скачай и обработай»** — это SSRF в чистом виде
  (метадата-сервис облака, внутренняя сеть). Если понадобится: allowlist
  доменов + резолв DNS + запрет приватных диапазонов + запрет редиректов.

### 6.4 Исходящий трафик

- Таймаут на каждый вызов, circuit breaker, allowlist доменов провайдеров.
- **Ответ провайдера — недоверенные данные**: валидировать схемой, ограничивать
  размер скачиваемого артефакта, проверять реальный тип.
- **Trust-уровни имеют смысл.** Laozhang, Kie.ai, API Models — перепродавцы:
  данные уходят третьей стороне. Роутинг не отправляет туда то, что помечено
  приватным; в UI видно, чей движок обработал кадр.

### 6.5 Вебхуки (Meshy, Kie.ai)

- **Подпись обязательна.** Неподписанный колбэк принимается только по явному
  локальному флагу — как `ALFA_CALLBACK_REQUIRE_SIGNATURE` в UpSound.
- **Replay-защита**: timestamp + nonce, окно в минуты.
- **Идемпотентность по `providerRef`**: колбэк придёт дважды, и он может
  прийти **раньше**, чем вернётся ответ на submit.
- **Вебхук — триггер, а не истина о деньгах.** Терминальное состояние
  подтверждается запросом к провайдеру.

### 6.6 Ошибки и логи

```ts
export abstract class AppError extends Error {
  abstract readonly code: string               // машинный код
  abstract readonly httpStatus: number
  abstract readonly publicMessageCode: string  // ключ текста в UI
  readonly diagnosticReference = newDiagnosticId()
  readonly retryable: boolean = false
  toProblem(): ProblemDetails                  // RFC 9457 problem+json
}
```

`ValidationError` · `AuthRequiredError` · `ForbiddenError` ·
`RateLimitError(retryAfter)` · `QuotaExceededError` ·
`AdmissionRejectedError(retryAfter)` · `IdempotencyConflictError` ·
`ProviderUnavailableError` · `ProviderRejectedInputError` · `StorageError` ·
`InvalidTransitionError`

**Инвариант: сырой текст исключения или ответа провайдера наружу не уходит
никогда** (правило №5). Наружу — `code` + `diagnosticReference`; по нему вы
находите полную строку в логе. Логгер — pino с редакцией по путям
(`authorization`, `*.key`, `*.apiKey`), ретеншен на debug-payload'ы.

### 6.7 Заголовки и рантайм

- `export const runtime = "nodejs"` явно на каждом роуте с секретами.
- CSP, HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy`.
- `AdmissionRejectedError` и `RateLimitError` отдают **`retryAfter`, видимый
  пользователю** («очередь занята, попробуйте через N секунд»), а не 500-ку.

---

## 7. Композиционный корень

Единственный файл, где встречается `new`. Всё остальное получает зависимости
через конструктор — поэтому всё остальное тестируется без сети.

```ts
// server/container.ts
export interface Container {
  readonly config: ServerConfig
  readonly jobs: JobRepository
  readonly queue: JobQueue
  readonly storage: ObjectStorage
  readonly router: ProviderRouter
  readonly useCases: { submitJob: SubmitJobUseCase; runJob: RunJobUseCase; … }
}

export function buildContainer(config: ServerConfig, role: ProcessRole): Container {
  const jobs    = config.databaseUrl ? new PostgresJobRepository(...) : new InMemoryJobRepository()
  const queue   = config.queueRedisUrl ? new BullMqQueue(...)         : new InlineQueue(...)
  const storage = config.s3     ? new S3Storage(...)                  : new LocalDiskStorage(...)

  const providers = [
    new FakeProvider(deps),
    ...config.enabledGateways.map((p) => new OpenAiCompatibleProvider(p, deps)),
    config.meshy ? new MeshyProvider(config.meshy, deps) : null,
  ].filter(Boolean)

  const router = new ProviderRouter(new ProviderRegistry(providers), new CheapestFirstPolicy(), breakers)
  …
}
```

Переезд «in-memory → Postgres», «inline → BullMQ», «fake → настоящий
провайдер» — это **правки здесь**, а не в use case'ах.

Оговорка про Next.js: модульные синглтоны переживают HMR. Контейнер кэшируется
на `globalThis` в разработке, иначе на каждый hot-reload появляется новый пул
соединений.

---

## 8. Договор с клиентом

Сейчас источник правды — браузер (`localStorage` + IndexedDB). С появлением
сервера **источником правды по задачам становится сервер**, а IndexedDB
превращается в кэш результатов.

- У записи галереи появляется `origin: "local" | "server"`. Старые локальные
  записи не ломаются — они просто не синхронизируются.
- Локальные canvas-движки остаются как офлайн-предпросмотр внутри
  `FakeProvider`, но перестают быть основным путём.
- Принцип «нажатие главной кнопки не может остаться без результата» сохраняется,
  но теперь его держит не локальный движок, а **видимый статус задачи**:
  очередь, прогресс, понятная ошибка с «Повторить».
- Клиентский таймаут на AI-операции — 120 секунд, дальше показывается статус
  задачи, а не спиннер без конца.

---

## 9. Этапы

Правило этапности: **порты пишутся сразу «взрослыми», меняются только
реализации**. Переход между этапами — строки в `container.ts`.

**Этап 0 — каркас без единого ключа.**
`shared/contracts`, `core` (Job, статусы, спеки, порты, ошибки), `container`,
`FakeProvider`, `InMemoryJobRepository`, `InlineQueue`, `LocalDiskStorage`,
guard-цепочка со всеми гейтами (пусть часть — заглушки, но места заняты).
Клиент переводится на `/api/v1/jobs`. Ключей нет — путь работает end-to-end.
Это ровно правило UpSound: «заглушка `fake_ai` — сразу, не потом».

**Этап 1 — фундамент и первый настоящий провайдер.**
Postgres + миграции, S3/R2, авторизация, `ServerConfig` + `Secret`,
`UsageRecorder`, `SpendWatchdog`, приём и пере-кодирование загрузок.
Провайдер — OpenRouter (синхронный, проще всего). Всё ещё без воркера.

**Этап 2 — очередь и воркер.**
Redis (ДВА URL), BullMQ, `PROCESS_ROLE=worker`, SSE-прогресс, admission control,
reaper'ы в `scheduler`. Без reaper'ов система выглядит рабочей и копит
зависшие задачи (правило №8).

**Этап 3 — дешёвые шлюзы и 3D.**
`OpenAiCompatibleProvider` × Laozhang / Kie.ai / API Models,
`CheapestFirstPolicy`, circuit breaker, алерты на фолбэк.
`MeshyProvider` + роут вебхуков + новый тип артефакта (меш) в галерее.

**Этап 4 — квоты, биллинг, наблюдаемость.**
Сага reserve → commit целиком или не начинать вовсе: половина саги хуже, чем её
отсутствие (правило №9). Sentry — раньше остального.

---

## 10. Куда что добавлять

| Что добавляем | Что трогаем |
| --- | --- |
| **Дешёвый OpenAI-совместимый шлюз** | Один объект в `providers/openai-compatible/profiles.ts` + ключ в `ServerConfig`. Классов не пишем |
| **Провайдер с иной механикой** | Класс от `SyncGenerationProvider` или `RemoteTaskProvider` + регистрация в `container.ts` |
| **Новый инструмент** | Класс `JobSpec` + zod-контракт в `shared/contracts` + страница в `app/(main)/` + пункт в `app-sidebar.tsx` + регистрация в каскаде удаления и `blob-gc` |
| **Новое хранилище/очередь/БД** | Класс, реализующий существующий порт, + строка в `container.ts` |
| **Новое правило доступа** | Класс `Guard` + место в цепочке. Не `if` внутри роута |

---

## 11. Чек-лист перед кодом

Из `upsound_frontend/docs/DESIGN_CHECKLIST.md`: девять вопросов, из которых
первые четыре покрывают 59% блокирующих замечаний ревью.

повтор · одновременность · **деньги** · видимость состояния · задачи в полёте ·
неизвестный исход · след решения · выход и отмена · пределы

Для этой платформы к ним добавляется десятый: **куда уходят данные
пользователя и на каком trust-уровне провайдер**, который их получит.
