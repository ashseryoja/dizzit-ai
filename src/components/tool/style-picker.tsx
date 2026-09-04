"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Check, PencilLine } from "lucide-react"

import { MaterialSwatch } from "@/components/tool/material-swatch"
import { StyleScene } from "@/components/tool/style-scenes"
import { STYLES, type RestyleFamily, type StyleInfo } from "@/lib/restyle-engine"
import { cn } from "@/lib/utils"
import type { RestyleStyle } from "@/types"

/** Пауза до превью: при прокрутке списка окошки не должны мелькать. */
const PREVIEW_DELAY_MS = 220
const PREVIEW_HEIGHT = 226

interface Preview {
  style: StyleInfo
  left: number
  width: number
  /** Показывать под строкой (top) или над ней (bottom) — куда есть место. */
  top?: number
  bottom?: number
}

/**
 * Список стилей рядом со сценой «Перенос стиля»: строка на стиль — название,
 * справа четыре самых узнаваемых материала и счётчик остальных, под названием
 * короткая характеристика (все материалы — в секции над композером). Первым идёт «Свой стиль» — быстрый доступ к
 * описанию словами. Клик выбирает стиль (он же — выбор в панели композера);
 * уточнения к выбранному — «лофт, но без кирпича» — пишут в комментарий внизу.
 *
 * При наведении (и фокусе с клавиатуры) под строкой — или над ней, если внизу
 * нет места — появляется окошко с примером интерьера в этом стиле: фото из
 * каталога, а пока его нет — нарисованная сцена. Окошко живёт порталом в
 * body: панель анимируется transform-ом, и fixed внутри неё считался бы от
 * панели.
 */
export function StylePicker({
  value,
  onChange,
  className,
}: {
  value: RestyleStyle
  onChange: (next: RestyleStyle) => void
  className?: string
}) {
  const [preview, setPreview] = useState<Preview | null>(null)
  const timer = useRef(0)

  const show = (style: StyleInfo, node: HTMLElement) => {
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const rect = node.getBoundingClientRect()
      const below = rect.bottom + PREVIEW_HEIGHT + 12 < window.innerHeight
      setPreview({
        style,
        left: rect.left,
        width: rect.width,
        top: below ? rect.bottom + 6 : undefined,
        bottom: below ? undefined : window.innerHeight - rect.top + 6,
      })
    }, PREVIEW_DELAY_MS)
  }
  const hide = () => {
    window.clearTimeout(timer.current)
    setPreview(null)
  }

  // Прокрутка списка и уход со страницы убирают окошко.
  useEffect(() => {
    if (!preview) return
    const onScroll = () => hide()
    window.addEventListener("scroll", onScroll, true)
    return () => window.removeEventListener("scroll", onScroll, true)
  }, [preview])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <div className={cn("flex flex-col gap-1", className)} role="radiogroup" aria-label="Стиль">
      <button
        type="button"
        role="radio"
        aria-checked={value === "auto"}
        onClick={() => onChange("auto")}
        className={cn("style-row", value === "auto" && "is-active")}
      >
        <span className="style-row-head">
          <span className="style-row-title">Свой стиль</span>
          <span className="style-row-swatches">
            <span className="style-row-custom" aria-hidden>
              <PencilLine className="h-3.5 w-3.5" strokeWidth={1.7} />
            </span>
            {value === "auto" ? <Check className="style-row-check" strokeWidth={2.4} aria-hidden /> : null}
          </span>
        </span>
        <span className="style-row-hint">опишите в комментарии: эпоха, материалы, настроение</span>
      </button>

      {STYLES.map((style) => {
        const active = value === style.value
        return (
          <button
            key={style.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(style.value)}
            onMouseEnter={(event) => show(style, event.currentTarget)}
            onMouseLeave={hide}
            onFocus={(event) => show(style, event.currentTarget)}
            onBlur={hide}
            className={cn("style-row", active && "is-active")}
          >
            <span className="style-row-head">
              <span className="style-row-title">{style.label}</span>
              <span className="style-row-swatches">
                {style.swatches.slice(0, 4).map((swatch, index) => (
                  <MaterialSwatch key={index} material={swatch.material} color={swatch.color} title={swatch.name} />
                ))}
                {style.swatches.length > 4 ? (
                  <span className="style-row-more" title={`Ещё ${style.swatches.length - 4} материалов — в секции над композером`}>
                    +{style.swatches.length - 4}
                  </span>
                ) : null}
                {active ? <Check className="style-row-check" strokeWidth={2.4} aria-hidden /> : null}
              </span>
            </span>
            <span className="style-row-hint">{style.hint}</span>
          </button>
        )
      })}

      {preview && typeof document !== "undefined"
        ? createPortal(
            <div
              className="style-preview fade-in"
              role="tooltip"
              style={{ left: preview.left, width: preview.width, top: preview.top, bottom: preview.bottom }}
            >
              <StylePreviewImage style={preview.style} />
              <span className="style-preview-caption">
                <span className="style-preview-title">{preview.style.label}</span>
                <span className="style-preview-hint">{preview.style.hint}</span>
              </span>
            </div>,
            document.body
          )
        : null}
    </div>
  )
}

/** Фото из каталога, а пока его нет — нарисованная сцена стиля. */
function StylePreviewImage({ style }: { style: StyleInfo }) {
  if (style.photo) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={style.photo} alt="" className="style-preview-image" draggable={false} />
  }
  return <StyleScene style={style.value as RestyleFamily} className="style-preview-image" />
}
