"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"

import { attachServerSync } from "@/lib/server-sync"
import type { Album } from "@/types"

/**
 * Альбомы-презентации. Тот же паттерн, что у сторов инструментов: записи в
 * localStorage (ключ `dizzit-albums`, попадает в резервную копию) и на
 * сервере в коллекции `albums`. Своих блобов у альбома нет — PDF собирается
 * заново по составу в момент скачивания, поэтому ни каскадного удаления
 * картинок, ни выгрузки блобов здесь нет.
 */
interface AlbumState {
  albums: Album[]
  hydrated: boolean

  setHydrated: () => void
  add: (album: Album) => void
  update: (id: string, patch: Partial<Album>) => void
  remove: (id: string) => void
  removeByProject: (projectId: string) => void
}

export const useAlbumStore = create<AlbumState>()(
  persist(
    (set) => ({
      albums: [],
      hydrated: false,

      setHydrated: () => set({ hydrated: true }),

      add: (album) => set((state) => ({ albums: [album, ...state.albums] })),

      update: (id, patch) =>
        set((state) => ({
          albums: state.albums.map((item) =>
            item.id === id ? { ...item, ...patch, updatedAt: new Date().toISOString() } : item
          ),
        })),

      remove: (id) => set((state) => ({ albums: state.albums.filter((item) => item.id !== id) })),

      removeByProject: (projectId) =>
        set((state) => ({ albums: state.albums.filter((item) => item.projectId !== projectId) })),
    }),
    {
      name: "dizzit-albums",
      partialize: (state) => ({ albums: state.albums }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated()
      },
    }
  )
)

attachServerSync(useAlbumStore, {
  collection: "albums",
  select: (state) => state.albums,
  apply: (albums) => useAlbumStore.setState({ albums }),
  hydrated: (state) => state.hydrated,
  // Блобов у альбома нет — выгружать при миграции нечего.
  assetKeys: () => [],
})
