// Persistent local rendering service. No video, image, or template is written to SQL.
// Motion templates are Hyperframes compositions (public/creative-lab/hf) rendered by
// @hyperframes/producer: headless Chrome captures frames, FFmpeg encodes H.264.
import { createServer } from "node:http"
import { createReadStream } from "node:fs"
import { cp, mkdir, readFile, readdir, rename, rm, writeFile, stat } from "node:fs/promises"
import { resolve, join } from "node:path"
import { randomUUID, timingSafeEqual } from "node:crypto"
import sharp from "sharp"
import { validateJob, compositionVariables, formatComposition, MAX_BODY } from "./validation.mjs"

const root = resolve(process.env.CREATIVE_LAB_DIR || ".data/creative-lab")
const templates = resolve(process.env.CREATIVE_LAB_TEMPLATES || "public/creative-lab/hf")
const token = process.env.CREATIVE_LAB_WORKER_TOKEN || ""
const host = process.env.CREATIVE_LAB_HOST || "127.0.0.1"
if (host !== "127.0.0.1" && host !== "localhost" && token.length < 24) throw new Error("Set CREATIVE_LAB_WORKER_TOKEN (24+ characters) before exposing the worker.")
await mkdir(root, { recursive: true })
const jobs = new Map()
let rendering = false
let submissions = 0
const queueFull = () => submissions + [...jobs.values()].filter(j => ["queued", "rendering"].includes(j.status)).length >= 5
let producerPromise
const pathOf = (id, ...file) => join(root, id, ...file)
async function save(job) {
  await writeFile(pathOf(job.id, "job.tmp"), JSON.stringify(job))
  await rename(pathOf(job.id, "job.tmp"), pathOf(job.id, "job.json"))
}
// Interrupted renders become retryable; queued jobs continue after restarting.
for (const id of await readdir(root)) {
  if (!/^[a-f0-9-]{36}$/.test(id)) continue
  try {
    const job = JSON.parse(await readFile(pathOf(id, "job.json"), "utf8"))
    if (job.status === "rendering") { job.status = "error"; job.error = "Сборка прервалась при перезапуске. Повторите экспорт."; await save(job) }
    jobs.set(id, job)
  } catch { /* Incomplete upload is never considered a finished job. */ }
}
const json = (res, status, value) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)) }
function authorized(req) {
  if (!token) return true
  const got = Buffer.from(req.headers.authorization || "")
  const expected = Buffer.from(`Bearer ${token}`)
  return got.length === expected.length && timingSafeEqual(got, expected)
}

/** Job folder → self-contained Hyperframes project: index.html, _shared, assets. */
async function prepareProject(job, template, input) {
  const dir = pathOf(job.id, "project")
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  await cp(join(templates, "_shared"), join(dir, "_shared"), { recursive: true })
  await cp(pathOf(job.id, "assets"), join(dir, "assets"), { recursive: true })
  const source = await readFile(join(templates, template.id, "index.html"), "utf8")
  await writeFile(join(dir, "index.html"), formatComposition(source.replaceAll("../_shared/", "_shared/"), input.format))
  return dir
}
async function renderVideo(job, template, input) {
  producerPromise ??= import("@hyperframes/producer").catch(e => { producerPromise = undefined; throw e })
  const { createRenderJob, executeRenderJob } = await producerPromise
  const projectDir = await prepareProject(job, template, input)
  const variables = compositionVariables(template, input, (i, photo) => photo.file)
  const render = createRenderJob({ fps: 30, quality: "standard", crf: 19, variables, hdrMode: "force-sdr", strictness: "best-effort" })
  const output = pathOf(job.id, "result.tmp.mp4")
  await executeRenderJob(render, projectDir, output, j => {
    const p = typeof j.progress === "number" ? (j.progress <= 1 ? j.progress * 100 : j.progress) : 0
    job.progress = Math.max(job.progress, Math.min(99, Math.round(p)))
  })
  await rename(output, pathOf(job.id, "result.mp4"))
  await rm(projectDir, { recursive: true, force: true })
}
/* Второй движок: Remotion. Композиция src/creative-lab/remotion.tsx получает тот же контракт,
   фотографии — data URL из assets. Шаблон выбирает движок полем `engine` в каталоге. */
let remotionBundle
async function renderRemotion(job, template, input) {
  const [{ bundle }, { renderMedia, selectComposition }] = await Promise.all([import("@remotion/bundler"), import("@remotion/renderer")])
  remotionBundle ??= bundle({ entryPoint: resolve("src/creative-lab/remotion.tsx"), publicDir: resolve("public") }).catch(e => { remotionBundle = undefined; throw e })
  const serveUrl = await remotionBundle
  const photos = await Promise.all(input.photos.map(async p => ({ ...p, src: `data:image/jpeg;base64,${(await readFile(pathOf(job.id, p.file))).toString("base64")}` })))
  const inputProps = { templateId: template.id, photos, fields: compositionVariables(template, input, () => ""), theme: input.theme, format: input.format }
  const composition = await selectComposition({ serveUrl, id: "CreativeLab", inputProps })
  await renderMedia({ composition, serveUrl, inputProps, codec: "h264", crf: 19, concurrency: 2, outputLocation: pathOf(job.id, "result.mp4"), timeoutInMilliseconds: 120_000,
    onProgress: ({ progress }) => { job.progress = Math.min(99, Math.round(progress * 100)) } })
}
async function drain() {
  if (rendering) return
  rendering = true
  try {
    for (const job of jobs.values()) {
      if (job.status !== "queued") continue
      try {
        job.status = "rendering"; job.progress = 0; delete job.error; await save(job)
        const input = JSON.parse(await readFile(pathOf(job.id, "input.json"), "utf8"))
        const template = validateJob({ ...input, photos: input.photos.map(p => ({ ...p, src: "data:image/jpeg;base64,AA==" })) })
        if (job.output === "image") await sharp(pathOf(job.id, input.photos[0].file)).png().toFile(pathOf(job.id, "result.png"))
        else if (template.engine === "remotion") await renderRemotion(job, template, input)
        else await renderVideo(job, template, input)
        job.status = "done"; job.progress = 100
      } catch (e) { console.error(`Creative Lab render ${job.id}:`, e); job.status = "error"; job.error = "Не удалось собрать результат. Повторите экспорт; подробности в журнале Creative Lab." }
      await save(job)
    }
  } finally { rendering = false }
}
const server = createServer(async (req, res) => {
  try {
    if (!authorized(req)) return json(res, 401, { message: "Нет доступа к рендеру." })
    // This is an internal service. Browsers must use the authenticated Next proxy.
    if (req.headers.origin) return json(res, 403, { message: "Прямой запрос из браузера не разрешён." })
    const url = new URL(req.url, "http://localhost")
    if (req.method === "GET" && url.pathname === "/health") return json(res, 200, { ready: true, storage: "disk", engine: "hyperframes" })
    if (req.method === "GET" && url.pathname === "/jobs") return json(res, 200, { jobs: [...jobs.values()].reverse() })
    const match = /^\/jobs\/([a-f0-9-]{36})(\/file|\/retry)?$/.exec(url.pathname)
    if (match) {
      const job = jobs.get(match[1])
      if (!job) return json(res, 404, { message: "Результат не найден." })
      if (req.method === "POST" && match[2] === "/retry") {
        if (job.status !== "error") return json(res, 409, { message: "Задача уже выполняется или завершена." })
        if (queueFull()) return json(res, 429, { message: "Очередь заполнена. Попробуйте позже." })
        job.status = "queued"; job.progress = 0; delete job.error; await save(job); void drain(); return json(res, 202, job)
      }
      if (req.method === "GET" && !match[2]) return json(res, 200, job)
      if (req.method === "GET" && match[2] === "/file" && job.status === "done") {
        const ext = job.output === "video" ? "mp4" : "png"
        const file = pathOf(job.id, `result.${ext}`)
        const { size } = await stat(file)
        const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/)
        const start = range ? Number(range[1]) : 0
        const end = range && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1
        if (start >= size || start > end) { res.writeHead(416, { "Content-Range": `bytes */${size}` }); return res.end() }
        res.writeHead(range ? 206 : 200, { "Content-Type": ext === "mp4" ? "video/mp4" : "image/png", "Content-Length": end - start + 1, "Accept-Ranges": "bytes", "Cache-Control": "private, no-cache", ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}), ...(url.searchParams.has("download") ? { "Content-Disposition": `attachment; filename="${job.templateId}-${job.id.slice(0, 8)}.${ext}"` } : {}) })
        const stream = createReadStream(file, { start, end }); res.on("close", () => stream.destroy()); stream.pipe(res); return
      }
    }
    if (req.method === "POST" && url.pathname === "/jobs") {
      if (queueFull()) return json(res, 429, { message: "В очереди уже пять задач. Дождитесь завершения одной из них." })
      submissions++
      try {
        let size = 0; const parts = []
        for await (const part of req) { size += part.length; if (size > MAX_BODY) return json(res, 413, { message: "Слишком большой набор фотографий." }); parts.push(part) }
        let input, template
        try { input = JSON.parse(Buffer.concat(parts).toString()); template = validateJob(input) }
        catch (e) { return json(res, 400, { message: e.message || "Не удалось прочитать изображения." }) }
        const id = randomUUID()
        await mkdir(pathOf(id, "assets"), { recursive: true })
        const photos = []
        try {
          for (const [i, image] of input.photos.entries()) {
            const decoded = Buffer.from(image.src.split(",")[1], "base64")
            const file = `assets/${i + 1}.jpg`
            await sharp(decoded, { limitInputPixels: 40_000_000 }).rotate().resize({ width: 2560, height: 2560, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 93 }).toFile(pathOf(id, file))
            photos.push({ file, x: image.x, y: image.y, ...(image.caption ? { caption: image.caption } : {}) })
          }
        } catch (e) { await rm(pathOf(id), { recursive: true, force: true }); return json(res, 400, { message: "Не удалось прочитать изображения." }) }
        // Keep only the validated contract; never accept filesystem paths or asset URLs.
        const title = template.fields.length ? (input.fields?.[template.fields[0].id] ?? template.fields[0].default) : ""
        await writeFile(pathOf(id, "input.json"), JSON.stringify({ templateId: template.id, format: input.format || "9:16", theme: input.theme === "dark" ? "dark" : "light", fields: input.fields ?? {}, photos }))
        const job = { id, templateId: template.id, title, format: input.format || "9:16", output: template.output, status: "queued", progress: 0, createdAt: new Date().toISOString() }
        await save(job); jobs.set(id, job); json(res, 202, job); void drain(); return
      } finally { submissions-- }
    }
    json(res, 404, { message: "Не найдено." })
  } catch (e) { console.error(e); if (!res.headersSent) json(res, 500, { message: "Не удалось обработать задание." }); else res.destroy() }
})
server.listen(Number(process.env.CREATIVE_LAB_PORT || 4318), host, () => { console.log(`Creative Lab: http://${host}:${process.env.CREATIVE_LAB_PORT || 4318} · storage: ${root} · templates: ${templates}`); void drain() })
