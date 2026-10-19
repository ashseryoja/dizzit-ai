"use client"

import { useEffect, useRef, type RefObject } from "react"

export interface SwipeHandlers {
  /** Палец ушёл влево — обычно «следующий». */
  onLeft?: () => void
  /** Палец ушёл вправо — «предыдущий» или «закрыть шторку слева». */
  onRight?: () => void
  onUp?: () => void
  /** Палец ушёл вниз — «закрыть» у нижних шторок и просмотра. */
  onDown?: () => void
  /**
   * С чего жест не начинается: кнопки, поля, ползунки, холст областей —
   * у них своё касание. Селектор проверяется по `closest` от цели касания.
   */
  ignore?: string
  /** Минимальный путь пальца по главной оси, px. */
  threshold?: number
  enabled?: boolean
}

const DEFAULT_IGNORE = "button, a, input, textarea, select, canvas, [data-no-swipe]"
/** Главная ось должна заметно перевешивать: диагональ — не свайп. */
const AXIS_RATIO = 1.4
const MAX_MS = 900

/** Есть ли между целью и корнем прокручиваемый по оси контейнер — тогда палец листает его, а не нас. */
function scrollsAlong(target: Element | null, root: HTMLElement, axis: "x" | "y"): boolean {
  let node: Element | null = target
  while (node && node !== root) {
    const style = getComputedStyle(node)
    const overflow = axis === "x" ? style.overflowX : style.overflowY
    if (overflow === "auto" || overflow === "scroll") {
      const scrollable = axis === "x" ? node.scrollWidth > node.clientWidth + 1 : node.scrollHeight > node.clientHeight + 1
      if (scrollable) return true
    }
    node = node.parentElement
  }
  return false
}

/**
 * Свайпы пальцем по элементу — один хук на сцену, просмотр во весь экран,
 * шторки меню и тосты. Только касания (`touch*`): мышь листает стрелками и
 * колесом, и перетаскивание мышью не должно превращаться в жест.
 *
 * Жест — один палец, путь не короче `threshold` по главной оси, которая
 * перевешивает вторую в `AXIS_RATIO` раз, и не дольше `MAX_MS`. Второй палец
 * (щипок на модели или картинке) жест отменяет. Касание внутри прокручиваемого
 * по той же оси контейнера (полоска миниатюр, список стилей) — не жест: палец
 * прокручивает его. Обработчики читаются из ref, поэтому подписка не
 * пересоздаётся на каждый рендер.
 */
export function useSwipe(ref: RefObject<HTMLElement | null>, handlers: SwipeHandlers): void {
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const enabled = handlers.enabled ?? true

  useEffect(() => {
    const node = ref.current
    if (!node || !enabled) return

    let start: { x: number; y: number; at: number; target: EventTarget | null } | null = null
    let cancelled = false

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) {
        start = null
        cancelled = true
        return
      }
      const touch = event.touches[0]
      const ignore = handlersRef.current.ignore ?? DEFAULT_IGNORE
      const target = event.target instanceof Element ? event.target : null
      if (target && ignore && target.closest(ignore)) {
        start = null
        return
      }
      cancelled = false
      start = { x: touch.clientX, y: touch.clientY, at: performance.now(), target }
    }
    const onMove = (event: TouchEvent) => {
      if (event.touches.length > 1) cancelled = true
    }
    const onEnd = (event: TouchEvent) => {
      const from = start
      start = null
      if (!from || cancelled) return
      const touch = event.changedTouches[0]
      if (!touch || performance.now() - from.at > MAX_MS) return
      const dx = touch.clientX - from.x
      const dy = touch.clientY - from.y
      const threshold = handlersRef.current.threshold ?? 48
      const target = from.target instanceof Element ? from.target : null
      const current = handlersRef.current
      if (Math.abs(dx) >= threshold && Math.abs(dx) > Math.abs(dy) * AXIS_RATIO) {
        if (scrollsAlong(target, node, "x")) return
        if (dx < 0) current.onLeft?.()
        else current.onRight?.()
      } else if (Math.abs(dy) >= threshold && Math.abs(dy) > Math.abs(dx) * AXIS_RATIO) {
        if (scrollsAlong(target, node, "y")) return
        if (dy < 0) current.onUp?.()
        else current.onDown?.()
      }
    }
    const onCancel = () => {
      start = null
    }

    node.addEventListener("touchstart", onStart, { passive: true })
    node.addEventListener("touchmove", onMove, { passive: true })
    node.addEventListener("touchend", onEnd, { passive: true })
    node.addEventListener("touchcancel", onCancel, { passive: true })
    return () => {
      node.removeEventListener("touchstart", onStart)
      node.removeEventListener("touchmove", onMove)
      node.removeEventListener("touchend", onEnd)
      node.removeEventListener("touchcancel", onCancel)
    }
  }, [ref, enabled])
}

/** Указатель — палец (телефон, планшет): крупнее цели, жесты вместо наведения. */
export function isCoarsePointer(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches
}
