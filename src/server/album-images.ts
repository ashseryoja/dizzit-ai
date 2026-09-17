import "server-only"

import sharp from "sharp"

import { sessionFromRequest, unauthorized } from "@/server/auth"
import { authConfigured } from "@/server/config"
import { getSql, type Sql } from "@/server/db"
import { listAssetKeysIn, upsertAssetMeta } from "@/server/records"
import { objectKey, resolveStorage, type ObjectStorage } from "@/server/storage"
import { PDF_IMAGE_MAX_SIDE, PDF_JPEG_QUALITY, pdfKey } from "@/shared/album"

/**
 * Картинки для альбома: откуда роуты берут байты и как готовятся копии для PDF.
 *
 * Оригиналы результатов — 2K PNG по 1,5–4 МБ, а в альбоме их десятки: качать
 * и уменьшать всё за один запрос — минуты, и клиент отваливается по таймауту.
 * Поэтому у каждой картинки есть **копия для PDF** — JPEG до 1800 px под
 * ключом `${id}:pdf-${роль}` в том же хранилище (`pdfKey`, shared/album.ts).
 * Копию делает браузер из своего кэша, когда оригинал у него есть (это
 * быстро: скачивать ничего не надо), иначе — сервер здесь, порциями в
 * `POST /api/album/prepare` (`prepareAlbumAssets`): вызов отвечает не позже
 * дедлайна и возвращает, что осталось, а начатые картинки дорабатываются в
 * фоне процесса; клиент зовёт его, пока список не опустеет, и показывает
 * прогресс. Сборка PDF читает только готовые копии — это секунды даже для
 * большого альбома, а повторная сборка того же альбома не качает оригиналы
 * вовсе. Копии числятся в таблице `assets` за своей записью, так что
 * удаление записи уносит и их.
 *
 * Резолвер сборки (`albumImageResolver`): файл из запроса (локальный режим
 * без сервера) → копия для PDF → оригинал из хранилища. Без настроенного входа
 * хранилище не читается; с настроенным — сессия обязательна, как у `/api/assets`.
 */

const PREPARE_CONCURRENCY = 3

export const ASSET_KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}:[a-z0-9-]{1,48}$/

export { pdfKey, PDF_IMAGE_MAX_SIDE }

export interface ResolvedImage {
  bytes: Uint8Array
  /** Уже копия для PDF: уменьшать и перекодировать не нужно. */
  prepared: boolean
}

export type ImageResolver = (key: string) => Promise<ResolvedImage | null>

interface OwnerContext {
  ownerId: string
  storage: ObjectStorage | null
  sql: Sql | null
}

/** Владелец и его хранилище по запросу; `Response` — отказ (нет сессии). */
export async function ownerContext(request: Request): Promise<OwnerContext | Response> {
  if (!authConfigured()) return { ownerId: "", storage: null, sql: null }
  const session = await sessionFromRequest(request)
  if (!session) return unauthorized()
  return { ownerId: session.ownerId, storage: resolveStorage(), sql: getSql() }
}

export async function albumImageResolver(request: Request, inline: ReadonlyMap<string, Uint8Array>): Promise<ImageResolver | Response> {
  const owner = await ownerContext(request)
  if (owner instanceof Response) return owner
  const { ownerId, storage } = owner
  return async (key) => {
    const own = inline.get(key)
    if (own) return { bytes: own, prepared: false }
    if (!storage || !ownerId) return null
    const prepared = await storage.get(objectKey(ownerId, pdfKey(key)))
    if (prepared) return { bytes: prepared.bytes, prepared: true }
    const original = await storage.get(objectKey(ownerId, key))
    return original ? { bytes: original.bytes, prepared: false } : null
  }
}

/** Копия для PDF из оригинала: не длиннее лимита, JPEG, sRGB, без альфы. */
export async function encodePdfCopy(bytes: Uint8Array, maxSide = PDF_IMAGE_MAX_SIDE): Promise<Buffer> {
  return sharp(bytes, { limitInputPixels: 100_000_000 })
    .autoOrient()
    .resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true, kernel: sharp.kernel.lanczos3 })
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .jpeg({ quality: Math.round(PDF_JPEG_QUALITY * 100), mozjpeg: true })
    .toBuffer()
}

export interface PrepareResult {
  /** Копии готовы (были или сделаны сейчас). */
  ready: string[]
  /** Не успели к дедлайну — клиент присылает их следующим вызовом. */
  pending: string[]
  /** Оригинала нет в хранилище — в PDF будет заглушка. */
  missing: string[]
}

export interface PrepareOptions {
  /** Не брать новые картинки в работу после этого времени. */
  budgetMs: number
  /** Ответить не позже; что не успело — в `pending`, работа над начатым продолжается в фоне. */
  deadlineMs: number
  /** Только сверить, что уже готово: ничего не качать и не писать. */
  dryRun?: boolean
}

/**
 * Подготовить копии для PDF по списку ключей. Готовые узнаются одним запросом
 * к учёту объектов; остальные — скачать оригинал, уменьшить, записать копию и
 * её учётную строку. Новая картинка не берётся после бюджета, а ответ уходит
 * не позже дедлайна: медленная сеть не превращается в таймаут у клиента.
 * Начатые к дедлайну картинки дорабатываются в фоне и к следующему вызову
 * уже числятся готовыми.
 */
export async function prepareAlbumAssets(owner: OwnerContext, keys: string[], options: PrepareOptions): Promise<PrepareResult> {
  const { ownerId, storage, sql } = owner
  const { budgetMs, deadlineMs, dryRun = false } = options
  const result: PrepareResult = { ready: [], pending: [], missing: [] }
  if (!storage || !ownerId) return { ...result, missing: keys }
  const startedAt = Date.now()
  // Что уже готово, узнаём одним запросом к учёту объектов, а не проверкой
  // каждого ключа в хранилище: у Blob каждая проверка — отдельный сетевой вызов.
  const known = sql ? new Set(await listAssetKeysIn(sql, ownerId, keys.map(pdfKey))) : null
  const queue: string[] = []
  for (const key of keys) {
    if (known?.has(pdfKey(key))) result.ready.push(key)
    else queue.push(key)
  }
  if (dryRun) return { ...result, pending: queue }

  let answered = false
  const inFlight = new Set<string>()
  const worker = async () => {
    while (queue.length > 0) {
      if (Date.now() - startedAt > budgetMs) return
      const key = queue.shift()!
      const copyKey = pdfKey(key)
      inFlight.add(key)
      try {
        if (!known && (await storage.has(objectKey(ownerId, copyKey)))) {
          if (!answered) result.ready.push(key)
          continue
        }
        const original = await storage.get(objectKey(ownerId, key))
        if (!original) {
          if (!answered) result.missing.push(key)
          continue
        }
        const copy = await encodePdfCopy(original.bytes)
        await storage.put(objectKey(ownerId, copyKey), copy, "image/jpeg")
        if (sql) await upsertAssetMeta(sql, ownerId, { key: copyKey, recordId: key.split(":")[0], contentType: "image/jpeg", bytes: copy.byteLength })
        if (!answered) result.ready.push(key)
      } catch (error) {
        console.warn(`[album/prepare] ${key}: ${error instanceof Error ? error.message : String(error)}`)
      } finally {
        inFlight.delete(key)
      }
    }
  }
  const work = Promise.all(Array.from({ length: Math.min(PREPARE_CONCURRENCY, queue.length) }, worker))
  const deadline = new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, deadlineMs - (Date.now() - startedAt))))
  await Promise.race([work, deadline])
  answered = true
  // Что не успело — в pending: и очередь, и картинки в полёте (они дойдут в фоне).
  result.pending.push(...inFlight, ...queue)
  return result
}
