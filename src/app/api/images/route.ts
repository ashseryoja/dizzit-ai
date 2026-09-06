import { NextResponse } from "next/server"

import {
  LaoZhangError,
  configuredImageModel,
  generateImage,
  isImageSize,
  readLaoZhangConfig,
  sniffImageMime,
  type ImageReference,
} from "@/server/laozhang"

/**
 * Единственный серверный вход генерации картинок — тонкий прокси, прячущий
 * ключ LaoZhang. Все инструменты (улучшение, перенос стиля, ракурсы,
 * материалы) ходят сюда через `src/lib/image-generation.ts`; промпт собирает
 * движок инструмента на клиенте, сюда приходят только текст, размер и
 * референсы.
 *
 * GET  → статус провайдера: настроен ли ключ и какая модель (без секретов).
 * POST → multipart: `prompt`, `size` (1024x1024 | 1536x1024 | 1024x1536),
 *        0…4 файлов `image` (PNG/JPEG/WEBP до 12 МБ каждый) → байты картинки.
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

export async function GET() {
  const config = readLaoZhangConfig()
  return NextResponse.json(
    { provider: "laozhang", configured: config !== null, model: config?.model ?? configuredImageModel() },
    { headers: { "Cache-Control": "no-store" } }
  )
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return problem(403, { error: "forbidden_origin", message: "Запрос с чужого сайта." })

  const config = readLaoZhangConfig()
  if (!config) {
    return problem(503, {
      error: "provider_not_configured",
      message: "Ключ LAOZHANG_API_KEY не задан — добавьте его в .env.local и перезапустите сервер.",
      retryable: false,
    })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return problem(400, { error: "bad_request", message: "Ожидается multipart/form-data." })
  }

  const prompt = String(form.get("prompt") ?? "").trim()
  if (!prompt) return problem(400, { error: "bad_request", message: "Пустой промпт." })
  if (prompt.length > MAX_PROMPT_CHARS) return problem(400, { error: "bad_request", message: "Слишком длинный промпт." })

  const size = form.get("size")
  if (!isImageSize(size)) return problem(400, { error: "bad_request", message: "Недопустимый размер картинки." })

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
    const image = await generateImage(config, { prompt, size, references, signal: request.signal })
    return new Response(image.bytes as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": image.mimeType,
        "Cache-Control": "no-store",
        "X-Image-Model": image.model,
        "X-Image-Endpoint": image.endpoint,
        "X-Image-Duration-Ms": String(image.durationMs),
      },
    })
  } catch (error) {
    if (error instanceof LaoZhangError) {
      console.error(`[api/images] ${error.kind}${error.status ? ` http=${error.status}` : ""}: ${error.message}`)
      const status = error.kind === "auth" ? 502 : error.kind === "safety" ? 422 : error.kind === "timeout" ? 504 : 502
      return problem(status, { error: `provider_${error.kind}`, message: publicMessage(error), retryable: error.retryable })
    }
    console.error("[api/images] unexpected:", error)
    return problem(500, { error: "internal", message: "Генерация не удалась — попробуйте ещё раз." })
  }
}

/** Текст для карточки: без сырого тела ответа провайдера, но с понятной причиной. */
function publicMessage(error: LaoZhangError): string {
  switch (error.kind) {
    case "auth":
      return "Провайдер отклонил ключ LAOZHANG_API_KEY — проверьте его в .env.local."
    case "safety":
      return "Провайдер отклонил задание по политике контента. Переформулируйте комментарий."
    case "rate_limit":
      return "Провайдер ограничил частоту запросов. Подождите минуту и повторите."
    case "timeout":
      return "Провайдер не ответил вовремя. Повторите — обычно помогает."
    case "network":
      return "Нет связи с провайдером. Проверьте сеть и повторите."
    case "bad_response":
      return "Провайдер вернул неожиданный ответ. Повторите ещё раз."
    default:
      return "Провайдер временно недоступен. Повторите через минуту."
  }
}
