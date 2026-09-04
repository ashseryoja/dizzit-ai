"use client"

import { useEffect, useRef, useState } from "react"
import {
  Image as ImageIcon,
  Settings2,
  Sparkles,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react"

import { MAX_BATCH, sourceQuality } from "@/lib/enhance-engine"
import { cn, plural } from "@/lib/utils"

/** Приложенный файл до отправки: сам файл + размеры + превью. */
export interface AttachedRender {
  file: File
  width: number
  height: number
  previewUrl: string
}

export interface ToolOption<T extends string> {
  value: T
  label: string
  icon: LucideIcon
}

/** Тексты композера — единственное, чем инструменты профиля отличаются в UI. */
export interface ToolComposerLabels {
  /** Заголовок секции файлов: «Рендеры», «Референсы». */
  filesTitle: string
  /** Подпись индикатора качества: «исходники», «референсы». */
  filesQuality: string
  /** Заголовок пустого слота: «Загрузить рендеры». */
  uploadTitle: string
  /** Подпись под секцией файлов. */
  filesCaption: string
  /** Заголовок секции выбора: «Контекст», «Материал». */
  optionsTitle: string
  optionsIcon: LucideIcon
  /** Обещание продукта внизу панели. */
  footer: string
  inputPlaceholder: string
  submitLabel: string
  /** Формы слова для чипа пачки: [рендер, рендера, рендеров]. */
  batchNoun: [string, string, string]
}

/**
 * Нижний композер инструмента — паттерн нейрофотосессии UpSound: комментарий,
 * главная кнопка и шестерёнка. Панель настроек раскрывается НАД композером
 * той же ширины: пачка файлов (до MAX_BATCH за раз) и один выбор-сегмент.
 * Других настроек нет намеренно. Общий для всех инструментов профиля —
 * различия только в текстах (labels) и наборе опций.
 */
export function ToolComposer<T extends string>({
  attachments,
  onPickFiles,
  onRemoveAttachment,
  onClearAttachments,
  note,
  onNoteChange,
  option,
  onOptionChange,
  options,
  labels,
  onSubmit,
  maxFiles = MAX_BATCH,
}: {
  attachments: AttachedRender[]
  onPickFiles: () => void
  onRemoveAttachment: (index: number) => void
  onClearAttachments: () => void
  note: string
  onNoteChange: (next: string) => void
  option: T
  onOptionChange: (next: T) => void
  options: ToolOption<T>[]
  labels: ToolComposerLabels
  onSubmit: () => void
  /** Лимит файлов в пачке; по умолчанию общий MAX_BATCH. */
  maxFiles?: number
}) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Клик мимо и Escape закрывают панель — паттерн дропдаунов сайдбара.
  useEffect(() => {
    if (!settingsOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setSettingsOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [settingsOpen])

  /* Индикатор качества — по ХУДШЕМУ файлу пачки: он и ограничит результат. */
  const quality = attachments.length
    ? Math.min(...attachments.map((item) => sourceQuality(item.width, item.height)))
    : 0

  const OptionsIcon = labels.optionsIcon

  return (
    <div ref={containerRef} className="pointer-events-auto relative w-full max-w-[880px]">
      {/* Панель настроек — над композером, той же ширины. */}
      {settingsOpen ? (
        <div
          className="overlay-surface scroll-thin absolute inset-x-0 bottom-[calc(100%+10px)] z-10 flex max-h-[70dvh] flex-col gap-5 overflow-y-auto p-5"
          role="dialog"
          aria-label="Настройки"
        >
          <section>
            <div className="mb-2.5 flex items-center justify-between gap-3">
              <SectionLabel icon={ImageIcon}>{labels.filesTitle}</SectionLabel>
              {/* Индикатор качества файлов — аналог «узнаваемости». */}
              <span className="flex items-center gap-2">
                <span className="flex gap-1" aria-hidden>
                  {[1, 2, 3].map((step) => (
                    <span
                      key={step}
                      className="h-[3px] w-4 rounded-full"
                      style={{ background: quality >= step ? "var(--accent)" : "var(--line-strong)" }}
                    />
                  ))}
                </span>
                <span className="ds-micro">{labels.filesQuality}</span>
              </span>
            </div>

            {attachments.length === 0 ? (
              <button
                type="button"
                onClick={onPickFiles}
                className="flex h-44 w-full flex-col items-center justify-center gap-2 transition-colors"
                style={{
                  borderRadius: "var(--r-md)",
                  border: "1px dashed var(--line-strong)",
                  color: "var(--fg-4)",
                  background: "transparent",
                }}
              >
                <Upload className="h-5 w-5" strokeWidth={1.5} />
                <span className="text-[13px]" style={{ color: "var(--fg-2)" }}>
                  {labels.uploadTitle}
                </span>
                <span className="text-[11.5px]" style={{ color: "var(--fg-5)" }}>
                  PNG · JPG · WEBP · до 32 МБ · {maxFiles === 1 ? "один файл" : `до ${maxFiles} файлов за раз`}
                </span>
              </button>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {attachments.map((attachment, index) => (
                  <div
                    key={attachment.previewUrl}
                    className="group/slot relative aspect-[4/3] overflow-hidden"
                    style={{ borderRadius: "var(--r-md)", border: "1px solid var(--line-strong)" }}
                  >
                    {/* Превью — object URL локального файла, next/image ни к чему. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={attachment.previewUrl}
                      alt={attachment.file.name}
                      className="h-full w-full object-cover"
                      draggable={false}
                    />
                    <span
                      className="absolute inset-x-1 bottom-1 truncate rounded-[6px] px-1.5 py-0.5 text-[10.5px]"
                      style={{ background: "rgba(16,16,18,0.7)", color: "rgba(255,255,255,0.85)" }}
                    >
                      {attachment.width}×{attachment.height}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveAttachment(index)}
                      aria-label={`Убрать «${attachment.file.name}»`}
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-[6px] opacity-0 transition-opacity group-hover/slot:opacity-100 focus-visible:opacity-100"
                      style={{ background: "rgba(16,16,18,0.7)", border: "1px solid rgba(255,255,255,0.18)", color: "rgba(255,255,255,0.92)" }}
                    >
                      <X className="h-3 w-3" strokeWidth={1.8} />
                    </button>
                  </div>
                ))}

                {attachments.length < maxFiles ? (
                  <button
                    type="button"
                    onClick={onPickFiles}
                    className="flex aspect-[4/3] flex-col items-center justify-center gap-1.5"
                    style={{
                      borderRadius: "var(--r-md)",
                      border: "1px dashed var(--line-strong)",
                      color: "var(--fg-4)",
                      background: "transparent",
                    }}
                  >
                    <Upload className="h-4 w-4" strokeWidth={1.6} />
                    <span className="text-[11.5px]" style={{ color: "var(--fg-3)" }}>
                      Добавить
                    </span>
                  </button>
                ) : null}
              </div>
            )}
            <p className="ds-caption mt-2">{labels.filesCaption}</p>
          </section>

          <section>
            <SectionLabel icon={OptionsIcon} className="mb-2.5">{labels.optionsTitle}</SectionLabel>
            <div className="seg w-full flex-wrap" role="radiogroup" aria-label={labels.optionsTitle}>
              {options.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="radio"
                  aria-checked={option === item.value}
                  onClick={() => onOptionChange(item.value)}
                  className={cn("seg-item flex-1 justify-center", option === item.value && "is-active")}
                >
                  <item.icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
                  {item.label}
                </button>
              ))}
            </div>
          </section>

          <p className="ds-caption border-t pt-3" style={{ borderColor: "var(--line)" }}>
            {labels.footer}
          </p>
        </div>
      ) : null}

      {/* Сам композер. */}
      <div className="overlay-surface flex items-center gap-1.5 p-2 sm:gap-2">
        {attachments.length > 0 ? (
          <span
            className="flex h-10 shrink-0 items-center gap-2 rounded-[var(--r-sm)] pl-1.5 pr-2"
            style={{ background: "var(--bg-raised)", border: "1px solid var(--line-strong)" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={attachments[0].previewUrl}
              alt=""
              aria-hidden
              className="h-7 w-7 rounded-[6px] object-cover"
              draggable={false}
            />
            <span className="max-w-[140px] truncate text-[12px]" style={{ color: "var(--fg-2)" }}>
              {attachments.length === 1
                ? attachments[0].file.name
                : `${attachments.length} ${plural(attachments.length, labels.batchNoun)}`}
            </span>
            <button
              type="button"
              onClick={onClearAttachments}
              aria-label="Убрать все файлы"
              className="btn-icon h-6 w-6"
            >
              <X className="h-3 w-3" strokeWidth={1.8} />
            </button>
          </span>
        ) : null}

        <input
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSubmit()
          }}
          placeholder={labels.inputPlaceholder}
          aria-label={labels.inputPlaceholder}
          className="h-10 min-w-0 flex-1 bg-transparent px-2 text-[13.5px] outline-none"
          style={{ color: "var(--fg-1)", caretColor: "var(--accent)" }}
        />

        <button type="button" onClick={onSubmit} className="btn-outline h-10 shrink-0 px-4 sm:px-5">
          <Sparkles className="h-4 w-4" strokeWidth={1.8} />
          <span className="hidden sm:inline">{labels.submitLabel}</span>
        </button>

        <button
          type="button"
          onClick={() => setSettingsOpen((value) => !value)}
          aria-label="Настройки"
          aria-expanded={settingsOpen}
          className="btn-icon h-10 w-10 shrink-0"
          style={settingsOpen ? { background: "var(--hover-2)", color: "var(--fg-1)" } : undefined}
        >
          <Settings2 className="h-4 w-4" strokeWidth={1.7} />
        </button>
      </div>
    </div>
  )
}

function SectionLabel({
  icon: Icon,
  children,
  className,
}: {
  icon: LucideIcon
  children: React.ReactNode
  className?: string
}) {
  return (
    <span className={cn("flex items-center gap-2 text-[13px]", className)} style={{ color: "var(--fg-2)" }}>
      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.6} style={{ color: "var(--fg-4)" }} />
      {children}
    </span>
  )
}
