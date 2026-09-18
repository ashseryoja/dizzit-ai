"use client"

import { getBlob, putBlobDurably, putLocalBlob, resultKey, thumbResultKey } from "@/lib/blob-store"
import { makeThumb } from "@/lib/enhance-engine"
import { remoteAssetExists, serverStatus } from "@/lib/server-sync"

/**
 * Публикует готовый результат атомарно с точки зрения метаданных страницы:
 * вызывающий меняет запись на `done` только после подтверждения полного файла
 * и миниатюры серверным хранилищем. Локальные копии записываются первыми.
 */
export async function persistResultDurably(
  id: string,
  blob: Blob,
  options: { serverHasFull?: boolean } = {}
): Promise<void> {
  if (options.serverHasFull) {
    // Полный файл сервер уже сохранил сам (`/api/images` со `store_key`): 4K весит
    // 5–10 МБ, и обратная загрузка ужала бы его под лимит тела запроса. Здесь —
    // только локальная копия; сбой IndexedDB не страшен, файл придёт с сервера.
    await putLocalBlob(resultKey(id), blob).catch(() => undefined)
  } else {
    await putBlobDurably(resultKey(id), blob)
  }
  await putBlobDurably(thumbResultKey(id), await makeThumb(blob))
}

/**
 * Дозагружает уже посчитанный результат. Используется после сетевого сбоя:
 * никакой image API здесь нет, поэтому кнопка «Повторить» не тратит токены.
 */
export async function repairPersistedResult(id: string): Promise<void> {
  const result = await getBlob(resultKey(id))
  if (!result) throw new Error("Локальная копия готового результата не найдена.")
  // Полный 4K-файл сервер кладёт сам при генерации. Если он там уже есть, повторная
  // загрузка с клиента заменила бы его ужатой копией (лимит тела запроса) — не трогаем.
  const status = await serverStatus()
  const serverHasFull = status.persistence ? await remoteAssetExists(resultKey(id)).catch(() => false) : false
  if (!serverHasFull) await putBlobDurably(resultKey(id), result)
  const thumb = (await getBlob(thumbResultKey(id))) ?? (await makeThumb(result))
  await putBlobDurably(thumbResultKey(id), thumb)
}
