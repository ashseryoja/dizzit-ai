"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { AttachedRender, AttachmentIntake } from "@/lib/use-attachments"
import { MODEL_VIEW_ROLES, type ModelSlot, type ModelViewRole } from "@/shared/model3d"

export interface ViewSlots {
  main: AttachedRender | null
  views: Record<ModelViewRole, AttachedRender | null>
  /** Фото в порядке отправки провайдеру: главный вид, затем ракурсы. */
  ordered: { slot: ModelSlot; attachment: AttachedRender }[]
  /** Открыть выбор файла для конкретного слота. */
  pick: (slot: ModelSlot) => void
  remove: (slot: ModelSlot) => void
}

/**
 * Слоты «Фото → 3D» поверх общей пачки `useAttachments`: главный вид и три
 * ракурса (слева, сзади, справа), как на панели Meshy. Пачка остаётся
 * плоским списком — хук только помнит, какой файл в каком слоте: клик по
 * слоту запоминает его как цель, и следующий приложенный файл (диалог,
 * перенос, вставка) попадает именно туда; без цели — в главный вид, затем в
 * первый свободный ракурс. Выключенный мульти-вид убирает ракурсы из пачки.
 */
export function useViewSlots(intake: AttachmentIntake, multiView: boolean): ViewSlots {
  const { attachments, detach, pickFiles } = intake
  const [slots, setSlots] = useState<Record<string, ModelSlot>>({})
  const target = useRef<ModelSlot | null>(null)

  const slotsRef = useRef(slots)
  slotsRef.current = slots

  useEffect(() => {
    const current = slotsRef.current
    const next: Record<string, ModelSlot> = {}
    const holder = new Map<ModelSlot, string>()
    for (const item of attachments) {
      const slot = current[item.previewUrl]
      if (slot) {
        next[item.previewUrl] = slot
        holder.set(slot, item.previewUrl)
      }
    }
    const replaced: string[] = []
    for (const item of attachments) {
      if (next[item.previewUrl]) continue
      const order: ModelSlot[] = ["main", ...MODEL_VIEW_ROLES]
      const wanted = target.current ?? order.find((slot) => !holder.has(slot))
      target.current = null
      if (!wanted) continue
      // Слот занят — новый файл встаёт на его место, прежний уходит из пачки.
      const previous = holder.get(wanted)
      if (previous) {
        delete next[previous]
        replaced.push(previous)
      }
      next[item.previewUrl] = wanted
      holder.set(wanted, item.previewUrl)
    }
    const same =
      Object.keys(next).length === Object.keys(current).length && Object.entries(next).every(([url, slot]) => current[url] === slot)
    if (!same) setSlots(next)
    if (replaced.length > 0) detach(replaced)
  }, [attachments, detach])

  // Мульти-вид выключили — в пачке остаётся только главный вид.
  useEffect(() => {
    if (multiView) return
    const extra = attachments.filter((item) => slots[item.previewUrl] && slots[item.previewUrl] !== "main")
    if (extra.length > 0) detach(extra.map((item) => item.previewUrl))
  }, [multiView, attachments, slots, detach])

  const bySlot = useMemo(() => {
    const map = new Map<ModelSlot, AttachedRender>()
    for (const item of attachments) {
      const slot = slots[item.previewUrl]
      if (slot) map.set(slot, item)
    }
    return map
  }, [attachments, slots])

  const pick = useCallback(
    (slot: ModelSlot) => {
      target.current = slot
      // Пачка полна — места новому файлу нет, занятый слот освобождаем заранее;
      // иначе замена случится, когда файл действительно выберут.
      const occupied = bySlot.get(slot)
      if (occupied && attachments.length >= intake.maxFiles && intake.maxFiles > 1) detach([occupied.previewUrl])
      pickFiles()
    },
    [bySlot, attachments.length, intake.maxFiles, detach, pickFiles]
  )

  const remove = useCallback(
    (slot: ModelSlot) => {
      const occupied = bySlot.get(slot)
      if (occupied) detach([occupied.previewUrl])
    },
    [bySlot, detach]
  )

  return useMemo(() => {
    const order: ModelSlot[] = ["main", ...MODEL_VIEW_ROLES]
    return {
      main: bySlot.get("main") ?? null,
      views: {
        left: bySlot.get("left") ?? null,
        back: bySlot.get("back") ?? null,
        right: bySlot.get("right") ?? null,
      },
      ordered: order.flatMap((slot) => {
        const attachment = bySlot.get(slot)
        return attachment ? [{ slot, attachment }] : []
      }),
      pick,
      remove,
    }
  }, [bySlot, pick, remove])
}
