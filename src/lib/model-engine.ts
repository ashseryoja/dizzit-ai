/**
 * Локальный движок «Фото → 3D»: настоящей реконструкции здесь нет, форма
 * подбирается из каркасной библиотеки по выбору пользователя, описанию и
 * имени файла. Провайдер, который отдаст GLB, подключается отдельно —
 * интерфейс страницы к этому готов (status/processing/error как везде).
 */

import { SHAPES, wireStats } from "@/lib/furniture-wire"
import type { FurnitureShape } from "@/types"

export type FurnitureOption = "auto" | FurnitureShape

const KEYWORDS: Record<FurnitureShape, RegExp> = {
  chair: /стул|кресл|табурет|chair|stool|seat/i,
  table: /стол|table|desk/i,
  lamp: /ламп|светильн|торшер|бра|lamp|light/i,
  sofa: /диван|соф|couch|sofa/i,
  shelf: /полк|стеллаж|шкаф|этажерк|shelf|bookcase|cabinet/i,
}

/** Предмет: явный выбор → ключевые слова → устойчивый хеш имени файла. */
export function resolveShape(option: FurnitureOption, note: string, fileName: string): FurnitureShape {
  if (option !== "auto") return option
  const text = `${note} ${fileName}`
  for (const shape of SHAPES) if (KEYWORDS[shape].test(text)) return shape
  let hash = 0
  for (const char of fileName) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return SHAPES[hash % SHAPES.length]
}

export interface ModelBuildResult {
  vertexCount: number
  edgeCount: number
}

/** Имитация построения: пауза как у настоящей очереди, потом статистика каркаса. */
export async function buildModelLocally(shape: FurnitureShape): Promise<ModelBuildResult> {
  await new Promise((resolve) => setTimeout(resolve, 2200 + Math.random() * 900))
  return wireStats(shape)
}
