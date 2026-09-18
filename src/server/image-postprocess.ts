import "server-only"

import sharp from "sharp"

import type { AspectRatio } from "@/server/image-provider"

/**
 * Финальный проход результата генерации по образцу канонизации обложек UpSound:
 * вырезка кадра, точный размер, Lanczos и JPEG высокого качества без цветовой
 * субдискретизации.
 *
 * Провайдер отдаёт только свои пропорции (у API Models — 1:1, 3:2, 4:3, 16:9…),
 * а рендер пользователя бывает любым: 1,70 вместо 16:9 модель молча подгоняла,
 * срезая пол или потолок. Поэтому кадр подгоняется ДО генерации полями
 * (`planFrame` + `padReferences`, файл `image-frame.ts`), а здесь результат
 * вырезается обратно ровно по исходному кадру (`box`) и приводится к точной
 * пропорции и длинной стороне.
 */

/** Прямоугольник в долях картинки: 0…1 по обеим осям. */
export interface NormalizedBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface FinalizeOptions {
  /** Длинная сторона итога в пикселях (Lanczos3). Нет — размер после вырезки. */
  longSide?: number
  /** Что вырезать из результата: реальный кадр внутри полей подгонки. */
  box?: NormalizedBox
  /**
   * Точная пропорция итога. Без `box` результат режется по центру до неё
   * (новые ракурсы в выбранном формате); с `box` — только выравнивается.
   */
  aspect?: AspectRatio
  /**
   * Бесшовный тайл (материалы): масштабирование «с заворотом» — края считаются
   * по соседям с противоположной стороны, и шов при повторе не появляется.
   */
  tileable?: boolean
}

export interface FinalizedImage {
  bytes: Uint8Array
  mimeType: "image/jpeg"
  width: number
  height: number
}

const JPEG = { quality: 95, chromaSubsampling: "4:4:4", progressive: true, optimiseCoding: true } as const

/** Центральная вырезка в пропорции `ratio` из картинки `width × height`, в долях. */
export function centerBox(width: number, height: number, ratio: number): NormalizedBox {
  const current = width / height
  if (Math.abs(Math.log(current / ratio)) < 0.002) return { x0: 0, y0: 0, x1: 1, y1: 1 }
  if (current > ratio) {
    const share = ratio / current
    return { x0: (1 - share) / 2, y0: 0, x1: (1 + share) / 2, y1: 1 }
  }
  const share = current / ratio
  return { x0: 0, y0: (1 - share) / 2, x1: 1, y1: (1 + share) / 2 }
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/**
 * Масштаб бесшовного тайла без шва: края продолжаются противоположной
 * стороной (`extend` с повтором), после масштаба поля отрезаются. Поле
 * подбирается так, чтобы его масштабированная ширина была целой — иначе
 * вырезка съезжала бы на полпикселя и повтор давал бы линию.
 */
async function resizeTile(pipeline: sharp.Sharp, width: number, height: number, targetWidth: number, targetHeight: number) {
  const scale = targetWidth / width
  const step = width / gcd(width, targetWidth)
  const pad = step <= 64 ? step * Math.max(1, Math.ceil(16 / step)) : 32
  const padded = await pipeline
    .extend({ left: pad, right: pad, top: pad, bottom: pad, extendWith: "repeat" })
    .toBuffer()
  const scaledPad = Math.round(pad * scale)
  return sharp(padded, { limitInputPixels: 200_000_000 })
    .resize(Math.round((width + pad * 2) * scale), Math.round((height + pad * 2) * scale), {
      fit: "fill",
      kernel: sharp.kernel.lanczos3,
      fastShrinkOnLoad: false,
    })
    .extract({ left: scaledPad, top: scaledPad, width: targetWidth, height: targetHeight })
}

/** Результат генерации → вырезка кадра, точная пропорция, Lanczos3, JPEG q95 4:4:4. */
export async function finalizeGeneratedImage(input: Uint8Array, options: FinalizeOptions = {}): Promise<FinalizedImage> {
  const source = sharp(input, { limitInputPixels: 100_000_000 })
  const metadata = await source.metadata()
  const oriented = metadata.autoOrient
  const sourceWidth = oriented?.width ?? metadata.width
  const sourceHeight = oriented?.height ?? metadata.height
  if (!sourceWidth || !sourceHeight) throw new Error("Не удалось определить размер результата генерации")

  const wantedRatio = options.aspect ? options.aspect.width / options.aspect.height : undefined
  const box = options.box ?? (wantedRatio ? centerBox(sourceWidth, sourceHeight, wantedRatio) : undefined)

  let pipeline = source.autoOrient()
  let width = sourceWidth
  let height = sourceHeight
  if (box && (box.x0 > 0 || box.y0 > 0 || box.x1 < 1 || box.y1 < 1)) {
    const left = Math.max(0, Math.round(box.x0 * sourceWidth))
    const top = Math.max(0, Math.round(box.y0 * sourceHeight))
    width = Math.max(1, Math.min(sourceWidth - left, Math.round((box.x1 - box.x0) * sourceWidth)))
    height = Math.max(1, Math.min(sourceHeight - top, Math.round((box.y1 - box.y0) * sourceHeight)))
    // Вырезка до масштаба: иначе Lanczos считал бы и поля подгонки.
    pipeline = sharp(await pipeline.extract({ left, top, width, height }).toBuffer(), { limitInputPixels: 100_000_000 })
  }

  // Итог — ровно в запрошенной пропорции: вырезка по пикселям даёт её с точностью до пикселя.
  const ratio = wantedRatio ?? width / height
  const long = options.longSide ?? Math.max(width, height)
  const targetWidth = ratio >= 1 ? long : Math.max(1, Math.round(long * ratio))
  const targetHeight = ratio >= 1 ? Math.max(1, Math.round(long / ratio)) : long

  if (targetWidth !== width || targetHeight !== height) {
    pipeline = options.tileable
      ? await resizeTile(pipeline, width, height, targetWidth, targetHeight)
      : pipeline.resize(targetWidth, targetHeight, {
          fit: "fill",
          kernel: sharp.kernel.lanczos3,
          withoutEnlargement: false,
          fastShrinkOnLoad: false,
        })
  }

  const { data, info } = await pipeline
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .jpeg(JPEG)
    .toBuffer({ resolveWithObject: true })

  return {
    bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    mimeType: "image/jpeg",
    width: info.width,
    height: info.height,
  }
}
