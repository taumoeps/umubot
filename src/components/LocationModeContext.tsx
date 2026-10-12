'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'

// UmuBot -- shared, client-only state between NearbyEssential.tsx
// (where real location detection happens) and Nav.tsx (which needs to
// know the result to decide whether to show Grocery). Operator
// request, 2026-10-13: Grocery should stay visible for NZ visitors
// (the default, since the real "nearest store" lookup assumes NZ until
// proven otherwise) and hide only once a visitor's location is
// actually confirmed overseas -- not a flat, permanent hide. Nav and
// the Essential page are siblings under the same layout, not parent/
// child, so this needs real shared state, not a prop.

interface LocationModeContextValue {
  isOverseas: boolean
  setIsOverseas: (value: boolean) => void
}

const LocationModeContext = createContext<LocationModeContextValue | null>(null)

export function LocationModeProvider({ children }: { children: ReactNode }) {
  const [isOverseas, setIsOverseas] = useState(false)
  return <LocationModeContext.Provider value={{ isOverseas, setIsOverseas }}>{children}</LocationModeContext.Provider>
}

export function useLocationMode(): LocationModeContextValue {
  const ctx = useContext(LocationModeContext)
  if (!ctx) throw new Error('useLocationMode must be used within LocationModeProvider')
  return ctx
}
