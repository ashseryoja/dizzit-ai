"use client"

import { Sparkles } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Превью-сетка пустого экрана «Генерация материала»: пять настоящих тайлов,
 * сгенерированных сервисом (килим, замша, гусиная лапка, цветочный принт,
 * лён), в раскладке будущей галереи плюс слот «ваш материал». Фотореализм —
 * обещание инструмента, поэтому здесь результаты, а не нарисованные заготовки.
 * Файлы — `public/images/invite/material-*.jpg` (520 px). Анимации — в .mp-*
 * (surfaces.css). Заготовки — не кнопки: клик по ним ничего не запускает.
 */

interface PreviewTile {
  key: string
  caption: string
  src: string
}

const TILES: PreviewTile[] = [
  { key: "kilim", caption: "ткань · килим с орнаментом", src: "/images/invite/material-1.jpg" },
  { key: "suede", caption: "замша · коньячная", src: "/images/invite/material-2.jpg" },
  { key: "houndstooth", caption: "ткань · гусиная лапка", src: "/images/invite/material-3.jpg" },
  { key: "floral", caption: "ткань · цветочный принт", src: "/images/invite/material-4.jpg" },
  { key: "linen", caption: "ткань · лён молочный", src: "/images/invite/material-5.jpg" },
]

export function MaterialPreviewGrid({
  onActivate,
  className,
}: {
  /** Клик по слоту «ваш материал» — фокус на поле описания; ничего не генерирует. */
  onActivate?: () => void
  className?: string
}) {
  return (
    <div className={cn("grid w-full grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4", className)}>
      {TILES.map((tile, index) => (
        <figure
          key={tile.key}
          className="mp-tile card relative aspect-square overflow-hidden"
          style={{ borderRadius: "var(--r-lg)", animationDelay: `${index * 90}ms` }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={tile.src} alt="" draggable={false} loading="lazy" className="mp-photo" />
          <figcaption className="mp-caption">
            <span className="truncate">{tile.caption}</span>
            <span className="mp-caption-tag">пример</span>
          </figcaption>
        </figure>
      ))}

      <button
        type="button"
        onClick={onActivate}
        className="mp-tile mp-slot flex aspect-square flex-col items-center justify-center gap-3 p-4 text-center"
        style={{ borderRadius: "var(--r-lg)", animationDelay: `${TILES.length * 90}ms` }}
      >
        <svg className="mp-slot-outline" aria-hidden>
          <rect width="100%" height="100%" rx="17" />
        </svg>
        <span
          className="relative flex h-11 w-11 items-center justify-center rounded-full"
          style={{ background: "var(--bg-raised)", border: "1px solid var(--line-strong)" }}
        >
          <Sparkles className="mp-slot-spark h-[18px] w-[18px]" strokeWidth={1.6} style={{ color: "var(--fg-2)" }} />
        </span>
        <span className="relative flex flex-col gap-1">
          <span className="text-[13.5px]" style={{ color: "var(--fg-1)" }}>
            Ваш материал
          </span>
          <span className="text-[11.5px] leading-snug" style={{ color: "var(--fg-4)" }}>
            Опишите его в строке внизу — заготовки сменятся вашими тайлами
          </span>
        </span>
      </button>
    </div>
  )
}
