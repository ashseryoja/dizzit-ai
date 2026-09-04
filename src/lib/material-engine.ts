"use client"

import { makeRng, type Rng } from "@/lib/seeded-rng"
import type { MaterialCategory } from "@/types"

/**
 * Локальный генератор материалов — ПРЕДПРОСМОТР, а не продукт.
 *
 * Настоящая генерация (диффузионная модель, обученная на PBR-текстурах) —
 * серверная задача, см. README «Куда добавлять новый инструмент». Пока
 * провайдера нет, этот генератор держит инструмент рабочим end-to-end:
 * процедурные текстуры на canvas по семейству материала. Референс задаёт
 * базовый тон (усредняется до одного цвета), описание — семейство в режиме
 * «авто». Результат — квадратный тайл.
 */

export const MATERIAL_SIDE = 1024

export interface MaterialResult {
  blob: Blob
  width: number
  height: number
}

/* Базовые тона семейств — приглушённые, в духе палитры сервиса. */
const BASE_TONE: Record<Exclude<MaterialCategory, "auto">, [number, number, number]> = {
  wood: [138, 106, 75],
  stone: [154, 151, 143],
  metal: [159, 164, 169],
  fabric: [125, 133, 119],
}

/** «Авто» выводится из описания; без узнаваемых слов — камень. */
export function resolveCategory(category: MaterialCategory, note: string): Exclude<MaterialCategory, "auto"> {
  if (category !== "auto") return category
  const text = note.toLowerCase()
  if (/дерев|дуб|орех|ясен|сосн|wood|oak/.test(text)) return "wood"
  if (/метал|сталь|латун|медь|алюмин|metal|steel/.test(text)) return "metal"
  if (/ткан|текстиль|лён|лен |хлопок|шерст|велюр|fabric|linen/.test(text)) return "fabric"
  return "stone"
}

/** Средний цвет референса: рисуем его в 1×1 и читаем пиксель. */
async function averageTone(ref: Blob): Promise<[number, number, number] | null> {
  try {
    const bitmap = await createImageBitmap(ref)
    try {
      const canvas = document.createElement("canvas")
      canvas.width = 1
      canvas.height = 1
      const ctx = canvas.getContext("2d", { willReadFrequently: true })
      if (!ctx) return null
      ctx.drawImage(bitmap, 0, 0, 1, 1)
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
      return [r, g, b]
    } finally {
      bitmap.close()
    }
  } catch {
    return null
  }
}

function rgba(tone: [number, number, number], delta: number, alpha: number): string {
  const [r, g, b] = tone.map((channel) => Math.max(0, Math.min(255, Math.round(channel + delta))))
  return `rgba(${r},${g},${b},${alpha})`
}

type Ctx = CanvasRenderingContext2D

function drawWood(ctx: Ctx, rand: Rng, tone: [number, number, number], side: number) {
  // Вертикальные доски с разнотоном + тонкие волокна с волной + пара сучков.
  let x = 0
  while (x < side) {
    const w = side * (0.05 + rand() * 0.06)
    ctx.fillStyle = rgba(tone, (rand() - 0.5) * 26, 1)
    ctx.fillRect(x, 0, w + 1, side)
    x += w
  }
  for (let i = 0; i < 70; i += 1) {
    const fx = rand() * side
    const amplitude = 2 + rand() * 6
    const phase = rand() * Math.PI * 2
    ctx.strokeStyle = rgba(tone, -20 - rand() * 25, 0.16 + rand() * 0.12)
    ctx.lineWidth = 0.6 + rand() * 1.1
    ctx.beginPath()
    for (let y = 0; y <= side; y += 16) {
      const wx = fx + Math.sin(y / 90 + phase) * amplitude
      if (y === 0) ctx.moveTo(wx, y)
      else ctx.lineTo(wx, y)
    }
    ctx.stroke()
  }
  const knots = 1 + Math.floor(rand() * 3)
  for (let i = 0; i < knots; i += 1) {
    const kx = rand() * side
    const ky = rand() * side
    for (let ring = 4; ring >= 1; ring -= 1) {
      ctx.fillStyle = rgba(tone, -14 * ring, 0.16)
      ctx.beginPath()
      ctx.ellipse(kx, ky, ring * (3 + rand() * 4), ring * (2 + rand() * 3), rand(), 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function drawStone(ctx: Ctx, rand: Rng, tone: [number, number, number], side: number) {
  // Пятна-зерно + несколько прожилок случайным блужданием.
  ctx.fillStyle = rgba(tone, 0, 1)
  ctx.fillRect(0, 0, side, side)
  for (let i = 0; i < 260; i += 1) {
    ctx.fillStyle = rgba(tone, (rand() - 0.5) * 34, 0.05 + rand() * 0.06)
    ctx.beginPath()
    ctx.ellipse(rand() * side, rand() * side, 20 + rand() * 150, 14 + rand() * 90, rand() * Math.PI, 0, Math.PI * 2)
    ctx.fill()
  }
  const veins = 4 + Math.floor(rand() * 5)
  for (let i = 0; i < veins; i += 1) {
    let vx = rand() * side
    let vy = 0
    ctx.strokeStyle = rgba(tone, -30 - rand() * 30, 0.2 + rand() * 0.15)
    ctx.lineWidth = 0.8 + rand() * 1.6
    ctx.beginPath()
    ctx.moveTo(vx, vy)
    while (vy < side) {
      vx += (rand() - 0.5) * 70
      vy += 20 + rand() * 50
      ctx.lineTo(vx, vy)
    }
    ctx.stroke()
  }
}

function drawMetal(ctx: Ctx, rand: Rng, tone: [number, number, number], side: number) {
  // Браширование: плотные горизонтальные штрихи + редкие царапины.
  ctx.fillStyle = rgba(tone, 0, 1)
  ctx.fillRect(0, 0, side, side)
  for (let y = 0; y < side; y += 2) {
    ctx.fillStyle = rgba(tone, (rand() - 0.5) * 30, 0.16)
    ctx.fillRect(0, y, side, 1)
  }
  for (let i = 0; i < 26; i += 1) {
    const sy = rand() * side
    ctx.strokeStyle = rgba(tone, rand() > 0.5 ? 26 : -26, 0.1 + rand() * 0.1)
    ctx.lineWidth = 0.6 + rand() * 0.8
    ctx.beginPath()
    ctx.moveTo(0, sy)
    ctx.lineTo(side, sy + (rand() - 0.5) * 30)
    ctx.stroke()
  }
}

function drawFabric(ctx: Ctx, rand: Rng, tone: [number, number, number], side: number) {
  // Полотняное переплетение: два перпендикулярных слоя нитей.
  ctx.fillStyle = rgba(tone, 0, 1)
  ctx.fillRect(0, 0, side, side)
  const pitch = 7
  for (let x = 0; x < side; x += pitch) {
    ctx.fillStyle = rgba(tone, (rand() - 0.5) * 22 - 6, 0.3)
    ctx.fillRect(x, 0, pitch / 2, side)
  }
  for (let y = 0; y < side; y += pitch) {
    ctx.fillStyle = rgba(tone, (rand() - 0.5) * 22 + 6, 0.24)
    ctx.fillRect(0, y, side, pitch / 2)
  }
  // Лёгкая неравномерность плетения крупными пятнами.
  for (let i = 0; i < 40; i += 1) {
    ctx.fillStyle = rgba(tone, (rand() - 0.5) * 16, 0.05)
    ctx.beginPath()
    ctx.ellipse(rand() * side, rand() * side, 60 + rand() * 160, 40 + rand() * 120, rand() * Math.PI, 0, Math.PI * 2)
    ctx.fill()
  }
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Браузер не смог закодировать текстуру"))),
      "image/png"
    )
  })
}

export async function generateMaterial({
  category,
  note,
  seed,
  ref,
}: {
  category: MaterialCategory
  note: string
  /** Ключ детерминизма — id записи: «Повторить» рисует ту же текстуру. */
  seed: string
  ref?: Blob | null
}): Promise<MaterialResult> {
  const family = resolveCategory(category, note)
  const rand = makeRng(seed)
  const tone = (ref ? await averageTone(ref) : null) ?? BASE_TONE[family]

  const canvas = document.createElement("canvas")
  canvas.width = MATERIAL_SIDE
  canvas.height = MATERIAL_SIDE
  const ctx = canvas.getContext("2d")
  if (!ctx) throw new Error("Canvas 2D недоступен")

  ctx.fillStyle = rgba(tone, 0, 1)
  ctx.fillRect(0, 0, MATERIAL_SIDE, MATERIAL_SIDE)

  switch (family) {
    case "wood":
      drawWood(ctx, rand, tone, MATERIAL_SIDE)
      break
    case "stone":
      drawStone(ctx, rand, tone, MATERIAL_SIDE)
      break
    case "metal":
      drawMetal(ctx, rand, tone, MATERIAL_SIDE)
      break
    case "fabric":
      drawFabric(ctx, rand, tone, MATERIAL_SIDE)
      break
  }

  const blob = await toBlob(canvas)
  return { blob, width: MATERIAL_SIDE, height: MATERIAL_SIDE }
}
