"use client"

import { useEffect, useState } from "react"

/**
 * true после первого клиентского рендера.
 *
 * Нужен всем экранам, которые читают zustand-persist: localStorage
 * восстанавливается ДО гидратации React, поэтому серверный HTML (пусто) и
 * первый клиентский рендер (данные) расходятся, и React ругается на
 * несовпадение. Пока false — показываем скелет, а не «проектов нет»: иначе
 * пустое состояние мигало бы поверх существующих данных.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  return mounted
}
