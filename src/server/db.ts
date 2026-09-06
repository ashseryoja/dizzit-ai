import "server-only"

import postgres from "postgres"

import { serverConfig } from "@/server/config"

/**
 * Один клиент Postgres на процесс. Кэш на `globalThis` — иначе каждый
 * hot-reload в разработке открывал бы новый пул (docs/PLATFORM_ARCHITECTURE.md §7).
 * Neon подключается через пулер (pgbouncer), поэтому `prepare: false`.
 */
export type Sql = ReturnType<typeof postgres>

const globalRef = globalThis as typeof globalThis & { __dizzitSql?: Sql; __dizzitSqlUrl?: string }

export function getSql(): Sql | null {
  const url = serverConfig.databaseUrl
  if (!url) return null
  if (!globalRef.__dizzitSql || globalRef.__dizzitSqlUrl !== url) {
    globalRef.__dizzitSql = postgres(url, {
      ssl: "require",
      max: 1,
      idle_timeout: 20,
      connect_timeout: 15,
      prepare: false,
    })
    globalRef.__dizzitSqlUrl = url
  }
  return globalRef.__dizzitSql
}
