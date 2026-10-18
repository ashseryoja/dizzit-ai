import React from "react"
import { AbsoluteFill, Img, continueRender, delayRender, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion"
import type { LabImage, LabTheme } from "./types"

/** Контракт задания в виде пропсов Remotion: то же, что получает Hyperframes-композиция. */
export type LabRemotionProps = { templateId: string; photos: LabImage[]; fields: Record<string, string>; theme: LabTheme; format: string }

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const
const fonts = [
  ["Lab Grotesk", "creative-lab/hf/_shared/fonts/golos-latin.woff2", "U+0000-00FF, U+2000-206F"],
  ["Lab Grotesk", "creative-lab/hf/_shared/fonts/golos-cyrillic.woff2", "U+0400-045F, U+0490-0491, U+2116"],
  ["Lab Mono", "creative-lab/hf/_shared/fonts/mono-latin.woff2", "U+0000-00FF, U+2000-206F"],
  ["Lab Mono", "creative-lab/hf/_shared/fonts/mono-cyrillic.woff2", "U+0400-045F, U+0490-0491, U+2116"],
] as const
let fontsReady: Promise<void> | undefined
function useLabFonts() {
  const [handle] = React.useState(() => delayRender("Creative Lab fonts"))
  React.useEffect(() => {
    fontsReady ??= Promise.all(fonts.map(async ([family, file, unicodeRange]) => {
      const face = new FontFace(family, `url(${staticFile(file)})`, { weight: "100 900", unicodeRange })
      document.fonts.add(await face.load())
    })).then(() => undefined)
    void fontsReady.finally(() => continueRender(handle))
  }, [handle])
}

/** Тот же жёсткий редакторский язык, что и у Hyperframes-шаблонов: резкие склейки, индекс, инверсный финал. */
export function LabRemotionComposition({ photos, fields, theme }: LabRemotionProps) {
  useLabFonts()
  const frame = useCurrentFrame()
  const { fps, durationInFrames, width, height } = useVideoConfig()
  const ink = "#101010", off = "#ededea", accent = /^#[0-9a-f]{6}$/i.test(fields.accent ?? "") ? fields.accent : "#ff5a1f"
  const [fg, bg] = theme === "light" ? [ink, off] : [off, ink]
  const beat = fps / 2
  const hold = beat * 2.6
  const endAt = durationInFrames - beat * 5
  const index = Math.min(photos.length - 1, Math.floor(frame / hold))
  const local = frame - index * hold
  const scale = interpolate(local, [0, beat * .9], [1.08, 1], { ...clamp, easing: t => 1 - Math.pow(1 - t, 4) })
  const title = fields.title ?? ""
  const blockY = interpolate(frame, [endAt, endAt + beat * .8], [100, 0], { ...clamp, easing: t => t < .5 ? 8 * t ** 4 : 1 - Math.pow(-2 * t + 2, 4) / 2 })
  if (!photos.length) return <AbsoluteFill style={{ background: bg }} />
  return <AbsoluteFill style={{ background: bg, fontFamily: "'Lab Grotesk', sans-serif", color: off }}>
    <AbsoluteFill style={{ transform: `scale(${scale})` }}><Img src={photos[index].src} style={{ width: "100%", height: "100%", objectFit: "cover", objectPosition: `${photos[index].x}% ${photos[index].y}%` }} /></AbsoluteFill>
    <div style={{ position: "absolute", left: 64, top: 220, right: 130, display: "flex", justifyContent: "space-between", fontFamily: "'Lab Mono', monospace", fontSize: 34, textTransform: "uppercase" }}><span>{title}</span><span>{String(index + 1).padStart(2, "0")} / {String(photos.length).padStart(2, "0")}</span></div>
    <div style={{ position: "absolute", right: -24, bottom: 220, fontFamily: "'Lab Mono', monospace", fontWeight: 300, fontSize: 420, lineHeight: .8, letterSpacing: "-.08em", color: "#fff", mixBlendMode: "difference" }}>{String(index + 1).padStart(2, "0")}</div>
    {photos[index].caption && <div style={{ position: "absolute", left: 64, right: 130, bottom: 340, fontSize: 76, fontWeight: 800, lineHeight: .98, letterSpacing: "-.035em", textTransform: "uppercase", textShadow: "0 0 40px rgba(16,16,16,.5)" }}>{photos[index].caption}</div>}
    <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: height * .4, background: fg, color: bg, transform: `translateY(${blockY}%)`, padding: `56px 130px 340px 64px`, display: "flex", flexDirection: "column", justifyContent: "flex-end", gap: 22 }}>
      <span style={{ display: "block", width: 140, height: 10, background: accent }} />
      <div style={{ fontSize: 76, fontWeight: 800, lineHeight: .98, letterSpacing: "-.035em", textTransform: "uppercase", maxWidth: width - 194 }}>{title}</div>
      <div style={{ fontFamily: "'Lab Mono', monospace", fontSize: 34, textTransform: "uppercase", opacity: .62 }}>{fields.meta ?? fields.scope ?? ""}</div>
    </div>
  </AbsoluteFill>
}
