import { readFile } from "node:fs/promises"
export const catalog = JSON.parse(await readFile(new URL("../../src/creative-lab/catalog.json", import.meta.url), "utf8"))
export const MAX_BODY = 24 * 1024 * 1024
export function validateJob(input) {
  if (!input || typeof input !== "object") throw new Error("Некорректное задание.")
  const template = catalog.find(t => t.id === input.templateId)
  if (!template) throw new Error("Шаблон не найден.")
  if (!template.formats.includes(input.format)) throw new Error("Неподдерживаемый формат.")
  if (typeof input.title !== "string" || input.title.length > 64) throw new Error("Заголовок: не больше 64 символов.")
  const count = template.kind === "hybrid" ? 2 : template.slots.length
  if (!Array.isArray(input.images) || input.images.length !== count) throw new Error(`Нужно ровно ${count} изображений.`)
  for (const image of input.images) {
    if (!image || typeof image.src !== "string" || image.src.length > 8 * 1024 * 1024 || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/.test(image.src)) throw new Error("Ожидается изображение JPG, PNG или WebP.")
    if (![image.x, image.y].every(v => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100) || !["cover", "contain"].includes(image.fit)) throw new Error("Некорректное кадрирование.")
  }
  return template
}
