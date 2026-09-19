"use client"
import { useState } from "react"
import { getBlob, resultKey, thumbResultKey } from "@/lib/blob-store"
import { useStoredBlobUrl } from "@/lib/use-stored-blob"
import { useEnhanceStore } from "@/stores/enhance-store"
import { useRestyleStore } from "@/stores/restyle-store"
import { useMaterialStore } from "@/stores/material-store"
import { useProjectStore } from "@/stores/project-store"

function ProjectPhoto({ id, label, onSelect }: { id: string; label: string; onSelect: (blob: Blob) => Promise<void> }) {
  const { url } = useStoredBlobUrl([thumbResultKey(id), resultKey(id)])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  return <div><button className="lab-project-photo" disabled={loading} onClick={async () => {
    setLoading(true); setError("")
    try { const blob = await getBlob(resultKey(id)); if (!blob) throw new Error("Фото недоступно"); await onSelect(blob) } catch (e) { setError((e as Error).message) } finally { setLoading(false) }
  }} aria-label={`Выбрать ${label}`}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    {url ? <img src={url} alt={label} /> : <span>Загрузка…</span>}<span>{loading ? "Загружаем…" : label}</span></button>{error && <small role="alert">{error}</small>}</div>
}
export function ProjectPhotos({ onSelect }: { onSelect: (blob: Blob) => Promise<void> }) {
  const projectId = useProjectStore(s => s.activeProjectId)
  const enhancements = useEnhanceStore(s => s.enhancements)
  const restyles = useRestyleStore(s => s.restyles)
  const materials = useMaterialStore(s => s.materials)
  const items = [...enhancements, ...restyles, ...materials].filter(i => i.projectId === projectId && i.status === "done")
  return <div className="lab-project-picker"><p>Готовые изображения текущего проекта</p>{!items.length ? <p className="lab-footnote">В этом проекте пока нет готовых изображений. Загрузите фото с устройства.</p> : <div className="lab-project-grid">{items.map((item, i) => <ProjectPhoto key={item.id} id={item.id} label={`Кадр ${i + 1}`} onSelect={onSelect} />)}</div>}</div>
}
