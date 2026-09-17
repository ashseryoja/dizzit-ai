"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { BookOpen, Plus, Sparkles, Trash2 } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { AlbumBuildBar, AlbumBuildPanel, albumBuildResult, type AlbumBuildState } from "@/components/tool/album-build"
import { AlbumPicker, type AlbumPickItem } from "@/components/tool/album-picker"
import { AlbumSection } from "@/components/tool/album-section"
import { ALBUM_FORMAT_OPTIONS, ALBUM_THEME_OPTIONS, AlbumFormatPicker, AlbumThemePicker } from "@/components/tool/album-style-picker"
import { ComposerDock, ToolShell } from "@/components/tool/tool-shell"
import { Field } from "@/components/ui/field"
import { Panel } from "@/components/ui/panel"
import { Switch } from "@/components/ui/switch"
import {
  buildAlbumFacts,
  buildAlbumSpec,
  collectAlbumSources,
  defaultAlbum,
  downloadAlbumPdf,
  overviewTitle,
  renderAlbum,
  requestAlbumCopy,
  MATERIAL_CATEGORY_LABEL,
  type AlbumSources,
} from "@/lib/album-engine"
import { resultKey, sourceKey, thumbResultKey, thumbSourceKey } from "@/lib/blob-store"
import { useIsMobile } from "@/lib/use-is-mobile"
import { cn, plural } from "@/lib/utils"
import { PRESET_LABEL } from "@/lib/view-presets"
import { planAlbum } from "@/shared/album"
import { useAlbumStore } from "@/stores/album-store"
import { useCompanyStore } from "@/stores/company-store"
import { useEnhanceStore } from "@/stores/enhance-store"
import { useMaterialStore } from "@/stores/material-store"
import { ensureActiveProject, useActiveProject } from "@/stores/project-store"
import { useRestyleStore } from "@/stores/restyle-store"
import { useViewsStore } from "@/stores/views-store"
import type { Album } from "@/types"

/** Ширина окна, с которой шаги и панель сборки стоят рядом (tailwind `xl`). */
const ALBUM_TWO_COLUMNS_MIN = 1280

const LABELS = {
  title: "Альбом-презентация",
  description: "PDF для клиента из того, что уже готово в проекте: обложка, концепция с палитрой, общие планы, сеты ракурсов и доска материалов.",
  create: "Начать альбом",
  another: "Новый альбом",
  remove: "Удалить",
  invite: {
    title: "Собрать альбом из готового",
    text: "Обложка, содержание, концепция стиля, общие планы, сеты и доска материалов сложатся сами — останется поправить состав и тексты и нажать «Собрать PDF».",
  },
  empty: {
    title: "Пока нечего собирать",
    text: "Альбом складывается из готовых результатов: улучшите рендер, перенесите стиль, постройте сет ракурсов или сгенерируйте материалы — и они появятся здесь.",
  },
  steps: {
    contents: "Состав",
    cover: "Обложка и тексты",
    style: "Оформление",
  },
  pickers: {
    overview: { title: "Общие планы", hint: "улучшенные рендеры и переносы стиля — по одному на страницу, в порядке сетки", empty: "В проекте нет готовых улучшений и переносов стиля." },
    sets: { title: "Сеты ракурсов", hint: "общий план и кадры из него — сеткой, по несколько на страницу", empty: "В проекте нет готовых сетов ракурсов." },
    materials: { title: "Доска материалов", hint: "квадратные тайлы с названиями", empty: "В проекте нет готовых материалов." },
    cover: { title: "Картинка обложки", hint: "рендер во весь лист, название проекта поверх", none: "Без картинки" },
  },
  showBefore: "Разворот «до / после» у переносов стиля",
  fields: {
    title: "название проекта",
    subtitle: "подзаголовок",
    concept: "концепция",
    conceptPlaceholder: "Два-три предложения о стиле, материалах и свете.",
  },
  copy: {
    title: "Тексты от ИИ",
    write: "Написать тексты",
    writing: "пишем тексты…",
    hint: "ИИ посмотрит на обложку и данные проекта и напишет подзаголовок, концепцию, вступление к материалам и подписи к картинкам. Ваши правки в полях останутся главнее.",
    fromAi: "предложил ИИ — можно переписать",
  },
  format: "формат страниц",
  theme: "тема",
} as const

/**
 * «Альбом-презентация» — первый экран, читающий результаты всех инструментов
 * сразу. Файлов не принимает, поэтому `ToolShell` без `intake`; вместо
 * композера — три шага настройки слева (`AlbumSection`) и панель сборки
 * справа (`AlbumBuildPanel`), на узких экранах — полоса в `ComposerDock`.
 * Запись альбома хранит состав и тексты; PDF собирает сервер по кнопке
 * (`lib/album-engine`), а что в него войдёт, панель показывает заранее по
 * общему плану страниц (`shared/album`).
 */
export default function AlbumPage() {
  const activeProject = useActiveProject()
  const albums = useAlbumStore((state) => state.albums)
  const addAlbum = useAlbumStore((state) => state.add)
  const updateAlbum = useAlbumStore((state) => state.update)
  const removeAlbum = useAlbumStore((state) => state.remove)
  const company = useCompanyStore()
  // Две колонки — с xl: ниже панель сборки уходит под шаги, а кнопка — в полосу внизу.
  const narrow = useIsMobile(ALBUM_TWO_COLUMNS_MIN - 1)

  const enhancements = useEnhanceStore((state) => state.enhancements)
  const restyles = useRestyleStore((state) => state.restyles)
  const viewSets = useViewsStore((state) => state.sets)
  const materials = useMaterialStore((state) => state.materials)

  const sources = useMemo(
    () => (activeProject ? collectAlbumSources(activeProject.id, { enhancements, restyles, viewSets, materials }) : null),
    [activeProject, enhancements, restyles, viewSets, materials]
  )
  const available = sources ? sources.enhancements.length + sources.restyles.length + sources.viewSets.length + sources.materials.length : 0

  const visible = activeProject ? albums.filter((item) => item.projectId === activeProject.id) : []
  const [activeId, setActiveId] = useState<string | null>(null)
  const album = visible.find((item) => item.id === activeId) ?? visible[0] ?? null

  const createAlbum = async () => {
    const project = await ensureActiveProject()
    if (!sources) return
    const next = defaultAlbum(project, sources)
    addAlbum(next)
    setActiveId(next.id)
  }

  const deleteAlbum = (item: Album) => {
    if (!window.confirm(`Удалить альбом «${item.title || "без названия"}»? Результаты инструментов останутся.`)) return
    removeAlbum(item.id)
    setActiveId(null)
  }

  return (
    <ToolShell composerOpen={narrow && Boolean(album && sources)}>
      <div className="flex flex-col gap-5">
        <PageHeader
          title={LABELS.title}
          description={LABELS.description}
          actions={
            album ? (
              <>
                <button type="button" className="btn-secondary" onClick={() => void createAlbum()} disabled={available === 0}>
                  <Plus className="h-4 w-4" strokeWidth={1.7} />
                  {LABELS.another}
                </button>
                <button type="button" className="btn-secondary is-danger" onClick={() => deleteAlbum(album)}>
                  <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                  {LABELS.remove}
                </button>
              </>
            ) : null
          }
        />

        {visible.length > 1 ? (
          <div className="seg w-fit max-w-full overflow-x-auto no-scrollbar" role="tablist" aria-label="Альбомы проекта">
            {visible.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={item.id === album?.id}
                className={cn("seg-item", item.id === album?.id && "is-active")}
                onClick={() => setActiveId(item.id)}
              >
                {item.title || "Без названия"}
              </button>
            ))}
          </div>
        ) : null}

        {!album || !sources ? (
          <Panel>
            <div className="flex flex-col items-center gap-4 py-10 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-[var(--r-sm)]" style={{ background: "var(--bg-raised)", border: "1px solid var(--line)" }}>
                <BookOpen className="h-5 w-5" style={{ color: "var(--fg-3)" }} strokeWidth={1.5} />
              </div>
              {available > 0 && sources ? (
                <>
                  <div className="flex max-w-md flex-col gap-2">
                    <h2 className="ds-h2">{LABELS.invite.title}</h2>
                    <p className="ds-body" style={{ color: "var(--fg-3)" }}>
                      {describeSources(sources)}. {LABELS.invite.text}
                    </p>
                  </div>
                  <button type="button" className="btn-primary" onClick={() => void createAlbum()}>
                    <BookOpen className="h-4 w-4" strokeWidth={1.7} />
                    {LABELS.create}
                  </button>
                </>
              ) : (
                <>
                  <div className="flex max-w-md flex-col gap-2">
                    <h2 className="ds-h2">{LABELS.empty.title}</h2>
                    <p className="ds-body" style={{ color: "var(--fg-3)" }}>
                      {LABELS.empty.text}
                    </p>
                  </div>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Link href="/restyle" className="btn-secondary">
                      Перенос стиля
                    </Link>
                    <Link href="/views" className="btn-secondary">
                      Ракурсы и детали
                    </Link>
                    <Link href="/materials" className="btn-secondary">
                      Материалы
                    </Link>
                  </div>
                </>
              )}
            </div>
          </Panel>
        ) : (
          <AlbumEditor key={album.id} album={album} sources={sources} studio={{ name: company.name, contact: company.contact }} onChange={(patch) => updateAlbum(album.id, patch)} />
        )}
      </div>
    </ToolShell>
  )
}

function describeSources(sources: AlbumSources): string {
  const parts: string[] = []
  const overview = sources.restyles.length + sources.enhancements.length
  if (overview) parts.push(`${overview} ${plural(overview, ["общий план", "общих плана", "общих планов"])}`)
  if (sources.viewSets.length) parts.push(`${sources.viewSets.length} ${plural(sources.viewSets.length, ["сет ракурсов", "сета ракурсов", "сетов ракурсов"])}`)
  if (sources.materials.length) parts.push(`${sources.materials.length} ${plural(sources.materials.length, ["материал", "материала", "материалов"])}`)
  return `В проекте готово: ${parts.join(", ")}`
}

function AlbumEditor({ album, sources, studio, onChange }: { album: Album; sources: AlbumSources; studio: { name: string; contact: string }; onChange: (patch: Partial<Album>) => void }) {
  const spec = useMemo(() => buildAlbumSpec(album, sources, studio), [album, sources, studio])
  const specJson = useMemo(() => JSON.stringify(spec), [spec])
  const plan = useMemo(() => planAlbum(spec), [spec])

  const [build, setBuild] = useState<AlbumBuildState>({ status: "idle" })
  const [copyBusy, setCopyBusy] = useState(false)
  const [copyError, setCopyError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Сборка — только по кнопке. Размонтирование обрывает запрос, чтобы поздний
  // ответ не попал в другой альбом.
  useEffect(() => () => abortRef.current?.abort(), [])

  const startBuild = useCallback(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const json = specJson
    setBuild((prev) => ({ status: "building", progress: null, previous: albumBuildResult(prev) }))
    renderAlbum(spec, {
      signal: controller.signal,
      onProgress: (progress) => setBuild((prev) => (prev.status === "building" ? { ...prev, progress } : prev)),
    }).then(
      (result) => {
        if (controller.signal.aborted) return
        setBuild({ status: "ready", result: { blob: result.blob, builtAt: new Date().toISOString(), specJson: json, missing: result.missing } })
      },
      (cause) => {
        if (controller.signal.aborted) return
        setBuild((prev) => ({ status: "error", message: cause instanceof Error ? cause.message : "Альбом не собрался.", previous: albumBuildResult(prev) }))
      }
    )
  }, [spec, specJson])

  const built = albumBuildResult(build)
  const stale = build.status === "ready" && build.result.specJson !== specJson
  const download = () => {
    if (built) downloadAlbumPdf(built.blob, album.title)
  }

  const writeCopy = async () => {
    setCopyBusy(true)
    setCopyError(null)
    try {
      const result = await requestAlbumCopy(spec, buildAlbumFacts(album, sources))
      onChange({ copy: result.copy, copyModel: result.model })
    } catch (cause) {
      setCopyError(cause instanceof Error ? cause.message : "Тексты не написались.")
    } finally {
      setCopyBusy(false)
    }
  }

  const toggle = (field: "overviewIds" | "viewSetIds" | "materialIds", allowed: string[]) => (id: string) => {
    const current = album[field]
    const next = current.includes(id) ? current.filter((item) => item !== id) : allowed.filter((item) => item === id || current.includes(item))
    onChange({ [field]: next })
  }

  const overviewItems: AlbumPickItem[] = [...sources.restyles, ...sources.enhancements].map((item) => ({
    id: item.id,
    label: overviewTitle(item),
    hint: item.note,
    keys: [thumbResultKey(item.id), resultKey(item.id)],
  }))
  const setItems: AlbumPickItem[] = sources.viewSets.map((set) => ({
    id: set.id,
    label: set.note.trim() || `${PRESET_LABEL[set.preset] ?? "Сет"} · ${set.frames.length} ${plural(set.frames.length, ["кадр", "кадра", "кадров"])}`,
    hint: set.sourceName,
    keys: [thumbSourceKey(set.id), sourceKey(set.id)],
  }))
  const materialItems: AlbumPickItem[] = sources.materials.map((item) => ({
    id: item.id,
    label: item.note.trim() || MATERIAL_CATEGORY_LABEL[item.category] || "материал",
    keys: [thumbResultKey(item.id), resultKey(item.id)],
  }))

  const composition = [
    `${spec.overview.length} ${plural(spec.overview.length, ["общий план", "общих плана", "общих планов"])}`,
    `${spec.viewSets.length} ${plural(spec.viewSets.length, ["сет", "сета", "сетов"])}`,
    `${spec.materials.length} ${plural(spec.materials.length, ["материал", "материала", "материалов"])}`,
  ].join(" · ")
  const coverLabel = overviewItems.find((item) => item.id === album.coverId)?.label ?? LABELS.pickers.cover.none.toLowerCase()
  const styleLabel = `${ALBUM_FORMAT_OPTIONS.find((option) => option.value === album.format)?.label ?? album.format} · ${(ALBUM_THEME_OPTIONS.find((option) => option.value === album.theme)?.label ?? album.theme).toLowerCase()}`

  return (
    <>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start">
        <div className="flex min-w-0 flex-col gap-5">
          <AlbumSection step={1} title={LABELS.steps.contents} summary={composition}>
            <div className="flex flex-col gap-6">
              <AlbumPicker
                title={LABELS.pickers.overview.title}
                hint={LABELS.pickers.overview.hint}
                items={overviewItems}
                selected={album.overviewIds}
                onToggle={toggle("overviewIds", overviewItems.map((item) => item.id))}
                onSelectAll={(ids) => onChange({ overviewIds: ids })}
                emptyText={LABELS.pickers.overview.empty}
              />
              {sources.restyles.length > 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <label htmlFor="album-show-before" className="cursor-pointer text-[13px]" style={{ color: "var(--fg-1)" }}>
                    {LABELS.showBefore}
                  </label>
                  <Switch id="album-show-before" checked={album.showBefore} onChange={(value) => onChange({ showBefore: value })} />
                </div>
              ) : null}
              <hr className="ds-divider" />
              <AlbumPicker
                title={LABELS.pickers.sets.title}
                hint={LABELS.pickers.sets.hint}
                items={setItems}
                selected={album.viewSetIds}
                onToggle={toggle("viewSetIds", setItems.map((item) => item.id))}
                onSelectAll={(ids) => onChange({ viewSetIds: ids })}
                emptyText={LABELS.pickers.sets.empty}
              />
              <hr className="ds-divider" />
              <AlbumPicker
                title={LABELS.pickers.materials.title}
                hint={LABELS.pickers.materials.hint}
                items={materialItems}
                selected={album.materialIds}
                onToggle={toggle("materialIds", materialItems.map((item) => item.id))}
                onSelectAll={(ids) => onChange({ materialIds: ids })}
                emptyText={LABELS.pickers.materials.empty}
                aspect="square"
              />
            </div>
          </AlbumSection>

          <AlbumSection step={2} title={LABELS.steps.cover} summary={coverLabel}>
            <div className="flex flex-col gap-6">
              <AlbumPicker
                title={LABELS.pickers.cover.title}
                hint={LABELS.pickers.cover.hint}
                items={overviewItems}
                selected={album.coverId ? [album.coverId] : []}
                onToggle={(id) => onChange({ coverId: id || undefined })}
                emptyText={LABELS.pickers.overview.empty}
                single
                noneLabel={LABELS.pickers.cover.none}
              />
              <hr className="ds-divider" />
              <div className="grid gap-4 md:grid-cols-2">
                <Field label={LABELS.fields.title}>
                  {(id) => <input id={id} className="field" value={album.title} onChange={(event) => onChange({ title: event.target.value })} placeholder="Квартира на Петровке" />}
                </Field>
                <Field label={LABELS.fields.subtitle} hint={album.copy?.subtitle && !album.subtitle ? LABELS.copy.fromAi : undefined}>
                  {(id) => (
                    <input id={id} className="field" value={album.subtitle} onChange={(event) => onChange({ subtitle: event.target.value })} placeholder={album.copy?.subtitle || "Концепция интерьера для семьи с двумя детьми"} />
                  )}
                </Field>
              </div>
              <Field label={LABELS.fields.concept} hint={album.copy?.concept && album.concept === undefined ? LABELS.copy.fromAi : undefined}>
                {(id) => (
                  <textarea
                    id={id}
                    className="field min-h-[96px] resize-y"
                    value={album.concept ?? album.copy?.concept ?? ""}
                    onChange={(event) => onChange({ concept: event.target.value })}
                    placeholder={LABELS.fields.conceptPlaceholder}
                  />
                )}
              </Field>
              <div className="card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-[13px]" style={{ color: "var(--fg-1)" }}>
                      {LABELS.copy.title}
                    </span>
                    <span className="ds-caption">{LABELS.copy.hint}</span>
                  </div>
                  <button type="button" className="btn-secondary shrink-0" onClick={() => void writeCopy()} disabled={copyBusy}>
                    <Sparkles className="h-4 w-4" strokeWidth={1.7} />
                    {copyBusy ? LABELS.copy.writing : LABELS.copy.write}
                  </button>
                </div>
                {album.copyModel || copyError ? (
                  <p className="ds-caption mt-3" style={copyError ? { color: "var(--danger)" } : undefined}>
                    {copyError ?? `тексты написаны · ${album.copyModel}`}
                  </p>
                ) : null}
              </div>
            </div>
          </AlbumSection>

          <AlbumSection step={3} title={LABELS.steps.style} summary={styleLabel}>
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <span className="ds-micro">{LABELS.format}</span>
                <AlbumFormatPicker value={album.format} onChange={(format) => onChange({ format })} />
              </div>
              <div className="flex flex-col gap-2">
                <span className="ds-micro">{LABELS.theme}</span>
                <AlbumThemePicker value={album.theme} onChange={(theme) => onChange({ theme })} />
              </div>
            </div>
          </AlbumSection>
        </div>

        <div className="xl:sticky xl:top-6">
          <AlbumBuildPanel plan={plan} format={album.format} styleLabel={styleLabel} coverLabel={coverLabel} state={build} stale={stale} onBuild={startBuild} onDownload={download} />
        </div>
      </div>

      <ComposerDock>
        <AlbumBuildBar plan={plan} state={build} stale={stale} onBuild={startBuild} onDownload={download} />
      </ComposerDock>
    </>
  )
}
