"use client"

import { Proportions } from "lucide-react"

import { FRAME_ASPECTS, frameAspectSize } from "@/lib/frame-aspect"
import { cn } from "@/lib/utils"
import type { FrameAspect } from "@/types"

/**
 * Выбор формата кадров — секция панели настроек композера (слот `extras`):
 * сторис 9:16, портрет 3:4, квадрат, альбом 4:3, широкий 16:9. У каждой
 * кнопки — глиф пропорции (.aspect-glyph в surfaces.css), чтобы формат
 * читался глазами, а не по цифрам. `value === null` — формат ещё не выбран:
 * страница просит выбрать его до построения; `suggested` подсвечивает
 * ближайший к пропорции исходника подписью «как исходник».
 */
export function AspectPicker({
  value,
  onChange,
  suggested,
  title = "Формат кадров",
  hint = "все кадры сета — в одном формате",
}: {
  value: FrameAspect | null
  onChange: (next: FrameAspect) => void
  /** Формат, ближайший к пропорции исходника, — подсказка. */
  suggested?: FrameAspect | null
  title?: string
  hint?: string
}) {
  return (
    <section>
      <span className="mb-2.5 flex items-start gap-2">
        <Proportions className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.6} style={{ color: "var(--fg-4)" }} />
        <span className="flex flex-col gap-0.5">
          <span className="text-[13px]" style={{ color: "var(--fg-2)" }}>
            {title}
          </span>
          <span className="text-[11.5px]" style={{ color: "var(--fg-5)" }}>
            {hint}
          </span>
        </span>
      </span>
      <div className="seg w-full flex-wrap" role="radiogroup" aria-label={title}>
        {FRAME_ASPECTS.map((item) => {
          const { width, height } = frameAspectSize(item.value)
          const active = value === item.value
          return (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(item.value)}
              className={cn("seg-item aspect-choice flex-1", active && "is-active")}
              title={item.value === suggested ? `${item.hint} · ближе всего к исходнику` : item.hint}
            >
              <span className="aspect-glyph" style={{ aspectRatio: `${width} / ${height}` }} aria-hidden />
              <span className="flex flex-col items-start leading-tight">
                <span className="tabular-nums">{item.value}</span>
                <span className="aspect-hint">{item.value === suggested ? "как исходник" : item.hint}</span>
              </span>
            </button>
          )
        })}
      </div>
    </section>
  )
}
