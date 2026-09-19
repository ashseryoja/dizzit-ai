import { isSameOrigin, problem } from "@/server/http"
import { authConfigured } from "@/server/config"
import { sessionFromRequest, unauthorized } from "@/server/auth"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
export const maxDuration = 60

async function proxy(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (authConfigured() && !(await sessionFromRequest(request))) return unauthorized()
  if (request.method === "POST" && !isSameOrigin(request)) return problem(403, { error: "forbidden", message: "Запрос с другого сайта." })
  const { path } = await params
  const target = path.join("/")
  const allowed = request.method === "GET"
    ? /^(health|jobs|jobs\/[a-f0-9-]{36}(\/file)?)$/
    : /^(jobs|jobs\/[a-f0-9-]{36}\/retry)$/
  if (!allowed.test(target)) return problem(404, { error: "not_found", message: "Не найдено." })
  const base = process.env.CREATIVE_LAB_WORKER_URL || (process.env.NODE_ENV !== "production" ? "http://127.0.0.1:4318" : "")
  if (!base) return problem(503, { error: "render_unavailable", message: "Сервис Creative Lab ещё не подключён на этом сервере." })
  const headers = new Headers()
  if (process.env.CREATIVE_LAB_WORKER_TOKEN) headers.set("Authorization", `Bearer ${process.env.CREATIVE_LAB_WORKER_TOKEN}`)
  if (request.headers.has("range")) headers.set("Range", request.headers.get("range")!)
  let body: Uint8Array<ArrayBuffer> | undefined
  if (request.method === "POST") {
    const reader = request.body?.getReader()
    const chunks: Uint8Array[] = []; let total = 0
    if (reader) {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > 24 * 1024 * 1024) { await reader.cancel(); return problem(413, { error: "too_large", message: "Слишком большой набор фотографий." }) }
        chunks.push(value)
      }
    }
    body = new Uint8Array(total); let offset = 0
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
    headers.set("Content-Type", "application/json")
  }
  try {
    const query = new URL(request.url).searchParams.has("download") ? "?download=1" : ""
    const response = await fetch(`${base.replace(/\/$/, "")}/${target}${query}`, { method: request.method, headers, body, cache: "no-store", signal: AbortSignal.timeout(30_000) })
    const outgoing = new Headers({ "Cache-Control": "private, no-store" })
    for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "content-disposition"]) {
      if (response.headers.has(name)) outgoing.set(name, response.headers.get(name)!)
    }
    return new Response(response.body, { status: response.status, headers: outgoing })
  } catch {
    return problem(503, { error: "render_unavailable", message: "Сервис сборки Creative Lab недоступен. Подключите его и повторите." })
  }
}
export const GET = proxy
export const POST = proxy
