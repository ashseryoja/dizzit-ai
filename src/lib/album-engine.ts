"use client"

import { getBlob, getLocalBlob, resultKey, sourceKey } from "@/lib/blob-store"
import { STYLE_LABEL, STYLES, describeVariant, matchStyle } from "@/lib/restyle-engine"
import { serverStatus, uploadAsset } from "@/lib/server-sync"
import { createId, mapWithConcurrency } from "@/lib/utils"
import { viewKey } from "@/lib/view-engine"
import { PRESET_LABEL } from "@/lib/view-presets"
import { albumImageKeys, PDF_IMAGE_MAX_SIDE, PDF_JPEG_QUALITY, pdfKey, type AlbumConcept, type AlbumCopy, type AlbumSpec } from "@/shared/album"
import type { Album, Enhancement, Material, Project, Restyle, ViewSet } from "@/types"

/**
 * Движок альбома-презентации: из записи альбома и записей инструментов
 * собирает спецификацию (`shared/album.ts`), которую сервер превращает в PDF
 * (`/api/album`), и заказывает тексты у ИИ (`/api/album/copy`).
 *
 * Картинки в спецификации — ключи хранилища. В обычном режиме перед сборкой
 * готовятся копии для PDF (`prepareAlbumImages`): те оригиналы, что есть в
 * кэше этого браузера, уменьшаются здесь и выгружаются под ключом копии — это
 * быстрее, чем серверу качать оригинал из облака; остальные готовит сервер
 * порциями. Когда серверного хранения нет (пароль не задан), движок достаёт
 * блобы из IndexedDB, уменьшает и прикладывает к запросу под теми же ключами.
 */

/** Что в проекте доступно альбому — записи со статусом «готово». */
export interface AlbumSources {
  enhancements: Enhancement[]
  restyles: Restyle[]
  viewSets: ViewSet[]
  materials: Material[]
}

export const MATERIAL_CATEGORY_LABEL: Record<string, string> = {
  auto: "",
  wood: "дерево",
  stone: "камень",
  metal: "металл",
  fabric: "ткань",
}

/**
 * Состав по умолчанию — не «всё подряд»: у живого проекта десятки сетов и
 * планов, и первый альбом на сотню картинок готовился бы минуты. Остальное
 * пользователь добавляет галочками.
 */
const MAX_DEFAULT_OVERVIEW = 6
const MAX_DEFAULT_VIEW_SETS = 3
const MAX_DEFAULT_MATERIALS = 8
/** Длинная сторона картинки, отправляемой из браузера в локальном режиме. */
const INLINE_IMAGE_MAX_SIDE = 1800
const INLINE_COVER_MAX_SIDE = 1024
const RENDER_TIMEOUT_MS = 120_000
/** Сервер отвечает за 40 с и сам; запас — на медленную сеть. */
const PREPARE_TIMEOUT_MS = 90_000
/** Подготовка большого альбома идёт порциями; больше — что-то не так, а не «ещё чуть-чуть». */
const MAX_PREPARE_ROUNDS = 60
/** Подряд неудачных вызовов подготовки, после которых сборка сдаётся. */
const MAX_PREPARE_FAILURES = 3
const LOCAL_UPLOAD_CONCURRENCY = 3
const COPY_TIMEOUT_MS = 125_000

const done = <T extends { status: string }>(items: T[]) => items.filter((item) => item.status === "done")

/** Готовые записи проекта в порядке галерей (новые первыми). */
export function collectAlbumSources(projectId: string, all: AlbumSources): AlbumSources {
  const own = <T extends { projectId: string; status: string }>(items: T[]) => done(items.filter((item) => item.projectId === projectId))
  return {
    enhancements: own(all.enhancements),
    restyles: own(all.restyles),
    viewSets: own(all.viewSets).filter((set) => set.frames.length > 0),
    materials: own(all.materials),
  }
}

/** Новый альбом с разумным составом: всё готовое в проекте, обложка — последний перенос стиля. */
export function defaultAlbum(project: Project, sources: AlbumSources): Album {
  const now = new Date().toISOString()
  const overview = [...sources.restyles, ...sources.enhancements]
  return {
    id: createId(),
    projectId: project.id,
    title: project.title,
    subtitle: "",
    format: "a4-landscape",
    theme: "dark",
    coverId: overview[0]?.id,
    overviewIds: overview.slice(0, MAX_DEFAULT_OVERVIEW).map((item) => item.id),
    showBefore: true,
    viewSetIds: sources.viewSets.slice(0, MAX_DEFAULT_VIEW_SETS).map((item) => item.id),
    materialIds: sources.materials.slice(0, MAX_DEFAULT_MATERIALS).map((item) => item.id),
    createdAt: now,
    updatedAt: now,
  }
}

/** Заголовок общего плана для подписи: стиль, направление или имя файла. */
export function overviewTitle(item: Restyle | Enhancement): string {
  if ("style" in item) {
    const family = item.style === "auto" ? matchStyle(item.note) : item.style
    const label = family ? STYLE_LABEL[family] : item.note.trim() || STYLE_LABEL.auto
    const variant = describeVariant(item.style, item.note, item.variant)
    return variant ? `${label} · ${variant}` : label
  }
  return item.note.trim() || "Общий план"
}

function conceptFor(album: Album, sources: AlbumSources): AlbumConcept | null {
  const cover = sources.restyles.find((item) => item.id === album.coverId) ?? sources.restyles.find((item) => album.overviewIds.includes(item.id))
  const text = album.concept ?? album.copy?.concept ?? ""
  if (!cover) return text ? { styleLabel: "Концепция", variantLabel: "", text, swatches: [] } : null
  const family = cover.style === "auto" ? matchStyle(cover.note) : cover.style
  const info = family ? STYLES.find((style) => style.value === family) : undefined
  const excluded = new Set(cover.excluded ?? [])
  return {
    styleLabel: info?.label ?? (cover.note.trim() || STYLE_LABEL.auto),
    variantLabel: describeVariant(cover.style, cover.note, cover.variant),
    text,
    swatches: (info?.swatches ?? []).filter((swatch) => !excluded.has(swatch.name)).slice(0, 8).map((swatch) => ({ name: swatch.name, color: swatch.color })),
  }
}

/** Дата на обложке и задней странице: месяц и год — у презентации нет «дня». */
export function formatAlbumDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric" }).format(new Date(iso)).replace(/\s*г\.$/, "")
  } catch {
    return ""
  }
}

/** Спецификация для сервера: подписи, стиль, ключи картинок — всё, что нужно рендеру. */
export function buildAlbumSpec(album: Album, sources: AlbumSources, studio: { name: string; contact: string }): AlbumSpec {
  const captions = album.copy?.captions ?? {}
  const byId = new Map<string, Restyle | Enhancement>()
  for (const item of [...sources.restyles, ...sources.enhancements]) byId.set(item.id, item)
  const cover = album.coverId ? byId.get(album.coverId) : undefined
  const overview = album.overviewIds
    .map((id) => byId.get(id))
    .filter((item): item is Restyle | Enhancement => Boolean(item))
    .map((item) => ({
      key: resultKey(item.id),
      beforeKey: album.showBefore && "style" in item && item.sourceName ? sourceKey(item.id) : undefined,
      title: overviewTitle(item),
      caption: captions[resultKey(item.id)] ?? "",
    }))
  const viewSets = album.viewSetIds
    .map((id) => sources.viewSets.find((set) => set.id === id))
    .filter((set): set is ViewSet => Boolean(set))
    .map((set) => ({
      title: set.note.trim() || `${PRESET_LABEL[set.preset] ?? "Сет"} · ${set.sourceName}`,
      caption: captions[sourceKey(set.id)] ?? "",
      sourceKey: sourceKey(set.id),
      aspect: set.aspect ?? "",
      frames: set.frames
        .filter((frame) => !set.ready || set.ready.includes(frame.key) || (set.generated ?? []).includes(frame.key))
        .map((frame) => ({ key: viewKey(set.id, frame.key), label: frame.label, caption: captions[viewKey(set.id, frame.key)] ?? "" })),
    }))
    .filter((set) => set.frames.length > 0)
  const materials = album.materialIds
    .map((id) => sources.materials.find((item) => item.id === id))
    .filter((item): item is Material => Boolean(item))
    .map((item) => ({
      key: resultKey(item.id),
      name: captions[resultKey(item.id)] ?? item.note.trim() ?? "",
      category: MATERIAL_CATEGORY_LABEL[item.category] ?? "",
    }))
  return {
    title: album.title.trim(),
    subtitle: album.subtitle.trim() || album.copy?.subtitle || "",
    studio: { name: studio.name.trim(), contact: studio.contact.trim() },
    date: formatAlbumDate(album.updatedAt || album.createdAt),
    format: album.format,
    theme: album.theme,
    coverKey: cover ? resultKey(cover.id) : "",
    concept: conceptFor(album, sources),
    overview,
    viewSets,
    materials,
    materialsIntro: album.copy?.materialsIntro ?? "",
  }
}

/** Факты для ИИ по ключам картинок: комментарии, брифы кадров, инвентарь сцены. */
export function buildAlbumFacts(album: Album, sources: AlbumSources): Record<string, string> {
  const facts: Record<string, string> = {}
  const put = (key: string, parts: (string | undefined)[]) => {
    const text = parts.filter((part): part is string => Boolean(part && part.trim())).join(". ")
    if (text) facts[key] = text
  }
  for (const item of [...sources.restyles, ...sources.enhancements]) {
    if (item.id !== album.coverId && !album.overviewIds.includes(item.id)) continue
    const inventory = "sceneInventory" in item ? item.sceneInventory?.slice(0, 900) : undefined
    put(resultKey(item.id), [item.note ? `комментарий дизайнера: ${item.note}` : undefined, "style" in item ? `стиль: ${overviewTitle(item)}` : undefined, inventory ? `что в кадре: ${inventory}` : undefined])
  }
  for (const set of sources.viewSets) {
    if (!album.viewSetIds.includes(set.id)) continue
    put(sourceKey(set.id), [set.note ? `комментарий: ${set.note}` : undefined, set.sceneInventory ? `что в кадре: ${set.sceneInventory.slice(0, 600)}` : undefined])
    for (const frame of set.frames) put(viewKey(set.id, frame.key), [frame.brief])
  }
  for (const item of sources.materials) {
    if (album.materialIds.includes(item.id)) put(resultKey(item.id), [item.note])
  }
  return facts
}

interface ProblemBody {
  error?: string
  message?: string
}

async function failureMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as ProblemBody
    if (body.message) return body.message
  } catch {
    // Не JSON — общий текст.
  }
  return `${fallback} (HTTP ${response.status})`
}

/** Уменьшенная JPEG-копия блоба для отправки в запросе — та же, что копия для PDF. */
async function inlineImage(key: string, maxSide: number): Promise<Blob | null> {
  const blob = await getBlob(key).catch(() => null)
  if (!blob) return null
  try {
    return await shrinkToPdfCopy(blob, maxSide)
  } catch {
    return blob
  }
}

export interface RenderedAlbum {
  blob: Blob
  /** Ключи картинок, которых не нашлось ни на сервере, ни в запросе. */
  missing: string[]
}

export interface AlbumProgress {
  /** Картинок подготовлено к PDF. */
  ready: number
  total: number
}

export interface RenderAlbumOptions {
  signal?: AbortSignal
  onProgress?: (progress: AlbumProgress) => void
}

interface PrepareResponse {
  ready?: string[]
  pending?: string[]
  missing?: string[]
}

function withTimeout(ms: number, signal?: AbortSignal): AbortSignal {
  return AbortSignal.any([AbortSignal.timeout(ms), ...(signal ? [signal] : [])])
}

/** Ошибка сети или таймаута — человеческим текстом, а не «signal timed out». */
function describeFailure(error: unknown, fallback: string): Error {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return new Error(`${fallback}: сервер не ответил вовремя. Попробуйте ещё раз или уберите часть картинок.`)
  }
  if (error instanceof DOMException && error.name === "AbortError") return error
  return error instanceof Error ? error : new Error(fallback)
}

async function callPrepare(keys: string[], dryRun: boolean, signal?: AbortSignal): Promise<PrepareResponse> {
  let response: Response
  try {
    response = await fetch("/api/album/prepare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys, dryRun }),
      signal: withTimeout(PREPARE_TIMEOUT_MS, signal),
    })
  } catch (error) {
    throw describeFailure(error, "Подготовка картинок не удалась")
  }
  if (!response.ok) throw new Error(await failureMessage(response, "Подготовка картинок не удалась"))
  return (await response.json()) as PrepareResponse
}

/** Копия для PDF из оригинала в браузере: JPEG не длиннее лимита. */
async function shrinkToPdfCopy(source: Blob, maxSide = PDF_IMAGE_MAX_SIDE): Promise<Blob> {
  const bitmap = await createImageBitmap(source)
  try {
    const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(bitmap.width * k))
    canvas.height = Math.max(1, Math.round(bitmap.height * k))
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas 2D недоступен")
    ctx.fillStyle = "#ffffff"
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Не удалось сжать картинку"))), "image/jpeg", PDF_JPEG_QUALITY)
    )
  } finally {
    bitmap.close()
  }
}

/**
 * Копии картинок для PDF. Сначала сверка с сервером, что уже готово; затем
 * копии для оригиналов из кэша этого браузера делаются здесь и выгружаются
 * (без скачивания из облака); что осталось — готовит сервер порциями, пока не
 * отчитается, что готово всё. Каждый вызов короткий, поэтому большой альбом
 * не упирается ни в таймаут клиента, ни в лимит serverless-функции; прогресс —
 * наружу. Сбой одного вызова — не приговор: сервер дорабатывает начатое в
 * фоне, и следующий вызов увидит это готовым.
 */
async function prepareAlbumImages(keys: string[], options: RenderAlbumOptions): Promise<void> {
  const { signal } = options
  let ready = 0
  const report = () => options.onProgress?.({ ready, total: keys.length })
  report()
  const check = await callPrepare(keys, true, signal)
  ready += (check.ready?.length ?? 0) + (check.missing?.length ?? 0)
  report()
  let pending = check.pending ?? []

  // Оригиналы из кэша браузера — копии делаем здесь.
  const remote: string[] = []
  await mapWithConcurrency(pending, LOCAL_UPLOAD_CONCURRENCY, async (key) => {
    if (signal?.aborted) return
    const local = await getLocalBlob(key).catch(() => null)
    if (!local) {
      remote.push(key)
      return
    }
    try {
      await uploadAsset(pdfKey(key), await shrinkToPdfCopy(local))
      ready += 1
      report()
    } catch {
      remote.push(key)
    }
  })
  if (signal?.aborted) throw new DOMException("Сборка отменена", "AbortError")
  pending = remote

  let failures = 0
  for (let round = 0; pending.length > 0 && round < MAX_PREPARE_ROUNDS; round += 1) {
    let json: PrepareResponse
    try {
      json = await callPrepare(pending, false, signal)
      failures = 0
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error
      failures += 1
      if (failures >= MAX_PREPARE_FAILURES) throw error
      continue
    }
    const next = json.pending ?? []
    ready += (json.ready?.length ?? 0) + (json.missing?.length ?? 0)
    pending = next
    report()
  }
}

/**
 * PDF альбома. С серверным хранением сначала готовятся копии картинок
 * (`prepareAlbumImages`), затем уходит только спецификация; без него
 * картинки прикладываются из IndexedDB. Ключи, которых нет нигде, сервер
 * заменит заглушками и вернёт списком.
 */
export async function renderAlbum(spec: AlbumSpec, options: RenderAlbumOptions = {}): Promise<RenderedAlbum> {
  const status = await serverStatus()
  const { signal } = options
  let response: Response
  if (status.persistence) {
    await prepareAlbumImages(albumImageKeys(spec), options)
    try {
      response = await fetch("/api/album", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(spec),
        signal: withTimeout(RENDER_TIMEOUT_MS, signal),
      })
    } catch (error) {
      throw describeFailure(error, "Альбом не собрался")
    }
  } else {
    const form = new FormData()
    form.set("spec", JSON.stringify(spec))
    for (const key of albumImageKeys(spec)) {
      const blob = await inlineImage(key, INLINE_IMAGE_MAX_SIDE)
      if (blob) form.set(key, blob, key)
    }
    try {
      response = await fetch("/api/album", { method: "POST", body: form, signal: withTimeout(RENDER_TIMEOUT_MS, signal) })
    } catch (error) {
      throw describeFailure(error, "Альбом не собрался")
    }
  }
  if (!response.ok) throw new Error(await failureMessage(response, "Альбом не собрался"))
  const missing = (response.headers.get("X-Album-Missing") ?? "").split(",").filter(Boolean)
  return { blob: await response.blob(), missing }
}

export interface AlbumCopyResult {
  copy: AlbumCopy
  model: string
}

/** Тексты от ИИ. Без серверного хранения обложка уходит в запросе data-URL. */
export async function requestAlbumCopy(spec: AlbumSpec, facts: Record<string, string>, signal?: AbortSignal): Promise<AlbumCopyResult> {
  const status = await serverStatus()
  let coverImage: string | undefined
  if (!status.persistence && spec.coverKey) {
    const blob = await inlineImage(spec.coverKey, INLINE_COVER_MAX_SIDE)
    if (blob) coverImage = await blobToDataUrl(blob)
  }
  const response = await fetch("/api/album/copy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ spec, facts, coverImage }),
    signal: AbortSignal.any([AbortSignal.timeout(COPY_TIMEOUT_MS), ...(signal ? [signal] : [])]),
  })
  if (!response.ok) throw new Error(await failureMessage(response, "Тексты не написались"))
  const json = (await response.json()) as { copy?: AlbumCopy; model?: string }
  if (!json.copy) throw new Error("Сервер не вернул тексты.")
  return { copy: json.copy, model: String(json.model ?? "") }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error("Не удалось прочитать картинку"))
    reader.readAsDataURL(blob)
  })
}

/** Скачать собранный PDF под именем альбома. */
export function downloadAlbumPdf(blob: Blob, title: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `${(title.trim() || "album").replace(/[\\/:*?"<>|]+/g, " ").trim()}.pdf`
  link.click()
  URL.revokeObjectURL(url)
}
