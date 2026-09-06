import "server-only"

import { createHash, timingSafeEqual } from "node:crypto"

import { NextResponse } from "next/server"

import { authConfigured, serverConfig } from "@/server/config"
import { SESSION_COOKIE, createSessionToken, readCookie, verifySessionToken } from "@/shared/session"

/**
 * Вход в рабочее пространство по паролю (`APP_ACCESS_PASSWORD`) и сессия в
 * HttpOnly-cookie. Пользователь один — владелец: все записи и объекты
 * помечены `OWNER_ID`. Аккаунты с отдельными id — следующий шаг, схема
 * таблиц к нему готова (`owner_id`).
 */

export const OWNER_ID = "owner"
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60

export interface Session {
  ownerId: string
}

export async function sessionFromRequest(request: Request): Promise<Session | null> {
  if (!authConfigured()) return null
  const token = readCookie(request.headers.get("cookie"), SESSION_COOKIE)
  return (await verifySessionToken(serverConfig.authSecret, token)) ? { ownerId: OWNER_ID } : null
}

/** Пароль сравнивается по хэшам за постоянное время: длина не выдаёт ничего. */
export function checkPassword(input: string): boolean {
  const expected = serverConfig.accessPassword
  if (!expected) return false
  const a = createHash("sha256").update(input).digest()
  const b = createHash("sha256").update(expected).digest()
  return timingSafeEqual(a, b)
}

function isSecure(request: Request): boolean {
  return request.headers.get("x-forwarded-proto") === "https" || request.url.startsWith("https://")
}

export async function issueSessionCookie(request: Request): Promise<string> {
  const token = await createSessionToken(serverConfig.authSecret, SESSION_TTL_SECONDS)
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${isSecure(request) ? "; Secure" : ""}`
}

export function clearSessionCookie(request: Request): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${isSecure(request) ? "; Secure" : ""}`
}

export function unauthorized(): NextResponse {
  return NextResponse.json({ error: "unauthorized", message: "Нужен вход в рабочее пространство." }, { status: 401 })
}

export function authNotConfigured(): NextResponse {
  return NextResponse.json(
    { error: "auth_not_configured", message: "Вход не настроен: задайте AUTH_SECRET и APP_ACCESS_PASSWORD." },
    { status: 503 }
  )
}
