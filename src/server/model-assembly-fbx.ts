import "server-only"

/**
 * Экспорт в ASCII FBX 7.4 для 3ds Max: отдельный `Model`/`Geometry` на каждый
 * объект, именованные материалы, текстуры по относительным именам файлов
 * (лежат рядом в архиве), два UV-набора — `UVMap` (атлас) и `BoxMap`
 * (box-развёртка под тайлящиеся материалы). Координаты в сантиметрах
 * (`UnitScaleFactor: 1`), ось Y вверх — импортёр Max переводит сам.
 *
 * Бинарный FBX нам не нужен: Max, Blender и three.js читают ASCII напрямую,
 * а писать его без SDK проще и безопаснее.
 */

export interface FbxMesh {
  name: string
  /** Метры. */
  positions: Float32Array
  normals: Float32Array
  uv0: Float32Array
  uv1: Float32Array
  indices: Uint32Array
  material: string
}

export interface FbxMaterial {
  name: string
  metallic: boolean
}

export interface FbxTexture {
  /** Уникальное имя внутри FBX. */
  id: string
  file: string
  material: string
  slot: "basecolor" | "normal" | "metalrough"
  uvSet: "UVMap" | "BoxMap"
}

const SLOT_PROPERTY: Record<FbxTexture["slot"], string> = { basecolor: "DiffuseColor", normal: "NormalMap", metalrough: "SpecularColor" }

const num = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/\.?0+$/, ""))
function list(values: ArrayLike<number>, map: (value: number, index: number) => number = (v) => v): string {
  const rows: string[] = []
  for (let i = 0; i < values.length; i += 1000) {
    const row: string[] = []
    for (let k = i; k < Math.min(values.length, i + 1000); k += 1) row.push(num(map(values[k], k)))
    rows.push(row.join(","))
  }
  return rows.join(",\n")
}

export function writeFbx(root: string, meshes: FbxMesh[], materials: FbxMaterial[], textures: FbxTexture[]): string {
  const out: string[] = []
  let nextId = 100000
  const id = () => (nextId += 1)
  const geometryIds = meshes.map(id)
  const modelIds = meshes.map(id)
  const rootId = id()
  const materialIds = materials.map(id)
  const textureIds = textures.map(id)
  const videoIds = textures.map(id)

  out.push(
    "; FBX 7.4.0 project file",
    "FBXHeaderExtension:  {",
    "\tFBXHeaderVersion: 1003",
    "\tFBXVersion: 7400",
    '\tCreator: "Dizzit AI"',
    "}",
    "GlobalSettings:  {",
    "\tVersion: 1000",
    "\tProperties70:  {",
    '\t\tP: "UpAxis", "int", "Integer", "",1',
    '\t\tP: "UpAxisSign", "int", "Integer", "",1',
    '\t\tP: "FrontAxis", "int", "Integer", "",2',
    '\t\tP: "FrontAxisSign", "int", "Integer", "",1',
    '\t\tP: "CoordAxis", "int", "Integer", "",0',
    '\t\tP: "CoordAxisSign", "int", "Integer", "",1',
    '\t\tP: "OriginalUpAxis", "int", "Integer", "",1',
    '\t\tP: "OriginalUpAxisSign", "int", "Integer", "",1',
    '\t\tP: "UnitScaleFactor", "double", "Number", "",1',
    '\t\tP: "OriginalUnitScaleFactor", "double", "Number", "",1',
    "\t}",
    "}",
    "Definitions:  {",
    "\tVersion: 100",
    `\tCount: ${meshes.length * 2 + 1 + materials.length + textures.length * 2}`,
    `\tObjectType: "Geometry" {\n\t\tCount: ${meshes.length}\n\t}`,
    `\tObjectType: "Model" {\n\t\tCount: ${meshes.length + 1}\n\t}`,
    `\tObjectType: "Material" {\n\t\tCount: ${materials.length}\n\t}`,
    `\tObjectType: "Texture" {\n\t\tCount: ${textures.length}\n\t}`,
    `\tObjectType: "Video" {\n\t\tCount: ${textures.length}\n\t}`,
    "}",
    "Objects:  {"
  )

  meshes.forEach((mesh, index) => {
    const polygons: number[] = []
    for (let t = 0; t < mesh.indices.length; t += 3) polygons.push(mesh.indices[t], mesh.indices[t + 1], -(mesh.indices[t + 2] + 1))
    const normals: number[] = []
    for (const vertex of mesh.indices) normals.push(mesh.normals[vertex * 3], mesh.normals[vertex * 3 + 1], mesh.normals[vertex * 3 + 2])
    const uvLayer = (layer: number, name: string, uv: Float32Array) => [
      `\t\tLayerElementUV: ${layer} {`,
      "\t\t\tVersion: 101",
      `\t\t\tName: "${name}"`,
      '\t\t\tMappingInformationType: "ByPolygonVertex"',
      '\t\t\tReferenceInformationType: "IndexToDirect"',
      // В FBX V направлен вверх — glTF хранит его сверху вниз.
      `\t\t\tUV: *${uv.length} {\n\t\t\t\ta: ${list(uv, (value, k) => (k % 2 ? 1 - value : value))}\n\t\t\t}`,
      `\t\t\tUVIndex: *${mesh.indices.length} {\n\t\t\t\ta: ${list(mesh.indices)}\n\t\t\t}`,
      "\t\t}",
    ]
    out.push(
      `\tGeometry: ${geometryIds[index]}, "Geometry::${mesh.name}", "Mesh" {`,
      `\t\tVertices: *${mesh.positions.length} {\n\t\t\ta: ${list(mesh.positions, (value) => value * 100)}\n\t\t}`,
      `\t\tPolygonVertexIndex: *${polygons.length} {\n\t\t\ta: ${list(polygons)}\n\t\t}`,
      "\t\tGeometryVersion: 124",
      "\t\tLayerElementNormal: 0 {",
      "\t\t\tVersion: 101",
      '\t\t\tName: ""',
      '\t\t\tMappingInformationType: "ByPolygonVertex"',
      '\t\t\tReferenceInformationType: "Direct"',
      `\t\t\tNormals: *${normals.length} {\n\t\t\t\ta: ${list(normals)}\n\t\t\t}`,
      "\t\t}",
      ...uvLayer(0, "UVMap", mesh.uv0),
      ...uvLayer(1, "BoxMap", mesh.uv1),
      "\t\tLayerElementMaterial: 0 {",
      "\t\t\tVersion: 101",
      '\t\t\tName: ""',
      '\t\t\tMappingInformationType: "AllSame"',
      '\t\t\tReferenceInformationType: "IndexToDirect"',
      "\t\t\tMaterials: *1 {\n\t\t\t\ta: 0\n\t\t\t}",
      "\t\t}",
      "\t\tLayer: 0 {",
      "\t\t\tVersion: 100",
      '\t\t\tLayerElement:  {\n\t\t\t\tType: "LayerElementNormal"\n\t\t\t\tTypedIndex: 0\n\t\t\t}',
      '\t\t\tLayerElement:  {\n\t\t\t\tType: "LayerElementMaterial"\n\t\t\t\tTypedIndex: 0\n\t\t\t}',
      '\t\t\tLayerElement:  {\n\t\t\t\tType: "LayerElementUV"\n\t\t\t\tTypedIndex: 0\n\t\t\t}',
      "\t\t}",
      "\t\tLayer: 1 {",
      "\t\t\tVersion: 100",
      '\t\t\tLayerElement:  {\n\t\t\t\tType: "LayerElementUV"\n\t\t\t\tTypedIndex: 1\n\t\t\t}',
      "\t\t}",
      "\t}",
      `\tModel: ${modelIds[index]}, "Model::${mesh.name}", "Mesh" {`,
      "\t\tVersion: 232",
      "\t\tProperties70:  {",
      '\t\t\tP: "Lcl Translation", "Lcl Translation", "", "A",0,0,0',
      '\t\t\tP: "Lcl Rotation", "Lcl Rotation", "", "A",0,0,0',
      '\t\t\tP: "Lcl Scaling", "Lcl Scaling", "", "A",1,1,1',
      '\t\t\tP: "DefaultAttributeIndex", "int", "Integer", "",0',
      "\t\t}",
      "\t\tShading: T",
      '\t\tCulling: "CullingOff"',
      "\t}"
    )
  })
  out.push(
    `\tModel: ${rootId}, "Model::${root}", "Null" {`,
    "\t\tVersion: 232",
    "\t\tProperties70:  {",
    '\t\t\tP: "Lcl Translation", "Lcl Translation", "", "A",0,0,0',
    "\t\t}",
    "\t\tShading: T",
    '\t\tCulling: "CullingOff"',
    "\t}"
  )
  materials.forEach((material, index) =>
    out.push(
      `\tMaterial: ${materialIds[index]}, "Material::${material.name}", "" {`,
      "\t\tVersion: 102",
      '\t\tShadingModel: "phong"',
      "\t\tMultiLayer: 0",
      "\t\tProperties70:  {",
      '\t\t\tP: "DiffuseColor", "Color", "", "A",1,1,1',
      `\t\t\tP: "SpecularColor", "Color", "", "A",${material.metallic ? "0.9,0.9,0.9" : "0.05,0.05,0.05"}`,
      `\t\t\tP: "ShininessExponent", "Number", "", "A",${material.metallic ? 200 : 20}`,
      '\t\t\tP: "Emissive", "Vector3D", "Vector", "",0,0,0',
      '\t\t\tP: "Ambient", "Vector3D", "Vector", "",0,0,0',
      '\t\t\tP: "Diffuse", "Vector3D", "Vector", "",1,1,1',
      '\t\t\tP: "Opacity", "double", "Number", "",1',
      "\t\t}",
      "\t}"
    )
  )
  textures.forEach((texture, index) =>
    out.push(
      `\tTexture: ${textureIds[index]}, "Texture::${texture.id}", "" {`,
      '\t\tType: "TextureVideoClip"',
      "\t\tVersion: 202",
      `\t\tTextureName: "Texture::${texture.id}"`,
      "\t\tProperties70:  {",
      `\t\t\tP: "UVSet", "KString", "", "", "${texture.uvSet}"`,
      '\t\t\tP: "UseMaterial", "bool", "", "",1',
      "\t\t}",
      `\t\tMedia: "Video::${texture.id}"`,
      `\t\tFileName: "${texture.file}"`,
      `\t\tRelativeFilename: "${texture.file}"`,
      "\t\tModelUVTranslation: 0,0",
      "\t\tModelUVScaling: 1,1",
      '\t\tTexture_Alpha_Source: "None"',
      "\t\tCropping: 0,0,0,0",
      "\t}",
      `\tVideo: ${videoIds[index]}, "Video::${texture.id}", "Clip" {`,
      '\t\tType: "Clip"',
      "\t\tProperties70:  {",
      `\t\t\tP: "Path", "KString", "XRefUrl", "", "${texture.file}"`,
      "\t\t}",
      "\t\tUseMipMap: 0",
      `\t\tFilename: "${texture.file}"`,
      `\t\tRelativeFilename: "${texture.file}"`,
      "\t}"
    )
  )
  out.push("}", "Connections:  {", `\tC: "OO",${rootId},0`)
  meshes.forEach((mesh, index) => {
    const material = materialIds[materials.findIndex((item) => item.name === mesh.material)]
    out.push(`\tC: "OO",${modelIds[index]},${rootId}`, `\tC: "OO",${geometryIds[index]},${modelIds[index]}`, `\tC: "OO",${material},${modelIds[index]}`)
  })
  textures.forEach((texture, index) => {
    const material = materialIds[materials.findIndex((item) => item.name === texture.material)]
    out.push(`\tC: "OP",${textureIds[index]},${material}, "${SLOT_PROPERTY[texture.slot]}"`, `\tC: "OO",${videoIds[index]},${textureIds[index]}`)
  })
  out.push("}")
  return `${out.join("\n")}\n`
}
