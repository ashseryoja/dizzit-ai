import "server-only"

/**
 * Окружение сервера в одном месте (по образцу `ServerConfig` из
 * docs/PLATFORM_ARCHITECTURE.md §6.1): `process.env` читается здесь и в
 * `providers.ts`, остальной серверный код получает значения отсюда.
 *
 * Значения секретов наружу не отдаются: только «настроено / не настроено».
 */

const env = (name: string) => (process.env[name] ?? "").trim()

export interface R2Config {
  accountId: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
}

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
  /** Cloudflare R2 — объектное хранилище картинок. */
  get r2(): R2Config | null {
    const accountId = env("R2_ACCOUNT_ID")
    const accessKeyId = env("R2_ACCESS_KEY_ID")
    const secretAccessKey = env("R2_SECRET_ACCESS_KEY")
    const bucket = env("R2_BUCKET")
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null
    return { accountId, accessKeyId, secretAccessKey, bucket }
  },
  /**
   * Каталог для картинок на диске — замена R2 в локальной разработке.
   * В проде (Vercel) диска нет: без R2 хранение картинок выключено.
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
