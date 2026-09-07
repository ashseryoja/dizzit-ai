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
    "angle (kind top / low / left / right): the WHOLE space from a new, interesting camera position — from the doorway looking in, from floor level along the floor toward the light, from a high corner looking down, from behind a piece of furniture, through an opening, a reflection in a mirror or glass, a strict frontal symmetry. Choose the kind by where the camera goes: top = raised camera looking down, low = camera near the floor, left / right = camera moved to that side of the space.",
  detail:
    "detail: ONE specific object exactly as it appears in the image — name it and its place (\"the black ceramic vase on the oak console, right of centre\"), what stands behind it, how the light falls on it, shallow depth of field.",
  texture:
    "texture: a macro of ONE specific material visible in the image — the grain of the oak veneer panels, the pits of the travertine floor, the bouclé weave, the brushed brass of a handle — with raking light that shows relief.",
  fragment:
    "fragment: a compositional slice of the space tighter than the reference — a corner, a junction of two materials, an alignment of lines, a niche with its light — not a whole-room view.",
}

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
    "You are the art director of an interior and architecture photo shoot. The attached image is a render of a space. Plan a shot list for a designer's publication carousel: new photographs of EXACTLY this space — the same objects, materials, colors, finishes and lighting, nothing added, removed or restyled. Only the camera moves.",
    `Plan exactly ${slots.length} shots. ${REQUIRED_SLOTS_PREFIX} ${slots.join(", ")} (in Russian: ${composition}). Every shot will be generated in ${aspect} format — ${ORIENTATION[aspect]} — so compose each shot for that frame.`,
    "Shot kinds:",
    ...kinds.map((slot) => `- ${SLOT_BRIEF[slot]}`),
    "Be creative but honest: each shot must be visibly different from the others and from the reference framing — a different subject, a different part of the room, a different distance. Prefer what a good photographer would notice: the play of light on a surface, a junction of two materials, a silhouette against the window, a reflection, a repeated rhythm of legs or slats, the one object that gives the room its character. Never invent objects that are not in the image; name subjects concretely so the generator can find them in the reference.",
    wishes.length > 0
      ? `The designer asked to show these subjects close up, in this order, giving them the first detail shots: ${wishes.map((item) => `"${item}"`).join(", ")}.`
      : "",
    'Answer with a JSON array only, no prose, no markdown: [{"kind": "top|low|left|right|detail|texture|fragment", "label": "<2–4 Russian words, lowercase, naming the subject: \\"ваза на консоли\\", \\"вид из проёма\\", \\"шпон дуба крупно\\">", "brief": "<English, 1–3 sentences for the image generator: the subject exactly as it appears in the image and where it is in the reference frame, camera position and height, distance, framing for the format, light>"}, …]',
  ]
    .filter(Boolean)
    .join("\n")
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
    const { kind, label, brief } = item as Record<string, unknown>
    const cleanKind = typeof kind === "string" ? kind.trim().toLowerCase() : ""
    if (!isShotKind(cleanKind)) continue
    const cleanBrief = typeof brief === "string" ? brief.replace(/\s+/g, " ").trim().slice(0, 600) : ""
    if (!cleanBrief) continue
    const cleanLabel = typeof label === "string" ? label.replace(/\s+/g, " ").trim().slice(0, 48) : ""
    drafts.push({ kind: cleanKind, label: cleanLabel || undefined, brief: cleanBrief })
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
