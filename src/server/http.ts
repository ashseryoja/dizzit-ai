import "server-only"

import { NextResponse } from "next/server"

/**
 * Общие мелочи HTTP-роутов, у которых нет своего смысла: тело ошибки в одном
 * формате и минимальная защита от чужих страниц. Используются `/api/images`
 * и `/api/scene` — любой новый роут генерации берёт их отсюда, а не копирует.
 */

export interface ProblemBody {
  error: string
  message: string
  retryable?: boolean
}

export function problem(status: number, body: ProblemBody): NextResponse<ProblemBody> {
  return NextResponse.json(body, { status })
}

/**
 * Минимальная защита от чужих страниц: браузерный запрос с другого origin
 * отклоняется. curl это не остановит — авторизации у сервиса пока нет, и это
 * осознанно (README, «Что осознанно НЕ сделано»).
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin")
  if (!origin) return true
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host")
  if (!host) return true
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}
