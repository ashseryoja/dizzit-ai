/**
 * Области точечной правки рендера: геометрия, пороги и сборка текста задания.
 *
 * Перенос из редактора обложек UpSound (`cover-region-annotations.ts`). У рисунка
 * ДВА канала, и они разделены строго: текст говорит только ЧТО делать («1. убрать
 * провод»), а ГДЕ — показывает карта областей (геометрия уходит в обработку полем
 * `regions`). Словесный адрес в текст не возвращать: каналы спорят, и модель
 * слушает координаты вместо обведённого.
 *
 * Координаты — доли ОТРИСОВАННОГО кадра (0…1), не контейнера и не вьюпорта: при
 * другом размере окна области ложатся на те же места рендера.
 */

export type RegionShape = "brush" | "lasso" | "rect"

export interface RegionPoint {
  x: number
  y: number
}

export interface EditRegion {
  id: string
  shape: RegionShape
  /**
   * Мазки области. У рамки и обводки он ровно один (у рамки — две противоположные
   * вершины), у кисти их может быть несколько: одну область человек набирает в
   * несколько заходов с зажатым Shift.
   */
  strokes: RegionPoint[][]
  /** Что изменить в этом месте. Пустая строка — область ещё не подписана. */
  comment: string
  /** Полутолщина штриха в долях кадра — фактическая, снятая в момент рисования. */
  brushHalfWidth?: number
}

export interface RegionBounds {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** Область в том виде, в каком она уходит в обработку: без клиентского id. */
export interface RegionPayload {
  shape: RegionShape
  strokes: RegionPoint[][]
  brush_half_width?: number
  comment: string
}

export const REGION_COMMENT_MAX_LENGTH = 500
export const EDIT_COMMENT_MAX_LENGTH = 5000
/** Больше десяти областей за один запуск модель уже не разводит. */
export const REGION_MAX_COUNT = 10
/** Точек на область: длинный штрих прореживается, иначе перерисовка пухнет. */
export const REGION_MAX_POINTS = 120
/** Мазков в одной области: десяток заходов — уже способ обойти предел точек. */
export const REGION_MAX_STROKES = 12

/** Меньше этой доли кадра — промах пальцем, а не область. */
const MIN_REGION_SIZE = 0.02
const MIN_REGION_AREA = MIN_REGION_SIZE * MIN_REGION_SIZE

/** Половина толщины кисти в долях кадра: на экране полоса ~5% меньшей стороны. */
export const BRUSH_HALF_WIDTH = 0.025
/** Коридор толщины, которым человек управляет сам: полоса 2%…12% меньшей стороны. */
export const BRUSH_HALF_WIDTH_MIN = 0.01
export const BRUSH_HALF_WIDTH_MAX = 0.06
export const BRUSH_HALF_WIDTH_STEP = 0.0025
/** Минимальная видимая полоса кисти в пикселях: на тесном экране доля слишком тонка. */
const BRUSH_MIN_STROKE_PX = 10

export function clampBrushHalfWidth(value: number): number {
  if (!Number.isFinite(value)) return BRUSH_HALF_WIDTH
  return Math.min(BRUSH_HALF_WIDTH_MAX, Math.max(BRUSH_HALF_WIDTH_MIN, value))
}

/**
 * Толщина полосы кисти на холсте и ЕЁ ЖЕ доля кадра — одной функцией, чтобы
 * экран и карта у модели не разъезжались на тесном кадре.
 */
export function resolveBrushStroke(
  frameSide: number,
  halfWidth: number = BRUSH_HALF_WIDTH
): { strokePx: number; halfWidth: number } {
  const wanted = clampBrushHalfWidth(halfWidth)
  const strokePx = Math.max(BRUSH_MIN_STROKE_PX, frameSide * wanted * 2)
  return { strokePx, halfWidth: frameSide > 0 ? strokePx / 2 / frameSide : wanted }
}

export function getRegionPoints(region: EditRegion): RegionPoint[] {
  return region.strokes.flat()
}

export function getRegionBounds(region: EditRegion): RegionBounds {
  const points = getRegionPoints(region)
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) }
}

export function countRegionPoints(region: EditRegion): number {
  return region.strokes.reduce((sum, stroke) => sum + stroke.length, 0)
}

function payloadBrushHalfWidth(region: EditRegion): number {
  return Math.round((region.brushHalfWidth ?? BRUSH_HALF_WIDTH) * 10_000) / 10_000
}

/** Площадь обводки или штриха в долях кадра. */
function regionArea(region: EditRegion): number {
  const points = region.strokes[0]
  if (region.shape === "lasso") {
    // Формула шнурков: у почти коллинеарных точек площадь стремится к нулю.
    let doubled = 0
    for (let index = 0; index < points.length; index += 1) {
      const current = points[index]
      const next = points[(index + 1) % points.length]
      doubled += current.x * next.y - next.x * current.y
    }
    return Math.abs(doubled) / 2
  }
  // Штрих кистью «толстый»: площадь — капсула, длина осевой на толщину плюс торцы.
  let length = 0
  for (const stroke of region.strokes) {
    for (let index = 1; index < stroke.length; index += 1) {
      length += Math.hypot(stroke[index].x - stroke[index - 1].x, stroke[index].y - stroke[index - 1].y)
    }
  }
  const half = payloadBrushHalfWidth(region)
  return length * half * 2 + Math.PI * half ** 2 * region.strokes.length
}

/** Случайный тап, флик из двух точек и схлопнутая рамка областью не становятся. */
export function isRegionMeaningful(region: EditRegion): boolean {
  if (getRegionPoints(region).length < 2) return false
  if (region.shape === "lasso" && region.strokes[0].length < 3) return false
  const bounds = getRegionBounds(region)
  const width = bounds.x1 - bounds.x0
  const height = bounds.y1 - bounds.y0
  if (region.shape === "rect") return width > MIN_REGION_SIZE * 2 && height > MIN_REGION_SIZE * 2
  if (width <= MIN_REGION_SIZE && height <= MIN_REGION_SIZE) return false
  return regionArea(region) >= MIN_REGION_AREA
}

/**
 * Прореживание точек штриха: подряд идущие точки ближе `minStep` не добавляют
 * ничего ни картинке, ни карте, но раздувают состояние и перерисовку.
 */
export function decimateRegionPoints(
  points: RegionPoint[],
  minStep = 0.006,
  limit = REGION_MAX_POINTS
): RegionPoint[] {
  if (points.length <= 2) return points
  const result: RegionPoint[] = [points[0]]
  for (const point of points.slice(1)) {
    const last = result[result.length - 1]
    if (Math.abs(point.x - last.x) + Math.abs(point.y - last.y) >= minStep) result.push(point)
  }
  const tail = points[points.length - 1]
  const last = result[result.length - 1]
  if (last.x !== tail.x || last.y !== tail.y) result.push(tail)
  if (result.length < 2) {
    // Замкнутый мазок схлопнулся бы в одну точку — оставляем самую дальнюю,
    // чтобы у него сохранился размах.
    let farthest = points[points.length - 1]
    let best = -1
    for (const point of points) {
      const distance = Math.abs(point.x - points[0].x) + Math.abs(point.y - points[0].y)
      if (distance > best) {
        best = distance
        farthest = point
      }
    }
    return [points[0], farthest]
  }
  return result.length > limit ? decimateRegionPoints(result, minStep * 2, limit) : result
}

/** Подпись области в канонном виде: одна и та же строка в тексте и в разметке. */
function normalizeRegionComment(comment: string): string {
  return comment.trim().replace(/\s+/g, " ")
}

/** Разметка для обработки: та же геометрия, координаты до четвёртого знака. */
export function buildRegionsPayload(regions: EditRegion[]): RegionPayload[] {
  const round = (value: number) => Math.min(1, Math.max(0, Math.round(value * 10_000) / 10_000))
  return regions.map((region) => {
    let strokes = region.strokes.map((stroke) => stroke.map((point) => ({ x: round(point.x), y: round(point.y) })))
    if (region.shape === "rect" && strokes[0]?.length === 2) {
      // Рамку канонизируем: жест справа налево дал бы x0 > x1.
      const [a, b] = strokes[0]
      strokes = [[{ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) }, { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) }]]
    }
    return {
      shape: region.shape,
      strokes,
      ...(region.shape === "brush" ? { brush_half_width: payloadBrushHalfWidth(region) } : {}),
      comment: normalizeRegionComment(region.comment),
    }
  })
}

export interface BuiltEditComment {
  /** Итоговый текст задания; пустая строка — общей правки и областей нет. */
  comment: string
  tooLong: boolean
  /**
   * Области без подписи, которым НЕЧЕГО делать: нет ни своей подписи, ни общего
   * текста. Их нельзя молча проглатывать — кнопка закрыта, пока не подпишут.
   */
  unlabeledRegionNumbers: number[]
  /** Области, чья подпись длиннее предела. */
  overlongRegionNumbers: number[]
}

/**
 * Собрать задание из свободного текста и отмеченных областей. Порядок частей
 * фиксирован: сначала общий текст, потом области по порядку рисования.
 *
 * Область без подписи рядом с общим текстом — не ошибка, а самый частый жест:
 * обвёл предмет и написал в композере «убери это». Тогда общий текст адресуется
 * этим областям, и задание уходит как обычная точечная правка.
 */
export function buildEditComment({
  userComment,
  regions,
  maxLength = EDIT_COMMENT_MAX_LENGTH,
  subjectNoun = "рендера",
}: {
  userComment: string
  regions: EditRegion[]
  maxLength?: number
  /** Что правим, в родительном падеже: «рендера». */
  subjectNoun?: string
}): BuiltEditComment {
  const trimmedUserComment = userComment.trim()
  const numbered = regions.map((region, index) => ({ region, number: index + 1 }))
  const labeled = numbered.filter(({ region }) => region.comment.trim().length > 0)
  const overlongRegionNumbers = numbered
    .filter(({ region }) => normalizeRegionComment(region.comment).length > REGION_COMMENT_MAX_LENGTH)
    .map(({ number }) => number)
  const unlabeled = numbered.filter(({ region }) => region.comment.trim().length === 0)
  // Общий текст есть — он и есть задание для областей без подписи.
  const addressed = trimmedUserComment ? unlabeled : []
  const unlabeledRegionNumbers = trimmedUserComment ? [] : unlabeled.map(({ number }) => number)

  const parts: string[] = []
  if (trimmedUserComment) parts.push(trimmedUserComment)

  if (addressed.length > 0) {
    const numbers = addressed.map(({ number }) => number).join(", ")
    parts.push(
      addressed.length > 1
        ? `Правка выше относится к отмеченным на карте областям ${numbers}: выполнить её именно в этих местах.`
        : `Правка выше относится к отмеченной на карте области ${numbers}: выполнить её именно в этом месте.`
    )
  }

  if (labeled.length > 0) {
    // Только НОМЕР и задание — без словесного адреса: где именно править,
    // показывает карта областей. Нумерация — по позиции на кадре, как у бейджа.
    const lines = labeled.map(({ region, number }) => `${number}. ${normalizeRegionComment(region.comment)}`)
    parts.push(
      [
        labeled.length > 1
          ? "Правки по отмеченным на карте областям (номера совпадают с картой):"
          : "Правка по отмеченной на карте области (номер совпадает с картой):",
        ...lines,
      ].join("\n")
    )
  }

  if (labeled.length > 0 || addressed.length > 0) {
    // «Остальное не менять» рядом с общей правкой на весь кадр — самопротиворечивое
    // задание; если же общий текст адресован областям, вне них менять нечего.
    parts.push(
      trimmedUserComment && addressed.length === 0
        ? "Вне отмеченных мест — только то, что просит общая правка выше."
        : `Остальную часть ${subjectNoun} оставить без изменений.`
    )
  }

  const comment = parts.join("\n\n")
  return { comment, tooLong: comment.length > maxLength, unlabeledRegionNumbers, overlongRegionNumbers }
}

/**
 * Короткая причина, по которой кнопка обработки закрыта — подсказкой на самой
 * кнопке. Порядок веток — от «чинится подписью» к «чинится вводом».
 */
export function editBlockReason(built: BuiltEditComment): string | null {
  if (built.unlabeledRegionNumbers.length > 0) {
    const numbers = built.unlabeledRegionNumbers.join(", ")
    return built.unlabeledRegionNumbers.length > 1
      ? `Подпишите области ${numbers} или напишите, что с ними сделать`
      : `Подпишите область ${numbers} или напишите, что с ней сделать`
  }
  if (built.overlongRegionNumbers.length > 0) {
    const numbers = built.overlongRegionNumbers.join(", ")
    return built.overlongRegionNumbers.length > 1
      ? `Подписи областей ${numbers} слишком длинные`
      : `Подпись области ${numbers} слишком длинная`
  }
  if (built.tooLong) return "Слишком длинный текст"
  return null
}
