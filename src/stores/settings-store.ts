"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"

/** Выбор темы. `system` следует за настройкой ОС и меняется вместе с ней. */
export type ThemePreference = "system" | "dark" | "light"

/**
 * Пользовательские настройки приложения (страница «Настройки»).
 * Применяет их к документу компонент ThemeSync в корневом layout;
 * до гидрации то же самое делает инлайн-скрипт там же — ключ и форма
 * состояния у них общие, менять синхронно.
 */
interface SettingsState {
  theme: ThemePreference
  reduceMotion: boolean

  setTheme: (theme: ThemePreference) => void
  setReduceMotion: (reduceMotion: boolean) => void
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // Тёмная, а не системная: тёмный интерфейс — исходный облик сервиса,
      // и до появления этой настройки все видели именно его.
      theme: "dark",
      reduceMotion: false,

      setTheme: (theme) => set({ theme }),
      setReduceMotion: (reduceMotion) => set({ reduceMotion }),
    }),
    { name: "dizzit-settings" }
  )
)
