"use client"

import { useEffect, useState } from "react"

/**
 * true ниже lg (1024px) — граница, по которой сайдбар уезжает в шторку.
 * `maxWidth` задаёт другую границу: альбом раскладывается в две колонки
 * только с xl (1280px), и до неё считается «узким». Начальное значение
 * false: на сервере media queries нет, а первый клиентский рендер должен
 * совпасть с серверным, иначе React ругается на гидратацию.
 */
export function useIsMobile(maxWidth = 1023): boolean {
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const query = window.matchMedia(`(max-width: ${maxWidth}px)`)
    const update = () => setIsMobile(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [maxWidth])

  return isMobile
}
