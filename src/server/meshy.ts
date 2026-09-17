import "server-only"

import sharp from "sharp"

import { serverConfig } from "@/server/config"
import { buildZip } from "@/server/zip"
import { modelAiInfo, modelPolycount, type ModelSettings, type ModelTaskKind } from "@/shared/model3d"
import type { ModelFormat } from "@/types"

/**
 * Meshy AI — провайдер «Фото → 3D» (Image to 3D API, docs.meshy.ai).
 *
 * В отличие от провайдеров картинок задача здесь асинхронная: `createTask`
 * отдаёт id за секунду, модель считается 1–5 минут, готовность узнаётся
 * опросом `getTask`. Очереди и воркера на сервере пока нет
 * (docs/PLATFORM_ARCHITECTURE.md, этап 2), поэтому опрашивает клиент через
 * `/api/models/:taskId`, а сервер остаётся тонким прокси, прячущим ключ.
 *
 * Ссылки Meshy на результат подписаны и живут ограниченно, сами ассеты
 * хранятся 3 дня — файлы перекладываются в наше хранилище сразу по готовности
 * (`/api/models/:taskId/file`).
 *
 * Форматов три (`MODEL_FORMATS`): GLB — для вьюера в браузере, FBX и OBJ — для
 * 3ds Max, ArchiCAD, AutoCAD. OBJ у Meshy — три отдельных файла (геометрия,
 * материал, текстура), поэтому отдаётся одним ZIP. На цену число форматов не
 * влияет, только на время задачи.
 *
 * Настройки задачи — `ModelSettings` из `src/shared/model3d.ts`. Несколько
 * фото (главный вид + ракурсы) уходят в соседний эндпоинт Multi-Image to 3D;
 * какой из двух считает задачу, помнит запись (`ModelTaskKind`).
 */

const TASK_PATH: Record<ModelTaskKind, string> = { image: "/image-to-3d", multi: "/multi-image-to-3d" }

export const MODEL_FORMATS: readonly ModelFormat[] = ["glb", "fbx", "obj"]

export const MODEL_CONTENT_TYPE: Record<ModelFormat, string> = {
  glb: "model/gltf-binary",
  fbx: "application/octet-stream",
  obj: "application/zip",
}

export type MeshyErrorKind = "auth" | "quota" | "rate" | "bad_request" | "not_found" | "unavailable" | "timeout"

export class MeshyError extends Error {
  readonly kind: MeshyErrorKind
  readonly status?: number
  constructor(kind: MeshyErrorKind, message: string, status?: number) {
    super(message)
    this.name = "MeshyError"
    this.kind = kind
    this.status = status
  }
  /** Имеет ли смысл повторять тот же запрос без изменений. */
  get retryable(): boolean {
    return this.kind === "rate" || this.kind === "unavailable" || this.kind === "timeout"
  }
}

export type MeshyTaskStatus = "pending" | "running" | "succeeded" | "failed"

export interface MeshyTask {
  id: string
  status: MeshyTaskStatus
  /** 0…100. */
  progress: number
  /** Сколько задач впереди в очереди Meshy, пока статус `pending`. */
  queue: number
  glbUrl: string | null
  /** Подписанные ссылки Meshy на файлы результата; наружу не отдаются. */
  urls: { glb?: string; fbx?: string; obj?: string; mtl?: string; texture?: string; thumbnail?: string }
  error: string | null
  consumedCredits: number
}

/** Meshy сам оптимизирует картинку; больше 2048 px ему не нужно, а тело запроса растёт. */
const SOURCE_MAX_SIDE = 2048
const REQUEST_TIMEOUT_MS = 60_000
const DOWNLOAD_TIMEOUT_MS = 120_000
const MAX_MODEL_BYTES = 64 * 1024 * 1024

export function meshyConfigured(): boolean {
  return Boolean(serverConfig.meshyApiKey)
}

function kindOfStatus(status: number): MeshyErrorKind {
  if (status === 401 || status === 403) return "auth"
  if (status === 402) return "quota"
  if (status === 404) return "not_found"
  if (status === 429) return "rate"
  if (status >= 500) return "unavailable"
  return "bad_request"
}

async function call(path: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(`${serverConfig.meshyBaseUrl}${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${serverConfig.meshyApiKey}` },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      cache: "no-store",
    })
  } catch (error) {
    if (timeout.aborted) throw new MeshyError("timeout", "Meshy не ответил вовремя.")
    throw new MeshyError("unavailable", error instanceof Error ? error.message : "Нет связи с Meshy.")
  }
  const text = await response.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // Не JSON — ниже уйдёт текстом ошибки.
  }
  if (!response.ok) {
    const message =
      json && typeof json === "object" && "message" in json ? String((json as { message: unknown }).message) : text.slice(0, 300)
    throw new MeshyError(kindOfStatus(response.status), message || `HTTP ${response.status}`, response.status)
  }
  return json
}

/**
 * Фото → data-URI для Meshy. API принимает только JPEG и PNG, поэтому WEBP
 * перекодируется; прозрачность (вырезанный предмет) сохраняется в PNG.
 */
async function toDataUri(bytes: Uint8Array): Promise<string> {
  const image = sharp(bytes, { failOn: "none" }).rotate().resize({
    width: SOURCE_MAX_SIDE,
    height: SOURCE_MAX_SIDE,
    fit: "inside",
    withoutEnlargement: true,
  })
  const { hasAlpha } = await sharp(bytes, { failOn: "none" }).metadata()
  const encoded = hasAlpha ? await image.png().toBuffer() : await image.jpeg({ quality: 92 }).toBuffer()
  return `data:image/${hasAlpha ? "png" : "jpeg"};base64,${encoded.toString("base64")}`
}

/**
 * Поставить задачу. Кредиты списываются Meshy в этот момент. `photos` —
 * главный вид первым, дальше ракурсы; настройки уже приведены к возможностям
 * модели (`normalizeModelSettings`). Ремеш держит модель в пределах, которые
 * тянут браузер и Blob на 1 ГБ.
 */
export async function createMeshyTask(
  photos: Uint8Array[],
  settings: ModelSettings,
  signal?: AbortSignal
): Promise<{ id: string; kind: ModelTaskKind }> {
  const kind: ModelTaskKind = photos.length > 1 ? "multi" : "image"
  const images = await Promise.all(photos.map(toDataUri))
  const body = {
    ...(kind === "multi" ? { image_urls: images } : { image_url: images[0] }),
    // MESHY_AI_MODEL подменяет только флагман: так можно прибить версию, не трогая выбор пользователя.
    ai_model: settings.ai === "meshy-7" ? serverConfig.meshyModel : settings.ai,
    ...(settings.quality === "ultra" ? { ultra_mode: true } : {}),
    // Lite отклоняет сам параметр («only supported for meshy-6»), даже выключенный.
    ...(modelAiInfo(settings.ai).enhance ? { image_enhancement: settings.enhance } : {}),
    should_texture: settings.texture,
    ...(settings.texture ? { enable_pbr: settings.pbr } : {}),
    should_remesh: true,
    topology: "triangle",
    target_polycount: modelPolycount(settings),
    target_formats: MODEL_FORMATS,
  }
  const json = await call(TASK_PATH[kind], { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }, signal)
  const id = json && typeof json === "object" && "result" in json ? String((json as { result: unknown }).result) : ""
  if (!id) throw new MeshyError("unavailable", "Meshy не вернул id задачи.")
  return { id, kind }
}

interface RawTask {
  id?: string
  status?: string
  progress?: number
  preceding_tasks?: number
  consumed_credits?: number
  model_urls?: { glb?: string; fbx?: string; obj?: string; mtl?: string } | null
  texture_urls?: { base_color?: string }[] | null
  thumbnail_url?: string
  task_error?: { message?: string } | null
}

export async function getMeshyTask(taskId: string, kind: ModelTaskKind, signal?: AbortSignal): Promise<MeshyTask> {
  const raw = ((await call(`${TASK_PATH[kind]}/${encodeURIComponent(taskId)}`, { method: "GET" }, signal)) ?? {}) as RawTask
  const status: MeshyTaskStatus =
    raw.status === "SUCCEEDED"
      ? "succeeded"
      : raw.status === "FAILED" || raw.status === "CANCELED" || raw.status === "EXPIRED"
        ? "failed"
        : raw.status === "IN_PROGRESS"
          ? "running"
          : "pending"
  const glbUrl = raw.model_urls?.glb || null
  return {
    id: raw.id ?? taskId,
    status: status === "succeeded" && !glbUrl ? "failed" : status,
    progress: Math.max(0, Math.min(100, Math.round(raw.progress ?? 0))),
    queue: Math.max(0, raw.preceding_tasks ?? 0),
    glbUrl,
    urls: {
      glb: raw.model_urls?.glb || undefined,
      fbx: raw.model_urls?.fbx || undefined,
      obj: raw.model_urls?.obj || undefined,
      mtl: raw.model_urls?.mtl || undefined,
      texture: raw.texture_urls?.[0]?.base_color || undefined,
      thumbnail: raw.thumbnail_url || undefined,
    },
    error:
      raw.task_error?.message ||
      (raw.status === "CANCELED" ? "Задача отменена в Meshy." : status === "succeeded" && !glbUrl ? "Meshy не отдал GLB." : null),
    consumedCredits: raw.consumed_credits ?? 0,
  }
}

/** Скачать файл по подписанной ссылке Meshy. Ключ API в этот запрос не уходит. */
async function downloadMeshyFile(url: string, what: string, signal?: AbortSignal): Promise<Uint8Array> {
  let host = ""
  try {
    const parsed = new URL(url)
    if (parsed.protocol === "https:") host = parsed.hostname
  } catch {
    // Ниже — общий отказ.
  }
  const fake = serverConfig.meshyBaseUrl.startsWith("http://127.0.0.1")
  if (!fake && host !== "meshy.ai" && !host.endsWith(".meshy.ai")) {
    throw new MeshyError("unavailable", "Meshy вернул ссылку на неожиданный адрес.")
  }
  const timeout = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(url, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout, cache: "no-store" })
  } catch {
    throw new MeshyError(timeout.aborted ? "timeout" : "unavailable", `Не удалось скачать ${what} у Meshy.`)
  }
  if (!response.ok) throw new MeshyError(kindOfStatus(response.status), `Meshy не отдал ${what} (HTTP ${response.status}).`, response.status)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_MODEL_BYTES) {
    throw new MeshyError("unavailable", `Файл (${what}) пустой или больше 64 МБ.`)
  }
  return bytes
}

const decoder = new TextDecoder()
const encoder = new TextEncoder()
const safeName = (value: string, fallback: string) => (/^[\w.-]{1,80}$/.test(value) ? value : fallback)

/**
 * OBJ одним архивом: геометрия, материал и текстура. Имена внутри берутся из
 * самих файлов (`mtllib` в OBJ, `map_Kd` в MTL), чтобы ссылки совпали и модель
 * открылась с текстурой; если ссылок нет — дописываются.
 */
async function buildObjArchive(task: MeshyTask, signal?: AbortSignal): Promise<Uint8Array> {
  if (!task.urls.obj) throw new MeshyError("not_found", "У этой задачи нет файла OBJ.")
  const [objBytes, mtlBytes, textureBytes] = await Promise.all([
    downloadMeshyFile(task.urls.obj, "OBJ", signal),
    task.urls.mtl ? downloadMeshyFile(task.urls.mtl, "MTL", signal) : Promise.resolve(null),
    task.urls.texture ? downloadMeshyFile(task.urls.texture, "текстуру", signal) : Promise.resolve(null),
  ])
  if (!mtlBytes) return buildZip([{ name: "model.obj", bytes: objBytes }])

  // `mtllib` стоит в шапке OBJ — весь файл (мегабайты текста) разбирать незачем.
  const declared = /^mtllib\s+(\S+)/m.exec(decoder.decode(objBytes.subarray(0, 4096)))?.[1] ?? ""
  const mtlName = safeName(declared, "model.mtl")
  let obj = objBytes
  if (declared !== mtlName) {
    const header = encoder.encode(`mtllib ${mtlName}\n`)
    obj = new Uint8Array(header.length + objBytes.length)
    obj.set(header)
    obj.set(objBytes, header.length)
  }

  if (!textureBytes) return buildZip([{ name: "model.obj", bytes: obj }, { name: mtlName, bytes: mtlBytes }])

  let mtl = decoder.decode(mtlBytes)
  const mapped = /^\s*map_Kd\s+(?:-\S+\s+\S+\s+)*(\S+)\s*$/m.exec(mtl)?.[1] ?? ""
  const jpeg = textureBytes[0] === 0xff && textureBytes[1] === 0xd8
  const textureName = safeName(mapped, jpeg ? "texture.jpg" : "texture.png")
  if (mapped !== textureName) mtl = `${mtl.replace(/^\s*map_Kd\s.*$/gm, "").trimEnd()}\nmap_Kd ${textureName}\n`
  return buildZip([
    { name: "model.obj", bytes: obj },
    { name: mtlName, bytes: encoder.encode(mtl) },
    { name: textureName, bytes: textureBytes, compress: false },
  ])
}

/** Файл готовой задачи в нужном формате. OBJ — ZIP с материалом и текстурой. */
export async function downloadMeshyModel(task: MeshyTask, format: ModelFormat, signal?: AbortSignal): Promise<Uint8Array> {
  if (format === "obj") return buildObjArchive(task, signal)
  const url = task.urls[format]
  if (!url) throw new MeshyError("not_found", `У этой задачи нет файла ${format.toUpperCase()}.`)
  const bytes = await downloadMeshyFile(url, format.toUpperCase(), signal)
  // «glTF» в первых четырёх байтах — бинарный контейнер GLB.
  if (format === "glb" && !(bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46)) {
    throw new MeshyError("unavailable", "Meshy отдал файл, который не является GLB.")
  }
  return bytes
}

/** Превью готовой модели (рендер Meshy) — плитка библиотеки моделей. */
export async function downloadMeshyThumbnail(task: MeshyTask, signal?: AbortSignal): Promise<Uint8Array> {
  if (!task.urls.thumbnail) throw new MeshyError("not_found", "У этой задачи нет превью.")
  return downloadMeshyFile(task.urls.thumbnail, "превью", signal)
}

/** Текст ошибки для карточки модели. */
export function meshyErrorMessage(error: MeshyError): string {
  switch (error.kind) {
    case "auth":
      return "Meshy не принял ключ MESHY_API_KEY."
    case "quota":
      return "На счёте Meshy закончились кредиты."
    case "rate":
      return "Meshy просит подождать: слишком много запросов."
    case "not_found":
      return error.status ? "Задача не найдена в Meshy — возможно, истёк срок хранения." : error.message
    case "timeout":
      return "Meshy не ответил вовремя."
    case "bad_request":
      return `Meshy отклонил фото: ${error.message}`
    default:
      return "Meshy временно недоступен."
  }
}

export function meshyErrorStatus(error: MeshyError): number {
  return error.kind === "quota" ? 402 : error.kind === "not_found" ? 404 : error.kind === "timeout" ? 504 : error.kind === "bad_request" ? 422 : 502
}
