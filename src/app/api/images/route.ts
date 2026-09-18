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
import { sessionFromRequest } from "@/server/auth"
import { getSql } from "@/server/db"
import { isSameOrigin, problem, streamBytes } from "@/server/http"
import { resizeToLongSideLanczos } from "@/server/image-postprocess"
import { describeIntendedProvider, providerKeyVariable, providerLabel, resolveImageProvider } from "@/server/providers"
import { upsertAssetMeta } from "@/server/records"
import { objectKey, resolveStorage } from "@/server/storage"

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
 *        цене пайплайна улучшения и `store_key` (`${id}:result`) — сервер сам
 *        кладёт результат в хранилище записи → байты картинки потоком,
 *        заголовок `X-Image-Stored: 1|0`.
 *
 * Очереди и воркера пока нет (см. docs/PLATFORM_ARCHITECTURE.md, этап 0):
 * запрос держится открытым всё время генерации, поэтому `maxDuration` —
 * потолок платформы, а не 10 секунд по умолчанию.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

/**
 * Потолок инструкции провайдеру. Промпт улучшения — это задание с блоком про
 * светильники (~13 тыс. символов), инвентарь сцены (до 3,6 тыс.), блок запретов,
 * а с правками дизайнера — ещё правила «удалить / добавить / заменить» (~3 тыс.)
 * и сам комментарий (до 5 тыс., `EDIT_COMMENT_MAX_LENGTH`): обычное улучшение —
 * ~18 тыс., правка по области — ~22 тыс., худший случай — ~27,5 тыс.
 * gpt-image-2 принимает до 32 тыс.; лимит здесь защищает от случайного мусора, а
 * не от длины задания. При 14 тыс. любая правка по отмеченной области упиралась
 * в него и не доходила до модели.
 */
const MAX_PROMPT_CHARS = 31_000
const MAX_REFERENCES = 4
const MAX_REFERENCE_BYTES = 12 * 1024 * 1024
const MIN_FINAL_LONG_SIDE = 512
const MAX_FINAL_LONG_SIDE = 4_096
/**
 * `store_key` — ключ результата записи (`${id}:result`): с ним сервер сам кладёт
 * готовую картинку в хранилище. 4K-результат весит 5–10 МБ и обратно через
 * `/api/assets` (тело запроса ≤ 4,5 МБ на Vercel) не пролезает — клиенту пришлось
 * бы ужимать его, и «облачная» копия переставала быть 4K.
 */
const STORE_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}:result$/

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

  const storeKey = String(form.get("store_key") ?? "").trim()
  if (storeKey && !STORE_KEY_PATTERN.test(storeKey)) {
    return problem(400, { error: "bad_request", message: "Недопустимый ключ результата." })
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
    // Полный результат — сразу в хранилище записи: без обратной загрузки с клиента.
    // Сбой хранилища генерацию не отменяет: клиент увидит `X-Image-Stored: 0` и
    // сохранит файл своим путём (с ужатием под лимит тела запроса).
    let stored = false
    if (storeKey) {
      try {
        const session = await sessionFromRequest(request)
        const storage = session ? resolveStorage() : null
        if (session && storage) {
          await storage.put(objectKey(session.ownerId, storeKey), output.bytes, output.mimeType)
          const sql = getSql()
          if (sql) {
            await upsertAssetMeta(sql, session.ownerId, {
              key: storeKey,
              recordId: storeKey.split(":")[0],
              contentType: output.mimeType,
              bytes: output.bytes.byteLength,
            })
          }
          stored = true
        }
      } catch (error) {
        console.error(`[api/images] не удалось сохранить ${storeKey} в хранилище:`, error)
      }
    }
    console.info(
      `[api/images] ${image.provider} ${image.endpoint} ${image.durationMs} мс → ${output.width ?? "?"}×${output.height ?? "?"}, ${(output.bytes.byteLength / 1024 / 1024).toFixed(1)} МБ${stored ? `, сохранён ${storeKey}` : ""}`
    )

    // Потоком: 4K-результат больше потолка Vercel в 4,5 МБ на тело ответа функции.
    return streamBytes(output.bytes, {
      "Content-Type": output.mimeType,
      "Cache-Control": "no-store",
      "X-Image-Provider": image.provider,
      "X-Image-Model": image.model,
      "X-Image-Endpoint": image.endpoint,
      "X-Image-Duration-Ms": String(image.durationMs),
      "X-Image-Stored": stored ? "1" : "0",
      ...(finalLongSide
        ? {
            "X-Image-Postprocess": "lanczos3",
            "X-Image-Width": String(output.width),
            "X-Image-Height": String(output.height),
          }
        : {}),
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
