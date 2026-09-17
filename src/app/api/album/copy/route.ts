import { NextResponse } from "next/server"

import { ALBUM_FACT_MAX_CHARS, writeAlbumCopy } from "@/server/album-copy"
import { albumImageResolver } from "@/server/album-images"
import { isSameOrigin, problem } from "@/server/http"
import { ImageProviderError, sniffImageMime } from "@/server/image-provider"
import { providerKeyVariable, providerLabel, resolveVisionProvider, resolveVisionProviders } from "@/server/providers"
import { parseAlbumSpec } from "@/shared/album"

/**
 * Тексты альбома от ИИ (`src/server/album-copy.ts`).
 *
 * GET  → статус: настроена ли модель, какая.
 * POST → JSON `{ spec, facts, coverImage? }`: спецификация альбома, факты по
 *        ключам картинок и, в локальном режиме без сервера, обложка data-URL
 *        (иначе она берётся из хранилища по `spec.coverKey`) →
 *        `{ copy, provider, model, durationMs }`.
 *
 * Как и разбор сцены — усилитель: без ключа 503, альбом собирается с
 * подписями-заготовками.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

const MAX_COVER_DATA_URL = 3 * 1024 * 1024
const MAX_FACTS = 120

export async function GET() {
  const provider = resolveVisionProvider()
  return NextResponse.json(
    { configured: provider !== null, provider: provider?.id ?? "", model: provider?.model ?? "" },
    { headers: { "Cache-Control": "no-store" } }
  )
}

function parseDataUrl(value: unknown): Uint8Array | null {
  if (typeof value !== "string" || value.length > MAX_COVER_DATA_URL) return null
  const match = /^data:image\/[a-z]+;base64,(.+)$/i.exec(value)
  if (!match) return null
  const bytes = new Uint8Array(Buffer.from(match[1], "base64"))
  return sniffImageMime(bytes) ? bytes : null
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return problem(403, { error: "forbidden_origin", message: "Запрос с чужого сайта." })
  const providers = resolveVisionProviders()
  if (providers.length === 0) {
    return problem(503, { error: "provider_not_configured", message: "Тексты от ИИ выключены или ключ провайдера не задан.", retryable: false })
  }

  let body: { spec?: unknown; facts?: unknown; coverImage?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return problem(400, { error: "bad_request", message: "Ожидается JSON." })
  }
  const spec = parseAlbumSpec(body.spec)
  if (!spec) return problem(400, { error: "bad_request", message: "Спецификация альбома пуста." })
  const facts: Record<string, string> = {}
  if (body.facts && typeof body.facts === "object") {
    for (const [key, value] of Object.entries(body.facts as Record<string, unknown>).slice(0, MAX_FACTS)) {
      if (typeof value === "string" && value.trim()) facts[key] = value.slice(0, ALBUM_FACT_MAX_CHARS)
    }
  }

  // Обложка: из запроса (локальный режим) или из хранилища владельца.
  let cover: { bytes: Uint8Array } | null = null
  const inlineCover = parseDataUrl(body.coverImage)
  if (spec.coverKey) {
    const resolve = await albumImageResolver(request, inlineCover ? new Map([[spec.coverKey, inlineCover]]) : new Map())
    if (resolve instanceof Response) return resolve
    const resolved = await resolve(spec.coverKey).catch(() => null)
    if (resolved) cover = { bytes: resolved.bytes }
  }

  try {
    const result = await writeAlbumCopy(providers, { spec, facts }, cover, request.signal)
    console.info(`[api/album/copy] ${result.provider} ${result.model} ${result.durationMs} ms, подписей ${Object.keys(result.copy.captions).length}`)
    return NextResponse.json({ copy: result.copy, provider: result.provider, model: result.model, durationMs: result.durationMs }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof ImageProviderError) {
      console.error(`[api/album/copy] ${error.provider} ${error.kind}${error.status ? ` http=${error.status}` : ""}: ${error.message}`)
      const status = error.kind === "quota" ? 402 : error.kind === "safety" ? 422 : error.kind === "timeout" ? 504 : 502
      const name = providerLabel(error.provider)
      const message =
        error.kind === "auth"
          ? `${name} не принял ключ ${providerKeyVariable(error.provider)}.`
          : error.kind === "quota"
            ? `На счёте ${name} закончились средства.`
            : `${name}: тексты не написались (${error.kind}).`
      return problem(status, { error: `provider_${error.kind}`, message, retryable: error.retryable })
    }
    console.error("[api/album/copy] unexpected:", error)
    return problem(500, { error: "internal", message: `Тексты не написались: ${error instanceof Error ? error.message : "внутренняя ошибка"}.` })
  }
}
