import type { ReactNode } from "react"

import { Panel } from "@/components/ui/panel"

/**
 * Шаг настройки альбома: панель с номером, заголовком и строкой-итогом
 * («4 общих плана · 2 сета · 8 материалов»). Три шага страницы альбома —
 * состав, обложка и тексты, оформление — одинаковые снаружи, разные внутри.
 */
export function AlbumSection({ step, title, summary, aside, children }: { step: number; title: string; summary?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <Panel>
      <header className="album-step">
        <span className="album-step-no" aria-hidden>
          {step}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="ds-h3">{title}</h2>
          {summary ? <p className="ds-caption mt-0.5">{summary}</p> : null}
        </div>
        {aside}
      </header>
      {children}
    </Panel>
  )
}
