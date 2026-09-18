"use client"

import { useState } from "react"
import { Pause, RefreshCw, RotateCw, Trash2 } from "lucide-react"

import { ThinkingGlyph } from "@/components/glyphs"
import { FurnitureMorph } from "@/components/tool/furniture-morph"
import { ModelDownloads, ModelViewer } from "@/components/tool/model-viewer"
import { openLightbox, ZoomHit } from "@/components/ui/lightbox"
import { sourceKey, thumbSourceKey, viewKey } from "@/lib/blob-store"
import { SHAPE_LABEL } from "@/lib/furniture-wire"
import { MESHY_ENGINE, type ModelTaskProgress } from "@/lib/model-engine"
import { useStoredBlobUrl } from "@/lib/use-stored-blob"
import { cn, fileBaseName } from "@/lib/utils"
import { MODEL_SLOT_LABEL, describeModelSettings } from "@/shared/model3d"
import type { Model3D } from "@/types"

/** Фон сцены — как свотчи над вьюером у Meshy: модель проверяют на тёмном, сером, чёрном и цветном. */
const BACKDROPS = [
  { name: "Графит", value: "var(--bg-surface)" },
  { name: "Серый", value: "#8a8a8f" },
  { name: "Чёрный", value: "#000000" },
  { name: "Светлый", value: "#e9e9ec" },
] as const

const formatCount = (value: number) => new Intl.NumberFormat("ru-RU").format(value)

/**
 * Сцена модели «Фото → 3D» — центральная область, как у Meshy: готовая модель
 * крутится во вьюере, слева сверху — фото, по которым она построена, и
 * статистика сетки, справа сверху — фон и автоповорот, снизу — тулбар
 * (скачать по форматам, построить заново, удалить). Пока задача считается —
 * каркасы мебели перетекают друг в друга и виден процент; без ключа
 * провайдера результат — каркас-заглушка.
 */
export function ModelStage({
  model,
  progress,
  className,
  onRetry,
  onDelete,
}: {
  model: Model3D
  progress?: ModelTaskProgress
  /** Высота сцены — страница подбирает её под развёрнутую или свёрнутую панель генерации. */
  className?: string
  onRetry: () => void
  onDelete: () => void
}) {
  const [backdrop, setBackdrop] = useState<string>(BACKDROPS[0].value)
  const [autoRotate, setAutoRotate] = useState(true)
  const done = model.status === "done"
  const real = done && model.engine === MESHY_ENGINE
  const title = model.note || (real ? fileBaseName(model.sourceName, "модель") : SHAPE_LABEL[model.shape])

  return (
    <figure className={cn("card model-stage", className)} style={real ? { background: backdrop } : undefined}>
      {/* Пока строится — библиотека перетекает («ищем форму»); готовая модель Meshy —
          настоящий GLB во вьюере, заглушка без ключа — один каркас, который вращается. */}
      {real ? (
        // Отступ снизу — под тулбар: основание модели не уходит под кнопки.
        <div className="h-full w-full pb-14 pt-2">
          <ModelViewer key={model.id} modelId={model.id} autoRotate={autoRotate} className="h-full w-full" />
        </div>
      ) : (
        <FurnitureMorph
          key={done ? model.shape : "searching"}
          shape={done ? model.shape : undefined}
          className={cn("h-full w-full", model.status === "error" && "opacity-30")}
        />
      )}

      <div className="model-stage-corner left-3 top-3 items-start">
        <div className="model-stage-chip">
          <SourceThumb keys={[thumbSourceKey(model.id), sourceKey(model.id)]} label={MODEL_SLOT_LABEL.main} />
          {(model.views ?? []).map((role) => (
            <SourceThumb key={role} keys={[viewKey(model.id, role)]} label={MODEL_SLOT_LABEL[role]} />
          ))}
          <span className="flex min-w-0 flex-col pr-1">
            <span className="model-stage-micro">фото{model.views?.length ? ` · ${1 + model.views.length}` : ""}</span>
            <span className="max-w-[150px] truncate text-[12px]" style={{ color: "rgba(255,255,255,0.9)" }}>
              {model.sourceName}
            </span>
          </span>
        </div>

        {real && model.vertexCount && model.faceCount ? (
          <dl className="model-stage-stats">
            <div>
              <dt>Топология</dt>
              <dd>треугольники</dd>
            </div>
            <div>
              <dt>Грани</dt>
              <dd>{formatCount(model.faceCount)}</dd>
            </div>
            <div>
              <dt>Вершины</dt>
              <dd>{formatCount(model.vertexCount)}</dd>
            </div>
            {model.modelBytes ? (
              <div>
                <dt>GLB</dt>
                <dd>{(model.modelBytes / 1024 / 1024).toFixed(1)} МБ</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </div>

      {real ? (
        <div className="model-stage-corner right-3 top-3 flex-row items-center">
          <div className="model-stage-swatches" role="radiogroup" aria-label="Фон сцены">
            {BACKDROPS.map((item) => (
              <button
                key={item.name}
                type="button"
                role="radio"
                aria-checked={backdrop === item.value}
                aria-label={`Фон: ${item.name}`}
                title={`Фон: ${item.name}`}
                onClick={() => setBackdrop(item.value)}
                className={cn(backdrop === item.value && "is-active")}
                style={{ background: item.value }}
              />
            ))}
          </div>
          <button
            type="button"
            onClick={() => setAutoRotate((value) => !value)}
            aria-pressed={autoRotate}
            aria-label={autoRotate ? "Остановить вращение" : "Вращать модель"}
            title={autoRotate ? "Остановить вращение" : "Вращать модель"}
            className="btn-icon model-stage-action h-9 w-9"
          >
            {autoRotate ? <Pause className="h-4 w-4" strokeWidth={1.7} /> : <RotateCw className="h-4 w-4" strokeWidth={1.7} />}
          </button>
        </div>
      ) : null}

      {/* Тулбар — по центру снизу, как у Meshy. */}
      <div className="model-stage-toolbar">
        {real ? <ModelDownloads model={model} /> : null}
        {model.status !== "processing" ? (
          <button type="button" onClick={onRetry} aria-label="Построить заново" title="Построить заново" className="btn-icon model-stage-action h-9 w-9">
            <RefreshCw className="h-4 w-4" strokeWidth={1.7} />
          </button>
        ) : null}
        <button type="button" onClick={onDelete} aria-label="Удалить модель" title="Удалить модель" className="btn-icon btn-danger model-stage-action h-9 w-9">
          <Trash2 className="h-4 w-4" strokeWidth={1.7} />
        </button>
      </div>

      {model.status === "processing" ? (
        <div className="fade-in pointer-events-none absolute inset-x-0 bottom-16 flex flex-col items-center gap-2">
          <ThinkingGlyph size={22} className="text-white/80" />
          <span className="text-[12px]" style={{ color: "var(--fg-3)" }}>
            {!model.taskId
              ? "строим модель по фото…"
              : progress && progress.progress > 0
                ? `строим модель · ${progress.progress}%`
                : progress && progress.queue > 0
                  ? `в очереди · впереди ${progress.queue}`
                  : "строим модель по фото · 1–5 минут"}
          </span>
          {progress && progress.progress > 0 ? (
            <span className="model-stage-progress" aria-hidden>
              <span style={{ width: `${progress.progress}%` }} />
            </span>
          ) : null}
        </div>
      ) : null}

      {model.status === "error" ? (
        <div className="fade-in absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
          <p className="max-w-[320px] text-[12.5px] leading-snug" style={{ color: "var(--fg-1)" }}>
            {model.error ?? "Не получилось."}
          </p>
          <button type="button" onClick={onRetry} className="btn-outline h-9 px-4 text-[13px]">
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
            Повторить
          </button>
        </div>
      ) : null}

      {done ? (
        <figcaption className="model-stage-caption rise-in">
          <span className="text-[13px]" style={{ color: "rgba(255,255,255,0.92)" }}>
            {title}
          </span>
          <span className="model-stage-micro">
            {real
              ? `${model.settings ? describeModelSettings(model.settings) : "Meshy"}${model.credits ? ` · ${model.credits} кредитов` : ""}`
              : "каркас-заглушка · ключ Meshy не задан"}
          </span>
        </figcaption>
      ) : null}
    </figure>
  )
}

/** Миниатюра фото-исходника на сцене; пока файл едет с сервера — пустая плашка того же размера. */
function SourceThumb({ keys, label }: { keys: string[]; label: string }) {
  const asset = useStoredBlobUrl(keys)
  return asset.url ? (
    // Фото-исходник открывается в просмотре во весь экран — полным файлом, не миниатюрой.
    <span className="card-media relative flex shrink-0 overflow-hidden rounded-[7px]" title={label}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={asset.url} alt={label} className="model-stage-thumb" draggable={false} onError={asset.reportImageError} />
      <ZoomHit
        onOpen={(origin) => openLightbox({ keys: [...keys].reverse(), preview: asset.url, alt: label, caption: label }, { origin })}
        label={`Открыть фото «${label}» в полном размере`}
      />
    </span>
  ) : (
    <span className="model-stage-thumb flex items-center justify-center" title={label}>
      {asset.status === "loading" ? <ThinkingGlyph size={13} /> : null}
    </span>
  )
}
