import { NextResponse } from "next/server"

import { isSameOrigin, problem } from "@/server/http"
import { ImageProviderError, sniffImageMime } from "@/server/image-provider"
import { providerKeyVariable, providerLabel, resolveVisionProvider, resolveVisionProviders } from "@/server/providers"
import { planShotList } from "@/server/shot-planner"
import { isFrameAspect } from "@/lib/frame-aspect"
import { PRESET_SLOTS } from "@/lib/view-presets"
import type { ViewPreset } from "@/types"

/**
 * Планировщик раскадровки для «Ракурсов и деталей»: рендер → список кадров
 * под этот интерьер от vision-модели (`src/server/shot-planner.ts`). Клиент
 * (`src/lib/shot-planning.ts`) подставляет задания кадров в промпты
 * gpt-image-2, и сет получается про эту сцену, а не по шаблону.
 *
 * GET  → статус: настроен ли планировщик, какой провайдер и модель.
 * POST → multipart: `image` (PNG/JPEG/WEBP до 12 МБ), `preset`
 *        (set | details | angles | fragments), `aspect` (9:16 | 16:9 | 4:3 |
 *        3:4 | 1:1), опционально `note` → JSON `{ frames, provider, model,
 *        durationMs }`.
 *
 * Планировщик — усилитель: без ключа роут отвечает 503, и клиент строит сет
 * по типовым кадрам набора.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 90

const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_NOTE_CHARS = 400

function parsePreset(value: FormDataEntryValue | null): ViewPreset | null {
  const text = String(value ?? "")
  return Object.prototype.hasOwnProperty.call(PRESET_SLOTS, text) ? (text as ViewPreset) : null
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
    return problem(503, { error: "provider_not_configured", message: "Планировщик кадров выключен или ключ провайдера не задан.", retryable: false })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return problem(400, { error: "bad_request", message: "Ожидается multipart/form-data." })
  }

  const preset = parsePreset(form.get("preset"))
  if (!preset) return problem(400, { error: "bad_request", message: "Неизвестный набор кадров." })
  const aspect = form.get("aspect")
  if (!isFrameAspect(aspect)) return problem(400, { error: "bad_request", message: "Неизвестный формат кадров." })
  const note = String(form.get("note") ?? "").slice(0, MAX_NOTE_CHARS)

  const file = form.get("image")
  if (!(file instanceof File)) return problem(400, { error: "bad_request", message: "Нет картинки для планировщика." })
  if (file.size > MAX_IMAGE_BYTES) return problem(413, { error: "reference_too_large", message: "Картинка больше 12 МБ." })
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mimeType = sniffImageMime(bytes)
  if (!mimeType) return problem(415, { error: "unsupported_reference", message: "Картинка должна быть PNG, JPEG или WEBP." })

  try {
    const result = await planShotList(providers, { bytes, mimeType }, { preset, aspect, note }, request.signal)
    console.info(
      `[api/shots] ${result.provider} ${result.model} ${result.durationMs} ms, tokens in=${result.inputTokens ?? "?"} out=${result.outputTokens ?? "?"}, ${preset} ${aspect}: ${result.proposed} предложено → ${result.frames.length} кадров${result.fallbacks ? `, после ${result.fallbacks} отказов` : ""}`
    )
    return NextResponse.json(
      { frames: result.frames, provider: result.provider, model: result.model, durationMs: result.durationMs },
      { headers: { "Cache-Control": "no-store", "X-Vision-Model": result.model, "X-Vision-Duration-Ms": String(result.durationMs) } }
    )
  } catch (error) {
    if (error instanceof ImageProviderError) {
      console.error(`[api/shots] ${error.provider} ${error.kind}${error.status ? ` http=${error.status}` : ""}: ${error.message}`)
      const status = error.kind === "quota" ? 402 : error.kind === "safety" ? 422 : error.kind === "timeout" ? 504 : 502
      const name = providerLabel(error.provider)
      const message =
        error.kind === "auth"
          ? `${name} не принял ключ ${providerKeyVariable(error.provider)} для vision-модели.`
          : error.kind === "quota"
            ? `На счёте ${name} закончились средства.`
            : `${name}: планировщик кадров не ответил (${error.kind}).`
      return problem(status, { error: `provider_${error.kind}`, message, retryable: error.retryable })
    }
    console.error("[api/shots] unexpected:", error)
    return problem(500, { error: "internal", message: "Планировщик кадров не ответил." })
  }
}
