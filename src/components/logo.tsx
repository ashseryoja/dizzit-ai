import { cn } from "@/lib/utils"

/**
 * Логотип: слово + белая точка-акцент. Точка — единственная плотная заливка
 * в шапке сайдбара, она же держит связь с акцентом системы.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span
      className={cn("studio-logo inline-flex items-baseline gap-[3px] leading-none", className)}
      style={{
        fontFamily: "var(--font-display)",
        fontWeight: 500,
        letterSpacing: "-0.02em",
        color: "var(--fg-1)",
      }}
    >
      Dizzit
      <span style={{ color: "var(--fg-4)" }}>AI</span>
      <span
        aria-hidden
        className="mb-[1px] inline-block h-[5px] w-[5px] rounded-full"
        style={{ background: "var(--accent)" }}
      />
    </span>
  )
}
