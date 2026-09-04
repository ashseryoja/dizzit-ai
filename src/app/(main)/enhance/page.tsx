"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Layers, Package, Sofa, Sparkles, Trees } from "lucide-react"

import { RenderReveal } from "@/components/tool/render-reveal"
import { RenderStrip, RenderTray } from "@/components/tool/render-tray"
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
  enhanceLocally,
  isAcceptedRender,
  makeThumb,
  readImageSize,
} from "@/lib/enhance-engine"
import { useMounted } from "@/lib/use-mounted"
import { usePresence } from "@/lib/use-presence"
import { cn, createId, plural } from "@/lib/utils"
import { useEnhanceStore } from "@/stores/enhance-store"
import { useProjectStore } from "@/stores/project-store"
import type { EnhanceContext, Enhancement } from "@/types"

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
  filesCaption: "свежие рендеры без сжатия · результат — в размере исходника",
  optionsTitle: "Контекст",
  optionsIcon: Layers,
  footer:
    "Содержимое кадра не меняется: геометрия, материалы, композиция и размер остаются вашими — растут только детализация и реализм.",
  inputPlaceholder: "Комментарий к обработке…",
  submitLabel: "Улучшить",
  batchNoun: ["рендер", "рендера", "рендеров"],
}

function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "") || "render"
}

/**
 * «Редактор рендера» — главный экран. Раскладка повторяет нейрофотосессию
 * UpSound: галерея результатов на всю ширину, внизу плавающий композер;
 * пачка рендеров и контекст — в его панели настроек. Пока ни рендера не
 * приложено и галерея пуста, композера нет — по центру большая зона
 * «Добавить рендер»; композер появляется вместе с первым файлом.
 *
 * Пока пачка приложена, но не отправлена, экран переключается в режим
 * просмотра: справа — панель-галерея с миниатюрами (зеркало сайдбара),
 * в центре — выбранный рендер во весь экран. Так десяток файлов не
 * теснится в чипе композера, а виден целиком.
 *
 * Обработка применяется к РАБОЧЕМУ НАБОРУ, а не ко всей пачке: в обычном
 * режиме это один рендер (тот, что на сцене), в режиме «Выбрать» панели —
 * несколько. Композер показывает размер набора рядом с полем комментария.
 */
export default function EnhancePage() {
  const mounted = useMounted()

  const activeProjectId = useProjectStore((state) => state.activeProjectId)
  const projects = useProjectStore((state) => state.projects)
  const createProject = useProjectStore((state) => state.createProject)
  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null

  const enhancements = useEnhanceStore((state) => state.enhancements)
  const add = useEnhanceStore((state) => state.add)
  const update = useEnhanceStore((state) => state.update)
  const remove = useEnhanceStore((state) => state.remove)

  const [attachments, setAttachments] = useState<AttachedRender[]>([])
  // Какой рендер пачки показан большим на сцене; по умолчанию первый.
  const [focus, setFocus] = useState(0)
  // Рабочий набор — по previewUrl: он уникален и переживает удаление
  // соседей (индексы бы поехали). Устаревшие записи отсеиваются при чтении.
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [picking, setPicking] = useState(false)
  const [note, setNote] = useState("")
  const [context, setContext] = useState<EnhanceContext>("auto")
  const [dragOver, setDragOver] = useState(false)
  const dragLayer = usePresence(dragOver)
  const dragDepth = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const visible = activeProject
    ? enhancements.filter((item) => item.projectId === activeProject.id)
    : []
  const hasAttachments = attachments.length > 0
  const showComposer = hasAttachments || visible.length > 0
  const composer = usePresence(showComposer)
  const tray = usePresence(hasAttachments)

  // Индекс не должен указывать за край пачки после удаления файлов.
  const focusIndex = Math.min(focus, Math.max(0, attachments.length - 1))
  const current = attachments[focusIndex] ?? null

  /* Что уйдёт в обработку. В режиме выбора — ровно отмеченное (может быть
     пусто); вне его отмеченное, а если ничего не отмечали — рендер со сцены. */
  const pickedItems = attachments.filter((item) => picked.has(item.previewUrl))
  const workingSet = picking || pickedItems.length > 0 ? pickedItems : current ? [current] : []
  const selectionLabel =
    workingSet.length === 0
      ? "ничего не выбрано"
      : `${plural(workingSet.length, ["выбран", "выбрано", "выбрано"])} ${workingSet.length} ${plural(workingSet.length, LABELS.batchNoun)}`

  // GC общего хранилища блобов — после гидрации сторов ВСЕХ инструментов.
  useBlobGc()

  const removeAttachment = useCallback((index: number) => {
    setAttachments((current) => {
      const target = current[index]
      if (target) URL.revokeObjectURL(target.previewUrl)
      return current.filter((_, i) => i !== index)
    })
    // Убрали рендер левее сцены — рендер на сцене сдвинулся на позицию назад.
    setFocus((value) => (index < value ? value - 1 : value))
  }, [])

  const clearAttachments = useCallback(() => {
    setAttachments((current) => {
      current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
      return []
    })
    setFocus(0)
    setPicked(new Set())
    setPicking(false)
  }, [])

  /* Клик по плитке: обычный режим — один рендер на сцену и в набор;
     режим «Выбрать» — переключить плитку в наборе, на сцену её же. */
  const selectAttachment = useCallback(
    (index: number) => {
      const item = attachments[index]
      if (!item) return
      setFocus(index)
      setPicked((set) => {
        if (!picking) return new Set([item.previewUrl])
        const next = new Set(set)
        if (next.has(item.previewUrl)) next.delete(item.previewUrl)
        else next.add(item.previewUrl)
        return next
      })
    },
    [attachments, picking]
  )

  const togglePicking = useCallback(() => setPicking((value) => !value), [])

  const pickAll = useCallback(() => {
    setPicked((set) => {
      const all = attachments.every((item) => set.has(item.previewUrl))
      return all ? new Set() : new Set(attachments.map((item) => item.previewUrl))
    })
  }, [attachments])

  /* Приём файлов — из диалога, переноса или буфера. Правила одинаковые для
     всех трёх путей, лишнее сверх пачки отбрасывается с предупреждением. */
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

  /* Стрелки листают сцену. Вне режима выбора листание и есть выбор
     (набор — один рендер), в режиме выбора набор не трогаем. */
  const step = useCallback(
    (delta: number) => {
      const next = Math.min(attachments.length - 1, Math.max(0, focusIndex + delta))
      const item = attachments[next]
      if (!item) return
      setFocus(next)
      if (!picking) setPicked(new Set([item.previewUrl]))
    },
    [attachments, focusIndex, picking]
  )
  const selectPrev = useCallback(() => step(-1), [step])
  const selectNext = useCallback(() => step(1), [step])

  // Клавиатура: стрелки — листание, Escape — выход из режима выбора.
  // Кроме случая, когда каретка в поле ввода.
  useEffect(() => {
    if (!hasAttachments) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return
      if (event.key === "ArrowLeft") selectPrev()
      if (event.key === "ArrowRight") selectNext()
      if (event.key === "Escape") setPicking(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [hasAttachments, selectPrev, selectNext])

  /* Собственно обработка: исходник уже в IndexedDB, результат и миниатюра
     доезжают туда же. Метаданные ведут карточку через статусы. */
  const runEnhance = useCallback(
    async (meta: Enhancement) => {
      try {
        const source = await getBlob(sourceKey(meta.id))
        if (!source) throw new Error("Исходник не найден в хранилище браузера.")
        const result = await enhanceLocally(source)
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
          error: error instanceof Error ? error.message : "Обработка не удалась.",
        })
      }
    },
    [update]
  )

  /* Пачка: карточки появляются все сразу (статус «обрабатывается»),
     обработка идёт по одной — десяток канвасов разом раздул бы память. */
  const startBatch = useCallback(
    async (files: File[], batchNote: string, batchContext: EnhanceContext) => {
      // Без активного проекта обработки некуда класть — создаём «Проект N»,
      // как это делает селектор в сайдбаре.
      const project = activeProject ?? createProject()

      const metas: Enhancement[] = []
      for (const file of files) {
        try {
          const { width, height } = await readImageSize(file)
          const id = createId()
          await putBlob(sourceKey(id), file)
          await putBlob(thumbSourceKey(id), await makeThumb(file))
          metas.push({
            id,
            projectId: project.id,
            status: "processing",
            context: batchContext,
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

      // add() кладёт в голову списка — добавляем с конца, чтобы порядок
      // пачки в галерее совпал с порядком выбора файлов.
      for (const meta of [...metas].reverse()) add(meta)
      for (const meta of metas) await runEnhance(meta)
    },
    [activeProject, createProject, add, runEnhance]
  )

  /* В обработку уходит рабочий набор; остальная пачка остаётся в панели,
     чтобы к ней можно было применить другие настройки. */
  const submit = () => {
    if (attachments.length === 0) {
      pickFiles()
      return
    }
    if (workingSet.length === 0) return
    const sent = new Set(workingSet.map((item) => item.previewUrl))
    const files = workingSet.map((item) => item.file)
    setAttachments((current) => {
      current.filter((item) => sent.has(item.previewUrl)).forEach((item) => URL.revokeObjectURL(item.previewUrl))
      return current.filter((item) => !sent.has(item.previewUrl))
    })
    setPicked(new Set())
    setPicking(false)
    setFocus(0)
    const batchNote = note.trim()
    setNote("")
    void startBatch(files, batchNote, context)
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

  // Перенос файлов на страницу. Счётчик — dragleave стреляет на каждом
  // дочернем элементе, и без него подсветка мигала бы.
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

  // Вставка из буфера — третий путь приёма, наравне с кнопкой и переносом.
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
      className={cn(
        "page-shell transition-[margin] duration-300",
        showComposer && "pb-32",
        // Справа — место под панель-галерею, зеркально отступу под сайдбар.
        tray.present && "lg:mr-[296px]"
      )}
      style={{ transitionTimingFunction: "var(--ease-out)" }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? [])
          // Сброс сразу: повторный выбор тех же файлов иначе не вызовет onChange.
          event.target.value = ""
          if (files.length > 0) void attachFiles(files)
        }}
      />

      {dragLayer.present ? (
        <div
          data-state={dragLayer.state}
          className="presence-fade pointer-events-none fixed inset-3 z-50 flex items-center justify-center"
          style={{
            border: "2px dashed var(--accent)",
            borderRadius: "var(--r-xl)",
            background: "rgba(16,16,18,0.55)",
          }}
        >
          <span className="text-[15px]" style={{ color: "var(--fg-1)" }}>
            Отпустите, чтобы приложить рендеры
          </span>
        </div>
      ) : null}

      <div className="page-content-wide flex flex-1 flex-col">
        {current ? (
          /* Режим просмотра пачки: выбранный рендер во весь экран, на узких
             экранах под ним — полоска миниатюр (на lg они в правой панели). */
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="stage min-h-[320px] flex-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img key={current.previewUrl} src={current.previewUrl} alt={current.file.name} draggable={false} />

              <span className="stage-badge left-3 top-3">
                <span className="truncate">{current.file.name}</span>
                <span style={{ color: "rgba(255,255,255,0.55)" }}>
                  {current.width}×{current.height}
                </span>
              </span>
              {attachments.length > 1 ? (
                <span className="stage-badge right-3 top-3 tabular-nums">
                  {focusIndex + 1} / {attachments.length}
                </span>
              ) : null}

              {attachments.length > 1 ? (
                <>
                  <button
                    type="button"
                    onClick={selectPrev}
                    disabled={focusIndex === 0}
                    aria-label="Предыдущий рендер"
                    className="stage-nav left-3"
                  >
                    <ChevronLeft className="h-4 w-4" strokeWidth={1.8} />
                  </button>
                  <button
                    type="button"
                    onClick={selectNext}
                    disabled={focusIndex === attachments.length - 1}
                    aria-label="Следующий рендер"
                    className="stage-nav right-3"
                  >
                    <ChevronRight className="h-4 w-4" strokeWidth={1.8} />
                  </button>
                </>
              ) : null}
            </div>

            <div className="lg:hidden">
              <RenderStrip
                attachments={attachments}
                focus={focusIndex}
                picked={picked}
                picking={picking}
                onTogglePicking={togglePicking}
                onSelect={selectAttachment}
                onRemove={removeAttachment}
                onPickFiles={pickFiles}
                maxFiles={MAX_BATCH}
              />
            </div>
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 py-6">
            {/* Большая зона приёма: клик открывает диалог, перенос и вставка
                из буфера работают на всей странице. Контур — SVG-пунктир,
                внутри — живое «до/после» (см. .dropzone и .re-* в surfaces.css). */}
            <button
              type="button"
              onClick={pickFiles}
              aria-label="Добавить рендер"
              className="dropzone flex w-full max-w-[720px] flex-col items-center justify-center gap-5 px-6 py-16 sm:py-20"
              style={{ borderRadius: "var(--r-xl)" }}
            >
              <svg className="dropzone-outline" aria-hidden>
                <rect width="100%" height="100%" rx="23" />
              </svg>

              <RenderReveal className="relative max-w-[440px]" />

              <span className="relative flex flex-col items-center gap-1.5">
                <span className="ds-h2" style={{ color: "var(--fg-1)" }}>
                  Добавить рендер
                </span>
                <span className="ds-body max-w-md text-center" style={{ color: "var(--fg-3)" }}>
                  Нажмите, перетащите сюда или вставьте из буфера. PNG, JPG или WEBP до 32 МБ, до {MAX_BATCH} файлов за раз.
                </span>
              </span>
            </button>
            <p className="ds-caption max-w-md text-center">
              Получите более реалистичные и детальные версии — без единого изменения в самих сценах.
            </p>
          </div>
        ) : (
          <div className="columns-1 gap-4 sm:columns-2 xl:columns-3">
            {visible.map((enhancement) => (
              <ToolCard
                key={enhancement.id}
                item={enhancement}
                caption={`${(enhancement.status === "done" && enhancement.resultWidth) || enhancement.sourceWidth}×${
                  (enhancement.status === "done" && enhancement.resultHeight) || enhancement.sourceHeight
                } · ${CONTEXT_LABEL[enhancement.context] ?? "авто"}`}
                processingLabel="улучшаем рендер…"
                downloadBaseName={`${baseName(enhancement.sourceName)}-enhanced`}
                onRetry={() => retry(enhancement)}
                onDelete={() => deleteEnhancement(enhancement)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Композер появляется, когда есть что обрабатывать или уже есть
          галерея, куда докладывать; на пустом экране его нет намеренно. */}
      {composer.present ? (
        <div
          data-state={composer.state}
          className={cn(
            "presence-rise pointer-events-none fixed inset-x-3 bottom-3 z-30 flex justify-center lg:left-[312px] lg:bottom-5",
            tray.present ? "lg:right-[312px]" : "lg:right-8"
          )}
        >
          <ToolComposer
            attachments={attachments}
            onPickFiles={pickFiles}
            onRemoveAttachment={removeAttachment}
            onClearAttachments={clearAttachments}
            note={note}
            onNoteChange={setNote}
            option={context}
            onOptionChange={setContext}
            options={CONTEXT_OPTIONS}
            labels={LABELS}
            onSubmit={submit}
            selectionLabel={hasAttachments ? selectionLabel : null}
          />
        </div>
      ) : null}

      {/* Правая панель-галерея пачки — зеркало сайдбара: та же ширина,
          отступы и поверхность. Только на lg; ниже миниатюры под сценой. */}
      {tray.present ? (
        <aside
          data-state={tray.state}
          aria-label="Приложенные рендеры"
          className="presence-slide fixed bottom-4 right-4 top-4 z-40 hidden w-[264px] flex-col overflow-hidden lg:flex"
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--line)",
            borderRadius: "var(--r-xl)",
            boxShadow: "0 16px 40px rgba(0, 0, 0, 0.35)",
          }}
        >
          <RenderTray
            attachments={attachments}
            focus={focusIndex}
            picked={picked}
            picking={picking}
            onTogglePicking={togglePicking}
            onPickAll={pickAll}
            onSelect={selectAttachment}
            onRemove={removeAttachment}
            onPickFiles={pickFiles}
            onClear={clearAttachments}
            maxFiles={MAX_BATCH}
            noun={LABELS.batchNoun}
          />
        </aside>
      ) : null}
    </div>
  )
}
