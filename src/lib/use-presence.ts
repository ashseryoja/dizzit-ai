"use client"

import { useEffect, useState } from "react"

export type PresenceState = "open" | "closed"

/**
 * «Присутствие» для всплывающих слоёв: дропдаунов, поповеров, оверлеев.
 *
 * Условный рендер `open ? <div/> : null` убирает элемент из DOM мгновенно —
 * анимации закрытия негде играть. Хук держит элемент смонтированным ещё
 * `exitMs` после закрытия, а `state` вешается на data-state: CSS играет
 * вход на "open" и выход на "closed" (см. .popover, .presence-* в surfaces.css).
 *
 * Быстрые переключения безопасны: повторное открытие во время выхода
 * просто отменяет таймер размонтирования.
 */
export function usePresence(open: boolean, exitMs = 200): { present: boolean; state: PresenceState } {
  const [present, setPresent] = useState(open)

  useEffect(() => {
    if (open) {
      setPresent(true)
      return
    }
    const timer = window.setTimeout(() => setPresent(false), exitMs)
    return () => window.clearTimeout(timer)
  }, [open, exitMs])

  return { present, state: open ? "open" : "closed" }
}
