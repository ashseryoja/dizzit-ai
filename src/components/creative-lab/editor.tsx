"use client"

import dynamic from "next/dynamic"
import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, ArrowRight, ArrowUp, Check, Plus, Sparkles, Upload, X } from "lucide-react"
import { createLabJob, importPhoto, labRequest, loadDraft, paperPhoto, saveDraft } from "@/creative-lab/client"
import { DIMENSIONS, FORMATS, FORMAT_LABEL, GROUPS, KIND_LABEL, estimateDuration, type LabFormat, type LabImage, type LabJob, type LabTemplate, type LabTheme } from "@/creative-lab/types"
import { imageProviderStatus } from "@/lib/image-generation"
import { LabJobResult } from "./history"
import { ProjectPhotos } from "./project-photos"

const Preview = dynamic(() => import("./preview"), { ssr: false, loading: () => <p className="lab-player-note" role="status">Открываем предпросмотр…</p> })

export function LabEditor({ template }: { template: LabTemplate }) {
  const { min, max, labels, pairs } = template.photos
  const [photos, setPhotos] = useState<(LabImage | null)[]>(() => Array.from({ length: max }, () => null))
  const [fields, setFields] = useState<Record<string, string>>(() => Object.fromEntries(template.fields.map(f => [f.id, f.default])))
  const [format, setFormat] = useState<LabFormat>("9:16")
  const [theme, setTheme] = useState<LabTheme>("dark")
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
  const [selected, setSelected] = useState<number | null>(null)
  const [showProject, setShowProject] = useState(false)
  const [safeZone, setSafeZone] = useState(true)
  const [view, setView] = useState<"edit" | "result">("edit")
  const fileInput = useRef<HTMLInputElement>(null)
  const targetSlot = useRef<number | null>(null)
  const controller = useRef<AbortController | null>(null)
  const importLock = useRef(false)
  const actionLock = useRef(false)

  const filled = useMemo(() => photos.filter((p): p is LabImage => Boolean(p)), [photos])
  // Фотографии идут подряд: первая пустая ячейка закрывает набор.
  const firstGap = photos.findIndex(p => !p)
  const count = firstGap === -1 ? max : firstGap
  const pairsOk = !pairs || (count - pairs.lead) % 2 === 0
  const complete = count >= min && pairsOk && firstGap !== -1 ? filled.length === count : count >= min && pairsOk
  const activeJob = job?.status === "queued" || job?.status === "rendering"
  const locked = !ready || Boolean(busy) || importing || activeJob
  const dims = DIMENSIONS[format]
  const isAi = template.kind !== "motion"
  const seconds = estimateDuration(template, count)
  const previewPhotos = useMemo<LabImage[]>(() => template.kind === "hybrid" ? (photos[0] ? (generated ? [photos[0], generated] : [photos[0]]) : []) : photos.slice(0, count).filter((p): p is LabImage => Boolean(p)), [template.kind, photos, generated, count])

  useEffect(() => {
    let stopped = false
    void loadDraft(template.id).then(draft => {
      if (stopped || !draft || draft.photos.length !== max) return
      setPhotos(draft.photos); setFields({ ...Object.fromEntries(template.fields.map(f => [f.id, f.default])), ...draft.fields }); setFormat(draft.format); setTheme(draft.theme); setGenerated(draft.generated); setJobId(draft.jobId)
    }).catch(() => { if (!stopped) setCacheError("Черновик недоступен: фотографии сохранятся только до закрытия страницы.") }).finally(() => { if (!stopped) setReady(true) })
    return () => { stopped = true; controller.current?.abort() }
  }, [template, max])

  useEffect(() => {
    let stopped = false
    const check = () => {
      void labRequest("health").then(() => { if (!stopped) { setHealthy(true); setHealthError("") } }).catch(e => { if (!stopped) { setHealthy(false); setHealthError(e.message) } })
      if (isAi) void imageProviderStatus(true).then(s => { if (!stopped) setProvider(s.configured) }).catch(() => { if (!stopped) setProvider(false) })
    }
    check(); const timer = setInterval(check, 15_000)
    return () => { stopped = true; clearInterval(timer) }
  }, [isAi])

  useEffect(() => {
    if (!ready) return
    const timer = setTimeout(() => { void saveDraft(template.id, { version: 2, photos, fields, format, theme, generated, jobId }).catch(() => setCacheError("Не удалось сохранить черновик в браузере. Не закрывайте страницу до отправки.")) }, 400)
    return () => clearTimeout(timer)
  }, [ready, template.id, photos, fields, format, theme, generated, jobId])

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

  const changePhotos = (next: (LabImage | null)[]) => { setPhotos(next); setGenerated(null) }
  async function addFiles(files: Blob[], slot: number | null) {
    if (locked || importLock.current) return
    importLock.current = true; setImporting(true); setError("")
    try {
      const next = [...photos]
      const destinations = slot === null ? next.flatMap((p, i) => p ? [] : [i]) : [slot]
      if (!destinations.length) throw new Error("Все ячейки заполнены. Нажмите на кадр, который хотите заменить.")
      // Validate the entire selected batch before changing any slots.
      const imported = await Promise.all(files.slice(0, destinations.length).map(importPhoto))
      imported.forEach((image, i) => { next[destinations[i]] = { ...image, caption: next[destinations[i]]?.caption } })
      changePhotos(next)
      if (imported.length) setSelected(destinations[0])
      if (files.length > destinations.length) setError(`Добавлено ${destinations.length} фото — больше ячеек нет.`)
    } catch (e) { setError((e as Error).message) }
    finally { importLock.current = false; setImporting(false) }
  }
  const pick = (slot: number | null) => { targetSlot.current = slot; if (fileInput.current) { fileInput.current.multiple = slot === null; fileInput.current.click() } }
  const patchPhoto = (i: number, patch: Partial<LabImage>) => { const next = [...photos]; if (next[i]) { next[i] = { ...next[i]!, ...patch }; if ("caption" in patch) setPhotos(next); else changePhotos(next) } }
  const move = (i: number, dir: -1 | 1) => { const j = i + dir; if (j < 0 || j >= max || !photos[i]) return; const next = [...photos]; [next[i], next[j]] = [next[j], next[i]]; changePhotos(next); setSelected(j) }
  const remove = (i: number) => { const next = [...photos]; next.splice(i, 1); next.push(null); changePhotos(next); setSelected(null) }

  async function create() {
    if (!complete || locked || !healthy || actionLock.current) return
    actionLock.current = true; setError(""); setBusy("Подготавливаем фотографии…")
    const abort = new AbortController(); controller.current = abort
    try {
      let result = generated
      if (isAi && !result) {
        setBusy("ИИ собирает бумажную сцену. Не закрывайте страницу…")
        result = await paperPhoto(photos[0]!, format, abort.signal)
        setGenerated(result)
        // Retain the expensive AI result before submitting a retryable, free render.
        await saveDraft(template.id, { version: 2, photos, fields, format, theme, generated: result }).catch(() => setCacheError("Не удалось сохранить ИИ-кадр в браузере. Не закрывайте страницу до экспорта."))
      }
      if (abort.signal.aborted) return
      setBusy("Отправляем на сборку…")
      const renderPhotos = template.kind === "motion" ? photos.slice(0, count) as LabImage[] : template.kind === "hybrid" ? [photos[0]!, result!] : [result!]
      const next = await createLabJob({ templateId: template.id, format, theme, photos: renderPhotos.map(p => ({ src: p.src, x: p.x, y: p.y, ...(p.caption ? { caption: p.caption } : {}) })), fields })
      setJob(next); setJobId(next.id); setView("result")
    } catch (e) { if (!abort.signal.aborted) setError((e as Error).message) }
    finally { setBusy(""); actionLock.current = false }
  }
  const retry = () => { if (!job) return; void labRequest<LabJob>(`jobs/${job.id}/retry`, {}).then(next => { setJob(next); setJobId(undefined); setTimeout(() => setJobId(next.id), 0) }).catch(e => setError(e.message)) }

  const captionsFor = (i: number) => template.captions?.slots.includes(i + 1) ? template.captions : null
  const slotHint = pairs ? (count < min ? `Добавьте ${pairs.lead ? "главный кадр и " : ""}хотя бы одну пару.` : !pairsOk ? "Не хватает второго кадра в последней паре." : "") : count < min ? `Нужно хотя бы ${min} ${min === 1 ? "фото" : "фото"}.` : ""
  const group = GROUPS.find(g => g.id === template.group)?.name

  return <div className="lab-page lab-editor">
    <div className="lab-editor-top">
      <Link href="/creative-lab" className="lab-back"><ArrowLeft size={15} />Все шаблоны</Link>
      <div className="lab-editor-title"><span className="lab-eyebrow">{group}{isAi ? ` · ${KIND_LABEL[template.kind]}` : ""}</span><h1>{template.name}</h1><p>{template.description}</p></div>
    </div>
    <div className="lab-workspace">
      <section className="lab-stage" aria-label="Предпросмотр">
        <div className="lab-stage-bar">
          {template.output === "video" && <div className="lab-segment" role="group" aria-label="Формат">{FORMATS.map(f => <button key={f} aria-pressed={format === f} disabled={locked && format !== f} onClick={() => { setFormat(f); if (isAi && f !== format) setGenerated(null) }}>{FORMAT_LABEL[f]}</button>)}</div>}
          {template.output === "video" && <div className="lab-segment" role="group" aria-label="Тема"><button aria-pressed={theme === "dark"} onClick={() => setTheme("dark")}>Тёмная</button><button aria-pressed={theme === "light"} onClick={() => setTheme("light")}>Светлая</button></div>}
          {template.output === "video" && previewPhotos.length > 0 && view === "edit" && <label className="lab-check"><input type="checkbox" checked={safeZone} onChange={e => setSafeZone(e.target.checked)} />Safe-зона</label>}
        </div>
        <div className="lab-stage-frame" style={{ aspectRatio: `${dims.width} / ${dims.height}` }}>
          {view === "result" && job ? <LabJobResult job={job} onRetry={retry} compact />
            : template.output === "image" ? (generated
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={generated.src} alt="Ваша фотография в бумажном стиле" />
              // eslint-disable-next-line @next/next/no-img-element
              : <img src={template.demo.photos[0]} alt="Пример бумажной стилизации" />)
            : previewPhotos.length ? <Preview template={template} photos={previewPhotos} fields={fields} format={format} theme={theme} safeZone={safeZone} />
              : <video key={template.id} className="lab-demo" src={`/creative-lab/demos/${template.id}.mp4`} poster={`/creative-lab/demos/${template.id}.jpg`} autoPlay muted loop playsInline preload="metadata" />}
        </div>
        <div className="lab-stage-meta">
          <span>{view === "result" && job ? (job.status === "done" ? "Готово" : job.status === "error" ? "Ошибка сборки" : "Собираем…") : template.output === "image" ? (generated ? "Ваш результат" : "Пример результата") : previewPhotos.length ? "Ваши кадры · живой предпросмотр" : "Пример шаблона"}</span>
          <span>{template.output === "video" ? `≈ ${seconds} с · ${dims.width} × ${dims.height} · MP4` : "PNG · 2048 px"}</span>
          {view === "result" && <button className="lab-text-button" onClick={() => setView("edit")}>К редактированию</button>}
        </div>
      </section>

      <section className="lab-panel" aria-label="Настройка шаблона">
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" aria-label="Загрузить фотографии" onChange={e => { void addFiles(Array.from(e.target.files || []), targetSlot.current); e.target.value = "" }} />
        <fieldset disabled={locked} className="lab-block">
          <div className="lab-block-title"><h2>Фотографии</h2><span>{count} / {max}</span></div>
          <p className="lab-footnote">{template.kind === "motion" ? (min === max ? `Ровно ${max}.` : `От ${min} до ${max}, по порядку.`) + " Нажмите на кадр, чтобы выбрать фокус." : "Одна ИИ-генерация на фото — по тарифу подключённого провайдера."}</p>
          <div className={`lab-slots ${pairs ? "is-pairs" : ""}`}>{photos.map((p, i) => {
            const pairStart = pairs && i >= pairs.lead && (i - pairs.lead) % 2 === 0
            const hidden = i > count && !p
            if (hidden) return null
            return <div key={i} className={`lab-slot ${selected === i ? "is-selected" : ""} ${pairStart ? "is-pair-start" : ""}`} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void addFiles(Array.from(e.dataTransfer.files), i) }}>
              <button type="button" className="lab-slot-image" onClick={() => p ? setSelected(selected === i ? null : i) : pick(i)} aria-label={`${labels[i]}: ${p ? "выбрать" : "добавить фото"}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {p ? <img src={p.src} alt={labels[i]} style={{ objectPosition: `${p.x}% ${p.y}%` }} /> : <Plus size={20} strokeWidth={1.2} />}
                <span>{String(i + 1).padStart(2, "0")}</span>
              </button>
              <span className="lab-slot-label">{labels[i]}</span>
              {p && captionsFor(i) && <input className="lab-slot-caption" value={p.caption ?? ""} maxLength={captionsFor(i)!.max} placeholder={captionsFor(i)!.label} aria-label={`${captionsFor(i)!.label} — ${labels[i]}`} onChange={e => patchPhoto(i, { caption: e.target.value })} />}
            </div>
          })}</div>
          {slotHint && <p className="lab-footnote lab-hint">{slotHint}</p>}
          <div className="lab-upload-actions">
            <button type="button" className="btn-secondary" onClick={() => pick(null)} disabled={firstGap === -1}><Upload size={15} />{importing ? "Загружаем…" : "Загрузить фото"}</button>
            <button type="button" className="lab-text-button" onClick={() => setShowProject(v => !v)} aria-expanded={showProject}>Из проекта</button>
          </div>
          {showProject && <ProjectPhotos onSelect={async blob => { await addFiles([blob], selected ?? (firstGap === -1 ? null : firstGap)); setShowProject(false) }} />}
          {selected !== null && photos[selected] && <div className="lab-focus">
            <div className="lab-block-title"><h3>{labels[selected]}</h3><div className="lab-slot-actions"><button type="button" onClick={() => pick(selected)} aria-label="Заменить"><Upload size={13} /></button><button type="button" disabled={selected === 0} onClick={() => move(selected, -1)} aria-label="Раньше"><ArrowUp size={13} /></button><button type="button" disabled={!photos[selected + 1]} onClick={() => move(selected, 1)} aria-label="Позже"><ArrowRight size={13} /></button><button type="button" onClick={() => remove(selected)} aria-label="Удалить"><X size={13} /></button></div></div>
            <p className="lab-footnote">Нажмите на точку, которая должна остаться в кадре при обрезке.</p>
            <button type="button" className="lab-focus-pick" aria-label="Выбрать точку фокуса" onClick={e => { const r = e.currentTarget.getBoundingClientRect(); patchPhoto(selected, { x: Math.round((e.clientX - r.left) / r.width * 100), y: Math.round((e.clientY - r.top) / r.height * 100) }) }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photos[selected]!.src} alt="" />
              <span className="lab-focus-dot" style={{ left: `${photos[selected]!.x}%`, top: `${photos[selected]!.y}%` }} />
            </button>
          </div>}
        </fieldset>

        {template.fields.length > 0 && <fieldset disabled={locked} className="lab-block">
          <div className="lab-block-title"><h2>Текст</h2></div>
          {template.fields.map(f => <label key={f.id} className={`lab-field ${f.kind === "color" ? "is-color" : ""}`}><span>{f.label}{f.kind !== "color" && <small>{(fields[f.id] ?? "").length} / {f.max}</small>}</span>{f.kind === "color" ? <span className="lab-color"><input type="color" value={/^#[0-9a-f]{6}$/i.test(fields[f.id] ?? "") ? fields[f.id] : f.default} onChange={e => setFields({ ...fields, [f.id]: e.target.value })} /><code>{fields[f.id] || f.default}</code>{fields[f.id] && fields[f.id] !== f.default && <button type="button" className="lab-text-button" onClick={() => setFields({ ...fields, [f.id]: f.default })}>сбросить</button>}</span> : f.max > 60 ? <textarea rows={3} value={fields[f.id] ?? ""} maxLength={f.max} onChange={e => setFields({ ...fields, [f.id]: e.target.value })} /> : <input value={fields[f.id] ?? ""} maxLength={f.max} onChange={e => setFields({ ...fields, [f.id]: e.target.value })} />}</label>)}
        </fieldset>}

        <div className="lab-block lab-actions">
          {cacheError && <p className="lab-notice">{cacheError}</p>}
          {healthError && <p className="lab-notice" role="status">Сервис сборки недоступен: {healthError} Предпросмотр работает, экспорт — после подключения.</p>}
          {isAi && provider === false && !generated && <p className="lab-notice">Для этого шаблона нужен подключённый ИИ-провайдер. Остальные шаблоны работают без него.</p>}
          {error && <p className="lab-notice is-error" role="alert">{error}</p>}
          <button type="button" className="lab-create" disabled={locked || !complete || !healthy || (isAi && !generated && provider !== true)} onClick={() => void create()}>{busy ? <span role="status">{busy}</span> : <>{isAi ? <Sparkles size={16} /> : <Check size={16} />}{activeJob ? "Сборка в процессе…" : `Создать ${template.output === "video" ? "видео" : "изображение"}`}</>}</button>
          <p className="lab-footnote lab-center">{template.kind === "motion" ? "Без ИИ и оплаты за генерации · сборка на сервере" : generated ? "ИИ-кадр готов. Повторный экспорт не запускает генерацию." : "Сначала ИИ-кадр, затем сборка"}</p>
        </div>
      </section>
    </div>
  </div>
}
