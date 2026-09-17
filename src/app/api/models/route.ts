import { NextResponse } from "next/server"

import { serverConfig } from "@/server/config"
import { isSameOrigin, problem } from "@/server/http"
import { sniffImageMime } from "@/server/image-provider"
import { createMeshyTask, MeshyError, meshyConfigured, meshyErrorMessage, meshyErrorStatus } from "@/server/meshy"
import { describeModelSettings, modelMaxPhotos, normalizeModelSettings } from "@/shared/model3d"

/**
 * Серверный вход «Фото → 3D» — тонкий прокси к Meshy (`src/server/meshy.ts`),
 * прячущий ключ. Клиент — `src/lib/model-engine.ts`.
 *
 * GET  → статус: настроен ли ключ и какая модель.
 * POST → multipart: `image` — 1…4 файла (PNG/JPEG/WEBP, клиент уменьшает до
 *        2048 px; первый — главный вид, дальше ракурсы) и `settings` — JSON
 *        `ModelSettings` (`src/shared/model3d.ts`) → JSON `{ taskId, kind }`.
 *        Кредиты Meshy списываются здесь.
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
  let settingsInput: unknown = null
  try {
    settingsInput = JSON.parse(String(form.get("settings") ?? "null"))
  } catch {
    return problem(400, { error: "bad_request", message: "Настройки модели — не JSON." })
  }
  const settings = normalizeModelSettings(settingsInput)

  const files = form.getAll("image").filter((entry): entry is File => entry instanceof File)
  if (files.length === 0) return problem(400, { error: "bad_request", message: "Нет фото для модели." })
  if (files.length > modelMaxPhotos(settings)) {
    return problem(400, { error: "bad_request", message: "Несколько ракурсов принимает только флагманская модель." })
  }
  const photos: Uint8Array[] = []
  for (const file of files) {
    if (file.size > MAX_IMAGE_BYTES) return problem(413, { error: "reference_too_large", message: "Фото больше 12 МБ." })
    const bytes = new Uint8Array(await file.arrayBuffer())
    if (!sniffImageMime(bytes)) return problem(415, { error: "unsupported_reference", message: "Фото должно быть PNG, JPEG или WEBP." })
    photos.push(bytes)
  }

  try {
    const startedAt = Date.now()
    const task = await createMeshyTask(photos, settings, request.signal)
    console.info(
      `[api/models] meshy task ${task.id} (${task.kind}, ${photos.length} фото, ${describeModelSettings(settings)}) создана за ${Date.now() - startedAt} ms`
    )
    return NextResponse.json({ taskId: task.id, kind: task.kind }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof MeshyError) {
      console.error(`[api/models] meshy ${error.kind}${error.status ? ` http=${error.status}` : ""}: ${error.message}`)
      return problem(meshyErrorStatus(error), { error: `provider_${error.kind}`, message: meshyErrorMessage(error), retryable: error.retryable })
    }
    console.error("[api/models] unexpected:", error)
    return problem(500, { error: "internal", message: "Не удалось поставить задачу." })
  }
}
