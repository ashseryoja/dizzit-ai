"use client"

import { useCallback, useState } from "react"
import { Cog, Layers, Mountain, Shirt, Sparkles, TreePine } from "lucide-react"

import { MaterialPreviewGrid } from "@/components/tool/material-preview-grid"
import { ToolCard } from "@/components/tool/tool-card"
import { ToolComposer, type ToolComposerLabels, type ToolOption } from "@/components/tool/tool-composer"
import { ComposerDock, ToolGallery, ToolShell } from "@/components/tool/tool-shell"
import { getBlob, sourceKey } from "@/lib/blob-store"
import { MAX_BATCH } from "@/lib/enhance-engine"
import { generateMaterial } from "@/lib/material-engine"
import { runGalleryQueue, saveSourceFile } from "@/lib/tool-jobs"
import { persistResultDurably, repairPersistedResult } from "@/lib/result-storage"
import { useAttachments } from "@/lib/use-attachments"
import { createId } from "@/lib/utils"
import { useMaterialStore } from "@/stores/material-store"
import { ensureActiveProject, useActiveProject } from "@/stores/project-store"
import type { Material, MaterialCategory } from "@/types"

const CATEGORY_OPTIONS: ToolOption<MaterialCategory>[] = [
  { value: "auto", label: "Авто", icon: Sparkles },
  { value: "wood", label: "Дерево", icon: TreePine },
  { value: "stone", label: "Камень", icon: Mountain },
  { value: "metal", label: "Металл", icon: Cog },
  { value: "fabric", label: "Ткань", icon: Shirt },
]

const CATEGORY_LABEL: Record<MaterialCategory, string> = {
  auto: "авто",
  wood: "дерево",
  stone: "камень",
  metal: "металл",
  fabric: "ткань",
}

const LABELS: ToolComposerLabels = {
  filesTitle: "Референсы",
  filesQuality: "референсы",
  uploadTitle: "Загрузить референсы",
  filesCaption: "референсы не обязательны · задают тон материала",
  optionsTitle: "Материал",
  optionsIcon: Layers,
  footer:
    "Описание задаёт характер материала, референс — тон, семейство — рисунок. Результат — квадратный тайл 1024×1024.",
  inputPlaceholder: "Опишите материал…",
  submitLabel: "Сгенерировать",
  batchNoun: ["референс", "референса", "референсов"],
}

/** Задание на одну генерацию: без референса — чисто по описанию. */
interface MaterialJob {
  file?: File
  note: string
  category: MaterialCategory
}

/**
 * «Генерация материала» — тот же каркас, что у остальных инструментов
 * (см. docs/TOOL_UI.md): галерея, композер, панель с файлами и одним выбором.
 * Отличий два: референсы не обязательны — материал генерируется и по чистому
 * описанию, поэтому композер есть всегда; и пачка не просматривается на
 * сцене — панели-галереи и рабочего набора здесь нет. Пустой экран —
 * превью-сетка живых заготовок материалов в раскладке будущей галереи.
 */
export default function MaterialsPage() {
  const activeProject = useActiveProject()

  const materials = useMaterialStore((state) => state.materials)
  const add = useMaterialStore((state) => state.add)
  const update = useMaterialStore((state) => state.update)
  const remove = useMaterialStore((state) => state.remove)

  const intake = useAttachments({ maxFiles: MAX_BATCH })
  const { attachments } = intake
  const [note, setNote] = useState("")
  const [category, setCategory] = useState<MaterialCategory>("auto")

  const visible = activeProject ? materials.filter((item) => item.projectId === activeProject.id) : []

  /** Слот «ваш материал» в превью-сетке ведёт в поле описания композера. */
  const focusComposer = () => {
    document.querySelector<HTMLInputElement>(`input[aria-label="${LABELS.inputPlaceholder}"]`)?.focus()
  }

  const runGenerate = useCallback(
    async (meta: Material) => {
      try {
        // Референс не обязателен: без него генерация идёт по одному описанию.
        const ref = meta.sourceName ? await getBlob(sourceKey(meta.id)) : null
        if (meta.sourceName && !ref) {
          throw new Error("Референс ещё не синхронизирован. Генерация без него не запущена.")
        }
        const result = await generateMaterial({
          category: meta.category,
          note: meta.note,
          seed: meta.id,
          ref,
        })
        // Ответ провайдера уже оплачен: ставим персистентный маркер до
        // сетевой загрузки, чтобы «Повторить» никогда не вызвал модель снова.
        update(meta.id, {
          resultWidth: result.width,
          resultHeight: result.height,
          engine: result.engine,
          syncPending: true,
        })
        try {
          await persistResultDurably(meta.id, result.blob)
        } catch {
          update(meta.id, {
            status: "error",
            resultWidth: result.width,
            resultHeight: result.height,
            engine: result.engine,
            syncPending: true,
            error: "Материал готов, но не сохранился на сервере. «Повторить» только дозагрузит файл без новой генерации.",
          })
          return
        }
        update(meta.id, {
          status: "done",
          resultWidth: result.width,
          resultHeight: result.height,
          engine: result.engine,
          syncPending: undefined,
          generationUncertain: undefined,
          error: undefined,
        })
      } catch (error) {
        update(meta.id, {
          status: "error",
          error: error instanceof Error ? error.message : "Генерация не удалась.",
        })
      }
    },
    [update]
  )

  const startBatch = useCallback(
    async (jobs: MaterialJob[]) => {
      const project = ensureActiveProject()
      const metas: Material[] = []
      for (const job of jobs) {
        const base = { projectId: project.id, status: "processing" as const, category: job.category, note: job.note }
        if (!job.file) {
          metas.push({ ...base, id: createId(), createdAt: new Date().toISOString() })
          continue
        }
        try {
          const { id, width, height } = await saveSourceFile(job.file, { durable: true })
          metas.push({
            ...base,
            id,
            sourceName: job.file.name,
            sourceWidth: width,
            sourceHeight: height,
            createdAt: new Date().toISOString(),
          })
        } catch {
          window.alert(`«${job.file.name}» не удалось сохранить — материал пойдёт без референса.`)
          metas.push({ ...base, id: createId(), createdAt: new Date().toISOString() })
        }
      }
      await runGalleryQueue(metas, add, runGenerate)
    },
    [add, runGenerate]
  )

  const submit = () => {
    const description = note.trim()
    if (attachments.length === 0 && !description) {
      window.alert("Опишите материал или приложите референс.")
      return
    }
    const jobs: MaterialJob[] =
      attachments.length > 0
        ? attachments.map((item) => ({ file: item.file, note: description, category }))
        : [{ note: description, category }]
    intake.clearAttachments()
    setNote("")
    void startBatch(jobs)
  }

  const retry = (material: Material) => {
    update(material.id, { status: "processing", error: undefined })
    if (!material.syncPending) {
      void runGenerate(material)
      return
    }
    void repairPersistedResult(material.id).then(
      () =>
        update(material.id, {
          status: "done",
          syncPending: undefined,
          generationUncertain: undefined,
          error: undefined,
        }),
      (error) =>
        update(material.id, {
          status: "error",
          syncPending: true,
          error: error instanceof Error ? error.message : "Не удалось дозагрузить материал на сервер.",
        })
    )
  }

  const deleteMaterial = (material: Material) => {
    const confirmed = window.confirm("Удалить материал? Действие необратимо.")
    if (!confirmed) return
    remove(material.id)
  }

  return (
    <ToolShell
      intake={intake}
      dropLabel="Отпустите, чтобы приложить референсы"
      composerOpen
      layers={
        <ComposerDock>
          <ToolComposer
            attachments={attachments}
            onPickFiles={intake.pickFiles}
            onRemoveAttachment={intake.removeAttachment}
            onClearAttachments={intake.clearAttachments}
            note={note}
            onNoteChange={setNote}
            option={category}
            onOptionChange={setCategory}
            options={CATEGORY_OPTIONS}
            labels={LABELS}
            onSubmit={submit}
          />
        </ComposerDock>
      }
    >
      {visible.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-5 py-4">
          {/* Заготовки будущей галереи вместо заголовка: сразу видно, какого
              рода тайлы здесь получают. Клики по заготовкам ничего не
              генерируют — галерея сменяет их только после собственной
              генерации пользователя; слот лишь ведёт в поле описания. */}
          <MaterialPreviewGrid className="max-w-[880px]" onActivate={focusComposer} />
          <button type="button" onClick={intake.pickFiles} className="btn-ghost">
            Приложить референсы
          </button>
        </div>
      ) : (
        <ToolGallery>
          {visible.map((material) => (
            <ToolCard
              key={material.id}
              item={material}
              caption={`${CATEGORY_LABEL[material.category] ?? "авто"}${material.note ? ` · ${material.note}` : ""}`}
              processingLabel="генерируем материал…"
              downloadBaseName={`material-${CATEGORY_LABEL[material.category] ?? "auto"}-${material.id.slice(0, 4)}`}
              onRetry={() => retry(material)}
              onDelete={() => deleteMaterial(material)}
            />
          ))}
        </ToolGallery>
      )}
    </ToolShell>
  )
}
