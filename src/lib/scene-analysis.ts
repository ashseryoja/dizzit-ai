"use client"

/**
 * Разбор сцены перед улучшением: исходник → `/api/scene` → текстовый
 * инвентарь предметов от vision-модели («телевизор — правая стена, в нише —
 * чёрный глянцевый экран, выключен; шторы — тюль и портьеры…»). Движок
 * улучшения вставляет его в промпт как авторитетное описание кадра, чтобы
 * gpt-image-2 понимал предметы, а не угадывал по пикселям.
 *
 * Разбор — усилитель, а не зависимость: любая ошибка или отсутствие ключа
 * даёт `null`, и улучшение идёт без инвентаря. Инвентарь одного рендера
 * сохраняется в записи (`Enhancement.sceneInventory`): «Повторить» и
 * повторная правка того же кадра не платят за разбор второй раз.
 */

import { prepareReference } from "@/lib/image-generation"
import type { EnhanceContext } from "@/types"

/** Длинная сторона копии для разбора: детали видны, а запрос лёгкий. */
export const SCENE_REFERENCE_MAX_SIDE = 1280
const STATUS_TTL_MS = 60_000
const REQUEST_TIMEOUT_MS = 110_000

/**
 * Инвентарь составлен уже с секцией MATERIALS (точные материалы поверхностей:
 * «travertine, NOT microcement»). Записи, разобранные до её появления, движок
 * разбирает заново — иначе «Повторить» унесёт в генератор инвентарь без
 * материалов, и пол снова может сменить травертин на микроцемент.
 */
export function hasMaterialsSection(inventory: string | undefined): boolean {
  return Boolean(inventory && /^MATERIALS:/im.test(inventory))
}

export interface SceneInventory {
  text: string
  provider: string
  model: string
}

export interface SceneAnalysisStatus {
  configured: boolean
  provider: string
  model: string
}

const UNCONFIGURED: SceneAnalysisStatus = { configured: false, provider: "", model: "" }
let statusCache: { value: SceneAnalysisStatus; at: number } | null = null
let statusInFlight: Promise<SceneAnalysisStatus> | null = null

/** Настроен ли разбор сцены. Кэш на минуту, как у статуса картинок. */
export function sceneAnalysisStatus(force = false): Promise<SceneAnalysisStatus> {
  if (!force && statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) return Promise.resolve(statusCache.value)
  if (statusInFlight) return statusInFlight
  statusInFlight = fetch("/api/scene", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`status ${response.status}`)
      const json = (await response.json()) as Partial<SceneAnalysisStatus>
      return { configured: Boolean(json.configured), provider: String(json.provider ?? ""), model: String(json.model ?? "") }
    })
    .catch(() => UNCONFIGURED)
    .then((value) => {
      statusCache = { value, at: Date.now() }
      statusInFlight = null
      return value
    })
  return statusInFlight
}

export interface DescribeSceneOptions {
  context?: EnhanceContext
  signal?: AbortSignal
}

/**
 * Инвентарь сцены для исходника или `null`, если разбор не настроен или не
 * удался. Никогда не бросает: улучшение не должно упасть из-за усилителя.
 */
export async function describeScene(source: Blob, options: DescribeSceneOptions = {}): Promise<SceneInventory | null> {
  const status = await sceneAnalysisStatus()
  if (!status.configured) return null

  try {
    const image = await prepareReference(source, SCENE_REFERENCE_MAX_SIDE)
    const form = new FormData()
    form.set("context", options.context ?? "auto")
    form.append("image", image, image.type === "image/png" ? "scene.png" : "scene.jpg")

    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    const response = await fetch("/api/scene", { method: "POST", body: form, signal })
    if (!response.ok) {
      let reason = `HTTP ${response.status}`
      try {
        const body = (await response.json()) as { error?: string; message?: string }
        reason = body.message ?? body.error ?? reason
        if (body.error === "provider_not_configured") statusCache = { value: UNCONFIGURED, at: Date.now() }
      } catch {
        // Тело не JSON — достаточно статуса.
      }
      console.warn(`[scene-analysis] разбор сцены пропущен: ${reason}`)
      return null
    }
    const json = (await response.json()) as { inventory?: unknown; provider?: unknown; model?: unknown }
    const text = typeof json.inventory === "string" ? json.inventory.trim() : ""
    if (!text) return null
    return { text, provider: String(json.provider ?? ""), model: String(json.model ?? "") }
  } catch (error) {
    if (options.signal?.aborted) return null
    console.warn(`[scene-analysis] разбор сцены пропущен: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}
