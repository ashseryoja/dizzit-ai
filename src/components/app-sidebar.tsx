"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  ChevronDown,
  Database,
  Layers,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  X,
} from "lucide-react"

import { PhotoToCubeGlyph, RenderEditorGlyph, RestyleGlyph, ViewsGlyph } from "@/components/glyphs"
import { Logo } from "@/components/logo"
import { usePresence } from "@/lib/use-presence"
import { cn } from "@/lib/utils"
import { useServerStatus } from "@/lib/server-sync"
import { useCompanyStore } from "@/stores/company-store"
import { useEnhanceStore } from "@/stores/enhance-store"
import { useMaterialStore } from "@/stores/material-store"
import { useModelStore } from "@/stores/model-store"
import { useProjectStore } from "@/stores/project-store"
import { useRestyleStore } from "@/stores/restyle-store"
import { useViewsStore } from "@/stores/views-store"

interface ToolLink {
  href: string
  label: string
  /** Lucide-иконка или собственный глиф с той же сигнатурой. */
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
}

/* Дизайн-инструменты нового профиля добавляются сюда по одному
   (скетч→рендер — следующий). Настроек здесь нет намеренно: они живут
   в меню аккаунта внизу — так же, как в UpSound AI. */
const TOOL_LINKS: ToolLink[] = [
  { href: "/enhance", label: "Редактор рендера", icon: RenderEditorGlyph },
  { href: "/views", label: "Ракурсы и детали", icon: ViewsGlyph },
  { href: "/restyle", label: "Перенос стиля", icon: RestyleGlyph },
  { href: "/photo-3d", label: "Фото → 3D", icon: PhotoToCubeGlyph },
  { href: "/materials", label: "Генерация материала", icon: Layers },
]

/** Размеры пунктов: на таче крупнее, чтобы попадать пальцем (как в UpSound). */
function navItemClass(large: boolean, active: boolean) {
  return cn(
    "nav-item",
    large ? "h-12 gap-3.5 px-3.5 text-[14px]" : "h-10 gap-3 px-3 text-[13px]",
    active && "is-active"
  )
}

/** Квадратик-«аватар» проекта: первая буква названия (паттерн UpSound,
    только вместо фото артиста — инициал). */
function ProjectAvatar({ title, large }: { title: string; large: boolean }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-[8px] font-medium",
        large ? "h-8 w-8 text-[13px]" : "h-7 w-7 text-[12px]"
      )}
      style={{ background: "var(--bg-raised)", border: "1px solid var(--line-strong)", color: "var(--fg-1)" }}
    >
      {(title.trim()[0] ?? "П").toUpperCase()}
    </span>
  )
}

/**
 * Селектор текущего проекта — тот же паттерн, что выбор артиста в UpSound:
 * кнопка с названием активного проекта, по клику дропдаун с поиском,
 * списком проектов (переименовать/удалить) и «Добавить проект».
 */
function ProjectSwitcher({ large, onNavigate }: { large: boolean; onNavigate?: () => void }) {
  const router = useRouter()

  const projects = useProjectStore((state) => state.projects)
  const activeProjectId = useProjectStore((state) => state.activeProjectId)
  const selectProject = useProjectStore((state) => state.selectProject)
  const createProject = useProjectStore((state) => state.createProject)
  const renameProject = useProjectStore((state) => state.renameProject)
  const deleteProject = useProjectStore((state) => state.deleteProject)

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  // Только что созданный проект: его переименование — часть сценария
  // создания, по завершении (как угодно) закрываем дропдаун и идём в проект.
  const [createdId, setCreatedId] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // Дропдаун живёт в DOM, пока доигрывает анимация закрытия.
  const menu = usePresence(open)

  const activeProject = projects.find((project) => project.id === activeProjectId) ?? null

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  /**
   * Единая точка выхода из переименования. save=false — отмена (Esc).
   * Для только что созданного проекта любое завершение — с именем или без
   * (останется «Проект N») — закрывает дропдаун и открывает проект.
   */
  const finishEditing = (save: boolean) => {
    if (!editingId) return
    // Пустое имя renameProject игнорирует — остаётся дефолтное «Проект N».
    if (save) renameProject(editingId, draft)
    const isNew = editingId === createdId
    setEditingId(null)
    setCreatedId(null)
    if (isNew) {
      setOpen(false)
      router.push("/")
      onNavigate?.()
    }
  }

  // Закрытие дропдауна (клик мимо) сбрасывает поиск, а недоведённое
  // переименование ДОВОДИТ: набранное имя не должно молча теряться.
  useEffect(() => {
    if (!open) {
      setQuery("")
      finishEditing(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const trimmedQuery = query.trim().toLowerCase()
  const filtered = trimmedQuery
    ? projects.filter((project) => project.title.toLowerCase().includes(trimmedQuery))
    : projects

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn("nav-item", large ? "h-14 gap-3 px-3" : "h-12 gap-2.5 px-2.5")}
        style={{ background: "var(--bg-raised)", borderColor: "var(--line-strong)" }}
      >
        <ProjectAvatar title={activeProject?.title ?? ""} large={large} />
        <span
          className={cn("min-w-0 flex-1 truncate text-left", large ? "text-[14px]" : "text-[13px]")}
          style={{ color: activeProject ? "var(--fg-1)" : "var(--fg-4)" }}
        >
          {activeProject?.title ?? "Выберите проект"}
        </span>
        <ChevronDown
          className={cn("chevron h-3.5 w-3.5 shrink-0", open && "is-open")}
          style={{ color: "var(--fg-5)" }}
          strokeWidth={1.7}
        />
      </button>

      {menu.present ? (
        <div
          role="menu"
          data-state={menu.state}
          className="popover popover-stagger overlay-surface absolute inset-x-0 top-[calc(100%+8px)] z-50 p-2"
        >
          <div className="relative mb-2">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2"
              style={{ color: "var(--fg-5)" }}
              strokeWidth={1.7}
            />
            {/* autoFocus только на десктопе: на таче он сразу поднял бы клавиатуру. */}
            <input
              autoFocus={!large}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Поиск по тексту…"
              aria-label="Поиск проекта"
              className="field h-9 w-full pl-9 text-[13px]"
            />
          </div>

          <div className="no-scrollbar flex max-h-[280px] flex-col gap-1 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-[12px]" style={{ color: "var(--fg-5)" }}>
                {projects.length === 0 ? "Проектов пока нет" : "Ничего не найдено"}
              </p>
            ) : (
              filtered.map((project) => {
                if (project.id === editingId) {
                  return (
                    <input
                      key={project.id}
                      autoFocus
                      value={draft}
                      onChange={(event) => setDraft(event.target.value)}
                      onFocus={(event) => event.currentTarget.select()}
                      onBlur={() => finishEditing(true)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") finishEditing(true)
                        if (event.key === "Escape") {
                          // Не даём Escape долететь до document — иначе вместе
                          // с отменой правки закроется весь дропдаун.
                          event.stopPropagation()
                          finishEditing(false)
                        }
                      }}
                      aria-label="Название проекта"
                      className={cn("field w-full text-[13px]", large ? "h-12" : "h-10")}
                    />
                  )
                }

                return (
                  <div key={project.id} className="relative">
                    <button
                      type="button"
                      onClick={() => {
                        selectProject(project.id)
                        router.push("/")
                        setOpen(false)
                        onNavigate?.()
                      }}
                      className={cn(navItemClass(large, project.id === activeProjectId), "pr-[68px]")}
                      aria-current={project.id === activeProjectId ? "true" : undefined}
                    >
                      <ProjectAvatar title={project.title} large={false} />
                      <span className="min-w-0 flex-1 truncate text-left">{project.title}</span>
                    </button>

                    <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 gap-0.5">
                      <button
                        type="button"
                        aria-label={`Переименовать проект «${project.title}»`}
                        onClick={() => {
                          setEditingId(project.id)
                          setDraft(project.title)
                        }}
                        className="btn-icon h-7 w-7"
                      >
                        <Pencil className="h-3.5 w-3.5" strokeWidth={1.7} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Удалить проект «${project.title}»`}
                        onClick={() => {
                          const confirmed = window.confirm(
                            `Удалить проект «${project.title}» вместе с его обработками и материалами? Действие необратимо.`
                          )
                          if (!confirmed) return
                          // Сначала данные инструментов (метаданные + блобы
                          // IndexedDB), потом сам проект — иначе сироты.
                          useEnhanceStore.getState().removeByProject(project.id)
                          useMaterialStore.getState().removeByProject(project.id)
                          useModelStore.getState().removeByProject(project.id)
                          useViewsStore.getState().removeByProject(project.id)
                          useRestyleStore.getState().removeByProject(project.id)
                          deleteProject(project.id)
                        }}
                        className="btn-icon h-7 w-7"
                      >
                        <Trash2 className="h-3.5 w-3.5" strokeWidth={1.7} />
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>

          <hr className="ds-divider my-2" />

          <button
            type="button"
            onClick={() => {
              // Проект получает имя «Проект N» сразу, а строка списка тут же
              // переключается в режим ввода: ввёл название — оно сохранится,
              // закрыл как угодно — останется дефолтное. Навигация в проект —
              // после завершения ввода (finishEditing).
              const project = createProject()
              setQuery("")
              setEditingId(project.id)
              setDraft(project.title)
              setCreatedId(project.id)
            }}
            className={cn("nav-item", large ? "h-12 gap-3.5 px-3.5 text-[14px]" : "h-10 gap-3 px-3 text-[13px]")}
          >
            <Plus className="h-4 w-4 shrink-0" strokeWidth={2} />
            Добавить проект
          </button>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Аккаунт внизу сайдбара — паттерн UpSound: аватар + имя + чем «оплачено»,
 * по клику на десктопе дропдаун ВВЕРХ, на таче — нижняя шторка.
 */
function AccountTrigger({
  large,
  open,
  onClick,
}: {
  large: boolean
  open?: boolean
  onClick: () => void
}) {
  const companyName = useCompanyStore((state) => state.name)
  const server = useServerStatus()
  const title = companyName.trim() || "Ваш аккаунт"
  const initial = (companyName.trim()[0] ?? "С").toUpperCase()

  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="menu"
      aria-expanded={open}
      className={cn("nav-item", large ? "h-14 gap-3 px-3" : "h-12 gap-2.5 px-2.5")}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center rounded-full font-medium",
          large ? "h-8 w-8 text-[13px]" : "h-7 w-7 text-[12px]"
        )}
        style={{ background: "var(--bg-raised)", border: "1px solid var(--line-strong)", color: "var(--fg-1)" }}
      >
        {initial}
      </span>
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className={cn("truncate leading-tight", large ? "text-[14px]" : "text-[13px]")} style={{ color: "var(--fg-1)" }}>
          {title}
        </span>
        <span className="truncate text-[11px] leading-tight" style={{ color: "var(--fg-5)" }}>
          {server?.persistence ? "серверное хранение" : "локальный режим"}
        </span>
      </span>
      <ChevronDown
        className={cn("chevron h-3.5 w-3.5 shrink-0", open && "is-open")}
        style={{ color: "var(--fg-5)" }}
        strokeWidth={1.7}
      />
    </button>
  )
}

function DesktopAccountMenu() {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const menu = usePresence(open)

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("mousedown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      {menu.present ? (
        <div
          role="menu"
          data-state={menu.state}
          className="popover popover-up popover-stagger overlay-surface absolute inset-x-0 bottom-[calc(100%+8px)] z-50 p-2"
        >
          <Link
            href="/settings"
            onClick={() => setOpen(false)}
            className="nav-item h-10 gap-3 px-3 text-[13px]"
            role="menuitem"
          >
            <Settings className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
            Настройки
          </Link>
          <hr className="ds-divider my-2" />
          <div className="flex items-start gap-2.5 px-3 pb-1.5 pt-0.5">
            <Database className="mt-0.5 h-3 w-3 shrink-0" strokeWidth={1.6} style={{ color: "var(--fg-5)" }} />
            <p className="text-[11px] leading-snug" style={{ color: "var(--fg-5)" }}>
              Данные хранятся в этом браузере. Авторизация подключается отдельно.
            </p>
          </div>
        </div>
      ) : null}
      <AccountTrigger large={false} open={open} onClick={() => setOpen((value) => !value)} />
    </div>
  )
}

function SidebarBody({
  large,
  onNavigate,
  onAccount,
}: {
  large: boolean
  onNavigate?: () => void
  /** Тач: аккаунт открывает нижнюю шторку, а не дропдаун. */
  onAccount?: () => void
}) {
  const pathname = usePathname()
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`)

  return (
    <div className="nav-enter flex min-h-0 flex-1 flex-col">
      {/* Текущий проект — как «артист» в UpSound: селектор со списком
          и созданием вместо отдельной кнопки «Новый проект». */}
      <div className="shrink-0 px-4 pb-4">
        <span className="ds-micro mb-1.5 block px-3">проект</span>
        <ProjectSwitcher large={large} onNavigate={onNavigate} />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar px-4">
        <span className="ds-micro mb-1.5 block px-3">инструменты</span>
        <div className="flex flex-col gap-1 pb-4">
          {TOOL_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={onNavigate}
              className={navItemClass(large, isActive(link.href))}
              aria-current={isActive(link.href) ? "page" : undefined}
            >
              <link.icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
              <span className="min-w-0 flex-1 truncate">{link.label}</span>
            </Link>
          ))}
        </div>
      </div>

      <div className="shrink-0 px-4 pb-4 pt-2">
        <hr className="ds-divider mb-3" />
        {large ? (
          <AccountTrigger large open={false} onClick={() => onAccount?.()} />
        ) : (
          <DesktopAccountMenu />
        )}
      </div>
    </div>
  )
}

/**
 * Сайдбар — скруглённая «плавающая» панель с отступом от краёв экрана
 * (раскладка UpSound), логотип по центру шапки, аккаунт внизу.
 * На таче — шторка слева + нижняя шторка аккаунта.
 */
export function AppSidebar() {
  const [openMobile, setOpenMobile] = useState(false)
  const [accountSheetOpen, setAccountSheetOpen] = useState(false)
  const pathname = usePathname()

  // Переход закрывает шторки. По смене маршрута, а не в onClick каждой ссылки:
  // так закрываются и программные переходы из списка проектов.
  useEffect(() => {
    setOpenMobile(false)
    setAccountSheetOpen(false)
  }, [pathname])

  // Открытая шторка блокирует скролл под собой — иначе палец прокручивает
  // контент вместо меню.
  useEffect(() => {
    const anyOpen = openMobile || accountSheetOpen
    if (!anyOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  }, [openMobile, accountSheetOpen])

  return (
    <>
      {/* Десктоп: плавающая панель со скруглением и отступом 16px от краёв. */}
      <aside
        className="fixed left-4 top-4 bottom-4 z-40 hidden w-[264px] flex-col overflow-hidden lg:flex"
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-xl)",
          boxShadow: "0 16px 40px rgba(0, 0, 0, 0.35)",
        }}
      >
        <div className="flex h-16 shrink-0 items-center justify-center">
          <Logo />
        </div>
        <SidebarBody large={false} />
      </aside>

      {/* Тач: плавающая круглая кнопка меню в углу (паттерн UpSound).
          Страницы резервируют под неё место слева. */}
      <button
        type="button"
        onClick={() => setOpenMobile(true)}
        aria-label="Открыть меню"
        className="fixed left-3 top-3 z-30 flex h-11 w-11 items-center justify-center rounded-full lg:hidden"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--line-strong)" }}
      >
        <span className="flex flex-col gap-[3.5px]" aria-hidden>
          <span className="block h-[1.5px] w-4 rounded-full" style={{ background: "var(--fg-2)" }} />
          <span className="block h-[1.5px] w-4 rounded-full" style={{ background: "var(--fg-2)" }} />
          <span className="block h-[1.5px] w-2.5 rounded-full" style={{ background: "var(--fg-2)" }} />
        </span>
      </button>

      {/* Оверлей и шторка меню. Смонтированы всегда и ездят transition-ом:
          состояние «открыто» не зависит от того, доиграла ли анимация. */}
      <div
        onClick={() => setOpenMobile(false)}
        aria-hidden
        className={cn(
          "fixed inset-0 z-40 transition-opacity duration-200 lg:hidden",
          openMobile ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        style={{ background: "rgba(10,10,12,0.6)" }}
      />
      <aside
        // inert выключает фокус и чтение скринридером у закрытой шторки:
        // иначе Tab уводит каретку в невидимое меню за краем экрана.
        inert={!openMobile}
        className={cn(
          "fixed bottom-2 left-2 top-2 z-50 flex w-[300px] max-w-[88vw] flex-col overflow-hidden transition-transform duration-300 lg:hidden",
          openMobile ? "translate-x-0" : "-translate-x-[110%]"
        )}
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--line)",
          borderRadius: "var(--r-xl)",
          transitionTimingFunction: "var(--ease-out)",
        }}
      >
        <div className="flex h-16 shrink-0 items-center justify-between px-3">
          {/* Спейсер зеркалит крестик — лого остаётся строго по центру. */}
          <span className="h-9 w-9 shrink-0" aria-hidden />
          <Logo />
          <button
            type="button"
            onClick={() => setOpenMobile(false)}
            aria-label="Закрыть меню"
            className="btn-icon h-9 w-9 shrink-0"
          >
            <X className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>
        <SidebarBody
          large
          onNavigate={() => setOpenMobile(false)}
          onAccount={() => setAccountSheetOpen(true)}
        />
      </aside>

      {/* Нижняя шторка аккаунта (тач) — поверх шторки меню, как в UpSound. */}
      <div
        onClick={() => setAccountSheetOpen(false)}
        aria-hidden
        className={cn(
          "fixed inset-0 z-[60] transition-opacity duration-200 lg:hidden",
          accountSheetOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        style={{ background: "rgba(10,10,12,0.5)" }}
      />
      <div
        inert={!accountSheetOpen}
        role="dialog"
        aria-label="Аккаунт"
        className={cn("sheet-bottom lg:hidden", !accountSheetOpen && "is-closed")}
      >
        <div className="sheet-grabber" aria-hidden />
        <AccountSheetContent onClose={() => setAccountSheetOpen(false)} />
      </div>
    </>
  )
}

function AccountSheetContent({ onClose }: { onClose: () => void }) {
  const companyName = useCompanyStore((state) => state.name)
  const companyContact = useCompanyStore((state) => state.contact)

  return (
    <div className="flex flex-col">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[15px]" style={{ color: "var(--fg-1)" }}>
            {companyName.trim() || "Ваш аккаунт"}
          </span>
          <span className="truncate text-[12px]" style={{ color: "var(--fg-4)" }}>
            {companyContact.trim() || "локальный режим · данные в этом браузере"}
          </span>
        </div>
        <button type="button" onClick={onClose} aria-label="Закрыть" className="btn-icon shrink-0">
          <X className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>

      <Link href="/settings" onClick={onClose} className="nav-item h-12 gap-3.5 px-3.5 text-[14px]">
        <Settings className="h-4 w-4 shrink-0" strokeWidth={1.7} />
        Настройки
      </Link>

      <p className="mt-3 px-1 text-[11.5px] leading-snug" style={{ color: "var(--fg-5)" }}>
        Авторизация не подключена: проекты и настройки лежат в localStorage этого браузера.
      </p>
    </div>
  )
}
