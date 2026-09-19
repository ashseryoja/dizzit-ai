"use client"

import { prepareReference, requestImage } from "@/lib/image-generation"
import { PAPER_PROMPT, type LabCompositionProps, type LabFormat, type LabImage, type LabJob } from "./types"

export async function labRequest<T>(path: string, data?: unknown): Promise<T> {
  const response = await fetch(`/api/creative-lab/${path}`, { method: data === undefined ? "GET" : "POST", ...(data === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }), cache: "no-store" })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(error.message || "Не удалось связаться с Creative Lab.")
  }
  return response.json()
}
export async function createLabJob(props: LabCompositionProps) {
  // Keep the whole JSON upload below serverless request limits (base64 adds 33%).
  // Compression is only needed for oversized batches; drafts keep full-size references.
  let payload = props
  for (const quality of [.88, .74, .58]) {
    if (JSON.stringify(payload).length < 4_000_000) break
    const images = await Promise.all(props.images.map(async image => {
      const bitmap = await createImageBitmap(await (await fetch(image.src)).blob())
      try {
        const canvas = document.createElement("canvas")
        const maxSide = props.images.length === 1 ? 2048 : 1920
        const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height))
        canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale)
        const ctx = canvas.getContext("2d")
        if (!ctx) throw new Error("Не удалось подготовить фотографии.")
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height)
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        return { ...image, src: canvas.toDataURL("image/jpeg", quality) }
      } finally { bitmap.close() }
    }))
    payload = { ...props, images }
  }
  if (JSON.stringify(payload).length >= 4_000_000) throw new Error("Этот набор слишком большой для отправки. Уменьшите размер фотографий и повторите.")
  return labRequest<LabJob>("jobs", payload)
}
export function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error("Не удалось прочитать файл."))
    reader.readAsDataURL(blob)
  })
}
export async function importPhoto(file: Blob): Promise<LabImage> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Выберите JPG, PNG или WebP.")
  if (!file.size || file.size > 32 * 1024 * 1024) throw new Error("Фотография должна быть не больше 32 МБ.")
  const reference = await prepareReference(file)
  return { src: await dataUrl(reference), x: 50, y: 50, fit: "cover" }
}
export async function paperPhoto(image: LabImage, format: LabFormat, signal: AbortSignal) {
  const [width, height] = format.split(":").map(Number)
  const source = await (await fetch(image.src)).blob()
  const result = await requestImage({ prompt: PAPER_PROMPT, references: [await prepareReference(source)], aspect: { width, height }, resolution: "2K", finalLongSide: 2048, frame: "crop", signal })
  return { ...image, src: await dataUrl(result.blob), x: 50, y: 50, fit: "contain" as const }
}

/** Separate browser draft cache: never passed to the application's blob GC or SQL sync. */
function draftDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("dizzit-creative-lab", 1)
    request.onupgradeneeded = () => request.result.createObjectStore("drafts")
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export type LabDraft = { images: (LabImage | null)[]; title: string; format: LabFormat; generated: LabImage | null; jobId?: string }
export async function loadDraft(key: string): Promise<LabDraft | undefined> {
  const db = await draftDb()
  try { return await new Promise((resolve, reject) => { const req = db.transaction("drafts").objectStore("drafts").get(key); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) }) }
  finally { db.close() }
}
export async function saveDraft(key: string, draft: LabDraft) {
  const db = await draftDb()
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction("drafts", "readwrite"); tx.objectStore("drafts").put(draft, key); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) }) }
  finally { db.close() }
}
