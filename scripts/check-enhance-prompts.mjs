import { readFile } from "node:fs/promises"

const [engine, client, route, sceneClient, sceneRoute, sceneInventory, providerContract, regions, frameServer, restyle, materials, views] = await Promise.all([
  readFile(new URL("../src/lib/enhance-engine.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/image-generation.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/images/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/scene-analysis.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/scene/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/server/scene-inventory.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/server/image-provider.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/render-regions.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/server/image-frame.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/restyle-engine.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/material-engine.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/view-engine.ts", import.meta.url), "utf8"),
])

const positiveTerms = [
  // Предметы кадра: инвентарь от vision-модели и правила «предмет остаётся предметом».
  "SCENE INVENTORY",
  "OBJECT IDENTITY",
  "flat black glossy screen",
  "sheer voile",
  "SOURCE QUALITY",
  // Материалы — как выбрал дизайнер: травертин не становится микроцементом.
  "MATERIAL FIDELITY",
  "never swapping it for a smoother, plainer or more common lookalike",
  // Мелкая структура: число спотов, ножки мебели и просвет под ней, раскладка пола.
  "STRUCTURE LOCK",
  "never merge two fixtures into one",
  "thin legs stay thin and separate",
  "do not narrow, widen, rotate or re-lay the boards",
  // Режим «оставить как есть» не приносит выдуманное солнце.
  "EXISTING LIGHT",
  "volumetric lighting",
  "god rays",
  "cinematic lighting",
  "soft natural light",
  "morning sunlight coming through window",
  "global illumination",
  "ambient occlusion",
  "ray tracing",
  "ultra-realistic",
  "hyperrealistic",
  "architectural photography",
  "interior design magazine",
  "photorealistic",
  "8k resolution",
  "highly detailed",
  "shot on Sony A7R IV",
  "35mm lens",
  "depth of field (DoF)",
]

// Правки дизайнера (комментарий и отмеченные области) сильнее замков: «удалить»
// и «добавить» расписаны отдельно, запреты не отменяют прошеную правку.
const editTerms = [
  "DESIGNER'S EDITS HAVE PRIORITY",
  "An output where a requested edit is missing is a failed output",
  "MARKED AREAS",
  "- REMOVE (убрать, удалить",
  "- ADD (добавить, поставить",
  "- REPLACE or CHANGE",
  "DESIGNER'S EDITS — MANDATORY",
  "objects removed without being asked",
  "a requested edit skipped or only half done",
  "The inventory describes the scene BEFORE the designer's edits",
  "focusedEdit",
]

// Светильники: состояние ON/OFF из инвентаря заперто, горящая лампа светит вокруг
// себя, выключенная не светится; итог — 4K (ступень провайдера + Lanczos 3840 px).
const lightTerms = [
  "LIGHT FIXTURES — STATE LOCK",
  "a fixture that is OFF stays OFF",
  "never a flat clipped blob",
  "inverse-square falloff",
  "no dotting, stepping or banding",
  "A fixture that is OFF is still a beautiful real object",
  "Light must always have a source",
  "unlit lamps switched on, lit lamps switched off",
  "isCurrentInventory(job.inventory)",
  "export const ENHANCE_LONG_SIDE = OUTPUT_LONG_SIDE",
  'export const ENHANCE_RESOLUTION = "4K"',
  "storeKey: job.storeKey",
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
  "substituted materials",
  "travertine or limestone turned into microcement",
  "changed number of spotlights",
  "merged furniture legs",
  "changed plank width",
]

const missing = [...positiveTerms, ...editTerms, ...lightTerms, ...negativeTerms].filter((term) => !engine.includes(term))
if (missing.length > 0) throw new Error(`В enhance-промптах отсутствуют: ${missing.join(", ")}`)

// Разбор сцены: движок запрашивает инвентарь, клиент ходит в /api/scene, роут зовёт аналитика.
if (!engine.includes("describeScene(")) throw new Error("enhance-engine не запрашивает инвентарь сцены (describeScene)")
if (!engine.includes("inventory: meta.sceneInventory") && !engine.includes("job.inventory")) {
  throw new Error("enhance-engine не подставляет инвентарь сцены из задания в промпт")
}
if (!sceneClient.includes('fetch("/api/scene"')) throw new Error("scene-analysis не ходит в /api/scene")
if (!sceneRoute.includes("analyzeScene(")) throw new Error("/api/scene не вызывает analyzeScene")
if (!sceneInventory.includes("NOT microcement")) throw new Error("Промпт разбора сцены не требует называть материал-двойник (NOT …)")
if (!sceneInventory.includes("exact COUNT and layout")) throw new Error("Промпт разбора сцены не требует точного числа светильников")
if (!sceneInventory.includes("legs or supports")) throw new Error("Промпт разбора сцены не описывает опоры мебели и просвет под ней")
if (!sceneInventory.includes("board width")) throw new Error("Промпт разбора сцены не фиксирует ширину и направление досок пола")
if (!sceneClient.includes("hasMaterialsSection(inventory) && hasFixturesSection(inventory)")) {
  throw new Error("scene-analysis: инвентарь без секций MATERIALS и FIXTURES должен считаться устаревшим")
}
if (!sceneInventory.includes("Decide ON or OFF for every type from visible evidence")) {
  throw new Error("Промпт разбора сцены не требует явного ON/OFF по каждому типу светильников")
}
// 4K-результат (5–10 МБ) не пролезает в тело ответа/запроса Vercel: ответ — потоком, файл — в хранилище на сервере.
if (!route.includes("streamBytes(output.bytes") || !route.includes("store_key")) {
  throw new Error("/api/images должен отдавать результат потоком и сохранять его по store_key")
}
for (const section of ["ROOM:", "LIGHT:", "FIXTURES:", "MATERIALS:", "OBJECTS:", "EASILY MISREAD:"]) {
  if (!sceneInventory.includes(section)) throw new Error(`Промпт разбора сцены без секции ${section}`)
}

// Последний блок инструкции (запреты) не отменяет прошеную правку.
if (!providerContract.includes("never cancel an edit that the instructions above explicitly request")) {
  throw new Error("composeProviderPrompt: запреты должны явно уступать правкам, которые просит инструкция")
}
// Правка по областям — самое длинное задание: роут не должен отбивать его по длине.
const promptLimit = Number(route.match(/MAX_PROMPT_CHARS = ([\d_]+)/)?.[1]?.replaceAll("_", "") ?? 0)
if (promptLimit < 28_000 || promptLimit > 32_000) {
  throw new Error(`MAX_PROMPT_CHARS = ${promptLimit}: задание с правками дизайнера — до ~27,5 тыс. символов, потолок gpt-image-2 — 32 тыс.`)
}
// Кадр пользователя не обрезается: провайдер знает только свои пропорции, поэтому
// редактор и перенос стиля просят `frame: "pad"` (поля до генерации, вырезка после),
// ракурсы — `frame: "crop"`, и все результаты доводятся до 4K бесплатным Lanczos.
if (!client.includes("export const OUTPUT_LONG_SIDE = 3840")) throw new Error("image-generation: OUTPUT_LONG_SIDE должен быть 3840 (4K)")
if (!engine.includes('frame: "pad"') || !engine.includes("finalLongSide: ENHANCE_LONG_SIDE,")) {
  throw new Error("enhance-engine: кадр исходника (frame: \"pad\") и 4K должны уходить всегда, а не только с улучшением качества")
}
if (!restyle.includes('frame: "pad"') || !restyle.includes("finalLongSide: OUTPUT_LONG_SIDE")) throw new Error("restyle-engine: кадр исходника и 4K")
if (!materials.includes("tileable: true") || !materials.includes("finalLongSide: OUTPUT_LONG_SIDE")) throw new Error("material-engine: 4K-тайл с масштабом «с заворотом»")
if (!views.includes('frame: "crop"') || !views.includes("VIEW_LONG_SIDE = OUTPUT_LONG_SIDE")) throw new Error("view-engine: кадр в выбранном формате и 4K")
if (!route.includes("padReferences(references, aspect, plan)") || !route.includes("provider.outputRatio(aspect)") || !route.includes("finalizeGeneratedImage(")) {
  throw new Error("/api/images должен подгонять кадр под пропорцию провайдера и вырезать его обратно")
}
if (!frameServer.includes("FORMAT EXTENSION") || !frameServer.includes('extendWith: "mirror"')) {
  throw new Error("image-frame: поля подгонки — размытое зеркальное продолжение с пояснением модели")
}
// Область без подписи + общий текст — обычная точечная правка, а не закрытая кнопка.
if (!regions.includes("Правка выше относится к отмеченной на карте области")) {
  throw new Error("render-regions: общий комментарий не адресуется областям без подписи")
}

if (!client.includes('form.set("negative_prompt", negativePrompt.trim())')) {
  throw new Error("Клиент не передаёт negative_prompt во внутренний API")
}
if (!/composeProviderPrompt\(\w+, negativePrompt\)/.test(route)) {
  throw new Error("Бэкенд не присоединяет negative prompt к инструкции провайдера")
}

console.log(`check:prompts — ок: ${positiveTerms.length} positive, ${editTerms.length} маркеров правок, ${lightTerms.length} маркеров света и 4K, кадр и 4K у всех инструментов, ${negativeTerms.length} negative`)
