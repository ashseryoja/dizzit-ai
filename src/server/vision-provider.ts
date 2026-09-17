import "server-only"

import {
  ImageProviderError,
  combineSignals,
  isTransientStatus,
  looksLikeQuotaExhausted,
  looksLikeSafetyRejection,
  snippetOf,
  withOneRetry,
  type ImageProviderId,
} from "@/server/image-provider"

/**
 * Vision-модель для разбора сцены: «что на этом рендере» текстом.
 *
 * Оба наших шлюза (API Models и LaoZhang) отдают чат-модели по
 * OpenAI-совместимому `POST …/chat/completions`, картинка уходит частью
 * сообщения `image_url` с data-URI. Поэтому адаптер один; различаются только
 * базовый URL, ключ и модель (см. `resolveVisionProviders` в `providers.ts`).
 *
 * Ошибки — в той же таксономии, что у картинок (`ImageProviderError`): у
 * роутов один способ превращать их в понятный текст для карточки.
 */

export interface VisionImage {
  bytes: Uint8Array
  mimeType: string
}

export interface VisionRequest {
  prompt: string
  /** Без картинки — обычный текстовый запрос к той же чат-модели (тексты альбома без обложки). */
  image?: VisionImage
  /** Потолок ответа в токенах: инвентарь короткий, длинный ответ нам вреден. */
  maxTokens: number
  signal?: AbortSignal
}

export interface VisionAnswer {
  text: string
  /** Модель упёрлась в `max_tokens` — последняя строка может быть оборвана. */
  truncated: boolean
  provider: ImageProviderId
  model: string
  durationMs: number
  inputTokens?: number
  outputTokens?: number
}

export interface VisionProvider {
  readonly id: ImageProviderId
  readonly model: string
  /** Сколько токенов ответа просить у этой модели: рассуждающим — с запасом на невидимые токены. */
  readonly outputBudget: number
  describe(input: VisionRequest): Promise<VisionAnswer>
}

export interface OpenAiCompatibleVisionConfig {
  id: ImageProviderId
  apiKey: string
  /** С `/v1` на конце или без — адаптер подставит сам. */
  baseUrl: string
  model: string
}

const REQUEST_TIMEOUT_MS = 90_000
/**
 * Модели с внутренним рассуждением (Gemini 3, GPT-5, DeepSeek V4, «thinking»)
 * тратят ~1000–1500 токенов ответа на невидимое рассуждение, причём через шлюзы
 * `reasoning_effort` и другие ручки не доходят (проверено на API Models и
 * LaoZhang). Поэтому им — бюджет с запасом, остальным — короче. Инвентарь с
 * секцией MATERIALS — до ~2600 символов, это ~700 токенов текста; Claude Sonnet 5
 * на пробе не уложился в 1100 (`finish_reason: length`), отсюда 1400.
 */
const REASONING_MODEL = /gemini-3|gpt-5|deepseek-v4|glm-5|thinking|reason/i
const REASONING_OUTPUT_BUDGET = 4_000
const PLAIN_OUTPUT_BUDGET = 1_400
/**
 * Если лимит всё же ушёл на рассуждение и модель вернула `content: null` с
 * `finish_reason: "length"` — один повтор с удвоенным лимитом, не выше потолка.
 */
const EMPTY_ANSWER_RETRY_MAX_TOKENS = 6_000

/** Бюджет ответа по имени модели — для `analyzeScene` и статуса. */
export function outputBudgetFor(model: string): number {
  return REASONING_MODEL.test(model) ? REASONING_OUTPUT_BUDGET : PLAIN_OUTPUT_BUDGET
}

type ChatContent = string | { type?: string; text?: string }[] | null | undefined

interface ChatCompletion {
  choices?: {
    message?: { content?: ChatContent }
    finish_reason?: string
  }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number }
  error?: { message?: string; type?: string; code?: string }
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString("base64")
}

/** Текст ответа: строка или массив частей (так отдают некоторые шлюзы). */
function contentText(content: ChatContent): string {
  if (typeof content === "string") return content
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && typeof part.text === "string" ? part.text : ""))
      .join("")
  }
  return ""
}

export class OpenAiCompatibleVisionProvider implements VisionProvider {
  readonly id: ImageProviderId
  readonly model: string
  readonly outputBudget: number
  private readonly apiKey: string
  private readonly endpoint: string

  constructor(config: OpenAiCompatibleVisionConfig) {
    this.id = config.id
    this.model = config.model
    this.outputBudget = outputBudgetFor(config.model)
    this.apiKey = config.apiKey
    const base = config.baseUrl.replace(/\/+$/, "")
    this.endpoint = /\/v\d+$/.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`
  }

  private fail(kind: ImageProviderError["kind"], message: string, options?: { status?: number; retryable?: boolean }): ImageProviderError {
    return new ImageProviderError(this.id, kind, message, options)
  }

  private classify(status: number, body: string): ImageProviderError {
    const snippet = snippetOf(body)
    if (looksLikeQuotaExhausted(body) || status === 402) {
      return this.fail("quota", `Vision (${this.model}): на счёте закончились средства (HTTP ${status}): ${snippet}`, { status, retryable: false })
    }
    if (status === 401 || status === 403) {
      return this.fail("auth", `Vision (${this.model}): ключ отклонён (HTTP ${status}): ${snippet}`, { status, retryable: false })
    }
    if (status === 429) return this.fail("rate_limit", `Vision (${this.model}): превышен лимит запросов: ${snippet}`, { status })
    if (looksLikeSafetyRejection(body)) {
      return this.fail("safety", `Vision (${this.model}): отказ по политике контента: ${snippet}`, { status, retryable: false })
    }
    if (isTransientStatus(status)) return this.fail("upstream", `Vision (${this.model}): провайдер временно недоступен (HTTP ${status}): ${snippet}`, { status })
    return this.fail("upstream", `Vision (${this.model}): HTTP ${status}: ${snippet}`, { status, retryable: false })
  }

  /** Один вызов чата; `null` — модель сожгла лимит и не вернула текста. */
  private async attempt(input: VisionRequest, maxTokens: number, startedAt: number): Promise<VisionAnswer | null> {
    const signal = combineSignals(REQUEST_TIMEOUT_MS, input.signal)
    const payload = {
      model: this.model,
      max_tokens: maxTokens,
      temperature: 0.2,
      messages: [
        {
          role: "user",
          content: input.image
            ? [
                { type: "text", text: input.prompt },
                {
                  type: "image_url",
                  image_url: { url: `data:${input.image.mimeType};base64,${toBase64(input.image.bytes)}`, detail: "high" },
                },
              ]
            : input.prompt,
        },
      ],
    }

    let response: Response
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      })
    } catch (error) {
      if (input.signal?.aborted) throw this.fail("timeout", "Запрос отменён", { retryable: false })
      if (signal.aborted) throw this.fail("timeout", `Vision (${this.model}) не ответил за ${Math.round(REQUEST_TIMEOUT_MS / 1000)} с`)
      throw this.fail("network", `Нет связи с vision-провайдером: ${error instanceof Error ? error.message : String(error)}`)
    }

    const text = await response.text().catch(() => "")
    if (!response.ok) throw this.classify(response.status, text)

    let completion: ChatCompletion
    try {
      completion = JSON.parse(text) as ChatCompletion
    } catch {
      throw this.fail("bad_response", `Vision (${this.model}) вернул не JSON: ${snippetOf(text)}`)
    }
    if (completion.error) throw this.classify(response.status, text)

    const choice = completion.choices?.[0]
    const answer = contentText(choice?.message?.content ?? "").trim()
    const truncated = choice?.finish_reason === "length"
    if (!answer) {
      if (truncated) return null
      throw this.fail("bad_response", `Vision (${this.model}) вернул пустой ответ: ${snippetOf(text)}`)
    }

    return {
      text: answer,
      truncated,
      provider: this.id,
      model: this.model,
      durationMs: Date.now() - startedAt,
      inputTokens: completion.usage?.prompt_tokens ?? completion.usage?.input_tokens,
      outputTokens: completion.usage?.completion_tokens ?? completion.usage?.output_tokens,
    }
  }

  async describe(input: VisionRequest): Promise<VisionAnswer> {
    return withOneRetry(async () => {
      const startedAt = Date.now()
      const first = await this.attempt(input, input.maxTokens, startedAt)
      if (first) return first
      // Лимит ушёл на невидимое рассуждение — даём больше, один раз.
      const retryTokens = Math.min(EMPTY_ANSWER_RETRY_MAX_TOKENS, input.maxTokens * 2)
      console.warn(`[vision] ${this.id} ${this.model}: пустой ответ при max_tokens=${input.maxTokens}, повтор с ${retryTokens}`)
      const second = await this.attempt(input, retryTokens, startedAt)
      if (second) return second
      throw this.fail("bad_response", `Vision (${this.model}) дважды исчерпал лимит токенов без текста`, { retryable: false })
    }, input.signal)
  }
}
