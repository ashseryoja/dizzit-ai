"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"

import { deleteBlobs, keysOf } from "@/lib/blob-store"
import { attachServerSync } from "@/lib/server-sync"
import { viewKeysOf } from "@/lib/view-engine"
import type { GenerationStatus, ViewSet } from "@/types"

/**
 * Сеты кадров («Ракурсы и детали»). Тот же паттерн, что enhance-store:
 * метаданные в localStorage (ключ `dizzit-views`, попадает в резервную копию),
 * исходник и кадры — в IndexedDB. Удаление каскадно сносит все блобы записи:
 * стандартные ключи и по паре на каждый кадр.
 */
interface ViewsState {
  sets: ViewSet[]
  hydrated: boolean

  setHydrated: () => void
  add: (set: ViewSet) => void
  update: (id: string, patch: Partial<ViewSet>) => void
  remove: (id: string) => void
  removeByProject: (projectId: string) => void
}

const blobKeys = (item: ViewSet) => [...keysOf(item.id), ...viewKeysOf(item.id, item.frames ?? [])]

export const useViewsStore = create<ViewsState>()(
  persist(
    (set, get) => ({
      sets: [],
      hydrated: false,

      setHydrated: () => set({ hydrated: true }),

      // Новые — в голову: галерея показывает свежие сеты первыми.
      add: (item) => set((state) => ({ sets: [item, ...state.sets] })),

      update: (id, patch) =>
        set((state) => ({
          sets: state.sets.map((item) => (item.id === id ? { ...item, ...patch } : item)),
        })),

      remove: (id) => {
        const doomed = get().sets.find((item) => item.id === id)
        set((state) => ({ sets: state.sets.filter((item) => item.id !== id) }))
        void deleteBlobs(doomed ? blobKeys(doomed) : keysOf(id))
      },

      removeByProject: (projectId) => {
        const doomed = get().sets.filter((item) => item.projectId === projectId)
        set((state) => ({ sets: state.sets.filter((item) => item.projectId !== projectId) }))
        void deleteBlobs(doomed.flatMap(blobKeys))
      },
    }),
    {
      name: "dizzit-views",
      partialize: (state) => ({ sets: state.sets }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated()
        // Сет, застрявший в «processing» (вкладку закрыли на полпути), после
        // перезагрузки крутился бы вечно. Исходник цел в IndexedDB, поэтому
        // это ошибка с кнопкой «Повторить», а не тупик.
        // localStorage синхронный: этот колбэк срабатывает ещё внутри create(),
        // когда константа стора не присвоена. Правку откладываем на микрозадачу —
        // иначе ReferenceError глотается persist и правка молча не применяется.
        queueMicrotask(() => {
          useViewsStore.setState((current) => ({
            // Записи без списка кадров (черновой формат) не восстановить — убираем.
            sets: current.sets.filter((item) => Array.isArray(item.frames)).map((item) =>
              item.status === "processing"
                ? {
                    ...item,
                    status: "error" as GenerationStatus,
                    error: "Построение сета прервалось — страница была закрыта.",
                  }
                : item
            ),
          }))
        })
      },
    }
  )
)

// У сета кадров свои ключи блобов — по паре на кадр, см. blobKeys.
attachServerSync(useViewsStore, {
  collection: "views",
  select: (state) => state.sets,
  apply: (sets) => useViewsStore.setState({ sets }),
  hydrated: (state) => state.hydrated,
  assetKeys: blobKeys,
  onRemovedLocally: (item) => void deleteBlobs(blobKeys(item)),
})
