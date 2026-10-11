import { supabase } from './supabase'
import { confidenceTierForSource, type ConfidenceTier } from './confidence'
import { cachedPaginatedQueryWithArg } from './paginatedQuery'

// UmuBot -- real price history/today's-prices for one specific observed
// product (keyed by item_name), reached from a food's product list
// (src/lib/essentialFoodsView.ts). Paginated AND cached via
// paginatedQuery.ts's cachedPaginatedQueryWithArg -- see that file's
// module doc for why this moved off a local fetchAllRows/unstable_cache
// pair (found and fixed by hand, 2026-10-12, same day as
// essentialFoodsView.ts's and productCatalogView.ts's own versions of
// this exact bug -- all three now share one implementation instead of
// three that could drift apart again).

export interface TodayPrice {
  chain: string
  storeName: string
  priceCents: number
  observedAt: string
  isCheapest: boolean
  tier: ConfidenceTier
}

export interface ChainHistoryPoint {
  date: string
  minPriceCents: number
}

export interface ChainHistory {
  chain: string
  points: ChainHistoryPoint[]
}

export interface ProductDetail {
  itemName: string
  brand: string | null
  packSize: string | null
  foodId: string | null
  todayByChain: TodayPrice[]
  history: ChainHistory[]
  lowestEverCents: number
  lowestEverDate: string
  historyStartDate: string
  historyEndDate: string
}

interface ProductDetailRow {
  chain: string | null
  store_name: string
  price_cents: number
  promo_flag: boolean
  observed_at: string
  brand: string | null
  pack_size: string | null
  food_id: string | null
  source: string
}

const getRowsForItem = cachedPaginatedQueryWithArg<ProductDetailRow, string>(
  ['product-detail-rows'],
  (itemName, from, to, withCount) =>
    supabase
      .from('price_observations')
      .select('chain, store_name, price_cents, promo_flag, observed_at, brand, pack_size, food_id, source', withCount ? { count: 'exact' } : undefined)
      .eq('item_name', itemName)
      .order('observed_at', { ascending: false })
      .range(from, to) as unknown as Promise<{ data: ProductDetailRow[] | null; error: { message: string } | null; count?: number | null }>
)

export async function getProductDetail(itemName: string): Promise<ProductDetail | null> {
  const rows = await getRowsForItem(itemName)
  if (rows.length === 0) return null

  const first = rows[0]

  const latestByChain = new Map<string, (typeof rows)[number]>()
  for (const r of rows) {
    const key = r.chain ?? r.store_name
    const existing = latestByChain.get(key)
    if (!existing || r.observed_at > existing.observed_at) latestByChain.set(key, r)
  }
  const cheapestCents = Math.min(...Array.from(latestByChain.values()).map((r) => r.price_cents))
  const todayByChain: TodayPrice[] = Array.from(latestByChain.entries())
    .map(([chain, r]) => ({
      chain,
      storeName: r.store_name,
      priceCents: r.price_cents,
      observedAt: r.observed_at,
      isCheapest: r.price_cents === cheapestCents,
      tier: confidenceTierForSource(r.source),
    }))
    .sort((a, b) => a.priceCents - b.priceCents)

  const byChainDay = new Map<string, Map<string, number>>()
  for (const r of rows) {
    const chain = r.chain ?? r.store_name
    const day = r.observed_at.slice(0, 10)
    if (!byChainDay.has(chain)) byChainDay.set(chain, new Map())
    const dayMap = byChainDay.get(chain)!
    dayMap.set(day, Math.min(dayMap.get(day) ?? Infinity, r.price_cents))
  }
  const history: ChainHistory[] = Array.from(byChainDay.entries()).map(([chain, dayMap]) => ({
    chain,
    points: Array.from(dayMap.entries())
      .map(([date, minPriceCents]) => ({ date, minPriceCents }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  }))

  const lowestRow = rows.reduce((min, r) => (r.price_cents < min.price_cents ? r : min), rows[0])
  const sortedDates = rows.map((r) => r.observed_at.slice(0, 10)).sort()

  return {
    itemName,
    brand: first.brand,
    packSize: first.pack_size,
    foodId: first.food_id,
    todayByChain,
    history,
    lowestEverCents: lowestRow.price_cents,
    lowestEverDate: lowestRow.observed_at.slice(0, 10),
    historyStartDate: sortedDates[0],
    historyEndDate: sortedDates[sortedDates.length - 1],
  }
}
