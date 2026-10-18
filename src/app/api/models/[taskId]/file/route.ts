import { sessionFromRequest } from "@/server/auth"
import { getSql } from "@/server/db"
import { problem, streamBytes } from "@/server/http"
import { sniffImageMime } from "@/server/image-provider"
import {
  ASSEMBLED_CONTENT_TYPE,
  downloadMeshyModel,
  downloadMeshySplitGlb,
  downloadMeshyThumbnail,
  getMeshySplitTask,
  getMeshyTask,
  MeshyError,
  meshyConfigured,
  meshyErrorMessage,
  meshyErrorStatus,
  MODEL_CONTENT_TYPE,
  MODEL_FORMATS,
  type MeshyTask,
} from "@/server/meshy"
import { assembleModel, type AssembledModel } from "@/server/model-assembly"
import { sanitizeRootName } from "@/server/model-parts"
import { upsertAssetMeta } from "@/server/records"
import { objectKey, resolveStorage, type ObjectStorage } from "@/server/storage"
import { buildZip } from "@/server/zip"
import type { ModelFormat } from "@/types"

/**
 * Файл готовой задачи: `?format=glb` (по умолчанию), `fbx`, `obj` или `thumb` —
 * превью модели для библиотеки (ключ `${record}:thumb-result`). `kind=multi` —
 * задача из нескольких ракурсов.
 *
 * `split=<splitId>` (+ `width` в см и `name` — корень группы) — модель
 * собирается по деталям (`src/server/model-assembly.ts`): цельный GLB Meshy и
 * GLB разбиения скачиваются один раз, из них получаются GLB для вьюера, FBX и
 * OBJ (оба — ZIP с текстурами), все три сразу ложатся в хранилище. Заголовок
 * `X-Model-Parts` в ответе — JSON `{ parts, size }`; `X-Model-Split-Note` —
 * почему сборка не удалась, тогда отдаётся цельная модель Meshy, как раньше.
 *
 * Ссылки Meshy подписаны и без CORS, а ассеты хранятся 3 дня, поэтому файл
 * идёт через сервер и при первом запросе кладётся в наше хранилище под ключом
 * `${record}:model` (`:model-fbx`, `:model-obj`) — тем же, по которому клиент
 * потом читает его через `/api/assets` (lib/blob-store). Без входа и
 * хранилища (локальный режим) собранные файлы держатся в памяти процесса
 * четверть часа, чтобы три формата не собирались трижды.
 *
 * Ответ — поток: так он не упирается в потолок 4,5 МБ на тело ответа функции
 * Vercel.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 300

const TASK_ID = /^[A-Za-z0-9-]{8,64}$/
const RECORD_ID = /^[A-Za-z0-9_-]{1,64}$/
const DEFAULT_WIDTH_CM = 100
const ASSEMBLY_CACHE_MS = 15 * 60_000

interface AssembledFiles {
  files: Record<ModelFormat, Uint8Array>
  parts: AssembledModel["parts"]
  size: AssembledModel["size"]
}

/** Сборка в памяти процесса: один и тот же результат для трёх форматов и повторных запросов без хранилища. */
const assemblies = new Map<string, { at: number; pending: Promise<AssembledFiles> }>()

function partsHeader(result: AssembledFiles): Record<string, string> {
  // В заголовке только ASCII: имена объектов латиницей, классы — тоже.
  return { "X-Model-Parts": JSON.stringify({ parts: result.parts, size: result.size.map((v) => Math.round(v * 1000) / 1000) }) }
}

function stream(bytes: Uint8Array, contentType: string, extra: Record<string, string> = {}): Response {
  return streamBytes(bytes, { "Content-Type": contentType, "Cache-Control": "private, no-store", ...extra })
}

async function assemble(task: MeshyTask, splitId: string, options: { rootName: string; widthMeters: number }, signal?: AbortSignal): Promise<AssembledFiles> {
  const cacheKey = `${task.id}:${splitId}`
  for (const [key, entry] of assemblies) if (Date.now() - entry.at > ASSEMBLY_CACHE_MS) assemblies.delete(key)
  const cached = assemblies.get(cacheKey)
  if (cached) return cached.pending
  const pending = (async () => {
    const split = await getMeshySplitTask(splitId, signal)
    if (split.status !== "succeeded") throw new MeshyError(split.status === "failed" ? "bad_request" : "unavailable", split.error ?? "Разбиение ещё не готово.")
    const startedAt = Date.now()
    const [originalGlb, splitGlb] = await Promise.all([downloadMeshyModel(task, "glb", signal), downloadMeshySplitGlb(split, signal)])
    const assembled = await assembleModel(originalGlb, splitGlb, options)
    const files: Record<ModelFormat, Uint8Array> = { glb: assembled.previewGlb, fbx: buildZip(assembled.fbx), obj: buildZip(assembled.obj) }
    console.info(
      `[api/models] ${task.id} собрана по деталям за ${Date.now() - startedAt} ms: ${assembled.parts.map((part) => `${part.object} (${part.faces})`).join(", ")}`
    )
    return { files, parts: assembled.parts, size: assembled.size }
  })()
  assemblies.set(cacheKey, { at: Date.now(), pending })
  pending.catch(() => assemblies.delete(cacheKey))
  return pending
}

async function store(storage: ObjectStorage | null, ownerId: string | null, record: string, format: ModelFormat, bytes: Uint8Array, contentType: string) {
  if (!storage || !ownerId) return
  const key = format === "glb" ? `${record}:model` : `${record}:model-${format}`
  await storage.put(objectKey(ownerId, key), bytes, contentType)
  const sql = getSql()
  if (sql) await upsertAssetMeta(sql, ownerId, { key, recordId: record, contentType, bytes: bytes.byteLength })
}

export async function GET(request: Request, context: { params: Promise<{ taskId: string }> }) {
  if (!meshyConfigured()) {
    return problem(503, { error: "provider_not_configured", message: "Ключ MESHY_API_KEY не задан.", retryable: false })
  }
  const { taskId } = await context.params
  const query = new URL(request.url).searchParams
  const record = query.get("record") ?? ""
  const format = (query.get("format") ?? "glb") as ModelFormat | "thumb"
  const kind = query.get("kind") === "multi" ? "multi" : "image"
  const splitId = query.get("split") ?? ""
  if (!TASK_ID.test(taskId) || !RECORD_ID.test(record) || !(format === "thumb" || MODEL_FORMATS.includes(format)) || (splitId && !TASK_ID.test(splitId))) {
    return problem(400, { error: "bad_request", message: "Недопустимый id задачи, записи или формат." })
  }
  const widthCm = Number(query.get("width"))
  const assemblyOptions = {
    rootName: sanitizeRootName(query.get("name") ?? ""),
    widthMeters: (Number.isFinite(widthCm) && widthCm >= 5 && widthCm <= 1000 ? widthCm : DEFAULT_WIDTH_CM) / 100,
  }

  const session = await sessionFromRequest(request)
  const storage = session ? resolveStorage() : null
  const ownerId = session?.ownerId ?? null
  const key = format === "thumb" ? `${record}:thumb-result` : format === "glb" ? `${record}:model` : `${record}:model-${format}`

  try {
    if (storage && ownerId) {
      const stored = await storage.get(objectKey(ownerId, key))
      if (stored) return stream(stored.bytes, stored.contentType)
    }

    const task = await getMeshyTask(taskId, kind, request.signal)
    if (task.status !== "succeeded" || !task.glbUrl) {
      return problem(409, { error: "not_ready", message: task.error ?? "Модель ещё не готова.", retryable: task.status !== "failed" })
    }

    if (format === "thumb") {
      const bytes = await downloadMeshyThumbnail(task, request.signal)
      const contentType = sniffImageMime(bytes) ?? "image/png"
      if (storage && ownerId) {
        await storage.put(objectKey(ownerId, key), bytes, contentType)
        const sql = getSql()
        if (sql) await upsertAssetMeta(sql, ownerId, { key, recordId: record, contentType, bytes: bytes.byteLength })
      }
      return stream(bytes, contentType)
    }

    let splitNote = ""
    if (splitId) {
      try {
        const result = await assemble(task, splitId, assemblyOptions, request.signal)
        for (const item of MODEL_FORMATS) await store(storage, ownerId, record, item, result.files[item], ASSEMBLED_CONTENT_TYPE[item])
        if (storage) console.info(`[api/models] ${taskId} → ${storage.kind} ${record}:model*, детали: ${result.parts.length}`)
        return stream(result.files[format], ASSEMBLED_CONTENT_TYPE[format], partsHeader(result))
      } catch (error) {
        if (error instanceof MeshyError && error.retryable) throw error
        splitNote = error instanceof Error ? error.message : "Сборка деталей не удалась."
        console.warn(`[api/models] ${taskId} split ${splitId}: ${splitNote} — отдаём цельную модель`)
      }
    }

    const bytes = await downloadMeshyModel(task, format, request.signal)
    const contentType = MODEL_CONTENT_TYPE[format]
    await store(storage, ownerId, record, format, bytes, contentType)
    if (storage) console.info(`[api/models] ${taskId} → ${storage.kind} ${key}, ${(bytes.byteLength / 1024 / 1024).toFixed(1)} МБ, ${task.consumedCredits} кредитов`)
    return stream(bytes, contentType, splitNote ? { "X-Model-Split-Note": encodeURIComponent(splitNote) } : {})
  } catch (error) {
    if (error instanceof MeshyError) {
      console.error(`[api/models] file ${taskId} ${error.kind}${error.status ? ` http=${error.status}` : ""}: ${error.message}`)
      return problem(meshyErrorStatus(error), { error: `provider_${error.kind}`, message: meshyErrorMessage(error), retryable: error.retryable })
    }
    console.error("[api/models] file unexpected:", error)
    return problem(500, { error: "internal", message: "Не удалось получить модель." })
  }
}
