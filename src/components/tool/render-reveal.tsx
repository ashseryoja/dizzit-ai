"use client"

import { cn } from "@/lib/utils"

/**
 * Живое «до/после» для пустого экрана «Редактор рендера»: один и тот же
 * интерьер (окно, диван, растение, торшер) нарисован дважды — как серый
 * CG-каркас и как фотореалистичный кадр со светом из окна, тенями и зерном.
 * Поверх ездит шторка-слайдер: открывает результат слева направо, держит
 * и возвращается. Геометрия общая (SCENE), различается только «краска».
 * Анимации — в .re-* (surfaces.css), там же отключаются при reduced-motion.
 */

const W = 360
const H = 220
/* Линия пола: выше — стена, ниже — пол. */
const FLOOR = 150

type Mode = "raw" | "real"

/* Каркас: всё одним цветом (currentColor), фон — тонкая заливка по глубине. */
function rawPaint(depth: number) {
  return { fill: "currentColor", fillOpacity: 0.035 + depth * 0.03, stroke: "currentColor", strokeWidth: 1.1 }
}

/* Пол в каркасе: сетка в перспективе — намёк на вьюпорт 3D-пакета. */
function FloorGrid() {
  const vanishX = 180
  const columns = [-60, 0, 60, 120, 180, 240, 300, 360, 420]
  const rows = [158, 168, 181, 198, 219]
  return (
    <g stroke="currentColor" strokeOpacity="0.22" strokeWidth="1">
      {columns.map((x) => (
        <line key={x} x1={x} y1={H} x2={vanishX + (x - vanishX) * 0.38} y2={FLOOR} />
      ))}
      {rows.map((y) => (
        <line key={y} x1="0" y1={y} x2={W} y2={y} />
      ))}
    </g>
  )
}

/** Окно с двумя импостами и подоконником. */
function Window({ mode }: { mode: Mode }) {
  const x = 36
  const y = 28
  const w = 88
  const h = 98
  if (mode === "raw") {
    const p = rawPaint(0)
    return (
      <g {...p}>
        <rect x={x} y={y} width={w} height={h} rx="2" />
        <line x1={x + w / 2} y1={y} x2={x + w / 2} y2={y + h} />
        <line x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2} />
        <rect x={x - 4} y={y + h} width={w + 8} height="5" rx="1" />
      </g>
    )
  }
  return (
    <g>
      {/* Небо за стеклом и мягкое пятно солнца. */}
      <rect x={x} y={y} width={w} height={h} fill="url(#re-sky)" />
      <ellipse cx={x + 30} cy={y + 30} rx="26" ry="20" fill="#fff" fillOpacity="0.55" filter="url(#re-blur-8)" />
      {/* Далёкие кроны — чтобы стекло не было пустым. */}
      <ellipse cx={x + 22} cy={y + 88} rx="30" ry="16" fill="#9fb59a" fillOpacity="0.7" filter="url(#re-blur-4)" />
      <ellipse cx={x + 70} cy={y + 92} rx="28" ry="14" fill="#8ea78c" fillOpacity="0.7" filter="url(#re-blur-4)" />
      {/* Рама и импосты. */}
      <rect x={x} y={y} width={w} height={h} fill="none" stroke="#f4efe6" strokeWidth="5" />
      <line x1={x + w / 2} y1={y} x2={x + w / 2} y2={y + h} stroke="#f4efe6" strokeWidth="4" />
      <line x1={x} y1={y + h / 2} x2={x + w} y2={y + h / 2} stroke="#f4efe6" strokeWidth="4" />
      {/* Подоконник с тенью под ним. */}
      <rect x={x - 5} y={y + h + 3} width={w + 10} height="4" fill="#3a2f26" fillOpacity="0.35" filter="url(#re-blur-2)" />
      <rect x={x - 4} y={y + h} width={w + 8} height="5" rx="1" fill="#ece5d8" />
    </g>
  )
}

/** Картина над диваном. */
function Picture({ mode }: { mode: Mode }) {
  const x = 208
  const y = 42
  if (mode === "raw") {
    const p = rawPaint(0)
    return (
      <g {...p}>
        <rect x={x} y={y} width="44" height="38" rx="1" />
        <rect x={x + 6} y={y + 6} width="32" height="26" strokeOpacity="0.5" fill="none" />
      </g>
    )
  }
  return (
    <g>
      <rect x={x + 2} y={y + 4} width="44" height="38" fill="#000" fillOpacity="0.28" filter="url(#re-blur-3)" />
      <rect x={x} y={y} width="44" height="38" rx="1" fill="#2a2622" />
      <rect x={x + 4} y={y + 4} width="36" height="30" fill="#efe9de" />
      <rect x={x + 8} y={y + 8} width="28" height="22" fill="url(#re-art)" />
    </g>
  )
}

/** Диван: спинка, сиденье, подлокотники, две подушки, декоративная подушка. */
function Sofa({ mode }: { mode: Mode }) {
  const back = { x: 158, y: 90, w: 144, h: 30 }
  const seat = { x: 158, y: 116, w: 144, h: 30 }
  const arms = [152, 294]
  const cushions = [168, 234]
  if (mode === "raw") {
    const p = rawPaint(2)
    const c = rawPaint(1)
    return (
      <g>
        <rect {...p} x={back.x} y={back.y} width={back.w} height={back.h} rx="6" />
        <rect {...p} x={seat.x} y={seat.y} width={seat.w} height={seat.h} rx="6" />
        {arms.map((x) => (
          <rect key={x} {...p} x={x} y="104" width="14" height="44" rx="5" />
        ))}
        {cushions.map((x) => (
          <rect key={x} {...c} x={x} y="118" width="58" height="22" rx="4" />
        ))}
        <rect {...c} x="176" y="98" width="22" height="20" rx="3" transform="rotate(-8 187 108)" />
        <g stroke="currentColor" strokeWidth="1.4">
          <line x1="164" y1="148" x2="164" y2="156" />
          <line x1="296" y1="148" x2="296" y2="156" />
        </g>
      </g>
    )
  }
  return (
    <g>
      {/* Контактная тень на полу. */}
      <ellipse cx="230" cy="157" rx="92" ry="7" fill="#000" fillOpacity="0.5" filter="url(#re-blur-4)" />
      <g stroke="#2a2420" strokeWidth="2" strokeLinecap="round">
        <line x1="164" y1="148" x2="164" y2="156" />
        <line x1="296" y1="148" x2="296" y2="156" />
      </g>
      <rect x={back.x} y={back.y} width={back.w} height={back.h} rx="6" fill="url(#re-sofa-back)" />
      <rect x={seat.x} y={seat.y} width={seat.w} height={seat.h} rx="6" fill="url(#re-sofa-seat)" />
      {cushions.map((x) => (
        <g key={x}>
          <rect x={x} y="120" width="58" height="22" rx="4" fill="#000" fillOpacity="0.25" filter="url(#re-blur-2)" />
          <rect x={x} y="118" width="58" height="22" rx="4" fill="url(#re-sofa-cushion)" />
        </g>
      ))}
      {arms.map((x) => (
        <rect key={x} x={x} y="104" width="14" height="44" rx="5" fill="url(#re-sofa-arm)" />
      ))}
      <rect x="176" y="98" width="22" height="20" rx="3" fill="url(#re-pillow)" transform="rotate(-8 187 108)" />
      {/* Блик от окна на левом подлокотнике и спинке. */}
      <rect x="152" y="104" width="6" height="44" rx="3" fill="#fff" fillOpacity="0.16" />
      <rect x="158" y="90" width="40" height="30" rx="6" fill="url(#re-sofa-light)" />
    </g>
  )
}

/** Растение в кашпо между окном и диваном. */
function Plant({ mode }: { mode: Mode }) {
  const leaves = [
    { cx: 129, cy: 122, rot: -38 },
    { cx: 138, cy: 116, rot: -6 },
    { cx: 147, cy: 123, rot: 34 },
    { cx: 134, cy: 130, rot: -70 },
    { cx: 143, cy: 131, rot: 66 },
  ]
  if (mode === "raw") {
    const p = rawPaint(1)
    return (
      <g {...p}>
        <path d="M127 138h20l-2 16h-16z" />
        <line x1="138" y1="138" x2="138" y2="128" />
        {leaves.map((leaf) => (
          <ellipse key={leaf.rot} cx={leaf.cx} cy={leaf.cy} rx="4.5" ry="9" transform={`rotate(${leaf.rot} ${leaf.cx} ${leaf.cy})`} />
        ))}
      </g>
    )
  }
  return (
    <g>
      <ellipse cx="138" cy="155" rx="13" ry="3" fill="#000" fillOpacity="0.4" filter="url(#re-blur-2)" />
      <path d="M127 138h20l-2 16h-16z" fill="url(#re-pot)" />
      <line x1="138" y1="138" x2="138" y2="128" stroke="#3c5a36" strokeWidth="1.6" />
      {leaves.map((leaf, i) => (
        <ellipse
          key={leaf.rot}
          cx={leaf.cx}
          cy={leaf.cy}
          rx="4.5"
          ry="9"
          fill={i % 2 ? "#4f7d48" : "#3d6538"}
          transform={`rotate(${leaf.rot} ${leaf.cx} ${leaf.cy})`}
        />
      ))}
    </g>
  )
}

/** Торшер справа. */
function Lamp({ mode }: { mode: Mode }) {
  if (mode === "raw") {
    const p = rawPaint(1)
    return (
      <g {...p}>
        <path d="M316 46h36l6 24h-48z" />
        <line x1="334" y1="70" x2="334" y2="150" />
        <ellipse cx="334" cy="151" rx="10" ry="3" />
      </g>
    )
  }
  return (
    <g>
      <ellipse cx="334" cy="152" rx="12" ry="3" fill="#000" fillOpacity="0.4" filter="url(#re-blur-2)" />
      <ellipse cx="334" cy="151" rx="10" ry="3" fill="#8a7a5e" />
      <line x1="334" y1="70" x2="334" y2="150" stroke="#b8a077" strokeWidth="2.2" strokeLinecap="round" />
      {/* Свечение абажура — под самим абажуром, чтобы читалось тепло. */}
      <circle className="re-glow" cx="334" cy="60" r="60" fill="url(#re-lamp-glow)" />
      <path d="M316 46h36l6 24h-48z" fill="url(#re-shade)" />
      <path d="M310 70h48" stroke="#fff3d6" strokeWidth="1.2" strokeOpacity="0.8" />
    </g>
  )
}

function Scene({ mode, className }: { mode: Mode; className?: string }) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" className={className} aria-hidden>
      {mode === "real" ? (
        <defs>
          <linearGradient id="re-wall" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#e6dccb" />
            <stop offset="0.5" stopColor="#bcb09f" />
            <stop offset="1" stopColor="#8d8374" />
          </linearGradient>
          <linearGradient id="re-floor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#6e563f" />
            <stop offset="1" stopColor="#3b2c21" />
          </linearGradient>
          <linearGradient id="re-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#b5d3ea" />
            <stop offset="1" stopColor="#f2e9d4" />
          </linearGradient>
          <linearGradient id="re-art" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#c2a684" />
            <stop offset="1" stopColor="#6e5a46" />
          </linearGradient>
          <linearGradient id="re-sofa-back" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#4f7263" />
            <stop offset="1" stopColor="#2f4a3d" />
          </linearGradient>
          <linearGradient id="re-sofa-seat" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3b5a4c" />
            <stop offset="1" stopColor="#243a2f" />
          </linearGradient>
          <linearGradient id="re-sofa-cushion" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5f8672" />
            <stop offset="1" stopColor="#3d5f4e" />
          </linearGradient>
          <linearGradient id="re-sofa-arm" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#496a5a" />
            <stop offset="1" stopColor="#2b4438" />
          </linearGradient>
          <linearGradient id="re-sofa-light" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0.22" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="re-pillow" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#e2c193" />
            <stop offset="1" stopColor="#b8905f" />
          </linearGradient>
          <linearGradient id="re-pot" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#c69573" />
            <stop offset="1" stopColor="#875a41" />
          </linearGradient>
          <linearGradient id="re-shade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f3e6c6" />
            <stop offset="1" stopColor="#d9c39a" />
          </linearGradient>
          <radialGradient id="re-lamp-glow">
            <stop offset="0" stopColor="#ffe3a6" stopOpacity="0.7" />
            <stop offset="1" stopColor="#ffe3a6" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="re-shaft" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff6dc" stopOpacity="0.7" />
            <stop offset="1" stopColor="#fff6dc" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="re-vignette" cx="0.5" cy="0.5" r="0.75">
            <stop offset="0.55" stopColor="#000" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.42" />
          </radialGradient>
          {[2, 3, 4, 8].map((r) => (
            <filter key={r} id={`re-blur-${r}`} x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation={r} />
            </filter>
          ))}
          {/* Зерно рендера — как «шлифовка» у металла в материалах. */}
          <filter id="re-grain" x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" />
            <feColorMatrix type="saturate" values="0" />
            <feComponentTransfer>
              <feFuncA type="table" tableValues="0 0.6" />
            </feComponentTransfer>
          </filter>
        </defs>
      ) : null}

      {mode === "raw" ? (
        <g>
          <line x1="0" y1={FLOOR} x2={W} y2={FLOOR} stroke="currentColor" strokeOpacity="0.5" strokeWidth="1.1" />
          <FloorGrid />
        </g>
      ) : (
        <g>
          <rect width={W} height={FLOOR} fill="url(#re-wall)" />
          <rect y={FLOOR} width={W} height={H - FLOOR} fill="url(#re-floor)" />
          {/* Доски пола в перспективе. */}
          <g stroke="#000" strokeOpacity="0.16" strokeWidth="1">
            {[-60, 20, 100, 180, 260, 340, 420].map((x) => (
              <line key={x} x1={x} y1={H} x2={180 + (x - 180) * 0.4} y2={FLOOR} />
            ))}
          </g>
          {/* Плинтус. */}
          <rect y={FLOOR - 4} width={W} height="4" fill="#d9cfbf" />
          <rect y={FLOOR} width={W} height="3" fill="#000" fillOpacity="0.28" />
          {/* Отражение окна на полу. */}
          <path d="M38 150h86l30 70H8z" fill="#fff" fillOpacity="0.16" filter="url(#re-blur-4)" />
        </g>
      )}

      <Window mode={mode} />
      <Picture mode={mode} />
      <Plant mode={mode} />
      <Sofa mode={mode} />
      <Lamp mode={mode} />

      {mode === "real" ? (
        <g>
          {/* Луч света из окна на пол — «дышит». */}
          <path className="re-shaft" d="M124 34L124 126L318 220L172 220z" fill="url(#re-shaft)" filter="url(#re-blur-8)" />
          <rect width={W} height={H} filter="url(#re-grain)" opacity="0.14" style={{ mixBlendMode: "overlay" }} />
          <rect width={W} height={H} fill="url(#re-vignette)" />
        </g>
      ) : null}
    </svg>
  )
}

export function RenderReveal({ className }: { className?: string }) {
  return (
    <div className={cn("re-frame", className)} aria-hidden>
      <Scene mode="raw" className="re-layer re-raw" />
      <span className="re-tag re-tag-raw">cg · исходник</span>

      <div className="re-reveal">
        <Scene mode="real" className="re-layer" />
        <span className="re-tag re-tag-real">результат</span>
      </div>

      {/* Шторка: линия по правому краю обёртки, ручка со стрелками. */}
      <div className="re-edge">
        <span className="re-line" />
        <span className="re-handle">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 8l-4 4 4 4M14 8l4 4-4 4" />
          </svg>
        </span>
      </div>
    </div>
  )
}
