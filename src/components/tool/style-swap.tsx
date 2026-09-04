"use client"

import { useEffect, useState } from "react"

import { StyleScene, type SceneStyle } from "@/components/tool/style-scenes"
import { STYLE_LABEL } from "@/lib/restyle-engine"
import { cn } from "@/lib/utils"

const CYCLE: SceneStyle[] = ["scandi", "neoclassic", "japandi", "loft"]
/** Пауза на стиле и длительность прохода валика — те же, что в .ss-* (surfaces.css). */
const HOLD_MS = 2600
const WIPE_MS = 1100

/**
 * Приглашение пустого экрана «Перенос стиля»: одна и та же комната, в которой
 * по кругу меняется интерьер — скандинавский → неоклассика → джапанди → лофт.
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
  const label = STYLE_LABEL[CYCLE[active]]

  return (
    <div className={cn("ss", className)} aria-hidden>
      <div className="ss-frame">
        <StyleScene style={CYCLE[current]} className="ss-layer" />
        {incoming !== null ? (
          <>
            <StyleScene key={`in-${incoming}`} style={CYCLE[incoming]} className="ss-layer is-incoming" />
            <span key={`edge-${incoming}`} className="ss-edge" />
          </>
        ) : null}
        <span key={label} className="ss-label rise-in">
          {label}
        </span>
      </div>
      <div className="ss-strip">
        {CYCLE.map((style, index) => (
          <span key={style} className={cn("ss-chip", index === active && "is-active")}>
            {STYLE_LABEL[style]}
          </span>
        ))}
      </div>
    </div>
  )
}
