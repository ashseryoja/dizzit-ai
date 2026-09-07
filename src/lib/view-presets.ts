/**
 * Наборы кадров «Ракурсов и деталей» — общая для клиента и сервера часть
 * (без canvas и «use client»): состав набора слотами, типовые кадры по
 * шаблону и сборка списка кадров из ответа планировщика.
 *
 * Все кадры — «виньетки» крупно, как в каруселях дизайнеров: ракурс — зона
 * с неожиданной точки (сверху под углом, с высоты кровати, в угол сбоку),
 * а не вся комната; фактура — материал на предмете, у края или шва, а не
 * голая стена. Правила — `server/shot-planner` (планировщик) и `CRAFT` /
 * `VIGNETTE_RULE` в `lib/view-engine` (генерация).
 *
 * Слот — это «какого рода кадр нужен» (ракурс, деталь, фактура, фрагмент);
 * какой именно ракурс (сверху, снизу, слева, справа) и что именно снять,
 * решает планировщик по конкретному рендеру (`server/shot-planner`). Без
 * планировщика слоты заполняются типовыми кадрами.
 */
import type { ShotKind, ViewFrame, ViewPreset } from "@/types"

export type ShotSlot = "angle" | "detail" | "texture" | "fragment"

export const PRESET_SLOTS: Record<ViewPreset, ShotSlot[]> = {
  // Готовая карусель: два ракурса, две детали, фактура и фрагмент.
  set: ["angle", "angle", "detail", "detail", "texture", "fragment"],
  details: ["detail", "detail", "detail", "detail"],
  angles: ["angle", "angle", "angle", "angle"],
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

export const SLOT_LABEL: Record<ShotSlot, string> = {
  angle: "ракурс",
  detail: "деталь",
  texture: "фактура",
  fragment: "фрагмент",
}

export const ANGLE_KINDS: readonly ShotKind[] = ["top", "low", "left", "right"]
export const SHOT_KINDS: readonly ShotKind[] = [...ANGLE_KINDS, "detail", "texture", "fragment"]

export function isShotKind(value: unknown): value is ShotKind {
  return typeof value === "string" && (SHOT_KINDS as readonly string[]).includes(value)
}

/** Ракурс — вся сцена с другой точки; остальное — крупные планы. */
export function isWideShot(kind: ShotKind): boolean {
  return (ANGLE_KINDS as readonly string[]).includes(kind)
}

export function slotOf(kind: ShotKind): ShotSlot {
  return isWideShot(kind) ? "angle" : (kind as ShotSlot)
}

/** Заготовка кадра от планировщика или шаблона — ключ и номер появятся при сборке. */
export interface ShotDraft {
  kind: ShotKind
  label?: string
  brief?: string
}

/**
 * Список кадров из заготовок: ключи уникальны в сете (`detail-2`), у кадров
 * без своей подписи повторы одного типа нумеруются («деталь 1», «деталь 2»).
 */
export function buildFrames(drafts: ShotDraft[]): ViewFrame[] {
  const total: Partial<Record<ShotKind, number>> = {}
  for (const draft of drafts) total[draft.kind] = (total[draft.kind] ?? 0) + 1
  const seen: Partial<Record<ShotKind, number>> = {}
  return drafts.map((draft) => {
    const n = (seen[draft.kind] ?? 0) + 1
    seen[draft.kind] = n
    const fallback = (total[draft.kind] ?? 1) > 1 ? `${SHOT_LABEL[draft.kind]} ${n}` : SHOT_LABEL[draft.kind]
    const frame: ViewFrame = { key: `${draft.kind}-${n}`, kind: draft.kind, label: draft.label?.trim() || fallback }
    if (draft.brief?.trim()) frame.brief = draft.brief.trim()
    return frame
  })
}

/** Типовые кадры набора без планировщика: ракурсы — по кругу сверху, снизу, слева, справа. */
export function templateDrafts(preset: ViewPreset): ShotDraft[] {
  let angle = 0
  return PRESET_SLOTS[preset].map((slot) => ({
    kind: slot === "angle" ? ANGLE_KINDS[angle++ % ANGLE_KINDS.length] : slot,
  }))
}

export function framesOf(preset: ViewPreset): ViewFrame[] {
  return buildFrames(templateDrafts(preset))
}

/**
 * Раскладывает кадры планировщика по слотам набора в порядке шаблона: для
 * каждого слота — первый неиспользованный кадр подходящего рода; если модель
 * дала кадров другого рода — берётся любой и тип подгоняется под слот; если
 * кадров не хватило — слот заполняется типовым. Результат всегда ровно по
 * составу набора, что бы ни ответила модель.
 */
export function assignShots(shots: ShotDraft[], preset: ViewPreset): ViewFrame[] {
  const unused = shots.filter((shot) => isShotKind(shot.kind))
  const usedAngles = new Set<ShotKind>()
  const take = (predicate: (shot: ShotDraft) => boolean): ShotDraft | null => {
    const index = unused.findIndex(predicate)
    if (index < 0) return null
    const [shot] = unused.splice(index, 1)
    return shot
  }
  const nextAngle = (): ShotKind => {
    const free = ANGLE_KINDS.find((kind) => !usedAngles.has(kind)) ?? ANGLE_KINDS[usedAngles.size % ANGLE_KINDS.length]
    return free
  }
  const drafts: ShotDraft[] = PRESET_SLOTS[preset].map((slot) => {
    const exact = take((shot) => slotOf(shot.kind) === slot)
    if (exact) {
      if (slot === "angle") usedAngles.add(exact.kind)
      return exact
    }
    const any = take(() => true)
    const kind = slot === "angle" ? nextAngle() : slot
    if (slot === "angle") usedAngles.add(kind)
    return any ? { ...any, kind } : { kind }
  })
  return buildFrames(drafts)
}

/** Состав набора одной строкой: «2 ракурса, 2 детали, фактура, фрагмент». */
export function describeSlots(preset: ViewPreset): string {
  const counts = new Map<ShotSlot, number>()
  for (const slot of PRESET_SLOTS[preset]) counts.set(slot, (counts.get(slot) ?? 0) + 1)
  return [...counts]
    .map(([slot, n]) => (n > 1 ? `${SLOT_LABEL[slot]} ×${n}` : SLOT_LABEL[slot]))
    .join(", ")
}
