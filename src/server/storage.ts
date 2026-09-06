import "server-only"

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

import { del, get, put } from "@vercel/blob"

import { serverConfig } from "@/server/config"

/**
 * Хранилище картинок за портом `ObjectStorage` (docs/PLATFORM_ARCHITECTURE.md
 * §3.4). Две реализации: приватное Vercel Blob (прод) и
 * каталог на диске (локальная разработка). Ключ объекта — `${owner}/${key}`,
 * где `key` тот же, что у блоба в IndexedDB клиента (`${id}:${role}`).
 */

export interface StoredObject {
  bytes: Uint8Array
  contentType: string
}

export interface ObjectStorage {
  readonly kind: "vercel-blob" | "disk"
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>
  get(key: string): Promise<StoredObject | null>
  delete(keys: string[]): Promise<void>
}

class VercelBlobStorage implements ObjectStorage {
  readonly kind = "vercel-blob" as const

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await put(key, Buffer.from(bytes), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType,
      cacheControlMaxAge: 31536000,
    })
  }

  async get(key: string): Promise<StoredObject | null> {
    const result = await get(key, { access: "private" })
    if (!result || result.statusCode !== 200) return null
    const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer())
    return { bytes, contentType: result.blob.contentType ?? "application/octet-stream" }
  }

  async delete(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 100) {
      await del(keys.slice(i, i + 100))
    }
  }
}

/** Диск: `<dir>/<encodeURIComponent(key)>` + рядом `.json` с типом содержимого. */
class DiskStorage implements ObjectStorage {
  readonly kind = "disk" as const
  private readonly dir: string

  constructor(dir: string) {
    this.dir = resolve(process.cwd(), dir)
  }

  private paths(key: string): { data: string; meta: string } {
    const name = encodeURIComponent(key)
    return { data: join(this.dir, name), meta: join(this.dir, `${name}.json`) }
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await mkdir(this.dir, { recursive: true })
    const { data, meta } = this.paths(key)
    await writeFile(data, bytes)
    await writeFile(meta, JSON.stringify({ contentType }))
  }

  async get(key: string): Promise<StoredObject | null> {
    const { data, meta } = this.paths(key)
    try {
      const bytes = new Uint8Array(await readFile(data))
      let contentType = "application/octet-stream"
      try {
        contentType = (JSON.parse(await readFile(meta, "utf8")) as { contentType?: string }).contentType ?? contentType
      } catch {
        // Без сайдкара отдаём как есть — клиент определит по сигнатуре.
      }
      return { bytes, contentType }
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return null
      throw error
    }
  }

  async delete(keys: string[]): Promise<void> {
    for (const key of keys) {
      const { data, meta } = this.paths(key)
      for (const path of [data, meta]) {
        try {
          await unlink(path)
        } catch (error) {
          if ((error as { code?: string }).code !== "ENOENT") throw error
        }
      }
    }
  }
}

const globalRef = globalThis as typeof globalThis & { __dizzitStorage?: ObjectStorage | null }

/** Vercel Blob, если настроен; иначе диск в разработке; в проде без Blob — ничего. */
export function resolveStorage(): ObjectStorage | null {
  if (globalRef.__dizzitStorage !== undefined) return globalRef.__dizzitStorage
  const storage: ObjectStorage | null = serverConfig.blobConfigured
    ? new VercelBlobStorage()
    : serverConfig.localAssetsDir
      ? new DiskStorage(serverConfig.localAssetsDir)
      : null
  globalRef.__dizzitStorage = storage
  return storage
}

export function objectKey(ownerId: string, key: string): string {
  return `${ownerId}/${key}`
}
