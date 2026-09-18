"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { ChevronLeft, ChevronRight, Download, Maximize2, X, ZoomIn, ZoomOut } from "lucide-react"

import { ThinkingGlyph } from "@/components/glyphs"
import { usePresence } from "@/lib/use-presence"
import { useStoredBlobUrl } from "@/lib/use-stored-blob"
import { cn } from "@/lib/utils"

/**
 * Просмотр картинки во весь экран — один на всё приложение. Любая картинка
 * интерфейса открывается одинаково: затемнение, кадр вырастает из своей
 * миниатюры, стрелки листают соседей, клик по кадру приближает, Esc закрывает.
 *
 * Состояние живёт в модуле, а не в контексте: открыть просмотр можно из любого
 * компонента обычным вызовом `openLightbox(...)`, без провайдера и пропсов.
 * Слой рисует `LightboxHost` — он один, в раскладке `(main)/layout.tsx`.
 */

export interface LightboxItem {
  /** Готовый адрес картинки: object URL приложенного файла или статика. */
  src?: string
  /**
   * Ключи хранилища блобов по убыванию качества (полный файл, затем миниатюра):
   * карточки показывают миниатюры, а смотреть в большом формате нужно оригинал.
   */
  keys?: string[]
  /** То, что уже видно на странице (обычно миниатюра): показывается сразу, пока едет полный файл. */
  preview?: string | null
  alt?: string
  /** Подпись в шапке: имя файла, «результат», название кадра. */
  caption?: string
  /** Имя файла без расширения — включает кнопку «Скачать». */
  downloadName?: string
}

interface LightboxState {
  items: LightboxItem[]
  index: number
  /** Откуда кадр «вырастает» — прямоугольник нажатой миниатюры. */
  origin: DOMRect | null
}

let current: LightboxState | null = null
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const notify = () => listeners.forEach((listener) => listener())

/** Открыть просмотр: одна картинка или галерея с начальным индексом. */
export function openLightbox(
  items: LightboxItem | LightboxItem[],
  options: { index?: number; origin?: Element | null } = {}
): void {
  const all = Array.isArray(items) ? items : [items]
  const wanted = all[options.index ?? 0]
  const list = all.filter((item) => item.src || item.preview || (item.keys && item.keys.length > 0))
  if (list.length === 0) return
  current = {
    items: list,
    index: Math.max(0, list.indexOf(wanted)),
    origin: options.origin?.getBoundingClientRect() ?? null,
  }
  notify()
}

function closeLightbox(): void {
  if (!current) return
  current = null
  notify()
}

function motionReduced(): boolean {
  return (
    document.documentElement.dataset.motion === "reduce" ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

/** Слой просмотра. Монтируется один раз; без открытой картинки ничего не рисует. */
export function LightboxHost() {
  const state = useSyncExternalStore(subscribe, () => current, () => null)
  const presence = usePresence(state !== null, 220)
  // Пока играет выход, показываем то, что было открыто.
  const lastRef = useRef<LightboxState | null>(null)
  if (state) lastRef.current = state
  const shown = state ?? lastRef.current

  if (!presence.present || !shown || typeof document === "undefined") return null
  return createPortal(<LightboxLayer key={shownKey(shown)} session={shown} state={presence.state} />, document.body)
}

/** Новое открытие — новый слой: индекс, зум и анимация входа начинаются заново. */
const sessionIds = new WeakMap<LightboxState, number>()
let sessionCounter = 0
function shownKey(session: LightboxState): number {
  let id = sessionIds.get(session)
  if (id === undefined) {
    id = sessionCounter += 1
    sessionIds.set(session, id)
  }
  return id
}

function LightboxLayer({ session, state }: { session: LightboxState; state: "open" | "closed" }) {
  const { items } = session
  const [index, setIndex] = useState(session.index)
  const [direction, setDirection] = useState<"next" | "prev" | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const item = items[Math.min(index, items.length - 1)]
  const many = items.length > 1

  const go = useCallback(
    (step: 1 | -1) => {
      setDirection(step === 1 ? "next" : "prev")
      setIndex((value) => (value + step + items.length) % items.length)
    },
    [items.length]
  )

  // Фокус — в слой, после закрытия — туда, где был; страница под слоем не прокручивается.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus({ preventScroll: true })
    const overflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = overflow
      previous?.focus?.({ preventScroll: true })
    }
  }, [])

  // Кадр при листании монтируется заново вместе с шапкой — фокус возвращаем в слой.
  useEffect(() => {
    if (!rootRef.current?.contains(document.activeElement)) closeRef.current?.focus({ preventScroll: true })
  }, [index])

  // Клавиши — на перехвате: стрелки и Escape не должны листать сцену под слоем.
  useEffect(() => {
    if (state !== "open") return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopImmediatePropagation()
        closeLightbox()
        return
      }
      if (many && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault()
        event.stopImmediatePropagation()
        go(event.key === "ArrowRight" ? 1 : -1)
        return
      }
      if (event.key === "Tab") {
        // Фокус не уходит под слой: кнопки слоя ходят по кругу.
        const focusable = Array.from(rootRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled)") ?? [])
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        const active = document.activeElement
        if (event.shiftKey && (active === first || !rootRef.current?.contains(active))) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && (active === last || !rootRef.current?.contains(active))) {
          event.preventDefault()
          first.focus()
        }
        return
      }
      // Остальные клавиши (стрелки сцены, скобки кисти) до страницы не доходят.
      event.stopImmediatePropagation()
    }
    window.addEventListener("keydown", onKeyDown, true)
    return () => window.removeEventListener("keydown", onKeyDown, true)
  }, [go, many, state])

  return (
    <div
      ref={rootRef}
      className="lb"
      data-state={state}
      role="dialog"
      aria-modal="true"
      aria-label={item.caption ? `Просмотр: ${item.caption}` : "Просмотр изображения"}
    >
      <div className="lb-backdrop" onClick={closeLightbox} aria-hidden />

      <LightboxFrame
        key={index}
        item={item}
        origin={direction === null ? session.origin : null}
        direction={direction}
        counter={many ? `${index + 1} / ${items.length}` : null}
        closeRef={closeRef}
      />

      {many ? (
        <>
          <button type="button" className="lb-nav is-prev" onClick={() => go(-1)} aria-label="Предыдущее изображение">
            <ChevronLeft className="h-5 w-5" strokeWidth={1.8} />
          </button>
          <button type="button" className="lb-nav is-next" onClick={() => go(1)} aria-label="Следующее изображение">
            <ChevronRight className="h-5 w-5" strokeWidth={1.8} />
          </button>
        </>
      ) : null}
    </div>
  )
}

/** Один кадр просмотра: шапка с подписью и действиями, картинка, зум и панорама. */
function LightboxFrame({
  item,
  origin,
  direction,
  counter,
  closeRef,
}: {
  item: LightboxItem
  origin: DOMRect | null
  direction: "next" | "prev" | null
  counter: string | null
  closeRef: React.RefObject<HTMLButtonElement | null>
}) {
  const stored = useStoredBlobUrl(item.src ? [] : (item.keys ?? []))
  const full = item.src ?? stored.url
  const url = full ?? item.preview ?? null
  const loading = !full && !item.src && stored.status === "loading"
  const failed = !url && !loading

  const viewportRef = useRef<HTMLDivElement>(null)
  const imageRef = useRef<HTMLImageElement>(null)
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null)
  const [zoom, setZoom] = useState<{ width: number; x: number; y: number } | null>(null)
  const grown = useRef(false)

  const onLoad = () => {
    const image = imageRef.current
    if (!image) return
    if (full) setNatural({ width: image.naturalWidth, height: image.naturalHeight })
    // Кадр вырастает из нажатой миниатюры — один раз, на первой показанной картинке.
    if (grown.current || !origin || motionReduced()) return
    grown.current = true
    const rect = image.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return
    const scale = Math.max(origin.width / rect.width, origin.height / rect.height)
    const dx = origin.left + origin.width / 2 - (rect.left + rect.width / 2)
    const dy = origin.top + origin.height / 2 - (rect.top + rect.height / 2)
    image.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${scale})`, opacity: 0.35 },
        { transform: "none", opacity: 1 },
      ],
      { duration: 440, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
    )
  }

  // Приближать есть смысл, только если оригинал заметно больше того, что на экране.
  const zoomWidth = (() => {
    const image = imageRef.current
    if (!natural || !image || zoom) return null
    const fit = image.clientWidth
    if (fit === 0) return null
    const target = Math.min(natural.width * 2, Math.max(natural.width, fit * 2))
    return target > fit * 1.2 ? target : null
  })()
  const zoomable = zoomWidth !== null

  // После приближения точка под курсором остаётся под курсором.
  useLayoutEffect(() => {
    const viewport = viewportRef.current
    const image = imageRef.current
    if (!zoom || !viewport || !image) return
    viewport.scrollLeft = zoom.x * image.offsetWidth - viewport.clientWidth / 2
    viewport.scrollTop = zoom.y * image.offsetHeight - viewport.clientHeight / 2
  }, [zoom])

  const toggleZoom = (event?: React.MouseEvent) => {
    if (zoom) {
      setZoom(null)
      return
    }
    const image = imageRef.current
    if (!zoomWidth || !image) return
    const rect = image.getBoundingClientRect()
    setZoom({
      width: zoomWidth,
      x: event ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : 0.5,
      y: event ? Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) : 0.5,
    })
  }

  // Приближенный кадр таскается мышью; клик без сдвига — отдалить.
  const drag = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null)
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current
    if (!zoom || !viewport || event.button !== 0) return
    drag.current = { x: event.clientX, y: event.clientY, left: viewport.scrollLeft, top: viewport.scrollTop, moved: false }
    viewport.setPointerCapture(event.pointerId)
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const viewport = viewportRef.current
    const start = drag.current
    if (!start || !viewport) return
    const dx = event.clientX - start.x
    const dy = event.clientY - start.y
    if (Math.abs(dx) + Math.abs(dy) > 4) start.moved = true
    viewport.scrollLeft = start.left - dx
    viewport.scrollTop = start.top - dy
  }
  const onPointerUp = () => {
    // Сброс — после click, которому нужен флаг сдвига.
    window.setTimeout(() => (drag.current = null), 0)
  }

  // Расширение — по типу самого файла: у object URL его нет в адресе.
  const download = async () => {
    if (!full || !item.downloadName) return
    const blob = await fetch(full).then((response) => response.blob())
    const href = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = href
    link.download = `${item.downloadName}.${blob.type === "image/png" ? "png" : blob.type === "image/webp" ? "webp" : "jpg"}`
    link.click()
    URL.revokeObjectURL(href)
  }

  return (
    <>
      <header className="lb-bar">
        <span className="lb-caption">
          {item.caption ? <span className="lb-title">{item.caption}</span> : null}
          {natural ? (
            <span className="lb-meta">
              {natural.width}×{natural.height}
            </span>
          ) : null}
        </span>
        <span className="lb-actions">
          {counter ? <span className="lb-counter">{counter}</span> : null}
          {zoomable || zoom ? (
            <button
              type="button"
              className="lb-action"
              onClick={() => toggleZoom()}
              aria-label={zoom ? "Вписать в экран" : "Приблизить"}
              title={zoom ? "Вписать в экран" : "Приблизить"}
            >
              {zoom ? <ZoomOut className="h-4 w-4" strokeWidth={1.8} /> : <ZoomIn className="h-4 w-4" strokeWidth={1.8} />}
            </button>
          ) : null}
          {full && item.downloadName ? (
            <button type="button" className="lb-action" onClick={() => void download()} aria-label="Скачать" title="Скачать">
              <Download className="h-4 w-4" strokeWidth={1.8} />
            </button>
          ) : null}
          <button ref={closeRef} type="button" className="lb-action" onClick={closeLightbox} aria-label="Закрыть" title="Закрыть · Esc">
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </span>
      </header>

      <div
        ref={viewportRef}
        className={cn("lb-viewport", zoom && "is-zoomed")}
        onClick={(event) => {
          // Клик мимо кадра закрывает просмотр.
          if (event.target === event.currentTarget) closeLightbox()
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {url ? (
          // Источник — object URL из хранилища или приложенного файла: next/image с ним не работает.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={imageRef}
            src={url}
            alt={item.alt ?? item.caption ?? ""}
            draggable={false}
            onLoad={onLoad}
            onClick={(event) => {
              if (drag.current?.moved) return
              if (zoom || zoomable) toggleZoom(event)
            }}
            data-direction={direction ?? undefined}
            data-grow={origin ? "true" : undefined}
            className={cn("lb-image", !full && "is-preview", zoomable && "is-zoomable")}
            style={zoom ? { width: zoom.width, maxWidth: "none", maxHeight: "none" } : undefined}
          />
        ) : null}
        {loading ? (
          <span className="lb-status" role="status">
            <ThinkingGlyph size={22} />
            {url ? null : <span>загружаем файл…</span>}
          </span>
        ) : null}
        {failed ? (
          <span className="lb-status" role="status">
            <span>Файл ещё не синхронизирован с этим браузером</span>
            <button type="button" className="btn-outline h-9 px-4 text-[13px]" onClick={stored.retry}>
              Проверить снова
            </button>
          </span>
        ) : null}
      </div>
    </>
  )
}

/**
 * Невидимая кнопка поверх картинки, у которой клик свободен: вся картинка
 * открывает просмотр. Кладётся сразу после `<img>`, до действий карточки —
 * те остаются выше и кликаются сами.
 */
export function ZoomHit({
  onOpen,
  label = "Открыть в полном размере",
  className,
}: {
  /** Получает саму кнопку — из её прямоугольника кадр «вырастает». */
  onOpen: (origin: HTMLElement) => void
  label?: string
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation()
        onOpen(event.currentTarget)
      }}
      className={cn("zoom-hit", className)}
    />
  )
}

/**
 * Кнопка-уголок «открыть в полном размере» для картинок, у которых клик уже
 * занят: плитка панели выбирает рендер, плитка альбома ставит галочку, сцена
 * редактора рисует области. Появляется по наведению на родителя `.zoom-host`.
 */
export function ZoomButton({
  onOpen,
  label = "Открыть в полном размере",
  className,
}: {
  onOpen: (origin: HTMLElement) => void
  label?: string
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(event) => {
        event.stopPropagation()
        event.preventDefault()
        // Кадр вырастает из всей плитки, а не из маленькой кнопки.
        const host = event.currentTarget.closest<HTMLElement>(".zoom-host")
        onOpen(host ?? event.currentTarget)
      }}
      onPointerDown={(event) => event.stopPropagation()}
      // Плитка-родитель ловит Enter и пробел под свой выбор — кнопке нужен собственный клик.
      onKeyDown={(event) => event.stopPropagation()}
      className={cn("zoom-btn", className)}
    >
      <Maximize2 className="h-3 w-3" strokeWidth={2} />
    </button>
  )
}
