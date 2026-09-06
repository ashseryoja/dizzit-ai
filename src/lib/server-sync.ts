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

export type Collection = "projects" | "enhancements" | "restyles" | "views" | "materials" | "models"

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

let statusPromise: Promise<ServerStatus> | null = null
let lastStatus: ServerStatus | null = null
const statusListeners = new Set<(status: ServerStatus) => void>()

/** Статус сервера; один запрос на загрузку страницы, `force` — перечитать. */
export function serverStatus(force = false): Promise<ServerStatus> {
  if (typeof window === "undefined") return Promise.resolve(OFFLINE)
  if (!statusPromise || force) {
    statusPromise = fetch("/api/session", { cache: "no-store" })
      .then(async (response) => (response.ok ? ((await response.json()) as ServerStatus) : OFFLINE))
      .catch(() => OFFLINE)
      .then((status) => {
        lastStatus = status
        statusListeners.forEach((listener) => listener(status))
        return status
      })
  }
  return statusPromise
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

/** Сессия слетела — сервер ответил 401: дальше работаем как без сервера. */
function markSignedOut() {
  const next = { ...(lastStatus ?? OFFLINE), signedIn: false, persistence: false }
  statusPromise = Promise.resolve(next)
  lastStatus = next
  statusListeners.forEach((listener) => listener(next))
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
        await task()
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
  const response = await fetch(`/api/records?collection=${collection}`, { cache: "no-store" })
  if (response.status === 401) {
    markSignedOut()
    throw new SyncError(401, "нет сессии")
  }
  await expectOk(response, "records")
  const body = (await response.json()) as { records: { data: T }[] }
  return body.records.map((row) => row.data)
}

export function pushRecord(collection: Collection, record: SyncableRecord): Promise<void> {
  return enqueue("records", `put ${collection}/${record.id}`, async () => {
    const response = await fetch("/api/records", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ collection, id: record.id, data: record, createdAt: record.createdAt }),
    })
    await expectOk(response, "put record")
  })
}

export function removeRecord(id: string): Promise<void> {
  return enqueue("records", `delete record ${id}`, async () => {
    const response = await fetch(`/api/records/${encodeURIComponent(id)}`, { method: "DELETE" })
    if (response.status === 404) return
    await expectOk(response, "delete record")
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
  const response = await fetch(`/api/assets/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: { "Content-Type": body.type || "application/octet-stream" },
    body,
  })
  await expectOk(response, "upload asset")
}

export function uploadAsset(key: string, blob: Blob): Promise<void> {
  return enqueue("assets", `upload ${key}`, () => uploadNow(key, blob))
}

export async function fetchAsset(key: string): Promise<Blob | null> {
  const response = await fetch(`/api/assets/${encodeURIComponent(key)}`, { cache: "no-store" })
  if (response.status === 404) return null
  if (response.status === 401) {
    markSignedOut()
    return null
  }
  if (!response.ok) return null
  return response.blob()
}

export function removeAssets(keys: string[]): Promise<void> {
  return enqueue("assets", `delete ${keys.length} assets`, async () => {
    for (const key of keys) {
      const response = await fetch(`/api/assets/${encodeURIComponent(key)}`, { method: "DELETE" })
      if (response.status === 404) continue
      await expectOk(response, "delete asset")
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

/** PUT записи и отметка «на сервере есть» после успеха — не раньше. */
function syncRecord(collection: Collection, record: SyncableRecord): Promise<void> {
  return pushRecord(collection, record).then(
    () => markSynced(collection, record.id, true),
    () => undefined
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
}

const DEFAULT_ROLES = ["source", "result", "thumb-source", "thumb-result"]

/**
 * Подключить стор к серверу. Вызывается один раз на модуль стора; ждёт
 * гидрации стора и статуса сервера, затем сливает записи и подписывается на
 * изменения.
 */
export function attachServerSync<S, R extends SyncableRecord>(store: StoreApi<S>, options: AttachOptions<S, R>): void {
  if (typeof window === "undefined") return
  const { collection, select, apply, hydrated } = options
  let started = false

  const start = async () => {
    const status = await serverStatus()
    if (!status.persistence) return

    // 1. Слияние.
    let remote: R[]
    try {
      remote = await fetchRecords<R>(collection)
    } catch {
      return
    }
    const local = select(store.getState())
    const synced = readSynced(collection)
    const remoteById = new Map(remote.map((record) => [record.id, record]))
    const localById = new Map(local.map((record) => [record.id, record]))

    const merged: R[] = []
    const toPush: R[] = []
    for (const record of remote) {
      const mine = localById.get(record.id)
      merged.push(mine && mine.status === "processing" ? mine : record)
    }
    for (const record of local) {
      if (remoteById.has(record.id)) continue
      if (synced.has(record.id)) {
        // Была на сервере и пропала — удалена с другого устройства.
        options.onRemovedLocally?.(record)
        continue
      }
      merged.push(record)
      toPush.push(record)
    }
    merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    apply(merged)
    // «На сервере есть» — только то, что сервер вернул; локальные попадут
    // в список после успешной отправки (иначе неудачный PUT стёр бы их при
    // следующем слиянии как «удалённые извне»).
    writeSynced(collection, remote.map((record) => record.id))

    // 2. Старые локальные записи — на сервер вместе с блобами.
    for (const record of toPush) {
      void syncRecord(collection, record)
      const keys = options.assetKeys ? options.assetKeys(record) : DEFAULT_ROLES.map((role) => `${record.id}:${role}`)
      for (const key of keys) {
        void enqueue("assets", `backfill ${key}`, async () => {
          const blob = await getLocalBlob(key)
          if (blob) await uploadNow(key, blob)
        })
      }
    }

    // 3. Дальше — каждое изменение.
    let previous = new Map(select(store.getState()).map((record) => [record.id, JSON.stringify(record)]))
    store.subscribe((state) => {
      const current = select(state)
      const next = new Map<string, string>()
      for (const record of current) {
        const serialized = JSON.stringify(record)
        next.set(record.id, serialized)
        if (previous.get(record.id) !== serialized) void syncRecord(collection, record)
      }
      for (const id of previous.keys()) {
        if (!next.has(id)) {
          markSynced(collection, id, false)
          void removeRecord(id)
        }
      }
      previous = next
    })
  }

  const maybeStart = () => {
    if (started || !hydrated(store.getState())) return
    started = true
    void start()
  }
  maybeStart()
  if (!started) {
    const unsubscribe = store.subscribe(() => {
      if (started) {
        unsubscribe()
        return
      }
      maybeStart()
      if (started) unsubscribe()
    })
  }
}
