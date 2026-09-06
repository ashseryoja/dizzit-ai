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
  auto: "SCENE TYPE: Infer the photographed subject from IMAGE 1 and use the corresponding real-world photographic language.",
  interior: "SCENE TYPE: interior architecture; aim for a natural high-end interior-design editorial photograph.",
  exterior: "SCENE TYPE: exterior architecture; aim for a natural high-end architectural editorial photograph.",
  product: "SCENE TYPE: product; aim for a natural premium product photograph with true-to-life scale and materials.",
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
  morning:
    "LIGHTING INTENT: soft early-morning sunlight from one plausible existing or off-camera opening, with warm highlights, cooler skylight fill and long gentle shadows.",
  day: "LIGHTING INTENT: bright natural daylight from one plausible existing or off-camera opening, with clean neutral color and soft directional shadows.",
  sunset:
    "LIGHTING INTENT: restrained golden-hour sunlight from one plausible existing or off-camera opening, with warm grazing highlights, cooler ambient fill and long soft shadows.",
  night:
    "LIGHTING INTENT: believable night-time exposure with the scene's existing artificial fixtures switched on. Do not introduce sunlight, daylight or an invented light source.",
}

/**
 * Реальный солнечный свет по умолчанию: не декоративный фильтр, а единая
 * физически правдоподобная схема. Ночью эта строка намеренно не добавляется.
 */
const LIGHTING_KEYWORDS =
  "volumetric lighting, god rays, cinematic lighting, soft natural light, global illumination, ambient occlusion, ray tracing"
const MORNING_SUNLIGHT_KEYWORD = "morning sunlight coming through window"

function naturalLightHint(time: BatchTime): string {
  if (time === "night") return ""
  const lightingKeywords =
    time === "keep" || time === "morning"
      ? `${LIGHTING_KEYWORDS}, ${MORNING_SUNLIGHT_KEYWORD}`
      : LIGHTING_KEYWORDS
  return [
    `LIGHTING KEYWORDS: ${lightingKeywords}.`,
    "NATURAL SUNLIGHT: Use one coherent sun direction from an existing visible opening or a plausible off-camera window/opening. Add restrained volumetric sunbeams only where light can physically enter, soft shadows from windows, correct penumbra and contact shadows, warm direct highlights with cooler bounced skylight fill, and subtle specular sun glints on glass, metal and polished wood. Use gentle photographic highlight bloom and a barely perceptible lens flare when physically justified. Keep windows and highlights recoverable; no fake flare overlay, exaggerated god rays, orange wash or random light sources.",
  ].join("\n")
}

/** Термины обязательного журнального фотореализма для дневных интерьеров. */
const PHOTOREALISM_HINT =
  "EDITORIAL PHOTOREALISM: architectural photography, interior design magazine, photorealistic, 8k resolution, highly detailed, shot on Sony A7R IV, 35mm lens, depth of field (DoF). Treat camera and resolution phrases as a visual-quality brief: keep the actual requested output size, exact source viewpoint, perspective and focal-length feel."

/**
 * GPT Image 2 не имеет отдельного weighted negative prompt, но наш API держит
 * запреты отдельным полем и бэкенд добавляет их последним строгим блоком.
 */
export function buildEnhanceNegativePrompt(job: EnhanceJob): string {
  const time = job.tools?.time ?? "keep"
  return [
    "cheap 3D render, low-quality CGI, obvious CGI, videogame graphics, flat technical visualization, plastic materials, waxy surfaces, rubbery fabric, perfectly uniform procedural textures, texture tiling, fake reflections, mirror-like wood, glowing materials",
    "flat lighting, sterile lighting, shadowless scene, inconsistent light direction, random light sources, fake HDR, HDR halos, clipped highlights, blown-out windows, crushed blacks, harsh artificial shadows, fake volumetric fog, exaggerated god rays, painted-on sunbeams, fake lens-flare overlay",
    "unnatural colors, neon color cast, orange wash, excessive saturation, excessive contrast, oversharpening, crunchy edges, waxy denoising, blur, low resolution, pixelation, JPEG artifacts, banding, moire, coarse noise",
    "cartoon, illustration, concept art, painterly image, surrealism, fantasy styling, miniature or dollhouse look",
    "fisheye distortion, warped perspective, leaning verticals, changed camera angle, changed crop, changed room geometry, moved walls, moved doors or windows, redesigned ceiling or floor, altered furniture, added furniture, removed objects, duplicated objects, floating objects, malformed decor, text, logo, watermark",
    time === "night" ? "sunlight, daylight, sunbeams, morning light, visible god rays" : "night-time exposure, black windows",
  ].join(", ")
}

export interface EnhancePrompts {
  prompt: string
  negativePrompt: string
}

export function buildEnhancePrompt(job: EnhanceJob): string {
  const tools = job.tools
  const improveQuality = tools ? tools.quality : true
  const time = tools?.time ?? "keep"
  const note = job.note?.trim() ?? ""
  const hasRegions = Boolean(job.regions && job.regions.length > 0)

  const lines: string[] = [
    "TASK: Transform IMAGE 1 from a computer-generated render into a convincing real professional photograph. IMAGE 1 is the authoritative design reference. The result must be immediately believable as a photograph of a real, physically built subject, not a cleaner CGI render.",
    CONTEXT_HINT[job.context ?? "auto"],
    "NON-NEGOTIABLE PRESERVATION: Keep the exact camera position, lens/focal-length feel, perspective, vertical lines, crop, aspect ratio, framing and composition. Preserve every wall, opening, ceiling, floor boundary, built-in element, piece of furniture, fixture and decor item in exactly the same shape, scale, count and position. Preserve the design, material identities, patterns and base colors. Do not redesign, restyle, invent, remove, move or replace anything unless the designer explicitly requests it below.",
    improveQuality
      ? "RENDER-TO-PHOTO PASS: Do not merely upscale, sharpen or polish the existing CGI pixels. Re-light and re-render every visible surface as real material under real light while keeping the locked design unchanged. Use physically plausible global illumination, indirect bounce, ambient occlusion, ray tracing and consistent light direction/color temperature. Replace flat procedural shading with scale-accurate photographic material response: natural wood grain and pores, individual textile fibers and weave, subtle plaster variation, realistic glass thickness/refraction, metal roughness, joints, seams, tiny edge bevels and grounded surface contact. Add restrained micro-imperfections and non-uniform roughness so surfaces feel manufactured and touched, never sterile or synthetic."
      : "Preserve the rendering quality as is; apply only the changes requested below.",
    improveQuality
      ? "PHOTOGRAPHIC CAMERA RESPONSE: Preserve the source lens and viewpoint, with straight architectural verticals where relevant and natural edge-to-edge focus. Use balanced exposure, neutral white balance, realistic dynamic range and highlight roll-off, gentle micro-contrast, fine sensor-level texture and subtle depth cues. The image should feel like an unretouched professional design-editorial photograph appropriate to the scene. Avoid plastic surfaces, perfectly uniform textures, fake mirror reflections, glowing materials, crushed blacks, clipped whites, HDR halos, excessive saturation/contrast, oversharpening, waxy denoising, blur, coarse noise, banding, moire, repeated texture tiles, warped geometry and the glossy 3D-render look."
      : "",
    improveQuality ? PHOTOREALISM_HINT : "",
    improveQuality
      ? "CONTROLLED EDIT FREEDOM: Make a substantial change to illumination, shadows, reflections, microtexture and surface shading so the result no longer inherits the flat CGI look. This freedom applies only to light and photographic material response; the preservation rules for geometry, layout, objects and camera always win."
      : "",
    improveQuality ? naturalLightHint(time) : "",
    tools ? FILTER_HINT[tools.filter] : "",
    tools ? TIME_HINT[time] : "",
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

/** Пара positive/negative для внутреннего API улучшения. */
export function buildEnhancePrompts(job: EnhanceJob): EnhancePrompts {
  return {
    prompt: buildEnhancePrompt(job),
    negativePrompt: buildEnhanceNegativePrompt(job),
  }
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
      const prompts = buildEnhancePrompts(job)
      return requestImage({
        prompt: prompts.prompt,
        negativePrompt: prompts.negativePrompt,
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
