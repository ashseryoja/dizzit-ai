"use client"

import { useEffect, useState } from "react"
import type { StoreApi } from "zustand"

import { getLocalBlob } from "@/lib/blob-store"

/**
 * Синхронизация с сервером — одно место для всех сторов и блобов.
 *
 * Пока сервер не настроен (нет входа, базы или хранилища), модуль молчит, и
 * приложение живёт в браузере, как раньше. Когда `persistence` включено:
 *
 * - записи сторов (`records`) при гидрации сливаются с серверными: сервер —
 *   источник правды по составу, локальная запись «в работе» (processing) не
 *   затирается; локальные записи, которых на сервере нет и не было, уезжают
 *   на сервер вместе с блобами (миграция старой галереи); записи, которые на
 *   сервере были и исчезли (удалены с другого устройства), удаляются и здесь;
 * - дальше каждое изменение стора уходит PUT/DELETE через очередь с повтором;
 * - блобы: `putBlob` дублирует объект на сервер, `getBlob` при промахе кэша
 *   тянет его с сервера и кладёт в IndexedDB, `deleteBlobs` удаляет и там.
 *
 * Ключи блобов на сервере те же, что в IndexedDB (`${id}:${role}`).
 */

export type Collection = "projects" | "enhancements" | "restyles" | "views" | "materials" | "models" | "albums"

export interface ServerStatus {
  authConfigured: boolean
  signedIn: boolean
  database: boolean
  storage: string | null
  /** Вход + база + хранилище: можно синхронизировать. */
  persistence: boolean
}

export interface SyncableRecord {
  id: string
  createdAt: string
  status?: string
}

const OFFLINE: ServerStatus = { authConfigured: false, signedIn: false, database: false, storage: null, persistence: false }

const STATUS_CACHE_MS = 30_000
const FORCED_STATUS_CACHE_MS = 1_500
const STATUS_TIMEOUT_MS = 8_000
const RECORDS_TIMEOUT_MS = 12_000
const ASSET_DOWNLOAD_TIMEOUT_MS = 20_000
const ASSET_UPLOAD_TIMEOUT_MS = 45_000
const QUEUED_TASK_TIMEOUT_MS = 90_000

let statusInFlight: Promise<ServerStatus> | null = null
let lastStatus: ServerStatus | null = null
let lastStatusCheckedAt = 0
let lastStatusRequestFailed = false
let statusGeneration = 0
const statusListeners = new Set<(status: ServerStatus) => void>()

function notifyStatus(status: ServerStatus) {
  statusListeners.forEach((listener) => {
    try {
      listener(status)
    } catch {
      // Один размонтирующийся компонент не должен ломать общий status promise.
    }
  })
}

/**
 * Статус сервера с коротким кэшем и ограниченным временем ожидания.
 * Одновременные запросы (все сторы стартуют почти вместе) используют один
 * in-flight promise; после сетевой ошибки следующий focus/online сможет
 * перечитать статус, а не упрётся в навсегда закэшированный OFFLINE.
 */
export function serverStatus(force = false): Promise<ServerStatus> {
  if (typeof window === "undefined") return Promise.resolve(OFFLINE)
  if (statusInFlight) return statusInFlight

  const maxAge = force ? FORCED_STATUS_CACHE_MS : STATUS_CACHE_MS
  if (lastStatus && Date.now() - lastStatusCheckedAt < maxAge) return Promise.resolve(lastStatus)

  const generation = statusGeneration
  const pending = retryTransient("session", 2, () =>
    withRequestTimeout("session", STATUS_TIMEOUT_MS, async (signal) => {
      const response = await fetch("/api/session", { cache: "no-store", signal })
      await expectOk(response, "session")
      return (await response.json()) as ServerStatus
    })
  )
    .then((status) => {
      lastStatusRequestFailed = false
      return status
    })
    .catch((error) => {
      const status = error instanceof SyncError ? error.status : 0
      lastStatusRequestFailed = status === 0 || status === 429 || status >= 500
      // При кратком обрыве сети сохраняем известную конфигурацию. Операции
      // всё равно ограничены таймаутом и будут повторены после online/focus.
      return lastStatusRequestFailed && lastStatus ? lastStatus : OFFLINE
    })
    .then((status) => {
      // 401 от параллельного запроса важнее чуть более раннего /api/session.
      if (generation !== statusGeneration) return lastStatus ?? OFFLINE
      lastStatus = status
      lastStatusCheckedAt = Date.now()
      notifyStatus(status)
      return status
    })

  statusInFlight = pending
  void pending.finally(() => {
    if (statusInFlight === pending) statusInFlight = null
  })
  return pending
}

/** Статус для компонентов: `null`, пока не загружен. */
export function useServerStatus(): ServerStatus | null {
  const [status, setStatus] = useState<ServerStatus | null>(lastStatus)
  useEffect(() => {
    let alive = true
    void serverStatus().then((value) => alive && setStatus(value))
    const listener = (value: ServerStatus) => alive && setStatus(value)
    statusListeners.add(listener)
    return () => {
      alive = false
      statusListeners.delete(listener)
    }
  }, [])
  return status
}

/** Последнее чтение /api/session закончилось временной сетевой/5xx ошибкой. */
export function serverStatusTemporarilyUnavailable(): boolean {
  return lastStatusRequestFailed
}

/** Сессия слетела — сервер ответил 401: дальше работаем как без сервера. */
function markSignedOut() {
  const next = { ...(lastStatus ?? OFFLINE), signedIn: false, persistence: false }
  statusGeneration += 1
  lastStatus = next
  lastStatusCheckedAt = Date.now()
  lastStatusRequestFailed = false
  notifyStatus(next)
}

/* ── Очередь сетевых операций ───────────────────────────────────────── */

class SyncError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
    this.name = "SyncError"
  }
}

function isTransient(error: unknown): boolean {
  const status = error instanceof SyncError ? error.status : 0
  return status === 0 || status === 429 || status >= 500
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Таймаут охватывает и получение заголовков, и чтение response body. */
async function withRequestTimeout<T>(
  label: string,
  timeoutMs: number,
  task: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await task(controller.signal)
  } catch (error) {
    if (error instanceof SyncError) throw error
    const reason = controller.signal.aborted ? "превышено время ожидания" : errorText(error)
    throw new SyncError(0, `${label}: ${reason}`)
  } finally {
    window.clearTimeout(timeout)
  }
}

/** Любая задача очереди обязана завершить свой promise, даже если браузерный API завис. */
function withTaskTimeout<T>(label: string, task: () => Promise<T>): Promise<T> {
  let timeout = 0
  const deadline = new Promise<never>((_, reject) => {
    timeout = window.setTimeout(
      () => reject(new SyncError(0, `${label}: превышено время ожидания`)),
      QUEUED_TASK_TIMEOUT_MS
    )
  })
  return Promise.race([task(), deadline]).finally(() => window.clearTimeout(timeout))
}

async function retryTransient<T>(label: string, attempts: number, task: () => Promise<T>): Promise<T> {
  let lastError: unknown = new SyncError(0, `${label}: неизвестная ошибка`)
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task()
    } catch (error) {
      lastError = error
      if (!isTransient(error) || attempt === attempts) throw error
      await new Promise((resolve) => window.setTimeout(resolve, attempt * 600))
    }
  }
  throw lastError
}

type Lane = "records" | "assets"

/**
 * Две независимые очереди: записи мелкие и должны доезжать сразу, объекты
 * крупные — иначе выгрузка старой галереи на минуты задержала бы метаданные
 * новой обработки.
 */
const chains: Record<Lane, Promise<void>> = { records: Promise.resolve(), assets: Promise.resolve() }

/** Последовательно в своей полосе, с повтором на сетевые ошибки и 5xx; 401 выключает синхронизацию. */
function enqueue(lane: Lane, label: string, task: () => Promise<void>): Promise<void> {
  const run = async () => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await withTaskTimeout(label, task)
        return
      } catch (error) {
        const status = error instanceof SyncError ? error.status : 0
        if (status === 401) {
          markSignedOut()
          throw error
        }
        const transient = status === 0 || status === 429 || status >= 500
        if (!transient || attempt === 3) {
          console.warn(`[server-sync] ${label}: ${error instanceof Error ? error.message : String(error)}`)
          throw error
        }
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500))
      }
    }
  }
  // Ошибка одной задачи не рвёт очередь: следующая стартует в любом случае.
  const settled = chains[lane].then(run, run)
  chains[lane] = settled.catch(() => undefined)
  return settled
}

interface BackfillJob {
  label: string
  task: () => Promise<void>
  resolve: () => void
  reject: (error: unknown) => void
}

const backfillJobs: BackfillJob[] = []
let drainingBackfill = false

function drainBackfillQueue() {
  if (drainingBackfill) return
  drainingBackfill = true
  void (async () => {
    try {
      while (backfillJobs.length > 0) {
        const job = backfillJobs.shift()
        if (!job) continue
        try {
          await enqueue("assets", job.label, job.task)
          job.resolve()
        } catch (error) {
          job.reject(error)
        }
      }
    } finally {
      drainingBackfill = false
      // Job мог добавиться между последней проверкой и finally.
      if (backfillJobs.length > 0) drainBackfillQueue()
    }
  })()
}

/**
 * В основную asset-очередь попадает не больше одного фонового backfill за
 * раз. Поэтому свежий результат, который пользователь только что оплатил,
 * встанет максимум за одной HEAD-проверкой, а не за всей старой галереей.
 */
function enqueueBackfill(label: string, task: () => Promise<void>): Promise<void> {
  const pending = new Promise<void>((resolve, reject) => {
    backfillJobs.push({ label, task, resolve, reject })
  })
  drainBackfillQueue()
  return pending
}

async function expectOk(response: Response, label: string): Promise<Response> {
  if (response.ok) return response
  let message = `${label}: HTTP ${response.status}`
  try {
    const body = (await response.json()) as { message?: string }
    if (body.message) message = `${label}: ${body.message}`
  } catch {
    // тело не JSON — оставляем код
  }
  throw new SyncError(response.status, message)
}

/* ── Записи ─────────────────────────────────────────────────────────── */

export async function fetchRecords<T extends SyncableRecord>(collection: Collection): Promise<T[]> {
  return retryTransient(`records ${collection}`, 3, () =>
    withRequestTimeout(`records ${collection}`, RECORDS_TIMEOUT_MS, async (signal) => {
      const response = await fetch(`/api/records?collection=${collection}`, { cache: "no-store", signal })
      if (response.status === 401) {
        markSignedOut()
        throw new SyncError(401, "нет сессии")
      }
      await expectOk(response, "records")
      const body = (await response.json()) as { records?: { data: T }[] }
      if (!Array.isArray(body.records)) throw new SyncError(0, "records: неверный ответ сервера")
      return body.records.map((row) => row.data)
    })
  )
}

export function pushRecord(collection: Collection, record: SyncableRecord): Promise<void> {
  return enqueue("records", `put ${collection}/${record.id}`, async () => {
    await withRequestTimeout("put record", RECORDS_TIMEOUT_MS, async (signal) => {
      const response = await fetch("/api/records", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collection, id: record.id, data: record, createdAt: record.createdAt }),
        signal,
      })
      await expectOk(response, "put record")
    })
  })
}

export function removeRecord(id: string): Promise<void> {
  return enqueue("records", `delete record ${id}`, async () => {
    await withRequestTimeout("delete record", RECORDS_TIMEOUT_MS, async (signal) => {
      const response = await fetch(`/api/records/${encodeURIComponent(id)}`, { method: "DELETE", signal })
      if (response.status === 404) return
      await expectOk(response, "delete record")
    })
  })
}

/* ── Объекты ────────────────────────────────────────────────────────── */

/** Потолок объекта на сервере — ниже лимита тела запроса на Vercel (4,5 МБ). */
const MAX_UPLOAD_BYTES = 3.5 * 1024 * 1024

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Браузер не смог закодировать картинку"))), type, quality)
  })
}

/**
 * Крупный блоб перед отправкой ужимается: сначала перекодируется в JPEG в
 * том же размере, если мало — уменьшается до 2048 px по длинной стороне.
 * Локальная копия в IndexedDB остаётся полноразмерной.
 */
async function shrinkForUpload(blob: Blob): Promise<Blob> {
  if (blob.size <= MAX_UPLOAD_BYTES) return blob
  const bitmap = await createImageBitmap(blob)
  try {
    for (const maxSide of [4096, 2048, 1536]) {
      const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.round(bitmap.width * k))
      canvas.height = Math.max(1, Math.round(bitmap.height * k))
      const ctx = canvas.getContext("2d")
      if (!ctx) throw new Error("Canvas 2D недоступен")
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = "high"
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const candidate = await canvasToBlob(canvas, "image/jpeg", 0.9)
      if (candidate.size <= MAX_UPLOAD_BYTES) return candidate
    }
    throw new Error("Картинка слишком велика даже после уменьшения")
  } finally {
    bitmap.close()
  }
}

/** Сама отправка — без очереди; из очереди зовут только её, иначе задача ждала бы саму себя. */
async function uploadNow(key: string, blob: Blob): Promise<void> {
  const body = await shrinkForUpload(blob)
  await withRequestTimeout(`upload ${key}`, ASSET_UPLOAD_TIMEOUT_MS, async (signal) => {
    const response = await fetch(`/api/assets/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": body.type || "application/octet-stream" },
      body,
      signal,
    })
    await expectOk(response, "upload asset")
  })
}

export function uploadAsset(key: string, blob: Blob): Promise<void> {
  return enqueue("assets", `upload ${key}`, () => uploadNow(key, blob))
}

export async function fetchAsset(key: string): Promise<Blob | null> {
  return retryTransient(`asset ${key}`, 3, () =>
    withRequestTimeout(`asset ${key}`, ASSET_DOWNLOAD_TIMEOUT_MS, async (signal) => {
      const response = await fetch(`/api/assets/${encodeURIComponent(key)}`, { cache: "no-store", signal })
      if (response.status === 404) return null
      if (response.status === 401) {
        markSignedOut()
        throw new SyncError(401, "нет сессии")
      }
      await expectOk(response, "download asset")
      return response.blob()
    })
  )
}

/**
 * Проверка нужна backfill, чтобы старая локальная копия не перезаписала
 * более свежий объект другого браузера. Серверный HEAD проверяет storage.has
 * и не загружает изображение целиком.
 */
async function remoteAssetExists(key: string): Promise<boolean> {
  return withRequestTimeout(`check asset ${key}`, RECORDS_TIMEOUT_MS, async (signal) => {
    const url = `/api/assets/${encodeURIComponent(key)}`
    const response = await fetch(url, { method: "HEAD", cache: "no-store", signal })
    if (response.status === 404) return false
    if (response.status === 401) {
      markSignedOut()
      throw new SyncError(401, "нет сессии")
    }
    await expectOk(response, "check asset")
    await response.body?.cancel()
    return true
  })
}

export function removeAssets(keys: string[]): Promise<void> {
  return enqueue("assets", `delete ${keys.length} assets`, async () => {
    for (const key of keys) {
      await withRequestTimeout(`delete asset ${key}`, RECORDS_TIMEOUT_MS, async (signal) => {
        const response = await fetch(`/api/assets/${encodeURIComponent(key)}`, { method: "DELETE", signal })
        if (response.status === 404) return
        await expectOk(response, "delete asset")
      })
    }
  })
}

/* ── Слияние стора с сервером ───────────────────────────────────────── */

function syncedKey(collection: Collection): string {
  return `dizzit-synced:${collection}`
}

/** Id записей, которые хоть раз были на сервере: по ним видно удаление извне. */
function readSynced(collection: Collection): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(syncedKey(collection)) ?? "[]") as string[])
  } catch {
    return new Set()
  }
}

function writeSynced(collection: Collection, ids: Iterable<string>) {
  try {
    localStorage.setItem(syncedKey(collection), JSON.stringify([...ids]))
  } catch {
    // storage запрещён — синхронизация без памяти об удалениях
  }
}

function markSynced(collection: Collection, id: string, present: boolean) {
  const ids = readSynced(collection)
  if (present) ids.add(id)
  else ids.delete(id)
  writeSynced(collection, ids)
}

function outboxKey(collection: Collection, kind: "dirty" | "deleted"): string {
  return `dizzit-outbox:${collection}:${kind}`
}

function readOutbox(collection: Collection, kind: "dirty" | "deleted"): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(outboxKey(collection, kind)) ?? "[]") as string[])
  } catch {
    return new Set()
  }
}

function writeOutbox(collection: Collection, kind: "dirty" | "deleted", ids: Set<string>) {
  try {
    if (ids.size === 0) localStorage.removeItem(outboxKey(collection, kind))
    else localStorage.setItem(outboxKey(collection, kind), JSON.stringify([...ids]))
  } catch {
    // В приватном режиме синхронизация остаётся best-effort в памяти.
  }
}

/** PUT записи и отметка «на сервере есть» после успеха — не раньше. */
function syncRecord(collection: Collection, record: SyncableRecord): Promise<boolean> {
  return pushRecord(collection, record).then(
    () => {
      markSynced(collection, record.id, true)
      return true
    },
    () => false
  )
}

export interface AttachOptions<S, R extends SyncableRecord> {
  collection: Collection
  select: (state: S) => R[]
  apply: (records: R[]) => void
  hydrated: (state: S) => boolean
  /** Ключи блобов записи для выгрузки старой локальной галереи; по умолчанию — стандартные роли. */
  assetKeys?: (record: R) => string[]
  /** Ключи блобов, которые удаляются вместе с записью на этом устройстве. */
  onRemovedLocally?: (record: R) => void
  /**
   * Список сверен: после первого успешного pull («server») или когда сервера
   * для записей нет и это не временный сбой («local»). До этого стор не знает,
   * пуст ли он на самом деле — авто-создание записей по умолчанию ждёт.
   */
  onSettled?: (mode: "server" | "local") => void
}

const DEFAULT_ROLES = ["source", "result", "thumb-source", "thumb-result"]

/**
 * Подключить стор к серверу. После гидрации делает pull, затем повторяет его
 * при возврате во вкладку и восстановлении сети. Поэтому данные с другого
 * устройства появляются без reload, а временный сбой первого запроса не
 * отключает синхронизацию до следующей загрузки страницы.
 */
export function attachServerSync<S, R extends SyncableRecord>(store: StoreApi<S>, options: AttachOptions<S, R>): void {
  if (typeof window === "undefined") return
  const { collection, select, apply, hydrated } = options
  let ready = false
  let activated = false
  let subscribed = false
  let serverReady = false
  let applyingRemote = false
  let pulling = false
  let pullAgain = false
  let retryTimer: number | null = null
  let retryAttempt = 0
  let previous = new Map<string, string>()
  let lastRemote = new Map<string, string>()
  let requestPull = () => undefined
  let scheduleRetry = () => undefined
  // Outbox живёт дольше вкладки: reload между локальным set() и успешным PUT
  // не даёт старой серверной версии затереть уже готовый результат.
  const dirtyIds = readOutbox(collection, "dirty")
  const locallyProcessingIds = new Set<string>()
  const pendingDeletes = readOutbox(collection, "deleted")
  const pushInFlight = new Map<string, string>()
  const deleteInFlight = new Set<string>()
  const uploadedBackfill = new Set<string>()
  const backfillInFlight = new Set<string>()
  const retryDelays = [2_000, 5_000, 15_000, 30_000]

  const snapshot = (records: R[]) => new Map(records.map((record) => [record.id, JSON.stringify(record)]))
  const currentRecord = (id: string) => select(store.getState()).find((record) => record.id === id)
  const keysFor = (record: R) =>
    options.assetKeys ? options.assetKeys(record) : DEFAULT_ROLES.map((role) => `${record.id}:${role}`)
  const setDirty = (id: string, present: boolean) => {
    if (present) dirtyIds.add(id)
    else dirtyIds.delete(id)
    writeOutbox(collection, "dirty", dirtyIds)
  }
  const setPendingDelete = (id: string, present: boolean) => {
    if (present) pendingDeletes.add(id)
    else pendingDeletes.delete(id)
    writeOutbox(collection, "deleted", pendingDeletes)
  }

  const flushDirtyRecord = (id: string) => {
    // Во время GET pull новые локальные изменения только помечаются dirty.
    // PUT стартует после merge, иначе поздний stale GET мог бы затереть уже
    // подтверждённый сервером локальный апдейт.
    if (!serverReady || pulling || !dirtyIds.has(id) || pushInFlight.has(id)) return
    const record = currentRecord(id)
    if (!record) return
    const serialized = JSON.stringify(record)
    pushInFlight.set(id, serialized)
    void (async () => {
      const saved = await syncRecord(collection, record)
      pushInFlight.delete(id)
      if (!saved) {
        scheduleRetry()
        return
      }
      lastRemote.set(id, serialized)
      const latest = currentRecord(id)
      if (!latest) {
        setDirty(id, false)
        if (pendingDeletes.has(id)) flushPendingDelete(id)
        return
      }
      if (JSON.stringify(latest) === serialized) {
        setDirty(id, false)
        return
      }
      // Запись изменилась, пока ехал PUT: сразу отправляем новую версию.
      setDirty(id, true)
      flushDirtyRecord(id)
    })()
  }

  const flushPendingDelete = (id: string) => {
    if (!serverReady || pulling || !pendingDeletes.has(id) || deleteInFlight.has(id)) return
    if (currentRecord(id)) {
      setPendingDelete(id, false)
      return
    }
    // DELETE идемпотентен и owner-scoped: отправляем его даже для записи,
    // которую сервер мог принять ровно в момент потерянного PUT-ответа.
    deleteInFlight.add(id)
    void (async () => {
      try {
        await removeRecord(id)
        markSynced(collection, id, false)
        lastRemote.delete(id)
        setPendingDelete(id, false)
        // Редкий undo с тем же id во время DELETE: возвращаем текущую запись.
        if (currentRecord(id)) {
          setDirty(id, true)
          flushDirtyRecord(id)
        }
      } catch {
        // Не считаем удаление завершённым: следующий focus/retry повторит.
        scheduleRetry()
      } finally {
        deleteInFlight.delete(id)
      }
    })()
  }

  /**
   * Backfill запускается для КАЖДОЙ локальной записи, включая ту, чьи
   * метаданные уже присутствуют на сервере. Это чинит старое состояние
   * «metadata есть, R2-объекта нет». Ключ отмечается только после реального
   * успешного upload: отсутствие локального блоба и сетевой сбой можно
   * проверить снова при следующем focus/online.
   */
  const backfillLocalAssets = (records: R[]) => {
    for (const record of records) {
      for (const key of keysFor(record)) {
        if (uploadedBackfill.has(key) || backfillInFlight.has(key)) continue
        backfillInFlight.add(key)
        void (async () => {
          try {
            let availableOnServer = false
            await enqueueBackfill(`backfill ${key}`, async () => {
              // Запись могла быть удалена, пока фоновая задача ждала очереди.
              if (!currentRecord(record.id)) return
              const blob = await getLocalBlob(key)
              if (!blob) return
              if (await remoteAssetExists(key)) {
                availableOnServer = true
                return
              }
              if (!currentRecord(record.id)) return
              await uploadNow(key, blob)
              availableOnServer = true
            })
            if (availableOnServer) uploadedBackfill.add(key)
          } catch {
            // Очередь уже залогировала ошибку. Ключ намеренно не отмечаем:
            // следующий pull попробует выгрузить его ещё раз.
          } finally {
            backfillInFlight.delete(key)
          }
        })()
      }
    }
  }

  const subscribeToLocalChanges = () => {
    if (subscribed) return
    subscribed = true
    previous = snapshot(select(store.getState()))
    store.subscribe((state) => {
      const current = select(state)
      const next = snapshot(current)
      if (applyingRemote) {
        previous = next
        return
      }
      for (const record of current) {
        const serialized = next.get(record.id)
        if (previous.get(record.id) === serialized) continue
        setPendingDelete(record.id, false)
        if (record.status === "processing") locallyProcessingIds.add(record.id)
        else locallyProcessingIds.delete(record.id)
        setDirty(record.id, lastRemote.get(record.id) !== serialized)
        flushDirtyRecord(record.id)
      }
      for (const id of previous.keys()) {
        if (!next.has(id)) {
          setDirty(id, false)
          locallyProcessingIds.delete(id)
          setPendingDelete(id, true)
          flushPendingDelete(id)
        }
      }
      previous = next
    })
  }

  const clearRetry = () => {
    if (retryTimer !== null) window.clearTimeout(retryTimer)
    retryTimer = null
    retryAttempt = 0
  }

  scheduleRetry = () => {
    if (retryTimer !== null || !navigator.onLine) return
    const delay = retryDelays[Math.min(retryAttempt, retryDelays.length - 1)]
    retryAttempt += 1
    retryTimer = window.setTimeout(() => {
      retryTimer = null
      requestPull()
    }, delay)
  }

  const pull = async () => {
    const status = await serverStatus(true)
    if (!status.persistence) {
      serverReady = false
      if (lastStatusRequestFailed) scheduleRetry()
      // Слетевшая сессия — не локальный режим: после входа записи придут с сервера.
      else if (!(status.authConfigured && !status.signedIn)) options.onSettled?.("local")
      return
    }

    try {
      // Сначала даём уже поставленным в очередь локальным PUT/DELETE доехать,
      // чтобы pull с меньшей вероятностью увидел предыдущее состояние.
      await chains.records
      const remote = await fetchRecords<R>(collection)
      const local = select(store.getState())
      const synced = readSynced(collection)
      const remoteById = new Map(remote.map((record) => [record.id, record]))
      const localById = new Map(local.map((record) => [record.id, record]))
      const remoteSnapshot = snapshot(remote)

      const merged: R[] = []
      const toPush: R[] = []
      const validLocalIds = new Set<string>()
      for (const record of remote) {
        if (pendingDeletes.has(record.id)) continue
        const mine = localById.get(record.id)
        const mineSerialized = mine ? JSON.stringify(mine) : null
        const remoteSerialized = remoteSnapshot.get(record.id)
        const mineError = mine && "error" in mine ? (mine as R & { error?: unknown }).error : undefined
        const recoveredAfterClose = Boolean(
          mine?.status === "error" &&
            record.status === "processing" &&
            typeof mineError === "string" &&
            mineError.includes("страница была закрыта")
        )
        if (recoveredAfterClose) setDirty(record.id, true)
        if (
          mine &&
          (recoveredAfterClose ||
            locallyProcessingIds.has(record.id) ||
            (dirtyIds.has(record.id) && mineSerialized !== remoteSerialized))
        ) {
          // Сильнее сервера только dirty-изменение или обработка, реально
          // запущенная в ЭТОЙ вкладке. Полученный ранее remote processing в
          // эти наборы не попадает, поэтому remote done/error его заменит.
          merged.push(mine)
        } else {
          setDirty(record.id, false)
          merged.push(record)
        }
        if (mine) validLocalIds.add(record.id)
      }
      for (const record of local) {
        if (remoteById.has(record.id)) continue
        if (pendingDeletes.has(record.id)) continue
        if (synced.has(record.id) && !dirtyIds.has(record.id) && !locallyProcessingIds.has(record.id)) {
          // Была на сервере и пропала — удалена с другого устройства.
          options.onRemovedLocally?.(record)
          continue
        }
        merged.push(record)
        toPush.push(record)
        validLocalIds.add(record.id)
      }
      merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))

      applyingRemote = true
      try {
        apply(merged)
        previous = snapshot(select(store.getState()))
      } finally {
        applyingRemote = false
      }
      options.onSettled?.("server")

      lastRemote = remoteSnapshot

      // «На сервере есть» — только то, что сервер действительно вернул.
      // Так неудачный PUT не превратится в ложное внешнее удаление.
      writeSynced(collection, remote.map((record) => record.id))

      serverReady = true
      for (const record of toPush) setDirty(record.id, true)
      for (const id of dirtyIds) flushDirtyRecord(id)
      for (const id of pendingDeletes) flushPendingDelete(id)
      const validLocal = local.filter((record) => validLocalIds.has(record.id))
      backfillLocalAssets(validLocal)
      clearRetry()
    } catch (error) {
      if (!(error instanceof SyncError) || error.status !== 401) scheduleRetry()
    }
  }

  requestPull = () => {
    if (!activated) return
    if (pulling) {
      pullAgain = true
      return
    }
    pulling = true
    void pull().finally(() => {
      pulling = false
      for (const id of dirtyIds) flushDirtyRecord(id)
      for (const id of pendingDeletes) flushPendingDelete(id)
      if (pullAgain) {
        pullAgain = false
        requestPull()
      }
    })
  }

  const refreshNow = () => {
    clearRetry()
    requestPull()
  }
  const onVisibility = () => {
    if (document.visibilityState === "visible") refreshNow()
  }

  const begin = () => {
    if (ready || !hydrated(store.getState())) return
    ready = true
    // onRehydrateStorage переводит оставшийся с прошлого сеанса processing
    // в error через microtask. Ждём следующий macrotask и берём это состояние
    // как baseline, а не как пользовательское dirty-изменение.
    window.setTimeout(() => {
      if (activated) return
      activated = true
      subscribeToLocalChanges()
      window.addEventListener("focus", refreshNow)
      window.addEventListener("online", refreshNow)
      document.addEventListener("visibilitychange", onVisibility)
      requestPull()
    }, 0)
  }

  begin()
  if (!ready) {
    const unsubscribeHydration = store.subscribe(() => {
      begin()
      if (ready) unsubscribeHydration()
    })
  }
}
