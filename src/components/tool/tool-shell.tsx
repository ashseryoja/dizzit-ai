"use client"

import type { ReactNode } from "react"
import { usePathname } from "next/navigation"
import { useActiveProject } from "@/stores/project-store"

import { PageLoader } from "@/components/page-loader"
import { useBlobGc } from "@/lib/blob-gc"
import type { AttachmentIntake } from "@/lib/use-attachments"
import { useMounted } from "@/lib/use-mounted"
import { usePresence, type PresenceState } from "@/lib/use-presence"
import { cn } from "@/lib/utils"

const TOOL_HEADINGS: Record<string, readonly [string, string]> = {
  "/enhance": ["Редактор рендера", "Превратите хороший рендер в впечатляющий."],
  "/views": ["Ракурсы и детали", "Новые точки зрения. Больше выразительных деталей."],
  "/restyle": ["Перенос стиля", "Ваше пространство — в новом прочтении."],
  "/photo-3d": ["Фото → 3D", "От фотографии предмета — к объёмной модели."],
  "/materials": ["Генерация материала", "Фактуры, которые хочется рассматривать."],
}

/** Результат usePresence — слои каркаса принимают его целиком. */
export interface Presence {
  present: boolean
  state: PresenceState
}

/**
 * Каркас экрана инструмента — один на все инструменты профиля. Внутри:
 * скелет до гидрации сторов, GC хранилища блобов, скрытый <input type="file">,
 * приём переноса файлов на всю страницу со слоем «Отпустите…», отступ снизу
 * под плавающий композер и справа — под панель-галерею пачки.
 *
 * Содержимое экрана (дропзона / сцена / галерея) — children; плавающие слои
 * (ComposerDock, ToolAside) — layers. Страница не знает про разметку
 * каркаса: чтобы поменять слой переноса или отступы везде, правят этот файл.
 *
 * Экран без приёма файлов (альбом-презентация собирается из уже готового)
 * не передаёт `intake`: остаются скелет, GC и раскладка, без input и слоя
 * переноса.
 */
export function ToolShell({
  intake,
  dropLabel,
  composerOpen,
  composerSpace = "pb-60",
  trayOpen = false,
  trayMargin = "lg:mr-[296px]",
  layers,
  children,
}: {
  /** Приём файлов; без него экран файлов не принимает. */
  intake?: AttachmentIntake
  /** Подпись слоя переноса: «Отпустите, чтобы приложить рендеры». */
  dropLabel?: string
  /** Внизу есть композер — контент получает отступ, чтобы не уходить под него. */
  composerOpen: boolean
  /** Класс нижнего отступа под композер; выше обычного, когда над ним постоянная секция (`dock`). */
  composerSpace?: string
  /** Справа открыта панель-галерея пачки — контент получает отступ под неё. */
  trayOpen?: boolean
  /** Класс отступа под правые панели; у переноса стиля их две. */
  trayMargin?: string
  layers?: ReactNode
  children: ReactNode
}) {
  const mounted = useMounted()
  const pathname = usePathname()
  const project = useActiveProject()
  const heading = TOOL_HEADINGS[pathname]
  // GC общего хранилища блобов — после гидрации сторов ВСЕХ инструментов.
  useBlobGc()
  const dragLayer = usePresence(intake?.dragOver ?? false)

  if (!mounted) {
    return (
      <div className="page-shell">
        <PageLoader />
      </div>
    )
  }

  return (
    <div
      {...intake?.dropProps}
      className={cn(
        "page-shell transition-[margin] duration-300",
        composerOpen && composerSpace,
        // Справа — место под панель-галерею, зеркально отступу под сайдбар.
        trayOpen && trayMargin
      )}
      style={{ transitionTimingFunction: "var(--ease-out)" }}
    >
      {intake ? (
        <input
          ref={intake.inputRef}
          type="file"
          accept={intake.accept}
          multiple={intake.multiple}
          className="hidden"
          onChange={intake.onInputChange}
        />
      ) : null}

      {dragLayer.present ? (
        <div
          data-state={dragLayer.state}
          className="presence-fade pointer-events-none fixed inset-3 z-50 flex items-center justify-center"
          style={{
            border: "2px dashed var(--accent)",
            borderRadius: "var(--r-xl)",
            background: "rgba(16,16,18,0.55)",
          }}
        >
          <span className="text-[15px]" style={{ color: "var(--fg-1)" }}>
            {dropLabel}
          </span>
        </div>
      ) : null}

      <div className="page-content-wide flex flex-1 flex-col">
        {heading ? (
          <header className="tool-heading">
            <div className="tool-breadcrumb"><span>{project?.title ?? "Рабочее пространство"}</span><span aria-hidden="true">›</span><span>Инструменты</span></div>
            <h1>{heading[0]}</h1>
            <p>{heading[1]}</p>
          </header>
        ) : null}
        {children}
      </div>

      {layers}
    </div>
  )
}

/**
 * Плавающая полоса внизу экрана, в которой живёт ToolComposer: по центру
 * контента, с отступом под сайдбар слева и под панель-галерею справа.
 * С presence — появляется и уходит анимацией; без него — есть всегда.
 */
export function ComposerDock({
  presence,
  trayOpen = false,
  trayRight = "lg:right-[312px]",
  children,
}: {
  presence?: Presence
  trayOpen?: boolean
  /** Класс правого отступа при открытой панели; у переноса стиля панелей две. */
  trayRight?: string
  children: ReactNode
}) {
  if (presence && !presence.present) return null
  return (
    <div
      data-state={presence?.state}
      className={cn(
        "composer-position presence-rise pointer-events-none fixed inset-x-3 bottom-3 z-30 flex justify-center lg:left-[312px] lg:bottom-5",
        trayOpen ? trayRight : "lg:right-8"
      )}
    >
      {children}
    </div>
  )
}

/**
 * Закреплённая правая панель — зеркало сайдбара: та же ширина, отступы и
 * поверхность. Панель-галерея пачки (RenderTray) и панель стилей у переноса
 * стиля. Только на широких экранах — ниже содержимое живёт под сценой.
 */
export function ToolAside({
  presence,
  label,
  className = "right-4 w-[264px] lg:flex",
  rail,
  children,
}: {
  presence: Presence
  label: string
  /** Позиция, ширина и брейкпоинт показа: по умолчанию — панель пачки. */
  className?: string
  /** Вкладки снаружи левого края панели (папки рендеров — `FolderRail`). */
  rail?: ReactNode
  children: ReactNode
}) {
  if (!presence.present) return null
  return (
    <aside
      data-state={presence.state}
      aria-label={label}
      className={cn("presence-slide fixed bottom-4 top-4 z-40 hidden flex-col", className)}
    >
      {rail}
      <div
        className="glass-surface tool-aside flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {children}
      </div>
    </aside>
  )
}

/**
 * Галерея результатов: по умолчанию масонри колонками; `layout="stack"` —
 * широкие карточки одна под другой (сеты кадров: исходник слева, кадры справа);
 * `layout="tiles"` — сетка по три в ряд по центру экрана для квадратных тайлов
 * (материалы): карточки одного размера, поэтому масонри им не нужно, а без
 * ограничения ширины три тайла растягивались бы на всю страницу.
 * Вертикальный зазор даёт `mb-4` карточки — в сетке он работает как row-gap.
 */
export function ToolGallery({
  children,
  layout = "columns",
}: {
  children: ReactNode
  layout?: "columns" | "stack" | "tiles"
}) {
  if (layout === "stack") return <div className="flex flex-col gap-8">{children}</div>
  if (layout === "tiles")
    return <div className={cn(TILE_GALLERY_WIDTH, "grid grid-cols-2 gap-x-4 sm:grid-cols-3")}>{children}</div>
  return <div className="columns-1 gap-4 sm:columns-2 xl:columns-3">{children}</div>
}

/**
 * Ширина сетки тайлов: держит тайл ≈ 250 px и центрирует колонки. Тот же класс
 * берёт превью-сетка пустого экрана, чтобы после первой генерации раскладка
 * не прыгала.
 */
export const TILE_GALLERY_WIDTH = "mx-auto w-full max-w-[780px]"
