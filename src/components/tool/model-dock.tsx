"use client"

import { ChevronDown, Clock, Coins, Info, Upload, X } from "lucide-react"

import { openLightbox, ZoomButton } from "@/components/ui/lightbox"
import { Switch } from "@/components/ui/switch"
import type { AttachedRender } from "@/lib/use-attachments"
import type { ViewSlots } from "@/lib/use-view-slots"
import { cn } from "@/lib/utils"
import {
  MODEL_AI,
  MODEL_SLOT_LABEL,
  MODEL_VIEW_ROLES,
  describeModelSettings,
  estimateModelCost,
  modelAiInfo,
  normalizeModelSettings,
  type ModelQuality,
  type ModelSettings,
  type ModelSlot,
} from "@/shared/model3d"

const QUALITY: { value: ModelQuality; label: string; hint: string }[] = [
  { value: "standard", label: "Стандарт", hint: "Сетка до 50 000 треугольников — лёгкий файл для сцены" },
  { value: "ultra", label: "Ультра", hint: "Геометрия высокой точности, до 150 000 треугольников · +5 кредитов" },
]

/**
 * Панель генерации «Фото → 3D» — секция над композером (`dock`). Повторяет
 * левую панель рабочего экрана Meshy, только лежит горизонтально: фото
 * (главный вид и ракурсы слева / сзади / справа с тумблером мульти-вида),
 * выбор модели и детализации, тумблеры текстуры, PBR и улучшения фото; в
 * шапке — оценка «время · кредиты» и сворачивание. Что доступно у выбранной
 * модели и сколько это стоит — из `src/shared/model3d.ts`, поэтому панель не
 * может предложить то, чего провайдер не примет.
 */
export function ModelDock({
  slots,
  settings,
  onSettingsChange,
  multiView,
  onMultiViewChange,
  configured,
  open,
  onOpenChange,
}: {
  slots: ViewSlots
  settings: ModelSettings
  onSettingsChange: (next: ModelSettings) => void
  multiView: boolean
  onMultiViewChange: (on: boolean) => void
  /** Есть ли ключ провайдера; `null` — ещё выясняем. Без ключа строится каркас-заглушка и настройки ни на что не влияют. */
  configured: boolean | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const info = modelAiInfo(settings.ai)
  const cost = estimateModelCost(settings)
  const off = configured === false
  const set = (patch: Partial<ModelSettings>) => {
    // Возврат с модели без текстуры (Lite) к полной — текстура и улучшение фото
    // включаются обратно: их выключил не пользователь, а ограничение модели.
    const next = patch.ai ? modelAiInfo(patch.ai) : info
    const restored: Partial<ModelSettings> = {
      ...(!info.texture && next.texture ? { texture: true } : {}),
      ...(!info.enhance && next.enhance ? { enhance: true } : {}),
    }
    onSettingsChange(normalizeModelSettings({ ...settings, ...restored, ...patch }))
  }
  const multiOn = multiView && info.multiView

  return (
    <div className="model-dock" data-open={open}>
      <div className="model-dock-head">
        <button type="button" onClick={() => onOpenChange(!open)} aria-expanded={open} className="model-dock-toggle">
          <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", !open && "-rotate-90")} strokeWidth={1.7} />
          <span className="text-[13px]" style={{ color: "var(--fg-1)" }}>
            Параметры модели
          </span>
          {!open ? <span className="model-dock-summary">{off ? "каркас-заглушка" : describeModelSettings(settings)}</span> : null}
        </button>
        {off ? (
          <span className="model-dock-cost" title="MESHY_API_KEY не задан на сервере">
            <Info className="h-3.5 w-3.5" strokeWidth={1.7} />
            ключ Meshy не задан — строится каркас-заглушка
          </span>
        ) : (
          <span className="model-dock-cost" title="Оценка до запуска; точная сумма списывается провайдером при постановке задачи">
            <Clock className="h-3.5 w-3.5" strokeWidth={1.7} />≈ {cost.minutes} мин
            <span className="model-dock-cost-sep" aria-hidden />
            <Coins className="h-3.5 w-3.5" strokeWidth={1.7} />
            {cost.credits} кредитов
          </span>
        )}
      </div>

      {open ? (
        <div className={cn("model-dock-body", off && "is-off")}>
          {/* Фото: главный вид и ракурсы. */}
          <section className="model-dock-section">
            <span className="model-dock-label">Фото</span>
            <div className="model-slots">
              <PhotoSlot slot="main" attachment={slots.main} onPick={() => slots.pick("main")} onRemove={() => slots.remove("main")} />
              {MODEL_VIEW_ROLES.map((role) => (
                <PhotoSlot
                  key={role}
                  slot={role}
                  attachment={slots.views[role]}
                  disabled={!multiOn}
                  onPick={() => slots.pick(role)}
                  onRemove={() => slots.remove(role)}
                />
              ))}
            </div>
            <label className="model-dock-row" title={info.multiView ? undefined : "Несколько ракурсов принимает только Meshy 7"}>
              <span>
                Мульти-вид
                <span className="model-dock-row-hint">до трёх ракурсов того же предмета</span>
              </span>
              <Switch checked={multiOn} onChange={onMultiViewChange} disabled={off || !info.multiView} />
            </label>
          </section>

          {/* Модель и детализация. */}
          <section className="model-dock-section">
            <span className="model-dock-label">Модель</span>
            <div className="model-ai-list" role="radiogroup" aria-label="Модель">
              {MODEL_AI.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="radio"
                  aria-checked={settings.ai === item.value}
                  disabled={off}
                  onClick={() => set({ ai: item.value })}
                  className={cn("model-ai", settings.ai === item.value && "is-active")}
                >
                  <span className="model-ai-name">{item.label}</span>
                  <span className="model-ai-hint">{item.hint}</span>
                </button>
              ))}
            </div>
            <div className="seg w-full" role="radiogroup" aria-label="Детализация">
              {QUALITY.map((item) => (
                <button
                  key={item.value}
                  type="button"
                  role="radio"
                  aria-checked={settings.quality === item.value}
                  disabled={off || (item.value === "ultra" && !info.ultra)}
                  title={item.value === "ultra" && !info.ultra ? "«Ультра» есть только у Meshy 7" : item.hint}
                  onClick={() => set({ quality: item.value })}
                  className={cn("seg-item flex-1 justify-center", settings.quality === item.value && "is-active")}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>

          {/* Материал и подготовка фото. */}
          <section className="model-dock-section">
            <span className="model-dock-label">Материал</span>
            <label className="model-dock-row" title={info.texture ? undefined : "Meshy 6 Lite строит только геометрию"}>
              <span>
                Текстура
                <span className="model-dock-row-hint">{settings.texture ? "модель с материалом по фото" : "голая геометрия — дешевле и быстрее"}</span>
              </span>
              <Switch checked={settings.texture} onChange={(texture) => set({ texture })} disabled={off || !info.texture} />
            </label>
            <label className="model-dock-row" title={settings.texture ? undefined : "Нужна включённая текстура"}>
              <span>
                PBR-карты
                <span className="model-dock-row-hint">металл, шероховатость, нормали</span>
              </span>
              <Switch checked={settings.pbr} onChange={(pbr) => set({ pbr })} disabled={off || !settings.texture} />
            </label>
            <label className="model-dock-row" title={info.enhance ? undefined : "У Meshy 6 Lite подготовки фото нет"}>
              <span>
                Улучшение фото
                <span className="model-dock-row-hint">кадр подчищается перед реконструкцией</span>
              </span>
              <Switch checked={settings.enhance} onChange={(enhance) => set({ enhance })} disabled={off || !info.enhance} />
            </label>
          </section>
        </div>
      ) : null}
    </div>
  )
}

/** Слот фото: пустой — пунктир с планом съёмки и подписью, занятый — превью с крестиком. */
function PhotoSlot({
  slot,
  attachment,
  disabled = false,
  onPick,
  onRemove,
}: {
  slot: ModelSlot
  attachment: AttachedRender | null
  disabled?: boolean
  onPick: () => void
  onRemove: () => void
}) {
  const label = MODEL_SLOT_LABEL[slot]
  return (
    <div className={cn("model-slot zoom-host", slot === "main" && "is-main", attachment && "is-filled", disabled && "is-disabled")}>
      <button
        type="button"
        onClick={onPick}
        disabled={disabled}
        aria-label={attachment ? `Заменить фото: ${label}` : `Добавить фото: ${label}`}
        className="model-slot-pick"
      >
        {attachment ? (
          // Превью — object URL локального файла, next/image ни к чему.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={attachment.previewUrl} alt={attachment.file.name} draggable={false} />
        ) : slot === "main" ? (
          <Upload className="h-5 w-5" strokeWidth={1.5} />
        ) : (
          <ViewPlanGlyph slot={slot} />
        )}
        <span className="model-slot-label">{label}</span>
      </button>
      {attachment ? (
        <>
          <button type="button" onClick={onRemove} aria-label={`Убрать фото: ${label}`} className="model-slot-remove">
            <X className="h-3 w-3" strokeWidth={1.8} />
          </button>
          {/* Клик по слоту заменяет фото — рассмотреть его в полном размере даёт уголок. */}
          <ZoomButton
            onOpen={(origin) =>
              openLightbox({ src: attachment.previewUrl, alt: attachment.file.name, caption: `${label} · ${attachment.file.name}` }, { origin })
            }
            label={`Открыть фото «${label}» в полном размере`}
            className="model-slot-zoom"
          />
        </>
      ) : null}
    </div>
  )
}

/** План съёмки сверху: предмет в центре и камера с той стороны, с которой снят ракурс. */
function ViewPlanGlyph({ slot }: { slot: ModelSlot }) {
  const camera = { main: [16, 27], left: [5, 16], back: [16, 5], right: [27, 16] }[slot]
  return (
    <svg viewBox="0 0 32 32" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={1.4} aria-hidden>
      <rect x="11.5" y="11.5" width="9" height="9" rx="1.5" />
      <circle cx={camera[0]} cy={camera[1]} r="2.2" fill="currentColor" stroke="none" />
      <path d={`M${camera[0]} ${camera[1]} L16 16`} strokeDasharray="1.6 2.2" strokeLinecap="round" />
    </svg>
  )
}
