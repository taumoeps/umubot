'use client'

import { createContext, useContext, useState, type ReactNode } from 'react'

// UmuBot -- shared, client-only state between NearbyEssential.tsx
// (where real location detection happens) and Nav.tsx (which needs to
// know the result to decide whether to show Grocery). Nav and the
// Essential page are siblings under the same layout, not parent/child,
// so this needs real shared state, not a prop.
//
// Grocery hidden by default, revealed ONLY once a real location check
// actually confirms NZ (operator decision, 2026-10-13, correcting an
// earlier version of this that defaulted to visible-unless-overseas --
// the real requirement is narrower: hidden until a genuine confirmation,
// not hidden only after a genuine disconfirmation). A failed/denied
// location check, an overseas result, or just never having used the
// button at all all leave this false -- only an explicit confirmedNZ:
// true from the real API response sets it true.

interface LocationModeContextValue {
  isConfirmedNZ: boolean
  setIsConfirmedNZ: (value: boolean) => void
}

const LocationModeContext = createContext<LocationModeContextValue | null>(null)

export function LocationModeProvider({ children }: { children: ReactNode }) {
  const [isConfirmedNZ, setIsConfirmedNZ] = useState(false)
  return <LocationModeContext.Provider value={{ isConfirmedNZ, setIsConfirmedNZ }}>{children}</LocationModeContext.Provider>
}

export function useLocationMode(): LocationModeContextValue {
  const ctx = useContext(LocationModeContext)
  if (!ctx) throw new Error('useLocationMode must be used within LocationModeProvider')
  return ctx
}
