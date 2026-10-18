"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { ArrowUpRight, Sparkles } from "lucide-react"
import { GROUPS, KIND_LABEL, TEMPLATES, estimateDuration, type LabTemplate } from "@/creative-lab/types"
import { LabHistory } from "./history"

function DemoCard({ template }: { template: LabTemplate }) {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = video.current
    if (!el) return
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)")
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !reduced.matches) void el.play().catch(() => undefined)
      else el.pause()
    }, { threshold: .35 })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  const { min, max } = template.photos
  const [low, high] = [estimateDuration(template, min), estimateDuration(template, max)]
  const seconds = template.output === "video" ? `≈ ${low === high ? low : `${low}–${high}`} с` : "PNG 2048"
  return <Link href={`/creative-lab/${template.id}`} className="lab-card" aria-label={`${template.name}: ${template.subtitle}`}>
    <div className="lab-card-media">
      {template.output === "video"
        ? <video ref={video} src={`/creative-lab/demos/${template.id}.mp4`} poster={`/creative-lab/demos/${template.id}.jpg`} muted loop playsInline preload="metadata" aria-label={`Пример ${template.name}`} />
        // eslint-disable-next-line @next/next/no-img-element
        : <img src={template.demo.photos[0]} alt="Интерьер в бумажной стилистике — пример результата" loading="lazy" />}
      {template.kind !== "motion" && <span className="lab-kind"><Sparkles size={11} />{KIND_LABEL[template.kind]}</span>}
      <span className="lab-card-use"><ArrowUpRight size={18} /></span>
    </div>
    <div className="lab-card-text"><strong>{template.name}</strong><span>{template.subtitle}</span></div>
    <div className="lab-card-meta"><span>{min === max ? `${min} фото` : `${min}–${max} фото`}</span><span>{seconds.replace("≈ 0–", "≈ ")}</span></div>
  </Link>
}

export function LabCatalog() {
  const [group, setGroup] = useState("all")
  const [tab, setTab] = useState<"templates" | "results">("templates")
  const filtered = TEMPLATES.filter(t => group === "all" || t.group === group)
  return <div className="lab-page">
    <header className="lab-heading">
      <span className="lab-eyebrow">Creative Lab</span>
      <h1>Ролики для Instagram,<br />которые выглядят как работа студии.</h1>
      <p>Ваши фотографии, редакторская типографика и спокойное движение: шторки, медленный наезд, подписи из-под маски. Reels 9:16 и лента 4:5. Без ИИ — кроме двух бумажных шаблонов.</p>
    </header>
    <div className="lab-nav-row">
      <div className="lab-tabs" role="tablist" aria-label="Creative Lab"><button role="tab" aria-selected={tab === "templates"} onClick={() => setTab("templates")}>Шаблоны <span>{TEMPLATES.length}</span></button><button role="tab" aria-selected={tab === "results"} onClick={() => setTab("results")}>Мои работы</button></div>
      {tab === "templates" && <nav className="lab-groups" aria-label="Темы шаблонов">{GROUPS.map(g => <button key={g.id} aria-pressed={group === g.id} onClick={() => setGroup(g.id)}>{g.name}</button>)}</nav>}
    </div>
    {tab === "templates" ? <div className="lab-grid">{filtered.map(t => <DemoCard key={t.id} template={t} />)}</div> : <LabHistory />}
  </div>
}
