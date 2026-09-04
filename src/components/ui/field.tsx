"use client"

import { useId, type ReactNode } from "react"

import { cn } from "@/lib/utils"

interface FieldProps {
  label: string
  hint?: string
  children: (id: string) => ReactNode
  className?: string
}

/** Подпись + поле. id связывает label с контролом — иначе тап по подписи ничего не делает. */
export function Field({ label, hint, children, className }: FieldProps) {
  const id = useId()
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="ds-micro">
        {label}
      </label>
      {children(id)}
      {hint ? <span className="ds-caption">{hint}</span> : null}
    </div>
  )
}
