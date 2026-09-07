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
  /** Папки панели рендеров («Комната 1», «Кухня»); «Общая» — не папка, а вид на всё. */
  folders?: RenderFolder[]
}

/** Папка рендеров внутри проекта — вкладка слева от правой панели. */
export interface RenderFolder {
  id: string
  title: string
  createdAt: string
}

/* ── Редактор рендера ──────────────────────────────────────────────
   Первый инструмент нового профиля: рендер на входе → та же сцена на
   выходе, но реалистичнее и в большем разрешении. Содержимое кадра
   не меняется — это обещание продукта, а не настройка. */

export type GenerationStatus = "draft" | "processing" | "done" | "error"

/**
 * Общий скелет записи галереи инструмента. Каждый инструмент профиля
 * (улучшение рендера, генерация материала, дальше скетч→рендер) живёт в этом
 * паттерне: метаданные в localStorage (попадают в резервную копию), сами
 * изображения — в IndexedDB под ключами `${id}:{роль}` (lib/blob-store).
 */
export interface GalleryItemMeta {
  id: string
  projectId: string
  /** Папка проекта, в которой запись создана; без неё запись видна только в «Общей». */
  folderId?: string
  status: GenerationStatus
  /** Комментарий из композера. */
  note: string
  /** Исходник/референс. У генерации без референса этих полей нет. */
  sourceName?: string
  sourceWidth?: number
  sourceHeight?: number
  resultWidth?: number
  resultHeight?: number
  /**
   * Чем посчитан результат: id модели провайдера (`gpt-image-2`) или
   * `preview` — локальный canvas-движок, когда ключ провайдера не задан
   * (см. lib/image-generation). У записей до подключения провайдера поля нет.
   */
  engine?: string
  /**
   * Результат уже посчитан и лежит в локальном кэше, но его серверная копия
   * ещё не подтверждена. Повтор в этом состоянии чинит только сохранение и
   * никогда не запускает платную генерацию второй раз.
   */
  syncPending?: boolean
  /**
   * Вкладка закрылась, пока платный запрос был в полёте, и достоверного ответа
   * нет. Автоматический Retry в таком состоянии не имеет права снова вызывать
   * провайдера: сначала можно только искать/дозагружать прежний результат.
   */
  generationUncertain?: boolean
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
 * Обработка рендера. При включённом улучшении GPT Image 2 создаёт 2K-версию,
 * после чего сервер приводит длинную сторону к 2000 px через Lanczos3.
 */
export interface Enhancement extends GalleryItemMeta {
  context: EnhanceContext
  sourceName: string
  sourceWidth: number
  sourceHeight: number
  /** Черновик полностью записал исходник и миниатюру в активное хранилище. */
  sourceReady?: boolean
  /** Повторная правка может использовать текущий результат, не затирая исходник. */
  inputRole?: "source" | "result"
  tools?: BatchTools
  /** Области точечной правки (см. lib/render-regions): геометрия в долях кадра. */
  regions?: RegionPayload[]
  /**
   * Заселить сцену: люди и растения по контексту кадра, в его масштабе.
   * Тумблер в настройках композера — и для одного рендера, и для пачки.
   */
  populate?: boolean
  /**
   * Инвентарь сцены от vision-модели (lib/scene-analysis): что за предметы в
   * кадре, где, из чего и в каком состоянии. Считается один раз перед первым
   * улучшением и подставляется в промпт; «Повторить» и повторные правки того
   * же кадра его переиспользуют.
   */
  sceneInventory?: string
}

/* ── Ракурсы и детали ── */

/**
 * Тип кадра в сете. Ракурсы (сверху, снизу, слева, справа) — вся сцена с
 * другой точки. Крупные планы — деталь (предмет крупно), фактура (макро
 * материала), фрагмент (зона помещения). Все кадры сета — в одном формате,
 * который выбирает пользователь (`FrameAspect`).
 */
export type ShotKind = "top" | "low" | "left" | "right" | "detail" | "texture" | "fragment"

/** Выбор в композере: готовая карусель или один тип кадров. `angles` — старые записи, теперь то же, что фрагменты. */
export type ViewPreset = "set" | "details" | "textures" | "fragments" | "angles"

/**
 * Формат кадров сета — выбирается перед построением (`lib/frame-aspect`):
 * сторис 9:16, широкий 16:9, классические 4:3 и 3:4, квадрат 1:1.
 */
export type FrameAspect = "9:16" | "16:9" | "4:3" | "3:4" | "1:1"

/**
 * Кадр сета: ключ уникален в сете (`detail-2`), подпись — для плитки.
 * `brief` — задание кадра от планировщика (vision-модель посмотрела на рендер
 * и решила, что именно снять: предмет, точка съёмки, кадрирование); без него
 * кадр строится по типовому сюжету своего типа.
 */
export interface ViewFrame {
  key: string
  kind: ShotKind
  label: string
  brief?: string
  /**
   * Область исходника для кадра — доли ширины и высоты [x, y, w, h] от 0 до 1.
   * Кадр — это кроп исходника, а не новая точка съёмки: клиент вырезает область
   * в формате сета и отдаёт модели как основу (см. lib/view-engine).
   */
  region?: [number, number, number, number]
}

/**
 * Сет кадров по одному рендеру: общий план на входе — раскадровка для
 * публикации на выходе, без 3D-модели. Каждый кадр лежит в IndexedDB под
 * своим ключом (`${id}:view-${frame.key}`, см. lib/view-engine); `generated`
 * фиксирует завершившийся вызов модели, а `ready` — подтверждённое серверное
 * сохранение. Разделение не позволяет Retry оплатить тот же кадр ещё раз.
 */
export interface ViewSet extends GalleryItemMeta {
  preset: ViewPreset
  frames: ViewFrame[]
  /** Формат кадров сета; у записей до появления выбора — нет (крупные планы 4:5). */
  aspect?: FrameAspect
  /** Исходник и миниатюра записаны в хранилище (и на сервер, если он есть). До этого — «сохраняем исходник…». */
  sourceReady?: boolean
  /**
   * Список кадров составлен планировщиком (vision-модель по этому рендеру), а
   * не по шаблону набора. «Повторить» планировщик заново не зовёт.
   */
  planned?: boolean
  /** Модель планировщика — для подписи карточки. */
  planner?: string
  /**
   * Инвентарь сцены (lib/scene-analysis) — тот же разбор, что в редакторе
   * рендера: материалы поверхностей и предметы. Уходит в промпт каждого кадра,
   * чтобы травертин на крупном плане не стал микроцементом; хранится, чтобы
   * «Повторить» не платил за разбор второй раз.
   */
  sceneInventory?: string
  generated?: string[]
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
