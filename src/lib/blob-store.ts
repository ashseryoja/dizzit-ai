"use client"

import {
  fetchAsset,
  removeAssets,
  serverStatus,
  serverStatusTemporarilyUnavailable,
  uploadAsset,
} from "@/lib/server-sync"

/**
 * Хранилище изображений инструментов сервиса — база общая для всех.
 *
 * localStorage для картинок не годится: квота ~5 МБ и строки-base64. Поэтому
 * разделение такое: метаданные обработок — в zustand+persist (localStorage,
 * попадают в резервную копию настроек), а блобы — здесь, в IndexedDB.
 * Ключ блоба — `${enhancementId}:{роль}`, роли перечислены ниже.
 *
 * Когда настроено серверное хранение (см. lib/server-sync), IndexedDB —
 * кэш: `putBlob` дублирует объект на сервер под тем же ключом, `getBlob` при
 * промахе тянет его оттуда, `deleteBlobs` удаляет и там.
 *
 * Резервная копия JSON блобы НЕ включает (см. README). Осиротевшие блобы —
 * например после «Удалить все данные» — подчищает gcBlobs() на входе
 * в инструмент: удаляет всё, чей id не числится в метаданных.
 */

const DB_NAME = "dizzit-blobs"
const STORE = "blobs"
const VERSION = 1
const IDB_TIMEOUT_MS = 8_000

/** База прежнего имени сервиса. Содержимое переносится один раз, см. ниже. */
const LEGACY_DB_NAME = "skizzy-blobs"
const MIGRATED_FLAG = "dizzit-blobs-migrated"

export const sourceKey = (id: string) => `${id}:source`
export const resultKey = (id: string) => `${id}:result`
export const thumbSourceKey = (id: string) => `${id}:thumb-source`
export const thumbResultKey = (id: string) => `${id}:thumb-result`

/** Все ключи одной обработки — для каскадного удаления. */
export function keysOf(id: string): string[] {
  return [sourceKey(id), resultKey(id), thumbSourceKey(id), thumbResultKey(id)]
}

let dbPromise: Promise<IDBDatabase> | null = null
const remoteBlobRequests = new Map<string, Promise<Blob | null>>()
// Последняя копия остаётся доступной в текущей вкладке, даже если браузер
// запретил IndexedDB. Это позволяет кнопке «Повторить синхронизацию» снова
// отправить уже оплаченный результат, не вызывая модель второй раз.
const pendingBlobWrites = new Map<string, Blob>()

function db(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB недоступна в этом окружении"))
  }
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, VERSION)
      let settled = false
      const timeout = window.setTimeout(() => {
        if (settled) return
        settled = true
        reject(new Error("IndexedDB не ответила вовремя"))
      }, IDB_TIMEOUT_MS)
      open.onupgradeneeded = () => open.result.createObjectStore(STORE)
      open.onsuccess = () => {
        if (settled) {
          open.result.close()
          return
        }
        settled = true
        window.clearTimeout(timeout)
        resolve(open.result)
      }
      open.onerror = () => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        reject(open.error ?? new Error("Не удалось открыть IndexedDB"))
      }
    }).then(async (database) => {
      await migrateLegacyBlobs(database)
      return database
    })
    // Повторная попытка при следующем вызове, если открытие провалилось.
    dbPromise.catch(() => {
      dbPromise = null
    })
  }
  return dbPromise
}

/**
 * Перенос блобов из базы прежнего имени сервиса (`skizzy-blobs` → `dizzit-blobs`).
 *
 * Живёт ВНУТРИ промиса открытия базы: getBlob/putBlob ждут этот же промис,
 * поэтому «прочитали раньше, чем перенесли» не случится. Отработав, помечает
 * себя флагом в localStorage и сносит старую базу — но только после успешного
 * копирования: любая ошибка оставляет старую базу нетронутой, и попытка
 * повторится при следующей загрузке.
 *
 * Метаданные записей переезжают отдельно — загрузочным скриптом в
 * app/layout.tsx. Всё вместе можно удалить, когда старых баз ни у кого
 * не останется.
 */
async function migrateLegacyBlobs(target: IDBDatabase): Promise<void> {
  try {
    if (localStorage.getItem(MIGRATED_FLAG) === "1") return
  } catch {
    return // storage запрещён — переносить всё равно некуда
  }

  try {
    // Открытие несуществующей базы создало бы пустую: ловим это по
    // onupgradeneeded и просто ничего не копируем.
    let existed = true
    const legacy = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(LEGACY_DB_NAME)
      let settled = false
      const timeout = window.setTimeout(() => {
        if (settled) return
        settled = true
        reject(new Error("Старая IndexedDB не ответила вовремя"))
      }, IDB_TIMEOUT_MS)
      open.onupgradeneeded = () => {
        existed = false
      }
      open.onsuccess = () => {
        if (settled) {
          open.result.close()
          return
        }
        settled = true
        window.clearTimeout(timeout)
        resolve(open.result)
      }
      open.onerror = () => {
        if (settled) return
        settled = true
        window.clearTimeout(timeout)
        reject(open.error ?? new Error("Старая база недоступна"))
      }
    })

    if (existed && legacy.objectStoreNames.contains(STORE)) {
      const source = legacy.transaction(STORE, "readonly").objectStore(STORE)
      const keys = (await request(source.getAllKeys())) as string[]
      const values = (await request(source.getAll())) as Blob[]
      const store = target.transaction(STORE, "readwrite").objectStore(STORE)
      await Promise.all(keys.map((key, i) => request(store.put(values[i], key))))
    }

    legacy.close()
    indexedDB.deleteDatabase(LEGACY_DB_NAME)
    localStorage.setItem(MIGRATED_FLAG, "1")
  } catch {
    // Оставляем старую базу как есть — попробуем на следующей загрузке.
  }
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timeout = window.setTimeout(() => {
      if (settled) return
      settled = true
      try {
        req.transaction?.abort()
      } catch {
        // Транзакция могла уже завершиться.
      }
      reject(new Error("IndexedDB не ответила вовремя"))
    }, IDB_TIMEOUT_MS)
    req.onsuccess = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      resolve(req.result)
    }
    req.onerror = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timeout)
      reject(req.error ?? new Error("Ошибка IndexedDB"))
    }
  })
}

/** Только IndexedDB, без сервера: для выгрузки старой галереи и кэша. */
export async function putLocalBlob(key: string, blob: Blob): Promise<void> {
  const database = await db()
  await request(database.transaction(STORE, "readwrite").objectStore(STORE).put(blob, key))
}

export async function getLocalBlob(key: string): Promise<Blob | null> {
  try {
    const database = await db()
    const value = await request(database.transaction(STORE, "readonly").objectStore(STORE).get(key))
    return value instanceof Blob ? value : null
  } catch {
    return null
  }
}

export async function putBlob(key: string, blob: Blob): Promise<void> {
  await putLocalBlob(key, blob)
  void (async () => {
    try {
      const status = await serverStatus()
      if (status.persistence) await uploadAsset(key, blob)
    } catch (error) {
      // Локальная копия уже сохранена. Pull на focus/online повторит backfill.
      console.warn(`[blob-store] upload ${key}: ${error instanceof Error ? error.message : String(error)}`)
    }
  })()
}

/**
 * Как `putBlob`, но при настроенном сервере ждёт подтверждения загрузки.
 * Нужен для черновиков: запись не помечается готовой, пока исходник нельзя
 * открыть на другом устройстве. Без сервера подтверждением остаётся IndexedDB.
 */
export async function putBlobDurably(key: string, blob: Blob): Promise<void> {
  pendingBlobWrites.set(key, blob)

  let localError: unknown = null
  try {
    await putLocalBlob(key, blob)
  } catch (error) {
    localError = error
  }

  const status = await serverStatus()
  if (status.persistence) {
    // Сервер — источник правды. Пытаемся загрузить туда и при отказе
    // IndexedDB: успешный PUT уже делает файл доступным другим устройствам.
    await uploadAsset(key, blob)
    pendingBlobWrites.delete(key)
    return
  }

  if (localError) throw localError

  // В автономном локальном режиме IndexedDB является штатным хранилищем.
  // Но временный обрыв нельзя принять за успешное серверное сохранение:
  // вызывающий код пометит запись syncPending и повторит только загрузку.
  if (
    serverStatusTemporarilyUnavailable() ||
    (typeof navigator !== "undefined" && !navigator.onLine) ||
    (status.authConfigured && !status.signedIn) ||
    (status.authConfigured && status.signedIn && status.database && !status.storage)
  ) {
    throw new Error("Серверное хранилище временно недоступно — файл сохранён в этой вкладке и ждёт синхронизации")
  }

  pendingBlobWrites.delete(key)
}

export async function getBlob(key: string): Promise<Blob | null> {
  const pendingWrite = pendingBlobWrites.get(key)
  if (pendingWrite) return pendingWrite

  const local = await getLocalBlob(key)
  if (local) return local

  // Один remote GET на ключ, даже если карточка и сцена запросили его вместе.
  // После любого исхода запись удаляется: временный сбой не становится
  // постоянным отрицательным кэшем, следующий вызов сможет попробовать снова.
  const existing = remoteBlobRequests.get(key)
  if (existing) return existing
  const pending = (async () => {
    const status = await serverStatus()
    if (!status.persistence) {
      // Отличаем реальное отсутствие сервера/сессии от временного сетевого
      // сбоя: UI-хук тогда покажет «не удалось загрузить», а не «файл утерян».
      if (serverStatusTemporarilyUnavailable() || (typeof navigator !== "undefined" && !navigator.onLine)) {
        throw new Error("Нет соединения с сервером")
      }
      return null
    }
    const remote = await fetchAsset(key)
    if (remote) {
      try {
        await putLocalBlob(key, remote)
      } catch {
        // Кэш не обязателен — отдаём как есть.
      }
    }
    return remote
  })()
  remoteBlobRequests.set(key, pending)
  const clearPending = () => {
    if (remoteBlobRequests.get(key) === pending) remoteBlobRequests.delete(key)
  }
  void pending.then(clearPending, clearPending)
  return pending
}

export async function deleteBlobs(keys: string[]): Promise<void> {
  if (keys.length === 0) return
  keys.forEach((key) => pendingBlobWrites.delete(key))
  try {
    const database = await db()
    const store = database.transaction(STORE, "readwrite").objectStore(STORE)
    await Promise.all(keys.map((key) => request(store.delete(key))))
  } catch {
    // Ничего: блоб без метаданных невидим, его доберёт gcBlobs.
  }
  void (async () => {
    try {
      const status = await serverStatus()
      if (status.persistence) await removeAssets(keys)
    } catch (error) {
      console.warn(`[blob-store] delete assets: ${error instanceof Error ? error.message : String(error)}`)
    }
  })()
}

/**
 * Сборка мусора: удаляет блобы обработок, которых больше нет в метаданных.
 * Вызывать ПОСЛЕ гидрации стора — иначе снесёт живые данные.
 */
export async function gcBlobs(validIds: ReadonlySet<string>): Promise<void> {
  for (const key of pendingBlobWrites.keys()) {
    if (!validIds.has(key.split(":")[0])) pendingBlobWrites.delete(key)
  }
  try {
    const database = await db()
    const store = database.transaction(STORE, "readwrite").objectStore(STORE)
    const keys = (await request(store.getAllKeys())) as string[]
    const orphans = keys.filter((key) => !validIds.has(key.split(":")[0]))
    await Promise.all(orphans.map((key) => request(store.delete(key))))
  } catch {
    // Не мешаем работе инструмента из-за уборки.
  }
}
