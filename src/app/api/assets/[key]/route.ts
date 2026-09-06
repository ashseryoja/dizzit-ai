import { NextResponse } from "next/server"

import { authNotConfigured, sessionFromRequest, unauthorized } from "@/server/auth"
import { authConfigured } from "@/server/config"
import { getSql } from "@/server/db"
import { sniffImageMime } from "@/server/image-provider"
import { deleteAssetMeta, upsertAssetMeta } from "@/server/records"
import { objectKey, resolveStorage } from "@/server/storage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Объекты записей: `${id}:${role}` — тот же ключ, что у блоба в IndexedDB
 * клиента, поэтому `getBlob(key)` при промахе кэша просто зовёт этот роут.
 * Лимит тела — ниже потолка Vercel в 4,5 МБ: клиент уменьшает крупное до
 * отправки (`src/lib/server-sync.ts`).
 */
const KEY_PATTERN = /^[A-Za-z0-9_-]{1,64}:[a-z0-9-]{1,48}$/
const MAX_ASSET_BYTES = 4 * 1024 * 1024

type Context = { params: Promise<{ key: string }> }

async function guard(request: Request) {
  if (!authConfigured()) return { error: authNotConfigured() }
  const session = await sessionFromRequest(request)
  if (!session) return { error: unauthorized() }
  const storage = resolveStorage()
  if (!storage) {
    return { error: NextResponse.json({ error: "no_storage", message: "Хранилище объектов не настроено (Vercel Blob)." }, { status: 503 }) }
  }
  return { session, storage }
}

function badKey(): NextResponse {
  return NextResponse.json({ error: "bad_request", message: "Недопустимый ключ объекта." }, { status: 400 })
}

export async function GET(request: Request, context: Context) {
  const g = await guard(request)
  if ("error" in g) return g.error
  const { key } = await context.params
  if (!KEY_PATTERN.test(key)) return badKey()
  const object = await g.storage.get(objectKey(g.session.ownerId, key))
  if (!object) return NextResponse.json({ error: "not_found", message: "Объекта нет на сервере." }, { status: 404 })
  return new Response(object.bytes as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": object.contentType,
      // Ключ неизменяем: тот же ключ — то же содержимое, кэшировать можно навсегда.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  })
}

export async function PUT(request: Request, context: Context) {
  const g = await guard(request)
  if ("error" in g) return g.error
  const { key } = await context.params
  if (!KEY_PATTERN.test(key)) return badKey()
  const declared = Number(request.headers.get("content-length") ?? 0)
  if (declared > MAX_ASSET_BYTES) {
    return NextResponse.json({ error: "too_large", message: "Объект больше 4 МБ." }, { status: 413 })
  }
  const bytes = new Uint8Array(await request.arrayBuffer())
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_ASSET_BYTES) {
    return NextResponse.json({ error: "too_large", message: "Объект пустой или больше 4 МБ." }, { status: 413 })
  }
  const contentType = sniffImageMime(bytes)
  if (!contentType) {
    return NextResponse.json({ error: "unsupported", message: "Хранятся только PNG, JPEG и WEBP." }, { status: 415 })
  }
  await g.storage.put(objectKey(g.session.ownerId, key), bytes, contentType)
  const sql = getSql()
  if (sql) await upsertAssetMeta(sql, g.session.ownerId, { key, recordId: key.split(":")[0], contentType, bytes: bytes.byteLength })
  return new NextResponse(null, { status: 204 })
}

export async function DELETE(request: Request, context: Context) {
  const g = await guard(request)
  if ("error" in g) return g.error
  const { key } = await context.params
  if (!KEY_PATTERN.test(key)) return badKey()
  await g.storage.delete([objectKey(g.session.ownerId, key)])
  const sql = getSql()
  if (sql) await deleteAssetMeta(sql, g.session.ownerId, [key])
  return new NextResponse(null, { status: 204 })
}
