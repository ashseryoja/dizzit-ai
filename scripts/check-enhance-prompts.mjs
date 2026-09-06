import { readFile } from "node:fs/promises"

const [engine, client, route] = await Promise.all([
  readFile(new URL("../src/lib/enhance-engine.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/image-generation.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/images/route.ts", import.meta.url), "utf8"),
])

const positiveTerms = [
  "volumetric lighting",
  "god rays",
  "cinematic lighting",
  "soft natural light",
  "morning sunlight coming through window",
  "global illumination",
  "ambient occlusion",
  "ray tracing",
  "architectural photography",
  "interior design magazine",
  "photorealistic",
  "8k resolution",
  "highly detailed",
  "shot on Sony A7R IV",
  "35mm lens",
  "depth of field (DoF)",
]

const negativeTerms = [
  "cheap 3D render",
  "plastic materials",
  "flat lighting",
  "unnatural colors",
  "changed room geometry",
  "fake lens-flare overlay",
]

const missing = [...positiveTerms, ...negativeTerms].filter((term) => !engine.includes(term))
if (missing.length > 0) throw new Error(`В enhance-промптах отсутствуют: ${missing.join(", ")}`)

if (!client.includes('form.set("negative_prompt", negativePrompt.trim())')) {
  throw new Error("Клиент не передаёт negative_prompt во внутренний API")
}
if (!route.includes("composeProviderPrompt(prompt, negativePrompt)")) {
  throw new Error("Бэкенд не присоединяет negative prompt к инструкции провайдера")
}

console.log(`check:prompts — ок: ${positiveTerms.length} positive и ${negativeTerms.length} negative маркеров`)
