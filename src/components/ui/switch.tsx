"use client"

import { cn } from "@/lib/utils"

/** Тумблер вкл/выкл — стандартный контрол настроек. Рецепт — .switch в DS. */
export function Switch({
  checked,
  onChange,
  id,
  disabled = false,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  id?: string
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn("switch", checked && "is-on")}
    >
      <span className="switch-knob" aria-hidden />
    </button>
  )
}
