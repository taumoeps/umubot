import { unstable_cache } from 'next/cache'
import { supabase } from './supabase'

// UmuBot -- real, non-NZ price fallback for Essential, ported from
// RecipeBot's authenticated Today pipeline (mosaro's src/app/api/
// food-prices/today/route.ts, src/lib/openFoodFactsPrices.ts,
// src/lib/globalProductPrices.ts) at the operator's explicit request,
// 2026-10-13, after confirming live that mechanism is real and already
// tested against real countries including Tonga -- but lives only in
// RecipeBot's authenticated iOS API, not on this public site, and uses
// the iPhone's own locale setting rather than GPS, which a website
// doesn't have. This module is a FRESH port for the web: country comes
// from reverse-geocoding the real GPS coordinates the existing "Use my
// location" button already collects, and deliberately covers only the
// two REAL (non-AI) tiers of RecipeBot's own 3-tier chain -- the third
// tier calls a Python agent that does a live, real-money web search per
// food per country; that's a reasonable cost for one authenticated
// iOS user's own request, not for an unauthenticated public page with
// no rate limiting built yet (operator decision, 2026-10-13).
//
// Tier A -- Open Food Facts Prices: real per-store crowd-submitted
// prices, matched via essential_foods.off_category_tags. Real, hard
// constraint ported faithfully, not glossed over: the barcode-resolution
// endpoint (world.openfoodfacts.org) enforces 15 requests/MINUTE per
// IP, shared across every concurrent visitor this site serves (Vercel's
// outbound IP is not per-visitor). off_product_cache (mosaro's own
// cache of barcodes already resolved by RecipeBot's real iOS traffic)
// is read-only here -- this site has no service-role key to write new
// entries to it, so a barcode this site resolves for the first time
// isn't cached for next time, unlike mosaro's own copy.
//
// Tier B -- GlobalProductPrices.com-derived estimate: NOT a live
// external call -- a read of global_food_price_references (a real
// table mosaro's own weekly cron populates, confirmed publicly
// readable), covering exactly 9 of the 22 foods (beef mince, chicken,
// milk, eggs, rice, flour, sugar, salt, cooking oil -- the SAME 9 that
// have no off_category_tags set, confirmed live: the two tiers are a
// clean, non-overlapping split of the 22 real foods, not two
// overlapping attempts per food). Ported with its real, already-
// disclosed gap intact, not silently fixed: the USD-to-local currency
// rate is hardcoded to 1 here too (same as mosaro's own call site),
// so the 4 "absolute"-method foods (flour, sugar, salt, cooking oil)
// are effectively still USD-valued regardless of the visitor's real
// country, until a real exchange-rate source is added.
//
// Real, disclosed coverage gap found live while building this,
// 2026-10-13: global_food_price_references has ZERO rows for Tonga
// specifically (confirmed via a direct query) -- the operator's own
// example country. For a country with no GlobalProductPrices rows and
// no real nearby Open Food Facts observations either, a food
// legitimately shows "no data for this country yet" rather than a
// guess -- that's an honest reflection of real, patchy international
// coverage, not a bug in this code.

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse'
// Nominatim's own usage policy: identify the real app, stay well under
// its soft rate limits. This call only ever fires once per explicit
// "Use my location" click, never automatically or in bulk.
const NOMINATIM_USER_AGENT = 'UmuBot/1.0 (https://umubot.vercel.app)'

export interface DetectedCountry {
  countryCode: string
  countryName: string
}

export async function reverseGeocodeCountry(lat: number, lon: number): Promise<DetectedCountry | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    let res: Response
    try {
      res = await fetch(
        `${NOMINATIM_URL}?lat=${lat}&lon=${lon}&format=json&zoom=3&addressdetails=1`,
        { signal: controller.signal, headers: { 'User-Agent': NOMINATIM_USER_AGENT } }
      )
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) return null
    const data = await res.json()
    const countryCode = data?.address?.country_code ? String(data.address.country_code).toUpperCase() : null
    const countryName = data?.address?.country ? String(data.address.country) : null
    if (!countryCode || !countryName) return null
    return { countryCode, countryName }
  } catch {
    return null
  }
}

// ---- Tier A: Open Food Facts Prices ----

const OFF_PRICES_URL = 'https://prices.openfoodfacts.org/api/v1/prices'
const OFF_PRODUCT_URL = 'https://world.openfoodfacts.org/api/v2/product'
const OFF_USER_AGENT = 'UmuBot/1.0 (hello@mosaro.cloud)'
// Real shared budget across every concurrent visitor -- see module doc.
// Deliberately tighter than mosaro's own per-food cap of 5, since that
// was sized for one authenticated user's own request; this is a total
// across all 13 OFF-covered foods in one visitor's request.
const MAX_LIVE_RESOLUTIONS_PER_REQUEST = 10

interface RawOffPricesResponse {
  items?: Array<{
    id: number
    product_code: string | null
    product_name: string | null
    price: number
    currency: string
    date: string
    location: { osm_name: string | null } | null
  }>
}

interface OffPriceObservation {
  productCode: string
  productName: string | null
  priceAmount: number
  currency: string
  storeName: string | null
}

async function offFetchOnce<T>(url: string, timeoutMs: number): Promise<T | null> {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': OFF_USER_AGENT } })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

async function offFetch<T>(url: string): Promise<T | null> {
  const first = await offFetchOnce<T>(url, 6000)
  if (first) return first
  await new Promise((r) => setTimeout(r, 500))
  return offFetchOnce<T>(url, 8000)
}

async function searchNearbyOff(lat: number, lon: number, radiusKm: number): Promise<OffPriceObservation[]> {
  const url = `${OFF_PRICES_URL}?lat=${lat}&lon=${lon}&radius_km=${radiusKm}&size=100`
  const data = await offFetch<RawOffPricesResponse>(url)
  if (!data?.items) return []
  return data.items
    .filter((i) => i.product_code != null)
    .map((i) => ({
      productCode: i.product_code!,
      productName: i.product_name,
      priceAmount: i.price,
      currency: i.currency,
      storeName: i.location?.osm_name ?? null,
    }))
}

interface ResolvedOffProduct {
  name: string | null
  categoriesTags: string[]
}

/** Reads mosaro's real off_product_cache first (shared, read-only --
 *  see module doc), only resolving live when genuinely uncached. */
async function resolveOffProduct(barcode: string, liveBudget: { remaining: number }): Promise<ResolvedOffProduct | null> {
  const { data: cached } = await supabase
    .from('off_product_cache')
    .select('product_name, categories_tags')
    .eq('barcode', barcode)
    .maybeSingle<{ product_name: string | null; categories_tags: string[] }>()
  if (cached) return { name: cached.product_name, categoriesTags: cached.categories_tags ?? [] }

  if (liveBudget.remaining <= 0) return null
  liveBudget.remaining -= 1

  const url = `${OFF_PRODUCT_URL}/${encodeURIComponent(barcode)}.json?fields=product_name,categories_tags`
  const data = await offFetch<{ product?: { product_name?: string | null; categories_tags?: string[] } }>(url)
  const product = data?.product
  if (!product) return null
  return { name: product.product_name ?? null, categoriesTags: product.categories_tags ?? [] }
}

export interface OffMatch {
  itemName: string
  priceAmount: number
  currency: string
  storeName: string | null
}

/** Tries real nearby OFF observations against one food's
 *  off_category_tags, stopping at the first genuine match. Shares
 *  liveBudget across every food tried in the same request. */
async function matchOffFood(
  observations: OffPriceObservation[],
  offCategoryTags: string[],
  liveBudget: { remaining: number }
): Promise<OffMatch | null> {
  if (offCategoryTags.length === 0 || observations.length === 0) return null
  const tagSet = new Set(offCategoryTags)
  for (const obs of observations) {
    const resolved = await resolveOffProduct(obs.productCode, liveBudget)
    if (!resolved) continue
    if (resolved.categoriesTags.some((t) => tagSet.has(t))) {
      return { itemName: resolved.name ?? obs.productName ?? 'Unknown product', priceAmount: obs.priceAmount, currency: obs.currency, storeName: obs.storeName }
    }
  }
  return null
}

// ---- Tier B: GlobalProductPrices.com-derived estimate ----

const PRODUCT_KEY_TO_FOOD_ID: Record<string, string> = {
  beef: 'beef-mince',
  poultry: 'chicken',
  milk: 'milk',
  eggs: 'eggs',
  rice: 'rice',
  flour: 'flour',
  sugar: 'sugar',
  salt: 'salt',
  cooking_oil: 'cooking-oil',
}
const FOOD_ID_TO_PRODUCT_KEY: Record<string, string> = Object.fromEntries(
  Object.entries(PRODUCT_KEY_TO_FOOD_ID).map(([key, foodId]) => [foodId, key])
)
const RATIO_BASED_PRODUCT_KEYS = new Set(['beef', 'poultry', 'milk', 'eggs', 'rice'])
const ABSOLUTE_PRODUCT_KEYS = new Set(['flour', 'sugar', 'salt', 'cooking_oil'])

// Cached -- unlike the OFF tier (genuinely per-location), this only
// depends on (productKey, country), so every visitor from the same
// country shares one real DB read instead of paying it per request.
// Confirmed live this was worth doing: an uncached real resolution for
// Sydney/Australia took ~16s end-to-end, most of it this tier's own
// several small sequential reads across up to 9 foods.
const latestReference = unstable_cache(
  async (productKey: string, country: string): Promise<number | null> => {
    const { data } = await supabase
      .from('global_food_price_references')
      .select('price_usd')
      .eq('product_key', productKey)
      .eq('country', country)
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ price_usd: number }>()
    return data?.price_usd ?? null
  },
  ['global-food-price-reference'],
  { revalidate: 3600 }
)


export interface GlobalPriceEstimate {
  priceUsd: number
  method: 'ratio' | 'absolute'
}

/** usdToLocalRate: real currency conversion, deliberately NOT
 *  implemented here -- see module doc. Pass 1 to get a USD-valued
 *  result, same honest gap as mosaro's own call site. */
async function getGlobalPriceEstimate(foodId: string, countryName: string, usdToLocalRate: number): Promise<GlobalPriceEstimate | null> {
  const productKey = FOOD_ID_TO_PRODUCT_KEY[foodId]
  if (!productKey) return null
  const countryValue = await latestReference(productKey, countryName)
  if (countryValue == null) return null

  if (RATIO_BASED_PRODUCT_KEYS.has(productKey)) {
    const nzValue = await latestReference(productKey, 'New Zealand')
    if (nzValue == null || nzValue <= 0) return null
    const { data: nzBasktRow } = await supabase
      .from('price_observations')
      .select('price_cents')
      .eq('food_id', foodId)
      .eq('source', 'baskt')
      .order('observed_at', { ascending: false })
      .limit(1)
      .maybeSingle<{ price_cents: number }>()
    if (!nzBasktRow) return null
    const ratio = countryValue / nzValue
    return { priceUsd: (nzBasktRow.price_cents / 100) * ratio, method: 'ratio' }
  }

  if (ABSOLUTE_PRODUCT_KEYS.has(productKey)) {
    return { priceUsd: countryValue * usdToLocalRate, method: 'absolute' }
  }

  return null
}

// ---- Orchestration ----

export interface EssentialFoodRow {
  id: string
  display_name: string
  category: string
  off_category_tags: string[] | null
}

export interface OverseasFoodResult {
  foodId: string
  displayName: string
  category: string
  tier: 'off' | 'global-estimate' | 'none'
  itemName: string | null
  priceUsd: number | null
  currency: string | null
  storeName: string | null
}

export async function getRealBasketFoodsForOverseas(): Promise<EssentialFoodRow[]> {
  const { data, error } = await supabase
    .from('essential_foods')
    .select('id, display_name, category, off_category_tags')
    .eq('basket_slot', true)
    .eq('is_active', true)
    .order('display_name', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as EssentialFoodRow[]
}

/** Resolves real (non-NZ) prices for every real essential food, using
 *  whichever of the two tiers actually covers it -- see module doc for
 *  why that's a clean, non-overlapping split, not two attempts per
 *  food. A food with no real data in either tier returns tier: 'none',
 *  shown honestly rather than guessed. */
export async function resolveOverseasEssentials(lat: number, lon: number, countryName: string): Promise<OverseasFoodResult[]> {
  const foods = await getRealBasketFoodsForOverseas()
  const offObservations = await searchNearbyOff(lat, lon, 50)
  const liveBudget = { remaining: MAX_LIVE_RESOLUTIONS_PER_REQUEST }

  const results: OverseasFoodResult[] = []
  for (const food of foods) {
    if (food.off_category_tags && food.off_category_tags.length > 0) {
      const match = await matchOffFood(offObservations, food.off_category_tags, liveBudget)
      results.push({
        foodId: food.id, displayName: food.display_name, category: food.category,
        tier: match ? 'off' : 'none',
        itemName: match?.itemName ?? null, priceUsd: match?.priceAmount ?? null,
        currency: match?.currency ?? null, storeName: match?.storeName ?? null,
      })
      continue
    }

    const estimate = await getGlobalPriceEstimate(food.id, countryName, 1)
    results.push({
      foodId: food.id, displayName: food.display_name, category: food.category,
      tier: estimate ? 'global-estimate' : 'none',
      itemName: estimate ? food.display_name : null, priceUsd: estimate?.priceUsd ?? null,
      currency: estimate ? 'USD' : null, storeName: null,
    })
  }
  return results
}
