"use client"

import { Clock, Palette, PersonStanding, Sparkles, type LucideIcon } from "lucide-react"

import { Switch } from "@/components/ui/switch"
import { ENHANCE_PRICE_LABEL } from "@/lib/enhance-engine"
import { cn } from "@/lib/utils"
import type { BatchFilter, BatchTime, BatchTools } from "@/types"

export const DEFAULT_BATCH_TOOLS: BatchTools = { quality: true, filter: "none", time: "keep" }

const FILTERS: { value: BatchFilter; label: string }[] = [
  { value: "none", label: "Нет" },
  { value: "warm", label: "Тёплый" },
  { value: "cool", label: "Холодный" },
  { value: "contrast", label: "Контраст" },
  { value: "mono", label: "Ч/Б" },
]

const TIMES: { value: BatchTime; label: string }[] = [
  { value: "keep", label: "Как есть" },
  { value: "morning", label: "Утро" },
  { value: "day", label: "День" },
  { value: "sunset", label: "Закат" },
  { value: "night", label: "Ночь" },
]

export const FILTER_LABEL = Object.fromEntries(FILTERS.map((item) => [item.value, item.label])) as Record<BatchFilter, string>
export const TIME_LABEL = Object.fromEntries(TIMES.map((item) => [item.value, item.label])) as Record<BatchTime, string>

/**
 * Три общие функции пакетного редактирования — единственное, что можно
 * применить к нескольким рендерам разом: качество, фильтр, время суток.
 * Точечные правки (отметить и убрать предмет) требуют одного кадра на
 * экране и здесь не предлагаются намеренно.
 */
export function BatchToolsPanel({
  value,
  onChange,
  populate,
  onPopulateChange,
  count,
}: {
  value: BatchTools
  onChange: (next: BatchTools) => void
  /** Заселение сцены — тот же тумблер, что в обычных настройках. */
  populate: boolean
  onPopulateChange: (next: boolean) => void
  /** Сколько рендеров получат эти настройки. */
  count: number
}) {
  return (
    <>
      <section className="flex items-center justify-between gap-4">
        <QualityToggle value={value.quality} onChange={(quality) => onChange({ ...value, quality })} />
      </section>

      <PopulateToggle value={populate} onChange={onPopulateChange} />

      <section>
        <ToolLabel icon={Palette} className="mb-2.5" hint="общий тон для всех рендеров">
          Фильтр
        </ToolLabel>
        <Segment options={FILTERS} value={value.filter} onChange={(filter) => onChange({ ...value, filter })} label="Фильтр" />
      </section>

      <section>
        <ToolLabel icon={Clock} className="mb-2.5" hint="освещение и небо под выбранное время суток">
          Время
        </ToolLabel>
        <Segment options={TIMES} value={value.time} onChange={(time) => onChange({ ...value, time })} label="Время" />
      </section>

      <p className="ds-caption border-t pt-3" style={{ borderColor: "var(--line)" }}>
        Настройки применятся ко всем {count} выбранным рендерам сразу. Точечные правки — по одному рендеру.
      </p>
    </>
  )
}

/** Разбор сцены vision-моделью, один AI-проход за фиксированную цену и бесплатный финальный Lanczos3. */
export function QualityToggle({ value, onChange }: { value: boolean; onChange: (next: boolean) => void }) {
  return (
    <div className="flex w-full items-center justify-between gap-4">
      <ToolLabel icon={Sparkles} hint={`свет, материалы и детали · результат в 4K · ≈ ${ENHANCE_PRICE_LABEL} за рендер`}>
        Улучшить качество
      </ToolLabel>
      <Switch checked={value} onChange={onChange} />
    </div>
  )
}

/**
 * Заселение сцены — тумблер в настройках редактора рендера. Единственная
 * функция, которая ДОБАВЛЯЕТ в кадр новое: людей и растения по контексту
 * сцены и в её масштабе. Живёт и в обычных настройках, и в пакетных.
 */
export function PopulateToggle({ value, onChange }: { value: boolean; onChange: (next: boolean) => void }) {
  return (
    <section className="flex items-center justify-between gap-4">
      <ToolLabel icon={PersonStanding} hint="люди и растения по контексту кадра, в масштабе сцены">
        Заселить сцену
      </ToolLabel>
      <Switch checked={value} onChange={onChange} />
    </section>
  )
}

function Segment<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[]
  value: T
  onChange: (next: T) => void
  label: string
}) {
  return (
    <div className="seg w-full flex-wrap" role="radiogroup" aria-label={label}>
      {options.map((item) => (
        <button
          key={item.value}
          type="button"
          role="radio"
          aria-checked={value === item.value}
          onClick={() => onChange(item.value)}
          className={cn("seg-item flex-1 justify-center", value === item.value && "is-active")}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

function ToolLabel({
  icon: Icon,
  children,
  hint,
  className,
}: {
  icon: LucideIcon
  children: React.ReactNode
  hint: string
  className?: string
}) {
  return (
    <span className={cn("flex items-start gap-2", className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.6} style={{ color: "var(--fg-4)" }} />
      <span className="flex flex-col gap-0.5">
        <span className="text-[13px]" style={{ color: "var(--fg-2)" }}>
          {children}
        </span>
        <span className="text-[11.5px]" style={{ color: "var(--fg-5)" }}>
          {hint}
        </span>
      </span>
    </span>
  )
}
