/**
 * Проект — контейнер работы пользователя. Раньше проект был «чатом-расчётом»
 * со сметой внутри; сметные инструменты удалены при смене профиля сервиса
 * (дизайн: рендеры, скетч→рендер, материалы). Новые инструменты будут
 * дописывать сюда свои сущности.
 */
export interface Project {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

/* ── Редактор рендера ──────────────────────────────────────────────
   Первый инструмент нового профиля: рендер на входе → та же сцена на
   выходе, но реалистичнее и в большем разрешении. Содержимое кадра
   не меняется — это обещание продукта, а не настройка. */

export type GenerationStatus = "processing" | "done" | "error"

/**
 * Общий скелет записи галереи инструмента. Каждый инструмент профиля
 * (улучшение рендера, генерация материала, дальше скетч→рендер) живёт в этом
 * паттерне: метаданные в localStorage (попадают в резервную копию), сами
 * изображения — в IndexedDB под ключами `${id}:{роль}` (lib/blob-store).
 */
export interface GalleryItemMeta {
  id: string
  projectId: string
  status: GenerationStatus
  /** Комментарий из композера. */
  note: string
  /** Исходник/референс. У генерации без референса этих полей нет. */
  sourceName?: string
  sourceWidth?: number
  sourceHeight?: number
  resultWidth?: number
  resultHeight?: number
  error?: string
  createdAt: string
}

/* ── Редактор рендера ── */

/** Подсказка обработке, что в кадре. На состав сцены не влияет. */
export type EnhanceContext = "auto" | "interior" | "exterior" | "product"

/**
 * Обработка рендера. Настроек нет намеренно: результат всегда в размере
 * исходника, единственный выбор пользователя — контекст сцены.
 */
export interface Enhancement extends GalleryItemMeta {
  context: EnhanceContext
  sourceName: string
  sourceWidth: number
  sourceHeight: number
}

/* ── Генерация материала ── */

/** Семейство материала. «Авто» выводится из описания. */
export type MaterialCategory = "auto" | "wood" | "stone" | "metal" | "fabric"

/**
 * Генерация материала: текстура по описанию, референс (если есть) задаёт тон.
 * Результат — квадратный тайл.
 */
export interface Material extends GalleryItemMeta {
  category: MaterialCategory
}

/* ── Фото → 3D ── */

/** Предмет, который строится по фото. Пока — пять семейств мебели. */
export type FurnitureShape = "chair" | "table" | "lamp" | "sofa" | "shelf"

/**
 * 3D-модель по одному фото. Геометрия пока не хранится: локальный движок
 * подбирает форму из библиотеки каркасов, а провайдер, который отдаст
 * настоящий GLB, подключается отдельно (тогда появится result-блоб).
 */
export interface Model3D extends GalleryItemMeta {
  shape: FurnitureShape
  sourceName: string
  sourceWidth: number
  sourceHeight: number
  vertexCount?: number
  edgeCount?: number
}
