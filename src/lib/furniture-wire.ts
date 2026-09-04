/**
 * Каркасная библиотека мебели для «Фото → 3D»: пять предметов, заданных
 * ломаными в кубе [-1, 1] (y — вверх, пол на y ≈ -0.95). Все модели
 * приводятся к одному числу ломаных и точек в каждой — так между любыми
 * двумя формами можно морфить простой линейной интерполяцией координат.
 * Ни цвета, ни граней: только линии и точки, как у скана.
 */

import type { FurnitureShape } from "@/types"

export const SHAPES: FurnitureShape[] = ["chair", "table", "lamp", "sofa", "shelf"]

export const SHAPE_LABEL: Record<FurnitureShape, string> = {
  chair: "стул",
  table: "стол",
  lamp: "лампа",
  sofa: "диван",
  shelf: "стеллаж",
}

type P = readonly [number, number, number]
type Poly = P[]

/** Точек в каждой ломаной после пересэмплирования. */
export const SAMPLES = 14

const line = (a: P, b: P): Poly => [a, b]

/** Замкнутый прямоугольник в плоскости XZ на высоте y. */
function rect(y: number, x0: number, z0: number, x1: number, z1: number): Poly {
  return [
    [x0, y, z0],
    [x1, y, z0],
    [x1, y, z1],
    [x0, y, z1],
    [x0, y, z0],
  ]
}

/** Окружность в плоскости XZ. */
function circle(cx: number, y: number, cz: number, r: number, n = 24): Poly {
  const out: P[] = []
  for (let i = 0; i <= n; i += 1) {
    const a = (i / n) * Math.PI * 2
    out.push([cx + Math.cos(a) * r, y, cz + Math.sin(a) * r])
  }
  return out
}

/** Параллелепипед: два прямоугольника и четыре ребра. */
function box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): Poly[] {
  return [
    rect(y0, x0, z0, x1, z1),
    rect(y1, x0, z0, x1, z1),
    line([x0, y0, z0], [x0, y1, z0]),
    line([x1, y0, z0], [x1, y1, z0]),
    line([x1, y0, z1], [x1, y1, z1]),
    line([x0, y0, z1], [x0, y1, z1]),
  ]
}

const RAW: Record<FurnitureShape, Poly[]> = {
  chair: [
    rect(-0.1, -0.45, -0.45, 0.45, 0.45),
    rect(-0.2, -0.45, -0.45, 0.45, 0.45),
    line([-0.4, -0.2, 0.4], [-0.4, -0.95, 0.4]),
    line([0.4, -0.2, 0.4], [0.4, -0.95, 0.4]),
    line([-0.4, -0.2, -0.4], [-0.4, -0.95, -0.4]),
    line([0.4, -0.2, -0.4], [0.4, -0.95, -0.4]),
    line([-0.4, -0.1, -0.4], [-0.4, 0.85, -0.42]),
    line([0.4, -0.1, -0.4], [0.4, 0.85, -0.42]),
    line([-0.4, 0.85, -0.42], [0.4, 0.85, -0.42]),
    line([-0.4, 0.1, -0.41], [0.4, 0.1, -0.41]),
    line([-0.2, 0.1, -0.41], [-0.2, 0.85, -0.42]),
    line([0, 0.1, -0.41], [0, 0.85, -0.42]),
    line([0.2, 0.1, -0.41], [0.2, 0.85, -0.42]),
    line([-0.4, -0.6, 0.4], [0.4, -0.6, 0.4]),
    line([-0.4, -0.6, -0.4], [-0.4, -0.6, 0.4]),
    line([0.4, -0.6, -0.4], [0.4, -0.6, 0.4]),
  ],
  table: [
    rect(0.15, -1, -0.55, 1, 0.55),
    rect(0.08, -1, -0.55, 1, 0.55),
    line([-1, 0.15, -0.55], [-1, 0.08, -0.55]),
    line([1, 0.15, -0.55], [1, 0.08, -0.55]),
    line([1, 0.15, 0.55], [1, 0.08, 0.55]),
    line([-1, 0.15, 0.55], [-1, 0.08, 0.55]),
    line([-0.9, 0.08, -0.45], [-0.9, -0.95, -0.45]),
    line([0.9, 0.08, -0.45], [0.9, -0.95, -0.45]),
    line([0.9, 0.08, 0.45], [0.9, -0.95, 0.45]),
    line([-0.9, 0.08, 0.45], [-0.9, -0.95, 0.45]),
    rect(-0.05, -0.9, -0.45, 0.9, 0.45),
    line([-0.9, -0.5, -0.45], [0.9, -0.5, -0.45]),
    line([-0.9, -0.5, 0.45], [0.9, -0.5, 0.45]),
  ],
  lamp: [
    circle(0, -0.95, 0, 0.36),
    circle(0, -0.88, 0, 0.14),
    line([0, -0.88, 0], [0, 0.32, 0]),
    circle(0, 0.3, 0, 0.62),
    circle(0, 0.85, 0, 0.3),
    line([0.62, 0.3, 0], [0.3, 0.85, 0]),
    line([-0.62, 0.3, 0], [-0.3, 0.85, 0]),
    line([0, 0.3, 0.62], [0, 0.85, 0.3]),
    line([0, 0.3, -0.62], [0, 0.85, -0.3]),
    line([0.44, 0.3, 0.44], [0.21, 0.85, 0.21]),
    line([-0.44, 0.3, -0.44], [-0.21, 0.85, -0.21]),
    line([0.44, 0.3, -0.44], [0.21, 0.85, -0.21]),
    line([-0.44, 0.3, 0.44], [-0.21, 0.85, 0.21]),
    circle(0, 0.92, 0, 0.07, 12),
    line([0, 0.85, 0], [0, 0.98, 0]),
  ],
  sofa: [
    ...box(-1, -0.6, -0.5, 1, -0.2, 0.5),
    ...box(-1, -0.2, -0.5, 1, 0.5, -0.24),
    ...box(-1, -0.2, -0.24, -0.8, 0.15, 0.5),
    ...box(0.8, -0.2, -0.24, 1, 0.15, 0.5),
    line([0, -0.2, -0.24], [0, -0.2, 0.5]),
    line([0, -0.2, -0.24], [0, 0.5, -0.24]),
    line([-0.85, -0.6, -0.4], [-0.85, -0.8, -0.4]),
    line([0.85, -0.6, -0.4], [0.85, -0.8, -0.4]),
    line([0.85, -0.6, 0.4], [0.85, -0.8, 0.4]),
    line([-0.85, -0.6, 0.4], [-0.85, -0.8, 0.4]),
  ],
  shelf: [
    ...box(-0.7, -0.95, -0.3, 0.7, 0.95, 0.3),
    rect(-0.4, -0.7, -0.3, 0.7, 0.3),
    rect(0.15, -0.7, -0.3, 0.7, 0.3),
    rect(0.6, -0.7, -0.3, 0.7, 0.3),
    line([0, -0.95, -0.3], [0, 0.95, -0.3]),
    line([0, -0.95, 0.3], [0, 0.95, 0.3]),
    // Несколько «книг» на средней полке.
    line([-0.55, -0.4, 0.1], [-0.55, -0.05, 0.1]),
    line([-0.45, -0.4, 0.1], [-0.45, 0, 0.1]),
    line([-0.33, -0.4, 0.1], [-0.33, -0.1, 0.1]),
    line([0.2, -0.4, 0.05], [0.4, -0.1, 0.05]),
  ],
}

/** Равномерная выборка SAMPLES точек по длине ломаной. */
function resample(poly: Poly): P[] {
  const lengths: number[] = [0]
  for (let i = 1; i < poly.length; i += 1) {
    const [ax, ay, az] = poly[i - 1]
    const [bx, by, bz] = poly[i]
    lengths.push(lengths[i - 1] + Math.hypot(bx - ax, by - ay, bz - az))
  }
  const total = lengths[lengths.length - 1]
  const out: P[] = []
  for (let s = 0; s < SAMPLES; s += 1) {
    const target = total === 0 ? 0 : (total * s) / (SAMPLES - 1)
    let i = 1
    while (i < lengths.length - 1 && lengths[i] < target) i += 1
    const segment = Math.max(1e-6, lengths[i] - lengths[i - 1])
    const t = total === 0 ? 0 : Math.min(1, Math.max(0, (target - lengths[i - 1]) / segment))
    const a = poly[i - 1]
    const b = poly[i] ?? a
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t])
  }
  return out
}

function centroid(poly: P[]): P {
  let x = 0
  let y = 0
  let z = 0
  for (const p of poly) {
    x += p[0]
    y += p[1]
    z += p[2]
  }
  return [x / poly.length, y / poly.length, z / poly.length]
}

/** Число ломаных у каждой модели после выравнивания. */
export const POLY_COUNT = Math.max(...SHAPES.map((shape) => RAW[shape].length))

/**
 * Скомпилированные модели: плоский массив [poly][sample][xyz]. Ломаные
 * отсортированы по высоте — при морфе нижние линии переходят в нижние,
 * верхние в верхние, и форма «перетекает», а не перемешивается. Модели
 * с меньшим числом ломаных дополнены повторами своих же линий.
 */
export const WIRE: Record<FurnitureShape, Float32Array> = Object.fromEntries(
  SHAPES.map((shape) => {
    const polys = RAW[shape].map(resample)
    polys.sort((a, b) => {
      const ca = centroid(a)
      const cb = centroid(b)
      return ca[1] - cb[1] || ca[0] - cb[0] || ca[2] - cb[2]
    })
    const data = new Float32Array(POLY_COUNT * SAMPLES * 3)
    for (let k = 0; k < POLY_COUNT; k += 1) {
      const poly = polys[k % polys.length]
      for (let s = 0; s < SAMPLES; s += 1) {
        const o = (k * SAMPLES + s) * 3
        data[o] = poly[s][0]
        data[o + 1] = poly[s][1]
        data[o + 2] = poly[s][2]
      }
    }
    return [shape, data]
  })
) as Record<FurnitureShape, Float32Array>

/** Честная статистика каркаса — для подписи под моделью. */
export function wireStats(shape: FurnitureShape): { vertexCount: number; edgeCount: number } {
  let vertexCount = 0
  let edgeCount = 0
  for (const poly of RAW[shape]) {
    vertexCount += poly.length
    edgeCount += poly.length - 1
  }
  return { vertexCount, edgeCount }
}

export interface DrawOptions {
  width: number
  height: number
  /** Поворот вокруг вертикали, рад. */
  angle: number
  /** Наклон камеры, рад (смотрим чуть сверху). */
  tilt: number
  /** Цвет линий, 0–255. */
  rgb: [number, number, number]
  /** Общая прозрачность (для появления/исчезновения). */
  alpha?: number
}

/**
 * Рисует каркас на canvas: перспектива, затухание по глубине, мягкое
 * свечение и точки-вершины. Координаты — в CSS-пикселях (ctx уже
 * отмасштабирован под devicePixelRatio).
 */
export function drawWire(ctx: CanvasRenderingContext2D, points: Float32Array, options: DrawOptions) {
  const { width, height, angle, tilt, rgb, alpha = 1 } = options
  const size = Math.min(width, height)
  const focal = size * 1.05
  const distance = 3.4
  const cx = width / 2
  const cy = height / 2 + size * 0.02
  const cosA = Math.cos(angle)
  const sinA = Math.sin(angle)
  const cosT = Math.cos(tilt)
  const sinT = Math.sin(tilt)

  const sx = new Float32Array(points.length / 3)
  const sy = new Float32Array(points.length / 3)
  const depth = new Float32Array(points.length / 3)
  for (let i = 0; i < points.length / 3; i += 1) {
    const x = points[i * 3]
    const y = points[i * 3 + 1]
    const z = points[i * 3 + 2]
    const rx = x * cosA - z * sinA
    const rz = x * sinA + z * cosA
    const ry = y * cosT - rz * sinT
    const dz = y * sinT + rz * cosT
    const scale = focal / (distance + dz)
    sx[i] = cx + rx * scale
    sy[i] = cy - ry * scale
    depth[i] = dz
  }

  // Тень на полу — мягкий эллипс под моделью.
  const floorScale = focal / distance
  const floorY = cy + 0.95 * floorScale * cosT
  const shadow = ctx.createRadialGradient(cx, floorY, 0, cx, floorY, size * 0.34)
  shadow.addColorStop(0, `rgba(${rgb.join(",")},${0.09 * alpha})`)
  shadow.addColorStop(1, `rgba(${rgb.join(",")},0)`)
  ctx.save()
  ctx.translate(cx, floorY)
  ctx.scale(1, 0.28)
  ctx.translate(-cx, -floorY)
  ctx.fillStyle = shadow
  ctx.fillRect(cx - size * 0.4, floorY - size * 0.4, size * 0.8, size * 0.8)
  ctx.restore()

  ctx.lineCap = "round"
  ctx.lineJoin = "round"
  const polyCount = points.length / 3 / SAMPLES
  for (let k = 0; k < polyCount; k += 1) {
    let meanDepth = 0
    for (let s = 0; s < SAMPLES; s += 1) meanDepth += depth[k * SAMPLES + s]
    meanDepth /= SAMPLES
    // Ближе к камере — контрастнее, дальше — прозрачнее.
    const near = 1 - Math.min(1, Math.max(0, (meanDepth + 1.2) / 2.4))
    const a = (0.22 + 0.55 * near) * alpha

    ctx.beginPath()
    for (let s = 0; s < SAMPLES; s += 1) {
      const i = k * SAMPLES + s
      if (s === 0) ctx.moveTo(sx[i], sy[i])
      else ctx.lineTo(sx[i], sy[i])
    }
    ctx.strokeStyle = `rgba(${rgb.join(",")},${a * 0.14})`
    ctx.lineWidth = 5
    ctx.stroke()
    ctx.strokeStyle = `rgba(${rgb.join(",")},${a})`
    ctx.lineWidth = 1.25
    ctx.stroke()

    ctx.fillStyle = `rgba(${rgb.join(",")},${Math.min(1, a * 0.9)})`
    for (let s = 0; s < SAMPLES; s += 1) {
      const i = k * SAMPLES + s
      ctx.beginPath()
      ctx.arc(sx[i], sy[i], 1.15, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}
