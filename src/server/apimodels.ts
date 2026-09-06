import "server-only"

import {
  ImageProviderError,
  closestRatio,
  combineSignals,
  downloadImage,
  isTransientStatus,
  looksLikeQuotaExhausted,
  looksLikeSafetyRejection,
  sniffImageMime,
  snippetOf,
  withOneRetry,
  type AspectRatio,
  type GeneratedImageBytes,
  type ImageGenerationInput,
  type ImageProvider,
  type ImageReference,
  type ImageResolution,
} from "@/server/image-provider"

/**
 * API Models (apimodels.app), модель `gpt-image-2` — основной провайдер картинок.
 * По документации https://apimodels.app/docs/gpt-image-2:
 *
 * - `POST {base}/images/generations` JSON `{ model, prompt, aspect_ratio,
 *   resolution, image_base64 + image_mime_type | image_urls[] }` создаёт
 *   задачу: `{ code: 200, data: { taskId, state: "pending" } }`;
 * - `GET {base}/images/generations?task_id=…` — опрос до `completed`
 *   (`resultUrls[]`, ссылки R2 живут 7 дней) или `failed` (`failMsg`);
 * - референсы: публичные URL, data-URI или голый base64, до 16 штук по 10 МБ;
 * - `aspect_ratio` из 1:1 / 2:3 / 3:2 / 4:5 / 5:4 / 4:3 / 3:4 / 16:9 / 9:16 / 21:9,
 *   причём 4:5 и 5:4 — только при `resolution: "1K"`;
 * - цена по разрешению: 1K $0.025, 2K $0.03, 4K $0.05; неудачные задачи не
 *   тарифицируются. Типичное время 10–30 с, потолок ~3 мин.
 */

export const APIMODELS_DEFAULT_BASE_URL = "https://api.apimodels.app/v1"
export const APIMODELS_DEFAULT_MODEL = "gpt-image-2"
export const APIMODELS_DEFAULT_RESOLUTION: ImageResolution = "2K"

const CREATE_TIMEOUT_MS = 60_000
const POLL_TIMEOUT_MS = 30_000
/** Опрос: с 2 с до 5 с между запросами, всего не дольше потолка провайдера. */
const POLL_MIN_INTERVAL_MS = 2_000
const POLL_MAX_INTERVAL_MS = 5_000
const TASK_DEADLINE_MS = 240_000

type ApiModelsRatio = "1:1" | "2:3" | "3:2" | "4:5" | "5:4" | "4:3" | "3:4" | "16:9" | "9:16" | "21:9"

const RATIOS: Record<ApiModelsRatio, number> = {
  "1:1": 1,
  "2:3": 2 / 3,
  "3:2": 3 / 2,
  "4:5": 4 / 5,
  "5:4": 5 / 4,
  "4:3": 4 / 3,
  "3:4": 3 / 4,
  "16:9": 16 / 9,
  "9:16": 9 / 16,
  "21:9": 21 / 9,
}

/** Пропорция провайдера под кадр; 4:5 и 5:4 доступны только на 1K. */
export function apiModelsAspect(aspect: AspectRatio, resolution: ImageResolution): ApiModelsRatio {
  if (resolution === "1K") return closestRatio(aspect, RATIOS)
  const { "4:5": _portrait, "5:4": _landscape, ...rest } = RATIOS
  return closestRatio(aspect, rest)
}

export interface ApiModelsConfig {
  apiKey: string
  baseUrl: string
  model: string
  resolution: ImageResolution
}

interface TaskEnvelope {
  code?: number
  msg?: string
  data?: {
    taskId?: string
    state?: string
    resultUrls?: string[]
    failMsg?: string
    costTime?: number
  }
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64")
}

function dataUri(reference: ImageReference): string {
  return `data:${reference.mimeType};base64,${toBase64(reference.bytes)}`
}

export class ApiModelsProvider implements ImageProvider {
  readonly id = "apimodels" as const
  readonly model: string
  readonly resolution: ImageResolution
  private readonly apiKey: string
  private readonly baseUrl: string

  constructor(config: ApiModelsConfig) {
    this.apiKey = config.apiKey
    this.baseUrl = config.baseUrl.replace(/\/+$/, "")
    this.model = config.model
    this.resolution = config.resolution
  }

  private headers(json: boolean): Record<string, string> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}` }
    if (json) headers["Content-Type"] = "application/json"
    return headers
  }

  private fail(kind: ImageProviderError["kind"], message: string, options?: { status?: number; retryable?: boolean }): ImageProviderError {
    return new ImageProviderError(this.id, kind, message, options)
  }

  /** HTTP-ошибка или `code !== 200` → общая таксономия. */
  private classify(status: number, body: string): ImageProviderError {
    const snippet = snippetOf(body)
    if (looksLikeQuotaExhausted(body) || status === 402) {
      return this.fail("quota", `На счёте API Models закончились средства (HTTP ${status}): ${snippet}`, { status, retryable: false })
    }
    if (status === 401 || status === 403) {
      return this.fail("auth", `API Models отклонил ключ (HTTP ${status}): ${snippet}`, { status, retryable: false })
    }
    if (status === 429) return this.fail("rate_limit", `API Models: превышен лимит запросов: ${snippet}`, { status })
    if (looksLikeSafetyRejection(body)) {
      return this.fail("safety", `API Models отклонил запрос по политике контента: ${snippet}`, { status, retryable: false })
    }
    if (isTransientStatus(status)) return this.fail("upstream", `API Models временно недоступен (HTTP ${status}): ${snippet}`, { status })
    return this.fail("upstream", `API Models HTTP ${status}: ${snippet}`, { status, retryable: false })
  }

  private async request(url: string, init: RequestInit, timeoutMs: number, external?: AbortSignal): Promise<{ status: number; text: string }> {
    const signal = combineSignals(timeoutMs, external)
    let response: Response
    try {
      response = await fetch(url, { ...init, signal })
    } catch (error) {
      if (external?.aborted) throw this.fail("timeout", "Запрос отменён", { retryable: false })
      if (signal.aborted) throw this.fail("timeout", `API Models не ответил за ${Math.round(timeoutMs / 1000)} с`)
      throw this.fail("network", `Нет связи с API Models: ${error instanceof Error ? error.message : String(error)}`)
    }
    return { status: response.status, text: await response.text().catch(() => "") }
  }

  private parseEnvelope(status: number, text: string): TaskEnvelope {
    let envelope: TaskEnvelope
    try {
      envelope = JSON.parse(text) as TaskEnvelope
    } catch {
      throw status >= 200 && status < 300
        ? this.fail("bad_response", `API Models вернул не JSON: ${snippetOf(text)}`)
        : this.classify(status, text)
    }
    if (status < 200 || status >= 300 || (typeof envelope.code === "number" && envelope.code !== 200)) {
      throw this.classify(status, text)
    }
    return envelope
  }

  private async createTask(input: ImageGenerationInput): Promise<string> {
    const references = input.references ?? []
    const payload: Record<string, unknown> = {
      model: this.model,
      prompt: input.prompt,
      aspect_ratio: apiModelsAspect(input.aspect, this.resolution),
      resolution: this.resolution,
    }
    if (references.length === 1) {
      // Один локальный файл — документированный путь image_base64 + MIME.
      payload.image_base64 = toBase64(references[0].bytes)
      payload.image_mime_type = references[0].mimeType
    } else if (references.length > 1) {
      // Несколько — массив data-URI (провайдер принимает их наравне с URL).
      payload.image_urls = references.map(dataUri)
    }
    const { status, text } = await this.request(
      `${this.baseUrl}/images/generations`,
      { method: "POST", headers: this.headers(true), body: JSON.stringify(payload) },
      CREATE_TIMEOUT_MS,
      input.signal
    )
    const envelope = this.parseEnvelope(status, text)
    const taskId = envelope.data?.taskId
    if (!taskId) throw this.fail("bad_response", `API Models не вернул taskId: ${snippetOf(text)}`)
    return taskId
  }

  private async waitForResult(taskId: string, startedAt: number, external?: AbortSignal): Promise<string> {
    let interval = POLL_MIN_INTERVAL_MS
    while (Date.now() - startedAt < TASK_DEADLINE_MS) {
      if (external?.aborted) throw this.fail("timeout", "Запрос отменён", { retryable: false })
      await new Promise((resolve) => setTimeout(resolve, interval))
      interval = Math.min(POLL_MAX_INTERVAL_MS, Math.round(interval * 1.4))

      const { status, text } = await this.request(
        `${this.baseUrl}/images/generations?task_id=${encodeURIComponent(taskId)}`,
        { method: "GET", headers: this.headers(false) },
        POLL_TIMEOUT_MS,
        external
      )
      const envelope = this.parseEnvelope(status, text)
      const state = envelope.data?.state ?? ""
      if (state === "completed") {
        const url = envelope.data?.resultUrls?.[0]
        if (!url) throw this.fail("bad_response", `Задача завершена без resultUrls: ${snippetOf(text)}`)
        return url
      }
      if (state === "failed") {
        const reason = envelope.data?.failMsg ?? envelope.msg ?? "без причины"
        if (looksLikeSafetyRejection(reason)) {
          throw this.fail("safety", `API Models отклонил задание по политике контента: ${snippetOf(reason)}`, { retryable: false })
        }
        // Неудачные задачи провайдер не тарифицирует — повтор безопасен.
        throw this.fail("upstream", `API Models: задача завершилась ошибкой: ${snippetOf(reason)}`)
      }
      // pending / processing — ждём дальше.
    }
    throw this.fail("timeout", `API Models не завершил задачу за ${Math.round(TASK_DEADLINE_MS / 1000)} с`)
  }

  async generate(input: ImageGenerationInput): Promise<GeneratedImageBytes> {
    return withOneRetry(async () => {
      const startedAt = Date.now()
      const taskId = await this.createTask(input)
      const url = await this.waitForResult(taskId, startedAt, input.signal)
      const bytes = await downloadImage(this.id, url, combineSignals(POLL_TIMEOUT_MS * 2, input.signal))
      const mimeType = sniffImageMime(bytes)
      if (!mimeType) throw this.fail("bad_response", "API Models вернул данные, которые не читаются как картинка")
      return {
        bytes,
        mimeType,
        provider: this.id,
        model: this.model,
        endpoint: input.references && input.references.length > 0 ? "task:image-to-image" : "task:text-to-image",
        durationMs: Date.now() - startedAt,
      }
    }, input.signal)
  }
}
