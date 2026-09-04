"use client"

import { Check, X } from "lucide-react"

import { MaterialSwatch } from "@/components/tool/material-swatch"
import { STYLES } from "@/lib/restyle-engine"
import { cn } from "@/lib/utils"
import type { RestyleStyle } from "@/types"

/**
 * Секция над композером для выбранного стиля: название и характеристика,
 * рядом все его материалы крупно — от стен и пола до света и декора, у
 * каждого галочка. Изначально все включены; снятая галочка исключает материал
 * из рендера («лофт, но без кирпича»). Крестик справа сбрасывает стиль на «свой».
 */
export function StyleDock({
  style,
  excluded,
  onToggle,
  onRestore,
  onClear,
}: {
  style: RestyleStyle
  /** Названия снятых материалов. */
  excluded: ReadonlySet<string>
  onToggle: (name: string) => void
  /** Вернуть все снятые галочки. */
  onRestore: () => void
  onClear: () => void
}) {
  const info = STYLES.find((item) => item.value === style)
  if (!info) return null

  return (
    <div className="style-dock">
      <div className="style-dock-head">
        <span className="style-dock-title">{info.label}</span>
        <span className="style-dock-hint">{info.hint}</span>
      </div>

      <div className="style-dock-tiles" role="group" aria-label={`Материалы стиля «${info.label}»`}>
        {info.swatches.map((swatch) => {
          const on = !excluded.has(swatch.name)
          return (
            <button
              key={swatch.name}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => onToggle(swatch.name)}
              className={cn("style-tile", !on && "is-off")}
              title={on ? `Убрать: ${swatch.name}` : `Вернуть: ${swatch.name}`}
            >
              <span className="style-tile-swatch">
                <MaterialSwatch material={swatch.material} color={swatch.color} size="lg" />
                <span className="style-tile-check" aria-hidden>
                  {on ? <Check className="h-2.5 w-2.5" strokeWidth={2.8} /> : null}
                </span>
              </span>
              <span className="style-tile-name">{swatch.name}</span>
            </button>
          )
        })}
      </div>

      <p className="style-dock-note">
        {excluded.size === 0 ? (
          "Снимите галочку, чтобы материала не было в рендере."
        ) : (
          <>
            Без: {[...excluded].join(", ")}.{" "}
            <button type="button" onClick={onRestore} className="style-dock-link">
              вернуть все
            </button>
          </>
        )}
      </p>

      <button type="button" onClick={onClear} aria-label="Сбросить стиль" className="btn-icon h-8 w-8 shrink-0">
        <X className="h-3.5 w-3.5" strokeWidth={1.8} />
      </button>
    </div>
  )
}
