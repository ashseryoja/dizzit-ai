import Link from "next/link"
import type { LucideIcon } from "lucide-react"

/** Пустой экран раздела: что произошло и ОДНО действие, которое это чинит. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  actionLabel,
  actionHref,
}: {
  icon: LucideIcon
  title: string
  description: string
  actionLabel?: string
  actionHref?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div
        className="flex h-12 w-12 items-center justify-center rounded-[var(--r-sm)]"
        style={{ background: "var(--bg-raised)", border: "1px solid var(--line)" }}
      >
        <Icon className="h-5 w-5" style={{ color: "var(--fg-3)" }} strokeWidth={1.5} />
      </div>
      <div className="flex max-w-md flex-col gap-2">
        <h2 className="ds-h2">{title}</h2>
        <p className="ds-body" style={{ color: "var(--fg-3)" }}>
          {description}
        </p>
      </div>
      {actionLabel && actionHref ? (
        <Link href={actionHref} className="btn-primary mt-1">
          {actionLabel}
        </Link>
      ) : null}
    </div>
  )
}
