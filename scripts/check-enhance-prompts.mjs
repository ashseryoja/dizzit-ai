import { readFile } from "node:fs/promises"

const [engine, client, route, sceneClient, sceneRoute, sceneInventory] = await Promise.all([
  readFile(new URL("../src/lib/enhance-engine.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/image-generation.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/images/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/scene-analysis.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/scene/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/server/scene-inventory.ts", import.meta.url), "utf8"),
])

const positiveTerms = [
  // Предметы кадра: инвентарь от vision-модели и правила «предмет остаётся предметом».
  "SCENE INVENTORY",
  "OBJECT IDENTITY",
  "flat black glossy screen",
  "sheer voile",
  "SOURCE QUALITY",
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
  "TV screen turned into a window or painting",
  "curtains merged into the wall",
]

const missing = [...positiveTerms, ...negativeTerms].filter((term) => !engine.includes(term))
if (missing.length > 0) throw new Error(`В enhance-промптах отсутствуют: ${missing.join(", ")}`)

// Разбор сцены: движок запрашивает инвентарь, клиент ходит в /api/scene, роут зовёт аналитика.
if (!engine.includes("describeScene(")) throw new Error("enhance-engine не запрашивает инвентарь сцены (describeScene)")
if (!engine.includes("inventory: meta.sceneInventory") && !engine.includes("job.inventory")) {
  throw new Error("enhance-engine не подставляет инвентарь сцены из задания в промпт")
}
if (!sceneClient.includes('fetch("/api/scene"')) throw new Error("scene-analysis не ходит в /api/scene")
if (!sceneRoute.includes("analyzeScene(")) throw new Error("/api/scene не вызывает analyzeScene")
for (const section of ["ROOM:", "LIGHT:", "OBJECTS:", "EASILY MISREAD:"]) {
  if (!sceneInventory.includes(section)) throw new Error(`Промпт разбора сцены без секции ${section}`)
}

if (!client.includes('form.set("negative_prompt", negativePrompt.trim())')) {
  throw new Error("Клиент не передаёт negative_prompt во внутренний API")
}
if (!route.includes("composeProviderPrompt(prompt, negativePrompt)")) {
  throw new Error("Бэкенд не присоединяет negative prompt к инструкции провайдера")
}

console.log(`check:prompts — ок: ${positiveTerms.length} positive и ${negativeTerms.length} negative маркеров`)
