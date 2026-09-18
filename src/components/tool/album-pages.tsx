"use client"

import { useStoredBlobUrl } from "@/lib/use-stored-blob"
import { cn } from "@/lib/utils"
import type { AlbumFormat, AlbumPlan, AlbumPlanPage, AlbumSpec } from "@/shared/album"

const PAGE_RATIO: Record<AlbumFormat, string> = {
  "a4-landscape": "297 / 210",
  "a4-portrait": "210 / 297",
  screen: "16 / 9",
}

/** Миниатюра интерфейса рядом с полным файлом: `id:result` → `id:thumb-result`. */
function thumbKeys(key: string): string[] {
  const at = key.indexOf(":")
  if (at < 0) return [key]
  const role = key.slice(at + 1)
  return role.startsWith("thumb-") ? [key] : [`${key.slice(0, at)}:thumb-${role}`, key]
}

function PageImage({ storeKey, className }: { storeKey: string; className?: string }) {
  const asset = useStoredBlobUrl(storeKey ? thumbKeys(storeKey) : [])
  if (!asset.url) return <span className={cn("album-page-blank", className)} />
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={asset.url} alt="" draggable={false} onError={asset.reportImageError} className={className} />
}

/** Одна страница в миниатюре — та же композиция, что у страницы PDF, без мелкого текста. */
function PageFace({ page, spec }: { page: AlbumPlanPage; spec: AlbumSpec }) {
  if (page.kind === "cover") {
    return (
      <>
        {spec.coverKey ? <PageImage storeKey={spec.coverKey} className="album-page-cover" /> : null}
        <span className="album-page-scrim" />
        <span className="album-page-title">{spec.title || "Без названия"}</span>
      </>
    )
  }
  if (page.kind === "contents") {
    return (
      <span className="album-page-lines">
        {Array.from({ length: 4 }, (_, index) => (
          <span key={index} />
        ))}
      </span>
    )
  }
  if (page.kind === "concept") {
    return (
      <span className="album-page-concept">
        <span className="album-page-lines is-short">
          <span />
          <span />
          <span />
        </span>
        <span className="album-page-swatches">
          {(spec.concept?.swatches ?? []).slice(0, 8).map((swatch) => (
            <span key={swatch.name} style={{ background: swatch.color }} />
          ))}
        </span>
      </span>
    )
  }
  if (page.kind === "overview") {
    const item = spec.overview[page.index]
    if (!item) return null
    return item.beforeKey ? (
      <span className="album-page-split">
        <PageImage storeKey={item.beforeKey} />
        <PageImage storeKey={item.key} />
      </span>
    ) : (
      <PageImage storeKey={item.key} className="album-page-full" />
    )
  }
  if (page.kind === "views") {
    const set = spec.viewSets[page.index]
    if (!set) return null
    const frames = set.frames.slice(page.from, page.to)
    return (
      <span className="album-page-views">
        {page.continuation ? null : <PageImage storeKey={set.sourceKey} className="album-page-views-main" />}
        <span className="album-page-grid" style={{ ["--cols" as string]: Math.min(3, Math.max(2, Math.ceil(frames.length / 2))) }}>
          {frames.map((frame) => (
            <PageImage key={frame.key} storeKey={frame.key} />
          ))}
        </span>
      </span>
    )
  }
  if (page.kind === "materials") {
    return (
      <span className="album-page-grid is-padded" style={{ ["--cols" as string]: Math.max(2, page.columns) }}>
        {spec.materials.slice(page.from, page.to).map((material) => (
          <PageImage key={material.key} storeKey={material.key} />
        ))}
      </span>
    )
  }
  return <span className="album-page-dot" />
}

const PAGE_LABEL: Record<AlbumPlanPage["kind"], string> = {
  cover: "обложка",
  contents: "содержание",
  concept: "концепция",
  overview: "общий план",
  views: "ракурсы",
  materials: "материалы",
  back: "задняя",
}

/**
 * Лента страниц будущего PDF в миниатюрах — живая, до сборки: обложка с
 * названием, разворот «до / после», сетка кадров сета, доска материалов. Страницы
 * идут по тому же плану (`planAlbum`), что и сам PDF, а картинки — миниатюры из
 * хранилища записей, так что лента меняется сразу с составом альбома.
 * Стили — `.album-page*` в surfaces.css.
 */
export function AlbumPageStrip({ spec, plan }: { spec: AlbumSpec; plan: AlbumPlan }) {
  return (
    <div className="album-pages scroll-thin" role="list" aria-label="Страницы альбома">
      {plan.pages.map((page) => (
        <figure key={page.number} role="listitem" className="album-page-item">
          <span
            className={cn("album-page", spec.theme === "light" ? "is-light" : "is-dark", `is-${page.kind}`)}
            style={{ aspectRatio: PAGE_RATIO[spec.format] }}
          >
            <PageFace page={page} spec={spec} />
          </span>
          <figcaption>
            <span className="tabular-nums">{page.number}</span> · {PAGE_LABEL[page.kind]}
          </figcaption>
        </figure>
      ))}
    </div>
  )
}
