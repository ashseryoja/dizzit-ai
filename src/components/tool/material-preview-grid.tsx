"use client"

import { Sparkles } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * Превью-сетка пустого экрана «Генерация материала»: пять живых SVG-заготовок
 * (дерево, мрамор, сталь, лён, терраццо) в раскладке будущей галереи плюс
 * слот «ваш материал». Узоры рисуются процедурно и детерминированно —
 * при каждом рендере одинаковые. Анимации — в .mp-* (surfaces.css).
 * Заготовки — не кнопки: клик по ним ничего не запускает.
 */

/** Маленький детерминированный ГПСЧ (mulberry32): узоры не «прыгают». */
function rng(seed: number) {
  let t = seed >>> 0
  return () => {
    t = (t + 0x6d2b79f5) >>> 0
    let x = Math.imul(t ^ (t >>> 15), 1 | t)
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

const VIEW = 200

/* ── Дерево: волокна дуба, медленно плывут вбок ─────────────────── */
function WoodTile() {
  const random = rng(11)
  const lines: string[] = []
  for (let i = 0; i < 18; i += 1) {
    const y = -6 + i * 12.5 + random() * 4
    const a = 3 + random() * 7
    // Волокно шире тайла: при дрейфе края не оголяются.
    lines.push(
      `M-120 ${y} C -60 ${y - a}, 0 ${y + a}, 60 ${y} S 180 ${y - a}, 240 ${y} S 360 ${y + a}, 420 ${y}`
    )
  }
  return (
    <svg viewBox={`0 0 ${VIEW} ${VIEW}`} preserveAspectRatio="xMidYMid slice" className="mp-svg" aria-hidden>
      <rect width={VIEW} height={VIEW} fill="#7f5b3d" />
      <g className="mp-drift" fill="none" strokeLinecap="round">
        {lines.map((d, i) => (
          <path
            key={d}
            d={d}
            stroke={i % 3 === 0 ? "#5a3b25" : "#6a4830"}
            strokeWidth={i % 4 === 0 ? 2.6 : 1.3}
            strokeOpacity={0.55 + (i % 3) * 0.12}
          />
        ))}
        {/* Сучок */}
        <g transform="translate(138 118)">
          <ellipse rx="19" ry="12" stroke="#4d3220" strokeWidth="1.6" strokeOpacity="0.7" />
          <ellipse rx="12" ry="7" stroke="#4d3220" strokeWidth="1.4" strokeOpacity="0.6" />
          <ellipse rx="5" ry="3" fill="#4d3220" fillOpacity="0.6" />
        </g>
      </g>
    </svg>
  )
}

/* ── Мрамор: прожилки дорисовываются, облака слегка дышат ────────── */
function MarbleTile() {
  const veins = [
    "M-10 40 C 40 60, 60 20, 110 50 S 170 110, 230 90",
    "M20 210 C 50 150, 90 170, 120 120 S 160 40, 215 10",
    "M-10 150 C 30 140, 50 170, 90 160 S 150 190, 210 175",
    "M60 -10 C 70 30, 40 60, 55 95 S 100 130, 80 210",
  ]
  return (
    <svg viewBox={`0 0 ${VIEW} ${VIEW}`} preserveAspectRatio="xMidYMid slice" className="mp-svg" aria-hidden>
      <defs>
        <filter id="mp-blur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>
      <rect width={VIEW} height={VIEW} fill="#e2dfd9" />
      <g filter="url(#mp-blur)" className="mp-breathe">
        <ellipse cx="60" cy="70" rx="70" ry="38" fill="#cbc6be" />
        <ellipse cx="150" cy="150" rx="60" ry="46" fill="#d3cec6" />
        <ellipse cx="140" cy="40" rx="40" ry="24" fill="#c4bfb7" />
      </g>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {veins.map((d, i) => (
          <path
            key={d}
            d={d}
            className="mp-vein"
            style={{ animationDelay: `${i * 0.9}s` }}
            pathLength={1}
            stroke="#7f7a74"
            strokeOpacity={i % 2 ? 0.5 : 0.8}
            strokeWidth={i % 2 ? 0.9 : 1.6}
          />
        ))}
      </g>
    </svg>
  )
}

/* ── Полированная сталь: анизотропный шум и бесшовно плывущие блики ── */
function MetalTile() {
  // Две копии бликов со сдвигом на ширину кадра: группа едет на -VIEW и
  // возвращается в исходное положение без видимого стыка.
  const glints = (
    <>
      <rect x="28" y="-40" width="44" height="280" fill="url(#mp-glint)" transform="skewX(-14)" />
      <rect x="118" y="-40" width="16" height="280" fill="url(#mp-glint)" opacity="0.55" transform="skewX(-14)" />
      <rect x="158" y="-40" width="26" height="280" fill="url(#mp-glint)" opacity="0.35" transform="skewX(-14)" />
    </>
  )
  return (
    <svg viewBox={`0 0 ${VIEW} ${VIEW}`} preserveAspectRatio="xMidYMid slice" className="mp-svg" aria-hidden>
      <defs>
        <linearGradient id="mp-steel" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3b3e45" />
          <stop offset="0.45" stopColor="#737780" />
          <stop offset="0.7" stopColor="#4c4f57" />
          <stop offset="1" stopColor="#5d616a" />
        </linearGradient>
        <linearGradient id="mp-glint" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0.42" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        {/* Вытянутый по горизонтали шум — «шлифовка» металла. */}
        <filter id="mp-brush" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.9" numOctaves="3" seed="4" />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="table" tableValues="0 0.9" />
          </feComponentTransfer>
        </filter>
        <filter id="mp-soft-blur" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
      </defs>
      <rect width={VIEW} height={VIEW} fill="url(#mp-steel)" />
      <rect width={VIEW} height={VIEW} filter="url(#mp-brush)" opacity="0.55" style={{ mixBlendMode: "overlay" }} />
      <g className="mp-glide" filter="url(#mp-soft-blur)">
        <g>{glints}</g>
        <g transform={`translate(${VIEW} 0)`}>{glints}</g>
      </g>
    </svg>
  )
}

/* ── Бархат: ворс из мелкого шума, свет медленно гуляет по кругу ─── */
function VelvetTile() {
  return (
    <svg viewBox={`0 0 ${VIEW} ${VIEW}`} preserveAspectRatio="xMidYMid slice" className="mp-svg" aria-hidden>
      <defs>
        <filter id="mp-pile" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="2" seed="9" />
          <feColorMatrix type="saturate" values="0" />
          <feComponentTransfer>
            <feFuncA type="table" tableValues="0 0.8" />
          </feComponentTransfer>
        </filter>
        <filter id="mp-velvet-blur" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="18" />
        </filter>
        <radialGradient id="mp-velvet-light">
          <stop offset="0" stopColor="#9ed3b6" stopOpacity="0.75" />
          <stop offset="1" stopColor="#9ed3b6" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={VIEW} height={VIEW} fill="#2b4a3c" />
      {/* Складка-заломы: широкие тёмные диагонали. */}
      <g filter="url(#mp-velvet-blur)" opacity="0.8">
        <ellipse cx="40" cy="170" rx="110" ry="34" fill="#11271c" transform="rotate(-32 40 170)" />
        <ellipse cx="185" cy="40" rx="90" ry="26" fill="#12291e" transform="rotate(-32 185 40)" />
      </g>
      <g className="mp-velvet-glow">
        <ellipse cx="0" cy="0" rx="110" ry="80" fill="url(#mp-velvet-light)" />
      </g>
      <rect width={VIEW} height={VIEW} filter="url(#mp-pile)" opacity="0.22" style={{ mixBlendMode: "overlay" }} />
    </svg>
  )
}

/* ── Терраццо: крошка проявляется по очереди ─────────────────────── */
function TerrazzoTile() {
  const random = rng(23)
  const palette = ["#8e8b86", "#5b5e63", "#b39c7c", "#6b7c6e", "#c9b4a3", "#3e4045"]
  const chips: { x: number; y: number; r: number; k: number; c: string; rot: number }[] = []
  for (let i = 0; i < 46; i += 1) {
    chips.push({
      x: random() * VIEW,
      y: random() * VIEW,
      r: 3 + random() * 9,
      k: 0.55 + random() * 0.45,
      c: palette[Math.floor(random() * palette.length)],
      rot: random() * 180,
    })
  }
  return (
    <svg viewBox={`0 0 ${VIEW} ${VIEW}`} preserveAspectRatio="xMidYMid slice" className="mp-svg" aria-hidden>
      <rect width={VIEW} height={VIEW} fill="#d6d1c8" />
      {chips.map((chip, i) => (
        /* Поворот — на группе: CSS-анимация масштаба перекрыла бы атрибут transform. */
        <g key={i} transform={`rotate(${chip.rot} ${chip.x} ${chip.y})`}>
          <ellipse
            className="mp-chip"
            style={{ animationDelay: `${(i % 12) * 0.25}s`, transformOrigin: `${chip.x}px ${chip.y}px` }}
            cx={chip.x}
            cy={chip.y}
            rx={chip.r}
            ry={chip.r * chip.k}
            fill={chip.c}
            fillOpacity="0.85"
          />
        </g>
      ))}
    </svg>
  )
}

interface PreviewTile {
  key: string
  caption: string
  render: () => React.ReactNode
}

const TILES: PreviewTile[] = [
  { key: "wood", caption: "дерево · дуб натуральный", render: WoodTile },
  { key: "stone", caption: "камень · мрамор с прожилками", render: MarbleTile },
  { key: "metal", caption: "металл · сталь полированная", render: MetalTile },
  { key: "fabric", caption: "ткань · бархат зелёный", render: VelvetTile },
  { key: "terrazzo", caption: "камень · терраццо", render: TerrazzoTile },
]

export function MaterialPreviewGrid({
  onActivate,
  className,
}: {
  /** Клик по слоту «ваш материал» — фокус на поле описания; ничего не генерирует. */
  onActivate?: () => void
  className?: string
}) {
  return (
    <div className={cn("grid w-full grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4", className)}>
      {TILES.map((tile, index) => (
        <figure
          key={tile.key}
          className="mp-tile card relative aspect-square overflow-hidden"
          style={{ borderRadius: "var(--r-lg)", animationDelay: `${index * 90}ms` }}
        >
          <tile.render />
          <figcaption
            className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-2 rounded-[8px] px-2 py-1 text-[11px]"
            style={{ background: "rgba(16,16,18,0.62)", color: "rgba(255,255,255,0.9)" }}
          >
            <span className="truncate">{tile.caption}</span>
            <span className="shrink-0 text-[10px] uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.5)" }}>
              пример
            </span>
          </figcaption>
        </figure>
      ))}

      <button
        type="button"
        onClick={onActivate}
        className="mp-tile mp-slot flex aspect-square flex-col items-center justify-center gap-3 p-4 text-center"
        style={{ borderRadius: "var(--r-lg)", animationDelay: `${TILES.length * 90}ms` }}
      >
        <svg className="mp-slot-outline" aria-hidden>
          <rect width="100%" height="100%" rx="17" />
        </svg>
        <span
          className="relative flex h-11 w-11 items-center justify-center rounded-full"
          style={{ background: "var(--bg-raised)", border: "1px solid var(--line-strong)" }}
        >
          <Sparkles className="mp-slot-spark h-[18px] w-[18px]" strokeWidth={1.6} style={{ color: "var(--fg-2)" }} />
        </span>
        <span className="relative flex flex-col gap-1">
          <span className="text-[13.5px]" style={{ color: "var(--fg-1)" }}>
            Ваш материал
          </span>
          <span className="text-[11.5px] leading-snug" style={{ color: "var(--fg-4)" }}>
            Опишите его в строке внизу — заготовки сменятся вашими тайлами
          </span>
        </span>
      </button>
    </div>
  )
}
