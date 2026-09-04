/**
 * Резервная копия локальных данных (страница «Настройки» → «Данные»).
 * Всё состояние приложения живёт в localStorage под этими префиксами:
 * `dizzit-` — текущие сторы, `smeta-` — ключи прежнего профиля сервиса
 * (название и контакты в `smeta-company` живы до сих пор). Префикс `skizzy-`
 * не нужен: ключи прежнего имени переносятся на `dizzit-` загрузочным
 * скриптом в app/layout.tsx до того, как сторы их прочитают.
 */
const APP_KEY_PREFIXES = ["dizzit-", "smeta-"] as const

/** Формат файла копии — чтобы при импорте отличить свой файл от чужого JSON. */
const BACKUP_MARKER = "dizzit-ai-backup"

interface BackupFile {
  app: typeof BACKUP_MARKER
  exportedAt: string
  data: Record<string, string>
}

function isAppKey(key: string): boolean {
  return APP_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))
}

function appKeys(): string[] {
  return Object.keys(localStorage).filter(isAppKey)
}

/** Сколько байт занимают данные приложения (строки UTF-16 → ×2). */
export function storageBytes(): number {
  return appKeys().reduce(
    (sum, key) => sum + (key.length + (localStorage.getItem(key)?.length ?? 0)) * 2,
    0
  )
}

/** Скачивает копию всех данных приложения одним JSON-файлом. */
export function downloadBackup() {
  const data: Record<string, string> = {}
  for (const key of appKeys()) {
    data[key] = localStorage.getItem(key) ?? ""
  }
  const backup: BackupFile = {
    app: BACKUP_MARKER,
    exportedAt: new Date().toISOString(),
    data,
  }

  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" })
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = `dizzit-backup-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * Восстанавливает данные из файла копии. Пишутся только ключи приложения —
 * посторонние записи из файла игнорируются. Возвращает число ключей;
 * бросает Error, если файл не похож на нашу копию.
 * После восстановления страницу нужно перезагрузить: zustand-persist читает
 * localStorage один раз на старте.
 */
export async function restoreBackup(file: File): Promise<number> {
  let parsed: unknown
  try {
    parsed = JSON.parse(await file.text())
  } catch {
    throw new Error("Файл не читается как JSON.")
  }

  const backup = parsed as Partial<BackupFile> | null
  if (!backup || backup.app !== BACKUP_MARKER || typeof backup.data !== "object" || !backup.data) {
    throw new Error("Это не файл копии Dizzit AI.")
  }

  const entries = Object.entries(backup.data).filter(
    ([key, value]) => isAppKey(key) && typeof value === "string"
  )
  if (entries.length === 0) {
    throw new Error("В файле нет данных приложения.")
  }

  // Сначала подчистить текущие ключи: иначе после восстановления старой копии
  // остались бы записи, которых в ней не было.
  for (const key of appKeys()) localStorage.removeItem(key)
  for (const [key, value] of entries) localStorage.setItem(key, value)
  return entries.length
}

/** Стирает все данные приложения. Вызывающий перезагружает страницу. */
export function clearAppData() {
  for (const key of appKeys()) localStorage.removeItem(key)
}
