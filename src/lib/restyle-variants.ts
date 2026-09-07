"use client"

import type { RestyleStyle } from "@/types"

type RestyleFamily = Exclude<RestyleStyle, "auto">

/**
 * Направления внутри стиля — чтобы один и тот же стиль каждый раз получался
 * по-разному. Без них модель на список из пятнадцати материалов отвечает
 * самым узнаваемым штампом (мид-сенчури = орех + бирюза + горчица, всегда).
 *
 * Направление — конкретный бриф: стены, пол, мебель, обивка, акценты, свет.
 * Материалы направления — имена образцов из каталога стиля (`STYLES` в
 * restyle-engine), поэтому снятые галочкой материалы учитываются: направление,
 * которое на них держится, при выборе уходит в конец очереди.
 *
 * Выбор направления — `pickVariant`: случайно, но не то, что было у последних
 * переносов этого стиля в проекте, и не то, чьи материалы исключены. Выбранное
 * хранится в записи (`Restyle.variant`), «Повторить» и подпись карточки
 * работают с ним же.
 */
export interface StyleVariant {
  id: string
  /** Подпись для карточки: «тик и олива». */
  label: string
  /** Бриф для модели: стены, пол, мебель, текстиль, акценты, свет. */
  brief: string
  /** Материалы каталога стиля, на которых держится направление. */
  materials: string[]
  /**
   * Материалы каталога, которые спорят с направлением (бирюза у «тик и
   * олива»): вспомогательными к нему не добавляются.
   */
  avoid: string[]
}

const variant = (id: string, label: string, brief: string, materials: string[], avoid: string[] = []): StyleVariant => ({
  id,
  label,
  brief,
  materials,
  avoid,
})

export const STYLE_VARIANTS: Record<RestyleFamily, StyleVariant[]> = {
  scandi: [
    variant(
      "white-oak",
      "белый и светлый дуб",
      "Walls: pure white plaster. Floor: wide light oak planks. Furniture: light oak with simple rounded forms. Upholstery: light grey wool. Accents: black metal lamp arms and picture frames, matte white ceramics, a sheepskin throw and one large green plant. Lighting: a black metal pendant.",
      ["белая штукатурка", "светлый дуб", "серая шерсть", "чёрный металл", "овчина", "матовая керамика", "зелень"]
    ),
    variant(
      "warm-nordic",
      "тёплый север: ясень, лён, букле",
      "Walls: warm off-white. Floor: pale ash, laid in herringbone where there is parquet. Furniture: ash with woven cane fronts. Upholstery: oatmeal linen and cream bouclé, no black anywhere. Accents: woven baskets, a beige wool rug, sheepskin. Lighting: a paper lantern pendant. Soft, warm and quiet.",
      ["ясень", "ёлочка из дуба", "натуральный лён", "букле", "плетение", "овчина"],
      ["чёрный металл"]
    ),
    variant(
      "slats",
      "рейка и белёная сосна",
      "Walls: one wall of vertical pale-pine wood slats, the rest white. Floor: whitewashed pine boards. Upholstery: dusty-blue linen with grey wool cushions. Accents: thin black metal, matte ceramics. Lighting: a black spot rail and a small pendant.",
      ["деревянная рейка", "белёная сосна", "пыльно-голубой лён", "серая шерсть", "чёрный металл", "матовая керамика"]
    ),
    variant(
      "grey",
      "серая скандинавия",
      "Walls: light grey paint. Floor: grey-washed light oak. Upholstery: a charcoal wool sofa with a white bouclé armchair. Accents: black steel, concrete-grey ceramics, a single plant. Lighting: black metal fixtures. Calm monochrome.",
      ["светло-серая краска", "светлый дуб", "серая шерсть", "букле", "чёрный металл", "матовая керамика", "зелень"]
    ),
  ],
  neoclassic: [
    variant(
      "navy-brass",
      "синий бархат и латунь",
      "Walls: cream with white painted mouldings and panelling. Floor: walnut herringbone parquet. Upholstery: navy blue velvet. Accents: brass sconces and hardware, white marble table tops, a medallion rug. Lighting: a brass chandelier.",
      ["стены с молдингами", "паркет ёлочкой, орех", "синий бархат", "латунь", "белый мрамор", "ковёр с медальоном"],
      ["изумрудный бархат", "пыльно-розовый бархат"]
    ),
    variant(
      "emerald-black",
      "изумруд и чёрный мрамор",
      "Walls: ivory Venetian plaster framed by mouldings. Floor: walnut herringbone. Upholstery: emerald green velvet. Accents: black marble tops and fireplace, gold details, silk curtains. Lighting: a crystal chandelier.",
      ["венецианская штукатурка", "стены с молдингами", "паркет ёлочкой, орех", "изумрудный бархат", "чёрный мрамор", "золото", "хрусталь", "шёлк"],
      ["синий бархат", "пыльно-розовый бархат"]
    ),
    variant(
      "parisian",
      "светлая парижская классика",
      "Walls: pale grey-white panelling with mouldings and a tall mirror. Floor: pale oak herringbone. Upholstery: cream leather and ivory silk. Accents: crystal, minimal brass, white marble. Lighting: a crystal chandelier and white plaster lamps. An airy Parisian apartment.",
      ["стены с молдингами", "светлый дуб ёлочкой", "кремовая кожа", "шёлк", "зеркало", "хрусталь", "белый мрамор"],
      ["синий бархат", "изумрудный бархат", "чёрный мрамор", "паркет ёлочкой, орех", "обои с узором"]
    ),
    variant(
      "rose-wallpaper",
      "обои и пыльная роза",
      "Walls: patterned damask wallpaper above panelling on the main wall, soft beige elsewhere. Floor: walnut herringbone with a medallion rug. Upholstery: dusty-rose velvet. Accents: brass, white marble, mirror. Lighting: brass sconces.",
      ["обои с узором", "стены с молдингами", "паркет ёлочкой, орех", "ковёр с медальоном", "пыльно-розовый бархат", "латунь", "зеркало"],
      ["синий бархат", "изумрудный бархат"]
    ),
  ],
  japandi: [
    variant(
      "warm-ash",
      "тёплая штукатурка и ясень",
      "Walls: warm sand-coloured plaster. Floor: pale ash. Furniture: low ash pieces. Textiles: taupe linen. Accents: black stained wood details, raku ceramics, one bonsai. Lighting: a paper lantern.",
      ["тёплая штукатурка", "ясень", "лён, тауп", "чёрное дерево", "керамика раку", "бонсай, зелень"]
    ),
    variant(
      "dark-paper",
      "тёмное дерево и бумага",
      "Walls: off-white with a rice-paper texture and a shoji-style screen element. Floor: dark stained wood. Furniture: dark wood frames. Textiles: undyed cotton. Accents: black ceramics, a tatami-textured rug. Lighting: a paper pendant.",
      ["рисовая бумага", "сёдзи", "тёмное дерево", "хлопок", "татами", "керамика раку"]
    ),
    variant(
      "tadelakt",
      "тадлакт и джут",
      "Walls: smooth greige tadelakt plaster. Floor: wide light wood. Textiles: oatmeal cotton and linen. Accents: a jute rug, river stones, bamboo, a single green plant. Lighting: warm concealed light. Spa-like calm.",
      ["тадлакт", "ясень", "хлопок", "джут", "речной камень", "бамбук", "бонсай, зелень"]
    ),
    variant(
      "bamboo",
      "бамбук и зелень",
      "Walls: pale plaster with bamboo slat screens or panels. Floor: ash. Textiles: moss-green linen accents over natural linen. Accents: raku ceramics, dark wood, plants. Lighting: a paper lantern.",
      ["тёплая штукатурка", "бамбук", "ясень", "лён, тауп", "керамика раку", "тёмное дерево", "бонсай, зелень"]
    ),
  ],
  loft: [
    variant(
      "red-brick",
      "красный кирпич и кожа",
      "Walls: an exposed red brick feature wall, grey plaster elsewhere. Floor: polished concrete. Upholstery: cognac brown leather. Accents: black steel frames, exposed pipes and ducts. Lighting: Edison bulb pendants.",
      ["красный кирпич", "серая штукатурка", "бетон", "коричневая кожа", "чёрный металл", "открытые трубы", "лампы Эдисона"],
      ["белёный кирпич"]
    ),
    variant(
      "white-brick",
      "белёный кирпич и бетон",
      "Walls: whitewashed brick and grey plaster. Floor: poured concrete. Upholstery: grey fabric with black leather details. Accents: black metal and glass partitions. Lighting: black steel track lights. A bright industrial space.",
      ["белёный кирпич", "серая штукатурка", "наливной пол", "чёрный металл", "стекло в чёрных рамах"],
      ["красный кирпич", "кортен, ржавчина"]
    ),
    variant(
      "timber",
      "балки и состаренная доска",
      "Walls: brick on one wall, warm grey plaster on the rest. Floor: aged wide wood planks. Ceiling: timber beams. Upholstery: brown leather. Accents: rope details, corten steel, black metal. Lighting: Edison bulbs on black cord.",
      ["красный кирпич", "состаренная доска", "деревянные балки", "коричневая кожа", "канат", "кортен, ржавчина", "лампы Эдисона"],
      ["белёный кирпич"]
    ),
    variant(
      "dark",
      "тёмный индастриал",
      "Walls: dark grey concrete. Floor: dark poured concrete. Upholstery: black leather. Accents: black metal mesh, corten steel, glass in black frames. Lighting: black industrial pendants. Moody and dramatic.",
      ["бетон", "наливной пол", "чёрный металл", "металлическая сетка", "кортен, ржавчина", "стекло в чёрных рамах"],
      ["белёный кирпич", "красный кирпич"]
    ),
  ],
  minimal: [
    variant(
      "white",
      "белый и микроцемент",
      "Walls: white paint. Floor: light microcement. Upholstery: off-white fabric. Cabinets: matte lacquer without visible handles. Lighting: concealed LED strips. Nothing decorative, only pure planes.",
      ["белая краска", "светлый микроцемент", "матовый лак", "скрытая подсветка"],
      ["графит", "бетон", "матовый чёрный металл"]
    ),
    variant(
      "graphite",
      "графит и стекло",
      "Walls: white with one graphite wall. Floor: dark grey porcelain stoneware. Upholstery: grey fabric. Accents: glass, matte black metal. Lighting: concealed light and thin black profiles.",
      ["белая краска", "графит", "керамогранит", "серая ткань", "стекло", "матовый чёрный металл", "скрытая подсветка"],
      ["белёный дуб", "бежевая ткань"]
    ),
    variant(
      "warm-oak",
      "белёный дуб и беж",
      "Walls: white. Floor: whitewashed oak. Upholstery: beige fabric. Cabinets: warm white matte lacquer. Accents: chrome details. Lighting: concealed warm light.",
      ["белая краска", "белёный дуб", "бежевая ткань", "матовый лак", "хром", "скрытая подсветка"],
      ["графит", "бетон", "матовый чёрный металл"]
    ),
    variant(
      "concrete",
      "бетон и хром",
      "Walls: a concrete finish. Floor: large-format grey porcelain. Upholstery: grey fabric. Accents: chrome and glass. Lighting: concealed cool light.",
      ["бетон", "керамогранит", "серая ткань", "хром", "стекло", "скрытая подсветка"],
      ["белёный дуб", "бежевая ткань"]
    ),
  ],
  midcentury: [
    variant(
      "walnut-teal",
      "орех, бирюза и горчица",
      "Walls: warm white with a walnut panelled feature wall. Floor: walnut or a diamond-pattern rug over wood. Furniture: walnut on tapered legs. Upholstery: teal fabric with mustard cushions. Accents: brass, glazed ceramics. Lighting: brass pendants.",
      ["тёплый белый", "деревянные панели", "орех", "бирюзовая ткань", "горчица", "латунь", "ковёр с ромбами"],
      ["пыльная роза", "оливковый лён", "оранжевый бархат"]
    ),
    variant(
      "teak-olive",
      "тик и олива",
      "Walls: warm white. Floor: terrazzo. Furniture: honey teak on tapered legs. Upholstery: olive green linen and cream. Accents: brass, rattan, glazed ceramics. Lighting: a paper globe pendant. No teal and no mustard anywhere.",
      ["тёплый белый", "терраццо", "тик", "оливковый лён", "латунь", "ротанг", "глазурованная керамика"],
      ["бирюзовая ткань", "горчица", "пыльная роза", "оранжевый бархат", "палисандр"]
    ),
    variant(
      "orange-smoke",
      "оранжевый бархат и дымчатое стекло",
      "Walls: cream with one wall of geometric wallpaper. Floor: walnut. Upholstery: burnt-orange velvet and cognac leather. Accents: smoked glass, brass, dark chocolate wood. Lighting: a brass sputnik chandelier.",
      ["тёплый белый", "геометрические обои", "орех", "оранжевый бархат", "кожа коньяк", "дымчатое стекло", "латунь"],
      ["бирюзовая ткань", "пыльная роза", "оливковый лён"]
    ),
    variant(
      "rosewood-blush",
      "палисандр и пыльная роза",
      "Walls: warm white. Floor: light wood with a diamond-pattern rug. Furniture: rosewood on tapered legs. Upholstery: dusty pink and pale grey. Accents: glazed ceramic lamps, brass. Lighting: ceramic table lamps and a small pendant. Pastel 1950s.",
      ["тёплый белый", "ковёр с ромбами", "палисандр", "пыльная роза", "глазурованная керамика", "латунь"],
      ["бирюзовая ткань", "горчица", "оранжевый бархат", "оливковый лён", "деревянные панели"]
    ),
  ],
  boho: [
    variant(
      "terracotta",
      "терракота и ротанг",
      "Walls: cream plaster. Floor: terracotta tiles. Furniture: rattan and woven pieces. Textiles: linen with pattern, macramé. Accents: woven baskets, many plants. Lighting: a rattan pendant.",
      ["кремовая штукатурка", "терракотовая плитка", "ротанг", "зелень и узор", "плетёные корзины", "макраме", "растения"]
    ),
    variant(
      "white",
      "белый бохо: джут и лён",
      "Walls: white plaster. Floor: pale wood with a jute rug. Furniture: rattan and pale wood. Textiles: white and oatmeal linen. Accents: woven baskets, dried grasses, macramé, many plants. Lighting: a rattan pendant. Light and airy.",
      ["кремовая штукатурка", "джут", "ротанг", "лён", "плетёные корзины", "сухие травы", "макраме", "растения"],
      ["терракотовый бархат", "ковёр с узором", "терракотовая плитка"]
    ),
    variant(
      "jewel",
      "цветной бохо: бархат и ковры",
      "Walls: cream plaster. Floor: layered patterned rugs. Upholstery: terracotta and mustard velvet. Accents: brass, mango wood, tassels and fringes, plants. Lighting: brass and glass. Rich and layered.",
      ["кремовая штукатурка", "ковёр с узором", "терракотовый бархат", "латунь", "дерево манго", "бахрома, кисточки", "растения"]
    ),
    variant(
      "earthy",
      "глина и дерево манго",
      "Walls: sand-coloured clay plaster. Floor: terracotta tiles. Furniture: mango wood and leather. Textiles: linen with tassels. Accents: clay ceramics, plants. Lighting: a woven pendant.",
      ["кремовая штукатурка", "терракотовая плитка", "дерево манго", "кожа", "лён", "бахрома, кисточки", "глина", "растения"]
    ),
  ],
  artdeco: [
    variant(
      "emerald-gold",
      "изумруд и золото",
      "Walls: deep emerald with brass trim. Floor: dark chevron parquet. Upholstery: emerald velvet. Accents: black marble, gold, crystal. Lighting: a brass and crystal chandelier.",
      ["изумрудные стены", "паркет шеврон", "бархат", "чёрный мрамор", "золото", "хрусталь", "латунь"],
      ["бордовый бархат", "обои с веером"]
    ),
    variant(
      "black-white",
      "чёрный лак и белый мрамор",
      "Walls: white with black lacquer panels. Floor: white marble or pale chevron parquet. Upholstery: black leather and ivory velvet. Accents: mirror, crystal, brass lines. Lighting: crystal and brass. Monochrome glamour.",
      ["чёрный лак", "белый мрамор", "паркет шеврон", "чёрная кожа", "бархат", "зеркало", "хрусталь", "латунь"],
      ["изумрудные стены", "бордовый бархат", "обои с веером"]
    ),
    variant(
      "burgundy",
      "бордо и латунь",
      "Walls: fan-pattern wallpaper. Floor: dark chevron parquet. Upholstery: burgundy velvet. Accents: brass, smoked mirror, black marble. Lighting: brass sconces.",
      ["обои с веером", "паркет шеврон", "бордовый бархат", "латунь", "дымчатое зеркало", "чёрный мрамор"],
      ["изумрудные стены"]
    ),
    variant(
      "champagne",
      "шампань и шёлк",
      "Walls: champagne silk panels and mirror. Floor: white marble or pale chevron parquet. Upholstery: ivory and gold velvet. Accents: gold, crystal, a geometric rug. Lighting: a crystal chandelier. Light and glamorous.",
      ["шёлк", "зеркало", "белый мрамор", "паркет шеврон", "бархат", "золото", "хрусталь", "ковёр с геометрией"],
      ["изумрудные стены", "бордовый бархат", "чёрный лак", "обои с веером"]
    ),
  ],
  mediterranean: [
    variant(
      "azulejo",
      "белёные стены и азулежу",
      "Walls: whitewashed plaster. Floor: terracotta tiles. Blue-and-white azulejo tiles on one feature. Textiles: blue cotton and natural linen. Accents: wood beams, wicker baskets. Lighting: wrought iron.",
      ["белёная штукатурка", "терракота", "синяя плитка азулежу", "синий хлопок", "натуральный лён", "деревянные балки", "плетёные корзины", "ковка"],
      ["зеллидж"]
    ),
    variant(
      "zellige",
      "зеллидж и терракота",
      "Walls: warm whitewashed plaster. Floor: terracotta. Teal zellige tiles as the accent. Accents: wrought iron, clay ceramics, jute, olive plants. Lighting: iron lanterns. Moroccan Mediterranean.",
      ["белёная штукатурка", "терракота", "зеллидж", "ковка", "глина", "джут", "олива, зелень"],
      ["синяя плитка азулежу", "синие ставни"]
    ),
    variant(
      "limestone",
      "известняк и лён",
      "Walls: white lime plaster. Floor: pale limestone. Textiles: natural linen. Accents: wood beams, wicker, olive branches, clay pots. Lighting: linen shades. Pared-back Ibiza.",
      ["белёная штукатурка", "известняк", "натуральный лён", "деревянные балки", "плетёные корзины", "олива, зелень", "глина"],
      ["синяя плитка азулежу", "зеллидж", "мозаика", "синие ставни", "синий хлопок"]
    ),
    variant(
      "greek",
      "синие ставни и мозаика",
      "Walls: bright white. Blue painted wood shutters and doors. Floor: pale stone with a mosaic detail. Textiles: white cotton with blue stripes. Accents: wrought iron, clay. Lighting: simple white pendants. A Greek island house.",
      ["белёная штукатурка", "синие ставни", "мозаика", "известняк", "синий хлопок", "ковка", "глина"],
      ["зеллидж", "терракота"]
    ),
  ],
  provence: [
    variant(
      "lavender",
      "лаванда и выбеленные доски",
      "Walls: pale pastel paint. Floor: whitewashed wood boards. Textiles: lavender linen and a floral pattern. Accents: wrought iron, dried lavender, wicker. Lighting: an iron chandelier.",
      ["пастельные стены", "выбеленные доски", "лавандовый лён", "цветочный узор", "кованый металл", "лаванда", "плетёные корзины"]
    ),
    variant(
      "gingham",
      "клетка виши и кружево",
      "Walls: pale blue-grey paint. Ceiling: light beams. Textiles: blue gingham and lace. Accents: painted ceramics, aged wood. Lighting: fabric shades.",
      ["лавандовая краска", "светлые балки", "клетка виши", "кружево", "керамика с росписью", "состаренное дерево"],
      ["лавандовый лён"]
    ),
    variant(
      "aged-wood",
      "состаренное дерево и терракота",
      "Walls: cream. Floor: terracotta tiles. Furniture: aged wood. Textiles: floral chintz. Accents: wicker baskets, painted ceramics. Lighting: wrought iron.",
      ["пастельные стены", "терракота", "состаренное дерево", "ситец", "плетёные корзины", "керамика с росписью", "кованый металл"],
      ["лавандовая краска", "шалфейная краска"]
    ),
    variant(
      "sage",
      "шалфей и ситец",
      "Walls: sage-green painted panelling. Ceiling: light beams. Floor: whitewashed boards. Textiles: chintz and lace. Accents: painted ceramics, lavender. Lighting: wrought iron.",
      ["шалфейная краска", "светлые балки", "выбеленные доски", "ситец", "кружево", "керамика с росписью", "лаванда"],
      ["лавандовая краска", "лавандовый лён"]
    ),
  ],
  wabisabi: [
    variant(
      "clay",
      "глиняная штукатурка и лён",
      "Walls: clay plaster in warm sand. Floor: dark wood. Textiles: rough linen. Accents: raku ceramics, dried branches. Lighting: a paper lantern.",
      ["глиняная штукатурка", "тёмное дерево", "грубый лён", "керамика раку", "сухие ветки", "бумага"],
      ["грубый бетон"]
    ),
    variant(
      "stone",
      "камень и травертин",
      "Walls: greige lime plaster. Floor: travertine. Textiles: wool and jute. Accents: rough stone, cast iron. Lighting: warm hidden light.",
      ["глиняная штукатурка", "травертин", "камень", "шерсть", "джут", "чугун"]
    ),
    variant(
      "dark",
      "тёмное дерево и грубый бетон",
      "Walls: rough concrete. Floor: dark cracked wood. Textiles: dark linen. Accents: cast iron, moss, a single branch. Lighting: a paper lantern. Moody.",
      ["грубый бетон", "дерево с трещинами", "тёмное дерево", "грубый лён", "чугун", "мох, растения", "сухие ветки"],
      ["бумага", "пробка"]
    ),
    variant(
      "paper",
      "бумага и пробка",
      "Walls: pale paper-textured plaster. Floor: cork or pale wood. Textiles: undyed wool. Accents: dried branches, moss, raku ceramics. Lighting: paper. Light and quiet.",
      ["бумага", "пробка", "шерсть", "сухие ветки", "мох, растения", "керамика раку"],
      ["грубый бетон", "дерево с трещинами", "чугун"]
    ),
  ],
  contemporary: [
    variant(
      "grey-leather",
      "серая кожа и керамогранит",
      "Walls: smooth white. Floor: large-format porcelain stoneware. Upholstery: grey leather. Accents: glass and steel, matte black. Lighting: recessed spots and LED lines.",
      ["гладкие стены", "керамогранит", "серая кожа", "стекло и сталь", "матовый чёрный", "LED-подсветка"]
    ),
    variant(
      "walnut",
      "шпон ореха и букле",
      "Walls: smooth white with walnut veneer panels. Floor: microcement. Upholstery: cream bouclé. Accents: steel, grey marble. Lighting: LED strips. Warm contemporary.",
      ["гладкие стены", "шпон ореха", "микроцемент", "букле", "сталь", "серый мрамор", "LED-подсветка"],
      ["тёмная акцентная стена", "глянцевый лак"]
    ),
    variant(
      "dark-gloss",
      "тёмная стена и глянец",
      "Walls: a dark accent wall with glossy lacquer cabinets. Floor: grey marble. Upholstery: grey leather. Accents: smoked glass, matte black. Lighting: LED.",
      ["тёмная акцентная стена", "глянцевый лак", "серый мрамор", "серая кожа", "дымчатое стекло", "матовый чёрный", "LED-подсветка"],
      ["букле", "шпон ореха"]
    ),
    variant(
      "light",
      "светлый контемпорари",
      "Walls: smooth white. Floor: light porcelain stoneware with a plain rug. Upholstery: light grey fabric. Accents: glass, steel, matte black. Lighting: recessed.",
      ["гладкие стены", "керамогранит", "однотонный ковёр", "стекло и сталь", "сталь", "матовый чёрный"],
      ["тёмная акцентная стена", "глянцевый лак", "шпон ореха"]
    ),
  ],
}

/* ── Английские имена материалов для промпта ───────────────────────── */

/**
 * Имена образцов в каталоге русские — они видны в доке и в подписи «без: …».
 * Модели уходит английский: так материал читается однозначно. Имени нет в
 * словаре — уходит как есть.
 */
export const MATERIAL_EN: Record<string, string> = {
  // сканди
  "белая штукатурка": "white plaster",
  "светлый дуб": "light oak",
  "серая шерсть": "grey wool",
  "чёрный металл": "black metal",
  "светло-серая краска": "light grey paint",
  "деревянная рейка": "vertical wood slats",
  "белёная сосна": "whitewashed pine",
  "ёлочка из дуба": "oak herringbone parquet",
  "ясень": "ash wood",
  "букле": "bouclé fabric",
  "натуральный лён": "natural linen",
  "овчина": "sheepskin",
  "плетение": "woven cane",
  "матовая керамика": "matte ceramics",
  "зелень": "green plants",
  "пыльно-голубой лён": "dusty blue linen",
  // неоклассика
  "стены с молдингами": "walls with mouldings and panelling",
  "паркет ёлочкой, орех": "walnut herringbone parquet",
  "синий бархат": "navy blue velvet",
  "латунь": "brass",
  "венецианская штукатурка": "Venetian plaster",
  "обои с узором": "patterned damask wallpaper",
  "белый мрамор": "white marble",
  "чёрный мрамор": "black marble",
  "изумрудный бархат": "emerald velvet",
  "золото": "gold details",
  "зеркало": "mirror",
  "хрусталь": "crystal",
  "шёлк": "silk",
  "ковёр с медальоном": "medallion rug",
  "кремовая кожа": "cream leather",
  "светлый дуб ёлочкой": "pale oak herringbone parquet",
  "пыльно-розовый бархат": "dusty rose velvet",
  // джапанди
  "тёплая штукатурка": "warm plaster",
  "лён, тауп": "taupe linen",
  "чёрное дерево": "black stained wood",
  "тадлакт": "tadelakt plaster",
  "бамбук": "bamboo",
  "рисовая бумага": "rice paper",
  "сёдзи": "shoji screen",
  "татами": "tatami",
  "хлопок": "undyed cotton",
  "керамика раку": "raku ceramics",
  "джут": "jute",
  "речной камень": "river stones",
  "тёмное дерево": "dark wood",
  "бонсай, зелень": "bonsai and green plants",
  // лофт
  "красный кирпич": "exposed red brick",
  "бетон": "concrete",
  "коричневая кожа": "brown leather",
  "белёный кирпич": "whitewashed brick",
  "серая штукатурка": "grey plaster",
  "наливной пол": "poured concrete floor",
  "состаренная доска": "aged wood planks",
  "открытые трубы": "exposed pipes and ducts",
  "деревянные балки": "wood beams",
  "металлическая сетка": "metal mesh",
  "кортен, ржавчина": "corten steel with rust patina",
  "лампы Эдисона": "Edison bulbs",
  "стекло в чёрных рамах": "glass in black metal frames",
  "канат": "rope",
  // минимализм
  "белая краска": "white paint",
  "светлый микроцемент": "light microcement",
  "серая ткань": "grey fabric",
  "графит": "graphite grey",
  "керамогранит": "large-format porcelain stoneware",
  "стекло": "glass",
  "матовый лак": "matte lacquer",
  "белёный дуб": "whitewashed oak",
  "хром": "chrome",
  "матовый чёрный металл": "matte black metal",
  "скрытая подсветка": "concealed LED lighting",
  "бежевая ткань": "beige fabric",
  // мид-сенчури
  "тёплый белый": "warm white",
  "орех": "walnut",
  "бирюзовая ткань": "teal fabric",
  "горчица": "mustard yellow",
  "тик": "teak",
  "деревянные панели": "wood wall panelling",
  "терраццо": "terrazzo",
  "оранжевый бархат": "burnt orange velvet",
  "кожа коньяк": "cognac leather",
  "ротанг": "rattan",
  "дымчатое стекло": "smoked glass",
  "геометрические обои": "geometric wallpaper",
  "ковёр с ромбами": "diamond-pattern rug",
  "глазурованная керамика": "glazed ceramics",
  "оливковый лён": "olive green linen",
  "пыльная роза": "dusty pink fabric",
  "палисандр": "rosewood",
  // бохо
  "кремовая штукатурка": "cream plaster",
  "терракотовая плитка": "terracotta tiles",
  "зелень и узор": "plants and patterned textiles",
  "плетёные корзины": "wicker baskets",
  "макраме": "macramé",
  "лён": "linen",
  "терракотовый бархат": "terracotta velvet",
  "ковёр с узором": "patterned rug",
  "кожа": "leather",
  "растения": "plants",
  "глина": "clay ceramics",
  "дерево манго": "mango wood",
  "бахрома, кисточки": "fringes and tassels",
  "сухие травы": "dried grasses",
  // ар-деко
  "изумрудные стены": "emerald green walls",
  "бархат": "velvet",
  "бордовый бархат": "burgundy velvet",
  "чёрный лак": "black lacquer",
  "паркет шеврон": "chevron parquet",
  "обои с веером": "fan-pattern wallpaper",
  "ковёр с геометрией": "geometric rug",
  "чёрная кожа": "black leather",
  "дымчатое зеркало": "smoked mirror",
  // средиземноморский
  "белёная штукатурка": "whitewashed plaster",
  "терракота": "terracotta",
  "синяя плитка азулежу": "blue-and-white azulejo tiles",
  "зеллидж": "zellige tiles",
  "мозаика": "mosaic",
  "олива, зелень": "olive branches and plants",
  "синие ставни": "blue painted shutters",
  "ковка": "wrought iron",
  "известняк": "limestone",
  "синий хлопок": "blue cotton",
  // прованс
  "пастельные стены": "pastel painted walls",
  "выбеленные доски": "whitewashed wood boards",
  "лавандовый лён": "lavender linen",
  "цветочный узор": "floral pattern",
  "лавандовая краска": "pale lavender-blue paint",
  "светлые балки": "light wood beams",
  "клетка виши": "gingham check",
  "кружево": "lace",
  "кованый металл": "wrought iron",
  "керамика с росписью": "hand-painted ceramics",
  "лаванда": "dried lavender",
  "состаренное дерево": "aged wood",
  "ситец": "chintz",
  "шалфейная краска": "sage green paint",
  // ваби-саби
  "глиняная штукатурка": "clay plaster",
  "камень": "stone",
  "грубый лён": "rough linen",
  "травертин": "travertine",
  "дерево с трещинами": "cracked aged wood",
  "грубый бетон": "rough concrete",
  "бумага": "paper",
  "сухие ветки": "dried branches",
  "мох, растения": "moss and plants",
  "пробка": "cork",
  "шерсть": "wool",
  "чугун": "cast iron",
  // контемпорари
  "гладкие стены": "smooth walls",
  "серая кожа": "grey leather",
  "стекло и сталь": "glass and steel",
  "тёмная акцентная стена": "dark accent wall",
  "микроцемент": "microcement",
  "сталь": "steel",
  "матовый чёрный": "matte black",
  "шпон ореха": "walnut veneer",
  "глянцевый лак": "glossy lacquer",
  "серый мрамор": "grey marble",
  "однотонный ковёр": "plain rug",
  "LED-подсветка": "LED lighting",
}

export function materialEn(name: string): string {
  return MATERIAL_EN[name] ?? name
}

/* ── Выбор направления ─────────────────────────────────────────────── */

export function variantOf(family: RestyleFamily, id: string | undefined): StyleVariant | undefined {
  if (!id) return undefined
  return STYLE_VARIANTS[family].find((item) => item.id === id)
}

/** Детерминированный генератор по строке: вспомогательные материалы у «Повторить» те же. */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length
  for (let i = 0; i < seed.length; i += 1) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Несколько случайных элементов без повторов. */
export function pickSome<T>(items: readonly T[], count: number, random: () => number = Math.random): T[] {
  const pool = [...items]
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, Math.max(0, count))
}

/**
 * Направление для нового переноса. Сначала отсеиваются те, чьи материалы
 * сняты галочкой (берутся направления с наименьшим числом исключённых), затем
 * из оставшихся — не встречавшиеся в `avoid` (последние переносы этого стиля),
 * если такие есть. Из финального набора — случайное.
 */
export function pickVariant(
  family: RestyleFamily,
  { avoid = [], excluded = [], random = Math.random }: { avoid?: readonly string[]; excluded?: readonly string[]; random?: () => number } = {}
): StyleVariant {
  const variants = STYLE_VARIANTS[family]
  const score = (item: StyleVariant) => item.materials.filter((name) => excluded.includes(name)).length
  const best = Math.min(...variants.map(score))
  let pool = variants.filter((item) => score(item) === best)
  const fresh = pool.filter((item) => !avoid.includes(item.id))
  if (fresh.length > 0) pool = fresh
  return pool[Math.floor(random() * pool.length)] ?? variants[0]
}
