import "server-only"

import { resolveVisionProviders } from "@/server/providers"

/**
 * Подсказка для разбиения модели на детали: vision-модель по фото предмета
 * называет его составные части (для `by_parts` у Meshy Auto Split), оценивает
 * реальную ширину (масштаб собранных файлов) и даёт короткое имя латиницей
 * (корневая группа и префикс объектов в FBX). Провайдер — та же цепочка, что
 * у разбора сцены (`resolveVisionProviders`). Без провайдера или при отказе
 * разбиение идёт автоматически, ширина — по умолчанию.
 */

export interface FurnitureParts {
  parts: string[]
  widthCm: number | null
  name: string
}

const DEADLINE_MS = 45_000
const PROMPT = `You see a photo of a single furniture or decor item. Answer with JSON only, no prose:
{"name": "<2-3 word English name in PascalCase, e.g. Armchair, DiningTable, FloorLamp>",
 "width_cm": <estimated real-world width of the item in centimetres as an integer>,
 "parts": ["<part>", ...]}
"parts": 2 to 8 structural parts a 3D model should be split into so that each part can get its own material, named in short English (e.g. "seat cushions", "back cushions", "leather frame with armrests", "metal legs", "table top", "wooden base"). Group parts that share one material. Do not list decorations that are only painted on.`

/** Имя группы: латиница и цифры, начинается с буквы, до 24 символов. */
export function sanitizeRootName(value: string, fallback = "Model"): string {
  const cleaned = value.replace(/[^A-Za-z0-9]/g, "").slice(0, 24)
  return /^[A-Za-z]/.test(cleaned) ? cleaned : fallback
}

function parseAnswer(text: string): FurnitureParts | null {
  const json = /\{[\s\S]*\}/.exec(text)?.[0]
  if (!json) return null
  try {
    const parsed = JSON.parse(json) as { name?: unknown; width_cm?: unknown; parts?: unknown }
    const parts = Array.isArray(parsed.parts)
      ? parsed.parts.map((part) => String(part).trim().replace(/\s+/g, " ")).filter((part) => part.length > 1 && part.length <= 60).slice(0, 10)
      : []
    const width = Number(parsed.width_cm)
    return {
      parts,
      widthCm: Number.isFinite(width) && width >= 5 && width <= 1000 ? Math.round(width) : null,
      name: sanitizeRootName(String(parsed.name ?? "")),
    }
  } catch {
    return null
  }
}

export async function describeFurnitureParts(photo: { bytes: Uint8Array; mimeType: string }, signal?: AbortSignal): Promise<FurnitureParts | null> {
  const providers = resolveVisionProviders()
  const startedAt = Date.now()
  for (const provider of providers) {
    const remaining = DEADLINE_MS - (Date.now() - startedAt)
    if (remaining < 8_000) break
    try {
      const answer = await provider.describe({
        prompt: PROMPT,
        image: photo,
        maxTokens: Math.min(provider.outputBudget, 1_200),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(remaining)]) : AbortSignal.timeout(remaining),
      })
      const parsed = parseAnswer(answer.text)
      if (parsed) {
        console.info(`[model-parts] ${provider.id} ${provider.model}: ${parsed.name}, ${parsed.widthCm ?? "?"} см, детали: ${parsed.parts.join(", ") || "—"}`)
        return parsed
      }
      console.warn(`[model-parts] ${provider.id} ${provider.model}: ответ без JSON (${answer.text.slice(0, 120)})`)
    } catch (error) {
      if (signal?.aborted) return null
      console.warn(`[model-parts] ${provider.id} ${provider.model} отказал: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`)
    }
  }
  return null
}
