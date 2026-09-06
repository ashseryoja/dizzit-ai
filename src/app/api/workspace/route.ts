import { NextResponse } from "next/server"

import { authNotConfigured, sessionFromRequest, unauthorized } from "@/server/auth"
import { authConfigured } from "@/server/config"
import { getSql } from "@/server/db"
import { objectKey, resolveStorage } from "@/server/storage"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PROJECT_ID = /^[A-Za-z0-9_-]{1,64}$/

function noDatabase(): NextResponse {
  return NextResponse.json({ error: "no_database", message: "Серверное хранение не настроено." }, { status: 503 })
}

async function guard(request: Request) {
  if (!authConfigured()) return { error: authNotConfigured() }
  const session = await sessionFromRequest(request)
  if (!session) return { error: unauthorized() }
  const sql = getSql()
  if (!sql) return { error: noDatabase() }
  return { session, sql }
}

type PreferenceRow = { active_project_id: string | null }
type CandidateRow = { id: string; asset_keys: string[] | null }

/**
 * Общий для всех браузеров активный проект. Старые рабочие пространства ещё
 * не имеют указателя, поэтому fallback выбирает проект с реально сохранёнными
 * файлами, затем — с наибольшим числом работ и самой свежей активностью.
 */
export async function GET(request: Request) {
  const g = await guard(request)
  if ("error" in g) return g.error
  const preferenceId = `_workspace_${g.session.ownerId}`
  const preference = await g.sql<PreferenceRow[]>`
    select data->>'activeProjectId' as active_project_id
    from records
    where id = ${preferenceId} and owner_id = ${g.session.ownerId} and collection = 'workspace'
    limit 1
  `

  const preferred = preference[0]?.active_project_id ?? null
  if (preferred) {
    const exists = await g.sql<{ id: string }[]>`
      select id from records
      where id = ${preferred} and owner_id = ${g.session.ownerId} and collection = 'projects'
      limit 1
    `
    if (exists.length > 0) {
      return NextResponse.json({ activeProjectId: preferred }, { headers: { "Cache-Control": "no-store" } })
    }
  }

  const candidates = await g.sql<CandidateRow[]>`
    select p.id,
      coalesce(
        array_agg(asset.key order by asset.created_at desc) filter (where asset.key is not null),
        array[]::text[]
      ) as asset_keys
    from records p
    left join records work
      on work.owner_id = p.owner_id
      and work.collection in ('enhancements', 'restyles', 'views', 'materials', 'models')
      and work.data->>'projectId' = p.id
    left join assets asset
      on asset.owner_id = p.owner_id and asset.record_id = work.id
    where p.owner_id = ${g.session.ownerId} and p.collection = 'projects'
    group by p.id, p.created_at
    order by
      max(work.updated_at) desc nulls last,
      count(distinct work.id) desc,
      p.created_at desc
    limit 20
  `

  // Строка в `assets` — только индекс. После старых тестов или оборванного
  // переноса она может пережить сам объект. Проверяем реальное хранилище,
  // иначе новый браузер снова выберет проект с пустыми серыми карточками.
  const storage = resolveStorage()
  if (storage) {
    // Не больше 12×4 коротких HEAD-проверок, параллельно и с общим для каждой
    // ограничением: даже тысячи старых индексных строк не подвешивают UI.
    const checkedCandidates = candidates.slice(0, 12)
    const available = await Promise.all(
      checkedCandidates.map(async (candidate) => {
        const checks = await Promise.all(
          (candidate.asset_keys ?? []).slice(0, 4).map(async (key) => {
            let timeout: ReturnType<typeof setTimeout> | undefined
            const deadline = new Promise<boolean>((resolve) => {
              timeout = setTimeout(() => resolve(false), 2_500)
            })
            try {
              return await Promise.race([
                storage.has(objectKey(g.session.ownerId, key)).catch(() => false),
                deadline,
              ])
            } finally {
              if (timeout) clearTimeout(timeout)
            }
          })
        )
        return checks.some(Boolean)
      })
    )
    const firstAvailable = checkedCandidates.find((_, index) => available[index])
    if (firstAvailable) {
      return NextResponse.json(
        { activeProjectId: firstAvailable.id },
        { headers: { "Cache-Control": "no-store" } }
      )
    }
  }
  return NextResponse.json(
    { activeProjectId: candidates[0]?.id ?? null },
    { headers: { "Cache-Control": "no-store" } }
  )
}

/** Сохраняется только явный выбор пользователя, не промежуточная гидрация. */
export async function PUT(request: Request) {
  const g = await guard(request)
  if ("error" in g) return g.error
  let body: { activeProjectId?: unknown }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Ожидается JSON." }, { status: 400 })
  }
  if (
    body.activeProjectId !== null &&
    (typeof body.activeProjectId !== "string" || !PROJECT_ID.test(body.activeProjectId))
  ) {
    return NextResponse.json({ error: "bad_request", message: "Недопустимый id проекта." }, { status: 400 })
  }

  const preferenceId = `_workspace_${g.session.ownerId}`
  const data = { activeProjectId: body.activeProjectId }
  await g.sql`
    insert into records (id, owner_id, collection, data, created_at, updated_at)
    values (${preferenceId}, ${g.session.ownerId}, 'workspace', ${g.sql.json(data)}, now(), now())
    on conflict (id) do update
      set data = excluded.data, updated_at = now()
      where records.owner_id = excluded.owner_id
  `
  return new NextResponse(null, { status: 204 })
}
