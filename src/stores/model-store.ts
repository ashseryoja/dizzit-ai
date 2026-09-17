"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"

import { deleteBlobs, keysOf, modelKey, viewKey } from "@/lib/blob-store"
import { attachServerSync } from "@/lib/server-sync"
import { DEFAULT_MODEL_SETTINGS, MODEL_VIEW_ROLES, normalizeModelSettings, type ModelSettings } from "@/shared/model3d"
import type { GenerationStatus, Model3D } from "@/types"

/**
 * Модели «Фото → 3D». Тот же паттерн, что enhance-store: метаданные в
 * localStorage (ключ `dizzit-models`, попадает в резервную копию), фото и
 * GLB — в IndexedDB. Удаление каскадно сносит и блобы.
 */
const blobKeys = (id: string) => [
  ...keysOf(id),
  modelKey(id),
  modelKey(id, "fbx"),
  modelKey(id, "obj"),
  ...MODEL_VIEW_ROLES.map((role) => viewKey(id, role)),
]

interface ModelState {
  models: Model3D[]
  /** Последние настройки панели генерации — чтобы не выставлять их заново. Живут только в этом браузере. */
  settings: ModelSettings
  multiView: boolean
  hydrated: boolean

  setSettings: (settings: ModelSettings) => void
  setMultiView: (on: boolean) => void

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
      settings: DEFAULT_MODEL_SETTINGS,
      multiView: false,
      hydrated: false,

      setSettings: (settings) => set({ settings: normalizeModelSettings(settings) }),
      setMultiView: (multiView) => set({ multiView }),

      setHydrated: () => set({ hydrated: true }),

      // Новые — в голову: свежая модель показывается первой.
      add: (model) => set((state) => ({ models: [model, ...state.models] })),

      update: (id, patch) =>
        set((state) => ({
          models: state.models.map((item) => (item.id === id ? { ...item, ...patch } : item)),
        })),

      remove: (id) => {
        set((state) => ({ models: state.models.filter((item) => item.id !== id) }))
        void deleteBlobs(blobKeys(id))
      },

      removeByProject: (projectId) => {
        const doomed = get().models.filter((item) => item.projectId === projectId)
        set((state) => ({ models: state.models.filter((item) => item.projectId !== projectId) }))
        void deleteBlobs(doomed.flatMap((item) => blobKeys(item.id)))
      },
    }),
    {
      name: "dizzit-models",
      partialize: (state) => ({ models: state.models, settings: state.settings, multiView: state.multiView }),
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<ModelState>
        return { ...current, ...saved, settings: normalizeModelSettings(saved.settings) }
      },
      onRehydrateStorage: () => (state) => {
        state?.setHydrated()
        // Застрявшее «processing» после перезагрузки — ошибка с «Повторить».
        // Кроме задач Meshy: они считаются на стороне провайдера, страница
        // продолжит опрос той же задачи (см. photo-3d/page.tsx).
        // localStorage синхронный: этот колбэк срабатывает ещё внутри create(),
        // когда константа стора не присвоена. Правку откладываем на микрозадачу —
        // иначе ReferenceError глотается persist и правка молча не применяется.
        queueMicrotask(() => {
          useModelStore.setState((current) => ({
            models: current.models.map((item) =>
              item.status === "processing" && !item.taskId
                ? {
                    ...item,
                    status: "error" as GenerationStatus,
                    error: "Построение прервалось — страница была закрыта.",
                  }
                : item
            ),
          }))
        })
      },
    }
  )
)

attachServerSync(useModelStore, {
  collection: "models",
  select: (state) => state.models,
  apply: (models) => useModelStore.setState({ models }),
  hydrated: (state) => state.hydrated,
  onRemovedLocally: (item) => void deleteBlobs(blobKeys(item.id)),
})
