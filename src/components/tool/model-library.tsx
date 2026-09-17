"use client"

import { Frown, ImageOff, Trash2 } from "lucide-react"

import { ThinkingGlyph } from "@/components/glyphs"
import { sourceKey, thumbResultKey, thumbSourceKey } from "@/lib/blob-store"
import type { ModelTaskProgress } from "@/lib/model-engine"
import { useStoredBlobUrl } from "@/lib/use-stored-blob"
import { cn, fileBaseName } from "@/lib/utils"
import type { Model3D } from "@/types"

interface ModelLibraryProps {
  models: Model3D[]
  selectedId: string | null
  progress: Record<string, ModelTaskProgress>
  onSelect: (id: string) => void
  onDelete: (model: Model3D) => void
}

/**
 * Библиотека моделей проекта — содержимое правой панели (`ToolAside`), как
 * сетка «My generation» у Meshy: превью готовой модели (рендер провайдера,
 * пока его нет — фото-исходник), статус задачи прямо на плитке, дата и
 * удаление по наведению. Клик выводит модель на сцену.
 */
export function ModelLibrary({ models, selectedId, progress, onSelect, onDelete }: ModelLibraryProps) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-16 shrink-0 items-baseline gap-2 pl-5 pr-3 pt-6">
        <span className="ds-micro">модели</span>
        <span className="text-[12px] tabular-nums" style={{ color: "var(--fg-4)" }}>
          {models.length}
        </span>
      </div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <div className="grid grid-cols-2 gap-2" role="listbox" aria-label="Модели проекта">
          {models.map((model) => (
            <ModelTile
              key={model.id}
              model={model}
              active={model.id === selectedId}
              progress={progress[model.id]}
              onSelect={() => onSelect(model.id)}
              onDelete={() => onDelete(model)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/** Та же библиотека полоской под сценой — на экранах, где правой панели нет. */
export function ModelLibraryStrip({ models, selectedId, progress, onSelect, onDelete }: ModelLibraryProps) {
  return (
    <div className="no-scrollbar flex gap-2 overflow-x-auto py-1 lg:hidden" role="listbox" aria-label="Модели проекта">
      {models.map((model) => (
        <div key={model.id} className="w-[96px] shrink-0">
          <ModelTile
            model={model}
            active={model.id === selectedId}
            progress={progress[model.id]}
            onSelect={() => onSelect(model.id)}
            onDelete={() => onDelete(model)}
          />
        </div>
      ))}
    </div>
  )
}

function ModelTile({
  model,
  active,
  progress,
  onSelect,
  onDelete,
}: {
  model: Model3D
  active: boolean
  progress?: ModelTaskProgress
  onSelect: () => void
  onDelete: () => void
}) {
  const done = model.status === "done"
  // Превью модели появляется после готовности; до этого и у заглушек — фото.
  const asset = useStoredBlobUrl(done ? [thumbResultKey(model.id), thumbSourceKey(model.id), sourceKey(model.id)] : [thumbSourceKey(model.id), sourceKey(model.id)])
  const name = model.note || fileBaseName(model.sourceName, "модель")
  const date = new Date(model.createdAt).toLocaleDateString("ru-RU")

  return (
    <div className="group/tile relative">
      <button
        type="button"
        role="option"
        aria-selected={active}
        onClick={onSelect}
        title={`${name} · ${date}`}
        className={cn("tray-thumb model-tile block aspect-square w-full", active && "is-active", !done && "is-pending")}
      >
        {asset.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.url} alt={name} className="h-full w-full object-cover" draggable={false} onError={asset.reportImageError} />
        ) : (
          <span className="flex h-full w-full items-center justify-center" style={{ color: "var(--fg-4)" }}>
            {asset.status === "loading" ? <ThinkingGlyph size={15} /> : <ImageOff className="h-4 w-4" strokeWidth={1.6} />}
          </span>
        )}

        {model.status === "processing" ? (
          <span className="model-tile-state">
            <ThinkingGlyph size={16} />
            <span>{progress && progress.progress > 0 ? `${progress.progress}%` : "строим…"}</span>
          </span>
        ) : null}
        {model.status === "error" ? (
          <span className="model-tile-state is-error">
            <Frown className="h-4 w-4" strokeWidth={1.7} />
            <span>ошибка</span>
          </span>
        ) : null}

        <span className="model-tile-date">{date}</span>
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Удалить модель «${name}»`}
        className="model-tile-remove opacity-0 transition-opacity focus-visible:opacity-100 group-hover/tile:opacity-100"
      >
        <Trash2 className="h-3 w-3" strokeWidth={1.8} />
      </button>
    </div>
  )
}
