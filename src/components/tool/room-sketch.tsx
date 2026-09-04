import { cn } from "@/lib/utils"

/**
 * Эскиз комнаты в одноточечной перспективе: стены, окно, диван, ковёр,
 * растение и торшер. Один рисунок на два пустых экрана: «Ракурсы» показывают
 * его каркасом с разных точек, «Перенос стиля» — в цвете, перекрашивая
 * палитру. Все заливки — классами .rs-*, чтобы цветом управлял CSS.
 */
export function RoomSketch({
  mode,
  className,
  viewBox = "0 0 200 130",
}: {
  mode: "wire" | "paint"
  className?: string
  /** Вырезка из эскиза — так пустой экран «Ракурсы и детали» показывает крупные планы. */
  viewBox?: string
}) {
  const wire = mode === "wire"
  return (
    <svg
      viewBox={viewBox}
      className={cn("rs block h-full w-full", wire ? "rs-wire" : "rs-paint", className)}
      aria-hidden
      preserveAspectRatio="xMidYMid slice"
    >
      {/* Потолок, боковые стены, задняя стена, пол. */}
      <polygon className="rs-ceiling" points="0,0 200,0 152,30 48,30" />
      <polygon className="rs-wall" points="0,0 48,30 48,92 0,130" />
      <polygon className="rs-wall" points="200,0 152,30 152,92 200,130" />
      <rect className="rs-wall rs-back" x="48" y="30" width="104" height="62" />
      <polygon className="rs-floor" points="0,130 200,130 152,92 48,92" />
      {wire ? (
        /* Сетка пола — намёк на вьюпорт 3D-пакета. */
        <g className="rs-grid">
          <line x1="64" y1="92" x2="34" y2="130" />
          <line x1="88" y1="92" x2="76" y2="130" />
          <line x1="112" y1="92" x2="124" y2="130" />
          <line x1="136" y1="92" x2="166" y2="130" />
          <line x1="36" y1="101" x2="164" y2="101" />
          <line x1="22" y1="112" x2="178" y2="112" />
        </g>
      ) : null}

      {/* Окно на левой стене. */}
      <polygon className="rs-glass" points="12,32 34,44 34,88 12,98" />
      <line className="rs-mullion" x1="23" y1="38" x2="23" y2="93" />
      <line className="rs-mullion" x1="12" y1="65" x2="34" y2="66" />

      {/* Картина на задней стене. */}
      <rect className="rs-accent" x="66" y="44" width="26" height="18" rx="1" />

      {/* Диван у задней стены: спинка, сиденье, подлокотники. */}
      <rect className="rs-sofa" x="98" y="68" width="46" height="13" rx="3" />
      <rect className="rs-sofa" x="96" y="79" width="50" height="14" rx="3" />
      <rect className="rs-sofa" x="93" y="74" width="7" height="19" rx="2.5" />
      <rect className="rs-sofa" x="142" y="74" width="7" height="19" rx="2.5" />

      {/* Ковёр и столик. */}
      <ellipse className="rs-accent rs-rug" cx="100" cy="112" rx="44" ry="8" />
      <rect className="rs-wood" x="108" y="100" width="28" height="4" rx="1" />
      <line className="rs-wood-line" x1="111" y1="104" x2="111" y2="110" />
      <line className="rs-wood-line" x1="133" y1="104" x2="133" y2="110" />

      {/* Растение слева. */}
      <polygon className="rs-wood" points="28,114 44,114 42,127 30,127" />
      <ellipse className="rs-leaf" cx="36" cy="106" rx="4" ry="11" transform="rotate(-28 36 106)" />
      <ellipse className="rs-leaf" cx="36" cy="106" rx="4" ry="11" transform="rotate(18 36 106)" />
      <ellipse className="rs-leaf" cx="36" cy="104" rx="3.5" ry="10" transform="rotate(-4 36 104)" />

      {/* Торшер справа. */}
      <line className="rs-wood-line" x1="166" y1="66" x2="166" y2="114" />
      <ellipse className="rs-wood" cx="166" cy="114" rx="7" ry="2" />
      <polygon className="rs-shade" points="156,66 176,66 172,54 160,54" />
    </svg>
  )
}
