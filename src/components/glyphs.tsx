/**
 * SVG-глифы системы. Монохром, только stroke.
 *
 * У каждого рисуемого элемента pathLength={1} — это нормализует длину контура,
 * и одна пара dasharray/dashoffset в CSS «дорисовывает» и линию, и окружность.
 */

/** Вращающийся разомкнутый контур — «ИИ думает». */
export function ThinkingGlyph({
  size = 16,
  className,
}: {
  size?: number
  className?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray="0.72 0.28"
        className="glyph-spin"
      />
      <circle cx="12" cy="12" r="2.2" fill="currentColor" className="glyph-pulse" />
    </svg>
  )
}

/**
 * «Редактор рендера» — кадр с горизонтом и карандаш в правом нижнем углу.
 * Сигнатура совпадает с иконками lucide (className / strokeWidth), чтобы
 * глиф вставал в те же слоты навигации.
 */
export function RenderEditorGlyph({
  className,
  strokeWidth = 1.7,
}: {
  className?: string
  strokeWidth?: number
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {/* Рамка кадра, разомкнутая под карандаш. */}
      <path d="M11 20H5.5A2.5 2.5 0 0 1 3 17.5v-11A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5V11" />
      {/* Горизонт и солнце. */}
      <path d="M3 16.5l4.4-4.4a1.5 1.5 0 0 1 2.1 0L13 15.6" />
      <circle cx="15.5" cy="8.5" r="1.5" />
      {/* Карандаш. */}
      <path d="M19.6 13.4a1.6 1.6 0 0 1 2.3 2.3L16.4 21.2H14v-2.4l5.6-5.4z" />
    </svg>
  )
}

/**
 * Приглашение к загрузке для пустого экрана инструмента: кадр с горизонтом,
 * сверху в него «ныряет» стрелка, вокруг расходятся кольца. Анимации — в
 * .dz-* (surfaces.css), там же они отключаются при reduced-motion.
 */
export function DropInviteGlyph({ size = 96, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 96 96"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {/* Расходящиеся кольца — два с разной фазой. */}
      <circle className="dz-ring" cx="48" cy="48" r="30" />
      <circle className="dz-ring" cx="48" cy="48" r="30" />

      {/* Кадр: верхняя кромка разомкнута под стрелку. */}
      <path d="M40 30H34a6 6 0 0 0-6 6v24a6 6 0 0 0 6 6h28a6 6 0 0 0 6-6V36a6 6 0 0 0-6-6h-6" />
      {/* Горизонт и солнце. */}
      <path d="M28 58l8.5-8.5a3 3 0 0 1 4.2 0L52 61" />
      <path d="M46 55l4.6-4.6a3 3 0 0 1 4.2 0L62 58" strokeOpacity="0.7" />
      <circle cx="58" cy="41" r="3" />

      {/* Стрелка, ныряющая в кадр. */}
      <g className="dz-arrow">
        <path d="M48 14v20" />
        <path d="M41 28l7 7 7-7" />
      </g>
    </svg>
  )
}

/** «Фото → 3D»: кадр фотографии, из которого выходит куб. */
export function PhotoToCubeGlyph({
  className,
  strokeWidth = 1.7,
}: {
  className?: string
  strokeWidth?: number
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {/* Кадр фото, разомкнутый под куб. */}
      <path d="M9 15H4.5A1.5 1.5 0 0 1 3 13.5v-8A1.5 1.5 0 0 1 4.5 4h9A1.5 1.5 0 0 1 15 5.5V8" />
      <path d="M3 12.5l3-3a1 1 0 0 1 1.4 0L9 11" />
      <circle cx="11" cy="7.5" r="1" />
      {/* Куб. */}
      <path d="M16 9.2l5 2.6v5.4l-5 2.8-5-2.8v-5.4l5-2.6z" />
      <path d="M11 11.8l5 2.7 5-2.7M16 14.5V20" />
    </svg>
  )
}
