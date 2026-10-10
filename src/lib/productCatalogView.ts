import { supabase } from './supabase'
import { mapBasktToPricer } from './basktTaxonomyMapping'

// UmuBot -- the fuller Pricer-structured product catalogue (13
// categories, subcategories), kept deliberately as a SECONDARY section
// behind Essential Foods (operator decision 2026-10-11: differentiate
// the primary identity from Pricer, but keep this real, working code
// around to grow into later -- not deleted, just not the homepage
// anymore). See src/lib/essentialFoodsView.ts for the primary,
// food_id-keyed browsing this site now leads with.
//
// Reads price_observations.baskt_category/baskt_subcategory/brand/
// item_name through the public anon client (src/lib/supabase.ts) --
// every query here relies on the RLS policies in mosaro/supabase/
// schema.sql's "Public read-only RLS for the Food Index tables"
// section; without them a query just returns zero rows, not an error.
// Paginated with .range() -- PostgREST's default 1000-row cap silently
// truncates an unpaginated pull, a real bug caught twice in the mosaro
// codebase this was split out of.
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
   *  not an all-time historical low (external review, 2026-10-11 -- see
   *  productDetailView.ts for the same fix applied there). */
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
