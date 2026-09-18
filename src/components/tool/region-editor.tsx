"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Brush, ChevronDown, ChevronsUpDown, Lasso, SquareDashed, Trash2, Undo2, X } from "lucide-react"

import {
  BRUSH_HALF_WIDTH,
  BRUSH_HALF_WIDTH_MAX,
  BRUSH_HALF_WIDTH_MIN,
  BRUSH_HALF_WIDTH_STEP,
  clampBrushHalfWidth,
  countRegionPoints,
  decimateRegionPoints,
  getRegionBounds,
  isRegionMeaningful,
  REGION_COMMENT_MAX_LENGTH,
  REGION_MAX_COUNT,
  REGION_MAX_POINTS,
  REGION_MAX_STROKES,
  resolveBrushStroke,
  type EditRegion,
  type RegionPoint,
  type RegionShape,
} from "@/lib/render-regions"
import { cn, createId } from "@/lib/utils"

/**
 * Холст точечной правки поверх рендера на сцене. Перенос редактора обложек
 * UpSound (`cover-region-editor.tsx`) на нашу дизайн-систему.
 *
 * Отдельного режима рисования нет: сцена И ЕСТЬ рабочая поверхность — ведёшь по
 * кадру и получаешь область с подписью, пишешь в композер и получаешь правку
 * целиком. От случайных штрихов защищает не режим, а порог `isRegionMeaningful`.
 *
 * Область показывает МАТОВАЯ МАСКА: полупрозрачное светлое тело, мягкая тёмная
 * тень по краю и волосяная светлая кромка — читается и на светлом, и на тёмном
 * рендере. Толщиной кисти человек управляет сам (ползунок, `[` и `]`), выбор
 * переживает перезаход; у нарисованной области своя толщина, ползунок её не
 * трогает. Shift дорисовывает мазок к последней области кистью.
 *
 * Компонент накрывает РОВНО отрисованный кадр (родитель — бокс размером с
 * картинку), поэтому координаты областей нормализованы к изображению.
 */

const TOOLS: Array<{ shape: RegionShape; label: string; hint?: string; Icon: typeof Brush }> = [
  {
    shape: "brush",
    label: "Кисть",
    hint: "Кисть · ещё раз — толщина · [ и ] — тоньше и толще · Shift — добавить мазок к последней области",
    Icon: Brush,
  },
  { shape: "lasso", label: "Обводка", Icon: Lasso },
  { shape: "rect", label: "Рамка", Icon: SquareDashed },
]

const BRUSH_STORAGE_KEY = "dizzit-brush-half-width"
const BRUSH_PREVIEW_MS = 1100
const BRUSH_PERSIST_DELAY_MS = 250
const NON_TEXT_INPUT_TYPES = new Set(["range", "checkbox", "radio", "button", "submit"])
const POPOVER_FALLBACK = { width: 280, height: 132 }

function appendBudget(region: EditRegion): number {
  return REGION_MAX_POINTS - countRegionPoints(region)
}

/** Дорисовать мазок можно только к кисти, пока не исчерпаны мазки и точки. */
function canAppendStroke(region: EditRegion): boolean {
  return region.shape === "brush" && region.strokes.length < REGION_MAX_STROKES && appendBudget(region) >= 2
}

interface DraftRegion {
  shape: RegionShape
  points: RegionPoint[]
  /** Штрих дорисовывается к существующей области (зажат Shift), а не создаёт новую. */
  appendToId?: string
}

export function RegionEditor({
  regions,
  onRegionsChange,
  disabled = false,
}: {
  regions: EditRegion[]
  onRegionsChange: (regions: EditRegion[]) => void
  /** Обработка в полёте или набор из нескольких рендеров — холст заморожен. */
  disabled?: boolean
}) {
  const rootRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const layerRef = useRef<HTMLCanvasElement | null>(null)
  const [tool, setTool] = useState<RegionShape>("brush")
  const [activeId, setActiveId] = useState<string | null>(null)
  const [toolbarAtBottom, setToolbarAtBottom] = useState(false)
  const [drawing, setDrawing] = useState(false)
  const [brushHalfWidth, setBrushHalfWidth] = useState(BRUSH_HALF_WIDTH)
  const [brushPanelOpen, setBrushPanelOpen] = useState(false)
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 })
  const [brushPreview, setBrushPreview] = useState(false)
  const previewTimerRef = useRef<number | null>(null)

  // Черновик штриха живёт в ref: точек приходят сотни, и ререндер на каждое
  // движение указателя рвал бы линию.
  const draftRef = useRef<DraftRegion | null>(null)
  const frameRef = useRef<number | null>(null)
  const pointerIdRef = useRef<number | null>(null)
  // Без захвата указателя pointerup за краем холста не придёт — штрих закрывает уход с холста.
  const capturedRef = useRef(false)

  // Толщина переживает перезаход: читаем после монтирования, localStorage на сервере нет.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(BRUSH_STORAGE_KEY)
      if (stored !== null) setBrushHalfWidth(clampBrushHalfWidth(Number(stored)))
    } catch {
      // Приватный режим: работаем на значении по умолчанию.
    }
  }, [])

  const firstWriteRef = useRef(true)
  useEffect(() => {
    if (firstWriteRef.current) {
      firstWriteRef.current = false
      return
    }
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(BRUSH_STORAGE_KEY, String(brushHalfWidth))
      } catch {
        // Теряется только выбор между заходами.
      }
    }, BRUSH_PERSIST_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [brushHalfWidth])

  const hideBrushPreview = useCallback(() => {
    if (previewTimerRef.current !== null) {
      window.clearTimeout(previewTimerRef.current)
      previewTimerRef.current = null
    }
    setBrushPreview(false)
  }, [])

  const showBrushPreview = useCallback(() => {
    setBrushPreview(true)
    if (previewTimerRef.current !== null) window.clearTimeout(previewTimerRef.current)
    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = null
      setBrushPreview(false)
    }, BRUSH_PREVIEW_MS)
  }, [])

  const applyBrushHalfWidth = useCallback(
    (value: number) => {
      setBrushHalfWidth(clampBrushHalfWidth(value))
      showBrushPreview()
    },
    [showBrushPreview]
  )

  // Функциональное обновление: зажатая скобка шлёт события быстрее рендера.
  const stepBrushHalfWidth = useCallback(
    (delta: number) => {
      setBrushHalfWidth((previous) => clampBrushHalfWidth(previous + delta))
      showBrushPreview()
    },
    [showBrushPreview]
  )

  useEffect(() => {
    if (!disabled) return
    setBrushPanelOpen(false)
    setActiveId(null)
    hideBrushPreview()
  }, [disabled, hideBrushPreview])

  useEffect(
    () => () => {
      if (previewTimerRef.current !== null) window.clearTimeout(previewTimerRef.current)
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
    },
    []
  )

  const shownHalfWidth = clampBrushHalfWidth(
    resolveBrushStroke(Math.min(frameSize.width, frameSize.height), brushHalfWidth).halfWidth
  )
  const brushRatio = (shownHalfWidth - BRUSH_HALF_WIDTH_MIN) / (BRUSH_HALF_WIDTH_MAX - BRUSH_HALF_WIDTH_MIN)
  const brushDotSize = 5 + brushRatio * 7

  const limitReached = regions.length >= REGION_MAX_COUNT
  const lastRegion = regions[regions.length - 1]
  const canAppendToLast = tool === "brush" && Boolean(lastRegion) && canAppendStroke(lastRegion)
  const activeRegion = regions.find((region) => region.id === activeId) ?? null

  const paint = useCallback(() => {
    const canvas = canvasRef.current
    const root = rootRef.current
    if (!canvas || !root) return
    const context = canvas.getContext("2d")
    if (!context) return

    const width = root.clientWidth
    const height = root.clientHeight
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    context.clearRect(0, 0, width, height)

    // Каждая область собирается на отдельном слое: середину полосы кисти мы
    // пробиваем destination-out, а он стирает ВСЁ под штрихом — на общем холсте
    // новый штрих выгрызал бы кайму у любой пересечённой области.
    const layer = layerRef.current ?? (layerRef.current = document.createElement("canvas"))
    if (layer.width !== canvas.width || layer.height !== canvas.height) {
      layer.width = canvas.width
      layer.height = canvas.height
    }
    const layerContext = layer.getContext("2d")
    layerContext?.setTransform(dpr, 0, 0, dpr, 0, 0)

    const draw = (shape: RegionShape, strokes: RegionPoint[][], isActive: boolean, regionHalfWidth?: number) => {
      const points = strokes.flat()
      if (points.length === 0) return
      const surface = layerContext ?? context
      const isolated = surface !== context
      surface.save()
      surface.lineJoin = "round"
      surface.lineCap = "round"

      const addStroke = (stroke: RegionPoint[]) => {
        if (shape === "rect") {
          const [start, end] = [stroke[0], stroke[stroke.length - 1]]
          surface.rect(
            Math.min(start.x, end.x) * width,
            Math.min(start.y, end.y) * height,
            Math.abs(end.x - start.x) * width,
            Math.abs(end.y - start.y) * height
          )
        } else {
          stroke.forEach((point, index) => {
            const x = point.x * width
            const y = point.y * height
            if (index === 0) surface.moveTo(x, y)
            else surface.lineTo(x, y)
          })
          if (shape === "lasso") surface.closePath()
        }
      }
      // ОДИН путь на все мазки: полупрозрачные полосы по очереди складывались бы
      // по альфе, и на нахлёсте кайма темнела.
      const traceAll = () => {
        surface.beginPath()
        for (const stroke of strokes) addStroke(stroke)
      }
      const strokePass = () => {
        traceAll()
        surface.stroke()
      }

      const frameSide = Math.min(width, height)
      const strokeWidth =
        shape === "brush"
          ? regionHalfWidth !== undefined
            ? regionHalfWidth * 2 * frameSide
            : resolveBrushStroke(frameSide, brushHalfWidth).strokePx
          : 2
      const alpha = isActive ? 1 : 0.62
      const edge = Math.max(1, frameSide * 0.0022)
      const shadowBlur = frameSide * 0.01

      const spread = strokeWidth / 2 + edge * 2 + 2
      const xs = points.map((point) => point.x * width)
      const ys = points.map((point) => point.y * height)
      const boxLeft = Math.max(0, Math.floor(Math.min(...xs) - spread))
      const boxTop = Math.max(0, Math.floor(Math.min(...ys) - spread))
      const boxWidth = Math.min(width, Math.ceil(Math.max(...xs) + spread)) - boxLeft
      const boxHeight = Math.min(height, Math.ceil(Math.max(...ys) + spread)) - boxTop
      if (boxWidth <= 0 || boxHeight <= 0) {
        surface.restore()
        return
      }
      if (isolated) surface.clearRect(boxLeft, boxTop, boxWidth, boxHeight)
      else {
        surface.shadowColor = `rgba(0,0,0,${(0.55 * alpha).toFixed(2)})`
        surface.shadowBlur = shadowBlur
      }

      // Сначала кромка, тело — под неё через destination-over: у кисти грани
      // ленты рождаются вычитанием узкой полосы из широкой.
      if (shape === "brush") {
        if (isolated) {
          surface.lineWidth = strokeWidth + edge * 2
          surface.strokeStyle = `rgba(0,0,0,${(0.55 * alpha).toFixed(2)})`
          strokePass()
          surface.globalCompositeOperation = "destination-out"
          surface.lineWidth = strokeWidth
          surface.strokeStyle = "rgba(0,0,0,1)"
          strokePass()
          surface.globalCompositeOperation = "source-over"
        }
        surface.lineWidth = strokeWidth
        surface.strokeStyle = `rgba(255,255,255,${(0.62 * alpha).toFixed(2)})`
        strokePass()
        if (isolated) {
          surface.globalCompositeOperation = "destination-out"
          surface.lineWidth = Math.max(0.5, strokeWidth - edge * 2)
          surface.strokeStyle = "rgba(0,0,0,1)"
          strokePass()
          surface.globalCompositeOperation = "source-over"
        }
        surface.globalCompositeOperation = "destination-over"
        surface.lineWidth = strokeWidth
        surface.strokeStyle = `rgba(255,255,255,${(isActive ? 0.26 : 0.15).toFixed(2)})`
        strokePass()
        surface.globalCompositeOperation = "source-over"
      } else {
        surface.lineWidth = edge * 4
        surface.strokeStyle = `rgba(0,0,0,${(0.5 * alpha).toFixed(2)})`
        strokePass()
        surface.lineWidth = edge * 2
        surface.strokeStyle = `rgba(255,255,255,${(0.62 * alpha).toFixed(2)})`
        strokePass()
        surface.globalCompositeOperation = "destination-over"
        traceAll()
        surface.fillStyle = `rgba(255,255,255,${(isActive ? 0.18 : 0.1).toFixed(2)})`
        surface.fill()
        surface.globalCompositeOperation = "source-over"
      }
      surface.restore()

      if (isolated) {
        const sx = Math.round(boxLeft * dpr)
        const sy = Math.round(boxTop * dpr)
        const sw = Math.round(boxWidth * dpr)
        const sh = Math.round(boxHeight * dpr)
        // Тень — на переносе, чтобы легла по обеим граням полосы.
        context.save()
        context.shadowColor = `rgba(0,0,0,${(0.55 * alpha).toFixed(2)})`
        context.shadowBlur = shadowBlur
        context.drawImage(layer, sx, sy, sw, sh, sx / dpr, sy / dpr, sw / dpr, sh / dpr)
        context.restore()
      }
    }

    const draft = draftRef.current
    regions.forEach((region) =>
      draw(
        region.shape,
        draft?.appendToId === region.id ? [...region.strokes, draft.points] : region.strokes,
        region.id === activeId,
        region.brushHalfWidth ?? BRUSH_HALF_WIDTH
      )
    )
    if (draft && !draft.appendToId) draw(draft.shape, [draft.points], true)

    // Образец толщины: одно касание кистью по центру кадра, пока крутят ползунок.
    if (brushPreview && !draft && !disabled && tool === "brush") {
      draw("brush", [[{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }]], true)
    }
  }, [regions, activeId, brushHalfWidth, brushPreview, disabled, tool])

  useEffect(() => {
    paint()
  }, [paint])

  // `[` и `]` — толщина кисти. По `code`, а не по `key`: на русской раскладке те
  // же клавиши дают «х» и «ъ».
  useEffect(() => {
    if (disabled || tool !== "brush") return
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && brushPanelOpen && !activeId) {
        event.preventDefault()
        event.stopPropagation()
        setBrushPanelOpen(false)
        return
      }
      const thinner = event.code === "BracketLeft" || event.key === "["
      const thicker = event.code === "BracketRight" || event.key === "]"
      if (!thinner && !thicker) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === "TEXTAREA" || target.isContentEditable)) return
      if (target && target.tagName === "INPUT" && !NON_TEXT_INPUT_TYPES.has((target as HTMLInputElement).type)) return
      event.preventDefault()
      stepBrushHalfWidth(thicker ? BRUSH_HALF_WIDTH_STEP : -BRUSH_HALF_WIDTH_STEP)
    }
    window.addEventListener("keydown", handleKey, true)
    return () => window.removeEventListener("keydown", handleKey, true)
  }, [activeId, brushPanelOpen, disabled, stepBrushHalfWidth, tool])

  // Наблюдатель за размером кадра — один раз; paint меняется на каждый символ подписи.
  const paintRef = useRef(paint)
  paintRef.current = paint
  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof ResizeObserver === "undefined") return
    const sync = () => {
      paintRef.current()
      setFrameSize((prev) =>
        prev.width === root.clientWidth && prev.height === root.clientHeight
          ? prev
          : { width: root.clientWidth, height: root.clientHeight }
      )
    }
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(root)
    return () => observer.disconnect()
  }, [])

  const scheduleRepaint = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      paint()
    })
  }, [paint])

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>): RegionPoint => {
    const rect = event.currentTarget.getBoundingClientRect()
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    }
  }

  const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return
    if (pointerIdRef.current !== null) return
    // Зажатый Shift дорисовывает к ПОСЛЕДНЕЙ области кистью; цель снимаем здесь же.
    const appendTarget = event.shiftKey && canAppendToLast ? lastRegion : undefined
    if (!appendTarget && limitReached) return
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
      capturedRef.current = true
    } catch {
      // Указатель уже отпущен (быстрый тап, стилус на границе кадра): захват не
      // обязателен — штрих закончится, когда указатель уйдёт с холста (onPointerLeave).
      capturedRef.current = false
    }
    pointerIdRef.current = event.pointerId
    setBrushPanelOpen(false)
    hideBrushPreview()
    // Во время штриха активной области нет: её поповер висел бы там, куда ведут мазок.
    setActiveId(null)
    draftRef.current = { shape: tool, points: [pointFromEvent(event)], appendToId: appendTarget?.id }
    setDrawing(true)
    scheduleRepaint()
  }

  const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const draft = draftRef.current
    if (!draft || pointerIdRef.current !== event.pointerId) return
    if (disabled) {
      draftRef.current = null
      pointerIdRef.current = null
      setDrawing(false)
      scheduleRepaint()
      return
    }
    const point = pointFromEvent(event)
    if (draft.shape === "rect") {
      draft.points = [draft.points[0], point]
    } else {
      const last = draft.points[draft.points.length - 1]
      if (Math.abs(point.x - last.x) + Math.abs(point.y - last.y) > 0.004) draft.points.push(point)
      if (draft.points.length > REGION_MAX_POINTS) draft.points = decimateRegionPoints(draft.points)
    }
    // Панель уступает дорогу, только когда штрих реально идёт под неё.
    if (point.y < 0.18) setToolbarAtBottom(true)
    else if (point.y > 0.82) setToolbarAtBottom(false)
    scheduleRepaint()
  }

  const discardStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (pointerIdRef.current !== event.pointerId) return
    draftRef.current = null
    pointerIdRef.current = null
    setDrawing(false)
    scheduleRepaint()
  }

  const finishStroke = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (pointerIdRef.current !== event.pointerId) return
    const draft = draftRef.current
    draftRef.current = null
    pointerIdRef.current = null
    setDrawing(false)
    if (!draft || disabled) return

    const target = draft.appendToId ? regions.find((region) => region.id === draft.appendToId) : undefined
    if (draft.appendToId && target && canAppendStroke(target)) {
      const stroke = decimateRegionPoints(draft.points, 0.006, appendBudget(target))
      if (!isRegionMeaningful({ ...target, strokes: [stroke] })) {
        scheduleRepaint()
        return
      }
      onRegionsChange(
        regions.map((region) => (region.id === target.id ? { ...region, strokes: [...region.strokes, stroke] } : region))
      )
      setActiveId(target.id)
      return
    }

    if (limitReached) {
      scheduleRepaint()
      return
    }

    const candidate: EditRegion = {
      id: createId(),
      shape: draft.shape,
      strokes: [draft.shape === "rect" ? draft.points : decimateRegionPoints(draft.points)],
      comment: "",
      ...(draft.shape === "brush"
        ? { brushHalfWidth: resolveBrushStroke(Math.min(frameSize.width, frameSize.height), brushHalfWidth).halfWidth }
        : {}),
    }
    if (!isRegionMeaningful(candidate)) {
      scheduleRepaint()
      return
    }
    onRegionsChange([...regions, candidate])
    setActiveId(candidate.id)
  }

  const updateRegionComment = (id: string, comment: string) => {
    onRegionsChange(regions.map((region) => (region.id === id ? { ...region, comment } : region)))
  }

  const removeRegion = (id: string) => {
    onRegionsChange(regions.filter((region) => region.id !== id))
    setActiveId((current) => (current === id ? null : current))
  }

  const undoLast = () => {
    const last = regions[regions.length - 1]
    if (!last) return
    // Отменяем последний МАЗОК, а не всю область.
    if (last.strokes.length > 1) {
      onRegionsChange(
        regions.map((region) => (region.id === last.id ? { ...region, strokes: region.strokes.slice(0, -1) } : region))
      )
      return
    }
    removeRegion(last.id)
  }

  // Позиция поповера — в пикселях по фактическому размеру, чтобы у края кадра
  // overflow не срезал поле подписи.
  const popoverRef = useRef<HTMLDivElement | null>(null)
  const [popoverBox, setPopoverBox] = useState(POPOVER_FALLBACK)
  useLayoutEffect(() => {
    if (!activeRegion) return
    const node = popoverRef.current
    if (!node?.offsetHeight) return
    setPopoverBox((prev) =>
      prev.width === node.offsetWidth && prev.height === node.offsetHeight
        ? prev
        : { width: node.offsetWidth, height: node.offsetHeight }
    )
  }, [activeRegion])

  const popoverPlacement = (() => {
    if (!activeRegion) return null
    const { width: frameWidth, height: frameHeight } = frameSize
    const bounds = getRegionBounds(activeRegion)
    const gap = 10
    const { width: popoverWidth, height: popoverHeight } = popoverBox
    // Под областью, если там есть место; иначе над ней.
    const below = bounds.y1 * frameHeight + gap
    const above = bounds.y0 * frameHeight - popoverHeight - gap
    const top = below + popoverHeight <= frameHeight - gap ? below : above
    const maxTop = Math.max(gap, frameHeight - popoverHeight - gap)
    const centerX = ((bounds.x0 + bounds.x1) / 2) * frameWidth
    const maxLeft = Math.max(gap, frameWidth - popoverWidth - gap)
    return {
      left: `${Math.min(Math.max(centerX - popoverWidth / 2, gap), maxLeft)}px`,
      top: `${Math.min(Math.max(top, gap), maxTop)}px`,
    }
  })()

  return (
    <div ref={rootRef} className="absolute inset-0">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 h-full w-full touch-none"
        style={{ cursor: disabled || (limitReached && !canAppendToLast) ? "default" : "crosshair" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishStroke}
        onPointerCancel={discardStroke}
        onLostPointerCapture={finishStroke}
        onPointerLeave={(event) => {
          if (!capturedRef.current) finishStroke(event)
        }}
      />

      {/* Номера областей. Пока открыт поповер, бейджи прячем: номер налезал бы на поле. */}
      {!activeRegion &&
        regions.map((region, index) => {
          const bounds = getRegionBounds(region)
          return (
            <button
              key={region.id}
              type="button"
              onClick={() => !disabled && setActiveId(region.id)}
              aria-label={`Область ${index + 1}${region.comment ? `: ${region.comment}` : " без подписи"}`}
              className={cn("rg-badge", region.comment.trim() && "is-labeled")}
              style={{
                left: `${((bounds.x0 + bounds.x1) / 2) * 100}%`,
                top: `${Math.max(bounds.y0 * 100 - 3, 4)}%`,
              }}
            >
              {index + 1}
            </button>
          )
        })}

      {/* Панель инструментов лежит на самом кадре; во время штриха гаснет. */}
      {!disabled ? (
        <div
          className={cn(
            "pointer-events-none absolute left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-2 transition-all duration-300",
            toolbarAtBottom ? "bottom-3 flex-col-reverse" : "top-3",
            drawing && "opacity-20"
          )}
        >
          <div className="rg-pill pointer-events-auto flex items-center gap-0.5 p-1">
            {TOOLS.map(({ shape, label, hint, Icon }) => (
              <button
                key={shape}
                type="button"
                onClick={() => {
                  // Первый тап выбирает инструмент, повторный по кисти раскрывает толщину.
                  if (tool !== shape) {
                    setTool(shape)
                    setBrushPanelOpen(false)
                    hideBrushPreview()
                    return
                  }
                  if (shape === "brush") setBrushPanelOpen((open) => !open)
                }}
                aria-label={label}
                aria-pressed={tool === shape}
                {...(shape === "brush" ? { "aria-expanded": brushPanelOpen } : {})}
                title={hint ?? label}
                className={cn("rg-tool", tool === shape && "is-active")}
              >
                {shape === "brush" ? (
                  // Кисть показывает свой размер: кружок 5…12 px, шеврон зовёт в настройку.
                  <span aria-hidden className="relative flex h-5 w-5 items-center justify-center">
                    <span className="rounded-full bg-current" style={{ width: brushDotSize, height: brushDotSize }} />
                    <ChevronDown
                      className="absolute -bottom-1.5 left-1/2 h-2 w-2 -translate-x-1/2 opacity-70"
                      strokeWidth={3.5}
                    />
                  </span>
                ) : (
                  <Icon className="h-4 w-4" strokeWidth={1.6} />
                )}
              </button>
            ))}

            <span aria-hidden className="rg-sep" />

            <button
              type="button"
              onClick={undoLast}
              disabled={regions.length === 0}
              aria-label="Отменить последний мазок"
              title="Отменить последний мазок"
              className="rg-tool"
            >
              <Undo2 className="h-4 w-4" strokeWidth={1.6} />
            </button>
            <button
              type="button"
              onClick={() => {
                onRegionsChange([])
                setActiveId(null)
              }}
              disabled={regions.length === 0}
              aria-label="Убрать все области"
              title="Убрать все области"
              className="rg-tool"
            >
              <Trash2 className="h-4 w-4" strokeWidth={1.6} />
            </button>
            <button
              type="button"
              onClick={() => setToolbarAtBottom((value) => !value)}
              aria-label="Перенести панель к другому краю"
              title="Перенести панель к другому краю"
              className="rg-tool"
            >
              <ChevronsUpDown className="h-4 w-4" strokeWidth={1.6} />
            </button>
          </div>

          {/* Толщина кисти — отдельная пилюля рядом с панелью. */}
          {brushPanelOpen && tool === "brush" ? (
            <div className="rg-pill pointer-events-auto flex w-[min(240px,60vw)] items-center gap-3 px-4 py-2">
              <span aria-hidden className="flex h-5 w-5 shrink-0 items-center justify-center">
                <span className="rounded-full" style={{ width: brushDotSize, height: brushDotSize, background: "rgba(255,255,255,0.7)" }} />
              </span>
              <div className="relative min-w-0 flex-1">
                <div aria-hidden className="rg-track">
                  <div className="rg-track-fill" style={{ width: `${brushRatio * 100}%` }} />
                </div>
                <input
                  type="range"
                  min={BRUSH_HALF_WIDTH_MIN}
                  max={BRUSH_HALF_WIDTH_MAX}
                  step={BRUSH_HALF_WIDTH_STEP}
                  value={brushHalfWidth}
                  aria-label="Толщина кисти"
                  onChange={(event) => applyBrushHalfWidth(Number(event.target.value))}
                  className="rg-range"
                />
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Подпись области вводится у самой области: «где» решено рисунком, текст отвечает на «что». */}
      {activeRegion && popoverPlacement ? (
        <div ref={popoverRef} className="rg-popover absolute z-30 w-[min(280px,86%)]" style={popoverPlacement}>
          <textarea
            autoFocus
            rows={2}
            value={activeRegion.comment}
            onChange={(event) => updateRegionComment(activeRegion.id, event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                setActiveId(null)
              }
              if (event.key === "Escape") {
                event.preventDefault()
                event.stopPropagation()
                setActiveId(null)
              }
            }}
            placeholder="Что сделать здесь: убрать, добавить, заменить…"
            maxLength={REGION_COMMENT_MAX_LENGTH}
            className="rg-textarea"
          />
          <div className="mt-3 flex items-center justify-between gap-2">
            <button type="button" onClick={() => removeRegion(activeRegion.id)} className="rg-link -ml-2">
              <X className="h-3 w-3" strokeWidth={1.8} />
              Убрать
            </button>
            <button type="button" onClick={() => setActiveId(null)} className="rg-done">
              Готово
            </button>
          </div>
        </div>
      ) : null}

      {limitReached && !disabled ? (
        <div
          className={cn(
            "rg-pill pointer-events-none absolute left-1/2 z-20 -translate-x-1/2 px-3 py-1.5 text-[11px]",
            toolbarAtBottom ? "top-3" : "bottom-3"
          )}
          style={{ color: "rgba(255,255,255,0.7)" }}
        >
          Больше {REGION_MAX_COUNT} областей за один запуск не получится
          {canAppendToLast ? " · Shift дорисует к последней" : ""}
        </div>
      ) : null}
    </div>
  )
}
