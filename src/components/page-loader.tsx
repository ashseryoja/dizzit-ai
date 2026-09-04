import { ThinkingGlyph } from "@/components/glyphs"

export function PageLoader({ message = "Загрузка" }: { message?: string }) {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3">
      <ThinkingGlyph size={24} className="text-white/40" />
      <span className="ds-caption">{message}</span>
    </div>
  )
}
