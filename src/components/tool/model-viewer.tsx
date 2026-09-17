"use client"

import { createElement, useEffect, useState } from "react"
import { Download } from "lucide-react"

import { ThinkingGlyph } from "@/components/glyphs"
import { StoredAssetNotice } from "@/components/tool/tool-card"
import { getBlob, modelKey } from "@/lib/blob-store"
import { MODEL_FILE, MODEL_FORMATS } from "@/lib/model-engine"
import { useStoredBlobUrl } from "@/lib/use-stored-blob"
import { cn, fileBaseName } from "@/lib/utils"
import type { Model3D, ModelFormat } from "@/types"

/**
 * Просмотр настоящей 3D-модели («Фото → 3D»): GLB из хранилища
 * (`${id}:model`, lib/blob-store) во вьюере `<model-viewer>` — вращение мышью
 * или пальцем, зум, медленный автоповорот. Библиотека (three.js внутри)
 * подгружается только здесь и только в браузере: на сервере кастомных
 * элементов нет, а остальным экранам эти ~700 КБ не нужны.
 *
 * Пока файл едет с сервера или потерян — общий `StoredAssetNotice`, как у
 * картинок.
 */
export function ModelViewer({ modelId, className }: { modelId: string; className?: string }) {
  const asset = useStoredBlobUrl([modelKey(modelId)])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let alive = true
    void import("@google/model-viewer").then(() => {
      if (alive) setReady(true)
    })
    return () => {
      alive = false
    }
  }, [])

  if (!asset.url || !ready) {
    return (
      <div className={cn("flex items-center justify-center", className)}>
        <StoredAssetNotice status={asset.url ? "loading" : asset.status} onRetry={asset.retry} />
      </div>
    )
  }

  // createElement — чтобы не расширять глобальные JSX-типы ради одного тега.
  return createElement("model-viewer", {
    key: asset.url,
    src: asset.url,
    // Модель — главное на сцене: грузим сразу, не дожидаясь попадания во вьюпорт.
    loading: "eager",
    "camera-controls": "",
    "auto-rotate": "",
    "auto-rotate-delay": "600",
    "rotation-per-second": "18deg",
    "interaction-prompt": "none",
    "environment-image": "neutral",
    "shadow-intensity": "0.7",
    "shadow-softness": "0.9",
    exposure: "1.05",
    "touch-action": "pan-y",
    class: cn("model-viewer fade-in block", className),
  })
}

/** Скачать файл модели из хранилища. `false` — файла нет ни локально, ни на сервере. */
export async function downloadStoredModel(model: Model3D, format: ModelFormat = "glb"): Promise<boolean> {
  const blob = await getBlob(modelKey(model.id, format)).catch(() => null)
  if (!blob) return false
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `${fileBaseName(model.sourceName, "model")}.${MODEL_FILE[format].extension}`
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return true
}

/**
 * Скачивание модели по форматам: GLB готов сразу, FBX и OBJ докачиваются
 * фоном — пока поля `formats` у записи нет, их кнопки ждут. Формат, которого
 * у задачи не оказалось, не показывается.
 */
export function ModelDownloads({ model, className }: { model: Model3D; className?: string }) {
  const [busy, setBusy] = useState<ModelFormat | null>(null)
  const settled = model.formats !== undefined
  const shown = MODEL_FORMATS.filter((format) => format === "glb" || !settled || model.formats?.includes(format))

  const download = async (format: ModelFormat) => {
    setBusy(format)
    try {
      if (!(await downloadStoredModel(model, format))) window.alert(`Файл ${MODEL_FILE[format].label} не найден в хранилище.`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className={cn("model-downloads", className)} role="group" aria-label="Скачать модель">
      <Download className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
      {shown.map((format) => {
        const ready = format === "glb" || Boolean(model.formats?.includes(format))
        return (
          <button
            key={format}
            type="button"
            disabled={!ready || busy !== null}
            onClick={() => void download(format)}
            title={
              !ready
                ? `${MODEL_FILE[format].label} готовится…`
                : format === "obj"
                  ? "Скачать OBJ — архив с материалом и текстурой"
                  : format === "fbx"
                    ? "Скачать FBX — для 3ds Max, ArchiCAD, AutoCAD"
                    : "Скачать GLB — для Blender, Unreal и веба"
            }
          >
            {busy === format || !ready ? <ThinkingGlyph size={11} /> : null}
            {MODEL_FILE[format].label}
          </button>
        )
      })}
    </div>
  )
}
