/**
 * Сессия входа — подписанный токен в HttpOnly-cookie. Модуль ИЗОМОРФНЫЙ
 * (только Web Crypto, без `node:*`): его читают и middleware на edge-рантайме,
 * и серверные роуты. Секрет сюда передают параметром, сам модуль окружение
 * не читает.
 *
 * Формат токена: `v1.<истекает, unix-секунды>.<base64url(HMAC-SHA256)>`.
 * Пользователь пока один — «владелец» рабочего пространства, поэтому в токене
 * нет id пользователя; когда появятся аккаунты, он добавится третьим полем.
 */

export const SESSION_COOKIE = "dizzit_session"

const encoder = new TextEncoder()

function toBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ""
  for (const byte of view) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
  return toBase64Url(await crypto.subtle.sign("HMAC", key, encoder.encode(message)))
}

/** Сравнение без ранних выходов: по длине и по каждому символу. */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function createSessionToken(secret: string, ttlSeconds: number): Promise<string> {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds
  const payload = `v1.${expires}`
  return `${payload}.${await hmac(secret, payload)}`
}

export async function verifySessionToken(secret: string, token: string | undefined | null): Promise<boolean> {
  if (!secret || !token) return false
  const parts = token.split(".")
  if (parts.length !== 3 || parts[0] !== "v1") return false
  const expires = Number(parts[1])
  if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return false
  const expected = await hmac(secret, `${parts[0]}.${parts[1]}`)
  return constantTimeEqual(expected, parts[2])
}

/** Значение cookie по имени из заголовка Cookie. */
export function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null
  for (const part of cookieHeader.split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (key === name) return decodeURIComponent(rest.join("="))
  }
  return null
}
