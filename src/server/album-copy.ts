import "server-only"

import { prepareSceneImage } from "@/server/scene-inventory"
import type { VisionImage, VisionProvider } from "@/server/vision-provider"
import { albumImageKeys, type AlbumCopy, type AlbumSpec } from "@/shared/album"

/**
 * Тексты альбома от ИИ: подзаголовок обложки, абзац концепции, вступление к
 * материалам и подписи к картинкам. Модель — та же чат-модель, что разбирает
 * сцену (`vision-provider.ts`), с обложкой в запросе, если она есть: подписи
 * должны опираться на реальный рендер, а не на общие слова о стиле.
 *
 * Вход — спецификация альбома (подписи-заготовки, стиль, состав) и «факты»
 * по ключам картинок: комментарий из композера, направление стиля, задание
 * кадра, инвентарь сцены. Ответ — JSON по контракту `AlbumCopy`; всё, чего
 * модель не написала, остаётся пустым и в PDF подставятся подписи-заготовки.
 */

export const ALBUM_FACT_MAX_CHARS = 1500
const SUBTITLE_MAX = 100
const CONCEPT_MAX = 500
const INTRO_MAX = 300
const CAPTION_MAX = 120
const COPY_DEADLINE_MS = 100_000
const MIN_ATTEMPT_MS = 20_000
/**
 * Бюджет ответа растёт с числом подписей: у альбома на 40 картинок один JSON
 * — это ~2500 токенов текста, а базовый бюджет модели рассчитан на инвентарь
 * сцены. Сверх базового — по ~70 токенов на подпись, но не выше потолка.
 */
const TOKENS_PER_CAPTION = 70
const MAX_OUTPUT_TOKENS = 12_000
/** Картинка обложки для модели: ей хватает 1024 px, а запрос легче. */
const COVER_MAX_SIDE = 1024

export interface AlbumCopyRequest {
  spec: AlbumSpec
  facts: Record<string, string>
}

export function buildAlbumCopyPrompt({ spec, facts }: AlbumCopyRequest): string {
  const fact = (key: string) => (facts[key] ?? "").slice(0, ALBUM_FACT_MAX_CHARS).trim()
  const lines: string[] = []
  for (const item of spec.overview) {
    lines.push(`- ${item.key} | общий план: ${item.title}${fact(item.key) ? ` | ${fact(item.key)}` : ""}`)
  }
  for (const set of spec.viewSets) {
    for (const frame of set.frames) {
      lines.push(`- ${frame.key} | кадр из сета «${set.title}»: ${frame.label}${fact(frame.key) ? ` | ${fact(frame.key)}` : ""}`)
    }
  }
  for (const material of spec.materials) {
    lines.push(`- ${material.key} | материал: ${material.name}${material.category ? ` (${material.category})` : ""}${fact(material.key) ? ` | ${fact(material.key)}` : ""}`)
  }
  const concept = spec.concept
  return [
    "Ты — арт-директор студии интерьера. Студия собирает клиенту альбом-презентацию из рендеров, и тебе нужно написать к нему тексты. Пиши по-русски, спокойно и предметно: про материалы, свет, цвет и планировку, без рекламных штампов («уникальный», «идеальный», «воплощение мечты»), без восклицаний и без обращения к читателю.",
    `ПРОЕКТ: «${spec.title || "Интерьер"}»${spec.studio.name ? `, студия «${spec.studio.name}»` : ""}.`,
    concept ? `СТИЛЬ: ${concept.styleLabel}${concept.variantLabel ? `, направление «${concept.variantLabel}»` : ""}${concept.swatches.length ? `. Материалы стиля: ${concept.swatches.map((s) => s.name).join(", ")}` : ""}.` : "",
    spec.coverKey && fact(spec.coverKey) ? `ОБЛОЖКА (${spec.coverKey}): ${fact(spec.coverKey)}` : "",
    spec.coverKey ? "К письму приложена картинка обложки — опирайся на то, что на ней действительно видно." : "",
    lines.length ? `ЭЛЕМЕНТЫ АЛЬБОМА (ключ | что это | известные факты):\n${lines.join("\n")}` : "",
    "Верни СТРОГО один JSON-объект без пояснений и без markdown:",
    `{"subtitle": "подзаголовок обложки, до ${SUBTITLE_MAX} символов — суть проекта одной фразой", "concept": "2–3 предложения о концепции: стиль, ключевые материалы, свет и настроение, до ${CONCEPT_MAX} символов", "materialsIntro": "1–2 предложения о подборе материалов, до ${INTRO_MAX} символов (пустая строка, если материалов нет)", "captions": {"<ключ>": "подпись до ${CAPTION_MAX} символов"}}`,
    "В captions — по одной подписи на КАЖДЫЙ ключ из списка элементов, ключ копируй дословно. Подпись описывает именно этот элемент по его фактам (что в кадре, какой материал, какая точка съёмки); не выдумывай предметы, которых в фактах нет. Для материалов подпись — короткое название материала как в спецификации дизайнера (например «Дуб натуральный, матовый лак»). Подписи короткие, без вступлений; JSON пиши компактно, без переносов строк внутри значений.",
  ]
    .filter(Boolean)
    .join("\n\n")
}

const clean = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "")

/** Строка JSON → текст: снимает кавычки и простые экранирования. */
function unescapeJson(raw: string): string {
  try {
    return JSON.parse(`"${raw}"`) as string
  } catch {
    return raw.replace(/\\"/g, '"').replace(/\\n/g, " ")
  }
}

/**
 * Разбор оборванного ответа: модель упёрлась в лимит токенов посреди
 * `captions`, и целого JSON нет. Поля верхнего уровня и все дописанные пары
 * «ключ: подпись» вытаскиваются регулярными выражениями — лучше альбом с
 * частью подписей, чем без текстов вовсе.
 */
function salvageAlbumCopy(text: string, allowed: Set<string>): AlbumCopy {
  const field = (name: string) => {
    const match = new RegExp(`"${name}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`).exec(text)
    return match ? unescapeJson(match[1]) : ""
  }
  const captions: Record<string, string> = {}
  const pair = /"([A-Za-z0-9_-]+:[a-z0-9-]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g
  for (const match of text.matchAll(pair)) {
    const caption = clean(unescapeJson(match[2]), CAPTION_MAX)
    if (allowed.has(match[1]) && caption) captions[match[1]] = caption
  }
  return {
    subtitle: clean(field("subtitle"), SUBTITLE_MAX),
    concept: clean(field("concept"), CONCEPT_MAX),
    materialsIntro: clean(field("materialsIntro"), INTRO_MAX),
    captions,
  }
}

/**
 * JSON из ответа модели: с обрезкой «```json» и лишнего текста вокруг,
 * мягкими лимитами и спасением оборванного ответа (`salvageAlbumCopy`).
 */
export function parseAlbumCopy(text: string, spec: AlbumSpec): AlbumCopy {
  const allowed = new Set(albumImageKeys(spec))
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  let parsed: Record<string, unknown> | null = null
  if (start >= 0 && end > start) {
    try {
      parsed = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
    } catch {
      parsed = null
    }
  }
  if (!parsed) return salvageAlbumCopy(text, allowed)
  const captions: Record<string, string> = {}
  const rawCaptions = parsed.captions && typeof parsed.captions === "object" ? (parsed.captions as Record<string, unknown>) : {}
  for (const [key, value] of Object.entries(rawCaptions)) {
    const caption = clean(value, CAPTION_MAX)
    if (allowed.has(key) && caption) captions[key] = caption
  }
  return {
    subtitle: clean(parsed.subtitle, SUBTITLE_MAX),
    concept: clean(parsed.concept, CONCEPT_MAX),
    materialsIntro: clean(parsed.materialsIntro, INTRO_MAX),
    captions,
  }
}

/** Ответ считается пустым, когда модель не дала ни одного полезного поля. */
export function isEmptyCopy(copy: AlbumCopy): boolean {
  return !copy.subtitle && !copy.concept && !copy.materialsIntro && Object.keys(copy.captions).length === 0
}

export interface AlbumCopyResult {
  copy: AlbumCopy
  provider: string
  model: string
  durationMs: number
}

/**
 * Тексты по цепочке провайдеров, как у разбора сцены: первый удачный —
 * результат. Пустой JSON (модель не справилась с форматом) — тоже отказ,
 * пробуем следующего.
 */
export async function writeAlbumCopy(
  providers: VisionProvider[],
  request: AlbumCopyRequest,
  cover: { bytes: Uint8Array } | null,
  signal?: AbortSignal
): Promise<AlbumCopyResult> {
  if (providers.length === 0) throw new Error("Нет модели для текстов альбома")
  const startedAt = Date.now()
  const image: VisionImage | undefined = cover ? await prepareSceneImage(cover.bytes, COVER_MAX_SIDE) : undefined
  const prompt = buildAlbumCopyPrompt(request)
  const captionCount = albumImageKeys(request.spec).length

  let lastError: unknown = null
  for (const [index, provider] of providers.entries()) {
    const remaining = COPY_DEADLINE_MS - (Date.now() - startedAt)
    if (index > 0 && remaining < MIN_ATTEMPT_MS) break
    try {
      const answer = await provider.describe({
        prompt,
        image,
        maxTokens: Math.min(MAX_OUTPUT_TOKENS, provider.outputBudget + captionCount * TOKENS_PER_CAPTION),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(remaining)]) : AbortSignal.timeout(remaining),
      })
      const copy = parseAlbumCopy(answer.text, request.spec)
      if (isEmptyCopy(copy)) {
        console.warn(`[album-copy] ${provider.model}: ответ без JSON (${answer.text.length} символов${answer.truncated ? ", обрезан по max_tokens" : ""}): ${answer.text.slice(0, 300).replace(/\s+/g, " ")}`)
        throw new Error(`${provider.model} вернул ответ без JSON`)
      }
      if (answer.truncated) {
        console.warn(`[album-copy] ${provider.model}: ответ обрезан по max_tokens, подписей спасено ${Object.keys(copy.captions).length} из ${captionCount}`)
      }
      return { copy, provider: answer.provider, model: answer.model, durationMs: Date.now() - startedAt }
    } catch (error) {
      lastError = error
      if (signal?.aborted) break
      if (index < providers.length - 1) {
        console.warn(`[album-copy] ${provider.id} ${provider.model} отказал (${(error instanceof Error ? error.message : String(error)).slice(0, 200)}), пробуем следующий`)
      }
    }
  }
  throw lastError ?? new Error("Тексты альбома не написались")
}
