import { DIMENSIONS, type LabFormat, type LabImage, type LabTemplate, type LabTheme } from "./types"

/** Переменные композиции Hyperframes; `src(i)` даёт адрес i-й фотографии. Зеркало scripts/creative-lab/validation.mjs. */
export function compositionVariables(template: LabTemplate, input: { theme: LabTheme; fields: Record<string, string>; photos: LabImage[] }, src: (i: number, photo: LabImage) => string) {
  const variables: Record<string, string> = { theme: input.theme === "dark" ? "dark" : "light" }
  for (const field of template.fields) variables[field.id] = typeof input.fields[field.id] === "string" ? input.fields[field.id] : field.default
  input.photos.forEach((photo, i) => {
    variables[`photo${i + 1}`] = src(i, photo)
    variables[`focus${i + 1}`] = `${Math.round(photo.x)}% ${Math.round(photo.y)}%`
    if (photo.caption) variables[`cap${i + 1}`] = photo.caption
  })
  return variables
}
/** Та же HTML-композиция в другом формате: размеры корня и viewport. */
export function formatComposition(html: string, format: LabFormat) {
  const { height } = DIMENSIONS[format]
  return html
    .replace('data-format="9:16"', `data-format="${format}"`)
    .replace('data-h="1920"', `data-h="${height}"`)
    .replace("height=1920", `height=${height}`)
    .replace('data-height="1920"', `data-height="${height}"`)
}
const htmlCache = new Map<string, Promise<string>>()
export function loadTemplateHtml(id: string) {
  let pending = htmlCache.get(id)
  if (!pending) {
    pending = fetch(`/creative-lab/hf/${id}/index.html`, { cache: "no-cache" }).then(r => { if (!r.ok) throw new Error("Шаблон не найден."); return r.text() })
    pending.catch(() => htmlCache.delete(id))
    htmlCache.set(id, pending)
  }
  return pending
}
/** Документ для srcdoc плеера: <base> на папку шаблона и переменные до скриптов композиции. */
export function composeDocument(html: string, template: LabTemplate, format: LabFormat, variables: Record<string, string>) {
  const inject = `<base href="${location.origin}/creative-lab/hf/${template.id}/" /><script>window.__hfVariables=${JSON.stringify(variables).replace(/</g, "\\u003c")};</script>`
  return formatComposition(html, format).replace(/<head([^>]*)>/i, (m) => `${m}${inject}`)
}
