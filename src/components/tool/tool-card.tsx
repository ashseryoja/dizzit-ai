"use client"

import { useEffect, useState } from "react"
import { Download, Eye, RefreshCw, Trash2 } from "lucide-react"

import { ThinkingGlyph } from "@/components/glyphs"
import { getBlob, resultKey, thumbResultKey, thumbSourceKey } from "@/lib/blob-store"
import { previewCaption } from "@/lib/image-generation"
import { cn } from "@/lib/utils"
import type { GalleryItemMeta } from "@/types"

/** Блоб из IndexedDB → object URL с уборкой за собой. */
export function useBlobUrl(key: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!key) {
      setUrl(null)
      return
    }
    let cancelled = false
    let objectUrl: string | null = null
    void getBlob(key).then((blob) => {
      if (cancelled || !blob) return
      objectUrl = URL.createObjectURL(blob)
      setUrl(objectUrl)
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      setUrl(null)
    }
  }, [key])
  return url
}

/**
 * Карточка записи в галерее инструмента (паттерн нейрофотосессии UpSound:
 * чистое изображение, действия — по ховеру). Общая для всех инструментов
 * профиля: миниатюры едут из IndexedDB, полный результат достаётся оттуда же
 * только на скачивание. «До/после» появляется, только если у записи есть
 * исходник или референс.
 */
export function ToolCard({
  item,
  caption,
  processingLabel,
  downloadBaseName,
  onRetry,
  onDelete,
}: {
  item: GalleryItemMeta
  /** Подпись в левом нижнем углу по ховеру, например «2800×1800 · интерьер». */
  caption: string
  /** Текст под спиннером: «улучшаем рендер…», «генерируем материал…». */
  processingLabel: string
  /** Имя файла при скачивании — без расширения, оно берётся из типа блоба. */
  downloadBaseName: string
  onRetry: () => void
  onDelete: () => void
}) {
  const { id, status } = item
  const [comparing, setComparing] = useState(false)

  const resultThumb = useBlobUrl(status === "done" ? thumbResultKey(id) : null)
  const sourceThumb = useBlobUrl(thumbSourceKey(id))

  // До готовности результата карточка живёт на миниатюре исходника (если он есть).
  const shown = status === "done" && !comparing ? resultThumb : sourceThumb ?? resultThumb

  const width = (status === "done" && item.resultWidth) || item.sourceWidth || 1
  const height = (status === "done" && item.resultHeight) || item.sourceHeight || 1

  const download = async () => {
    const blob = await getBlob(resultKey(id))
    if (!blob) {
      window.alert("Результат не найден в хранилище браузера. Повторите генерацию.")
      return
    }
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    const extension = blob.type === "image/png" ? "png" : "jpg"
    link.download = `${downloadBaseName}.${extension}`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <figure
      className="group card rise-in relative mb-4 break-inside-avoid overflow-hidden"
      style={{ borderRadius: "var(--r-lg)" }}
    >
      <div className="relative w-full" style={{ aspectRatio: `${width} / ${height}` }}>
        {shown ? (
          /* Плейн <img>: источник — object URL из IndexedDB, next/image
             с ним не работает. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shown}
            alt={item.sourceName ?? item.note ?? ""}
            draggable={false}
            className={cn(
              "absolute inset-0 h-full w-full select-none object-cover",
              status === "processing" && "blur-[6px]"
            )}
          />
        ) : (
          <div className="absolute inset-0" style={{ background: "var(--bg-raised)" }} />
        )}

        {status === "processing" ? (
          <div
            className="fade-in absolute inset-0 flex flex-col items-center justify-center gap-2.5"
            style={{ background: "rgba(16,16,18,0.45)" }}
          >
            <ThinkingGlyph size={22} className="text-white/80" />
            <span className="text-[12px]" style={{ color: "rgba(255,255,255,0.85)" }}>
              {processingLabel}
            </span>
          </div>
        ) : null}

        {status === "error" ? (
          <div
            className="fade-in absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center"
            style={{ background: "rgba(16,16,18,0.72)" }}
          >
            <p className="max-w-[240px] text-[12.5px] leading-snug" style={{ color: "rgba(255,255,255,0.9)" }}>
              {item.error ?? "Не получилось."}
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={onRetry} className="btn-outline h-9 px-4 text-[13px]">
                <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
                Повторить
              </button>
              <button
                type="button"
                onClick={onDelete}
                aria-label="Удалить"
                className="btn-icon btn-danger h-9 w-9"
                style={{ background: "rgba(255,255,255,0.07)" }}
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.7} />
              </button>
            </div>
          </div>
        ) : null}

        {status === "done" ? (
          <>
            {/* Действия — по ховеру, как отметки на карточках нейрофотосессии. */}
            <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              {sourceThumb ? (
                <CardAction
                  label="Показать исходник (удерживайте)"
                  onPointerDown={() => setComparing(true)}
                  onPointerUp={() => setComparing(false)}
                  onPointerLeave={() => setComparing(false)}
                  active={comparing}
                >
                  <Eye className="h-3.5 w-3.5" strokeWidth={1.8} />
                </CardAction>
              ) : null}
              <CardAction label="Скачать результат" onClick={() => void download()}>
                <Download className="h-3.5 w-3.5" strokeWidth={1.8} />
              </CardAction>
              <CardAction label="Удалить" onClick={onDelete} danger>
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
              </CardAction>
            </div>

            {comparing ? (
              <span className="chip absolute left-2 top-2" style={{ background: "rgba(16,16,18,0.7)", color: "rgba(255,255,255,0.9)" }}>
                до
              </span>
            ) : null}

            <figcaption
              className="chip absolute bottom-2 left-2 opacity-0 transition-opacity group-hover:opacity-100"
              style={{ background: "rgba(16,16,18,0.7)", color: "rgba(255,255,255,0.85)", borderColor: "rgba(255,255,255,0.16)" }}
            >
              {/* Результат без ключа провайдера подписан честно: это canvas-предпросмотр. */}
              {caption}
              {previewCaption(item)}
            </figcaption>
          </>
        ) : null}
      </div>
    </figure>
  )
}

/** Кнопка на карточке: тёмная плашка поверх изображения, всегда читаемая. */
function CardAction({
  label,
  onClick,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
  active = false,
  danger = false,
  children,
}: {
  label: string
  onClick?: () => void
  onPointerDown?: () => void
  onPointerUp?: () => void
  onPointerLeave?: () => void
  active?: boolean
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      onContextMenu={(event) => event.preventDefault()}
      className="flex h-8 w-8 items-center justify-center rounded-[8px] transition-colors"
      style={{
        background: active ? "rgba(255,255,255,0.92)" : "rgba(16,16,18,0.66)",
        border: "1px solid rgba(255,255,255,0.18)",
        color: active ? "#111113" : danger ? "var(--danger)" : "rgba(255,255,255,0.92)",
      }}
    >
      {children}
    </button>
  )
}
