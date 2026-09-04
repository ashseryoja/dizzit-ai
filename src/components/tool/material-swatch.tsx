"use client"

import { useId } from "react"

import type { SwatchMaterial } from "@/lib/restyle-engine"

/**
 * Образец материала: маленький SVG-тайл с фактурой — кирпич с раствором, доски
 * с волокном, паркет ёлочкой, бетон с раковинами, мрамор с прожилками, лён,
 * бархат, кожа, ротанг, латунь, плитка, букле, овчина, сетка, кортен, лампа
 * Эдисона, бамбук, сёдзи, татами, мох… Цвет задаёт тон, фактура рисуется его
 * светлыми и тёмными оттенками, чтобы образец читался и на светлых, и на
 * тёмных материалах.
 */

const S = 20

function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "")
  const full = value.length === 3 ? value.split("").map((c) => c + c).join("") : value
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** Сдвиг тона к белому (amount > 0) или к чёрному (amount < 0). */
function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex)
  const target = amount > 0 ? 255 : 0
  const k = Math.abs(amount)
  const mix = (channel: number) => Math.round(channel + (target - channel) * k)
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`
}

type Tones = { color: string; light: string; dark: string; soft: string; dim: string; id: string }

/* Диагональная штриховка: две семьи линий, вниз-вправо и вверх-вправо. */
function Diagonals({ stroke, opacity, width, up = false }: { stroke: string; opacity: number; width: number; up?: boolean }) {
  const d = up
    ? "M-2 16l6 6M-2 10l12 12M-2 4l18 18M4 -2l18 18M10 -2l12 12M16 -2l6 6"
    : "M-2 4l6-6M-2 10l12-12M-2 16l18-18M4 22l18-18M10 22l12-12M16 22l6-6"
  return <path d={d} fill="none" stroke={stroke} strokeOpacity={opacity} strokeWidth={width} />
}

function Dots({ points, r, fill, opacity }: { points: [number, number][]; r: number; fill: string; opacity: number }) {
  return (
    <g fill={fill} fillOpacity={opacity}>
      {points.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r={r} />
      ))}
    </g>
  )
}

/* Горизонтальные линии через шаг. */
function Rows({ step, stroke, opacity, width, offset = 0 }: { step: number; stroke: string; opacity: number; width: number; offset?: number }) {
  const ys: number[] = []
  for (let y = offset; y <= S; y += step) ys.push(y)
  return (
    <g stroke={stroke} strokeOpacity={opacity} strokeWidth={width}>
      {ys.map((y) => (
        <line key={y} x1="0" y1={y} x2={S} y2={y} />
      ))}
    </g>
  )
}

function Sheen({ id, from, to, angle = true }: { id: string; from: string; to: string; angle?: boolean }) {
  return (
    <>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2={angle ? "1" : "0"}>
          <stop offset="0" stopColor={from} stopOpacity="0.6" />
          <stop offset="0.5" stopColor={from} stopOpacity="0" />
          <stop offset="1" stopColor={to} stopOpacity="0.5" />
        </linearGradient>
      </defs>
      <rect width={S} height={S} fill={`url(#${id})`} />
    </>
  )
}

function texture(material: SwatchMaterial, t: Tones): React.ReactNode {
  const { color, light, dark, soft, dim, id } = t
  switch (material) {
    case "plaster":
      return (
        <g fill={light} fillOpacity="0.5">
          <ellipse cx="6" cy="7" rx="5" ry="3.5" />
          <ellipse cx="14" cy="14" rx="5.5" ry="3" fill={dim} fillOpacity="0.35" />
          <ellipse cx="15" cy="5" rx="3" ry="2" />
        </g>
      )
    case "molding":
      return (
        <g fill="none" strokeWidth="1">
          <rect x="3" y="3" width="14" height="14" stroke={dark} strokeOpacity="0.45" />
          <rect x="5" y="5" width="10" height="10" stroke={light} strokeOpacity="0.9" />
        </g>
      )
    case "brick":
      return (
        <g fill={color}>
          <rect width={S} height={S} fill={dark} />
          {[0, 5, 10, 15].map((y, row) =>
            [-4, 4, 12].map((x) => (
              <rect key={`${y}-${x}`} x={x + (row % 2 ? 4 : 0)} y={y + 0.6} width="7.2" height="3.8" />
            ))
          )}
        </g>
      )
    case "concrete":
      return (
        <g>
          <ellipse cx="5" cy="6" rx="4" ry="2.5" fill={light} fillOpacity="0.22" />
          <ellipse cx="14" cy="13" rx="4.5" ry="3" fill={dark} fillOpacity="0.2" />
          <Dots points={[[3, 14], [9, 4], [16, 7], [12, 17], [7, 10]]} r={0.7} fill={dark} opacity={0.55} />
        </g>
      )
    case "planks":
      return (
        <g stroke={dark} strokeOpacity="0.5" strokeWidth="0.8">
          <line x1="0" y1="5" x2={S} y2="5" />
          <line x1="0" y1="10" x2={S} y2="10" />
          <line x1="0" y1="15" x2={S} y2="15" />
          <line x1="7" y1="5" x2="7" y2="10" />
          <line x1="14" y1="10" x2="14" y2="15" />
          <line x1="4" y1="15" x2="4" y2="20" />
          <path d="M1 2.5c4 0 6 1 10 1M9 7.5c3 0 5 1 8 1M2 12.5c3 0 5 1 8 1M10 17.5c3 0 5 1 8 1" stroke={dim} strokeOpacity="0.6" strokeWidth="0.6" fill="none" />
        </g>
      )
    case "herringbone":
      return (
        <g>
          <Diagonals stroke={dark} opacity={0.55} width={0.9} />
          <Diagonals stroke={dark} opacity={0.3} width={0.9} up />
        </g>
      )
    case "chevron":
      return (
        <path d="M0 6l5-4 5 4 5-4 5 4M0 12l5-4 5 4 5-4 5 4M0 18l5-4 5 4 5-4 5 4" fill="none" stroke={dark} strokeOpacity="0.55" strokeWidth="1" />
      )
    case "checker":
      return (
        <g fill={light} fillOpacity="0.85">
          <rect x="0" y="0" width="10" height="10" />
          <rect x="10" y="10" width="10" height="10" />
        </g>
      )
    case "marble":
      return (
        <g fill="none" strokeWidth="0.8" strokeLinecap="round">
          <path d="M-1 4c4 2 5 6 9 7s6 5 13 5" stroke={light} strokeOpacity="0.75" />
          <path d="M2 18c3-3 4-7 9-8s5-4 10-7" stroke={light} strokeOpacity="0.4" strokeWidth="0.5" />
          <path d="M12 -1c-1 4 2 6 1 9" stroke={dark} strokeOpacity="0.45" strokeWidth="0.5" />
        </g>
      )
    case "stone":
      return <path d="M0 8h8l3-4h9M8 8v12M12 4v7h8M3 20v-6h5" fill="none" stroke={dark} strokeOpacity="0.45" strokeWidth="0.8" />
    case "slate":
      return (
        <g stroke={dark} strokeOpacity="0.5" strokeWidth="0.8" fill="none">
          <path d="M0 4h9l2 1h9M0 9h5l3-1h12M0 14h12l2 1h6M0 18h8l1-1h11" />
          <path d="M0 6h6M12 11h8M0 16h4" stroke={light} strokeOpacity="0.5" strokeWidth="0.5" />
        </g>
      )
    case "cobble":
      return (
        <g fill={color} stroke={dark} strokeOpacity="0.6" strokeWidth="0.8">
          <rect width={S} height={S} fill={dark} stroke="none" />
          <ellipse cx="4" cy="4" rx="4" ry="3" />
          <ellipse cx="13" cy="5" rx="5" ry="3.5" />
          <ellipse cx="6" cy="12" rx="5" ry="3.5" />
          <ellipse cx="15" cy="13" rx="4" ry="3" />
          <ellipse cx="9" cy="19" rx="5" ry="3" />
          <ellipse cx="18" cy="19" rx="3" ry="2.5" />
        </g>
      )
    case "terrazzo":
      return (
        <g>
          <Dots points={[[4, 5], [13, 3], [8, 12], [17, 9]]} r={1.4} fill={dark} opacity={0.5} />
          <Dots points={[[15, 16], [3, 15], [10, 7]]} r={1.1} fill="#b77a5a" opacity={0.7} />
          <Dots points={[[6, 18], [18, 4], [12, 17]]} r={0.9} fill="#4a6b70" opacity={0.7} />
          <Dots points={[[2, 9], [16, 12]]} r={0.8} fill={light} opacity={0.9} />
        </g>
      )
    case "tile":
      return (
        <g fill={color}>
          <rect width={S} height={S} fill={light} fillOpacity="0.9" />
          {[0.8, 10.4].map((y) => [0.8, 10.4].map((x) => <rect key={`${x}-${y}`} x={x} y={y} width="8.8" height="8.8" rx="0.5" />))}
          <rect x="3" y="3" width="4.4" height="4.4" fill={light} fillOpacity="0.35" />
          <rect x="12.6" y="12.6" width="4.4" height="4.4" fill={light} fillOpacity="0.35" />
        </g>
      )
    case "terracotta":
      return (
        <g fill={color}>
          <rect width={S} height={S} fill={dark} fillOpacity="0.8" />
          {[0.6, 7.2, 13.8].map((y, row) =>
            [-5, 5.2, 15.4].map((x) => <rect key={`${y}-${x}`} x={x + (row % 2 ? 5 : 0)} y={y} width="9.4" height="5.8" rx="0.6" />)
          )}
        </g>
      )
    case "mosaic":
      return (
        <g>
          <rect width={S} height={S} fill={light} fillOpacity="0.8" />
          {[0, 1, 2, 3].map((r) =>
            [0, 1, 2, 3].map((c) => (
              <rect
                key={`${r}-${c}`}
                x={c * 5 + 0.6}
                y={r * 5 + 0.6}
                width="3.8"
                height="3.8"
                fill={(r + c) % 3 === 0 ? soft : (r + c) % 3 === 1 ? color : dim}
              />
            ))
          )}
        </g>
      )
    case "ceramic":
      return (
        <g>
          <ellipse cx="7" cy="6" rx="5" ry="3" fill={light} fillOpacity="0.55" />
          <path d="M2 15q8 6 16 0" fill="none" stroke={dark} strokeOpacity="0.4" strokeWidth="1" />
          <path d="M3 3q3-2 6-1" fill="none" stroke="#fff" strokeOpacity="0.7" strokeWidth="1" strokeLinecap="round" />
        </g>
      )
    case "linen":
      return (
        <g stroke={light} strokeOpacity="0.35" strokeWidth="0.6">
          {[2, 6, 10, 14, 18].map((v) => (
            <g key={v}>
              <line x1="0" y1={v} x2={S} y2={v} />
              <line x1={v} y1="0" x2={v} y2={S} stroke={dark} strokeOpacity="0.3" />
            </g>
          ))}
        </g>
      )
    case "jute":
      return (
        <g strokeWidth="1.6">
          {[2, 7, 12, 17].map((v) => (
            <g key={v}>
              <line x1="0" y1={v} x2={S} y2={v} stroke={dark} strokeOpacity="0.32" />
              <line x1={v} y1="0" x2={v} y2={S} stroke={light} strokeOpacity="0.32" />
            </g>
          ))}
        </g>
      )
    case "velvet":
      return (
        <>
          <Sheen id={`${id}-v`} from={light} to={dark} />
          <path d="M3 16c3-3 5-8 8-13" stroke={light} strokeOpacity="0.35" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        </>
      )
    case "silk":
      return (
        <>
          <Sheen id={`${id}-s`} from="#ffffff" to={dark} />
          <path d="M-2 14q6-10 12-4t12-4" fill="none" stroke="#fff" strokeOpacity="0.5" strokeWidth="1.2" />
        </>
      )
    case "boucle":
      return (
        <g fill="none" strokeWidth="0.9">
          {[
            [3, 3], [9, 4], [15, 3], [5, 9], [12, 9], [18, 10], [3, 15], [9, 16], [15, 15], [7, 19], [17, 19],
          ].map(([x, y], i) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" stroke={i % 2 ? dark : light} strokeOpacity={i % 2 ? 0.45 : 0.8} />
          ))}
        </g>
      )
    case "fur":
      return (
        <g fill="none" strokeWidth="0.7" strokeLinecap="round">
          {[
            [2, 6], [6, 3], [10, 7], [14, 3], [18, 6], [4, 12], [8, 15], [12, 12], [16, 15], [2, 18], [19, 18], [10, 19],
          ].map(([x, y], i) => (
            <path key={`${x}-${y}`} d={`M${x} ${y}q1.5-3 3-4`} stroke={i % 2 ? dark : light} strokeOpacity={i % 2 ? 0.4 : 0.85} />
          ))}
        </g>
      )
    case "leather":
      return (
        <g>
          <ellipse cx="6" cy="6" rx="5" ry="3.5" fill={light} fillOpacity="0.28" />
          <Dots points={[[3, 12], [8, 15], [13, 9], [16, 15], [11, 3], [17, 4], [5, 17]]} r={0.6} fill={dark} opacity={0.5} />
          <line x1="0" y1="13" x2={S} y2="13" stroke={dark} strokeOpacity="0.35" strokeWidth="0.8" />
        </g>
      )
    case "rattan":
      return (
        <g>
          <Diagonals stroke={dark} opacity={0.45} width={1.1} />
          <Diagonals stroke={light} opacity={0.5} width={1.1} up />
        </g>
      )
    case "cane":
      return (
        <g fill="none" strokeWidth="0.8">
          <Diagonals stroke={dark} opacity={0.4} width={0.8} />
          <Diagonals stroke={dark} opacity={0.4} width={0.8} up />
          {[3, 10, 17].map((x) => (
            <line key={x} x1={x} y1="0" x2={x} y2={S} stroke={light} strokeOpacity="0.7" />
          ))}
        </g>
      )
    case "rope":
      return (
        <g strokeWidth="2.6" strokeLinecap="round">
          <path d="M-2 8l6-6M-2 16l12-12M4 22l14-14M12 22l10-10" stroke={light} strokeOpacity="0.55" />
          <path d="M-2 12l10-10M2 20l16-16M10 22l12-12" stroke={dark} strokeOpacity="0.5" />
        </g>
      )
    case "macrame":
      return (
        <g fill="none" strokeWidth="0.9" strokeLinecap="round">
          <path d="M3 3l4 4M7 3l-4 4M11 3l4 4M15 3l-4 4M5 8l4 4M9 8l-4 4M13 8l4 4M17 8l-4 4" stroke={dark} strokeOpacity="0.5" />
          {[3, 6, 9, 12, 15, 18].map((x) => (
            <line key={x} x1={x} y1="13" x2={x} y2={x % 2 ? 19 : 17} stroke={dark} strokeOpacity="0.45" />
          ))}
        </g>
      )
    case "gingham":
      return (
        <g fill={dark} fillOpacity="0.28">
          <rect x="3" y="0" width="5" height={S} />
          <rect x="13" y="0" width="5" height={S} />
          <rect x="0" y="3" width={S} height="5" />
          <rect x="0" y="13" width={S} height="5" />
        </g>
      )
    case "lace":
      return (
        <g fill="none" stroke={dark} strokeOpacity="0.35" strokeWidth="0.6">
          {[[5, 5], [15, 5], [10, 12], [5, 18], [15, 18]].map(([x, y]) => (
            <g key={`${x}-${y}`}>
              <circle cx={x} cy={y} r="3" />
              <circle cx={x} cy={y} r="1.2" />
            </g>
          ))}
        </g>
      )
    case "floral":
      return (
        <g fill={light} fillOpacity="0.85">
          {[[5, 6], [14, 5], [9, 14], [16, 15]].map(([x, y]) => (
            <g key={`${x}-${y}`}>
              <circle cx={x - 1.4} cy={y} r="1.1" />
              <circle cx={x + 1.4} cy={y} r="1.1" />
              <circle cx={x} cy={y - 1.4} r="1.1" />
              <circle cx={x} cy={y + 1.4} r="1.1" />
              <circle cx={x} cy={y} r="0.8" fill={dark} />
            </g>
          ))}
        </g>
      )
    case "wallpaper":
      return (
        <g fill="none" stroke={dark} strokeOpacity="0.45" strokeWidth="0.8">
          <path d="M5 2l3 4-3 4-3-4zM15 2l3 4-3 4-3-4zM10 9l3 4-3 4-3-4zM5 16l3 4-3 4-3-4zM15 16l3 4-3 4-3-4z" />
          <Dots points={[[5, 6], [15, 6], [10, 13]]} r={0.7} fill={light} opacity={0.9} />
        </g>
      )
    case "rug":
      return (
        <g fill="none" stroke={light} strokeOpacity="0.7" strokeWidth="0.8">
          <rect x="1.5" y="1.5" width="17" height="17" />
          <rect x="3.5" y="3.5" width="13" height="13" strokeOpacity="0.35" />
          <path d="M10 6l4 4-4 4-4-4z" fill={light} fillOpacity="0.5" />
        </g>
      )
    case "metal":
      return (
        <g strokeWidth="0.7">
          {[1, 3, 5, 7, 9, 11, 13, 15, 17, 19].map((y, i) => (
            <line key={y} x1="0" y1={y} x2={S} y2={y} stroke={i % 2 ? dark : light} strokeOpacity={i % 2 ? 0.35 : 0.45} />
          ))}
          <rect x="0" y="6" width={S} height="4" fill={light} fillOpacity="0.35" />
        </g>
      )
    case "iron":
      return (
        <g>
          <ellipse cx="6" cy="5" rx="5" ry="2.5" fill={light} fillOpacity="0.16" />
          <Dots points={[[4, 15], [16, 15]]} r={1.3} fill={light} opacity={0.35} />
          <Dots points={[[4, 15], [16, 15]]} r={0.6} fill={dark} opacity={0.8} />
        </g>
      )
    case "pipe":
      return (
        <g>
          <rect x="0" y="3" width={S} height="6" rx="3" fill={light} fillOpacity="0.3" />
          <rect x="0" y="4.5" width={S} height="1.5" fill="#fff" fillOpacity="0.35" />
          <rect x="0" y="12" width={S} height="6" rx="3" fill={light} fillOpacity="0.3" />
          <rect x="0" y="13.5" width={S} height="1.5" fill="#fff" fillOpacity="0.35" />
          <rect x="7" y="2" width="2.5" height="8" fill={dark} fillOpacity="0.6" />
          <rect x="12" y="11" width="2.5" height="8" fill={dark} fillOpacity="0.6" />
        </g>
      )
    case "mesh":
      return (
        <g>
          <Diagonals stroke={light} opacity={0.6} width={0.7} />
          <Diagonals stroke={light} opacity={0.6} width={0.7} up />
        </g>
      )
    case "rust":
      return (
        <g>
          <ellipse cx="6" cy="6" rx="5" ry="3.5" fill={dark} fillOpacity="0.45" />
          <ellipse cx="14" cy="12" rx="5" ry="4" fill={light} fillOpacity="0.35" />
          <ellipse cx="7" cy="16" rx="3.5" ry="2.5" fill={dark} fillOpacity="0.35" />
          <Dots points={[[16, 4], [3, 11], [11, 18]]} r={0.8} fill={dark} opacity={0.6} />
        </g>
      )
    case "glass":
      return (
        <>
          <Sheen id={`${id}-g`} from={light} to={dark} />
          <line x1="4" y1="20" x2="20" y2="4" stroke={light} strokeOpacity="0.8" strokeWidth="1.2" />
          <line x1="0" y1="20" x2="14" y2="6" stroke={light} strokeOpacity="0.35" strokeWidth="0.6" />
        </>
      )
    case "mirror":
      return (
        <>
          <Sheen id={`${id}-m`} from="#ffffff" to={dark} />
          <path d="M2 20l16-16M8 20l12-12" stroke="#fff" strokeOpacity="0.55" strokeWidth="1.6" />
        </>
      )
    case "lacquer":
      return (
        <>
          <defs>
            <radialGradient id={`${id}-l`} cx="0.3" cy="0.25" r="0.7">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
              <stop offset="1" stopColor={dark} stopOpacity="0.35" />
            </radialGradient>
          </defs>
          <rect width={S} height={S} fill={`url(#${id}-l)`} />
        </>
      )
    case "bulb":
      return (
        <>
          <defs>
            <radialGradient id={`${id}-b`} cx="0.5" cy="0.5" r="0.5">
              <stop offset="0" stopColor="#fff4cf" stopOpacity="1" />
              <stop offset="0.5" stopColor={color} stopOpacity="0.9" />
              <stop offset="1" stopColor="#2b241c" stopOpacity="1" />
            </radialGradient>
          </defs>
          <rect width={S} height={S} fill="#2b241c" />
          <circle cx="10" cy="11" r="8" fill={`url(#${id}-b)`} />
          <path d="M7 12q1.5-3 3-1t3-1" fill="none" stroke="#b8742e" strokeWidth="0.8" />
          <rect x="8" y="1" width="4" height="3" fill="#6a6a6a" />
        </>
      )
    case "neon":
      return (
        <>
          <defs>
            <filter id={`${id}-n`} x="-30%" y="-100%" width="160%" height="300%">
              <feGaussianBlur stdDeviation="1.6" />
            </filter>
          </defs>
          <rect width={S} height={S} fill="#1c1c20" />
          <rect x="2" y="9" width="16" height="2" rx="1" fill={color} fillOpacity="0.8" filter={`url(#${id}-n)`} />
          <rect x="2" y="9.5" width="16" height="1" rx="0.5" fill={color} />
        </>
      )
    case "bamboo":
      return (
        <g>
          {[3, 9, 15].map((x) => (
            <g key={x}>
              <rect x={x} y="0" width="3.5" height={S} rx="1" fill={light} fillOpacity="0.35" />
              <line x1={x} y1={x === 9 ? 12 : 7} x2={x + 3.5} y2={x === 9 ? 12 : 7} stroke={dark} strokeOpacity="0.6" strokeWidth="0.8" />
              <line x1={x + 0.6} y1="0" x2={x + 0.6} y2={S} stroke={dark} strokeOpacity="0.3" strokeWidth="0.5" />
            </g>
          ))}
        </g>
      )
    case "paper":
      return (
        <g>
          <Rows step={3} stroke={dark} opacity={0.12} width={0.5} offset={1.5} />
          <Dots points={[[4, 5], [14, 9], [8, 15], [17, 17]]} r={0.5} fill={dark} opacity={0.3} />
        </g>
      )
    case "shoji":
      return (
        <g stroke={dark} strokeOpacity="0.6" strokeWidth="0.9" fill="none">
          <path d="M0 7h20M0 13h20M7 0v20M13 0v20" />
        </g>
      )
    case "tatami":
      return (
        <g>
          <Rows step={2} stroke={dark} opacity={0.25} width={0.5} offset={1} />
          <rect x="0" y="0" width={S} height="2.5" fill={dark} fillOpacity="0.55" />
          <rect x="0" y="17.5" width={S} height="2.5" fill={dark} fillOpacity="0.55" />
        </g>
      )
    case "cork":
      return (
        <g>
          <Dots points={[[3, 3], [8, 6], [14, 3], [18, 8], [5, 11], [11, 12], [16, 15], [3, 17], [9, 18], [13, 8]]} r={1} fill={dark} opacity={0.35} />
          <Dots points={[[6, 8], [12, 4], [17, 12], [8, 15], [3, 14]]} r={0.7} fill={light} opacity={0.6} />
        </g>
      )
    case "moss":
      return (
        <g>
          <Dots points={[[3, 4], [8, 3], [13, 5], [18, 3], [5, 9], [10, 8], [15, 10], [3, 14], [8, 13], [13, 15], [18, 14], [6, 18], [11, 18], [16, 19]]} r={1.6} fill={light} opacity={0.45} />
          <Dots points={[[6, 6], [11, 11], [16, 7], [4, 17], [14, 18]]} r={1.2} fill={dark} opacity={0.4} />
        </g>
      )
    default:
      return <ellipse cx="6" cy="5" rx="5" ry="3" fill={light} fillOpacity="0.18" />
  }
}

export function MaterialSwatch({
  material,
  color,
  title,
  size = "sm",
}: {
  material: SwatchMaterial
  color: string
  title?: string
  /** «lg» — крупный образец для секции над композером. */
  size?: "sm" | "lg"
}) {
  const id = useId()
  const tones: Tones = {
    color,
    light: shade(color, 0.28),
    dark: shade(color, -0.32),
    soft: shade(color, 0.12),
    dim: shade(color, -0.14),
    id,
  }

  return (
    <svg
      viewBox={`0 0 ${S} ${S}`}
      className={size === "lg" ? "swatch swatch-lg" : "swatch"}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title ? <title>{title}</title> : null}
      <rect width={S} height={S} fill={color} />
      {texture(material, tones)}
    </svg>
  )
}
