"use client"

import { Plus } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Плейсхолдер «добавить ещё» в галерее результатов: плитка того же размера,
 * что исходник карточки, с пунктиром, плюсом и подписью. По клику — выбор
 * файла (`intake.pickFiles`); дальше обычный путь инструмента. Нужен там, где
 * после первого результата экран уже без дропзоны и добавить новый исходник
 * иначе неоткуда, кроме вставки из буфера (сеты «Ракурсов»).
 */
export function AddTile({
  onClick,
  label,
  hint,
  aspectRatio = "4 / 3",
  className,
}: {
  onClick: () => void
  /** «Добавить кадр». */
  label: string
  /** Подпись под плиткой: «и построить ещё один сет». */
  hint?: string
  /** Пропорция плитки — как у исходника рядом. */
  aspectRatio?: string
  className?: string
}) {
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
