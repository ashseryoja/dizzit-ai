"use client"

import { getBlob, putBlobDurably, resultKey, thumbResultKey } from "@/lib/blob-store"
import { makeThumb } from "@/lib/enhance-engine"

/**
 * Публикует готовый результат атомарно с точки зрения метаданных страницы:
 * вызывающий меняет запись на `done` только после подтверждения полного файла
 * и миниатюры серверным хранилищем. Локальные копии записываются первыми.
 */
export async function persistResultDurably(id: string, blob: Blob): Promise<void> {
  await putBlobDurably(resultKey(id), blob)
  await putBlobDurably(thumbResultKey(id), await makeThumb(blob))
}

/**
 * Дозагружает уже посчитанный результат. Используется после сетевого сбоя:
 * никакой image API здесь нет, поэтому кнопка «Повторить» не тратит токены.
 */
export async function repairPersistedResult(id: string): Promise<void> {
  const result = await getBlob(resultKey(id))
  if (!result) throw new Error("Локальная копия готового результата не найдена.")
  await putBlobDurably(resultKey(id), result)
  const thumb = (await getBlob(thumbResultKey(id))) ?? (await makeThumb(result))
  await putBlobDurably(thumbResultKey(id), thumb)
}
