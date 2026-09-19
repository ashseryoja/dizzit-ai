import catalog from "./catalog.json"

export type LabFormat = "9:16" | "1:1" | "16:9"
export type LabTemplate = {
  id: string; name: string; subtitle: string; description: string
  kind: "motion" | "ai" | "hybrid"; output: "video" | "image"
  categories: string[]; slots: string[]; duration: number; formats: string[]
  color: string; title: string; recipe?: string; demoImages: string[]
}
export const TEMPLATES = catalog as LabTemplate[]
export const CATEGORIES = [
  { id: "all", name: "Все шаблоны" }, { id: "motion", name: "Motion Graphics" },
  { id: "ai-photo", name: "ИИ-фото" }, { id: "trends", name: "Тренды видео" },
  { id: "ai-motion", name: "ИИ + Motion" }, { id: "interiors", name: "Для интерьеров" },
]
export const KIND_LABEL = { motion: "Без ИИ", ai: "ИИ-фото", hybrid: "ИИ + Motion" }
export const DIMENSIONS: Record<LabFormat, { width: number; height: number }> = {
  "9:16": { width: 1080, height: 1920 }, "1:1": { width: 1080, height: 1080 }, "16:9": { width: 1920, height: 1080 },
}
export type LabImage = { src: string; x: number; y: number; fit: "cover" | "contain" }
export type LabCompositionProps = { templateId: string; images: LabImage[]; title: string; format: LabFormat }
export type LabJob = {
  id: string; templateId: string; title: string; createdAt: string; status: "queued" | "rendering" | "done" | "error"
  progress: number; format: LabFormat; output: "video" | "image"; error?: string
}
export const PAPER_PROMPT = "Transform this photograph into a handcrafted paper-cut diorama. Rebuild all visible surfaces with layered matte colored cardstock, folded edges, subtle paper fibers and soft physical contact shadows. Preserve the original subject, recognizable identity, camera angle, composition and object positions. Warm ivory and sage palette retaining original color relationships. A tactile dimensional paper construction, not a flat photo filter. No extra objects, no text, no watermark."
