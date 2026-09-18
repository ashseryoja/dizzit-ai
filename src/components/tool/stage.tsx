"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { ChevronLeft, ChevronRight, LayoutGrid, X } from "lucide-react"

import { openLightbox, ZoomButton, ZoomHit } from "@/components/ui/lightbox"
import type { AttachedRender } from "@/lib/use-attachments"
import { cn, plural } from "@/lib/utils"

/** Большая поверхность сцены, пока её содержимое восстанавливается. */
export function StagePlaceholder({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("stage flex min-h-[320px] flex-1 flex-col items-center justify-center gap-2.5", className)}>
      {children}
    </div>
  )
}

/**
 * Сцена: выбранный рендер пачки во весь доступный экран. В углах — имя и
 * размер, счётчик «2 / 7», по бокам стрелки (стили .stage-* в surfaces.css).
 *
 * С overlay (холст точечной правки у редактора рендера) картинка ложится в
 * бокс РОВНО по кадру: его позиция и размер считаются по пропорции картинки
 * от размера сцены, чтобы холст накрывал именно кадр. Без overlay —
 * просто object-contain на всю сцену.
 *
 * Просмотр во весь экран: кнопка-уголок внизу слева есть всегда; без overlay
 * его открывает и клик по самой картинке (с overlay клик занят рисованием).
 */
export function Stage({
  attachment,
  index,
  count,
  onPrev,
  onNext,
  itemLabel = "рендер",
  className = "min-h-[320px] flex-1",
  overlay,
}: {
  attachment: AttachedRender
  index: number
  count: number
  onPrev: () => void
  onNext: () => void
  /** Для подписей стрелок: «Предыдущий рендер», «Следующий интерьер». */
  itemLabel?: string
  /** Размер сцены: во всю высоту (по умолчанию) или фиксированная пропорция. */
  className?: string
  overlay?: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const measured = overlay !== undefined

  // Размер сцены — чтобы посчитать бокс кадра по пропорции картинки.
  useEffect(() => {
    if (!measured) return
    const node = ref.current
    if (!node || typeof ResizeObserver === "undefined") return
    const sync = () =>
      setSize((prev) =>
        prev.width === node.clientWidth && prev.height === node.clientHeight
          ? prev
          : { width: node.clientWidth, height: node.clientHeight }
      )
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(node)
    return () => observer.disconnect()
  }, [measured])

  const openViewer = (origin: HTMLElement) => {
    // Кадр вырастает из картинки на сцене, а не из кнопки.
    const image = ref.current?.querySelector("img") ?? origin
    openLightbox(
      { src: attachment.previewUrl, alt: attachment.file.name, caption: attachment.file.name },
      { origin: image }
    )
  }

  const frameBox = (() => {
    if (!measured || size.width === 0 || size.height === 0) return null
    const scale = Math.min(size.width / attachment.width, size.height / attachment.height)
    const width = Math.floor(attachment.width * scale)
    const height = Math.floor(attachment.height * scale)
    return { width, height, left: Math.floor((size.width - width) / 2), top: Math.floor((size.height - height) / 2) }
  })()

  return (
    <div ref={ref} className={cn("stage zoom-host", className)}>
      {measured ? (
        frameBox ? (
          <div className="stage-frame" style={frameBox}>
            {/* Превью — object URL локального файла, next/image ни к чему. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={attachment.previewUrl} alt={attachment.file.name} draggable={false} />
            {overlay}
          </div>
        ) : null
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={attachment.previewUrl}
          alt={attachment.file.name}
          draggable={false}
          className="absolute inset-0 h-full w-full select-none object-contain"
        />
      )}
      {measured ? null : <ZoomHit onOpen={openViewer} />}

      <span className="stage-badge left-3 top-3">
        <span className="truncate">{attachment.file.name}</span>
        <span style={{ color: "rgba(255,255,255,0.55)" }}>
          {attachment.width}×{attachment.height}
        </span>
      </span>
      {count > 1 ? (
        <span className="stage-badge right-3 top-3 tabular-nums">
          {index + 1} / {count}
        </span>
      ) : null}

      <ZoomButton onOpen={openViewer} className="stage-zoom" />

      {count > 1 ? (
        <>
          <button
            type="button"
            onClick={onPrev}
            disabled={index === 0}
            aria-label={`Предыдущий ${itemLabel}`}
            className="stage-nav left-3"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={onNext}
            disabled={index === count - 1}
            aria-label={`Следующий ${itemLabel}`}
            className="stage-nav right-3"
          >
            <ChevronRight className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </>
      ) : null}
    </div>
  )
}

/**
 * Пакетный режим: вместо сцены — грид рабочего набора с заголовком и
 * кнопкой «К просмотру». Править по одному здесь нельзя намеренно
 * (.batch-tile), клик по плитке только открывает просмотр во весь экран.
 * compact — для узкой колонки переноса стиля.
 */
export function BatchGrid({
  items,
  title,
  noun,
  onLeave,
  compact = false,
}: {
  items: AttachedRender[]
  /** «Пакетное редактирование», «Пакетный перенос», «Пакетная раскадровка». */
  title: string
  noun: [string, string, string]
  onLeave: () => void
  compact?: boolean
}) {
  return (
    <div className={cn("flex min-h-0 flex-col", compact ? "gap-2" : "flex-1 gap-4")}>
      <div className={cn("flex items-center justify-between gap-3 px-1", compact && "h-8")}>
        <span className="flex min-w-0 items-center gap-2.5 whitespace-nowrap">
          <LayoutGrid className="h-4 w-4 shrink-0" strokeWidth={1.7} style={{ color: "var(--fg-4)" }} />
          <span className={cn("truncate", compact ? "text-[13px]" : "ds-body")} style={{ color: "var(--fg-1)" }}>
            {title}
          </span>
          <span className="text-[13px] tabular-nums" style={{ color: "var(--fg-4)" }}>
            {items.length} {plural(items.length, noun)}
          </span>
        </span>
        <button
          type="button"
          onClick={onLeave}
          className={cn("btn-ghost shrink-0 gap-2 whitespace-nowrap", compact ? "h-8 px-2.5 text-[12.5px]" : "h-9 px-3 text-[13px]")}
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.8} />
          К просмотру
        </button>
      </div>
      <div className={cn("grid grid-cols-2", compact ? "gap-2 md:grid-cols-3" : "gap-3 xl:grid-cols-3")}>
        {items.map((item, index) => (
          <div key={item.previewUrl} className="batch-tile card-media">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.previewUrl} alt={item.file.name} draggable={false} />
            {/* Править по одному здесь нельзя, а рассмотреть — можно: набор листается стрелками. */}
            <ZoomHit
              onOpen={(origin) =>
                openLightbox(
                  items.map((entry) => ({ src: entry.previewUrl, alt: entry.file.name, caption: entry.file.name })),
                  { index, origin }
                )
              }
            />
            <span className={cn("stage-badge", compact ? "left-2 top-2" : "left-2.5 top-2.5")}>
              <span className="truncate">{item.file.name}</span>
              {compact ? null : (
                <span style={{ color: "rgba(255,255,255,0.55)" }}>
                  {item.width}×{item.height}
                </span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
