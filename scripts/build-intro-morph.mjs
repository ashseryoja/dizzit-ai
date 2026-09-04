/**
 * Генерирует src/lib/intro-morph-data.ts — данные морфа интро-заставки.
 *
 * Для каждой буквы «Dizzit AI»:
 *  - source: контур(ы) рукописного штриха (центрлиния из intro-splash,
 *    раздутая в замкнутую «колбасу» с круглыми торцами, w = 5.5);
 *  - target: НАСТОЯЩИЕ контуры глифа Unbounded wght=500 из TTF, поставленные
 *    в позицию фактического рендера (пен-позиции сняты с DOM, базлайн 105
 *    в координатах viewBox 620×150);
 *  - контуры пересэмплированы в N равных точек и выровнены по направлению
 *    обхода и стартовой точке — рантайм линейно интерполирует пары.
 *
 * Классификация контуров глифа — ПО ЗНАКУ обхода, а не по площади: у «i»
 * точка — отдельный ПОЛОЖИТЕЛЬНЫЙ контур, а не дырка, и красить её цветом
 * фона нельзя. Знак внешнего задаёт самое большое кольцо; совпадающий знак —
 * «чернила», противоположный — дырка (растёт из точки, заливается фоном:
 * на сплошном фоне неотличимо от настоящего counter'а).
 *
 * Контрформы приводятся к истинной дырке — см. resolveCounterQuad.
 *
 * Штрихи эскиза сопоставляются положительным контурам по ближайшему центроиду
 * (точка «i» → точка глифа, ножка → ножка). Лишние штрихи
 * дорисовываются в ближайший контур (overdraw тем же цветом невидим).
 *
 * Запуск: node scripts/build-intro-morph.mjs
 */
import fs from "node:fs"
import path from "node:path"
import url from "node:url"
import * as fk from "fontkit"

const fontkit = fk.default ?? fk

const __dirname = path.dirname(url.fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, "..")

const FONT_PATH = path.join(ROOT, "public/fonts/unbounded/Unbounded-Variable-v2.ttf")
const OUT_PATH = path.join(ROOT, "src/lib/intro-morph-data.ts")

/* ── Метрики, снятые с фактического рендера (Range API по DOM) ── */
const VIEWBOX_W = 620
const STAGE_W = 920
const FONT_PX = 128
const FS = (FONT_PX * VIEWBOX_W) / STAGE_W
const BASELINE = 105
const TRACKING = -0.025 * FS

// Пен-позиции букв (левый край ячейки символа). Раскладка посчитана из
// advance-метрик Unbounded wght=500 (adv·S + TRACKING между буквами, зазор
// слово↔AI = 9.9 — как в DOM-замере рендера) и отцентрована по тому же
// охвату, что занимал прежний логотип: «Dizzit» уже «Skizzy» на 43 единицы,
// поэтому слово сдвинуто вправо, а блок «AI» — влево.
// Ключи z1/z2 и i1/i2 — одинаковые буквы на своих пенах.
const PENS = { D: 92.81, i1: 169.23, z1: 192.35, z2: 248.16, i2: 303.97, t: 327.09, A: 386.94 }
const AI_RIGHT_EDGE = 492.7

const N = 128
const STROKE_W = 5.5

/* ── Рукописные центрлинии (из intro-splash.tsx), по сабпутям ── */
const SKETCH = {
  // D — стойка и чаша, двумя штрихами, как пишут от руки. Стойка идёт по
  // середине стойки глифа (x≈107), чаша — по середине C-образной ленты.
  D: ["M107 41 C106 62 106 84 107 104", "M113 43 C138 41 160 54 161 72 C162 90 138 104 113 102"],
  i1: ["M182 61 C181 76 181 90 182 105", "M181 41 C181 43 182 45 183 43"],
  z1: ["M199 62 C214 59 230 59 244 61 L243 63 C229 76 215 89 203 102 L205 104 C219 106 233 106 246 104"],
  z2: ["M255 62 C270 59 286 59 300 61 L299 63 C285 76 271 89 259 102 L261 104 C275 106 289 106 302 104"],
  i2: ["M316 61 C315 76 315 90 316 105", "M315 41 C315 43 316 45 317 43"],
  // t — стойка с нижним крюком и перекладина.
  t: ["M341 43 C340 65 339 85 341 97 C343 105 355 107 366 103", "M329 61 C340 59 353 59 364 61"],
  A: ["M403 105 C413 79 423 53 435 33 L437 32 C449 53 460 79 470 105", "M417 77 C430 74 445 74 457 77"],
  I: ["M480 34 C479 57 479 81 480 105"],
}

const LETTERS = [
  { key: "D", char: "D", color: "main" },
  { key: "i1", char: "i", color: "main" },
  { key: "z1", char: "z", color: "main" },
  { key: "z2", char: "z", color: "main" },
  { key: "i2", char: "i", color: "main" },
  { key: "t", char: "t", color: "main" },
  { key: "A", char: "A", color: "ai" },
  { key: "I", char: "I", color: "ai" },
]

/* ═══════════ Геометрия ═══════════ */

function parseSketchPath(d) {
  const tokens = d.match(/[MCL]|-?\d+(?:\.\d+)?/g)
  const pts = []
  let i = 0
  let cur = null
  const STEPS = 48
  while (i < tokens.length) {
    const cmd = tokens[i++]
    if (cmd === "M") {
      cur = [Number(tokens[i++]), Number(tokens[i++])]
      pts.push(cur)
    } else if (cmd === "L") {
      const p = [Number(tokens[i++]), Number(tokens[i++])]
      pts.push(p)
      cur = p
    } else if (cmd === "C") {
      const c1 = [Number(tokens[i++]), Number(tokens[i++])]
      const c2 = [Number(tokens[i++]), Number(tokens[i++])]
      const p2 = [Number(tokens[i++]), Number(tokens[i++])]
      for (let s = 1; s <= STEPS; s++) {
        const t = s / STEPS
        const mt = 1 - t
        pts.push([
          mt ** 3 * cur[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t ** 3 * p2[0],
          mt ** 3 * cur[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t ** 3 * p2[1],
        ])
      }
      cur = p2
    }
  }
  return pts
}

function polylineLength(pts) {
  let len = 0
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1])
  return len
}

/** Равномерная пересэмплировка открытой полилинии в M точек. */
function resampleOpen(pts, M) {
  const total = polylineLength(pts)
  const out = [pts[0]]
  const step = total / (M - 1)
  let acc = 0
  let i = 1
  let prev = pts[0]
  while (out.length < M - 1 && i < pts.length) {
    const seg = Math.hypot(pts[i][0] - prev[0], pts[i][1] - prev[1])
    if (acc + seg >= step) {
      const t = (step - acc) / seg
      const p = [prev[0] + (pts[i][0] - prev[0]) * t, prev[1] + (pts[i][1] - prev[1]) * t]
      out.push(p)
      prev = p
      acc = 0
    } else {
      acc += seg
      prev = pts[i]
      i++
    }
  }
  while (out.length < M) out.push(pts.at(-1))
  return out
}

/** Равномерная пересэмплировка ЗАМКНУТОГО кольца в M точек. */
function resampleRing(ring, M) {
  const pts = [...ring, ring[0]]
  const total = polylineLength(pts)
  const out = [pts[0]]
  const step = total / M
  let acc = 0
  let prev = pts[0]
  let i = 1
  while (out.length < M && i < pts.length) {
    const seg = Math.hypot(pts[i][0] - prev[0], pts[i][1] - prev[1])
    if (acc + seg >= step) {
      const t = (step - acc) / seg
      const p = [prev[0] + (pts[i][0] - prev[0]) * t, prev[1] + (pts[i][1] - prev[1]) * t]
      out.push(p)
      prev = p
      acc = 0
    } else {
      acc += seg
      prev = pts[i]
      i++
    }
  }
  while (out.length < M) out.push(ring[0])
  return out
}

function ringArea(ring) {
  let a = 0
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]
    const [x2, y2] = ring[(i + 1) % ring.length]
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}

function ringCentroid(ring) {
  let cx = 0
  let cy = 0
  for (const [x, y] of ring) {
    cx += x
    cy += y
  }
  return [cx / ring.length, cy / ring.length]
}

function ensureCCW(ring) {
  // Важен не сам знак, а ОДИНАКОВАЯ ориентация всех колец перед паровкой.
  return ringArea(ring) > 0 ? [...ring].reverse() : ring
}

/** Циклический сдвиг target-кольца, минимизирующий сумму расстояний до source. */
function alignRing(from, to) {
  let bestK = 0
  let bestD = Infinity
  const n = from.length
  for (let k = 0; k < n; k++) {
    let d = 0
    for (let i = 0; i < n; i += 2) {
      const p = from[i]
      const q = to[(i + k) % n]
      d += (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2
      if (d >= bestD) break
    }
    if (d < bestD) {
      bestD = d
      bestK = k
    }
  }
  return from.map((_, i) => to[(i + bestK) % n])
}

/** «Колбаса»: центрлиния → замкнутый контур штриха с круглыми торцами. */
function strokeOutline(centerline, width) {
  const M = 110
  const pts = resampleOpen(centerline, M)
  const h = width / 2
  const normals = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(M - 1, i + 1)]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len = Math.hypot(dx, dy) || 1
    return [-dy / len, dx / len]
  })
  const left = pts.map((p, i) => [p[0] + normals[i][0] * h, p[1] + normals[i][1] * h])
  const right = pts.map((p, i) => [p[0] - normals[i][0] * h, p[1] - normals[i][1] * h])

  const cap = (center, fromPt, toPt, steps = 8) => {
    const a0 = Math.atan2(fromPt[1] - center[1], fromPt[0] - center[0])
    let a1 = Math.atan2(toPt[1] - center[1], toPt[0] - center[0])
    while (a1 - a0 > Math.PI) a1 -= 2 * Math.PI
    while (a0 - a1 > Math.PI) a1 += 2 * Math.PI
    const out = []
    for (let s = 1; s < steps; s++) {
      const a = a0 + ((a1 - a0) * s) / steps
      out.push([center[0] + Math.cos(a) * h, center[1] + Math.sin(a) * h])
    }
    return out
  }

  const rightReversed = [...right].reverse()
  return [
    ...left,
    ...cap(pts[M - 1], left[M - 1], right[M - 1]),
    ...rightReversed,
    ...cap(pts[0], right[0], left[0]),
  ]
}

function circleRing(cx, cy, r, M) {
  const out = []
  for (let i = 0; i < M; i++) {
    const a = (i / M) * Math.PI * 2
    out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r])
  }
  return out
}

const r2 = (v) => Math.round(v * 100) / 100
const flat = (ring) => ring.flat().map(r2)

/* ═══════════ Шрифт ═══════════ */

const font = fontkit.openSync(FONT_PATH)
const inst = font.getVariation ? font.getVariation({ wght: 500 }) : font
const upm = inst.unitsPerEm
const S = FS / upm

console.log(`font: upm=${upm}, scale=${S.toFixed(5)}, cap-top ≈ ${(BASELINE - inst.capHeight * S).toFixed(1)}`)

/* ── Корректирующий четырёхугольник контрформы ───────────────────────
   У вариативного Unbounded контур контрформы «D» — это основная петля
   (в единицах шрифта x 160…446, y 150…600) плюс хвост из двух узлов
   (246,683)→(246,67). Вместе с точками крепления (160,600) и (160,150) хвост
   образует четырёхугольник ПРОТИВОПОЛОЖНОЙ намотки, и при заливке всего
   глифа одним путём он гасит полосу x<246 — стойка «D» получается нормальной
   толщины (169 ед., как у «i»), а не 83. Это не мусор: без него буква
   неверна. Есть на всех весах — так шрифт и построен.

   Мы заливаем контрформу отдельным path цветом фона, и намотка внешнего
   контура нам недоступна. Поэтому истинную дырку считаем сами: основная
   петля (кольцо без хвоста), обрезанная полуплоскостью по последнему отрезку
   хвоста с той стороны, где лежат точки крепления. Это ровно та область,
   которую даёт намотка. Делается только для контрформ — у чернильных
   контуров самопересечение штатно («z», «A»), их не трогаем. */
function segmentsCross(a, b, c, d) {
  const cross = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const d1 = cross(c, d, a)
  const d2 = cross(c, d, b)
  const d3 = cross(a, b, c)
  const d4 = cross(a, b, d)
  return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0
}

function selfIntersects(pts) {
  const n = pts.length
  if (n < 4) return false
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue // смежные через замыкание
      if (segmentsCross(a, b, pts[j], pts[(j + 1) % n])) return true
    }
  }
  return false
}

/** Команды глифа → субпути (каждый начинается с moveTo). */
function splitSubpaths(commands) {
  const subs = []
  let cur = []
  for (const cmd of commands) {
    if (cmd.command === "moveTo" && cur.length) {
      subs.push(cur)
      cur = []
    }
    cur.push(cmd)
  }
  if (cur.length) subs.push(cur)
  return subs
}

/** Один субпуть → точки и точный d в координатах viewBox. */
function buildRing(cmds, X, Y) {
  const pts = []
  let d = ""
  let last = null
  const sampleCubic = (p0, c1, c2, p, steps = 24) => {
    for (let s = 1; s <= steps; s++) {
      const t = s / steps
      const mt = 1 - t
      pts.push([
        mt ** 3 * p0[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t ** 3 * p[0],
        mt ** 3 * p0[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t ** 3 * p[1],
      ])
    }
  }
  const sampleQuad = (p0, c, p, steps = 24) => {
    for (let s = 1; s <= steps; s++) {
      const t = s / steps
      const mt = 1 - t
      pts.push([
        mt * mt * p0[0] + 2 * mt * t * c[0] + t * t * p[0],
        mt * mt * p0[1] + 2 * mt * t * c[1] + t * t * p[1],
      ])
    }
  }

  for (const cmd of cmds) {
    const a = cmd.args
    switch (cmd.command) {
      case "moveTo": {
        last = [X(a[0]), Y(a[1])]
        pts.push(last)
        d += `M${r2(last[0])} ${r2(last[1])}`
        break
      }
      case "lineTo": {
        const p = [X(a[0]), Y(a[1])]
        pts.push(p)
        d += `L${r2(p[0])} ${r2(p[1])}`
        last = p
        break
      }
      case "quadraticCurveTo": {
        const c = [X(a[0]), Y(a[1])]
        const p = [X(a[2]), Y(a[3])]
        sampleQuad(last, c, p)
        d += `Q${r2(c[0])} ${r2(c[1])} ${r2(p[0])} ${r2(p[1])}`
        last = p
        break
      }
      case "bezierCurveTo": {
        const c1 = [X(a[0]), Y(a[1])]
        const c2 = [X(a[2]), Y(a[3])]
        const p = [X(a[4]), Y(a[5])]
        sampleCubic(last, c1, c2, p)
        d += `C${r2(c1[0])} ${r2(c1[1])} ${r2(c2[0])} ${r2(c2[1])} ${r2(p[0])} ${r2(p[1])}`
        last = p
        break
      }
    }
  }
  return { pts, d: d + "Z" }
}

/** Пересечение отрезка p→q с бесконечной прямой a→b. */
function lineHit(p, q, a, b) {
  const dx = q[0] - p[0]
  const dy = q[1] - p[1]
  const ex = b[0] - a[0]
  const ey = b[1] - a[1]
  const den = dx * ey - dy * ex
  const t = ((a[0] - p[0]) * ey - (a[1] - p[1]) * ex) / den
  return [p[0] + dx * t, p[1] + dy * t]
}

/** Сазерленд–Ходжман: оставляет часть кольца по одну сторону прямой a→b. */
function clipHalfPlane(pts, a, b, keepSign) {
  const side = (p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])
  const out = []
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i]
    const prev = pts[(i - 1 + pts.length) % pts.length]
    const inCur = side(cur) * keepSign >= 0
    const inPrev = side(prev) * keepSign >= 0
    if (inCur) {
      if (!inPrev) out.push(lineHit(prev, cur, a, b))
      out.push(cur)
    } else if (inPrev) {
      out.push(lineHit(prev, cur, a, b))
    }
  }
  return out
}

const polygonD = (pts) => `M${pts.map((p) => `${r2(p[0])} ${r2(p[1])}`).join("L")}Z`

/** Истинная дырка контрформы. Вызывается только для дырок. */
function resolveCounterQuad(ring, X, Y, label) {
  if (!selfIntersects(ring.pts)) return ring

  // Хвост — trailing lineTo, пока основная петля самопересекается.
  let cmds = ring.cmds
  const tail = []
  let main = ring
  for (let guard = 0; guard < 4 && selfIntersects(main.pts); guard++) {
    const lastIdx = cmds.at(-1).command === "closePath" ? cmds.length - 2 : cmds.length - 1
    if (cmds[lastIdx]?.command !== "lineTo") break
    tail.unshift([X(cmds[lastIdx].args[0]), Y(cmds[lastIdx].args[1])])
    cmds = [...cmds.slice(0, lastIdx), ...cmds.slice(lastIdx + 1)]
    main = { cmds, ...buildRing(cmds, X, Y) }
  }
  if (tail.length < 2) {
    console.log(`  ${label}: контрформа самопересекается, но хвоста нет — оставлена как есть`)
    return ring
  }

  // Режем по последнему отрезку хвоста; точка крепления — последний узел
  // петли — лежит на стороне, которую гасит четырёхугольник.
  const a = tail[tail.length - 2]
  const b = tail[tail.length - 1]
  const attach = main.pts[main.pts.length - 1]
  const attachSide = (b[0] - a[0]) * (attach[1] - a[1]) - (b[1] - a[1]) * (attach[0] - a[0])
  const pts = clipHalfPlane(main.pts, a, b, -Math.sign(attachSide))
  console.log(
    `  ${label}: контрформа обрезана по прямой x≈${r2(a[0])} (хвост ${tail.length} узла), точек ${main.pts.length}→${pts.length}`
  )
  return { cmds, pts, d: polygonD(pts) }
}

/* ── Буква с дыркой → ленты ──────────────────────────────────────────
   У каждой буквы логотипа контур глифа — «лента»: обходит штрих по одной
   стороне и возвращается по другой, ровно как раздутая «колбаса» эскиза.
   Точки ложатся один в один, и морф — чистое утолщение. Единственное
   исключение — «D»: её чернила — один замкнутый силуэт с дыркой, и оба
   штриха (стойка и чаша) тянулись бы к одному большому контуру, «раскрываясь»
   через всю букву. Это и выглядело как переворот.

   Поэтому такую букву раскладываем на две ленты по левому краю истинной
   дырки: прямоугольник стойки и C-образную ленту чаши (с верхней и нижней
   перекладинами). Стойка утолщается в стойку, чаша — в чашу, дырка
   получается сама — отдельная контрформа не нужна. Ленты чуть перекрываются,
   чтобы шов не просвечивал на антиалиасинге.

   Ограничение: разрез вертикальный по левому краю дырки — это устройство
   «D» (и B, P, R). Для «O» или «Q» понадобился бы другой разрез. */

const EPS = 1e-3

/** Дуга обрезанного кольца — всё, кроме отрезка вдоль линии разреза. */
function arcBetweenCuts(pts, xCut) {
  const onCut = (p) => Math.abs(p[0] - xCut) < EPS
  const n = pts.length
  for (let i = 0; i < n; i++) {
    if (onCut(pts[i]) && onCut(pts[(i + 1) % n])) {
      // pts[i] → pts[i+1] — отрезок разреза; дуга идёт от pts[i+1] до pts[i].
      const arc = []
      for (let k = 1; k <= n; k++) arc.push(pts[(i + k) % n])
      return arc
    }
  }
  throw new Error("arcBetweenCuts: не нашёл отрезок разреза")
}

function splitAtHole(outer, hole, label) {
  const xCut = Math.min(...hole.pts.map((p) => p[0]))
  const OVERLAP = 0.6

  // clipHalfPlane для вертикали a=(x,0)→b=(x,1): side(p) = −(p.x − x),
  // то есть keepSign=+1 оставляет ЛЕВУЮ сторону, −1 — ПРАВУЮ.
  // Стойка: всё левее разреза (+нахлёст).
  const stem = clipHalfPlane(outer.pts, [xCut + OVERLAP, 0], [xCut + OVERLAP, 1], 1)

  // Чаша: внешняя дуга правее разреза + дуга дырки в обратную сторону.
  const outerArc = arcBetweenCuts(clipHalfPlane(outer.pts, [xCut, 0], [xCut, 1], -1), xCut)
  const holeArc = arcBetweenCuts(hole.pts, xCut)
  // Внешняя дуга идёт сверху вниз, дуга дырки должна идти снизу вверх —
  // иначе лента самопересечётся. Ориентируем по концам.
  const outerEnd = outerArc[outerArc.length - 1]
  const holeStart = holeArc[0]
  const holeEnd = holeArc[holeArc.length - 1]
  const orientedHole =
    Math.abs(holeStart[1] - outerEnd[1]) <= Math.abs(holeEnd[1] - outerEnd[1]) ? holeArc : [...holeArc].reverse()
  const bowl = [...outerArc, ...orientedHole]

  console.log(`  ${label}: разложена на ленты по x≈${r2(xCut)} — стойка ${stem.length} т., чаша ${bowl.length} т.`)
  return [
    { pts: stem, d: polygonD(stem) },
    { pts: bowl, d: polygonD(bowl) },
  ]
}

/** Глиф → кольца точек, каждое со своим точным d, в координатах viewBox. */
function glyphRings(char, penX) {
  const glyph = inst.glyphForCodePoint(char.codePointAt(0))
  const X = (x) => penX + x * S
  const Y = (y) => BASELINE - y * S

  const subs = splitSubpaths(glyph.path.commands)
    .map((cmds) => ({ cmds, ...buildRing(cmds, X, Y) }))
    .filter((ring) => ring.pts.length > 2)

  // Классификация нужна прямо здесь: истинную дырку считаем только для контрформ.
  const areas = subs.map((ring) => ringArea(ring.pts))
  const outerIdx = areas.reduce((best, a, i) => (Math.abs(a) > Math.abs(areas[best]) ? i : best), 0)
  const outerSign = Math.sign(areas[outerIdx])

  const inks = subs.filter((_, i) => Math.sign(areas[i]) === outerSign)
  const holes = subs
    .filter((_, i) => Math.sign(areas[i]) !== outerSign)
    .map((ring) => resolveCounterQuad(ring, X, Y, char))

  const advance = glyph.advanceWidth * S
  if (inks.length === 1 && holes.length === 1) {
    return { rings: splitAtHole(inks[0], holes[0], char), advance }
  }
  return { rings: [...inks, ...holes], advance }
}

/* ═══════════ Сборка ═══════════ */

const aInfo = glyphRings("A", PENS.A)
const penI = PENS.A + aInfo.advance + TRACKING
const iInfo = glyphRings("I", penI)
const iRight = penI + iInfo.advance + TRACKING
console.log(`I: pen=${penI.toFixed(1)}, right=${iRight.toFixed(1)} (замер DOM: ${AI_RIGHT_EDGE})`)

const letters = []

for (const { key, char, color } of LETTERS) {
  const pen = key === "I" ? penI : PENS[key]
  const { rings } = glyphRings(char, pen)

  // Знак внешнего контура задаёт самое большое кольцо; совпадающий знак —
  // «чернила», противоположный — дырка.
  const areas = rings.map((r) => ringArea(r.pts))
  const outerIdx = areas.reduce((best, a, i) => (Math.abs(a) > Math.abs(areas[best]) ? i : best), 0)
  const outerSign = Math.sign(areas[outerIdx])

  const positives = []
  const holes = []
  rings.forEach((ring, i) => {
    const entry = {
      ring: ensureCCW(resampleRing(ring.pts, N)),
      d: ring.d,
      centroid: ringCentroid(ring.pts),
    }
    if (Math.sign(areas[i]) === outerSign) positives.push(entry)
    else holes.push(entry)
  })

  // Штрихи эскиза → положительные контуры: по ближайшему центроиду.
  const sources = SKETCH[key].map((subpath) => {
    const centerline = parseSketchPath(subpath)
    const banana = ensureCCW(resampleRing(strokeOutline(centerline, STROKE_W), N))
    return { banana, centroid: ringCentroid(centerline) }
  })

  const used = new Set()
  const shapes = sources.map((src) => {
    let bestIdx = 0
    let bestDist = Infinity
    positives.forEach((pos, i) => {
      // Незанятые контуры в приоритете, чтобы у каждого был свой штрих.
      const dist =
        (src.centroid[0] - pos.centroid[0]) ** 2 +
        (src.centroid[1] - pos.centroid[1]) ** 2 +
        (used.has(i) ? 1e6 : 0)
      if (dist < bestDist) {
        bestDist = dist
        bestIdx = i
      }
    })
    used.add(bestIdx)
    const target = positives[bestIdx]
    return { from: flat(src.banana), to: flat(alignRing(src.banana, target.ring)), final: target.d }
  })

  // Положительные контуры, оставшиеся без штриха, растут из точки цветом букв.
  positives.forEach((pos, i) => {
    if (used.has(i)) return
    const fromRing = circleRing(pos.centroid[0], pos.centroid[1], 0.6, N)
    shapes.push({ from: flat(fromRing), to: flat(alignRing(fromRing, pos.ring)), final: pos.d })
  })

  // Дырки растут из точки в своём центроиде, заливаются цветом фона.
  const counters = holes.map((hole) => {
    const fromRing = circleRing(hole.centroid[0], hole.centroid[1], 0.6, N)
    return { from: flat(fromRing), to: flat(alignRing(fromRing, hole.ring)), final: hole.d }
  })

  console.log(
    `${key}: чернильных=${positives.length}, дырок=${holes.length}, штрихов=${sources.length}, фигур=${shapes.length}`
  )
  letters.push({ color, shapes, counters })
}

const banner = `// АВТОГЕНЕРАЦИЯ: node scripts/build-intro-morph.mjs — не править руками.
// Пары контуров для морфа интро: рукописный штрих («колбаса» центрлинии) →
// настоящий контур глифа Unbounded wght=500 в координатах viewBox 620×150.
// from/to — плоские массивы [x0,y0,...] по ${N} точек, final — точный d глифа.

export interface MorphShape {
  from: number[]
  to: number[]
  final: string
}

export interface MorphLetter {
  color: "main" | "ai"
  shapes: MorphShape[]
  counters: MorphShape[]
}

export const INTRO_MORPH: MorphLetter[] = `

fs.writeFileSync(OUT_PATH, banner + JSON.stringify(letters) + "\n")
console.log(`→ ${path.relative(ROOT, OUT_PATH)} (${(fs.statSync(OUT_PATH).size / 1024).toFixed(0)} КБ)`)
