"use client"

import { Download, FileText, RefreshCw } from "lucide-react"

import { ThinkingGlyph } from "@/components/glyphs"
import { AlbumPreview } from "@/components/tool/album-preview"
import { Panel } from "@/components/ui/panel"
import type { AlbumProgress } from "@/lib/album-engine"
import { cn, plural } from "@/lib/utils"
import type { AlbumFormat, AlbumPlan } from "@/shared/album"

/** Собранный PDF: файл, время и состав, для которого он собран. */
export interface AlbumBuildResult {
  blob: Blob
  builtAt: string
  /** JSON спецификации на момент сборки — по нему страница понимает, что состав изменился. */
  specJson: string
  /** Ключи картинок, которых не нашлось: в PDF на их месте заглушки. */
  missing: string[]
}

/**
 * Состояние сборки альбома. Пока идёт новая сборка или после ошибки прежний
 * файл не пропадает — его можно скачать.
 */
export type AlbumBuildState =
  | { status: "idle" }
  | { status: "building"; progress: AlbumProgress | null; previous: AlbumBuildResult | null }
  | { status: "ready"; result: AlbumBuildResult }
  | { status: "error"; message: string; previous: AlbumBuildResult | null }

export function albumBuildResult(state: AlbumBuildState): AlbumBuildResult | null {
  if (state.status === "ready") return state.result
  if (state.status === "building" || state.status === "error") return state.previous
  return null
}

const formatBytes = (bytes: number) => `${(bytes / 1048576).toFixed(1).replace(".", ",")} МБ`
const formatTime = (iso: string) => new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso))
const pageRange = (from: number, count: number) => (count <= 1 ? String(from) : `${from}–${from + count - 1}`)

function albumSummary(plan: AlbumPlan): string {
  return `${plan.pages.length} ${plural(plan.pages.length, ["страница", "страницы", "страниц"])} · ${plan.imageCount} ${plural(plan.imageCount, ["картинка", "картинки", "картинок"])}`
}

/**
 * Главная кнопка сборки: что она делает, зависит от состояния. До сборки —
 * «Собрать PDF», после — «Скачать PDF», а если состав менялся — «Собрать
 * заново» (прежний файл остаётся на второй кнопке).
 */
function BuildAction({ state, stale, onBuild, onDownload, compact = false }: { state: AlbumBuildState; stale: boolean; onBuild: () => void; onDownload: () => void; compact?: boolean }) {
  const previous = albumBuildResult(state)
  if (state.status === "building") {
    return (
      <button type="button" className="btn-primary" disabled>
        <ThinkingGlyph size={16} />
        собираем…
      </button>
    )
  }
  if (state.status === "ready" && !stale) {
    return (
      <button type="button" className="btn-primary" onClick={onDownload}>
        <Download className="h-4 w-4" strokeWidth={1.7} />
        Скачать PDF
      </button>
    )
  }
  return (
    <>
      <button type="button" className="btn-primary" onClick={onBuild}>
        {state.status === "idle" ? <FileText className="h-4 w-4" strokeWidth={1.7} /> : <RefreshCw className="h-4 w-4" strokeWidth={1.7} />}
        {state.status === "idle" ? "Собрать PDF" : state.status === "error" ? "Попробовать снова" : "Собрать заново"}
      </button>
      {previous && !compact ? (
        <button type="button" className="btn-secondary" onClick={onDownload} title={`Файл, собранный в ${formatTime(previous.builtAt)}`}>
          <Download className="h-4 w-4" strokeWidth={1.7} />
          Скачать прежний
        </button>
      ) : null}
    </>
  )
}

/**
 * Панель сборки — правая колонка страницы альбома: что войдёт в PDF
 * (структура по плану `planAlbum` с номерами страниц — та же, что в
 * содержании самого PDF), главная кнопка, превью и итог сборки. Сборка
 * начинается только по кнопке; когда состав меняется после сборки, панель
 * говорит об этом и предлагает собрать заново.
 */
export function AlbumBuildPanel({
  plan,
  format,
  styleLabel,
  coverLabel,
  state,
  stale,
  onBuild,
  onDownload,
}: {
  plan: AlbumPlan
  format: AlbumFormat
  /** «A4 альбомный · тёмная». */
  styleLabel: string
  /** Что на обложке: название записи или «без картинки». */
  coverLabel: string
  state: AlbumBuildState
  /** Состав изменился после последней сборки. */
  stale: boolean
  onBuild: () => void
  onDownload: () => void
}) {
  const result = albumBuildResult(state)
  const last = plan.pages[plan.pages.length - 1]
  const hasContacts = plan.sections.some((section) => section.kind === "contacts")
  const rows: { key: string; number: string; title: string; detail?: string; pages: string }[] = [
    { key: "cover", number: "", title: "Обложка", detail: coverLabel, pages: "1" },
    ...(plan.contents ? [{ key: "contents", number: "", title: "Содержание", detail: "разделы и номера страниц", pages: "2" }] : []),
    ...plan.sections.map((section) => ({
      key: section.kind,
      number: section.number ? String(section.number).padStart(2, "0") : "",
      title: section.title,
      detail: section.detail,
      pages: pageRange(section.page, section.pageCount),
    })),
    ...(hasContacts ? [] : [{ key: "back", number: "", title: "Задняя страница", detail: "дата и подпись", pages: String(last.number) }]),
  ]

  return (
    <Panel className="album-build">
      <div className="album-build-head">
        <div className="min-w-0">
          <h2 className="ds-h3">Что войдёт в PDF</h2>
          <p className="ds-caption mt-0.5">
            {albumSummary(plan)} · {styleLabel}
          </p>
        </div>
      </div>

      <ol className="album-outline" aria-label="Структура альбома">
        {rows.map((row) => (
          <li key={row.key} className="album-outline-row">
            <span className="album-outline-no">{row.number}</span>
            <span className="min-w-0">
              <span className="album-outline-title">{row.title}</span>
              {row.detail ? <span className="album-outline-detail">{row.detail}</span> : null}
            </span>
            <span className="album-outline-pages">{row.pages}</span>
          </li>
        ))}
      </ol>

      <div className="album-build-actions">
        <BuildAction state={state} stale={stale} onBuild={onBuild} onDownload={onDownload} />
      </div>

      <p className={cn("album-build-note", state.status === "error" && "is-error", stale && state.status === "ready" && "is-stale")} role="status">
        {state.status === "idle"
          ? "Сборка начнётся по кнопке: сначала готовятся уменьшенные копии картинок, потом собирается PDF."
          : state.status === "building"
            ? "Не закрывайте страницу — сборка идёт здесь."
            : state.status === "error"
              ? state.message
              : stale
                ? "Состав или тексты изменились после сборки — соберите альбом заново, чтобы обновить файл."
                : `Собран в ${formatTime(state.result.builtAt)} · ${formatBytes(state.result.blob.size)}${state.result.missing.length ? ` · ${state.result.missing.length} ${plural(state.result.missing.length, ["картинка", "картинки", "картинок"])} не найдено, на их месте заглушки` : ""}`}
      </p>

      <AlbumPreview
        blob={result?.blob ?? null}
        status={state.status}
        error={state.status === "error" ? state.message : null}
        progress={state.status === "building" ? state.progress : null}
        stale={stale}
        format={format}
        idleText="Превью появится после сборки — это тот же PDF, что уходит клиенту."
        onRetry={onBuild}
      />
    </Panel>
  )
}

/**
 * Компактная полоса сборки для экранов уже xl — живёт в `ComposerDock`, где
 * у остальных инструментов композер: итог альбома и та же главная кнопка.
 * На широких экранах её нет — там панель сборки стоит справа от шагов.
 */
export function AlbumBuildBar({ plan, state, stale, onBuild, onDownload }: { plan: AlbumPlan; state: AlbumBuildState; stale: boolean; onBuild: () => void; onDownload: () => void }) {
  return (
    <div className="album-build-bar xl:hidden">
      <span className="min-w-0 truncate ds-caption" style={{ color: "var(--fg-2)" }}>
        {albumSummary(plan)}
      </span>
      <BuildAction state={state} stale={stale} onBuild={onBuild} onDownload={onDownload} compact />
    </div>
  )
}
