// Фальшивый LaoZhang Images API для проверки прокси без ключа и без расходов.
// Принимает /v1/images/generations (JSON) и /v1/images/edits (multipart),
// логирует, что пришло, и отвечает PNG нужного размера в data[0].b64_json.
import { createServer } from "node:http"
import { deflateSync } from "node:zlib"

const PORT = Number(process.env.PORT || 4321)

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n += 1) {
    c = n
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
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

let calls = 0
createServer(async (req, res) => {
  const chunks = []
  for await (const part of req) chunks.push(part)
  const body = Buffer.concat(chunks)
  calls += 1
  const auth = req.headers.authorization || ""
  const contentType = req.headers["content-type"] || ""

  if (!auth.startsWith("Bearer ")) {
    res.writeHead(401, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: { message: "missing bearer" } }))
    return
  }

  let model = "?"
  let size = "1024x1024"
  let prompt = ""
  let files = 0
  let fields = ""
  if (contentType.includes("application/json")) {
    const json = JSON.parse(body.toString("utf8"))
    model = json.model
    size = json.size || size
    prompt = json.prompt || ""
  } else {
    const text = body.toString("latin1")
    const field = (name) => {
      const m = text.match(new RegExp(`name="${name}"\\r\\n\\r\\n([\\s\\S]*?)\\r\\n--`))
      return m ? m[1] : ""
    }
    model = field("model")
    size = field("size") || size
    prompt = Buffer.from(field("prompt"), "latin1").toString("utf8")
    files = (text.match(/filename="/g) || []).length
    fields = [...new Set([...text.matchAll(/name="(image(?:\[\])?)"/g)].map((m) => m[1]))].join(",")
  }
  const [w, h] = size.split("x").map(Number)
  console.log(`#${calls} ${req.method} ${req.url} model=${model} size=${size} files=${files}${fields ? ` (${fields})` : ""} bytes=${body.length}`)
  console.log(`   prompt: ${prompt.slice(0, 160).replace(/\n/g, " | ")}${prompt.length > 160 ? "…" : ""}`)

  if (prompt.includes("FAIL_500")) {
    res.writeHead(500, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: { message: "simulated upstream failure" } }))
    return
  }
  if (prompt.includes("FAIL_SAFETY")) {
    res.writeHead(400, { "Content-Type": "application/json" })
    res.end(JSON.stringify({ error: { message: "rejected by safety system" } }))
    return
  }

  const png = makePng(w || 1024, h || 1024, calls * 37)
  res.writeHead(200, { "Content-Type": "application/json" })
  res.end(JSON.stringify({ created: Date.now(), data: [{ b64_json: png.toString("base64") }] }))
}).listen(PORT, () => console.log(`fake laozhang on http://127.0.0.1:${PORT}`))
