"use client"

import { cn } from "@/lib/utils"

const BASE = "/images/invite"

/** Кадры справа: подпись, файл и счётчик — как в карусели. */
const TILES = [
  { key: "t1", label: "деталь", src: `${BASE}/views-detail.jpg` },
  { key: "t2", label: "сверху", src: `${BASE}/views-top.jpg` },
  { key: "t3", label: "фрагмент", src: `${BASE}/views-fragment.jpg` },
  { key: "t4", label: "фактура", src: `${BASE}/views-texture.jpg` },
]

/**
 * Приглашение пустого экрана «Ракурсы и детали» — карусель из одного рендера:
 * слева общий план, справа кадры, которые из него получают, — деталь крупно,
 * вид сверху, фрагмент и фактура. Это настоящий сет, построенный сервисом по
 * рендеру спальни (`public/images/invite/views-*.jpg`): пустой экран показывает
 * результат, а не схему. По общему плану ходит рамка и показывает, откуда взят
 * кадр, подсвеченный в этот момент; счётчики «2/5» — как в карусели. Анимации —
 * в .vo-* (surfaces.css), там же отключаются при reduced-motion.
 */
export function ViewsInvite({ className }: { className?: string }) {
  return (
    <div className={cn("vo", className)} aria-hidden>
      <div className="vo-overview">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${BASE}/views-overview.jpg`} alt="" draggable={false} />
        <span className="vo-scan" />
        <span className="vo-chip">общий план</span>
        <span className="vo-count">1/5</span>
      </div>
      <div className="vo-grid">
        {TILES.map((tile, index) => (
          <div key={tile.key} className={cn("vo-tile", `vo-${tile.key}`)}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={tile.src} alt="" draggable={false} loading="lazy" />
            <span className="vo-chip">{tile.label}</span>
            <span className="vo-count">{index + 2}/5</span>
          </div>
        ))}
      </div>
    </div>
  )
}
