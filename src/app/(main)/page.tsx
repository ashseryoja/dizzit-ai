import { redirect } from "next/navigation"

/** Главный экран сервиса — первый инструмент. */
export default function RootPage() {
  redirect("/enhance")
}
