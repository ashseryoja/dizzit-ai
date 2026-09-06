import { NextResponse } from "next/server"

import { checkPassword, issueSessionCookie } from "@/server/auth"
import { authConfigured } from "@/server/config"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

/** Вход по паролю: верный — cookie сессии на 30 дней, неверный — пауза и 401. */
export async function POST(request: Request) {
  if (!authConfigured()) {
    return NextResponse.json({ error: "auth_not_configured", message: "Вход не настроен на сервере." }, { status: 503 })
  }
  let password = ""
  try {
    password = String(((await request.json()) as { password?: unknown }).password ?? "")
  } catch {
    return NextResponse.json({ error: "bad_request", message: "Ожидается JSON с полем password." }, { status: 400 })
  }
  if (!checkPassword(password)) {
    // Небольшая пауза против перебора; лимитера по IP пока нет.
    await new Promise((resolve) => setTimeout(resolve, 700))
    return NextResponse.json({ error: "wrong_password", message: "Неверный пароль." }, { status: 401 })
  }
  return new NextResponse(null, { status: 204, headers: { "Set-Cookie": await issueSessionCookie(request) } })
}
