"use client"

import { useEffect, useRef, useState } from "react"
import Image from "next/image"
import { ArrowUpRight, LoaderCircle, ScanEye } from "lucide-react"

import { ToolDropzone } from "@/components/tool/tool-dropzone"

const EXAMPLE_IMAGE = "/images/render-example.jpg"

/** Приглашение редактора; файлы по-прежнему принимает общий useAttachments. */
export function RenderEmptyState({ onPick, onAttachFiles }: {
  onPick: () => void
  onAttachFiles: (files: File[]) => Promise<void>
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = useRef<AbortController | null>(null)

  useEffect(() => () => request.current?.abort(), [])

  const openExample = async () => {
    if (request.current) return
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(EXAMPLE_IMAGE, { signal: controller.signal })
      if (!response.ok) throw new Error("Example unavailable")
      const image = await response.blob()
      if (controller.signal.aborted) return
      // Открываем исходник обычным путём. Генерация — только по кнопке редактора.
      await onAttachFiles([new File([image], "Пример — гостиная.jpg", { type: "image/jpeg" })])
    } catch {
      if (!controller.signal.aborted) setError("Не удалось открыть пример. Попробуйте ещё раз или выберите своё изображение.")
    } finally {
      if (!controller.signal.aborted) {
        request.current = null
        setLoading(false)
      }
    }
  }

  return (
    <ToolDropzone
      variant="glass"
      onPick={onPick}
      label="Выбрать изображение"
      visual={
        <span className="render-welcome-visual">
          <Image
            className="render-welcome-image"
            src={EXAMPLE_IMAGE}
            width={1536}
            height={1024}
            sizes="(max-width: 480px) 80vw, 370px"
            priority
            alt="Пример интерьерной визуализации: светлая гостиная с аркой и мягким диваном"
            draggable={false}
          />
          <span className="render-welcome-label" aria-hidden>ВАШЕ ВИДЕНИЕ / НОВАЯ ГЛУБИНА</span>
          <span className="render-welcome-eye" aria-hidden><ScanEye size={32} strokeWidth={2.1} /></span>
        </span>
      }
      title="Добавьте ваш рендер"
      description={<>Оживите свет и фактуры, сохранив<br className="render-welcome-break" /> архитектуру и характер пространства.</>}
      actionLabel="Выбрать изображение"
      hint="или перетащите файл сюда · JPG, PNG, WEBP · до 32 МБ"
      caption={<>Архитектура остаётся вашей.<br />Мы помогаем проявить свет, фактуру и глубину.</>}
      footer={
        <>
          <button type="button" className="render-welcome-example" onClick={() => void openExample()} disabled={loading} aria-busy={loading}>
            {loading ? "Открываем пример…" : "Посмотреть на примере"}
            {loading ? <LoaderCircle size={18} className="animate-spin motion-reduce:animate-none" aria-hidden /> : <ArrowUpRight size={18} aria-hidden />}
          </button>
          {error ? <p role="alert" className="render-welcome-error">{error}</p> : null}
        </>
      }
    />
  )
}
