"use client"

import type { RestyleStyle } from "@/types"

/**
 * Локальный движок переноса стиля — ПРЕДПРОСМОТР, а не продукт.
 *
 * Настоящий перенос (та же геометрия помещения, но другая отделка, цвета и
 * мебель) — серверная image-to-image модель с контролем по глубине и краям,
 * см. README «Куда добавлять новый инструмент». Пока провайдера нет, движок
 * держит инструмент рабочим end-to-end: тональная «палитра» стиля canvas-
 * фильтрами, тонировка и виньетка. Геометрия и размер кадра не меняются.
 */

export type RestyleFamily = Exclude<RestyleStyle, "auto">

/**
 * Материал образца: рисуется фактурой (кирпич, доски, ёлочка, бетон, мрамор,
 * букле, сетка, лампа Эдисона…), а не плоским цветом — так стиль узнаётся сразу.
 * Рисунки — в components/tool/material-swatch.tsx.
 */
export type SwatchMaterial =
  | "plain"
  | "plaster"
  | "molding"
  | "brick"
  | "concrete"
  | "planks"
  | "herringbone"
  | "chevron"
  | "checker"
  | "marble"
  | "stone"
  | "slate"
  | "cobble"
  | "terrazzo"
  | "tile"
  | "terracotta"
  | "mosaic"
  | "ceramic"
  | "linen"
  | "jute"
  | "velvet"
  | "silk"
  | "boucle"
  | "fur"
  | "leather"
  | "rattan"
  | "cane"
  | "rope"
  | "macrame"
  | "gingham"
  | "lace"
  | "floral"
  | "wallpaper"
  | "rug"
  | "metal"
  | "iron"
  | "pipe"
  | "mesh"
  | "rust"
  | "glass"
  | "mirror"
  | "lacquer"
  | "bulb"
  | "neon"
  | "bamboo"
  | "paper"
  | "shoji"
  | "tatami"
  | "cork"
  | "moss"

export interface StyleSwatch {
  material: SwatchMaterial
  color: string
  /** Подпись: «кирпич», «дуб», «латунь» — она же уходит в исключения. */
  name: string
}

/** Стиль в каталоге: подпись, чем узнаётся, материалы и слова для «авто». */
export interface StyleInfo {
  value: RestyleFamily
  label: string
  /** Короткая характеристика: материалы, цвета, настроение. */
  hint: string
  /**
   * Из чего стиль собирают на практике: стены, пол, конструкции, мебель,
   * текстиль, свет, декор. Первые четыре — самые узнаваемые, они видны в
   * списке; все — в секции над композером с галочками.
   */
  swatches: StyleSwatch[]
  keywords: RegExp
  /**
   * Фото-пример стиля для превью при наведении (путь из /public). Пока не
   * задано — превью рисует сцену стиля (style-scenes.tsx). Сюда кладут
   * собственные фото: у стоковых картинок лицензии, в продукт их не вшиваем.
   */
  photo?: string
}

const sw = (material: SwatchMaterial, color: string, name: string): StyleSwatch => ({ material, color, name })

/**
 * Каталог популярных стилей — список рядом со сценой «Перенос стиля». Порядок —
 * по частоте запросов у дизайнеров интерьера. Материалы подобраны по тому, из
 * чего стиль собирают на практике, от стен и пола до света и декора.
 */
export const STYLES: StyleInfo[] = [
  {
    value: "scandi",
    label: "Скандинавский",
    hint: "белые стены, светлое дерево, серый текстиль, чёрные акценты",
    swatches: [
      sw("plaster", "#f4f1ea", "белая штукатурка"),
      sw("planks", "#dcc6a2", "светлый дуб"),
      sw("linen", "#b9bfc3", "серая шерсть"),
      sw("plain", "#26262a", "чёрный металл"),
      sw("plain", "#e2e2df", "светло-серая краска"),
      sw("planks", "#e5d8bf", "деревянная рейка"),
      sw("planks", "#ece2cf", "белёная сосна"),
      sw("herringbone", "#dcc6a2", "ёлочка из дуба"),
      sw("planks", "#d8c4a0", "ясень"),
      sw("boucle", "#e9e4da", "букле"),
      sw("linen", "#d9d2c4", "натуральный лён"),
      sw("fur", "#efe8dc", "овчина"),
      sw("rattan", "#cdb58a", "плетение"),
      sw("ceramic", "#cfc9bd", "матовая керамика"),
      sw("moss", "#6f8f6a", "зелень"),
    ],
    keywords: /сканди|скандинав|scandi|nordic|хюгге|hygge/i,
  },
  {
    value: "neoclassic",
    label: "Неоклассика",
    hint: "молдинги, паркет ёлочкой, бархат, латунь, мрамор",
    swatches: [
      sw("molding", "#e9e0cf", "стены с молдингами"),
      sw("herringbone", "#8f6544", "паркет ёлочкой, орех"),
      sw("velvet", "#3b4864", "синий бархат"),
      sw("metal", "#c4a35a", "латунь"),
      sw("plaster", "#eae1d2", "венецианская штукатурка"),
      sw("wallpaper", "#dcd2c2", "обои с узором"),
      sw("marble", "#efeae3", "белый мрамор"),
      sw("marble", "#2b2d33", "чёрный мрамор"),
      sw("velvet", "#2a6b5a", "изумрудный бархат"),
      sw("metal", "#d4b26a", "золото"),
      sw("mirror", "#cfd8de", "зеркало"),
      sw("glass", "#dfe8ee", "хрусталь"),
      sw("silk", "#d9cdb8", "шёлк"),
      sw("rug", "#8a5e56", "ковёр с медальоном"),
      sw("leather", "#d9c9ae", "кремовая кожа"),
    ],
    keywords: /неокласс|классик|classic|ампир|барокко|лепнин|молдинг/i,
  },
  {
    value: "japandi",
    label: "Джапанди",
    hint: "тёплая штукатурка, ясень, лён, бумага, чёрное дерево",
    swatches: [
      sw("plaster", "#e6dccb", "тёплая штукатурка"),
      sw("planks", "#c9b596", "ясень"),
      sw("linen", "#8f8574", "лён, тауп"),
      sw("plain", "#2f2b27", "чёрное дерево"),
      sw("plaster", "#d3c3ab", "тадлакт"),
      sw("bamboo", "#d2b98a", "бамбук"),
      sw("paper", "#f3ecdd", "рисовая бумага"),
      sw("shoji", "#f5f0e4", "сёдзи"),
      sw("tatami", "#c9b98f", "татами"),
      sw("linen", "#d9d0c0", "хлопок"),
      sw("ceramic", "#6e6355", "керамика раку"),
      sw("jute", "#c2a97a", "джут"),
      sw("cobble", "#9a9186", "речной камень"),
      sw("plain", "#6b5340", "тёмное дерево"),
      sw("moss", "#7f8f6c", "бонсай, зелень"),
    ],
    keywords: /джапанди|japandi|япон|japan|дзен|zen/i,
  },
  {
    value: "loft",
    label: "Лофт",
    hint: "кирпич, бетон, кожа, чёрный металл, открытые трубы",
    swatches: [
      sw("brick", "#8d5a44", "красный кирпич"),
      sw("concrete", "#6d6a66", "бетон"),
      sw("leather", "#5e3f2c", "коричневая кожа"),
      sw("metal", "#2a2a2c", "чёрный металл"),
      sw("brick", "#d8cfc4", "белёный кирпич"),
      sw("plaster", "#8a8580", "серая штукатурка"),
      sw("concrete", "#5c5754", "наливной пол"),
      sw("planks", "#6b4a33", "состаренная доска"),
      sw("pipe", "#3a3835", "открытые трубы"),
      sw("planks", "#5a4634", "деревянные балки"),
      sw("mesh", "#4a4a4c", "металлическая сетка"),
      sw("rust", "#8a4b2e", "кортен, ржавчина"),
      sw("bulb", "#f5c96a", "лампы Эдисона"),
      sw("glass", "#8fa3b3", "стекло в чёрных рамах"),
      sw("rope", "#b59a6a", "канат"),
    ],
    keywords: /лофт|loft|индастр|industrial|кирпич|бетон/i,
  },
  {
    value: "minimal",
    label: "Минимализм",
    hint: "гладкие плоскости, микроцемент, белый, графит",
    swatches: [
      sw("plain", "#f4f4f2", "белая краска"),
      sw("concrete", "#d3d0ca", "светлый микроцемент"),
      sw("linen", "#9d9c98", "серая ткань"),
      sw("plain", "#202022", "графит"),
      sw("concrete", "#a9a7a2", "бетон"),
      sw("stone", "#c9c6c0", "керамогранит"),
      sw("glass", "#d6dde2", "стекло"),
      sw("lacquer", "#ececea", "матовый лак"),
      sw("planks", "#e3d9c6", "белёный дуб"),
      sw("metal", "#c9ccd0", "хром"),
      sw("plain", "#2b2b2d", "матовый чёрный металл"),
      sw("neon", "#ffffff", "скрытая подсветка"),
    ],
    keywords: /минимал|minimal|лаконич/i,
  },
  {
    value: "midcentury",
    label: "Мид-сенчури",
    hint: "орех, тик, горчица и бирюза, тонкие ножки",
    swatches: [
      sw("plain", "#efe6d4", "тёплый белый"),
      sw("planks", "#7b5236", "орех"),
      sw("linen", "#2f6f73", "бирюзовая ткань"),
      sw("plain", "#d9a441", "горчица"),
      sw("planks", "#9a6a3f", "тик"),
      sw("planks", "#6f4a30", "деревянные панели"),
      sw("terrazzo", "#e6dccb", "терраццо"),
      sw("velvet", "#c8663a", "оранжевый бархат"),
      sw("leather", "#a5642f", "кожа коньяк"),
      sw("rattan", "#c0a06a", "ротанг"),
      sw("metal", "#c9a55e", "латунь"),
      sw("glass", "#6f7a80", "дымчатое стекло"),
      sw("wallpaper", "#e9dcc4", "геометрические обои"),
      sw("rug", "#d9c6a0", "ковёр с ромбами"),
      sw("ceramic", "#3b7a83", "глазурованная керамика"),
    ],
    keywords: /мид[- ]?сенчури|mid[- ]?century|60-?х|шестидесят|ретро|retro/i,
  },
  {
    value: "boho",
    label: "Бохо",
    hint: "ротанг, макраме, терракота, ковры, растения",
    swatches: [
      sw("plaster", "#f1e4d0", "кремовая штукатурка"),
      sw("terracotta", "#c07a52", "терракотовая плитка"),
      sw("rattan", "#b7924f", "ротанг"),
      sw("floral", "#5f7a58", "зелень и узор"),
      sw("rattan", "#cfa96a", "плетёные корзины"),
      sw("macrame", "#e8d9c0", "макраме"),
      sw("jute", "#c2a97a", "джут"),
      sw("linen", "#ebdfc9", "лён"),
      sw("velvet", "#b8613d", "терракотовый бархат"),
      sw("rug", "#a8563a", "ковёр с узором"),
      sw("leather", "#8a5a3a", "кожа"),
      sw("moss", "#5f7a58", "растения"),
      sw("ceramic", "#b7794e", "глина"),
      sw("planks", "#a87b52", "дерево манго"),
      sw("macrame", "#d6c1a3", "бахрома, кисточки"),
      sw("metal", "#c9a55e", "латунь"),
    ],
    keywords: /бохо|boho|богем|ротанг|макраме/i,
  },
  {
    value: "artdeco",
    label: "Ар-деко",
    hint: "изумруд, чёрный мрамор, латунь, бархат, геометрия",
    swatches: [
      sw("velvet", "#1f4d40", "изумрудные стены"),
      sw("marble", "#23262b", "чёрный мрамор"),
      sw("velvet", "#2a6b5a", "бархат"),
      sw("metal", "#b08d57", "латунь"),
      sw("marble", "#e9e2d0", "белый мрамор"),
      sw("metal", "#d4b26a", "золото"),
      sw("velvet", "#6e2f3f", "бордовый бархат"),
      sw("mirror", "#d0d8dc", "зеркало"),
      sw("lacquer", "#1b1b1e", "чёрный лак"),
      sw("chevron", "#6f4a2e", "паркет шеврон"),
      sw("wallpaper", "#2e3a44", "обои с веером"),
      sw("glass", "#dfe8ee", "хрусталь"),
      sw("silk", "#cfb98a", "шёлк"),
      sw("rug", "#1a1c20", "ковёр с геометрией"),
      sw("leather", "#26262a", "чёрная кожа"),
    ],
    keywords: /ар[- ]?деко|art[- ]?deco|гэтсби|gatsby/i,
  },
  {
    value: "mediterranean",
    label: "Средиземноморский",
    hint: "белёные стены, терракота, азулежу, лён, синий",
    swatches: [
      sw("plaster", "#f7f2e8", "белёная штукатурка"),
      sw("terracotta", "#c9865a", "терракота"),
      sw("linen", "#d8c8a8", "натуральный лён"),
      sw("tile", "#3b6ea5", "синяя плитка азулежу"),
      sw("tile", "#4d8f8a", "зеллидж"),
      sw("mosaic", "#6fa3b8", "мозаика"),
      sw("planks", "#8a6a4a", "деревянные балки"),
      sw("rattan", "#cfa96a", "плетёные корзины"),
      sw("moss", "#7a9b76", "олива, зелень"),
      sw("planks", "#3b6ea5", "синие ставни"),
      sw("iron", "#2b2b2b", "ковка"),
      sw("ceramic", "#b7794e", "глина"),
      sw("stone", "#d9cfb8", "известняк"),
      sw("jute", "#c2a97a", "джут"),
      sw("linen", "#4a7cb0", "синий хлопок"),
    ],
    keywords: /средиземномор|mediterran|греч|тоскан|итальян|прибреж|coastal/i,
  },
  {
    value: "provence",
    label: "Прованс",
    hint: "выбеленное дерево, лаванда, цветочный текстиль",
    swatches: [
      sw("plain", "#f4efe4", "пастельные стены"),
      sw("planks", "#ded3bf", "выбеленные доски"),
      sw("linen", "#a9a2c8", "лавандовый лён"),
      sw("floral", "#8aa37b", "цветочный узор"),
      sw("plain", "#d9d3e6", "лавандовая краска"),
      sw("planks", "#cdbfa6", "светлые балки"),
      sw("gingham", "#b9c4d6", "клетка виши"),
      sw("lace", "#f4efe4", "кружево"),
      sw("iron", "#3a3a3a", "кованый металл"),
      sw("ceramic", "#dfe6ec", "керамика с росписью"),
      sw("rattan", "#cfa96a", "плетёные корзины"),
      sw("floral", "#8e7fb8", "лаванда"),
      sw("planks", "#cbb89a", "состаренное дерево"),
      sw("terracotta", "#cfa07a", "терракота"),
      sw("floral", "#efe4d4", "ситец"),
    ],
    keywords: /прованс|provence|шебби|shabby|кантри|country|францу/i,
  },
  {
    value: "wabisabi",
    label: "Ваби-саби",
    hint: "глиняная штукатурка, камень, лён, тёмное дерево",
    swatches: [
      sw("plaster", "#d9cbb6", "глиняная штукатурка"),
      sw("stone", "#a89880", "камень"),
      sw("linen", "#6e6355", "грубый лён"),
      sw("plain", "#3a342c", "тёмное дерево"),
      sw("stone", "#cbb9a0", "травертин"),
      sw("jute", "#b8a78d", "джут"),
      sw("planks", "#7a6650", "дерево с трещинами"),
      sw("ceramic", "#5a4f44", "керамика раку"),
      sw("concrete", "#8a8378", "грубый бетон"),
      sw("paper", "#e9e1d1", "бумага"),
      sw("plain", "#6b5340", "сухие ветки"),
      sw("moss", "#7f8f6c", "мох, растения"),
      sw("cork", "#b89b74", "пробка"),
      sw("linen", "#cbbfae", "шерсть"),
      sw("iron", "#2f2b27", "чугун"),
    ],
    keywords: /ваби|wabi|глин|штукатур|несовершен/i,
  },
  {
    value: "contemporary",
    label: "Контемпорари",
    hint: "крупный керамогранит, стекло, серая кожа, чистые линии",
    swatches: [
      sw("plain", "#ececea", "гладкие стены"),
      sw("stone", "#b5b0a8", "керамогранит"),
      sw("leather", "#5d6068", "серая кожа"),
      sw("glass", "#8fa3b3", "стекло и сталь"),
      sw("plain", "#5d6068", "тёмная акцентная стена"),
      sw("concrete", "#c9c6bf", "микроцемент"),
      sw("metal", "#c7ccd1", "сталь"),
      sw("plain", "#1f1f22", "матовый чёрный"),
      sw("boucle", "#d9d6cf", "букле"),
      sw("planks", "#6e4d34", "шпон ореха"),
      sw("lacquer", "#2b2f36", "глянцевый лак"),
      sw("marble", "#b9b6b0", "серый мрамор"),
      sw("linen", "#d9d6d0", "однотонный ковёр"),
      sw("neon", "#ffffff", "LED-подсветка"),
      sw("glass", "#55606a", "дымчатое стекло"),
    ],
    keywords: /контемпорари|contemporary|современн|modern|хай[- ]?тек|hi-?tech/i,
  },
]

export const STYLE_FAMILIES: RestyleFamily[] = STYLES.map((style) => style.value)

export const STYLE_LABEL: Record<RestyleStyle, string> = {
  auto: "Свой стиль",
  ...(Object.fromEntries(STYLES.map((style) => [style.value, style.label])) as Record<RestyleFamily, string>),
}

/**
 * «Авто» выводится из описания. Без узнаваемых слов семейство выбирается
 * устойчиво по тексту, чтобы «Повторить» дало тот же стиль; пустое описание
 * при «авто» — не задание, страница просит выбрать стиль.
 */
export function resolveStyle(style: RestyleStyle, note: string): RestyleFamily {
  if (style !== "auto") return style
  for (const info of STYLES) if (info.keywords.test(note)) return info.value
  let hash = 0
  for (const char of note) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return STYLE_FAMILIES[hash % STYLE_FAMILIES.length]
}

interface Grade {
  /** Глобальная тональная коррекция. */
  filter: string
  /** Тонировка поверх: цвет, режим наложения и сила. */
  tint: string
  blend: GlobalCompositeOperation
  tintAlpha: number
  /** Сила виньетки по краям (0 — нет). */
  vignette: number
}

/* Тональные палитры семейств: светлый холодный север, тёплая контрастная
   неоклассика, приглушённый джапанди, тёмный лофт, белёсый минимализм и
   далее по каталогу — у каждого свой оттенок, контраст и виньетка. */
const GRADE: Record<RestyleFamily, Grade> = {
  scandi: {
    filter: "brightness(1.08) saturate(0.82) contrast(0.96)",
    tint: "rgb(214, 226, 236)",
    blend: "soft-light",
    tintAlpha: 0.32,
    vignette: 0,
  },
  neoclassic: {
    filter: "brightness(1.02) saturate(1.06) contrast(1.08) sepia(0.14)",
    tint: "rgb(198, 160, 104)",
    blend: "soft-light",
    tintAlpha: 0.3,
    vignette: 0.28,
  },
  japandi: {
    filter: "brightness(1.03) saturate(0.7) contrast(0.93)",
    tint: "rgb(204, 184, 156)",
    blend: "multiply",
    tintAlpha: 0.22,
    vignette: 0.12,
  },
  loft: {
    filter: "brightness(0.9) saturate(0.8) contrast(1.16)",
    tint: "rgb(96, 72, 56)",
    blend: "soft-light",
    tintAlpha: 0.42,
    vignette: 0.4,
  },
  minimal: {
    filter: "brightness(1.1) saturate(0.58) contrast(0.98)",
    tint: "rgb(240, 240, 238)",
    blend: "screen",
    tintAlpha: 0.14,
    vignette: 0,
  },
  midcentury: {
    filter: "saturate(1.12) contrast(1.06) sepia(0.1)",
    tint: "rgb(200, 140, 90)",
    blend: "soft-light",
    tintAlpha: 0.28,
    vignette: 0.18,
  },
  boho: {
    filter: "saturate(1.15) brightness(1.02) sepia(0.2)",
    tint: "rgb(196, 120, 80)",
    blend: "soft-light",
    tintAlpha: 0.34,
    vignette: 0.2,
  },
  artdeco: {
    filter: "contrast(1.18) saturate(0.9) brightness(0.92)",
    tint: "rgb(160, 130, 70)",
    blend: "soft-light",
    tintAlpha: 0.4,
    vignette: 0.42,
  },
  mediterranean: {
    filter: "brightness(1.08) saturate(1.1)",
    tint: "rgb(120, 170, 200)",
    blend: "soft-light",
    tintAlpha: 0.26,
    vignette: 0.05,
  },
  provence: {
    filter: "brightness(1.08) saturate(0.85) sepia(0.12)",
    tint: "rgb(210, 190, 210)",
    blend: "soft-light",
    tintAlpha: 0.3,
    vignette: 0.08,
  },
  wabisabi: {
    filter: "saturate(0.55) contrast(0.9) brightness(0.98)",
    tint: "rgb(150, 135, 115)",
    blend: "multiply",
    tintAlpha: 0.24,
    vignette: 0.2,
  },
  contemporary: {
    filter: "contrast(1.08) saturate(0.9)",
    tint: "rgb(200, 200, 205)",
    blend: "soft-light",
    tintAlpha: 0.2,
    vignette: 0.12,
  },
}

export interface RestyleResult {
  blob: Blob
  width: number
  height: number
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Браузер не смог закодировать результат"))),
      type,
      quality
    )
  })
}

export async function restyleLocally(source: Blob, family: RestyleFamily): Promise<RestyleResult> {
  const bitmap = await createImageBitmap(source)
  try {
    const { width, height } = bitmap
    const grade = GRADE[family]

    const canvas = document.createElement("canvas")
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas 2D недоступен")
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = "high"

    // Safari до 18 игнорирует ctx.filter — там остаются тонировка и виньетка.
    ctx.filter = grade.filter
    ctx.drawImage(bitmap, 0, 0, width, height)
    ctx.filter = "none"

    ctx.save()
    ctx.globalCompositeOperation = grade.blend
    ctx.globalAlpha = grade.tintAlpha
    ctx.fillStyle = grade.tint
    ctx.fillRect(0, 0, width, height)
    ctx.restore()

    if (grade.vignette > 0) {
      const radius = Math.hypot(width, height) / 2
      const gradient = ctx.createRadialGradient(width / 2, height / 2, radius * 0.45, width / 2, height / 2, radius)
      gradient.addColorStop(0, "rgba(0, 0, 0, 0)")
      gradient.addColorStop(1, `rgba(0, 0, 0, ${grade.vignette})`)
      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, width, height)
    }

    const type = source.type === "image/png" ? "image/png" : "image/jpeg"
    const blob = await toBlob(canvas, type, type === "image/jpeg" ? 0.95 : undefined)
    return { blob, width, height }
  } finally {
    bitmap.close()
  }
}
