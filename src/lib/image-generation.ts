"use client"

/**
 * Клиентский вход генерации картинок — общий для всех инструментов.
 *
 * Движок инструмента (`enhance-engine`, `restyle-engine`, `view-engine`,
 * `material-engine`) собирает промпт и референсы и зовёт `requestImage`; тот
 * ходит в `/api/images` — тонкий прокси с ключом провайдера (основной —
 * API Models, модель gpt-image-2; запасной — LaoZhang). Ключа в браузере нет
 * и быть не может. Пропорция результата задаётся парой «ширина:высота» —
 * сервер сам подбирает ближайшую из поддерживаемых провайдером.
 *
 * Когда ключ не задан (локальная разработка без провайдера), `withImageProvider`
 * прозрачно переключает движок на canvas-предпросмотр: главная кнопка не может
 * остаться без результата. Такой результат помечается `engine: "preview"`, и
 * карточка это показывает — молчаливой подмены модели нет.
 */

/** Метка результата, посчитанного локальным canvas-движком без ключа. */
export const PREVIEW_ENGINE = "preview"

/** Желаемая пропорция результата; важно только отношение сторон. */
export interface Aspect {
  width: number
  height: number
}

export interface GeneratedImage {
  blob: Blob
  width: number
  height: number
  /** Чем посчитано: id модели провайдера (`gpt-image-2`) или `preview`. */
  engine: string
}

export interface ImageProviderStatus {
  configured: boolean
  provider: string
  model: string
  /** Ступень разрешения провайдера: 1K / 2K / 4K. */
  resolution: string
}

export interface ImageRequest {
  prompt: string
  aspect: Aspect
  /** Референсы: первый — исходник, дальше вспомогательные (карта областей и т. п.). */
  references?: Blob[]
  signal?: AbortSignal
}

/** Ошибка генерации с текстом для карточки; `retryable` — имеет ли смысл «Повторить». */
export class ImageGenerationError extends Error {
  readonly code: string
  readonly retryable: boolean
  constructor(code: string, message: string, retryable = true) {
    super(message)
    this.name = "ImageGenerationError"
    this.code = code
    this.retryable = retryable
  }
}

const STATUS_TTL_MS = 60_000
/** Клиентский таймаут: сервер держит задачу до 4 минут, плюс запас на передачу. */
const REQUEST_TIMEOUT_MS = 280_000
/**
 * Длинная сторона референса. Модель отдаёт до 2K, больше ей не нужно, а канал
 * экономит: 30-мегабайтный рендер уезжает мегабайтом-двумя, что укладывается
 * в лимит тела запроса на Vercel.
 */
export const REFERENCE_MAX_SIDE = 2048

let statusCache: { value: ImageProviderStatus; at: number } | null = null
let statusInFlight: Promise<ImageProviderStatus> | null = null

const UNCONFIGURED: ImageProviderStatus = { configured: false, provider: "", model: "", resolution: "" }

/** Настроен ли провайдер. Кэш на минуту, чтобы не дёргать роут на каждую карточку пачки. */
export function imageProviderStatus(force = false): Promise<ImageProviderStatus> {
  if (!force && statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) return Promise.resolve(statusCache.value)
  if (statusInFlight) return statusInFlight
  statusInFlight = fetch("/api/images", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`status ${response.status}`)
      const json = (await response.json()) as Partial<ImageProviderStatus>
      return {
        configured: Boolean(json.configured),
        provider: String(json.provider ?? ""),
        model: String(json.model ?? ""),
        resolution: String(json.resolution ?? ""),
      }
    })
    .catch(() => UNCONFIGURED)
    .then((value) => {
      statusCache = { value, at: Date.now() }
      statusInFlight = null
      return value
    })
  return statusInFlight
}

/**
 * Провайдер настроен — считает модель, нет — локальный предпросмотр.
 * Ошибка модели НЕ подменяется предпросмотром: пользователь видит ошибку и
 * «Повторить», а не тихо худший результат.
 */
export async function withImageProvider<T extends GeneratedImage>(
  remote: (model: string) => Promise<T>,
  preview: () => Promise<Omit<T, "engine"> | T>
): Promise<T> {
  const status = await imageProviderStatus()
  if (status.configured) return remote(status.model)
  const result = await preview()
  return { ...result, engine: PREVIEW_ENGINE } as T
}

/** Ширина и высота блоба картинки. */
export async function readBlobSize(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob)
  try {
    return { width: bitmap.width, height: bitmap.height }
  } finally {
    bitmap.close()
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Браузер не смог закодировать картинку"))), type, quality)
  })
}

/**
 * Референс для модели: уменьшенная копия не длиннее `maxSide`, JPEG высокого
 * качества. Маленький PNG уходит как есть — без перекодирования.
 */
export async function prepareReference(source: Blob, maxSide = REFERENCE_MAX_SIDE): Promise<Blob> {
  const bitmap = await createImageBitmap(source)
  try {
    const longest = Math.max(bitmap.width, bitmap.height)
    if (longest <= maxSide && source.type === "image/png" && source.size <= 4 * 1024 * 1024) return source
    const k = Math.min(1, maxSide / longest)
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(bitmap.width * k))
    canvas.height = Math.max(1, Math.round(bitmap.height * k))
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas 2D недоступен")
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await canvasToBlob(canvas, "image/jpeg", 0.92)
  } finally {
    bitmap.close()
  }
}

/**
 * Центральная вырезка результата в нужную пропорцию (например, 4:5 для крупных
 * планов, когда провайдер отдал 3:4). Пропорция уже совпадает — блоб как есть.
 */
export async function cropToAspect(image: GeneratedImage, aspect: number): Promise<GeneratedImage> {
  const current = image.width / image.height
  if (Math.abs(current - aspect) < 0.01) return image
  const bitmap = await createImageBitmap(image.blob)
  try {
    let w = bitmap.width
    let h = bitmap.height
    if (current > aspect) w = Math.round(h * aspect)
    else h = Math.round(w / aspect)
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas 2D недоступен")
    ctx.drawImage(bitmap, Math.round((bitmap.width - w) / 2), Math.round((bitmap.height - h) / 2), w, h, 0, 0, w, h)
    const type = image.blob.type === "image/png" ? "image/png" : "image/jpeg"
    const blob = await canvasToBlob(canvas, type, type === "image/jpeg" ? 0.95 : undefined)
    return { ...image, blob, width: w, height: h }
  } finally {
    bitmap.close()
  }
}

interface ProblemBody {
  error?: string
  message?: string
  retryable?: boolean
}

/**
 * Одна картинка от провайдера. Референсы уходят как есть — уменьшить их до
 * вызова обязан движок (`prepareReference`), чтобы не перекодировать дважды
 * там, где один исходник идёт в несколько кадров.
 */
export async function requestImage({ prompt, aspect, references = [], signal }: ImageRequest): Promise<GeneratedImage> {
  const form = new FormData()
  form.set("prompt", prompt)
  form.set("aspect", `${Math.max(1, Math.round(aspect.width))}:${Math.max(1, Math.round(aspect.height))}`)
  references.forEach((blob, index) => {
    const extension = blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg"
    form.append("image", blob, `${index === 0 ? "source" : `reference_${index}`}.${extension}`)
  })

  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout

  let response: Response
  try {
    response = await fetch("/api/images", { method: "POST", body: form, signal: combined })
  } catch (error) {
    if (timeout.aborted) throw new ImageGenerationError("timeout", "Генерация не уложилась в пять минут. Повторите.")
    if (signal?.aborted) throw new ImageGenerationError("aborted", "Генерация отменена.", false)
    throw new ImageGenerationError("network", `Нет связи с сервером: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!response.ok) {
    let body: ProblemBody = {}
    try {
      body = (await response.json()) as ProblemBody
    } catch {
      body = {}
    }
    if (body.error === "provider_not_configured") {
      // Ключ пропал на сервере — следующие задания пойдут в предпросмотр.
      statusCache = { value: UNCONFIGURED, at: Date.now() }
    }
    throw new ImageGenerationError(
      body.error ?? `http_${response.status}`,
      body.message ?? `Сервер ответил ошибкой ${response.status}.`,
      body.retryable ?? response.status >= 500
    )
  }

  const blob = await response.blob()
  const { width, height } = await readBlobSize(blob)
  const engine = response.headers.get("X-Image-Model") || "gpt-image-2"
  return { blob, width, height, engine }
}

/** Хвост подписи карточки для результата-предпросмотра. */
export function previewCaption(item: { engine?: string; status: string }): string {
  return item.status === "done" && item.engine === PREVIEW_ENGINE ? " · предпросмотр без ключа" : ""
}
