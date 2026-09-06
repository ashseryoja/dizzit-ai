import "server-only"

/**
 * Окружение сервера в одном месте (по образцу `ServerConfig` из
 * docs/PLATFORM_ARCHITECTURE.md §6.1): `process.env` читается здесь и в
 * `providers.ts`, остальной серверный код получает значения отсюда.
 *
 * Значения секретов наружу не отдаются: только «настроено / не настроено».
 */

const env = (name: string) => (process.env[name] ?? "").trim()

export const serverConfig = {
  /** Neon/Postgres. Пусто — серверного хранения нет, приложение живёт в браузере. */
  get databaseUrl(): string {
    return env("DATABASE_URL")
  },
  /** Секрет подписи сессии; генерируется один раз (`openssl rand -base64 32`). */
  get authSecret(): string {
    return env("AUTH_SECRET")
  },
  /** Пароль входа в рабочее пространство. */
  get accessPassword(): string {
    return env("APP_ACCESS_PASSWORD")
  },
  /** Приватное Vercel Blob: OIDC в проде или read-write токен локально. */
  get blobConfigured(): boolean {
    return Boolean(env("BLOB_STORE_ID") || env("BLOB_READ_WRITE_TOKEN"))
  },
  /**
   * Каталог для картинок на диске — замена Blob в локальной разработке.
   * В проде (Vercel) диска нет: без Blob хранение картинок выключено.
   */
  get localAssetsDir(): string {
    const explicit = env("ASSETS_DIR")
    if (explicit) return explicit
    return process.env.NODE_ENV === "production" ? "" : ".data/assets"
  },
}

/** Вход настроен: есть и секрет, и пароль. Без этого сервер данных не хранит. */
export function authConfigured(): boolean {
  return Boolean(serverConfig.authSecret && serverConfig.accessPassword)
}
