"use client"

import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type RefObject } from "react"

import { ENHANCE_ACCEPT, MAX_BATCH, MAX_FILE_BYTES, isAcceptedRender, readImageSize } from "@/lib/enhance-engine"
import { createId } from "@/lib/utils"

/** Приложенный файл до отправки: сам файл + размеры + превью. */
export interface AttachedRender {
  /** Стабильный id черновика: связывает запись, исходник и превью между перезагрузками. */
  id: string
  file: File
  width: number
  height: number
  previewUrl: string
}

export type AttachmentDetachReason = "discard" | "consume"

export interface RestoredAttachment {
  id: string
  file: File
  width: number
  height: number
}

export interface UseAttachmentsOptions {
  /**
   * Лимит файлов в пачке; по умолчанию общий MAX_BATCH. `Infinity` — пачка
   * без лимита (редактор рендера хранит в ней все записи проекта, а лимит
   * действует только на рабочий набор — см. `useBatchSelection.maxWorkingSet`).
   */
  maxFiles?: number
  /** Новые файлы ЗАМЕНЯЮТ приложенные, а не докладываются: «Фото → 3D» — одно фото на модель. */
  replace?: boolean
  /**
   * Файлы уходят из пачки (убрали один, очистили, отправили в обработку) —
   * страница подчищает то, что хранила по previewUrl (области правки и т.п.).
   */
  onDetach?: (items: AttachedRender[], reason: AttachmentDetachReason) => void
}

/** Приём файлов инструмента — то, что нужно ToolShell и композеру. */
export interface AttachmentIntake {
  attachments: AttachedRender[]
  maxFiles: number
  /** Приложить файлы — из диалога, переноса или буфера. Правила одни на все три пути. */
  attachFiles: (files: File[]) => Promise<void>
  removeAttachment: (index: number) => void
  clearAttachments: () => void
  /** Убрать из пачки перечисленные (по previewUrl) — так уходит рабочий набор при отправке. */
  detach: (urls: Iterable<string>, reason?: AttachmentDetachReason) => void
  /** Восстановить уже проверенные файлы из IndexedDB/серверного хранилища. */
  restoreAttachments: (items: RestoredAttachment[]) => void
  /** Открыть системный диалог выбора файлов. */
  pickFiles: () => void
  /** Скрытый <input type="file"> — его рендерит ToolShell. */
  inputRef: RefObject<HTMLInputElement | null>
  onInputChange: (event: ChangeEvent<HTMLInputElement>) => void
  accept: string
  multiple: boolean
  /** Над страницей тянут файлы — ToolShell показывает слой «Отпустите…». */
  dragOver: boolean
  dropProps: {
    onDragEnter: (event: DragEvent) => void
    onDragOver: (event: DragEvent) => void
    onDragLeave: (event: DragEvent) => void
    onDrop: (event: DragEvent) => void
  }
}

function hasFiles(event: DragEvent): boolean {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files")
}

/**
 * Приём файлов — общий для всех инструментов профиля: кнопка (диалог),
 * перенос на страницу и вставка из буфера ведут в один attachFiles с одними
 * правилами (PNG/JPG/WEBP до 32 МБ, не больше пачки). Превью — object URL,
 * который хук сам отзывает, когда файл уходит из пачки.
 *
 * Хук ничего не рендерит: скрытый input и слой переноса рисует ToolShell,
 * чип и сетку файлов — ToolComposer. Страница только решает, что делать
 * с пачкой дальше (useBatchSelection, submit).
 */
export function useAttachments({ maxFiles = MAX_BATCH, replace = false, onDetach }: UseAttachmentsOptions = {}): AttachmentIntake {
  const [attachments, setAttachments] = useState<AttachedRender[]>([])
  const [dragOver, setDragOver] = useState(false)
  // Счётчик — dragleave стреляет на каждом дочернем элементе, и без него подсветка мигала бы.
  const dragDepth = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  // Актуальная пачка и колбэк для стабильных обработчиков без лишних зависимостей.
  const attachmentsRef = useRef(attachments)
  attachmentsRef.current = attachments
  const onDetachRef = useRef(onDetach)
  onDetachRef.current = onDetach

  const detach = useCallback((urls: Iterable<string>, reason: AttachmentDetachReason = "discard") => {
    const gone = new Set(urls)
    if (gone.size === 0) return
    const detached = attachmentsRef.current.filter((item) => gone.has(item.previewUrl))
    setAttachments((current) => {
      current.filter((item) => gone.has(item.previewUrl)).forEach((item) => URL.revokeObjectURL(item.previewUrl))
      return current.filter((item) => !gone.has(item.previewUrl))
    })
    onDetachRef.current?.(detached, reason)
  }, [])

  const removeAttachment = useCallback(
    (index: number) => {
      const target = attachmentsRef.current[index]
      if (target) detach([target.previewUrl])
    },
    [detach]
  )

  const clearAttachments = useCallback(() => {
    detach(attachmentsRef.current.map((item) => item.previewUrl))
  }, [detach])

  const attachFiles = useCallback(
    async (files: File[]) => {
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
          accepted.push({ id: createId(), file, width, height, previewUrl: URL.createObjectURL(file) })
        } catch {
          rejected.push(file.name)
        }
      }

      let overflow = 0
      if (replace) {
        // Замена: прежние файлы уходят целиком, из новых берём сколько влезает.
        const taken = accepted.slice(0, maxFiles)
        overflow = accepted.length - taken.length
        accepted.slice(maxFiles).forEach((item) => URL.revokeObjectURL(item.previewUrl))
        if (taken.length > 0) detach(attachmentsRef.current.map((item) => item.previewUrl))
        if (taken.length > 0) setAttachments((current) => [...current, ...taken])
      } else {
        setAttachments((current) => {
          const room = Math.max(0, maxFiles - current.length)
          overflow = accepted.length - room
          const taken = accepted.slice(0, room)
          accepted.slice(room).forEach((item) => URL.revokeObjectURL(item.previewUrl))
          return [...current, ...taken]
        })
      }

      const warnings: string[] = []
      if (rejected.length > 0) {
        warnings.push(`Не приняты: ${rejected.join(", ")} — только PNG/JPG/WEBP до 32 МБ.`)
      }
      // Один файл на задание — лишние просто не берём, это и так видно по чипу.
      if (overflow > 0 && maxFiles > 1 && Number.isFinite(maxFiles)) {
        warnings.push(`Больше ${maxFiles} файлов за раз нельзя — лишние ${overflow} не добавлены.`)
      }
      if (warnings.length > 0) window.alert(warnings.join("\n"))
    },
    [maxFiles, replace, detach]
  )

  const restoreAttachments = useCallback(
    (items: RestoredAttachment[]) => {
      if (items.length === 0) return
      setAttachments((current) => {
        const currentIds = new Set(current.map((item) => item.id))
        const room = Math.max(0, maxFiles - current.length)
        const restored = items
          .filter((item) => !currentIds.has(item.id))
          .slice(0, room)
          .map((item) => ({ ...item, previewUrl: URL.createObjectURL(item.file) }))
        return [...current, ...restored]
      })
    },
    [maxFiles]
  )

  const pickFiles = useCallback(() => inputRef.current?.click(), [])

  const onInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? [])
      // Сброс сразу: повторный выбор тех же файлов иначе не вызовет onChange.
      event.target.value = ""
      if (files.length > 0) void attachFiles(files)
    },
    [attachFiles]
  )

  // Слой «Отпустите…» — только для файлов: перенос плитки пачки на вкладку
  // папки идёт своим путём (RenderTray → FolderRail) и сюда не попадает.
  const onDragEnter = useCallback((event: DragEvent) => {
    if (!hasFiles(event)) return
    event.preventDefault()
    dragDepth.current += 1
    setDragOver(true)
  }, [])
  const onDragOver = useCallback((event: DragEvent) => {
    if (hasFiles(event)) event.preventDefault()
  }, [])
  const onDragLeave = useCallback((event: DragEvent) => {
    if (!hasFiles(event)) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragOver(false)
  }, [])
  const onDrop = useCallback(
    (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      dragDepth.current = 0
      setDragOver(false)
      const files = Array.from(event.dataTransfer.files ?? [])
      if (files.length > 0) void attachFiles(files)
    },
    [attachFiles]
  )

  // Вставка из буфера — третий путь приёма, наравне с кнопкой и переносом.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? [])
      if (files.length > 0) void attachFiles(files)
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [attachFiles])

  return {
    attachments,
    maxFiles,
    attachFiles,
    removeAttachment,
    clearAttachments,
    detach,
    restoreAttachments,
    pickFiles,
    inputRef,
    onInputChange,
    accept: ENHANCE_ACCEPT,
    multiple: maxFiles > 1,
    dragOver,
    dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop },
  }
}
