// Catalogue demos: each video template rendered with its demo photos, then downscaled
// to 540 px for a light catalogue. Requires FFmpeg on PATH; Chrome is fetched by Hyperframes.
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { spawn } from "node:child_process"
import { createRenderJob, executeRenderJob } from "@hyperframes/producer"
import { catalog, compositionVariables, formatComposition } from "./validation.mjs"

const destination = resolve("public/creative-lab/demos")
const templates = resolve("public/creative-lab/hf")
await mkdir(destination, { recursive: true })
const only = process.argv.slice(2)
const run = (cmd, args) => new Promise((ok, fail) => { const p = spawn(cmd, args, { stdio: ["ignore", "ignore", "inherit"] }); p.on("exit", code => code ? fail(new Error(`${cmd} exited ${code}`)) : ok()) })

for (const template of catalog.filter(t => t.output === "video" && (!only.length || only.includes(t.id)))) {
  const work = await mkdtemp(join(tmpdir(), `dizzit-demo-${template.id}-`))
  await cp(join(templates, "_shared"), join(work, "_shared"), { recursive: true })
  await mkdir(join(work, "assets"))
  const photos = []
  for (const [i, src] of template.demo.photos.entries()) {
    await cp(resolve("public", src.slice(1)), join(work, "assets", `${i + 1}.jpg`))
    photos.push({ src: "", x: 50, y: 50, caption: template.demo.captions?.[String(i + 1)] })
  }
  const source = await readFile(join(templates, template.id, "index.html"), "utf8")
  await writeFile(join(work, "index.html"), formatComposition(source.replaceAll("../_shared/", "_shared/"), "9:16"))
  const variables = compositionVariables(template, { theme: "dark", fields: {}, photos }, i => `assets/${i + 1}.jpg`)
  const full = join(work, "full.mp4")
  const job = createRenderJob({ fps: 30, quality: "standard", crf: 18, variables, hdrMode: "force-sdr", strictness: "best-effort" })
  await executeRenderJob(job, work, full)
  await run("ffmpeg", ["-v", "error", "-y", "-i", full, "-vf", "scale=540:-2", "-c:v", "libx264", "-crf", "25", "-preset", "slow", "-movflags", "+faststart", "-an", join(destination, `${template.id}.mp4`)])
  await run("ffmpeg", ["-v", "error", "-y", "-ss", String(Math.max(1, Math.round((await duration(full)) * .62))), "-i", full, "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "4", join(destination, `${template.id}.jpg`)])
  await rm(work, { recursive: true, force: true })
  console.log(`Ready: ${template.id}`)
}
async function duration(file) {
  return new Promise((ok, fail) => {
    const p = spawn("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file])
    let out = ""; p.stdout.on("data", b => { out += b }); p.on("exit", code => code ? fail(new Error("ffprobe failed")) : ok(Number(out) || 10))
  })
}
