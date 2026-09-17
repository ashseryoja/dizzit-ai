import { NextResponse } from "next/server"

import { serverConfig } from "@/server/config"
import { isSameOrigin, problem } from "@/server/http"
import { sniffImageMime } from "@/server/image-provider"
import { createMeshyTask, MeshyError, meshyConfigured, meshyErrorMessage, meshyErrorStatus } from "@/server/meshy"

/**
 * Серверный вход «Фото → 3D» — тонкий прокси к Meshy (`src/server/meshy.ts`),
 * прячущий ключ. Клиент — `src/lib/model-engine.ts`.
 *
 * GET  → статус: настроен ли ключ и какая модель.
 * POST → multipart: `image` (PNG/JPEG/WEBP, клиент уменьшает до 2048 px) →
 *        JSON `{ taskId }`. Кредиты Meshy списываются здесь.
 *
 * Дальше клиент опрашивает `/api/models/:taskId` и забирает GLB через
 * `/api/models/:taskId/file`.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

const MAX_IMAGE_BYTES = 12 * 1024 * 1024

export async function GET() {
  return NextResponse.json(
    { configured: meshyConfigured(), provider: "meshy", model: meshyConfigured() ? serverConfig.meshyModel : "" },
    { headers: { "Cache-Control": "no-store" } }
  )
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return problem(403, { error: "forbidden_origin", message: "Запрос с чужого сайта." })
  if (!meshyConfigured()) {
    return problem(503, { error: "provider_not_configured", message: "Ключ MESHY_API_KEY не задан.", retryable: false })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return problem(400, { error: "bad_request", message: "Ожидается multipart/form-data." })
  }
  const file = form.get("image")
  if (!(file instanceof File)) return problem(400, { error: "bad_request", message: "Нет фото для модели." })
  if (file.size > MAX_IMAGE_BYTES) return problem(413, { error: "reference_too_large", message: "Фото больше 12 МБ." })
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!sniffImageMime(bytes)) return problem(415, { error: "unsupported_reference", message: "Фото должно быть PNG, JPEG или WEBP." })

  try {
    const startedAt = Date.now()
    const taskId = await createMeshyTask(bytes, request.signal)
    console.info(`[api/models] meshy ${serverConfig.meshyModel} task ${taskId} создана за ${Date.now() - startedAt} ms`)
    return NextResponse.json({ taskId }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof MeshyError) {
      console.error(`[api/models] meshy ${error.kind}${error.status ? ` http=${error.status}` : ""}: ${error.message}`)
      return problem(meshyErrorStatus(error), { error: `provider_${error.kind}`, message: meshyErrorMessage(error), retryable: error.retryable })
    }
    console.error("[api/models] unexpected:", error)
    return problem(500, { error: "internal", message: "Не удалось поставить задачу." })
  }
}
