// Real local worker smoke test, isolated from the user's archive. No AI API calls.
import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { once } from "node:events"
import { randomUUID } from "node:crypto"
const dir = await mkdtemp(join(tmpdir(), "dizzit-lab-test-"))
const port = process.env.CREATIVE_LAB_TEST_PORT || "44318"
const url = `http://127.0.0.1:${port}`
const token = randomUUID()
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
let worker
let output = ""
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
async function start() {
  worker = spawn(process.execPath, ["scripts/creative-lab/worker.mjs"], { env: { ...process.env, CREATIVE_LAB_HOST: "127.0.0.1", CREATIVE_LAB_PORT: port, CREATIVE_LAB_DIR: dir, CREATIVE_LAB_WORKER_TOKEN: token }, stdio: ["ignore", "pipe", "pipe"] })
  worker.stdout.on("data", b => { output += b }); worker.stderr.on("data", b => { output += b })
  for (let i = 0; i < 60; i++) {
    if (worker.exitCode !== null) throw new Error(output)
    try { const r = await fetch(`${url}/health`, { headers }); if (r.ok) return } catch { /* Starting. */ }
    await delay(250)
  }
  throw new Error(`Worker did not start: ${output}`)
}
async function stop() { if (worker && worker.exitCode === null) { const done = once(worker, "exit"); worker.kill("SIGTERM"); await done } }
async function completed(id) {
  for (let i = 0; i < 180; i++) {
    const job = await (await fetch(`${url}/jobs/${id}`, { headers })).json()
    assert.notEqual(job.status, "error", output)
    if (job.status === "done") return job
    await delay(1000)
  }
  throw new Error("Rendering exceeded 180 seconds")
}
try {
  await start()
  assert.equal((await fetch(`${url}/health`)).status, 401)
  assert.equal((await fetch(`${url}/jobs`, { method: "POST", headers: { ...headers, Origin: "https://other-site.example" }, body: "{}" })).status, 403)
  const image = { src: `data:image/jpeg;base64,${(await readFile("public/images/invite/restyle-source.jpg")).toString("base64")}`, x: 50, y: 50, fit: "cover" }
  const props = { templateId: "split", title: "Integration check", format: "16:9", images: [image, image] }
  const post = body => fetch(`${url}/jobs`, { method: "POST", headers, body: JSON.stringify(body) })
  assert.equal((await post({ ...props, images: [] })).status, 400)
  assert.equal((await post({ ...props, images: [{ ...image, src: "http://127.0.0.1/private" }, image] })).status, 400)
  const accepted = await post(props); assert.equal(accepted.status, 202)
  const job = await accepted.json(); console.log(`Rendering test video ${job.id}`)
  await completed(job.id)
  const ranged = await fetch(`${url}/jobs/${job.id}/file`, { headers: { ...headers, Range: "bytes=0-31" } })
  assert.equal(ranged.status, 206); assert.equal((await ranged.arrayBuffer()).byteLength, 32)
  const file = await fetch(`${url}/jobs/${job.id}/file?download=1`, { headers })
  assert.equal(file.headers.get("content-type"), "video/mp4")
  assert.match(file.headers.get("content-disposition"), /attachment/)
  assert.equal(Buffer.from(await file.arrayBuffer()).subarray(4, 8).toString(), "ftyp")
  assert.equal((await fetch(`${url}/jobs/${job.id}/file`, { headers: { ...headers, Range: "bytes=999999999-" } })).status, 416)
  assert.equal((await fetch(`${url}/jobs/${job.id}/retry`, { method: "POST", headers })).status, 409)
  const imageJob = await (await post({ ...props, templateId: "paper-photo", images: [image] })).json()
  await completed(imageJob.id)
  const png = await fetch(`${url}/jobs/${imageJob.id}/file`, { headers })
  assert.equal(png.headers.get("content-type"), "image/png")
  assert.equal(Buffer.from(await png.arrayBuffer()).subarray(1, 4).toString(), "PNG")
  await stop(); await start()
  const restored = await (await fetch(`${url}/jobs/${job.id}`, { headers })).json()
  assert.equal(restored.status, "done")
  assert.equal((await fetch(`${url}/jobs/${job.id}/file`, { headers })).status, 200)
  console.log(`PASS: token, validation, MP4/PNG, byte ranges, retry guard, restart recovery. Test output: ${dir}`)
} finally { await stop() }
