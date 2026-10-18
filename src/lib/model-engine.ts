/**
 * Движок «Фото → 3D».
 *
 * С ключом Meshy (`/api/models`, серверный прокси — `src/server/meshy.ts`)
 * модель настоящая: фото уходит задачей, страница опрашивает её готовность и
 * забирает GLB. Ключа в браузере нет. Без ключа работает локальная заглушка:
 * форма подбирается из каркасной библиотеки по выбору пользователя, описанию и
 * имени файла — главная кнопка не остаётся без результата, а запись помечается
 * `engine: "preview"`.
 */

import { SHAPES, wireStats } from "@/lib/furniture-wire"
import { PREVIEW_ENGINE, prepareReference } from "@/lib/image-generation"
import type { ModelPart, ModelSettings, ModelStage, ModelTaskKind } from "@/shared/model3d"
import type { FurnitureShape, ModelFormat } from "@/types"

export type FurnitureOption = "auto" | FurnitureShape

/**
 * Форматы модели: GLB крутится во вьюере сразу по готовности, FBX и OBJ
 * докачиваются фоном — для 3ds Max, ArchiCAD, AutoCAD. Собранная по деталям
 * модель отдаёт FBX и OBJ архивами с текстурами; у старых записей FBX — один
 * файл (`downloadStoredModel` смотрит на тип блоба).
 */
export const MODEL_FORMATS: readonly ModelFormat[] = ["glb", "fbx", "obj"]
export const MODEL_FILE: Record<ModelFormat, { label: string; extension: string; mime: string }> = {
  glb: { label: "GLB", extension: "glb", mime: "model/gltf-binary" },
  fbx: { label: "FBX", extension: "fbx.zip", mime: "application/zip" },
  obj: { label: "OBJ", extension: "obj.zip", mime: "application/zip" },
}

/** Метка записи, посчитанной Meshy. */
export const MESHY_ENGINE = "meshy"
export { PREVIEW_ENGINE }

const KEYWORDS: Record<FurnitureShape, RegExp> = {
  chair: /стул|кресл|табурет|chair|stool|seat/i,
  table: /стол|table|desk/i,
  lamp: /ламп|светильн|торшер|бра|lamp|light/i,
  sofa: /диван|соф|couch|sofa/i,
  shelf: /полк|стеллаж|шкаф|этажерк|shelf|bookcase|cabinet/i,
}

/** Предмет: явный выбор → ключевые слова → устойчивый хеш имени файла. */
export function resolveShape(option: FurnitureOption, note: string, fileName: string): FurnitureShape {
  if (option !== "auto") return option
  const text = `${note} ${fileName}`
  for (const shape of SHAPES) if (KEYWORDS[shape].test(text)) return shape
  let hash = 0
  for (const char of fileName) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return SHAPES[hash % SHAPES.length]
}

export interface ModelBuildResult {
  vertexCount: number
  edgeCount: number
}

/** Имитация построения: пауза как у настоящей очереди, потом статистика каркаса. */
export async function buildModelLocally(shape: FurnitureShape): Promise<ModelBuildResult> {
  await new Promise((resolve) => setTimeout(resolve, 2200 + Math.random() * 900))
  return wireStats(shape)
}

/* ── Meshy ──────────────────────────────────────────────────────────── */

/**
 * Ошибка построения с текстом для карточки. `taskLost` — задача у провайдера
 * закончилась неудачей или пропала: «Повторить» должен ставить новую, а не
 * опрашивать прежнюю.
 */
export class ModelBuildError extends Error {
  readonly taskLost: boolean
  constructor(message: string, taskLost = false) {
    super(message)
    this.name = "ModelBuildError"
    this.taskLost = taskLost
  }
}

export interface ModelProviderStatus {
  configured: boolean
  model: string
}

export interface ModelTaskProgress {
  /** Что считается: сама модель или разбиение на детали. */
  stage: ModelStage
  /** 0…100. */
  progress: number
  /** Задач впереди в очереди Meshy. */
  queue: number
}

/** Задача разбиения на детали и подсказки для сборки файлов (хранятся в записи). */
export interface ModelSplitRef {
  id: string
  widthCm?: number
  rootName?: string
}

const STATUS_TTL_MS = 60_000
const POLL_INTERVAL_MS = 4_000
/** Meshy считает 1–5 минут; очередь в часы пик добавляет ещё. */
const POLL_LIMIT_MS = 25 * 60_000
/** Сколько сбоев сети подряд терпит опрос, прежде чем сдаться. */
const POLL_MAX_FAILURES = 6

let statusCache: { value: ModelProviderStatus; at: number } | null = null
let statusInFlight: Promise<ModelProviderStatus> | null = null

/** Настроен ли Meshy. Кэш на минуту. */
export function modelProviderStatus(force = false): Promise<ModelProviderStatus> {
  if (!force && statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) return Promise.resolve(statusCache.value)
  if (statusInFlight) return statusInFlight
  statusInFlight = fetch("/api/models", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`status ${response.status}`)
      const json = (await response.json()) as Partial<ModelProviderStatus>
      return { configured: Boolean(json.configured), model: String(json.model ?? "") }
    })
    .catch(() => ({ configured: false, model: "" }))
    .then((value) => {
      statusCache = { value, at: Date.now() }
      statusInFlight = null
      return value
    })
  return statusInFlight
}

async function problemOf(response: Response, fallback: string): Promise<{ message: string; retryable: boolean }> {
  try {
    const json = (await response.json()) as { message?: string; retryable?: boolean }
    return { message: json.message || fallback, retryable: json.retryable !== false }
  } catch {
    return { message: fallback, retryable: true }
  }
}

/** Длинная сторона фото: несколько ракурсов ужимаются сильнее — тело запроса на Vercel не больше 4,5 МБ. */
const SINGLE_PHOTO_SIDE = 2048
const MULTI_PHOTO_SIDE = 1536

/**
 * Поставить задачу Meshy. `photos` — главный вид первым, дальше ракурсы.
 * Кредиты списываются в этот момент.
 */
export async function submitModelTask(
  photos: Blob[],
  settings: ModelSettings,
  signal?: AbortSignal
): Promise<{ taskId: string; kind: ModelTaskKind }> {
  const form = new FormData()
  const side = photos.length > 1 ? MULTI_PHOTO_SIDE : SINGLE_PHOTO_SIDE
  for (const photo of photos) form.append("image", await prepareReference(photo, side), "photo")
  form.append("settings", JSON.stringify(settings))
  let response: Response
  try {
    response = await fetch("/api/models", { method: "POST", body: form, signal })
  } catch {
    throw new ModelBuildError("Нет связи с сервером — задача не поставлена.", true)
  }
  if (!response.ok) throw new ModelBuildError((await problemOf(response, "Не удалось поставить задачу.")).message, true)
  const { taskId, kind } = (await response.json()) as { taskId?: string; kind?: ModelTaskKind }
  if (!taskId) throw new ModelBuildError("Сервер не вернул id задачи.", true)
  return { taskId, kind: kind === "multi" ? "multi" : "image" }
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer)
        reject(new DOMException("Aborted", "AbortError"))
      },
      { once: true }
    )
  })

async function pollTask(url: string, stage: ModelStage, onProgress?: (progress: ModelTaskProgress) => void, signal?: AbortSignal): Promise<{ credits: number }> {
  const startedAt = Date.now()
  let failures = 0
  while (Date.now() - startedAt < POLL_LIMIT_MS) {
    let response: Response | null = null
    try {
      response = await fetch(url, { cache: "no-store", signal })
    } catch (error) {
      if (signal?.aborted) throw error
    }
    if (response?.ok) {
      failures = 0
      const task = (await response.json()) as {
        status: string
        progress?: number
        queue?: number
        error?: string | null
        credits?: number
      }
      if (task.status === "succeeded") return { credits: task.credits ?? 0 }
      if (task.status === "failed") {
        throw new ModelBuildError(task.error || (stage === "parts" ? "Meshy не смог разделить модель на детали." : "Meshy не смог построить модель по этому фото."), true)
      }
      onProgress?.({ stage, progress: task.progress ?? 0, queue: task.queue ?? 0 })
    } else {
      const problem = response ? await problemOf(response, "Не удалось узнать статус задачи.") : null
      if (problem && !problem.retryable) throw new ModelBuildError(problem.message, response?.status === 404)
      if (response?.status === 404) throw new ModelBuildError(problem?.message ?? "Задача не найдена.", true)
      failures += 1
      if (failures >= POLL_MAX_FAILURES) {
        throw new ModelBuildError(`${problem?.message ?? "Нет связи с сервером."} Задача продолжает считаться — нажмите «Повторить» позже.`)
      }
    }
    await sleep(POLL_INTERVAL_MS, signal)
  }
  throw new ModelBuildError("Meshy считает дольше обычного. Задача не потеряна — нажмите «Повторить» позже.")
}

/** Ждать готовности задачи. Сбой сети задачу не теряет: она считается у Meshy. */
export function awaitModelTask(
  taskId: string,
  kind: ModelTaskKind,
  onProgress?: (progress: ModelTaskProgress) => void,
  signal?: AbortSignal
): Promise<{ credits: number }> {
  return pollTask(`/api/models/${encodeURIComponent(taskId)}?kind=${kind}`, "model", onProgress, signal)
}

/**
 * Поставить разбиение готовой модели на детали (10 кредитов Meshy). `photo` —
 * главный вид для vision-подсказки: какие детали резать, реальная ширина,
 * имя группы. `taskLost` у ошибки — разбиение ставить нельзя (задача пропала
 * или Meshy отказал), модель остаётся цельной.
 */
export async function submitSplitTask(taskId: string, kind: ModelTaskKind, photo: Blob | null, signal?: AbortSignal): Promise<ModelSplitRef> {
  const form = new FormData()
  form.append("kind", kind)
  if (photo) form.append("image", await prepareReference(photo, SINGLE_PHOTO_SIDE), "photo")
  let response: Response
  try {
    response = await fetch(`/api/models/${encodeURIComponent(taskId)}/split`, { method: "POST", body: form, signal })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new ModelBuildError("Нет связи с сервером — разбиение на детали не поставлено.")
  }
  if (!response.ok) {
    const problem = await problemOf(response, "Не удалось поставить разбиение на детали.")
    throw new ModelBuildError(problem.message, !problem.retryable || response.status === 404 || response.status === 422)
  }
  const json = (await response.json()) as { splitId?: string; widthCm?: number | null; rootName?: string }
  if (!json.splitId) throw new ModelBuildError("Сервер не вернул id разбиения.", true)
  return { id: json.splitId, ...(json.widthCm ? { widthCm: json.widthCm } : {}), ...(json.rootName ? { rootName: json.rootName } : {}) }
}

/** Ждать готовности разбиения на детали. */
export function awaitSplitTask(
  taskId: string,
  splitId: string,
  onProgress?: (progress: ModelTaskProgress) => void,
  signal?: AbortSignal
): Promise<{ credits: number }> {
  return pollTask(`/api/models/${encodeURIComponent(taskId)}/split?id=${encodeURIComponent(splitId)}`, "parts", onProgress, signal)
}

export interface ModelFileResult {
  blob: Blob
  /** Детали собранной модели — только когда файл собран сейчас, из хранилища приходит один блоб. */
  parts?: ModelPart[]
  /** Ширина, высота, глубина, м. */
  size?: [number, number, number]
  /** Сборка по деталям не удалась — файл цельный, вот почему. */
  splitNote?: string
}

/**
 * Файл готовой задачи; сервер заодно кладёт его в своё хранилище под ключом
 * `modelKey(recordId, format)`. С `split` модель собирается по деталям
 * (GLB с объектами, FBX и OBJ — архивы с текстурами). `taskLost` у ошибки —
 * такого формата у задачи нет.
 */
export async function fetchModelFile(
  taskId: string,
  recordId: string,
  kind: ModelTaskKind,
  /** `thumb` — превью модели для библиотеки (кладётся под `thumbResultKey`). */
  format: ModelFormat | "thumb" = "glb",
  split?: ModelSplitRef,
  signal?: AbortSignal
): Promise<ModelFileResult> {
  let response: Response
  try {
    const query = new URLSearchParams({ record: recordId, format, kind })
    if (split) {
      query.set("split", split.id)
      if (split.widthCm) query.set("width", String(split.widthCm))
      if (split.rootName) query.set("name", split.rootName)
    }
    response = await fetch(`/api/models/${encodeURIComponent(taskId)}/file?${query}`, { cache: "no-store", signal })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new ModelBuildError("Модель готова, но скачать её не удалось — нажмите «Повторить».")
  }
  if (!response.ok) {
    const problem = await problemOf(response, "Модель готова, но скачать её не удалось.")
    throw new ModelBuildError(problem.message, response.status === 404)
  }
  const bytes = await response.blob()
  const result: ModelFileResult = { blob: format === "thumb" ? bytes : new Blob([bytes], { type: response.headers.get("Content-Type") || MODEL_FILE[format].mime }) }
  const header = response.headers.get("X-Model-Parts")
  if (header) {
    try {
      const parsed = JSON.parse(header) as { parts?: ModelPart[]; size?: [number, number, number] }
      if (Array.isArray(parsed.parts) && parsed.parts.length > 1) result.parts = parsed.parts
      if (Array.isArray(parsed.size) && parsed.size.length === 3) result.size = parsed.size
    } catch {
      // Без подписи деталей — просто файл.
    }
  }
  const note = response.headers.get("X-Model-Split-Note")
  if (note) result.splitNote = decodeURIComponent(note)
  return result
}

export interface GlbStats {
  vertexCount: number
  faceCount: number
}

/**
 * Вершины и треугольники из JSON-чанка GLB: суммы по примитивам мешей.
 * Нужны только для подписи — при любой странности отдаём нули.
 */
export async function readGlbStats(glb: Blob): Promise<GlbStats> {
  try {
    const header = new DataView(await glb.slice(0, 20).arrayBuffer())
    // magic «glTF», версия, длина; затем чанк: длина + тип «JSON».
    if (header.getUint32(0, true) !== 0x46546c67 || header.getUint32(16, true) !== 0x4e4f534a) return { vertexCount: 0, faceCount: 0 }
    const jsonLength = header.getUint32(12, true)
    const gltf = JSON.parse(await glb.slice(20, 20 + jsonLength).text()) as {
      accessors?: { count?: number }[]
      meshes?: { primitives?: { attributes?: { POSITION?: number }; indices?: number; mode?: number }[] }[]
    }
    let vertexCount = 0
    let faceCount = 0
    for (const mesh of gltf.meshes ?? []) {
      for (const primitive of mesh.primitives ?? []) {
        const vertices = gltf.accessors?.[primitive.attributes?.POSITION ?? -1]?.count ?? 0
        vertexCount += vertices
        if ((primitive.mode ?? 4) !== 4) continue
        const indices = primitive.indices === undefined ? vertices : (gltf.accessors?.[primitive.indices]?.count ?? 0)
        faceCount += Math.floor(indices / 3)
      }
    }
    return { vertexCount, faceCount }
  } catch {
    return { vertexCount: 0, faceCount: 0 }
  }
}
