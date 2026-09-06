import { NextResponse } from "next/server"

import { authNotConfigured, sessionFromRequest, unauthorized } from "@/server/auth"
import { authConfigured } from "@/server/config"
import { getSql } from "@/server/db"
import { isCollection, listRecords, upsertRecord } from "@/server/records"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_DATA_BYTES = 64 * 1024
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

function noDatabase(): NextResponse {
  return NextResponse.json({ error: "no_database", message: "Серверное хранение не настроено (DATABASE_URL)." }, { status: 503 })
}

/** GET ?collection=enhancements → все записи владельца в коллекции. */
export async function GET(request: Request) {
  if (!authConfigured()) return authNotConfigured()
  const session = await sessionFromRequest(request)
  if (!session) return unauthorized()
  const sql = getSql()
  if (!sql) return noDatabase()

  const collection = new URL(request.url).searchParams.get("collection")
  if (!isCollection(collection)) {
    return NextResponse.json({ error: "bad_request", message: "Неизвестная коллекция." }, { status: 400 })
  }
  const records = await listRecords(sql, session.ownerId, collection)
  return NextResponse.json({ records }, { headers: { "Cache-Control": "no-store" } })
}

/** PUT { collection, id, data, createdAt } → создать или обновить запись. */
export async function PUT(request: Request) {
  if (!authConfigured()) return authNotConfigured()
  const session = await sessionFromRequest(request)
  if (!session) return unauthorized()
  const sql = getSql()
  if (!sql) return noDatabase()

  let body: { collection?: unknown; id?: unknown; data?: unknown; createdAt?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Ожидается JSON." }, { status: 400 })
  }
  if (!isCollection(body.collection)) {
    return NextResponse.json({ error: "bad_request", message: "Неизвестная коллекция." }, { status: 400 })
  }
  if (typeof body.id !== "string" || !ID_PATTERN.test(body.id)) {
    return NextResponse.json({ error: "bad_request", message: "Недопустимый id." }, { status: 400 })
  }
  if (!body.data || typeof body.data !== "object" || JSON.stringify(body.data).length > MAX_DATA_BYTES) {
    return NextResponse.json({ error: "bad_request", message: "Тело записи пустое или слишком большое." }, { status: 400 })
  }
  await upsertRecord(sql, session.ownerId, {
    id: body.id,
    collection: body.collection,
    data: body.data,
    createdAt: typeof body.createdAt === "string" ? body.createdAt : new Date().toISOString(),
  })
  return new NextResponse(null, { status: 204 })
}
