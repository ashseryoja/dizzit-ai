"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Download, Layers, Package, Sofa, Sparkles, Trees } from "lucide-react"

import { ThinkingGlyph } from "@/components/glyphs"
import {
  BatchToolsPanel,
  DEFAULT_BATCH_TOOLS,
  PopulateToggle,
  QualityToggle,
} from "@/components/tool/batch-tools"
import { RegionEditor } from "@/components/tool/region-editor"
import { RenderReveal } from "@/components/tool/render-reveal"
import { RenderStrip, RenderTray } from "@/components/tool/render-tray"
import { BatchGrid, Stage, StagePlaceholder } from "@/components/tool/stage"
import { downloadStoredResult, useBlobUrl } from "@/components/tool/tool-card"
import { ToolComposer, type ToolComposerLabels, type ToolOption } from "@/components/tool/tool-composer"
import { ToolDropzone } from "@/components/tool/tool-dropzone"
import { ComposerDock, ToolAside, ToolShell } from "@/components/tool/tool-shell"
import {
  deleteBlobs,
  getBlob,
  keysOf,
  putBlob,
  resultKey,
  sourceKey,
  thumbResultKey,
  thumbSourceKey,
} from "@/lib/blob-store"
import { MAX_BATCH, enhanceRender, makeThumb } from "@/lib/enhance-engine"
import {
  buildEditComment,
  buildRegionsPayload,
  editBlockReason,
  type EditRegion,
  type RegionPayload,
} from "@/lib/render-regions"
import { runGalleryQueue, saveSourceFile } from "@/lib/tool-jobs"
import { useAttachments, type AttachedRender, type AttachmentDetachReason } from "@/lib/use-attachments"
import { useBatchSelection } from "@/lib/use-batch-selection"
import { usePresence } from "@/lib/use-presence"
import { cn, fileBaseName } from "@/lib/utils"
import { useEnhanceStore } from "@/stores/enhance-store"
import { ensureActiveProject, useActiveProject } from "@/stores/project-store"
import type { BatchTools, EnhanceContext, Enhancement } from "@/types"

const CONTEXT_OPTIONS: ToolOption<EnhanceContext>[] = [
  { value: "auto", label: "Авто", icon: Sparkles },
  { value: "interior", label: "Интерьер", icon: Sofa },
  { value: "exterior", label: "Экстерьер", icon: Trees },
  { value: "product", label: "Предметный", icon: Package },
]

const LABELS: ToolComposerLabels = {
  filesTitle: "Рендеры",
  filesQuality: "исходники",
  uploadTitle: "Загрузить рендеры",
  filesCaption: "GPT Image 2 · результат 2000 px · $0,03 за рендер",
  optionsTitle: "Контекст",
  optionsIcon: Layers,
  footer:
    "Содержимое кадра не меняется: геометрия, материалы и композиция остаются вашими — растут только детализация и реализм.",
  inputPlaceholder: "Комментарий к обработке…",
  submitLabel: "Улучшить · $0,03",
  batchNoun: ["рендер", "рендера", "рендеров"],
}

/** Серверная запись может приехать на другое устройство чуть раньше блоба. */
async function getWorkspaceSource(id: string): Promise<Blob | null> {
  for (const delay of [0, 400, 1200, 2500, 5000]) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    const blob = await getBlob(sourceKey(id))
    if (blob) return blob
  }
  return null
}

/** Вторая плитка пары в правой панели: будущий или уже готовый результат. */
function EnhancementVersionThumb({
  enhancement,
  index,
  active,
  onSelect,
}: {
  enhancement: Enhancement
  index: number
  active: boolean
  onSelect: () => void
}) {
  const sourceThumb = useBlobUrl(thumbSourceKey(enhancement.id))
  const resultThumb = useBlobUrl(enhancement.status === "done" ? thumbResultKey(enhancement.id) : null)
  const preview = resultThumb ?? sourceThumb
  const stateLabel =
    enhancement.status === "processing"
      ? "улучшается"
      : enhancement.status === "error"
        ? "ошибка"
        : "новый"

  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      aria-label={`${index + 1}, новая версия: ${stateLabel}`}
      onClick={onSelect}
      className={cn("tray-thumb group/thumb aspect-[4/3]", active && "is-active is-focus")}
      title={enhancement.status === "error" ? enhancement.error : "Улучшенная версия"}
    >
      {preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={preview}
          alt="Улучшенная версия"
          draggable={false}
          className={cn("h-full w-full object-cover", enhancement.status === "processing" && "blur-[3px]")}
        />
      ) : null}
      {enhancement.status === "processing" ? (
        <span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white/90">
          <ThinkingGlyph size={18} />
        </span>
      ) : null}
      {enhancement.status === "error" ? (
        <span className="absolute inset-0 flex items-center justify-center bg-black/45 px-2 text-center text-[10px] text-white/90">
          ошибка · нажмите для деталей
        </span>
      ) : null}
      <span className="tray-thumb-index" aria-hidden>
        {index + 1} · {stateLabel}
      </span>
    </button>
  )
}

/**
 * «Редактор рендера» — главный экран. Раскладка повторяет нейрофотосессию
 * UpSound: большая рабочая сцена, справа постоянные пары «исходник / новый»,
 * внизу плавающий композер. Пока ни рендера, ни сохранённой пары нет,
 * композера нет — по центру большая зона «Добавить рендер».
 *
 * Каркас экрана, приём файлов, панель-галерея пачки, сцена и рабочий набор —
 * общие для инструментов (см. docs/TOOL_UI.md). Своё у редактора рендера:
 * контекст сцены, улучшение качества, тумблер заселения, пакетные функции
 * и точечная правка.
 *
 * Обработка применяется к РАБОЧЕМУ НАБОРУ, а не ко всей пачке: в обычном
 * режиме это один рендер (тот, что на сцене), в режиме «Выбрать» панели —
 * несколько. Композер показывает размер набора рядом с полем комментария.
 *
 * «Редактировать все» переводит набор в пакетное редактирование: вместо
 * сцены — грид выбранных, в настройках композера — только три общие
 * функции (качество, фильтр, время). Точечные правки на многих кадрах
 * невозможны, поэтому ничего другого там нет.
 *
 * Точечная правка ОДНОГО рендера — прямо на сцене: кисть, обводка и рамка
 * отмечают области, у каждой свой номер и подпись «что изменить в этом месте»
 * (перенос редактора обложек UpSound). Области хранятся по рендеру и уходят
 * в обработку вместе с собранным текстом задания.
 */
export default function EnhancePage() {
  const activeProject = useActiveProject()

  const enhancements = useEnhanceStore((state) => state.enhancements)
  const add = useEnhanceStore((state) => state.add)
  const update = useEnhanceStore((state) => state.update)
  const remove = useEnhanceStore((state) => state.remove)

  // Области точечной правки — по previewUrl рендера: у каждого свои.
  // Рендер ушёл из пачки (убрали, очистили, отправили) — его области вместе с ним.
  const [regionsByUrl, setRegionsByUrl] = useState<Record<string, EditRegion[]>>({})
  const dropRegions = useCallback((urls: string[]) => {
    setRegionsByUrl((map) => {
      if (!urls.some((url) => url in map)) return map
      const next = { ...map }
      urls.forEach((url) => delete next[url])
      return next
    })
  }, [])

  const detachWorkspaceItems = useCallback(
    (items: AttachedRender[], reason: AttachmentDetachReason) => {
      dropRegions(items.map((item) => item.previewUrl))
      if (reason !== "discard") return
      const current = useEnhanceStore.getState().enhancements
      for (const item of items) {
        if (current.some((record) => record.id === item.id)) remove(item.id)
      }
    },
    [dropRegions, remove]
  )
  const intake = useAttachments({ maxFiles: MAX_BATCH, onDetach: detachWorkspaceItems })
  const { restoreAttachments } = intake
  const [settingsOpen, setSettingsOpen] = useState(false)
  // «Редактировать все» открывает настройки сами — там и есть все доступные действия.
  const batch = useBatchSelection(intake, {
    noun: LABELS.batchNoun,
    onEditAll: () => setSettingsOpen(true),
    onLeaveBatch: () => setSettingsOpen(false),
  })
  const { attachments, current, focusIndex, pickedItems, workingSet, showBatchGrid } = batch

  const [tools, setTools] = useState<BatchTools>(DEFAULT_BATCH_TOOLS)
  // Заселение сцены — тумблер в настройках, общий для одного рендера и пачки.
  const [populate, setPopulate] = useState(false)
  const [note, setNoteState] = useState("")
  // Замечание над строкой ввода и счётчик «волны» по настройкам: без комментария,
  // областей и изменённых настроек «Улучшить» не запускает обработку, а
  // показывает, что выбрать. Любой ввод замечание снимает.
  const [notice, setNotice] = useState<string | null>(null)
  const [attention, setAttention] = useState(0)
  const setNote = (value: string) => {
    setNoteState(value)
    if (value.trim()) setNotice(null)
  }
  const [context, setContext] = useState<EnhanceContext>("auto")

  const visible = useMemo(
    () =>
      activeProject
        ? enhancements.filter((item) => item.projectId === activeProject.id && item.status !== "draft")
        : [],
    [activeProject, enhancements]
  )
  const enhancementById = useMemo(() => new Map(visible.map((item) => [item.id, item])), [visible])
  const currentEnhancement = current ? enhancementById.get(current.id) : undefined
  const [stageChoice, setStageChoice] = useState<{ id: string; version: "source" | "result" } | null>(null)
  const stageVersion =
    stageChoice && current && stageChoice.id === current.id
      ? stageChoice.version
      : currentEnhancement?.status === "done"
        ? "result"
        : "source"
  const resultUrl = useBlobUrl(
    currentEnhancement?.status === "done" && stageVersion === "result" ? resultKey(currentEnhancement.id) : null
  )
  const stageAttachment =
    current && currentEnhancement?.status === "done" && stageVersion === "result" && resultUrl
      ? {
          ...current,
          previewUrl: resultUrl,
          width: currentEnhancement.resultWidth ?? current.width,
          height: currentEnhancement.resultHeight ?? current.height,
        }
      : current
  const hasAttachments = attachments.length > 0
  const showComposer = hasAttachments || visible.length > 0
  const composer = usePresence(showComposer)
  const tray = usePresence(hasAttachments)

  /* Новое вложение сразу становится черновиком: исходник и миниатюра уходят
     в IndexedDB + сервер, метаданные — в общий стор + Postgres. Поэтому оно
     переживает refresh ещё до нажатия «Улучшить». */
  const savingDrafts = useRef(new Map<string, ReturnType<typeof saveSourceFile>>())
  useEffect(() => {
    if (!activeProject) {
      if (attachments.length > 0) ensureActiveProject()
      return
    }
    for (const attachment of attachments) {
      const existing = enhancements.find((item) => item.id === attachment.id)
      if (!existing) {
        add({
          id: attachment.id,
          projectId: activeProject.id,
          status: "draft",
          context: "auto",
          note: "",
          sourceName: attachment.file.name,
          sourceWidth: attachment.width,
          sourceHeight: attachment.height,
          sourceReady: false,
          createdAt: new Date().toISOString(),
        })
      }
      if ((existing && (existing.status !== "draft" || existing.sourceReady)) || savingDrafts.current.has(attachment.id)) {
        continue
      }

      const saving = saveSourceFile(attachment.file, { id: attachment.id, durable: true })
      savingDrafts.current.set(attachment.id, saving)
      void saving
        .then(() => {
          const current = useEnhanceStore.getState().enhancements.find((item) => item.id === attachment.id)
          if (current?.status === "draft") update(attachment.id, { sourceReady: true })
          else if (!current) void deleteBlobs(keysOf(attachment.id))
        })
        .catch(() => {
          window.alert(`«${attachment.file.name}» сохранён в браузере, но сервер пока не подтвердил загрузку. Повторим автоматически после обновления.`)
        })
        .finally(() => savingDrafts.current.delete(attachment.id))
    }
  }, [activeProject, add, attachments, enhancements, update])

  /* После гидрации стора восстанавливаем на рабочую сцену не только черновики,
     но и уже запущенные/готовые пары. Иначе после refresh интерфейс снова
     провалился бы в старую галерею карточек. */
  const restoringSources = useRef<string | null>(null)
  const sourcesToRestore = useMemo(() => {
    if (!activeProject) return []
    const attachedIds = new Set(attachments.map((attachment) => attachment.id))
    return enhancements
      .filter((item) => item.projectId === activeProject.id && !attachedIds.has(item.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(0, MAX_BATCH - attachments.length))
  }, [activeProject, attachments, enhancements])
  const restoreSignature = sourcesToRestore.map((item) => item.id).join(",")
  const sourcesToRestoreRef = useRef(sourcesToRestore)
  sourcesToRestoreRef.current = sourcesToRestore
  useEffect(() => {
    if (!activeProject || !restoreSignature || restoringSources.current === restoreSignature) return
    restoringSources.current = restoreSignature
    let cancelled = false
    void Promise.all(
      sourcesToRestoreRef.current.map(async (item) => {
        const blob = await getWorkspaceSource(item.id)
        if (!blob) return null
        const file = new File([blob], item.sourceName, {
          type: blob.type || "image/jpeg",
          lastModified: Date.parse(item.createdAt) || Date.now(),
        })
        return { id: item.id, file, width: item.sourceWidth, height: item.sourceHeight }
      })
    )
      .then((items) => {
        if (!cancelled) restoreAttachments(items.filter((item): item is NonNullable<typeof item> => Boolean(item)))
      })
      .finally(() => {
        if (restoringSources.current === restoreSignature) restoringSources.current = null
      })
    return () => {
      cancelled = true
    }
  }, [activeProject, restoreAttachments, restoreSignature])

  /* Точечная правка живёт только у ОДНОГО рендера на сцене: при наборе из
     нескольких холст заморожен — точечные правки к пачке неприменимы. */
  const currentRegions = current ? (regionsByUrl[current.previewUrl] ?? []) : []
  const regionEditingActive =
    Boolean(current) &&
    currentEnhancement?.status !== "processing" &&
    !showBatchGrid &&
    workingSet.length === 1 &&
    workingSet[0] === current
  const built = buildEditComment({ userComment: note, regions: regionEditingActive ? currentRegions : [] })
  const processingSelected = workingSet.some((item) => enhancementById.get(item.id)?.status === "processing")
  const submitBlockedReason = processingSelected
    ? "Этот рендер уже улучшается"
    : regionEditingActive
      ? editBlockReason(built)
      : null

  /* Есть ли что обрабатывать: улучшение качества включено по умолчанию, либо
     есть комментарий, области, контекст, заселение, фильтр или время. */
  const toolsChosen = tools.quality || tools.filter !== "none" || tools.time !== "keep"
  const hasIntent =
    note.trim().length > 0 ||
    (regionEditingActive && currentRegions.length > 0) ||
    context !== "auto" ||
    populate ||
    toolsChosen

  const setCurrentRegions = useCallback(
    (regions: EditRegion[]) => {
      if (!current) return
      const url = current.previewUrl
      setRegionsByUrl((map) => ({ ...map, [url]: regions }))
      if (regions.length > 0) setNotice(null)
    },
    [current]
  )

  const selectSource = useCallback(
    (index: number) => {
      const attachment = attachments[index]
      if (!attachment) return
      batch.selectAttachment(index)
      setStageChoice({ id: attachment.id, version: "source" })
    },
    [attachments, batch]
  )

  const selectResult = useCallback(
    (attachment: AttachedRender, index: number) => {
      batch.selectAttachment(index)
      setStageChoice({ id: attachment.id, version: "result" })
    },
    [batch]
  )

  const renderVersion = useCallback(
    (attachment: AttachedRender, index: number) => {
      const enhancement = enhancementById.get(attachment.id)
      if (!enhancement) return null
      return (
        <EnhancementVersionThumb
          enhancement={enhancement}
          index={index}
          active={current?.id === attachment.id && stageVersion === "result"}
          onSelect={() => selectResult(attachment, index)}
        />
      )
    },
    [current?.id, enhancementById, selectResult, stageVersion]
  )

  const enhanceTrayProps = {
    ...batch.trayProps,
    focus: stageVersion === "source" ? batch.trayProps.focus : -1,
    onSelect: selectSource,
    sourceLabel: "исходник",
    renderVersion,
  }

  /* Собственно обработка: исходник уже в IndexedDB, результат и миниатюра
     доезжают туда же. Метаданные ведут карточку через статусы. Всё, что
     выбрано в композере (контекст, заселение, пакетные функции, области и
     комментарий), уходит в движок одним заданием. */
  const runEnhance = useCallback(
    async (meta: Enhancement, input?: Blob) => {
      try {
        const source = input ?? (await getBlob(sourceKey(meta.id)))
        if (!source) throw new Error("Исходник не найден в хранилище браузера.")
        const result = await enhanceRender(source, {
          populate: meta.populate,
          context: meta.context,
          seed: meta.id,
          note: meta.note,
          tools: meta.tools,
          regions: meta.regions,
        })
        // Рендер могли убрать из правой панели, пока провайдер считал ответ.
        // Тогда не возвращаем удалённую пару в хранилище.
        if (!useEnhanceStore.getState().enhancements.some((item) => item.id === meta.id)) return
        await putBlob(resultKey(meta.id), result.blob)
        await putBlob(thumbResultKey(meta.id), await makeThumb(result.blob))
        update(meta.id, {
          status: "done",
          resultWidth: result.width,
          resultHeight: result.height,
          engine: result.engine,
          error: undefined,
        })
        setStageChoice({ id: meta.id, version: "result" })
      } catch (error) {
        update(meta.id, {
          status: "error",
          error: error instanceof Error ? error.message : "Обработка не удалась.",
        })
      }
    },
    [update]
  )

  const startBatch = useCallback(
    async (
      items: AttachedRender[],
      batchNote: string,
      batchContext: EnhanceContext,
      batchPopulate: boolean,
      batchTools?: BatchTools,
      regions?: RegionPayload[],
      inputVersions?: ReadonlyMap<string, "source" | "result">
    ) => {
      const project = ensureActiveProject()
      const metas: Enhancement[] = []
      const inputs = new Map<string, Blob>()
      for (const item of items) {
        const file = item.file
        try {
          const draft = useEnhanceStore.getState().enhancements.find((record) => record.id === item.id)
          const pending = savingDrafts.current.get(item.id)
          const saved = pending
            ? await pending
            : draft?.sourceReady
              ? { id: item.id, width: item.width, height: item.height }
              : await saveSourceFile(file, { id: item.id, durable: true })
          const { id, width, height } = saved
          const requestedInput = inputVersions?.get(item.id) ?? "source"
          const resultInput = requestedInput === "result" ? await getBlob(resultKey(item.id)) : null
          if (resultInput) inputs.set(item.id, resultInput)
          metas.push({
            id,
            projectId: project.id,
            status: "processing",
            context: batchContext,
            note: batchNote,
            tools: batchTools,
            populate: batchPopulate || undefined,
            regions: regions && regions.length > 0 ? regions : undefined,
            sourceName: file.name,
            sourceWidth: width,
            sourceHeight: height,
            sourceReady: true,
            inputRole: resultInput ? "result" : "source",
            createdAt: new Date().toISOString(),
          })
        } catch {
          window.alert(`«${file.name}» не удалось сохранить в хранилище браузера.`)
        }
      }
      await runGalleryQueue(
        metas,
        (meta) => {
          const exists = useEnhanceStore.getState().enhancements.some((item) => item.id === meta.id)
          if (exists) update(meta.id, meta)
          else add(meta)
        },
        (meta) => runEnhance(meta, inputs.get(meta.id))
      )
    },
    [add, runEnhance, update]
  )

  const submit = () => {
    if (attachments.length === 0) {
      intake.pickFiles()
      return
    }
    if (workingSet.length === 0 || submitBlockedReason) return
    if (!hasIntent) {
      setNotice("Выберите настройки или добавьте комментарий")
      setSettingsOpen(true)
      setAttention((value) => value + 1)
      return
    }
    setNotice(null)
    // Точечная правка: текст задания собран из общего комментария и подписей
    // областей, геометрия уходит отдельным полем.
    const regionsPayload = regionEditingActive && currentRegions.length > 0 ? buildRegionsPayload(currentRegions) : undefined
    const noteToSend = regionEditingActive ? built.comment : note.trim()
    const batchTools = tools
    const { items } = batch.takeWorkingSet({ retain: true })
    const inputVersions = new Map(
      items.map((item) => [item.id, item.id === current?.id ? stageVersion : "source"] as const)
    )
    dropRegions(items.map((item) => item.previewUrl))
    if (items[0]) setStageChoice({ id: items[0].id, version: "result" })
    setSettingsOpen(false)
    setNote("")
    void startBatch(items, noteToSend, context, populate, batchTools, regionsPayload, inputVersions)
  }

  const retry = (enhancement: Enhancement) => {
    setStageChoice({ id: enhancement.id, version: "result" })
    update(enhancement.id, { status: "processing", error: undefined })
    void (async () => {
      const input = enhancement.inputRole === "result" ? await getBlob(resultKey(enhancement.id)) : undefined
      await runEnhance(enhancement, input ?? undefined)
    })()
  }

  return (
    <ToolShell
      intake={intake}
      dropLabel="Отпустите, чтобы приложить рендеры"
      composerOpen={showComposer}
      trayOpen={tray.present}
      layers={
        <>
          {/* Композер появляется, когда есть исходник или восстанавливается
              сохранённая рабочая пара; на пустом экране его нет намеренно. */}
          <ComposerDock presence={composer} trayOpen={tray.present}>
            <ToolComposer
              attachments={attachments}
              onPickFiles={intake.pickFiles}
              onRemoveAttachment={batch.removeAttachment}
              onClearAttachments={batch.clearAttachments}
              note={note}
              onNoteChange={setNote}
              option={context}
              onOptionChange={(next) => {
                setContext(next)
                setNotice(null)
              }}
              options={CONTEXT_OPTIONS}
              labels={LABELS}
              onSubmit={submit}
              selectionLabel={batch.selectionLabel}
              settingsOpen={settingsOpen}
              onSettingsOpenChange={setSettingsOpen}
              regionTags={regionEditingActive ? currentRegions : undefined}
              onRemoveRegionTag={(id) => setCurrentRegions(currentRegions.filter((region) => region.id !== id))}
              submitBlockedReason={submitBlockedReason}
              placeholder={
                regionEditingActive && currentRegions.length > 0 ? "И что изменить в рендере целиком…" : undefined
              }
              notice={notice}
              attentionKey={attention}
              extras={
                <>
                  <QualityToggle
                    value={tools.quality}
                    onChange={(quality) => {
                      setTools((current) => ({ ...current, quality }))
                      setNotice(null)
                    }}
                  />
                  <PopulateToggle
                    value={populate}
                    onChange={(next) => {
                      setPopulate(next)
                      setNotice(null)
                    }}
                  />
                </>
              }
              tools={
                showBatchGrid ? (
                  <BatchToolsPanel
                    value={tools}
                    onChange={(next) => {
                      setTools(next)
                      setNotice(null)
                    }}
                    populate={populate}
                    onPopulateChange={(next) => {
                      setPopulate(next)
                      setNotice(null)
                    }}
                    count={pickedItems.length}
                  />
                ) : undefined
              }
            />
          </ComposerDock>

          {/* Правая панель-галерея пачки. Только на lg; ниже миниатюры под сценой. */}
          <ToolAside presence={tray} label="Приложенные рендеры">
            <RenderTray {...enhanceTrayProps} />
          </ToolAside>
        </>
      }
    >
      {current ? (
        /* Режим просмотра пачки: выбранный рендер во весь экран, на узких
           экранах под ним — полоска миниатюр (на lg они в правой панели).
           В пакетном редактировании вместо сцены — грид набора. */
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {showBatchGrid ? (
            <BatchGrid items={pickedItems} title="Пакетное редактирование" noun={LABELS.batchNoun} onLeave={batch.leaveBatch} />
          ) : (
            <Stage
              attachment={stageAttachment ?? current}
              index={focusIndex}
              count={attachments.length}
              onPrev={batch.selectPrev}
              onNext={batch.selectNext}
              overlay={
                <>
                  {/* Тот же редактор остаётся поверх исходника и результата.
                      Повторная обработка результата не затирает исходник. */}
                  <RegionEditor
                    key={`editor-${current.previewUrl}`}
                    regions={currentRegions}
                    onRegionsChange={setCurrentRegions}
                    disabled={!regionEditingActive}
                  />

                  {currentEnhancement?.status === "processing" ? (
                    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2.5 bg-black/35 text-white/90 backdrop-blur-[2px]">
                      <ThinkingGlyph size={24} />
                      <span className="text-[12px]">улучшаем рендер…</span>
                    </div>
                  ) : null}

                  {currentEnhancement?.status === "done" && stageVersion === "result" && !resultUrl ? (
                    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-2.5 bg-black/25 text-white/90">
                      <ThinkingGlyph size={22} />
                      <span className="text-[12px]">загружаем улучшенную версию…</span>
                    </div>
                  ) : null}

                  {currentEnhancement?.status === "done" && stageVersion === "result" && resultUrl ? (
                    <button
                      type="button"
                      onClick={() =>
                        void downloadStoredResult(
                          currentEnhancement,
                          `${fileBaseName(currentEnhancement.sourceName, "render")}-enhanced`
                        )
                      }
                      className="btn-outline absolute bottom-3 right-3 z-30 h-9 bg-black/55 px-3 text-[12px] text-white backdrop-blur-md"
                    >
                      <Download className="h-3.5 w-3.5" strokeWidth={1.8} />
                      Скачать
                    </button>
                  ) : null}

                  {currentEnhancement?.status === "error" && stageVersion === "result" ? (
                    <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-3 bg-black/55 px-6 text-center text-white/90">
                      <p className="max-w-[420px] text-[12.5px] leading-relaxed">
                        {currentEnhancement.error ?? "Не получилось улучшить рендер."}
                      </p>
                      <button type="button" onClick={() => retry(currentEnhancement)} className="btn-outline h-9 px-4 text-[13px]">
                        Повторить
                      </button>
                    </div>
                  ) : null}
                </>
              }
            />
          )}

          <div className="lg:hidden">
            <RenderStrip {...enhanceTrayProps} />
          </div>
        </div>
      ) : visible.length === 0 ? (
        <ToolDropzone
          onPick={intake.pickFiles}
          label="Добавить рендер"
          visual={<RenderReveal className="relative max-w-[440px]" />}
          title="Добавить рендер"
          description={`Нажмите, перетащите сюда или вставьте из буфера. PNG, JPG или WEBP до 32 МБ, до ${MAX_BATCH} файлов за раз.`}
          caption="Получите более реалистичные и детальные версии — без единого изменения в самих сценах."
        />
      ) : (
        <StagePlaceholder>
          <ThinkingGlyph size={24} />
          <span className="text-[12px]" style={{ color: "var(--fg-3)" }}>
            восстанавливаем рабочую сцену…
          </span>
        </StagePlaceholder>
      )}
    </ToolShell>
  )
}
