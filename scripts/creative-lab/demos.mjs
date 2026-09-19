import { mkdir, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { bundle } from "@remotion/bundler"
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer"
import { catalog } from "./validation.mjs"

const destination = resolve("public/creative-lab/demos")
await mkdir(destination, { recursive: true })
const serveUrl = await bundle({ entryPoint: resolve("src/creative-lab/remotion.tsx"), publicDir: resolve("public") })
for (const template of catalog.filter(t => t.output === "video")) {
  const images = await Promise.all(template.demoImages.map(async src => ({ src: `data:image/jpeg;base64,${(await readFile(resolve("public", src.slice(1)))).toString("base64")}`, x: 50, y: 50, fit: "cover" })))
  const inputProps = { templateId: template.id, images, title: template.title, format: "9:16" }
  const full = await selectComposition({ serveUrl, id: "CreativeLab", inputProps })
  // Lightweight catalogue files; final user videos render at full 1080p.
  const composition = { ...full, width: 540, height: 960 }
  await renderMedia({ serveUrl, composition, inputProps, codec: "h264", crf: 24, concurrency: 2, outputLocation: resolve(destination, `${template.id}.mp4`) })
  await renderStill({ serveUrl, composition, inputProps, frame: Math.round(composition.durationInFrames * .7), imageFormat: "jpeg", output: resolve(destination, `${template.id}.jpg`) })
  console.log(`Ready: ${template.id} (${template.duration}s)`)
}
