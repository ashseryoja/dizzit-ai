/**
 * Спецификация альбома-презентации — контракт между клиентом и рендерером
 * PDF (`src/server/album-render.ts`). Клиент (`src/lib/album-engine.ts`)
 * собирает её из записи альбома и записей инструментов: подписи, стиль,
 * ключи картинок. Сервер по ней только рисует — ни базу, ни записи он не
 * читает, поэтому спецификация должна быть самодостаточной.
 *
 * Картинки адресуются теми же ключами, что блобы в IndexedDB и в хранилище
 * (`${id}:result`, `${id}:view-${frame}`, см. lib/blob-store): сервер берёт их
 * из хранилища владельца, а в локальном режиме без сервера клиент присылает
 * файлы прямо в запросе под теми же ключами.
 */

import { plural } from "@/lib/utils"

/** Формат страниц: A4 альбомный (печать), A4 книжный, экран 16:9 (показ на встрече). */
export type AlbumFormat = "a4-landscape" | "a4-portrait" | "screen"

/** Тема разворотов: тёмная — фирменная, светлая — под печать. */
export type AlbumTheme = "dark" | "light"

export const ALBUM_FORMATS: readonly AlbumFormat[] = ["a4-landscape", "a4-portrait", "screen"]
export const ALBUM_THEMES: readonly AlbumTheme[] = ["dark", "light"]

export interface AlbumStudio {
  name: string
  contact: string
}

/** Плашка материала стиля на странице концепции. */
export interface AlbumSwatch {
  name: string
  color: string
}

export interface AlbumConcept {
  /** Название стиля из каталога («Скандинавский») или «Свой стиль». */
  styleLabel: string
  /** Направление внутри стиля («белый и светлый дуб»); пусто — нет. */
  variantLabel: string
  /** Абзац концепции: от ИИ или от пользователя. */
  text: string
  swatches: AlbumSwatch[]
}

/** Общий план: улучшенный рендер или перенос стиля. */
export interface AlbumOverview {
  key: string
  /** Исходник для разворота «до / после»; пусто — разворота нет. */
  beforeKey?: string
  title: string
  caption: string
}

export interface AlbumViewFrame {
  key: string
  label: string
  caption: string
}

export interface AlbumViewSet {
  title: string
  caption: string
  /** Общий план, из которого построен сет. */
  sourceKey: string
  /** Формат кадров сета (`9:16`, `16:9`, `4:3`, `3:4`, `1:1`); пусто — кадры 4:5. */
  aspect: string
  frames: AlbumViewFrame[]
}

export interface AlbumMaterial {
  key: string
  name: string
  category: string
}

export interface AlbumSpec {
  title: string
  subtitle: string
  studio: AlbumStudio
  /** Дата на обложке уже отформатирована клиентом («17 сент. 2026»). */
  date: string
  format: AlbumFormat
  theme: AlbumTheme
  /** Картинка обложки; пусто — обложка текстовая. */
  coverKey: string
  concept: AlbumConcept | null
  overview: AlbumOverview[]
  viewSets: AlbumViewSet[]
  materials: AlbumMaterial[]
  /** Вступление к доске материалов. */
  materialsIntro: string
}

/** Тексты альбома от ИИ (`/api/album/copy`): по ключам картинок — подписи. */
export interface AlbumCopy {
  subtitle: string
  concept: string
  materialsIntro: string
  captions: Record<string, string>
}

/**
 * Копия картинки для PDF: JPEG не длиннее `PDF_IMAGE_MAX_SIDE` под ключом
 * `${id}:pdf-${роль}` рядом с оригиналом (`abc:result` → `abc:pdf-result`).
 * Готовит её либо браузер из своего кэша (быстро: оригинал уже на месте),
 * либо сервер из оригинала в хранилище (`/api/album/prepare`).
 */
export const PDF_IMAGE_MAX_SIDE = 1800
export const PDF_JPEG_QUALITY = 0.82

export function pdfKey(key: string): string {
  const [id, role] = key.split(":")
  return `${id}:pdf-${role}`
}

/** Все ключи картинок спецификации в порядке появления, без повторов. */
export function albumImageKeys(spec: AlbumSpec): string[] {
  const keys: string[] = []
  const push = (key: string | undefined) => {
    if (key && !keys.includes(key)) keys.push(key)
  }
  push(spec.coverKey)
  for (const item of spec.overview) {
    push(item.key)
    push(item.beforeKey)
  }
  for (const set of spec.viewSets) {
    push(set.sourceKey)
    for (const frame of set.frames) push(frame.key)
  }
  for (const material of spec.materials) push(material.key)
  return keys
}

const KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}:[a-z0-9-]{1,48}$/
const MAX_TEXT = 4000
const MAX_ITEMS = 60

const str = (value: unknown, max = MAX_TEXT) => (typeof value === "string" ? value.slice(0, max) : "")
const key = (value: unknown) => (typeof value === "string" && KEY_PATTERN.test(value) ? value : "")
const list = <T>(value: unknown, map: (item: unknown) => T | null): T[] =>
  Array.isArray(value)
    ? value
        .slice(0, MAX_ITEMS)
        .map(map)
        .filter((item): item is T => item !== null)
    : []

/**
 * Разбор тела запроса в спецификацию: строки обрезаются, ключи картинок
 * проверяются по шаблону хранилища, лишние поля отбрасываются. Ошибочные
 * элементы списков пропускаются, а не валят весь альбом.
 */
export function parseAlbumSpec(input: unknown): AlbumSpec | null {
  if (!input || typeof input !== "object") return null
  const raw = input as Record<string, unknown>
  const format = ALBUM_FORMATS.includes(raw.format as AlbumFormat) ? (raw.format as AlbumFormat) : "a4-landscape"
  const theme = ALBUM_THEMES.includes(raw.theme as AlbumTheme) ? (raw.theme as AlbumTheme) : "dark"
  const studio = (raw.studio ?? {}) as Record<string, unknown>
  const concept = raw.concept && typeof raw.concept === "object" ? (raw.concept as Record<string, unknown>) : null
  return {
    title: str(raw.title, 200),
    subtitle: str(raw.subtitle, 400),
    studio: { name: str(studio.name, 120), contact: str(studio.contact, 200) },
    date: str(raw.date, 40),
    format,
    theme,
    coverKey: key(raw.coverKey),
    concept: concept
      ? {
          styleLabel: str(concept.styleLabel, 80),
          variantLabel: str(concept.variantLabel, 80),
          text: str(concept.text, 1200),
          swatches: list(concept.swatches, (item) => {
            const sw = (item ?? {}) as Record<string, unknown>
            const color = str(sw.color, 16)
            return /^#[0-9a-fA-F]{3,8}$/.test(color) ? { name: str(sw.name, 60), color } : null
          }).slice(0, 8),
        }
      : null,
    overview: list(raw.overview, (item) => {
      const o = (item ?? {}) as Record<string, unknown>
      const k = key(o.key)
      if (!k) return null
      const before = key(o.beforeKey)
      return { key: k, beforeKey: before || undefined, title: str(o.title, 120), caption: str(o.caption, 400) }
    }),
    viewSets: list(raw.viewSets, (item) => {
      const s = (item ?? {}) as Record<string, unknown>
      const sourceKey = key(s.sourceKey)
      const frames = list(s.frames, (frame) => {
        const f = (frame ?? {}) as Record<string, unknown>
        const k = key(f.key)
        return k ? { key: k, label: str(f.label, 80), caption: str(f.caption, 300) } : null
      })
      if (frames.length === 0 && !sourceKey) return null
      return { title: str(s.title, 120), caption: str(s.caption, 400), sourceKey, aspect: str(s.aspect, 8), frames }
    }),
    materials: list(raw.materials, (item) => {
      const m = (item ?? {}) as Record<string, unknown>
      const k = key(m.key)
      return k ? { key: k, name: str(m.name, 80), category: str(m.category, 30) } : null
    }),
    materialsIntro: str(raw.materialsIntro, 600),
  }
}

/* ── План страниц ─────────────────────────────────────────────────────────
   Одна раскладка на клиент и сервер: страница инструмента показывает по
   плану структуру и число страниц ДО сборки, а рендер (`album-document.tsx`)
   рисует по нему же — и печатает по нему содержание с номерами страниц. */

/** Сколько кадров сета и материалов помещается на страницу — зависит от формата. */
export interface AlbumCapacity {
  /** Первая страница сета: рядом с общим планом места меньше. */
  viewsFirst: number
  viewsNext: number
  materials: number
}

export const ALBUM_CAPACITY: Record<AlbumFormat, AlbumCapacity> = {
  "a4-landscape": { viewsFirst: 6, viewsNext: 8, materials: 8 },
  "a4-portrait": { viewsFirst: 4, viewsNext: 6, materials: 9 },
  screen: { viewsFirst: 6, viewsNext: 8, materials: 8 },
}

/**
 * Сетка доски материалов: допустимые колонки, рядов на страницу и примерная
 * геометрия (ширина области и тайл, ограниченный высотой ряда, pt) — чтобы
 * выбрать колонки по размеру тайла, не зная точной вёрстки.
 */
export const MATERIAL_GRID: Record<AlbumFormat, { columns: number[]; rows: number; width: number; rowTile: number }> = {
  "a4-landscape": { columns: [3, 4, 5], rows: 2, width: 754, rowTile: 175 },
  "a4-portrait": { columns: [2, 3], rows: 3, width: 515, rowTile: 188 },
  screen: { columns: [3, 4, 5], rows: 2, width: 872, rowTile: 148 },
}

/**
 * Колонки доски материалов под число тайлов: меньше страниц, потом крупнее
 * тайл, потом полные ряды (без ряда «4 + 1»), потом меньше колонок.
 */
export function materialColumns(count: number, format: AlbumFormat): number {
  const { columns, rows, width, rowTile } = MATERIAL_GRID[format]
  let best: { cols: number; pages: number; tile: number; remainder: number } | null = null
  for (const cols of columns) {
    const pages = Math.ceil(Math.ceil(count / cols) / rows)
    const tile = Math.round(Math.min((width - 12 * (cols - 1)) / cols, rowTile))
    const remainder = count % cols
    // Заполненность последнего ряда: полный ряд лучше любого неполного, а из неполных — полнее.
    const fill = remainder === 0 ? 1 : remainder / cols
    const better =
      !best ||
      pages < best.pages ||
      (pages === best.pages && tile > best.tile) ||
      (pages === best.pages && tile === best.tile && fill > (best.remainder === 0 ? 1 : best.remainder / best.cols)) ||
      (pages === best.pages && tile === best.tile && fill === (best.remainder === 0 ? 1 : best.remainder / best.cols) && cols < best.cols)
    if (better) best = { cols, pages, tile, remainder }
  }
  return best?.cols ?? columns[0]
}

export type AlbumSectionKind = "concept" | "overview" | "views" | "materials" | "contacts"

export const ALBUM_SECTION_TITLE: Record<AlbumSectionKind, string> = {
  concept: "Концепция",
  overview: "Общие планы",
  views: "Ракурсы и детали",
  materials: "Материалы",
  contacts: "Контакты студии",
}

/** Раздел альбома для содержания и панели сборки. */
export interface AlbumSection {
  kind: AlbumSectionKind
  /** Порядковый номер раздела с 1; у контактов номера нет. */
  number: number | null
  title: string
  /** «6 общих планов · 3 разворота «до / после»». */
  detail: string
  /** Номер первой страницы раздела (обложка — 1). */
  page: number
  pageCount: number
}

export type AlbumPageKind = "cover" | "contents" | "concept" | "overview" | "views" | "materials" | "back"

export interface AlbumPlanPage {
  kind: AlbumPageKind
  /** Номер страницы с 1 (обложка — 1). */
  number: number
  /** Номер раздела, к которому относится страница. */
  section: number | null
  /** overview: индекс общего плана; views: индекс сета. */
  index: number
  /** views: кадры сета `[from, to)`; materials: материалы `[from, to)`. */
  from: number
  to: number
  /** materials: колонок в сетке страницы. */
  columns: number
  /** Не первая страница сета или доски материалов. */
  continuation: boolean
}

export interface AlbumPlan {
  pages: AlbumPlanPage[]
  sections: AlbumSection[]
  /** Есть страница содержания (от двух разделов). */
  contents: boolean
  imageCount: number
}

/**
 * Разложить `count` элементов по страницам так, чтобы последняя не осталась
 * с одним-двумя: минимум страниц, а элементы — поровну. Первая страница
 * вмещает `first`, остальные — `next`.
 */
export function splitBalanced(count: number, first: number, next: number): number[] {
  if (count <= 0) return []
  if (count <= first) return [count]
  const pages = 1 + Math.ceil((count - first) / next)
  const base = Math.floor(count / pages)
  const sizes = Array.from({ length: pages }, () => base)
  let extra = count - base * pages
  for (let i = pages - 1; i >= 0 && extra > 0; i -= 1, extra -= 1) sizes[i] += 1
  let overflow = Math.max(0, sizes[0] - first)
  sizes[0] -= overflow
  for (let i = 1; i < pages && overflow > 0; i += 1) {
    const take = Math.min(next - sizes[i], overflow)
    sizes[i] += take
    overflow -= take
  }
  return sizes
}

export function hasConceptPage(spec: AlbumSpec): boolean {
  return Boolean(spec.concept && (spec.concept.text || spec.concept.swatches.length > 0))
}

/** План страниц по спецификации: обложка → содержание → разделы → задняя страница. */
export function planAlbum(spec: AlbumSpec): AlbumPlan {
  const cap = ALBUM_CAPACITY[spec.format]
  const pages: AlbumPlanPage[] = []
  const sections: AlbumSection[] = []
  const push = (page: Omit<AlbumPlanPage, "number">) => pages.push({ ...page, number: pages.length + 1 })
  const blank = { section: null, index: 0, from: 0, to: 0, columns: 0, continuation: false }

  const concept = hasConceptPage(spec)
  const frames = spec.viewSets.reduce((sum, set) => sum + set.frames.length, 0)
  const splits = spec.overview.filter((item) => item.beforeKey).length
  const contentSections = (concept ? 1 : 0) + (spec.overview.length ? 1 : 0) + (spec.viewSets.length ? 1 : 0) + (spec.materials.length ? 1 : 0)
  const contents = contentSections >= 2

  push({ kind: "cover", ...blank })
  if (contents) push({ kind: "contents", ...blank })

  let number = 0
  const section = (kind: AlbumSectionKind, detail: string, count: number) => {
    number += 1
    sections.push({ kind, number, title: ALBUM_SECTION_TITLE[kind], detail, page: pages.length + 1, pageCount: count })
    return number
  }

  if (concept) {
    const c = spec.concept!
    const parts = [c.styleLabel, c.swatches.length ? `палитра из ${c.swatches.length} ${plural(c.swatches.length, ["материала", "материалов", "материалов"])}` : ""].filter(Boolean)
    push({ kind: "concept", ...blank, section: section("concept", parts.join(" · "), 1) })
  }
  if (spec.overview.length) {
    const detail = [
      `${spec.overview.length} ${plural(spec.overview.length, ["общий план", "общих плана", "общих планов"])}`,
      splits ? `${splits} ${plural(splits, ["разворот", "разворота", "разворотов"])} «до / после»` : "",
    ]
      .filter(Boolean)
      .join(" · ")
    const no = section("overview", detail, spec.overview.length)
    spec.overview.forEach((_, index) => push({ kind: "overview", ...blank, section: no, index }))
  }
  if (spec.viewSets.length) {
    const detail = `${spec.viewSets.length} ${plural(spec.viewSets.length, ["сет", "сета", "сетов"])} · ${frames} ${plural(frames, ["кадр", "кадра", "кадров"])}`
    const start = pages.length
    const no = section("views", detail, 0)
    spec.viewSets.forEach((set, index) => {
      let from = 0
      splitBalanced(set.frames.length, cap.viewsFirst, cap.viewsNext).forEach((size, page) => {
        push({ kind: "views", section: no, index, from, to: from + size, columns: 0, continuation: page > 0 })
        from += size
      })
    })
    sections[sections.length - 1].pageCount = pages.length - start
  }
  if (spec.materials.length) {
    const start = pages.length
    const no = section("materials", `${spec.materials.length} ${plural(spec.materials.length, ["материал", "материала", "материалов"])}`, 0)
    // Ряды делятся между страницами поровну, а не тайлы: полный ряд на
    // каждой странице, неполный — только последний.
    const columns = materialColumns(spec.materials.length, spec.format)
    const rowsPerPage = MATERIAL_GRID[spec.format].rows
    const rows = Math.ceil(spec.materials.length / columns)
    let from = 0
    // Лишний ряд — первой странице, а не последней (у рядов вместимость всех страниц одна).
    splitBalanced(rows, rowsPerPage, rowsPerPage).reverse().forEach((rowCount, page) => {
      const to = Math.min(spec.materials.length, from + rowCount * columns)
      push({ kind: "materials", section: no, index: 0, from, to, columns, continuation: page > 0 })
      from = to
    })
    sections[sections.length - 1].pageCount = pages.length - start
  }
  if (spec.studio.name || spec.studio.contact) {
    sections.push({ kind: "contacts", number: null, title: ALBUM_SECTION_TITLE.contacts, detail: spec.studio.name, page: pages.length + 1, pageCount: 1 })
  }
  push({ kind: "back", ...blank })

  return { pages, sections, contents, imageCount: albumImageKeys(spec).length }
}
