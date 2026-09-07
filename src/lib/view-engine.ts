"use client"

import { MATERIAL_FIDELITY_HINT, OBJECT_IDENTITY_HINT, sceneInventoryBlock } from "@/lib/enhance-engine"
import { frameAspectRatio, frameAspectSize } from "@/lib/frame-aspect"
import {
  PREVIEW_ENGINE,
  REFERENCE_MAX_SIDE,
  cropToAspect,
  imageProviderStatus,
  prepareReference,
  readBlobSize,
  requestImage,
  type GeneratedImage,
} from "@/lib/image-generation"
import { isWideShot } from "@/lib/view-presets"
import type { FrameAspect, ShotKind, ViewFrame } from "@/types"

export {
  PRESET_LABEL,
  PRESET_SLOTS,
  SHOT_LABEL,
  SLOT_LABEL,
  assignShots,
  buildFrames,
  describeSlots,
  framesOf,
  isWideShot,
} from "@/lib/view-presets"

/**
 * Движок раскадровки.
 *
 * Основной путь — `prepareViewSet` → `render(frame)`: общий план один раз
 * уменьшается до референса, и каждый кадр сета — свой запрос к gpt-image-2
 * (`lib/image-generation` → `/api/images`) в выбранном пользователем формате
 * (`FrameAspect`: провайдер отдаёт ближайшую свою пропорцию, остаток
 * обрезается до точного формата). Что именно снимать, кадру говорит `brief`
 * планировщика (`lib/shot-planning`); без него — типовой сюжет по типу
 * кадра, а комментарий «что показать крупно» раздаётся крупным планам по
 * порядку.
 *
 * Без ключа провайдера — ПРЕДПРОСМОТР на canvas (`planShots` +
 * `renderFrameLocally`), результат помечен `engine: "preview"`:
 *
 * - крупные планы (деталь, фактура, фрагмент) — вырезки в формате сета из
 *   кадра вокруг самых «насыщенных» мест: карта градиентов по уменьшенной
 *   копии, окно с максимумом, подавление соседей, чтобы кадры сета не
 *   смотрели в одну точку;
 * - ракурсы (сверху, снизу, слева, справа) — перспективное искажение кадра на
 *   canvas: трапеция и вписанный прямоугольник, затем обрезка до формата.
 */

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

/** Формат крупных планов у записей до появления выбора формата: портрет 4:5. */
export const LEGACY_CLOSEUP_ASPECT = 4 / 5

/** Длинная сторона кадра после серверного Lanczos3 — как у редактора рендера. */
export const VIEW_LONG_SIDE = 2000

/*
 * Кадр — КРОП исходника, а не новая точка съёмки (промпт по образцу
 * каруселей дизайнеров с AI close-ups): геометрия, перспектива, предметы и
 * свет остаются, меняется только кадрирование, модель дорисовывает детали в
 * полном размере. Область кропа даёт планировщик (`ViewFrame.region`); без
 * него — типовая область по типу кадра (зона — часть кадра, крупные планы —
 * «насыщенные» окна из плана предпросмотра). Область вырезается на клиенте
 * в формате сета и уходит модели единственным референсом: полного кадра
 * модель не видит и не может «отъехать» обратно к общему плану; что за
 * предметы и материалы в кропе, ей говорит инвентарь сцены в промпте.
 */

/** Типовые области зон в долях кадра: [x, y, w, h]. */
const ZONE_REGION: Record<"top" | "low" | "left" | "right", [number, number, number, number]> = {
  top: [0.275, 0.05, 0.45, 0.45],
  low: [0.275, 0.5, 0.45, 0.45],
  left: [0.05, 0.3, 0.45, 0.45],
  right: [0.5, 0.3, 0.45, 0.45],
}

const ZONE_PROMPT: Record<"top" | "low" | "left" | "right", string> = {
  top: "the upper zone of the image: the wall composition and what stands on the main surface (a sconce, a lamp, a shelf, a plant), as a small composed still life",
  low: "the lower zone of the image: the main surface with its objects, the furniture edge and the floor, as a small composed still life",
  left: "the left zone of the image: the corner where the main piece of furniture meets its neighbour",
  right: "the right zone of the image: the corner where the main piece of furniture meets its neighbour",
}

/** Крупные планы без подсказки: чтобы кадры одного типа смотрели на разное. */
const DETAIL_SUBJECTS = [
  "the one object that gives the room its character (a plant, a lamp, a vase, a chair), with its neighbours for context",
  "a secondary object: a lamp, a vase, a bowl on a stack of books, a cushion",
  "a decor item or accessory visible in the scene, with what stands next to it",
  "a functional element: a handle, a switch plate, a fixture, a shelf, with the material around it",
]
const TEXTURE_SUBJECTS = [
  "the most characteristic material of the scene on its object, where it meets an edge, seam or a second material",
  "a second material of the scene at an edge or joint, with a neighbouring surface in frame",
  "a third material at a seam, piping or hardware detail",
  "a fourth material where light rakes across it and a second surface is visible",
]
const FRAGMENT_SUBJECTS = [
  "the main zone of the space with a foreground layer (the edge of the bed, sofa or table nearest the camera)",
  "a different corner of the same space, framed with something near and something behind",
  "another zone not shown in the previous fragments, with depth from a foreground edge",
  "a fourth distinct zone of the space, framed tight",
]

/** Насколько тесно кадрировать — по типу кадра. */
const FRAMING: Record<ShotKind, string> = {
  top: "FRAMING: a wider crop of this zone, roughly a third to a half of the image, kept as a small composed still life with a clear focal point; walls and floor only as background.",
  low: "FRAMING: a wider crop of this zone, roughly a third to a half of the image, kept as a small composed still life with a clear focal point; walls and floor only as background.",
  left: "FRAMING: a wider crop of this zone, roughly a third to a half of the image, kept as a small composed still life with a clear focal point; walls and floor only as background.",
  right: "FRAMING: a wider crop of this zone, roughly a third to a half of the image, kept as a small composed still life with a clear focal point; walls and floor only as background.",
  detail: "FRAMING: medium close-up around the object with a little surrounding context — not extreme macro, the object fully in frame.",
  texture: "FRAMING: tight crop on the material where it meets an edge, seam or a second surface; the material fills most of the frame, but the edge keeps it readable as an object, not a flat swatch.",
  fragment: "FRAMING: a crop of one zone that keeps a foreground layer and depth — something near, something behind.",
}

const ORIENTATION: Record<FrameAspect, string> = {
  "9:16": "tall vertical",
  "3:4": "vertical portrait",
  "1:1": "square",
  "4:3": "horizontal",
  "16:9": "wide horizontal",
}

/** «ваза, кресло, торшер» → отдельные сюжеты для крупных планов по порядку. */
function noteSubjects(note: string): string[] {
  return note
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

/** Типовой сюжет кадра без задания планировщика. */
function templateShot(frame: ViewFrame, frames: ViewFrame[], note: string): string {
  if (isWideShot(frame.kind)) return ZONE_PROMPT[frame.kind as keyof typeof ZONE_PROMPT]
  const closeups = frames.filter((item) => !isWideShot(item.kind))
  const position = closeups.findIndex((item) => item.key === frame.key)
  const subjects = noteSubjects(note)
  const requested = position >= 0 && position < subjects.length ? subjects[position] : null
  const ordinal = closeups.filter((item, index) => item.kind === frame.kind && index < position).length
  if (frame.kind === "detail") return requested ?? DETAIL_SUBJECTS[ordinal % DETAIL_SUBJECTS.length]
  if (frame.kind === "texture") return requested ?? TEXTURE_SUBJECTS[ordinal % TEXTURE_SUBJECTS.length]
  return requested ?? FRAGMENT_SUBJECTS[ordinal % FRAGMENT_SUBJECTS.length]
}

export interface ViewPromptOptions {
  /** IMAGE 1 — уже вырезанная область, IMAGE 2 — весь кадр для контекста. */
  cropped?: boolean
}

/**
 * Промпт кадра — по образцу промптов для AI close-ups: исходник — единственная
 * основа, камера не двигается, кадр — кроп с лёгким улучшением. Сюжет — задание
 * планировщика (`frame.brief`) или типовой по типу кадра; сюжеты из
 * комментария раздаются крупным планам по порядку. Формат — выбранный
 * пользователем; у записей без формата — портрет для крупных планов.
 */
export function buildViewPrompt(
  frame: ViewFrame,
  frames: ViewFrame[],
  note: string,
  aspect?: FrameAspect,
  inventory?: string,
  options: ViewPromptOptions = {}
): string {
  const format = aspect
    ? `FORMAT: ${aspect}, ${ORIENTATION[aspect]} — a single image in this frame, no letterboxing, no borders.`
    : isWideShot(frame.kind)
      ? "FORMAT: keep the aspect ratio of the base image."
      : "FORMAT: portrait orientation, the subject centered with some margin around it."
  const base = options.cropped
    ? [
        "IMAGE 1 IS THE BASE — it is already the exact crop of the scene to produce: keep its framing, geometry, perspective, objects, materials and light exactly; the output shows precisely what IMAGE 1 shows, nothing beyond its edges.",
        "GOAL: re-render IMAGE 1 at full resolution as one realistic photograph — an enhancement of this crop, not a new render and not a wider view.",
      ]
    : [
        "INPUT IMAGE 1 IS THE BASE — use it as the only source. DO NOT change geometry. DO NOT change perspective. DO NOT reconstruct the scene. DO NOT add or remove objects. The camera does not move.",
        "GOAL: one single detail shot made by cropping into the existing image — this is a crop, not a new render; keep the original perspective exactly the same.",
      ]
  return [
    ...base,
    `SUBJECT: ${frame.brief ?? templateShot(frame, frames, note)}`,
    FRAMING[frame.kind],
    "COMPOSITION: refine only by cropping — rule of thirds, balanced framing, clear focal point. DEPTH OF FIELD: very subtle, do not blur heavily, keep most details readable.",
    "TEXTURE: enhance material realism slightly, add subtle micro-details (dust, tiny imperfections), do not exaggerate. LIGHT: keep the original lighting exactly, no new light sources. FILM & OPTICS: subtle film grain, very light chromatic aberration, minimal lens softness, no heavy effects.",
    sceneInventoryBlock(inventory),
    OBJECT_IDENTITY_HINT,
    MATERIAL_FIDELITY_HINT,
    format,
    "STRICT RULES: no geometry distortion, no perspective change, no hallucinated details, no new objects — only crop and enhancement. RESULT: a single realistic detail shot, accurate to the base image, clean, natural, believable; no collage, no grid, no text, no watermark.",
  ]
    .filter(Boolean)
    .join("\n")
}

/**
 * Вырезка области исходника в формате сета: область расширяется вокруг своего
 * центра до нужной пропорции, не выходя за кадр, и приводится к рабочему
 * размеру модели: большая уменьшается до `maxSide`, маленькая увеличивается
 * до `minSide` — модели нужна основа полного кадра, детали она дорисует.
 */
export const CROP_MIN_SIDE = 1536

export async function cropRegion(
  source: Blob,
  region: [number, number, number, number],
  ratio: number,
  maxSide = REFERENCE_MAX_SIDE,
  minSide = CROP_MIN_SIDE
): Promise<Blob> {
  const bitmap = await createImageBitmap(source)
  try {
    const W = bitmap.width
    const H = bitmap.height
    const [fx, fy, fw, fh] = region
    const cx = (fx + fw / 2) * W
    const cy = (fy + fh / 2) * H
    let w = Math.max(8, fw * W)
    let h = Math.max(8, fh * H)
    if (w / h < ratio) w = h * ratio
    else h = w / ratio
    if (w > W) {
      w = W
      h = W / ratio
    }
    if (h > H) {
      h = H
      w = H * ratio
    }
    const x = Math.min(Math.max(0, cx - w / 2), W - w)
    const y = Math.min(Math.max(0, cy - h / 2), H - h)
    const longest = Math.max(w, h)
    const k = longest > maxSide ? maxSide / longest : longest < minSide ? minSide / longest : 1
    const [canvas, ctx] = makeCanvas(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)))
    ctx.drawImage(bitmap, x, y, w, h, 0, 0, canvas.width, canvas.height)
    return await toBlob(canvas, "image/jpeg", 0.92)
  } finally {
    bitmap.close()
  }
}

export interface ViewSetRenderer {
  /** Один кадр сета. Кадры независимы — их можно считать по несколько разом. */
  render(frame: ViewFrame): Promise<ViewResult>
}

/**
 * Подготовка сета: провайдер настроен — референс уменьшается один раз на все
 * кадры, а для каждого кадра вырезается его область; нет — план вырезок для
 * предпросмотра считается один раз на сет. `aspect` — формат всех кадров; без
 * него (старые записи) зоны в пропорции исходника, крупные планы 4:5.
 * `inventory` — разбор сцены в промпт каждого кадра. Готовый кадр сервер
 * проходит Lanczos3 до `VIEW_LONG_SIDE`, как в редакторе рендера.
 */
export async function prepareViewSet(
  source: Blob,
  frames: ViewFrame[],
  note: string,
  aspect?: FrameAspect,
  inventory?: string
): Promise<ViewSetRenderer> {
  const status = await imageProviderStatus()
  const { width, height } = await readBlobSize(source)
  const ratioFor = (frame: ViewFrame): number =>
    aspect ? frameAspectRatio(aspect) : isWideShot(frame.kind) ? width / height : LEGACY_CLOSEUP_ASPECT
  // Область без планировщика: зона — типовая часть кадра, крупный план —
  // «насыщенное» окно из плана предпросмотра (пиксели → доли кадра).
  const needFallback = frames.some((frame) => !frame.region && !isWideShot(frame.kind))
  const fallback = needFallback ? await planShots(source, frames, ratioFor) : null
  const regionOf = (frame: ViewFrame): [number, number, number, number] | null => {
    if (frame.region) return frame.region
    if (isWideShot(frame.kind)) return ZONE_REGION[frame.kind as keyof typeof ZONE_REGION]
    const px = fallback?.regions[frame.key]
    return px ? [px.x / width, px.y / height, px.w / width, px.h / height] : null
  }
  if (status.configured) {
    // Полный кадр нужен только кадрам без области (старые записи без плана).
    const reference = frames.every((frame) => regionOf(frame)) ? null : await prepareReference(source)
    return {
      async render(frame) {
        const region = regionOf(frame)
        const crop = region ? await cropRegion(source, region, ratioFor(frame)) : null
        const base = crop ?? reference ?? (await prepareReference(source))
        // Провайдер подберёт ближайшую свою пропорцию; остаток обрежется до точного формата.
        const wanted = aspect ? frameAspectSize(aspect) : isWideShot(frame.kind) ? { width, height } : { width: 4, height: 5 }
        const image = await requestImage({
          prompt: buildViewPrompt(frame, frames, note, aspect, inventory, { cropped: Boolean(crop) }),
          aspect: wanted,
          references: [base],
          finalLongSide: VIEW_LONG_SIDE,
        })
        return cropToAspect(image, ratioFor(frame))
      },
    }
  }
  const plan = fallback ?? (await planShots(source, frames, ratioFor))
  return {
    render: (frame) => renderFrameLocally(source, frame, plan, ratioFor(frame)),
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

/**
 * План крупных планов сета: крупные окна выбираются первыми, мелкие — в
 * остатке. `ratioFor` — формат вырезки каждого кадра (ширина / высота).
 */
export async function planShots(source: Blob, frames: ViewFrame[], ratioFor: (frame: ViewFrame) => number): Promise<ShotPlan> {
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
      const ratio = ratioFor(frame)
      let w = Math.max(4, Math.round(map.aw * CROP_WIDTH[frame.kind as keyof typeof CROP_WIDTH]))
      let h = Math.max(4, Math.round(w / ratio))
      if (h > map.ah) {
        h = map.ah
        w = Math.max(4, Math.round(h * ratio))
      }
      if (w > map.aw) {
        w = map.aw
        h = Math.max(4, Math.round(w / ratio))
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

/** Вырезка по плану в формате кадра, растянутая до размера исходника (в разумных пределах). */
function cropShot(source: ImageBitmap, region: Region, ratio: number): HTMLCanvasElement {
  const longest = Math.min(Math.max(source.width, source.height), 2000)
  const outW = ratio >= 1 ? longest : Math.round(longest * ratio)
  const outH = ratio >= 1 ? Math.round(longest / ratio) : longest
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

/** Центральная обрезка canvas до формата (ширина / высота); совпадает — как есть. */
function cropCanvasToAspect(canvas: HTMLCanvasElement, ratio: number): HTMLCanvasElement {
  const current = canvas.width / canvas.height
  if (Math.abs(current - ratio) < 0.01) return canvas
  let w = canvas.width
  let h = canvas.height
  if (current > ratio) w = Math.round(h * ratio)
  else h = Math.round(w / ratio)
  const [out, ctx] = makeCanvas(w, h)
  ctx.drawImage(canvas, Math.round((canvas.width - w) / 2), Math.round((canvas.height - h) / 2), w, h, 0, 0, w, h)
  return out
}

export async function renderFrameLocally(source: Blob, frame: ViewFrame, plan: ShotPlan, ratio: number): Promise<ViewResult> {
  const bitmap = await createImageBitmap(source)
  try {
    const { width, height } = bitmap
    let canvas: HTMLCanvasElement
    switch (frame.kind) {
      case "left":
        canvas = cropCanvasToAspect(turnSideways(bitmap, width, height, true), ratio)
        break
      case "right":
        canvas = cropCanvasToAspect(turnSideways(bitmap, width, height, false), ratio)
        break
      case "top":
        canvas = cropCanvasToAspect(tiltCamera(bitmap, width, height, true), ratio)
        break
      case "low":
        canvas = cropCanvasToAspect(tiltCamera(bitmap, width, height, false), ratio)
        break
      default: {
        const region = frame.region
          ? { x: frame.region[0] * width, y: frame.region[1] * height, w: frame.region[2] * width, h: frame.region[3] * height }
          : plan.regions[frame.key]
        if (!region) throw new Error("Для кадра нет плана вырезки — постройте сет заново.")
        canvas = cropShot(bitmap, region, ratio)
      }
    }
    const type = source.type === "image/png" ? "image/png" : "image/jpeg"
    const blob = await toBlob(canvas, type, type === "image/jpeg" ? 0.95 : undefined)
    return { blob, width: canvas.width, height: canvas.height, engine: PREVIEW_ENGINE }
  } finally {
    bitmap.close()
  }
}
