"use client"

import { useEffect } from "react"

import { useSettingsStore } from "@/stores/settings-store"

/** Фон системной строки браузера под каждую тему (метатег theme-color). */
const THEME_COLOR = { dark: "#292929", light: "#eeeeee" } as const

/**
 * Переносит настройки внешнего вида на <html>: data-theme (конкретная тема,
 * «системная» уже разрешена в тёмную или светлую) и data-motion.
 * Первую отрисовку страхует инлайн-скрипт в корневом layout — он читает тот же
 * localStorage-ключ до гидрации, иначе светлая тема мигала бы тёмной.
 */
export function ThemeSync() {
  const theme = useSettingsStore((state) => state.theme)
  const reduceMotion = useSettingsStore((state) => state.reduceMotion)

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)")

    const apply = () => {
      const resolved = theme === "system" ? (media.matches ? "light" : "dark") : theme
      document.documentElement.dataset.theme = resolved
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", THEME_COLOR[resolved])
    }

    apply()
    // Системная тема живёт за пользователем ОС: переключил там — едет и тут.
    if (theme !== "system") return
    media.addEventListener("change", apply)
    return () => media.removeEventListener("change", apply)
  }, [theme])

  useEffect(() => {
    if (reduceMotion) {
      document.documentElement.dataset.motion = "reduce"
    } else {
      delete document.documentElement.dataset.motion
    }
  }, [reduceMotion])

  return null
}
