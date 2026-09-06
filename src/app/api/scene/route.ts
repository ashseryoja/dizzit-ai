import { NextResponse } from "next/server"

import { isSameOrigin, problem } from "@/server/http"
import { ImageProviderError, sniffImageMime } from "@/server/image-provider"
import { providerKeyVariable, providerLabel, resolveVisionProvider, resolveVisionProviders } from "@/server/providers"
import { analyzeScene } from "@/server/scene-inventory"
import type { EnhanceContext } from "@/types"

/**
 * Разбор сцены перед улучшением рендера: картинка → текстовый инвентарь
 * предметов от vision-модели (`src/server/scene-inventory.ts`). Клиент
 * (`src/lib/scene-analysis.ts`) вставляет его в промпт gpt-image-2, чтобы
 * генератор знал, что телевизор — это выключенный экран, а не окно.
 *
 * GET  → статус: настроен ли разбор, какой провайдер и модель.
 * POST → multipart: `image` (PNG/JPEG/WEBP до 12 МБ), опционально `context`
 *        (auto | interior | exterior | product) → JSON `{ inventory, provider,
 *        model, durationMs }`.
 *
 * Разбор — усилитель, а не зависимость: без ключа роут отвечает 503, и клиент
 * молча продолжает улучшение без инвентаря.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const CONTEXTS: readonly EnhanceContext[] = ["auto", "interior", "exterior", "product"]

function parseContext(value: FormDataEntryValue | null): EnhanceContext | null {
  if (value === null || value === "") return "auto"
  return (CONTEXTS as readonly string[]).includes(String(value)) ? (String(value) as EnhanceContext) : null
}

export async function GET() {
  const provider = resolveVisionProvider()
  return NextResponse.json(
    { configured: provider !== null, provider: provider?.id ?? "", model: provider?.model ?? "" },
    { headers: { "Cache-Control": "no-store" } }
  )
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return problem(403, { error: "forbidden_origin", message: "Запрос с чужого сайта." })

  const providers = resolveVisionProviders()
  if (providers.length === 0) {
    return problem(503, { error: "provider_not_configured", message: "Разбор сцены выключен или ключ провайдера не задан.", retryable: false })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return problem(400, { error: "bad_request", message: "Ожидается multipart/form-data." })
  }

  const context = parseContext(form.get("context"))
  if (!context) return problem(400, { error: "bad_request", message: "Неизвестный контекст сцены." })

  const file = form.get("image")
  if (!(file instanceof File)) return problem(400, { error: "bad_request", message: "Нет картинки для разбора." })
  if (file.size > MAX_IMAGE_BYTES) return problem(413, { error: "reference_too_large", message: "Картинка больше 12 МБ." })
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mimeType = sniffImageMime(bytes)
  if (!mimeType) return problem(415, { error: "unsupported_reference", message: "Картинка должна быть PNG, JPEG или WEBP." })

  try {
    const result = await analyzeScene(providers, { bytes, mimeType }, context, request.signal)
    console.info(
      `[api/scene] ${result.provider} ${result.model} ${result.durationMs} ms, tokens in=${result.inputTokens ?? "?"} out=${result.outputTokens ?? "?"}, ${result.inventory.length} chars${result.fallbacks ? `, после ${result.fallbacks} отказов` : ""}`
    )
    return NextResponse.json(
      { inventory: result.inventory, provider: result.provider, model: result.model, durationMs: result.durationMs },
      { headers: { "Cache-Control": "no-store", "X-Vision-Model": result.model, "X-Vision-Duration-Ms": String(result.durationMs) } }
    )
  } catch (error) {
    if (error instanceof ImageProviderError) {
      console.error(`[api/scene] ${error.provider} ${error.kind}${error.status ? ` http=${error.status}` : ""}: ${error.message}`)
      const status = error.kind === "quota" ? 402 : error.kind === "safety" ? 422 : error.kind === "timeout" ? 504 : 502
      const name = providerLabel(error.provider)
      const message =
        error.kind === "auth"
          ? `${name} не принял ключ ${providerKeyVariable(error.provider)} для vision-модели.`
          : error.kind === "quota"
            ? `На счёте ${name} закончились средства.`
            : `${name}: разбор сцены не удался (${error.kind}).`
      return problem(status, { error: `provider_${error.kind}`, message, retryable: error.retryable })
    }
    console.error("[api/scene] unexpected:", error)
    return problem(500, { error: "internal", message: "Разбор сцены не удался." })
  }
}
