import "server-only"

import { access } from "node:fs/promises"
import { join } from "node:path"

import { Font, renderToStream } from "@react-pdf/renderer"
import sharp from "sharp"

import { AlbumDocument, FONT_BODY, FONT_DISPLAY, type AlbumImage, type AlbumImages } from "@/server/album-document"
import { encodePdfCopy, PDF_IMAGE_MAX_SIDE, type ImageResolver } from "@/server/album-images"
import { sniffImageMime } from "@/server/image-provider"
import { albumImageKeys, type AlbumSpec } from "@/shared/album"

/**
 * Сборка PDF альбома: шрифты проекта, подготовка картинок и рендер
 * документа (`album-document.tsx`) в поток. Откуда брать байты картинок,
 * решает роут (`app/api/album/route.ts`): хранилище владельца или файлы из
 * запроса — сюда приходит функция-резолвер по ключу.
 */

const CONCURRENCY = 4

interface FontFile {
  family: string
  file: string
  /** Начертание в семействе; без веса — единственное. */
  weight?: number
}

/**
 * Unbounded — статические начертания, вырезанные из вариативного шрифта
 * (fontTools instancer): react-pdf вариативные оси не применяет и рисовал бы
 * всё одним Regular. Light — большие заголовки, Medium — подписи и номера.
 */
const FONT_FILES: FontFile[] = [
  { family: FONT_DISPLAY, file: "public/fonts/unbounded/Unbounded-Light.ttf", weight: 300 },
  { family: FONT_DISPLAY, file: "public/fonts/unbounded/Unbounded-Medium.ttf", weight: 500 },
  { family: FONT_BODY, file: "public/fonts/garet-book/Garet-Book-v2.woff2" },
]

let fontsReady: Promise<void> | null = null

/**
 * Регистрация шрифтов — раз на процесс. Файлы читаются с диска
 * (`public/fonts`, на Vercel их включает `outputFileTracingIncludes`); если
 * файла в функции нет, шрифт берётся по URL с того же сайта — те же файлы
 * отдаёт статика, так что альбом не зависит от трассировки сборки.
 */
export function ensureAlbumFonts(origin?: string): Promise<void> {
  if (!fontsReady) {
    fontsReady = (async () => {
      for (const { family, file, weight } of FONT_FILES) {
        const src = join(process.cwd(), file)
        const onDisk = await access(src).then(() => true, () => false)
        let source = src
        if (!onDisk) {
          if (!origin) throw new Error(`Шрифт ${file} не найден`)
          console.warn(`[album] шрифт ${file} не найден на диске, берём с ${origin}`)
          source = `${origin}/${file.replace(/^public\//, "")}`
        }
        Font.register(weight ? { family, src: source, fontWeight: weight } : { family, src: source })
      }
      // Переносы по словарю react-pdf английские: русские слова резались бы
      // посреди слога. Без переносов строки просто переносятся по словам.
      Font.registerHyphenationCallback((word) => [word])
    })().catch((error) => {
      fontsReady = null
      throw error
    })
  }
  return fontsReady
}

/**
 * Картинка для документа: готовая копия (JPEG или PNG — браузер мог отдать
 * любой) кладётся как есть, всё остальное — через `encodePdfCopy`.
 */
export async function prepareAlbumImage(bytes: Uint8Array, prepared: boolean): Promise<AlbumImage> {
  const mime = prepared ? sniffImageMime(bytes) : null
  const asIs = mime === "image/jpeg" || mime === "image/png"
  const data = asIs ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength) : await encodePdfCopy(bytes, PDF_IMAGE_MAX_SIDE)
  const meta = await sharp(data).metadata()
  return { data, format: mime === "image/png" ? "png" : "jpg", width: meta.width ?? 1, height: meta.height ?? 1 }
}

export interface LoadedImages {
  images: AlbumImages
  /** Ключи, по которым картинки не нашлось: в PDF на их месте заглушка. */
  missing: string[]
}

/** Все картинки спецификации: параллельно по несколько, промахи — в список. */
export async function loadAlbumImages(spec: AlbumSpec, resolve: ImageResolver): Promise<LoadedImages> {
  const keys = albumImageKeys(spec)
  const images = new Map<string, AlbumImage>()
  const missing: string[] = []
  let cursor = 0
  const worker = async () => {
    while (cursor < keys.length) {
      const key = keys[cursor]
      cursor += 1
      try {
        const resolved = await resolve(key)
        if (!resolved) {
          missing.push(key)
          continue
        }
        images.set(key, await prepareAlbumImage(resolved.bytes, resolved.prepared))
      } catch (error) {
        console.warn(`[album] картинка ${key} не подготовлена: ${error instanceof Error ? error.message : String(error)}`)
        missing.push(key)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, keys.length) }, worker))
  return { images, missing }
}

/** PDF альбома потоком — ответ роута отдаётся по мере рендера, без лимита на размер тела. */
export async function renderAlbumPdf(spec: AlbumSpec, images: AlbumImages, origin?: string): Promise<NodeJS.ReadableStream> {
  await ensureAlbumFonts(origin)
  return renderToStream(AlbumDocument({ spec, images }))
}
