"use client"

import type { ReactNode } from "react"
import { Plus } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Пустой экран инструмента — большая зона приёма: клик открывает диалог,
 * перенос и вставка из буфера работают на всей странице (ToolShell). Контур —
 * SVG-пунктир, внутри — живое приглашение инструмента (visual: «до/после»,
 * смена стиля, карусель кадров, морф мебели), под ним заголовок и пояснение.
 * Стили — .dropzone в surfaces.css.
 */
export function ToolDropzone({
  onPick,
  label,
  armed = false,
  visual,
  title,
  description,
  caption,
  variant = "default",
  actionLabel,
  hint,
  footer,
  className = "max-w-[720px] gap-5 px-6 py-16 sm:py-20",
}: {
  onPick: () => void
  /** aria-label кнопки: «Добавить рендер». */
  label: string
  /** Файл уже приложен — контур подсвечен, как при ховере (фото → 3D). */
  armed?: boolean
  visual: ReactNode
  title: string
  description: ReactNode
  /** Обещание инструмента под зоной. */
  caption: ReactNode
  /** Стеклянная карточка без пунктирного контура. */
  variant?: "default" | "glass"
  actionLabel?: string
  hint?: ReactNode
  /** Дополнительное действие за пределами кнопки загрузки. */
  footer?: ReactNode
  /** Ширина, промежутки и поля кнопки — у приглашений разная высота. */
  className?: string
}) {
  return (
    <div className={cn("flex flex-1 flex-col items-center justify-center gap-4 py-6", variant === "glass" && "tool-dropzone-glass")}>
      <button
        type="button"
        onClick={onPick}
        aria-label={label}
        className={cn("flex w-full flex-col items-center justify-center", variant === "glass" ? "dropzone-glass" : "dropzone", armed && "is-armed", variant === "default" && className)}
        style={variant === "default" ? { borderRadius: "var(--r-xl)" } : undefined}
      >
        {variant === "default" ? (
          <svg className="dropzone-outline" aria-hidden>
            <rect width="100%" height="100%" rx="29" />
          </svg>
        ) : null}

        {visual}

        <span className={cn("relative flex flex-col items-center gap-1.5", variant === "glass" && "dropzone-glass-copy")}>
          <span className="ds-h2" style={{ color: "var(--fg-1)" }}>
            {title}
          </span>
          <span className="ds-body max-w-md text-center" style={{ color: "var(--fg-3)" }}>
            {description}
          </span>
        </span>
        {actionLabel ? <span className="dropzone-glass-action"><Plus size={19} strokeWidth={2.2} aria-hidden />{actionLabel}</span> : null}
        {hint ? <span className="dropzone-glass-hint">{hint}</span> : null}
      </button>
      <p className="ds-caption max-w-md text-center">{caption}</p>
      {footer}
    </div>
  )
}
