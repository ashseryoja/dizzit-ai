import { NextResponse } from "next/server"

import { sessionFromRequest } from "@/server/auth"
import { authConfigured, serverConfig } from "@/server/config"
import { resolveStorage } from "@/server/storage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/**
 * Статус для клиента: настроен ли вход, есть ли сессия и можно ли хранить
 * данные на сервере (нужны все три: вход, база, хранилище объектов).
 * Секретов в ответе нет.
 */
export async function GET(request: Request) {
  const auth = authConfigured()
  const session = auth ? await sessionFromRequest(request) : null
  const database = Boolean(serverConfig.databaseUrl)
  const storage = resolveStorage()?.kind ?? null
  return NextResponse.json(
    {
      authConfigured: auth,
      signedIn: session !== null,
      database,
      storage,
      persistence: auth && session !== null && database && storage !== null,
    },
    { headers: { "Cache-Control": "no-store" } }
  )
}
