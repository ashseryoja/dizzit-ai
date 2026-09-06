"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"

import { deleteBlobs, keysOf } from "@/lib/blob-store"
import { attachServerSync } from "@/lib/server-sync"
import type { Enhancement, GenerationStatus } from "@/types"

/**
 * Обработки рендеров. Здесь только метаданные (localStorage, ключ
 * `dizzit-enhancements` — попадает в резервную копию настроек); изображения —
 * в IndexedDB, см. lib/blob-store. Удаление каскадно сносит и блобы.
 */
interface EnhanceState {
  enhancements: Enhancement[]
  hydrated: boolean

  setHydrated: () => void
  add: (enhancement: Enhancement) => void
  update: (id: string, patch: Partial<Enhancement>) => void
  remove: (id: string) => void
  removeByProject: (projectId: string) => void
}

export const useEnhanceStore = create<EnhanceState>()(
  persist(
    (set, get) => ({
      enhancements: [],
      hydrated: false,

      setHydrated: () => set({ hydrated: true }),

      // Новые — в голову: галерея показывает свежие обработки первыми.
      add: (enhancement) =>
        set((state) => ({ enhancements: [enhancement, ...state.enhancements] })),

      update: (id, patch) =>
        set((state) => ({
          enhancements: state.enhancements.map((item) =>
            item.id === id ? { ...item, ...patch } : item
          ),
        })),

      remove: (id) => {
        set((state) => ({
          enhancements: state.enhancements.filter((item) => item.id !== id),
        }))
        void deleteBlobs(keysOf(id))
      },

      removeByProject: (projectId) => {
        const doomed = get().enhancements.filter((item) => item.projectId === projectId)
        set((state) => ({
          enhancements: state.enhancements.filter((item) => item.projectId !== projectId),
        }))
        void deleteBlobs(doomed.flatMap((item) => keysOf(item.id)))
      },
    }),
    {
      name: "dizzit-enhancements",
      partialize: (state) => ({ enhancements: state.enhancements }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated()
        // Черновики остаются черновиками. Обработка, застрявшая в «processing»
        // (вкладку закрыли на полпути),
        // после перезагрузки крутилась бы вечно. Исходник цел в IndexedDB,
        // поэтому это ошибка с кнопкой «Повторить», а не тупик.
        // localStorage синхронный: этот колбэк срабатывает ещё внутри create(),
        // когда константа стора не присвоена. Правку откладываем на микрозадачу —
        // иначе ReferenceError глотается persist и правка молча не применяется.
        queueMicrotask(() => {
          useEnhanceStore.setState((current) => ({
            enhancements: current.enhancements.map((item) =>
              item.status === "processing"
                ? {
                    ...item,
                    status: "error" as GenerationStatus,
                    error: "Обработка прервалась — страница была закрыта.",
                  }
                : item
            ),
          }))
        })
      },
    }
  )
)

// Сервер (если настроен): слияние при гидрации и отправка каждого изменения.
attachServerSync(useEnhanceStore, {
  collection: "enhancements",
  select: (state) => state.enhancements,
  apply: (enhancements) => useEnhanceStore.setState({ enhancements }),
  hydrated: (state) => state.hydrated,
  onRemovedLocally: (item) => void deleteBlobs(keysOf(item.id)),
})
