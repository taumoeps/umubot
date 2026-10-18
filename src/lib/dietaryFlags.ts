import { unstable_cache } from 'next/cache'
import { supabase } from './supabase'

// UmuBot -- Phase 3 (essential-foods-implementation.md Sec10): a lightweight, anonymous (no
// account) dietary-restriction filter for Essential, backed by the real food_dietary_flags /
// essential_food_dietary_flags tables (essential-foods-phase3-migration.sql). Operator decision
// this session: umubot stays account-free by design, so this lives entirely in the browser
// (localStorage) -- no server-side user_preferences, that's RecipeBot's (iOS, has real accounts)
// job for a logged-in user, not this public site's.
//
// Liability-conscious by construction: every per-food flag is a POSITIVE, definitional property
// (e.g. "contains-pork"), each one carrying a confidence of 'definite' or 'uncertain' -- never an
// asserted "is vegetarian"/"is vegan" tag on a food, which would require confidently judging
// things this data genuinely can't resolve (hidden rennet source, shared-equipment traces, etc).
// Restriction compliance below is DERIVED from the absence of disqualifying flags, and an
// 'uncertain' flag still disqualifies -- a possible match is not a confirmed one, and this is a
// convenience filter, not a medical/allergen guarantee (the UI must say so, not just imply it).

export interface DietaryRestriction {
  id: string
  label: string
  /** flag_ids that disqualify a food from this restriction if present with ANY confidence. */
  excludesFlags: string[]
}

export const DIETARY_RESTRICTIONS: DietaryRestriction[] = [
  { id: 'vegetarian', label: 'Vegetarian', excludesFlags: ['contains-meat', 'contains-fish'] },
  { id: 'vegan', label: 'Vegan', excludesFlags: ['contains-meat', 'contains-fish', 'contains-dairy', 'contains-egg'] },
  { id: 'dairy-free', label: 'Dairy-free', excludesFlags: ['contains-dairy'] },
  { id: 'gluten-free', label: 'Gluten-free', excludesFlags: ['contains-gluten'] },
  { id: 'egg-free', label: 'Egg-free', excludesFlags: ['contains-egg'] },
  { id: 'no-pork', label: 'No pork', excludesFlags: ['contains-pork'] },
]

interface DietaryFlagRow {
  food_id: string
  flag_id: string
}

const getDietaryFlagsByFoodIdUncached = async (): Promise<Record<string, string[]>> => {
  const { data, error } = await supabase.from('essential_food_dietary_flags').select('food_id, flag_id')
  if (error) throw new Error(error.message)
  const byFoodId: Record<string, string[]> = {}
  for (const row of (data ?? []) as DietaryFlagRow[]) {
    if (!byFoodId[row.food_id]) byFoodId[row.food_id] = []
    byFoodId[row.food_id].push(row.flag_id)
  }
  return byFoodId
}

/** Cached 5 minutes, same convention as essentialFoodsView.ts's own unstable_cache -- this is
 *  small, slow-changing reference data, not worth a live query per page load. */
export const getDietaryFlagsByFoodId = unstable_cache(getDietaryFlagsByFoodIdUncached, ['essential-dietary-flags'], { revalidate: 300 })

/** True when a food (by its own flag list) satisfies every selected restriction. A food with NO
 *  flags at all (e.g. a plain fruit/vegetable) trivially satisfies every restriction -- that's
 *  correct, not a gap, since the backfill only records POSITIVE contains-X properties. */
export function isRestrictionCompliant(foodFlags: string[], selectedRestrictionIds: string[]): boolean {
  const excluded = new Set(
    selectedRestrictionIds.flatMap((id) => DIETARY_RESTRICTIONS.find((r) => r.id === id)?.excludesFlags ?? [])
  )
  return !foodFlags.some((f) => excluded.has(f))
}
