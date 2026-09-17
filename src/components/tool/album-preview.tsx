"use client"

import { useEffect, useState } from "react"
import { BookOpen, RefreshCw } from "lucide-react"

import { ThinkingGlyph } from "@/components/glyphs"
import type { AlbumProgress } from "@/lib/album-engine"
import { useIsMobile } from "@/lib/use-is-mobile"
import { cn } from "@/lib/utils"
import type { AlbumFormat } from "@/shared/album"

export type AlbumPreviewStatus = "idle" | "building" | "ready" | "error"

const FRAME_ASPECT: Record<AlbumFormat, string> = {
  "a4-landscape": "297 / 210",
  "a4-portrait": "210 / 297",
  screen: "16 / 9",
}

/**
 * Превью альбома: собранный PDF во встроенном просмотрщике браузера — то,
 * что скачает клиент, без отдельной HTML-вёрстки «примерно так». Кадр держит
 * пропорцию выбранного формата, поверх — вуаль состояния: до первой сборки
 * приглашение, во время сборки прогресс подготовки картинок, при ошибке —
 * «попробовать снова». Object URL живёт здесь и отзывается при смене файла.
 * На телефонах встроенного просмотрщика PDF нет — вместо кадра подсказка.
 */
export function AlbumPreview({
  blob,
  status,
  error,
  progress,
  stale,
  format,
  idleText,
  onRetry,
}: {
  blob: Blob | null
  status: AlbumPreviewStatus
  error?: string | null
  /** Ход подготовки картинок; null во время самой сборки PDF. */
  progress?: AlbumProgress | null
  /** Состав изменился после сборки — превью показывает прежнюю версию. */
  stale: boolean
  format: AlbumFormat
  /** Подпись до первой сборки. */
  idleText: string
  onRetry: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  const mobile = useIsMobile()

  useEffect(() => {
    if (!blob) {
      setUrl(null)
      return
    }
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])

  const preparing = progress && progress.total > 0 && progress.ready < progress.total
  const percent = preparing ? Math.round((progress.ready / progress.total) * 100) : 100

  return (
    <div className={cn("album-preview", stale && status === "ready" && "is-stale")} style={{ aspectRatio: FRAME_ASPECT[format] }}>
      {url && !mobile ? <iframe key={url} src={`${url}#toolbar=0&navpanes=0&view=Fit`} title="Превью альбома" className="album-preview-frame" /> : null}
      {url && mobile ? (
        <div className="album-preview-veil">
          <span className="ds-body" style={{ color: "var(--fg-2)" }}>
            Альбом собран
          </span>
          <span className="ds-caption">На телефоне превью PDF не показывается — скачайте файл.</span>
        </div>
      ) : null}
      {status === "idle" && !url ? (
        <div className="album-preview-veil">
          <BookOpen className="h-6 w-6" strokeWidth={1.4} style={{ color: "var(--fg-5)" }} />
          <span className="ds-caption" style={{ maxWidth: 260 }}>
            {idleText}
          </span>
        </div>
      ) : null}
      {status === "building" ? (
        <div className={cn("album-preview-veil", url && "is-over")} role="status" aria-live="polite">
          <ThinkingGlyph size={28} />
          <span className="ds-caption" style={{ color: "var(--fg-2)" }}>
            {preparing ? `готовим картинки · ${progress.ready} из ${progress.total}` : "собираем PDF…"}
          </span>
          <span className={cn("album-progress", !preparing && "is-busy")} aria-hidden>
            <span className="album-progress-fill" style={{ width: `${percent}%` }} />
          </span>
        </div>
      ) : null}
      {status === "error" ? (
        <div className={cn("album-preview-veil", url && "is-over")}>
          <span className="ds-body" style={{ color: "var(--danger)", maxWidth: 320 }}>
            {error ?? "Альбом не собрался."}
          </span>
          <button type="button" className="btn-secondary" onClick={onRetry}>
            <RefreshCw className="h-4 w-4" strokeWidth={1.7} />
            Попробовать снова
          </button>
        </div>
      ) : null}
      {stale && status === "ready" ? <span className="album-preview-badge">показана прежняя версия</span> : null}
    </div>
  )
}
