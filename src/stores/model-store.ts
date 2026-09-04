"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"

import { deleteBlobs, keysOf } from "@/lib/blob-store"
import type { GenerationStatus, Model3D } from "@/types"

/**
 * Модели «Фото → 3D». Тот же паттерн, что enhance-store: метаданные в
 * localStorage (ключ `dizzit-models`, попадает в резервную копию), фото —
 * в IndexedDB. Удаление каскадно сносит и блобы.
 */
interface ModelState {
  models: Model3D[]
  hydrated: boolean

  setHydrated: () => void
  add: (model: Model3D) => void
  update: (id: string, patch: Partial<Model3D>) => void
  remove: (id: string) => void
  removeByProject: (projectId: string) => void
}

export const useModelStore = create<ModelState>()(
  persist(
    (set, get) => ({
      models: [],
      hydrated: false,

      setHydrated: () => set({ hydrated: true }),

      // Новые — в голову: свежая модель показывается первой.
      add: (model) => set((state) => ({ models: [model, ...state.models] })),

      update: (id, patch) =>
        set((state) => ({
          models: state.models.map((item) => (item.id === id ? { ...item, ...patch } : item)),
        })),

      remove: (id) => {
        set((state) => ({ models: state.models.filter((item) => item.id !== id) }))
        void deleteBlobs(keysOf(id))
      },

      removeByProject: (projectId) => {
        const doomed = get().models.filter((item) => item.projectId === projectId)
        set((state) => ({ models: state.models.filter((item) => item.projectId !== projectId) }))
        void deleteBlobs(doomed.flatMap((item) => keysOf(item.id)))
      },
    }),
    {
      name: "dizzit-models",
      partialize: (state) => ({ models: state.models }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated()
        // Застрявшее «processing» после перезагрузки — ошибка с «Повторить».
        useModelStore.setState((current) => ({
          models: current.models.map((item) =>
            item.status === "processing"
              ? {
                  ...item,
                  status: "error" as GenerationStatus,
                  error: "Построение прервалось — страница была закрыта.",
                }
              : item
          ),
        }))
      },
    }
  )
)
