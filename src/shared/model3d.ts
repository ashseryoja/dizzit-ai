/**
 * Контракт «Фото → 3D» — один на клиент и сервер: какие настройки генерации
 * есть, что умеет каждая модель Meshy и сколько это стоит. Панель генерации
 * (`components/tool/model-dock.tsx`) рисует по нему контролы, сервер
 * (`src/server/meshy.ts`) собирает по нему тело задачи — расхождений между
 * «что выбрал пользователь» и «что ушло провайдеру» быть не может.
 *
 * Возможности и цены сверены с рабочим экраном Meshy (сентябрь 2026):
 * мульти-вид и «Ультра» есть только у флагмана, у Lite нет текстуры вовсе.
 */

export type ModelAi = "meshy-7" | "meshy-6" | "meshy-6-lite"
export type ModelQuality = "standard" | "ultra"
/** Дополнительные ракурсы предмета; главный вид — само фото записи. */
export type ModelViewRole = "left" | "back" | "right"
export type ModelSlot = "main" | ModelViewRole
/** Какой эндпоинт Meshy считает задачу: одно фото или несколько ракурсов. */
export type ModelTaskKind = "image" | "multi"

export interface ModelSettings {
  ai: ModelAi
  quality: ModelQuality
  /** С материалом (текстура по фото) или голая геометрия. */
  texture: boolean
  /** PBR-карты (metallic / roughness / normal) поверх цвета — для рендер-движков. */
  pbr: boolean
  /** Meshy сам подчищает фото перед реконструкцией. */
  enhance: boolean
}

/** Кредиты Meshy за разбиение готовой модели на детали (Auto Split). */
export const SPLIT_CREDITS = 10

/** Класс материала детали — по нему подбираются имя объекта и бесшовная текстура. */
export type ModelMaterialClass = "fabric" | "leather" | "metal" | "wood"

/** Деталь собранной модели: отдельный объект в GLB/FBX/OBJ со своим материалом. */
export interface ModelPart {
  object: string
  material: string
  cls: ModelMaterialClass
  faces: number
}

/** Этап задачи «Фото → 3D»: сама модель у Meshy, потом разбиение на детали. */
export type ModelStage = "model" | "parts"

export const MODEL_CLASS_LABEL: Record<ModelMaterialClass, string> = { fabric: "ткань", leather: "кожа", metal: "металл", wood: "дерево" }

/**
 * Разбиение на детали нужно каждой модели с текстурой: по атласу определяется
 * класс материала каждой детали. Голая геометрия (Lite) остаётся цельной.
 */
export function modelSplitEnabled(settings: ModelSettings): boolean {
  return settings.texture
}

export interface ModelAiInfo {
  value: ModelAi
  label: string
  hint: string
  multiView: boolean
  ultra: boolean
  texture: boolean
  enhance: boolean
}

export const MODEL_AI: readonly ModelAiInfo[] = [
  { value: "meshy-7", label: "Meshy 7", hint: "Флагман: максимум деталей и точности", multiView: true, ultra: true, texture: true, enhance: true },
  { value: "meshy-6", label: "Meshy 6", hint: "Качественно, устойчивая форма", multiView: false, ultra: false, texture: true, enhance: true },
  { value: "meshy-6-lite", label: "Meshy 6 Lite", hint: "Быстрый черновик: только геометрия", multiView: false, ultra: false, texture: false, enhance: false },
]

export const MODEL_VIEW_ROLES: readonly ModelViewRole[] = ["left", "back", "right"]
export const MODEL_SLOT_LABEL: Record<ModelSlot, string> = {
  main: "Главный вид",
  left: "Слева",
  back: "Сзади",
  right: "Справа",
}
export const MODEL_MAX_PHOTOS = 1 + MODEL_VIEW_ROLES.length

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  ai: "meshy-7",
  quality: "standard",
  texture: true,
  pbr: false,
  enhance: true,
}

export function modelAiInfo(ai: ModelAi): ModelAiInfo {
  return MODEL_AI.find((item) => item.value === ai) ?? MODEL_AI[0]
}

/** Настройки, приведённые к возможностям выбранной модели. Вход — что угодно (JSON из запроса, старая запись). */
export function normalizeModelSettings(input: unknown): ModelSettings {
  const raw = (input && typeof input === "object" ? input : {}) as Partial<Record<keyof ModelSettings, unknown>>
  const ai = MODEL_AI.some((item) => item.value === raw.ai) ? (raw.ai as ModelAi) : DEFAULT_MODEL_SETTINGS.ai
  const info = modelAiInfo(ai)
  const texture = info.texture && (raw.texture === undefined ? DEFAULT_MODEL_SETTINGS.texture : Boolean(raw.texture))
  return {
    ai,
    quality: info.ultra && raw.quality === "ultra" ? "ultra" : "standard",
    texture,
    pbr: texture && Boolean(raw.pbr),
    enhance: info.enhance && (raw.enhance === undefined ? DEFAULT_MODEL_SETTINGS.enhance : Boolean(raw.enhance)),
  }
}

/** Сколько фото примет задача с такими настройками. */
export function modelMaxPhotos(settings: ModelSettings): number {
  return modelAiInfo(settings.ai).multiView ? MODEL_MAX_PHOTOS : 1
}

/** Треугольников после ремеша: «Ультра» незачем ужимать до черновой сетки. */
export function modelPolycount(settings: ModelSettings): number {
  return settings.quality === "ultra" ? 150_000 : 50_000
}

/** Оценка до запуска — как строка «время · кредиты» над кнопкой у Meshy. Точная сумма приходит с задачей. */
export function estimateModelCost(settings: ModelSettings): { credits: number; minutes: number } {
  // Через API Lite стоит 5 кредитов (проверено живой задачей), хотя на сайте Meshy показывает 10.
  if (settings.ai === "meshy-6-lite") return { credits: 5, minutes: 1 }
  const credits = 20 + (settings.texture ? 10 : 0) + (settings.quality === "ultra" ? 5 : 0) + (modelSplitEnabled(settings) ? SPLIT_CREDITS : 0)
  return { credits, minutes: settings.texture ? 3 : 1 }
}

/** Короткая сводка настроек: свёрнутая панель и подпись под моделью. */
export function describeModelSettings(settings: ModelSettings): string {
  const parts = [modelAiInfo(settings.ai).label]
  if (settings.quality === "ultra") parts.push("ультра")
  parts.push(settings.texture ? (settings.pbr ? "текстура + PBR" : "с текстурой") : "без текстуры")
  if (modelSplitEnabled(settings)) parts.push("детали")
  return parts.join(" · ")
}
