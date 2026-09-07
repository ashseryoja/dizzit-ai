/**
 * Форматы кадров, которые выбирает пользователь перед построением сета
 * («Ракурсы и детали»): сторис, широкий, классические и квадрат. Значение —
 * строка «ширина:высота», она же подпись; `ratio` — для canvas-обрезки и
 * плиток, `size` — пара для `requestImage` (провайдер подберёт ближайшую
 * свою пропорцию, остаток обрежется до точного формата на клиенте).
 */
import type { FrameAspect } from "@/types"

export interface FrameAspectOption {
  value: FrameAspect
  /** Подпись под глифом: «сторис», «широкий»… */
  hint: string
  size: { width: number; height: number }
}

export const FRAME_ASPECTS: readonly FrameAspectOption[] = [
  { value: "9:16", hint: "сторис", size: { width: 9, height: 16 } },
  { value: "3:4", hint: "портрет", size: { width: 3, height: 4 } },
  { value: "1:1", hint: "квадрат", size: { width: 1, height: 1 } },
  { value: "4:3", hint: "альбом", size: { width: 4, height: 3 } },
  { value: "16:9", hint: "широкий", size: { width: 16, height: 9 } },
]

export function frameAspectSize(aspect: FrameAspect): { width: number; height: number } {
  return FRAME_ASPECTS.find((item) => item.value === aspect)?.size ?? { width: 4, height: 5 }
}

/** Отношение ширины к высоте: 9:16 → 0.5625. */
export function frameAspectRatio(aspect: FrameAspect): number {
  const { width, height } = frameAspectSize(aspect)
  return width / height
}

/** Значение для CSS `aspect-ratio`: «9 / 16». */
export function frameAspectCss(aspect: FrameAspect): string {
  const { width, height } = frameAspectSize(aspect)
  return `${width} / ${height}`
}

/** Формат из списка, ближайший к пропорции исходника — подсказка по умолчанию. */
export function closestFrameAspect(width: number, height: number): FrameAspect {
  const wanted = width > 0 && height > 0 ? width / height : 1
  let best: FrameAspectOption = FRAME_ASPECTS[0]
  let bestDistance = Number.POSITIVE_INFINITY
  for (const item of FRAME_ASPECTS) {
    const distance = Math.abs(Math.log(item.size.width / item.size.height) - Math.log(wanted))
    if (distance < bestDistance) {
      bestDistance = distance
      best = item
    }
  }
  return best.value
}

export function isFrameAspect(value: unknown): value is FrameAspect {
  return FRAME_ASPECTS.some((item) => item.value === value)
}
