import assert from "node:assert/strict"
import { test } from "node:test"
import { access, readFile } from "node:fs/promises"
import { catalog, validateJob, compositionVariables, formatComposition } from "./validation.mjs"

const photo = { src: "data:image/jpeg;base64,AAAA", x: 50, y: 50 }
const job = (templateId, count, extra = {}) => ({ templateId, format: "9:16", theme: "light", photos: Array.from({ length: count }, () => ({ ...photo })), fields: {}, ...extra })

test("every template accepts its minimum and maximum photo count in both formats", () => {
  for (const t of catalog) for (const format of ["9:16", "4:5"]) {
    for (const count of [t.photos.min, t.photos.max]) assert.equal(validateJob({ ...job(t.id, count), format }).id, t.id)
    assert.throws(() => validateJob(job(t.id, t.photos.max + 1)), /фото/)
    if (t.photos.min > 0) assert.throws(() => validateJob(job(t.id, t.photos.min - 1)), /фото/)
  }
})
test("pairs must be complete", () => {
  assert.throws(() => validateJob(job("before-after", 3)), /парами/)
  assert.throws(() => validateJob(job("reveal", 2)), /парами/)
  assert.equal(validateJob(job("reveal", 3)).id, "reveal")
})
test("captions only on allowed slots and within length", () => {
  assert.equal(validateJob(job("details", 2, { photos: [{ ...photo, caption: "Латунь" }, photo] })).id, "details")
  assert.throws(() => validateJob(job("details", 5, { photos: [photo, photo, photo, photo, { ...photo, caption: "x" }] })), /Подпись/)
  assert.throws(() => validateJob(job("details", 1, { photos: [{ ...photo, caption: "x".repeat(31) }] })), /Подпись/)
})
test("fields are checked against the template", () => {
  assert.throws(() => validateJob(job("note", 1, { fields: { nope: "x" } })), /Неизвестное поле/)
  assert.throws(() => validateJob(job("note", 1, { fields: { quote: "x".repeat(151) } })), /не больше/)
  assert.equal(validateJob(job("note", 1, { fields: { quote: "Хорошо" } })).id, "note")
})
test("rejects unsafe sources, formats and themes", () => {
  assert.throws(() => validateJob(job("note", 1, { photos: [{ ...photo, src: "/etc/passwd" }] })), /изображение/)
  assert.throws(() => validateJob(job("note", 1, { photos: [{ ...photo, src: "http://127.0.0.1/x" }] })), /изображение/)
  assert.throws(() => validateJob(job("note", 1, { photos: [{ ...photo, x: 140 }] })), /фокус/)
  assert.throws(() => validateJob(job("note", 1, { format: "16:9" })), /формат/)
  assert.throws(() => validateJob(job("note", 1, { theme: "neon" })), /тема/)
  assert.throws(() => validateJob({ templateId: "nope", photos: [] }), /не найден/)
})
test("composition variables and format substitution", () => {
  const t = catalog.find(t => t.id === "before-after")
  const v = compositionVariables(t, job("before-after", 2, { theme: "dark", fields: { title: "Дом" }, photos: [{ ...photo, x: 20.4, y: 80 }, photo] }), i => `assets/${i + 1}.jpg`)
  assert.equal(v.theme, "dark"); assert.equal(v.title, "Дом"); assert.equal(v.scope, t.fields[1].default)
  assert.equal(v.photo1, "assets/1.jpg"); assert.equal(v.focus1, "20% 80%"); assert.equal(v.photo2, "assets/2.jpg")
  const html = '<html data-format="9:16" data-h="1920"><meta name="viewport" content="width=1080, height=1920" /><div data-width="1080" data-height="1920"></div>'
  assert.equal(formatComposition(html, "4:5"), '<html data-format="4:5" data-h="1350"><meta name="viewport" content="width=1080, height=1350" /><div data-width="1080" data-height="1350"></div>')
  assert.equal(formatComposition(html, "9:16"), html)
})
test("every template has its composition, demo assets and consistent labels", async () => {
  for (const t of catalog) {
    assert.equal(t.photos.labels.length, t.photos.max, t.id)
    assert.ok(t.photos.min >= 1 && t.photos.min <= t.photos.max, t.id)
    for (const src of t.demo.photos) await access(`public${src}`)
    if (t.engine === "hyperframes") {
      const html = await readFile(`public/creative-lab/hf/${t.id}/index.html`, "utf8")
      assert.match(html, new RegExp(`data-composition-id="${t.id}"`))
      const declared = JSON.parse(/data-composition-variables='([^']+)'/.exec(html)[1]).map(v => v.id)
      for (const f of t.fields) assert.ok(declared.includes(f.id), `${t.id}: ${f.id}`)
      for (let i = 1; i <= t.photos.max; i++) assert.ok(declared.includes(`photo${i}`) && declared.includes(`focus${i}`), `${t.id}: photo${i}`)
      for (const slot of t.captions?.slots ?? []) assert.ok(declared.includes(`cap${slot}`), `${t.id}: cap${slot}`)
    }
  }
})
