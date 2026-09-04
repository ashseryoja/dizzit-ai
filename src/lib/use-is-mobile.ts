"use client"

import { useEffect, useState } from "react"

/**
 * true ниже lg (1024px) — граница, по которой сайдбар уезжает в шторку.
 * Начальное значение false: на сервере media queries нет, а первый клиентский
 * рендер должен совпасть с серверным, иначе React ругается на гидратацию.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const query = window.matchMedia("(max-width: 1023px)")
    const update = () => setIsMobile(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])

  return isMobile
}
