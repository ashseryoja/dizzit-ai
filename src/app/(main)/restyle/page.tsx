"use client"

import { useCallback, useState } from "react"
import {
  Armchair,
  Building2,
  Columns3,
  Factory,
  Feather,
  Flower,
  Flower2,
  Gem,
  Lamp,
  Leaf,
  Snowflake,
  Sparkles,
  Sun,
  SwatchBook,
  type LucideIcon,
} from "lucide-react"

import { RenderStrip, RenderTray } from "@/components/tool/render-tray"
import { BatchGrid, Stage } from "@/components/tool/stage"
import { StyleDock } from "@/components/tool/style-dock"
import { StylePicker } from "@/components/tool/style-picker"
import { StyleSwap } from "@/components/tool/style-swap"
import { ToolCard } from "@/components/tool/tool-card"
import { ToolComposer, type ToolComposerLabels, type ToolOption } from "@/components/tool/tool-composer"
import { ToolDropzone } from "@/components/tool/tool-dropzone"
import { ComposerDock, ToolAside, ToolGallery, ToolShell } from "@/components/tool/tool-shell"
import { getBlob, putBlob, resultKey, sourceKey, thumbResultKey } from "@/lib/blob-store"
import { MAX_BATCH, makeThumb } from "@/lib/enhance-engine"
import { STYLES, STYLE_LABEL, describeStyle, resolveStyle, restyleRender, type RestyleFamily } from "@/lib/restyle-engine"
import { runGalleryQueue, saveSourceFile } from "@/lib/tool-jobs"
import { useAttachments } from "@/lib/use-attachments"
import { useBatchSelection } from "@/lib/use-batch-selection"
import { usePresence } from "@/lib/use-presence"
import { fileBaseName, plural } from "@/lib/utils"
import { ensureActiveProject, useActiveProject } from "@/stores/project-store"
import { useRestyleStore } from "@/stores/restyle-store"
import type { Restyle, RestyleStyle } from "@/types"

/* Иконки стилей для сегмента в панели композера; карточки на сцене — с палитрами. */
const STYLE_ICON: Record<RestyleFamily, LucideIcon> = {
  scandi: Snowflake,
  neoclassic: Columns3,
  japandi: Leaf,
  loft: Factory,
  minimal: Armchair,
  midcentury: Lamp,
  boho: Flower2,
  artdeco: Gem,
  mediterranean: Sun,
  provence: Flower,
  wabisabi: Feather,
  contemporary: Building2,
}

const STYLE_OPTIONS: ToolOption<RestyleStyle>[] = [
  { value: "auto", label: STYLE_LABEL.auto, icon: Sparkles },
  ...STYLES.map((style) => ({ value: style.value, label: style.label, icon: STYLE_ICON[style.value] })),
]

const LABELS: ToolComposerLabels = {
  filesTitle: "Интерьеры",
  filesQuality: "исходники",
  uploadTitle: "Загрузить интерьеры",
  filesCaption: "рендер или фото помещения · результат до 1536 px по длинной стороне",
  optionsTitle: "Стиль",
  optionsIcon: SwatchBook,
  footer:
    "Геометрия помещения остаётся вашей: стены, окна и расстановка на месте — меняются отделка, цвета и дизайн мебели. Комментарий уточняет: «без кирпича», «светлее пол».",
  inputPlaceholder: "В какой стиль перевести…",
  submitLabel: "Перенести",
  batchNoun: ["интерьер", "интерьера", "интерьеров"],
}

/**
 * «Перенос стиля» — готовый интерьер переводится в другой стиль: например,
 * скандинавский в неоклассику. Каркас, приём файлов, панель-галерея пачки,
 * сцена и рабочий набор — общие для инструментов (см. docs/TOOL_UI.md).
 * Своё у переноса стиля: список стилей рядом со сценой (на xl — вторая
 * закреплённая панель левее панели пачки, ниже — блок под сценой) и секция
 * материалов выбранного стиля над композером с галочками «без кирпича».
 *
 * Стиль применяется к РАБОЧЕМУ НАБОРУ, как и обработка в редакторе рендера:
 * в обычном режиме это интерьер на сцене, в режиме «Выбрать» панели —
 * отмеченные; «Перенести все» показывает набор гридом вместо сцены. Остальная
 * пачка остаётся в панели.
 */
export default function RestylePage() {
  const activeProject = useActiveProject()

  const restyles = useRestyleStore((state) => state.restyles)
  const add = useRestyleStore((state) => state.add)
  const update = useRestyleStore((state) => state.update)
  const remove = useRestyleStore((state) => state.remove)

  const intake = useAttachments({ maxFiles: MAX_BATCH })
  const batch = useBatchSelection(intake, { noun: LABELS.batchNoun })
  const { attachments, current, focusIndex, pickedItems, workingSet, showBatchGrid } = batch

  const [note, setNoteState] = useState("")
  const [style, setStyle] = useState<RestyleStyle>("auto")
  // Снятые галочкой материалы выбранного стиля — их в рендере быть не должно.
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set())
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Замечание над строкой ввода и «волна» по настройкам: без стиля и описания
  // «Перенести» не запускает обработку, а показывает, что выбрать.
  const [notice, setNotice] = useState<string | null>(null)
  const [attention, setAttention] = useState(0)
  const setNote = (value: string) => {
    setNoteState(value)
    if (value.trim()) setNotice(null)
  }
  const selectStyle = (next: RestyleStyle) => {
    setStyle(next)
    // У другого стиля другие материалы — галочки начинаются заново.
    setExcluded(new Set())
    setNotice(null)
  }
  const toggleExcluded = (name: string) =>
    setExcluded((set) => {
      const next = new Set(set)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })

  const visible = activeProject ? restyles.filter((item) => item.projectId === activeProject.id) : []
  const hasAttachments = attachments.length > 0
  const showComposer = hasAttachments || visible.length > 0
  const composer = usePresence(showComposer)
  const tray = usePresence(hasAttachments)

  const runRestyle = useCallback(
    async (meta: Restyle) => {
      try {
        const source = await getBlob(sourceKey(meta.id))
        if (!source) throw new Error("Исходник не найден в хранилище браузера.")
        const result = await restyleRender(source, { style: meta.style, note: meta.note, excluded: meta.excluded })
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
          error: error instanceof Error ? error.message : "Перенос стиля не удался.",
        })
      }
    },
    [update]
  )

  const startBatch = useCallback(
    async (files: File[], batchNote: string, batchStyle: RestyleStyle, batchExcluded: string[]) => {
      const project = ensureActiveProject()
      const metas: Restyle[] = []
      for (const file of files) {
        try {
          const { id, width, height } = await saveSourceFile(file)
          metas.push({
            id,
            projectId: project.id,
            status: "processing",
            style: batchStyle,
            excluded: batchExcluded.length > 0 ? batchExcluded : undefined,
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
      await runGalleryQueue(metas, add, runRestyle)
    },
    [add, runRestyle]
  )

  const submit = () => {
    if (attachments.length === 0) {
      intake.pickFiles()
      return
    }
    if (workingSet.length === 0) return
    // «Свой стиль» без описания — стиль неоткуда взять.
    if (style === "auto" && !note.trim()) {
      setNotice("Выберите стиль на карточках или опишите его")
      setAttention((value) => value + 1)
      return
    }
    setNotice(null)
    const sentNote = note.trim()
    const { files } = batch.takeWorkingSet()
    setNoteState("")
    setSettingsOpen(false)
    void startBatch(files, sentNote, style, style === "auto" ? [] : [...excluded])
  }

  const retry = (item: Restyle) => {
    update(item.id, { status: "processing", error: undefined })
    void runRestyle(item)
  }

  const deleteRestyle = (item: Restyle) => {
    const confirmed = window.confirm("Удалить результат вместе с исходником? Действие необратимо.")
    if (!confirmed) return
    remove(item.id)
  }

  const styleLabel = STYLE_LABEL[style]
  const placeholder =
    style === "auto"
      ? "Опишите свой стиль: эпоха, материалы, настроение…"
      : `Уточнения к стилю «${styleLabel.toLowerCase()}»: без кирпича, светлее пол…`

  return (
    <ToolShell
      intake={intake}
      dropLabel="Отпустите, чтобы приложить интерьеры"
      composerOpen={showComposer}
      trayOpen={tray.present}
      // Справа — панель-галерея (lg) и панель стилей рядом с ней (xl).
      trayMargin="lg:mr-[296px] xl:mr-[588px]"
      layers={
        <>
          <ComposerDock presence={composer} trayOpen={tray.present} trayRight="lg:right-[312px] xl:right-[588px]">
            <ToolComposer
              attachments={attachments}
              onPickFiles={intake.pickFiles}
              onRemoveAttachment={batch.removeAttachment}
              onClearAttachments={batch.clearAttachments}
              note={note}
              onNoteChange={setNote}
              option={style}
              onOptionChange={selectStyle}
              options={STYLE_OPTIONS}
              labels={LABELS}
              onSubmit={submit}
              selectionLabel={batch.selectionLabel}
              settingsOpen={settingsOpen}
              onSettingsOpenChange={setSettingsOpen}
              notice={notice}
              attentionKey={attention}
              placeholder={hasAttachments ? placeholder : undefined}
              dock={
                hasAttachments && style !== "auto" ? (
                  <StyleDock
                    style={style}
                    excluded={excluded}
                    onToggle={toggleExcluded}
                    onRestore={() => setExcluded(new Set())}
                    onClear={() => selectStyle("auto")}
                  />
                ) : undefined
              }
            />
          </ComposerDock>

          {/* Панель стилей — такая же высокая, как панель пачки, левее неё.
              Только на xl; ниже список живёт блоком под сценой. */}
          <ToolAside presence={tray} label="Стили" className="right-[292px] w-[280px] xl:flex">
            <div className="flex h-16 shrink-0 items-center px-5">
              <StylePanelHeader style={style} label={styleLabel} />
            </div>
            <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-3">
              <StylePicker value={style} onChange={selectStyle} />
            </div>
            <div className="shrink-0 px-5 pb-4 pt-2">
              <hr className="ds-divider mb-3" />
              <p className="ds-caption">Пожелания — в комментарии внизу: «лофт, но без кирпича», «светлее пол».</p>
            </div>
          </ToolAside>

          <ToolAside presence={tray} label="Приложенные интерьеры">
            <RenderTray {...batch.trayProps} title="интерьеры" editLabel="Перенести" />
          </ToolAside>
        </>
      }
    >
      {current ? (
        /* Сцена по центру; стили — в закреплённой панели справа (xl), ниже —
           блоком под сценой; миниатюры на узких экранах — полоской. */
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="mx-auto flex w-full max-w-[880px] flex-col gap-2">
            {showBatchGrid ? (
              <BatchGrid items={pickedItems} title="Пакетный перенос" noun={LABELS.batchNoun} onLeave={batch.leaveBatch} compact />
            ) : (
              <Stage
                attachment={current}
                index={focusIndex}
                count={attachments.length}
                onPrev={batch.selectPrev}
                onNext={batch.selectNext}
                itemLabel="интерьер"
                className="aspect-[4/3] w-full"
              />
            )}
            <p className="ds-caption px-1">
              {workingSet.length === 0
                ? "Ничего не выбрано — отметьте интерьеры в панели справа."
                : workingSet.length === 1
                  ? `Стиль применится к интерьеру на сцене${style === "auto" ? "" : `: ${styleLabel.toLowerCase()}`}.`
                  : `Стиль применится к ${workingSet.length} выбранным ${plural(workingSet.length, ["интерьеру", "интерьерам", "интерьерам"])} сразу${style === "auto" ? "" : `: ${styleLabel.toLowerCase()}`}.`}
            </p>
          </div>

          {/* Ниже xl панели стилей нет — список блоком под сценой, со своим скроллом. */}
          <div className="mx-auto flex w-full max-w-[880px] flex-col gap-2 xl:hidden">
            <StylePanelHeader style={style} label={styleLabel} />
            <div className="card scroll-thin max-h-[46dvh] overflow-y-auto p-2" style={{ borderRadius: "var(--r-lg)" }}>
              <StylePicker value={style} onChange={selectStyle} />
            </div>
          </div>

          <div className="lg:hidden">
            <RenderStrip {...batch.trayProps} editLabel="Перенести" />
          </div>
        </div>
      ) : visible.length === 0 ? (
        /* Зона приёма: одна комната, у которой по кругу меняется стиль (см. .ss-* в surfaces.css). */
        <ToolDropzone
          onPick={intake.pickFiles}
          label="Добавить интерьер"
          visual={<StyleSwap className="relative w-full max-w-[520px]" />}
          title="Добавить интерьер"
          description={`Рендер или фото помещения — и тот же интерьер в другом стиле: скандинавский, неоклассика, джапанди, лофт и ещё десяток. Нажмите, перетащите сюда или вставьте из буфера. PNG, JPG или WEBP до 32 МБ, до ${MAX_BATCH} файлов за раз.`}
          caption="Планировка, окна и расстановка остаются — меняются отделка, цвета и мебель."
          className="max-w-[720px] gap-5 px-6 py-12 sm:py-14"
        />
      ) : (
        <ToolGallery>
          {visible.map((item) => (
            <ToolCard
              key={item.id}
              item={item}
              caption={`${(item.status === "done" && item.resultWidth) || item.sourceWidth}×${
                (item.status === "done" && item.resultHeight) || item.sourceHeight
              } · ${describeStyle(item.style, item.note)}${
                item.excluded && item.excluded.length > 0 ? ` · без: ${item.excluded.join(", ")}` : ""
              }${item.note ? ` · ${item.note}` : ""}`}
              processingLabel="переносим стиль…"
              downloadBaseName={`${fileBaseName(item.sourceName, "interior")}-${resolveStyle(item.style, item.note)}`}
              onRetry={() => retry(item)}
              onDelete={() => deleteRestyle(item)}
            />
          ))}
        </ToolGallery>
      )}
    </ToolShell>
  )
}

/** Заголовок панели стилей: «стиль» и что выбрано сейчас. */
function StylePanelHeader({ style, label }: { style: RestyleStyle; label: string }) {
  return (
    <span className="flex w-full items-baseline justify-between gap-2">
      <span className="flex items-baseline gap-2">
        <span className="ds-micro">стиль</span>
        <span className="text-[12px]" style={{ color: "var(--fg-4)" }}>
          {style === "auto" ? "по описанию" : label.toLowerCase()}
        </span>
      </span>
      <SwatchBook className="h-3.5 w-3.5 shrink-0 self-center" strokeWidth={1.6} style={{ color: "var(--fg-5)" }} />
    </span>
  )
}
