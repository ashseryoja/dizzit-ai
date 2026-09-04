"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Cog, Layers, Mountain, Shirt, Sparkles, TreePine } from "lucide-react"

import { MaterialPreviewGrid } from "@/components/tool/material-preview-grid"
import { ToolCard } from "@/components/tool/tool-card"
import {
  ToolComposer,
  type AttachedRender,
  type ToolComposerLabels,
  type ToolOption,
} from "@/components/tool/tool-composer"
import { PageLoader } from "@/components/page-loader"
import { useBlobGc } from "@/lib/blob-gc"
import {
  getBlob,
  putBlob,
  resultKey,
  sourceKey,
  thumbResultKey,
  thumbSourceKey,
} from "@/lib/blob-store"
import {
  MAX_BATCH,
  MAX_FILE_BYTES,
  isAcceptedRender,
  makeThumb,
  readImageSize,
} from "@/lib/enhance-engine"
import { generateMaterial } from "@/lib/material-engine"
import { useMounted } from "@/lib/use-mounted"
import { createId } from "@/lib/utils"
import { useMaterialStore } from "@/stores/material-store"
import { useProjectStore } from "@/stores/project-store"
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
 * «Генерация материала» — тот же UI, что у улучшения рендера: галерея,
 * композер, панель с файлами и одним выбором. Отличие механики одно:
 * референсы не обязательны — материал генерируется и по чистому описанию.
 * Пустой экран — превью-сетка живых заготовок материалов в раскладке
 * будущей галереи, чтобы сразу было видно, что здесь получают.
 */
export default function MaterialsPage() {
  const mounted = useMounted()

  const activeProjectId = useProjectStore((state) => state.activeProjectId)
  const projects = useProjectStore((state) => state.projects)
  const createProject = useProjectStore((state) => state.createProject)
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null

  const materials = useMaterialStore((state) => state.materials)
  const add = useMaterialStore((state) => state.add)
  const update = useMaterialStore((state) => state.update)
  const remove = useMaterialStore((state) => state.remove)

  const [attachments, setAttachments] = useState<AttachedRender[]>([])
  const [note, setNote] = useState("")
  const [category, setCategory] = useState<MaterialCategory>("auto")
  const [dragOver, setDragOver] = useState(false)
  const dragDepth = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const visible = activeProject
    ? materials.filter((item) => item.projectId === activeProject.id)
    : []

  // GC общего хранилища блобов — после гидрации сторов ВСЕХ инструментов.
  useBlobGc()

  const removeAttachment = useCallback((index: number) => {
    setAttachments((current) => {
      const target = current[index]
      if (target) URL.revokeObjectURL(target.previewUrl)
      return current.filter((_, i) => i !== index)
    })
  }, [])

  const clearAttachments = useCallback(() => {
    setAttachments((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
      return []
    })
  }, [])

  /* Приём файлов — тот же, что в улучшении рендера: три пути, одни правила. */
  const attachFiles = useCallback(async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith("image/"))
    if (images.length === 0) return

    const rejected: string[] = []
    const accepted: AttachedRender[] = []
    for (const file of images) {
      if (!isAcceptedRender(file) || file.size > MAX_FILE_BYTES) {
        rejected.push(file.name)
        continue
      }
      try {
        const { width, height } = await readImageSize(file)
        accepted.push({ file, width, height, previewUrl: URL.createObjectURL(file) })
      } catch {
        rejected.push(file.name)
      }
    }

    let overflow = 0
    setAttachments((current) => {
      const room = Math.max(0, MAX_BATCH - current.length)
      overflow = accepted.length - room
      const taken = accepted.slice(0, room)
      accepted.slice(room).forEach((item) => URL.revokeObjectURL(item.previewUrl))
      return [...current, ...taken]
    })

    const warnings: string[] = []
    if (rejected.length > 0) {
      warnings.push(`Не приняты: ${rejected.join(", ")} — только PNG/JPG/WEBP до 32 МБ.`)
    }
    if (overflow > 0) {
      warnings.push(`Больше ${MAX_BATCH} файлов за раз нельзя — лишние ${overflow} не добавлены.`)
    }
    if (warnings.length > 0) window.alert(warnings.join("\n"))
  }, [])

  const pickFiles = () => fileInputRef.current?.click()

  /** Слот «ваш материал» в превью-сетке ведёт в поле описания композера. */
  const focusComposer = () => {
    document
      .querySelector<HTMLInputElement>(`input[aria-label="${LABELS.inputPlaceholder}"]`)
      ?.focus()
  }

  const runGenerate = useCallback(
    async (meta: Material) => {
      try {
        // Референс не обязателен: без него генерация идёт по одному описанию.
        const ref = meta.sourceName ? await getBlob(sourceKey(meta.id)) : null
        const result = await generateMaterial({
          category: meta.category,
          note: meta.note,
          seed: meta.id,
          ref,
        })
        await putBlob(resultKey(meta.id), result.blob)
        await putBlob(thumbResultKey(meta.id), await makeThumb(result.blob))
        update(meta.id, {
          status: "done",
          resultWidth: result.width,
          resultHeight: result.height,
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

  /* Пачка заданий: карточки появляются сразу, генерация — по одной. */
  const startBatch = useCallback(
    async (jobs: MaterialJob[]) => {
      const project = activeProject ?? createProject()

      const metas: Material[] = []
      for (const job of jobs) {
        const id = createId()
        const meta: Material = {
          id,
          projectId: project.id,
          status: "processing",
          category: job.category,
          note: job.note,
          createdAt: new Date().toISOString(),
        }
        if (job.file) {
          try {
            const { width, height } = await readImageSize(job.file)
            await putBlob(sourceKey(id), job.file)
            await putBlob(thumbSourceKey(id), await makeThumb(job.file))
            meta.sourceName = job.file.name
            meta.sourceWidth = width
            meta.sourceHeight = height
          } catch {
            window.alert(`«${job.file.name}» не удалось сохранить — материал пойдёт без референса.`)
          }
        }
        metas.push(meta)
      }

      for (const meta of [...metas].reverse()) add(meta)
      for (const meta of metas) await runGenerate(meta)
    },
    [activeProject, createProject, add, runGenerate]
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
    clearAttachments()
    setNote("")
    void startBatch(jobs)
  }

  const retry = (material: Material) => {
    update(material.id, { status: "processing", error: undefined })
    void runGenerate(material)
  }

  const deleteMaterial = (material: Material) => {
    const confirmed = window.confirm("Удалить материал? Действие необратимо.")
    if (!confirmed) return
    remove(material.id)
  }

  const onDragEnter = (event: React.DragEvent) => {
    event.preventDefault()
    dragDepth.current += 1
    setDragOver(true)
  }
  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragOver(false)
  }
  const onDrop = (event: React.DragEvent) => {
    event.preventDefault()
    dragDepth.current = 0
    setDragOver(false)
    const files = Array.from(event.dataTransfer.files ?? [])
    if (files.length > 0) void attachFiles(files)
  }

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? [])
      if (files.length > 0) void attachFiles(files)
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [attachFiles])

  if (!mounted) {
    return (
      <div className="page-shell">
        <PageLoader />
      </div>
    )
  }

  return (
    <div
      onDragEnter={onDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className="page-shell pb-32"
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          event.target.value = ""
          if (files.length > 0) void attachFiles(files)
        }}
      />

      {dragOver ? (
        <div
          className="pointer-events-none fixed inset-3 z-50 flex items-center justify-center"
          style={{
            border: "2px dashed var(--accent)",
            borderRadius: "var(--r-xl)",
            background: "rgba(16,16,18,0.55)",
          }}
        >
          <span className="text-[15px]" style={{ color: "var(--fg-1)" }}>
            Отпустите, чтобы приложить референсы
          </span>
        </div>
      ) : null}

      <div className="page-content-wide flex flex-1 flex-col">
        {visible.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-5 py-4">
            {/* Заготовки будущей галереи вместо заголовка: сразу видно, какого
                рода тайлы здесь получают. Клики по заготовкам ничего не
                генерируют — галерея сменяет их только после собственной
                генерации пользователя; слот лишь ведёт в поле описания. */}
            <MaterialPreviewGrid className="max-w-[880px]" onActivate={focusComposer} />
            <button type="button" onClick={pickFiles} className="btn-ghost">
              Приложить референсы
            </button>
          </div>
        ) : (
          <div className="columns-1 gap-4 sm:columns-2 xl:columns-3">
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
          </div>
        )}
      </div>

      <div className="pointer-events-none fixed inset-x-3 bottom-3 z-30 flex justify-center lg:left-[312px] lg:right-8 lg:bottom-5">
        <ToolComposer
          attachments={attachments}
          onPickFiles={pickFiles}
          onRemoveAttachment={removeAttachment}
          onClearAttachments={clearAttachments}
          note={note}
          onNoteChange={setNote}
          option={category}
          onOptionChange={setCategory}
          options={CATEGORY_OPTIONS}
          labels={LABELS}
          onSubmit={submit}
        />
      </div>
    </div>
  )
}
