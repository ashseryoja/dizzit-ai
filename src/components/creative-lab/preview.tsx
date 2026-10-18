"use client"
import { useEffect, useRef, useState } from "react"
import { composeDocument, compositionVariables, loadTemplateHtml } from "@/creative-lab/compose"
import { DIMENSIONS, type LabFormat, type LabImage, type LabTemplate, type LabTheme } from "@/creative-lab/types"

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "hyperframes-player": React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & { srcdoc?: string; controls?: boolean; muted?: boolean; width?: number; height?: number; "runtime-src"?: string }
    }
  }
}
type PlayerElement = HTMLElement & { play(): void; pause(): void; loop: boolean; ready: boolean; duration: number }
export type LabPreviewProps = { template: LabTemplate; photos: LabImage[]; fields: Record<string, string>; format: LabFormat; theme: LabTheme; safeZone?: boolean }

/** Живой предпросмотр композиции Hyperframes: тот же HTML, что и на сервере, с blob-адресами фотографий. */
export default function LabPreview({ template, photos, fields, format, theme, safeZone }: LabPreviewProps) {
  const player = useRef<PlayerElement>(null)
  const urls = useRef(new Map<string, string>())
  const [doc, setDoc] = useState("")
  const [error, setError] = useState("")
  const [registered, setRegistered] = useState(false)
  const dims = DIMENSIONS[format]

  useEffect(() => { void import("@hyperframes/player").then(() => setRegistered(true)).catch(() => setError("Не удалось загрузить плеер предпросмотра.")) }, [])
  useEffect(() => {
    let stopped = false
    const timer = setTimeout(async () => {
      try {
        const html = await loadTemplateHtml(template.id)
        // Data-URL фотографий переводим в blob: документ srcdoc остаётся маленьким.
        const sources = await Promise.all(photos.map(async p => {
          let url = urls.current.get(p.src)
          if (!url) { url = URL.createObjectURL(await (await fetch(p.src)).blob()); urls.current.set(p.src, url) }
          return url
        }))
        if (stopped) return
        setError("")
        setDoc(composeDocument(html, template, format, compositionVariables(template, { theme, fields, photos }, i => sources[i])))
      } catch (e) { if (!stopped) setError((e as Error).message) }
    }, 350)
    return () => { stopped = true; clearTimeout(timer) }
  }, [template, photos, fields, format, theme])
  useEffect(() => { const map = urls.current; return () => { map.forEach(url => URL.revokeObjectURL(url)); map.clear() } }, [])
  useEffect(() => {
    const el = player.current
    if (!el || !doc) return
    const onReady = () => { el.loop = true; try { el.play() } catch { /* автозапуск может быть запрещён */ } }
    el.addEventListener("ready", onReady)
    return () => el.removeEventListener("ready", onReady)
  }, [doc, registered])

  const safe = format === "9:16" ? { top: 220 / 1920, bottom: 340 / 1920, left: 72 / 1080, right: 130 / 1080 } : { top: 150 / 1350, bottom: 150 / 1350, left: 72 / 1080, right: 72 / 1080 }
  return <div className="lab-player" style={{ aspectRatio: `${dims.width} / ${dims.height}` }}>
    {registered && doc && <hyperframes-player ref={player} srcdoc={doc} controls muted width={dims.width} height={dims.height} runtime-src="/creative-lab/hf/_shared/runtime.js" />}
    {!doc && !error && <p className="lab-player-note" role="status">Готовим предпросмотр…</p>}
    {error && <p className="lab-player-note" role="alert">{error}</p>}
    {safeZone && doc && <div className="lab-safe" aria-hidden style={{ top: `${safe.top * 100}%`, bottom: `${safe.bottom * 100}%`, left: `${safe.left * 100}%`, right: `${safe.right * 100}%` }}>
      {format === "9:16" && <span className="lab-safe-feed" style={{ top: `${(285 / 1920 - safe.top) / (1 - safe.top - safe.bottom) * 100}%`, bottom: `${(285 / 1920 - safe.bottom) / (1 - safe.top - safe.bottom) * 100}%` }} />}
    </div>}
  </div>
}
