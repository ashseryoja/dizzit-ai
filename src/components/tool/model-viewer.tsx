"use client"

import { createElement, useCallback, useEffect, useState } from "react"
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
 *
 * Модель без текстуры Meshy отдаёт вообще без секции материалов — по
 * спецификации glTF такой сетке достаётся белый металл (metallic 1), который
 * зеркалит окружение и выгорает в сплошное белое пятно. После загрузки такие
 * материалы переводятся в матовую светло-серую «глину», как в просмотрщике
 * Meshy: форма читается по светотени, а не по бликам. Текстурированные
 * материалы не трогаем.
 */
export function ModelViewer({
  modelId,
  className,
  autoRotate = true,
}: {
  modelId: string
  className?: string
  /** Медленный автоповорот; пользователь выключает его кнопкой на сцене. */
  autoRotate?: boolean
}) {
  const asset = useStoredBlobUrl([modelKey(modelId)])
  const [ready, setReady] = useState(false)
  const attach = useCallback((node: ModelViewerNode | null) => {
    if (!node) return
    node.addEventListener("load", () => clayBareMaterials(node))
    // Событие могло прийти до подписки (файл из кэша) — проверяем сразу.
    if (node.model) clayBareMaterials(node)
  }, [])

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
    ref: attach,
    src: asset.url,
    // Модель — главное на сцене: грузим сразу, не дожидаясь попадания во вьюпорт.
    loading: "eager",
    "camera-controls": "",
    ...(autoRotate ? { "auto-rotate": "" } : {}),
    "auto-rotate-delay": "600",
    "rotation-per-second": "18deg",
    "interaction-prompt": "none",
    "environment-image": "neutral",
    "shadow-intensity": "0.7",
    "shadow-softness": "0.9",
    exposure: "1",
    "touch-action": "pan-y",
    class: cn("model-viewer fade-in block", className),
  })
}

/** Часть API `<model-viewer>` (scene-graph), которая нужна для замены материалов. */
interface ModelViewerNode extends HTMLElement {
  model?: {
    materials: ReadonlyArray<{
      pbrMetallicRoughness: {
        baseColorTexture: { texture: unknown } | null
        setBaseColorFactor(rgba: [number, number, number, number] | string): void
        setMetallicFactor(value: number): void
        setRoughnessFactor(value: number): void
      }
    }>
  } | null
}

/**
 * Цвет «глины» в линейном пространстве (≈ #9a9794 в sRGB): тёплый средне-серый.
 * Подобран замером кадра вьюера на графитовом фоне: у белого металла по
 * умолчанию 81 % пикселей модели были выгоревшими (яркость ≥ 245), у этого
 * оттенка — 0 %, средняя яркость ≈ 170 — светотень читается, блики не слепят.
 */
const CLAY_BASE_COLOR: [number, number, number, number] = [0.3, 0.29, 0.27, 1]
const CLAY_ROUGHNESS = 0.62

/** Материалам без цветовой текстуры — матовая глина; материалы с текстурой остаются как в файле. */
function clayBareMaterials(node: ModelViewerNode) {
  for (const material of node.model?.materials ?? []) {
    const pbr = material.pbrMetallicRoughness
    if (pbr.baseColorTexture?.texture) continue
    pbr.setBaseColorFactor(CLAY_BASE_COLOR)
    pbr.setMetallicFactor(0)
    pbr.setRoughnessFactor(CLAY_ROUGHNESS)
  }
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
