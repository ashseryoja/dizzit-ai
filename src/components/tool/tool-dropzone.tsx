"use client"

import type { ReactNode } from "react"

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
  caption: string
  /** Ширина, промежутки и поля кнопки — у приглашений разная высота. */
  className?: string
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 py-6">
      <button
        type="button"
        onClick={onPick}
        aria-label={label}
        className={cn("dropzone flex w-full flex-col items-center justify-center", armed && "is-armed", className)}
        style={{ borderRadius: "var(--r-xl)" }}
      >
        <svg className="dropzone-outline" aria-hidden>
          <rect width="100%" height="100%" rx="29" />
        </svg>

        {visual}

        <span className="relative flex flex-col items-center gap-1.5">
          <span className="ds-h2" style={{ color: "var(--fg-1)" }}>
            {title}
          </span>
          <span className="ds-body max-w-md text-center" style={{ color: "var(--fg-3)" }}>
            {description}
          </span>
        </span>
      </button>
      <p className="ds-caption max-w-md text-center">{caption}</p>
    </div>
  )
}
