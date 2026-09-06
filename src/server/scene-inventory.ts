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

/** Длинная сторона картинки для vision-модели: детали видны, токены дёшевы. */
export const SCENE_ANALYSIS_MAX_SIDE = 1280
/** Потолок инвентаря в промпте: длиннее — генератор начинает терять начало. */
export const SCENE_INVENTORY_MAX_CHARS = 1800
/** Сколько просим у модели: с запасом меньше потолка, чтобы хвост не резать. */
const SCENE_INVENTORY_TARGET_CHARS = 1400
/** Строк в секции OBJECTS: главное — крупные и «опасные» предметы, а не всё подряд. */
const SCENE_OBJECT_LINES = 12

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
    "You are the scene analyst in an architectural visualization pipeline. A generative image model will re-light and re-texture THIS EXACT IMAGE into a photograph. That model often misreads objects: a switched-off TV becomes a window or a painting, curtains melt into walls, lamps and chandeliers turn into blobs, mirrors lose their reflections. Your inventory is what stops that.",
    CONTEXT_FOCUS[context],
    `Look carefully at the image and return PLAIN TEXT in English, at most ${SCENE_INVENTORY_TARGET_CHARS} characters in total, with exactly these four sections:`,
    "ROOM: room type or subject; camera height and angle; lens feel (wide, normal, telephoto).",
    "LIGHT: every light source and its state — windows or openings with daylight direction and time-of-day feel; every fixture (pendant, chandelier, sconce, spot, LED strip or cove, floor or table lamp) and whether it is ON or OFF.",
    `OBJECTS: at most ${SCENE_OBJECT_LINES} lines, one per notable object, largest and most easily confused first, in the form "name — where in frame — material and color — state or details". Always cover: screens (TV, monitor: flat black glossy screen switched off, or what it shows; bezel; wall-mounted or on a stand), curtains (sheer or blackout, open or closed, rod or track, how the fabric falls), lamps and fixtures, mirrors and glass, artwork and photos (their subject), plants (real or artificial), rugs and textiles (weave, pile), wood, stone and metal finishes, built-ins and niches, doors and windows.`,
    "EASILY MISREAD: 2–5 short lines — shapes a generative model is likely to confuse, and what they truly are.",
    "Rules: describe only what is visible; never invent objects that are not there; keep every line short; no markdown, no bullets, no headings other than the four section labels.",
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
 * ставит крупное и спорное первым), а секция EASILY MISREAD — самая ценная для
 * генератора — остаётся целиком.
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
