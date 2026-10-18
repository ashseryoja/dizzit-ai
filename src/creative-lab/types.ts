import catalog from "./catalog.json"

export type LabFormat = "9:16" | "4:5"
export type LabField = { id: string; label: string; max: number; default: string; kind?: "color" }
export type LabTemplate = {
  id: string; engine: "hyperframes" | "remotion" | "image"; kind: "motion" | "ai" | "hybrid"; output: "video" | "image"; group: string
  name: string; subtitle: string; description: string
  photos: { min: number; max: number; labels: string[]; pairs?: { lead: number } }
  captions?: { slots: number[]; label: string; max: number }
  fields: LabField[]
  timing: { base: number; per: number; unit: string }
  recipe?: string
  demo: { photos: string[]; captions?: Record<string, string> }
}
export const TEMPLATES = catalog as LabTemplate[]
export const FORMATS: LabFormat[] = ["9:16", "4:5"]
export const GROUPS = [
  { id: "all", name: "Все" }, { id: "project", name: "Проект" }, { id: "change", name: "До / после" },
  { id: "detail", name: "Детали и материалы" }, { id: "story", name: "Текст и отзывы" }, { id: "ai", name: "ИИ" },
]
export const KIND_LABEL = { motion: "Без ИИ", ai: "ИИ-фото", hybrid: "ИИ + motion" }
export const FORMAT_LABEL: Record<LabFormat, string> = { "9:16": "Reels · 9:16", "4:5": "Лента · 4:5" }
export const DIMENSIONS: Record<LabFormat, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 }, "4:5": { width: 1080, height: 1350 },
}
/** Фото с точкой фокуса в процентах: в шаблоне становится object-position. */
export type LabImage = { src: string; x: number; y: number; caption?: string }
export type LabTheme = "light" | "dark"
export type LabJobInput = { templateId: string; format: LabFormat; theme: LabTheme; photos: LabImage[]; fields: Record<string, string> }
export type LabJob = {
  id: string; templateId: string; title: string; createdAt: string; status: "queued" | "rendering" | "done" | "error"
  progress: number; format: LabFormat; output: "video" | "image"; error?: string
}
/** Сколько секунд получится при данном числе фотографий. */
export function estimateDuration(template: LabTemplate, count: number) {
  const lead = template.photos.pairs?.lead ?? 0
  const units = template.photos.pairs ? Math.floor(Math.max(0, count - lead) / 2) : template.timing.unit === "photo" || template.timing.unit === "stage" ? count : Math.max(0, count - 1)
  return Math.round(template.timing.base + template.timing.per * units)
}
export const PAPER_PROMPT = "Transform this photograph into a handcrafted paper-cut diorama. Rebuild all visible surfaces with layered matte colored cardstock, folded edges, subtle paper fibers and soft physical contact shadows. Preserve the original subject, recognizable identity, camera angle, composition and object positions. Warm ivory and sage palette retaining original color relationships. A tactile dimensional paper construction, not a flat photo filter. No extra objects, no text, no watermark."
