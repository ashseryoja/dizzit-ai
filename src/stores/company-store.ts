"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"

/** Данные исполнителя — подпись в аккаунте и шапки будущих экспортов. */
export interface CompanyProfile {
  name: string
  contact: string
}

interface CompanyState extends CompanyProfile {
  update: (patch: Partial<CompanyProfile>) => void
}

/* Ключ остался `smeta-company` намеренно: в нём только название и контакты,
   они переживают смену профиля сервиса. Сметные «накрутки по умолчанию»,
   лежащие в старых записях, просто не читаются. */
export const useCompanyStore = create<CompanyState>()(
  persist(
    (set) => ({
      name: "",
      contact: "",

      update: (patch) => set((state) => ({ ...state, ...patch })),
    }),
    {
      name: "smeta-company",
      partialize: (state) => ({ name: state.name, contact: state.contact }),
    }
  )
)
