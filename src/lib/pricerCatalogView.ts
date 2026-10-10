import { supabase } from './supabase'
import { mapBasktToPricer } from './basktTaxonomyMapping'

// UmuBot -- real data layer behind the Pricer-structured browse UI
// (pricerCatalogTaxonomy.ts has the category/subcategory names). Reads
// price_observations.baskt_category/baskt_subcategory/brand/item_name
// through the public anon client (src/lib/supabase.ts) -- every query
// here relies on the RLS policies in mosaro/supabase/schema.sql's
// "Public read-only RLS for the Food Index tables" section; without
// them a query just returns zero rows, not an error. Paginated with
// .range() -- PostgREST's default 1000-row cap silently truncates an
// unpaginated pull, a real bug caught twice in the mosaro codebase this
// was split out of.
//
// Every row is mapped through basktTaxonomyMapping.mapBasktToPricer
// rather than matched by literal category/subcategory name -- Baskt's
// own vocabulary does not match Pricer's in several places. A row whose
// (category, subcategory) isn't in that mapping table is excluded, not
// guessed into the nearest bucket.
//
// Known gap, flagged rather than silently built around: counts/grouping
// here are done client-side over every matching row. Fine at current
// real volume; once the catalog genuinely grows into the thousands-of-
// products range Pricer operates at, this should become a real SQL
// aggregate (a view), not a client-side group-by over a full page pull.

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

interface CatalogRow {
  item_name: string
  brand: string | null
  baskt_category: string | null
  baskt_subcategory: string | null
}

export async function getSubcategoryProductCounts(): Promise<Map<string, number>> {
  const rows = await fetchAllRows<CatalogRow>((from, to) =>
    supabase
      .from('price_observations')
      .select('item_name, brand, baskt_category, baskt_subcategory')
      .not('baskt_category', 'is', null)
      .not('baskt_subcategory', 'is', null)
      .range(from, to) as unknown as Promise<{ data: CatalogRow[] | null; error: { message: string } | null }>
  )

  const itemsByKey = new Map<string, Set<string>>()
  for (const row of rows) {
    const mapped = mapBasktToPricer(row.baskt_category, row.baskt_subcategory)
    if (!mapped) continue
    const key = subcategoryCountKey(mapped.categorySlug, mapped.subcategorySlug)
    if (!itemsByKey.has(key)) itemsByKey.set(key, new Set())
    itemsByKey.get(key)!.add(row.item_name)
  }

  const counts = new Map<string, number>()
  for (const [key, items] of itemsByKey) counts.set(key, items.size)
  return counts
}

/** Keyed by Pricer category/subcategory SLUGS (not Baskt's raw names --
 *  see mapBasktToPricer). */
export function subcategoryCountKey(categorySlug: string, subcategorySlug: string): string {
  return `${categorySlug}::${subcategorySlug}`
}

export interface CatalogProduct {
  itemName: string
  brand: string | null
  packSize: string | null
  /** The lowest price among each chain's MOST RECENT real observation --
   *  not an all-time historical low. Real bug, found via external review
   *  2026-10-11: the previous version took Math.min() over every row
   *  ever returned for an item with no date awareness at all (the query
   *  didn't even select observed_at), so a months-old price could
   *  outrank today's real price and display as "the" lowest price --
   *  e.g. milk at $3.50 last month, $4.80 today, catalogue shows $3.50.
   *  Fixed by reducing to the latest row per (item, chain) first, then
   *  taking the min across THOSE. */
  lowestPriceCents: number
  lowestPriceAsOf: string
  chains: string[]
}

interface ProductGroupRow {
  item_name: string
  brand: string | null
  pack_size: string | null
  price_cents: number
  chain: string | null
  observed_at: string
  baskt_category: string | null
  baskt_subcategory: string | null
}

function groupIntoProducts(rows: ProductGroupRow[]): CatalogProduct[] {
  // Reduce to the latest real observation per (item, chain) FIRST -- the
  // only rows "lowest price" is allowed to be computed from. A stale
  // price from a chain that hasn't been re-observed recently never beats
  // a chain's own current price.
  const latestByItemChain = new Map<string, ProductGroupRow>()
  for (const row of rows) {
    const key = `${row.item_name}::${row.chain ?? ''}`
    const existing = latestByItemChain.get(key)
    if (!existing || row.observed_at > existing.observed_at) latestByItemChain.set(key, row)
  }

  const byItem = new Map<string, CatalogProduct>()
  for (const row of latestByItemChain.values()) {
    const existing = byItem.get(row.item_name)
    if (!existing) {
      byItem.set(row.item_name, {
        itemName: row.item_name,
        brand: row.brand,
        packSize: row.pack_size,
        lowestPriceCents: row.price_cents,
        lowestPriceAsOf: row.observed_at,
        chains: row.chain ? [row.chain] : [],
      })
    } else {
      if (row.price_cents < existing.lowestPriceCents) {
        existing.lowestPriceCents = row.price_cents
        existing.lowestPriceAsOf = row.observed_at
      }
      if (row.chain && !existing.chains.includes(row.chain)) existing.chains.push(row.chain)
      if (!existing.brand && row.brand) existing.brand = row.brand
      if (!existing.packSize && row.pack_size) existing.packSize = row.pack_size
    }
  }
  return Array.from(byItem.values()).sort((a, b) => a.itemName.localeCompare(b.itemName))
}

/** categorySlug/subcategorySlug are Pricer slugs (pricerCatalogTaxonomy.ts),
 *  not Baskt's raw category/subcategory text -- matched via
 *  basktTaxonomyMapping.mapBasktToPricer since the two vocabularies don't
 *  line up 1:1 (see this file's module doc). */
export async function getProductsForSubcategory(categorySlug: string, subcategorySlug: string): Promise<CatalogProduct[]> {
  const rows = await fetchAllRows<ProductGroupRow>((from, to) =>
    supabase
      .from('price_observations')
      .select('item_name, brand, pack_size, price_cents, chain, observed_at, baskt_category, baskt_subcategory')
      .not('baskt_category', 'is', null)
      .not('baskt_subcategory', 'is', null)
      .range(from, to) as unknown as Promise<{ data: ProductGroupRow[] | null; error: { message: string } | null }>
  )
  const matching = rows.filter((row) => {
    const mapped = mapBasktToPricer(row.baskt_category, row.baskt_subcategory)
    return mapped?.categorySlug === categorySlug && mapped?.subcategorySlug === subcategorySlug
  })
  return groupIntoProducts(matching)
}

export interface CatalogBrand {
  brand: string
  productCount: number
  chains: string[]
}

interface BrandGroupRow {
  brand: string
  item_name: string
  chain: string | null
}

export async function getBrandList(): Promise<CatalogBrand[]> {
  const rows = await fetchAllRows<BrandGroupRow>((from, to) =>
    supabase
      .from('price_observations')
      .select('brand, item_name, chain')
      .not('brand', 'is', null)
      .range(from, to) as unknown as Promise<{ data: BrandGroupRow[] | null; error: { message: string } | null }>
  )

  const byBrand = new Map<string, { items: Set<string>; chains: Set<string> }>()
  for (const row of rows) {
    if (!byBrand.has(row.brand)) byBrand.set(row.brand, { items: new Set(), chains: new Set() })
    const entry = byBrand.get(row.brand)!
    entry.items.add(row.item_name)
    if (row.chain) entry.chains.add(row.chain)
  }

  return Array.from(byBrand.entries())
    .map(([brand, entry]) => ({ brand, productCount: entry.items.size, chains: Array.from(entry.chains) }))
    .sort((a, b) => a.brand.localeCompare(b.brand))
}

export async function getProductsForBrand(brand: string): Promise<CatalogProduct[]> {
  const rows = await fetchAllRows<ProductGroupRow>((from, to) =>
    supabase
      .from('price_observations')
      .select('item_name, brand, pack_size, price_cents, chain, observed_at')
      .eq('brand', brand)
      .range(from, to) as unknown as Promise<{ data: ProductGroupRow[] | null; error: { message: string } | null }>
  )
  return groupIntoProducts(rows)
}

export interface TodayPrice {
  chain: string
  storeName: string
  priceCents: number
  observedAt: string
  isCheapest: boolean
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
  category: string | null
  subcategory: string | null
  /** Most recent real observation per chain -- "Today's prices" (mirrors
   *  Pricer's product page), but real observed dates are shown rather
   *  than assumed to be literally today -- see the product page for why. */
  todayByChain: TodayPrice[]
  /** Real min-price-per-day per chain, for the price history chart. Not
   *  raw per-store rows -- a generic item like "Bananas (kg)" matches 50+
   *  real stores per sync, which isn't a time series, it's same-day
   *  coverage; charting per-chain-per-day is the real, Pricer-equivalent
   *  signal (one line per retailer) without that noise. */
  history: ChainHistory[]
  /** Real lowest price ever observed for this item, across all real
   *  history (not a fixed "30-day low" like Pricer -- real history here
   *  is often shorter than 30 days, so the actual window is reported
   *  alongside the number rather than assumed). */
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
  baskt_category: string | null
  baskt_subcategory: string | null
}

export async function getProductDetail(itemName: string): Promise<ProductDetail | null> {
  const rows = await fetchAllRows<ProductDetailRow>((from, to) =>
    supabase
      .from('price_observations')
      .select('chain, store_name, price_cents, promo_flag, observed_at, brand, pack_size, baskt_category, baskt_subcategory')
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
    category: first.baskt_category,
    subcategory: first.baskt_subcategory,
    todayByChain,
    history,
    lowestEverCents: lowestRow.price_cents,
    lowestEverDate: lowestRow.observed_at.slice(0, 10),
    historyStartDate: sortedDates[0],
    historyEndDate: sortedDates[sortedDates.length - 1],
  }
}
