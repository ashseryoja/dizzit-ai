import "server-only"

/**
 * Общий контракт провайдера картинок и помощники, одинаковые для всех
 * адаптеров (`apimodels.ts`, `laozhang.ts`). Выбор провайдера по окружению —
 * `providers.ts`. Ключи читаются только в адаптерах и только на сервере:
 * `import "server-only"` ломает сборку при попытке утянуть модуль в браузер.
 */

export type ImageProviderId = "apimodels" | "laozhang"

/** Ступень разрешения: у API Models — 1K / 2K / 4K, у LaoZhang всегда ~1K. */
export type ImageResolution = "1K" | "2K" | "4K"

export function isImageResolution(value: unknown): value is ImageResolution {
  return value === "1K" || value === "2K" || value === "4K"
}

export type ImageErrorKind = "auth" | "quota" | "safety" | "rate_limit" | "upstream" | "network" | "bad_response" | "timeout"

/** Ошибка провайдера в общей таксономии; сырое тело ответа — только в серверный лог. */
export class ImageProviderError extends Error {
  readonly kind: ImageErrorKind
  readonly provider: ImageProviderId
  readonly status?: number
  readonly retryable: boolean

  constructor(
    provider: ImageProviderId,
    kind: ImageErrorKind,
    message: string,
    options: { status?: number; retryable?: boolean } = {}
  ) {
    super(message)
    this.name = "ImageProviderError"
    this.provider = provider
    this.kind = kind
    this.status = options.status
    this.retryable = options.retryable ?? (kind === "rate_limit" || kind === "upstream" || kind === "network" || kind === "timeout")
  }
}

export interface ImageReference {
  bytes: Uint8Array
  mimeType: string
  /** Имя файла: по нему картинку можно адресовать в промпте («image 1»). */
  name: string
}

/** Желаемая пропорция результата; важно только отношение сторон. */
export interface AspectRatio {
  width: number
  height: number
}

export interface ImageGenerationInput {
  prompt: string
  aspect: AspectRatio
  /** Первый референс — исходник, дальше вспомогательные (карта областей и т. п.). */
  references?: ImageReference[]
  signal?: AbortSignal
}

/**
 * GPT Image 2 принимает одну текстовую инструкцию, а не отдельное поле
 * negative_prompt. Держим positive/negative раздельно до границы бэкенда и
 * здесь превращаем запреты в последний, наиболее заметный блок инструкции.
 */
export function composeProviderPrompt(prompt: string, negativePrompt?: string): string {
  const negative = negativePrompt?.trim()
  if (!negative) return prompt.trim()
  return [
    prompt.trim(),
    "NEGATIVE PROMPT — STRICT EXCLUSIONS:",
    `Do not produce or introduce any of the following: ${negative}`,
    "These exclusions never permit changing the locked geometry, layout, camera or object placement.",
  ].join("\n")
}

export interface GeneratedImageBytes {
  bytes: Uint8Array
  mimeType: string
  provider: ImageProviderId
  model: string
  /** Какой маршрут провайдера сработал: `generations` / `edits` / `task`. */
  endpoint: string
  durationMs: number
}

export interface ImageProvider {
  readonly id: ImageProviderId
  readonly model: string
  readonly resolution: ImageResolution
  generate(input: ImageGenerationInput): Promise<GeneratedImageBytes>
}

/* ── Помощники ──────────────────────────────────────────────────────── */

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

/** Ближайшая из поддерживаемых пропорций провайдера к запрошенной. */
export function closestRatio<T extends string>(aspect: AspectRatio, candidates: Readonly<Record<T, number>>): T {
  const wanted = aspect.width > 0 && aspect.height > 0 ? aspect.width / aspect.height : 1
  let best: T | null = null
  let bestDistance = Number.POSITIVE_INFINITY
  for (const key of Object.keys(candidates) as T[]) {
    // Сравниваем логарифмы: 2:1 и 1:2 одинаково далеки от квадрата.
    const distance = Math.abs(Math.log(candidates[key]) - Math.log(wanted))
    if (distance < bestDistance) {
      bestDistance = distance
      best = key
    }
  }
  return best as T
}

export function combineSignals(timeoutMs: number, external?: AbortSignal): AbortSignal {
  const signals = [AbortSignal.timeout(timeoutMs)]
  if (external) signals.push(external)
  return AbortSignal.any(signals)
}

export function isTransientStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600)
}

/** Тело ответа провайдера одной строкой для лога — без переносов, не длиннее 300 символов. */
export function snippetOf(body: string): string {
  return body.replace(/\s+/g, " ").slice(0, 300)
}

/** Пустой баланс аккаунта: у шлюзов это 403/402 с текстом про quota/balance. */
export function looksLikeQuotaExhausted(body: string): boolean {
  return /insufficient_user_quota|quota .* is not enough|insufficient (user )?quota|insufficient balance|balance (is )?insufficient|not enough (balance|credits?)|额度不足|余额不足/i.test(body)
}

export function looksLikeSafetyRejection(body: string): boolean {
  return /safety|moderation|content[_ ]policy|policy violation|flagged/i.test(body)
}

/** Ограниченное скачивание результата по ссылке: провайдер — недоверенный источник. */
export async function downloadImage(
  provider: ImageProviderId,
  url: string,
  signal: AbortSignal,
  maxBytes = 40 * 1024 * 1024
): Promise<Uint8Array> {
  let response: Response
  try {
    response = await fetch(url, { signal })
  } catch (error) {
    throw new ImageProviderError(provider, "network", `Не удалось скачать результат: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    throw new ImageProviderError(provider, "bad_response", `Ссылка на результат недоступна (HTTP ${response.status})`)
  }
  const length = Number(response.headers.get("content-length") ?? 0)
  if (length > maxBytes) throw new ImageProviderError(provider, "bad_response", "Результат слишком большой", { retryable: false })
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength > maxBytes) throw new ImageProviderError(provider, "bad_response", "Результат слишком большой", { retryable: false })
  return bytes
}

/** Один повтор на временную ошибку (429/5xx/сеть) — как перебор попыток в UpSound. */
export async function withOneRetry<T>(run: () => Promise<T>, external?: AbortSignal, delayMs = 2_000): Promise<T> {
  try {
    return await run()
  } catch (error) {
    const failure = error instanceof ImageProviderError ? error : null
    if (!failure || !failure.retryable || external?.aborted) throw error
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    return run()
  }
}
