// The one source of essential-food prices for this site (RecipeBot
// docs/ESSENTIALS_ALIGNMENT_PLAN_2026-10.md, step 5): mosaro's shared
// essentials service, GET /api/essentials -- the same service RecipeBot's
// Today screen uses, so both show the same product for the same food.
// Replaces this site's own selection (essentialFoodsView.ts's
// getEssentialProductsByGroup) and nearest-store lookup (nearbyEssential.ts),
// which disagreed with the app on 7 of 22 foods (2026-10-21 audit).
//
// Types mirror mosaro/src/lib/essentialsSelect.ts. Safe on server and client
// (no Supabase, no next/cache); browser code calls it through this site's
// own /api/nearby-essential proxy, so mosaro needs no CORS for it.

export type FreshnessTier = 'live' | 'recent' | 'estimated'
export type UnitMeasure = 'kg' | 'L' | 'ea'
export type EssentialGroup = 'pantry' | 'nutrition'

export interface Offer {
  itemName: string
  packSize: string | null
  priceCents: number
  unitPriceCents: number | null
  unitMeasure: UnitMeasure | null
  chain: string | null
  storeName: string | null
  distanceKm: number | null
  observedAt: string
  tier: FreshnessTier
  source: string
  promoFlag: boolean
  /** One serving of the food at this price (EssentialItem.servingLabel says how much). */
  servingCents?: number | null
}

export interface EssentialItem {
  foodId: string
  defaultFoodId: string
  displayName: string
  group: EssentialGroup | null
  isCustom: boolean
  substituteFor: string | null
  /** 'direct' = the same food, 'culinary' = a cut that cooks the same way (Year 2 feature 2.2). */
  substituteKind?: 'direct' | 'culinary' | null
  /** Year 3 feature 3.2 (My Essentials): why this food is shown for a signed-in household. */
  personalised?: string | null
  representative: Offer | null
  cheapestNearby: Offer | null
  outOfRange: Offer | null
  productScope: 'national' | 'local' | null
  variants: number
  /** One of the original 22 basket foods. */
  core?: boolean
  servingLabel?: string | null
  /** Typical storage life, unopened. */
  shelfLifeDays?: number | null
  /** Opened / freezer life and a tip (Year 2 feature 2.3). */
  storage?: FoodStorage | null
  /** Nutrition for one serving (USDA data; labels use Food Standards Code thresholds). */
  nutrition?: { perServing: string; claims: string | null; note: string | null } | null
  /** Servings in the pack shown vs how long it keeps, e.g. "≈10 servings in this pack and it keeps ~5 days…" */
  wasteTip?: string | null
}

export interface EssentialsGroup {
  group: EssentialGroup
  label: string
  items: EssentialItem[]
}

export interface EssentialsResult {
  mode: 'national' | 'nearby'
  radiusKm: number | null
  groups: EssentialsGroup[]
  insight: string | null
  generatedAt: string
}

export const MOSARO_URL = process.env.NEXT_PUBLIC_MOSARO_URL ?? 'https://mosaro.vercel.app'

/** Same radius RecipeBot's Today uses by default on the operator's device. */
export const NEARBY_RADIUS_KM = 50

export interface FoodStorage { unopenedDays: number | null; openedDays: number | null; freezerDays: number | null; freezesWell: boolean; tip: string | null }

/** "about 5 days", "about 3 months", "about 2 years" */
export function formatKeeps(days: number): string {
  if (days >= 365) { const y = Math.round(days / 365); return `about ${y} year${y === 1 ? '' : 's'}` }
  if (days >= 60) { const m = Math.round(days / 30); return `about ${m} months` }
  if (days >= 14) { const w = Math.round(days / 7); return `about ${w} weeks` }
  return `about ${days} day${days === 1 ? '' : 's'}`
}

export async function fetchEssentials(
  q: { lat?: number; lng?: number; radiusKm?: number; accessToken?: string; set?: 'basket' | 'all' } = {},
  init: RequestInit & { next?: { revalidate?: number } } = {}
): Promise<EssentialsResult> {
  const params = new URLSearchParams()
  if (q.lat != null && q.lng != null) {
    params.set('lat', String(q.lat))
    params.set('lng', String(q.lng))
    params.set('radiusKm', String(q.radiusKm ?? NEARBY_RADIUS_KM))
  }
  if (q.set === 'all') params.set('set', 'all')
  const url = `${MOSARO_URL}/api/essentials${params.size ? `?${params}` : ''}`
  const headers = new Headers(init.headers)
  if (q.accessToken) headers.set('Authorization', `Bearer ${q.accessToken}`)
  const res = await fetch(url, { ...init, headers })
  if (!res.ok) throw new Error(`essentials service: HTTP ${res.status}`)
  return (await res.json()) as EssentialsResult
}

const UNIT_LABELS: Record<UnitMeasure, string> = { kg: '/kg', L: '/L', ea: ' each' }

export function formatUnitPrice(offer: Pick<Offer, 'unitPriceCents' | 'unitMeasure'>): string | null {
  if (offer.unitPriceCents == null || !offer.unitMeasure) return null
  return `$${(offer.unitPriceCents / 100).toFixed(2)}${UNIT_LABELS[offer.unitMeasure]}`
}

const CHAIN_LABELS: Record<string, string> = { paknsave: "PAK'nSAVE", 'new-world': 'New World' }

export function storeLabel(offer: Pick<Offer, 'storeName' | 'chain'>): string {
  return offer.storeName ?? (offer.chain ? (CHAIN_LABELS[offer.chain] ?? offer.chain) : 'Unknown store')
}

/** "keeps ~2 years" / "~3 months" / "~2 weeks" / "5 days" -- a guide, the pack's own date wins. */
export function formatShelfLife(days: number | null | undefined): string | null {
  if (days == null || days <= 0) return null
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`
  if (days < 60) return `~${Math.round(days / 7)} weeks`
  if (days < 365) return `~${Math.round(days / 30)} months`
  const years = Math.round((days / 365) * 2) / 2
  return `~${years} year${years === 1 ? '' : 's'}`
}

/** "≈$0.20 per serving (75 g dry)" */
export function formatServing(offer: Pick<Offer, 'servingCents'>, label: string | null | undefined): string | null {
  if (offer.servingCents == null) return null
  // A pinch of salt rounds to 0 cents: say so rather than "$0.00".
  const price = offer.servingCents < 1 ? 'under 1¢' : `≈$${(offer.servingCents / 100).toFixed(2)}`
  return `${price} per serving${label ? ` (${label})` : ''}`
}

// --- Year 2 feature 2.1: compare pack sizes (mosaro GET /api/essentials/compare) -------------

export interface SizeOption {
  itemName: string
  packSize: string | null
  priceCents: number
  unitPriceCents: number | null
  unitMeasure: UnitMeasure | null
  storeName: string | null
  chain: string | null
  distanceKm: number | null
  tier: FreshnessTier
  observedAt: string
  servingsPerPack: number | null
  cheapestPerUnit: boolean
  bestValueInTime: boolean
}

export interface SizeComparison {
  foodId: string
  displayName: string
  shelfLifeDays: number | null
  options: SizeOption[]
  note: string | null
}

export async function fetchSizeComparison(
  foodId: string,
  q: { lat?: number; lng?: number; radiusKm?: number } = {},
  init: RequestInit & { next?: { revalidate?: number } } = {}
): Promise<SizeComparison | null> {
  const params = new URLSearchParams({ food: foodId })
  if (q.lat != null && q.lng != null) {
    params.set('lat', String(q.lat))
    params.set('lng', String(q.lng))
    params.set('radiusKm', String(q.radiusKm ?? NEARBY_RADIUS_KM))
  }
  const res = await fetch(`${MOSARO_URL}/api/essentials/compare?${params}`, init)
  if (!res.ok) return null
  return (await res.json()) as SizeComparison
}

/** Feature switches (mosaro config/feature-flags.json). UMUBOT_PREVIEW_FLAGS (comma-separated,
 *  server env, never set in production) turns switches on locally to preview a hidden feature. */
export async function fetchFeatureFlags(init: RequestInit & { next?: { revalidate?: number } } = {}): Promise<Record<string, boolean>> {
  let flags: Record<string, boolean> = {}
  try {
    const res = await fetch(`${MOSARO_URL}/api/feature-flags`, init)
    if (res.ok) flags = ((await res.json()) as { flags?: Record<string, boolean> }).flags ?? {}
  } catch {
    // Switches unreadable = everything off: a hidden feature never appears by accident.
  }
  for (const name of (process.env.UMUBOT_PREVIEW_FLAGS ?? '').split(',').map((s) => s.trim()).filter(Boolean)) flags[name] = true
  return flags
}

// --- Year 2 feature 2.2: typed substitutions (mosaro GET /api/essentials/swaps) ---------------

export type SwapKind = 'direct' | 'culinary' | 'nutritional'
export interface Substitution { foodId: string; displayName: string; kind: SwapKind; reason: string | null; costPerServingCents: number | null; approved: boolean }
export interface SubstitutionResult { foodId: string; displayName: string; costPerServingCents: number | null; groups: { kind: SwapKind; label: string; items: Substitution[] }[] }

export async function fetchSubstitutions(
  foodId: string,
  q: { lat?: number; lng?: number; radiusKm?: number } = {},
  init: RequestInit & { next?: { revalidate?: number } } = {}
): Promise<SubstitutionResult | null> {
  const params = new URLSearchParams({ food: foodId })
  if (q.lat != null && q.lng != null) {
    params.set('lat', String(q.lat))
    params.set('lng', String(q.lng))
    params.set('radiusKm', String(q.radiusKm ?? NEARBY_RADIUS_KM))
  }
  const res = await fetch(`${MOSARO_URL}/api/essentials/swaps?${params}`, init)
  if (!res.ok) return null
  return (await res.json()) as SubstitutionResult
}

// --- Year 2 feature 2.5: budget basket (mosaro GET /api/essentials/basket) ---------------------

export interface BasketLine { foodId: string; displayName: string; productName: string; storeName: string | null; portions: number; servingLabel: string | null; packs: number; costCents: number; lastsWeeks: number | null }
export interface BudgetBasket {
  budgetCents: number; adults: number; children: number; totalCents: number; fullBasketCents: number; fits: boolean
  groups: { key: string; label: string; portionsNeeded: number; portionsCovered: number; lines: BasketLine[] }[]
  fallsOff: { foodId: string; displayName: string; group: string; costCents: number }[]
  note: string | null
  /** Year 2 feature 2.6 (shown behind the nutrition-coverage switch). */
  nutrition?: NutritionCoverage | null
}

export interface NutrientCoverage { key: string; label: string; unit: string; amount: number; target: number; percent: number; status: 'covered' | 'most' | 'possible-gap' | 'no-data'; missingFor: string[]; note: string | null }
export interface NutritionCoverage { people: number; nutrients: NutrientCoverage[]; summary: string }

export async function fetchBudgetBasket(
  q: { budgetDollars: number; adults: number; children: number; lat?: number; lng?: number; radiusKm?: number },
  init: RequestInit & { next?: { revalidate?: number } } = {}
): Promise<BudgetBasket | null> {
  const params = new URLSearchParams({ budget: String(q.budgetDollars), adults: String(q.adults), children: String(q.children) })
  if (q.lat != null && q.lng != null) {
    params.set('lat', String(q.lat))
    params.set('lng', String(q.lng))
    params.set('radiusKm', String(q.radiusKm ?? NEARBY_RADIUS_KM))
  }
  const res = await fetch(`${MOSARO_URL}/api/essentials/basket?${params}`, init)
  if (!res.ok) return null
  return (await res.json()) as BudgetBasket
}
