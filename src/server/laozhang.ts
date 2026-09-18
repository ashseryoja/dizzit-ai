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
  type ImageResolution,
} from "@/server/image-provider"

/**
 * LaoZhang Images API — запасной провайдер (OpenAI-совместимый). Перенос из
 * UpSound (`services/cover_generator/image_generator.py`,
 * `_generate_via_laozhang_images_api`):
 *
 * - текст → картинка: `POST /v1/images/generations`, JSON;
 * - картинка(и) + текст → картинка: `POST /v1/images/edits`, multipart с
 *   полем `image` (один референс) или `image[]` (несколько);
 * - модель `gpt-image-2` (~$0.03 за картинку): принимает `size` из трёх
 *   значений и НЕ принимает `quality` и `output_format`; `gpt-image-2-vip`
 *   молча игнорирует `size` — формат задаётся текстом промпта;
 * - ответ: `data[0].b64_json` либо `data[0].url`.
 */

export const LAOZHANG_DEFAULT_BASE_URL = "https://api.laozhang.ai"
export const LAOZHANG_DEFAULT_MODEL = "gpt-image-2"

/** Размеры, которые gpt-image-2 у LaoZhang гарантированно принимает (набор OpenAI). */
type LaoZhangSize = "1024x1024" | "1536x1024" | "1024x1536"
const SIZES: Record<LaoZhangSize, number> = { "1024x1024": 1, "1536x1024": 1.5, "1024x1536": 2 / 3 }

export function laoZhangSize(aspect: AspectRatio): LaoZhangSize {
  return closestRatio(aspect, SIZES)
}

/* Особенности маршрутов LaoZhang — те же проверки, что в UpSound. */
const supportsQuality = (model: string) => !["gpt-image-2", "gpt-image-2-vip"].includes(model)
const supportsOutputFormat = (model: string) => !["gpt-image-2", "gpt-image-2-vip"].includes(model)
const supportsSize = (model: string) => model !== "gpt-image-2-vip"

const REQUEST_TIMEOUT_MS = 180_000

export interface LaoZhangConfig {
  apiKey: string
  baseUrl: string
  model: string
}

export class LaoZhangProvider implements ImageProvider {
  readonly id = "laozhang" as const
  readonly model: string
  /** LaoZhang отдаёт только ~1K: 1024 по короткой стороне. */
  readonly resolution: ImageResolution = "1K"
  private readonly apiKey: string
  private readonly baseUrl: string


  outputRatio(aspect: AspectRatio): number {
    return SIZES[laoZhangSize(aspect)]
  }

  constructor(config: LaoZhangConfig) {
    this.apiKey = config.apiKey
    this.baseUrl = config.baseUrl.replace(/\/+$/, "")
    this.model = config.model
  }

  private fail(kind: ImageProviderError["kind"], message: string, options?: { status?: number; retryable?: boolean }): ImageProviderError {
    return new ImageProviderError(this.id, kind, message, options)
  }

  private classify(status: number, body: string): ImageProviderError {
    const snippet = snippetOf(body)
    // LaoZhang отвечает 403 и на пустой баланс аккаунта (insufficient_user_quota).
    if (looksLikeQuotaExhausted(body)) {
      return this.fail("quota", `На счёте LaoZhang закончились средства (HTTP ${status}): ${snippet}`, { status, retryable: false })
    }
    if (status === 401 || status === 403) {
      return this.fail("auth", `LaoZhang отклонил ключ (HTTP ${status}): ${snippet}`, { status, retryable: false })
    }
    if (status === 400 && looksLikeSafetyRejection(body)) {
      return this.fail("safety", `LaoZhang отклонил запрос по политике контента (model=${this.model}): ${snippet}`, { status, retryable: false })
    }
    if (status === 429) return this.fail("rate_limit", `LaoZhang: превышен лимит запросов (HTTP 429): ${snippet}`, { status })
    if (isTransientStatus(status)) return this.fail("upstream", `LaoZhang временно недоступен (HTTP ${status}): ${snippet}`, { status })
    return this.fail("upstream", `LaoZhang HTTP ${status} (model=${this.model}): ${snippet}`, { status, retryable: false })
  }

  /** `data[0].b64_json` либо `data[0].url` — как `_extract_laozhang_image_bytes` в UpSound. */
  private async extractBytes(payload: unknown, signal: AbortSignal): Promise<Uint8Array> {
    const data = (payload as { data?: unknown })?.data
    const first = Array.isArray(data) ? (data[0] as { b64_json?: unknown; url?: unknown } | undefined) : undefined
    if (!first) throw this.fail("bad_response", `LaoZhang вернул ответ без data: ${JSON.stringify(payload).slice(0, 500)}`)
    if (typeof first.b64_json === "string" && first.b64_json.trim()) {
      return new Uint8Array(Buffer.from(first.b64_json.trim(), "base64"))
    }
    if (typeof first.url === "string" && first.url.trim()) return downloadImage(this.id, first.url.trim(), signal)
    throw this.fail("bad_response", "LaoZhang вернул ни b64_json, ни url")
  }

  private async callOnce(input: ImageGenerationInput): Promise<GeneratedImageBytes> {
    const references = input.references ?? []
    const endpoint = references.length > 0 ? "edits" : "generations"
    const url = `${this.baseUrl}/v1/images/${endpoint}`
    const size = laoZhangSize(input.aspect)
    const headers: Record<string, string> = { Authorization: `Bearer ${this.apiKey}` }
    const signal = combineSignals(REQUEST_TIMEOUT_MS, input.signal)
    const startedAt = Date.now()

    let response: Response
    try {
      if (endpoint === "edits") {
        const form = new FormData()
        form.set("model", this.model)
        form.set("prompt", input.prompt)
        form.set("n", "1")
        if (supportsSize(this.model)) form.set("size", size)
        if (supportsOutputFormat(this.model)) form.set("output_format", "png")
        if (supportsQuality(this.model)) form.set("quality", "high")
        // Одна картинка — поле `image`, несколько — `image[]`: так принимает LaoZhang.
        const field = references.length > 1 ? "image[]" : "image"
        references.forEach((reference) => {
          form.append(field, new Blob([reference.bytes as BlobPart], { type: reference.mimeType }), reference.name)
        })
        response = await fetch(url, { method: "POST", headers, body: form, signal })
      } else {
        const payload: Record<string, unknown> = { model: this.model, prompt: input.prompt, n: 1 }
        if (supportsSize(this.model)) payload.size = size
        if (supportsOutputFormat(this.model)) payload.output_format = "png"
        if (supportsQuality(this.model)) payload.quality = "high"
        response = await fetch(url, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal,
        })
      }
    } catch (error) {
      if (input.signal?.aborted) throw this.fail("timeout", "Запрос отменён", { retryable: false })
      if (signal.aborted) throw this.fail("timeout", `LaoZhang не ответил за ${Math.round(REQUEST_TIMEOUT_MS / 1000)} с`)
      throw this.fail("network", `Нет связи с LaoZhang: ${error instanceof Error ? error.message : String(error)}`)
    }

    if (!response.ok) throw this.classify(response.status, await response.text().catch(() => ""))

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw this.fail("bad_response", "LaoZhang вернул не JSON")
    }
    const bytes = await this.extractBytes(payload, signal)
    const mimeType = sniffImageMime(bytes)
    if (!mimeType) throw this.fail("bad_response", "LaoZhang вернул данные, которые не читаются как картинка")
    return { bytes, mimeType, provider: this.id, model: this.model, endpoint, durationMs: Date.now() - startedAt }
  }

  generate(input: ImageGenerationInput): Promise<GeneratedImageBytes> {
    return withOneRetry(() => this.callOnce(input), input.signal)
  }
}
