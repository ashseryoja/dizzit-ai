import "server-only"

import type { Sql } from "@/server/db"

/**
 * Записи галерей и проекты — таблица `records`: одна строка на запись любого
 * инструмента, тело записи целиком в `data` (jsonb). Клиентские сторы уже
 * держат записи как JSON, и сервер их не разбирает: он источник правды по
 * составу, а не по смыслу полей. Схема — db/migrations/0001_init.sql.
 */

export const COLLECTIONS = ["projects", "enhancements", "restyles", "views", "materials", "models", "albums"] as const
export type Collection = (typeof COLLECTIONS)[number]

export function isCollection(value: unknown): value is Collection {
  return typeof value === "string" && (COLLECTIONS as readonly string[]).includes(value)
}

export interface StoredRecord {
  id: string
  collection: Collection
  data: unknown
  createdAt: string
  updatedAt: string
}

interface RecordRow {
  id: string
  collection: string
  data: unknown
  created_at: Date
  updated_at: Date
}

export async function listRecords(sql: Sql, ownerId: string, collection: Collection): Promise<StoredRecord[]> {
  const rows = await sql<RecordRow[]>`
    select id, collection, data, created_at, updated_at
    from records
    where owner_id = ${ownerId} and collection = ${collection}
    order by created_at desc
  `
  return rows.map((row) => ({
    id: row.id,
    collection: row.collection as Collection,
    data: row.data,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }))
}

export async function upsertRecord(
  sql: Sql,
  ownerId: string,
  record: { id: string; collection: Collection; data: unknown; createdAt: string }
): Promise<void> {
  const createdAt = new Date(record.createdAt)
  const created = Number.isNaN(createdAt.getTime()) ? new Date() : createdAt
  await sql`
    insert into records (id, owner_id, collection, data, created_at, updated_at)
    values (${record.id}, ${ownerId}, ${record.collection}, ${sql.json(record.data as never)}, ${created}, now())
    on conflict (id) do update
      set data = excluded.data, collection = excluded.collection, updated_at = now()
      where records.owner_id = excluded.owner_id
  `
}

export async function deleteRecord(sql: Sql, ownerId: string, id: string): Promise<void> {
  await sql`delete from records where owner_id = ${ownerId} and id = ${id}`
}

/* ── Учёт объектов хранилища ─────────────────────────────────────────── */

export interface AssetMeta {
  key: string
  recordId: string
  contentType: string
  bytes: number
}

export async function upsertAssetMeta(sql: Sql, ownerId: string, asset: AssetMeta): Promise<void> {
  await sql`
    insert into assets (owner_id, key, record_id, content_type, bytes)
    values (${ownerId}, ${asset.key}, ${asset.recordId}, ${asset.contentType}, ${asset.bytes})
    on conflict (owner_id, key) do update
      set content_type = excluded.content_type, bytes = excluded.bytes, created_at = now()
  `
}

export async function deleteAssetMeta(sql: Sql, ownerId: string, keys: string[]): Promise<void> {
  if (keys.length === 0) return
  await sql`delete from assets where owner_id = ${ownerId} and key in ${sql(keys)}`
}

/** Какие из перечисленных ключей числятся в учёте — одним запросом (копии для PDF альбома). */
export async function listAssetKeysIn(sql: Sql, ownerId: string, keys: string[]): Promise<string[]> {
  if (keys.length === 0) return []
  const rows = await sql<{ key: string }[]>`select key from assets where owner_id = ${ownerId} and key in ${sql(keys)}`
  return rows.map((row) => row.key)
}

/** Ключи объектов записи — чтобы удалить их из хранилища вместе с записью. */
export async function listAssetKeys(sql: Sql, ownerId: string, recordId: string): Promise<string[]> {
  const rows = await sql<{ key: string }[]>`select key from assets where owner_id = ${ownerId} and record_id = ${recordId}`
  return rows.map((row) => row.key)
}
