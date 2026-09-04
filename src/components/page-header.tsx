import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

/** Шапка обычной страницы: заголовок, пояснение и правый слот действий. */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string
  description?: string
  actions?: ReactNode
  className?: string
}) {
  return (
    <header className={cn("flex flex-wrap items-end justify-between gap-4", className)}>
      <div className="flex min-w-0 flex-col gap-1.5">
        <h1 className="ds-h1">{title}</h1>
        {description ? (
          <p className="ds-body max-w-2xl" style={{ color: "var(--fg-3)" }}>
            {description}
          </p>
        ) : null}
      </div>
      {/* Без shrink-0: на узком экране пара кнопок шире колонки, и
          неуменьшаемый блок выезжал бы за правый край вместо переноса. */}
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}
