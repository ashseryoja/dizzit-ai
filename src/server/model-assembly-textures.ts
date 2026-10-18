import "server-only"

import sharp from "sharp"

/**
 * Бесшовные PBR-текстуры по классам материалов для модели «по канонам»
 * (`src/server/model-assembly.ts`). Считаются процедурно один раз на процесс
 * и переиспользуются всеми моделями: дизайнер всё равно заменит их своим
 * материалом, им важно лишь честно показывать класс (ткань, кожа, металл,
 * дерево) и ложиться без швов на box-развёртку.
 *
 * Тайл — `tile` метров при UV 0…1; `metalrough` по glTF: G — шероховатость,
 * B — металличность.
 */

export type MaterialClass = "fabric" | "leather" | "metal" | "wood"
export type TextureRole = "basecolor" | "metalrough" | "normal"

interface ClassSpec {
  color: [number, number, number]
  metallic: number
  roughness: number
  /** Размер тайла в метрах. */
  tile: number
  height(x: number, y: number, noise: NoiseSet): number
  albedo(height: number, noise: NoiseSet, x: number, y: number): number
  normalStrength: number
  roughnessVariation: number
}

interface NoiseSet {
  fine(x: number, y: number): number
  coarse(x: number, y: number): number
  streak(x: number, y: number): number
}

const SIZE = 1024

/** Периодический value-noise на решётке N×N: индексы оборачиваются — тайл бесшовный. */
function periodicNoise(cells: number, seed: number): (x: number, y: number) => number {
  let state = seed >>> 0
  const random = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 4294967296)
  const grid = new Float32Array(cells * cells)
  for (let i = 0; i < grid.length; i += 1) grid[i] = random()
  const fade = (t: number) => t * t * (3 - 2 * t)
  return (x, y) => {
    const fx = x * cells
    const fy = y * cells
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const tx = fade(fx - x0)
    const ty = fade(fy - y0)
    const at = (i: number, j: number) => grid[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)]
    return (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty
  }
}

function fbm(octaves: number, seed: number, base: number): (x: number, y: number) => number {
  const layers: ((x: number, y: number) => number)[] = []
  for (let octave = 0; octave < octaves; octave += 1) layers.push(periodicNoise(base << octave, seed + octave * 7919))
  return (x, y) => {
    let sum = 0
    let total = 0
    let weight = 0.5
    for (const layer of layers) {
      sum += layer(x, y) * weight
      total += weight
      weight *= 0.5
    }
    return sum / total
  }
}

const CLASSES: Record<MaterialClass, ClassSpec> = {
  fabric: {
    color: [0.7, 0.69, 0.66],
    metallic: 0,
    roughness: 0.88,
    tile: 0.25,
    height: (x, y, n) => (0.5 + 0.25 * Math.sin(x * Math.PI * 320) * Math.sin(y * Math.PI * 320)) * 0.6 + n.fine(x, y) * 0.4,
    albedo: (h, n, x, y) => 0.88 + 0.22 * (h - 0.5) + 0.08 * (n.coarse(x, y) - 0.5),
    normalStrength: 1,
    roughnessVariation: 0.06,
  },
  leather: {
    color: [0.58, 0.31, 0.12],
    metallic: 0,
    roughness: 0.42,
    tile: 0.5,
    height: (x, y, n) => n.fine(x, y) * 0.15 + n.coarse(x, y) * 0.85,
    albedo: (h, n, x, y) => 0.95 + 0.08 * (n.coarse(x, y) - 0.5) + 0.02 * (h - 0.5),
    normalStrength: 0.25,
    roughnessVariation: 0.06,
  },
  metal: {
    color: [0.8, 0.66, 0.4],
    metallic: 1,
    roughness: 0.32,
    tile: 0.2,
    height: (x, y, n) => n.streak(x, y),
    albedo: (h) => 0.95 + 0.1 * (h - 0.5),
    normalStrength: 1.2,
    roughnessVariation: 0.1,
  },
  wood: {
    color: [0.45, 0.28, 0.15],
    metallic: 0,
    roughness: 0.55,
    tile: 0.5,
    height: (x, y, n) => 0.5 + 0.25 * Math.sin((y * 14 + n.coarse(x, y) * 3) * Math.PI * 2) + n.fine(x, y) * 0.2,
    albedo: (h) => 0.85 + 0.3 * (h - 0.5),
    normalStrength: 2,
    roughnessVariation: 0.1,
  },
}

export interface ClassTextures {
  cls: MaterialClass
  tile: number
  metallic: number
  roughness: number
  files: Record<TextureRole, { name: string; bytes: Uint8Array }>
}

const cache = new Map<MaterialClass, Promise<ClassTextures>>()

async function render(cls: MaterialClass): Promise<ClassTextures> {
  const spec = CLASSES[cls]
  const fine = fbm(4, 11, 64)
  const coarse = fbm(3, 23, 4)
  const streakFine = periodicNoise(512, 5)
  const streakCoarse = periodicNoise(8, 9)
  const noise: NoiseSet = { fine, coarse, streak: (x, y) => 0.5 * streakFine(x * 0.02, y) + 0.5 * streakCoarse(x, y) }
  const heights = new Float32Array(SIZE * SIZE)
  for (let j = 0; j < SIZE; j += 1) for (let i = 0; i < SIZE; i += 1) heights[j * SIZE + i] = spec.height(i / SIZE, j / SIZE, noise)
  const base = Buffer.alloc(SIZE * SIZE * 3)
  const metalRough = Buffer.alloc(SIZE * SIZE * 3)
  const normal = Buffer.alloc(SIZE * SIZE * 3)
  const at = (i: number, j: number) => heights[((j + SIZE) % SIZE) * SIZE + ((i + SIZE) % SIZE)]
  for (let j = 0; j < SIZE; j += 1) {
    for (let i = 0; i < SIZE; i += 1) {
      const p = j * SIZE + i
      const h = heights[p]
      const albedo = spec.albedo(h, noise, i / SIZE, j / SIZE)
      for (let c = 0; c < 3; c += 1) base[p * 3 + c] = Math.max(0, Math.min(255, Math.round(255 * Math.pow(spec.color[c] * albedo, 1 / 2.2))))
      const rough = spec.roughness + spec.roughnessVariation * (h - 0.5) * 2
      metalRough[p * 3] = 0
      metalRough[p * 3 + 1] = Math.round(255 * Math.max(0.05, Math.min(1, rough)))
      metalRough[p * 3 + 2] = Math.round(255 * spec.metallic)
      const dx = ((at(i + 1, j) - at(i - 1, j)) * spec.normalStrength * SIZE) / 64
      const dy = ((at(i, j + 1) - at(i, j - 1)) * spec.normalStrength * SIZE) / 64
      const length = Math.hypot(dx, dy, 1)
      normal[p * 3] = Math.round(255 * (0.5 - dx / length / 2))
      normal[p * 3 + 1] = Math.round(255 * (0.5 + dy / length / 2))
      normal[p * 3 + 2] = Math.round(255 * (0.5 + 1 / length / 2))
    }
  }
  const encode = (raw: Buffer) => sharp(raw, { raw: { width: SIZE, height: SIZE, channels: 3 } }).png({ compressionLevel: 8 }).toBuffer()
  const [baseBytes, metalRoughBytes, normalBytes] = await Promise.all([encode(base), encode(metalRough), encode(normal)])
  return {
    cls,
    tile: spec.tile,
    metallic: spec.metallic,
    roughness: spec.roughness,
    files: {
      basecolor: { name: `tile_${cls}_basecolor.png`, bytes: new Uint8Array(baseBytes) },
      metalrough: { name: `tile_${cls}_metalrough.png`, bytes: new Uint8Array(metalRoughBytes) },
      normal: { name: `tile_${cls}_normal.png`, bytes: new Uint8Array(normalBytes) },
    },
  }
}

/** Текстуры класса; считаются при первом обращении (~1 с) и живут в памяти процесса. */
export function classTextures(cls: MaterialClass): Promise<ClassTextures> {
  let pending = cache.get(cls)
  if (!pending) {
    pending = render(cls)
    cache.set(cls, pending)
  }
  return pending
}

export interface DecodedImage {
  width: number
  height: number
  /** Цвет в точке UV (с оборачиванием), 0…255. */
  at(u: number, v: number): [number, number, number]
}

/** Картинка в RGB для выборки цвета по UV — классификация частей по атласу Meshy. */
export async function decodeImage(bytes: Uint8Array): Promise<DecodedImage> {
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const wrap = (value: number, size: number) => Math.min(size - 1, Math.max(0, Math.floor((((value % 1) + 1) % 1) * size)))
  return {
    width: info.width,
    height: info.height,
    at(u, v) {
      const i = (wrap(v, info.height) * info.width + wrap(u, info.width)) * 4
      return [data[i], data[i + 1], data[i + 2]]
    },
  }
}
