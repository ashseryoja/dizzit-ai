import { Readable } from "node:stream"

import { albumImageResolver } from "@/server/album-images"
import { loadAlbumImages, renderAlbumPdf } from "@/server/album-render"
import { isSameOrigin, problem } from "@/server/http"
import { sniffImageMime } from "@/server/image-provider"
import { parseAlbumSpec, type AlbumSpec } from "@/shared/album"

/**
 * Сборка альбома-презентации в PDF (`src/server/album-render.ts`).
 *
 * POST — спецификация альбома (`shared/album.ts`) → `application/pdf` потоком.
 * Тело — JSON со спецификацией или multipart: поле `spec` (JSON) и файлы под
 * ключами картинок. Картинки берутся из хранилища владельца по ключам
 * спецификации; файл из запроса под тем же ключом главнее — так альбом
 * собирается и в локальном режиме без сервера, и пока картинка ещё не
 * досинхронизировалась. Чего не нашлось — заглушка в PDF и заголовок
 * `X-Album-Missing` со списком ключей.
 *
 * Без входа (пароль не задан) хранилище не читается — только файлы из
 * запроса; с настроенным входом сессия обязательна, как у `/api/assets`.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 90

const MAX_INLINE_IMAGE_BYTES = 6 * 1024 * 1024
const MAX_INLINE_TOTAL_BYTES = 80 * 1024 * 1024

interface ParsedBody {
  spec: AlbumSpec
  inline: Map<string, Uint8Array>
}

async function parseBody(request: Request): Promise<ParsedBody | Response> {
  const type = request.headers.get("content-type") ?? ""
  if (type.includes("multipart/form-data")) {
    let form: FormData
    try {
      form = await request.formData()
    } catch {
      return problem(400, { error: "bad_request", message: "Не удалось прочитать multipart-тело." })
    }
    let raw: unknown
    try {
      raw = JSON.parse(String(form.get("spec") ?? ""))
    } catch {
      return problem(400, { error: "bad_request", message: "Поле spec должно быть JSON." })
    }
    const spec = parseAlbumSpec(raw)
    if (!spec) return problem(400, { error: "bad_request", message: "Спецификация альбома пуста." })
    const inline = new Map<string, Uint8Array>()
    let total = 0
    for (const [key, value] of form.entries()) {
      if (key === "spec" || !(value instanceof File)) continue
      if (value.size > MAX_INLINE_IMAGE_BYTES) return problem(413, { error: "image_too_large", message: `Картинка ${key} больше 6 МБ.` })
      total += value.size
      if (total > MAX_INLINE_TOTAL_BYTES) return problem(413, { error: "album_too_large", message: "Слишком много картинок в одном запросе." })
      const bytes = new Uint8Array(await value.arrayBuffer())
      if (!sniffImageMime(bytes)) return problem(415, { error: "unsupported_image", message: `Картинка ${key} должна быть PNG, JPEG или WEBP.` })
      inline.set(key, bytes)
    }
    return { spec, inline }
  }
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return problem(400, { error: "bad_request", message: "Ожидается JSON или multipart/form-data." })
  }
  const spec = parseAlbumSpec(raw)
  if (!spec) return problem(400, { error: "bad_request", message: "Спецификация альбома пуста." })
  return { spec, inline: new Map() }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return problem(403, { error: "forbidden_origin", message: "Запрос с чужого сайта." })
  const body = await parseBody(request)
  if (body instanceof Response) return body
  const resolve = await albumImageResolver(request, body.inline)
  if (resolve instanceof Response) return resolve

  try {
    const startedAt = Date.now()
    const { images, missing } = await loadAlbumImages(body.spec, resolve)
    const stream = await renderAlbumPdf(body.spec, images, new URL(request.url).origin)
    const fileName = encodeURIComponent(`${body.spec.title || "album"}.pdf`)
    console.info(`[api/album] ${images.size} картинок, ${missing.length} не найдено, подготовка ${Date.now() - startedAt} ms`)
    return new Response(Readable.toWeb(stream as Readable) as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename*=UTF-8''${fileName}`,
        "Cache-Control": "no-store",
        "X-Album-Missing": missing.join(","),
        "X-Album-Images": String(images.size),
      },
    })
  } catch (error) {
    console.error("[api/album] сборка не удалась:", error)
    return problem(500, { error: "render_failed", message: `Альбом не собрался: ${error instanceof Error ? error.message : "внутренняя ошибка"}.` })
  }
}
