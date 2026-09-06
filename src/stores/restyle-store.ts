"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"

import { deleteBlobs, keysOf } from "@/lib/blob-store"
import { attachServerSync } from "@/lib/server-sync"
import type { GenerationStatus, Restyle } from "@/types"

/**
 * Переносы стиля. Тот же паттерн, что enhance-store: метаданные в
 * localStorage (ключ `dizzit-restyles`, попадает в резервную копию),
 * изображения — в IndexedDB. Удаление каскадно сносит и блобы.
 */
interface RestyleState {
  restyles: Restyle[]
  hydrated: boolean

  setHydrated: () => void
  add: (restyle: Restyle) => void
  update: (id: string, patch: Partial<Restyle>) => void
  remove: (id: string) => void
  removeByProject: (projectId: string) => void
}

export const useRestyleStore = create<RestyleState>()(
  persist(
    (set, get) => ({
      restyles: [],
      hydrated: false,

      setHydrated: () => set({ hydrated: true }),

      // Новые — в голову: галерея показывает свежие результаты первыми.
      add: (restyle) => set((state) => ({ restyles: [restyle, ...state.restyles] })),

      update: (id, patch) =>
        set((state) => ({
          restyles: state.restyles.map((item) => (item.id === id ? { ...item, ...patch } : item)),
        })),

      remove: (id) => {
        set((state) => ({ restyles: state.restyles.filter((item) => item.id !== id) }))
        void deleteBlobs(keysOf(id))
      },

      removeByProject: (projectId) => {
        const doomed = get().restyles.filter((item) => item.projectId === projectId)
        set((state) => ({
          restyles: state.restyles.filter((item) => item.projectId !== projectId),
        }))
        void deleteBlobs(doomed.flatMap((item) => keysOf(item.id)))
      },
    }),
    {
      name: "dizzit-restyles",
      partialize: (state) => ({ restyles: state.restyles }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated()
        // Застрявшее «processing» после перезагрузки — ошибка с «Повторить».
        // localStorage синхронный: этот колбэк срабатывает ещё внутри create(),
        // когда константа стора не присвоена. Правку откладываем на микрозадачу —
        // иначе ReferenceError глотается persist и правка молча не применяется.
        queueMicrotask(() => {
          useRestyleStore.setState((current) => ({
            restyles: current.restyles.map((item) =>
              item.status === "processing"
                ? {
                    ...item,
                    status: "error" as GenerationStatus,
                    error: "Перенос стиля прервался — страница была закрыта.",
                  }
                : item
            ),
          }))
        })
      },
    }
  )
)

attachServerSync(useRestyleStore, {
  collection: "restyles",
  select: (state) => state.restyles,
  apply: (restyles) => useRestyleStore.setState({ restyles }),
  hydrated: (state) => state.hydrated,
  onRemovedLocally: (item) => void deleteBlobs(keysOf(item.id)),
})
