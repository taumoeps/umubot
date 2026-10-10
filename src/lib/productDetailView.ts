import { supabase } from './supabase'
import { confidenceTierForSource, type ConfidenceTier } from './confidence'

// UmuBot -- real price history/today's-prices for one specific observed
// product (keyed by item_name, e.g. "Spaghetti Pasta (500g)"), reached
// from a food's product list (src/lib/essentialFoodsView.ts). Paginated
// with .range() -- PostgREST's default 1000-row cap silently truncates
// an unpaginated pull, a real bug caught twice in the mosaro codebase
// this was split out of.

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
  /** Most recent real observation per chain -- "Today's prices", but
   *  real observed dates are shown rather than assumed to be literally
   *  today -- see the product page for why. Each row carries its real
   *  confidence tier (live vs estimated, src/lib/confidence.ts). */
  todayByChain: TodayPrice[]
  /** Real min-price-per-day per chain, for the price history chart. Not
   *  raw per-store rows -- a generic item can match 50+ real stores per
   *  sync, which isn't a time series, it's same-day coverage; charting
   *  per-chain-per-day is the real signal without that noise. */
  history: ChainHistory[]
  /** Real lowest price ever observed for this item, across all real
   *  history. Real history is often short, so the actual window is
   *  reported alongside the number rather than assumed. */
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

export async function getProductDetail(itemName: string): Promise<ProductDetail | null> {
  const rows = await fetchAllRows<ProductDetailRow>((from, to) =>
    supabase
      .from('price_observations')
      .select('chain, store_name, price_cents, promo_flag, observed_at, brand, pack_size, food_id, source')
      .eq('item_name', itemName)
      .order('observed_at', { ascending: false })
      .range(from, to) as unknown as Promise<{ data: ProductDetailRow[] | null; error: { message: string } | null }>
  )
  if (rows.length === 0) return null

  const first = rows[0]

  // Today's prices: most recent real observation per chain.
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

  // Price history: real min price per (chain, day).
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
