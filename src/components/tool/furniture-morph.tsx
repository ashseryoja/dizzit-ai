"use client"

import { useEffect, useRef, useState } from "react"

import { SHAPES, SHAPE_LABEL, WIRE, drawWire } from "@/lib/furniture-wire"
import { cn } from "@/lib/utils"
import type { FurnitureShape } from "@/types"

const HOLD_MS = 2600
const MORPH_MS = 1700
const TILT = 0.42

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

function parseRgb(color: string): [number, number, number] {
  const match = color.match(/(\d+(?:\.\d+)?)/g)
  if (!match || match.length < 3) return [255, 255, 255]
  return [Number(match[0]), Number(match[1]), Number(match[2])]
}

/**
 * Каркасная 3D-сцена на canvas. Без `shape` перебирает всю библиотеку,
 * плавно перетекая из предмета в предмет (стул → стол → лампа → …), —
 * это «приглашение» пустого экрана. С `shape` — одна модель, медленное
 * вращение: так показывается результат. Цвет линий берётся из --fg-1,
 * поэтому в обеих темах каркас под цвет интерфейса.
 */
export function FurnitureMorph({
  shape,
  className,
  showLabel = false,
}: {
  shape?: FurnitureShape
  className?: string
  /** Подпись текущего предмета под сценой (для перебора библиотеки). */
  showLabel?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [label, setLabel] = useState<FurnitureShape>(shape ?? SHAPES[0])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    let width = 0
    let height = 0
    let dpr = 1
    let raf = 0
    let visible = true
    let start = performance.now()
    let lastLabel: FurnitureShape | null = null
    const buffer = new Float32Array(WIRE[SHAPES[0]].length)

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      dpr = Math.min(2, window.devicePixelRatio || 1)
      width = Math.max(1, Math.round(rect.width))
      height = Math.max(1, Math.round(rect.height))
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }

    /* Кадр рисуется синхронно: в фоне (скрытая вкладка, пане без фокуса)
       rAF может не прийти вовсе, а сцена после resize не должна оставаться
       пустой. Цикл rAF — только поверх этого. */
    const draw = (now: number) => {
      const elapsed = now - start
      const rgb = parseRgb(getComputedStyle(canvas).color)
      ctx.clearRect(0, 0, width, height)

      let points: Float32Array
      let angle: number
      if (shape) {
        points = WIRE[shape]
        angle = reduceMotion ? 0.7 : 0.7 + elapsed * 0.00028
      } else {
        const period = HOLD_MS + MORPH_MS
        const cycle = Math.floor(elapsed / period)
        const inCycle = elapsed - cycle * period
        const from = SHAPES[cycle % SHAPES.length]
        const to = SHAPES[(cycle + 1) % SHAPES.length]
        const p = inCycle < HOLD_MS ? 0 : easeInOut((inCycle - HOLD_MS) / MORPH_MS)
        const a = WIRE[from]
        const b = WIRE[to]
        for (let i = 0; i < buffer.length; i += 1) buffer[i] = a[i] + (b[i] - a[i]) * p
        points = buffer
        // Подпись переключается на середине перетекания.
        const current = p < 0.5 ? from : to
        if (current !== lastLabel) {
          lastLabel = current
          setLabel(current)
        }
        // Во время морфа вращение чуть ускоряется — форма «доворачивается».
        angle = reduceMotion ? 0.7 : 0.7 + elapsed * 0.00034 + Math.sin(p * Math.PI) * 0.35
      }

      drawWire(ctx, points, { width, height, angle, tilt: TILT, rgb })
    }

    const frame = (now: number) => {
      draw(now)
      if (!reduceMotion && visible) raf = requestAnimationFrame(frame)
    }

    const play = () => {
      cancelAnimationFrame(raf)
      frame(performance.now())
    }

    const observer = new ResizeObserver(() => {
      resize()
      draw(performance.now())
    })
    observer.observe(canvas)
    resize()

    // Не крутим сцену за кадром: вне вьюпорта и в скрытой вкладке.
    const intersection = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting && !document.hidden
      play()
    })
    intersection.observe(canvas)
    const onVisibility = () => {
      visible = !document.hidden
      play()
    }
    document.addEventListener("visibilitychange", onVisibility)
    play()

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      intersection.disconnect()
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [shape])

  return (
    <div className={cn("relative", className)}>
      <canvas ref={canvasRef} className="block h-full w-full" style={{ color: "var(--fg-1)" }} aria-hidden />
      {showLabel ? (
        <span
          key={label}
          className="rise-in pointer-events-none absolute inset-x-0 bottom-3 text-center text-[12px] uppercase tracking-[0.18em]"
          style={{ color: "var(--fg-5)" }}
        >
          {SHAPE_LABEL[label]}
        </span>
      ) : null}
    </div>
  )
}
