"use client"

import { useCallback, useEffect, useState } from "react"

import { getBlob } from "@/lib/blob-store"

export type StoredBlobStatus = "loading" | "ready" | "missing" | "error"

export interface StoredBlobUrlState {
  /** Object URL первого найденного ключа, в том же порядке, что передал вызывающий код. */
  url: string | null
  /** Ключ, из которого собран url: позволяет отличить результат от запасного исходника. */
  resolvedKey: string | null
  status: StoredBlobStatus
  error: Error | null
  /** Повторяет только чтение локального/серверного файла. Генерацию не запускает. */
  retry: () => void
  /** Скрывает повреждённую картинку, если браузер не смог декодировать object URL. */
  reportImageError: () => void
}

interface Snapshot {
  signature: string
  url: string | null
  resolvedKey: string | null
  status: StoredBlobStatus
  error: Error | null
}

/**
 * Небольшое окно для eventual consistency: метаданные записи могут приехать
 * с сервера раньше, чем крупный файл закончит загружаться в object storage.
 * После четырёх ограниченных попыток UI перестаёт крутить вечный скелет и
 * показывает понятное состояние `missing` с ручным повтором.
 */
const RETRY_DELAYS_MS = [0, 500, 1_500, 3_500] as const

function wait(delay: number, signal: AbortSignal): Promise<void> {
  if (delay === 0 || signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = window.setTimeout(resolve, delay)
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer)
        resolve()
      },
      { once: true }
    )
  })
}

/**
 * Загружает blob по списку запасных ключей и превращает его в object URL.
 * Ключи проверяются строго слева направо на каждой попытке. Хук пригоден для
 * карточек, плиток и сцен; `retry` безопасен и никогда не вызывает image API.
 */
export function useStoredBlobUrl(keys: readonly (string | null | undefined)[]): StoredBlobUrlState {
  const signature = keys.filter((key): key is string => Boolean(key)).join("\0")
  const [revision, setRevision] = useState(0)
  const [snapshot, setSnapshot] = useState<Snapshot>({
    signature,
    url: null,
    resolvedKey: null,
    status: "loading",
    error: null,
  })

  useEffect(() => {
    const requestedKeys = signature ? signature.split("\0") : []
    const controller = new AbortController()
    let objectUrl: string | null = null

    setSnapshot({ signature, url: null, resolvedKey: null, status: "loading", error: null })

    const load = async () => {
      if (requestedKeys.length === 0) {
        setSnapshot({ signature, url: null, resolvedKey: null, status: "missing", error: null })
        return
      }

      let lastError: Error | null = null
      for (const delay of RETRY_DELAYS_MS) {
        await wait(delay, controller.signal)
        if (controller.signal.aborted) return

        for (const key of requestedKeys) {
          try {
            const blob = await getBlob(key)
            if (controller.signal.aborted) return
            if (!blob) continue
            objectUrl = URL.createObjectURL(blob)
            setSnapshot({ signature, url: objectUrl, resolvedKey: key, status: "ready", error: null })
            return
          } catch (error) {
            lastError = error instanceof Error ? error : new Error("Не удалось загрузить файл")
          }
        }
      }

      if (controller.signal.aborted) return
      setSnapshot({
        signature,
        url: null,
        resolvedKey: null,
        status: lastError ? "error" : "missing",
        error: lastError,
      })
    }

    void load()
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [revision, signature])

  const retry = useCallback(() => setRevision((value) => value + 1), [])
  const reportImageError = useCallback(() => {
    setSnapshot((current) =>
      current.signature === signature
        ? {
            ...current,
            url: null,
            resolvedKey: null,
            status: "error",
            error: new Error("Браузер не смог открыть файл"),
          }
        : current
    )
  }, [signature])

  // Не показываем URL от предыдущей карточки даже на один кадр до useEffect.
  if (snapshot.signature !== signature) {
    return { url: null, resolvedKey: null, status: "loading", error: null, retry, reportImageError }
  }
  return { ...snapshot, retry, reportImageError }
}
