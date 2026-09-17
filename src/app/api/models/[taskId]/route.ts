import { NextResponse } from "next/server"

import { problem } from "@/server/http"
import { getMeshyTask, MeshyError, meshyConfigured, meshyErrorMessage, meshyErrorStatus } from "@/server/meshy"

/**
 * Опрос задачи «Фото → 3D»: клиент (`src/lib/model-engine.ts`) зовёт раз в
 * несколько секунд, пока Meshy считает модель. Отдаёт только то, что нужно
 * карточке: статус, процент и очередь. Ссылка на GLB наружу не уходит — файл
 * забирается через `/api/models/:taskId/file`.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

const TASK_ID = /^[A-Za-z0-9-]{8,64}$/

export async function GET(request: Request, context: { params: Promise<{ taskId: string }> }) {
  if (!meshyConfigured()) {
    return problem(503, { error: "provider_not_configured", message: "Ключ MESHY_API_KEY не задан.", retryable: false })
  }
  const { taskId } = await context.params
  if (!TASK_ID.test(taskId)) return problem(400, { error: "bad_request", message: "Недопустимый id задачи." })

  try {
    const task = await getMeshyTask(taskId, request.signal)
    return NextResponse.json(
      { status: task.status, progress: task.progress, queue: task.queue, error: task.error, credits: task.consumedCredits },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    if (error instanceof MeshyError) {
      console.error(`[api/models] poll ${taskId} ${error.kind}${error.status ? ` http=${error.status}` : ""}: ${error.message}`)
      return problem(meshyErrorStatus(error), { error: `provider_${error.kind}`, message: meshyErrorMessage(error), retryable: error.retryable })
    }
    console.error("[api/models] poll unexpected:", error)
    return problem(500, { error: "internal", message: "Не удалось узнать статус задачи." })
  }
}
