// UmuBot -- real Baskt pack_size parsing, extracted from mealAffordability.ts into its own
// shared module, 2026-10-18 (Today v2 / Phase 2 task 3: comparable unit pricing on Essential's
// cards, essential-foods-implementation.md Sec6.1's own worked example -- "the UI should show
// both total purchase cost and comparable unit price, not automatically choose the smallest or
// cheapest pack"). Same "share one copy, don't let two independently-maintained copies drift
// apart" discipline this codebase already applied once to looksPlain/PROCESSED_KEYWORDS
// (essentialFoodsView.ts's own module doc) -- this parser already existed, correctly, inside
// mealAffordability.ts; duplicating it here instead of extracting it would be exactly the
// mistake that earlier move was made to avoid.

export interface ResolvedWeight {
  totalGrams: number
  isPerKg: boolean
  isAssumedWeight: boolean
}

/** Reasonable, clearly-assumed per-unit weight (grams) for foods whose real pack_size is
 *  count-based ("ea", "Npk") with no real weight attached. Only used when no real parseable
 *  weight exists in the product's own pack_size. */
export const ASSUMED_UNIT_GRAMS: Record<string, number> = {
  bread: 80, // one bread roll
  broccoli: 500, // one head
  eggs: 55, // one large egg
  bananas: 130, // one banana
  chicken: 150, // one piece/skewer
}

/** Parses a real Baskt pack_size string into a total gram weight. Returns null for count-based
 *  sizes ("ea", "Npk") with no real weight -- the caller applies ASSUMED_UNIT_GRAMS for those. */
export function parseRealPackSize(packSize: string): ResolvedWeight | null {
  const s = packSize.trim().toLowerCase()

  if (s === 'kg') return { totalGrams: 1000, isPerKg: true, isAssumedWeight: false }

  const multiMatch = s.match(/^(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*g$/)
  if (multiMatch) return { totalGrams: parseFloat(multiMatch[1]) * parseFloat(multiMatch[2]), isPerKg: false, isAssumedWeight: false }

  const kgMatch = s.match(/^(\d+(?:\.\d+)?)\s*kg$/)
  if (kgMatch) return { totalGrams: parseFloat(kgMatch[1]) * 1000, isPerKg: false, isAssumedWeight: false }

  const gMatch = s.match(/^(\d+(?:\.\d+)?)\s*g$/)
  if (gMatch) return { totalGrams: parseFloat(gMatch[1]), isPerKg: false, isAssumedWeight: false }

  const lMatch = s.match(/^(\d+(?:\.\d+)?)\s*l$/)
  if (lMatch) return { totalGrams: parseFloat(lMatch[1]) * 1000, isPerKg: false, isAssumedWeight: false } // 1ml ~ 1g

  const mlMatch = s.match(/^(\d+(?:\.\d+)?)\s*ml$/)
  if (mlMatch) return { totalGrams: parseFloat(mlMatch[1]), isPerKg: false, isAssumedWeight: false }

  return null
}

export function resolveWeight(packSize: string | null, foodId: string): ResolvedWeight | null {
  if (!packSize) return null
  const real = parseRealPackSize(packSize)
  if (real) return real

  const unitGrams = ASSUMED_UNIT_GRAMS[foodId]
  if (!unitGrams) return null

  const s = packSize.trim().toLowerCase()
  if (s === 'ea') return { totalGrams: unitGrams, isPerKg: false, isAssumedWeight: true }
  const pkMatch = s.match(/^(\d+)\s*pk$/)
  if (pkMatch) return { totalGrams: unitGrams * parseInt(pkMatch[1], 10), isPerKg: false, isAssumedWeight: true }

  return null
}
