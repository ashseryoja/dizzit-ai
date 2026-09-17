/* eslint-disable jsx-a11y/alt-text -- <Image> здесь из @react-pdf, у него нет alt */
import "server-only"

import { deflateSync } from "node:zlib"

import * as React from "react"
import { Document, Image, Page, StyleSheet, Text, View } from "@react-pdf/renderer"

import { plural } from "@/lib/utils"
import {
  ALBUM_SECTION_TITLE,
  MATERIAL_GRID,
  planAlbum,
  type AlbumFormat,
  type AlbumPlan,
  type AlbumPlanPage,
  type AlbumSpec,
  type AlbumSwatch,
  type AlbumTheme,
  type AlbumViewSet,
} from "@/shared/album"

/**
 * Вёрстка альбома-презентации: React-компоненты страниц для @react-pdf.
 * Только композиция — картинки уже подготовлены (`album-render.ts`: размер,
 * JPEG, габариты), спецификация уже проверена (`shared/album.ts`), а какие
 * страницы и с чем — решает общий план `planAlbum` (по нему же страница
 * инструмента показывает структуру до сборки и печатается содержание).
 *
 * Язык вёрстки — как у издательского альбома интерьера: одна сетка на все
 * страницы, кикер раздела и номер страницы на каждом развороте, большие
 * заголовки лёгким Unbounded, подписи — Garet. Обложка — рендер во весь
 * лист с затемнением снизу и текстом поверх; без картинки — типографская
 * обложка с полосой палитры. Содержание с номерами страниц появляется от
 * двух разделов. Размеры считаются от формата страницы (A4 в обеих
 * ориентациях, экран 16:9), а не от фиксированных пикселей.
 */

export interface AlbumImage {
  data: Buffer
  format: "jpg" | "png"
  width: number
  height: number
}

export type AlbumImages = ReadonlyMap<string, AlbumImage>

const PAGE_SIZE: Record<AlbumFormat, [number, number]> = {
  "a4-landscape": [841.89, 595.28],
  "a4-portrait": [595.28, 841.89],
  screen: [960, 540],
}

interface Palette {
  page: string
  raised: string
  fg1: string
  fg2: string
  fg3: string
  fg4: string
  line: string
  /** Плашка «до / после» поверх картинки и её текст. */
  pill: string
  pillText: string
}

/** Цвета — от токенов дизайн-системы, сплошными hex: у страницы нет прозрачностей. */
const PALETTE: Record<AlbumTheme, Palette> = {
  dark: { page: "#19191c", raised: "#232327", fg1: "#ffffff", fg2: "#d8d8dc", fg3: "#a1a1a7", fg4: "#75757c", line: "#2e2e33", pill: "#f4f4f5", pillText: "#151517" },
  light: { page: "#ffffff", raised: "#f1f1f3", fg1: "#151517", fg2: "#3a3a40", fg3: "#6b6b72", fg4: "#9a9aa1", line: "#e3e3e7", pill: "#151517", pillText: "#ffffff" },
}

export const FONT_DISPLAY = "Unbounded"
export const FONT_BODY = "Garet"

/** Сетка страницы: зазоры и высоты фиксированных зон (pt). */
const GAP = 12
const CONTENT_GAP = 22
const HEADER_H = 26
const TITLE_H = 58
const CAPTION_H = 42
const FOOTER_BOTTOM = 20
const COLOR_BAR_H = 14

const FRAME_RATIO: Record<string, number> = { "9:16": 9 / 16, "16:9": 16 / 9, "4:3": 4 / 3, "3:4": 3 / 4, "1:1": 1 }

const pad = (n: number) => String(n).padStart(2, "0")

/* ── Затемнение обложки ──────────────────────────────────────────────────
   Градиент SVG не годится: pdfkit не интерполирует прозрачность стопов и
   кладёт скрим жёстким прямоугольником. Вместо него — PNG в один пиксель
   шириной с альфа-каналом от 0 до 0,9 (плавнее к низу), растянутый на
   нижнюю часть листа. Кодируется здесь же: сигнатура, IHDR, IDAT, IEND. */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, "ascii"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

let scrimCache: Buffer | null = null

/** PNG 1×192 RGBA: тёмный цвет, альфа растёт к низу по кривой t^1.6. */
function scrimPng(): Buffer {
  if (scrimCache) return scrimCache
  const rows = 192
  const raw = Buffer.alloc(rows * 5)
  for (let y = 0; y < rows; y += 1) {
    const t = y / (rows - 1)
    raw[y * 5] = 0
    raw[y * 5 + 1] = 12
    raw[y * 5 + 2] = 12
    raw[y * 5 + 3] = 14
    raw[y * 5 + 4] = Math.round(255 * 0.9 * Math.pow(t, 1.6))
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(1, 0)
  ihdr.writeUInt32BE(rows, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  scrimCache = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ])
  return scrimCache
}

function makeStyles(c: Palette, portrait: boolean) {
  return StyleSheet.create({
    page: { backgroundColor: c.page, color: c.fg1, fontFamily: FONT_BODY },
    kicker: { fontFamily: FONT_BODY, fontSize: 6.8, letterSpacing: 1.4, textTransform: "uppercase" as const, color: c.fg4 },
    displayXl: { fontFamily: FONT_DISPLAY, fontWeight: 300, fontSize: portrait ? 28 : 34, lineHeight: 1.1, color: c.fg1 },
    displayL: { fontFamily: FONT_DISPLAY, fontWeight: 300, fontSize: portrait ? 22 : 26, lineHeight: 1.15, color: c.fg1 },
    heading: { fontFamily: FONT_DISPLAY, fontWeight: 500, fontSize: 13, lineHeight: 1.25, color: c.fg1 },
    label: { fontFamily: FONT_DISPLAY, fontWeight: 500, fontSize: 8.5, lineHeight: 1.3, color: c.fg1 },
    number: { fontFamily: FONT_DISPLAY, fontWeight: 500, fontSize: 7, lineHeight: 1.3, color: c.fg4 },
    body: { fontFamily: FONT_BODY, fontSize: 10.5, lineHeight: 1.6, color: c.fg2 },
    caption: { fontFamily: FONT_BODY, fontSize: 8.5, lineHeight: 1.45, color: c.fg3 },
    placeholder: { backgroundColor: c.raised, alignItems: "center" as const, justifyContent: "center" as const },
    placeholderText: { fontFamily: FONT_BODY, fontSize: 7.5, color: c.fg4 },
  })
}

interface Layout {
  width: number
  height: number
  portrait: boolean
  margin: number
  c: Palette
  s: ReturnType<typeof makeStyles>
  plan: AlbumPlan
  spec: AlbumSpec
  images: AlbumImages
}

/** Рабочая область страницы под шапкой; `reserved` — фиксированные зоны ниже (заголовок, подпись). */
function contentBox(layout: Layout, reserved: number): { w: number; h: number } {
  return { w: layout.width - layout.margin * 2, h: layout.height - layout.margin * 2 - HEADER_H - reserved }
}

/** Размер картинки, вписанной в коробку без обрезки. */
function fitInside(image: { width: number; height: number }, boxW: number, boxH: number): { width: number; height: number } {
  const scale = Math.min(boxW / image.width, boxH / image.height)
  return { width: image.width * scale, height: image.height * scale }
}

function sectionKicker(layout: Layout, page: AlbumPlanPage): string {
  const section = layout.plan.sections.find((item) => item.number === page.section)
  return section ? `${pad(section.number ?? 0)} — ${section.title}` : ALBUM_SECTION_TITLE[page.kind === "views" ? "views" : page.kind === "materials" ? "materials" : page.kind === "concept" ? "concept" : "overview"]
}

/* ── Кирпичики ─────────────────────────────────────────────────────────── */

/**
 * Лист без полей (обложка, задняя страница): фон и слои поверх. У страницы
 * с `wrap={false}` и одними абсолютными детьми react-pdf не красит фон —
 * поэтому первым идёт обычный View во весь лист, в него и кладётся картинка.
 */
function Sheet({ layout, background, children }: { layout: Layout; background?: React.ReactNode; children: React.ReactNode }) {
  const { width, height, s } = layout
  return (
    <Page size={[width, height]} style={[s.page, { padding: 0 }]} wrap={false}>
      <View style={{ width, height, overflow: "hidden" }}>{background}</View>
      {children}
    </Page>
  )
}

function Placeholder({ layout, boxW, boxH, radius = 0 }: { layout: Layout; boxW: number; boxH: number; radius?: number }) {
  return (
    <View style={[layout.s.placeholder, { width: boxW, height: boxH, borderRadius: radius }]}>
      <Text style={layout.s.placeholderText}>картинка ещё не синхронизирована</Text>
    </View>
  )
}

/** Картинка, вписанная в коробку; дети — слои поверх (плашки «до / после»). */
function Fitted({
  image,
  boxW,
  boxH,
  layout,
  radius = 0,
  children,
}: {
  image: AlbumImage | undefined
  boxW: number
  boxH: number
  layout: Layout
  radius?: number
  children?: React.ReactNode
}) {
  if (!image) return <Placeholder layout={layout} boxW={boxW} boxH={boxH} radius={radius} />
  const size = fitInside(image, boxW, boxH)
  return (
    <View style={{ width: size.width, height: size.height, position: "relative", borderRadius: radius, overflow: "hidden" }}>
      <Image src={{ data: image.data, format: image.format }} style={{ width: size.width, height: size.height }} />
      {children}
    </View>
  )
}

/** Картинка, заполняющая коробку с обрезкой (обложка, тайлы материалов). */
function Covered({ image, boxW, boxH, layout, radius = 0 }: { image: AlbumImage | undefined; boxW: number; boxH: number; layout: Layout; radius?: number }) {
  if (!image) return <Placeholder layout={layout} boxW={boxW} boxH={boxH} radius={radius} />
  return (
    <View style={{ width: boxW, height: boxH, borderRadius: radius, overflow: "hidden" }}>
      <Image src={{ data: image.data, format: image.format }} style={{ width: boxW, height: boxH, objectFit: "cover" }} />
    </View>
  )
}

/** Плашка поверх картинки: «до», «после». */
function Pill({ layout, children }: { layout: Layout; children: string }) {
  const { c, s } = layout
  return (
    <View style={{ position: "absolute", left: 10, top: 10, backgroundColor: c.pill, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 }}>
      <Text style={[s.kicker, { color: c.pillText, fontSize: 6.5, letterSpacing: 1.2 }]}>{children}</Text>
    </View>
  )
}

/** Полоса палитры по нижнему краю листа — на типографской обложке и задней странице. */
function ColorBar({ layout, swatches }: { layout: Layout; swatches: AlbumSwatch[] }) {
  if (swatches.length === 0) return null
  return (
    <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: COLOR_BAR_H, flexDirection: "row" }}>
      {swatches.map((swatch, index) => (
        <View key={`${swatch.color}-${index}`} style={{ flex: 1, backgroundColor: swatch.color }} />
      ))}
    </View>
  )
}

/** Строка студии: название слева, контакт справа, сверху тонкая линия. */
function StudioRow({ layout, color, lineColor, opacity = 1 }: { layout: Layout; color: string; lineColor: string; opacity?: number }) {
  const { spec, s } = layout
  if (!spec.studio.name && !spec.studio.contact) return null
  return (
    <View style={{ marginTop: 22 }}>
      <View style={{ height: 1, backgroundColor: lineColor, marginBottom: 12 }} />
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
        <Text style={[s.label, { color }]}>{spec.studio.name}</Text>
        <Text style={[s.caption, { color, opacity, textAlign: "right", flex: 1 }]}>{spec.studio.contact}</Text>
      </View>
    </View>
  )
}

/**
 * Каркас обычной страницы: шапка (кикер раздела слева, счётчик справа),
 * содержимое и нижний колонтитул с названием проекта и номером страницы.
 */
function Frame({ layout, page, kicker, right, children }: { layout: Layout; page: AlbumPlanPage; kicker: string; right?: string; children: React.ReactNode }) {
  const { width, height, margin, s, c, spec } = layout
  return (
    <Page size={[width, height]} style={[s.page, { padding: margin }]} wrap={false}>
      <View style={{ height: HEADER_H, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 16 }}>
        <Text style={s.kicker}>{kicker}</Text>
        {right ? <Text style={s.kicker}>{right}</Text> : null}
      </View>
      {children}
      <View style={{ position: "absolute", left: margin, right: margin, bottom: FOOTER_BOTTOM, flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
        <Text style={[s.kicker, { maxLines: 1, textOverflow: "ellipsis", maxWidth: "70%" }]}>{spec.title || "Альбом"}</Text>
        <Text style={[s.number, { color: c.fg3 }]}>{String(page.number)}</Text>
      </View>
    </Page>
  )
}

/** Заголовок страницы с подписью в одну-две строки — фиксированной высоты, чтобы сетка ниже не плыла. */
function TitleBlock({ layout, title, caption }: { layout: Layout; title: string; caption?: string }) {
  const { s } = layout
  return (
    <View style={{ height: TITLE_H }}>
      <Text style={[s.heading, { maxLines: 1, textOverflow: "ellipsis" }]}>{title}</Text>
      {caption ? <Text style={[s.caption, { fontSize: 9, marginTop: 4, maxLines: 2, textOverflow: "ellipsis", maxWidth: layout.portrait ? "100%" : "68%" }]}>{caption}</Text> : null}
    </View>
  )
}

/* ── Обложка ─────────────────────────────────────────────────────────── */

function coverKicker(spec: AlbumSpec): string {
  return ["концепция интерьера", spec.date].filter(Boolean).join("   ·   ")
}

function CoverPage({ layout }: { layout: Layout }) {
  const { width, height, margin, portrait, s, spec, images } = layout
  const image = spec.coverKey ? images.get(spec.coverKey) : undefined
  if (!image) return <TextCoverPage layout={layout} />
  const scrimH = height * (portrait ? 0.52 : 0.64)
  return (
    <Sheet layout={layout} background={<Image src={{ data: image.data, format: image.format }} style={{ width, height, objectFit: "cover" }} />}>
      <Image src={{ data: scrimPng(), format: "png" }} style={{ position: "absolute", left: 0, top: height - scrimH, width, height: scrimH }} />
      <View style={{ position: "absolute", left: margin, right: margin, bottom: margin }}>
        <Text style={[s.kicker, { color: "#ffffff", opacity: 0.74 }]}>{coverKicker(spec)}</Text>
        <Text style={[s.displayXl, { color: "#ffffff", marginTop: 12, maxWidth: width * (portrait ? 1 : 0.8) }]}>{spec.title || "Концепция интерьера"}</Text>
        {spec.subtitle ? (
          <Text style={[s.body, { color: "#ffffff", opacity: 0.82, fontSize: 11, marginTop: 10, maxWidth: width * (portrait ? 0.9 : 0.56), maxLines: 3, textOverflow: "ellipsis" }]}>{spec.subtitle}</Text>
        ) : null}
        <StudioRow layout={layout} color="#ffffff" lineColor="#8a8a8f" opacity={0.78} />
      </View>
    </Sheet>
  )
}

/** Обложка без картинки: крупная типографика и полоса палитры по нижнему краю. */
function TextCoverPage({ layout }: { layout: Layout }) {
  const { width, height, margin, portrait, s, c, spec } = layout
  const swatches = spec.concept?.swatches ?? []
  const bar = swatches.length ? COLOR_BAR_H : 0
  return (
    <Sheet layout={layout}>
      <View style={{ position: "absolute", left: margin, top: margin }}>
        <Text style={s.kicker}>{coverKicker(spec)}</Text>
      </View>
      <View style={{ position: "absolute", left: margin, right: margin, top: height * (portrait ? 0.3 : 0.32) }}>
        <Text style={[s.displayXl, { fontSize: portrait ? 34 : 42, maxWidth: width * 0.84 }]}>{spec.title || "Концепция интерьера"}</Text>
        {spec.subtitle ? <Text style={[s.body, { fontSize: 11.5, marginTop: 14, maxWidth: width * (portrait ? 0.9 : 0.56), maxLines: 3, textOverflow: "ellipsis" }]}>{spec.subtitle}</Text> : null}
      </View>
      <View style={{ position: "absolute", left: margin, right: margin, bottom: margin + bar }}>
        <StudioRow layout={layout} color={c.fg1} lineColor={c.line} />
      </View>
      <ColorBar layout={layout} swatches={swatches} />
    </Sheet>
  )
}

/* ── Содержание ───────────────────────────────────────────────────────── */

function ContentsPage({ layout, page }: { layout: Layout; page: AlbumPlanPage }) {
  const { portrait, s, c, spec, plan } = layout
  const { h } = contentBox(layout, 0)
  const count = plan.pages.length
  return (
    <Frame layout={layout} page={page} kicker={`альбом · ${count} ${plural(count, ["страница", "страницы", "страниц"])}`} right={spec.date}>
      <View style={{ height: h, flexDirection: portrait ? "column" : "row", gap: portrait ? 28 : 48 }}>
        <View style={{ width: portrait ? "100%" : "36%" }}>
          <Text style={s.displayL}>Содержание</Text>
          {spec.subtitle ? <Text style={[s.caption, { fontSize: 9, marginTop: 10, maxLines: 4, textOverflow: "ellipsis" }]}>{spec.subtitle}</Text> : null}
        </View>
        <View style={{ flex: 1 }}>
          {plan.sections.map((section) => (
            <View key={section.kind} style={{ flexDirection: "row", alignItems: "flex-start", gap: 12, paddingVertical: 12, borderBottom: `1px solid ${c.line}` }}>
              <Text style={[s.number, { width: 22, paddingTop: 2 }]}>{section.number ? pad(section.number) : "—"}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>{section.title}</Text>
                {section.detail ? <Text style={[s.caption, { marginTop: 3, maxLines: 1, textOverflow: "ellipsis" }]}>{section.detail}</Text> : null}
              </View>
              <Text style={[s.label, { color: c.fg2, width: 32, textAlign: "right", paddingTop: 1 }]}>{String(section.page)}</Text>
            </View>
          ))}
        </View>
      </View>
    </Frame>
  )
}

/* ── Концепция ────────────────────────────────────────────────────────── */

function ConceptPage({ layout, page }: { layout: Layout; page: AlbumPlanPage }) {
  const { portrait, s, c, spec } = layout
  const concept = spec.concept
  if (!concept) return null
  const { w, h } = contentBox(layout, 0)
  const twoColumns = !portrait && concept.swatches.length > 0
  const paletteW = 250
  const swatchW = twoColumns ? (paletteW - 10) / 2 : (w - 10 * 3) / 4
  return (
    <Frame layout={layout} page={page} kicker={sectionKicker(layout, page)}>
      <View style={{ height: h, flexDirection: twoColumns ? "row" : "column", gap: twoColumns ? 56 : 32 }}>
        <View style={{ flex: 1, justifyContent: "center" }}>
          <Text style={[s.displayL, { fontSize: portrait ? 24 : 30 }]}>{concept.styleLabel || "Стиль проекта"}</Text>
          {concept.variantLabel ? <Text style={[s.body, { color: c.fg3, marginTop: 6 }]}>{concept.variantLabel}</Text> : null}
          {concept.text ? <Text style={[s.body, { marginTop: 24, maxWidth: 380 }]}>{concept.text}</Text> : null}
        </View>
        {concept.swatches.length > 0 ? (
          <View style={{ width: twoColumns ? paletteW : "100%", justifyContent: "center" }}>
            <Text style={[s.kicker, { marginBottom: 12 }]}>палитра материалов</Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
              {concept.swatches.map((swatch, index) => (
                <View key={`${swatch.name}-${index}`} style={{ width: swatchW }}>
                  <View style={{ height: 44, borderRadius: 5, backgroundColor: swatch.color, border: `1px solid ${c.line}` }} />
                  <Text style={[s.caption, { color: c.fg2, marginTop: 6, maxLines: 2, textOverflow: "ellipsis" }]}>{swatch.name}</Text>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </Frame>
  )
}

/* ── Общие планы ──────────────────────────────────────────────────────── */

function OverviewPage({ layout, page }: { layout: Layout; page: AlbumPlanPage }) {
  const { portrait, s, c, spec, images } = layout
  const item = spec.overview[page.index]
  const total = spec.overview.length
  const { w, h } = contentBox(layout, CAPTION_H)
  const after = images.get(item.key)
  const before = item.beforeKey ? images.get(item.beforeKey) : undefined
  // Без исходника на сервере разворот вырождается в одну картинку, а не в заглушку рядом.
  const split = Boolean(before)
  const halfW = portrait ? w : (w - GAP) / 2
  const halfH = portrait ? (h - GAP) / 2 : h
  return (
    <Frame layout={layout} page={page} kicker={sectionKicker(layout, page)} right={`${pad(page.index + 1)} / ${pad(total)}`}>
      <View style={{ height: h, alignItems: "center", justifyContent: "center" }}>
        {split ? (
          <View style={{ flexDirection: portrait ? "column" : "row", gap: GAP, alignItems: "center", justifyContent: "center" }}>
            <Fitted image={before} boxW={halfW} boxH={halfH} layout={layout}>
              <Pill layout={layout}>до</Pill>
            </Fitted>
            <Fitted image={after} boxW={halfW} boxH={halfH} layout={layout}>
              <Pill layout={layout}>после</Pill>
            </Fitted>
          </View>
        ) : (
          <Fitted image={after} boxW={w} boxH={h} layout={layout} />
        )}
      </View>
      <View style={{ height: CAPTION_H, justifyContent: "flex-end" }}>
        <View style={{ height: 1, backgroundColor: c.line, marginBottom: 9 }} />
        <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
          <Text style={[s.number, { paddingTop: 1 }]}>{pad(page.index + 1)}</Text>
          <View style={{ flex: 1, flexDirection: portrait ? "column" : "row", gap: portrait ? 2 : 18 }}>
            <Text style={[s.label, { maxLines: 1, textOverflow: "ellipsis", maxWidth: portrait ? "100%" : "40%" }]}>{item.title}</Text>
            {item.caption ? <Text style={[s.caption, { flex: 1, maxLines: 2, textOverflow: "ellipsis" }]}>{item.caption}</Text> : null}
          </View>
        </View>
      </View>
    </Frame>
  )
}

/* ── Сеты ракурсов ────────────────────────────────────────────────────── */

const FRAME_LABEL_H = 26

/** Сетка кадров: число колонок, при котором кадры выходят крупнее всего. */
function bestGrid(count: number, ratio: number, boxW: number, boxH: number): { cols: number; cellW: number; cellH: number; imageH: number } {
  let best = { cols: 1, cellW: boxW, cellH: boxH, imageH: boxH - FRAME_LABEL_H, area: 0 }
  for (let cols = 1; cols <= Math.min(6, count); cols += 1) {
    const rows = Math.ceil(count / cols)
    const cellW = (boxW - GAP * (cols - 1)) / cols
    const cellH = (boxH - GAP * (rows - 1)) / rows
    const imageH = cellH - FRAME_LABEL_H - 6
    if (cellW <= 0 || imageH <= 0) continue
    const fitted = fitInside({ width: ratio, height: 1 }, cellW, imageH)
    const area = fitted.width * fitted.height
    if (area > best.area) best = { cols, cellW, cellH, imageH, area }
  }
  return best
}

function FrameGrid({ frames, startIndex, ratio, boxW, boxH, layout }: { frames: AlbumViewSet["frames"]; startIndex: number; ratio: number; boxW: number; boxH: number; layout: Layout }) {
  const { s, images } = layout
  const grid = bestGrid(frames.length, ratio, boxW, boxH)
  // Ячейки — по ширине самих кадров (у сета один формат), сетка по центру:
  // иначе между узкими вертикальными кадрами оставались бы пустые поля.
  const sizes = frames.map((frame) => fitInside(images.get(frame.key) ?? { width: ratio, height: 1 }, grid.cellW, grid.imageH))
  const cellW = Math.max(...sizes.map((size) => size.width))
  const gridW = Math.min(boxW, cellW * grid.cols + GAP * (grid.cols - 1))
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: GAP, width: gridW, alignSelf: "center" }}>
      {frames.map((frame, index) => {
        const image = images.get(frame.key)
        const size = sizes[index]
        return (
          <View key={frame.key} style={{ width: cellW, height: grid.cellH }}>
            <Fitted image={image} boxW={cellW} boxH={grid.imageH} layout={layout} radius={3} />
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 6, width: size.width }}>
              <Text style={[s.number, { paddingTop: 0.5 }]}>{pad(startIndex + index + 1)}</Text>
              <Text style={[s.caption, { flex: 1, maxLines: 2, textOverflow: "ellipsis" }]}>{frame.caption || frame.label}</Text>
            </View>
          </View>
        )
      })}
    </View>
  )
}

function ViewsPage({ layout, page }: { layout: Layout; page: AlbumPlanPage }) {
  const { portrait, s, spec, images } = layout
  const set = spec.viewSets[page.index]
  const frames = set.frames.slice(page.from, page.to)
  // Пропорция кадров — из самих картинок (у сета один формат), формат сета — запасной.
  const sample = frames.map((frame) => images.get(frame.key)).find(Boolean)
  const ratio = sample ? sample.width / sample.height : (FRAME_RATIO[set.aspect] ?? 4 / 5)
  const { w, h } = contentBox(layout, TITLE_H)
  // Общий план — только на первой странице сета и только если он есть: у старых сетов исходник на сервер не попал.
  const source = !page.continuation && set.sourceKey ? images.get(set.sourceKey) : undefined
  const withSource = Boolean(source)
  const sourceW = portrait ? w : Math.round(w * 0.36)
  const sourceH = portrait ? Math.round(h * 0.38) : h
  const gridW = withSource && !portrait ? w - sourceW - CONTENT_GAP : w
  const gridH = withSource && portrait ? h - sourceH - CONTENT_GAP : h
  const total = spec.viewSets.length
  return (
    <Frame
      layout={layout}
      page={page}
      kicker={`${sectionKicker(layout, page)}${page.continuation ? " · продолжение" : ""}`}
      right={total > 1 ? `сет ${pad(page.index + 1)} / ${pad(total)}` : undefined}
    >
      <TitleBlock layout={layout} title={set.title} caption={page.continuation ? undefined : set.caption} />
      <View style={{ height: h, flexDirection: portrait ? "column" : "row", gap: CONTENT_GAP }}>
        {withSource ? (
          <View style={{ width: sourceW, height: sourceH, justifyContent: "center" }}>
            <Fitted image={source} boxW={sourceW} boxH={sourceH - FRAME_LABEL_H - 6} layout={layout} radius={3} />
            <Text style={[s.kicker, { marginTop: 7 }]}>общий план</Text>
          </View>
        ) : null}
        <View style={{ width: gridW, height: gridH, justifyContent: "center" }}>
          <FrameGrid frames={frames} startIndex={page.from} ratio={ratio} boxW={gridW} boxH={gridH} layout={layout} />
        </View>
      </View>
    </Frame>
  )
}

/* ── Материалы ────────────────────────────────────────────────────────── */

function MaterialsPage({ layout, page }: { layout: Layout; page: AlbumPlanPage }) {
  const { s, c, spec, images } = layout
  const items = spec.materials.slice(page.from, page.to)
  // Колонки выбрал план (materialColumns): под число тайлов, без ряда «4 + 1».
  const cols = page.columns
  const rows = MATERIAL_GRID[spec.format].rows
  const labelH = 30
  const { w, h } = contentBox(layout, TITLE_H)
  const cellW = (w - GAP * (cols - 1)) / cols
  const tile = Math.min(cellW, (h - GAP * (rows - 1)) / rows - labelH)
  const gridW = cols * tile + GAP * (cols - 1)
  return (
    <Frame layout={layout} page={page} kicker={`${sectionKicker(layout, page)}${page.continuation ? " · продолжение" : ""}`}>
      <TitleBlock layout={layout} title="Доска материалов" caption={page.continuation ? undefined : spec.materialsIntro} />
      <View style={{ width: gridW, alignSelf: "center", flexDirection: "row", flexWrap: "wrap", gap: GAP }}>
        {items.map((material, index) => (
          <View key={`${material.key}-${index}`} style={{ width: tile }}>
            <Covered image={images.get(material.key)} boxW={tile} boxH={tile} layout={layout} radius={6} />
            <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6, marginTop: 7, width: tile }}>
              <Text style={[s.number, { paddingTop: 1 }]}>{pad(page.from + index + 1)}</Text>
              <View style={{ flex: 1 }}>
                <Text style={[s.caption, { color: c.fg1, maxLines: 1, textOverflow: "ellipsis" }]}>{material.name || "Материал"}</Text>
                {material.category ? <Text style={[s.kicker, { marginTop: 2, letterSpacing: 1 }]}>{material.category}</Text> : null}
              </View>
            </View>
          </View>
        ))}
      </View>
    </Frame>
  )
}

/* ── Задняя страница ──────────────────────────────────────────────────── */

function BackPage({ layout }: { layout: Layout }) {
  const { margin, s, c, spec } = layout
  const swatches = spec.concept?.swatches ?? []
  const bar = swatches.length ? COLOR_BAR_H : 0
  return (
    <Sheet layout={layout}>
      <View style={{ position: "absolute", left: margin, top: margin }}>
        <Text style={s.kicker}>{spec.title}</Text>
      </View>
      <View style={{ position: "absolute", left: margin, right: margin, top: 0, bottom: bar, alignItems: "center", justifyContent: "center" }}>
        <Text style={[s.displayL, { textAlign: "center" }]}>{spec.studio.name || "Спасибо за внимание"}</Text>
        {spec.studio.contact ? <Text style={[s.body, { textAlign: "center", marginTop: 10 }]}>{spec.studio.contact}</Text> : null}
        <View style={{ width: 28, height: 1, backgroundColor: c.fg4, marginTop: 24 }} />
        {spec.date ? <Text style={[s.caption, { marginTop: 14 }]}>{spec.date}</Text> : null}
      </View>
      <View style={{ position: "absolute", left: margin, bottom: FOOTER_BOTTOM + bar }}>
        <Text style={s.kicker}>альбом собран в Dizzit AI</Text>
      </View>
      <ColorBar layout={layout} swatches={swatches} />
    </Sheet>
  )
}

/* ── Документ ─────────────────────────────────────────────────────────── */

export function AlbumDocument({ spec, images }: { spec: AlbumSpec; images: AlbumImages }) {
  const [width, height] = PAGE_SIZE[spec.format]
  const portrait = height > width
  const c = PALETTE[spec.theme]
  const plan = planAlbum(spec)
  const layout: Layout = { width, height, portrait, margin: portrait ? 40 : 44, c, s: makeStyles(c, portrait), plan, spec, images }
  return (
    <Document title={spec.title || "Альбом"} author={spec.studio.name || "Dizzit AI"} creator="Dizzit AI" producer="Dizzit AI" language="ru">
      {plan.pages.map((page) => {
        const key = `${page.kind}-${page.number}`
        switch (page.kind) {
          case "cover":
            return <CoverPage key={key} layout={layout} />
          case "contents":
            return <ContentsPage key={key} layout={layout} page={page} />
          case "concept":
            return <ConceptPage key={key} layout={layout} page={page} />
          case "overview":
            return <OverviewPage key={key} layout={layout} page={page} />
          case "views":
            return <ViewsPage key={key} layout={layout} page={page} />
          case "materials":
            return <MaterialsPage key={key} layout={layout} page={page} />
          case "back":
            return <BackPage key={key} layout={layout} />
        }
      })}
    </Document>
  )
}
