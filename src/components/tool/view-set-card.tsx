"use client"

import { Download, RefreshCw, Sparkles, Trash2 } from "lucide-react"

import { ThinkingGlyph } from "@/components/glyphs"
import { StoredAssetNotice } from "@/components/tool/tool-card"
import { openLightbox, ZoomHit, type LightboxItem } from "@/components/ui/lightbox"
import { getBlob, sourceKey, thumbSourceKey } from "@/lib/blob-store"
import { frameAspectCss, frameAspectRatio } from "@/lib/frame-aspect"
import { previewCaption } from "@/lib/image-generation"
import { useStoredBlobUrl, type StoredBlobStatus, type StoredBlobUrlState } from "@/lib/use-stored-blob"
import { cn, plural } from "@/lib/utils"
import { PRESET_LABEL, isWideShot, viewKey, viewThumbKey } from "@/lib/view-engine"
import type { ViewFrame, ViewSet } from "@/types"

/**
 * Карточка сета кадров — широкая строка галереи (`ToolGallery layout="stack"`):
 * слева общий план, который приложил пользователь, с именем, форматом и
 * действиями; справа — кадры, которые из него получились, плитками в формате
 * сета (`.view-set*` в surfaces.css). Пока кадр считается, плитка живёт на
 * размытом исходнике со спиннером — сет догоняет по одному кадру. У плитки
 * своё скачивание, у сета — «скачать все», удаление и «Повторить» при ошибке.
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
  const sourceAsset = useStoredBlobUrl([thumbSourceKey(id), sourceKey(id)])
  const ready = new Set(item.ready ?? [])
  const frames = item.frames ?? []
  // Записи до появления флага считаются сохранёнными.
  const sourceReady = item.sourceReady !== false
  /* Шаги работы: исходник, план кадров, каждый кадр. Доля — для полоски прогресса. */
  const steps = frames.length + 2
  const doneSteps = (sourceReady ? 1 : 0) + (item.planned !== undefined || ready.size > 0 ? 1 : 0) + ready.size
  const progress = status === "done" ? 1 : Math.min(0.96, doneSteps / steps)
  const stage = !sourceReady
    ? "сохраняем исходник…"
    : ready.size === 0 && item.planned === undefined
      ? "разбираем сцену и подбираем кадры…"
      : `строим кадры: ${ready.size} из ${frames.length}`
  const tall = item.aspect ? frameAspectRatio(item.aspect) < 1 : true

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

  /* Просмотр во весь экран: общий план и готовые кадры сета одной галереей —
     стрелки листают сет, открывается тот кадр, по которому нажали. */
  const openViewer = (startKey: string | null, origin: HTMLElement) => {
    const views: Array<LightboxItem & { frameKey: string | null }> = [
      {
        frameKey: null,
        keys: [sourceKey(id), thumbSourceKey(id)],
        preview: sourceAsset.url,
        alt: item.sourceName,
        caption: `${item.sourceName} · общий план`,
      },
      ...frames
        .filter((frame) => ready.has(frame.key))
        .map((frame) => ({
          frameKey: frame.key,
          keys: [viewKey(id, frame.key), viewThumbKey(id, frame.key)],
          alt: `${item.sourceName} — ${frame.label}`,
          caption: frame.label,
          downloadName: `${downloadBaseName}-${frame.key}`,
        })),
    ]
    openLightbox(views, { index: Math.max(0, views.findIndex((view) => view.frameKey === startKey)), origin })
  }

  const frameCount = `${frames.length} ${plural(frames.length, ["кадр", "кадра", "кадров"])}`
  const summary = [
    `${item.sourceWidth}×${item.sourceHeight}`,
    PRESET_LABEL[item.preset].toLowerCase(),
    frameCount,
    item.aspect ? `формат ${item.aspect}` : null,
  ]
    .filter(Boolean)
    .join(" · ")
  const origin =
    [
      item.sceneInventory ? "разбор сцены" : null,
      item.planned
        ? "кадры подобрала vision-модель по этому рендеру"
        : item.planned === false || status !== "processing"
          ? "кадры по составу набора"
          : null,
      item.status === "done" && item.engine && item.engine !== "preview" ? "Lanczos 2000 px" : null,
    ]
      .filter(Boolean)
      .join(" · ") + previewCaption(item)

  return (
    <figure className="rise-in relative">
      <div className="view-set">
        {/* Общий план: что приложили, с подписью и действиями. */}
        <div className="view-set-source flex flex-col gap-2.5">
          <div
            className="card-media relative w-full overflow-hidden"
            style={{
              aspectRatio: `${item.sourceWidth || 4} / ${item.sourceHeight || 3}`,
              borderRadius: "var(--r-md)",
              background: "var(--bg-raised)",
            }}
          >
            {sourceAsset.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={sourceAsset.url}
                alt={item.sourceName}
                draggable={false}
                onError={sourceAsset.reportImageError}
                className="absolute inset-0 h-full w-full select-none object-cover"
              />
            ) : !sourceReady || sourceAsset.status === "loading" ? (
              <div className="fade-in absolute inset-0 flex items-center justify-center">
                <ThinkingGlyph size={20} className="[color:var(--fg-4)]" />
              </div>
            ) : (
              <StoredAssetNotice status={sourceAsset.status} onRetry={sourceAsset.retry} compact className="absolute inset-0" />
            )}
            {sourceAsset.url ? <ZoomHit onOpen={(origin) => openViewer(null, origin)} label="Открыть общий план в полном размере" /> : null}
            <span className="view-set-chip">общий план</span>
          </div>

          <figcaption className="flex min-w-0 flex-col gap-1 px-0.5">
            <span className="truncate text-[13px]" style={{ color: "var(--fg-1)" }} title={item.sourceName}>
              {item.sourceName}
            </span>
            <span className="ds-caption">{summary}</span>
            {item.note ? <span className="ds-caption">«{item.note}»</span> : null}
            <span className="ds-caption flex items-center gap-1.5">
              <Sparkles className="h-3 w-3 shrink-0" strokeWidth={1.7} />
              {origin}
            </span>
          </figcaption>

          {status === "error" ? (
            <div className="flex flex-col gap-2.5 px-0.5">
              <p className="text-[12.5px] leading-snug" style={{ color: "var(--danger)" }}>
                {item.error ?? "Не получилось."}
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={onRetry} className="btn-outline h-9 px-4 text-[13px]">
                  <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
                  Повторить
                </button>
                <button type="button" onClick={onDelete} aria-label="Удалить сет" className="btn-icon btn-danger h-9 w-9">
                  <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                </button>
              </div>
            </div>
          ) : status === "done" ? (
            <div className="-ml-1 flex items-center gap-1">
              <button type="button" onClick={() => void downloadAll()} className="btn-ghost h-8 gap-2 px-2.5 text-[12.5px]">
                <Download className="h-3.5 w-3.5" strokeWidth={1.8} />
                {frames.length > 1 ? "Скачать все" : "Скачать"}
              </button>
              <button type="button" onClick={onDelete} aria-label="Удалить сет" className="btn-icon btn-danger h-8 w-8">
                <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 px-0.5" aria-live="polite">
              <div className="flex items-center gap-2 text-[12.5px]" style={{ color: "var(--fg-2)" }}>
                <ThinkingGlyph size={16} className="[color:var(--fg-4)]" />
                {stage}
              </div>
              <div className="view-set-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)}>
                <span style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
              <span className="ds-caption">обычно около минуты: разбор сцены ≈ 15 с, затем по 20–40 с на кадр, по три разом</span>
            </div>
          )}
        </div>

        {/* Кадры сета — в формате, выбранном для сета. */}
        <div className={cn("view-set-frames", tall ? "is-tall" : "is-wide")}>
          {frames.map((frame) => (
            <ViewTile
              key={frame.key}
              item={item}
              frame={frame}
              ready={ready.has(frame.key)}
              sourceAsset={sourceAsset}
              onDownload={() => void download(frame)}
              onOpen={(origin) => openViewer(frame.key, origin)}
            />
          ))}
        </div>
      </div>
    </figure>
  )
}

/** Плитка одного кадра: миниатюра из IndexedDB, подпись, скачивание по ховеру. */
function ViewTile({
  item,
  frame,
  ready,
  sourceAsset,
  onDownload,
  onOpen,
}: {
  item: ViewSet
  frame: ViewFrame
  ready: boolean
  sourceAsset: StoredBlobUrlState
  onDownload: () => void
  /** Открыть кадр в просмотре во весь экран. */
  onOpen: (origin: HTMLElement) => void
}) {
  const frameAsset = useStoredBlobUrl(ready ? [viewThumbKey(item.id, frame.key), viewKey(item.id, frame.key)] : [])
  // Готовый кадр — сам кадр; пока его нет — размытый исходник как подложка.
  const shownAsset = ready && frameAsset.url ? frameAsset : sourceAsset.url ? sourceAsset : frameAsset
  const shown = shownAsset.url
  const assetStatus = shown ? "ready" : mergeUnavailableStatus(ready ? [frameAsset, sourceAsset] : [sourceAsset])
  const showingSourceFallback = ready && Boolean(shown) && shownAsset === sourceAsset && !frameAsset.url
  const pending = item.status === "processing" && !ready
  const aspect = item.aspect
    ? frameAspectCss(item.aspect)
    : isWideShot(frame.kind)
      ? `${item.sourceWidth || 1} / ${item.sourceHeight || 1}`
      : "4 / 5"

  return (
    <div className="group/tile view-set-tile card-media" style={{ aspectRatio: aspect }}>
      {shown ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={shown}
          alt={`${item.sourceName} — ${frame.label}`}
          title={frame.brief}
          draggable={false}
          onError={shownAsset.reportImageError}
          className={cn("absolute inset-0 h-full w-full select-none object-cover", (pending || showingSourceFallback) && "blur-[6px]")}
        />
      ) : null}

      {ready && frameAsset.url ? <ZoomHit onOpen={onOpen} label={`Открыть кадр «${frame.label}» в полном размере`} /> : null}

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
        <div className="fade-in absolute inset-0 flex flex-col items-center justify-center gap-2" style={{ background: "rgba(16,16,18,0.45)" }}>
          <ThinkingGlyph size={16} className="text-white/80" />
          <span className="text-[10.5px]" style={{ color: "rgba(255,255,255,0.85)" }}>
            строим кадр…
          </span>
        </div>
      ) : null}

      {showingSourceFallback ? (
        <StoredAssetNotice status={frameAsset.status} onRetry={frameAsset.retry} compact className="absolute bottom-2 left-2 right-2 rounded-[10px]" />
      ) : null}

      <span className="view-set-chip" title={frame.brief}>
        {frame.label}
      </span>

      {ready && item.status === "done" && frameAsset.url ? (
        <button
          type="button"
          onClick={onDownload}
          aria-label={`Скачать кадр «${frame.label}»`}
          title="Скачать кадр"
          className="absolute bottom-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-[6px] opacity-0 transition-opacity group-hover/tile:opacity-100 focus-visible:opacity-100"
          style={{ background: "rgba(16,16,18,0.66)", border: "1px solid rgba(255,255,255,0.18)", color: "rgba(255,255,255,0.92)" }}
        >
          <Download className="h-3 w-3" strokeWidth={1.8} />
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
