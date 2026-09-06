"use client"

import { useCallback, useEffect, useRef, useState } from "react"

import type { AttachedRender, AttachmentIntake } from "@/lib/use-attachments"
import { plural } from "@/lib/utils"

export interface UseBatchSelectionOptions {
  /** Формы слова: [рендер, рендера, рендеров] — для подписи «выбрано 5 рендеров». */
  noun: [string, string, string]
  /** «Редактировать все»: что ещё сделать при входе в пакетный режим (редактор рендера открывает настройки). */
  onEditAll?: () => void
  onLeaveBatch?: () => void
  /**
   * Сколько рендеров можно отправить в обработку за раз. Пачка при этом может
   * быть любого размера (редактор рендера хранит в ней все записи проекта);
   * набор больше лимита не урезается молча — композер получает `limitNotice`.
   */
  maxWorkingSet?: number
}

/** Пропсы RenderTray/RenderStrip одним объектом — панель и полоска получают их спредом. */
export interface TrayProps {
  attachments: AttachedRender[]
  focus: number
  picked: Set<string>
  picking: boolean
  onTogglePicking: () => void
  onPickAll: () => void
  onEditAll: () => void
  onSelect: (index: number) => void
  onRemove: (index: number) => void
  onPickFiles: () => void
  onClear: () => void
  maxFiles: number
  noun: [string, string, string]
}

export interface BatchSelection {
  attachments: AttachedRender[]
  /** Индекс рендера на сцене — не указывает за край пачки после удалений. */
  focusIndex: number
  /** Рендер на сцене; null — пачка пуста. */
  current: AttachedRender | null
  picked: Set<string>
  picking: boolean
  batchEditing: boolean
  /** Отмеченные в режиме «Выбрать». */
  pickedItems: AttachedRender[]
  /** Что уйдёт в обработку: отмеченные, а если ничего не отмечали — рендер со сцены. */
  workingSet: AttachedRender[]
  /** Пакетный режим с непустым набором: вместо сцены — грид. */
  showBatchGrid: boolean
  /** Подпись для композера: «выбрано 5 рендеров»; null — пачка пуста, показывать нечего. */
  selectionLabel: string | null
  /** Набор больше `maxWorkingSet`: причина, по которой отправка заблокирована; null — всё в норме. */
  limitNotice: string | null
  selectAttachment: (index: number) => void
  togglePicking: () => void
  editAll: () => void
  leaveBatch: () => void
  pickAll: () => void
  step: (delta: number) => void
  selectPrev: () => void
  selectNext: () => void
  removeAttachment: (index: number) => void
  clearAttachments: () => void
  /** Забрать рабочий набор; `retain` оставляет файлы на сцене во время и после обработки. */
  takeWorkingSet: (options?: { retain?: boolean }) => { items: AttachedRender[]; files: File[]; urls: string[] }
  trayProps: TrayProps
}

/**
 * Рабочий набор пачки — общая механика «Редактора рендера», «Ракурсов» и
 * «Переноса стиля»: какой рендер на сцене, что отмечено в режиме «Выбрать»
 * (как в «Фото» iOS), пакетный режим набора, стрелки и Escape с клавиатуры.
 *
 * Обычный режим: клик по плитке — один рендер на сцену, он же уходит в
 * обработку. Режим «Выбрать»: клики набирают несколько, обработка ко всем
 * сразу. Набор ведётся по previewUrl — он уникален и переживает удаление
 * соседей (индексы бы поехали); устаревшие записи отсеиваются при чтении.
 */
export function useBatchSelection(
  intake: AttachmentIntake,
  { noun, onEditAll, onLeaveBatch, maxWorkingSet = Number.POSITIVE_INFINITY }: UseBatchSelectionOptions
): BatchSelection {
  const { attachments } = intake
  const [focus, setFocus] = useState(0)
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [picking, setPicking] = useState(false)
  const [batchEditing, setBatchEditing] = useState(false)
  const previousUrls = useRef(new Set<string>())

  const focusIndex = Math.min(focus, Math.max(0, attachments.length - 1))
  const current = attachments[focusIndex] ?? null

  /* В режиме выбора — ровно отмеченное (может быть пусто); вне его отмеченное,
     а если ничего не отмечали — рендер со сцены. */
  const pickedItems = attachments.filter((item) => picked.has(item.previewUrl))
  const workingSet = picking || pickedItems.length > 0 ? pickedItems : current ? [current] : []
  const showBatchGrid = batchEditing && pickedItems.length > 0

  // Новый файл, добавленный к уже открытой пачке, сразу становится рабочим:
  // пользователь может без лишнего клика запустить следующую обработку.
  useEffect(() => {
    const previous = previousUrls.current
    const addedIndex = attachments.findIndex((item) => !previous.has(item.previewUrl))
    if (previous.size > 0 && addedIndex >= 0) {
      const added = attachments[addedIndex]
      setFocus(addedIndex)
      if (!picking) setPicked(new Set([added.previewUrl]))
      setBatchEditing(false)
    }
    previousUrls.current = new Set(attachments.map((item) => item.previewUrl))
  }, [attachments, picking])

  const selectionLabel =
    attachments.length === 0
      ? null
      : workingSet.length === 0
        ? "ничего не выбрано"
        : `${plural(workingSet.length, ["выбран", "выбрано", "выбрано"])} ${workingSet.length} ${plural(workingSet.length, noun)}`
  const overflow = workingSet.length - maxWorkingSet
  const limitNotice =
    overflow > 0
      ? `За раз в обработку уходит не больше ${maxWorkingSet} ${plural(maxWorkingSet, noun)} — снимите ${overflow}`
      : null

  /* Клик по плитке: обычный режим — один рендер на сцену и в набор;
     режим «Выбрать» — переключить плитку в наборе, на сцену её же. */
  const selectAttachment = useCallback(
    (index: number) => {
      const item = attachments[index]
      if (!item) return
      setFocus(index)
      if (!picking) setBatchEditing(false)
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

  /* «Редактировать все»: режим выбора завершён, набор остаётся; сцена уступает место гриду. */
  const editAll = useCallback(() => {
    setPicking(false)
    setBatchEditing(true)
    onEditAll?.()
    // Колбэки страниц — простые сеттеры, их можно не стабилизировать.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const leaveBatch = useCallback(() => {
    setBatchEditing(false)
    onLeaveBatch?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const pickAll = useCallback(() => {
    setPicked((set) => {
      const all = attachments.every((item) => set.has(item.previewUrl))
      return all ? new Set() : new Set(attachments.map((item) => item.previewUrl))
    })
  }, [attachments])

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
    if (attachments.length === 0) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return
      if (event.key === "ArrowLeft") selectPrev()
      if (event.key === "ArrowRight") selectNext()
      if (event.key === "Escape") setPicking(false)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [attachments.length, selectPrev, selectNext])

  const { removeAttachment: baseRemove, clearAttachments: baseClear, detach, pickFiles, maxFiles } = intake

  const removeAttachment = useCallback(
    (index: number) => {
      baseRemove(index)
      // Убрали рендер левее сцены — рендер на сцене сдвинулся на позицию назад.
      setFocus((value) => (index < value ? value - 1 : value))
    },
    [baseRemove]
  )

  /* Сцена на первый рендер, набор пуст, режимы выключены — после очистки и отправки. */
  const reset = useCallback(() => {
    setFocus(0)
    setPicked(new Set())
    setPicking(false)
    setBatchEditing(false)
  }, [])

  const clearAttachments = useCallback(() => {
    baseClear()
    reset()
  }, [baseClear, reset])

  /* В обработку уходит рабочий набор; остальная пачка остаётся в панели,
     чтобы к ней можно было применить другие настройки. */
  const takeWorkingSet = ({ retain = false }: { retain?: boolean } = {}) => {
    const urls = workingSet.map((item) => item.previewUrl)
    const files = workingSet.map((item) => item.file)
    if (retain) {
      setPicking(false)
      setBatchEditing(false)
    } else {
      detach(urls, "consume")
      reset()
    }
    return { items: workingSet, files, urls }
  }

  return {
    attachments,
    focusIndex,
    current,
    picked,
    picking,
    batchEditing,
    pickedItems,
    workingSet,
    showBatchGrid,
    selectionLabel,
    limitNotice,
    selectAttachment,
    togglePicking,
    editAll,
    leaveBatch,
    pickAll,
    step,
    selectPrev,
    selectNext,
    removeAttachment,
    clearAttachments,
    takeWorkingSet,
    trayProps: {
      attachments,
      focus: focusIndex,
      picked,
      picking,
      onTogglePicking: togglePicking,
      onPickAll: pickAll,
      onEditAll: editAll,
      onSelect: selectAttachment,
      onRemove: removeAttachment,
      onPickFiles: pickFiles,
      onClear: clearAttachments,
      maxFiles,
      noun,
    },
  }
}
