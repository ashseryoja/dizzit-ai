"use client"

import { Check, Plus, SlidersHorizontal, X } from "lucide-react"

import type { AttachedRender } from "@/components/tool/tool-composer"
import { cn, plural } from "@/lib/utils"

interface RenderTrayProps {
  attachments: AttachedRender[]
  /** Индекс рендера, который сейчас показан большим на сцене. */
  focus: number
  /** Рабочий набор — previewUrl рендеров, которые уйдут в обработку. */
  picked: Set<string>
  /** Режим «Выбрать» (как в iOS): клик по плитке переключает её в наборе. */
  picking: boolean
  onTogglePicking: () => void
  onPickAll: () => void
  /** Режим выбора с отмеченными: открыть пакетное редактирование набора. */
  onEditAll: () => void
  onSelect: (index: number) => void
  onRemove: (index: number) => void
  onPickFiles: () => void
  onClear: () => void
  maxFiles: number
  /** Формы слова: [рендер, рендера, рендеров]. */
  noun: [string, string, string]
  /** Заголовок панели во множественном числе: «рендеры», «интерьеры». */
  title?: string
  /** Глагол кнопки набора: «Редактировать», «Перенести». */
  editLabel?: string
}

/**
 * Галерея приложенных рендеров — правая панель, зеркальная сайдбару
 * (та же ширина, отступы и поверхность). Гридом лежат миниатюры пачки.
 *
 * Обычный режим: клик выбирает ОДИН рендер — он показывается на сцене
 * и он же уходит в обработку. Режим «Выбрать» (кнопка сверху, как в iOS):
 * клики набирают несколько рендеров, обработка применяется ко всем сразу.
 * Крестик убирает рендер из пачки, плитка «+» докладывает ещё.
 */
export function RenderTray({
  attachments,
  focus,
  picked,
  picking,
  onTogglePicking,
  onPickAll,
  onEditAll,
  onSelect,
  onRemove,
  onPickFiles,
  onClear,
  maxFiles,
  noun,
  title = "рендеры",
  editLabel = "Редактировать",
}: RenderTrayProps) {
  const count = attachments.length
  const pickedCount = attachments.filter((item) => picked.has(item.previewUrl)).length
  const allPicked = count > 0 && pickedCount === count

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 pl-5 pr-3">
        {picking ? (
          <button type="button" onClick={onPickAll} className="btn-ghost h-8 px-2.5 text-[12px]">
            {allPicked ? "Снять все" : "Выбрать все"}
          </button>
        ) : (
          <span className="flex items-baseline gap-2">
            <span className="ds-micro">{title}</span>
            <span className="text-[12px] tabular-nums" style={{ color: "var(--fg-4)" }}>
              {count} из {maxFiles}
            </span>
          </span>
        )}
        <button
          type="button"
          onClick={onTogglePicking}
          aria-pressed={picking}
          className={cn("h-8 px-2.5 text-[12px]", picking ? "btn-outline" : "btn-ghost")}
        >
          {picking ? "Готово" : "Выбрать"}
        </button>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <div className="grid grid-cols-2 gap-2" role="listbox" aria-multiselectable={picking} aria-label="Приложенные рендеры">
          {attachments.map((attachment, index) => (
            <TrayThumb
              key={attachment.previewUrl}
              attachment={attachment}
              index={index}
              picked={picked.has(attachment.previewUrl)}
              focused={index === focus}
              picking={picking}
              onSelect={() => onSelect(index)}
              onRemove={() => onRemove(index)}
            />
          ))}

          {count < maxFiles && !picking ? (
            <button
              type="button"
              onClick={onPickFiles}
              aria-label="Добавить ещё рендер"
              className="tray-add flex aspect-[4/3] flex-col items-center justify-center gap-1"
            >
              <Plus className="h-4 w-4" strokeWidth={1.7} />
              <span className="text-[11px]">Добавить</span>
            </button>
          ) : null}
        </div>
      </div>

      <div className="shrink-0 px-4 pb-4 pt-2">
        <hr className="ds-divider mb-3" />
        {picking && pickedCount > 0 ? (
          /* Отмечено несколько — единственное действие с набором: общие правки. */
          <button type="button" onClick={onEditAll} className="btn-primary h-10 w-full justify-center text-[13px]">
            <SlidersHorizontal className="h-4 w-4" strokeWidth={1.7} />
            {pickedCount === 1 ? editLabel : `${editLabel} все · ${pickedCount}`}
          </button>
        ) : (
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="min-w-0 truncate text-[12px]" style={{ color: "var(--fg-4)" }}>
              {count} {plural(count, noun)} в пачке
            </span>
            <button type="button" onClick={onClear} className="btn-ghost h-8 shrink-0 px-2.5 text-[12px]">
              Очистить
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Полоска миниатюр для узких экранов, где правой панели нет:
 * горизонтальная прокрутка под сценой, те же плитки и тот же режим выбора.
 */
export function RenderStrip({
  attachments,
  focus,
  picked,
  picking,
  onTogglePicking,
  onEditAll,
  onSelect,
  onRemove,
  onPickFiles,
  maxFiles,
  editLabel = "Редактировать",
}: Omit<RenderTrayProps, "onClear" | "noun" | "onPickAll" | "title">) {
  const pickedCount = attachments.filter((item) => picked.has(item.previewUrl)).length
  return (
    <div className="flex items-center gap-2">
      <div className="no-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto py-1" role="listbox" aria-multiselectable={picking} aria-label="Приложенные рендеры">
        {attachments.map((attachment, index) => (
          <div key={attachment.previewUrl} className="w-[96px] shrink-0">
            <TrayThumb
              attachment={attachment}
              index={index}
              picked={picked.has(attachment.previewUrl)}
              focused={index === focus}
              picking={picking}
              onSelect={() => onSelect(index)}
              onRemove={() => onRemove(index)}
            />
          </div>
        ))}
        {attachments.length < maxFiles && !picking ? (
          <button
            type="button"
            onClick={onPickFiles}
            aria-label="Добавить ещё рендер"
            className="tray-add flex aspect-[4/3] w-[96px] shrink-0 items-center justify-center"
          >
            <Plus className="h-4 w-4" strokeWidth={1.7} />
          </button>
        ) : null}
      </div>
      {picking && pickedCount > 0 ? (
        <button type="button" onClick={onEditAll} className="btn-primary h-8 shrink-0 px-2.5 text-[12px]">
          {editLabel}{pickedCount > 1 ? ` все · ${pickedCount}` : ""}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onTogglePicking}
        aria-pressed={picking}
        className={cn("h-8 shrink-0 px-2.5 text-[12px]", picking ? "btn-outline" : "btn-ghost")}
      >
        {picking ? "Готово" : "Выбрать"}
      </button>
    </div>
  )
}

function TrayThumb({
  attachment,
  index,
  picked,
  focused,
  picking,
  onSelect,
  onRemove,
}: {
  attachment: AttachedRender
  index: number
  picked: boolean
  focused: boolean
  picking: boolean
  onSelect: () => void
  onRemove: () => void
}) {
  return (
    <div
      role="option"
      aria-selected={picked}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        "tray-thumb group/thumb aspect-[4/3]",
        picked && "is-active",
        focused && "is-focus",
        picking && "is-picking"
      )}
      title={attachment.file.name}
    >
      {/* Превью — object URL локального файла, next/image ни к чему. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={attachment.previewUrl}
        alt={attachment.file.name}
        className="h-full w-full object-cover"
        draggable={false}
      />
      <span className="tray-thumb-index" aria-hidden>
        {index + 1}
      </span>
      {picking ? (
        /* Кружок-чекбокс в режиме выбора — паттерн «Фото» iOS. */
        <span className={cn("tray-thumb-check", picked && "is-on")} aria-hidden>
          {picked ? <Check className="h-3 w-3" strokeWidth={2.4} /> : null}
        </span>
      ) : (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
          aria-label={`Убрать «${attachment.file.name}»`}
          className="tray-thumb-remove"
        >
          <X className="h-3 w-3" strokeWidth={1.8} />
        </button>
      )}
    </div>
  )
}
