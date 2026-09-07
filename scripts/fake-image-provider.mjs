// Фальшивый провайдер картинок для проверки прокси без ключа и без расходов.
// На одном порту эмулирует оба протокола, которые понимает src/server/:
//
//  - API Models (основной): POST /v1/images/generations с JSON {aspect_ratio,
//    resolution, image_base64 | image_urls} → {code, data:{taskId, state}};
//    GET /v1/images/generations?task_id= → processing, затем completed с
//    resultUrls на /result/<id>.png этого же сервера;
//  - LaoZhang / OpenAI Images API (запасной): POST /v1/images/generations с
//    JSON {size} и POST /v1/images/edits multipart → data[0].b64_json.
//
// Слова в промпте управляют исходом: FAIL_500 — ошибка сервера, FAIL_SAFETY —
// отказ по политике, FAIL_QUOTA — пустой баланс. Логирует, что пришло.
import { createServer } from "node:http"
import { deflateSync } from "node:zlib"

const PORT = Number(process.env.PORT || 4321)
const RESOLUTION_LONG_SIDE = { "1K": 1024, "2K": 2048, "4K": 4096 }

function crc32(buf) {
  const table = []
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, "ascii")
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

/** Простой PNG: градиент + диагональ, чтобы результат отличался от исходника. */
function makePng(width, height, seed) {
  const raw = Buffer.alloc((width * 3 + 1) * height)
  let offset = 0
  for (let y = 0; y < height; y += 1) {
    raw[offset++] = 0
    for (let x = 0; x < width; x += 1) {
      const diag = Math.abs(x / width - y / height) < 0.01 ? 255 : 0
      raw[offset++] = Math.max(diag, Math.round((x / width) * 200 + seed) % 256)
      raw[offset++] = Math.max(diag, Math.round((y / height) * 200) % 256)
      raw[offset++] = Math.max(diag, 120)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

function dimsForAspect(aspectRatio, resolution) {
  const [w, h] = String(aspectRatio || "1:1").split(":").map(Number)
  const ratio = w > 0 && h > 0 ? w / h : 1
  const long = RESOLUTION_LONG_SIDE[resolution] || RESOLUTION_LONG_SIDE["1K"]
  return ratio >= 1 ? [long, Math.round(long / ratio)] : [Math.round(long * ratio), long]
}

const json = (res, status, body) => {
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(body))
}

let calls = 0
const tasks = new Map()
const results = new Map()

createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)

  // Готовый результат задачи API Models.
  if (req.method === "GET" && url.pathname.startsWith("/result/")) {
    const png = results.get(url.pathname.slice("/result/".length))
    if (!png) return json(res, 404, { error: "no such result" })
    res.writeHead(200, { "Content-Type": "image/png" })
    return res.end(png)
  }

  const chunks = []
  for await (const part of req) chunks.push(part)
  const body = Buffer.concat(chunks)
  calls += 1
  const auth = req.headers.authorization || ""
  const contentType = req.headers["content-type"] || ""

  if (!auth.startsWith("Bearer ")) return json(res, 401, { error: { message: "missing bearer" } })

  // Vision-чат (разбор сцены и планировщик кадров «Ракурсов»): планировщику —
  // список кадров по строке `REQUIRED SLOTS:` из промпта, остальным — короткий
  // инвентарь. Слово FAIL_VISION в промпте — ошибка сервера.
  if (req.method === "POST" && url.pathname.endsWith("/chat/completions")) {
    const payload = JSON.parse(body.toString("utf8"))
    const parts = payload.messages?.[0]?.content
    const text = Array.isArray(parts) ? parts.map((p) => p.text || "").join("\n") : String(parts || "")
    const slots = (text.match(/REQUIRED SLOTS:\s*([a-z, ]+)/) || [])[1]
    let content
    if (slots) {
      const angles = ["low", "top", "left", "right"]
      let angle = 0
      const shots = slots.split(",").map((s) => s.trim()).filter(Boolean).map((slot, i) => {
        const kind = slot === "angle" ? angles[angle++ % 4] : slot
        const shot = {
          kind,
          label: { angle: "вид из проёма", detail: "ваза на консоли", texture: "шпон дуба крупно", fragment: "угол у окна", vantage: "стол сверху" }[slot] + ` ${i + 1}`,
          brief: `Fake ${slot} shot #${i + 1} of the same room, crop ${kind}.`,
          region: [Math.min(0.6, 0.05 + i * 0.12), 0.2, slot === "texture" ? 0.2 : 0.35, 0.4],
        }
        if (slot === "vantage") shot.side = i % 2 ? "right" : "left"
        return shot
      })
      content = JSON.stringify(shots)
    } else {
      content = "ROOM: fake room.\nLIGHT: fake light.\nMATERIALS: floor — oak.\nOBJECTS: sofa — centre.\nEASILY MISREAD: none."
    }
    console.log(`#${calls} POST ${url.pathname} [vision] model=${payload.model} ${slots ? `shots(${slots})` : "inventory"}`)
    if (text.includes("FAIL_VISION")) return json(res, 500, { error: { message: "simulated vision failure" } })
    return json(res, 200, {
      choices: [{ message: { content }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1000, completion_tokens: 200 },
    })
  }

  // Опрос задачи API Models: первый ответ processing, дальше completed.
  if (req.method === "GET" && url.searchParams.has("task_id")) {
    const task = tasks.get(url.searchParams.get("task_id"))
    if (!task) return json(res, 404, { code: 404, msg: "task not found" })
    task.polls += 1
    console.log(`#${calls} GET task ${task.id} poll ${task.polls}`)
    if (task.failMsg) return json(res, 200, { code: 200, msg: "success", data: { taskId: task.id, state: "failed", failMsg: task.failMsg } })
    if (task.polls < 2) return json(res, 200, { code: 200, msg: "success", data: { taskId: task.id, state: "processing" } })
    return json(res, 200, {
      code: 200,
      msg: "success",
      data: { taskId: task.id, state: "completed", resultUrls: [`http://127.0.0.1:${PORT}/result/${task.id}.png`], costTime: 1200 },
    })
  }

  let model = "?"
  let prompt = ""
  let size = ""
  let aspectRatio = ""
  let resolution = ""
  let files = 0
  let fields = ""
  if (contentType.includes("application/json")) {
    const payload = JSON.parse(body.toString("utf8"))
    model = payload.model
    prompt = payload.prompt || ""
    size = payload.size || ""
    aspectRatio = payload.aspect_ratio || ""
    resolution = payload.resolution || ""
    if (payload.image_base64) {
      files = 1
      fields = `image_base64(${payload.image_mime_type || "?"})`
    } else if (Array.isArray(payload.image_urls)) {
      files = payload.image_urls.length
      fields = `image_urls[${payload.image_urls.map((u) => String(u).slice(0, 15)).join(",")}…]`
    }
  } else {
    const text = body.toString("latin1")
    const field = (name) => {
      const m = text.match(new RegExp(`name="${name}"\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--`))
      return m ? m[1] : ""
    }
    model = field("model")
    size = field("size")
    prompt = Buffer.from(field("prompt"), "latin1").toString("utf8")
    files = (text.match(/filename="/g) || []).length
    fields = [...new Set([...text.matchAll(/name="(image(?:\[\])?)"/g)].map((m) => m[1]))].join(",")
  }
  const apiModels = Boolean(aspectRatio || resolution) || (!size && contentType.includes("application/json") && url.pathname.endsWith("/generations"))
  console.log(
    `#${calls} ${req.method} ${url.pathname} [${apiModels ? "apimodels" : "laozhang"}] model=${model} ` +
      `${apiModels ? `aspect=${aspectRatio || "-"} resolution=${resolution || "-"}` : `size=${size || "-"}`} files=${files}${fields ? ` (${fields})` : ""} bytes=${body.length}`
  )
  console.log(`   prompt: ${prompt.slice(0, 160).replace(/\n/g, " | ")}${prompt.length > 160 ? "…" : ""}`)

  if (prompt.includes("FAIL_500")) return json(res, 500, { code: 500, msg: "simulated upstream failure", error: { message: "simulated upstream failure" } })
  if (prompt.includes("FAIL_QUOTA")) return json(res, 403, { code: 403, msg: "insufficient balance", error: { message: "insufficient balance" } })
  if (!apiModels && prompt.includes("FAIL_SAFETY")) return json(res, 400, { error: { message: "rejected by safety system" } })

  if (apiModels) {
    const id = `task_${calls}_${Date.now().toString(36)}`
    const [w, h] = dimsForAspect(aspectRatio, resolution || "1K")
    results.set(`${id}.png`, makePng(w, h, calls * 37))
    tasks.set(id, { id, polls: 0, failMsg: prompt.includes("FAIL_SAFETY") ? "rejected by safety system" : null })
    return json(res, 200, { code: 200, msg: "success", data: { taskId: id, state: "pending" } })
  }

  const [w, h] = (size || "1024x1024").split("x").map(Number)
  const png = makePng(w || 1024, h || 1024, calls * 37)
  return json(res, 200, { created: Date.now(), data: [{ b64_json: png.toString("base64") }] })
}).listen(PORT, () => console.log(`fake image provider (apimodels + laozhang) on http://127.0.0.1:${PORT}`))
