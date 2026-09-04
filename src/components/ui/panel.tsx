import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/** Основная поверхность контента: плоская заливка + одна рамка. */
export function Panel({
  children,
  className,
  padded = true,
}: {
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return <div className={cn("panel", padded && "p-5 md:p-6", className)}>{children}</div>
}

/** Карточка ВНУТРИ панели: на ступень светлее, радиус меньше. */
export function Card({
  children,
  className,
  interactive = false,
}: {
  children: ReactNode
  className?: string
  interactive?: boolean
}) {
  return <div className={cn("card p-4", interactive && "card-interactive", className)}>{children}</div>
}

/** Заголовок блока внутри панели. */
export function SectionTitle({
  children,
  aside,
  className,
}: {
  children: ReactNode
  aside?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("mb-4 flex items-center justify-between gap-4", className)}>
      <h2 className="ds-h3">{children}</h2>
      {aside}
    </div>
  )
}
