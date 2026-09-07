import "server-only"

import type { ImageProviderId } from "@/server/image-provider"
import { prepareSceneImage } from "@/server/scene-inventory"
import type { VisionProvider } from "@/server/vision-provider"
import { PRESET_SLOTS, SLOT_LABEL, assignShots, isShotKind, type ShotDraft, type ShotSlot } from "@/lib/view-presets"
import type { FrameAspect, ViewFrame, ViewPreset } from "@/types"

/**
 * Планировщик раскадровки («Ракурсы и детали»): vision-модель смотрит на
 * рендер и составляет список кадров под ЭТОТ интерьер — какую вазу снять
 * крупно, где стык материалов, какой ракурс здесь интересен (из дверного
 * проёма, от пола вдоль досок к окну, отражение в зеркале). Без него кадры
 * строились по шаблону «сверху, снизу, деталь 1, деталь 2» — одинаково для
 * любой сцены и скучно.
 *
 * Здесь только смысл: промпт арт-директора и разбор ответа. Транспорт —
 * `vision-provider.ts`, выбор модели — `providers.ts` (та же цепочка, что у
 * разбора сцены), HTTP — `app/api/shots/route.ts`. Планировщик — усилитель:
 * не ответил — кадры по шаблону.
 */

const ORIENTATION: Record<FrameAspect, string> = {
  "9:16": "tall vertical (stories)",
  "3:4": "vertical portrait",
  "1:1": "square",
  "4:3": "horizontal landscape",
  "16:9": "wide horizontal",
}

const SLOT_BRIEF: Record<ShotSlot, string> = {
  angle:
    "zone (kind top / low / left / right — which part of the image the crop takes): a wider crop of ONE zone of the image, roughly a quarter to a half of its width — the nightstand with the lamp and the corner of the headboard, the bench with the planter and the door edge, the armchair with its side table. The zone reads as a small composed still life, walls and floor only as background.",
  detail:
    "detail: a medium close-up crop around ONE clearly visible object with a little of its surroundings — name it and its place (\"the bonsai in the black bowl on the marble bench top, right of the bed\"), what is beside and behind it, how the light falls on it. Medium close-up, not extreme macro.",
  texture:
    "texture: a tight crop where a material sits on its object and meets an edge, a seam, a piping, a joint or a second material — the fabric panel joint with the sconce's light pool, the marble top edge over the drawer front, the blanket fringe over the bed edge. Never a flat patch of bare wall, floor or ceiling with nothing else in the crop.",
  fragment:
    "fragment: a tight crop of one corner that keeps a foreground layer and depth — the corner of the bed with the nightstand behind, the curtain edge with the bench and window light, the doorway with the planter — never more than 45% of the image on any side.",
}

/**
 * Редакторские правила — по каруселям дизайнеров с AI close-ups: каждый кадр —
 * кроп исходника, а не новая точка съёмки; один-три предмета крупно; вся
 * комната целиком и голые поверхности — брак.
 */
const EDITORIAL_RULES = [
  "Editorial rules, like a designer's carousel of AI close-ups:",
  "- every shot is a CROP of the input image: the camera does not move, geometry and perspective stay exactly as in the image; the shots differ by which part of the image they take and how tight;",
  "- every crop is a VIGNETTE: one to three objects, a clear focal point, rule of thirds, some surrounding context kept;",
  "- every crop should contain light doing something: a sconce's pool on fabric, an LED cove line on a marble top, window light across a blanket, a lamp shade's glow;",
  "- FORBIDDEN: a crop where a whole bed, sofa or the whole room fits; a crop larger than 45% of the image on any side; a crop that is mostly bare wall, floor, ceiling or curtain; a flat patch of one material with nothing else; two crops of the same subject; the full image as a crop;",
  "- crops must differ from each other in subject, position in the image and size.",
].join("\n")

/** Строка состава набора для промпта и для фальшивого провайдера в тестах: `REQUIRED SLOTS: angle, angle, detail…`. */
export const REQUIRED_SLOTS_PREFIX = "REQUIRED SLOTS:"

export function buildShotListPrompt(preset: ViewPreset, aspect: FrameAspect, note: string): string {
  const slots = PRESET_SLOTS[preset]
  const composition = slots.map((slot) => SLOT_LABEL[slot]).join(", ")
  const kinds = [...new Set(slots)]
  const wishes = note
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
  return [
    "You are the art director of an interior and architecture photo shoot. The attached image is a render of a space. Plan a shot list for a designer's publication carousel of close-ups: each shot is a CROP of this exact image — the same objects, materials, colors, finishes, lighting and perspective, nothing added, removed or restyled, the camera does not move — which an image model will then re-render at full resolution with photographic micro-detail.",
    `Plan exactly ${slots.length} shots. ${REQUIRED_SLOTS_PREFIX} ${slots.join(", ")} (in Russian: ${composition}). Every shot will be produced in ${aspect} format — ${ORIENTATION[aspect]} — so choose crop regions that work in that frame (the region you give will be adjusted to that proportion around its centre).`,
    "Shot kinds:",
    ...kinds.map((slot) => `- ${SLOT_BRIEF[slot]}`),
    EDITORIAL_RULES,
    "Be creative but honest: prefer what a good photographer would notice — the play of light on a surface, a junction of two materials, a repeated rhythm of legs or slats, the one object that gives the room its character. Never invent objects that are not in the image; name subjects concretely so the generator can find them in the reference.",
    wishes.length > 0
      ? `The designer asked to show these subjects close up, in this order, giving them the first detail shots: ${wishes.map((item) => `"${item}"`).join(", ")}.`
      : "",
    'Answer with a JSON array only, no prose, no markdown: [{"kind": "top|low|left|right|detail|texture|fragment", "label": "<2–4 Russian words, lowercase, naming the subject: \\"ваза на консоли\\", \\"тумба с лампой\\", \\"шпон дуба крупно\\">", "brief": "<English, 1–3 sentences for the image generator: the subject exactly as it appears in the image, what else is in the crop, where the light falls>", "region": [x, y, w, h]}, …] where region is the crop rectangle as fractions of the image width and height from 0 to 1 (x, y — top-left corner; w, h — size), chosen as the best composition around the subject. HARD LIMITS: no side of any region larger than 0.45 of the image (a bigger crop comes out as the whole picture again); texture 0.14–0.3, detail 0.22–0.42, fragment 0.28–0.45. Put the crop where the subject actually is in the image.',
  ]
    .filter(Boolean)
    .join("\n")
}

/** Область кропа [x, y, w, h] в долях кадра: числа от 0 до 1, не меньше 8 % стороны, внутри кадра. */
function parseRegion(value: unknown): [number, number, number, number] | undefined {
  if (!Array.isArray(value) || value.length !== 4) return undefined
  const nums = value.map((n) => (typeof n === "number" ? n : typeof n === "string" ? Number(n) : NaN))
  if (nums.some((n) => !Number.isFinite(n))) return undefined
  // Модель иногда отдаёт проценты или пиксели тысячной сетки — нормализуем.
  const scale = nums.some((n) => n > 1.5) ? (nums.some((n) => n > 100) ? 1000 : 100) : 1
  let [x, y, w, h] = nums.map((n) => n / scale)
  x = Math.min(Math.max(0, x), 0.99)
  y = Math.min(Math.max(0, y), 0.99)
  w = Math.min(Math.max(0.08, w), 1 - x)
  h = Math.min(Math.max(0.08, h), 1 - y)
  if (w >= 0.98 && h >= 0.98) return undefined
  return [x, y, w, h].map((n) => Math.round(n * 1000) / 1000) as [number, number, number, number]
}

/** Первый JSON-массив из ответа модели — заготовки кадров; мусор и лишние поля отбрасываются. */
export function parseShotList(text: string): ShotDraft[] {
  const start = text.indexOf("[")
  const end = text.lastIndexOf("]")
  if (start < 0 || end <= start) return []
  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []
  const drafts: ShotDraft[] = []
  for (const item of raw) {
    if (!item || typeof item !== "object") continue
    const { kind, label, brief, region } = item as Record<string, unknown>
    const cleanKind = typeof kind === "string" ? kind.trim().toLowerCase() : ""
    if (!isShotKind(cleanKind)) continue
    const cleanBrief = typeof brief === "string" ? brief.replace(/\s+/g, " ").trim().slice(0, 600) : ""
    if (!cleanBrief) continue
    const cleanLabel = typeof label === "string" ? label.replace(/\s+/g, " ").trim().slice(0, 48) : ""
    drafts.push({ kind: cleanKind, label: cleanLabel || undefined, brief: cleanBrief, region: parseRegion(region) })
  }
  return drafts
}

export interface ShotListResult {
  frames: ViewFrame[]
  provider: ImageProviderId
  model: string
  durationMs: number
  /** Сколько кадров пришло от модели (после чистки) — для лога. */
  proposed: number
  inputTokens?: number
  outputTokens?: number
  fallbacks: number
}

/** Общий дедлайн: клиент ждёт до 80 с, роут живёт 90 с. */
const PLAN_DEADLINE_MS = 75_000
const MIN_ATTEMPT_MS = 15_000

/**
 * Список кадров по цепочке провайдеров: первый ответ, из которого удалось
 * собрать хотя бы один кадр, — результат; остальные слоты добираются
 * шаблоном (`assignShots`). Все отказали или все ответы пустые — ошибка.
 */
export async function planShotList(
  providers: VisionProvider[],
  source: { bytes: Uint8Array; mimeType: string },
  options: { preset: ViewPreset; aspect: FrameAspect; note: string },
  signal?: AbortSignal
): Promise<ShotListResult> {
  if (providers.length === 0) throw new Error("Нет vision-провайдера для планировщика кадров")
  const startedAt = Date.now()
  const image = await prepareSceneImage(source.bytes)
  const prompt = buildShotListPrompt(options.preset, options.aspect, options.note)

  let lastError: unknown = null
  for (const [index, provider] of providers.entries()) {
    const remaining = PLAN_DEADLINE_MS - (Date.now() - startedAt)
    if (index > 0 && remaining < MIN_ATTEMPT_MS) break
    try {
      const answer = await provider.describe({
        prompt,
        image,
        maxTokens: provider.outputBudget,
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(remaining)]) : AbortSignal.timeout(remaining),
      })
      const drafts = parseShotList(answer.text)
      if (drafts.length === 0) throw new Error(`ответ без списка кадров: ${answer.text.slice(0, 120).replace(/\s+/g, " ")}`)
      return {
        frames: assignShots(drafts, options.preset),
        provider: answer.provider,
        model: answer.model,
        durationMs: Date.now() - startedAt,
        proposed: drafts.length,
        inputTokens: answer.inputTokens,
        outputTokens: answer.outputTokens,
        fallbacks: index,
      }
    } catch (error) {
      lastError = error
      if (signal?.aborted) break
      const reason = error instanceof Error ? error.message : String(error)
      if (index < providers.length - 1) {
        console.warn(`[shot-planner] ${provider.id} ${provider.model} отказал (${reason.slice(0, 200)}), пробуем следующий`)
      }
    }
  }
  throw lastError ?? new Error("Планировщик кадров не ответил")
}
