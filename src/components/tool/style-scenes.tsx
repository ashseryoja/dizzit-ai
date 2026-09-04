import type { RestyleFamily } from "@/lib/restyle-engine"

/**
 * Интерьеры одной и той же комнаты — по одному на каждый стиль каталога.
 * Геометрия общая (стены, окно слева, пол, место дивана), а всё остальное —
 * отделка, мебель, свет и декор — своё: так видно обещание инструмента,
 * планировка остаётся, меняется характер. Первые четыре крутятся в
 * приглашении пустого экрана, все двенадцать — в превью при наведении на
 * стиль в списке. Координаты — viewBox 200×130, как у RoomSketch.
 */

export type SceneStyle = RestyleFamily

const CEILING = "0,0 200,0 152,30 48,30"
const LEFT_WALL = "0,0 48,30 48,92 0,130"
const RIGHT_WALL = "200,0 152,30 152,92 200,130"
const FLOOR = "0,130 200,130 152,92 48,92"
const WINDOW = "12,32 34,44 34,88 12,98"
/* Пятно света из окна на полу и стене — атмосфера у каждого стиля своя. */
const LIGHT = "34,50 34,88 128,130 64,130"

function Shell({
  ceiling,
  wall,
  back,
  floor,
}: {
  ceiling: string
  wall: [string, string]
  back: string
  floor: string
}) {
  return (
    <>
      <polygon points={CEILING} fill={ceiling} />
      <polygon points={LEFT_WALL} fill={wall[0]} />
      <polygon points={RIGHT_WALL} fill={wall[1]} />
      <rect x="48" y="30" width="104" height="62" fill={back} />
      <polygon points={FLOOR} fill={floor} />
    </>
  )
}

/* Линии пола в перспективе — доски или плиты. */
function FloorLines({ stroke, opacity = 0.45 }: { stroke: string; opacity?: number }) {
  return (
    <g stroke={stroke} strokeOpacity={opacity} strokeWidth="0.8">
      <line x1="64" y1="92" x2="34" y2="130" />
      <line x1="88" y1="92" x2="76" y2="130" />
      <line x1="112" y1="92" x2="124" y2="130" />
      <line x1="136" y1="92" x2="166" y2="130" />
    </g>
  )
}

function Light({ id, color, opacity }: { id: string; color: string; opacity: number }) {
  return (
    <>
      <defs>
        <filter id={id} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" />
        </filter>
      </defs>
      <polygon points={LIGHT} fill={color} fillOpacity={opacity} filter={`url(#${id})`} />
    </>
  )
}

/* ── Скандинавский: белые стены, светлый дуб, простой диван, монстера ── */
function Scandi() {
  return (
    <>
      <Shell ceiling="#faf8f4" wall={["#efece5", "#e8e4dc"]} back="#f4f1ea" floor="#dccbae" />
      <FloorLines stroke="#c4b092" />
      <Light id="ss-light-scandi" color="#ffffff" opacity={0.32} />
      {/* Окно: белая рама, светлое небо. */}
      <polygon points={WINDOW} fill="#d3e2ea" />
      <polygon points={WINDOW} fill="none" stroke="#ffffff" strokeWidth="2.2" />
      <line x1="23" y1="38" x2="23" y2="93" stroke="#ffffff" strokeWidth="1.6" />
      <line x1="12" y1="65" x2="34" y2="66" stroke="#ffffff" strokeWidth="1.6" />
      {/* Постер в тонкой чёрной раме и часы. */}
      <rect x="62" y="42" width="24" height="18" fill="#ffffff" stroke="#2b2b2b" strokeWidth="0.8" />
      <circle cx="70" cy="51" r="4.5" fill="#dcb9a2" />
      <rect x="75" y="46" width="8" height="10" fill="#9fb2a5" />
      <circle cx="136" cy="49" r="5" fill="#ffffff" stroke="#2b2b2b" strokeWidth="0.8" />
      <line x1="136" y1="49" x2="136" y2="46" stroke="#2b2b2b" strokeWidth="0.7" />
      <line x1="136" y1="49" x2="138.5" y2="50" stroke="#2b2b2b" strokeWidth="0.7" />
      {/* Подвес: чёрный шнур и белый купол. */}
      <line x1="100" y1="30" x2="100" y2="44" stroke="#2b2b2b" strokeWidth="0.7" />
      <path d="M91 50a9 9 0 0 1 18 0z" fill="#f6f4ef" stroke="#2b2b2b" strokeWidth="0.6" />
      {/* Диван на тонких ножках, льняные подушки. */}
      <rect x="96" y="70" width="50" height="12" rx="4" fill="#b7bec5" />
      <rect x="94" y="80" width="54" height="12" rx="3" fill="#c4cad0" />
      <rect x="100" y="72" width="18" height="9" rx="2" fill="#e8e3da" />
      <rect x="124" y="72" width="18" height="9" rx="2" fill="#e8e3da" />
      <line x1="98" y1="92" x2="96" y2="99" stroke="#8a6a4d" strokeWidth="1.2" />
      <line x1="144" y1="92" x2="146" y2="99" stroke="#8a6a4d" strokeWidth="1.2" />
      {/* Столик, ковёр в полоску, монстера. */}
      <ellipse cx="160" cy="88" rx="8" ry="2.6" fill="#d9c6a5" />
      <line x1="160" y1="88" x2="160" y2="104" stroke="#8a6a4d" strokeWidth="1.2" />
      <ellipse cx="100" cy="112" rx="44" ry="8" fill="#e6e0d5" />
      <ellipse cx="100" cy="112" rx="34" ry="5.5" fill="none" stroke="#cfc7b8" strokeWidth="0.8" />
      <ellipse cx="100" cy="112" rx="20" ry="3" fill="none" stroke="#cfc7b8" strokeWidth="0.8" />
      <rect x="26" y="112" width="16" height="14" rx="1" fill="#f3f0ea" stroke="#d6d0c6" strokeWidth="0.6" />
      <ellipse cx="34" cy="104" rx="5" ry="11" fill="#6f8f6a" transform="rotate(-30 34 104)" />
      <ellipse cx="35" cy="103" rx="5" ry="11" fill="#7d9c76" transform="rotate(22 35 103)" />
      <ellipse cx="34" cy="101" rx="4" ry="10" fill="#5f7f5a" transform="rotate(-4 34 101)" />
    </>
  )
}

/* ── Неоклассика: молдинги, паркет, бархатный диван, люстра, портьеры ── */
function Neoclassic() {
  return (
    <>
      <Shell ceiling="#f3ede2" wall={["#e6dccb", "#dfd3c0"]} back="#ebe2d1" floor="#9a7352" />
      {/* Паркет ёлочкой: две семьи диагоналей. */}
      <g stroke="#b3895f" strokeOpacity="0.5" strokeWidth="0.7">
        {[48, 62, 76, 90, 104, 118, 132, 146].map((x) => (
          <line key={`a${x}`} x1={x} y1="92" x2={x + 26} y2="130" />
        ))}
        {[62, 76, 90, 104, 118, 132, 146, 160].map((x) => (
          <line key={`b${x}`} x1={x} y1="92" x2={x - 26} y2="130" />
        ))}
      </g>
      <Light id="ss-light-neo" color="#f2c98b" opacity={0.3} />
      {/* Карниз и молдинги на стенах. */}
      <polygon points="48,30 152,30 152,33.5 48,33.5" fill="#f7f2e8" />
      <g fill="none" stroke="#d3c3a6" strokeWidth="0.9">
        <rect x="56" y="41" width="26" height="40" />
        <rect x="59" y="44" width="20" height="34" />
        <rect x="118" y="41" width="26" height="40" />
        <rect x="121" y="44" width="20" height="34" />
        <polygon points="160,44 192,26 192,94 160,80" />
        <polygon points="164,48 188,32 188,88 164,77" />
      </g>
      {/* Окно с портьерами и золотым карнизом. */}
      <polygon points={WINDOW} fill="#cfdbe4" />
      <polygon points={WINDOW} fill="none" stroke="#f4eee2" strokeWidth="1.6" />
      <line x1="23" y1="38" x2="23" y2="93" stroke="#f4eee2" strokeWidth="1.2" />
      <polygon points="6,28 13,32 13,100 6,104" fill="#7a4a3f" />
      <polygon points="33,43 40,47 40,88 33,92" fill="#7a4a3f" />
      <line x1="5" y1="27" x2="41" y2="45" stroke="#c9a55e" strokeWidth="1.2" />
      {/* Люстра. */}
      <line x1="100" y1="30" x2="100" y2="40" stroke="#c9a55e" strokeWidth="0.8" />
      <ellipse cx="100" cy="46" rx="14" ry="4" fill="none" stroke="#c9a55e" strokeWidth="1.2" />
      {[
        [86, 40],
        [93, 38],
        [100, 37],
        [107, 38],
        [114, 40],
      ].map(([x, y]) => (
        <g key={x}>
          <rect x={x - 1} y={y} width="2" height="5" fill="#f7f0dc" />
          <circle cx={x} cy={y - 1.5} r="1.2" fill="#ffd98a" />
        </g>
      ))}
      <g stroke="#e3cf9a" strokeWidth="0.6">
        <line x1="92" y1="49" x2="92" y2="53" />
        <line x1="100" y1="50" x2="100" y2="55" />
        <line x1="108" y1="49" x2="108" y2="53" />
      </g>
      {/* Картина в золочёной раме. */}
      <rect x="82" y="40" width="36" height="26" fill="#c9a55e" />
      <rect x="85" y="43" width="30" height="20" fill="#8ea2b8" />
      <polygon points="85,63 95,52 103,58 110,50 115,56 115,63" fill="#7d8f6a" />
      <circle cx="108" cy="47" r="2" fill="#f5e6b8" />
      {/* Бархатный диван с валиками и точёными ножками. */}
      <rect x="96" y="66" width="50" height="14" rx="5" fill="#46536e" />
      <rect x="92" y="78" width="58" height="14" rx="3" fill="#3e4a63" />
      <ellipse cx="94" cy="80" rx="5" ry="7" fill="#3e4a63" />
      <ellipse cx="148" cy="80" rx="5" ry="7" fill="#3e4a63" />
      <rect x="102" y="69" width="16" height="9" rx="2" fill="#5a6987" />
      <rect x="124" y="69" width="16" height="9" rx="2" fill="#5a6987" />
      <line x1="94" y1="86" x2="148" y2="86" stroke="#c9a55e" strokeWidth="0.5" strokeOpacity="0.8" />
      <rect x="97" y="92" width="3" height="5" fill="#c9a55e" />
      <rect x="142" y="92" width="3" height="5" fill="#c9a55e" />
      {/* Консоль с зеркалом. */}
      <ellipse cx="171" cy="58" rx="9" ry="12" fill="#d9e2ea" stroke="#c9a55e" strokeWidth="1.4" />
      <rect x="158" y="78" width="26" height="3" fill="#f1e7d3" />
      <line x1="161" y1="81" x2="161" y2="96" stroke="#c9a55e" strokeWidth="1" />
      <line x1="181" y1="81" x2="181" y2="96" stroke="#c9a55e" strokeWidth="1" />
      {/* Ковёр с медальоном. */}
      <ellipse cx="100" cy="112" rx="46" ry="9" fill="#8a5e56" />
      <ellipse cx="100" cy="112" rx="40" ry="7" fill="none" stroke="#c9a55e" strokeWidth="0.8" />
      <ellipse cx="100" cy="112" rx="12" ry="3" fill="#a9746a" />
    </>
  )
}

/* ── Джапанди: тёплый беж, низкая мебель, бумажный торшер, ветка в вазе ── */
function Japandi() {
  return (
    <>
      <Shell ceiling="#efe9dd" wall={["#e4dccc", "#dbd2c0"]} back="#e8e0d0" floor="#c9b393" />
      <g stroke="#b89f7d" strokeOpacity="0.5" strokeWidth="0.8">
        <line x1="40" y1="102" x2="160" y2="102" />
        <line x1="26" y1="114" x2="174" y2="114" />
        <line x1="12" y1="126" x2="188" y2="126" />
      </g>
      <Light id="ss-light-japandi" color="#f4e3c0" opacity={0.36} />
      {/* Окно-сёдзи. */}
      <polygon points={WINDOW} fill="#f5f0e4" />
      <polygon points={WINDOW} fill="none" stroke="#6e5a46" strokeWidth="1.2" />
      <g stroke="#c7b89c" strokeWidth="0.7">
        <line x1="19" y1="36" x2="19" y2="95" />
        <line x1="27" y1="40" x2="27" y2="91" />
        <line x1="12" y1="50" x2="34" y2="57" />
        <line x1="12" y1="66" x2="34" y2="71" />
        <line x1="12" y1="82" x2="34" y2="85" />
      </g>
      {/* Энсо на панели. */}
      <rect x="84" y="40" width="32" height="26" fill="#e0d6c3" />
      <circle cx="100" cy="53" r="8.5" fill="none" stroke="#3d3833" strokeWidth="1.6" strokeDasharray="46 8" strokeLinecap="round" />
      {/* Бумажный торшер со свечением. */}
      <defs>
        <filter id="ss-glow-japandi" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
      </defs>
      <ellipse cx="168" cy="84" rx="18" ry="30" fill="#f7e9c4" fillOpacity="0.55" filter="url(#ss-glow-japandi)" />
      <rect x="160" y="58" width="16" height="52" rx="4" fill="#f3ecdd" stroke="#d8cdb5" strokeWidth="0.6" />
      <g stroke="#e6dcc6" strokeWidth="0.6">
        {[64, 70, 76, 82, 88, 94, 100, 106].map((y) => (
          <line key={y} x1="160" y1={y} x2="176" y2={y} />
        ))}
      </g>
      <rect x="164" y="110" width="8" height="3" fill="#3d3833" />
      {/* Низкий диван на деревянной платформе. */}
      <rect x="96" y="66" width="52" height="10" rx="2" fill="#a09585" />
      <rect x="94" y="74" width="56" height="12" rx="2" fill="#8f8578" />
      <rect x="100" y="69" width="12" height="8" rx="1.5" fill="#d8cfc0" />
      <rect x="92" y="84" width="60" height="6" fill="#6e5a46" />
      {/* Низкий столик, ваза с веткой. */}
      <rect x="104" y="100" width="30" height="3" fill="#6e5a46" />
      <line x1="108" y1="103" x2="108" y2="109" stroke="#6e5a46" strokeWidth="1.2" />
      <line x1="130" y1="103" x2="130" y2="109" stroke="#6e5a46" strokeWidth="1.2" />
      <rect x="116" y="92" width="5" height="8" rx="1" fill="#2f2a26" />
      <path d="M118.5 92c0-6-4-10-6-16" fill="none" stroke="#6b5340" strokeWidth="1.1" />
      <path d="M116 84c3-2 5-2 7-1" fill="none" stroke="#6b5340" strokeWidth="0.8" />
      <ellipse cx="113" cy="76" rx="2.4" ry="1.3" fill="#8e9a7c" transform="rotate(-30 113 76)" />
      <ellipse cx="121" cy="82" rx="2.2" ry="1.2" fill="#8e9a7c" transform="rotate(20 121 82)" />
      <ellipse cx="115" cy="80" rx="2" ry="1.1" fill="#7f8b6e" transform="rotate(-60 115 80)" />
      {/* Джутовый ковёр и бонсай. */}
      <polygon points="58,104 142,104 150,122 50,122" fill="#d3c3a4" stroke="#c2b08e" strokeWidth="0.8" />
      <polygon points="26,116 42,116 40,127 28,127" fill="#3d3833" />
      <path d="M34 116c0-6-3-9-1-14" fill="none" stroke="#5a4634" strokeWidth="1.3" />
      <ellipse cx="33" cy="101" rx="8" ry="3.5" fill="#7f8f6c" />
      <ellipse cx="38" cy="106" rx="5" ry="2.4" fill="#8f9e7a" />
    </>
  )
}

/* ── Лофт: кирпич, бетон, кожаный диван, металлические подвесы, трубы ── */
function Loft() {
  const rows = [30, 36, 42, 48, 54, 60, 66, 72, 78, 84]
  const dark = new Set(["36-1", "48-4", "54-7", "66-2", "72-6", "84-3", "42-8"])
  return (
    <>
      <Shell ceiling="#4c4946" wall={["#8a8580", "#7c7772"]} back="#7a5646" floor="#5c5754" />
      {/* Кирпичная кладка со смещением рядов. */}
      <g fill="#8b6555">
        {rows.map((y, row) =>
          Array.from({ length: 10 }, (_, i) => {
            const x = 48 + i * 11 - (row % 2 ? 5.5 : 0)
            const w = Math.min(x + 10.2, 152) - Math.max(x, 48)
            if (w <= 0) return null
            const key = `${y}-${i}`
            return (
              <rect
                key={key}
                x={Math.max(x, 48)}
                y={y + 0.5}
                width={w}
                height="5"
                fill={dark.has(key) ? "#6d4c3f" : undefined}
              />
            )
          })
        )}
      </g>
      <FloorLines stroke="#4a4644" opacity={0.9} />
      <Light id="ss-light-loft" color="#cfd8de" opacity={0.22} />
      {/* Трубы на потолке. */}
      <line x1="10" y1="6" x2="190" y2="6" stroke="#35322f" strokeWidth="2.6" />
      <line x1="23" y1="14" x2="177" y2="14" stroke="#3b3835" strokeWidth="1.8" />
      {/* Фабричное окно. */}
      <polygon points={WINDOW} fill="#aab7be" />
      <polygon points={WINDOW} fill="none" stroke="#262626" strokeWidth="1.6" />
      <g stroke="#262626" strokeWidth="1">
        <line x1="19" y1="36" x2="19" y2="95" />
        <line x1="27" y1="40" x2="27" y2="91" />
        <line x1="12" y1="46" x2="34" y2="55" />
        <line x1="12" y1="60" x2="34" y2="66" />
        <line x1="12" y1="74" x2="34" y2="77" />
      </g>
      {/* Металлические конусы с тёплыми лампами. */}
      <defs>
        <filter id="ss-glow-loft" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="4" />
        </filter>
      </defs>
      {[80, 120].map((x) => (
        <g key={x}>
          <ellipse cx={x} cy="60" rx="14" ry="9" fill="#f5c96a" fillOpacity="0.45" filter="url(#ss-glow-loft)" />
          <line x1={x} y1="30" x2={x} y2="44" stroke="#2b2b2b" strokeWidth="0.8" />
          <polygon points={`${x - 8},52 ${x + 8},52 ${x},44`} fill="#2b2b2b" />
          <circle cx={x} cy="53" r="2.4" fill="#f5d58a" />
        </g>
      ))}
      {/* Полка на кронштейнах. */}
      <rect x="158" y="60" width="28" height="2" fill="#2b2b2b" />
      <line x1="162" y1="62" x2="162" y2="68" stroke="#2b2b2b" strokeWidth="1" />
      <line x1="182" y1="62" x2="182" y2="68" stroke="#2b2b2b" strokeWidth="1" />
      <rect x="161" y="53" width="4" height="7" fill="#8a5a3a" />
      <rect x="166" y="55" width="3" height="5" fill="#3a5a6a" />
      <rect x="170" y="54" width="5" height="6" fill="#b08d57" />
      {/* Кожаный диван на чёрных ножках. */}
      <rect x="96" y="66" width="50" height="14" rx="3" fill="#6b4a36" />
      <rect x="94" y="80" width="54" height="12" rx="2" fill="#7a5640" />
      <rect x="92" y="72" width="6" height="20" rx="1.5" fill="#5e4030" />
      <rect x="144" y="72" width="6" height="20" rx="1.5" fill="#5e4030" />
      <line x1="100" y1="83" x2="142" y2="83" stroke="#9a7256" strokeWidth="0.6" />
      <line x1="121" y1="68" x2="121" y2="79" stroke="#5a3d2c" strokeWidth="0.8" />
      <rect x="97" y="92" width="3" height="5" fill="#2b2b2b" />
      <rect x="142" y="92" width="3" height="5" fill="#2b2b2b" />
      {/* Столик-ящик в металлической раме, ковёр, сансевиерия. */}
      <rect x="108" y="98" width="30" height="8" fill="#8b6b4b" />
      <line x1="108" y1="101" x2="138" y2="101" stroke="#6e5238" strokeWidth="0.6" />
      <line x1="108" y1="104" x2="138" y2="104" stroke="#6e5238" strokeWidth="0.6" />
      <rect x="107" y="97" width="32" height="10" fill="none" stroke="#2b2b2b" strokeWidth="0.9" />
      <ellipse cx="100" cy="114" rx="44" ry="8" fill="#3f3c3a" />
      <rect x="26" y="112" width="16" height="14" rx="1" fill="#2b2b2b" />
      <polygon points="30,112 33,88 36,112" fill="#4f6b4a" />
      <polygon points="35,112 39,92 41,112" fill="#5c7a56" />
      <polygon points="28,112 29,96 32,112" fill="#5c7a56" />
    </>
  )
}

/* ── Минимализм: гладкие плоскости, микроцемент, один холст, одна лампа ── */
function Minimal() {
  return (
    <>
      <Shell ceiling="#fbfbfa" wall={["#f0f0ee", "#e9e9e6"]} back="#f5f5f3" floor="#d9d6d0" />
      <Light id="ss-light-minimal" color="#ffffff" opacity={0.3} />
      <polygon points={WINDOW} fill="#dfe6ea" />
      <polygon points={WINDOW} fill="none" stroke="#f7f7f5" strokeWidth="2" />
      <line x1="23" y1="38" x2="23" y2="93" stroke="#f7f7f5" strokeWidth="1.4" />
      {/* Пустой холст, низкий белый диван на тёмной базе, чёрный торшер. */}
      <rect x="76" y="42" width="48" height="30" fill="#ffffff" stroke="#e2e0dc" strokeWidth="0.8" />
      <rect x="98" y="70" width="48" height="8" rx="1.5" fill="#f3f2ef" />
      <rect x="90" y="76" width="64" height="14" rx="2" fill="#ebeae6" />
      <rect x="90" y="90" width="64" height="2" fill="#2b2b2b" />
      <rect x="104" y="102" width="30" height="2" fill="#2b2b2b" />
      <line x1="107" y1="104" x2="107" y2="110" stroke="#2b2b2b" strokeWidth="0.8" />
      <line x1="131" y1="104" x2="131" y2="110" stroke="#2b2b2b" strokeWidth="0.8" />
      <rect x="117" y="96" width="3" height="6" fill="#2b2b2b" />
      <line x1="170" y1="60" x2="170" y2="112" stroke="#2b2b2b" strokeWidth="1" />
      <circle cx="170" cy="58" r="3" fill="#2b2b2b" />
      <ellipse cx="170" cy="112" rx="6" ry="1.6" fill="#2b2b2b" />
    </>
  )
}

/* ── Мид-сенчури: орех, бирюза и горчица, тонкие ножки, спутник ── */
function Midcentury() {
  return (
    <>
      <Shell ceiling="#f3ede0" wall={["#e8dfcc", "#dfd5c0"]} back="#efe6d4" floor="#8b5e3c" />
      <FloorLines stroke="#6b4529" />
      <Light id="ss-light-mid" color="#f6d9a0" opacity={0.3} />
      {/* Панель из ореха на задней стене. */}
      <rect x="118" y="30" width="34" height="62" fill="#7b5236" />
      <g stroke="#5f3e28" strokeWidth="0.6">
        {[123, 128, 133, 138, 143, 148].map((x) => (
          <line key={x} x1={x} y1="30" x2={x} y2="92" />
        ))}
      </g>
      <polygon points={WINDOW} fill="#cfe0e8" />
      <polygon points={WINDOW} fill="none" stroke="#f3ede0" strokeWidth="1.8" />
      {/* Люстра-спутник и часы-солнце. */}
      <line x1="100" y1="30" x2="100" y2="40" stroke="#c9a55e" strokeWidth="0.8" />
      <circle cx="100" cy="42" r="1.6" fill="#c9a55e" />
      {[
        [88, 36],
        [112, 36],
        [86, 46],
        [114, 46],
        [94, 52],
        [106, 52],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <line x1="100" y1="42" x2={x} y2={y} stroke="#c9a55e" strokeWidth="0.7" />
          <circle cx={x} cy={y} r="1.6" fill="#f5e6b8" />
        </g>
      ))}
      <circle cx="70" cy="50" r="4" fill="#efe6d4" stroke="#c9a55e" strokeWidth="0.8" />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4
        return (
          <line
            key={i}
            x1={70 + Math.cos(a) * 5.5}
            y1={50 + Math.sin(a) * 5.5}
            x2={70 + Math.cos(a) * 9.5}
            y2={50 + Math.sin(a) * 9.5}
            stroke="#c9a55e"
            strokeWidth="0.8"
          />
        )
      })}
      {/* Комод, бирюзовый диван, горчичное кресло — всё на тонких ножках. */}
      <rect x="56" y="74" width="34" height="12" rx="1" fill="#7b5236" />
      <line x1="73" y1="74" x2="73" y2="86" stroke="#5f3e28" strokeWidth="0.6" />
      <line x1="58" y1="86" x2="56" y2="94" stroke="#5f3e28" strokeWidth="1.2" />
      <line x1="88" y1="86" x2="90" y2="94" stroke="#5f3e28" strokeWidth="1.2" />
      <rect x="98" y="68" width="48" height="12" rx="3" fill="#2f6f73" />
      <rect x="96" y="78" width="52" height="12" rx="2" fill="#357b7f" />
      {[106, 116, 126, 136].map((x) => (
        <circle key={x} cx={x} cy="74" r="0.8" fill="#24595c" />
      ))}
      <line x1="100" y1="90" x2="97" y2="98" stroke="#5f3e28" strokeWidth="1.4" />
      <line x1="144" y1="90" x2="147" y2="98" stroke="#5f3e28" strokeWidth="1.4" />
      <ellipse cx="169" cy="76" rx="9" ry="6" fill="#d9a441" />
      <rect x="160" y="78" width="18" height="12" rx="4" fill="#d9a441" />
      <line x1="163" y1="90" x2="161" y2="97" stroke="#5f3e28" strokeWidth="1.2" />
      <line x1="175" y1="90" x2="177" y2="97" stroke="#5f3e28" strokeWidth="1.2" />
      <ellipse cx="100" cy="112" rx="40" ry="8" fill="#e2d5bd" />
      <ellipse cx="100" cy="112" rx="30" ry="5.5" fill="none" stroke="#c4a875" strokeWidth="0.8" />
    </>
  )
}

/* ── Бохо: ротанг, макраме, терракота, подушки с узором, растения ── */
function Boho() {
  return (
    <>
      <Shell ceiling="#f5ecdc" wall={["#ecdfca", "#e5d6bf"]} back="#f1e4d0" floor="#c07a52" />
      <FloorLines stroke="#a8623e" opacity={0.55} />
      <g stroke="#a8623e" strokeOpacity="0.5" strokeWidth="0.8">
        <line x1="42" y1="100" x2="158" y2="100" />
        <line x1="30" y1="108" x2="170" y2="108" />
        <line x1="18" y1="118" x2="182" y2="118" />
      </g>
      <Light id="ss-light-boho" color="#f7d9b0" opacity={0.32} />
      <polygon points={WINDOW} fill="#d9e4e8" />
      <polygon points={WINDOW} fill="none" stroke="#f5ecdc" strokeWidth="1.8" />
      {/* Макраме на стене и ротанговый подвес. */}
      <rect x="64" y="40" width="22" height="2.5" rx="1" fill="#6b4b2a" />
      {[66, 69, 72, 75, 78, 81, 84].map((x, i) => (
        <line key={x} x1={x} y1="42.5" x2={x} y2={58 + (i % 2 ? 6 : 2)} stroke="#e8d9c0" strokeWidth="1" />
      ))}
      <path d="M66 46q9 8 18 0" fill="none" stroke="#e8d9c0" strokeWidth="1" />
      <line x1="100" y1="30" x2="100" y2="42" stroke="#6b4b2a" strokeWidth="0.7" />
      <path d="M87 54a13 13 0 0 1 26 0z" fill="#b7924f" />
      <path d="M90 54l8-10M96 54l8-10M102 54l6-8M88 50l14 4M90 46l18 6" fill="none" stroke="#8f6d35" strokeWidth="0.6" />
      {/* Диван в подушках, пуф, ковёр слоями, растения. */}
      <rect x="94" y="70" width="56" height="12" rx="3" fill="#e9dcc6" />
      <rect x="92" y="80" width="60" height="12" rx="3" fill="#efe3cf" />
      <rect x="98" y="72" width="12" height="9" rx="1.5" fill="#c47a4f" />
      <rect x="112" y="72" width="12" height="9" rx="1.5" fill="#5f7a58" />
      <rect x="126" y="72" width="12" height="9" rx="1.5" fill="#d9a441" />
      <g stroke="#f1e4d0" strokeWidth="0.6">
        <line x1="128" y1="74" x2="136" y2="74" />
        <line x1="128" y1="77" x2="136" y2="77" />
        <line x1="114" y1="74" x2="118" y2="79" />
        <line x1="118" y1="74" x2="122" y2="79" />
      </g>
      <line x1="96" y1="92" x2="96" y2="97" stroke="#6b4b2a" strokeWidth="1.2" />
      <line x1="148" y1="92" x2="148" y2="97" stroke="#6b4b2a" strokeWidth="1.2" />
      <ellipse cx="70" cy="104" rx="10" ry="6" fill="#b7924f" />
      <path d="M62 102q8 -4 16 0M62 106q8 4 16 0" fill="none" stroke="#8f6d35" strokeWidth="0.6" />
      <polygon points="52,106 150,106 158,124 44,124" fill="#f1e4d0" stroke="#c47a4f" strokeWidth="0.8" />
      <g stroke="#c47a4f" strokeWidth="0.8">
        <line x1="50" y1="111" x2="152" y2="111" />
        <line x1="48" y1="116" x2="155" y2="116" />
        <line x1="46" y1="121" x2="157" y2="121" />
      </g>
      <rect x="26" y="112" width="16" height="14" rx="1" fill="#c47a4f" />
      <ellipse cx="34" cy="104" rx="5" ry="11" fill="#6f8f6a" transform="rotate(-30 34 104)" />
      <ellipse cx="35" cy="103" rx="5" ry="11" fill="#7d9c76" transform="rotate(22 35 103)" />
      <rect x="164" y="104" width="14" height="12" rx="1" fill="#b7924f" />
      {[-40, -15, 15, 40].map((deg) => (
        <ellipse key={deg} cx="171" cy="96" rx="3" ry="12" fill="#5f7a58" transform={`rotate(${deg} 171 104)`} />
      ))}
    </>
  )
}

/* ── Ар-деко: изумруд, чёрный мрамор, латунь, бархат, геометрия ── */
function Artdeco() {
  return (
    <>
      <Shell ceiling="#24302b" wall={["#1b453a", "#173b31"]} back="#1f4d40" floor="#23262b" />
      <g fill="none" stroke="#6b6f78" strokeOpacity="0.55" strokeWidth="0.6">
        <path d="M40 130c20-10 30-18 60-20s40-8 70-10" />
        <path d="M0 118c30-6 50-14 80-14" />
      </g>
      <Light id="ss-light-deco" color="#cbb27a" opacity={0.16} />
      <polygon points={WINDOW} fill="#3d4f5c" />
      <polygon points={WINDOW} fill="none" stroke="#b08d57" strokeWidth="1.4" />
      <line x1="23" y1="38" x2="23" y2="93" stroke="#b08d57" strokeWidth="1" />
      <line x1="12" y1="65" x2="34" y2="66" stroke="#b08d57" strokeWidth="1" />
      {/* Солнце из латунных лучей и шестигранный подвес. */}
      <circle cx="100" cy="52" r="4" fill="#b08d57" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * Math.PI) / 6
        return (
          <line
            key={i}
            x1={100 + Math.cos(a) * 5}
            y1={52 + Math.sin(a) * 5}
            x2={100 + Math.cos(a) * 14}
            y2={52 + Math.sin(a) * 14}
            stroke="#b08d57"
            strokeWidth="1.2"
          />
        )
      })}
      <line x1="160" y1="30" x2="160" y2="38" stroke="#b08d57" strokeWidth="0.8" />
      <polygon points="154,42 166,42 169,48 166,54 154,54 151,48" fill="none" stroke="#b08d57" strokeWidth="1.2" />
      <circle cx="160" cy="48" r="1.8" fill="#f2dfa8" />
      {/* Скруглённый бархатный диван на латунной базе, зеркало, барная тележка. */}
      <path d="M92 92h60v-12a8 8 0 0 0-8-8h-44a8 8 0 0 0-8 8z" fill="#2a6b5a" />
      <g stroke="#24594c" strokeWidth="0.7">
        {[100, 108, 116, 124, 132, 140].map((x) => (
          <line key={x} x1={x} y1="74" x2={x} y2="90" />
        ))}
      </g>
      <rect x="96" y="92" width="52" height="2" fill="#b08d57" />
      <circle cx="176" cy="58" r="10" fill="#2e3a44" stroke="#b08d57" strokeWidth="1.6" />
      <circle cx="176" cy="58" r="7" fill="none" stroke="#b08d57" strokeWidth="0.5" />
      <rect x="160" y="84" width="18" height="2" fill="#b08d57" />
      <rect x="160" y="94" width="18" height="2" fill="#b08d57" />
      <line x1="162" y1="86" x2="162" y2="96" stroke="#b08d57" strokeWidth="0.8" />
      <line x1="176" y1="86" x2="176" y2="96" stroke="#b08d57" strokeWidth="0.8" />
      <rect x="164" y="79" width="2.5" height="5" fill="#2e3a44" />
      <rect x="168" y="78" width="2.5" height="6" fill="#4a6b5a" />
      <rect x="172" y="80" width="2.5" height="4" fill="#b08d57" />
      <polygon points="56,104 144,104 152,122 48,122" fill="#1a1c20" stroke="#b08d57" strokeWidth="0.8" />
      <path d="M62 113l8-5 8 5 8-5 8 5 8-5 8 5 8-5 8 5 8-5 8 5" fill="none" stroke="#b08d57" strokeWidth="0.8" />
    </>
  )
}

/* ── Средиземноморский: белёные стены, арка, терракота, азулежу, олива ── */
function Mediterranean() {
  return (
    <>
      <Shell ceiling="#f3ede2" wall={["#f2ece0", "#eae3d5"]} back="#f7f2e8" floor="#c9865a" />
      <FloorLines stroke="#a8663e" opacity={0.5} />
      <g stroke="#a8663e" strokeOpacity="0.45" strokeWidth="0.8">
        <line x1="42" y1="100" x2="158" y2="100" />
        <line x1="30" y1="108" x2="170" y2="108" />
        <line x1="18" y1="118" x2="182" y2="118" />
      </g>
      {/* Балки на потолке. */}
      <g stroke="#8a6a4a" strokeWidth="2.4">
        <line x1="13" y1="8" x2="187" y2="8" />
        <line x1="26" y1="16" x2="174" y2="16" />
        <line x1="36" y1="23" x2="164" y2="23" />
      </g>
      <Light id="ss-light-med" color="#fff1c8" opacity={0.38} />
      <polygon points={WINDOW} fill="#cfe4ee" />
      <polygon points={WINDOW} fill="none" stroke="#f7f2e8" strokeWidth="1.6" />
      <polygon points="6,29 12,32 12,98 6,102" fill="#3b6ea5" />
      <polygon points="34,44 40,47 40,88 34,88" fill="#3b6ea5" />
      <g stroke="#2d5a88" strokeWidth="0.5">
        {[40, 50, 60, 70, 80, 90].map((y) => (
          <line key={y} x1="6" y1={y} x2="12" y2={y + 2} />
        ))}
      </g>
      {/* Арочная ниша и полоса азулежу. */}
      <path d="M84 92v-34a16 16 0 0 1 32 0v34z" fill="#e9dfcc" stroke="#d9ccb2" strokeWidth="0.8" />
      <rect x="96" y="70" width="8" height="10" rx="1" fill="#c9865a" />
      <rect x="48" y="84" width="104" height="8" fill="#3b6ea5" />
      <g fill="#f7f2e8">
        {Array.from({ length: 13 }, (_, i) => (
          <rect key={i} x={49 + i * 8} y={85 + (i % 2 ? 3 : 0)} width="3" height="3" />
        ))}
      </g>
      {/* Льняной диван, олива в глиняном горшке, плетёный подвес. */}
      <rect x="96" y="68" width="50" height="12" rx="4" fill="#e2d5b8" />
      <rect x="92" y="78" width="58" height="14" rx="3" fill="#d8c8a8" />
      <rect x="100" y="70" width="12" height="9" rx="1.5" fill="#3b6ea5" />
      <rect x="130" y="70" width="12" height="9" rx="1.5" fill="#3b6ea5" />
      <polygon points="24,116 42,116 39,128 27,128" fill="#c9865a" />
      <path d="M33 116c0-8-2-12 0-20" fill="none" stroke="#6b5340" strokeWidth="1.3" />
      <ellipse cx="30" cy="96" rx="8" ry="5" fill="#7a9b76" />
      <ellipse cx="38" cy="92" rx="7" ry="4.5" fill="#93ad8c" />
      <ellipse cx="33" cy="88" rx="6" ry="4" fill="#7a9b76" />
      <line x1="140" y1="30" x2="140" y2="42" stroke="#8a6a4a" strokeWidth="0.7" />
      <polygon points="130,54 150,54 140,42" fill="#d9b98a" stroke="#b8955f" strokeWidth="0.6" />
      <path d="M132 50h16M134 46h12" stroke="#b8955f" strokeWidth="0.5" />
    </>
  )
}

/* ── Прованс: выбеленное дерево, лаванда, цветочный текстиль, ковка ── */
function Provence() {
  return (
    <>
      <Shell ceiling="#f7f3ea" wall={["#eee8ec", "#e7e1e6"]} back="#f4efe4" floor="#ded3bf" />
      <FloorLines stroke="#c8bca6" opacity={0.6} />
      <g stroke="#cdbfa6" strokeWidth="2">
        <line x1="20" y1="12" x2="180" y2="12" />
        <line x1="34" y1="22" x2="166" y2="22" />
      </g>
      <Light id="ss-light-prov" color="#fff5da" opacity={0.32} />
      <polygon points={WINDOW} fill="#d5e3ea" />
      <polygon points={WINDOW} fill="none" stroke="#f7f3ea" strokeWidth="1.8" />
      <line x1="23" y1="38" x2="23" y2="93" stroke="#f7f3ea" strokeWidth="1.4" />
      <polygon points="6,29 12,32 12,98 6,102" fill="#a9a2c8" />
      <polygon points="34,44 40,47 40,88 34,88" fill="#a9a2c8" />
      {/* Кованая люстра со свечами. */}
      <line x1="100" y1="30" x2="100" y2="40" stroke="#3a3a3a" strokeWidth="0.8" />
      <path d="M86 46q7-8 14-2q7-6 14 2" fill="none" stroke="#3a3a3a" strokeWidth="1" />
      <path d="M86 46q-4 4 0 6M114 46q4 4 0 6" fill="none" stroke="#3a3a3a" strokeWidth="0.8" />
      {[86, 93, 100, 107, 114].map((x) => (
        <g key={x}>
          <rect x={x - 1} y={x === 100 ? 36 : 40} width="2" height="5" fill="#f7f0dc" />
          <circle cx={x} cy={x === 100 ? 34.5 : 38.5} r="1.1" fill="#ffd98a" />
        </g>
      ))}
      {/* Диван в цветочном льне, выбеленный комод, лаванда. */}
      <rect x="96" y="68" width="50" height="12" rx="5" fill="#a9a2c8" />
      <rect x="92" y="78" width="58" height="14" rx="4" fill="#b2acce" />
      <g fill="#f4efe4">
        {[
          [100, 84],
          [110, 88],
          [120, 83],
          [130, 88],
          [140, 84],
          [104, 72],
          [120, 74],
          [136, 72],
        ].map(([x, y]) => (
          <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" />
        ))}
      </g>
      <rect x="100" y="70" width="10" height="8" rx="1.5" fill="#f4efe4" />
      <rect x="132" y="70" width="10" height="8" rx="1.5" fill="#f4efe4" />
      <rect x="160" y="66" width="26" height="26" fill="#e8e1d3" stroke="#cdbfa6" strokeWidth="0.8" />
      <g stroke="#cdbfa6" strokeWidth="0.6">
        <line x1="160" y1="75" x2="186" y2="75" />
        <line x1="160" y1="84" x2="186" y2="84" />
      </g>
      {[70.5, 79.5, 88.5].map((y) => (
        <circle key={y} cx="173" cy={y} r="0.9" fill="#8a7f6a" />
      ))}
      <rect x="171" y="58" width="4" height="8" rx="1" fill="#c8c2d8" />
      {[-3, 0, 3].map((dx) => (
        <g key={dx}>
          <line x1={173 + dx} y1="58" x2={173 + dx * 1.6} y2="48" stroke="#6f8f5a" strokeWidth="0.7" />
          <ellipse cx={173 + dx * 1.7} cy="47" rx="1.1" ry="2.6" fill="#8e7fb8" />
        </g>
      ))}
      <ellipse cx="100" cy="112" rx="42" ry="8" fill="#efe9de" stroke="#d6cbb8" strokeWidth="0.8" />
    </>
  )
}

/* ── Ваби-саби: глиняная штукатурка, камень, лён, ветка в грубой вазе ── */
function Wabisabi() {
  return (
    <>
      <Shell ceiling="#e6dccb" wall={["#d2c4ae", "#c8b9a2"]} back="#d9cbb6" floor="#a89880" />
      <g fill="#cdbca4" fillOpacity="0.55">
        <ellipse cx="70" cy="50" rx="16" ry="9" />
        <ellipse cx="130" cy="42" rx="14" ry="7" fill="#e0d3bf" />
        <ellipse cx="100" cy="80" rx="20" ry="6" />
      </g>
      <g fill="none" stroke="#8b7b64" strokeOpacity="0.55" strokeWidth="0.8">
        <path d="M48 92l-8 12 8 10 -14 16M92 92l6 14 -4 12 10 12M136 92l12 12 -6 12 16 14M70 104h30M120 116h40" />
      </g>
      <Light id="ss-light-wabi" color="#f2e3c8" opacity={0.3} />
      <polygon points={WINDOW} fill="#e9e1d1" />
      <polygon points={WINDOW} fill="none" stroke="#6b5a46" strokeWidth="1" />
      {/* Арочный проём, низкий диван на платформе, ваза с веткой, пень-табурет. */}
      <path d="M118 92v-30a12 12 0 0 1 24 0v30z" fill="#b8a78d" />
      <rect x="64" y="70" width="48" height="10" rx="3" fill="#7d7263" />
      <rect x="60" y="78" width="56" height="14" rx="3" fill="#6e6355" />
      <rect x="58" y="92" width="60" height="4" fill="#4a3f34" />
      <path d="M150 100c-8 0-10-6-10-12s4-10 10-10 10 4 10 10-2 12-10 12z" fill="#5a4f44" />
      <path d="M150 78c-2-8-8-10-12-18M150 78c1-6 5-9 8-14" fill="none" stroke="#3a342c" strokeWidth="1" />
      <circle cx="139" cy="61" r="1.2" fill="#8e9a7c" />
      <circle cx="157" cy="65" r="1" fill="#8e9a7c" />
      <rect x="72" y="106" width="16" height="8" fill="#5a4634" />
      <ellipse cx="80" cy="106" rx="8" ry="3" fill="#6b5340" />
      <ellipse cx="80" cy="106" rx="4" ry="1.5" fill="none" stroke="#4a3626" strokeWidth="0.5" />
      <polygon points="52,110 148,110 156,124 44,124" fill="#b8a78d" stroke="#9d8d72" strokeWidth="0.8" />
    </>
  )
}

/* ── Контемпорари: керамогранит, стекло, серая кожа, подсветка, чёрные рамы ── */
function Contemporary() {
  return (
    <>
      <Shell ceiling="#f1f1ef" wall={["#e6e6e3", "#dedddb"]} back="#5d6068" floor="#b5b0a8" />
      <FloorLines stroke="#9a958d" opacity={0.6} />
      <g stroke="#9a958d" strokeOpacity="0.5" strokeWidth="0.8">
        <line x1="40" y1="102" x2="160" y2="102" />
        <line x1="24" y1="115" x2="176" y2="115" />
      </g>
      <defs>
        <filter id="ss-glow-cont" x="-20%" y="-200%" width="140%" height="500%">
          <feGaussianBlur stdDeviation="2" />
        </filter>
      </defs>
      <rect x="48" y="31" width="104" height="3" fill="#ffffff" fillOpacity="0.5" filter="url(#ss-glow-cont)" />
      <line x1="48" y1="32" x2="152" y2="32" stroke="#ffffff" strokeWidth="1.2" strokeOpacity="0.9" />
      <Light id="ss-light-cont" color="#dfe7ee" opacity={0.22} />
      <polygon points={WINDOW} fill="#cfd8df" />
      <polygon points={WINDOW} fill="none" stroke="#1a1b1e" strokeWidth="1.6" />
      <line x1="23" y1="38" x2="23" y2="93" stroke="#1a1b1e" strokeWidth="1" />
      {/* Телевизор, модульный диван, стеклянный столик, хромированный торшер-дуга. */}
      <rect x="76" y="44" width="44" height="24" fill="#1a1b1e" />
      <rect x="132" y="44" width="14" height="20" fill="#e9e9e6" stroke="#cfd0cc" strokeWidth="0.6" />
      <rect x="94" y="68" width="56" height="12" rx="2" fill="#666a72" />
      <rect x="92" y="78" width="60" height="14" rx="2" fill="#5d6068" />
      <rect x="140" y="78" width="20" height="14" rx="2" fill="#565961" />
      <line x1="98" y1="84" x2="146" y2="84" stroke="#7a7e86" strokeWidth="0.6" />
      <rect x="104" y="100" width="30" height="3" fill="none" stroke="#cfd8df" strokeWidth="1" />
      <line x1="106" y1="103" x2="106" y2="110" stroke="#cfd8df" strokeWidth="1" />
      <line x1="132" y1="103" x2="132" y2="110" stroke="#cfd8df" strokeWidth="1" />
      <line x1="108" y1="101.5" x2="126" y2="101.5" stroke="#ffffff" strokeWidth="0.6" strokeOpacity="0.8" />
      <line x1="172" y1="112" x2="172" y2="64" stroke="#c7ccd1" strokeWidth="1.2" />
      <path d="M172 64q-30-14-50 8" fill="none" stroke="#c7ccd1" strokeWidth="1.2" />
      <circle cx="122" cy="72" r="3" fill="#c7ccd1" />
      <ellipse cx="172" cy="112" rx="6" ry="1.6" fill="#c7ccd1" />
      <polygon points="56,104 146,104 154,122 48,122" fill="#d9d6d0" />
    </>
  )
}

const SCENES: Record<SceneStyle, () => React.ReactElement> = {
  scandi: Scandi,
  neoclassic: Neoclassic,
  japandi: Japandi,
  loft: Loft,
  minimal: Minimal,
  midcentury: Midcentury,
  boho: Boho,
  artdeco: Artdeco,
  mediterranean: Mediterranean,
  provence: Provence,
  wabisabi: Wabisabi,
  contemporary: Contemporary,
}

export function StyleScene({ style, className }: { style: SceneStyle; className?: string }) {
  const Scene = SCENES[style]
  return (
    <svg viewBox="0 0 200 130" className={className} preserveAspectRatio="xMidYMid slice" aria-hidden>
      <Scene />
    </svg>
  )
}
