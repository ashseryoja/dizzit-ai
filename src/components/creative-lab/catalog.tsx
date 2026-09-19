"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { ArrowUpRight, Film, ImageIcon, Search, Sparkles, X } from "lucide-react"
import { CATEGORIES, KIND_LABEL, TEMPLATES, type LabTemplate } from "@/creative-lab/types"
import { LabHistory } from "./history"

function DemoCard({ template, animate }: { template: LabTemplate; animate: boolean }) {
  const video = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const el = video.current
    if (!el) return
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)")
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && animate && !reduced.matches) void el.play().catch(() => undefined)
      else el.pause()
    }, { threshold: .3 })
    observer.observe(el)
    return () => observer.disconnect()
  }, [animate])
  return <Link href={`/creative-lab/${template.id}`} className="lab-card" aria-label={`${template.name}: ${template.slots.length} фото`}>
    <div className="lab-card-media" style={{ background: template.color }}>
      {template.output === "video"
        ? <video ref={video} src={`/creative-lab/demos/${template.id}.mp4`} poster={`/creative-lab/demos/${template.id}.jpg`} muted loop playsInline preload="metadata" aria-label={`Пример ${template.name}`} />
        // eslint-disable-next-line @next/next/no-img-element
        : <img src={template.demoImages[0]} alt="Интерьер в бумажной стилистике — пример результата" loading="lazy" />}
      <span className={`lab-kind ${template.kind === "motion" ? "" : "is-ai"}`}>{template.kind === "motion" ? <Film size={12} /> : <Sparkles size={12} />}{KIND_LABEL[template.kind]}</span>
      <span className="lab-card-use"><ArrowUpRight size={20} /></span>
      <div className="lab-card-overlay"><span>{template.subtitle}</span><strong>{template.name}</strong></div>
    </div>
    <div className="lab-card-meta"><span>{template.slots.length} фото <span>·</span> {template.output === "video" ? `${template.duration} сек` : "Изображение"}</span><span>{template.output === "video" ? "MP4" : "PNG"}<ArrowUpRight size={13} /></span></div>
  </Link>
}

export function LabCatalog() {
  const [category, setCategory] = useState("all")
  const [query, setQuery] = useState("")
  const [tab, setTab] = useState<"templates" | "results">("templates")
  const [animate, setAnimate] = useState(true)
  const filtered = TEMPLATES.filter(t => (category === "all" || t.categories.includes(category)) && `${t.name} ${t.subtitle} ${t.description}`.toLowerCase().includes(query.trim().toLowerCase()))
  return <div className="lab-page">
    <header className="lab-heading"><div><span className="lab-eyebrow"><span />DIZZIT / CREATIVE LAB</span><h1>Ваша следующая<br /><em>классная идея.</em></h1><p>Выберите результат, который нравится.<br />Добавьте свои кадры — остальное уже придумано.</p></div><div className="lab-heading-mark" aria-hidden><Sparkles strokeWidth={.7} /><span>МЕНЬШЕ НАСТРОЕК.<br />БОЛЬШЕ ТВОРЧЕСТВА.</span></div></header>
    <div className="lab-nav-row"><div className="lab-tabs" role="tablist" aria-label="Creative Lab"><button role="tab" aria-selected={tab === "templates"} onClick={() => setTab("templates")}>Шаблоны <span>{TEMPLATES.length}</span></button><button role="tab" aria-selected={tab === "results"} onClick={() => setTab("results")}>Мои работы</button></div>{tab === "templates" && <label className="lab-search"><Search size={17} /><input placeholder="Найти идею…" aria-label="Поиск шаблонов" value={query} onChange={e => setQuery(e.target.value)} />{query && <button onClick={() => setQuery("")} aria-label="Очистить поиск"><X size={16} /></button>}</label>}</div>
    {tab === "templates" ? <>
      <nav className="lab-categories" aria-label="Категории шаблонов">{CATEGORIES.map(c => <button key={c.id} aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>{c.name}</button>)}</nav>
      <div className="lab-section-label"><span>{CATEGORIES.find(c => c.id === category)?.name} · {filtered.length}</span><button className="lab-text-button" onClick={() => setAnimate(v => !v)} aria-pressed={!animate}>{animate ? "Остановить примеры" : "Включить примеры"}</button></div>
      {filtered.length ? <div className="lab-grid">{filtered.map(t => <DemoCard key={t.id} template={t} animate={animate} />)}</div> : <div className="lab-empty"><ImageIcon /><h2>Здесь пока ничего нет</h2><p>Попробуйте другой запрос или категорию.</p><button className="btn-secondary" onClick={() => { setQuery(""); setCategory("all") }}>Все шаблоны</button></div>}
      <p className="lab-footnote">У каждого шаблона — свой пример и точное количество кадров. Motion Graphics собираются без ИИ.</p>
    </> : <LabHistory />}
  </div>
}
