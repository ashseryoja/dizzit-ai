"use client"

import { putBlob, putBlobDurably, sourceKey, thumbSourceKey } from "@/lib/blob-store"
import { makeThumb, readImageSize } from "@/lib/enhance-engine"
import { createId } from "@/lib/utils"
import type { GalleryItemMeta } from "@/types"

/** Исходник, сохранённый в хранилище: id новой записи и размеры кадра. */
export interface SavedSource {
  id: string
  width: number
  height: number
}

export interface SaveSourceOptions {
  /** Стабильный id уже созданного черновика. */
  id?: string
  /** Дождаться серверной копии, если серверное хранение включено. */
  durable?: boolean
}

/**
 * Положить исходник в IndexedDB под новым id: сам файл и миниатюра.
 * Общий первый шаг любого задания с файлом — от улучшения рендера до
 * фото → 3D. Бросает, если файл не читается как изображение или
 * хранилище недоступно; страница решает, что сказать пользователю.
 * Для серверного черновика `durable` ждёт и удалённую копию.
 */
export async function saveSourceFile(file: File, options: SaveSourceOptions = {}): Promise<SavedSource> {
  const { width, height } = await readImageSize(file)
  const id = options.id ?? createId()
  const save = options.durable ? putBlobDurably : putBlob
  await save(sourceKey(id), file)
  await save(thumbSourceKey(id), await makeThumb(file))
  return { id, width, height }
}

/**
 * Очередь пачки: карточки появляются все сразу (статус «обрабатывается»),
 * обработка идёт по одной — десяток канвасов разом раздул бы память.
 * add() сторов кладёт в голову списка, поэтому добавляем с конца: порядок
 * пачки в галерее совпадает с порядком выбора файлов.
 */
export async function runGalleryQueue<T extends GalleryItemMeta>(
  metas: T[],
  add: (meta: T) => void,
  run: (meta: T) => Promise<void>
): Promise<void> {
  for (const meta of [...metas].reverse()) add(meta)
  for (const meta of metas) await run(meta)
}
