"use client"

import { useEffect } from "react"

import { gcBlobs } from "@/lib/blob-store"
import { useEnhanceStore } from "@/stores/enhance-store"
import { useMaterialStore } from "@/stores/material-store"
import { useModelStore } from "@/stores/model-store"
import { useRestyleStore } from "@/stores/restyle-store"
import { useViewsStore } from "@/stores/views-store"

let done = false

/**
 * Сборка мусора IndexedDB — раз за сессию, с любой страницы инструмента.
 * Живыми считаются записи ВСЕХ инструментов сразу: хранилище блобов общее,
 * и GC, знающий только про один стор, снёс бы данные остальных. Пока хоть
 * один стор не гидрирован — ничего не делает (и не считает себя выполненной).
 */
export function runBlobGcOnce() {
  if (done) return
  const enhance = useEnhanceStore.getState()
  const materials = useMaterialStore.getState()
  const models = useModelStore.getState()
  const views = useViewsStore.getState()
  const restyles = useRestyleStore.getState()
  if (!enhance.hydrated || !materials.hydrated || !models.hydrated || !views.hydrated || !restyles.hydrated) return
  done = true
  const validIds = new Set<string>()
  for (const item of enhance.enhancements) validIds.add(item.id)
  for (const item of materials.materials) validIds.add(item.id)
  for (const item of models.models) validIds.add(item.id)
  for (const item of views.sets) validIds.add(item.id)
  for (const item of restyles.restyles) validIds.add(item.id)
  void gcBlobs(validIds)
}

/** Хук для страниц инструментов: ждёт гидрации всех сторов и запускает GC. */
export function useBlobGc() {
  const a = useEnhanceStore((state) => state.hydrated)
  const b = useMaterialStore((state) => state.hydrated)
  const c = useModelStore((state) => state.hydrated)
  const d = useViewsStore((state) => state.hydrated)
  const e = useRestyleStore((state) => state.hydrated)
  useEffect(() => {
    if (a && b && c && d && e) runBlobGcOnce()
  }, [a, b, c, d, e])
}
