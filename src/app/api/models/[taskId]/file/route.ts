import { sessionFromRequest } from "@/server/auth"
import { getSql } from "@/server/db"
import { problem } from "@/server/http"
import {
  downloadMeshyModel,
  getMeshyTask,
  MeshyError,
  meshyConfigured,
  meshyErrorMessage,
  meshyErrorStatus,
  MODEL_CONTENT_TYPE,
  MODEL_FORMATS,
} from "@/server/meshy"
import { upsertAssetMeta } from "@/server/records"
import { objectKey, resolveStorage } from "@/server/storage"
import type { ModelFormat } from "@/types"

/**
 * Файл готовой задачи: `?format=glb` (по умолчанию), `fbx` или `obj` (ZIP с
 * материалом и текстурой). Ссылки Meshy подписаны и без CORS, а ассеты
 * хранятся 3 дня, поэтому файл идёт через сервер: при первом запросе
 * скачивается у Meshy и кладётся в наше хранилище под ключом `${record}:model`
 * (`:model-fbx`, `:model-obj`) — тем же, по которому клиент потом читает его
 * через `/api/assets` (lib/blob-store). Без входа и хранилища (локальный
 * режим) файл просто проксируется.
 *
 * Ответ — поток: так он не упирается в потолок 4,5 МБ на тело ответа функции
 * Vercel.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

const TASK_ID = /^[A-Za-z0-9-]{8,64}$/
const RECORD_ID = /^[A-Za-z0-9_-]{1,64}$/
const CHUNK_BYTES = 256 * 1024

function stream(bytes: Uint8Array, contentType: string): Response {
  let offset = 0
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close()
        return
      }
      controller.enqueue(bytes.subarray(offset, offset + CHUNK_BYTES))
      offset += CHUNK_BYTES
    },
  })
  return new Response(body, { status: 200, headers: { "Content-Type": contentType, "Cache-Control": "private, no-store" } })
}

export async function GET(request: Request, context: { params: Promise<{ taskId: string }> }) {
  if (!meshyConfigured()) {
    return problem(503, { error: "provider_not_configured", message: "Ключ MESHY_API_KEY не задан.", retryable: false })
  }
  const { taskId } = await context.params
  const query = new URL(request.url).searchParams
  const record = query.get("record") ?? ""
  const format = (query.get("format") ?? "glb") as ModelFormat
  if (!TASK_ID.test(taskId) || !RECORD_ID.test(record) || !MODEL_FORMATS.includes(format)) {
    return problem(400, { error: "bad_request", message: "Недопустимый id задачи, записи или формат." })
  }
  const contentType = MODEL_CONTENT_TYPE[format]

  const session = await sessionFromRequest(request)
  const storage = session ? resolveStorage() : null
  const key = format === "glb" ? `${record}:model` : `${record}:model-${format}`

  try {
    if (session && storage) {
      const stored = await storage.get(objectKey(session.ownerId, key))
      if (stored) return stream(stored.bytes, contentType)
    }

    const task = await getMeshyTask(taskId, request.signal)
    if (task.status !== "succeeded" || !task.glbUrl) {
      return problem(409, { error: "not_ready", message: task.error ?? "Модель ещё не готова.", retryable: task.status !== "failed" })
    }
    const bytes = await downloadMeshyModel(task, format, request.signal)

    if (session && storage) {
      await storage.put(objectKey(session.ownerId, key), bytes, contentType)
      const sql = getSql()
      if (sql) await upsertAssetMeta(sql, session.ownerId, { key, recordId: record, contentType, bytes: bytes.byteLength })
      console.info(`[api/models] ${taskId} → ${storage.kind} ${key}, ${(bytes.byteLength / 1024 / 1024).toFixed(1)} МБ, ${task.consumedCredits} кредитов`)
    }
    return stream(bytes, contentType)
  } catch (error) {
    if (error instanceof MeshyError) {
      console.error(`[api/models] file ${taskId} ${error.kind}${error.status ? ` http=${error.status}` : ""}: ${error.message}`)
      return problem(meshyErrorStatus(error), { error: `provider_${error.kind}`, message: meshyErrorMessage(error), retryable: error.retryable })
    }
    console.error("[api/models] file unexpected:", error)
    return problem(500, { error: "internal", message: "Не удалось получить модель." })
  }
}
