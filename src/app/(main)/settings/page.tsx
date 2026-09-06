"use client"

import { useRef, type ReactNode } from "react"
import { Cloud, Download, LogOut, Monitor, Moon, Sun, Trash2, Upload, type LucideIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { PageLoader } from "@/components/page-loader"
import { Field } from "@/components/ui/field"
import { Panel, SectionTitle } from "@/components/ui/panel"
import { Switch } from "@/components/ui/switch"
import { clearAppData, downloadBackup, restoreBackup, storageBytes } from "@/lib/backup"
import { useServerStatus } from "@/lib/server-sync"
import { useMounted } from "@/lib/use-mounted"
import { cn, formatNumber, plural } from "@/lib/utils"
import { useCompanyStore } from "@/stores/company-store"
import { useProjectStore } from "@/stores/project-store"
import { useSettingsStore, type ThemePreference } from "@/stores/settings-store"

const THEME_OPTIONS: { value: ThemePreference; label: string; icon: LucideIcon }[] = [
  { value: "dark", label: "Тёмная", icon: Moon },
  { value: "light", label: "Светлая", icon: Sun },
  { value: "system", label: "Системная", icon: Monitor },
]

export default function SettingsPage() {
  const mounted = useMounted()
  const company = useCompanyStore()
  const projectCount = useProjectStore((state) => state.projects.length)
  const settings = useSettingsStore()
  const server = useServerStatus()

  const signOut = async () => {
    await fetch("/api/auth/logout", { method: "POST" })
    window.location.href = "/login"
  }

  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleRestore: React.ChangeEventHandler<HTMLInputElement> = async (event) => {
    const file = event.target.files?.[0]
    // Сбрасываем value сразу: иначе повторный выбор того же файла не вызовет onChange.
    event.target.value = ""
    if (!file) return

    const confirmed = window.confirm(
      `Восстановить данные из «${file.name}»? Текущие проекты, профиль и настройки будут заменены содержимым копии.`
    )
    if (!confirmed) return

    try {
      await restoreBackup(file)
      // Перезагрузка обязательна: zustand-persist читает localStorage один раз на старте.
      window.location.reload()
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Не удалось восстановить копию.")
    }
  }

  const handleClear = () => {
    const confirmed = window.confirm(
      "Удалить все данные приложения? Исчезнут проекты, профиль и настройки в этом браузере. Действие необратимо."
    )
    if (!confirmed) return
    clearAppData()
    window.location.reload()
  }

  if (!mounted) {
    return (
      <div className="page-shell">
        <PageLoader />
      </div>
    )
  }

  const initial = (company.name.trim()[0] ?? "?").toUpperCase()

  return (
    <div className="page-shell">
      <div className="page-content-narrow flex flex-col gap-5">
        <PageHeader title="Настройки" description="Профиль, внешний вид и данные приложения." />

        <Panel>
          <SectionTitle>Профиль</SectionTitle>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
            {/* Инициал-«аватар» — тот же, что в меню аккаунта: видно, что правишь именно его. */}
            <span
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-[20px] font-medium"
              style={{
                background: "var(--bg-raised)",
                border: "1px solid var(--line-strong)",
                color: "var(--fg-1)",
              }}
              aria-hidden
            >
              {initial}
            </span>
            <div className="grid min-w-0 flex-1 gap-4 sm:grid-cols-2">
              <Field label="имя или студия">
                {(id) => (
                  <input
                    id={id}
                    className="field"
                    value={company.name}
                    onChange={(event) => company.update({ name: event.target.value })}
                    placeholder="Студия «Контур»"
                    autoComplete="organization"
                  />
                )}
              </Field>
              <Field label="контакты" hint="Телефон, почта или сайт">
                {(id) => (
                  <input
                    id={id}
                    className="field"
                    value={company.contact}
                    onChange={(event) => company.update({ contact: event.target.value })}
                    placeholder="hello@studio.ru"
                    autoComplete="email"
                  />
                )}
              </Field>
            </div>
          </div>
          <p className="ds-caption mt-4">
            Видны в меню аккаунта внизу сайдбара и попадут в шапки будущих экспортов.
          </p>
        </Panel>

        <Panel>
          <SectionTitle>Внешний вид</SectionTitle>
          <div className="flex flex-col gap-4">
            <SettingRow
              title="Тема"
              description="Светлая и тёмная — вручную, системная повторяет настройку устройства."
              // На узких экранах сегменты делят всю ширину, иконки прячутся —
              // иначе «Системная» не влезала и обрезалась краем панели.
              controlClassName="max-sm:w-full"
              control={
                <div className="seg max-sm:w-full" role="radiogroup" aria-label="Тема интерфейса">
                  {THEME_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={settings.theme === option.value}
                      onClick={() => settings.setTheme(option.value)}
                      className={cn(
                        "seg-item max-sm:flex-1 max-sm:justify-center",
                        settings.theme === option.value && "is-active"
                      )}
                    >
                      <option.icon className="h-3.5 w-3.5 shrink-0 max-sm:hidden" strokeWidth={1.7} />
                      {option.label}
                    </button>
                  ))}
                </div>
              }
            />
            <hr className="ds-divider" />
            <SettingRow
              htmlFor="setting-reduce-motion"
              title="Меньше движения"
              description="Отключает анимации и переходы — интерфейс меняется мгновенно."
              control={
                <Switch
                  id="setting-reduce-motion"
                  checked={settings.reduceMotion}
                  onChange={settings.setReduceMotion}
                />
              }
            />
          </div>
        </Panel>

        <Panel>
          <SectionTitle>Хранение</SectionTitle>
          <div className="flex flex-col gap-4">
            <SettingRow
              title={server?.persistence ? "Проекты и результаты хранятся на сервере" : "Проекты и результаты хранятся в этом браузере"}
              description={storageDescription(server)}
              control={
                <span className="flex items-center gap-1.5 text-[12px]" style={{ color: "var(--fg-4)" }}>
                  <Cloud className="h-4 w-4" strokeWidth={1.7} />
                  {server?.persistence ? "синхронизация включена" : "локальный режим"}
                </span>
              }
            />
            {server?.signedIn ? (
              <>
                <hr className="ds-divider" />
                <SettingRow
                  title="Выйти из рабочего пространства"
                  description="Сессия на этом устройстве закроется; данные на сервере останутся."
                  control={
                    <button type="button" onClick={() => void signOut()} className="btn-secondary">
                      <LogOut className="h-4 w-4" strokeWidth={1.7} />
                      Выйти
                    </button>
                  }
                />
              </>
            ) : null}
          </div>
        </Panel>

        <Panel>
          <SectionTitle>Данные</SectionTitle>
          <div className="flex flex-col gap-4">
            <SettingRow
              title="Резервная копия"
              description="Все проекты, профиль и настройки одним JSON-файлом."
              control={
                <button type="button" onClick={downloadBackup} className="btn-secondary">
                  <Download className="h-4 w-4" strokeWidth={1.7} />
                  Скачать копию
                </button>
              }
            />
            <hr className="ds-divider" />
            <SettingRow
              title="Восстановление"
              description="Вернёт данные из скачанной ранее копии. Текущие будут заменены."
              control={
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={handleRestore}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="btn-secondary"
                  >
                    <Upload className="h-4 w-4" strokeWidth={1.7} />
                    Выбрать файл
                  </button>
                </>
              }
            />
            <hr className="ds-divider" />
            <SettingRow
              title="Удалить все данные"
              description="Сотрёт проекты, профиль и настройки из этого браузера. Необратимо."
              control={
                <button type="button" onClick={handleClear} className="btn-secondary is-danger">
                  <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                  Удалить всё
                </button>
              }
            />
          </div>
          <p className="ds-caption mt-5">
            Сейчас в браузере: {projectCount} {plural(projectCount, ["проект", "проекта", "проектов"])} ·
            данные занимают {formatBytes(storageBytes())}.{" "}
            {server?.persistence ? "Копия каждой записи и картинки уходит на сервер." : "На сервер ничего не отправляется."}
          </p>
        </Panel>
      </div>
    </div>
  )
}

/**
 * Строка настройки — стандартная раскладка «название и пояснение слева,
 * контрол справа». htmlFor связывает название с контролом: клик по тексту
 * переключает тумблер.
 */
function SettingRow({
  title,
  description,
  control,
  htmlFor,
  controlClassName,
}: {
  title: string
  description: string
  control: ReactNode
  htmlFor?: string
  controlClassName?: string
}) {
  const titleClass = "text-[13.5px]"
  const titleStyle = { color: "var(--fg-1)" }

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-8 gap-y-3">
      <div className="flex min-w-[220px] max-w-[420px] flex-1 flex-col gap-1">
        {htmlFor ? (
          <label htmlFor={htmlFor} className={`${titleClass} w-fit cursor-pointer`} style={titleStyle}>
            {title}
          </label>
        ) : (
          <span className={titleClass} style={titleStyle}>
            {title}
          </span>
        )}
        <span className="text-[12px] leading-snug" style={{ color: "var(--fg-4)" }}>
          {description}
        </span>
      </div>
      <div className={cn("flex shrink-0 items-center gap-2", controlClassName)}>{control}</div>
    </div>
  )
}

/** Почему данные там, где они есть: чего не хватает для серверного хранения. */
function storageDescription(server: ReturnType<typeof useServerStatus>): string {
  if (!server) return "Проверяем подключение к серверу…"
  if (server.persistence) {
    return `Вход выполнен, база подключена, картинки — в ${server.storage === "vercel-blob" ? "приватном Vercel Blob" : "хранилище на диске сервера"}. Галерея одна на всех устройствах.`
  }
  if (!server.authConfigured) return "На сервере не задан пароль входа (AUTH_SECRET и APP_ACCESS_PASSWORD) — серверное хранение выключено."
  if (!server.signedIn) return "Сессия не активна — войдите заново, чтобы синхронизация продолжилась."
  if (!server.database) return "Не задана база данных (DATABASE_URL)."
  if (!server.storage) return "Не настроено хранилище картинок (BLOB_STORE_ID)."
  return "Синхронизация недоступна."
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`
  if (bytes < 1024 * 1024) return `${formatNumber(bytes / 1024, 0)} КБ`
  return `${formatNumber(bytes / (1024 * 1024), 1)} МБ`
}
