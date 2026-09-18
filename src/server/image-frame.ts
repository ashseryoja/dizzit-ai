import "server-only"

import sharp from "sharp"

import type { NormalizedBox } from "@/server/image-postprocess"
import type { AspectRatio, ImageReference } from "@/server/image-provider"

/**
 * Кадр пользователя без обрезки. Провайдер умеет только свои пропорции
 * (API Models: 1:1, 2:3, 3:2, 4:3, 3:4, 16:9, 9:16, 21:9), и рендер 1,70 он
 * рисовал как 16:9 — модель подгоняла кадр сама и срезала низ или верх.
 *
 * Теперь кадр подгоняется до генерации: исходник (и карта областей того же
 * формата) дополняется по бокам или сверху-снизу мягкими полями до ближайшей
 * пропорции провайдера — зеркальное продолжение, сильно размытое, чтобы модель
 * видела «картинку целиком» и не перекомпоновывала её. В промпт добавляется
 * пояснение, что поля не часть проекта. После генерации `finalizeGeneratedImage`
 * вырезает из результата ровно исходный кадр (`box`) и доводит его до точной
 * пропорции.
 */

export interface FramePlan {
  /** Пропорция, которую получит провайдер (одна из его собственных). */
  providerAspect: AspectRatio
  /** Где в подогнанной картинке (и значит в результате) лежит реальный кадр, в долях. */
  box: NormalizedBox
  /** Поля по ширине (`x`) или по высоте (`y`). */
  axis: "x" | "y"
  /** Доля полей с каждой стороны от размера подогнанной картинки по этой оси. */
  bandShare: number
}

/** Разница пропорций, ниже которой подгонка не нужна (≈ 0,5 %). */
const SAME_RATIO = 0.005
/** Референс считается «того же кадра», если его пропорция отличается не больше чем на 2 %. */
const SAME_FRAME = 0.02

function ratioOf(aspect: AspectRatio): number {
  return aspect.width / aspect.height
}

/**
 * План подгонки: `requested` — пропорция кадра пользователя, `providerRatio` —
 * пропорция, в которой провайдер отдаст результат. `null` — подгонять нечего.
 */
export function planFrame(requested: AspectRatio, providerRatio: number): FramePlan | null {
  const ratio = ratioOf(requested)
  if (!Number.isFinite(ratio) || ratio <= 0 || Math.abs(Math.log(providerRatio / ratio)) < SAME_RATIO) return null
  const providerAspect = { width: Math.round(providerRatio * 10_000), height: 10_000 }
  if (providerRatio > ratio) {
    // Провайдер шире кадра — поля слева и справа.
    const share = ratio / providerRatio
    const band = (1 - share) / 2
    return { providerAspect, box: { x0: band, y0: 0, x1: 1 - band, y1: 1 }, axis: "x", bandShare: band }
  }
  const share = providerRatio / ratio
  const band = (1 - share) / 2
  return { providerAspect, box: { x0: 0, y0: band, x1: 1, y1: 1 - band }, axis: "y", bandShare: band }
}

async function dimensions(bytes: Uint8Array): Promise<{ width: number; height: number }> {
  const metadata = await sharp(bytes, { limitInputPixels: 100_000_000 }).metadata()
  const oriented = metadata.autoOrient
  const width = oriented?.width ?? metadata.width ?? 0
  const height = oriented?.height ?? metadata.height ?? 0
  return { width, height }
}

/** Размеры подогнанной картинки и поля по сторонам для кадра `width × height`. */
function padding(width: number, height: number, plan: FramePlan) {
  const target = ratioOf(plan.providerAspect)
  if (plan.axis === "x") {
    const total = Math.max(0, Math.round(height * target) - width)
    const left = Math.floor(total / 2)
    return { left, right: total - left, top: 0, bottom: 0, width: width + total, height }
  }
  const total = Math.max(0, Math.round(width / target) - height)
  const top = Math.floor(total / 2)
  return { left: 0, right: 0, top, bottom: total - top, width, height: height + total }
}

/**
 * Поля подгонки для исходника: зеркальное продолжение кадра, размытое так, что
 * читается как расфокус, а не как второй экземпляр мебели. Резкий кадр лежит
 * поверх ровно в центре.
 */
async function padSource(bytes: Uint8Array, plan: FramePlan): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const { width, height } = await dimensions(bytes)
  const pad = padding(width, height, plan)
  const oriented = await sharp(bytes, { limitInputPixels: 100_000_000 }).autoOrient().toBuffer()
  const sigma = Math.max(8, Math.round(Math.max(pad.width, pad.height) * 0.012))
  const mirrored = await sharp(oriented)
    .extend({ left: pad.left, right: pad.right, top: pad.top, bottom: pad.bottom, extendWith: "mirror" })
    .blur(sigma)
    .toBuffer()
  const data = await sharp(mirrored)
    .composite([{ input: oriented, left: pad.left, top: pad.top }])
    .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
    .toBuffer()
  return { bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: pad.width, height: pad.height }
}

/**
 * Подгонка референсов под план. Первый — исходник: зеркальные размытые поля.
 * Остальные того же кадра (карта областей) получают ТЕ ЖЕ поля исходника — без
 * своих пометок: отражённый номер области в поле модель приняла бы за вторую
 * область. Референсы другого формата (стиль, крупный план) уходят как есть.
 */
export async function padReferences(
  references: ImageReference[],
  requested: AspectRatio,
  plan: FramePlan
): Promise<{ references: ImageReference[]; box: NormalizedBox } | null> {
  if (references.length === 0) return null
  const ratio = ratioOf(requested)
  const first = await dimensions(references[0].bytes)
  if (!first.width || !first.height || Math.abs(Math.log(first.width / first.height / ratio)) > SAME_FRAME) return null

  const source = await padSource(references[0].bytes, plan)
  // Где лежит кадр — по фактическим пикселям полей исходника, а не по округлённой пропорции.
  const sourcePad = padding(first.width, first.height, plan)
  const box: NormalizedBox = {
    x0: sourcePad.left / sourcePad.width,
    y0: sourcePad.top / sourcePad.height,
    x1: (sourcePad.left + first.width) / sourcePad.width,
    y1: (sourcePad.top + first.height) / sourcePad.height,
  }
  const result: ImageReference[] = [{ bytes: source.bytes, mimeType: "image/jpeg", name: references[0].name.replace(/\.[^.]+$/, ".jpg") }]

  for (const reference of references.slice(1)) {
    const own = await dimensions(reference.bytes)
    if (!own.width || !own.height || Math.abs(Math.log(own.width / own.height / ratio)) > SAME_FRAME) {
      result.push(reference)
      continue
    }
    const pad = padding(own.width, own.height, plan)
    const background = await sharp(source.bytes).resize(pad.width, pad.height, { fit: "fill" }).toBuffer()
    const oriented = await sharp(reference.bytes, { limitInputPixels: 100_000_000 }).autoOrient().toBuffer()
    const data = await sharp(background)
      .composite([{ input: oriented, left: pad.left, top: pad.top }])
      .jpeg({ quality: 92, chromaSubsampling: "4:4:4" })
      .toBuffer()
    result.push({ bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), mimeType: "image/jpeg", name: reference.name.replace(/\.[^.]+$/, ".jpg") })
  }
  return { references: result, box }
}

/** Пояснение модели: поля подгонки — не часть проекта, реальный кадр не двигать. */
export function frameNote(plan: FramePlan, referenceCount: number): string {
  const sides = plan.axis === "x" ? "the left and right edges" : "the top and bottom edges"
  const dimension = plan.axis === "x" ? "width" : "height"
  const percent = Math.max(1, Math.round(plan.bandShare * 100))
  const images = referenceCount > 1 ? "IMAGE 1 and every other reference image of the same frame were" : "IMAGE 1 was"
  return [
    `FORMAT EXTENSION: to fit the output format, ${images} extended with soft, heavily blurred bands along ${sides} (about ${percent}% of the ${dimension} on each side). These bands are NOT part of the design and will be cut off after generation; the real frame is the sharp area between them.`,
    "Keep that real frame exactly where it is: every wall, object, edge and horizon at the same position and scale, nothing shifted, zoomed, rotated or re-framed, nothing pushed into or pulled out of the bands. Fill the bands with a natural, unremarkable continuation of the scene (same surfaces, same light), never with new objects, and never use them as a reason to move anything inside the real frame.",
  ].join("\n")
}
