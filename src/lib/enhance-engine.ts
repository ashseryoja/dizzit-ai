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
 * Перед промптом — разбор сцены (`lib/scene-analysis`): vision-модель
 * составляет инвентарь предметов кадра (телевизор выключен, шторы тюлевые,
 * люстра горит…), и он уходит в задание авторитетным описанием. Так генератор
 * не путает выключенный экран с окном и не сплавляет шторы со стеной.
 * Инвентарь сохраняется в записи и на повторе не считается заново.
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
import { describeScene, hasMaterialsSection, type SceneInventory } from "@/lib/scene-analysis"
import { populateScene } from "@/lib/scene-population"
import type { BatchFilter, BatchTime, BatchTools, EnhanceContext } from "@/types"

export const ENHANCE_ACCEPT = "image/png,image/jpeg,image/webp"
export const MAX_FILE_BYTES = 32 * 1024 * 1024
/** Итог улучшения: длинная сторона ровно 2000 px после Lanczos3. */
export const ENHANCE_LONG_SIDE = 2000
/** Пачка за одну отправку: как лимит вложений в прежнем чате. */
export const MAX_BATCH = 10

export interface EnhanceResult extends GeneratedImage {
  /** Инвентарь сцены, посчитанный в этом прогоне (нет — взят из записи или разбор выключен). */
  inventory?: SceneInventory
}

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
  /**
   * Инвентарь сцены от vision-модели (lib/scene-analysis). Есть в записи —
   * используется как есть; нет — `enhanceRender` запросит его сам.
   */
  inventory?: string
  /** Размер исходника: маленький рендер получает отдельную инструкцию. */
  sourceSize?: { width: number; height: number }
}

/** Что страница узнаёт по ходу обработки, до её конца. */
export interface EnhanceHooks {
  /** Инвентарь сцены получен — запись сохраняет его до платной генерации. */
  onInventory?: (inventory: SceneInventory) => void
}

/* ── Промпт ─────────────────────────────────────────────────────────── */

/** Ниже этой длинной стороны исходник считается маленьким и получает отдельную инструкцию. */
export const SMALL_SOURCE_LONG_SIDE = 1200

/**
 * Предметы кадра — как реальные предметы. Главная причина «не пойми чего» на
 * месте телевизора или штор — генератор не распознал предмет и дорисовал
 * форму; этот блок называет типичные случаи и их правильное поведение.
 */
export const OBJECT_IDENTITY_HINT =
  "OBJECT IDENTITY: Before changing a single pixel, recognize what every object in IMAGE 1 is and render it as exactly that real-world object with its true function, scale and material behavior; never let an ambiguous shape drift into a different object. A television or monitor stays a thin flat panel with a flat black glossy screen that is switched off (dark, with only faint dim reflections of the room) unless the source clearly shows content, with a slim bezel and its wall mount or stand — never a window, painting, mirror, niche or glowing rectangle. Curtains stay fabric: sheer voile is translucent and softly transmits daylight, blackout drapes are opaque with heavy vertical folds; both hang from their rod or ceiling track with natural pleats and a gentle break at the floor — never fused into the wall or turned into rigid panels. Light fixtures (pendants, chandeliers, sconces, spots, cove LED strips, floor and table lamps) keep their exact form, count, mounting and on/off state, with believable emissive glow, shades, cords and hardware. Windows and glass doors show a plausible exterior with correct exposure, real glass thickness, mullions and subtle reflections. Mirrors reflect the actual room consistently with the viewpoint. Artwork and photographs keep their exact subject, framing and mount. Plants get botanically believable leaves and stems; rugs and upholstery get true pile, weave and seams; wood keeps species-like grain, stone its veining, metal its brushed or polished finish."

/**
 * Материалы — как выбрал дизайнер. Вторая причина брака после «не тот предмет»:
 * генератор заменяет материал похожим, но более простым — травертин становится
 * микроцементом, шпон дуба — ламинатом, плитка теряет швы. Этот блок запрещает
 * подмену и объясняет, что фотореализм — это микроструктура ИМЕННО этого
 * материала, а не другой материал.
 */
export const MATERIAL_FIDELITY_HINT =
  "MATERIAL FIDELITY: Every surface keeps the exact material of IMAGE 1 (and of the MATERIALS section of the inventory when present): the same stone type, wood species and veneer grain direction, tile format with its joints and grout, fabric type and weave, metal finish, paint or plaster type, and the same base color and value. Photorealism here means rendering the true micro-structure of THAT material at correct scale — travertine's pits and fine linear veining, marble's vein color, oak's grain and pores, bouclé's loops, brushed brass's hairline finish — never swapping it for a smoother, plainer or more common lookalike. Travertine or limestone must not become microcement, concrete or plaster; a seamless floor must not gain joints and a slab or plank floor must not lose them; veneer must not become laminate; marble must not lose its veining; painted walls must not become plaster or stone and vice versa. Light may change how a material looks, never what it is."

/**
 * Замок на мелкую структуру: именно её генератор ломает чаще всего — сливает
 * тонкие ножки в монолит, меняет число потолочных спотов, перекладывает доски
 * пола. На пробе пользователя (коридор) из трёх групп спотов остались две,
 * появилась выдуманная LED-линия, под консолью пропал просвет, пол сменил
 * ширину досок и тон. Общего «preserve count» для этого мало.
 */
const STRUCTURE_LOCK_HINT =
  "STRUCTURE LOCK: Light fixtures keep their exact number, grouping, spacing and positions — count the ceiling spots, downlights, pendants and LED lines in IMAGE 1 and reproduce exactly that many in exactly those places; never merge two fixtures into one, drop one, add one, or turn spots into a strip or a strip into spots. Furniture keeps its exact construction: the same number, thickness and shape of legs, supports, shelves and frames, with the same open space beneath and between them — the floor and wall visible under a table, console, bench or sofa in IMAGE 1 stay visible; thin legs stay thin and separate, never fused into a solid block or a shadow mass. Floors keep the same board or slab format: the same plank or tile width, count across the frame, direction, joint layout, grain scale, finish and color — do not narrow, widen, rotate or re-lay the boards and do not shift the floor's tone. Doors, handles, skirtings, frames, mouldings and ceiling recesses keep their exact profile and position."

/** Инвентарь сцены — авторитетное описание кадра, сильнее любых спорных пикселей. */
export function sceneInventoryBlock(inventory: string | undefined): string {
  const text = inventory?.trim()
  if (!text) return ""
  return [
    "SCENE INVENTORY (authoritative visual analysis of IMAGE 1 — trust it over any ambiguous pixels):",
    text,
    "Render every listed object as exactly that object, in its listed position, material and state; give every surface in MATERIALS exactly the named material, pattern, layout and finish (and never the material it is marked NOT to be); resolve each EASILY MISREAD item as described. The inventory never authorizes adding, removing or moving anything.",
  ].join("\n")
}

/** Маленький исходник: размытые пятна — это предметы из инвентаря, а не новые объекты. */
function sourceQualityHint(size: EnhanceJob["sourceSize"]): string {
  if (!size || Math.max(size.width, size.height) >= SMALL_SOURCE_LONG_SIDE) return ""
  return `SOURCE QUALITY: IMAGE 1 is a low-resolution source (${Math.round(size.width)}×${Math.round(size.height)} px). Its soft, blocky or aliased shapes must be resolved into the objects named above with plausible fine detail at full output resolution — never into new or different objects. Do not reproduce its blur, compression artifacts or pixelation.`
}

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
  if (time === "keep") {
    // Режим «оставить как есть»: схема света — из исходника. Раньше сюда тоже
    // попадало «morning sunlight coming through window», и модель заливала
    // коридор солнцем из дальнего окна, попутно перерисовывая споты на потолке.
    return [
      `LIGHTING KEYWORDS: ${LIGHTING_KEYWORDS}.`,
      "EXISTING LIGHT: Keep the lighting scheme of IMAGE 1 — the same light sources, the same direction, the same balance of daylight and artificial light, the same time-of-day feel and mood. Do not introduce sunlight, sunbeams or a new opening that IMAGE 1 does not show; do not brighten a switched-off fixture or dim a lit one. Make the existing light physically believable instead: correct penumbra and contact shadows, indirect bounce, realistic falloff from each fixture, subtle specular glints on glass, metal and polished wood, gentle highlight roll-off. Keep windows and highlights recoverable; no fake flare overlay, exaggerated god rays, orange wash or random light sources.",
    ].join("\n")
  }
  const lightingKeywords = time === "morning" ? `${LIGHTING_KEYWORDS}, ${MORNING_SUNLIGHT_KEYWORD}` : LIGHTING_KEYWORDS
  return [
    `LIGHTING KEYWORDS: ${lightingKeywords}.`,
    "NATURAL SUNLIGHT: Use one coherent sun direction from an existing visible opening or a plausible off-camera window/opening. Add restrained volumetric sunbeams only where light can physically enter, soft shadows from windows, correct penumbra and contact shadows, warm direct highlights with cooler bounced skylight fill, and subtle specular sun glints on glass, metal and polished wood. Use gentle photographic highlight bloom and a barely perceptible lens flare when physically justified. Keep windows and highlights recoverable; no fake flare overlay, exaggerated god rays, orange wash or random light sources. Sunlight changes the illumination only, never the fixtures: every lamp, spot and strip of IMAGE 1 stays in place, in the same number.",
  ].join("\n")
}

/**
 * Термины обязательного журнального фотореализма. «Ultra-realistic» первым:
 * на пробе пользователя ChatGPT с запросом «ультрареалистичный рендер» дал
 * заметно более живую картинку (фактура штукатурки, ковра, дерева), чем наш
 * промпт без этого слова.
 */
const PHOTOREALISM_HINT =
  "ULTRA-REALISTIC EDITORIAL PHOTOREALISM: ultra-realistic, hyperrealistic, ultra-detailed, architectural photography, interior design magazine, photorealistic, 8k resolution, highly detailed, shot on Sony A7R IV, 35mm lens, depth of field (DoF). Treat camera and resolution phrases as a visual-quality brief: keep the actual requested output size, exact source viewpoint, perspective and focal-length feel."

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
    "misidentified objects, objects changed into different objects, TV screen turned into a window or painting, screen showing a landscape or glowing content, curtains merged into the wall, curtains turned into solid panels, melted or malformed light fixtures, lamps turned into blobs, missing fixtures, mirror without reflection, replaced artwork subject",
    "substituted materials, changed floor material, travertine or limestone turned into microcement or concrete or plaster, stone veining removed, marble veins repainted, tile joints or grout lines removed, seamless floor where the source has slabs or planks, added joints on a seamless floor, changed wood species, changed veneer grain direction, veneer turned into laminate, changed fabric type, changed metal finish, recolored materials",
    "changed number of spotlights, merged downlights, missing or extra ceiling spots, added LED strip, spots turned into a strip, redesigned ceiling lighting, moved fixtures, merged furniture legs, fused legs, thickened legs, filled-in space under furniture, solid block under a table or console, missing gap under furniture, changed plank width, narrower or wider boards, re-laid floor, rotated floor boards, changed floor color, shifted floor tone",
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
    "TASK: Transform IMAGE 1 from a computer-generated render into an ultra-realistic real professional photograph. IMAGE 1 is the authoritative design reference. The result must be immediately believable as an ultra-realistic photograph of a real, physically built subject — hyper-detailed, true-to-life materials and light — not a cleaner CGI render.",
    CONTEXT_HINT[job.context ?? "auto"],
    sceneInventoryBlock(job.inventory),
    "NON-NEGOTIABLE PRESERVATION: This is an enhancement of IMAGE 1, never a redesign or a reinterpretation. Keep the exact camera position, lens/focal-length feel, perspective, vertical lines, crop, aspect ratio, framing and composition. Preserve every wall, opening, ceiling, floor boundary, built-in element, piece of furniture, fixture and decor item in exactly the same shape, scale, count and position. Preserve the design, material identities, patterns and base colors. Do not redesign, restyle, invent, remove, move or replace anything unless the designer explicitly requests it below.",
    STRUCTURE_LOCK_HINT,
    improveQuality ? OBJECT_IDENTITY_HINT : "",
    improveQuality ? MATERIAL_FIDELITY_HINT : "",
    improveQuality ? sourceQualityHint(job.sourceSize) : "",
    improveQuality
      ? "RENDER-TO-PHOTO PASS: Do not merely upscale, sharpen or polish the existing CGI pixels. Re-light and re-render every visible surface as real material under real light while keeping the locked design unchanged. Use physically plausible global illumination, indirect bounce, ambient occlusion, ray tracing and consistent light direction/color temperature. Replace flat procedural shading with scale-accurate photographic material response: natural wood grain and pores, individual textile fibers and weave, subtle plaster variation, realistic glass thickness/refraction, metal roughness, joints, seams, tiny edge bevels and grounded surface contact. Add restrained micro-imperfections and non-uniform roughness so surfaces feel manufactured and touched, never sterile or synthetic."
      : "Preserve the rendering quality as is; apply only the changes requested below.",
    improveQuality
      ? "PHOTOGRAPHIC CAMERA RESPONSE: Preserve the source lens and viewpoint, with straight architectural verticals where relevant and natural edge-to-edge focus. Use balanced exposure, neutral white balance, realistic dynamic range and highlight roll-off, gentle micro-contrast, fine sensor-level texture and subtle depth cues. The image should feel like an unretouched professional design-editorial photograph appropriate to the scene. Avoid plastic surfaces, perfectly uniform textures, fake mirror reflections, glowing materials, crushed blacks, clipped whites, HDR halos, excessive saturation/contrast, oversharpening, waxy denoising, blur, coarse noise, banding, moire, repeated texture tiles, warped geometry and the glossy 3D-render look."
      : "",
    improveQuality ? PHOTOREALISM_HINT : "",
    improveQuality
      ? "CONTROLLED EDIT FREEDOM: Change how every existing surface responds to light — shading, shadows, reflections, microtexture and material response — so the result no longer inherits the flat CGI look. This freedom applies only to surface response and photographic rendering; it never extends to the light sources themselves (their number, placement, form and on/off state), nor to geometry, layout, objects, floor layout or camera. The preservation rules always win."
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

/**
 * Улучшение рендера: модель, а без ключа — локальный предпросмотр.
 *
 * При включённом улучшении качества и без готового инвентаря в задании сначала
 * идёт разбор сцены; его результат отдаётся в `hooks.onInventory` ещё до
 * генерации, чтобы запись сохранила его даже при сбое генератора. Разбор
 * не удался или выключен — улучшение идёт без инвентаря, как раньше.
 */
export async function enhanceRender(source: Blob, job: EnhanceJob, hooks: EnhanceHooks = {}): Promise<EnhanceResult> {
  const improveQuality = job.tools?.quality ?? true
  return withImageProvider(
    async () => {
      const { width, height } = await readBlobSize(source)
      const references = [await prepareReference(source)]
      if (job.regions && job.regions.length > 0) references.push(await renderRegionMap(source, job.regions))

      // Инвентарь без секции MATERIALS — из записи прошлых версий: разбираем заново.
      let inventory = hasMaterialsSection(job.inventory) ? job.inventory?.trim() : undefined
      let found: SceneInventory | undefined
      if (improveQuality && !inventory) {
        found = (await describeScene(source, { context: job.context })) ?? undefined
        if (found) {
          inventory = found.text
          hooks.onInventory?.(found)
        }
      }

      const prompts = buildEnhancePrompts({ ...job, inventory, sourceSize: { width, height } })
      const image = await requestImage({
        prompt: prompts.prompt,
        negativePrompt: prompts.negativePrompt,
        aspect: { width, height },
        references,
        provider: "apimodels",
        resolution: "2K",
        finalLongSide: improveQuality ? ENHANCE_LONG_SIDE : undefined,
      })
      return { ...image, inventory: found }
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
