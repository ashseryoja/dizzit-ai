import { NextResponse } from "next/server"

import { authNotConfigured, sessionFromRequest, unauthorized } from "@/server/auth"
import { authConfigured } from "@/server/config"
import { getSql } from "@/server/db"
import { deleteAssetMeta, deleteRecord, listAssetKeys } from "@/server/records"
import { objectKey, resolveStorage } from "@/server/storage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Удалить запись и все её объекты в хранилище. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!authConfigured()) return authNotConfigured()
  const session = await sessionFromRequest(request)
  if (!session) return unauthorized()
  const sql = getSql()
  if (!sql) return NextResponse.json({ error: "no_database", message: "Серверное хранение не настроено." }, { status: 503 })

  const { id } = await context.params
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    return NextResponse.json({ error: "bad_request", message: "Недопустимый id." }, { status: 400 })
  }
  const keys = await listAssetKeys(sql, session.ownerId, id)
  const storage = resolveStorage()
  if (storage && keys.length > 0) await storage.delete(keys.map((key) => objectKey(session.ownerId, key)))
  await deleteAssetMeta(sql, session.ownerId, keys)
  await deleteRecord(sql, session.ownerId, id)
  return new NextResponse(null, { status: 204 })
}
