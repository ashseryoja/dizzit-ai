"use client"

import {
  PREVIEW_ENGINE,
  cropToAspect,
  imageProviderStatus,
  prepareReference,
  readBlobSize,
  requestImage,
  sizeForAspect,
  type GeneratedImage,
} from "@/lib/image-generation"
import type { ShotKind, ViewFrame, ViewPreset } from "@/types"

/**
 * Движок раскадровки.
 *
 * Основной путь — `prepareViewSet` → `render(frame)`: общий план один раз
 * уменьшается до референса, и каждый кадр сета — свой запрос к gpt-image-2
 * (`lib/image-generation` → `/api/images`): ракурсы — та же сцена с другой
 * точки в пропорции исходника, крупные планы — портрет, обрезанный до 4:5.
 * Комментарий «что показать крупно» раздаётся крупным планам по порядку.
 *
 * Без ключа провайдера — ПРЕДПРОСМОТР на canvas (`planShots` +
 * `renderFrameLocally`), результат помечен `engine: "preview"`:
 *
 * - крупные планы (деталь, фактура, фрагмент) — вырезки 4:5 из кадра вокруг
 *   самых «насыщенных» мест: карта градиентов по уменьшенной копии, окно с
 *   максимумом, подавление соседей, чтобы кадры сета не смотрели в одну точку;
 * - ракурсы (сверху, снизу, слева, справа) — перспективное искажение кадра на
 *   canvas: трапеция и вписанный прямоугольник, размер исходника.
 */

const PRESET_SHOTS: Record<ViewPreset, ShotKind[]> = {
  // Готовая карусель: два ракурса, две детали, фактура и фрагмент.
  set: ["top", "low", "detail", "detail", "texture", "fragment"],
  details: ["detail", "detail", "detail", "detail"],
  angles: ["top", "low", "left", "right"],
  fragments: ["fragment", "fragment", "fragment", "fragment"],
}

export const PRESET_LABEL: Record<ViewPreset, string> = {
  set: "Сет",
  details: "Детали",
  angles: "Ракурсы",
  fragments: "Фрагменты",
}

export const SHOT_LABEL: Record<ShotKind, string> = {
  top: "сверху",
  low: "снизу",
  left: "слева",
  right: "справа",
  detail: "деталь",
  texture: "фактура",
  fragment: "фрагмент",
}

/** Ракурс — вся сцена, размер исходника; остальное — вырезки 4:5. */
export function isWideShot(kind: ShotKind): boolean {
  return kind === "top" || kind === "low" || kind === "left" || kind === "right"
}

/** Кадры сета с уникальными ключами; повторы одного типа нумеруются в подписи. */
export function framesOf(preset: ViewPreset): ViewFrame[] {
  const kinds = PRESET_SHOTS[preset]
  const total: Partial<Record<ShotKind, number>> = {}
  for (const kind of kinds) total[kind] = (total[kind] ?? 0) + 1
  const seen: Partial<Record<ShotKind, number>> = {}
  return kinds.map((kind) => {
    const n = (seen[kind] ?? 0) + 1
    seen[kind] = n
    return {
      key: `${kind}-${n}`,
      kind,
      label: (total[kind] ?? 1) > 1 ? `${SHOT_LABEL[kind]} ${n}` : SHOT_LABEL[kind],
    }
  })
}

/* Ключи кадров в общем хранилище блобов: префикс — id записи, поэтому
   сборка мусора (gcBlobs) видит их живыми, пока жива запись. */
export const viewKey = (id: string, frameKey: string) => `${id}:view-${frameKey}`
export const viewThumbKey = (id: string, frameKey: string) => `${id}:thumb-view-${frameKey}`

/** Все ключи кадров записи — для каскадного удаления вместе с keysOf(id). */
export function viewKeysOf(id: string, frames: ViewFrame[]): string[] {
  return frames.flatMap((frame) => [viewKey(id, frame.key), viewThumbKey(id, frame.key)])
}

export type ViewResult = GeneratedImage

/* ── Основной путь: модель ──────────────────────────────────────────── */

/** Пропорция крупных планов: портрет 4:5, как в каруселях. */
const CLOSEUP_ASPECT = 4 / 5

const ANGLE_PROMPT: Record<"top" | "low" | "left" | "right", string> = {
  top: "Photograph the same scene from an elevated camera position looking down at it (high angle, roughly 35–45 degrees above the horizon), so the layout of the space reads clearly.",
  low: "Photograph the same scene from a low camera position close to the floor, looking slightly upward (low angle), keeping the scene grounded and natural.",
  left: "Photograph the same scene with the camera moved to the left side of the space and turned toward it, so the scene is seen from that side and its right-hand part opens up.",
  right: "Photograph the same scene with the camera moved to the right side of the space and turned toward it, so the scene is seen from that side and its left-hand part opens up.",
}

/** Крупные планы без подсказки: чтобы кадры одного типа смотрели на разное. */
const DETAIL_SUBJECTS = [
  "the most prominent piece of furniture in the scene",
  "a secondary object: a lamp, a vase, an armchair or a piece of decor",
  "a decor item or accessory visible in the scene",
  "a functional element: a handle, a fixture, a shelf or a joint between materials",
]
const TEXTURE_SUBJECTS = [
  "the most characteristic material surface of the scene (wood grain, stone, plaster or fabric weave)",
  "a second, different material surface of the scene",
  "a third, different material surface of the scene",
  "a fourth, different material surface of the scene",
]
const FRAGMENT_SUBJECTS = [
  "the main functional zone of the space",
  "a different corner or zone of the same space",
  "another part of the space not shown in the previous fragments",
  "a fourth distinct zone of the space",
]

/** «ваза, кресло, торшер» → отдельные сюжеты для крупных планов по порядку. */
function noteSubjects(note: string): string[] {
  return note
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

/**
 * Промпт кадра. Сюжеты из комментария раздаются крупным планам (деталь,
 * фактура, фрагмент) в порядке сета; кому не хватило — типовой сюжет по номеру.
 */
export function buildViewPrompt(frame: ViewFrame, frames: ViewFrame[], note: string): string {
  const shared = [
    "The attached image is a render of a space. Produce a new photograph of exactly the same space: the same objects, materials, colors, finishes and lighting — nothing added, removed or restyled.",
  ]
  if (isWideShot(frame.kind)) {
    return [
      ...shared,
      ANGLE_PROMPT[frame.kind as keyof typeof ANGLE_PROMPT],
      "Keep the same aspect ratio as the reference. Photorealistic, no text, no watermark.",
    ].join("\n")
  }

  const closeups = frames.filter((item) => !isWideShot(item.kind))
  const position = closeups.findIndex((item) => item.key === frame.key)
  const subjects = noteSubjects(note)
  const requested = position >= 0 && position < subjects.length ? subjects[position] : null
  const ordinal = closeups.filter((item, index) => item.kind === frame.kind && index < position).length

  let shot: string
  if (frame.kind === "detail") {
    shot = `A close-up photograph of ${requested ?? DETAIL_SUBJECTS[ordinal % DETAIL_SUBJECTS.length]}, as it exists in this scene, with shallow depth of field and the object fully in frame.`
  } else if (frame.kind === "texture") {
    shot = `An extreme close-up (macro) of ${requested ?? TEXTURE_SUBJECTS[ordinal % TEXTURE_SUBJECTS.length]}, showing its texture and the way light falls on it.`
  } else {
    shot = `A photograph of ${requested ?? FRAGMENT_SUBJECTS[ordinal % FRAGMENT_SUBJECTS.length]}, framed tighter than the reference, as a fragment of this same interior.`
  }
  return [
    ...shared,
    shot,
    "Portrait orientation, the subject centered with some margin around it. Photorealistic, same lighting as the reference, no text, no watermark.",
  ].join("\n")
}

export interface ViewSetRenderer {
  /** Один кадр сета. Кадры независимы — их можно считать по несколько разом. */
  render(frame: ViewFrame): Promise<ViewResult>
}

/**
 * Подготовка сета: провайдер настроен — референс уменьшается один раз на все
 * кадры; нет — план вырезок для предпросмотра считается один раз на сет.
 */
export async function prepareViewSet(source: Blob, frames: ViewFrame[], note: string): Promise<ViewSetRenderer> {
  const status = await imageProviderStatus()
  if (status.configured) {
    const { width, height } = await readBlobSize(source)
    const reference = await prepareReference(source)
    const wideSize = sizeForAspect(width, height)
    return {
      async render(frame) {
        const wide = isWideShot(frame.kind)
        const image = await requestImage({
          prompt: buildViewPrompt(frame, frames, note),
          size: wide ? wideSize : "1024x1536",
          references: [reference],
        })
        return wide ? image : cropToAspect(image, CLOSEUP_ASPECT)
      },
    }
  }
  const plan = await planShots(source, frames)
  return {
    render: (frame) => renderFrameLocally(source, frame, plan),
  }
}

/* ── Предпросмотр без ключа ─────────────────────────────────────────── */

/** Область кадра в пикселях исходника. */
export interface Region {
  x: number
  y: number
  w: number
  h: number
}

/** План сета: где вырезать крупные планы. Считается один раз на сет. */
export interface ShotPlan {
  regions: Record<string, Region>
}

type Ctx = CanvasRenderingContext2D

function makeCanvas(width: number, height: number): [HTMLCanvasElement, Ctx] {
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas 2D недоступен")
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  return [canvas, ctx]
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Браузер не смог закодировать кадр"))),
      type,
      quality
    )
  })
}

/* ── Крупные планы: карта «насыщенности» ─────────────────────────────── */

/** Ширина уменьшенной копии для анализа: хватает, чтобы найти предметы. */
const ANALYSIS_WIDTH = 128

/** Ширина окна вырезки в долях ширины кадра — по типу крупного плана. */
const CROP_WIDTH: Record<"detail" | "texture" | "fragment", number> = {
  fragment: 0.55,
  detail: 0.34,
  texture: 0.2,
}

/** Пропорция вырезок предпросмотра — та же 4:5. */
const CROP_ASPECT = CLOSEUP_ASPECT

interface Saliency {
  aw: number
  ah: number
  /** Интегральная карта градиентов (aw+1)×(ah+1). */
  integral: Float64Array
}

/** Карта градиентов по уменьшенной серой копии: где рисунок, там и предметы. */
function analyze(bitmap: ImageBitmap): Saliency {
  const aw = Math.min(ANALYSIS_WIDTH, bitmap.width)
  const ah = Math.max(8, Math.round((bitmap.height * aw) / bitmap.width))
  const canvas = document.createElement("canvas")
  canvas.width = aw
  canvas.height = ah
  const ctx = canvas.getContext("2d", { willReadFrequently: true })
  if (!ctx) throw new Error("Canvas 2D недоступен")
  ctx.drawImage(bitmap, 0, 0, aw, ah)
  const { data } = ctx.getImageData(0, 0, aw, ah)

  const gray = new Float32Array(aw * ah)
  for (let i = 0; i < aw * ah; i += 1) {
    gray[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
  }
  const grad = new Float32Array(aw * ah)
  for (let y = 0; y < ah; y += 1) {
    for (let x = 0; x < aw; x += 1) {
      const left = gray[y * aw + Math.max(0, x - 1)]
      const right = gray[y * aw + Math.min(aw - 1, x + 1)]
      const up = gray[Math.max(0, y - 1) * aw + x]
      const down = gray[Math.min(ah - 1, y + 1) * aw + x]
      grad[y * aw + x] = Math.abs(right - left) + Math.abs(down - up)
    }
  }
  const integral = new Float64Array((aw + 1) * (ah + 1))
  for (let y = 1; y <= ah; y += 1) {
    let row = 0
    for (let x = 1; x <= aw; x += 1) {
      row += grad[(y - 1) * aw + (x - 1)]
      integral[y * (aw + 1) + x] = integral[(y - 1) * (aw + 1) + x] + row
    }
  }
  return { aw, ah, integral }
}

function windowSum(map: Saliency, x0: number, y0: number, x1: number, y1: number): number {
  const stride = map.aw + 1
  return (
    map.integral[y1 * stride + x1] -
    map.integral[y0 * stride + x1] -
    map.integral[y1 * stride + x0] +
    map.integral[y0 * stride + x0]
  )
}

/**
 * Лучшее окно заданного размера: максимум средней «насыщенности» с мягким
 * приоритетом средне-нижней части кадра (там мебель и предметы) и штрафом
 * рядом с уже выбранными окнами — чтобы кадры сета не повторяли друг друга.
 */
function pickWindow(
  map: Saliency,
  w: number,
  h: number,
  taken: { cx: number; cy: number; r: number }[]
): { x: number; y: number } {
  const step = Math.max(1, Math.round(w / 8))
  let best = { x: 0, y: 0 }
  let bestScore = -1
  for (let y = 0; y + h <= map.ah; y += step) {
    for (let x = 0; x + w <= map.aw; x += step) {
      const cx = x + w / 2
      const cy = y + h / 2
      let score = windowSum(map, x, y, x + w, y + h) / (w * h)
      const vertical = Math.abs(cy / map.ah - 0.62) / 0.5
      score *= 0.75 + 0.25 * (1 - Math.min(1, vertical))
      for (const point of taken) {
        if (Math.hypot(cx - point.cx, cy - point.cy) < (point.r + Math.max(w, h) / 2) * 0.8) score *= 0.2
      }
      if (score > bestScore) {
        bestScore = score
        best = { x, y }
      }
    }
  }
  return best
}

/** План крупных планов сета: крупные окна выбираются первыми, мелкие — в остатке. */
export async function planShots(source: Blob, frames: ViewFrame[]): Promise<ShotPlan> {
  const crops = frames.filter((frame) => !isWideShot(frame.kind))
  if (crops.length === 0) return { regions: {} }

  const bitmap = await createImageBitmap(source)
  try {
    const map = analyze(bitmap)
    const scale = bitmap.width / map.aw
    const taken: { cx: number; cy: number; r: number }[] = []
    const regions: Record<string, Region> = {}
    const order = [...crops].sort(
      (a, b) =>
        CROP_WIDTH[b.kind as keyof typeof CROP_WIDTH] - CROP_WIDTH[a.kind as keyof typeof CROP_WIDTH]
    )
    for (const frame of order) {
      let w = Math.max(4, Math.round(map.aw * CROP_WIDTH[frame.kind as keyof typeof CROP_WIDTH]))
      let h = Math.round(w / CROP_ASPECT)
      if (h > map.ah) {
        h = map.ah
        w = Math.max(4, Math.round(h * CROP_ASPECT))
      }
      const { x, y } = pickWindow(map, w, h, taken)
      taken.push({ cx: x + w / 2, cy: y + h / 2, r: Math.max(w, h) / 2 })
      regions[frame.key] = {
        x: Math.round(x * scale),
        y: Math.round(y * scale),
        w: Math.round(w * scale),
        h: Math.round(h * scale),
      }
    }
    return { regions }
  } finally {
    bitmap.close()
  }
}

/** Вырезка 4:5 по плану, растянутая до высоты исходника (в разумных пределах). */
function cropShot(source: ImageBitmap, region: Region): HTMLCanvasElement {
  const outH = Math.min(source.height, 2000)
  const outW = Math.round(outH * CROP_ASPECT)
  const x = Math.min(Math.max(0, region.x), source.width - 1)
  const y = Math.min(Math.max(0, region.y), source.height - 1)
  const w = Math.max(1, Math.min(region.w, source.width - x))
  const h = Math.max(1, Math.min(region.h, source.height - y))
  const [out, ctx] = makeCanvas(outW, outH)
  ctx.drawImage(source, x, y, w, h, 0, 0, outW, outH)
  return out
}

/* ── Ракурсы: перспективное искажение ───────────────────────────────── */

/** Дальний край трапеции относительно ближнего: чем меньше, тем сильнее поворот. */
const FAR = 0.8

/**
 * Поворот камеры вбок: кадр режется на вертикальные полосы, ближний край
 * во всю высоту, дальний — ниже; полосы у дальнего края уже. Затем берётся
 * вписанный прямоугольник и растягивается обратно в размер исходника.
 */
function turnSideways(source: ImageBitmap, width: number, height: number, nearLeft: boolean): HTMLCanvasElement {
  const [warp, ctx] = makeCanvas(width, height)
  const slices = Math.min(width, 720)
  const sliceW = width / slices
  const scales: number[] = []
  let total = 0
  for (let i = 0; i < slices; i += 1) {
    const t = (i + 0.5) / slices
    const s = nearLeft ? 1 - (1 - FAR) * t : FAR + (1 - FAR) * t
    scales.push(s)
    total += s
  }
  let x = 0
  for (let i = 0; i < slices; i += 1) {
    const s = scales[i]
    const w = (width * s) / total
    const h = height * s
    ctx.drawImage(source, i * sliceW, 0, sliceW, height, x, (height - h) / 2, w + 0.6, h)
    x += w
  }
  const [out, outCtx] = makeCanvas(width, height)
  const cropH = height * FAR
  outCtx.drawImage(warp, 0, (height - cropH) / 2, width, cropH, 0, 0, width, height)
  return out
}

/** Камера выше или ниже: горизонтальные полосы, ближний край шире дальнего. */
function tiltCamera(source: ImageBitmap, width: number, height: number, nearBottom: boolean): HTMLCanvasElement {
  const [warp, ctx] = makeCanvas(width, height)
  const slices = Math.min(height, 720)
  const sliceH = height / slices
  const scales: number[] = []
  let total = 0
  for (let i = 0; i < slices; i += 1) {
    const t = (i + 0.5) / slices
    const s = nearBottom ? FAR + (1 - FAR) * t : 1 - (1 - FAR) * t
    scales.push(s)
    total += s
  }
  let y = 0
  for (let i = 0; i < slices; i += 1) {
    const s = scales[i]
    const h = (height * s) / total
    const w = width * s
    ctx.drawImage(source, 0, i * sliceH, width, sliceH, (width - w) / 2, y, w, h + 0.6)
    y += h
  }
  const [out, outCtx] = makeCanvas(width, height)
  const cropW = width * FAR
  outCtx.drawImage(warp, (width - cropW) / 2, 0, cropW, height, 0, 0, width, height)
  return out
}

export async function renderFrameLocally(source: Blob, frame: ViewFrame, plan: ShotPlan): Promise<ViewResult> {
  const bitmap = await createImageBitmap(source)
  try {
    const { width, height } = bitmap
    let canvas: HTMLCanvasElement
    switch (frame.kind) {
      case "left":
        canvas = turnSideways(bitmap, width, height, true)
        break
      case "right":
        canvas = turnSideways(bitmap, width, height, false)
        break
      case "top":
        canvas = tiltCamera(bitmap, width, height, true)
        break
      case "low":
        canvas = tiltCamera(bitmap, width, height, false)
        break
      default: {
        const region = plan.regions[frame.key]
        if (!region) throw new Error("Для кадра нет плана вырезки — постройте сет заново.")
        canvas = cropShot(bitmap, region)
      }
    }
    const type = source.type === "image/png" ? "image/png" : "image/jpeg"
    const blob = await toBlob(canvas, type, type === "image/jpeg" ? 0.95 : undefined)
    return { blob, width: canvas.width, height: canvas.height, engine: PREVIEW_ENGINE }
  } finally {
    bitmap.close()
  }
}
