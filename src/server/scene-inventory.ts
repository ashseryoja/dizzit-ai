import "server-only"

import sharp from "sharp"

import type { ImageProviderId } from "@/server/image-provider"
import type { VisionImage, VisionProvider } from "@/server/vision-provider"
import type { EnhanceContext } from "@/types"

/**
 * Разбор сцены перед улучшением рендера: vision-модель составляет инвентарь
 * предметов (что это, где, из чего, в каком состоянии — телевизор выключен,
 * шторы тюлевые, люстра горит), и этот текст уходит в промпт gpt-image-2
 * как авторитетное описание. Без него генератор угадывает по пикселям и
 * путает: выключенный экран становится окном, шторы сливаются со стеной,
 * светильники плывут.
 *
 * Здесь только смысл: промпт аналитика, подготовка картинки и чистка ответа.
 * Транспорт — `vision-provider.ts`, выбор модели — `providers.ts`,
 * HTTP — `app/api/scene/route.ts`.
 */

/**
 * Длинная сторона картинки для vision-модели. 1600, а не 1280: поры травертина
 * и швы плит на полу при 1280 px сливаются в ровный тон, и модель видит
 * «микроцемент». Картинка режется на тайлы по 768 px — это +2–4 тайла,
 * около +$0,001 за разбор.
 */
export const SCENE_ANALYSIS_MAX_SIDE = 1600
/** Потолок инвентаря в промпте: длиннее — генератор начинает терять начало. */
export const SCENE_INVENTORY_MAX_CHARS = 3000
/** Сколько просим у модели: с запасом меньше потолка, чтобы хвост не резать. */
const SCENE_INVENTORY_TARGET_CHARS = 2300
/** Строк в секции OBJECTS: главное — крупные и «опасные» предметы, а не всё подряд. */
const SCENE_OBJECT_LINES = 10

const CONTEXT_FOCUS: Record<EnhanceContext, string> = {
  auto: "",
  interior: "The image is an interior. Pay special attention to screens, curtains, fixtures, mirrors, artwork, plants and textiles.",
  exterior:
    "The image is exterior architecture. Cover facades and their materials, glazing and what it reflects, roofs, railings, landscaping, paving, vehicles and the sky/light.",
  product:
    "The image is a product shot. Cover the product's parts, materials, seams and joints, labels or logos, surface finish, and the background/surface it stands on.",
}

export function buildSceneInventoryPrompt(context: EnhanceContext = "auto"): string {
  return [
    "You are the scene analyst in an architectural visualization pipeline. A generative image model will re-light and re-texture THIS EXACT IMAGE into a photograph. That model often misreads objects and swaps materials: a switched-off TV becomes a window or a painting, curtains melt into walls, lamps and chandeliers turn into blobs, mirrors lose their reflections, a travertine floor is repainted as microcement, oak veneer turns into laminate. The designer chose every material deliberately; a substituted material ruins the result. Your inventory is what stops that.",
    CONTEXT_FOCUS[context],
    `Look carefully at the image and return PLAIN TEXT in English, at most ${SCENE_INVENTORY_TARGET_CHARS} characters in total, with exactly these five sections:`,
    "ROOM: room type or subject; camera height and angle; lens feel (wide, normal, telephoto).",
    "LIGHT: every light source and its state — windows or openings with daylight direction and time-of-day feel; every fixture (pendant, chandelier, sconce, spot, LED strip or cove, floor or table lamp) and whether it is ON or OFF. For every fixture type give the exact COUNT and layout: count the ceiling spots and downlights one by one and state how they are grouped and spaced (e.g. \"recessed spots: 6, two rows of three along the corridor, each row on one side of the ceiling slot\"; \"LED cove: one continuous line along the left wall only\"). The generative model tends to merge, drop or add spots and to invent LED strips, and only an exact count stops that.",
    `MATERIALS: one line per major surface and finish, in this order — floor, walls, ceiling, worktops and tabletops, cabinet fronts and doors, large upholstery, curtains, then every other prominent finish. Form: "surface — ONE exact material — visible evidence (pits, pores, veining, flecks, speckle, grain, joints, weave) — pattern and layout — finish — color — NOT <the lookalike>". Look at the surface up close before naming it and commit to a single material: never write "X or Y", never hedge, never write just "stone", "wood", "tile" or "fabric". Name materials with an interior designer's precision: travertine, limestone, marble (with vein color), terrazzo, microcement, concrete, porcelain tile, oak / walnut / ash veneer, lacquer, lime plaster, bouclé, linen, velvet, leather, brushed brass, blackened steel, chrome. Lookalike guide: a warm beige or grey stone with a fine speckle of small pits and pores, soft mottling and thin straight joints between large slabs is travertine or limestone — NOT microcement (microcement is seamless with cloudy trowel marks and no pits) and NOT terrazzo (terrazzo has sharp-edged multicolor chips); a soft beige stone with cloudy, diffuse veining is honed marble or onyx — NOT quartz or plaster; a wood front with continuous natural grain and pores is veneer — NOT laminate; a textured grey stone wall with speckle is stone cladding — NOT painted plaster. State the layout: large-format slabs with thin joints, herringbone or straight planks, seamless. For a plank or tile floor also give the board width (narrow, medium or wide), roughly how many boards fit across the frame, the direction of the boards relative to the camera (along the view, across it, diagonal) and the exact tone (e.g. "pale honey oak, matte") — the generator tends to re-lay floors with narrower boards and a warmer tone. Then write the evidence you actually see so the generator can reproduce that exact texture even at a glance.`,
    `OBJECTS: at most ${SCENE_OBJECT_LINES} lines, one per notable object, largest and most easily confused first, in the form "name — where in frame — material and color — state or details". Always cover: screens (TV, monitor: flat black glossy screen switched off, or what it shows; bezel; wall-mounted or on a stand), curtains (sheer or blackout, open or closed, rod or track, how the fabric falls), lamps and fixtures, mirrors and glass, artwork and photos (their subject), plants (real or artificial), rugs and textiles (weave, pile), built-ins and niches, doors and windows. For every table, console, bench, chair, sofa and shelf describe its construction: the number, shape and thickness of its legs or supports and what is visible beneath and between them (e.g. "console — right of centre against the wood wall — four slender square oak legs, open underneath, floor and skirting visible between the legs") — the generator tends to fuse thin legs into a solid block.`,
    "EASILY MISREAD: 2–6 short lines — shapes and surfaces a generative model is likely to confuse, and what they truly are; always include the floor and the largest stone or wood surface if either could be mistaken for a plainer or smoother material (e.g. \"floor: fine-pored travertine slabs, NOT seamless microcement\"), and any thin or small elements that are likely to be merged, dropped or multiplied (rows of small spots, slender legs, thin frames, handles), stating their exact count.",
    "Rules: describe only what is visible; never invent objects or materials that are not there; keep every line short; no markdown, no bullets, no headings other than the five section labels.",
  ]
    .filter(Boolean)
    .join("\n")
}

/** Картинка для vision-модели: не длиннее 1280 px, JPEG среднего веса. */
export async function prepareSceneImage(bytes: Uint8Array, maxSide = SCENE_ANALYSIS_MAX_SIDE): Promise<VisionImage> {
  const { data } = await sharp(bytes, { limitInputPixels: 100_000_000 })
    .autoOrient()
    .resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true, kernel: sharp.kernel.lanczos3 })
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .jpeg({ quality: 86, progressive: false })
    .toBuffer({ resolveWithObject: true })
  return { bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), mimeType: "image/jpeg" }
}

const MISREAD_HEADER = /^EASILY MISREAD:/i
const OBJECTS_HEADER = /^OBJECTS:/i

/**
 * Ответ модели → строки инвентаря: без markdown, без пустых повторов, не
 * длиннее лимита и всегда по границе строки. Оборванный по `max_tokens`
 * хвост отбрасывается — недописанная строка хуже отсутствующей.
 *
 * Если текст длиннее потолка, укорачивается секция OBJECTS с конца (модель
 * ставит крупное и спорное первым), а секции MATERIALS (идёт перед OBJECTS) и
 * EASILY MISREAD — самые ценные для генератора — остаются целиком.
 */
export function tidyInventory(text: string, truncated = false): string {
  const lines = text
    .replace(/\r/g, "")
    .replace(/[*_`#]+/g, "")
    .split("\n")
    .map((line) => line.replace(/^\s*[-•]\s+/, "").trim())
  const compact: string[] = []
  for (const line of lines) {
    if (!line && compact[compact.length - 1] === "") continue
    compact.push(line)
  }
  while (compact.length > 0 && compact[compact.length - 1] === "") compact.pop()
  if (truncated && compact.length > 1) compact.pop()

  const length = (items: string[]) => items.join("\n").trim().length
  const misreadAt = compact.findIndex((line) => MISREAD_HEADER.test(line))
  const objectsAt = compact.findIndex((line) => OBJECTS_HEADER.test(line))
  if (objectsAt >= 0 && misreadAt > objectsAt) {
    // Конец секции OBJECTS — перед пустой строкой или заголовком MISREAD.
    let end = misreadAt
    while (end - 1 > objectsAt && compact[end - 1] === "") end -= 1
    while (length(compact) > SCENE_INVENTORY_MAX_CHARS && end - 1 > objectsAt) {
      compact.splice(end - 1, 1)
      end -= 1
    }
  }

  let result = compact.join("\n").trim()
  if (result.length > SCENE_INVENTORY_MAX_CHARS) {
    const cut = result.lastIndexOf("\n", SCENE_INVENTORY_MAX_CHARS)
    result = (cut > SCENE_INVENTORY_MAX_CHARS / 2 ? result.slice(0, cut) : result.slice(0, SCENE_INVENTORY_MAX_CHARS)).trim()
  }
  return result
}

export interface SceneInventoryResult {
  inventory: string
  provider: ImageProviderId
  model: string
  durationMs: number
  inputTokens?: number
  outputTokens?: number
  /** Сколько провайдеров цепочки отказали до удачного. */
  fallbacks: number
  /** Модель упёрлась в `max_tokens` — последняя строка отброшена. */
  truncated: boolean
}

/**
 * Общий дедлайн разбора: клиент ждёт до 110 с, роут живёт 120 с. Запасной
 * провайдер запускается, только если ему осталось хотя бы 20 с.
 */
const SCENE_ANALYSIS_DEADLINE_MS = 100_000
const MIN_ATTEMPT_MS = 20_000

/**
 * Инвентарь сцены по цепочке провайдеров: первый удачный ответ — результат.
 * Отказ одного (пустой ответ, лимит, сеть) — в серверный лог и к следующему;
 * отказали все — наружу уходит последняя ошибка.
 */
export async function analyzeScene(
  providers: VisionProvider[],
  source: { bytes: Uint8Array; mimeType: string },
  context: EnhanceContext = "auto",
  signal?: AbortSignal
): Promise<SceneInventoryResult> {
  if (providers.length === 0) throw new Error("Нет vision-провайдера для разбора сцены")
  const startedAt = Date.now()
  const image = await prepareSceneImage(source.bytes)
  const prompt = buildSceneInventoryPrompt(context)

  let lastError: unknown = null
  for (const [index, provider] of providers.entries()) {
    const remaining = SCENE_ANALYSIS_DEADLINE_MS - (Date.now() - startedAt)
    if (index > 0 && remaining < MIN_ATTEMPT_MS) break
    try {
      const answer = await provider.describe({
        prompt,
        image,
        maxTokens: provider.outputBudget,
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(remaining)]) : AbortSignal.timeout(remaining),
      })
      return {
        inventory: tidyInventory(answer.text, answer.truncated),
        provider: answer.provider,
        model: answer.model,
        durationMs: Date.now() - startedAt,
        inputTokens: answer.inputTokens,
        outputTokens: answer.outputTokens,
        fallbacks: index,
        truncated: answer.truncated,
      }
    } catch (error) {
      lastError = error
      if (signal?.aborted) break
      const reason = error instanceof Error ? error.message : String(error)
      if (index < providers.length - 1) {
        console.warn(`[scene-inventory] ${provider.id} ${provider.model} отказал (${reason.slice(0, 200)}), пробуем следующий`)
      }
    }
  }
  throw lastError ?? new Error("Разбор сцены не удался")
}
