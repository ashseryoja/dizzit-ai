"use client"

import { useState } from "react"
import { Download, Eye, RefreshCw, Trash2 } from "lucide-react"

import { ThinkingGlyph } from "@/components/glyphs"
import { StoredAssetNotice } from "@/components/tool/tool-card"
import { getBlob, sourceKey, thumbSourceKey } from "@/lib/blob-store"
import { previewCaption } from "@/lib/image-generation"
import { useStoredBlobUrl, type StoredBlobStatus, type StoredBlobUrlState } from "@/lib/use-stored-blob"
import { cn, plural } from "@/lib/utils"
import { PRESET_LABEL, isWideShot, viewKey, viewThumbKey } from "@/lib/view-engine"
import type { ViewFrame, ViewSet } from "@/types"

/**
 * Карточка сета кадров в галерее — контактный лист: плитки по два в ряд,
 * ракурсы в пропорции исходника, крупные планы — 4:5; сеты собраны так, что
 * соседи в ряду одной пропорции. Пока кадр считается, плитка живёт на размытом
 * исходнике со спиннером — сет догоняет по одному кадру. У плитки своё
 * скачивание, у сета — исходник (удерживать), «скачать все» и удаление.
 */
export function ViewSetCard({
  item,
  downloadBaseName,
  onRetry,
  onDelete,
}: {
  item: ViewSet
  downloadBaseName: string
  onRetry: () => void
  onDelete: () => void
}) {
  const { id, status } = item
  const [comparing, setComparing] = useState(false)
  const sourceAsset = useStoredBlobUrl([thumbSourceKey(id), sourceKey(id)])
  const ready = new Set(item.ready ?? [])
  const frames = item.frames ?? []
  const many = frames.length > 1

  const download = async (frame: ViewFrame) => {
    const blob = await getBlob(viewKey(id, frame.key))
    if (!blob) {
      window.alert("Файл кадра ещё не синхронизирован. Подождите и попробуйте скачать снова.")
      return
    }
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    const extension = blob.type === "image/png" ? "png" : "jpg"
    link.download = `${downloadBaseName}-${frame.key}.${extension}`
    link.click()
    URL.revokeObjectURL(url)
  }

  // Скачивание сета — по файлу с паузой: браузеры режут очередь мгновенных кликов.
  const downloadAll = async () => {
    for (const frame of frames) {
      await download(frame)
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  }

  const caption =
    `${item.sourceWidth}×${item.sourceHeight} · ${PRESET_LABEL[item.preset].toLowerCase()} · ` +
    `${frames.length} ${plural(frames.length, ["кадр", "кадра", "кадров"])}` +
    (item.note ? ` · ${item.note}` : "") +
    previewCaption(item)

  return (
    <figure
      className="group card rise-in relative mb-4 break-inside-avoid overflow-hidden"
      style={{ borderRadius: "var(--r-lg)" }}
    >
      <div className={cn("grid gap-[2px]", many && "grid-cols-2")} style={{ background: "var(--line)" }}>
        {frames.map((frame) => (
          <ViewTile
            key={frame.key}
            item={item}
            frame={frame}
            ready={ready.has(frame.key)}
            sourceAsset={sourceAsset}
            comparing={comparing}
            onDownload={() => void download(frame)}
          />
        ))}
      </div>

      {status === "error" && sourceAsset.url ? (
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
          <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {sourceAsset.url ? (
              <CardAction
                label="Показать общий план (удерживайте)"
                onPointerDown={() => setComparing(true)}
                onPointerUp={() => setComparing(false)}
                onPointerLeave={() => setComparing(false)}
                active={comparing}
              >
                <Eye className="h-3.5 w-3.5" strokeWidth={1.8} />
              </CardAction>
            ) : null}
            <CardAction label={many ? "Скачать все кадры" : "Скачать кадр"} onClick={() => void downloadAll()}>
              <Download className="h-3.5 w-3.5" strokeWidth={1.8} />
            </CardAction>
            <CardAction label="Удалить" onClick={onDelete} danger>
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
            </CardAction>
          </div>

          <figcaption
            className="chip absolute bottom-2 left-2 opacity-0 transition-opacity group-hover:opacity-100"
            style={{ background: "rgba(16,16,18,0.7)", color: "rgba(255,255,255,0.85)", borderColor: "rgba(255,255,255,0.16)" }}
          >
            {caption}
          </figcaption>
        </>
      ) : null}
    </figure>
  )
}

/** Плитка одного кадра: миниатюра из IndexedDB, подпись, скачивание по ховеру. */
function ViewTile({
  item,
  frame,
  ready,
  sourceAsset,
  comparing,
  onDownload,
}: {
  item: ViewSet
  frame: ViewFrame
  ready: boolean
  sourceAsset: StoredBlobUrlState
  comparing: boolean
  onDownload: () => void
}) {
  const frameAsset = useStoredBlobUrl(
    ready ? [viewThumbKey(item.id, frame.key), viewKey(item.id, frame.key)] : []
  )
  const preferFrame = ready && !comparing
  const shownAsset = preferFrame
    ? frameAsset.url
      ? frameAsset
      : sourceAsset
    : sourceAsset.url
      ? sourceAsset
      : frameAsset
  const shown = shownAsset.url
  const assetStatus = shown
    ? "ready"
    : mergeUnavailableStatus(preferFrame || comparing ? [frameAsset, sourceAsset] : [sourceAsset])
  const showingSource = Boolean(shown && shownAsset === sourceAsset)
  const showingSourceFallback = ready && !comparing && showingSource && !frameAsset.url
  const pending = item.status === "processing" && !ready
  const aspect = isWideShot(frame.kind) ? `${item.sourceWidth || 1} / ${item.sourceHeight || 1}` : "4 / 5"

  return (
    <div
      className="group/tile relative w-full overflow-hidden"
      style={{ aspectRatio: aspect, background: "var(--bg-raised)" }}
    >
      {shown ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={shown}
          alt={`${item.sourceName} — ${frame.label}`}
          draggable={false}
          onError={shownAsset.reportImageError}
          className={cn("absolute inset-0 h-full w-full select-none object-cover", pending && "blur-[6px]")}
        />
      ) : null}

      {!shown ? (
        <StoredAssetNotice
          status={assetStatus}
          onRetry={() => {
            frameAsset.retry()
            sourceAsset.retry()
          }}
          compact
          className="absolute inset-0"
        />
      ) : pending ? (
        <div
          className="fade-in absolute inset-0 flex flex-col items-center justify-center gap-2"
          style={{ background: "rgba(16,16,18,0.45)" }}
        >
          <ThinkingGlyph size={20} className="text-white/80" />
          <span className="text-[11.5px]" style={{ color: "rgba(255,255,255,0.85)" }}>
            строим кадр…
          </span>
        </div>
      ) : null}

      {showingSourceFallback ? (
        <StoredAssetNotice
          status={frameAsset.status}
          onRetry={frameAsset.retry}
          compact
          className="absolute bottom-2 left-2 right-2 rounded-[10px]"
        />
      ) : null}

      <span
        className="chip absolute left-2 top-2"
        style={{ background: "rgba(16,16,18,0.7)", color: "rgba(255,255,255,0.85)", borderColor: "rgba(255,255,255,0.16)" }}
      >
        {(comparing && ready) || (ready && showingSource) ? "общий план" : frame.label}
      </span>

      {ready && item.status === "done" && frameAsset.url ? (
        <button
          type="button"
          onClick={onDownload}
          aria-label={`Скачать кадр «${frame.label}»`}
          title="Скачать кадр"
          className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-[7px] opacity-0 transition-opacity group-hover/tile:opacity-100 focus-visible:opacity-100"
          style={{ background: "rgba(16,16,18,0.66)", border: "1px solid rgba(255,255,255,0.18)", color: "rgba(255,255,255,0.92)" }}
        >
          <Download className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      ) : null}
    </div>
  )
}

function mergeUnavailableStatus(states: StoredBlobUrlState[]): StoredBlobStatus {
  if (states.some((state) => state.status === "loading")) return "loading"
  if (states.some((state) => state.status === "error")) return "error"
  return "missing"
}

/** Кнопка на карточке: тёмная плашка поверх изображения (как у ToolCard). */
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
