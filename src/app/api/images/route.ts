import { NextResponse } from "next/server"

import {
  composeProviderPrompt,
  ImageProviderError,
  isImageResolution,
  sniffImageMime,
  type AspectRatio,
  type ImageProviderId,
  type ImageReference,
  type ImageResolution,
} from "@/server/image-provider"
import { resizeToLongSideLanczos } from "@/server/image-postprocess"
import { describeIntendedProvider, providerKeyVariable, providerLabel, resolveImageProvider } from "@/server/providers"

/**
 * Единственный серверный вход генерации картинок — тонкий прокси, прячущий
 * ключ провайдера. Все инструменты (улучшение, перенос стиля, ракурсы,
 * материалы) ходят сюда через `src/lib/image-generation.ts`; промпт собирает
 * движок инструмента на клиенте, сюда приходят только текст, пропорция и
 * референсы. Провайдер выбирается по окружению (`src/server/providers.ts`):
 * основной — API Models (gpt-image-2), запасной — LaoZhang.
 *
 * GET  → статус: настроен ли ключ, какой провайдер, модель и разрешение.
 * POST → multipart: `prompt`, опциональный `negative_prompt`, `aspect`
 *        («ширина:высота» желаемой пропорции),
 *        0…4 файлов `image` (PNG/JPEG/WEBP до 12 МБ каждый); опционально
 *        `provider`, `resolution`, `final_long_side` для фиксированного по
 *        цене пайплайна улучшения → байты картинки.
 *
 * Очереди и воркера пока нет (см. docs/PLATFORM_ARCHITECTURE.md, этап 0):
 * запрос держится открытым всё время генерации, поэтому `maxDuration` —
 * потолок платформы, а не 10 секунд по умолчанию.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

const MAX_PROMPT_CHARS = 8_000
const MAX_REFERENCES = 4
const MAX_REFERENCE_BYTES = 12 * 1024 * 1024
const MIN_FINAL_LONG_SIDE = 512
const MAX_FINAL_LONG_SIDE = 4_096

interface ProblemBody {
  error: string
  message: string
  retryable?: boolean
}

function problem(status: number, body: ProblemBody): NextResponse<ProblemBody> {
  return NextResponse.json(body, { status })
}

/**
 * Минимальная защита от чужих страниц: браузерный запрос с другого origin
 * отклоняется. curl это не остановит — авторизации у сервиса пока нет, и это
 * осознанно (README, «Что осознанно НЕ сделано»).
 */
function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin")
  if (!origin) return true
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  if (!host) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** «1600:900» → пропорция; пусто — квадрат. */
function parseAspect(value: FormDataEntryValue | null): AspectRatio | null {
  if (value === null || value === "") return { width: 1, height: 1 }
  const match = /^(\d{1,5}):(\d{1,5})$/.exec(String(value).trim())
  if (!match) return null
  const width = Number(match[1])
  const height = Number(match[2])
  if (width <= 0 || height <= 0) return null
  return { width, height }
}

function parseProvider(value: FormDataEntryValue | string | null): ImageProviderId | null | undefined {
  if (value === null || value === "") return undefined
  if (value === "apimodels" || value === "laozhang") return value
  return null
}

function parseResolution(value: FormDataEntryValue | string | null): ImageResolution | null | undefined {
  if (value === null || value === "") return undefined
  const normalized = String(value).toUpperCase()
  return isImageResolution(normalized) ? normalized : null
}

function parseFinalLongSide(value: FormDataEntryValue | null): number | null | undefined {
  if (value === null || value === "") return undefined
  if (!/^\d{3,4}$/.test(String(value))) return null
  const pixels = Number(value)
  return pixels >= MIN_FINAL_LONG_SIDE && pixels <= MAX_FINAL_LONG_SIDE ? pixels : null
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const preferred = parseProvider(url.searchParams.get("provider"))
  const requestedResolution = parseResolution(url.searchParams.get("resolution"))
  if (preferred === null || requestedResolution === null) {
    return problem(400, { error: "bad_request", message: "Неизвестный провайдер или разрешение." })
  }
  const provider = resolveImageProvider(preferred, requestedResolution)
  const intended = describeIntendedProvider(preferred, requestedResolution)
  return NextResponse.json(
    {
      configured: provider !== null,
      provider: provider?.id ?? intended.provider,
      model: provider?.model ?? intended.model,
      resolution: provider?.resolution ?? intended.resolution,
    },
    { headers: { "Cache-Control": "no-store" } }
  )
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return problem(403, { error: "forbidden_origin", message: "Запрос с чужого сайта." })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return problem(400, { error: "bad_request", message: "Ожидается multipart/form-data." })
  }

  const preferred = parseProvider(form.get("provider"))
  const requestedResolution = parseResolution(form.get("resolution"))
  const finalLongSide = parseFinalLongSide(form.get("final_long_side"))
  if (preferred === null || requestedResolution === null || finalLongSide === null) {
    return problem(400, { error: "bad_request", message: "Некорректные параметры обработки картинки." })
  }

  const provider = resolveImageProvider(preferred, requestedResolution)
  if (!provider) {
    const intended = describeIntendedProvider(preferred, requestedResolution)
    return problem(503, {
      error: "provider_not_configured",
      message: `Ключ ${providerKeyVariable(intended.provider)} не задан — добавьте его в .env.local и перезапустите сервер.`,
      retryable: false,
    })
  }

  const prompt = String(form.get("prompt") ?? "").trim()
  const negativePrompt = String(form.get("negative_prompt") ?? "").trim()
  if (!prompt) return problem(400, { error: "bad_request", message: "Пустой промпт." })
  const providerPrompt = composeProviderPrompt(prompt, negativePrompt)
  if (providerPrompt.length > MAX_PROMPT_CHARS) {
    return problem(400, { error: "bad_request", message: "Слишком длинные prompt и negative prompt." })
  }

  const aspect = parseAspect(form.get("aspect"))
  if (!aspect) return problem(400, { error: "bad_request", message: "Пропорция задаётся как «ширина:высота»." })

  const files = form.getAll("image").filter((entry): entry is File => entry instanceof File)
  if (files.length > MAX_REFERENCES) {
    return problem(400, { error: "bad_request", message: `Не больше ${MAX_REFERENCES} референсов за запрос.` })
  }

  const references: ImageReference[] = []
  for (const [index, file] of files.entries()) {
    if (file.size > MAX_REFERENCE_BYTES) {
      return problem(413, { error: "reference_too_large", message: "Референс больше 12 МБ." })
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    // Тип — по сигнатуре, а не по имени или Content-Type от клиента.
    const mimeType = sniffImageMime(bytes)
    if (!mimeType) return problem(415, { error: "unsupported_reference", message: "Референс должен быть PNG, JPEG или WEBP." })
    const extension = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg"
    const baseName = (file.name || `reference_${index + 1}`).replace(/[^A-Za-z0-9_-]/g, "_").replace(/\.[^.]*$/, "")
    references.push({ bytes, mimeType, name: `${baseName || `reference_${index + 1}`}.${extension}` })
  }

  try {
    const image = await provider.generate({ prompt: providerPrompt, aspect, references, signal: request.signal })
    const output = finalLongSide
      ? await resizeToLongSideLanczos(image.bytes, finalLongSide)
      : { bytes: image.bytes, mimeType: image.mimeType, width: undefined, height: undefined }
    return new Response(output.bytes as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": output.mimeType,
        "Cache-Control": "no-store",
        "X-Image-Provider": image.provider,
        "X-Image-Model": image.model,
        "X-Image-Endpoint": image.endpoint,
        "X-Image-Duration-Ms": String(image.durationMs),
        ...(finalLongSide
          ? {
              "X-Image-Postprocess": "lanczos3",
              "X-Image-Width": String(output.width),
              "X-Image-Height": String(output.height),
            }
          : {}),
      },
    })
  } catch (error) {
    if (error instanceof ImageProviderError) {
      console.error(`[api/images] ${error.provider} ${error.kind}${error.status ? ` http=${error.status}` : ""}: ${error.message}`)
      const status =
        error.kind === "quota" ? 402 : error.kind === "safety" ? 422 : error.kind === "timeout" ? 504 : 502
      return problem(status, { error: `provider_${error.kind}`, message: publicMessage(error), retryable: error.retryable })
    }
    console.error("[api/images] unexpected:", error)
    return problem(500, { error: "internal", message: "Генерация не удалась — попробуйте ещё раз." })
  }
}

/** Текст для карточки: без сырого тела ответа провайдера, но с понятной причиной. */
function publicMessage(error: ImageProviderError): string {
  const name = providerLabel(error.provider)
  const keyVariable = providerKeyVariable(error.provider)
  switch (error.kind) {
    case "auth":
      return error.status === 403
        ? `${name} отклонил доступ (HTTP 403): ключ ${keyVariable} отключён или не имеет доступа к модели. Подробности — в логах сервера.`
        : `${name} не принял ключ ${keyVariable} (HTTP 401) — проверьте его в переменных окружения.`
    case "quota":
      return `На счёте ${name} закончились средства — пополните баланс в кабинете и повторите.`
    case "safety":
      return `${name} отклонил задание по политике контента. Переформулируйте комментарий.`
    case "rate_limit":
      return `${name} ограничил частоту запросов. Подождите минуту и повторите.`
    case "timeout":
      return `${name} не ответил вовремя. Повторите — обычно помогает.`
    case "network":
      return `Нет связи с ${name}. Проверьте сеть и повторите.`
    case "bad_response":
      return `${name} вернул неожиданный ответ. Повторите ещё раз.`
    default:
      return `${name} временно недоступен. Повторите через минуту.`
  }
}
