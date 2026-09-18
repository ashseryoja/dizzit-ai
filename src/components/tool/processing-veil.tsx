"use client"

import { useEffect, useState } from "react"

import { ThinkingGlyph } from "@/components/glyphs"
import { cn } from "@/lib/utils"

/** Сколько держится один этап, прежде чем подпись сменится следующим. */
const STEP_MS = 9000

/**
 * Слой ожидания результата поверх размытого исходника — один на сцену,
 * карточки и плитки. Вместо «спиннер и надпись»: затемнение, проходящая
 * световая полоса, лёгкое зерно и этапы работы текстом. Этапы идут по времени и
 * на последнем останавливаются — слой не знает настоящего прогресса и не
 * изображает его процентами.
 *
 * `order` — номер плитки среди соседей: сдвигает фазу полосы и появление, чтобы
 * семь кадров сета не мигали синхронно. Стили — `.pv-*` в surfaces.css.
 */
export function ProcessingVeil({
  label,
  steps,
  order = 0,
  compact = false,
  className,
}: {
  /** Подпись, когда этапов нет: «переносим стиль…». */
  label: string
  /** Этапы по порядку; последний остаётся до конца. */
  steps?: string[]
  order?: number
  /** Плитка: без подписи, только полоса и глиф. */
  compact?: boolean
  className?: string
}) {
  const [step, setStep] = useState(0)
  const total = steps?.length ?? 0

  useEffect(() => {
    if (total < 2) return
    const timer = window.setInterval(() => setStep((value) => Math.min(value + 1, total - 1)), STEP_MS)
    return () => window.clearInterval(timer)
  }, [total])

  const text = steps && total > 0 ? steps[Math.min(step, total - 1)] : label

  return (
    <div
      className={cn("pv", compact && "is-compact", className)}
      style={{ ["--pv-order" as string]: order }}
      role="status"
      aria-live="polite"
    >
      <span className="pv-sweep" aria-hidden />
      <span className="pv-grain" aria-hidden />
      <span className="pv-body">
        <ThinkingGlyph size={compact ? 18 : 24} />
        {compact ? (
          <span className="sr-only">{text}</span>
        ) : (
          <>
            {/* key перезапускает появление подписи при смене этапа. */}
            <span key={text} className="pv-text">
              {text}
            </span>
            {total > 1 ? (
              <span className="pv-dots" aria-hidden>
                {steps!.map((name, index) => (
                  <span key={name} className={cn("pv-dot", index <= step && "is-on")} />
                ))}
              </span>
            ) : null}
          </>
        )}
      </span>
    </div>
  )
}
