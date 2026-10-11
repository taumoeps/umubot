import { unstable_cache } from 'next/cache'
import { supabase } from './supabase'
import { confidenceTierForSource, type ConfidenceTier } from './confidence'

// UmuBot -- real price history/today's-prices for one specific observed
// product (keyed by item_name), reached from a food's product list
// (src/lib/essentialFoodsView.ts). Paginated with .range() -- PostgREST's
// default 1000-row cap silently truncates an unpaginated pull, a real
// bug caught twice in this project.
//
// Cached per item_name via unstable_cache -- real perf gap caught live,
// 2026-10-12, same day as essentialFoodsView.ts's and
// productCatalogView.ts's versions of this fix: those two cover the
// Essential/Budget pages and the Grocery catalog, but this file -- the
// query behind a product detail page's own chart/today's-prices data --
// was never touched by either, confirmed live: "Free Range Eggs (12pk)"
// (a product not yet visited this cache window) still took 1-2s to
// open even after both earlier fixes shipped. The query itself is
// cheap (scoped to one item_name, rarely more than ~100 rows), so this
// is mostly real network/connection round-trip cost, not a big pull --
// but it's still worth caching, since once ANY visitor opens a given
// product, every other visitor gets it fast for the next 5 minutes
// too, not just the one who paid the first real cost.

const PAGE_SIZE = 1000

async function fetchAllRows<T>(
  build: (from: number, to: number) => Promise<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const all: T[] = []
  for (let page = 0; page < 50; page++) {
    const from = page * PAGE_SIZE
    const { data, error } = await build(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) break
    all.push(...data)
    if (data.length < PAGE_SIZE) break
  }
  return all
}

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

const getRowsForItem = unstable_cache(
  async (itemName: string): Promise<ProductDetailRow[]> =>
    fetchAllRows<ProductDetailRow>((from, to) =>
      supabase
        .from('price_observations')
        .select('chain, store_name, price_cents, promo_flag, observed_at, brand, pack_size, food_id, source')
        .eq('item_name', itemName)
        .order('observed_at', { ascending: false })
        .range(from, to) as unknown as Promise<{ data: ProductDetailRow[] | null; error: { message: string } | null }>
    ),
  ['product-detail-rows'],
  { revalidate: 300 }
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
