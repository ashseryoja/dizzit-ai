import "server-only"

import sharp from "sharp"

/**
 * Финальный проход рендера по образцу канонизации обложек UpSound:
 * точный размер, Lanczos и JPEG высокого качества без цветовой субдискретизации.
 */
export async function resizeToLongSideLanczos(
  input: Uint8Array,
  longSide: number
): Promise<{ bytes: Uint8Array; mimeType: "image/jpeg"; width: number; height: number }> {
  const source = sharp(input, { limitInputPixels: 100_000_000 })
  const metadata = await source.metadata()
  const oriented = metadata.autoOrient
  const sourceWidth = oriented?.width ?? metadata.width
  const sourceHeight = oriented?.height ?? metadata.height
  if (!sourceWidth || !sourceHeight) throw new Error("Не удалось определить размер результата генерации")

  const landscape = sourceWidth >= sourceHeight
  const width = landscape ? longSide : Math.max(1, Math.round((sourceWidth / sourceHeight) * longSide))
  const height = landscape ? Math.max(1, Math.round((sourceHeight / sourceWidth) * longSide)) : longSide

  const { data, info } = await source
    .autoOrient()
    .resize(width, height, {
      fit: "fill",
      kernel: sharp.kernel.lanczos3,
      withoutEnlargement: false,
      fastShrinkOnLoad: false,
    })
    .flatten({ background: "#ffffff" })
    .toColourspace("srgb")
    .jpeg({
      quality: 95,
      chromaSubsampling: "4:4:4",
      progressive: true,
      optimiseCoding: true,
    })
    .toBuffer({ resolveWithObject: true })

  return {
    bytes: new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    mimeType: "image/jpeg",
    width: info.width,
    height: info.height,
  }
}
