"use client"

/**
 * Движок улучшения рендера.
 *
 * Основной путь — `enhanceRender`: промпт + исходник (и карта областей точечной
 * правки) уходят в gpt-image-2 через `lib/image-generation` → `/api/images`.
 * Модель дорисовывает микродетали, материалы и свет, не трогая геометрию и
 * состав кадра; результат — в ближайшей из пропорций провайдера, разрешение
 * по его ступени (2K у API Models).
 *
 * Без ключа провайдера работает `enhanceLocally` — ПРЕДПРОСМОТР на canvas:
 * деликатная цветокоррекция в размере исходника. Так главная кнопка не
 * остаётся без результата и в локальной разработке; такой результат помечен
 * `engine: "preview"`.
 *
 * Настроек у обработки нет намеренно — нажатие «Улучшить» не требует решений.
 */

import {
  PREVIEW_ENGINE,
  REFERENCE_MAX_SIDE,
  prepareReference,
  readBlobSize,
  requestImage,
  withImageProvider,
  type GeneratedImage,
} from "@/lib/image-generation"
import { BRUSH_HALF_WIDTH, type RegionPayload } from "@/lib/render-regions"
import { populateScene } from "@/lib/scene-population"
import type { BatchFilter, BatchTime, BatchTools, EnhanceContext } from "@/types"

export const ENHANCE_ACCEPT = "image/png,image/jpeg,image/webp"
export const MAX_FILE_BYTES = 32 * 1024 * 1024
/** Итог улучшения: длинная сторона ровно 2000 px после Lanczos3. */
export const ENHANCE_LONG_SIDE = 2000
/** Пачка за одну отправку: как лимит вложений в прежнем чате. */
export const MAX_BATCH = 10

export type EnhanceResult = GeneratedImage

export function isAcceptedRender(file: File): boolean {
  return ENHANCE_ACCEPT.split(",").includes(file.type)
}

/** Размеры картинки без полной раскодировки в DOM. */
export const readImageSize = readBlobSize

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
  /** Заселить сцену: стаффаж людей и растений по контексту кадра. */
  populate?: boolean
  context?: EnhanceContext
  /** Ключ детерминизма стаффажа предпросмотра — id записи: «Повторить» расставит тех же. */
  seed?: string
}

/** Задание модели: всё, что пользователь выбрал в композере. */
export interface EnhanceJob extends EnhanceOptions {
  /** Комментарий, уже собранный с подписями областей (lib/render-regions). */
  note?: string
  /** Пакетные функции: качество, фильтр, время суток. */
  tools?: BatchTools
  /** Области точечной правки — уходят моделью картой поверх исходника. */
  regions?: RegionPayload[]
}

/* ── Промпт ─────────────────────────────────────────────────────────── */

const CONTEXT_HINT: Record<EnhanceContext, string> = {
  auto: "",
  interior: "The image is an interior architectural visualization.",
  exterior: "The image is an exterior architectural visualization.",
  product: "The image is a product visualization.",
}

const FILTER_HINT: Record<BatchFilter, string> = {
  none: "",
  warm: "Apply a warm color grade to the whole image.",
  cool: "Apply a cool color grade to the whole image.",
  contrast: "Increase the overall contrast moderately.",
  mono: "Convert the image to black and white with a rich tonal range.",
}

const TIME_HINT: Record<BatchTime, string> = {
  keep: "",
  morning: "Change the lighting to soft early-morning light with long gentle shadows.",
  day: "Change the lighting to bright, clear daylight.",
  sunset: "Change the lighting to warm golden-hour sunset light.",
  night: "Change the lighting to night-time with the artificial lights of the scene switched on.",
}

export function buildEnhancePrompt(job: EnhanceJob): string {
  const tools = job.tools
  const improveQuality = tools ? tools.quality : true
  const note = job.note?.trim() ?? ""
  const hasRegions = Boolean(job.regions && job.regions.length > 0)

  const lines: string[] = [
    "TASK: Edit IMAGE 1 into a premium photorealistic architectural photograph. IMAGE 1 is the authoritative design reference.",
    CONTEXT_HINT[job.context ?? "auto"],
    "NON-NEGOTIABLE PRESERVATION: Keep the exact camera position, lens/focal-length feel, perspective, vertical lines, crop, aspect ratio, framing and composition. Preserve every wall, opening, ceiling, floor boundary, built-in element, piece of furniture, fixture and decor item in exactly the same shape, scale, count and position. Preserve the design, material identities, patterns and base colors. Do not redesign, restyle, invent, remove, move or replace anything unless the designer explicitly requests it below.",
    improveQuality
      ? "REALISM PASS: Keep the design unchanged while making it look captured by a professional architectural photographer. Use physically plausible global illumination and bounced light, balanced exposure and dynamic range, a natural white balance, consistent light direction and color temperature, soft contact shadows and ambient occlusion. Refine scale-accurate PBR material cues: fine texture, grain, weave, joints, micro-roughness, restrained specular response, realistic reflection and refraction, subtle edge bevels and contact between surfaces. Add only tiny real-world surface variation that does not change the design. Preserve crisp architectural detail with natural focus and depth; the image must feel photographic, not computer-generated."
      : "Preserve the rendering quality as is; apply only the changes requested below.",
    improveQuality
      ? "QUALITY CONTROL: clean high-end archviz finish, smooth tonal transitions, realistic glass and metals, detailed fabrics/wood/stone, clean edges and fine detail. Avoid plastic materials, fake mirror reflections, glowing surfaces, crushed blacks, clipped highlights, HDR halos, excessive saturation, excessive contrast, oversharpening, blur, noise, banding, moire, texture repetition, warped geometry and the glossy CGI look."
      : "",
    tools ? FILTER_HINT[tools.filter] : "",
    tools ? TIME_HINT[tools.time] : "",
    job.populate
      ? "Populate the scene: add a few people and, where appropriate, plants natural to this space, in correct scale and perspective, without covering the key elements of the composition."
      : "",
    hasRegions
      ? "Two images are attached. IMAGE 1 is the render to edit. IMAGE 2 is the same render with numbered marked areas (colored outlines with number badges). Apply each numbered instruction below only to the corresponding marked area. The output must not contain any outlines, badges or numbers."
      : "",
    "OUTPUT: Return one clean full-frame image with no crop or border. No text, labels, logos, signatures or watermark.",
    note ? `DESIGNER'S ALLOWED CHANGES (these override preservation only where explicit):\n${note}` : "",
  ]
  return lines.filter(Boolean).join("\n")
}

/* ── Карта областей ─────────────────────────────────────────────────── */

function payloadBounds(region: RegionPayload): { x0: number; y0: number } {
  const points = region.strokes.flat()
  return { x0: Math.min(...points.map((p) => p.x)), y0: Math.min(...points.map((p) => p.y)) }
}

/**
 * Копия исходника с нанесёнными областями: заливка и контур по фигуре, номер
 * в кружке у левого верхнего края — те же номера, что в тексте задания и на
 * бейджах редактора. Уходит моделью вторым референсом.
 */
export async function renderRegionMap(source: Blob, regions: RegionPayload[], maxSide = REFERENCE_MAX_SIDE): Promise<Blob> {
  const bitmap = await createImageBitmap(source)
  try {
    const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * k))
    const h = Math.max(1, Math.round(bitmap.height * k))
    const canvas = document.createElement("canvas")
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas 2D недоступен")
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(bitmap, 0, 0, w, h)

    const minSide = Math.min(w, h)
    const color = "#ff2d55"
    const fill = "rgba(255, 45, 85, 0.3)"
    const outline = Math.max(3, minSide * 0.006)

    regions.forEach((region, index) => {
      ctx.save()
      ctx.lineJoin = "round"
      ctx.lineCap = "round"
      if (region.shape === "rect" && region.strokes[0]?.length >= 2) {
        const [a, b] = region.strokes[0]
        const x = Math.min(a.x, b.x) * w
        const y = Math.min(a.y, b.y) * h
        const rw = Math.abs(b.x - a.x) * w
        const rh = Math.abs(b.y - a.y) * h
        ctx.fillStyle = fill
        ctx.fillRect(x, y, rw, rh)
        ctx.strokeStyle = color
        ctx.lineWidth = outline
        ctx.strokeRect(x, y, rw, rh)
      } else if (region.shape === "lasso") {
        const points = region.strokes[0] ?? []
        ctx.beginPath()
        points.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x * w, p.y * h) : ctx.lineTo(p.x * w, p.y * h)))
        ctx.closePath()
        ctx.fillStyle = fill
        ctx.fill()
        ctx.strokeStyle = color
        ctx.lineWidth = outline
        ctx.stroke()
      } else {
        ctx.strokeStyle = "rgba(255, 45, 85, 0.6)"
        ctx.lineWidth = Math.max(outline, (region.brush_half_width ?? BRUSH_HALF_WIDTH) * 2 * minSide)
        for (const stroke of region.strokes) {
          ctx.beginPath()
          stroke.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x * w, p.y * h) : ctx.lineTo(p.x * w, p.y * h)))
          ctx.stroke()
        }
      }
      ctx.restore()

      // Номер — кружок у левого верхнего края области, как бейдж в редакторе.
      const { x0, y0 } = payloadBounds(region)
      const radius = Math.max(14, minSide * 0.028)
      const cx = Math.min(w - radius, Math.max(radius, x0 * w))
      const cy = Math.min(h - radius, Math.max(radius, y0 * h))
      ctx.save()
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(cx, cy, radius, 0, Math.PI * 2)
      ctx.fill()
      ctx.strokeStyle = "#ffffff"
      ctx.lineWidth = Math.max(2, radius * 0.12)
      ctx.stroke()
      ctx.fillStyle = "#ffffff"
      ctx.font = `bold ${Math.round(radius * 1.2)}px system-ui, sans-serif`
      ctx.textAlign = "center"
      ctx.textBaseline = "middle"
      ctx.fillText(String(index + 1), cx, cy + radius * 0.05)
      ctx.restore()
    })

    return await toBlob(canvas, "image/jpeg", 0.9)
  } finally {
    bitmap.close()
  }
}

/* ── Основной путь ──────────────────────────────────────────────────── */

/** Улучшение рендера: модель, а без ключа — локальный предпросмотр. */
export async function enhanceRender(source: Blob, job: EnhanceJob): Promise<EnhanceResult> {
  const improveQuality = job.tools?.quality ?? true
  return withImageProvider(
    async () => {
      const { width, height } = await readBlobSize(source)
      const references = [await prepareReference(source)]
      if (job.regions && job.regions.length > 0) references.push(await renderRegionMap(source, job.regions))
      return requestImage({
        prompt: buildEnhancePrompt(job),
        aspect: { width, height },
        references,
        provider: "apimodels",
        resolution: "2K",
        finalLongSide: improveQuality ? ENHANCE_LONG_SIDE : undefined,
      })
    },
    () => enhanceLocally(source, job),
    { provider: "apimodels", resolution: "2K" }
  )
}

/* ── Предпросмотр без ключа ─────────────────────────────────────────── */

/**
 * Локальный предпросмотр: глобальная тональная коррекция canvas-фильтрами.
 * Геометрия, состав кадра и размер не меняются по построению.
 */
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
    return { blob, width, height, engine: PREVIEW_ENGINE }
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
