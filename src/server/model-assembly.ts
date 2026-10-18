import "server-only"

import { writeFbx, type FbxTexture } from "@/server/model-assembly-fbx"
import { readGlb, writeGlb, type GlbMaterial, type GlbTexture } from "@/server/model-assembly-glb"
import { classTextures, decodeImage, type ClassTextures, type DecodedImage, type MaterialClass } from "@/server/model-assembly-textures"
import type { ZipEntry } from "@/server/zip"
import type { ModelPart } from "@/shared/model3d"

/**
 * Сборка модели «по канонам» для дизайнеров интерьера: из цельной модели Meshy
 * и её разбиения Auto Split получается набор отдельных именованных объектов
 * (каркас, подушки, ножки…) с материалом по классу на каждом, двумя
 * UV-каналами (атлас Meshy и box-развёртка под тайлящиеся материалы), реальным
 * масштабом в метрах и pivot на полу. Именно так устроены ручные модели мебели
 * для 3ds Max, и только так дизайнер может поменять ткань подушки, не трогая
 * дерево каркаса.
 *
 * Auto Split режет сетку и достраивает внутренние поверхности контакта (низ
 * подушки, внутреннюю стенку каркаса); у этих граней нет своего места на
 * текстуре. Правила для них подобраны на живых моделях (октябрь 2026):
 *  - грань вплотную к исходной поверхности, где исходный треугольник ещё жив, —
 *    дубликат, просвечивает сквозь поверхность, удаляется;
 *  - грань вплотную к поверхности, но смотрящая внутрь — то же самое;
 *  - остальные новые грани получают ровный цвет своей части из атласа.
 * Осколки меньше `SLIVER_TRIS` треугольников приклеиваются к ближайшей крупной
 * части; граница между частями сглаживается и утапливается на `GROOVE_M`.
 *
 * Класс материала части определяется по среднему цвету и металличности атласа
 * Meshy (он снят с фото): серое — ткань, коричнево-оранжевое — кожа, металлик —
 * металл. Имена — по роли в мебели: ножки, каркас, подушки.
 */

export interface AssemblyOptions {
  /** Имя корневой группы и префикс объектов — латиницей, без пробелов. */
  rootName: string
  /** Реальная ширина предмета, м (по фото оценивает vision-модель). */
  widthMeters: number
}

export interface AssembledModel {
  /** GLB для вьюера и скачивания: объекты, оба UV-канала, запечённая текстура Meshy. */
  previewGlb: Uint8Array
  /** FBX с материалами по классам и текстурами рядом. */
  fbx: ZipEntry[]
  /** OBJ + MTL + текстуры; UV — box-развёртка с тайлом. */
  obj: ZipEntry[]
  parts: ModelPart[]
  /** Ширина, высота, глубина в метрах. */
  size: [number, number, number]
}

const SLIVER_TRIS = 150
const SMOOTH_ITERATIONS = 8
const SMOOTH_LAMBDA = 0.5
const MIN_RING = 40
const GROOVE_M = 0.003
const NEAR_M = 0.0025
const CELL_M = 0.02
const MATERIAL_BY_CLASS: Record<MaterialClass, string> = { fabric: "Fabric_Gray", leather: "Leather_Cognac", metal: "Metal_Brass", wood: "Wood_Oak" }

type Vec3 = [number, number, number]
type Tri = { c: [Vec3, Vec3, Vec3]; orig: number }

const key3 = (p: Vec3) => `${Math.round(p[0] * 1e5)},${Math.round(p[1] * 1e5)},${Math.round(p[2] * 1e5)}`
const triKey = (a: Vec3, b: Vec3, c: Vec3) => [key3(a), key3(b), key3(c)].sort().join("|")
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2])
const centroidOf = (c: [Vec3, Vec3, Vec3]): Vec3 => [(c[0][0] + c[1][0] + c[2][0]) / 3, (c[0][1] + c[1][1] + c[2][1]) / 3, (c[0][2] + c[1][2] + c[2][2]) / 3]

class TriGrid {
  private readonly cells = new Map<string, number[]>()
  constructor(private readonly centroid: (tri: number) => Vec3, tris: Iterable<number>) {
    for (const tri of tris) {
      const key = this.cellKey(this.centroid(tri))
      const list = this.cells.get(key)
      if (list) list.push(tri)
      else this.cells.set(key, [tri])
    }
  }
  private cellKey(p: Vec3) {
    return `${Math.floor(p[0] / CELL_M)},${Math.floor(p[1] / CELL_M)},${Math.floor(p[2] / CELL_M)}`
  }
  nearest(p: Vec3, maxRadius = 8): number {
    const gx = Math.floor(p[0] / CELL_M)
    const gy = Math.floor(p[1] / CELL_M)
    const gz = Math.floor(p[2] / CELL_M)
    let best = -1
    let bestDistance = Infinity
    for (let r = 0; r <= maxRadius; r += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        for (let dy = -r; dy <= r; dy += 1) {
          for (let dz = -r; dz <= r; dz += 1) {
            if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue
            const list = this.cells.get(`${gx + dx},${gy + dy},${gz + dz}`)
            if (!list) continue
            for (const tri of list) {
              const c = this.centroid(tri)
              const d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2
              if (d < bestDistance) {
                bestDistance = d
                best = tri
              }
            }
          }
        }
      }
      if (best >= 0 && r >= 1) break
    }
    return best
  }
}

interface RawPart {
  name: string
  positions: Float64Array
  indices: Float64Array
  tris: number
  min: Vec3
  max: Vec3
  center: Vec3
  extra: RawPart[]
  color?: { rgb: Vec3; metallic: number }
  cls?: MaterialClass
}

interface PartObject {
  name: string
  cls: MaterialClass
  material: string
  tris: Tri[]
  rgbAccumulator: Vec3
  weight: number
  grid?: TriGrid
  flatUv: [number, number]
}

function classify(rgb: Vec3, metallic: number): MaterialClass {
  const [r, g, b] = rgb.map((v) => v / 255) as Vec3
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const saturation = max ? (max - min) / max : 0
  if (metallic > 0.5) return "metal"
  if (saturation < 0.18) return max < 0.25 ? "metal" : "fabric"
  const hue = max === r ? ((g - b) / (max - min) + 6) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4
  return hue < 1.2 || hue > 5.5 ? "leather" : "fabric"
}

export async function assembleModel(originalGlb: Uint8Array, splitGlb: Uint8Array, options: AssemblyOptions): Promise<AssembledModel> {
  const root = options.rootName
  const original = readGlb(originalGlb)
  const primitive = original.json.meshes?.[0]?.primitives[0]
  if (!primitive || primitive.indices === undefined || primitive.attributes.TEXCOORD_0 === undefined) {
    throw new Error("У модели Meshy нет развёртки — собрать детали не из чего.")
  }
  const originalMaterial = original.json.materials?.[0]
  const atlasIndex = (ref: { index: number } | undefined) => (ref ? original.json.textures?.[ref.index]?.source : undefined)
  const atlasBaseIndex = atlasIndex(originalMaterial?.pbrMetallicRoughness?.baseColorTexture)
  if (atlasBaseIndex === undefined) throw new Error("У модели Meshy нет текстуры — собрать детали не из чего.")

  // ---------- масштаб: всё дальше считается в метрах, pivot на полу ----------
  const split = readGlb(splitGlb)
  const splitMeshes = split.json.meshes ?? []
  if (splitMeshes.length < 2) throw new Error("Meshy не разделил модель на части.")
  const bounds = { min: [Infinity, Infinity, Infinity] as Vec3, max: [-Infinity, -Infinity, -Infinity] as Vec3 }
  const rawPositions = splitMeshes.map((mesh) => split.accessor(mesh.primitives[0].attributes.POSITION).data)
  for (const positions of rawPositions) {
    for (let k = 0; k < positions.length; k += 3) {
      for (let j = 0; j < 3; j += 1) {
        bounds.min[j] = Math.min(bounds.min[j], positions[k + j])
        bounds.max[j] = Math.max(bounds.max[j], positions[k + j])
      }
    }
  }
  const scale = options.widthMeters / (bounds.max[0] - bounds.min[0])
  const cx = (bounds.min[0] + bounds.max[0]) / 2
  const cz = (bounds.min[2] + bounds.max[2]) / 2
  const floor = bounds.min[1]
  const toMeters = (positions: Float64Array) => {
    const out = new Float64Array(positions.length)
    for (let k = 0; k < positions.length; k += 3) {
      out[k] = (positions[k] - cx) * scale
      out[k + 1] = (positions[k + 1] - floor) * scale
      out[k + 2] = (positions[k + 2] - cz) * scale
    }
    return out
  }
  const size: Vec3 = [0, 1, 2].map((j) => (bounds.max[j] - bounds.min[j]) * scale) as Vec3

  // ---------- исходник ----------
  const OP = toMeters(original.accessor(primitive.attributes.POSITION).data)
  const OUV = original.accessor(primitive.attributes.TEXCOORD_0).data
  const OI = original.accessor(primitive.indices).data
  const originalTriCount = OI.length / 3
  const corner = (tri: number, j: number): Vec3 => {
    const i = OI[tri * 3 + j] * 3
    return [OP[i], OP[i + 1], OP[i + 2]]
  }
  const originalCentroid = (tri: number) => centroidOf([corner(tri, 0), corner(tri, 1), corner(tri, 2)])
  const originalByKey = new Map<string, number>()
  for (let tri = 0; tri < originalTriCount; tri += 1) originalByKey.set(triKey(corner(tri, 0), corner(tri, 1), corner(tri, 2)), tri)
  const originalNormal = (tri: number): Vec3 => cross(sub(corner(tri, 1), corner(tri, 0)), sub(corner(tri, 2), corner(tri, 0)))
  const uvAt = (tri: number, point: Vec3, clamp: boolean): [number, number] => {
    const a = corner(tri, 0)
    const v0 = sub(corner(tri, 1), a)
    const v1 = sub(corner(tri, 2), a)
    const v2 = sub(point, a)
    const d00 = dot(v0, v0)
    const d01 = dot(v0, v1)
    const d11 = dot(v1, v1)
    const d20 = dot(v2, v0)
    const d21 = dot(v2, v1)
    const den = d00 * d11 - d01 * d01 || 1e-12
    let v = (d11 * d20 - d01 * d21) / den
    let w = (d00 * d21 - d01 * d20) / den
    let u = 1 - v - w
    if (clamp) {
      u = Math.max(0, u)
      v = Math.max(0, v)
      w = Math.max(0, w)
      const sum = u + v + w || 1
      u /= sum
      v /= sum
      w /= sum
    }
    const ia = OI[tri * 3]
    const ib = OI[tri * 3 + 1]
    const ic = OI[tri * 3 + 2]
    return [u * OUV[ia * 2] + v * OUV[ib * 2] + w * OUV[ic * 2], u * OUV[ia * 2 + 1] + v * OUV[ib * 2 + 1] + w * OUV[ic * 2 + 1]]
  }

  // ---------- атлас для классификации ----------
  const atlasBase = await decodeImage(original.image(atlasBaseIndex).bytes)
  const atlasMetalIndex = atlasIndex(originalMaterial?.pbrMetallicRoughness?.metallicRoughnessTexture)
  const atlasMetal: DecodedImage | null = atlasMetalIndex === undefined ? null : await decodeImage(original.image(atlasMetalIndex).bytes)

  // ---------- части разбиения ----------
  const raw: RawPart[] = splitMeshes.map((mesh, index) => {
    const positions = toMeters(rawPositions[index])
    const indices = split.accessor(mesh.primitives[0].indices!).data
    const min: Vec3 = [Infinity, Infinity, Infinity]
    const max: Vec3 = [-Infinity, -Infinity, -Infinity]
    for (let k = 0; k < positions.length; k += 3) {
      for (let j = 0; j < 3; j += 1) {
        min[j] = Math.min(min[j], positions[k + j])
        max[j] = Math.max(max[j], positions[k + j])
      }
    }
    return { name: mesh.name ?? `part${index}`, positions, indices, tris: indices.length / 3, min, max, center: [0, 1, 2].map((j) => (min[j] + max[j]) / 2) as Vec3, extra: [] }
  })
  const partCorner = (part: RawPart, tri: number, j: number): Vec3 => {
    const i = part.indices[tri * 3 + j] * 3
    return [part.positions[i], part.positions[i + 1], part.positions[i + 2]]
  }
  const partColor = (part: RawPart): { rgb: Vec3; metallic: number } => {
    let n = 0
    const rgb: Vec3 = [0, 0, 0]
    let metallic = 0
    const step = Math.max(1, Math.floor(part.tris / 400))
    for (let tri = 0; tri < part.tris; tri += step) {
      const key = triKey(partCorner(part, tri, 0), partCorner(part, tri, 1), partCorner(part, tri, 2))
      const source = originalByKey.get(key)
      if (source === undefined) continue
      const ia = OI[source * 3]
      const ib = OI[source * 3 + 1]
      const ic = OI[source * 3 + 2]
      const u = (OUV[ia * 2] + OUV[ib * 2] + OUV[ic * 2]) / 3
      const v = (OUV[ia * 2 + 1] + OUV[ib * 2 + 1] + OUV[ic * 2 + 1]) / 3
      const pixel = atlasBase.at(u, v)
      rgb[0] += pixel[0]
      rgb[1] += pixel[1]
      rgb[2] += pixel[2]
      if (atlasMetal) metallic += atlasMetal.at(u, v)[2] / 255
      n += 1
    }
    return n ? { rgb: rgb.map((v) => v / n) as Vec3, metallic: metallic / n } : { rgb: [128, 128, 128], metallic: 0 }
  }

  // ---------- разметка: класс по цвету, имя по роли ----------
  const big = raw.filter((part) => part.tris >= SLIVER_TRIS)
  if (big.length < 2) throw new Error("Meshy не разделил модель на части.")
  for (const part of big) {
    part.color = partColor(part)
    part.cls = classify(part.color.rgb, part.color.metallic)
  }
  const labels = new Map<RawPart, { object: string; cls: MaterialClass }>()
  const low = (part: RawPart) => part.max[1] < 0.45 * size[1]
  const pad = (n: number) => String(n).padStart(2, "0")
  const metalParts = big.filter((part) => part.cls === "metal")
  metalParts.forEach((part, index) => labels.set(part, { object: low(part) ? `${root}_Legs_Metal` : `${root}_Metal_${pad(index + 1)}`, cls: "metal" }))
  for (const cls of ["leather", "wood"] as const) {
    const parts = big.filter((part) => part.cls === cls).sort((a, b) => b.tris - a.tris)
    const title = cls[0].toUpperCase() + cls.slice(1)
    let cushion = 0
    parts.forEach((part, index) => {
      const thin = part.max[1] - part.min[1] < 0.15 * size[1]
      const frame = index === 0 || thin || low(part)
      labels.set(part, { object: frame ? `${root}_Frame_${title}` : `${root}_Cushion_${pad((cushion += 1))}_${title}`, cls })
    })
  }
  const fabric = big.filter((part) => part.cls === "fabric").sort((a, b) => a.center[1] - b.center[1])
  fabric.forEach((part, index) => {
    const role = fabric.length === 2 ? (index === 0 ? "SeatCushions" : "BackCushions") : `Cushion_${pad(index + 1)}`
    labels.set(part, { object: `${root}_${role}_Fabric`, cls: "fabric" })
  })

  // ---------- осколки к ближайшей крупной части ----------
  const minDistance = (a: RawPart, b: RawPart) => {
    let best = Infinity
    const stepA = Math.max(1, Math.floor(a.positions.length / 3 / 200))
    const stepB = Math.max(1, Math.floor(b.positions.length / 3 / 3000))
    for (let i = 0; i < a.positions.length; i += 3 * stepA) {
      for (let k = 0; k < b.positions.length; k += 3 * stepB) {
        const d = (a.positions[i] - b.positions[k]) ** 2 + (a.positions[i + 1] - b.positions[k + 1]) ** 2 + (a.positions[i + 2] - b.positions[k + 2]) ** 2
        if (d < best) best = d
      }
    }
    return best
  }
  for (const sliver of raw.filter((part) => !labels.has(part))) {
    let target = big[0]
    let best = Infinity
    for (const candidate of big) {
      const d = minDistance(sliver, candidate)
      if (d < best) {
        best = d
        target = candidate
      }
    }
    target.extra.push(sliver)
  }

  // ---------- объекты ----------
  const objects = new Map<string, PartObject>()
  for (const part of big) {
    const label = labels.get(part)!
    let object = objects.get(label.object)
    if (!object) {
      object = { name: label.object, cls: label.cls, material: MATERIAL_BY_CLASS[label.cls], tris: [], rgbAccumulator: [0, 0, 0], weight: 0, flatUv: [0, 0] }
      objects.set(label.object, object)
    }
    for (const chunk of [part, ...part.extra]) {
      for (let tri = 0; tri < chunk.tris; tri += 1) {
        const c: [Vec3, Vec3, Vec3] = [partCorner(chunk, tri, 0), partCorner(chunk, tri, 1), partCorner(chunk, tri, 2)]
        object.tris.push({ c, orig: originalByKey.get(triKey(...c)) ?? -1 })
      }
    }
  }
  const globalGrid = new TriGrid(originalCentroid, Array.from({ length: originalTriCount }, (_, i) => i))
  const originalPresent = new Set<number>()
  for (const object of objects.values()) {
    let bestArea = -1
    let bestTri = -1
    for (const tri of object.tris) {
      if (tri.orig < 0) continue
      originalPresent.add(tri.orig)
      const area = len(cross(sub(tri.c[1], tri.c[0]), sub(tri.c[2], tri.c[0])))
      if (area > bestArea) {
        bestArea = area
        bestTri = tri.orig
      }
    }
    // Опорная точка атласа — центр самого большого исходного треугольника части: ровный цвет для внутренних граней.
    if (bestTri >= 0) {
      const ia = OI[bestTri * 3]
      const ib = OI[bestTri * 3 + 1]
      const ic = OI[bestTri * 3 + 2]
      object.flatUv = [(OUV[ia * 2] + OUV[ib * 2] + OUV[ic * 2]) / 3, (OUV[ia * 2 + 1] + OUV[ib * 2 + 1] + OUV[ic * 2 + 1]) / 3]
    }
  }

  // ---------- граница между частями: сглаживание и утапливание ----------
  const edgeOwners = new Map<string, Set<string>>()
  const vertexNormal = new Map<string, Vec3>()
  for (const object of objects.values()) {
    for (const tri of object.tris) {
      const keys = tri.c.map(key3)
      for (let j = 0; j < 3; j += 1) {
        const edge = [keys[j], keys[(j + 1) % 3]].sort().join("~")
        const owners = edgeOwners.get(edge)
        if (owners) owners.add(object.name)
        else edgeOwners.set(edge, new Set([object.name]))
      }
      if (tri.orig < 0) continue
      const n = cross(sub(tri.c[1], tri.c[0]), sub(tri.c[2], tri.c[0]))
      for (const key of keys) {
        const acc = vertexNormal.get(key)
        if (acc) {
          acc[0] += n[0]
          acc[1] += n[1]
          acc[2] += n[2]
        } else vertexNormal.set(key, [...n])
      }
    }
  }
  const ring = new Map<string, Set<string>>()
  for (const [edge, owners] of edgeOwners) {
    if (owners.size < 2) continue
    const [a, b] = edge.split("~")
    ;(ring.get(a) ?? ring.set(a, new Set()).get(a)!).add(b)
    ;(ring.get(b) ?? ring.set(b, new Set()).get(b)!).add(a)
  }
  const component = new Map<string, number>()
  const componentSize: number[] = []
  for (const start of ring.keys()) {
    if (component.has(start)) continue
    const id = componentSize.length
    let count = 0
    const stack = [start]
    component.set(start, id)
    while (stack.length) {
      const vertex = stack.pop()!
      count += 1
      for (const next of ring.get(vertex)!) {
        if (component.has(next)) continue
        component.set(next, id)
        stack.push(next)
      }
    }
    componentSize.push(count)
  }
  const parse = (key: string) => key.split(",").map((v) => Number(v) / 1e5) as Vec3
  let positions = new Map<string, Vec3>()
  for (const vertex of ring.keys()) positions.set(vertex, parse(vertex))
  for (let iteration = 0; iteration < SMOOTH_ITERATIONS; iteration += 1) {
    const next = new Map<string, Vec3>()
    for (const [vertex, neighbours] of ring) {
      const current = positions.get(vertex)!
      if (componentSize[component.get(vertex)!] < MIN_RING || neighbours.size < 2) {
        next.set(vertex, current)
        continue
      }
      const average: Vec3 = [0, 0, 0]
      for (const neighbour of neighbours) {
        const p = positions.get(neighbour)!
        average[0] += p[0]
        average[1] += p[1]
        average[2] += p[2]
      }
      next.set(vertex, current.map((value, j) => value + SMOOTH_LAMBDA * (average[j] / neighbours.size - value)) as Vec3)
    }
    positions = next
  }
  const moved = new Map<string, Vec3>()
  for (const [vertex, p] of positions) {
    const n = vertexNormal.get(vertex) ?? [0, 0, 0]
    const l = len(n) || 1
    const groove = componentSize[component.get(vertex)!] >= MIN_RING ? GROOVE_M : 0
    moved.set(vertex, [p[0] - (n[0] / l) * groove, p[1] - (n[1] / l) * groove, p[2] - (n[2] / l) * groove])
  }

  // ---------- сборка объектов ----------
  const classes = new Map<MaterialClass, ClassTextures>()
  for (const object of objects.values()) if (!classes.has(object.cls)) classes.set(object.cls, await classTextures(object.cls))
  const built: { name: string; cls: MaterialClass; material: string; positions: Float32Array; normals: Float32Array; uv0: Float32Array; uv1: Float32Array; indices: Uint32Array }[] = []
  const parts: ModelPart[] = []
  for (const object of objects.values()) {
    const tile = classes.get(object.cls)!.tile
    const vertexIndex = new Map<string, number>()
    const P: number[] = []
    const UV0: number[] = []
    const UV1: number[] = []
    const IDX: number[] = []
    for (const tri of object.tris) {
      let uvs: [number, number][]
      if (tri.orig >= 0) {
        uvs = [0, 1, 2].map((j) => [OUV[OI[tri.orig * 3 + j] * 2], OUV[OI[tri.orig * 3 + j] * 2 + 1]] as [number, number])
      } else {
        const c = centroidOf(tri.c)
        const g = globalGrid.nearest(c)
        if (g >= 0) {
          const a = corner(g, 0)
          const ng = originalNormal(g)
          const nl = len(ng) || 1
          const distance = dot(sub(c, a), ng) / nl
          if (Math.abs(distance) < NEAR_M) {
            // Дубликат поверх живой поверхности или вывернутая внутрь грань у самой поверхности — просвечивают, убираем.
            if (originalPresent.has(g)) continue
            if (dot(cross(sub(tri.c[1], tri.c[0]), sub(tri.c[2], tri.c[0])), ng) < 0) continue
          }
        }
        uvs = [object.flatUv, object.flatUv, object.flatUv]
      }
      const corners = tri.c.map((p) => moved.get(key3(p)) ?? p) as [Vec3, Vec3, Vec3]
      const n = cross(sub(corners[1], corners[0]), sub(corners[2], corners[0])).map(Math.abs)
      const axis = n[0] >= n[1] && n[0] >= n[2] ? 0 : n[1] >= n[2] ? 1 : 2
      corners.forEach((w, j) => {
        const box = (axis === 0 ? [w[2], w[1]] : axis === 1 ? [w[0], w[2]] : [w[0], w[1]]).map((value) => value / tile)
        const key = `${key3(w)}|${Math.round(uvs[j][0] * 1e4)},${Math.round(uvs[j][1] * 1e4)}|${Math.round(box[0] * 1e3)},${Math.round(box[1] * 1e3)}`
        let index = vertexIndex.get(key)
        if (index === undefined) {
          index = P.length / 3
          vertexIndex.set(key, index)
          P.push(w[0], w[1], w[2])
          UV0.push(uvs[j][0], uvs[j][1])
          UV1.push(box[0], box[1])
        }
        IDX.push(index)
      })
    }
    if (IDX.length === 0) continue
    // Сглаженные нормали по позиции (с весом площади), чтобы швы сварки не читались.
    const accumulators = new Map<string, Vec3>()
    const positionKeys: string[] = []
    for (let v = 0; v < P.length / 3; v += 1) {
      const key = key3([P[v * 3], P[v * 3 + 1], P[v * 3 + 2]])
      positionKeys.push(key)
      if (!accumulators.has(key)) accumulators.set(key, [0, 0, 0])
    }
    for (let t = 0; t < IDX.length; t += 3) {
      const a = IDX[t] * 3
      const b = IDX[t + 1] * 3
      const c = IDX[t + 2] * 3
      const n = cross([P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]], [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]])
      for (const vi of [IDX[t], IDX[t + 1], IDX[t + 2]]) {
        const acc = accumulators.get(positionKeys[vi])!
        acc[0] += n[0]
        acc[1] += n[1]
        acc[2] += n[2]
      }
    }
    const N: number[] = []
    for (let v = 0; v < P.length / 3; v += 1) {
      const n = accumulators.get(positionKeys[v])!
      const l = len(n) || 1
      N.push(n[0] / l, n[1] / l, n[2] / l)
    }
    built.push({ name: object.name, cls: object.cls, material: object.material, positions: Float32Array.from(P), normals: Float32Array.from(N), uv0: Float32Array.from(UV0), uv1: Float32Array.from(UV1), indices: Uint32Array.from(IDX) })
    parts.push({ object: object.name, material: object.material, cls: object.cls, faces: IDX.length / 3 })
  }
  if (built.length < 2) throw new Error("После чистки осталась одна деталь.")

  // ---------- текстуры ----------
  const atlas: Record<"basecolor" | "metalrough" | "normal", { name: string; mime: string; bytes: Uint8Array } | null> = { basecolor: null, metalrough: null, normal: null }
  const atlasRole = (role: keyof typeof atlas, ref: { index: number } | undefined) => {
    const source = atlasIndex(ref)
    if (source === undefined) return
    const image = original.image(source)
    atlas[role] = { name: `atlas_${role}.${image.mime === "image/png" ? "png" : "jpg"}`, mime: image.mime, bytes: image.bytes }
  }
  atlasRole("basecolor", originalMaterial?.pbrMetallicRoughness?.baseColorTexture)
  atlasRole("metalrough", originalMaterial?.pbrMetallicRoughness?.metallicRoughnessTexture)
  atlasRole("normal", originalMaterial?.normalTexture)
  const materialNames = [...new Set(built.map((mesh) => mesh.material))]
  const classOf = new Map(built.map((mesh) => [mesh.material, mesh.cls] as const))

  // ---------- GLB: запечённая текстура Meshy на атласе, объекты и оба UV-канала ----------
  const glbTextures: GlbTexture[] = []
  const glbTexture = (role: keyof typeof atlas) => {
    const image = atlas[role]
    if (!image) return -1
    glbTextures.push({ name: role, mime: image.mime, bytes: image.bytes })
    return glbTextures.length - 1
  }
  const base = glbTexture("basecolor")
  const metalRough = glbTexture("metalrough")
  const normal = glbTexture("normal")
  const glbMaterials: GlbMaterial[] = materialNames.map((name) => ({
    name,
    baseColor: base,
    metallicRoughness: metalRough >= 0 ? metalRough : base,
    normal: normal >= 0 ? normal : base,
    texCoord: 0,
    metallicFactor: metalRough >= 0 ? 1 : 0,
    roughnessFactor: 1,
  }))
  const previewGlb = writeGlb(
    root,
    built.map((mesh) => ({ ...mesh, material: materialNames.indexOf(mesh.material) })),
    glbMaterials,
    glbTextures
  )

  // ---------- FBX: материалы по классам на box-развёртке; атлас рядом про запас ----------
  const tileFiles = new Map<string, Uint8Array>()
  const fbxTextures: FbxTexture[] = []
  for (const name of materialNames) {
    const textures = classes.get(classOf.get(name)!)!
    for (const slot of ["basecolor", "normal", "metalrough"] as const) {
      const file = textures.files[slot]
      tileFiles.set(file.name, file.bytes)
      fbxTextures.push({ id: `${name}_${slot}`, file: file.name, material: name, slot, uvSet: "BoxMap" })
    }
  }
  const fbxText = writeFbx(
    root,
    built,
    materialNames.map((name) => ({ name, metallic: classes.get(classOf.get(name)!)!.metallic > 0.5 })),
    fbxTextures
  )
  const encoder = new TextEncoder()
  const textureEntries: ZipEntry[] = [
    ...[...tileFiles].map(([name, bytes]) => ({ name, bytes, compress: false })),
    ...Object.values(atlas)
      .filter((image): image is NonNullable<typeof image> => Boolean(image))
      .map((image) => ({ name: image.name, bytes: image.bytes, compress: false })),
  ]
  const fbx: ZipEntry[] = [{ name: `${root}.fbx`, bytes: encoder.encode(fbxText) }, ...textureEntries]

  // ---------- OBJ + MTL: один UV-канал — box-развёртка с тайлом ----------
  let objText = `mtllib ${root}.mtl\n`
  let offset = 1
  for (const mesh of built) {
    objText += `o ${mesh.name}\nusemtl ${mesh.material}\n`
    for (let v = 0; v < mesh.positions.length; v += 3) objText += `v ${mesh.positions[v].toFixed(5)} ${mesh.positions[v + 1].toFixed(5)} ${mesh.positions[v + 2].toFixed(5)}\n`
    for (let v = 0; v < mesh.uv1.length; v += 2) objText += `vt ${mesh.uv1[v].toFixed(5)} ${mesh.uv1[v + 1].toFixed(5)}\n`
    for (let v = 0; v < mesh.normals.length; v += 3) objText += `vn ${mesh.normals[v].toFixed(4)} ${mesh.normals[v + 1].toFixed(4)} ${mesh.normals[v + 2].toFixed(4)}\n`
    objText += "s 1\n"
    for (let t = 0; t < mesh.indices.length; t += 3) {
      const face = [mesh.indices[t], mesh.indices[t + 1], mesh.indices[t + 2]].map((i) => `${i + offset}/${i + offset}/${i + offset}`)
      objText += `f ${face.join(" ")}\n`
    }
    offset += mesh.positions.length / 3
  }
  const mtlText = materialNames
    .map((name) => {
      const textures = classes.get(classOf.get(name)!)!
      const metallic = textures.metallic > 0.5
      return `newmtl ${name}\nKd 1 1 1\nKs ${metallic ? "0.9 0.9 0.9" : "0.05 0.05 0.05"}\nNs ${metallic ? 200 : 15}\nmap_Kd ${textures.files.basecolor.name}\nmap_Bump ${textures.files.normal.name}\n`
    })
    .join("\n")
  const obj: ZipEntry[] = [{ name: `${root}.obj`, bytes: encoder.encode(objText) }, { name: `${root}.mtl`, bytes: encoder.encode(mtlText) }, ...textureEntries]

  return { previewGlb, fbx, obj, parts, size }
}
