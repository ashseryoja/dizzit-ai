"use client"

/**
 * Локальный движок улучшения — ПРЕДПРОСМОТР, а не продукт.
 *
 * Настоящее улучшение (image-to-image модель, которая дорисовывает микродетали,
 * материалы и свет, не трогая геометрию) — серверная задача с очередью и
 * хранилищем, см. README «Куда добавлять новый инструмент». Пока провайдера
 * нет, этот движок держит инструмент рабочим end-to-end: деликатная
 * цветокоррекция canvas-фильтрами. Геометрия, состав кадра и РАЗМЕР не
 * меняются по построению: результат всегда в разрешении исходника.
 *
 * Настроек у обработки нет намеренно — тот же принцип, что у главной кнопки:
 * нажатие «Улучшить» не может остаться без результата и не требует решений.
 */

import { populateScene } from "@/lib/scene-population"
import type { EnhanceContext } from "@/types"

export const ENHANCE_ACCEPT = "image/png,image/jpeg,image/webp"
export const MAX_FILE_BYTES = 32 * 1024 * 1024
/** Пачка за одну отправку: как лимит вложений в прежнем чате. */
export const MAX_BATCH = 10

export interface EnhanceResult {
  blob: Blob
  width: number
  height: number
}

export function isAcceptedRender(file: File): boolean {
  return ENHANCE_ACCEPT.split(",").includes(file.type)
}

/** Размеры картинки без полной раскодировки в DOM. */
export async function readImageSize(file: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(file)
  try {
    return { width: bitmap.width, height: bitmap.height }
  } finally {
    bitmap.close()
  }
}

/** «Качество исходника» для индикатора в панели: 1–3 деления по мегапикселям. */
export function sourceQuality(width: number, height: number): 1 | 2 | 3 {
  const megapixels = (width * height) / 1_000_000
  if (megapixels < 1) return 1
  if (megapixels < 4) return 2
  return 3
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Браузер не смог закодировать результат"))),
      type,
      quality
    )
  })
}

export interface EnhanceOptions {
  /** Заселить сцену: стаффаж людей и растений по контексту кадра (lib/scene-population). */
  populate?: boolean
  context?: EnhanceContext
  /** Ключ детерминизма стаффажа — id записи: «Повторить» расставит тех же. */
  seed?: string
}

export async function enhanceLocally(source: Blob, options: EnhanceOptions = {}): Promise<EnhanceResult> {
  const bitmap = await createImageBitmap(source)
  try {
    const { width, height } = bitmap

    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas 2D недоступен")

    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    // Только глобальная тональная коррекция — никакой геометрии.
    // Safari до 18 игнорирует ctx.filter — там результат равен исходнику.
    ctx.filter = "contrast(1.05) saturate(1.08) brightness(1.01)"
    ctx.drawImage(bitmap, 0, 0, width, height)

    // Заселение — единственное, что добавляет в кадр новое; по явному тумблеру.
    if (options.populate) {
      populateScene(ctx, width, height, { context: options.context ?? "auto", seed: options.seed ?? "" })
    }

    // PNG остаётся PNG (рендеры часто с плоскими заливками), остальное — JPEG.
    const type = source.type === "image/png" ? "image/png" : "image/jpeg"
    const blob = await toBlob(canvas, type, type === "image/jpeg" ? 0.95 : undefined)
    return { blob, width, height }
  } finally {
    bitmap.close()
  }
}

/** Миниатюра для карточки галереи — маленький JPEG в IndexedDB. */
export async function makeThumb(source: Blob, maxSide = 512): Promise<Blob> {
  const bitmap = await createImageBitmap(source)
  try {
    const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(bitmap.width * k))
    canvas.height = Math.max(1, Math.round(bitmap.height * k))
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas 2D недоступен")
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await toBlob(canvas, "image/jpeg", 0.8)
  } finally {
    bitmap.close()
  }
}
