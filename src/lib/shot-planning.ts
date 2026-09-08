"use client"

/**
 * Планировщик раскадровки на клиенте: исходник → `/api/shots` → список кадров
 * под этот рендер от vision-модели (что снять крупно, откуда взять ракурс,
 * какую фактуру показать). Движок ракурсов подставляет `brief` каждого кадра
 * в промпт gpt-image-2.
 *
 * Планировщик — усилитель, а не зависимость: отсутствие ключа или любая
 * ошибка дают `null`, и сет строится по типовым кадрам набора. Список
 * сохраняется в записи (`ViewSet.frames`, `planned`), поэтому «Повторить»
 * второй раз за план не платит.
 */

import { prepareReference } from "@/lib/image-generation"
import { SCENE_REFERENCE_MAX_SIDE } from "@/lib/scene-analysis"
import type { FrameAspect, ViewFrame, ViewPreset } from "@/types"

const STATUS_TTL_MS = 60_000
const REQUEST_TIMEOUT_MS = 85_000

export interface ShotPlan {
  frames: ViewFrame[]
  provider: string
  model: string
}

interface PlannerStatus {
  configured: boolean
  provider: string
  model: string
}

const UNCONFIGURED: PlannerStatus = { configured: false, provider: "", model: "" }
let statusCache: { value: PlannerStatus; at: number } | null = null
let statusInFlight: Promise<PlannerStatus> | null = null

/** Настроен ли планировщик. Кэш на минуту, как у статуса картинок. */
export function shotPlannerStatus(force = false): Promise<PlannerStatus> {
  if (!force && statusCache && Date.now() - statusCache.at < STATUS_TTL_MS) return Promise.resolve(statusCache.value)
  if (statusInFlight) return statusInFlight
  statusInFlight = fetch("/api/shots", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error(`status ${response.status}`)
      const json = (await response.json()) as Partial<PlannerStatus>
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

/**
 * Список кадров для исходника или `null`, если планировщик не настроен или
 * не ответил. Никогда не бросает: сет не должен упасть из-за усилителя.
 */
export async function planViewFrames(
  source: Blob,
  options: { preset: ViewPreset; aspect: FrameAspect; note: string; inventory?: string; signal?: AbortSignal }
): Promise<ShotPlan | null> {
  const status = await shotPlannerStatus()
  if (!status.configured) return null

  try {
    const image = await prepareReference(source, SCENE_REFERENCE_MAX_SIDE)
    const form = new FormData()
    form.set("preset", options.preset)
    form.set("aspect", options.aspect)
    form.set("note", options.note)
    if (options.inventory?.trim()) form.set("inventory", options.inventory.trim())
    form.append("image", image, image.type === "image/png" ? "scene.png" : "scene.jpg")

    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    const response = await fetch("/api/shots", { method: "POST", body: form, signal })
    if (!response.ok) {
      let reason = `HTTP ${response.status}`
      try {
        const body = (await response.json()) as { error?: string; message?: string }
        reason = body.message ?? body.error ?? reason
        if (body.error === "provider_not_configured") statusCache = { value: UNCONFIGURED, at: Date.now() }
      } catch {
        // Тело не JSON — достаточно статуса.
      }
      console.warn(`[shot-planning] планировщик пропущен: ${reason}`)
      return null
    }
    const json = (await response.json()) as { frames?: unknown; provider?: unknown; model?: unknown }
    const frames = Array.isArray(json.frames)
      ? (json.frames as ViewFrame[]).filter((frame) => frame && typeof frame.key === "string" && typeof frame.kind === "string")
      : []
    if (frames.length === 0) return null
    return { frames, provider: String(json.provider ?? ""), model: String(json.model ?? "") }
  } catch (error) {
    if (options.signal?.aborted) return null
    console.warn(`[shot-planning] планировщик пропущен: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }
}
