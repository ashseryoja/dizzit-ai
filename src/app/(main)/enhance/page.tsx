"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Layers, Package, Sofa, Sparkles, Trees } from "lucide-react"

import {
  BatchToolsPanel,
  DEFAULT_BATCH_TOOLS,
  FILTER_LABEL,
  PopulateToggle,
  QualityToggle,
  TIME_LABEL,
} from "@/components/tool/batch-tools"
import { RegionEditor } from "@/components/tool/region-editor"
import { RenderReveal } from "@/components/tool/render-reveal"
import { RenderStrip, RenderTray } from "@/components/tool/render-tray"
import { BatchGrid, Stage } from "@/components/tool/stage"
import { ToolCard } from "@/components/tool/tool-card"
import { ToolComposer, type ToolComposerLabels, type ToolOption } from "@/components/tool/tool-composer"
import { ToolDropzone } from "@/components/tool/tool-dropzone"
import { ComposerDock, ToolAside, ToolGallery, ToolShell } from "@/components/tool/tool-shell"
import { deleteBlobs, getBlob, keysOf, putBlob, resultKey, sourceKey, thumbResultKey } from "@/lib/blob-store"
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
import { fileBaseName, plural } from "@/lib/utils"
import { useEnhanceStore } from "@/stores/enhance-store"
import { ensureActiveProject, useActiveProject } from "@/stores/project-store"
import type { BatchTools, EnhanceContext, Enhancement } from "@/types"

const CONTEXT_OPTIONS: ToolOption<EnhanceContext>[] = [
  { value: "auto", label: "Авто", icon: Sparkles },
  { value: "interior", label: "Интерьер", icon: Sofa },
  { value: "exterior", label: "Экстерьер", icon: Trees },
  { value: "product", label: "Предметный", icon: Package },
]

const CONTEXT_LABEL: Record<EnhanceContext, string> = {
  auto: "авто",
  interior: "интерьер",
  exterior: "экстерьер",
  product: "предметный",
}

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
async function getDraftSource(id: string): Promise<Blob | null> {
  for (const delay of [0, 400, 1200, 2500, 5000]) {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    const blob = await getBlob(sourceKey(id))
    if (blob) return blob
  }
  return null
}

/** Хвост подписи карточки для пакетной обработки: что именно применили. */
function toolsCaption(tools: BatchTools | undefined): string {
  if (!tools) return ""
  const parts: string[] = []
  if (tools.quality) parts.push("качество")
  if (tools.filter !== "none") parts.push(FILTER_LABEL[tools.filter].toLowerCase())
  if (tools.time !== "keep") parts.push(TIME_LABEL[tools.time].toLowerCase())
  return parts.length ? ` · ${parts.join(" · ")}` : ""
}

/** Хвост подписи карточки: сцена заселена людьми и растениями. */
function populateCaption(populate: boolean | undefined): string {
  return populate ? " · заселение" : ""
}

/** Хвост подписи карточки: сколько областей отмечено на кадре. */
function regionsCaption(regions: RegionPayload[] | undefined): string {
  if (!regions || regions.length === 0) return ""
  return ` · ${regions.length} ${plural(regions.length, ["область", "области", "областей"])}`
}

/**
 * «Редактор рендера» — главный экран. Раскладка повторяет нейрофотосессию
 * UpSound: галерея результатов на всю ширину, внизу плавающий композер;
 * пачка рендеров и контекст — в его панели настроек. Пока ни рендера не
 * приложено и галерея пуста, композера нет — по центру большая зона
 * «Добавить рендер»; композер появляется вместе с первым файлом.
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

  const detachDrafts = useCallback(
    (items: AttachedRender[], reason: AttachmentDetachReason) => {
      dropRegions(items.map((item) => item.previewUrl))
      if (reason !== "discard") return
      const current = useEnhanceStore.getState().enhancements
      for (const item of items) {
        if (current.some((record) => record.id === item.id && record.status === "draft")) remove(item.id)
      }
    },
    [dropRegions, remove]
  )
  const intake = useAttachments({ maxFiles: MAX_BATCH, onDetach: detachDrafts })
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

  const visible = activeProject
    ? enhancements.filter((item) => item.projectId === activeProject.id && item.status !== "draft")
    : []
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

  /* После гидрации стора достаём исходники черновиков из локального кэша,
     а на другом устройстве — из приватного Vercel Blob. */
  const restoringDrafts = useRef<string | null>(null)
  const draftsToRestore = useMemo(() => {
    if (!activeProject) return []
    const attachedIds = new Set(attachments.map((attachment) => attachment.id))
    return enhancements
      .filter(
        (item) => item.projectId === activeProject.id && item.status === "draft" && !attachedIds.has(item.id)
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .slice(0, Math.max(0, MAX_BATCH - attachments.length))
  }, [activeProject, attachments, enhancements])
  const restoreSignature = draftsToRestore.map((draft) => draft.id).join(",")
  const draftsToRestoreRef = useRef(draftsToRestore)
  draftsToRestoreRef.current = draftsToRestore
  useEffect(() => {
    if (!activeProject || !restoreSignature || restoringDrafts.current === restoreSignature) return
    restoringDrafts.current = restoreSignature
    let cancelled = false
    void Promise.all(
      draftsToRestoreRef.current.map(async (draft) => {
        const blob = await getDraftSource(draft.id)
        if (!blob) return null
        const file = new File([blob], draft.sourceName, {
          type: blob.type || "image/jpeg",
          lastModified: Date.parse(draft.createdAt) || Date.now(),
        })
        return { id: draft.id, file, width: draft.sourceWidth, height: draft.sourceHeight }
      })
    )
      .then((items) => {
        if (!cancelled) restoreAttachments(items.filter((item): item is NonNullable<typeof item> => Boolean(item)))
      })
      .finally(() => {
        if (restoringDrafts.current === restoreSignature) restoringDrafts.current = null
      })
    return () => {
      cancelled = true
    }
  }, [activeProject, restoreAttachments, restoreSignature])

  /* Точечная правка живёт только у ОДНОГО рендера на сцене: при наборе из
     нескольких холст заморожен — точечные правки к пачке неприменимы. */
  const currentRegions = current ? (regionsByUrl[current.previewUrl] ?? []) : []
  const regionEditingActive = Boolean(current) && !showBatchGrid && workingSet.length === 1 && workingSet[0] === current
  const built = buildEditComment({ userComment: note, regions: regionEditingActive ? currentRegions : [] })
  const submitBlockedReason = regionEditingActive ? editBlockReason(built) : null

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

  /* Собственно обработка: исходник уже в IndexedDB, результат и миниатюра
     доезжают туда же. Метаданные ведут карточку через статусы. Всё, что
     выбрано в композере (контекст, заселение, пакетные функции, области и
     комментарий), уходит в движок одним заданием. */
  const runEnhance = useCallback(
    async (meta: Enhancement) => {
      try {
        const source = await getBlob(sourceKey(meta.id))
        if (!source) throw new Error("Исходник не найден в хранилище браузера.")
        const result = await enhanceRender(source, {
          populate: meta.populate,
          context: meta.context,
          seed: meta.id,
          note: meta.note,
          tools: meta.tools,
          regions: meta.regions,
        })
        await putBlob(resultKey(meta.id), result.blob)
        await putBlob(thumbResultKey(meta.id), await makeThumb(result.blob))
        update(meta.id, {
          status: "done",
          resultWidth: result.width,
          resultHeight: result.height,
          engine: result.engine,
          error: undefined,
        })
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
      regions?: RegionPayload[]
    ) => {
      const project = ensureActiveProject()
      const metas: Enhancement[] = []
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
        runEnhance
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
    const { items } = batch.takeWorkingSet()
    setSettingsOpen(false)
    setNote("")
    void startBatch(items, noteToSend, context, populate, batchTools, regionsPayload)
  }

  const retry = (enhancement: Enhancement) => {
    update(enhancement.id, { status: "processing", error: undefined })
    void runEnhance(enhancement)
  }

  const deleteEnhancement = (enhancement: Enhancement) => {
    const confirmed = window.confirm("Удалить обработку вместе с результатом? Действие необратимо.")
    if (!confirmed) return
    remove(enhancement.id)
  }

  return (
    <ToolShell
      intake={intake}
      dropLabel="Отпустите, чтобы приложить рендеры"
      composerOpen={showComposer}
      trayOpen={tray.present}
      layers={
        <>
          {/* Композер появляется, когда есть что обрабатывать или уже есть
              галерея, куда докладывать; на пустом экране его нет намеренно. */}
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
            <RenderTray {...batch.trayProps} />
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
              attachment={current}
              index={focusIndex}
              count={attachments.length}
              onPrev={batch.selectPrev}
              onNext={batch.selectNext}
              overlay={
                /* Холст точечной правки накрывает ровно кадр. Ключ по рендеру:
                   у каждого свой инструмент, активная область и панель. */
                <RegionEditor
                  key={`editor-${current.previewUrl}`}
                  regions={currentRegions}
                  onRegionsChange={setCurrentRegions}
                  disabled={!regionEditingActive}
                />
              }
            />
          )}

          <div className="lg:hidden">
            <RenderStrip {...batch.trayProps} />
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
        <ToolGallery>
          {visible.map((enhancement) => (
            <ToolCard
              key={enhancement.id}
              item={enhancement}
              caption={`${(enhancement.status === "done" && enhancement.resultWidth) || enhancement.sourceWidth}×${
                (enhancement.status === "done" && enhancement.resultHeight) || enhancement.sourceHeight
              } · ${CONTEXT_LABEL[enhancement.context] ?? "авто"}${toolsCaption(enhancement.tools)}${populateCaption(enhancement.populate)}${regionsCaption(enhancement.regions)}`}
              processingLabel="улучшаем рендер…"
              downloadBaseName={`${fileBaseName(enhancement.sourceName, "render")}-enhanced`}
              onRetry={() => retry(enhancement)}
              onDelete={() => deleteEnhancement(enhancement)}
            />
          ))}
        </ToolGallery>
      )}
    </ToolShell>
  )
}
