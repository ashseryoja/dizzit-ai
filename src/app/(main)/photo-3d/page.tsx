"use client"

import { useCallback, useState } from "react"
import { Armchair, Box, LampDesk, Library, RefreshCw, Sofa, Sparkles, Table, Trash2 } from "lucide-react"

import { ThinkingGlyph } from "@/components/glyphs"
import { FurnitureMorph } from "@/components/tool/furniture-morph"
import { useBlobUrl } from "@/components/tool/tool-card"
import { ToolComposer, type ToolComposerLabels, type ToolOption } from "@/components/tool/tool-composer"
import { ToolDropzone } from "@/components/tool/tool-dropzone"
import { ComposerDock, ToolShell } from "@/components/tool/tool-shell"
import { thumbSourceKey } from "@/lib/blob-store"
import { SHAPE_LABEL } from "@/lib/furniture-wire"
import { buildModelLocally, resolveShape, type FurnitureOption } from "@/lib/model-engine"
import { saveSourceFile } from "@/lib/tool-jobs"
import { useAttachments } from "@/lib/use-attachments"
import { usePresence } from "@/lib/use-presence"
import { cn, plural } from "@/lib/utils"
import { useModelStore } from "@/stores/model-store"
import { ensureActiveProject, useActiveProject } from "@/stores/project-store"
import type { Model3D } from "@/types"

const SHAPE_OPTIONS: ToolOption<FurnitureOption>[] = [
  { value: "auto", label: "Авто", icon: Sparkles },
  { value: "chair", label: "Стул", icon: Armchair },
  { value: "table", label: "Стол", icon: Table },
  { value: "lamp", label: "Лампа", icon: LampDesk },
  { value: "sofa", label: "Диван", icon: Sofa },
  { value: "shelf", label: "Стеллаж", icon: Library },
]

const LABELS: ToolComposerLabels = {
  filesTitle: "Фото",
  filesQuality: "фото",
  uploadTitle: "Загрузить фото",
  filesCaption: "один предмет в кадре · нейтральный фон · предмет целиком",
  optionsTitle: "Предмет",
  optionsIcon: Box,
  footer:
    "Модель строится по одному фото: предмет угадывается по кадру и описанию. Экспорт в GLB/OBJ появится с подключением провайдера.",
  inputPlaceholder: "Комментарий к модели…",
  submitLabel: "Создать 3D",
  batchNoun: ["фото", "фото", "фото"],
}

const formatCount = (value: number) => new Intl.NumberFormat("ru-RU").format(value)

/**
 * «Фото → 3D». Одно фото — одна модель: новое фото заменяет приложенное.
 * Каркас, приём файлов и композер — общие для инструментов (см.
 * docs/TOOL_UI.md); панели-галереи пачки и сцены рендера здесь нет — вместо
 * них своя сцена модели. Пустой экран — большая зона, в которой каркасы мебели
 * перетекают друг в друга: показывает, что здесь получают. После генерации
 * та же сцена показывает результат крупно, а остальные модели проекта —
 * лентой под ней.
 */
export default function PhotoTo3DPage() {
  const activeProject = useActiveProject()

  const models = useModelStore((state) => state.models)
  const add = useModelStore((state) => state.add)
  const update = useModelStore((state) => state.update)
  const remove = useModelStore((state) => state.remove)

  const intake = useAttachments({ maxFiles: 1, replace: true })
  const { attachments } = intake
  const [note, setNote] = useState("")
  const [option, setOption] = useState<FurnitureOption>("auto")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const visible = activeProject ? models.filter((item) => item.projectId === activeProject.id) : []
  // Выбранная модель — либо та, что кликнули в ленте, либо самая свежая.
  const selected = visible.find((item) => item.id === selectedId) ?? visible[0] ?? null
  const hasAttachments = attachments.length > 0
  const showComposer = hasAttachments || visible.length > 0
  const composer = usePresence(showComposer)

  const runBuild = useCallback(
    async (meta: Model3D) => {
      try {
        const stats = await buildModelLocally(meta.shape)
        update(meta.id, { status: "done", error: undefined, ...stats })
      } catch (error) {
        update(meta.id, {
          status: "error",
          error: error instanceof Error ? error.message : "Построение не удалось.",
        })
      }
    },
    [update]
  )

  const startBuild = useCallback(
    async (file: File, buildNote: string, buildOption: FurnitureOption) => {
      const project = ensureActiveProject()
      try {
        const { id, width, height } = await saveSourceFile(file)
        const meta: Model3D = {
          id,
          projectId: project.id,
          status: "processing",
          shape: resolveShape(buildOption, buildNote, file.name),
          note: buildNote,
          sourceName: file.name,
          sourceWidth: width,
          sourceHeight: height,
          createdAt: new Date().toISOString(),
        }
        add(meta)
        setSelectedId(id)
        await runBuild(meta)
      } catch {
        window.alert(`«${file.name}» не удалось сохранить в хранилище браузера.`)
      }
    },
    [add, runBuild]
  )

  const submit = () => {
    const photo = attachments[0]
    if (!photo) {
      intake.pickFiles()
      return
    }
    intake.clearAttachments()
    const buildNote = note.trim()
    setNote("")
    void startBuild(photo.file, buildNote, option)
  }

  const retry = (model: Model3D) => {
    update(model.id, { status: "processing", error: undefined })
    void runBuild(model)
  }

  const deleteModel = (model: Model3D) => {
    const confirmed = window.confirm("Удалить модель вместе с фото? Действие необратимо.")
    if (!confirmed) return
    remove(model.id)
  }

  return (
    <ToolShell
      intake={intake}
      dropLabel="Отпустите, чтобы приложить фото"
      composerOpen={showComposer}
      layers={
        <ComposerDock presence={composer}>
          <ToolComposer
            attachments={attachments}
            onPickFiles={intake.pickFiles}
            onRemoveAttachment={intake.removeAttachment}
            onClearAttachments={intake.clearAttachments}
            note={note}
            onNoteChange={setNote}
            option={option}
            onOptionChange={setOption}
            options={SHAPE_OPTIONS}
            labels={LABELS}
            onSubmit={submit}
            maxFiles={1}
          />
        </ComposerDock>
      }
    >
      {visible.length === 0 ? (
        /* Сцена-приглашение: каркасы мебели перетекают друг в друга. Приложенное
           фото держит контур подсвеченным — как приглашение нажать «Создать 3D». */
        <ToolDropzone
          onPick={intake.pickFiles}
          label={hasAttachments ? "Заменить фото" : "Добавить фото"}
          armed={hasAttachments}
          visual={<FurnitureMorph showLabel className="relative h-[300px] w-full max-w-[520px] sm:h-[340px]" />}
          title={hasAttachments ? "Фото приложено" : "Добавить фото"}
          description={
            hasAttachments
              ? `«${attachments[0].file.name}» — нажмите «${LABELS.submitLabel}» внизу или выберите другое фото.`
              : "Один предмет в кадре — стул, стол, лампа, диван — и получите его 3D-модель. Нажмите, перетащите сюда или вставьте из буфера. PNG, JPG или WEBP до 32 МБ."
          }
          caption="Модель строится по одному фото, без разметки и ручной настройки."
          className="max-w-[760px] gap-2 px-6 pb-10 pt-4 sm:pb-12"
        />
      ) : (
        <div className="flex flex-col gap-4">
          {selected ? (
            <ModelStage model={selected} onRetry={() => retry(selected)} onDelete={() => deleteModel(selected)} />
          ) : null}

          {visible.length > 1 ? (
            <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
              {visible.map((model) => (
                <ModelChip
                  key={model.id}
                  model={model}
                  active={model.id === selected?.id}
                  onClick={() => setSelectedId(model.id)}
                />
              ))}
            </div>
          ) : null}
        </div>
      )}
    </ToolShell>
  )
}

/** Большая сцена результата: модель крупно, фото-исходник в углу, подпись и действия. */
function ModelStage({
  model,
  onRetry,
  onDelete,
}: {
  model: Model3D
  onRetry: () => void
  onDelete: () => void
}) {
  const sourceThumb = useBlobUrl(thumbSourceKey(model.id))
  const done = model.status === "done"

  return (
    <figure className="card relative overflow-hidden" style={{ borderRadius: "var(--r-xl)" }}>
      {/* Пока строится — библиотека перетекает («ищем форму»), готовая модель — одна и вращается. */}
      <FurnitureMorph
        key={done ? model.shape : "searching"}
        shape={done ? model.shape : undefined}
        className={cn("h-[52dvh] min-h-[360px] w-full", model.status === "error" && "opacity-30")}
      />

      {sourceThumb ? (
        <div
          className="fade-in absolute left-3 top-3 flex items-center gap-2 rounded-[10px] p-1 pr-3"
          style={{ background: "rgba(16,16,18,0.62)", border: "1px solid rgba(255,255,255,0.12)" }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={sourceThumb} alt="" aria-hidden className="h-12 w-12 rounded-[7px] object-cover" draggable={false} />
          <span className="flex flex-col">
            <span className="text-[11px] uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.5)" }}>
              фото
            </span>
            <span className="max-w-[160px] truncate text-[12px]" style={{ color: "rgba(255,255,255,0.9)" }}>
              {model.sourceName}
            </span>
          </span>
        </div>
      ) : null}

      <div className="absolute right-3 top-3 flex gap-1">
        {model.status !== "processing" ? (
          <button type="button" onClick={onRetry} aria-label="Построить заново" className="btn-icon h-9 w-9" style={{ background: "rgba(16,16,18,0.62)" }}>
            <RefreshCw className="h-4 w-4" strokeWidth={1.7} />
          </button>
        ) : null}
        <button type="button" onClick={onDelete} aria-label="Удалить модель" className="btn-icon btn-danger h-9 w-9" style={{ background: "rgba(16,16,18,0.62)" }}>
          <Trash2 className="h-4 w-4" strokeWidth={1.7} />
        </button>
      </div>

      {model.status === "processing" ? (
        <div className="fade-in pointer-events-none absolute inset-x-0 bottom-4 flex flex-col items-center gap-2">
          <ThinkingGlyph size={22} className="text-white/80" />
          <span className="text-[12px]" style={{ color: "var(--fg-3)" }}>
            строим модель по фото…
          </span>
        </div>
      ) : null}

      {model.status === "error" ? (
        <div className="fade-in absolute inset-0 flex flex-col items-center justify-center gap-3 p-4 text-center">
          <p className="max-w-[280px] text-[12.5px] leading-snug" style={{ color: "var(--fg-1)" }}>
            {model.error ?? "Не получилось."}
          </p>
          <button type="button" onClick={onRetry} className="btn-outline h-9 px-4 text-[13px]">
            <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
            Повторить
          </button>
        </div>
      ) : null}

      {done ? (
        <figcaption
          className="rise-in absolute bottom-3 left-3 flex flex-col gap-0.5 rounded-[8px] px-2.5 py-1.5"
          style={{ background: "rgba(16,16,18,0.62)" }}
        >
          <span className="text-[13px]" style={{ color: "rgba(255,255,255,0.92)" }}>
            {SHAPE_LABEL[model.shape]}
            {model.note ? ` · ${model.note}` : ""}
          </span>
          {model.vertexCount && model.edgeCount ? (
            <span className="text-[11px]" style={{ color: "rgba(255,255,255,0.55)" }}>
              каркас · {formatCount(model.vertexCount)} {plural(model.vertexCount, ["вершина", "вершины", "вершин"])} ·{" "}
              {formatCount(model.edgeCount)} {plural(model.edgeCount, ["ребро", "ребра", "рёбер"])} · экспорт GLB появится с
              провайдером
            </span>
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  )
}

/** Лента моделей проекта под сценой. */
function ModelChip({ model, active, onClick }: { model: Model3D; active: boolean; onClick: () => void }) {
  const thumb = useBlobUrl(thumbSourceKey(model.id))
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn("nav-item h-14 shrink-0 gap-2.5 pl-1.5 pr-3", active && "is-active")}
      style={{ borderRadius: "var(--r-md)" }}
    >
      {thumb ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb} alt="" aria-hidden className="h-11 w-11 rounded-[8px] object-cover" draggable={false} />
      ) : (
        <span className="h-11 w-11 rounded-[8px]" style={{ background: "var(--bg-raised)" }} />
      )}
      <span className="flex flex-col text-left">
        <span className="text-[13px]" style={{ color: "var(--fg-1)" }}>
          {SHAPE_LABEL[model.shape]}
        </span>
        <span className="max-w-[160px] truncate text-[11px]" style={{ color: "var(--fg-5)" }}>
          {model.status === "processing" ? "строим…" : model.status === "error" ? "ошибка" : model.note || model.sourceName}
        </span>
      </span>
    </button>
  )
}
