import { readFile } from "node:fs/promises"
export const catalog = JSON.parse(await readFile(new URL("../../src/creative-lab/catalog.json", import.meta.url), "utf8"))
export const MAX_BODY = 48 * 1024 * 1024
export const FORMATS = { "9:16": { width: 1080, height: 1920 }, "4:5": { width: 1080, height: 1350 } }
const FOCUS = /^\d{1,3}% \d{1,3}%$/
const DATA_IMAGE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/

/** Контракт задания: шаблон, формат, тема, фотографии с фокусом и подписями, текстовые поля. */
export function validateJob(input) {
  if (!input || typeof input !== "object") throw new Error("Некорректное задание.")
  const template = catalog.find(t => t.id === input.templateId)
  if (!template) throw new Error("Шаблон не найден.")
  if (template.output === "video" && !FORMATS[input.format]) throw new Error("Неподдерживаемый формат.")
  if (input.theme !== undefined && !["light", "dark"].includes(input.theme)) throw new Error("Неизвестная тема.")
  const photos = input.photos
  const { min, max, pairs } = template.photos
  if (!Array.isArray(photos) || photos.length < min || photos.length > max) throw new Error(min === max ? `Нужно ровно ${min} фото.` : `Нужно от ${min} до ${max} фото.`)
  if (pairs && (photos.length - pairs.lead) % 2) throw new Error("Фотографии должны идти парами.")
  for (const [i, image] of photos.entries()) {
    if (!image || typeof image.src !== "string" || image.src.length > 12 * 1024 * 1024 || !DATA_IMAGE.test(image.src)) throw new Error("Ожидается изображение JPG, PNG или WebP.")
    if (![image.x, image.y].every(v => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 100)) throw new Error("Некорректная точка фокуса.")
    if (image.caption !== undefined) {
      const allowed = template.captions?.slots.includes(i + 1)
      if (typeof image.caption !== "string" || (!allowed && image.caption) || image.caption.length > (template.captions?.max ?? 0)) throw new Error("Подпись к кадру слишком длинная.")
    }
  }
  const fields = input.fields ?? {}
  if (typeof fields !== "object" || Array.isArray(fields)) throw new Error("Некорректные поля.")
  for (const key of Object.keys(fields)) {
    const field = template.fields.find(f => f.id === key)
    if (!field) throw new Error(`Неизвестное поле «${key}».`)
    if (typeof fields[key] !== "string" || fields[key].length > field.max) throw new Error(`«${field.label}»: не больше ${field.max} символов.`)
    if (field.kind === "color" && fields[key] && !/^#[0-9a-f]{6}$/i.test(fields[key])) throw new Error(`«${field.label}»: цвет в виде #rrggbb.`)
  }
  return template
}

/** Переменные композиции Hyperframes из задания; `src(i)` даёт путь к i-й фотографии. */
export function compositionVariables(template, input, src) {
  const variables = { theme: input.theme === "dark" ? "dark" : "light" }
  for (const field of template.fields) variables[field.id] = typeof input.fields?.[field.id] === "string" ? input.fields[field.id] : field.default
  input.photos.forEach((photo, i) => {
    variables[`photo${i + 1}`] = src(i, photo)
    variables[`focus${i + 1}`] = `${Math.round(photo.x)}% ${Math.round(photo.y)}%`
    if (photo.caption) variables[`cap${i + 1}`] = photo.caption
  })
  return variables
}

/** Та же HTML-композиция в другом формате: размеры корня и viewport. */
export function formatComposition(html, format) {
  const { height } = FORMATS[format] ?? FORMATS["9:16"]
  return html
    .replace('data-format="9:16"', `data-format="${format}"`)
    .replace('data-h="1920"', `data-h="${height}"`)
    .replace("height=1920", `height=${height}`)
    .replace('data-height="1920"', `data-height="${height}"`)
}
export function focusString(photo) { return `${Math.round(photo.x)}% ${Math.round(photo.y)}%` }
