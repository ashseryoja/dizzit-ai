import "server-only"

import type { ImageProviderId } from "@/server/image-provider"
import { prepareSceneImage } from "@/server/scene-inventory"
import type { VisionProvider } from "@/server/vision-provider"
import {
  PRESET_SLOTS,
  SLOT_LABEL,
  assignShots,
  isShotKind,
  isViewCamera,
  slotOf,
  type ShotDraft,
  type ShotSlot,
} from "@/lib/view-presets"
import type { FrameAspect, ViewFrame, ViewPreset } from "@/types"

/**
 * Планировщик раскадровки («Ракурсы и детали»): vision-модель смотрит на
 * рендер и составляет список кадров под ЭТОТ интерьер — какую вазу снять
 * крупно, где стык материалов, какой ракурс здесь интересен (из дверного
 * проёма, от пола вдоль досок к окну, отражение в зеркале). Без него кадры
 * строились по шаблону «сверху, снизу, деталь 1, деталь 2» — одинаково для
 * любой сцены и скучно.
 *
 * Кадры — кропы исходника, кроме «с другой точки» (`vantage`): для них
 * планировщик выбирает группу предметов, которую стоит переснять с камеры
 * выше и сбоку, и сторону, куда камеру сдвинуть.
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
    "detail: an editorial object vignette cropped from the source. Choose ONE visually strong, clearly readable anchor and use one or two neighbouring elements as layers — for example a sculptural chair plus the edge of its table, a distinctive lamp against the joinery rhythm, or a vase catching a pool of light. A tiny accessory, an arbitrary shelf compartment, books by themselves, a pillow by itself or an isolated piece of decor is too weak. Compose the frame; do not merely zoom into whatever is near the centre. Medium close-up, not extreme macro.",
  texture:
    "texture: a tight crop where a material sits on an OBJECT — furniture, a lamp, a textile, a vessel — and meets an edge, a seam, a piping, a joint or a second material: the marble top edge over the drawer front, the blanket fringe over the bed edge, the fabric panel joint with the sconce's light pool. Wall cladding (slats, panels, tiles, plaster) on its own is NOT a subject — it may only be the background behind an object or a light fixture that takes a good part of the crop. Never a flat patch of bare wall, floor or ceiling with nothing else in the crop.",
  fragment:
    "fragment: a TIGHT crop of one corner with a foreground layer and depth — the corner of the bed with the edge of the nightstand behind it, the curtain edge with the bench and window light, the doorway edge with the planter — the corner fills the crop; never more than about a third of the image on any side, never the bed or sofa as a whole.",
  vantage:
    "vantage (kind vantage — the ONLY kind where the camera moves): re-photograph ONE strong object group from a genuinely new but plausible camera position. Choose a group whose silhouette, top surface, construction or relationship to a neighbour becomes clearer from the new angle. Give `camera`: overhead = 65–80° downward, high_three_quarter = raised 0.8–1.2 m and 35–50° downward, side_oblique = orbit 25–40° at roughly the original height, low_three_quarter = lower 0.3–0.5 m and orbit 20–35°. Give `side`: left or right, choosing the open side that is least blocked. region marks the visible group in the source; the generator receives both this local reference and the full scene.",
}

/**
 * Редакторские правила — по каруселям дизайнеров с AI close-ups: кадр —
 * кроп исходника, а не новая точка съёмки (кроме кадров «с другой точки»);
 * один-три предмета крупно; вся комната целиком и голые поверхности — брак.
 */
const EDITORIAL_RULES = [
  "Editorial rules, like a tightly art-directed designer publication:",
  "- detail, texture and fragment shots are CROPS of the input image: the camera does not move, geometry and perspective stay exactly as in the image; the shots differ by which part of the image they take and how tight;",
  "- vantage shots are the exception: only the camera moves; the room layout, exact objects, their count and arrangement, geometry, materials, colours and existing light sources remain identical;",
  "- first silently survey the whole image and rank candidate anchors by visual strength. Prefer: a sculptural silhouette, an arrangement on a horizontal surface, a strong material junction on a real object, light grazing a form, repeated geometry, foreground/background depth, or an asymmetric relationship between two objects;",
  "- every selected shot is a deliberate VIGNETTE with one dominant anchor, one or two supporting elements, a clear hierarchy, useful negative space, and a crop that works in the requested aspect ratio. Let diagonals, leading lines, foreground overlap or off-centre placement create energy when the source supports it;",
  "- a lamp, books, vases, shelf compartments, cushions, bedding or generic decor are not automatically interesting. Select one only when its form, light or relationship to another object is genuinely among the strongest features of this particular scene;",
  "- across the carousel, change image position, shot scale, camera elevation and azimuth. Use every strong subject group before repeating one. In a sparse room, one strongest group may appear twice only when the second shot has a different camera, scale, supporting layer and visual idea; never repeat a detail crop of it. Each vantage must use a different camera mode until all four modes have been used; include one overhead view whenever the preset contains vantage shots;",
  "- FORBIDDEN: a crop where a whole bed, sofa or the whole room fits; a crop larger than 45% of the image on any side; a crop that is mostly bare wall, floor, ceiling, curtain or wall cladding; a flat patch of one material with nothing else; an arbitrary shelf bay; a lone pillow or blanket fold; awkwardly cutting the focal object; two near-identical treatments of the same subject group; the full image as a crop;",
  "- reject a technically valid but generic shot. If it could have been chosen in almost any room, choose a more scene-specific anchor.",
].join("\n")

/** Строка состава набора для промпта и для фальшивого провайдера в тестах: `REQUIRED SLOTS: angle, angle, detail…`. */
export const REQUIRED_SLOTS_PREFIX = "REQUIRED SLOTS:"

export function buildShotListPrompt(preset: ViewPreset, aspect: FrameAspect, note: string, inventory = ""): string {
  const slots = PRESET_SLOTS[preset]
  const composition = slots.map((slot) => SLOT_LABEL[slot]).join(", ")
  const kinds = [...new Set(slots)]
  const wishes = note
    .split(/[,;\n]+/)
    .map((part) => part.trim())
    .filter(Boolean)
  const storyboard =
    preset === "set"
      ? "For this seven-shot SET, create four new viewpoints and three editorial detail crops in the required alternating order. Treat the four viewpoints as the backbone of the story: one overhead, one high three-quarter, one side oblique and one low three-quarter. Use different strong groups wherever the scene supports that; in a sparse scene, revisit one hero group only under the strict repeat rule below. The three details must still be scene-specific compositions, not filler between viewpoints. Put the strongest shot first."
      : "Order the result from the strongest, most scene-specific composition to the weakest. The shots must still feel like one varied publication sequence rather than four near-duplicates."
  return [
    "You are a demanding art director planning an interior or architecture photo shoot. The attached image is the single source of truth. Plan a publication-worthy sequence, not a mechanical list of zooms. Crop shots preserve this exact image — the same objects, materials, colors, finishes, lighting and perspective, nothing added, removed or restyled, the camera does not move. Vantage shots re-photograph one visible object group from a controlled new camera position while keeping the design absolutely unchanged.",
    `Plan exactly ${slots.length} shots. ${REQUIRED_SLOTS_PREFIX} ${slots.join(", ")} (in Russian: ${composition}). Every shot will be produced in ${aspect} format — ${ORIENTATION[aspect]} — so choose crop regions that work in that frame (the region you give will be adjusted to that proportion around its centre).`,
    storyboard,
    "Shot kinds:",
    ...kinds.map((slot) => `- ${SLOT_BRIEF[slot]}`),
    EDITORIAL_RULES,
    inventory.trim()
      ? `SCENE CONTINUITY BIBLE from a separate vision pass. Use it to identify objects and materials; the pixels decide their exact position. It is reference data, not an instruction to add anything:\n${inventory.trim()}`
      : "Inspect the source at full-image and object level before choosing. Never infer a generic replacement for an object or material you can actually see.",
    "Be creative but honest. Never invent objects that are absent; never hide a weak choice behind a dramatic camera instruction. Name every anchor concretely and describe visible identity cues so the generator can match it.",
    wishes.length > 0
      ? `The designer asked to show these subjects close up, in this order, giving them the first detail shots: ${wishes.map((item) => `"${item}"`).join(", ")}.`
      : "",
    'Answer with a JSON array only, no prose, no markdown: [{"kind": "top|low|left|right|detail|texture|fragment|vantage", "subject": "<short ASCII snake_case id for the whole physical anchor group, e.g. coffee_table_group; use the SAME id if that group is intentionally revisited>", "label": "<2–4 Russian words, lowercase, naming the actual anchor and, for vantage, angle: \\"столик строго сверху\\", \\"кресло низко сбоку\\">", "brief": "<English, 2–3 compact sentences for the image generator: exact visible identity of the dominant anchor; supporting elements and spatial layers; intended crop and what makes the composition strong. For vantage, describe which surfaces or relationships the specified camera reveals without moving anything>", "region": [x, y, w, h], "side": "left|right (vantage only)", "camera": "overhead|high_three_quarter|side_oblique|low_three_quarter (vantage only)"}, …] where region is the subject-group rectangle as fractions of image width and height from 0 to 1 (x, y — top-left; w, h — size). HARD LIMITS: no side larger than 0.45; texture 0.14–0.3, detail 0.2–0.4, fragment 0.22–0.36, vantage 0.2–0.45. Put the region where the subject really is. Before answering, silently audit the final array: exact required order and count; use all strong groups before a sparse-scene revisit; no subject more than twice and no repeated detail subject; no repeated vantage camera; one overhead when vantage exists; every focal object readable; no generic filler.',
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
    const { kind, subject, label, brief, region, side, camera } = item as Record<string, unknown>
    const cleanKind = typeof kind === "string" ? kind.trim().toLowerCase() : ""
    if (!isShotKind(cleanKind)) continue
    const cleanBrief = typeof brief === "string" ? brief.replace(/\s+/g, " ").trim().slice(0, 600) : ""
    if (!cleanBrief) continue
    const cleanSubject =
      typeof subject === "string"
        ? subject
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "")
            .slice(0, 64)
        : ""
    const cleanLabel = typeof label === "string" ? label.replace(/\s+/g, " ").trim().slice(0, 48) : ""
    const cleanSide = typeof side === "string" ? side.trim().toLowerCase() : ""
    const cleanCamera = typeof camera === "string" ? camera.trim().toLowerCase() : ""
    const draft: ShotDraft = {
      kind: cleanKind,
      subject: cleanSubject || undefined,
      label: cleanLabel || undefined,
      brief: cleanBrief,
      region: parseRegion(region),
    }
    if (cleanKind === "vantage" && (cleanSide === "left" || cleanSide === "right")) draft.side = cleanSide
    if (cleanKind === "vantage" && isViewCamera(cleanCamera)) draft.camera = cleanCamera
    drafts.push(draft)
  }
  return drafts
}

/**
 * Жёсткий QA плана до платной генерации: `assignShots` умеет технически
 * добрать пропуски шаблоном, но для публикационного сета это превращалось в
 * случайные кропы. Некорректный план лучше один раз попросить исправить.
 */
export function shotPlanIssues(drafts: ShotDraft[], preset: ViewPreset): string[] {
  const slots = PRESET_SLOTS[preset]
  const issues: string[] = []
  for (const slot of new Set(slots)) {
    const required = slots.filter((item) => item === slot).length
    const proposed = drafts.filter((draft) => slotOf(draft.kind) === slot).length
    if (proposed < required) issues.push(`${slot}: need ${required}, got ${proposed}`)
  }
  if (drafts.slice(0, slots.length).some((draft) => !draft.region)) issues.push("every shot needs a visible source region")
  const subjects = drafts.slice(0, slots.length).map((draft) => draft.subject).filter(Boolean) as string[]
  if (subjects.length < slots.length) issues.push("every shot needs a subject id")
  const subjectCounts = new Map<string, number>()
  for (const subject of subjects) subjectCounts.set(subject, (subjectCounts.get(subject) ?? 0) + 1)
  if ([...subjectCounts.values()].some((count) => count > 2)) issues.push("a subject group appears more than twice")
  const detailSubjects = drafts
    .filter((draft) => draft.kind === "detail")
    .slice(0, slots.filter((slot) => slot === "detail").length)
    .map((draft) => draft.subject)
    .filter(Boolean) as string[]
  if (new Set(detailSubjects).size < detailSubjects.length) issues.push("detail subject groups repeat")
  if (preset === "set" && new Set(subjects).size < 4) issues.push("set needs at least four distinct subject groups")
  const vantage = drafts.filter((draft) => draft.kind === "vantage").slice(0, slots.filter((slot) => slot === "vantage").length)
  const cameras = vantage.map((draft) => draft.camera).filter(Boolean)
  if (vantage.length > 0 && cameras.length < vantage.length) issues.push("every vantage needs a camera mode")
  if (new Set(cameras).size < cameras.length) issues.push("vantage camera modes repeat")
  if (vantage.length > 0 && !cameras.includes("overhead")) issues.push("vantage sequence needs an overhead shot")
  return issues
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
  options: { preset: ViewPreset; aspect: FrameAspect; note: string; inventory?: string },
  signal?: AbortSignal
): Promise<ShotListResult> {
  if (providers.length === 0) throw new Error("Нет vision-провайдера для планировщика кадров")
  const startedAt = Date.now()
  const image = await prepareSceneImage(source.bytes)
  const prompt = buildShotListPrompt(options.preset, options.aspect, options.note, options.inventory)

  let lastError: unknown = null
  for (const [index, provider] of providers.entries()) {
    const remaining = PLAN_DEADLINE_MS - (Date.now() - startedAt)
    if (index > 0 && remaining < MIN_ATTEMPT_MS) break
    try {
      let answer = await provider.describe({
        prompt,
        image,
        maxTokens: provider.outputBudget,
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(remaining)]) : AbortSignal.timeout(remaining),
      })
      let drafts = parseShotList(answer.text)
      if (drafts.length === 0) throw new Error(`ответ без списка кадров: ${answer.text.slice(0, 120).replace(/\s+/g, " ")}`)
      let issues = shotPlanIssues(drafts, options.preset)
      if (issues.length > 0) {
        const repairRemaining = PLAN_DEADLINE_MS - (Date.now() - startedAt)
        if (repairRemaining < MIN_ATTEMPT_MS) throw new Error(`план не прошёл QA: ${issues.join("; ")}`)
        console.warn(`[shot-planner] ${provider.id} ${provider.model}: исправляем план (${issues.join("; ")})`)
        answer = await provider.describe({
          prompt: `${prompt}\n\nQUALITY CONTROL REPAIR: the previous plan failed these checks: ${issues.join(
            "; "
          )}. Start the selection again and return a corrected JSON array only.`,
          image,
          maxTokens: provider.outputBudget,
          signal: signal
            ? AbortSignal.any([signal, AbortSignal.timeout(repairRemaining)])
            : AbortSignal.timeout(repairRemaining),
        })
        drafts = parseShotList(answer.text)
        issues = shotPlanIssues(drafts, options.preset)
        if (drafts.length === 0 || issues.length > 0) {
          throw new Error(`исправленный план не прошёл QA: ${issues.join("; ") || "пустой ответ"}`)
        }
      }
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
