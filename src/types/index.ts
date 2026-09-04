/**
 * Проект — контейнер работы пользователя. Раньше проект был «чатом-расчётом»
 * со сметой внутри; сметные инструменты удалены при смене профиля сервиса
 * (дизайн: рендеры, скетч→рендер, материалы). Новые инструменты будут
 * дописывать сюда свои сущности.
 */

import type { RegionPayload } from "@/lib/render-regions"
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

/** Фильтр пакетной обработки — общий тон для всех рендеров пачки. */
export type BatchFilter = "none" | "warm" | "cool" | "contrast" | "mono"

/** Время суток на рендере; «как есть» — не менять. */
export type BatchTime = "keep" | "morning" | "day" | "sunset" | "night"

/**
 * Общие функции пакетного редактирования. Только они применимы сразу
 * к нескольким рендерам: точечные правки («убрать вот это») требуют
 * одного кадра на экране.
 */
export interface BatchTools {
  quality: boolean
  filter: BatchFilter
  time: BatchTime
}

/**
 * Обработка рендера. Настроек нет намеренно: результат всегда в размере
 * исходника, единственный выбор пользователя — контекст сцены. Пакетная
 * обработка добавляет общие функции (tools).
 */
export interface Enhancement extends GalleryItemMeta {
  context: EnhanceContext
  sourceName: string
  sourceWidth: number
  sourceHeight: number
  tools?: BatchTools
  /** Области точечной правки (см. lib/render-regions): геометрия в долях кадра. */
  regions?: RegionPayload[]
  /**
   * Заселить сцену: люди и растения по контексту кадра, в его масштабе.
   * Тумблер в настройках композера — и для одного рендера, и для пачки.
   */
  populate?: boolean
}

/* ── Ракурсы и детали ── */

/**
 * Тип кадра в сете. Ракурсы (сверху, снизу, слева, справа) — вся сцена с
 * другой точки, в размере исходника. Крупные планы — вырезки из кадра в
 * формате 4:5: деталь (предмет крупно), фактура (макро материала),
 * фрагмент (зона помещения).
 */
export type ShotKind = "top" | "low" | "left" | "right" | "detail" | "texture" | "fragment"

/** Выбор в композере: готовая карусель или один тип кадров. */
export type ViewPreset = "set" | "details" | "angles" | "fragments"

/** Кадр сета: ключ уникален в сете (`detail-2`), подпись — для плитки. */
export interface ViewFrame {
  key: string
  kind: ShotKind
  label: string
}

/**
 * Сет кадров по одному рендеру: общий план на входе — раскадровка для
 * публикации на выходе, без 3D-модели. Каждый кадр лежит в IndexedDB под
 * своим ключом (`${id}:view-${frame.key}`, см. lib/view-engine); `ready` —
 * ключи готовых, запись считается done, когда готовы все `frames`.
 */
export interface ViewSet extends GalleryItemMeta {
  preset: ViewPreset
  frames: ViewFrame[]
  ready?: string[]
  sourceName: string
  sourceWidth: number
  sourceHeight: number
}

/* ── Перенос стиля ── */

/**
 * Стиль интерьера, в который переводится кадр. «Авто» — свой стиль по
 * описанию. Каталог с подписями, палитрами и словами-подсказками —
 * `STYLES` в lib/restyle-engine.
 */
export type RestyleStyle =
  | "auto"
  | "scandi"
  | "neoclassic"
  | "japandi"
  | "loft"
  | "minimal"
  | "midcentury"
  | "boho"
  | "artdeco"
  | "mediterranean"
  | "provence"
  | "wabisabi"
  | "contemporary"

/**
 * Перенос стиля: геометрия помещения остаётся, меняются отделка, цвета и
 * дизайн мебели. Результат — в размере исходника, как у улучшения.
 */
export interface Restyle extends GalleryItemMeta {
  style: RestyleStyle
  /** Материалы стиля, которые пользователь снял галочкой: их в рендере быть не должно. */
  excluded?: string[]
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
