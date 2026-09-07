"use client"

import { Fragment, useEffect, useRef, useState, type DragEvent, type ReactNode } from "react"
import { Check, FolderInput, Plus, SlidersHorizontal, X } from "lucide-react"

import type { AttachedRender } from "@/components/tool/tool-composer"
import { cn, plural } from "@/lib/utils"

/** MIME переноса плиток пачки: список id записей (JSON). Принимает FolderRail. */
export const RENDER_DRAG_TYPE = "application/x-dizzit-renders"

/** Куда можно перенести рендеры: null — «Общая», то есть без папки. */
export interface MoveTarget {
  id: string | null
  title: string
}

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
  /** Подпись обычной плитки, когда рядом показывается производная версия. */
  sourceLabel?: string
  /** Дополнительная плитка после исходника: результат, вариант, ракурс. */
  renderVersion?: (attachment: AttachedRender, index: number) => ReactNode
  /**
   * Папки, куда можно перенести рендеры. Задано — плитки перетаскиваются на
   * вкладки FolderRail, а в режиме «Выбрать» появляется кнопка «В папку».
   */
  moveTargets?: MoveTarget[]
  onMoveTo?: (ids: string[], folderId: string | null) => void
}

/** Что уезжает при перетаскивании плитки: в режиме выбора — весь набор, иначе одна. */
function dragIdsFor(attachment: AttachedRender, attachments: AttachedRender[], picked: Set<string>, picking: boolean): string[] {
  if (picking && picked.has(attachment.previewUrl)) {
    return attachments.filter((item) => picked.has(item.previewUrl)).map((item) => item.id)
  }
  return [attachment.id]
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
  sourceLabel,
  renderVersion,
  moveTargets,
  onMoveTo,
}: RenderTrayProps) {
  const count = attachments.length
  const pickedItems = attachments.filter((item) => picked.has(item.previewUrl))
  const pickedCount = pickedItems.length
  const allPicked = count > 0 && pickedCount === count
  const canMove = Boolean(onMoveTo && moveTargets && moveTargets.length > 1)

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
              {Number.isFinite(maxFiles) ? `${count} из ${maxFiles}` : count}
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
            <Fragment key={attachment.previewUrl}>
              <TrayThumb
                attachment={attachment}
                index={index}
                label={sourceLabel ? `${index + 1} · ${sourceLabel}` : undefined}
                picked={picked.has(attachment.previewUrl)}
                focused={index === focus}
                picking={picking}
                onSelect={() => onSelect(index)}
                onRemove={() => onRemove(index)}
                dragIds={canMove ? dragIdsFor(attachment, attachments, picked, picking) : undefined}
              />
              {!picking ? renderVersion?.(attachment, index) : null}
            </Fragment>
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
          /* Отмечено несколько: общие правки и, если есть папки, перенос набора. */
          <div className="flex items-stretch gap-2">
            <button type="button" onClick={onEditAll} className="btn-primary h-10 min-w-0 flex-1 justify-center text-[13px]">
              <SlidersHorizontal className="h-4 w-4 shrink-0" strokeWidth={1.7} />
              <span className="truncate">{pickedCount === 1 ? editLabel : `${editLabel} все · ${pickedCount}`}</span>
            </button>
            {canMove && moveTargets && onMoveTo ? (
              <MoveMenu targets={moveTargets} onPick={(folderId) => onMoveTo(pickedItems.map((item) => item.id), folderId)} />
            ) : null}
          </div>
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
  sourceLabel,
  renderVersion,
  moveTargets,
  onMoveTo,
}: Omit<RenderTrayProps, "onClear" | "noun" | "onPickAll" | "title">) {
  const pickedItems = attachments.filter((item) => picked.has(item.previewUrl))
  const pickedCount = pickedItems.length
  const canMove = Boolean(onMoveTo && moveTargets && moveTargets.length > 1)
  return (
    <div className="flex items-center gap-2">
      <div className="no-scrollbar flex min-w-0 flex-1 gap-2 overflow-x-auto py-1" role="listbox" aria-multiselectable={picking} aria-label="Приложенные рендеры">
        {attachments.map((attachment, index) => {
          const version = !picking ? renderVersion?.(attachment, index) : null
          return (
            <Fragment key={attachment.previewUrl}>
              <div className="w-[96px] shrink-0">
                <TrayThumb
                  attachment={attachment}
                  index={index}
                  label={sourceLabel ? `${index + 1} · ${sourceLabel}` : undefined}
                  picked={picked.has(attachment.previewUrl)}
                  focused={index === focus}
                  picking={picking}
                  onSelect={() => onSelect(index)}
                  onRemove={() => onRemove(index)}
                  dragIds={canMove ? dragIdsFor(attachment, attachments, picked, picking) : undefined}
                />
              </div>
              {version ? <div className="w-[96px] shrink-0">{version}</div> : null}
            </Fragment>
          )
        })}
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
        <>
          <button type="button" onClick={onEditAll} className="btn-primary h-8 shrink-0 px-2.5 text-[12px]">
            {editLabel}{pickedCount > 1 ? ` все · ${pickedCount}` : ""}
          </button>
          {canMove && moveTargets && onMoveTo ? (
            <MoveMenu compact targets={moveTargets} onPick={(folderId) => onMoveTo(pickedItems.map((item) => item.id), folderId)} />
          ) : null}
        </>
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
  label,
  picked,
  focused,
  picking,
  onSelect,
  onRemove,
  dragIds,
}: {
  attachment: AttachedRender
  index: number
  label?: string
  picked: boolean
  focused: boolean
  picking: boolean
  onSelect: () => void
  onRemove: () => void
  /** Id записей, которые уезжают при перетаскивании плитки на вкладку папки. */
  dragIds?: string[]
}) {
  return (
    <div
      role="option"
      aria-selected={picked}
      tabIndex={0}
      onClick={onSelect}
      draggable={Boolean(dragIds)}
      onDragStart={
        dragIds
          ? (event: DragEvent<HTMLDivElement>) => {
              event.dataTransfer.setData(RENDER_DRAG_TYPE, JSON.stringify(dragIds))
              event.dataTransfer.effectAllowed = "move"
            }
          : undefined
      }
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
        {label ?? index + 1}
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

/** Кнопка «В папку» с выпадающим списком папок; закрывается по клику мимо и Escape. */
function MoveMenu({ targets, onPick, compact = false }: { targets: MoveTarget[]; onPick: (folderId: string | null) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("pointerdown", onPointerDown)
    window.addEventListener("keydown", onKeyDown)
    return () => {
      window.removeEventListener("pointerdown", onPointerDown)
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [open])
  return (
    <div ref={rootRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Перенести в папку"
        title="Перенести в папку"
        className={cn("btn-outline justify-center", compact ? "h-8 px-2.5 text-[12px]" : "h-10 px-3 text-[13px]")}
      >
        <FolderInput className="h-4 w-4" strokeWidth={1.7} />
        {compact ? null : "В папку"}
      </button>
      {open ? (
        <div role="menu" className="tray-move-menu popover popover-up" aria-label="Папки">
          {targets.map((target) => (
            <button
              key={target.id ?? "all"}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false)
                onPick(target.id)
              }}
              className="tray-move-item"
            >
              {target.title}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
