"use client"

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react"
import { ChevronsLeftRight } from "lucide-react"

import { cn } from "@/lib/utils"

const INTRO_MS = 1500

/**
 * Шторка «до / после» поверх картинки-результата. Родитель уже показывает
 * «после»; слой кладёт сверху «до» (исходник), обрезанный справа по положению
 * ручки: слева от линии — исходник, справа — результат. Тянется мышью и
 * пальцем по всей площади, с клавиатуры — стрелками на ручке (role="slider").
 *
 * `intro` — разовое проявление результата: шторка сама проезжает слева
 * направо и зовёт `onIntroEnd` (сцена после этого убирает слой). Так готовый
 * рендер не «подменяется», а открывается поверх исходника.
 *
 * Стили — `.cmp-*` в surfaces.css. Слой занимает родителя целиком (inset: 0),
 * пропорции исходника и результата совпадают, поэтому `object-fit: fill`.
 */
export function CompareSlider({
  before,
  alt = "",
  beforeLabel = "до",
  afterLabel = "после",
  fit = "fill",
  intro = false,
  onIntroEnd,
  className,
}: {
  /** Адрес исходника («до»). */
  before: string
  alt?: string
  beforeLabel?: string
  afterLabel?: string
  /** Как ложится исходник: `fill` — сцена с боксом по кадру, `cover` — карточка, `contain` — просмотр. */
  fit?: "fill" | "cover" | "contain"
  intro?: boolean
  onIntroEnd?: () => void
  className?: string
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  // Доля ширины, занятая исходником: 0 — виден только результат, 1 — только исходник.
  const [position, setPosition] = useState(intro ? 1 : 0.5)
  const [playing, setPlaying] = useState(intro)

  // Проявление: исходник целиком → шторка уезжает влево до нуля.
  useEffect(() => {
    if (!intro) return
    const reduce =
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      document.documentElement.dataset.motion === "reduce"
    if (reduce) {
      setPlaying(false)
      onIntroEnd?.()
      return
    }
    const start = window.setTimeout(() => setPosition(0), 60)
    // Таймер, а не transitionend: в скрытой вкладке переход может не доиграть.
    const end = window.setTimeout(() => {
      setPlaying(false)
      onIntroEnd?.()
    }, INTRO_MS + 160)
    return () => {
      window.clearTimeout(start)
      window.clearTimeout(end)
    }
    // Проявление играет один раз на монтирование слоя.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const moveTo = useCallback((clientX: number) => {
    const node = rootRef.current
    if (!node) return
    const rect = node.getBoundingClientRect()
    if (rect.width === 0) return
    setPosition(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)))
  }, [])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (playing) return
    dragging.current = true
    event.currentTarget.setPointerCapture(event.pointerId)
    moveTo(event.clientX)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) moveTo(event.clientX)
  }
  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    dragging.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 0.1 : 0.02
    if (event.key === "ArrowLeft") setPosition((value) => Math.max(0, value - step))
    else if (event.key === "ArrowRight") setPosition((value) => Math.min(1, value + step))
    else if (event.key === "Home") setPosition(0)
    else if (event.key === "End") setPosition(1)
    else return
    event.preventDefault()
    event.stopPropagation()
  }

  const percent = `${(position * 100).toFixed(2)}%`

  return (
    <div
      ref={rootRef}
      className={cn("cmp", playing && "is-intro", className)}
      style={{ ["--cmp" as string]: percent }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClick={(event) => event.stopPropagation()}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={before} alt={alt} draggable={false} className="cmp-before" style={{ objectFit: fit }} />
      {playing ? null : (
        <>
          <span className="cmp-label cmp-label-before">{beforeLabel}</span>
          <span className="cmp-label cmp-label-after">{afterLabel}</span>
        </>
      )}
      <span className="cmp-line" aria-hidden />
      {playing ? null : (
        <button
          type="button"
          role="slider"
          aria-label="Граница «до / после»"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(position * 100)}
          onKeyDown={onKeyDown}
          className="cmp-handle"
        >
          <ChevronsLeftRight className="h-4 w-4" strokeWidth={1.8} />
        </button>
      )}
    </div>
  )
}
