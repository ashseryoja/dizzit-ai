"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"

import { deleteBlobs, keysOf } from "@/lib/blob-store"
import { attachServerSync } from "@/lib/server-sync"
import type { GenerationStatus, Material } from "@/types"

/**
 * Генерации материалов. Тот же паттерн, что enhance-store: метаданные в
 * localStorage (ключ `dizzit-materials`, попадает в резервную копию),
 * изображения — в IndexedDB. Удаление каскадно сносит и блобы.
 */
interface MaterialState {
  materials: Material[]
  hydrated: boolean

  setHydrated: () => void
  add: (material: Material) => void
  update: (id: string, patch: Partial<Material>) => void
  remove: (id: string) => void
  removeByProject: (projectId: string) => void
}

export const useMaterialStore = create<MaterialState>()(
  persist(
    (set, get) => ({
      materials: [],
      hydrated: false,

      setHydrated: () => set({ hydrated: true }),

      // Новые — в голову: галерея показывает свежие генерации первыми.
      add: (material) => set((state) => ({ materials: [material, ...state.materials] })),

      update: (id, patch) =>
        set((state) => ({
          materials: state.materials.map((item) => (item.id === id ? { ...item, ...patch } : item)),
        })),

      remove: (id) => {
        set((state) => ({ materials: state.materials.filter((item) => item.id !== id) }))
        void deleteBlobs(keysOf(id))
      },

      removeByProject: (projectId) => {
        const doomed = get().materials.filter((item) => item.projectId === projectId)
        set((state) => ({
          materials: state.materials.filter((item) => item.projectId !== projectId),
        }))
        void deleteBlobs(doomed.flatMap((item) => keysOf(item.id)))
      },
    }),
    {
      name: "dizzit-materials",
      partialize: (state) => ({ materials: state.materials }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated()
        // Генерация, застрявшая в «processing» (вкладку закрыли на полпути),
        // после перезагрузки крутилась бы вечно. Параметры целы, поэтому это
        // ошибка с кнопкой «Повторить», а не тупик.
        // localStorage синхронный: этот колбэк срабатывает ещё внутри create(),
        // когда константа стора не присвоена. Правку откладываем на микрозадачу —
        // иначе ReferenceError глотается persist и правка молча не применяется.
        queueMicrotask(() => {
          useMaterialStore.setState((current) => ({
            materials: current.materials.map((item) =>
              item.status === "processing"
                  ? {
                    ...item,
                    status: "error" as GenerationStatus,
                    syncPending: true,
                    generationUncertain: true,
                    error:
                      "Генерация прервалась — страница была закрыта. Повторный платный запрос отключён; можно только восстановить уже готовый файл.",
                  }
                : item
            ),
          }))
        })
      },
    }
  )
)

attachServerSync(useMaterialStore, {
  collection: "materials",
  select: (state) => state.materials,
  apply: (materials) => useMaterialStore.setState({ materials }),
  hydrated: (state) => state.hydrated,
  onRemovedLocally: (item) => void deleteBlobs(keysOf(item.id)),
})
