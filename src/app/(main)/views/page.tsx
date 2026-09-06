"use client"

import { useCallback, useState } from "react"
import { Camera, Crop, Images, ZoomIn } from "lucide-react"

import { RenderStrip, RenderTray } from "@/components/tool/render-tray"
import { BatchGrid, Stage } from "@/components/tool/stage"
import { ToolComposer, type ToolComposerLabels, type ToolOption } from "@/components/tool/tool-composer"
import { ToolDropzone } from "@/components/tool/tool-dropzone"
import { ComposerDock, ToolAside, ToolGallery, ToolShell } from "@/components/tool/tool-shell"
import { ViewSetCard } from "@/components/tool/view-set-card"
import { ViewsInvite } from "@/components/tool/views-invite"
import { getBlob, putBlob, sourceKey } from "@/lib/blob-store"
import { MAX_BATCH, makeThumb } from "@/lib/enhance-engine"
import { runGalleryQueue, saveSourceFile } from "@/lib/tool-jobs"
import { useAttachments } from "@/lib/use-attachments"
import { useBatchSelection } from "@/lib/use-batch-selection"
import { usePresence } from "@/lib/use-presence"
import { fileBaseName, mapWithConcurrency, plural } from "@/lib/utils"
import { PRESET_LABEL, SHOT_LABEL, framesOf, prepareViewSet, viewKey, viewThumbKey } from "@/lib/view-engine"
import { ensureActiveProject, useActiveProject } from "@/stores/project-store"
import { useViewsStore } from "@/stores/views-store"
import type { ShotKind, ViewFrame, ViewPreset, ViewSet } from "@/types"

const PRESET_OPTIONS: ToolOption<ViewPreset>[] = [
  { value: "set", label: "Сет", icon: Images },
  { value: "details", label: "Детали", icon: ZoomIn },
  { value: "angles", label: "Ракурсы", icon: Camera },
  { value: "fragments", label: "Фрагменты", icon: Crop },
]

const LABELS: ToolComposerLabels = {
  filesTitle: "Общие планы",
  filesQuality: "исходники",
  uploadTitle: "Загрузить рендеры",
  filesCaption: "по одному сету на каждый рендер · крупные планы 4:5, ракурсы в 2K",
  optionsTitle: "Что снять",
  optionsIcon: Camera,
  footer:
    "Сцена остаётся той же — меняются кадрирование и точка съёмки. Сет — готовая карусель по одному рендеру: вид сверху и снизу, две детали крупно, фактура и фрагмент.",
  inputPlaceholder: "Что показать крупно: ваза, кресло, торшер…",
  submitLabel: "Построить",
  batchNoun: ["рендер", "рендера", "рендеров"],
}

/** Сколько кадров сета считается одновременно: быстрее, чем по одному, и без шторма запросов к провайдеру. */
const FRAME_CONCURRENCY = 3

/** Состав набора одной строкой: «сверху, снизу, деталь ×2, фактура, фрагмент». */
function describeFrames(frames: ViewFrame[]): string {
  const counts = new Map<ShotKind, number>()
  for (const frame of frames) counts.set(frame.kind, (counts.get(frame.kind) ?? 0) + 1)
  return [...counts].map(([kind, n]) => (n > 1 ? `${SHOT_LABEL[kind]} ×${n}` : SHOT_LABEL[kind])).join(", ")
}

/**
 * «Ракурсы и детали» — из одного общего рендера раскадровка для публикации,
 * как в карусели дизайнера: детали крупно, фактуры, фрагменты и виды с других
 * точек, без 3D-модели. Каркас, приём файлов, панель-галерея пачки, сцена и
 * рабочий набор — общие для инструментов (см. docs/TOOL_UI.md). Своё у
 * ракурсов: выбор набора кадров, подпись под сценой о том, какие кадры
 * получатся, и карточка-контактный лист вместо обычной карточки.
 *
 * Сет строится по РАБОЧЕМУ НАБОРУ: в обычном режиме это рендер на сцене,
 * в режиме «Выбрать» панели — отмеченные; «Построить все» показывает набор
 * гридом вместо сцены. Каждый рендер пачки даёт свой сет; кадры внутри сета
 * считаются по несколько разом, и карточка догоняет их плитка за плиткой.
 */
export default function ViewsPage() {
  const activeProject = useActiveProject()

  const sets = useViewsStore((state) => state.sets)
  const add = useViewsStore((state) => state.add)
  const update = useViewsStore((state) => state.update)
  const remove = useViewsStore((state) => state.remove)

  const intake = useAttachments({ maxFiles: MAX_BATCH })
  const batch = useBatchSelection(intake, { noun: LABELS.batchNoun })
  const { attachments, current, focusIndex, pickedItems, workingSet, showBatchGrid } = batch

  const [note, setNote] = useState("")
  const [preset, setPreset] = useState<ViewPreset>("set")
  const [settingsOpen, setSettingsOpen] = useState(false)

  const visible = activeProject ? sets.filter((item) => item.projectId === activeProject.id) : []
  const hasAttachments = attachments.length > 0
  const showComposer = hasAttachments || visible.length > 0
  const composer = usePresence(showComposer)
  const tray = usePresence(hasAttachments)

  /* Кадры сета считаются по несколько разом; готовые сразу отмечаются в
     записи, чтобы карточка показывала их, не дожидаясь всего сета. Подготовка
     (референс для модели или план вырезок предпросмотра) — один раз на сет. */
  const runSet = useCallback(
    async (meta: ViewSet) => {
      try {
        const source = await getBlob(sourceKey(meta.id))
        if (!source) throw new Error("Исходник не найден в хранилище браузера.")
        const renderer = await prepareViewSet(source, meta.frames, meta.note)
        const ready: string[] = []
        let engine: string | undefined
        await mapWithConcurrency(meta.frames, FRAME_CONCURRENCY, async (frame) => {
          const result = await renderer.render(frame)
          await putBlob(viewKey(meta.id, frame.key), result.blob)
          await putBlob(viewThumbKey(meta.id, frame.key), await makeThumb(result.blob))
          ready.push(frame.key)
          engine = result.engine
          update(meta.id, { ready: [...ready] })
        })
        update(meta.id, {
          status: "done",
          resultWidth: meta.sourceWidth,
          resultHeight: meta.sourceHeight,
          engine,
          error: undefined,
        })
      } catch (error) {
        update(meta.id, {
          status: "error",
          error: error instanceof Error ? error.message : "Построение сета не удалось.",
        })
      }
    },
    [update]
  )

  const startBatch = useCallback(
    async (files: File[], batchNote: string, batchPreset: ViewPreset) => {
      const project = ensureActiveProject()
      const metas: ViewSet[] = []
      for (const file of files) {
        try {
          const { id, width, height } = await saveSourceFile(file)
          metas.push({
            id,
            projectId: project.id,
            status: "processing",
            preset: batchPreset,
            frames: framesOf(batchPreset),
            ready: [],
            note: batchNote,
            sourceName: file.name,
            sourceWidth: width,
            sourceHeight: height,
            createdAt: new Date().toISOString(),
          })
        } catch {
          window.alert(`«${file.name}» не удалось сохранить в хранилище браузера.`)
        }
      }
      await runGalleryQueue(metas, add, runSet)
    },
    [add, runSet]
  )

  const submit = () => {
    if (attachments.length === 0) {
      intake.pickFiles()
      return
    }
    if (workingSet.length === 0) return
    const sentNote = note.trim()
    const { files } = batch.takeWorkingSet()
    setNote("")
    setSettingsOpen(false)
    void startBatch(files, sentNote, preset)
  }

  const retry = (item: ViewSet) => {
    update(item.id, { status: "processing", ready: [], error: undefined })
    void runSet({ ...item, ready: [] })
  }

  const deleteSet = (item: ViewSet) => {
    const confirmed = window.confirm("Удалить сет кадров вместе с результатами? Действие необратимо.")
    if (!confirmed) return
    remove(item.id)
  }

  /* Подпись под сценой: какие кадры даст выбранный набор и по чему. */
  const frames = framesOf(preset)
  const frameCount = `${frames.length} ${plural(frames.length, ["кадр", "кадра", "кадров"])}`
  const stageCaption =
    workingSet.length === 0
      ? "Ничего не выбрано — отметьте рендеры в панели справа."
      : workingSet.length === 1
        ? `${PRESET_LABEL[preset]} — ${frameCount} по рендеру на сцене: ${describeFrames(frames)}.`
        : `${PRESET_LABEL[preset]} — ${frameCount} на каждый из ${workingSet.length} выбранных ${LABELS.batchNoun[2]}: ${describeFrames(frames)}.`

  return (
    <ToolShell
      intake={intake}
      dropLabel="Отпустите, чтобы приложить рендеры"
      composerOpen={showComposer}
      trayOpen={tray.present}
      layers={
        <>
          <ComposerDock presence={composer} trayOpen={tray.present}>
            <ToolComposer
              attachments={attachments}
              onPickFiles={intake.pickFiles}
              onRemoveAttachment={batch.removeAttachment}
              onClearAttachments={batch.clearAttachments}
              note={note}
              onNoteChange={setNote}
              option={preset}
              onOptionChange={setPreset}
              options={PRESET_OPTIONS}
              labels={LABELS}
              onSubmit={submit}
              selectionLabel={batch.selectionLabel}
              settingsOpen={settingsOpen}
              onSettingsOpenChange={setSettingsOpen}
            />
          </ComposerDock>

          <ToolAside presence={tray} label="Приложенные рендеры">
            <RenderTray {...batch.trayProps} editLabel={LABELS.submitLabel} />
          </ToolAside>
        </>
      }
    >
      {current ? (
        /* Режим просмотра пачки: выбранный рендер во весь экран, под ним — какие
           кадры даст набор; на узких экранах — полоска миниатюр. В пакетной
           раскадровке вместо сцены — грид набора. */
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {showBatchGrid ? (
            <BatchGrid items={pickedItems} title="Пакетная раскадровка" noun={LABELS.batchNoun} onLeave={batch.leaveBatch} />
          ) : (
            <Stage
              attachment={current}
              index={focusIndex}
              count={attachments.length}
              onPrev={batch.selectPrev}
              onNext={batch.selectNext}
            />
          )}

          <p className="ds-caption px-1">{stageCaption}</p>

          <div className="lg:hidden">
            <RenderStrip {...batch.trayProps} editLabel={LABELS.submitLabel} />
          </div>
        </div>
      ) : visible.length === 0 ? (
        /* Зона приёма: слева общий план, справа кадры, которые из него получают (см. .vo-* в surfaces.css). */
        <ToolDropzone
          onPick={intake.pickFiles}
          label="Добавить рендер"
          visual={<ViewsInvite className="relative w-full max-w-[600px]" />}
          title="Добавить рендер"
          description={`Один общий план — и из него сет кадров для публикации: детали крупно, фактуры, фрагменты, вид сверху и снизу. Нажмите, перетащите сюда или вставьте из буфера. PNG, JPG или WEBP до 32 МБ, до ${MAX_BATCH} файлов за раз.`}
          caption="Как карусель дизайнера: общий план и крупные планы предметов — по одному рендеру, без 3D-модели и повторного рендера."
          className="max-w-[760px] gap-6 px-6 pb-10 pt-8 sm:pb-12 sm:pt-10"
        />
      ) : (
        <ToolGallery>
          {visible.map((item) => (
            <ViewSetCard
              key={item.id}
              item={item}
              downloadBaseName={`${fileBaseName(item.sourceName, "render")}-shot`}
              onRetry={() => retry(item)}
              onDelete={() => deleteSet(item)}
            />
          ))}
        </ToolGallery>
      )}
    </ToolShell>
  )
}
