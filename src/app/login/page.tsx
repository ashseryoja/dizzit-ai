"use client"

import { Suspense, useState, type FormEvent } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { LockKeyhole } from "lucide-react"

import { Logo } from "@/components/logo"
import { Panel } from "@/components/ui/panel"

/**
 * Вход в рабочее пространство — один пароль на всех, кто им пользуется
 * (`APP_ACCESS_PASSWORD`). Страница вне (main): без сайдбара и без сторов.
 * После входа — на страницу, с которой middleware сюда отправил.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const router = useRouter()
  const params = useSearchParams()
  const next = params.get("next") || "/"
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { message?: string }
        setError(body.message ?? `Не удалось войти (HTTP ${response.status}).`)
        return
      }
      // Только свой путь: чужой адрес в next не открываем.
      router.replace(next.startsWith("/") && !next.startsWith("//") ? next : "/")
      router.refresh()
    } catch {
      setError("Нет связи с сервером. Попробуйте ещё раз.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-4 py-10">
      <Panel className="w-full max-w-[380px]">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <Logo className="h-7" />
          <p className="ds-caption">Вход в рабочее пространство</p>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label htmlFor="login-password" className="ds-micro">
            Пароль
          </label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            autoFocus
            className="field"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          {error ? (
            <p className="text-[12.5px]" style={{ color: "var(--danger)" }}>
              {error}
            </p>
          ) : null}
          <button type="submit" className="btn-primary mt-1 h-10 justify-center" disabled={busy || !password}>
            <LockKeyhole className="h-4 w-4" strokeWidth={1.7} />
            {busy ? "Входим…" : "Войти"}
          </button>
        </form>
        <p className="ds-caption mt-5 text-center">Пароль задаёт владелец в настройках сервера.</p>
      </Panel>
    </div>
  )
}
