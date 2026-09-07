"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Camera, Crop, Images, ZoomIn } from "lucide-react"

import { AddTile } from "@/components/tool/add-tile"
import { AspectPicker } from "@/components/tool/aspect-picker"
import { RenderStrip, RenderTray } from "@/components/tool/render-tray"
import { BatchGrid, Stage } from "@/components/tool/stage"
import { ToolComposer, type ToolComposerLabels, type ToolOption } from "@/components/tool/tool-composer"
import { ToolDropzone } from "@/components/tool/tool-dropzone"
import { ComposerDock, ToolAside, ToolGallery, ToolShell } from "@/components/tool/tool-shell"
import { ViewSetCard } from "@/components/tool/view-set-card"
import { ViewsInvite } from "@/components/tool/views-invite"
import { getBlob, putBlobDurably, sourceKey } from "@/lib/blob-store"
import { MAX_BATCH, makeThumb, readImageSize } from "@/lib/enhance-engine"
import { closestFrameAspect } from "@/lib/frame-aspect"
import { describeScene, hasMaterialsSection } from "@/lib/scene-analysis"
import { planViewFrames } from "@/lib/shot-planning"
import { runGalleryQueue, saveSourceFile } from "@/lib/tool-jobs"
import { useAttachments } from "@/lib/use-attachments"
import { useBatchSelection } from "@/lib/use-batch-selection"
import { usePresence } from "@/lib/use-presence"
import { createId, fileBaseName, mapWithConcurrency, plural } from "@/lib/utils"
import { PRESET_LABEL, PRESET_SLOTS, describeSlots, framesOf, prepareViewSet, viewKey, viewThumbKey } from "@/lib/view-engine"
import { ensureActiveProject, useActiveProject } from "@/stores/project-store"
import { useViewsStore } from "@/stores/views-store"
import type { FrameAspect, ViewPreset, ViewSet } from "@/types"

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
  filesCaption: "по одному сету на каждый рендер · все кадры в выбранном формате · GPT Image 2 2K → Lanczos 2000 px",
  optionsTitle: "Что снять",
  optionsIcon: Camera,
  footer:
    "Сцена остаётся той же — меняются точка съёмки и кадрирование. Все кадры — крупные виньетки, как в каруселях дизайнеров: предмет с соседями, вид сверху под углом на тумбу, через край кровати, материал у шва. Общих планов и голых стен не будет. Перед построением vision-модель разбирает сцену и сама решает, что здесь стоит снять. Каждый кадр проходит Lanczos до 2000 px.",
  inputPlaceholder: "Что показать крупно: ваза, кресло, торшер…",
  submitLabel: "Построить",
  batchNoun: ["рендер", "рендера", "рендеров"],
}

/** Сколько кадров сета считается одновременно: быстрее, чем по одному, и без шторма запросов к провайдеру. */
const FRAME_CONCURRENCY = 3

const ASPECT_NOTICE = "Выберите формат кадров: сторис, портрет, квадрат, альбом или широкий."

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
 *
 * Формат кадров (9:16, 3:4, 1:1, 4:3, 16:9) спрашивается до построения:
 * с первым приложенным рендером панель настроек открывается сама, а кнопка
 * «Построить» закрыта, пока формат не выбран. Перед генерацией планировщик
 * (`lib/shot-planning`, vision-модель) составляет список кадров под этот
 * рендер; без него кадры берутся по составу набора.
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
  const [aspect, setAspect] = useState<FrameAspect | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [attention, setAttention] = useState(0)

  const visible = activeProject ? sets.filter((item) => item.projectId === activeProject.id) : []
  const hasAttachments = attachments.length > 0
  const showComposer = hasAttachments || visible.length > 0
  const composer = usePresence(showComposer)
  const tray = usePresence(hasAttachments)

  /* Формат спрашивается сразу: с первым рендером пачки панель настроек
     открывается сама и «волна» подсветки показывает, где выбирать. Панель
     раскрывается после анимации композера. */
  const askedRef = useRef(false)
  useEffect(() => {
    if (!hasAttachments) {
      askedRef.current = false
      return
    }
    if (askedRef.current || aspect) return
    askedRef.current = true
    const timer = window.setTimeout(() => {
      setSettingsOpen(true)
      setAttention((key) => key + 1)
    }, 420)
    return () => window.clearTimeout(timer)
  }, [hasAttachments, aspect])

  /* Кадры сета считаются по несколько разом; готовые сразу отмечаются в
     записи, чтобы карточка показывала их, не дожидаясь всего сета. Подготовка
     (референс для модели или план вырезок предпросмотра) — один раз на сет. */
  const runSet = useCallback(
    async (meta: ViewSet) => {
      const ready = new Set(meta.ready ?? [])
      const generated = new Set([...(meta.generated ?? []), ...ready])
      let engine: string | undefined = meta.engine
      try {
        if (meta.generationUncertain) {
          throw new Error(
            "Статус предыдущего платного запроса неизвестен. Новая генерация не запущена — откройте исходный браузер для синхронизации или создайте отдельный сет вручную."
          )
        }
        const source = await getBlob(sourceKey(meta.id))
        if (!source) throw new Error("Исходник не найден в хранилище браузера.")

        // Планировщик — до первого кадра и только раз: пока ни один кадр не
        // создан, список кадров можно заменить на подобранный под этот рендер.
        // «Повторить» после сбоя идёт с уже сохранённым списком. Разбор сцены
        // (тот же, что в редакторе рендера) идёт параллельно и тоже хранится.
        let frames = meta.frames
        let inventory = hasMaterialsSection(meta.sceneInventory) ? meta.sceneInventory?.trim() : undefined
        const needPlan = !meta.planned && generated.size === 0 && Boolean(meta.aspect)
        if (needPlan || !inventory) {
          const [plan, found] = await Promise.all([
            needPlan && meta.aspect
              ? planViewFrames(source, { preset: meta.preset, aspect: meta.aspect, note: meta.note })
              : Promise.resolve(null),
            inventory ? Promise.resolve(null) : describeScene(source),
          ])
          if (found) inventory = found.text
          const patch: Partial<ViewSet> = {}
          if (needPlan) {
            patch.planned = Boolean(plan)
            if (plan) {
              frames = plan.frames
              patch.frames = frames
              patch.planner = plan.model
            }
          }
          if (found) patch.sceneInventory = found.text
          if (Object.keys(patch).length > 0) update(meta.id, patch)
        }

        // До ЛЮБОГО нового вызова модели проверяем уже созданные кадры. Если
        // сервер знает, что провайдер закончил кадр, но самого файла в этом
        // браузере ещё нет, останавливаем весь Retry: параллельные воркеры не
        // успеют повторно потратить деньги на остальные ракурсы.
        const recovered = new Map<string, Blob>()
        for (const frame of frames) {
          if (!generated.has(frame.key)) continue
          const blob = await getBlob(viewKey(meta.id, frame.key))
          if (!blob) {
            throw new Error(
              `Кадр «${frame.label}» уже создан, но ещё не синхронизирован. Откройте исходный браузер и нажмите «Повторить» там — новая генерация не запущена.`
            )
          }
          recovered.set(frame.key, blob)
        }

        const renderer = await prepareViewSet(source, frames, meta.note, meta.aspect, inventory)
        await mapWithConcurrency(frames, FRAME_CONCURRENCY, async (frame) => {
          // После сетевого сбоя готовый кадр уже может лежать локально. В этом
          // случае повтор только дозагружает его и не вызывает модель ещё раз.
          let frameBlob = recovered.get(frame.key) ?? (await getBlob(viewKey(meta.id, frame.key)))
          if (!frameBlob) {
            if (generated.has(frame.key)) {
              throw new Error(
                `Готовый кадр «${frame.label}» ещё не синхронизирован. Платная генерация повторно не запущена.`
              )
            }
            const result = await renderer.render(frame)
            frameBlob = result.blob
            engine = result.engine
          }
          // Маркер записывается сразу после ответа провайдера (или обнаружения
          // старой локальной копии), ДО загрузки asset. Даже если PUT оборвётся,
          // следующий браузер увидит запрет на повторную генерацию.
          if (!generated.has(frame.key)) {
            generated.add(frame.key)
            update(meta.id, {
              generated: [...generated],
              engine,
              syncPending: true,
            })
          }
          await putBlobDurably(viewKey(meta.id, frame.key), frameBlob)
          const thumb = (await getBlob(viewThumbKey(meta.id, frame.key))) ?? (await makeThumb(frameBlob))
          await putBlobDurably(viewThumbKey(meta.id, frame.key), thumb)
          ready.add(frame.key)
          update(meta.id, {
            generated: [...generated],
            ready: [...ready],
            syncPending: generated.size > ready.size || undefined,
          })
        })
        update(meta.id, {
          status: "done",
          resultWidth: meta.sourceWidth,
          resultHeight: meta.sourceHeight,
          engine,
          syncPending: undefined,
          generationUncertain: undefined,
          error: undefined,
        })
      } catch (error) {
        update(meta.id, {
          status: "error",
          generated: [...generated],
          ready: [...ready],
          syncPending: generated.size > ready.size || undefined,
          error: error instanceof Error ? error.message : "Построение сета не удалось.",
        })
      }
    },
    [update]
  )

  /* Карточки появляются СРАЗУ после нажатия — ещё до сохранения исходника:
     человек должен увидеть, что работа пошла. Сохранение (с ожиданием
     серверной копии) идёт уже внутри очереди, под статусом «сохраняем
     исходник…»; пока оно не закончилось, исходник берётся из памяти
     (pendingBlobWrites в blob-store), так что превью есть с первой секунды. */
  const startBatch = useCallback(
    async (files: File[], batchNote: string, batchPreset: ViewPreset, batchAspect: FrameAspect) => {
      const project = ensureActiveProject()
      const metas: ViewSet[] = []
      const sources = new Map<string, File>()
      for (const file of files) {
        try {
          const { width, height } = await readImageSize(file)
          const id = createId()
          sources.set(id, file)
          metas.push({
            id,
            projectId: project.id,
            status: "processing",
            preset: batchPreset,
            aspect: batchAspect,
            sourceReady: false,
            frames: framesOf(batchPreset),
            ready: [],
            note: batchNote,
            sourceName: file.name,
            sourceWidth: width,
            sourceHeight: height,
            createdAt: new Date().toISOString(),
          })
        } catch {
          window.alert(`«${file.name}» не читается как изображение.`)
        }
      }
      await runGalleryQueue(metas, add, async (meta) => {
        const file = sources.get(meta.id)
        try {
          if (!file) throw new Error("Файл исходника потерян.")
          await saveSourceFile(file, { id: meta.id, durable: true })
          update(meta.id, { sourceReady: true })
        } catch (error) {
          update(meta.id, {
            status: "error",
            error: `Исходник не удалось сохранить: ${error instanceof Error ? error.message : "хранилище недоступно"}.`,
          })
          return
        }
        await runSet({ ...meta, sourceReady: true })
      })
    },
    [add, runSet, update]
  )

  const submitBlockedReason = hasAttachments && !aspect ? "Сначала выберите формат кадров" : null

  const submit = () => {
    if (attachments.length === 0) {
      intake.pickFiles()
      return
    }
    if (!aspect) {
      setSettingsOpen(true)
      setAttention((key) => key + 1)
      return
    }
    if (workingSet.length === 0) return
    const sentNote = note.trim()
    const { files } = batch.takeWorkingSet()
    setNote("")
    setSettingsOpen(false)
    void startBatch(files, sentNote, preset, aspect)
  }

  const retry = (item: ViewSet) => {
    update(item.id, { status: "processing", error: undefined })
    void runSet(item)
  }

  /* Смена режима — новая сцена или готовая очередь карточек — всегда наверху
     страницы: иначе после «Построить» новая карточка встаёт в голову списка,
     а экран остаётся прокрученным к плитке «Добавить кадр», и кажется, что
     ничего не произошло. */
  useEffect(() => {
    // Мгновенно, не плавно: плавную прокрутку обрывает перестройка страницы.
    window.scrollTo(0, 0)
  }, [hasAttachments])

  /* Строка состояния в композере, пока идёт хотя бы один сет: композер всегда
     на экране, значит и ответ «работает ли» — тоже. */
  const processing = visible.filter((item) => item.status === "processing")
  const processingNotice = (() => {
    if (processing.length === 0) return null
    const done = processing.reduce((sum, item) => sum + (item.ready?.length ?? 0), 0)
    const total = processing.reduce((sum, item) => sum + (item.frames?.length ?? 0), 0)
    if (processing.length === 1) {
      const item = processing[0]
      const stage = !item.sourceReady
        ? "сохраняем исходник…"
        : (item.ready?.length ?? 0) === 0 && !item.planned
          ? "разбираем сцену и подбираем кадры…"
          : `кадры ${done} из ${total}…`
      return `Строим сет по «${item.sourceName}»: ${stage}`
    }
    return `Строим ${processing.length} ${plural(processing.length, ["сет", "сета", "сетов"])}: готово ${done} из ${total} кадров…`
  })()

  const deleteSet = (item: ViewSet) => {
    const confirmed = window.confirm("Удалить сет кадров вместе с результатами? Действие необратимо.")
    if (!confirmed) return
    remove(item.id)
  }

  /* Подпись под сценой: какие кадры даст выбранный набор, в каком формате и по чему. */
  const slotCount = PRESET_SLOTS[preset].length
  const frameCount = `${slotCount} ${plural(slotCount, ["кадр", "кадра", "кадров"])}${aspect ? ` ${aspect}` : ""}`
  const stageCaption =
    workingSet.length === 0
      ? "Ничего не выбрано — отметьте рендеры в панели справа."
      : `${PRESET_LABEL[preset]} — ${frameCount} ${
          workingSet.length === 1 ? "по рендеру на сцене" : `на каждый из ${workingSet.length} выбранных ${LABELS.batchNoun[2]}`
        }: ${describeSlots(preset)}. ${aspect ? "Что именно снять, решит vision-модель по этому интерьеру." : "Формат кадров — в настройках композера."}`
  const suggestedAspect = current ? closestFrameAspect(current.width, current.height) : null

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
              submitBlockedReason={submitBlockedReason}
              notice={hasAttachments ? (aspect ? null : ASPECT_NOTICE) : processingNotice}
              placeholder={hasAttachments ? undefined : "Добавьте рендер: плитка «Добавить кадр», перенос или вставка из буфера"}
              attentionKey={attention}
              extras={<AspectPicker value={aspect} onChange={setAspect} suggested={suggestedAspect} />}
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
          description={`Один общий план — и из него сет кадров для публикации: детали крупно, фактуры, фрагменты и неожиданные ракурсы, в формате сторис, квадрата или альбома. Нажмите, перетащите сюда или вставьте из буфера. PNG, JPG или WEBP до 32 МБ, до ${MAX_BATCH} файлов за раз.`}
          caption="Как карусель дизайнера: vision-модель смотрит на рендер и подбирает кадры под него — по одному рендеру, без 3D-модели и повторного рендера."
          className="max-w-[760px] gap-6 px-6 pb-10 pt-8 sm:pb-12 sm:pt-10"
        />
      ) : (
        <ToolGallery layout="stack">
          {visible.map((item) => (
            <ViewSetCard
              key={item.id}
              item={item}
              downloadBaseName={`${fileBaseName(item.sourceName, "render")}-shot`}
              onRetry={() => retry(item)}
              onDelete={() => deleteSet(item)}
            />
          ))}
          {/* Под последним сетом — плитка того же размера, что его общий план:
              новый рендер и ещё один сет. Дропзоны на этом экране уже нет. */}
          <AddTile
            onClick={intake.pickFiles}
            label="Добавить кадр"
            hint="ещё один рендер — и новый сет ракурсов"
            aspectRatio={`${visible[0].sourceWidth || 4} / ${visible[0].sourceHeight || 3}`}
            className="w-full md:w-[260px]"
          />
        </ToolGallery>
      )}
    </ToolShell>
  )
}
