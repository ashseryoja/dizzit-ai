"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"

import { attachServerSync } from "@/lib/server-sync"
import { createId } from "@/lib/utils"
import { fetchWorkspaceProject, hasPendingWorkspaceSave, saveWorkspaceProject } from "@/lib/workspace-sync"
import type { Project } from "@/types"

// Не даём медленному GET, начатому до локального клика, вернуть старый проект.
let workspaceSelectionRevision = 0
function rememberWorkspaceProject(id: string | null) {
  workspaceSelectionRevision += 1
  void saveWorkspaceProject(id)
}

/**
 * Проекты — центральная сущность приложения: селектор в сайдбаре живёт на
 * этом сторе. Инструменты сервиса (дизайн: рендеры, материалы) будут крепить
 * свои данные к проекту по id.
 *
 * Хранилище — localStorage (ключ `dizzit-projects`). Прежний ключ
 * `smeta-chats` не читается намеренно: вместе со сметными инструментами
 * ушли и переписки-расчёты, тащить их в новый профиль сервиса нечем.
 */
interface ProjectState {
  projects: Project[]
  activeProjectId: string | null
  hydrated: boolean

  setHydrated: () => void
  createProject: (title?: string) => Project
  selectProject: (id: string) => void
  renameProject: (id: string, title: string) => void
  deleteProject: (id: string) => void
}

function nowIso() {
  return new Date().toISOString()
}

/** Дефолтное имя нового проекта: «Проект N», N растёт до бесконечности —
    следующий номер за максимальным из уже существующих. Имя живёт, пока
    пользователь не переименует проект сам. */
function nextProjectTitle(projects: Project[]): string {
  let maxN = 0
  for (const project of projects) {
    const match = /^Проект (\d+)$/u.exec(project.title.trim())
    if (match) maxN = Math.max(maxN, Number(match[1]))
  }
  return `Проект ${maxN + 1}`
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,
      hydrated: false,

      setHydrated: () => set({ hydrated: true }),

      createProject: (title) => {
        const timestamp = nowIso()
        const project: Project = {
          id: createId(),
          title: title ?? nextProjectTitle(get().projects),
          createdAt: timestamp,
          updatedAt: timestamp,
        }
        set((state) => ({
          projects: [project, ...state.projects],
          activeProjectId: project.id,
        }))
        rememberWorkspaceProject(project.id)
        return project
      },

      selectProject: (id) => {
        set({ activeProjectId: id })
        rememberWorkspaceProject(id)
      },

      renameProject: (id, title) => {
        set((state) => ({
          projects: state.projects.map((project) =>
            project.id === id
              ? { ...project, title: title.trim() || project.title, updatedAt: nowIso() }
              : project
          ),
        }))
      },

      deleteProject: (id) => {
        const { projects, activeProjectId } = get()
        const rest = projects.filter((project) => project.id !== id)
        const nextActiveProjectId = activeProjectId === id ? rest[0]?.id ?? null : activeProjectId
        set({
          projects: rest,
          // Удалили активный — переключаемся на следующий, иначе разделы
          // остались бы с пустым контекстом.
          activeProjectId: nextActiveProjectId,
        })
        rememberWorkspaceProject(nextActiveProjectId)
      },
    }),
    {
      name: "dizzit-projects",
      partialize: (state) => ({
        projects: state.projects,
        activeProjectId: state.activeProjectId,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated()
      },
    }
  )
)

export function useActiveProject(): Project | null {
  const projects = useProjectStore((state) => state.projects)
  const activeProjectId = useProjectStore((state) => state.activeProjectId)
  return projects.find((project) => project.id === activeProjectId) ?? null
}

/**
 * Активный проект, а без него — новый «Проект N», как это делает селектор
 * в сайдбаре. Для колбэков вне рендера: обработкам нужно, куда их класть.
 */
export function ensureActiveProject(): Project {
  const { projects, activeProjectId, createProject } = useProjectStore.getState()
  return projects.find((project) => project.id === activeProjectId) ?? createProject()
}

// Сервер (если настроен): проекты сливаются первыми — записи инструментов
// фильтруются по активному проекту, и он должен существовать на любом устройстве.
attachServerSync(useProjectStore, {
  collection: "projects",
  select: (state) => state.projects,
  apply: (projects) => {
    const { activeProjectId } = useProjectStore.getState()
    const active = projects.some((project) => project.id === activeProjectId) ? activeProjectId : projects[0]?.id ?? null
    useProjectStore.setState({ projects, activeProjectId: active })
  },
  hydrated: (state) => state.hydrated,
})

/*
 * activeProjectId раньше был только в localStorage, поэтому два браузера
 * могли открыть разные одноимённые проекты. Серверный указатель применяется
 * после появления списка проектов и перечитывается при возврате во вкладку.
 */
if (typeof window !== "undefined") {
  let pendingProjectId: string | null = null
  let refreshing = false

  const applyPending = () => {
    if (!pendingProjectId) return
    const state = useProjectStore.getState()
    if (state.projects.some((project) => project.id === pendingProjectId)) {
      // setState уведомляет подписчиков синхронно. Сначала очищаем pending,
      // иначе этот же subscribe рекурсивно вызовет applyPending до overflow.
      const nextProjectId = pendingProjectId
      pendingProjectId = null
      if (state.activeProjectId !== nextProjectId) {
        useProjectStore.setState({ activeProjectId: nextProjectId })
      }
    }
  }

  const refreshWorkspace = async () => {
    if (refreshing) return
    // Пока явный локальный выбор не подтверждён, старое серверное значение не
    // имеет права откатывать UI назад.
    if (hasPendingWorkspaceSave()) return
    refreshing = true
    const revisionAtStart = workspaceSelectionRevision
    try {
      const projectId = await fetchWorkspaceProject()
      if (revisionAtStart !== workspaceSelectionRevision || hasPendingWorkspaceSave()) return
      pendingProjectId = projectId
      applyPending()
    } catch {
      // Локальный выбор остаётся рабочим; следующая focus/online-попытка повторит.
    } finally {
      refreshing = false
    }
  }

  useProjectStore.subscribe(applyPending)
  window.addEventListener("focus", refreshWorkspace)
  window.addEventListener("online", refreshWorkspace)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refreshWorkspace()
  })
  void refreshWorkspace()
}
