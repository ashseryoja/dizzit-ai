"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"

import { attachServerSync } from "@/lib/server-sync"
import { createId } from "@/lib/utils"
import { fetchWorkspaceProject, hasPendingWorkspaceSave, saveWorkspaceProject } from "@/lib/workspace-sync"
import type { Project, RenderFolder } from "@/types"

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
  /**
   * Список сверен с сервером (или сервера нет). До этого стор не знает, пуст
   * ли он на самом деле: в новом браузере проекты ещё едут, и авто-создание
   * «Проект N» породило бы фантом, который затем уехал бы на сервер.
   */
  synced: boolean

  setHydrated: () => void
  createProject: (title?: string) => Project
  selectProject: (id: string) => void
  renameProject: (id: string, title: string) => void
  deleteProject: (id: string) => void
  /** Папки рендеров внутри проекта — вкладки правой панели. */
  createFolder: (projectId: string, title?: string) => RenderFolder | null
  renameFolder: (projectId: string, folderId: string, title: string) => void
  deleteFolder: (projectId: string, folderId: string) => void
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

/** Дефолтное имя папки — «Комната N», по той же логике, что и у проектов. */
function nextFolderTitle(folders: RenderFolder[]): string {
  let maxN = 0
  for (const folder of folders) {
    const match = /^Комната (\d+)$/u.exec(folder.title.trim())
    if (match) maxN = Math.max(maxN, Number(match[1]))
  }
  return `Комната ${maxN + 1}`
}

function patchProject(projects: Project[], id: string, patch: (project: Project) => Partial<Project>): Project[] {
  return projects.map((project) => (project.id === id ? { ...project, ...patch(project), updatedAt: nowIso() } : project))
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set, get) => ({
      projects: [],
      activeProjectId: null,
      hydrated: false,
      synced: false,

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

      createFolder: (projectId, title) => {
        const project = get().projects.find((item) => item.id === projectId)
        if (!project) return null
        const folder: RenderFolder = {
          id: createId(),
          title: title?.trim() || nextFolderTitle(project.folders ?? []),
          createdAt: nowIso(),
        }
        set((state) => ({
          projects: patchProject(state.projects, projectId, (item) => ({ folders: [...(item.folders ?? []), folder] })),
        }))
        return folder
      },

      renameFolder: (projectId, folderId, title) => {
        set((state) => ({
          projects: patchProject(state.projects, projectId, (item) => ({
            folders: (item.folders ?? []).map((folder) =>
              folder.id === folderId ? { ...folder, title: title.trim() || folder.title } : folder
            ),
          })),
        }))
      },

      deleteFolder: (projectId, folderId) => {
        set((state) => ({
          projects: patchProject(state.projects, projectId, (item) => ({
            folders: (item.folders ?? []).filter((folder) => folder.id !== folderId),
          })),
        }))
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

const SYNC_WAIT_MS = 30_000

function findActiveProject(): Project | null {
  const { projects, activeProjectId } = useProjectStore.getState()
  return projects.find((project) => project.id === activeProjectId) ?? null
}

/** Ждём сверки списка с сервером; сервер молчит дольше SYNC_WAIT_MS — отказ, не фантом. */
function whenProjectsSynced(): Promise<void> {
  if (useProjectStore.getState().synced) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      unsubscribe()
      reject(new Error("Проекты ещё не загрузились с сервера — проверьте соединение и попробуйте ещё раз."))
    }, SYNC_WAIT_MS)
    const unsubscribe = useProjectStore.subscribe((state) => {
      if (!state.synced) return
      window.clearTimeout(timer)
      unsubscribe()
      resolve()
    })
  })
}

/**
 * Активный проект, а без него — новый «Проект N», как это делает селектор
 * в сайдбаре. Для колбэков вне рендера: обработкам нужно, куда их класть.
 *
 * Новый проект — только после сверки списка с сервером (`synced`): в новом
 * браузере локальный стор пуст, пока проекты едут, и создание «Проект 1» в
 * этот момент давало фантом, который слияние затем отправляло на сервер.
 * С активным проектом на руках ждать нечего — отвечаем сразу.
 */
export async function ensureActiveProject(): Promise<Project> {
  const existing = findActiveProject()
  if (existing) return existing
  await whenProjectsSynced()
  return findActiveProject() ?? useProjectStore.getState().createProject()
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
  onSettled: () => useProjectStore.setState({ synced: true }),
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
