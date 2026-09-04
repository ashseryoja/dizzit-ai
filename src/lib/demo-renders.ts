"use client"

/**
 * Тестовые рендеры для примера галереи: плоские абстрактные «сцены» разных
 * форматов, нарисованные на canvas. Нужны, чтобы посмотреть раскладку
 * галереи с десятком обработок, не собирая настоящие рендеры. Идут через
 * обычный конвейер инструмента — с миниатюрами, статусами и IndexedDB.
 */

interface DemoFormat {
  width: number
  height: number
}

/* Форматы вперемешку: горизонтали, вертикали, квадрат, панорама, сторис. */
const FORMATS: DemoFormat[] = [
  { width: 1600, height: 900 },
  { width: 1200, height: 1600 },
  { width: 1400, height: 1400 },
  { width: 1600, height: 1200 },
  { width: 900, height: 1600 },
  { width: 2100, height: 900 },
  { width: 1280, height: 960 },
  { width: 1600, height: 680 },
  { width: 1000, height: 1250 },
  { width: 1760, height: 1100 },
]

/* Приглушённые палитры «интерьеров»: [стена, пол, свет, ...мебельные тона]. */
const PALETTES: string[][] = [
  ["#b8b2a7", "#8a8378", "#ddd8cc", "#6f6a60", "#4a5a66", "#2f2b26"],
  ["#a7adb3", "#767c82", "#d3d8dc", "#5c636a", "#8a6f5c", "#33383d"],
  ["#b3a89a", "#7d7466", "#e0d9c9", "#68604f", "#4f6157", "#2e2a24"],
  ["#9aa39e", "#6e7671", "#ccd4cf", "#565e59", "#7a5f52", "#2b302d"],
  ["#b0a5ad", "#7c7178", "#dcd3d9", "#635960", "#4e5d6b", "#2f2a2e"],
]

/** Детерминированный «шум» по индексу: пример стабилен между показами. */
function vary(seed: number, salt: number): number {
  const x = Math.sin(seed * 127.1 + salt * 311.7) * 43758.5453
  return x - Math.floor(x)
}

function drawScene(ctx: CanvasRenderingContext2D, width: number, height: number, index: number) {
  const palette = PALETTES[index % PALETTES.length]
  const [wall, floor, light, ...tones] = palette

  ctx.fillStyle = wall
  ctx.fillRect(0, 0, width, height)

  // Линия пола: от 58 до 74 процентов высоты.
  const floorY = Math.round(height * (0.58 + vary(index, 1) * 0.16))
  ctx.fillStyle = floor
  ctx.fillRect(0, floorY, width, height - floorY)

  // «Окно» — светлый прямоугольник в верхней части.
  const windowWidth = Math.round(width * (0.14 + vary(index, 2) * 0.12))
  const windowHeight = Math.round(height * (0.2 + vary(index, 3) * 0.18))
  const windowX = Math.round(width * (0.55 + vary(index, 4) * 0.3))
  const windowY = Math.round(height * (0.1 + vary(index, 5) * 0.12))
  ctx.fillStyle = light
  ctx.fillRect(windowX, windowY, windowWidth, windowHeight)

  // 3–5 «предметов», стоящих на линии пола, каждый со своей тенью у основания.
  const blockCount = 3 + Math.floor(vary(index, 6) * 3)
  for (let block = 0; block < blockCount; block += 1) {
    const tone = tones[(index + block) % tones.length]
    const blockWidth = Math.round(width * (0.08 + vary(index, 10 + block) * 0.16))
    const blockHeight = Math.round(height * (0.16 + vary(index, 20 + block) * 0.3))
    const blockX = Math.round(width * 0.06 + (width * 0.82 * (block + vary(index, 30 + block))) / blockCount)
    const blockY = floorY - blockHeight

    ctx.fillStyle = "rgba(0,0,0,0.16)"
    ctx.fillRect(blockX - Math.round(blockWidth * 0.04), floorY, Math.round(blockWidth * 1.12), Math.round(height * 0.02))
    ctx.fillStyle = tone
    ctx.fillRect(blockX, blockY, blockWidth, blockHeight)
  }
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Не удалось собрать тестовый рендер"))),
      "image/png"
    )
  })
}

export async function makeDemoRenders(count = 10): Promise<File[]> {
  const files: File[] = []
  for (let index = 0; index < count; index += 1) {
    const { width, height } = FORMATS[index % FORMATS.length]
    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas 2D недоступен")
    drawScene(ctx, width, height, index)
    const blob = await toBlob(canvas)
    files.push(new File([blob], `demo-render-${index + 1}.png`, { type: "image/png" }))
  }
  return files
}
