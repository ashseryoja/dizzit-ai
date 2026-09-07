/**
 * Наборы кадров «Ракурсов и деталей» — общая для клиента и сервера часть
 * (без canvas и «use client»): состав набора слотами, типовые кадры по
 * шаблону и сборка списка кадров из ответа планировщика.
 *
 * Крупные планы — КРОПЫ исходника, как в каруселях дизайнеров с AI close-ups:
 * камера не двигается, геометрия и перспектива исходника остаются, меняется
 * только кадрирование, а модель лишь дорисовывает детали в полном размере.
 * «Зона» — более широкий кроп одной части кадра (верх, низ, левая, правая
 * часть), деталь — предмет крупно, фактура — материал на предмете у края или
 * шва, фрагмент — срез с передним планом. Единственное исключение — кадр
 * «с другой точки» (`vantage`): камера поднята выше и сдвинута вбок, предмет
 * крупно сверху и чуть сбоку; область — где предмет стоит в исходнике, а
 * `side` — в какую сторону ушла камера. Правила — `server/shot-planner`
 * (планировщик) и `buildViewPrompt` в `lib/view-engine` (генерация).
 *
 * Слот — это «какого рода кадр нужен» (ракурс, деталь, фактура, фрагмент);
 * какой именно ракурс (сверху, снизу, слева, справа) и что именно снять,
 * решает планировщик по конкретному рендеру (`server/shot-planner`). Без
 * планировщика слоты заполняются типовыми кадрами.
 */
import type { ShotKind, ViewFrame, ViewPreset } from "@/types"

export type ShotSlot = "angle" | "detail" | "texture" | "fragment" | "vantage"

export const PRESET_SLOTS: Record<ViewPreset, ShotSlot[]> = {
  // Готовая карусель: три предмета крупно, два кадра с другой точки, фактура
  // и фрагмент. Широких «зон» в наборах больше нет: из них выходил почти
  // исходник; второй фактуры тоже — из неё выходила скучная голая стена.
  set: ["detail", "detail", "detail", "vantage", "vantage", "texture", "fragment"],
  details: ["detail", "detail", "detail", "detail"],
  textures: ["texture", "texture", "texture", "texture"],
  fragments: ["fragment", "fragment", "fragment", "fragment"],
  angles: ["vantage", "vantage", "vantage", "vantage"],
}

export const PRESET_LABEL: Record<ViewPreset, string> = {
  set: "Сет",
  details: "Детали",
  textures: "Фактуры",
  fragments: "Фрагменты",
  angles: "Ракурсы",
}

/**
 * Границы области кропа по роду кадра — доли ширины и высоты кадра. Больше
 * потолка — после расширения до формата кроп становится почти исходником;
 * меньше пола — в кропе слишком мало пикселей, модель выдумывает.
 */
export const REGION_BOUNDS: Record<ShotSlot, { min: number; max: number }> = {
  angle: { min: 0.3, max: 0.45 },
  detail: { min: 0.2, max: 0.4 },
  texture: { min: 0.14, max: 0.3 },
  // Фрагмент в маленькой комнате при 45 % — это вся комната; 36 % — угол.
  fragment: { min: 0.22, max: 0.36 },
  // Кадр с другой точки: область — группа предметов, референс движок берёт шире.
  vantage: { min: 0.2, max: 0.45 },
}

/** Потолок доли кадра для ГОТОВОГО кропа после расширения до формата — по роду кадра. */
export function maxCropFraction(kind: ShotKind): number {
  return REGION_BOUNDS[slotOf(kind)].max
}

/** Область в границах своего рода: сжимается или растёт вокруг центра, не выходя за кадр. */
export function boundRegion(region: [number, number, number, number], kind: ShotKind): [number, number, number, number] {
  const { min, max } = REGION_BOUNDS[slotOf(kind)]
  const [x, y, w, h] = region
  const cx = x + w / 2
  const cy = y + h / 2
  const nw = Math.min(max, Math.max(min, w))
  const nh = Math.min(max, Math.max(min, h))
  const nx = Math.min(Math.max(0, cx - nw / 2), 1 - nw)
  const ny = Math.min(Math.max(0, cy - nh / 2), 1 - nh)
  return [nx, ny, nw, nh].map((n) => Math.round(n * 1000) / 1000) as [number, number, number, number]
}

export const SHOT_LABEL: Record<ShotKind, string> = {
  top: "верхняя зона",
  low: "нижняя зона",
  left: "левая зона",
  right: "правая зона",
  detail: "деталь",
  texture: "фактура",
  fragment: "фрагмент",
  vantage: "с другой точки",
}

export const SLOT_LABEL: Record<ShotSlot, string> = {
  angle: "зона",
  detail: "деталь",
  texture: "фактура",
  fragment: "фрагмент",
  vantage: "новый ракурс",
}

export const ANGLE_KINDS: readonly ShotKind[] = ["top", "low", "left", "right"]
export const SHOT_KINDS: readonly ShotKind[] = [...ANGLE_KINDS, "detail", "texture", "fragment", "vantage"]

export function isShotKind(value: unknown): value is ShotKind {
  return typeof value === "string" && (SHOT_KINDS as readonly string[]).includes(value)
}

/** «Зона» — широкий кроп части кадра; остальное — крупные планы. */
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
  region?: [number, number, number, number]
  side?: "left" | "right"
}

/**
 * Список кадров из заготовок: ключи уникальны в сете (`detail-2`), у кадров
 * без своей подписи повторы одного типа нумеруются («деталь 1», «деталь 2»).
 * Кадр с другой точки без стороны от планировщика берёт сторону, противоположную
 * предыдущему такому кадру (первый — слева), чтобы два таких кадра не смотрели
 * с одной стороны.
 */
export function buildFrames(drafts: ShotDraft[]): ViewFrame[] {
  const total: Partial<Record<ShotKind, number>> = {}
  for (const draft of drafts) total[draft.kind] = (total[draft.kind] ?? 0) + 1
  const seen: Partial<Record<ShotKind, number>> = {}
  let lastSide: "left" | "right" | undefined
  return drafts.map((draft) => {
    const n = (seen[draft.kind] ?? 0) + 1
    seen[draft.kind] = n
    const fallback = (total[draft.kind] ?? 1) > 1 ? `${SHOT_LABEL[draft.kind]} ${n}` : SHOT_LABEL[draft.kind]
      const frame: ViewFrame = { key: `${draft.kind}-${n}`, kind: draft.kind, label: draft.label?.trim() || fallback }
    if (draft.brief?.trim()) frame.brief = draft.brief.trim()
    if (draft.region) frame.region = boundRegion(draft.region, draft.kind)
    if (draft.kind === "vantage") {
      frame.side = draft.side ?? (lastSide === "left" ? "right" : "left")
      lastSide = frame.side
    }
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
 * Раскладывает кадры планировщика по слотам набора в порядке шаблона в два
 * прохода: сначала каждый слот получает первый неиспользованный кадр своего
 * рода (чтобы слот «деталь» не забрал кадр «с другой точки» раньше, чем до
 * него дойдёт очередь); затем пустые слоты добираются любыми оставшимися
 * кадрами с типом, подогнанным под слот; если кадров не хватило — слот
 * заполняется типовым. Результат всегда ровно по составу набора, что бы ни
 * ответила модель.
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
  const slots = PRESET_SLOTS[preset]
  const exact = slots.map((slot) => {
    const shot = take((candidate) => slotOf(candidate.kind) === slot)
    if (shot && slot === "angle") usedAngles.add(shot.kind)
    return shot
  })
  const drafts: ShotDraft[] = slots.map((slot, index) => {
    if (exact[index]) return exact[index]
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
