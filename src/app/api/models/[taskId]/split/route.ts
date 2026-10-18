import { NextResponse } from "next/server"

import { isSameOrigin, problem } from "@/server/http"
import { sniffImageMime } from "@/server/image-provider"
import {
  createMeshySplitTask,
  getMeshySplitTask,
  getMeshyTask,
  MeshyError,
  meshyConfigured,
  meshyErrorMessage,
  meshyErrorStatus,
} from "@/server/meshy"
import { describeFurnitureParts, sanitizeRootName } from "@/server/model-parts"

/**
 * Разбиение готовой модели «Фото → 3D» на детали — второй, обязательный этап
 * после Image to 3D (см. `src/server/model-assembly.ts`, почему без него
 * модель бесполезна дизайнеру).
 *
 * POST multipart: `kind` (`image` | `multi`) и `image` — фото предмета для
 *      vision-подсказки (какие детали резать, реальная ширина, имя). Ставит
 *      задачу Auto Split у Meshy (10 кредитов) → JSON `{ splitId, widthCm,
 *      rootName, parts }`. Без фото или vision-провайдера Meshy режет сам.
 * GET  `?id=<splitId>` → статус и процент, как у `/api/models/:taskId`.
 *
 * Файлы потом забираются через `/api/models/:taskId/file?split=<splitId>`.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 120

const TASK_ID = /^[A-Za-z0-9-]{8,64}$/
const MAX_IMAGE_BYTES = 12 * 1024 * 1024

function providerProblem(scope: string, taskId: string, error: unknown) {
  if (error instanceof MeshyError) {
    console.error(`[api/models] ${scope} ${taskId} ${error.kind}${error.status ? ` http=${error.status}` : ""}: ${error.message}`)
    return problem(meshyErrorStatus(error), { error: `provider_${error.kind}`, message: meshyErrorMessage(error), retryable: error.retryable })
  }
  console.error(`[api/models] ${scope} unexpected:`, error)
  return null
}

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  if (!isSameOrigin(request)) return problem(403, { error: "forbidden_origin", message: "Запрос с чужого сайта." })
  if (!meshyConfigured()) {
    return problem(503, { error: "provider_not_configured", message: "Ключ MESHY_API_KEY не задан.", retryable: false })
  }
  const { taskId } = await context.params
  if (!TASK_ID.test(taskId)) return problem(400, { error: "bad_request", message: "Недопустимый id задачи." })

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return problem(400, { error: "bad_request", message: "Ожидается multipart/form-data." })
  }
  const kind = form.get("kind") === "multi" ? "multi" : "image"
  const file = form.get("image")
  let photo: { bytes: Uint8Array; mimeType: string } | null = null
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_IMAGE_BYTES) return problem(413, { error: "reference_too_large", message: "Фото больше 12 МБ." })
    const bytes = new Uint8Array(await file.arrayBuffer())
    const mimeType = sniffImageMime(bytes)
    if (mimeType) photo = { bytes, mimeType }
  }

  try {
    const task = await getMeshyTask(taskId, kind, request.signal)
    if (task.status !== "succeeded") {
      return problem(409, { error: "not_ready", message: task.error ?? "Модель ещё не готова.", retryable: task.status !== "failed" })
    }
    const startedAt = Date.now()
    const hint = photo ? await describeFurnitureParts(photo, request.signal) : null
    const splitId = await createMeshySplitTask(taskId, hint?.parts ?? null, request.signal)
    console.info(`[api/models] split ${splitId} для ${taskId} (${hint ? `${hint.parts.length} деталей по подсказке` : "авто"}) поставлена за ${Date.now() - startedAt} ms`)
    return NextResponse.json(
      { splitId, widthCm: hint?.widthCm ?? null, rootName: sanitizeRootName(hint?.name ?? ""), parts: hint?.parts ?? [] },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    return providerProblem("split", taskId, error) ?? problem(500, { error: "internal", message: "Не удалось поставить разбиение на детали." })
  }
}

export async function GET(request: Request, context: { params: Promise<{ taskId: string }> }) {
  if (!meshyConfigured()) {
    return problem(503, { error: "provider_not_configured", message: "Ключ MESHY_API_KEY не задан.", retryable: false })
  }
  const { taskId } = await context.params
  const splitId = new URL(request.url).searchParams.get("id") ?? ""
  if (!TASK_ID.test(taskId) || !TASK_ID.test(splitId)) return problem(400, { error: "bad_request", message: "Недопустимый id задачи." })
  try {
    const task = await getMeshySplitTask(splitId, request.signal)
    return NextResponse.json(
      { status: task.status, progress: task.progress, queue: task.queue, error: task.error, credits: task.consumedCredits, parts: task.partCount },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    return providerProblem("split poll", splitId, error) ?? problem(500, { error: "internal", message: "Не удалось узнать статус разбиения." })
  }
}
