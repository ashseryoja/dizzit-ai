"use client"

import { Plus } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Плейсхолдер «добавить ещё» в галерее результатов. По клику — выбор файла
 * (`intake.pickFiles`); дальше обычный путь инструмента. Нужен там, где после
 * первого результата экран уже без дропзоны и добавить новый исходник иначе
 * неоткуда, кроме вставки из буфера (сеты «Ракурсов»).
 *
 * Два вида: `variant="bar"` — узкая длинная полоса НАД галереей, с плюсом,
 * подписью и подсказкой в одну строку (не нужно прокручивать к концу списка,
 * чтобы добавить рендер); `variant="tile"` — плитка того же размера, что
 * исходник карточки, с пунктиром, плюсом и подписью под ней.
 */
export function AddTile({
  onClick,
  label,
  hint,
  aspectRatio = "4 / 3",
  variant = "tile",
  className,
}: {
  onClick: () => void
  /** «Добавить кадр». */
  label: string
  /** Подпись: «и построить ещё один сет» — под плиткой или после подписи в полосе. */
  hint?: string
  /** Пропорция плитки — как у исходника рядом (только `tile`). */
  aspectRatio?: string
  /** Полоса над галереей или плитка в ней. */
  variant?: "tile" | "bar"
  className?: string
}) {
  if (variant === "bar") {
    return (
      <button type="button" onClick={onClick} className={cn("add-bar", className)}>
        <span className="add-tile-plus">
          <Plus className="h-4 w-4" strokeWidth={1.6} />
        </span>
        <span className="text-[13px]">{label}</span>
        {hint ? <span className="ds-caption hidden sm:inline">{hint}</span> : null}
      </button>
    )
  }
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <button type="button" onClick={onClick} className="add-tile" style={{ aspectRatio }} aria-label={label}>
        <span className="add-tile-plus">
          <Plus className="h-5 w-5" strokeWidth={1.6} />
        </span>
      </button>
      <span className="flex flex-col gap-0.5 px-0.5">
        <button type="button" onClick={onClick} className="text-left text-[13px]" style={{ color: "var(--fg-2)" }}>
          {label}
        </button>
        {hint ? <span className="ds-caption">{hint}</span> : null}
      </span>
    </div>
  )
}
