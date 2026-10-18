import "server-only"

/**
 * Чтение и запись GLB без зависимостей — ровно то, что нужно сборке модели
 * «по канонам» (`src/server/model-assembly.ts`): позиции, индексы, UV, цвет
 * вершин и встроенные картинки на входе; несколько именованных мешей с двумя
 * UV-каналами, материалами и текстурами на выходе.
 */

const COMPONENT: Record<number, { ctor: new (buffer: ArrayBufferLike, byteOffset: number, length: number) => ArrayLike<number>; size: number }> = {
  5120: { ctor: Int8Array, size: 1 },
  5121: { ctor: Uint8Array, size: 1 },
  5122: { ctor: Int16Array, size: 2 },
  5123: { ctor: Uint16Array, size: 2 },
  5125: { ctor: Uint32Array, size: 4 },
  5126: { ctor: Float32Array, size: 4 },
}
const COUNT: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }

export interface GltfJson {
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean; min?: number[]; max?: number[] }[]
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number; target?: number }[]
  images?: { bufferView?: number; mimeType?: string; name?: string }[]
  materials?: {
    name?: string
    normalTexture?: { index: number }
    pbrMetallicRoughness?: { baseColorTexture?: { index: number }; metallicRoughnessTexture?: { index: number } }
  }[]
  textures?: { source?: number }[]
  meshes?: { name?: string; primitives: { attributes: Record<string, number>; indices?: number; material?: number; mode?: number }[] }[]
}

export interface GlbFile {
  json: GltfJson
  /** Числа аксессора подряд (без шага между элементами). */
  accessor(index: number): { data: Float64Array; width: number }
  /** Картинка по индексу `images` (через её `textures[i].source`). */
  image(index: number): { mime: string; bytes: Uint8Array }
}

export function readGlb(file: Uint8Array): GlbFile {
  const buf = Buffer.from(file.buffer, file.byteOffset, file.byteLength)
  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) throw new Error("Не GLB")
  const jsonLength = buf.readUInt32LE(12)
  const json = JSON.parse(buf.subarray(20, 20 + jsonLength).toString("utf8")) as GltfJson
  const binLength = buf.readUInt32LE(20 + jsonLength)
  const bin = buf.subarray(28 + jsonLength, 28 + jsonLength + binLength)
  return {
    json,
    accessor(index) {
      const a = json.accessors?.[index]
      if (!a || a.bufferView === undefined) throw new Error(`Нет аксессора ${index}`)
      const view = json.bufferViews?.[a.bufferView]
      if (!view) throw new Error(`Нет bufferView ${a.bufferView}`)
      const { ctor, size } = COMPONENT[a.componentType]
      const width = COUNT[a.type]
      const stride = view.byteStride || size * width
      const base = (view.byteOffset || 0) + (a.byteOffset || 0)
      const out = new Float64Array(a.count * width)
      const norm = a.normalized ? (a.componentType === 5121 ? 255 : a.componentType === 5123 ? 65535 : 1) : 1
      for (let k = 0; k < a.count; k += 1) {
        const row = new ctor(bin.buffer, bin.byteOffset + base + k * stride, width)
        for (let j = 0; j < width; j += 1) out[k * width + j] = row[j] / norm
      }
      return { data: out, width }
    },
    image(index) {
      const image = json.images?.[index]
      if (!image || image.bufferView === undefined) throw new Error(`Нет картинки ${index}`)
      const view = json.bufferViews![image.bufferView]
      return { mime: image.mimeType ?? "image/png", bytes: bin.subarray(view.byteOffset || 0, (view.byteOffset || 0) + view.byteLength) }
    },
  }
}

export interface GlbMesh {
  name: string
  positions: Float32Array
  normals: Float32Array
  uv0: Float32Array
  uv1: Float32Array
  indices: Uint32Array
  material: number
}

export interface GlbMaterial {
  name: string
  baseColor: number
  metallicRoughness: number
  normal: number
  /** Какой UV-канал у текстур: 0 — атлас, 1 — box-развёртка. */
  texCoord: 0 | 1
  metallicFactor: number
  roughnessFactor: number
}

export interface GlbTexture {
  name: string
  mime: string
  bytes: Uint8Array
}

/** Собрать GLB: один корневой узел-группа, под ним меш на каждый объект. */
export function writeGlb(root: string, meshes: GlbMesh[], materials: GlbMaterial[], textures: GlbTexture[]): Uint8Array {
  const chunks: Buffer[] = []
  let byteLength = 0
  const bufferViews: NonNullable<GltfJson["bufferViews"]> = []
  const accessors: NonNullable<GltfJson["accessors"]> = []
  const pushView = (bytes: Uint8Array, target?: number) => {
    const pad = (4 - (bytes.byteLength % 4)) % 4
    chunks.push(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    if (pad) chunks.push(Buffer.alloc(pad))
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.byteLength, ...(target ? { target } : {}) })
    byteLength += bytes.byteLength + pad
    return bufferViews.length - 1
  }
  const pushAccessor = (array: Float32Array | Uint32Array, type: string, componentType: number, target: number, bounds = false) => {
    const width = COUNT[type]
    const accessor: NonNullable<GltfJson["accessors"]>[number] = {
      bufferView: pushView(new Uint8Array(array.buffer, array.byteOffset, array.byteLength), target),
      componentType,
      count: array.length / width,
      type,
    }
    if (bounds) {
      accessor.min = Array(width).fill(Infinity)
      accessor.max = Array(width).fill(-Infinity)
      for (let i = 0; i < array.length; i += 1) {
        accessor.min[i % width] = Math.min(accessor.min[i % width], array[i])
        accessor.max[i % width] = Math.max(accessor.max[i % width], array[i])
      }
    }
    accessors.push(accessor)
    return accessors.length - 1
  }

  const images = textures.map((texture) => ({ bufferView: pushView(texture.bytes), mimeType: texture.mime, name: texture.name }))
  const gltfMeshes = meshes.map((mesh) => ({
    name: mesh.name,
    primitives: [
      {
        attributes: {
          POSITION: pushAccessor(mesh.positions, "VEC3", 5126, 34962, true),
          NORMAL: pushAccessor(mesh.normals, "VEC3", 5126, 34962),
          TEXCOORD_0: pushAccessor(mesh.uv0, "VEC2", 5126, 34962),
          TEXCOORD_1: pushAccessor(mesh.uv1, "VEC2", 5126, 34962),
        },
        indices: pushAccessor(mesh.indices, "SCALAR", 5125, 34963),
        material: mesh.material,
      },
    ],
  }))
  const nodes: { name: string; mesh?: number; children?: number[] }[] = meshes.map((mesh, index) => ({ name: mesh.name, mesh: index }))
  nodes.push({ name: root, children: meshes.map((_, index) => index) })
  const gltf = {
    asset: { version: "2.0", generator: "dizzit" },
    scene: 0,
    scenes: [{ nodes: [nodes.length - 1] }],
    nodes,
    meshes: gltfMeshes,
    materials: materials.map((material) => ({
      name: material.name,
      pbrMetallicRoughness: {
        baseColorTexture: { index: material.baseColor, texCoord: material.texCoord },
        metallicRoughnessTexture: { index: material.metallicRoughness, texCoord: material.texCoord },
        metallicFactor: material.metallicFactor,
        roughnessFactor: material.roughnessFactor,
      },
      normalTexture: { index: material.normal, texCoord: material.texCoord },
    })),
    textures: images.map((_, index) => ({ source: index, sampler: 0 })),
    images,
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    buffers: [{ byteLength }],
    bufferViews,
    accessors,
  }
  const jsonBytes = Buffer.from(JSON.stringify(gltf))
  const jsonPad = (4 - (jsonBytes.length % 4)) % 4
  const bin = Buffer.concat(chunks)
  const header = Buffer.alloc(12)
  header.write("glTF", 0)
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(28 + jsonBytes.length + jsonPad + bin.length, 8)
  const jsonChunk = Buffer.alloc(8)
  jsonChunk.writeUInt32LE(jsonBytes.length + jsonPad, 0)
  jsonChunk.writeUInt32LE(0x4e4f534a, 4)
  const binChunk = Buffer.alloc(8)
  binChunk.writeUInt32LE(bin.length, 0)
  binChunk.writeUInt32LE(0x004e4942, 4)
  return new Uint8Array(Buffer.concat([header, jsonChunk, jsonBytes, Buffer.alloc(jsonPad, 0x20), binChunk, bin]))
}
