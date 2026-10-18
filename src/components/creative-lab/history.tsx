"use client"
import { useEffect, useState } from "react"
import Link from "next/link"
import { Download, RefreshCw } from "lucide-react"
import { labRequest } from "@/creative-lab/client"
import { TEMPLATES, type LabJob } from "@/creative-lab/types"

export function LabJobResult({ job, onRetry, compact }: { job: LabJob; onRetry?: () => void; compact?: boolean }) {
  return <article className={`lab-result ${compact ? "is-compact" : ""}`}>
    {job.status === "done" ? <>
      {job.output === "video" ? <video src={`/api/creative-lab/jobs/${job.id}/file`} controls playsInline preload="metadata" />
        // eslint-disable-next-line @next/next/no-img-element
        : <img src={`/api/creative-lab/jobs/${job.id}/file`} alt={job.title || "Результат Creative Lab"} />}
      <a className="btn-primary" href={`/api/creative-lab/jobs/${job.id}/file?download=1`} download><Download size={16} />Скачать {job.output === "video" ? "MP4" : "PNG"}</a>
    </> : job.status === "error" ? <div role="alert"><p>{job.error}</p><button className="btn-secondary" onClick={onRetry}><RefreshCw size={15} />Повторить</button></div> : <div role="status"><span className="lab-render-pulse" /><h3>{job.status === "queued" ? "В очереди" : "Собираем ролик"}</h3><progress max={100} value={job.progress} /><p>{job.progress}% · можно закрыть страницу и вернуться позже</p></div>}
  </article>
}

export function LabHistory() {
  const [jobs, setJobs] = useState<LabJob[]>([])
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let stopped = false; let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try { const result = await labRequest<{ jobs: LabJob[] }>("jobs"); if (!stopped) { setJobs(result.jobs); setError("") } }
      catch (e) { if (!stopped) setError((e as Error).message) }
      finally { if (!stopped) { setLoading(false); timer = setTimeout(refresh, 5000) } }
    }
    void refresh()
    return () => { stopped = true; clearTimeout(timer) }
  }, [revision])
  return <section className="lab-history">
    {error && <p className="lab-notice" role="alert">{error}</p>}
    {loading ? <p className="lab-footnote" role="status">Загружаем работы…</p> : !jobs.length && !error ? <div className="lab-empty"><h2>Пока пусто</h2><p>Выберите шаблон, добавьте фотографии — готовые ролики появятся здесь.</p></div> : null}
    <div className="lab-history-grid">{jobs.map(job => <div key={job.id}><div className="lab-section-label"><Link href={`/creative-lab/${job.templateId}`}>{TEMPLATES.find(t => t.id === job.templateId)?.name ?? job.templateId}{job.title ? ` · ${job.title}` : ""}</Link><span>{new Date(job.createdAt).toLocaleDateString("ru-RU")} · {job.format}</span></div><LabJobResult job={job} onRetry={() => { void labRequest(`jobs/${job.id}/retry`, {}).then(() => setRevision(v => v + 1)).catch(e => setError(e.message)) }} /></div>)}</div>
  </section>
}
