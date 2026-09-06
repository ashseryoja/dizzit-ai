import "server-only"

import { APIMODELS_DEFAULT_BASE_URL, APIMODELS_DEFAULT_MODEL, APIMODELS_DEFAULT_RESOLUTION, ApiModelsProvider } from "@/server/apimodels"
import { isImageResolution, type ImageProvider, type ImageProviderId, type ImageResolution } from "@/server/image-provider"
import { LAOZHANG_DEFAULT_BASE_URL, LAOZHANG_DEFAULT_MODEL, LaoZhangProvider } from "@/server/laozhang"
import { OpenAiCompatibleVisionProvider, type VisionProvider } from "@/server/vision-provider"

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
 *
 * Разбор сцены (vision) выбирается теми же ключами: `VISION_PROVIDER`
 * (`apimodels` | `laozhang` | `off`), `VISION_MODEL`. Без переменных —
 * тот шлюз, у которого есть ключ (сначала API Models), с моделью по умолчанию
 * для этого шлюза: Claude Sonnet 5 у API Models, GPT-4.1 у LaoZhang.
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

function buildApiModels(resolutionOverride?: ImageResolution): ImageProvider | null {
  const apiKey = env("APIMODELS_API_KEY")
  if (!apiKey) return null
  return new ApiModelsProvider({
    apiKey,
    baseUrl: env("APIMODELS_API_BASE_URL") || APIMODELS_DEFAULT_BASE_URL,
    model: env("APIMODELS_IMAGE_MODEL") || APIMODELS_DEFAULT_MODEL,
    resolution: resolutionOverride ?? resolution(),
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

export function resolveImageProvider(preferred?: ImageProviderId, resolutionOverride?: ImageResolution): ImageProvider | null {
  const wanted = preferred ?? wantedProvider()
  if (wanted === "apimodels") return buildApiModels(resolutionOverride)
  if (wanted === "laozhang") return buildLaoZhang()
  return buildApiModels(resolutionOverride) ?? buildLaoZhang()
}

/** Что сообщить клиенту, когда ключа нет: какой провайдер и модель включатся с ключом. */
export function describeIntendedProvider(
  preferred?: ImageProviderId,
  resolutionOverride?: ImageResolution
): { provider: ImageProviderId; model: string; resolution: ImageResolution } {
  const wanted = preferred ?? wantedProvider() ?? "apimodels"
  if (wanted === "laozhang") {
    return { provider: "laozhang", model: env("LAOZHANG_IMAGE_MODEL") || LAOZHANG_DEFAULT_MODEL, resolution: "1K" }
  }
  return {
    provider: "apimodels",
    model: env("APIMODELS_IMAGE_MODEL") || APIMODELS_DEFAULT_MODEL,
    resolution: resolutionOverride ?? resolution(),
  }
}

/** Человеческое имя провайдера для текстов ошибок. */
export function providerLabel(id: ImageProviderId): string {
  return id === "apimodels" ? "API Models" : "LaoZhang"
}

/** Имя переменной с ключом — для подсказки «добавьте ключ». */
export function providerKeyVariable(id: ImageProviderId): string {
  return id === "apimodels" ? "APIMODELS_API_KEY" : "LAOZHANG_API_KEY"
}

/* ── Разбор сцены (vision) ──────────────────────────────────────────── */

/** Модель разбора сцены по умолчанию у каждого шлюза (см. пробы в README). */
export const VISION_DEFAULT_MODEL: Record<ImageProviderId, string> = {
  apimodels: "claude-sonnet-5",
  laozhang: "gpt-4.1",
}

/** Запасная модель на том же ключе: дешевле и быстрее, без внутреннего рассуждения. */
export const VISION_FALLBACK_MODEL: Partial<Record<ImageProviderId, string>> = {
  apimodels: "claude-haiku-4-5-20251001",
}

function wantedVisionProvider(): ImageProviderId | "off" | null {
  const value = env("VISION_PROVIDER").toLowerCase()
  if (value === "apimodels" || value === "laozhang" || value === "off") return value
  return null
}

function buildVision(id: ImageProviderId, model?: string): VisionProvider | null {
  const apiKey = env(providerKeyVariable(id))
  if (!apiKey) return null
  const baseUrl =
    id === "apimodels"
      ? env("APIMODELS_API_BASE_URL") || APIMODELS_DEFAULT_BASE_URL
      : env("LAOZHANG_API_BASE_URL") || LAOZHANG_DEFAULT_BASE_URL
  return new OpenAiCompatibleVisionProvider({ id, apiKey, baseUrl, model: model ?? (env("VISION_MODEL") || VISION_DEFAULT_MODEL[id]) })
}

/**
 * Цепочка vision-провайдеров для инвентаря сцены, по порядку попыток:
 * выбранный (`VISION_PROVIDER` / `VISION_MODEL` или первый шлюз с ключом),
 * затем запасные — Claude Haiku 4.5 на том же ключе API Models и модель по
 * умолчанию другого шлюза. Пусто — разбор выключен или ключей нет: улучшение
 * идёт без инвентаря, как раньше. Разбор — усилитель, не зависимость.
 */
export function resolveVisionProviders(): VisionProvider[] {
  const wanted = wantedVisionProvider()
  if (wanted === "off") return []
  const primary = wanted ? buildVision(wanted) : buildVision("apimodels") ?? buildVision("laozhang")
  if (!primary) return []

  const chain: VisionProvider[] = [primary]
  const seen = new Set([`${primary.id}:${primary.model}`])
  const push = (candidate: VisionProvider | null) => {
    if (!candidate || seen.has(`${candidate.id}:${candidate.model}`)) return
    seen.add(`${candidate.id}:${candidate.model}`)
    chain.push(candidate)
  }
  const fallbackModel = env(providerKeyVariable("apimodels")) ? VISION_FALLBACK_MODEL.apimodels : null
  if (fallbackModel) push(buildVision("apimodels", fallbackModel))
  push(buildVision(primary.id === "apimodels" ? "laozhang" : "apimodels", primary.id === "apimodels" ? VISION_DEFAULT_MODEL.laozhang : VISION_DEFAULT_MODEL.apimodels))
  return chain
}

/** Первый провайдер цепочки — для статуса; `null` — разбор выключен. */
export function resolveVisionProvider(): VisionProvider | null {
  return resolveVisionProviders()[0] ?? null
}
