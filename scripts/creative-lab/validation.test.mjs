import test from "node:test"
import assert from "node:assert/strict"
import { access } from "node:fs/promises"
import { catalog, validateJob } from "./validation.mjs"
const photo = () => ({ src: "data:image/jpeg;base64,YWJjZA==", x: 50, y: 50, fit: "cover" })
const input = (template = catalog[0]) => ({ templateId: template.id, title: "Мой проект", format: "9:16", images: Array.from({ length: template.kind === "hybrid" ? 2 : template.slots.length }, photo) })
test("all six templates accept the documented number of frames and each format", () => {
  for (const template of catalog) for (const format of template.formats) assert.equal(validateJob({ ...input(template), format }).id, template.id)
})
test("rejects missing or extra frames", () => {
  const good = input(); assert.throws(() => validateJob({ ...good, images: [] })); assert.throws(() => validateJob({ ...good, images: [...good.images, photo()] }))
})
test("only accepts embedded image bytes, never remote URLs or local paths", () => {
  for (const src of ["http://127.0.0.1/private", "file:///etc/passwd", "../../private", "data:image/svg+xml;base64,YWJjZA==", "javascript:alert(1)"]) {
    const bad = input(); bad.images[0].src = src; assert.throws(() => validateJob(bad))
  }
})
test("rejects invalid coordinates, fit, template, format and title", () => {
  for (const patch of [{ x: NaN }, { y: -1 }, { x: 101 }, { fit: "fill" }, { src: "" }]) { const bad = input(); Object.assign(bad.images[0], patch); assert.throws(() => validateJob(bad)) }
  for (const patch of [{ templateId: "../secret" }, { format: "4:3" }, { title: "a".repeat(65) }, { title: null }]) assert.throws(() => validateJob({ ...input(), ...patch }))
})
test("every template has an actual local example", async () => {
  for (const t of catalog) {
    for (const src of t.demoImages) await access(`public${src}`)
    if (t.output === "video") { await access(`public/creative-lab/demos/${t.id}.mp4`); await access(`public/creative-lab/demos/${t.id}.jpg`) }
  }
})
