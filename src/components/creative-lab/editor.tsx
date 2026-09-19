"use client"

import dynamic from "next/dynamic"
import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { ArrowLeft, ArrowUp, Check, Film, Plus, Sparkles, Upload, X } from "lucide-react"
import { createLabJob, importPhoto, labRequest, loadDraft, paperPhoto, saveDraft } from "@/creative-lab/client"
import { DIMENSIONS, KIND_LABEL, type LabFormat, type LabImage, type LabJob, type LabTemplate } from "@/creative-lab/types"
import { imageProviderStatus } from "@/lib/image-generation"
import { LabJobResult } from "./history"
import { ProjectPhotos } from "./project-photos"

const Preview = dynamic(() => import("./preview"), { ssr: false, loading: () => <p role="status">Открываем предпросмотр…</p> })

export function LabEditor({ template }: { template: LabTemplate }) {
  const [images, setImages] = useState<(LabImage | null)[]>(() => template.slots.map(() => null))
  const [title, setTitle] = useState(template.title)
  const [format, setFormat] = useState<LabFormat>("9:16")
  const [generated, setGenerated] = useState<LabImage | null>(null)
  const [ready, setReady] = useState(false)
  const [healthy, setHealthy] = useState(false)
  const [healthError, setHealthError] = useState("")
  const [provider, setProvider] = useState<boolean | null>(null)
  const [error, setError] = useState("")
  const [cacheError, setCacheError] = useState("")
  const [busy, setBusy] = useState("")
  const [importing, setImporting] = useState(false)
  const [job, setJob] = useState<LabJob | null>(null)
  const [jobId, setJobId] = useState<string>()
  const [selected, setSelected] = useState(0)
  const [showProject, setShowProject] = useState(false)
  const [preview, setPreview] = useState<"example" | "mine">("example")
  const fileInput = useRef<HTMLInputElement>(null)
  const targetSlot = useRef<number | null>(null)
  const controller = useRef<AbortController | null>(null)
  const importLock = useRef(false)
  const actionLock = useRef(false)
  const count = images.filter(Boolean).length
  const complete = count === template.slots.length
  const activeJob = job?.status === "queued" || job?.status === "rendering"
  const locked = !ready || Boolean(busy) || importing || activeJob
  const dimensions = DIMENSIONS[format]

  useEffect(() => {
    let stopped = false
    void loadDraft(template.id).then(draft => {
      if (stopped || !draft || draft.images.length !== template.slots.length || !template.formats.includes(draft.format)) return
      setImages(draft.images); setTitle(draft.title); setFormat(draft.format); setGenerated(draft.generated); setJobId(draft.jobId)
    }).catch(() => { if (!stopped) setCacheError("Черновик недоступен. Загруженные фото будут доступны только до закрытия страницы.") }).finally(() => { if (!stopped) setReady(true) })
    return () => { stopped = true; controller.current?.abort() }
  }, [template])

  useEffect(() => {
    let stopped = false
    const check = () => {
      void labRequest("health").then(() => { if (!stopped) { setHealthy(true); setHealthError("") } }).catch(e => { if (!stopped) { setHealthy(false); setHealthError(e.message) } })
      if (template.kind !== "motion") void imageProviderStatus(true).then(s => { if (!stopped) setProvider(s.configured) }).catch(() => { if (!stopped) setProvider(false) })
    }
    check(); const timer = setInterval(check, 15_000)
    return () => { stopped = true; clearInterval(timer) }
  }, [template.kind])

  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => { void saveDraft(template.id, { images, title, format, generated, jobId }).catch(() => setCacheError("Не удалось сохранить черновик в браузере. Не закрывайте страницу до отправки результата.")) }, 400)
    return () => clearTimeout(timer)
  }, [ready, template.id, images, title, format, generated, jobId])

  useEffect(() => {
    if (!jobId) return
    let stopped = false; let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const next = await labRequest<LabJob>(`jobs/${jobId}`)
        if (stopped) return
        setJob(next)
        if (next.status === "queued" || next.status === "rendering") timer = setTimeout(poll, 2000)
      } catch (e) { if (!stopped) { setError((e as Error).message); timer = setTimeout(poll, 5000) } }
    }
    void poll()
    return () => { stopped = true; clearTimeout(timer) }
  }, [jobId])

  useEffect(() => {
    if (!busy) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = "" }
    window.addEventListener("beforeunload", warn)
    return () => window.removeEventListener("beforeunload", warn)
  }, [busy])

  const changeImages = (next: (LabImage | null)[]) => { setImages(next); setGenerated(null) }
  async function addFiles(files: Blob[], slot: number | null) {
    if (locked || importLock.current) return
    importLock.current = true; setImporting(true); setError("")
    try {
      const next = [...images]
      const destinations = slot === null ? next.flatMap((image, i) => image ? [] : [i]) : [slot]
      if (!destinations.length) throw new Error("Все кадры заполнены. Выберите кадр, который хотите заменить.")
      // Validate the entire selected batch before changing any slots.
      const imported = await Promise.all(files.slice(0, destinations.length).map(importPhoto))
      imported.forEach((image, i) => { next[destinations[i]] = image })
      changeImages(next)
      if (imported.length) setSelected(destinations[0])
      if (files.length > destinations.length) setError(`Добавлено ${destinations.length} фото. Лишние файлы не использованы.`)
    } catch (e) { setError((e as Error).message) }
    finally { importLock.current = false; setImporting(false) }
  }
  const pick = (slot: number | null) => { targetSlot.current = slot; if (fileInput.current) { fileInput.current.multiple = slot === null; fileInput.current.click() } }
  async function create() {
    if (!complete || locked || !healthy || actionLock.current) return
    actionLock.current = true; setError(""); setBusy("Подготавливаем фотографии…")
    const abort = new AbortController(); controller.current = abort
    try {
      let result = generated
      if (template.kind !== "motion" && !result) {
        setBusy("Создаём бумажный мир. Не закрывайте эту страницу…")
        result = await paperPhoto(images[0]!, format, abort.signal)
        setGenerated(result)
        // Retain the expensive AI result before submitting a retryable, free render.
        await saveDraft(template.id, { images, title, format, generated: result }).catch(() => setCacheError("Не удалось сохранить ИИ-кадр в браузере. Не закрывайте страницу до экспорта."))
      }
      if (abort.signal.aborted) return
      setBusy("Отправляем на сборку…")
      const renderImages = template.kind === "motion" ? images as LabImage[] : template.kind === "hybrid" ? [images[0]!, result!] : [result!]
      const next = await createLabJob({ templateId: template.id, images: renderImages, title, format })
      setJob(next); setJobId(next.id); setPreview("mine")
    } catch (e) { if (!abort.signal.aborted) setError((e as Error).message) }
    finally { setBusy(""); actionLock.current = false }
  }
  const previewImages = template.kind === "hybrid" && generated ? [images[0]!, generated] : images.filter((image): image is LabImage => Boolean(image))
  const canPreview = complete && (template.kind === "motion" || Boolean(generated))
  const patchPhoto = (patch: Partial<LabImage>) => { const next = [...images]; if (next[selected]) { next[selected] = { ...next[selected]!, ...patch }; changeImages(next) } }

  return <div className="lab-page lab-editor">
    <Link href="/creative-lab" className="lab-back"><ArrowLeft size={16} />Все шаблоны</Link>
    <header className="lab-editor-heading"><div><span className="lab-eyebrow">CREATIVE LAB / {KIND_LABEL[template.kind]}</span><h1>{template.name}</h1><p>{template.description}</p></div><span className="lab-editor-number">{String(template.slots.length).padStart(2, "0")}<small>фото</small></span></header>
    <div className="lab-workspace">
      <section className="lab-preview-panel" aria-label="Предпросмотр">
        <div className="lab-preview-tabs"><button aria-pressed={preview === "example"} onClick={() => setPreview("example")}>Готовый пример</button><button aria-pressed={preview === "mine"} onClick={() => setPreview("mine")}>Мои кадры</button></div>
        <div className="lab-preview-stage">
          {preview === "example" ? template.output === "video" ? <video key={template.id} src={`/creative-lab/demos/${template.id}.mp4`} poster={`/creative-lab/demos/${template.id}.jpg`} controls loop playsInline preload="metadata" />
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={template.demoImages[0]} alt="Пример бумажной стилизации" />
            : canPreview ? template.output === "video" ? <Preview templateId={template.id} images={previewImages} title={title} format={format} duration={template.duration} />
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={generated!.src} alt="Ваша фотография в бумажном стиле" />
              : <div className="lab-preview-empty"><Film size={36} strokeWidth={1} /><h2>{complete ? "Превращение впереди" : "Здесь будет ваша история"}</h2><p>{complete ? "Нажмите «Создать», чтобы ИИ подготовил новый кадр." : `Добавьте все ${template.slots.length} фото в слоты справа.`}</p></div>}
        </div>
        <div className="lab-preview-caption"><span>{preview === "example" ? "Пример шаблона · демонстрационные фото" : "Ваши фотографии"}</span><span>{template.output === "video" ? `${template.duration} сек · без звука` : "ИИ-стилизация"}</span></div>
      </section>
      <section className="lab-controls" aria-label="Настройка шаблона">
        <div className="lab-step-title"><h2><span>01</span>Ваши кадры</h2><span>{count} / {template.slots.length}</span></div>
        <p className="lab-footnote">{template.kind === "motion" ? "Никаких генераций — только ваши фотографии и готовая анимация." : "Одна ИИ-генерация на фото. Оплачивается по тарифу подключённого провайдера."}</p>
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple={targetSlot.current === null} className="sr-only" aria-label="Загрузить фотографии" onChange={e => { void addFiles(Array.from(e.target.files || []), targetSlot.current); e.target.value = "" }} />
        <fieldset disabled={locked} className="lab-photo-fieldset">
          <div className="lab-slots">{template.slots.map((label, i) => <div key={label} className={`lab-slot ${selected === i ? "is-selected" : ""}`} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void addFiles(Array.from(e.dataTransfer.files), i) }}>
            <button className="lab-slot-image" onClick={() => images[i] ? setSelected(i) : pick(i)} aria-label={`${label}: ${images[i] ? "настроить" : "добавить фото"}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {images[i] ? <img src={images[i]!.src} alt={label} style={{ objectFit: images[i]!.fit, objectPosition: `${images[i]!.x}% ${images[i]!.y}%` }} /> : <Plus size={22} strokeWidth={1} />}<span>{String(i + 1).padStart(2, "0")}</span>
            </button><span className="lab-slot-label">{label}</span>
            {images[i] && <div className="lab-slot-actions"><button onClick={() => pick(i)} aria-label={`Заменить ${label}`}><Upload size={13} /></button><button disabled={!i} onClick={() => { const next = [...images]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; changeImages(next); setSelected(i - 1) }} aria-label={`Переместить ${label} раньше`}><ArrowUp size={13} /></button><button onClick={() => { const next = [...images]; next[i] = null; changeImages(next) }} aria-label={`Удалить ${label}`}><X size={13} /></button></div>}
          </div>)}</div>
          <div className="lab-upload-actions"><button className="btn-secondary" onClick={() => pick(null)} disabled={complete}><Upload size={15} />{importing ? "Загружаем…" : "Загрузить фото"}</button><button className="lab-text-button" onClick={() => setShowProject(v => !v)} aria-expanded={showProject}>Из проекта</button></div>
          <p className="lab-footnote">JPG, PNG, WebP · до 32 МБ на фото. Можно перетащить прямо в слот.</p>
          {showProject && <ProjectPhotos onSelect={async blob => { await addFiles([blob], selected); setShowProject(false) }} />}
          {images[selected] && template.kind === "motion" && <details className="lab-crop"><summary>Кадрирование · {template.slots[selected]}</summary><label>Масштаб<select aria-label="Масштаб фото" value={images[selected]!.fit} onChange={e => patchPhoto({ fit: e.target.value as LabImage["fit"] })}><option value="cover">Заполнить кадр</option><option value="contain">Показать целиком</option></select></label>{images[selected]!.fit === "cover" && <>{(["x", "y"] as const).map(axis => <label key={axis}>{axis === "x" ? "По горизонтали" : "По вертикали"}<input type="range" min="0" max="100" value={images[selected]![axis]} onChange={e => patchPhoto({ [axis]: Number(e.target.value) })} /></label>)}</>}</details>}
        </fieldset>
        <fieldset disabled={locked} className="lab-output-fields">
          <div className="lab-step-title"><h2><span>02</span>Финальный штрих</h2></div>
          {template.output === "video" && <label>Подпись<input value={title} maxLength={64} onChange={e => setTitle(e.target.value)} placeholder="Можно оставить без текста" /></label>}
          <div className="lab-format-field"><span>Формат</span><div className="lab-formats" role="group" aria-label="Формат результата">{template.formats.map(value => <button key={value} aria-pressed={format === value} onClick={() => { setFormat(value as LabFormat); if (value !== format) setGenerated(null) }}>{value}{format === value && <Check size={12} />}</button>)}</div></div>
          <p className="lab-footnote">{template.output === "video" ? `MP4 · ${dimensions.width} × ${dimensions.height} · 30 кадров/с` : "PNG · длинная сторона 2048 px"}</p>
        </fieldset>
        {cacheError && <p className="lab-notice">{cacheError}</p>}
        {healthError && <p className="lab-notice" role="status">{healthError} Предпросмотр шаблонов доступен.</p>}
        {template.kind !== "motion" && provider === false && !generated && <p className="lab-notice">Для этого шаблона нужен подключённый ИИ-провайдер. Шаблоны Motion Graphics работают без него.</p>}
        {error && <p className="lab-notice is-error" role="alert">{error}</p>}
        <button className="lab-create" disabled={locked || !complete || !healthy || (template.kind !== "motion" && !generated && provider !== true)} onClick={() => void create()}>{busy ? <span role="status">{busy}</span> : <><Sparkles size={17} />{activeJob ? "Сборка в процессе…" : `Создать ${template.output === "video" ? "видео" : "изображение"}`}</>}</button>
        <p className="lab-footnote lab-center">{template.kind === "motion" ? "Без ИИ и платы за генерации · сборка на вашем сервере" : generated ? "ИИ-кадр готов. Повторный экспорт не запускает генерацию." : "Сначала ИИ-кадр, затем сохранение результата"}</p>
      </section>
    </div>
    {job && <section className="lab-editor-result"><div className="lab-step-title"><h2><span>03</span>Ваш результат</h2><Link href="/creative-lab">Все работы — в каталоге</Link></div><LabJobResult job={job} onRetry={() => { void labRequest<LabJob>(`jobs/${job.id}/retry`, {}).then(next => { setJob(next); setJobId(undefined); setTimeout(() => setJobId(next.id), 0) }).catch(e => setError(e.message)) }} /></section>}
  </div>
}
