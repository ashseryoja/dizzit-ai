"use client"

import { RoomSketch } from "@/components/tool/room-sketch"
import { cn } from "@/lib/utils"

/**
 * Приглашение пустого экрана «Ракурсы и детали» — карусель из одного рендера:
 * слева общий план, справа кадры, которые из него получают, — деталь крупно,
 * вид сверху, фрагмент и фактура. Кадры — вырезки того же эскиза (viewBox),
 * поэтому видно, что это одна сцена. По общему плану ходит рамка и показывает,
 * откуда вырезан кадр, подсвеченный в этот момент; счётчики «2/5» — как в
 * карусели. Анимации — в .vo-* (surfaces.css), там же отключаются при
 * reduced-motion.
 */
export function ViewsInvite({ className }: { className?: string }) {
  return (
    <div className={cn("vo", className)} aria-hidden>
      <div className="vo-overview">
        <RoomSketch mode="paint" />
        <span className="vo-scan" />
        <span className="vo-chip">общий план</span>
        <span className="vo-count">1/5</span>
      </div>
      <div className="vo-grid">
        <div className="vo-tile vo-t1">
          <RoomSketch mode="paint" viewBox="96 42 48 60" />
          <span className="vo-chip">деталь</span>
          <span className="vo-count">2/5</span>
        </div>
        <div className="vo-tile vo-t2">
          <RoomSketch mode="paint" className="vo-topview" />
          <span className="vo-chip">сверху</span>
          <span className="vo-count">3/5</span>
        </div>
        <div className="vo-tile vo-t3">
          <RoomSketch mode="paint" viewBox="140 36 48 60" />
          <span className="vo-chip">фрагмент</span>
          <span className="vo-count">4/5</span>
        </div>
        <div className="vo-tile vo-t4">
          <RoomSketch mode="paint" viewBox="18 86 32 40" />
          <span className="vo-chip">фактура</span>
          <span className="vo-count">5/5</span>
        </div>
      </div>
    </div>
  )
}
