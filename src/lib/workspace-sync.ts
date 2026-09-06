"use client"

import { serverStatus } from "@/lib/server-sync"

const REQUEST_TIMEOUT_MS = 10_000
const RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000] as const

function timeoutFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  return fetch(path, { ...init, signal: controller.signal }).finally(() => window.clearTimeout(timeout))
}

async function statusWithDeadline() {
  let timeout = 0
  const deadline = new Promise<never>((_, reject) => {
    timeout = window.setTimeout(() => reject(new Error("workspace: сервер не ответил вовремя")), REQUEST_TIMEOUT_MS)
  })
  return Promise.race([serverStatus(true), deadline]).finally(() => window.clearTimeout(timeout))
}

/** Прочитать выбранный на сервере проект; null также означает «проектов нет». */
export async function fetchWorkspaceProject(): Promise<string | null> {
  const status = await statusWithDeadline()
  if (!status.persistence) throw new Error("workspace: серверное хранение временно недоступно")
  const response = await timeoutFetch("/api/workspace", { cache: "no-store" })
  if (!response.ok) throw new Error(`workspace: HTTP ${response.status}`)
  const body = (await response.json()) as { activeProjectId?: unknown }
  return typeof body.activeProjectId === "string" ? body.activeProjectId : null
}

// undefined — нечего отправлять; null — явный выбор «проектов нет».
let pendingProjectId: string | null | undefined
let flushPromise: Promise<void> | null = null
let retryTimer: number | null = null
let retryAttempt = 0

export function hasPendingWorkspaceSave(): boolean {
  return pendingProjectId !== undefined
}

function scheduleRetry() {
  if (retryTimer !== null || pendingProjectId === undefined || !navigator.onLine) return
  const delay = RETRY_DELAYS_MS[Math.min(retryAttempt, RETRY_DELAYS_MS.length - 1)]
  retryAttempt += 1
  retryTimer = window.setTimeout(() => {
    retryTimer = null
    void flushWorkspaceProject()
  }, delay)
}

async function flushWorkspaceProject(): Promise<void> {
  if (flushPromise) return flushPromise
  const run = async () => {
    while (pendingProjectId !== undefined) {
      const requestedProjectId = pendingProjectId
      try {
        const status = await statusWithDeadline()
        if (!status.persistence) {
          scheduleRetry()
          return
        }
        const response = await timeoutFetch("/api/workspace", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ activeProjectId: requestedProjectId }),
        })
        if (!response.ok) throw new Error(`workspace: HTTP ${response.status}`)
        if (pendingProjectId === requestedProjectId) pendingProjectId = undefined
        retryAttempt = 0
        if (retryTimer !== null) window.clearTimeout(retryTimer)
        retryTimer = null
      } catch {
        scheduleRetry()
        return
      }
    }
  }
  flushPromise = run().finally(() => {
    flushPromise = null
    if (pendingProjectId !== undefined && retryTimer === null) scheduleRetry()
  })
  return flushPromise
}

/**
 * Последний явный выбор всегда побеждает предыдущий. Неуспешный PUT остаётся
 * pending и повторяется на online/focus; зависший запрос ограничен таймаутом,
 * поэтому последующие клики никогда не застревают за ним навсегда.
 */
export function saveWorkspaceProject(activeProjectId: string | null): Promise<void> {
  pendingProjectId = activeProjectId
  if (retryTimer !== null) window.clearTimeout(retryTimer)
  retryTimer = null
  retryAttempt = 0
  return flushWorkspaceProject()
}

if (typeof window !== "undefined") {
  const retryNow = () => {
    if (retryTimer !== null) window.clearTimeout(retryTimer)
    retryTimer = null
    void flushWorkspaceProject()
  }
  window.addEventListener("focus", retryNow)
  window.addEventListener("online", retryNow)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") retryNow()
  })
}
