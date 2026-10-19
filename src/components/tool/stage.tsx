"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import { ChevronLeft, ChevronRight, Download, LayoutGrid, SplitSquareHorizontal, X } from "lucide-react"

import { CompareSlider } from "@/components/tool/compare-slider"
import { openLightbox, ZoomButton, ZoomHit } from "@/components/ui/lightbox"
import type { AttachedRender } from "@/lib/use-attachments"
import { useSwipe } from "@/lib/use-swipe"
import { cn, plural } from "@/lib/utils"

/** Большая поверхность сцены, пока её содержимое восстанавливается. */
export function StagePlaceholder({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("stage flex min-h-[320px] flex-1 flex-col items-center justify-center gap-2.5", className)}>
      {children}
    </div>
  )
}

/** Поля вокруг кадра и полоса над ним — под бейджи и панель областей. */
const STAGE_PAD = 12
const STAGE_BAND = 52
/** Уже этого панель областей не помещается рядом с бейджами — остаётся на кадре. */
const STAGE_WIDE = 640
/** Ниже lg сцена не тянется на весь экран, а берёт высоту по пропорции кадра. */
const STAGE_FIT_BELOW = 1024

/**
 * Сцена: выбранный рендер пачки во весь доступный экран. В углах — имя и
 * размер, счётчик «2 / 7», по бокам стрелки (стили .stage-* в surfaces.css).
 *
 * Кадр лежит в боксе РОВНО по пропорции картинки, со скруглёнными углами и
 * полями; поля заполняет сильно размытая затемнённая копия того же кадра, так
 * что вертикальный рендер не стоит в пустой серой коробке. Над кадром — полоса
 * под бейджи и панель областей (`overlay`): инструменты не закрывают рендер.
 * На узких экранах высота сцены считается по пропорции кадра.
 *
 * `compare` — исходник того же кадра: появляется кнопка «До / после» со шторкой
 * (`CompareSlider`); удержание клавиши «\» показывает исходник целиком.
 * `reveal` — разовое проявление только что готового результата той же шторкой.
 * `onDownload` — кнопка «Скачать» в правом нижнем углу сцены.
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
  compare,
  reveal = false,
  onRevealEnd,
  onDownload,
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
  /** Исходник кадра на сцене: включает шторку «до / после». */
  compare?: { before: string }
  /** Проявить результат шторкой один раз (только что закончилась обработка). */
  reveal?: boolean
  onRevealEnd?: () => void
  /** Скачать то, что на сцене (готовый результат): кнопка в правом нижнем углу. */
  onDownload?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0, viewport: 0, viewportHeight: 0 })
  const [comparing, setComparing] = useState(false)
  const [peeking, setPeeking] = useState(false)

  // Размер сцены — чтобы посчитать бокс кадра по пропорции картинки. Окно
  // меряется по <html> (clientWidth/Height): это раскладочный вьюпорт без
  // полосы прокрутки, и он честен при эмуляции телефона, где innerWidth врёт.
  useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === "undefined") return
    const sync = () => {
      const root = document.documentElement
      setSize((prev) =>
        prev.width === node.clientWidth &&
        prev.height === node.clientHeight &&
        prev.viewport === root.clientWidth &&
        prev.viewportHeight === root.clientHeight
          ? prev
          : { width: node.clientWidth, height: node.clientHeight, viewport: root.clientWidth, viewportHeight: root.clientHeight }
      )
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(node)
    window.addEventListener("resize", sync)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", sync)
    }
  }, [])

  // Другой кадр — шторка закрывается: сравнение относится к одному рендеру.
  const compareUrl = compare?.before ?? null
  useEffect(() => {
    setComparing(false)
    setPeeking(false)
  }, [compareUrl, attachment.previewUrl])

  // «\» удерживается — на сцене исходник целиком (как в графических редакторах).
  useEffect(() => {
    if (!compareUrl) return
    const typing = (target: EventTarget | null) =>
      target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Backslash" || event.repeat || typing(event.target)) return
      event.preventDefault()
      setPeeking(true)
    }
    const up = (event: KeyboardEvent) => {
      if (event.code === "Backslash") setPeeking(false)
    }
    const blur = () => setPeeking(false)
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    window.addEventListener("blur", blur)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
      window.removeEventListener("blur", blur)
    }
  }, [compareUrl])

  // Палец по сцене листает пачку, как стрелки. Холст областей (кисть активна),
  // шторка «до / после» и кнопки ведут своё касание — с них жест не начинается.
  useSwipe(ref, {
    onLeft: onNext,
    onRight: onPrev,
    ignore: "button, input, textarea, canvas, .cmp, .rg-popover",
    enabled: count > 1,
  })

  const openViewer = (origin: HTMLElement) => {
    // Кадр вырастает из картинки на сцене, а не из кнопки.
    const image = ref.current?.querySelector<HTMLElement>(".stage-frame img") ?? origin
    openLightbox(
      {
        src: attachment.previewUrl,
        alt: attachment.file.name,
        caption: attachment.file.name,
        compare: compareUrl ? { src: compareUrl } : undefined,
      },
      { origin: image }
    )
  }

  const ratio = attachment.width / Math.max(1, attachment.height)
  const wide = size.width >= STAGE_WIDE
  const band = overlay !== undefined && wide ? STAGE_BAND : overlay !== undefined ? STAGE_BAND - 8 : STAGE_PAD
  // Узкий экран: сцена ровно под кадр, но не выше двух третей окна.
  const fitHeight =
    size.width > 0 && size.viewport > 0 && size.viewport < STAGE_FIT_BELOW
      ? Math.round(
          Math.min((size.width - STAGE_PAD * 2) / ratio + band + STAGE_PAD, Math.max(260, size.viewportHeight * 0.66))
        )
      : null

  const frameBox = (() => {
    if (size.width === 0 || size.height === 0) return null
    const availWidth = Math.max(1, size.width - STAGE_PAD * 2)
    const availHeight = Math.max(1, size.height - band - STAGE_PAD)
    const scale = Math.min(availWidth / attachment.width, availHeight / attachment.height)
    const width = Math.floor(attachment.width * scale)
    const height = Math.floor(attachment.height * scale)
    return {
      width,
      height,
      left: Math.floor((size.width - width) / 2),
      top: band + Math.floor((availHeight - height) / 2),
    }
  })()

  const showCompare = Boolean(compareUrl) && (comparing || reveal)

  return (
    <div
      ref={ref}
      className={cn("stage zoom-host", className)}
      style={fitHeight ? { height: fitHeight, flex: "none", minHeight: 0, aspectRatio: "auto" } : undefined}
    >
      {/* Свечение кадра за сценой и размытая копия в полях — одна и та же картинка. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={attachment.previewUrl} alt="" aria-hidden draggable={false} className="stage-glow" />
      <div className="stage-clip">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={attachment.previewUrl} alt="" aria-hidden draggable={false} className="stage-backdrop" />
        {frameBox ? (
          <div
            className="stage-frame"
            style={{ ...frameBox, ["--rg-lift" as string]: overlay !== undefined && wide ? `${STAGE_BAND}px` : "0px" }}
          >
            {/* Превью — object URL локального файла, next/image ни к чему. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={peeking && compareUrl ? compareUrl : attachment.previewUrl} alt={attachment.file.name} draggable={false} />
            {overlay === undefined ? <ZoomHit onOpen={openViewer} /> : null}
            {overlay}
            {showCompare && compareUrl ? (
              <CompareSlider
                key={reveal ? "reveal" : "compare"}
                before={compareUrl}
                alt={attachment.file.name}
                beforeLabel="исходник"
                afterLabel="результат"
                intro={reveal}
                onIntroEnd={onRevealEnd}
              />
            ) : null}
          </div>
        ) : null}

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
        {compareUrl && !reveal ? (
          <button
            type="button"
            onClick={() => setComparing((value) => !value)}
            aria-pressed={comparing}
            title={"Сравнить с исходником · удерживайте «\\», чтобы увидеть исходник целиком"}
            className={cn("stage-action stage-compare", comparing && "is-active")}
          >
            <SplitSquareHorizontal className="h-3.5 w-3.5" strokeWidth={1.8} />
            {peeking ? "Исходник" : "До / после"}
          </button>
        ) : null}

        {onDownload ? (
          <button type="button" onClick={onDownload} className="stage-action stage-download">
            <Download className="h-3.5 w-3.5" strokeWidth={1.8} />
            Скачать
          </button>
        ) : null}

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
