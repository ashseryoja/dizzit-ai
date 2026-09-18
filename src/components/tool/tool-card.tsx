"use client"

import { useState } from "react"
import { Download, Eye, Grid2x2, ImageOff, RefreshCw, SplitSquareHorizontal, Trash2 } from "lucide-react"

import { ThinkingGlyph } from "@/components/glyphs"
import { CompareSlider } from "@/components/tool/compare-slider"
import { ProcessingVeil } from "@/components/tool/processing-veil"
import { openLightbox, ZoomHit, type LightboxItem } from "@/components/ui/lightbox"
import { getBlob, resultKey, sourceKey, thumbResultKey, thumbSourceKey } from "@/lib/blob-store"
import { previewCaption } from "@/lib/image-generation"
import { useStoredBlobUrl, type StoredBlobStatus } from "@/lib/use-stored-blob"
import { cn, fileBaseName } from "@/lib/utils"
import type { GalleryItemMeta } from "@/types"

/** Блоб из IndexedDB → object URL с уборкой за собой. */
export function useBlobUrl(key: string | null): string | null {
  return useStoredBlobUrl([key]).url
}

/** Скачать полный результат из общего хранилища, а не миниатюру интерфейса. */
export async function downloadStoredResult(item: GalleryItemMeta, baseName?: string): Promise<void> {
  const blob = await getBlob(resultKey(item.id))
  if (!blob) {
    window.alert("Файл результата ещё не синхронизирован. Подождите и попробуйте скачать снова.")
    return
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `${baseName ?? `${fileBaseName(item.sourceName ?? "", "result")}-result`}.${blob.type === "image/png" ? "png" : "jpg"}`
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Карточка записи в галерее инструмента (паттерн нейрофотосессии UpSound:
 * чистое изображение, действия — по ховеру). Общая для всех инструментов
 * профиля: миниатюры едут из IndexedDB, полный результат достаётся оттуда же
 * только на скачивание. «До/после» появляется, только если у записи есть
 * исходник или референс. `tileable` — результат должен повторяться без шва
 * (материалы): добавляется переключатель «Повтор 2×2», который кладёт
 * результат четырьмя копиями встык, стык — в центре карточки.
 */
export function ToolCard({
  item,
  caption,
  processingLabel,
  downloadBaseName,
  tileable = false,
  title,
  compare = "hold",
  order = 0,
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
  /** Результат — бесшовный тайл: показать переключатель повтора 2×2. */
  tileable?: boolean
  /** Подпись-название: у обычных карточек видна всегда (стиль), у тайлов — по наведению (узор не закрываем). */
  title?: string
  /**
   * Как сравнивать с исходником: `hold` — показать исходник, пока кнопка нажата
   * (референс материала — другая картинка), `slider` — шторка «до / после»
   * (перенос стиля: тот же кадр).
   */
  compare?: "hold" | "slider"
  /** Номер карточки в галерее: сдвигает появление и фазу ожидания. */
  order?: number
  onRetry: () => void
  onDelete: () => void
}) {
  const { id, status } = item
  const [comparing, setComparing] = useState(false)
  const [repeating, setRepeating] = useState(false)

  // Метаданные могут приехать с сервера раньше объектов. Полный файл —
  // штатный запасной вариант миниатюре; отдельный хук результата продолжает
  // ограниченные попытки, даже когда карточка уже показывает исходник.
  const expectsSavedResult = status === "done" || item.syncPending === true
  const resultAsset = useStoredBlobUrl(
    expectsSavedResult ? [thumbResultKey(id), resultKey(id)] : []
  )
  const sourceAsset = useStoredBlobUrl(
    item.sourceName ? [thumbSourceKey(id), sourceKey(id)] : []
  )
  const preferredAsset = expectsSavedResult && resultAsset.url ? resultAsset : sourceAsset
  const sliding = compare === "slider"
  const shownAsset = comparing && !sliding && sourceAsset.url ? sourceAsset : preferredAsset
  const shown = shownAsset.url
  const assetStatus = shown
    ? "ready"
    : mergeUnavailableStatus(expectsSavedResult ? [resultAsset.status, sourceAsset.status] : [sourceAsset.status])
  const showingSourceFallback = Boolean(
    shown && status === "done" && shownAsset === sourceAsset && !resultAsset.url
  )

  const width = (expectsSavedResult && item.resultWidth) || item.sourceWidth || 1
  const height = (expectsSavedResult && item.resultHeight) || item.sourceHeight || 1

  const download = async () => {
    await downloadStoredResult(item, downloadBaseName)
  }

  /* Просмотр во весь экран: полный результат (а не миниатюра карточки), рядом —
     исходник, чтобы «до / после» листалось стрелками. */
  const openViewer = (origin: HTMLElement) => {
    const name = item.sourceName ?? item.note ?? ""
    const views: LightboxItem[] = []
    if (resultAsset.url) {
      views.push({
        keys: [resultKey(id), thumbResultKey(id)],
        preview: resultAsset.url,
        alt: name,
        caption: name ? `${name} · результат` : "результат",
        downloadName: downloadBaseName,
        compare: sliding && sourceAsset.url ? { keys: [sourceKey(id), thumbSourceKey(id)], preview: sourceAsset.url } : undefined,
      })
    }
    if (sourceAsset.url) {
      views.push({
        keys: [sourceKey(id), thumbSourceKey(id)],
        preview: sourceAsset.url,
        alt: name,
        caption: name ? `${name} · исходник` : "исходник",
      })
    }
    openLightbox(views, { index: comparing && views.length > 1 ? 1 : 0, origin })
  }

  return (
    <figure
      className="group card card-media rise-in relative mb-4 break-inside-avoid overflow-hidden"
      style={{ borderRadius: "var(--r-lg)", animationDelay: `${Math.min(order, 8) * 60}ms` }}
    >
      <div className="relative w-full" style={{ aspectRatio: `${width} / ${height}` }}>
        {shown && tileable && repeating && status === "done" && !comparing ? (
          /* Повтор 2×2: результат фоном с background-repeat — без лишних пикселей и запросов. */
          <div
            role="img"
            aria-label="Повтор тайла 2×2"
            className="tile-repeat select-none"
            style={{ backgroundImage: `url("${shown}")` }}
          />
        ) : shown ? (
          /* Плейн <img>: источник — object URL из IndexedDB, next/image
             с ним не работает. */
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={shown}
            alt={item.sourceName ?? item.note ?? ""}
            draggable={false}
            onError={shownAsset.reportImageError}
            className={cn(
              "absolute inset-0 h-full w-full select-none object-cover",
              status === "processing" && "blur-[6px]"
            )}
          />
        ) : (
          <div className="absolute inset-0" style={{ background: "var(--bg-raised)" }} />
        )}

        {/* Вся картинка открывает просмотр; действия карточки лежат выше и кликаются сами. */}
        {shown && status === "done" ? <ZoomHit onOpen={openViewer} /> : null}

        {shown && status === "done" && sliding && comparing && sourceAsset.url ? (
          <CompareSlider before={sourceAsset.url} alt={item.sourceName ?? ""} fit="cover" />
        ) : null}

        {status === "processing" ? (
          <ProcessingVeil label={processingLabel} order={order} />
        ) : status === "error" ? (
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
        ) : !shown ? (
          <StoredAssetNotice
            status={assetStatus}
            onRetry={() => {
              resultAsset.retry()
              sourceAsset.retry()
            }}
            className="absolute inset-0"
          />
        ) : null}

        {showingSourceFallback ? (
          <StoredAssetNotice
            status={resultAsset.status}
            onRetry={resultAsset.retry}
            compact
            className="absolute bottom-2 left-2 right-2 rounded-[10px]"
          />
        ) : null}

        {shown && status === "done" ? (
          <>
            {/* Действия — по ховеру, как отметки на карточках нейрофотосессии. */}
            <div
              className={cn(
                "card-actions absolute right-2 top-2 z-[41] flex gap-1 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
                repeating || (sliding && comparing) ? "opacity-100" : "opacity-0"
              )}
            >
              {tileable && resultAsset.url ? (
                <CardAction
                  label={repeating ? "Скрыть повтор" : "Показать повтор 2×2"}
                  onClick={() => setRepeating((value) => !value)}
                  active={repeating}
                >
                  <Grid2x2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                </CardAction>
              ) : null}
              {sourceAsset.url && resultAsset.url ? (
                sliding ? (
                  <CardAction
                    label={comparing ? "Скрыть сравнение" : "Сравнить «до / после»"}
                    onClick={() => setComparing((value) => !value)}
                    active={comparing}
                  >
                    <SplitSquareHorizontal className="h-3.5 w-3.5" strokeWidth={1.8} />
                  </CardAction>
                ) : (
                  <CardAction
                    label="Показать исходник (удерживайте)"
                    onPointerDown={() => setComparing(true)}
                    onPointerUp={() => setComparing(false)}
                    onPointerLeave={() => setComparing(false)}
                    active={comparing}
                  >
                    <Eye className="h-3.5 w-3.5" strokeWidth={1.8} />
                  </CardAction>
                )
              ) : null}
              <CardAction label="Скачать результат" onClick={() => void download()}>
                <Download className="h-3.5 w-3.5" strokeWidth={1.8} />
              </CardAction>
              <CardAction label="Удалить" onClick={onDelete} danger>
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
              </CardAction>
            </div>

            {comparing && !sliding ? (
              <span className="chip absolute left-2 top-2" style={{ background: "rgba(16,16,18,0.7)", color: "rgba(255,255,255,0.9)" }}>
                до
              </span>
            ) : tileable && repeating ? (
              <span className="chip absolute left-2 top-2" style={{ background: "rgba(16,16,18,0.7)", color: "rgba(255,255,255,0.9)" }}>
                повтор 2×2
              </span>
            ) : null}

            {/* Подпись: название — всегда, подробности — по наведению. Под ними
                градиент, иначе на пёстром узоре (гусиная лапка) текст не читается. */}
            {sliding && comparing ? null : (
              <figcaption className={cn("card-caption", title && !tileable && "has-title")}>
                {title ? <span className="card-caption-title">{title}</span> : null}
                <span className="card-caption-meta">
                  {/* Результат без ключа провайдера подписан честно: это canvas-предпросмотр. */}
                  {caption}
                  {previewCaption(item)}
                </span>
              </figcaption>
            )}
          </>
        ) : null}
      </div>
    </figure>
  )
}

function mergeUnavailableStatus(states: StoredBlobStatus[]): StoredBlobStatus {
  if (states.some((status) => status === "loading")) return "loading"
  if (states.some((status) => status === "error")) return "error"
  return "missing"
}

/**
 * Терминальное состояние отсутствующего серверного файла. Оно не предлагает
 * пересоздать результат и не вызывает image API: кнопка лишь повторяет чтение
 * IndexedDB/object storage, сохраняя карточку и её размеры на месте.
 */
export function StoredAssetNotice({
  status,
  onRetry,
  compact = false,
  showRetry = true,
  className,
}: {
  status: StoredBlobStatus
  onRetry: () => void
  compact?: boolean
  /** false внутри уже интерактивной плитки, чтобы не вкладывать button в button. */
  showRetry?: boolean
  className?: string
}) {
  const loading = status === "loading"
  return (
    <div
      className={cn(
        "fade-in flex flex-col items-center justify-center text-center",
        compact ? "gap-1.5 p-2" : "gap-2.5 p-4",
        className
      )}
      style={{ background: "var(--bg-raised)" }}
      role="status"
    >
      {loading ? (
        <ThinkingGlyph size={compact ? 17 : 21} className="[color:var(--fg-4)]" />
      ) : (
        <ImageOff className={compact ? "h-4 w-4" : "h-5 w-5"} strokeWidth={1.6} style={{ color: "var(--fg-4)" }} />
      )}
      <span className={compact ? "text-[10.5px] leading-tight" : "text-[12px] leading-snug"} style={{ color: "var(--fg-3)" }}>
        {loading ? "Загружаем файл…" : "Файл ещё не синхронизирован"}
      </span>
      {!loading && showRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className={cn("btn-outline", compact ? "h-7 px-2 text-[10.5px]" : "h-8 px-3 text-[12px]")}
        >
          <RefreshCw className="h-3 w-3" strokeWidth={1.8} />
          Проверить снова
        </button>
      ) : null}
    </div>
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
      className={cn("card-action", active && "is-active", danger && "is-danger")}
    >
      {children}
    </button>
  )
}
