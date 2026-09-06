import "server-only"

/**
 * Клиент LaoZhang Images API — единственное место, где сервис зовёт
 * провайдера картинок. Перенос из UpSound
 * (`services/cover_generator/image_generator.py`, `_generate_via_laozhang_images_api`):
 *
 * - текст → картинка: `POST /v1/images/generations`, JSON;
 * - картинка(и) + текст → картинка: `POST /v1/images/edits`, multipart с
 *   полем `image` (один референс) или `image[]` (несколько);
 * - модель `gpt-image-2` (~$0.03 за картинку): принимает `size` из трёх
 *   значений и НЕ принимает `quality` и `output_format`; `gpt-image-2-vip`
 *   молча игнорирует `size` — формат задаётся текстом промпта;
 * - ответ: `data[0].b64_json` либо `data[0].url`.
 *
 * Ключ читается только здесь и только на сервере: `import "server-only"`
 * ломает сборку, если модуль утянут в клиентский бандл.
 */

export const LAOZHANG_DEFAULT_BASE_URL = "https://api.laozhang.ai"
export const DEFAULT_IMAGE_MODEL = "gpt-image-2"

/** Размеры, которые gpt-image-2 гарантированно принимает (набор OpenAI). */
export const IMAGE_SIZES = ["1024x1024", "1536x1024", "1024x1536"] as const
export type ImageSize = (typeof IMAGE_SIZES)[number]

export function isImageSize(value: unknown): value is ImageSize {
  return typeof value === "string" && (IMAGE_SIZES as readonly string[]).includes(value)
}

export interface LaoZhangConfig {
  apiKey: string
  baseUrl: string
  model: string
}

/**
 * Конфигурация из окружения. `null`, когда ключа нет — тогда роут отвечает
 * «провайдер не настроен», а клиент показывает локальный предпросмотр.
 */
export function readLaoZhangConfig(): LaoZhangConfig | null {
  const apiKey = (process.env.LAOZHANG_API_KEY ?? "").trim()
  if (!apiKey) return null
  const baseUrl = (process.env.LAOZHANG_API_BASE_URL ?? LAOZHANG_DEFAULT_BASE_URL).trim().replace(/\/+$/, "")
  const model = (process.env.LAOZHANG_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL).trim() || DEFAULT_IMAGE_MODEL
  return { apiKey, baseUrl, model }
}

/** Какую модель сообщать клиенту, когда ключа нет: та, что включится с ключом. */
export function configuredImageModel(): string {
  return (process.env.LAOZHANG_IMAGE_MODEL ?? DEFAULT_IMAGE_MODEL).trim() || DEFAULT_IMAGE_MODEL
}

/* Особенности маршрутов LaoZhang — те же проверки, что в UpSound. */
const supportsQuality = (model: string) => !["gpt-image-2", "gpt-image-2-vip"].includes(model)
const supportsOutputFormat = (model: string) => !["gpt-image-2", "gpt-image-2-vip"].includes(model)
const supportsSize = (model: string) => model !== "gpt-image-2-vip"

export type LaoZhangErrorKind = "auth" | "quota" | "safety" | "rate_limit" | "upstream" | "network" | "bad_response" | "timeout"

export class LaoZhangError extends Error {
  readonly kind: LaoZhangErrorKind
  readonly status?: number
  readonly retryable: boolean

  constructor(kind: LaoZhangErrorKind, message: string, options: { status?: number; retryable?: boolean } = {}) {
    super(message)
    this.name = "LaoZhangError"
    this.kind = kind
    this.status = options.status
    this.retryable = options.retryable ?? (kind === "rate_limit" || kind === "upstream" || kind === "network" || kind === "timeout")
  }
}

export interface ImageReference {
  bytes: Uint8Array
  mimeType: string
  /** Имя файла в multipart: по нему картинку можно адресовать в промпте. */
  name: string
}

export interface ImageGenerationInput {
  prompt: string
  size: ImageSize
  references?: ImageReference[]
  /** Таймаут одного HTTP-вызова; генерация gpt-image-2 занимает 20–90 с. */
  timeoutMs?: number
  signal?: AbortSignal
}

export interface GeneratedImageBytes {
  bytes: Uint8Array
  mimeType: string
  model: string
  endpoint: "generations" | "edits"
  durationMs: number
}

const DEFAULT_TIMEOUT_MS = 180_000
/** Один повтор на временную ошибку (429/5xx/сеть) — как перебор попыток в UpSound. */
const TRANSIENT_RETRIES = 1
const RETRY_DELAY_MS = 2_000
/** Ответ по ссылке не должен быть бесконечным: ограничиваем скачивание. */
const MAX_DOWNLOAD_BYTES = 24 * 1024 * 1024

/** Тип картинки по сигнатуре: Content-Type провайдера доверять нельзя. */
export function sniffImageMime(bytes: Uint8Array): "image/png" | "image/jpeg" | "image/webp" | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png"
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp"
  }
  return null
}

function combineSignals(timeoutMs: number, external?: AbortSignal): AbortSignal {
  const signals = [AbortSignal.timeout(timeoutMs)]
  if (external) signals.push(external)
  return AbortSignal.any(signals)
}

function isTransientStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600)
}

/** HTTP-ошибка провайдера → наша таксономия; сырой ответ в сообщение не попадает целиком. */
function classifyHttpError(status: number, body: string, model: string): LaoZhangError {
  const snippet = body.replace(/\s+/g, " ").slice(0, 300)
  // LaoZhang отвечает 403 и на пустой баланс аккаунта (insufficient_user_quota) —
  // это не про ключ, и пользователю нужно сказать «пополните счёт», а не «проверьте токен».
  if (/insufficient_user_quota|quota .* is not enough|Insufficient user quota|额度不足/i.test(body)) {
    return new LaoZhangError("quota", `На счёте LaoZhang закончились средства (HTTP ${status}): ${snippet}`, { status, retryable: false })
  }
  if (status === 401 || status === 403) {
    // Тело ответа — в серверный лог: по нему видно, отключён ли токен, не пускает ли IP или модель.
    return new LaoZhangError("auth", `LaoZhang отклонил ключ (HTTP ${status}): ${snippet}`, { status, retryable: false })
  }
  if (status === 400 && /safety|moderation|policy|content_policy/i.test(body)) {
    return new LaoZhangError("safety", `LaoZhang отклонил запрос по политике контента (model=${model}): ${snippet}`, {
      status,
      retryable: false,
    })
  }
  if (status === 429) {
    return new LaoZhangError("rate_limit", `LaoZhang: превышен лимит запросов (HTTP 429): ${snippet}`, { status })
  }
  if (isTransientStatus(status)) {
    return new LaoZhangError("upstream", `LaoZhang временно недоступен (HTTP ${status}): ${snippet}`, { status })
  }
  return new LaoZhangError("upstream", `LaoZhang HTTP ${status} (model=${model}): ${snippet}`, { status, retryable: false })
}

async function fetchImageByUrl(url: string, signal: AbortSignal): Promise<Uint8Array> {
  const response = await fetch(url, { signal })
  if (!response.ok) {
    throw new LaoZhangError("bad_response", `LaoZhang вернул ссылку на картинку, но она недоступна (HTTP ${response.status})`)
  }
  const length = Number(response.headers.get("content-length") ?? 0)
  if (length > MAX_DOWNLOAD_BYTES) {
    throw new LaoZhangError("bad_response", "LaoZhang вернул слишком большой файл", { retryable: false })
  }
  const buffer = new Uint8Array(await response.arrayBuffer())
  if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new LaoZhangError("bad_response", "LaoZhang вернул слишком большой файл", { retryable: false })
  }
  return buffer
}

/** `data[0].b64_json` либо `data[0].url` — как `_extract_laozhang_image_bytes` в UpSound. */
async function extractImageBytes(payload: unknown, signal: AbortSignal): Promise<Uint8Array> {
  const data = (payload as { data?: unknown })?.data
  const first = Array.isArray(data) ? (data[0] as { b64_json?: unknown; url?: unknown } | undefined) : undefined
  if (!first) {
    throw new LaoZhangError("bad_response", `LaoZhang Images API вернул ответ без data: ${JSON.stringify(payload).slice(0, 500)}`)
  }
  if (typeof first.b64_json === "string" && first.b64_json.trim()) {
    return new Uint8Array(Buffer.from(first.b64_json.trim(), "base64"))
  }
  if (typeof first.url === "string" && first.url.trim()) {
    return fetchImageByUrl(first.url.trim(), signal)
  }
  throw new LaoZhangError("bad_response", "LaoZhang Images API вернул ни b64_json, ни url")
}

async function callOnce(config: LaoZhangConfig, input: ImageGenerationInput, signal: AbortSignal): Promise<GeneratedImageBytes> {
  const references = input.references ?? []
  const endpoint: GeneratedImageBytes["endpoint"] = references.length > 0 ? "edits" : "generations"
  const url = `${config.baseUrl}/v1/images/${endpoint}`
  const headers: Record<string, string> = { Authorization: `Bearer ${config.apiKey}` }
  const startedAt = Date.now()

  let response: Response
  try {
    if (endpoint === "edits") {
      const form = new FormData()
      form.set("model", config.model)
      form.set("prompt", input.prompt)
      form.set("n", "1")
      if (supportsSize(config.model)) form.set("size", input.size)
      if (supportsOutputFormat(config.model)) form.set("output_format", "png")
      if (supportsQuality(config.model)) form.set("quality", "high")
      // Одна картинка — поле `image`, несколько — `image[]`: так принимает LaoZhang.
      const field = references.length > 1 ? "image[]" : "image"
      references.forEach((reference) => {
        form.append(field, new Blob([reference.bytes as BlobPart], { type: reference.mimeType }), reference.name)
      })
      response = await fetch(url, { method: "POST", headers, body: form, signal })
    } else {
      const payload: Record<string, unknown> = { model: config.model, prompt: input.prompt, n: 1 }
      if (supportsSize(config.model)) payload.size = input.size
      if (supportsOutputFormat(config.model)) payload.output_format = "png"
      if (supportsQuality(config.model)) payload.quality = "high"
      response = await fetch(url, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      })
    }
  } catch (error) {
    if (signal.aborted) {
      throw new LaoZhangError("timeout", `LaoZhang не ответил за ${Math.round((input.timeoutMs ?? DEFAULT_TIMEOUT_MS) / 1000)} с`)
    }
    throw new LaoZhangError("network", `Нет связи с LaoZhang: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "")
    throw classifyHttpError(response.status, body, config.model)
  }

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    throw new LaoZhangError("bad_response", "LaoZhang вернул не JSON")
  }

  const bytes = await extractImageBytes(payload, signal)
  const mimeType = sniffImageMime(bytes)
  if (!mimeType) throw new LaoZhangError("bad_response", "LaoZhang вернул данные, которые не читаются как картинка")

  return { bytes, mimeType, model: config.model, endpoint, durationMs: Date.now() - startedAt }
}

/**
 * Одна картинка по промпту и (необязательным) референсам. Временные ошибки
 * повторяются один раз; ошибки ключа, политики и формата — нет.
 */
export async function generateImage(config: LaoZhangConfig, input: ImageGenerationInput): Promise<GeneratedImageBytes> {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let lastError: LaoZhangError | null = null
  for (let attempt = 0; attempt <= TRANSIENT_RETRIES; attempt += 1) {
    const signal = combineSignals(timeoutMs, input.signal)
    try {
      return await callOnce(config, input, signal)
    } catch (error) {
      const failure = error instanceof LaoZhangError ? error : new LaoZhangError("upstream", String(error))
      lastError = failure
      const userAborted = Boolean(input.signal?.aborted)
      if (!failure.retryable || userAborted || attempt === TRANSIENT_RETRIES) throw failure
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS))
    }
  }
  throw lastError ?? new LaoZhangError("upstream", "LaoZhang: неизвестная ошибка")
}
