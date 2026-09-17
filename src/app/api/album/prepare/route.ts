import { NextResponse } from "next/server"

import { ASSET_KEY_PATTERN, ownerContext, prepareAlbumAssets } from "@/server/album-images"
import { isSameOrigin, problem } from "@/server/http"

/**
 * Подготовка копий картинок для PDF (`src/server/album-images.ts`).
 *
 * POST `{ keys: string[], dryRun?: boolean }` → `{ ready, pending, missing }`.
 * Вызов отвечает не позже дедлайна; `pending` клиент присылает снова, пока
 * список не опустеет, и показывает прогресс. `dryRun` — только сверить, что
 * уже готово (клиент решает, какие копии сделать самому из своего кэша).
 * Без серверного хранения (пароль не задан) готовить нечего — все ключи
 * уходят в `missing`, картинки едут в самом запросе сборки.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

/** Новые картинки берутся до бюджета, ответ уходит не позже дедлайна — оба с запасом до `maxDuration`. */
const BUDGET_MS = 20_000
const DEADLINE_MS = 40_000
const MAX_KEYS = 200

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return problem(403, { error: "forbidden_origin", message: "Запрос с чужого сайта." })
  let body: { keys?: unknown; dryRun?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return problem(400, { error: "bad_request", message: "Ожидается JSON." })
  }
  const keys = Array.isArray(body.keys)
    ? [...new Set(body.keys.filter((key): key is string => typeof key === "string" && ASSET_KEY_PATTERN.test(key)))].slice(0, MAX_KEYS)
    : []
  const owner = await ownerContext(request)
  if (owner instanceof Response) return owner
  const startedAt = Date.now()
  const result = await prepareAlbumAssets(owner, keys, { budgetMs: BUDGET_MS, deadlineMs: DEADLINE_MS, dryRun: body.dryRun === true })
  console.info(`[api/album/prepare]${body.dryRun === true ? " сверка:" : ""} готово ${result.ready.length}, осталось ${result.pending.length}, нет ${result.missing.length}, ${Date.now() - startedAt} ms`)
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } })
}
