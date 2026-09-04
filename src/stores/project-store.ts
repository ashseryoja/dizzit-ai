"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"

import { createId } from "@/lib/utils"
import type { Project } from "@/types"

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
        return project
      },

      selectProject: (id) => set({ activeProjectId: id }),

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
        set({
          projects: rest,
          // Удалили активный — переключаемся на следующий, иначе разделы
          // остались бы с пустым контекстом.
          activeProjectId: activeProjectId === id ? rest[0]?.id ?? null : activeProjectId,
        })
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
