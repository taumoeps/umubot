import { supabase } from './supabase'
import { confidenceTierForSource, type ConfidenceTier } from './confidence'

// UmuBot -- Essential is driven by essential_products (real,
// individually-flagged products), not essential_foods concepts
// directly (operator decision, 2026-10-11: Essential should show ONLY
// what's actually been flagged essential, not every product that
// happened to match an essential_foods search-term concept).
//
// The homepage shows ONE representative (the real cheapest) product
// per essential-food concept (operator request, 2026-10-12, matching
// the real RecipeBot iOS app's Today view: "Beef Mince $6.49" shown
// once, not every real pack size/brand flattened into the grid). The
// other real flagged variants of that same concept (food_id) surface
// on that product's own detail page (getOtherVariants below), sorted
// cheapest to most expensive.
//
// Category comes from essential_foods.category (the food CONCEPT's own
// real, always-set Pricer-taxonomy category -- unified with Products'
// 13-category scheme, 2026-10-11), NOT from each flagged item's own
// baskt_category/baskt_subcategory. Switched 2026-10-12 after a real
// bug, caught live: eggs/flour/milk/pork chops had ZERO flagged items
// with any real baskt_category/baskt_subcategory recorded across
// 80-100+ real rows each, and cooking-oil/salt's only tagged rows used
// real Baskt tags basktTaxonomyMapping.ts doesn't recognise -- together
// these silently dropped 6 of the real 22 essential foods from the
// page entirely (17 shown instead of 22, caught by the operator live).
//
// Tier-aware "cheapest" pick -- a second real bug caught live the same
// session, immediately after the category fix: dropping the category
// filter let through every flagged item's agent_web_search estimate
// (no real store, source != 'baskt'/'openfoodfacts'), and several of
// those estimates (Beef mince $5.05, Milk $0.75, eggs $1.84, all with
// chain=null) were numerically lower than the real Baskt-scanned
// prices for the same food, so the "cheapest" pick silently became a
// guess instead of a real observed price. Fixed by resolving each
// FLAGGED ITEM's own representative row to live data
// (source baskt/openfoodfacts) whenever any exists for that item,
// falling back to its estimate only when it has no live data at all --
// then, per food concept, preferring a live-tier item over an
// estimated one even when the estimate is nominally cheaper. Each
// returned product carries its real tier so the UI can keep the site's
// standing promise ("never shown without saying which").
//
// Scoped to essential_foods.basket_slot = true (the real 22) -- a
// third real bug caught the same session: "Bread Rolls (ea)" (food_id
// "bread-rolls", a fallback-only food, basket_slot = false, never
// meant to stand alone) was showing as its own Essential card because
// nothing filtered representative food_ids down to the real 22.
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
  tier: ConfidenceTier
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
  source: string
}

interface CategoryRow {
  id: string
  label: string
}

interface BasketFoodRow {
  id: string
  category: string
}

/** Every real, individually-flagged essential product belonging to one
 *  of the real 22 basket_slot foods, reduced to its current lowest
 *  price per item across chains -- preferring real observed data
 *  (source baskt/openfoodfacts) over an agent_web_search estimate
 *  whenever the item has any -- with its category resolved from the
 *  food concept itself (not the item's own, gap-prone Baskt tags).
 *  Shared by the homepage grouping below and getOtherVariants -- one
 *  query path, not two that could drift apart. */
async function getAllFlaggedProducts(): Promise<FlaggedProduct[]> {
  const [flaggedResult, basketFoodsResult] = await Promise.all([
    supabase.from('essential_products').select('item_name'),
    supabase.from('essential_foods').select('id, category').eq('basket_slot', true).eq('is_active', true),
  ])
  if (flaggedResult.error) throw new Error(flaggedResult.error.message)
  if (basketFoodsResult.error) throw new Error(basketFoodsResult.error.message)

  const flaggedNames = new Set(((flaggedResult.data ?? []) as FlaggedRow[]).map((r) => r.item_name))
  if (flaggedNames.size === 0) return []
  const categoryByFoodId = new Map(((basketFoodsResult.data ?? []) as BasketFoodRow[]).map((f) => [f.id, f.category]))
  if (categoryByFoodId.size === 0) return []

  const rows = await fetchAllRows<ObservationRow>((from, to) =>
    supabase
      .from('price_observations')
      .select('item_name, food_id, brand, pack_size, price_cents, chain, observed_at, source')
      .range(from, to) as unknown as Promise<{ data: ObservationRow[] | null; error: { message: string } | null }>
  )
  const relevant = rows.filter((r) => flaggedNames.has(r.item_name) && categoryByFoodId.has(r.food_id))

  // Per item: use ONLY its live-tier rows when it has any, else fall
  // back to its estimated rows -- never mix the two for one item.
  const rowsByItem = new Map<string, ObservationRow[]>()
  for (const row of relevant) {
    if (!rowsByItem.has(row.item_name)) rowsByItem.set(row.item_name, [])
    rowsByItem.get(row.item_name)!.push(row)
  }
  const usableRows: { row: ObservationRow; tier: ConfidenceTier }[] = []
  for (const itemRows of rowsByItem.values()) {
    const live = itemRows.filter((r) => confidenceTierForSource(r.source) === 'live')
    const chosen = live.length > 0 ? live : itemRows
    const tier: ConfidenceTier = live.length > 0 ? 'live' : 'estimated'
    for (const row of chosen) usableRows.push({ row, tier })
  }

  // Reduce to the latest observation per (item, chain) -- same
  // "current lowest, not ever lowest" discipline as Products (external
  // review, 2026-10-11).
  const latestByItemChain = new Map<string, { row: ObservationRow; tier: ConfidenceTier }>()
  for (const entry of usableRows) {
    const key = `${entry.row.item_name}::${entry.row.chain ?? ''}`
    const existing = latestByItemChain.get(key)
    if (!existing || entry.row.observed_at > existing.row.observed_at) latestByItemChain.set(key, entry)
  }

  const byItemName = new Map<string, FlaggedProduct>()
  for (const { row, tier } of latestByItemChain.values()) {
    const categorySlug = categoryByFoodId.get(row.food_id)!
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
        categorySlug,
        tier,
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

  // Collapse to one representative per essential-food concept
  // (food_id): the real cheapest LIVE item when the food has any, else
  // its cheapest estimate -- a live item always wins over an estimate
  // regardless of nominal price (see module doc). Only categories with
  // at least one flagged product show -- an empty category here would
  // be exactly the clutter the operator flagged live, 2026-10-11.
  const byCategory = new Map<string, Map<string, EssentialProduct>>()
  for (const p of allProducts) {
    if (!byCategory.has(p.categorySlug)) byCategory.set(p.categorySlug, new Map())
    const repByFoodId = byCategory.get(p.categorySlug)!
    const existing = repByFoodId.get(p.foodId)
    if (!existing) {
      repByFoodId.set(p.foodId, p)
      continue
    }
    const pIsBetterTier = existing.tier === 'estimated' && p.tier === 'live'
    const existingIsBetterTier = existing.tier === 'live' && p.tier === 'estimated'
    if (existingIsBetterTier) continue
    if (pIsBetterTier || p.lowestPriceCents < existing.lowestPriceCents) repByFoodId.set(p.foodId, p)
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

/** Every real flagged variant of one essential-food concept, unsorted
 *  by price -- for a caller (the meal affordability engine) that needs
 *  to pick its OWN "best" representative by a different rule than
 *  "cheapest", e.g. preferring a plain ingredient (Kumara, not Kumara
 *  Fries) over whatever happens to be the lowest-priced flagged variant. */
export async function getAllVariantsForFood(foodId: string): Promise<EssentialProduct[]> {
  const allProducts = await getAllFlaggedProducts()
  return allProducts.filter((p) => p.foodId === foodId)
}
