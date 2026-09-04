"use client"

import { makeRng } from "@/lib/seeded-rng"
import type { EnhanceContext } from "@/types"

/**
 * Заселение сцены — ПРЕДПРОСМОТР, а не продукт.
 *
 * Настоящее заселение (люди, растения и декор, вписанные в свет и перспективу
 * кадра) — работа серверной модели, см. README «Куда добавлять новый
 * инструмент». Пока провайдера нет, движок рисует стаффаж: плоские силуэты
 * людей и растений в масштабе кадра — так на эскизах архитекторы показывают
 * масштаб и жизнь в пространстве. Состав зависит от контекста: интерьеру —
 * люди и растение в кадке, экстерьеру — прохожие и дерево, предметной съёмке —
 * только веточка в углу.
 */

type Ctx = CanvasRenderingContext2D

const SILHOUETTE = "rgba(18, 18, 22, 0.66)"
const FOLIAGE = "rgba(46, 70, 52, 0.78)"
const POT = "rgba(58, 52, 46, 0.82)"
const SHADOW = "rgba(0, 0, 0, 0.28)"

/** Мягкая тень под ногами/кадкой: эллипс с растушёвкой. */
function shadow(ctx: Ctx, x: number, y: number, rx: number, ry: number) {
  const gradient = ctx.createRadialGradient(x, y, 0, x, y, rx)
  gradient.addColorStop(0, SHADOW)
  gradient.addColorStop(1, "rgba(0, 0, 0, 0)")
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(1, ry / rx)
  ctx.translate(-x, -y)
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(x, y, rx, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()
}

/**
 * Силуэт стоящего человека высотой `h`, ноги в точке (x, footY).
 * `stride` — шаг: 0 — стоит, 1 — идёт; `facing` — куда повёрнут (±1).
 */
function person(ctx: Ctx, x: number, footY: number, h: number, stride: number, facing: number) {
  const headR = h * 0.068
  const shoulder = h * 0.19
  const hip = h * 0.13
  shadow(ctx, x, footY, h * 0.22, h * 0.05)

  ctx.save()
  ctx.translate(x, footY)
  ctx.scale(facing, 1)
  ctx.fillStyle = SILHOUETTE

  // Голова.
  ctx.beginPath()
  ctx.arc(0, -h + headR, headR, 0, Math.PI * 2)
  ctx.fill()
  // Шея и торс — трапеция от плеч к бёдрам.
  const neckY = -h + headR * 2 + h * 0.01
  const shoulderY = neckY + h * 0.05
  const hipY = -h * 0.46
  ctx.beginPath()
  ctx.moveTo(-headR * 0.45, neckY)
  ctx.lineTo(headR * 0.45, neckY)
  ctx.lineTo(shoulder / 2, shoulderY)
  ctx.lineTo(hip / 2, hipY)
  ctx.lineTo(-hip / 2, hipY)
  ctx.lineTo(-shoulder / 2, shoulderY)
  ctx.closePath()
  ctx.fill()
  // Руки — узкие полосы от плеч, одна чуть вперёд.
  const arm = h * 0.045
  ctx.save()
  ctx.lineCap = "round"
  ctx.lineWidth = arm
  ctx.strokeStyle = SILHOUETTE
  ctx.beginPath()
  ctx.moveTo(-shoulder / 2 + arm / 2, shoulderY + arm / 2)
  ctx.lineTo(-shoulder / 2 - h * 0.03 * stride, hipY + h * 0.02)
  ctx.moveTo(shoulder / 2 - arm / 2, shoulderY + arm / 2)
  ctx.lineTo(shoulder / 2 + h * 0.05 * stride, hipY - h * 0.02)
  ctx.stroke()
  // Ноги: вместе или в шаге.
  ctx.lineWidth = h * 0.06
  ctx.beginPath()
  ctx.moveTo(-hip / 4, hipY)
  ctx.lineTo(-hip / 4 - h * 0.09 * stride, 0)
  ctx.moveTo(hip / 4, hipY)
  ctx.lineTo(hip / 4 + h * 0.07 * stride, -h * 0.01)
  ctx.stroke()
  ctx.restore()
  ctx.restore()
}

/** Растение в кадке высотой `h`, дно кадки в (x, baseY). */
function pottedPlant(ctx: Ctx, rand: () => number, x: number, baseY: number, h: number) {
  const potH = h * 0.28
  const potW = h * 0.3
  shadow(ctx, x, baseY, potW * 0.9, potW * 0.18)
  ctx.fillStyle = POT
  ctx.beginPath()
  ctx.moveTo(x - potW / 2, baseY - potH)
  ctx.lineTo(x + potW / 2, baseY - potH)
  ctx.lineTo(x + potW * 0.4, baseY)
  ctx.lineTo(x - potW * 0.4, baseY)
  ctx.closePath()
  ctx.fill()

  // Листья веером из горловины: узкие эллипсы под разными углами.
  const topY = baseY - potH
  const leaves = 6 + Math.floor(rand() * 4)
  ctx.fillStyle = FOLIAGE
  for (let i = 0; i < leaves; i += 1) {
    const angle = -Math.PI / 2 + (i / (leaves - 1) - 0.5) * 1.9 + (rand() - 0.5) * 0.2
    const len = h * (0.45 + rand() * 0.3)
    ctx.save()
    ctx.translate(x, topY)
    ctx.rotate(angle)
    ctx.beginPath()
    ctx.ellipse(len / 2, 0, len / 2, h * 0.055, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}

/** Дерево высотой `h`: ствол и крона из трёх кругов. */
function tree(ctx: Ctx, rand: () => number, x: number, baseY: number, h: number) {
  shadow(ctx, x, baseY, h * 0.28, h * 0.05)
  ctx.fillStyle = POT
  ctx.fillRect(x - h * 0.03, baseY - h * 0.45, h * 0.06, h * 0.45)
  ctx.fillStyle = FOLIAGE
  const crown: [number, number, number][] = [
    [0, -h * 0.68, h * 0.3],
    [-h * 0.18, -h * 0.5, h * 0.22],
    [h * 0.2, -h * 0.52, h * 0.24],
  ]
  for (const [dx, dy, r] of crown) {
    ctx.beginPath()
    ctx.arc(x + dx + (rand() - 0.5) * h * 0.04, baseY + dy, r, 0, Math.PI * 2)
    ctx.fill()
  }
}

export function populateScene(
  ctx: Ctx,
  width: number,
  height: number,
  { context, seed }: { context: EnhanceContext; seed: string }
) {
  const rand = makeRng(`populate:${seed}`)
  const side = rand() > 0.5 ? 1 : -1
  const edgeX = (fraction: number) => (side > 0 ? width * fraction : width * (1 - fraction))

  ctx.save()
  ctx.filter = "none"
  ctx.globalCompositeOperation = "source-over"

  switch (context) {
    case "exterior": {
      // Прохожие мельче и дальше от края, дерево — у одного из краёв.
      tree(ctx, rand, edgeX(0.1), height * (0.9 + rand() * 0.06), height * 0.56)
      const walkers = 2 + Math.floor(rand() * 2)
      for (let i = 0; i < walkers; i += 1) {
        const footY = height * (0.82 + rand() * 0.14)
        const h = height * (0.14 + (footY / height - 0.82) * 0.7)
        person(ctx, width * (0.3 + rand() * 0.45), footY, h, rand() > 0.4 ? 1 : 0, rand() > 0.5 ? 1 : -1)
      }
      break
    }
    case "product": {
      // Предметной съёмке люди ни к чему — только веточка в углу.
      pottedPlant(ctx, rand, edgeX(0.12), height * 0.96, height * 0.2)
      break
    }
    default: {
      // Интерьер (и «авто»): двое людей, один ближе и выше ростом, и растение в кадке.
      const nearFoot = height * (0.9 + rand() * 0.06)
      person(ctx, width * (0.6 + rand() * 0.15), nearFoot, height * 0.36, 0, side)
      const farFoot = height * (0.78 + rand() * 0.06)
      person(ctx, width * (0.22 + rand() * 0.16), farFoot, height * 0.27, 1, -side)
      pottedPlant(ctx, rand, edgeX(0.09), height * 0.97, height * 0.3)
    }
  }

  ctx.restore()
}
