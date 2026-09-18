"use client"

import { useEffect, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { Check, X } from "lucide-react"

import { useStoredBlobUrl } from "@/lib/use-stored-blob"

/**
 * Тосты «готово» — один слой на всё приложение (`ToastHost` в раскладке),
 * вызов из любого места обычной функцией `showToast(...)`, без провайдера:
 * состояние живёт в модуле, как у просмотра картинок. Генерация идёт 20–90 с,
 * и человек успевает уйти в другой инструмент — тост сообщает, что результат
 * готов, с миниатюрой; клик ведёт к нему. Стили — `.toast*` в motion.css.
 */

export interface ToastInput {
  /** «Рендер готов». */
  title: string
  /** «Гостиная.jpg · 4K». */
  detail?: string
  /** Ключи хранилища для миниатюры, по убыванию предпочтения. */
  imageKeys?: string[]
  /** Клик по тосту: перейти к результату. */
  onOpen?: () => void
}

interface ToastItem extends ToastInput {
  id: number
}

const LIFETIME_MS = 6000
const MAX_VISIBLE = 3

let toasts: ToastItem[] = []
let counter = 0
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
const emit = () => listeners.forEach((listener) => listener())

function dismiss(id: number): void {
  toasts = toasts.filter((toast) => toast.id !== id)
  emit()
}

export function showToast(input: ToastInput): void {
  counter += 1
  toasts = [...toasts, { ...input, id: counter }].slice(-MAX_VISIBLE)
  emit()
}

/** Слой тостов. Монтируется один раз в `(main)/layout.tsx`. */
export function ToastHost() {
  const items = useSyncExternalStore(subscribe, () => toasts, () => toasts)
  if (items.length === 0 || typeof document === "undefined") return null
  return createPortal(
    <div className="toast-stack" role="status" aria-live="polite">
      {items.map((toast) => (
        <ToastCard key={toast.id} toast={toast} />
      ))}
    </div>,
    document.body
  )
}

function ToastCard({ toast }: { toast: ToastItem }) {
  const image = useStoredBlobUrl(toast.imageKeys ?? [])

  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(toast.id), LIFETIME_MS)
    return () => window.clearTimeout(timer)
  }, [toast.id])

  return (
    <div className="toast glass-surface glass-dense">
      <button
        type="button"
        className="toast-body"
        onClick={() => {
          toast.onOpen?.()
          dismiss(toast.id)
        }}
      >
        <span className="toast-thumb">
          {image.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image.url} alt="" draggable={false} onError={image.reportImageError} />
          ) : null}
          <span className="toast-check" aria-hidden>
            <Check className="h-3 w-3" strokeWidth={2.6} />
          </span>
        </span>
        <span className="min-w-0 text-left">
          <span className="toast-title">{toast.title}</span>
          {toast.detail ? <span className="toast-detail">{toast.detail}</span> : null}
        </span>
      </button>
      <button type="button" className="toast-close" onClick={() => dismiss(toast.id)} aria-label="Закрыть уведомление">
        <X className="h-3.5 w-3.5" strokeWidth={1.8} />
      </button>
    </div>
  )
}
