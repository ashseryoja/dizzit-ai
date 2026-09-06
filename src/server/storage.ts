import "server-only"

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"

import { DeleteObjectsCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"

import { serverConfig } from "@/server/config"

/**
 * Хранилище картинок за портом `ObjectStorage` (docs/PLATFORM_ARCHITECTURE.md
 * §3.4). Две реализации: Cloudflare R2 через S3-совместимый API (прод) и
 * каталог на диске (локальная разработка). Ключ объекта — `${owner}/${key}`,
 * где `key` тот же, что у блоба в IndexedDB клиента (`${id}:${role}`).
 */

export interface StoredObject {
  bytes: Uint8Array
  contentType: string
}

export interface ObjectStorage {
  readonly kind: "r2" | "disk"
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>
  get(key: string): Promise<StoredObject | null>
  delete(keys: string[]): Promise<void>
}

class R2Storage implements ObjectStorage {
  readonly kind = "r2" as const
  private readonly client: S3Client
  private readonly bucket: string

  constructor(config: NonNullable<typeof serverConfig.r2>) {
    this.bucket = config.bucket
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
      forcePathStyle: true,
    })
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType }))
  }

  async get(key: string): Promise<StoredObject | null> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }))
      if (!result.Body) return null
      return { bytes: await result.Body.transformToByteArray(), contentType: result.ContentType ?? "application/octet-stream" }
    } catch (error) {
      const name = (error as { name?: string }).name
      if (name === "NoSuchKey" || name === "NotFound") return null
      throw error
    }
  }

  async delete(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000)
      await this.client.send(
        new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true } })
      )
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

/** R2, если настроен; иначе диск в разработке; в проде без R2 — ничего. */
export function resolveStorage(): ObjectStorage | null {
  if (globalRef.__dizzitStorage !== undefined) return globalRef.__dizzitStorage
  const r2 = serverConfig.r2
  const storage: ObjectStorage | null = r2
    ? new R2Storage(r2)
    : serverConfig.localAssetsDir
      ? new DiskStorage(serverConfig.localAssetsDir)
      : null
  globalRef.__dizzitStorage = storage
  return storage
}

export function objectKey(ownerId: string, key: string): string {
  return `${ownerId}/${key}`
}
