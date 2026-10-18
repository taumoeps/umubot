import { supabase } from './supabase'

// UmuBot -- real location-aware "nearest store" matching for Essential,
// ported from mosaro's Today pipeline (src/lib/baskt.ts,
// src/lib/basktSync.ts, src/app/api/food-prices/today/route.ts) at the
// operator's explicit request, 2026-10-11: find the real nearest store
// with the food in stock, substitute a real fallback food
// (essential_foods.fallback_food_ids) when the primary has none nearby.
//
// What's reused vs rebuilt: Baskt's API is public and keyless (no
// Supabase/service-role needed for the Baskt calls themselves), so
// findNearbyLocations/searchAtLocation port directly. What does NOT
// port: mosaro's PostGIS-backed nearby_food_prices cache (real infra
// specific to mosaro's own DB functions) and any write-back to
// price_observations (service-role only, correctly unavailable to the
// public anon key this site uses). This does LIVE Baskt lookups only,
// no caching layer -- simpler than mosaro's full pipeline, and more
// honest (always fresh) at the cost of being slower per request.
//
// Baskt's own usage terms (quoted in mosaro's baskt.ts module doc):
// "Do not use the public API... as a raw bulk export feed" -- real
// Today-loads/once-daily syncs only, never a bulk scan. This is only
// ever triggered by an explicit user action (clicking "Use my
// location"), scoped to the nearest 1-2 real covered locations per
// food, never a scan across all ~200 covered stores.

const BASKT_URL = 'https://baskt.nz/api/v1'
const COVERED_CHAINS = ['new-world', 'paknsave'] as const

export interface BasktLocation {
  id: string
  chain: string
  name: string
  lat: number
  lng: number
}

export interface NearbyMatch {
  itemName: string
  brand: string | null
  packSize: string | null
  priceCents: number
  chain: string
  storeName: string
  distanceKm: number
}

const RATE_LIMITED = Symbol('rate-limited')

async function basktFetchOnce<T>(path: string, timeoutMs: number): Promise<T | null | typeof RATE_LIMITED> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await fetch(`${BASKT_URL}${path}`, { signal: controller.signal })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) return res.status === 429 ? RATE_LIMITED : null
    return await res.json()
  } catch {
    return null
  }
}

// Same two-retry, longer-backoff-on-429 discipline as mosaro's baskt.ts
// -- confirmed there as the real fix for genuine Baskt-side rate
// limiting under concurrent load, not just generic flakiness.
async function basktFetch<T>(path: string): Promise<T | null> {
  const first = await basktFetchOnce<T>(path, 6000)
  if (first && first !== RATE_LIMITED) return first
  await new Promise((r) => setTimeout(r, first === RATE_LIMITED ? 3000 : 400))
  const second = await basktFetchOnce<T>(path, 6000)
  if (second && second !== RATE_LIMITED) return second
  await new Promise((r) => setTimeout(r, second === RATE_LIMITED ? 5000 : 900))
  const result = await basktFetchOnce<T>(path, 8000)
  return result === RATE_LIMITED ? null : result
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.asin(Math.sqrt(a))
}

interface RawBasktLocation {
  id: string | number
  chain: string
  name: string
  lat: number | null
  lng: number | null
}
interface RawBasktLocationsResponse {
  data?: { locations?: RawBasktLocation[] }
}
interface RawBasktItem {
  id: string | number
  chain: string
  name: string
  packSize?: string | null
  brand?: string | null
}
interface RawBasktPrice {
  itemId: string
  locationId: string | number
  priceCents: number
}
interface RawBasktItemsResponse {
  data?: { items?: RawBasktItem[]; latestPrices?: RawBasktPrice[] }
}

/** Only new-world/paknsave carry real per-store coordinates on Baskt --
 *  same real constraint mosaro's baskt.ts documents (the other 5 Baskt
 *  chains have no usable per-store lat/lng at all). */
export async function findNearbyLocations(latitude: number, longitude: number, limit = 2): Promise<(BasktLocation & { distanceKm: number })[]> {
  const data = await basktFetch<RawBasktLocationsResponse>('/locations?limit=500')
  if (!data) return []
  const locations = data.data?.locations ?? []
  return locations
    .filter((l): l is RawBasktLocation & { lat: number; lng: number } => l.lat != null && l.lng != null)
    .filter((l) => (COVERED_CHAINS as readonly string[]).includes(l.chain))
    .map((l) => ({
      id: String(l.id), chain: l.chain, name: l.name, lat: l.lat, lng: l.lng,
      distanceKm: haversineKm(latitude, longitude, l.lat, l.lng),
    }))
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit)
}

async function searchAtLocation(itemName: string, location: BasktLocation & { distanceKm: number }): Promise<NearbyMatch[]> {
  const query = itemName.trim().toLowerCase()
  const data = await basktFetch<RawBasktItemsResponse>(
    `/items?q=${encodeURIComponent(itemName)}&locationId=${encodeURIComponent(location.id)}&limit=100&chain=${location.chain}`
  )
  if (!data) return []
  const items = data.data?.items ?? []
  // Word-boundary startsWith, not plain startsWith -- real bug caught
  // live 2026-10-11: plain startsWith('bread') matches "Breadcrumbs"
  // too ("Breadcrumbs" literally starts with "Bread"), surfacing
  // breadcrumbs as a real match for the essential food "Bread". The
  // character immediately after the matched term must be a boundary
  // (space, open paren, or end of string) for it to count.
  const matches = items.filter((i) => {
    const name = String(i.name ?? '').toLowerCase()
    if (!name.startsWith(query)) return false
    const nextChar = name.charAt(query.length)
    return nextChar === '' || nextChar === ' ' || nextChar === '('
  })
  if (matches.length === 0) return []
  const matchedIds = new Set(matches.map((m) => String(m.id)))
  const infoById = new Map(matches.map((m) => [String(m.id), m]))
  const prices = data.data?.latestPrices ?? []
  return prices
    .filter((p) => matchedIds.has(String(p.itemId)) && String(p.locationId) === location.id)
    .map((p) => {
      const info = infoById.get(String(p.itemId))
      return {
        itemName: info?.name ?? itemName,
        brand: info?.brand ?? null,
        packSize: info?.packSize ?? null,
        priceCents: p.priceCents,
        chain: location.chain,
        storeName: location.name,
        distanceKm: location.distanceKm,
      }
    })
}

/** Tries each real term in order at a real nearby location, returning
 *  the first match -- same "first startsWith match wins, not every
 *  candidate" discipline as mosaro's searchAtLocation callers. */
async function searchTermsAtLocation(terms: string[], location: BasktLocation & { distanceKm: number }): Promise<NearbyMatch | null> {
  for (const term of terms) {
    const matches = await searchAtLocation(term, location)
    if (matches.length > 0) return matches.sort((a, b) => a.priceCents - b.priceCents)[0]
  }
  return null
}

export interface EssentialFoodRow {
  id: string
  display_name: string
  category: string
  essential_group: string | null
  search_terms: unknown
  fallback_food_ids: unknown
}

/** Phase 3 (essential-foods-implementation.md Sec7/Sec7.1): the four typed substitution
 *  relationships, replacing the flat, untyped fallback_food_ids with real classified data from
 *  the new food_relationships table. 'equivalent' = genuinely the same product in a different
 *  pack/prep format (e.g. cheese vs grated cheese); everything else found in the real backfilled
 *  data turned out to be 'culinary' (a different cut/species/product commonly substituted, not
 *  literally the same thing) -- see essential-foods-phase3-migration.sql's backfill for the real
 *  per-relationship reasoning. 'form_alternative' and 'nutritional' exist in the type but aren't
 *  used by any of the 27 real backfilled relationships yet. */
export type RelationshipType = 'equivalent' | 'form_alternative' | 'culinary' | 'nutritional'

export const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  equivalent: 'same product, different pack',
  form_alternative: 'different storage form',
  culinary: 'culinary substitute',
  nutritional: 'nutritional alternative',
}

export interface ResolvedFood {
  foodId: string
  displayName: string
  category: string
  /** Today v2 (essential-foods-redesign.md): 'pantry' | 'nutrition' | null (not yet
   *  classified). Mirrors essentialFoodsView.ts's same field for the default browse view --
   *  see NearbyEssential.tsx for how the client groups by it. */
  essentialGroup: 'pantry' | 'nutrition' | null
  match: NearbyMatch | null
  /** The ORIGINAL food's display name when a fallback filled the slot,
   *  same real substituteFor semantics as mosaro's Today route --
   *  null means a direct match, not a substitute. */
  substituteFor: string | null
  /** Phase 3: the real relationship type for this substitution, looked up from
   *  food_relationships. Null when substituteFor is null (no substitution happened) OR when a
   *  substitution happened but no typed relationship row exists yet for that pair (shouldn't
   *  occur for the current 22-food basket -- every real fallback_food_ids pair was backfilled --
   *  but a food added later without a matching food_relationships row falls back to this,
   *  honestly, rather than guessing a type). */
  substituteRelationshipType: RelationshipType | null
}

function toEssentialGroup(value: string | null): 'pantry' | 'nutrition' | null {
  return value === 'pantry' || value === 'nutrition' ? value : null
}

/** Keyed "sourceId|targetId" -> relationship type, fetched once per request alongside the
 *  basket foods themselves (small table, cheap to load whole). */
export async function getRelationshipTypes(): Promise<Map<string, RelationshipType>> {
  const { data, error } = await supabase.from('food_relationships').select('source_food_id, target_food_id, relationship_type')
  if (error) throw new Error(error.message)
  return new Map((data ?? []).map((r): [string, RelationshipType] => [`${r.source_food_id}|${r.target_food_id}`, r.relationship_type as RelationshipType]))
}

/**
 * Real nearest-store resolution for one essential food: try the food's
 * own search_terms at the nearest real covered locations (nearest
 * first, stop at first real hit); if nothing, walk
 * fallback_food_ids in order and try each one's own search_terms the
 * same way. Mirrors mosaro's Today route's real fallback-walk control
 * flow exactly (first real hit wins, in array order).
 */
export async function resolveNearestFood(
  food: EssentialFoodRow,
  locations: (BasktLocation & { distanceKm: number })[],
  allFoodsById: Map<string, EssentialFoodRow>,
  relationshipTypes: Map<string, RelationshipType>
): Promise<ResolvedFood> {
  const essentialGroup = toEssentialGroup(food.essential_group)
  const primaryTerms = Array.isArray(food.search_terms) ? (food.search_terms as string[]) : []
  for (const location of locations) {
    const match = await searchTermsAtLocation(primaryTerms, location)
    if (match) return { foodId: food.id, displayName: food.display_name, category: food.category, essentialGroup, match, substituteFor: null, substituteRelationshipType: null }
  }

  const fallbackIds = Array.isArray(food.fallback_food_ids) ? (food.fallback_food_ids as string[]) : []
  for (const fallbackId of fallbackIds) {
    const fallbackFood = allFoodsById.get(fallbackId)
    if (!fallbackFood) continue
    const fallbackTerms = Array.isArray(fallbackFood.search_terms) ? (fallbackFood.search_terms as string[]) : []
    for (const location of locations) {
      const match = await searchTermsAtLocation(fallbackTerms, location)
      if (match) {
        const relationshipType = relationshipTypes.get(`${food.id}|${fallbackId}`) ?? null
        return { foodId: food.id, displayName: food.display_name, category: food.category, essentialGroup, match, substituteFor: food.display_name, substituteRelationshipType: relationshipType }
      }
    }
  }

  return { foodId: food.id, displayName: food.display_name, category: food.category, essentialGroup, match: null, substituteFor: null, substituteRelationshipType: null }
}

export async function getRealBasketFoods(): Promise<EssentialFoodRow[]> {
  const { data, error } = await supabase
    .from('essential_foods')
    .select('id, display_name, category, essential_group, search_terms, fallback_food_ids')
    .eq('basket_slot', true)
    .eq('is_active', true)
    .order('display_name', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as EssentialFoodRow[]
}
