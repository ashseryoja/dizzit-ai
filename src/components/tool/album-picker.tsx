"use client"

import { Check } from "lucide-react"

import { useStoredBlobUrl } from "@/lib/use-stored-blob"
import { cn } from "@/lib/utils"

/** Запись инструмента, которую можно включить в альбом: подпись и ключи миниатюры (слева направо). */
export interface AlbumPickItem {
  id: string
  label: string
  hint?: string
  keys: (string | null | undefined)[]
}

/**
 * Выбор состава альбома: сетка миниатюр готовых записей инструмента.
 * В обычном режиме плитки — галочки, и на выбранной стоит её номер в
 * альбоме (порядок в PDF — порядок сетки); «выбрать все / снять все» — разом.
 * В режиме `single` выбирается одна плитка (обложка), а с `noneLabel` первой
 * идёт плитка «без картинки». Миниатюры едут из общего хранилища
 * (`useStoredBlobUrl`), как у карточек.
 */
export function AlbumPicker({
  title,
  hint,
  items,
  selected,
  onToggle,
  onSelectAll,
  emptyText,
  aspect = "wide",
  single = false,
  noneLabel,
}: {
  title: string
  /** Подсказка под заголовком: что делает выбор. */
  hint?: string
  items: AlbumPickItem[]
  selected: readonly string[]
  /** Обычный режим — включить/выключить; `single` — выбрать (пустая строка — «без картинки»). */
  onToggle: (id: string) => void
  onSelectAll?: (ids: string[]) => void
  emptyText: string
  /** Пропорция плитки: широкая для рендеров, квадрат для материалов. */
  aspect?: "wide" | "square"
  single?: boolean
  noneLabel?: string
}) {
  const count = items.filter((item) => selected.includes(item.id)).length
  const all = count === items.length && items.length > 0
  const order = new Map(items.filter((item) => selected.includes(item.id)).map((item, index) => [item.id, index + 1] as const))
  return (
    <section className="album-pick">
      <div className="album-pick-head">
        <div className="min-w-0">
          <span className="album-pick-title">{title}</span>
          {hint ? <span className="ds-caption block mt-0.5">{hint}</span> : null}
        </div>
        {!single && items.length > 0 ? (
          <span className="flex shrink-0 items-center gap-3">
            <span className={cn("chip", count > 0 && "is-on")}>
              {count} из {items.length}
            </span>
            {onSelectAll ? (
              <button type="button" className="album-pick-link" onClick={() => onSelectAll(all ? [] : items.map((item) => item.id))}>
                {all ? "снять все" : "выбрать все"}
              </button>
            ) : null}
          </span>
        ) : null}
      </div>
      {items.length === 0 ? (
        <p className="ds-caption">{emptyText}</p>
      ) : (
        <div className={cn("album-pick-grid", aspect === "square" && "is-square")} role={single ? "radiogroup" : "group"} aria-label={title}>
          {single && noneLabel ? (
            <button
              type="button"
              role="radio"
              aria-checked={selected.length === 0}
              className={cn("album-pick-tile is-none", selected.length === 0 && "is-selected")}
              onClick={() => onToggle("")}
            >
              <span className="album-pick-badge" aria-hidden>
                <Check className="h-3 w-3" strokeWidth={2.4} />
              </span>
              <span className="album-pick-none">{noneLabel}</span>
            </button>
          ) : null}
          {items.map((item) => (
            <AlbumPickTile key={item.id} item={item} selected={selected.includes(item.id)} order={single ? null : (order.get(item.id) ?? null)} single={single} onToggle={() => onToggle(item.id)} />
          ))}
        </div>
      )}
    </section>
  )
}

function AlbumPickTile({ item, selected, order, single, onToggle }: { item: AlbumPickItem; selected: boolean; order: number | null; single: boolean; onToggle: () => void }) {
  const { url } = useStoredBlobUrl(item.keys)
  return (
    <button
      type="button"
      role={single ? "radio" : "checkbox"}
      aria-checked={selected}
      aria-label={item.label}
      title={item.hint ? `${item.label} — ${item.hint}` : item.label}
      onClick={onToggle}
      className={cn("album-pick-tile", selected && "is-selected")}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {url ? <img src={url} alt="" draggable={false} /> : null}
      <span className="album-pick-badge" aria-hidden>
        {order !== null && selected ? order : <Check className="h-3 w-3" strokeWidth={2.4} />}
      </span>
      <span className="album-pick-label">{item.label}</span>
    </button>
  )
}
