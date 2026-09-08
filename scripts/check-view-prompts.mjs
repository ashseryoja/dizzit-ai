import { readFile } from "node:fs/promises"

const [presets, planner, engine, page, client, route] = await Promise.all([
  readFile(new URL("../src/lib/view-presets.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/server/shot-planner.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/view-engine.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/(main)/views/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../src/lib/shot-planning.ts", import.meta.url), "utf8"),
  readFile(new URL("../src/app/api/shots/route.ts", import.meta.url), "utf8"),
])

const required = [
  [presets, 'set: ["vantage", "detail", "vantage", "detail", "vantage", "detail", "vantage"]'],
  [presets, '"overhead", "high_three_quarter", "side_oblique", "low_three_quarter"'],
  [planner, "rank candidate anchors by visual strength"],
  [planner, "no subject more than twice"],
  [planner, '"camera": "overhead|high_three_quarter|side_oblique|low_three_quarter'],
  [engine, "REFERENCE ROLES: IMAGE 1 is the close subject reference; IMAGE 2 is the full-scene continuity blueprint"],
  [engine, "references = vantage && crop && reference ? [crop, reference] : [base]"],
  [engine, "VANTAGE_DUPLICATE_THRESHOLD"],
  [client, 'form.set("inventory", options.inventory.trim())'],
  [route, "{ preset, aspect, note, inventory }"],
  [page, "await describeScene(source)"],
  [page, "await planViewFrames(source"],
]

const missing = required.filter(([source, marker]) => !source.includes(marker)).map(([, marker]) => marker)
if (missing.length > 0) throw new Error(`Пайплайн ракурсов потерял обязательные правила: ${missing.join(", ")}`)

const sceneBeforePlan = page.indexOf("await describeScene(source)") < page.indexOf("await planViewFrames(source")
if (!sceneBeforePlan) throw new Error("Инвентарь сцены должен быть готов до планирования кадров")

console.log("check:views — ок: арт-дирекция, 4 камеры, continuity bible, 2 референса и контроль дублей")
