"use client"

import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react"
import { Pencil, Plus, Trash2 } from "lucide-react"

import { RENDER_DRAG_TYPE } from "@/components/tool/render-tray"
import { cn } from "@/lib/utils"
import type { RenderFolder } from "@/types"

export interface FolderRailProps {
  folders: RenderFolder[]
  /** Активная папка; null — «Общая», в которой видно всё. */
  activeId: string | null
  onSelect: (id: string | null) => void
  /** Создать папку; вернуть её, чтобы сразу открыть переименование. */
  onCreate: () => RenderFolder | null
  onRename: (id: string, title: string) => void
  onDelete: (id: string) => void
  /** Плитку пачки бросили на вкладку: перенести записи в папку (null — в «Общую», без папки). */
  onDropRenders?: (ids: string[], folderId: string | null) => void
  /** Подпись вкладки «всё»: по умолчанию «Общая». */
  allLabel?: string
  /** Вертикальные вкладки слева от панели (по умолчанию) или строка чипов над полоской. */
  orientation?: "vertical" | "horizontal"
}

/**
 * Папки рендеров — вкладки у правой панели, как закладки у блокнота.
 * Первая, «Общая», показывает все записи проекта; ниже — папки пользователя
 * («Комната 1», «Кухня»), последняя — «+» для новой. При наведении на папку
 * появляется карандаш: имя правится в маленьком окошке, там же — удаление.
 * Записи удалённой папки остаются в проекте и видны в «Общей».
 */
export function FolderRail({
  folders,
  activeId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onDropRenders,
  allLabel = "Общая",
  orientation = "vertical",
}: FolderRailProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [dropId, setDropId] = useState<string | null | undefined>(undefined)
  const horizontal = orientation === "horizontal"

  /* Перетаскивание плиток пачки (RenderTray): вкладка подсвечивается, пока над
     ней держат рендер, и принимает список id из dataTransfer. */
  const dropProps = (folderId: string | null) =>
    onDropRenders
      ? {
          onDragOver: (event: DragEvent<HTMLButtonElement>) => {
            if (!event.dataTransfer.types.includes(RENDER_DRAG_TYPE)) return
            event.preventDefault()
            event.dataTransfer.dropEffect = "move"
            if (dropId !== folderId) setDropId(folderId)
          },
          onDragLeave: () => setDropId(undefined),
          onDrop: (event: DragEvent<HTMLButtonElement>) => {
            setDropId(undefined)
            const raw = event.dataTransfer.getData(RENDER_DRAG_TYPE)
            if (!raw) return
            event.preventDefault()
            try {
              const ids = JSON.parse(raw) as unknown
              if (Array.isArray(ids) && ids.every((id) => typeof id === "string")) onDropRenders(ids, folderId)
            } catch {
              // Чужие данные переноса — не наш формат, игнорируем.
            }
          },
        }
      : {}

  const create = () => {
    const folder = onCreate()
    if (!folder) return
    onSelect(folder.id)
    setEditingId(folder.id)
  }

  return (
    <div
      className={cn("folder-rail", horizontal && "is-horizontal")}
      role="tablist"
      aria-orientation={horizontal ? "horizontal" : "vertical"}
      aria-label="Папки рендеров"
    >
      <div className="folder-tab-wrap">
        <button
          type="button"
          role="tab"
          aria-selected={activeId === null}
          onClick={() => onSelect(null)}
          className={cn("folder-tab", activeId === null && "is-active", dropId === null && "is-drop")}
          {...dropProps(null)}
        >
          <span className="folder-tab-label">{allLabel}</span>
        </button>
      </div>

      {folders.map((folder) => {
        const active = folder.id === activeId
        return (
          <div key={folder.id} className="folder-tab-wrap">
            <button
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(folder.id)}
              className={cn("folder-tab", active && "is-active", dropId === folder.id && "is-drop")}
              title={folder.title}
              {...dropProps(folder.id)}
            >
              <span className="folder-tab-label">{folder.title}</span>
            </button>
            <button
              type="button"
              onClick={() => setEditingId(folder.id)}
              aria-label={`Переименовать папку «${folder.title}»`}
              className="folder-tab-edit"
            >
              <Pencil className="h-3 w-3" strokeWidth={1.8} />
            </button>
            {editingId === folder.id ? (
              <FolderEditor
                folder={folder}
                onSubmit={(title) => {
                  onRename(folder.id, title)
                  setEditingId(null)
                }}
                onDelete={() => {
                  setEditingId(null)
                  onDelete(folder.id)
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : null}
          </div>
        )
      })}

      <div className="folder-tab-wrap">
        <button type="button" onClick={create} aria-label="Новая папка" className="folder-tab folder-tab-add">
          <Plus className="h-3.5 w-3.5" strokeWidth={1.7} />
        </button>
      </div>
    </div>
  )
}

/** Окошко имени папки: Enter или клик мимо — сохранить, Escape — отменить. */
function FolderEditor({
  folder,
  onSubmit,
  onDelete,
  onCancel,
}: {
  folder: RenderFolder
  onSubmit: (title: string) => void
  onDelete: () => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(folder.title)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const submitRef = useRef(onSubmit)
  submitRef.current = onSubmit

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // Клик мимо окошка сохраняет имя — как переименование файла в Finder.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return
      submitRef.current(inputRef.current?.value ?? "")
    }
    window.addEventListener("pointerdown", onPointerDown)
    return () => window.removeEventListener("pointerdown", onPointerDown)
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") onSubmit(title)
    if (event.key === "Escape") onCancel()
  }

  return (
    <div ref={rootRef} className="folder-editor popover" role="dialog" aria-label="Имя папки">
      <input
        ref={inputRef}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={onKeyDown}
        maxLength={40}
        aria-label="Имя папки"
        className="folder-editor-input"
      />
      <button
        type="button"
        onClick={() => {
          if (window.confirm(`Удалить папку «${folder.title}»? Рендеры останутся в проекте и будут видны в «Общей».`)) onDelete()
        }}
        aria-label="Удалить папку"
        className="folder-editor-delete"
      >
        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
      </button>
    </div>
  )
}
