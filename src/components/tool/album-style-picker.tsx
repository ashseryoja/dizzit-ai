"use client"

import { cn } from "@/lib/utils"
import type { AlbumFormat, AlbumTheme } from "@/shared/album"

/** Форматы страниц альбома: глиф пропорции, подпись и для чего годится. */
export const ALBUM_FORMAT_OPTIONS: { value: AlbumFormat; label: string; hint: string; ratio: string }[] = [
  { value: "a4-landscape", label: "A4 альбомный", hint: "печать и экран", ratio: "297 / 210" },
  { value: "a4-portrait", label: "A4 книжный", hint: "печать", ratio: "210 / 297" },
  { value: "screen", label: "16:9", hint: "показ с экрана", ratio: "16 / 9" },
]

/** Темы разворотов. */
export const ALBUM_THEME_OPTIONS: { value: AlbumTheme; label: string; hint: string }[] = [
  { value: "dark", label: "Тёмная", hint: "фирменная, для экрана" },
  { value: "light", label: "Светлая", hint: "экономит краску" },
]

/**
 * Выбор формата страниц — сегмент с глифами пропорции листа (тот же рецепт
 * `.seg-item.aspect-choice`, что у формата кадров в «Ракурсах»): формат
 * читается глазами, а не по названию.
 */
export function AlbumFormatPicker({ value, onChange }: { value: AlbumFormat; onChange: (next: AlbumFormat) => void }) {
  return (
    <div className="seg w-full flex-wrap" role="radiogroup" aria-label="Формат страниц">
      {ALBUM_FORMAT_OPTIONS.map((option) => {
        const active = option.value === value
        return (
          <button key={option.value} type="button" role="radio" aria-checked={active} className={cn("seg-item aspect-choice flex-1", active && "is-active")} onClick={() => onChange(option.value)}>
            <span className="aspect-glyph" style={{ aspectRatio: option.ratio }} aria-hidden />
            <span className="flex flex-col items-start leading-tight">
              <span>{option.label}</span>
              <span className="aspect-hint">{option.hint}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** Выбор темы — сегмент с миниатюрой листа: тёмный или светлый. */
export function AlbumThemePicker({ value, onChange }: { value: AlbumTheme; onChange: (next: AlbumTheme) => void }) {
  return (
    <div className="seg w-full flex-wrap" role="radiogroup" aria-label="Тема альбома">
      {ALBUM_THEME_OPTIONS.map((option) => {
        const active = option.value === value
        return (
          <button key={option.value} type="button" role="radio" aria-checked={active} className={cn("seg-item aspect-choice flex-1", active && "is-active")} onClick={() => onChange(option.value)}>
            <span className={cn("album-theme-glyph", option.value === "dark" ? "is-dark" : "is-light")} aria-hidden />
            <span className="flex flex-col items-start leading-tight">
              <span>{option.label}</span>
              <span className="aspect-hint">{option.hint}</span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
