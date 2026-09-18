import type { ReactNode } from "react"

import { AppSidebar } from "@/components/app-sidebar"
import { LightboxHost } from "@/components/ui/lightbox"

/**
 * Раскладка приложения: плавающий сайдбар слева, контент справа.
 * Отступ = ширина панели с её полями (16 + 264 + 16) и только с lg —
 * ниже сайдбар живёт в шторке и места не занимает.
 */
export default function MainLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="min-h-dvh">
      <AppSidebar />
      <main className="min-w-0 lg:pl-[296px]">{children}</main>
      {/* Просмотр картинок во весь экран — один слой на все экраны (openLightbox). */}
      <LightboxHost />
    </div>
  )
}
