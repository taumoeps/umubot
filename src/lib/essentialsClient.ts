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
  /** Nutrition for one serving (USDA data; labels use Food Standards Code thresholds). */
  nutrition?: { perServing: string; claims: string | null; note: string | null } | null
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
