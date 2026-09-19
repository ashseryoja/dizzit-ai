import React from "react"
import { AbsoluteFill, Img, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion"
import type { LabCompositionProps, LabImage } from "./types"

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const
function Photo({ image, style }: { image: LabImage; style?: React.CSSProperties }) {
  return <Img src={image.src} style={{ width: "100%", height: "100%", objectFit: image.fit, objectPosition: `${image.x}% ${image.y}%`, ...style }} />
}

/** One deterministic composition for the Player, exported video and catalogue demos. */
export function LabComposition({ templateId, images, title }: LabCompositionProps) {
  const frame = useCurrentFrame()
  const { width, height, fps, durationInFrames } = useVideoConfig()
  const unit = Math.min(width, height)
  const safeTitle = title.slice(0, 64)
  const segment = durationInFrames / Math.max(1, images.length)
  const index = Math.min(images.length - 1, Math.floor(frame / segment))
  const local = frame - index * segment
  const fade = interpolate(frame, [0, 10, durationInFrames - 12, durationInFrames - 1], [0, 1, 1, 0], clamp)
  if (!images.length) return <AbsoluteFill style={{ background: "#19191c" }} />
  const typeStyle: React.CSSProperties = { fontFamily: "Arial, sans-serif", color: "white", letterSpacing: "-0.04em", fontWeight: 700 }
  const footer = <div style={{ position: "absolute", left: unit * .065, bottom: unit * .09, right: unit * .065, ...typeStyle, fontSize: unit * .063, lineHeight: 1.05, overflowWrap: "anywhere", textShadow: "0 2px 20px #0008" }}>{safeTitle}</div>

  if (templateId === "polaroid") {
    const cardW = Math.min(width * .73, height * .68)
    return <AbsoluteFill style={{ background: "#e6ddcd", overflow: "hidden", opacity: fade }}>
      <div style={{ position: "absolute", inset: unit * .05, border: "1px solid #766a5733" }} />
      <div style={{ position: "absolute", top: unit * .08, left: unit * .07, font: `${unit * .02}px monospace`, color: "#6b5e4c", letterSpacing: ".25em" }}>COLLECTED / MOMENTS</div>
      {images.map((image, i) => {
        const arrive = spring({ frame: frame - i * segment, fps, config: { damping: 17, stiffness: 100 } })
        const rot = [-8, 7, -5, 5, -2][i % 5]
        return <div key={i} style={{ position: "absolute", width: cardW, height: cardW * 1.13, left: (width - cardW) / 2, top: (height - cardW * 1.13) / 2 - unit * .025, padding: cardW * .038, paddingBottom: cardW * .13, background: "#fffaf0", boxSizing: "border-box", boxShadow: "0 22px 55px #48382d50", transform: `translateY(${(1 - arrive) * height}px) rotate(${rot + (1 - arrive) * 22}deg)`, opacity: Math.max(0, Math.min(1, arrive * 3)) }}><Photo image={image} /><div style={{ font: `${unit * .025}px monospace`, color: "#51493e", marginTop: cardW * .027 }}>{String(i + 1).padStart(2, "0")} / {safeTitle.slice(0, 26)}</div></div>
      })}
    </AbsoluteFill>
  }
  if (templateId === "split" || templateId === "paper-reveal") {
    const reveal = interpolate(frame / durationInFrames, [0, .15, .55, .8, 1], [0, 0, 1, 1, 1], clamp)
    const zoom = 1 + frame / durationInFrames * .04
    return <AbsoluteFill style={{ background: "#1b1b1b", opacity: fade }}>
      <AbsoluteFill style={{ transform: `scale(${zoom})` }}><Photo image={images[0]} /></AbsoluteFill>
      <AbsoluteFill style={{ clipPath: `inset(0 ${(1 - reveal) * 100}% 0 0)`, transform: `scale(${zoom})` }}><Photo image={images[1] ?? images[0]} /></AbsoluteFill>
      <div style={{ position: "absolute", left: `${reveal * 100}%`, height: "100%", width: 3, background: "#fff", boxShadow: "0 0 30px #fff8" }} />
      <AbsoluteFill style={{ background: "linear-gradient(0deg,#0009,transparent 40%)" }} />
      <div style={{ position: "absolute", top: unit * .075, left: unit * .065, ...typeStyle, fontSize: unit * .025, letterSpacing: ".2em" }}>{templateId === "paper-reveal" ? "INTO / PAPER" : "BEFORE / AFTER"}</div>
      {footer}
    </AbsoluteFill>
  }
  if (templateId === "kinetic") {
    const grid = frame > durationInFrames * .67
    const shot = Math.floor(frame / 15) % images.length
    return <AbsoluteFill style={{ background: "#17161a", overflow: "hidden", opacity: fade }}>
      {grid ? <div style={{ position: "absolute", inset: unit * .045, bottom: unit * .23, display: "grid", gridTemplateColumns: "1fr 1fr", gridTemplateRows: "repeat(3,1fr)", gap: unit * .015 }}>{images.map((image, i) => <div key={i} style={{ overflow: "hidden", transform: `scale(${spring({ frame: frame - Math.round(durationInFrames * .67) - i * 2, fps, config: { damping: 18 } })})` }}><Photo image={image} /></div>)}</div> : <AbsoluteFill style={{ transform: `scale(${interpolate(frame % 15, [0, 14], [1.12, 1], clamp)})` }}><Photo image={images[shot]} /><AbsoluteFill style={{ background: "#0002" }} /></AbsoluteFill>}
      <div style={{ position: "absolute", right: unit * .065, top: unit * .05, ...typeStyle, fontSize: unit * .12 }}>{String(shot + 1).padStart(2, "0")}</div>
      {footer}
    </AbsoluteFill>
  }
  const scale = interpolate(local, [0, segment], [1.08, 1], clamp)
  return <AbsoluteFill style={{ background: "#191a17", opacity: fade, overflow: "hidden" }}>
    <AbsoluteFill style={{ transform: `scale(${scale})` }}><Photo image={images[index]} /></AbsoluteFill>
    <AbsoluteFill style={{ background: "linear-gradient(0deg,#000b,transparent 60%)" }} />
    <div style={{ position: "absolute", inset: unit * .05, border: "1px solid #ffffff70" }} />
    <div style={{ position: "absolute", top: unit * .08, left: unit * .085, font: `${unit * .024}px monospace`, letterSpacing: ".16em", color: "#fff" }}>VISUAL JOURNAL / {String(index + 1).padStart(2, "0")}</div>
    <div style={{ position: "absolute", left: unit * .085, right: unit * .085, bottom: unit * .15, ...typeStyle, fontSize: unit * .1, lineHeight: .98, overflowWrap: "anywhere", transform: `translateY(${interpolate(local, [0, 15], [25, 0], clamp)}px)` }}>{safeTitle}</div>
    <div style={{ position: "absolute", bottom: unit * .085, left: unit * .085, height: 3, width: (width - unit * .17) * frame / durationInFrames, background: "#fff" }} />
  </AbsoluteFill>
}
