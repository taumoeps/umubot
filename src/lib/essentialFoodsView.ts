import { supabase } from './supabase'
import { mapBasktToPricer } from './basktTaxonomyMapping'

// UmuBot -- Essential is driven by essential_products (real,
// individually-flagged products), not essential_foods concepts
// (operator decision, 2026-10-11: Essential should show ONLY what's
// actually been flagged essential, not every product that happened to
// match an essential_foods search-term concept). essential_foods/
// food_id stays untouched underneath -- the Price Index still depends
// on it; only Essential's own browsing page changed what powers it.
//
// The homepage shows ONE representative (the real cheapest) product
// per essential-food concept (operator request, 2026-10-12, matching
// the real RecipeBot iOS app's Today view: "Beef Mince $6.49" shown
// once, not every real pack size/brand flattened into the grid). The
// other real flagged variants of that same concept (food_id) surface
// on that product's own detail page (getOtherVariants below), sorted
// cheapest to most expensive, each clickable through to its own page --
// same real data, just not all flattened onto the homepage grid.
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
  foodId: string
  brand: string | null
  packSize: string | null
  lowestPriceCents: number
  lowestPriceAsOf: string
  chains: string[]
}

interface FlaggedProduct extends EssentialProduct {
  categorySlug: string
}

interface FlaggedRow {
  item_name: string
}

interface ObservationRow {
  item_name: string
  food_id: string
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

/** Every real, individually-flagged essential product, reduced to its
 *  current lowest price per item across chains. Shared by the homepage
 *  grouping below and getOtherVariants -- one query path for the
 *  correctness-sensitive parts (pagination, null-category filtering,
 *  latest-per-item-chain reduction), not two that could drift apart. */
async function getAllFlaggedProducts(): Promise<FlaggedProduct[]> {
  const { data: flagged, error: flagErr } = await supabase.from('essential_products').select('item_name')
  if (flagErr) throw new Error(flagErr.message)
  const flaggedNames = new Set(((flagged ?? []) as FlaggedRow[]).map((r) => r.item_name))
  if (flaggedNames.size === 0) return []

  // .not('baskt_category', 'is', null) etc FIRST, before any latest-row
  // picking -- real bug, found live 2026-10-11: multiple real rows can
  // share the exact same (item_name, chain, observed_at) for different
  // underlying store SKUs, and only some of them carry real category
  // data. productCatalogView.ts's getProductsForSubcategory already
  // filters this way; this just matches that already-correct pattern.
  const rows = await fetchAllRows<ObservationRow>((from, to) =>
    supabase
      .from('price_observations')
      .select('item_name, food_id, brand, pack_size, price_cents, chain, observed_at, baskt_category, baskt_subcategory')
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

  const byItemName = new Map<string, FlaggedProduct>()
  for (const row of latestByItemChain.values()) {
    const mapped = mapBasktToPricer(row.baskt_category, row.baskt_subcategory)
    if (!mapped) continue
    const existing = byItemName.get(row.item_name)
    if (!existing) {
      byItemName.set(row.item_name, {
        itemName: row.item_name,
        foodId: row.food_id,
        brand: row.brand,
        packSize: row.pack_size,
        lowestPriceCents: row.price_cents,
        lowestPriceAsOf: row.observed_at,
        chains: row.chain ? [row.chain] : [],
        categorySlug: mapped.categorySlug,
      })
    } else {
      if (row.price_cents < existing.lowestPriceCents) {
        existing.lowestPriceCents = row.price_cents
        existing.lowestPriceAsOf = row.observed_at
      }
      if (row.chain && !existing.chains.includes(row.chain)) existing.chains.push(row.chain)
    }
  }

  return Array.from(byItemName.values())
}

export async function getEssentialProductsByCategory(): Promise<{ category: string; label: string; products: EssentialProduct[] }[]> {
  const [allProducts, categoriesResult] = await Promise.all([
    getAllFlaggedProducts(),
    supabase.from('essential_food_categories').select('id, label').order('sort_order', { ascending: true }),
  ])
  if (categoriesResult.error) throw new Error(categoriesResult.error.message)

  // Collapse to the real cheapest product per essential-food concept
  // (food_id) -- the homepage shows one representative price per food,
  // not every real pack size/brand. Only categories with at least one
  // flagged product show -- an empty category here would be exactly
  // the clutter the operator flagged live, 2026-10-11.
  const byCategory = new Map<string, Map<string, EssentialProduct>>()
  for (const p of allProducts) {
    if (!byCategory.has(p.categorySlug)) byCategory.set(p.categorySlug, new Map())
    const cheapestByFoodId = byCategory.get(p.categorySlug)!
    const existing = cheapestByFoodId.get(p.foodId)
    if (!existing || p.lowestPriceCents < existing.lowestPriceCents) cheapestByFoodId.set(p.foodId, p)
  }

  return ((categoriesResult.data ?? []) as CategoryRow[])
    .filter((c) => byCategory.has(c.id))
    .map((c) => ({
      category: c.id,
      label: c.label,
      products: Array.from(byCategory.get(c.id)!.values()).sort((a, b) => a.itemName.localeCompare(b.itemName)),
    }))
}

/** Every other real flagged variant of the same essential-food concept,
 *  cheapest first -- shown on a product's detail page so "Beef Mince
 *  (340g) $6.49" links through to "Beef Mince (500g) $11.99" etc,
 *  operator request 2026-10-12. Empty when this is the only flagged
 *  variant of its concept. */
export async function getOtherVariants(foodId: string, excludeItemName: string): Promise<EssentialProduct[]> {
  const allProducts = await getAllFlaggedProducts()
  return allProducts
    .filter((p) => p.foodId === foodId && p.itemName !== excludeItemName)
    .sort((a, b) => a.lowestPriceCents - b.lowestPriceCents)
}
