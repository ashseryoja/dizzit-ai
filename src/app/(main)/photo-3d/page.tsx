"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Box } from "lucide-react"

import { FurnitureMorph } from "@/components/tool/furniture-morph"
import { showToast } from "@/components/ui/toast"
import { ModelDock } from "@/components/tool/model-dock"
import { ModelLibrary, ModelLibraryStrip } from "@/components/tool/model-library"
import { ModelStage } from "@/components/tool/model-stage"
import { ToolComposer, type ToolComposerLabels } from "@/components/tool/tool-composer"
import { ToolDropzone } from "@/components/tool/tool-dropzone"
import { ComposerDock, ToolAside, ToolShell } from "@/components/tool/tool-shell"
import { getBlob, modelKey, putBlob, putLocalBlob, sourceKey, thumbResultKey, viewKey } from "@/lib/blob-store"
import {
  awaitModelTask,
  buildModelLocally,
  fetchModelFile,
  MESHY_ENGINE,
  MODEL_FORMATS,
  ModelBuildError,
  modelProviderStatus,
  PREVIEW_ENGINE,
  readGlbStats,
  resolveShape,
  submitModelTask,
  type ModelTaskProgress,
} from "@/lib/model-engine"
import { saveSourceFile } from "@/lib/tool-jobs"
import { useAttachments } from "@/lib/use-attachments"
import { useIsMobile } from "@/lib/use-is-mobile"
import { usePresence } from "@/lib/use-presence"
import { useViewSlots } from "@/lib/use-view-slots"
import { cn } from "@/lib/utils"
import {
  MODEL_MAX_PHOTOS,
  estimateModelCost,
  modelAiInfo,
  type ModelSettings,
  type ModelSlot,
  type ModelViewRole,
} from "@/shared/model3d"
import { useModelStore } from "@/stores/model-store"
import { ensureActiveProject, useActiveProject } from "@/stores/project-store"
import type { Model3D, ModelFormat } from "@/types"

const LABELS: ToolComposerLabels = {
  filesTitle: "Фото",
  filesQuality: "фото",
  uploadTitle: "Загрузить фото",
  filesCaption: "один предмет в кадре · нейтральный фон · предмет целиком",
  optionsTitle: "Предмет",
  optionsIcon: Box,
  footer: "",
  inputPlaceholder: "Название или комментарий к модели…",
  submitLabel: "Создать 3D",
  batchNoun: ["фото", "фото", "фото"],
}

/**
 * «Фото → 3D» — экран по образцу рабочего пространства Meshy (см.
 * docs/TOOL_UI.md): панель генерации над композером (`ModelDock`: фото и
 * ракурсы, модель, детализация, текстура), сцена модели в центре
 * (`ModelStage`), библиотека моделей проекта справа (`ModelLibrary`). У Meshy
 * панель генерации слева — у нас там сайдбар, поэтому она внизу.
 *
 * Модель считает Meshy (lib/model-engine → /api/models): задача ставится один
 * раз, её id хранится в записи, и опрос переживает перезагрузку страницы —
 * повторно кредиты не тратятся. Без ключа — каркас-заглушка из библиотеки.
 */
export default function PhotoTo3DPage() {
  const activeProject = useActiveProject()

  const models = useModelStore((state) => state.models)
  const add = useModelStore((state) => state.add)
  const update = useModelStore((state) => state.update)
  const remove = useModelStore((state) => state.remove)
  const settings = useModelStore((state) => state.settings)
  const setSettings = useModelStore((state) => state.setSettings)
  const multiView = useModelStore((state) => state.multiView)
  const setMultiView = useModelStore((state) => state.setMultiView)

  const [configured, setConfigured] = useState<boolean | null>(null)
  useEffect(() => {
    void modelProviderStatus().then((status) => setConfigured(status.configured))
  }, [])

  // Несколько ракурсов принимает только флагман — с другой моделью пачка снова из одного фото.
  const multiOn = multiView && modelAiInfo(settings.ai).multiView && configured !== false
  const intake = useAttachments({ maxFiles: multiOn ? MODEL_MAX_PHOTOS : 1, replace: !multiOn })
  const slots = useViewSlots(intake, multiOn)

  const [note, setNote] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  // Панель генерации развёрнута на широком экране и свёрнута на телефоне, пока её не тронули.
  const narrow = useIsMobile(767)
  const [dockChoice, setDockChoice] = useState<boolean | null>(null)
  const dockOpen = dockChoice ?? !narrow
  // Ход задач Meshy живёт в состоянии страницы, а не в записи: иначе каждый
  // процент уезжал бы синхронизацией на сервер.
  const [progress, setProgress] = useState<Record<string, ModelTaskProgress>>({})
  const building = useRef(new Set<string>())
  const collecting = useRef(new Set<string>())

  const visible = activeProject ? models.filter((item) => item.projectId === activeProject.id) : []
  // Выбранная модель — либо та, что кликнули в библиотеке, либо самая свежая.
  const selected = visible.find((item) => item.id === selectedId) ?? visible[0] ?? null
  const library = usePresence(visible.length > 0)

  const runBuild = useCallback(
    async (meta: Model3D) => {
      if (building.current.has(meta.id)) return
      building.current.add(meta.id)
      try {
        const provider = await modelProviderStatus()
        if (!provider.configured) {
          const stats = await buildModelLocally(meta.shape)
          update(meta.id, { status: "done", error: undefined, engine: PREVIEW_ENGINE, ...stats })
          return
        }
        let taskId = meta.taskId
        let kind = meta.taskKind ?? "image"
        if (!taskId) {
          const main = await getBlob(sourceKey(meta.id))
          if (!main) throw new ModelBuildError("Фото не найдено в хранилище — приложите его заново.", true)
          const views = await Promise.all((meta.views ?? []).map((role) => getBlob(viewKey(meta.id, role)).catch(() => null)))
          const photos = [main, ...views.filter((blob): blob is Blob => Boolean(blob))]
          const jobSettings = meta.settings ?? useModelStore.getState().settings
          const task = await submitModelTask(photos, jobSettings)
          taskId = task.taskId
          kind = task.kind
          update(meta.id, { taskId, taskKind: kind, settings: jobSettings })
        }
        const { credits } = await awaitModelTask(taskId, kind, (step) => setProgress((current) => ({ ...current, [meta.id]: step })))
        const glb = await fetchModelFile(taskId, meta.id, kind)
        // Кэш браузера; при серверном хранении GLB уже лежит там под тем же ключом.
        await putLocalBlob(modelKey(meta.id), glb).catch(() => undefined)
        const stats = await readGlbStats(glb)
        update(meta.id, {
          status: "done",
          error: undefined,
          engine: MESHY_ENGINE,
          edgeCount: undefined,
          modelBytes: glb.size,
          credits: credits || undefined,
          ...stats,
        })
        showToast({ title: "3D-модель готова", detail: meta.sourceName })
      } catch (error) {
        update(meta.id, {
          status: "error",
          error: error instanceof Error ? error.message : "Построение не удалось.",
          ...(error instanceof ModelBuildError && error.taskLost ? { taskId: undefined, taskKind: undefined } : {}),
        })
      } finally {
        building.current.delete(meta.id)
        setProgress(({ [meta.id]: _finished, ...rest }) => rest)
      }
    },
    [update]
  )

  // Превью для библиотеки, FBX и OBJ забираются фоном уже после того, как GLB
  // закрутился во вьюере: Meshy хранит файлы 3 дня, поэтому сервер сразу
  // перекладывает их к себе. Сбой сети оставляет `formats` пустым — попытка
  // повторится при следующем открытии страницы; формат, которого у задачи
  // нет, просто не попадает в список.
  const collectFormats = useCallback(
    async (meta: Model3D) => {
      if (!meta.taskId || collecting.current.has(meta.id)) return
      // Из набора запись не убирается: одна попытка на загрузку страницы.
      collecting.current.add(meta.id)
      const kind = meta.taskKind ?? "image"
      await fetchModelFile(meta.taskId, meta.id, kind, "thumb")
        .then((thumb) => putLocalBlob(thumbResultKey(meta.id), thumb))
        .catch(() => undefined)
      const formats: ModelFormat[] = ["glb"]
      for (const format of MODEL_FORMATS) {
        if (format === "glb") continue
        try {
          const file = await fetchModelFile(meta.taskId, meta.id, kind, format)
          await putLocalBlob(modelKey(meta.id, format), file).catch(() => undefined)
          formats.push(format)
        } catch (error) {
          if (!(error instanceof ModelBuildError && error.taskLost)) return
        }
      }
      update(meta.id, { formats })
    },
    [update]
  )

  // Задача Meshy считается у провайдера: после перезагрузки (или на другом
  // устройстве) опрос той же задачи просто продолжается.
  useEffect(() => {
    for (const model of models) {
      if (model.status === "processing" && model.taskId) void runBuild(model)
      else if (model.status === "done" && model.engine === MESHY_ENGINE && !model.formats) void collectFormats(model)
    }
  }, [models, runBuild, collectFormats])

  const startBuild = useCallback(
    async (photos: { slot: ModelSlot; file: File }[], buildNote: string, buildSettings: ModelSettings) => {
      const project = await ensureActiveProject()
      const main = photos[0].file
      try {
        const { id, width, height } = await saveSourceFile(main, { durable: true })
        const views: ModelViewRole[] = []
        for (const photo of photos.slice(1)) {
          if (photo.slot === "main") continue
          await putBlob(viewKey(id, photo.slot), photo.file)
          views.push(photo.slot)
        }
        const meta: Model3D = {
          id,
          projectId: project.id,
          status: "processing",
          shape: resolveShape("auto", buildNote, main.name),
          note: buildNote,
          sourceName: main.name,
          sourceWidth: width,
          sourceHeight: height,
          settings: buildSettings,
          ...(views.length > 0 ? { views } : {}),
          createdAt: new Date().toISOString(),
        }
        add(meta)
        setSelectedId(id)
        await runBuild(meta)
      } catch {
        window.alert(`«${main.name}» не удалось сохранить в хранилище браузера.`)
      }
    },
    [add, runBuild]
  )

  const submit = () => {
    if (!slots.main) {
      slots.pick("main")
      return
    }
    const photos = slots.ordered.map(({ slot, attachment }) => ({ slot, file: attachment.file }))
    intake.clearAttachments()
    const buildNote = note.trim()
    setNote("")
    void startBuild(photos, buildNote, settings)
  }

  const retry = (model: Model3D) => {
    // Готовая модель «заново» — это новая платная задача; после сбоя связи
    // «Повторить» продолжает прежнюю, уже оплаченную.
    const rebuild = model.status === "done" && model.engine === MESHY_ENGINE
    if (rebuild) {
      const cost = estimateModelCost(model.settings ?? settings)
      if (!window.confirm(`Построить модель заново? Это новая задача — около ${cost.credits} кредитов Meshy.`)) return
    }
    const patch: Partial<Model3D> = {
      status: "processing",
      error: undefined,
      ...(rebuild ? { taskId: undefined, taskKind: undefined, formats: undefined, credits: undefined } : {}),
    }
    update(model.id, patch)
    void runBuild({ ...model, ...patch })
  }

  const deleteModel = (model: Model3D) => {
    const confirmed = window.confirm("Удалить модель вместе с фото? Действие необратимо.")
    if (!confirmed) return
    remove(model.id)
  }

  const libraryProps = { models: visible, selectedId: selected?.id ?? null, progress, onSelect: setSelectedId, onDelete: deleteModel }

  return (
    <ToolShell
      intake={intake}
      dropLabel="Отпустите, чтобы приложить фото"
      composerOpen
      composerSpace={dockOpen ? "22rem" : "11rem"}
      trayOpen={visible.length > 0}
      layers={
        <>
          <ComposerDock trayOpen={visible.length > 0}>
            <ToolComposer
              attachments={intake.attachments}
              onPickFiles={() => slots.pick("main")}
              onRemoveAttachment={intake.removeAttachment}
              onClearAttachments={intake.clearAttachments}
              note={note}
              onNoteChange={setNote}
              option="auto"
              onOptionChange={() => undefined}
              options={[]}
              labels={LABELS}
              onSubmit={submit}
              maxFiles={intake.maxFiles}
              settingsInDock
              dockLabel="Параметры модели"
              dock={
                <ModelDock
                  slots={slots}
                  settings={settings}
                  onSettingsChange={setSettings}
                  multiView={multiView}
                  onMultiViewChange={setMultiView}
                  configured={configured}
                  open={dockOpen}
                  onOpenChange={setDockChoice}
                />
              }
            />
          </ComposerDock>
          <ToolAside presence={library} label="Модели проекта">
            <ModelLibrary {...libraryProps} />
          </ToolAside>
        </>
      }
    >
      {visible.length === 0 ? (
        /* Сцена-приглашение: каркасы мебели перетекают друг в друга. Приложенное
           фото держит контур подсвеченным — как приглашение нажать «Создать 3D». */
        <ToolDropzone
          onPick={() => slots.pick("main")}
          label={slots.main ? "Заменить фото" : "Добавить фото"}
          armed={Boolean(slots.main)}
          visual={<FurnitureMorph showLabel={!dockOpen} className={cn("relative w-full max-w-[520px]", dockOpen ? "h-[120px] sm:h-[clamp(116px,calc(100dvh-40rem),220px)]" : "h-[300px] sm:h-[340px]")} />}
          title={slots.main ? "Фото приложено" : "Что построим сегодня?"}
          description={
            slots.main
              ? `«${slots.main.file.name}» — проверьте параметры внизу и нажмите «${LABELS.submitLabel}».`
              : (
                  /* На невысоком экране панель параметров занимает пол-окна — описание уступает ей место. */
                  <span className={cn(dockOpen && "[@media(max-height:860px)]:hidden")}>
                    Один предмет в кадре — стул, стол, лампа, диван — и получите его 3D-модель.
                  </span>
                )
          }
          caption="GLB · FBX · OBJ — для 3ds Max, ArchiCAD, AutoCAD"
          className={cn("max-w-[760px] gap-2 px-6", dockOpen ? "pb-6 pt-3" : "pb-8 pt-4 sm:pb-10")}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {selected ? (
            <ModelStage
              model={selected}
              progress={progress[selected.id]}
              className={dockOpen ? "h-[calc(100dvh-33rem)] min-h-[220px]" : "h-[calc(100dvh-21rem)] min-h-[300px]"}
              onRetry={() => retry(selected)}
              onDelete={() => deleteModel(selected)}
            />
          ) : null}
          {visible.length > 1 ? <ModelLibraryStrip {...libraryProps} /> : null}
        </div>
      )}
    </ToolShell>
  )
}
