#!/usr/bin/env node
/**
 * Миграции Postgres: применяет файлы db/migrations/*.sql по порядку имён,
 * отмечая применённые в таблице schema_migrations. Запуск: `npm run db:migrate`
 * (DATABASE_URL берётся из окружения или из .env.local).
 */
import { readdirSync, readFileSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import postgres from "postgres"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL.trim()
  const envFile = join(ROOT, ".env.local")
  if (!existsSync(envFile)) return ""
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const match = /^\s*DATABASE_URL\s*=\s*(.+?)\s*$/.exec(line)
    if (match) return match[1].replace(/^["']|["']$/g, "")
  }
  return ""
}

const url = databaseUrl()
if (!url) {
  console.error("DATABASE_URL не задан ни в окружении, ни в .env.local")
  process.exit(1)
}

const sql = postgres(url, { ssl: "require", max: 1, prepare: false })
try {
  await sql`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`
  const applied = new Set((await sql`select name from schema_migrations`).map((row) => row.name))
  const dir = join(ROOT, "db/migrations")
  const files = readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()
  let count = 0
  for (const name of files) {
    if (applied.has(name)) continue
    const body = readFileSync(join(dir, name), "utf8")
    await sql.begin(async (tx) => {
      await tx.unsafe(body)
      await tx`insert into schema_migrations (name) values (${name})`
    })
    console.log(`applied ${name}`)
    count += 1
  }
  console.log(count === 0 ? "миграций нет — схема актуальна" : `применено миграций: ${count}`)
} finally {
  await sql.end()
}
