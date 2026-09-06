import "server-only"

import { APIMODELS_DEFAULT_BASE_URL, APIMODELS_DEFAULT_MODEL, APIMODELS_DEFAULT_RESOLUTION, ApiModelsProvider } from "@/server/apimodels"
import { isImageResolution, type ImageProvider, type ImageProviderId, type ImageResolution } from "@/server/image-provider"
import { LAOZHANG_DEFAULT_BASE_URL, LAOZHANG_DEFAULT_MODEL, LaoZhangProvider } from "@/server/laozhang"

/**
 * Выбор провайдера картинок по окружению — единственное место, где читаются
 * ключи (по образцу `container.ts` из docs/PLATFORM_ARCHITECTURE.md §7).
 *
 * - `IMAGE_PROVIDER=apimodels|laozhang` — явный выбор; без него берётся
 *   первый, у кого есть ключ: сначала API Models, потом LaoZhang.
 * - `APIMODELS_API_KEY`, `APIMODELS_API_BASE_URL`, `APIMODELS_IMAGE_MODEL`,
 *   `IMAGE_RESOLUTION` (1K / 2K / 4K, по умолчанию 2K).
 * - `LAOZHANG_API_KEY`, `LAOZHANG_API_BASE_URL`, `LAOZHANG_IMAGE_MODEL`.
 *
 * `null` — ключа нет: роут отвечает «провайдер не настроен», клиент считает
 * локальный предпросмотр.
 */

const env = (name: string) => (process.env[name] ?? "").trim()

function resolution(): ImageResolution {
  const value = env("IMAGE_RESOLUTION").toUpperCase()
  return isImageResolution(value) ? value : APIMODELS_DEFAULT_RESOLUTION
}

function wantedProvider(): ImageProviderId | null {
  const value = env("IMAGE_PROVIDER").toLowerCase()
  if (value === "apimodels" || value === "laozhang") return value
  return null
}

function buildApiModels(): ImageProvider | null {
  const apiKey = env("APIMODELS_API_KEY")
  if (!apiKey) return null
  return new ApiModelsProvider({
    apiKey,
    baseUrl: env("APIMODELS_API_BASE_URL") || APIMODELS_DEFAULT_BASE_URL,
    model: env("APIMODELS_IMAGE_MODEL") || APIMODELS_DEFAULT_MODEL,
    resolution: resolution(),
  })
}

function buildLaoZhang(): ImageProvider | null {
  const apiKey = env("LAOZHANG_API_KEY")
  if (!apiKey) return null
  return new LaoZhangProvider({
    apiKey,
    baseUrl: env("LAOZHANG_API_BASE_URL") || LAOZHANG_DEFAULT_BASE_URL,
    model: env("LAOZHANG_IMAGE_MODEL") || LAOZHANG_DEFAULT_MODEL,
  })
}

export function resolveImageProvider(): ImageProvider | null {
  const wanted = wantedProvider()
  if (wanted === "apimodels") return buildApiModels()
  if (wanted === "laozhang") return buildLaoZhang()
  return buildApiModels() ?? buildLaoZhang()
}

/** Что сообщить клиенту, когда ключа нет: какой провайдер и модель включатся с ключом. */
export function describeIntendedProvider(): { provider: ImageProviderId; model: string; resolution: ImageResolution } {
  const wanted = wantedProvider() ?? "apimodels"
  if (wanted === "laozhang") {
    return { provider: "laozhang", model: env("LAOZHANG_IMAGE_MODEL") || LAOZHANG_DEFAULT_MODEL, resolution: "1K" }
  }
  return { provider: "apimodels", model: env("APIMODELS_IMAGE_MODEL") || APIMODELS_DEFAULT_MODEL, resolution: resolution() }
}

/** Человеческое имя провайдера для текстов ошибок. */
export function providerLabel(id: ImageProviderId): string {
  return id === "apimodels" ? "API Models" : "LaoZhang"
}

/** Имя переменной с ключом — для подсказки «добавьте ключ». */
export function providerKeyVariable(id: ImageProviderId): string {
  return id === "apimodels" ? "APIMODELS_API_KEY" : "LAOZHANG_API_KEY"
}
