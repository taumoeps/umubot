import { supabase } from './supabase'
import { mapBasktToPricer } from './basktTaxonomyMapping'

// UmuBot -- Essential is now driven by essential_products (real,
// individually-flagged products), not essential_foods concepts
// (operator decision, 2026-10-11: Essential should show ONLY what's
// actually been flagged essential, not every product that happened to
// match an essential_foods search-term concept). essential_foods/
// food_id stays untouched underneath -- the Price Index still depends
// on it; only Essential's own browsing page changed what powers it.
//
// A flagged item's category is derived the same way Products already
// does it: read its real price_observations.baskt_category/
// baskt_subcategory and run it through basktTaxonomyMapping.ts's
// mapBasktToPricer() -- the same single source of truth both features
// share, not a second stored copy that could drift stale.
//
// Paginated with .range() -- PostgREST's default 1000-row cap silently
// truncated an earlier query here down to 8 distinct items out of a
// real 296, caught live 2026-10-11 while building this exact backfill.

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

export interface EssentialProduct {
  itemName: string
  brand: string | null
  packSize: string | null
  lowestPriceCents: number
  lowestPriceAsOf: string
  chains: string[]
}

interface FlaggedRow {
  item_name: string
}

interface ObservationRow {
  item_name: string
  brand: string | null
  pack_size: string | null
  price_cents: number
  chain: string | null
  observed_at: string
  baskt_category: string | null
  baskt_subcategory: string | null
}

interface CategoryRow {
  id: string
  label: string
}

export async function getEssentialProductsByCategory(): Promise<{ category: string; label: string; products: EssentialProduct[] }[]> {
  const { data: flagged, error: flagErr } = await supabase.from('essential_products').select('item_name')
  if (flagErr) throw new Error(flagErr.message)
  const flaggedNames = new Set(((flagged ?? []) as FlaggedRow[]).map((r) => r.item_name))
  if (flaggedNames.size === 0) return []

  const { data: categories, error: catErr } = await supabase
    .from('essential_food_categories')
    .select('id, label')
    .order('sort_order', { ascending: true })
  if (catErr) throw new Error(catErr.message)

  // .not('baskt_category', 'is', null) etc FIRST, before any latest-row
  // picking -- real bug, found live 2026-10-11: multiple real rows can
  // share the exact same (item_name, chain, observed_at) for different
  // underlying store SKUs, and only some of them carry real category
  // data (Baskt's own per-item category/subcategory tags aren't
  // guaranteed on every matched record). Without this filter, the
  // "latest" row for an item could arbitrarily be a same-timestamp row
  // with null category even when a same-timestamp row WITH real
  // category data exists -- confirmed live: "Spaghetti Pasta (500g)"
  // has 1309 real rows, 1116 of them null-category, and the unfiltered
  // query intermittently picked a null one. productCatalogView.ts's
  // getProductsForSubcategory already filters this way; this just
  // matches that already-correct pattern.
  const rows = await fetchAllRows<ObservationRow>((from, to) =>
    supabase
      .from('price_observations')
      .select('item_name, brand, pack_size, price_cents, chain, observed_at, baskt_category, baskt_subcategory')
      .not('baskt_category', 'is', null)
      .not('baskt_subcategory', 'is', null)
      .range(from, to) as unknown as Promise<{ data: ObservationRow[] | null; error: { message: string } | null }>
  )
  const relevant = rows.filter((r) => flaggedNames.has(r.item_name))

  // Reduce to the latest real observation per (item, chain) first --
  // same "current lowest, not ever lowest" discipline as Products
  // (external review, 2026-10-11).
  const latestByItemChain = new Map<string, ObservationRow>()
  for (const row of relevant) {
    const key = `${row.item_name}::${row.chain ?? ''}`
    const existing = latestByItemChain.get(key)
    if (!existing || row.observed_at > existing.observed_at) latestByItemChain.set(key, row)
  }

  const byCategory = new Map<string, Map<string, EssentialProduct>>()
  for (const row of latestByItemChain.values()) {
    const mapped = mapBasktToPricer(row.baskt_category, row.baskt_subcategory)
    if (!mapped) continue
    if (!byCategory.has(mapped.categorySlug)) byCategory.set(mapped.categorySlug, new Map())
    const products = byCategory.get(mapped.categorySlug)!
    const existing = products.get(row.item_name)
    if (!existing) {
      products.set(row.item_name, {
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
    }
  }

  // Only categories that actually have a flagged product show -- this
  // is the whole point of the filter; an empty category here would be
  // exactly the clutter the operator flagged live, 2026-10-11.
  return ((categories ?? []) as CategoryRow[])
    .filter((c) => byCategory.has(c.id))
    .map((c) => ({
      category: c.id,
      label: c.label,
      products: Array.from(byCategory.get(c.id)!.values()).sort((a, b) => a.itemName.localeCompare(b.itemName)),
    }))
}
