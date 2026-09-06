"use client"

import { fetchAsset, removeAssets, serverStatus, uploadAsset } from "@/lib/server-sync"

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

function db(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB недоступна в этом окружении"))
  }
  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, VERSION)
      open.onupgradeneeded = () => open.result.createObjectStore(STORE)
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error ?? new Error("Не удалось открыть IndexedDB"))
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
      open.onupgradeneeded = () => {
        existed = false
      }
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error ?? new Error("Старая база недоступна"))
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
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error("Ошибка IndexedDB"))
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
  void serverStatus().then((status) => {
    if (status.persistence) void uploadAsset(key, blob)
  })
}

/**
 * Как `putBlob`, но при настроенном сервере ждёт подтверждения загрузки.
 * Нужен для черновиков: запись не помечается готовой, пока исходник нельзя
 * открыть на другом устройстве. Без сервера подтверждением остаётся IndexedDB.
 */
export async function putBlobDurably(key: string, blob: Blob): Promise<void> {
  await putLocalBlob(key, blob)
  const status = await serverStatus()
  if (status.persistence) await uploadAsset(key, blob)
}

export async function getBlob(key: string): Promise<Blob | null> {
  const local = await getLocalBlob(key)
  if (local) return local
  // Промах кэша: объект мог прийти с другого устройства — тянем с сервера.
  const status = await serverStatus()
  if (!status.persistence) return null
  const remote = await fetchAsset(key)
  if (remote) {
    try {
      await putLocalBlob(key, remote)
    } catch {
      // Кэш не обязателен — отдаём как есть.
    }
  }
  return remote
}

export async function deleteBlobs(keys: string[]): Promise<void> {
  if (keys.length === 0) return
  try {
    const database = await db()
    const store = database.transaction(STORE, "readwrite").objectStore(STORE)
    await Promise.all(keys.map((key) => request(store.delete(key))))
  } catch {
    // Ничего: блоб без метаданных невидим, его доберёт gcBlobs.
  }
  void serverStatus().then((status) => {
    if (status.persistence) void removeAssets(keys)
  })
}

/**
 * Сборка мусора: удаляет блобы обработок, которых больше нет в метаданных.
 * Вызывать ПОСЛЕ гидрации стора — иначе снесёт живые данные.
 */
export async function gcBlobs(validIds: ReadonlySet<string>): Promise<void> {
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
