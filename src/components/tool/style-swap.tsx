"use client"

import { useEffect, useState } from "react"

import { cn } from "@/lib/utils"

/** Одна и та же комната: исходный рендер и два настоящих переноса стиля. */
const CYCLE = [
  { key: "source", label: "Исходник", src: "/images/invite/restyle-source.jpg" },
  { key: "loft", label: "Лофт", src: "/images/invite/restyle-loft.jpg" },
  { key: "midcentury", label: "Мид-сенчури", src: "/images/invite/restyle-midcentury.jpg" },
]
/** Пауза на стиле и длительность прохода валика — те же, что в .ss-* (surfaces.css). */
const HOLD_MS = 2600
const WIPE_MS = 1100

/**
 * Приглашение пустого экрана «Перенос стиля»: одна и та же комната, в которой
 * по кругу меняется интерьер — исходник → лофт → мид-сенчури. Это настоящие
 * результаты сервиса (`public/images/invite/restyle-*.jpg`), а не схема.
 * Смена идёт проходом малярного валика: светящаяся кромка едет слева направо,
 * и под ней старая отделка, мебель и свет превращаются в новые (clip-path
 * входящего слоя, см. .ss-* в surfaces.css). Планировка при этом на месте —
 * обещание инструмента в одном движении. Подпись стиля и полоска стилей под
 * кадром переключаются вместе с валиком.
 */
export function StyleSwap({ className }: { className?: string }) {
  const [current, setCurrent] = useState(0)
  const [incoming, setIncoming] = useState<number | null>(null)
  const [still, setStill] = useState(false)

  // Меньше движения — системная настройка или переключатель в настройках.
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    const sync = () => setStill(media.matches || document.documentElement.dataset.motion === "reduce")
    sync()
    media.addEventListener("change", sync)
    return () => media.removeEventListener("change", sync)
  }, [])

  // Пауза → валик → следующий стиль. В скрытой вкладке не тикаем: CSS-анимации
  // там заморожены, и переходы накопились бы.
  useEffect(() => {
    if (still) return
    let timer = 0
    const tick = () => {
      if (document.hidden) return
      if (incoming === null) {
        timer = window.setTimeout(() => setIncoming((current + 1) % CYCLE.length), HOLD_MS)
      } else {
        timer = window.setTimeout(() => {
          setCurrent(incoming)
          setIncoming(null)
        }, WIPE_MS + 80)
      }
    }
    tick()
    const onVisibility = () => {
      window.clearTimeout(timer)
      if (!document.hidden) tick()
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [current, incoming, still])

  const active = incoming ?? current
  const label = CYCLE[active].label

  return (
    <div className={cn("ss", className)} aria-hidden>
      <div className="ss-frame">
        {/* Все кадры лежат в DOM сразу: к приходу валика следующий уже загружен. */}
        {CYCLE.map((item, index) =>
          index === current || index === incoming ? null : (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={`preload-${item.key}`} src={item.src} alt="" className="ss-layer is-preload" />
          )
        )}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={CYCLE[current].src} alt="" draggable={false} className="ss-layer" />
        {incoming !== null ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img key={`in-${incoming}`} src={CYCLE[incoming].src} alt="" draggable={false} className="ss-layer is-incoming" />
            <span key={`edge-${incoming}`} className="ss-edge" />
          </>
        ) : null}
        <span key={label} className="ss-label rise-in">
          {label}
        </span>
      </div>
      <div className="ss-strip">
        {CYCLE.map((item, index) => (
          <span key={item.key} className={cn("ss-chip", index === active && "is-active")}>
            {item.label}
          </span>
        ))}
      </div>
    </div>
  )
}
