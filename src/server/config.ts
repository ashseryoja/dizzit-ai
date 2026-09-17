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
  /** Ключ Meshy («Фото → 3D»). Пусто — страница строит каркас-заглушку. */
  get meshyApiKey(): string {
    return env("MESHY_API_KEY")
  },
  /** База API Meshy; переопределяется только для фальшивого провайдера в тестах. */
  get meshyBaseUrl(): string {
    return (env("MESHY_API_BASE_URL") || "https://api.meshy.ai/openapi/v1").replace(/\/+$/, "")
  },
  /** Модель Meshy: `latest` (по умолчанию), `meshy-7`, `meshy-6`, `meshy-6-lite`. */
  get meshyModel(): string {
    return env("MESHY_AI_MODEL") || "latest"
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
