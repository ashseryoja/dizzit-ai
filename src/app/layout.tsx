import type { Metadata, Viewport } from "next"

import { IntroSplash } from "@/components/intro-splash"
import { ThemeSync } from "@/components/theme-sync"

import "./globals.css"

/**
 * Тема до гидрации: читаем тот же ключ, что settings-store, и вешаем
 * data-атрибуты на <html> ещё при разборе HTML — иначе выбранная светлая
 * тема мигала бы тёмной на каждой загрузке. Дальше атрибуты ведёт ThemeSync.
 *
 * Здесь же — перенос ключей с прежнего имени сервиса (`skizzy-` → `dizzit-`).
 * Место выбрано не случайно: сторы читают localStorage при инициализации
 * модуля, а этот скрипт блокирующий и выполняется до неё, поэтому гонки нет.
 * Блок можно удалить, когда старых ключей ни у кого не останется.
 */
const THEME_BOOT_SCRIPT = `(function () {
  try {
    for (var i = localStorage.length - 1; i >= 0; i--) {
      var k = localStorage.key(i);
      if (k && k.indexOf("skizzy-") === 0) {
        var n = "dizzit-" + k.slice(7);
        if (localStorage.getItem(n) === null) localStorage.setItem(n, localStorage.getItem(k));
        localStorage.removeItem(k);
      }
    }
  } catch (e) {}
  var s = {};
  try { s = JSON.parse(localStorage.getItem("dizzit-settings")).state || {}; } catch (e) {}
  var t = s.theme || "dark";
  if (t === "system") t = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.dataset.theme = t;
  if (s.reduceMotion) document.documentElement.dataset.motion = "reduce";
})();`

export const metadata: Metadata = {
  title: "Dizzit AI — инструменты ИИ для дизайна",
  description:
    "Dizzit AI — инструменты ИИ для дизайнеров: улучшение качества рендеров, скетч в рендер, генерация материалов. Первые инструменты скоро.",
}

export const viewport: Viewport = {
  themeColor: "#292929",
  width: "device-width",
  initialScale: 1,
  // Страница заходит под вырез и индикатор «домой»: отступы под них дают
  // env(safe-area-inset-*) в page-shell, у композера, кнопки меню и шторок.
  viewportFit: "cover",
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: data-theme на <html> ставит скрипт ниже до
    // гидрации, серверная разметка атрибута не знает — это ожидаемо.
    <html lang="ru" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <ThemeSync />
        {/* Заставка в корневом layout: он не перемонтируется при клиентской
            навигации, поэтому анимация не повторяется на каждом переходе. */}
        <IntroSplash />
        {children}
      </body>
    </html>
  )
}
