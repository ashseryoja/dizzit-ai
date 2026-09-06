import { NextResponse, type NextRequest } from "next/server"

import { SESSION_COOKIE, verifySessionToken } from "@/shared/session"

/**
 * Дверь в рабочее пространство. Когда заданы `AUTH_SECRET` и
 * `APP_ACCESS_PASSWORD`, без валидной сессии страницы уводят на /login, а API
 * отвечает 401 — включая /api/images, чтобы чужие не тратили ключ провайдера.
 * Пока пароль не задан, приложение открыто, как раньше, но серверного
 * хранения тогда нет (см. src/server/auth.ts).
 */
export const config = {
  // Всё, кроме статики, страницы входа и служебных роутов входа/статуса.
  matcher: ["/((?!_next/|api/auth/|api/session|login|.*\\..*).*)"],
}

export async function middleware(request: NextRequest) {
  const secret = process.env.AUTH_SECRET?.trim()
  const password = process.env.APP_ACCESS_PASSWORD?.trim()
  if (!secret || !password) return NextResponse.next()

  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (await verifySessionToken(secret, token)) return NextResponse.next()

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized", message: "Нужен вход в рабочее пространство." }, { status: 401 })
  }
  const login = new URL("/login", request.url)
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`
  if (next !== "/") login.searchParams.set("next", next)
  return NextResponse.redirect(login)
}
