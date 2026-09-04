"use client"

import { useEffect, useRef, useState } from "react"

import { INTRO_MORPH } from "@/lib/intro-morph-data"
import { cn } from "@/lib/utils"

const SEEN_KEY = "dizzit-intro-seen"

/* Тайминги сценария. Снятие оверлея — ТОЛЬКО JS-таймеры, не конец анимаций:
   клок анимаций и rAF в фоновой вкладке замирают, заставка не имеет права
   зависнуть навсегда. */
const MORPH_START_MS = 2400
const MORPH_MS = 680
const LEAVE_MS = 3450
const DONE_MS = 4000

type Phase = "boot" | "playing" | "leaving" | "done"

const SVG_NS = "http://www.w3.org/2000/svg"
const COLOR_MAIN = "#ffffff"
/* НЕПРОЗРАЧНЫЙ эквивалент rgba(255,255,255,0.48) на фоне #1e1e21: контуры
   буквы (ножки «A» и её перекладина) рисуются отдельными фигурами и
   перекрываются — полупрозрачный цвет в зоне наложения светлел бы. */
const COLOR_AI = "rgb(138, 138, 140)"
const COLOR_BG = "#1e1e21" // --bg-page: дырки на сплошном фоне

/** Задержка старта каждого штриха — буквы пишутся по очереди. */
function delay(ms: number) {
  return { "--d": `${ms}ms` } as React.CSSProperties
}

function easeOutCubic(t: number) {
  return 1 - (1 - t) ** 3
}

interface MorphController {
  setT: (eased: number) => void
  finalize: () => void
}

/**
 * Полноэкранная заставка входа.
 *
 * Сценарий в ДВА этапа, без промежуточных состояний и кроссфейдов:
 *  1) рукописный эскиз «Dizzit AI» дорисовывается штрих за штрихом, чуть криво;
 *  2) каждый штрих МОРФИТСЯ прямо в контур соответствующего глифа Unbounded —
 *     геометрия перетекает из рисунка в финальный логотип. Контуры глифов
 *     извлечены из того же TTF, что рендерит логотип в сайдбаре, и поставлены
 *     в метрику реального рендера, поэтому конечный кадр — это и есть логотип,
 *     подменять его нечем и незачем.
 *
 * Морф ведёт JS (rAF): пары контуров предрасчитаны скриптом
 * scripts/build-intro-morph.mjs (штрих раздут в замкнутую «колбасу», глиф
 * пересэмплирован в те же 128 точек, кольца выровнены) — на кадр остаётся
 * линейная интерполяция точек. По завершении подставляется точный d глифа
 * с кривыми — полигон из 128 точек и так неотличим, но пусть будет идеал.
 *
 * Правила показа: один раз за сессию (sessionStorage), клик/Esc — пропуск,
 * prefers-reduced-motion — пропуск целиком. ?intro=hold — отладка: заставка
 * не снимается сама, window.__intro.at(t)/final() листают морф вручную.
 */
export function IntroSplash() {
  const [phase, setPhase] = useState<Phase>("boot")
  const timersRef = useRef<number[]>([])
  const rafRef = useRef<number>(0)
  const morphRef = useRef<MorphController | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  /** Спрятать штрихи, смонтировать слой заливок в исходном состоянии. */
  const buildMorph = (): MorphController | null => {
    if (morphRef.current) return morphRef.current
    const svg = svgRef.current
    if (!svg) return null

    const layer = document.createElementNS(SVG_NS, "g")
    const items: { el: SVGPathElement; from: number[]; to: number[]; final: string }[] = []

    // Каждый контур — свой path: чернила цветом букв, контрформы цветом фона.
    // Заливать букву ОДНИМ путём с намоткой nonzero нельзя, хотя это и была бы
    // шрифтовая семантика: посреди морфа контрформа успевает вырасти за
    // пределы ещё тонкого штриха, и область с намоткой −1 заливается вместо
    // того, чтобы вырезаться. Цвет фона такого не умеет — он просто невидим,
    // пока не ляжет на чернила. Шпильку контрформы «D», которая раньше
    // гасилась намоткой, снимает генератор (см. build-intro-morph.mjs).
    for (const letter of INTRO_MORPH) {
      const ink = letter.color === "main" ? COLOR_MAIN : COLOR_AI
      for (const shape of letter.shapes) {
        const el = document.createElementNS(SVG_NS, "path")
        el.setAttribute("fill", ink)
        layer.appendChild(el)
        items.push({ el, ...shape })
      }
      // Дырки — ПОСЛЕ чернил своей буквы: рисуются поверх и «прорезают» её.
      for (const hole of letter.counters) {
        const el = document.createElementNS(SVG_NS, "path")
        el.setAttribute("fill", COLOR_BG)
        layer.appendChild(el)
        items.push({ el, ...hole })
      }
    }

    const setT = (eased: number) => {
      for (const item of items) {
        const { from, to } = item
        const parts: string[] = []
        for (let i = 0; i < from.length; i += 2) {
          const x = from[i] + (to[i] - from[i]) * eased
          const y = from[i + 1] + (to[i + 1] - from[i + 1]) * eased
          parts.push(`${x.toFixed(2)} ${y.toFixed(2)}`)
        }
        item.el.setAttribute("d", `M${parts.join("L")}Z`)
      }
    }

    const finalize = () => {
      for (const item of items) item.el.setAttribute("d", item.final)
    }

    setT(0)
    svg.appendChild(layer)
    // Штрихи гаснут в тот же кадр, когда их место занимают идентичные заливки.
    svg.querySelectorAll<SVGPathElement>("path.st").forEach((p) => {
      p.style.display = "none"
    })

    const controller = { setT, finalize }
    morphRef.current = controller
    return controller
  }

  const runMorph = () => {
    const morph = buildMorph()
    if (!morph) return
    const t0 = performance.now()
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / MORPH_MS)
      morph.setT(easeOutCubic(t))
      if (t >= 1) {
        morph.finalize()
        return
      }
      rafRef.current = requestAnimationFrame(frame)
    }
    rafRef.current = requestAnimationFrame(frame)
  }

  useEffect(() => {
    // ?intro=hold — отладка: показывается всегда, сама не снимается.
    const debugHold = new URLSearchParams(window.location.search).get("intro") === "hold"

    let seen = false
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === "1"
      sessionStorage.setItem(SEEN_KEY, "1")
    } catch {
      // Приватный режим с запретом storage: не рискуем показывать на каждый
      // переход — просто пропускаем.
      seen = true
    }

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    if (!debugHold && (seen || reducedMotion)) {
      setPhase("done")
      return
    }

    setPhase("playing")

    if (debugHold) {
      const w = window as typeof window & {
        __intro?: { at: (t: number) => void; final: () => void }
      }
      w.__intro = {
        at: (t: number) => buildMorph()?.setT(easeOutCubic(Math.min(1, Math.max(0, t)))),
        final: () => {
          const m = buildMorph()
          m?.setT(1)
          m?.finalize()
        },
      }
      return () => {
        delete w.__intro
      }
    }

    const morphTimer = window.setTimeout(runMorph, MORPH_START_MS)
    const leaveTimer = window.setTimeout(() => setPhase("leaving"), LEAVE_MS)
    const doneTimer = window.setTimeout(() => setPhase("done"), DONE_MS)
    timersRef.current = [morphTimer, leaveTimer, doneTimer]
    return () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer))
      cancelAnimationFrame(rafRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (phase !== "playing") return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") skip()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const skip = () => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer))
    cancelAnimationFrame(rafRef.current)
    setPhase("leaving")
    timersRef.current = [window.setTimeout(() => setPhase("done"), 480)]
  }

  if (phase === "done") return null

  return (
    <div
      className={cn("intro-overlay", phase === "leaving" && "is-leaving")}
      onClick={phase === "playing" ? skip : undefined}
      aria-hidden
    >
      {phase !== "boot" ? (
        <div className="intro-stage">
          {/* Эскиз: однолинейные «рукописные» буквы. Каждая — свой штрих со
              своим наклоном (transform) и задержкой (--d). */}
          <svg ref={svgRef} className="intro-sketch" viewBox="0 0 620 150" fill="none" aria-hidden>
            <g className="intro-sketch-tilt">
              {/* D */}
              <path
                className="st st-main"
                pathLength={1}
                style={delay(0)}
                transform="rotate(-2.5 134 72)"
                d="M107 41 C106 62 106 84 107 104 M113 43 C138 41 160 54 161 72 C162 90 138 104 113 102"
              />
              {/* i */}
              <path
                className="st st-main"
                pathLength={1}
                style={delay(190)}
                transform="rotate(1.8 182 72)"
                d="M182 61 C181 76 181 90 182 105 M181 41 C181 43 182 45 183 43"
              />
              {/* z */}
              <path
                className="st st-main"
                pathLength={1}
                style={delay(380)}
                transform="rotate(-1.6 222 82)"
                d="M199 62 C214 59 230 59 244 61 L243 63 C229 76 215 89 203 102 L205 104 C219 106 233 106 246 104"
              />
              {/* z */}
              <path
                className="st st-main"
                pathLength={1}
                style={delay(560)}
                transform="rotate(1.5 278 82)"
                d="M255 62 C270 59 286 59 300 61 L299 63 C285 76 271 89 259 102 L261 104 C275 106 289 106 302 104"
              />
              {/* i */}
              <path
                className="st st-main"
                pathLength={1}
                style={delay(740)}
                transform="rotate(-1.4 316 72)"
                d="M316 61 C315 76 315 90 316 105 M315 41 C315 43 316 45 317 43"
              />
              {/* t */}
              <path
                className="st st-main"
                pathLength={1}
                style={delay(920)}
                transform="rotate(1.6 348 75)"
                d="M341 43 C340 65 339 85 341 97 C343 105 355 107 366 103 M329 61 C340 59 353 59 364 61"
              />
              {/* A — серым, как в логотипе */}
              <path
                className="st st-ai"
                pathLength={1}
                style={delay(1120)}
                transform="rotate(1.4 436 68)"
                d="M403 105 C413 79 423 53 435 33 L437 32 C449 53 460 79 470 105 M417 77 C430 74 445 74 457 77"
              />
              {/* I */}
              <path
                className="st st-ai"
                pathLength={1}
                style={delay(1300)}
                transform="rotate(-2 480 70)"
                d="M480 34 C479 57 479 81 480 105"
              />
              {/* Точка-акцент: JS-морфу не нужна — CSS перекатывает её на
                  позицию точки логотипа и заливает белым. */}
              <circle className="st st-dot" pathLength={1} style={delay(1430)} cx="530" cy="96" r="8" />
            </g>
          </svg>

          <p className="intro-hint">нажмите, чтобы пропустить</p>
        </div>
      ) : null}
    </div>
  )
}
