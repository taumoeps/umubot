import { unstable_cache } from 'next/cache'
import { supabase } from './supabase'
import { confidenceTierForSource, type ConfidenceTier } from './confidence'
import { runPaginated } from './paginatedQuery'
import { resolveWeight } from './packWeight'

// UmuBot -- Essential is driven by essential_products
// (real, individually-flagged products), not essential_foods concepts
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
// Plain-ingredient preference -- a fourth real bug, caught live by the
// operator 2026-10-12: "Beef Steak Sausages (420g)" was the real
// representative shown for "Beef steak", because it genuinely was the
// cheapest live-tier flagged item under that food_id, and nothing here
// distinguished a processed product from a plain cut. The same real
// bug mealAffordability.ts's Budget engine had already solved for its
// own ingredient picks (PROCESSED_KEYWORDS/looksPlain below, operator
// request that day: avoid Kumara Fries, flavoured kebabs etc as
// "the" representative of a plain staple) -- that logic now lives HERE
// instead, as the one shared source both this homepage and the Budget
// engine use, so they never pick different representatives for the
// same food. Tier (live vs estimated) still outranks plain-ness --
// never show a fake estimate over a real price just because it's
// plain -- and plain-ness outranks price -- never show a cheaper
// processed product over a pricier plain one.
//
// Paginated with .range() -- PostgREST's default 1000-row cap silently
// truncated an earlier query here down to 8 distinct items out of a
// real 296, caught live 2026-10-11 while building this exact backfill.

/** Keywords that mark a real flagged product as a processed/derivative
 *  form rather than the plain staple itself (a sausage, a crumbed
 *  fillet, a flavoured kebab) -- used to prefer a plain product as a
 *  food's representative, both here and in mealAffordability.ts's
 *  Budget engine. Not a general classifier: a genuinely new processed-
 *  product naming pattern not on this list would still slip through,
 *  the same honest limit the Budget engine already carried. */
export const PROCESSED_KEYWORDS = [
  'kebab', 'schnitzel', 'crumbed', 'battered', 'fries', 'sausage', 'nugget',
  'marinated', 'honey', 'soy', 'bbq', 'satay', 'stuffed', 'burger', 'patties',
  'pudding', 'twist', 'scroll', 'gluten free', 'half loaf', 'snack pack',
  'cups', 'coconut', 'lemongrass', 'baguette', 'breadcrumbs', 'sprout',
]

export function looksPlain(itemName: string): boolean {
  const lower = itemName.toLowerCase()
  return !PROCESSED_KEYWORDS.some((kw) => lower.includes(kw))
}

/** Matching-layer form-validation safeguard (essential-foods-implementation.md Sec5.1 /
 *  Sec13 acceptance criterion #2: "fresh milk cannot be classified or priced as unopened UHT
 *  milk"). A food concept's essential_group ('pantry' = shelf-stable expected, 'nutrition' =
 *  perishable/fresh expected) is a property of the FOOD CONCEPT, not a guarantee about any one
 *  flagged PRODUCT under it -- a generic "milk" concept classified nutrition/fresh could still
 *  have a UHT product mistakenly flagged under it. Same "detect from the real product name,
 *  don't trust the parent classification blindly" principle as PROCESSED_KEYWORDS/looksPlain
 *  above -- narrow and evidence-based (the canonical example this whole redesign used
 *  throughout), not a general classifier; a real mismatch pattern not on this list would still
 *  slip through, same honest limit PROCESSED_KEYWORDS already carries. */
const NUTRITION_GROUP_CONTRADICTION_KEYWORDS = ['uht', 'long life', 'longlife', 'powdered', 'shelf stable', 'shelf-stable']
const PANTRY_GROUP_CONTRADICTION_KEYWORDS = ['fresh', 'chilled', 'refrigerate']

export function hasFormMismatch(itemName: string, essentialGroup: 'pantry' | 'nutrition' | null): boolean {
  if (!essentialGroup) return false
  const lower = itemName.toLowerCase()
  if (essentialGroup === 'nutrition') return NUTRITION_GROUP_CONTRADICTION_KEYWORDS.some((kw) => lower.includes(kw))
  if (essentialGroup === 'pantry') return PANTRY_GROUP_CONTRADICTION_KEYWORDS.some((kw) => lower.includes(kw))
  return false
}

// Pagination itself is shared via paginatedQuery.ts's runPaginated --
// see that file's module doc. This function still wraps its OWN
// unstable_cache around the whole thing (not paginatedQuery.ts's
// cachedPaginatedQuery) because it does real prep work (fetching the
// flagged-item list and basket-food categories) BEFORE pagination can
// even start -- there's no way to express "prep work, then paginate"
// through the simpler no-prep wrappers without losing type safety, so
// this is the one query in the project that calls runPaginated +
// unstable_cache directly instead of going through a wrapper.

export interface EssentialProduct {
  itemName: string
  foodId: string
  brand: string | null
  packSize: string | null
  lowestPriceCents: number
  lowestPriceAsOf: string
  chains: string[]
  tier: ConfidenceTier
  /** Comparable unit price -- essential-foods-implementation.md Sec6.1's own worked example
   *  (white rice): "the UI should show both total purchase cost and comparable unit price, not
   *  automatically choose the smallest or cheapest pack." Cents per kilogram, computed from the
   *  real pack_size via packWeight.ts's resolveWeight(); null when the pack size can't be
   *  resolved to a real or reasonably-assumed weight (e.g. a genuinely unparseable pack_size) --
   *  never a guessed unit price. */
  unitPriceCentsPerKg: number | null
  /** True when unitPriceCentsPerKg rests on packWeight.ts's ASSUMED_UNIT_GRAMS (a labelled
   *  assumed per-unit weight for count-sold items like one egg or one bread roll) rather than a
   *  real parsed pack_size -- shown to the user as a caveat, not hidden. */
  unitPriceIsAssumed: boolean
}

interface FlaggedProduct extends EssentialProduct {
  categorySlug: string
  essentialGroup: 'pantry' | 'nutrition' | null
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
  essential_group: string | null
}

/** Every real, individually-flagged essential product belonging to one
 *  of the real 22 basket_slot foods, reduced to its current lowest
 *  price per item across chains -- preferring real observed data
 *  (source baskt/openfoodfacts) over an agent_web_search estimate
 *  whenever the item has any -- with its category resolved from the
 *  food concept itself (not the item's own, gap-prone Baskt tags).
 *  Shared by the homepage grouping below, getOtherVariants, and the
 *  Budget engine's ingredient resolution -- one query path, not several
 *  that could drift apart.
 *
 *  Cached across requests via unstable_cache -- real perf bug caught
 *  live, 2026-10-12, same day as the Budget page's own version of this
 *  fix: even after fetchAllRowsParallel, a full resolution still costs
 *  several real seconds (confirmed live: product detail pages taking
 *  2.9s-4.8s to open, even on REPEAT visits to the same item, because
 *  getOtherVariants calls this same expensive function uncached on
 *  every page view). The Budget page got its own cache wrapper around
 *  resolveAllIngredients() that day, but this function -- the one
 *  EVERY caller (homepage, product pages, Budget) ultimately goes
 *  through -- stayed uncached. Caching it here instead fixes all three
 *  call sites at the root, not just one. */
const getAllFlaggedProducts = unstable_cache(
  getAllFlaggedProductsUncached,
  ['essential-flagged-products'],
  { revalidate: 300 }
)

async function getAllFlaggedProductsUncached(): Promise<FlaggedProduct[]> {
  const [flaggedResult, basketFoodsResult] = await Promise.all([
    supabase.from('essential_products').select('item_name'),
    supabase.from('essential_foods').select('id, category, essential_group').eq('basket_slot', true).eq('is_active', true),
  ])
  if (flaggedResult.error) throw new Error(flaggedResult.error.message)
  if (basketFoodsResult.error) throw new Error(basketFoodsResult.error.message)

  const flaggedNames = new Set(((flaggedResult.data ?? []) as FlaggedRow[]).map((r) => r.item_name))
  if (flaggedNames.size === 0) return []
  const basketFoodRows = (basketFoodsResult.data ?? []) as BasketFoodRow[]
  const categoryByFoodId = new Map(basketFoodRows.map((f) => [f.id, f.category]))
  // essential_group: 'pantry' | 'nutrition' | NULL. NULL is a real state (not yet classified),
  // not something to guess at -- see essential-foods-implementation.md Sec5.1. A food in this
  // state is excluded from the Pantry/Nutrition view below rather than dumped into a confusing
  // third bucket or silently assumed either way.
  const groupByFoodId = new Map<string, 'pantry' | 'nutrition' | null>(
    basketFoodRows.map((f): [string, 'pantry' | 'nutrition' | null] => [
      f.id,
      f.essential_group === 'pantry' || f.essential_group === 'nutrition' ? f.essential_group : null,
    ])
  )
  if (categoryByFoodId.size === 0) return []

  // Scoped to the real flagged item names at the SQL level (though
  // confirmed live, 2026-10-12: flagged items account for ~84% of the
  // whole table, so this alone barely helps -- runPaginated's parallel
  // pagination is what actually cut this from ~4.3s to real,
  // click-responsive time). This used to pull the WHOLE price_observations
  // table and filter client-side, which is what made the Food
  // Affordability page feel slow/intermittent (see
  // getAllVariantsGroupedByFood's own doc for the other half of that bug).
  const flaggedNamesArray = Array.from(flaggedNames)
  const rows = await runPaginated<ObservationRow>((from, to, withCount) => {
    const query = supabase
      .from('price_observations')
      .select('item_name, food_id, brand, pack_size, price_cents, chain, observed_at, source', withCount ? { count: 'exact' } : undefined)
      .in('item_name', flaggedNamesArray)
      .range(from, to)
    return query as unknown as Promise<{ data: ObservationRow[] | null; error: { message: string } | null; count?: number | null }>
  })
  // hasFormMismatch: the matching-layer safeguard itself -- a flagged product whose real name
  // contradicts its food concept's declared essential_group never becomes a candidate
  // representative at all, same stage as the existing categoryByFoodId filter.
  const relevant = rows.filter(
    (r) => categoryByFoodId.has(r.food_id) && !hasFormMismatch(r.item_name, groupByFoodId.get(r.food_id) ?? null)
  )

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
    const essentialGroup = groupByFoodId.get(row.food_id) ?? null
    const existing = byItemName.get(row.item_name)
    if (!existing) {
      const weight = resolveWeight(row.pack_size, row.food_id)
      byItemName.set(row.item_name, {
        itemName: row.item_name,
        foodId: row.food_id,
        brand: row.brand,
        packSize: row.pack_size,
        lowestPriceCents: row.price_cents,
        lowestPriceAsOf: row.observed_at,
        essentialGroup,
        chains: row.chain ? [row.chain] : [],
        categorySlug,
        tier,
        unitPriceCentsPerKg: weight ? (row.price_cents / weight.totalGrams) * 1000 : null,
        unitPriceIsAssumed: weight?.isAssumedWeight ?? false,
      })
    } else {
      if (row.price_cents < existing.lowestPriceCents) {
        existing.lowestPriceCents = row.price_cents
        existing.lowestPriceAsOf = row.observed_at
        // Recompute, don't just carry the old unit price forward -- same item_name across
        // chains shares the same real pack_size/weight, so this is deterministic, not a guess.
        const weight = resolveWeight(row.pack_size, row.food_id)
        existing.unitPriceCentsPerKg = weight ? (row.price_cents / weight.totalGrams) * 1000 : null
      }
      if (row.chain && !existing.chains.includes(row.chain)) existing.chains.push(row.chain)
    }
  }

  return Array.from(byItemName.values())
}

/** True when `candidate` should replace `current` as a food's
 *  representative -- tier first, then plain-ness, then price (see
 *  getEssentialProductsByCategory's own doc for why this order). */
function isBetterRepresentative(candidate: EssentialProduct, current: EssentialProduct): boolean {
  if (current.tier === 'live' && candidate.tier === 'estimated') return false
  if (current.tier === 'estimated' && candidate.tier === 'live') return true

  const candidatePlain = looksPlain(candidate.itemName)
  const currentPlain = looksPlain(current.itemName)
  if (currentPlain && !candidatePlain) return false
  if (!currentPlain && candidatePlain) return true

  return candidate.lowestPriceCents < current.lowestPriceCents
}

export async function getEssentialProductsByCategory(): Promise<{ category: string; label: string; products: EssentialProduct[] }[]> {
  const [allProducts, categoriesResult] = await Promise.all([
    getAllFlaggedProducts(),
    supabase.from('essential_food_categories').select('id, label').order('sort_order', { ascending: true }),
  ])
  if (categoriesResult.error) throw new Error(categoriesResult.error.message)

  // Collapse to one representative per essential-food concept
  // (food_id), in strict priority order: (1) tier -- a live item always
  // wins over an estimate regardless of nominal price; (2) plain-ness
  // -- within the same tier, a plain product (PROCESSED_KEYWORDS/
  // looksPlain above) always wins over a processed one regardless of
  // price, the real fix for "Beef Steak Sausages" representing "Beef
  // steak"; (3) price -- within the same tier and plain-ness, cheapest
  // wins. Only categories with at least one flagged product show -- an
  // empty category here would be exactly the clutter the operator
  // flagged live, 2026-10-11.
  const byCategory = new Map<string, Map<string, EssentialProduct>>()
  for (const p of allProducts) {
    if (!byCategory.has(p.categorySlug)) byCategory.set(p.categorySlug, new Map())
    const repByFoodId = byCategory.get(p.categorySlug)!
    const existing = repByFoodId.get(p.foodId)
    if (!existing || isBetterRepresentative(p, existing)) repByFoodId.set(p.foodId, p)
  }

  return ((categoriesResult.data ?? []) as CategoryRow[])
    .filter((c) => byCategory.has(c.id))
    .map((c) => ({
      category: c.id,
      label: c.label,
      products: Array.from(byCategory.get(c.id)!.values()).sort((a, b) => a.itemName.localeCompare(b.itemName)),
    }))
}

/** Same real representative-selection logic as getEssentialProductsByCategory above (tier, then
 *  plain-ness, then price), grouped by essential_group ('pantry' | 'nutrition') instead of
 *  supermarket category -- the Today v2 Pantry/Nutrition split from essential-foods-redesign.md,
 *  added 2026-10-18 once the real essential_group column existed and the 25 live basket-slot
 *  rows were backfilled (see essential-foods-phase2-backfill.md).
 *
 *  Pantry always returned first, Nutrition second -- the established convention across every
 *  essential-foods design doc this session produced, not an arbitrary choice here.
 *
 *  A food whose essential_group is still NULL (not yet classified -- see the FlaggedProduct
 *  mapping above) is excluded from this view entirely, not guessed into either bucket and not
 *  shown in a confusing third "unclassified" section. This is the minimum safeguard
 *  essential-foods-implementation.md Sec10's revised Phase 2 scope requires shipping alongside
 *  the UI, not after it: better to under-show than to show a food under the wrong one of two
 *  user-facing, meaningfully different sections. Currently a no-op (all 25 real basket-slot rows
 *  are classified), but protects correctness the moment an unclassified candidate food is added. */
export async function getEssentialProductsByGroup(): Promise<{ group: 'pantry' | 'nutrition'; label: string; products: EssentialProduct[] }[]> {
  const allProducts = await getAllFlaggedProducts()

  const byGroup = new Map<'pantry' | 'nutrition', Map<string, EssentialProduct>>()
  for (const p of allProducts) {
    if (p.essentialGroup === null) continue // unclassified -- see doc comment above
    if (!byGroup.has(p.essentialGroup)) byGroup.set(p.essentialGroup, new Map())
    const repByFoodId = byGroup.get(p.essentialGroup)!
    const existing = repByFoodId.get(p.foodId)
    if (!existing || isBetterRepresentative(p, existing)) repByFoodId.set(p.foodId, p)
  }

  const labels: Record<'pantry' | 'nutrition', string> = { pantry: 'Pantry Essentials', nutrition: 'Nutrition Essentials' }
  return (['pantry', 'nutrition'] as const)
    .filter((g) => byGroup.has(g))
    .map((g) => ({
      group: g,
      label: labels[g],
      products: Array.from(byGroup.get(g)!.values()).sort((a, b) => a.itemName.localeCompare(b.itemName)),
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
 *  Fries) over whatever happens to be the lowest-priced flagged variant.
 *  Calling this per food in a loop/Promise.all is a real perf trap --
 *  see getAllVariantsGroupedByFood below -- use that instead when more
 *  than one food is needed in the same request. */
export async function getAllVariantsForFood(foodId: string): Promise<EssentialProduct[]> {
  const allProducts = await getAllFlaggedProducts()
  return allProducts.filter((p) => p.foodId === foodId)
}

/** Same real data as getAllVariantsForFood, grouped by food_id, for a
 *  caller that needs several foods' variants in one request (the meal
 *  affordability engine resolving ~20 ingredients). Real bug caught
 *  live, 2026-10-12: resolveAllIngredients originally called
 *  getAllVariantsForFood once per ingredient in Promise.all, and each
 *  call independently re-ran getAllFlaggedProducts()'s full paginated
 *  price_observations pull (~31,000 rows, 31 requests) -- 20 ingredients
 *  meant 20 full-table scans on every single click on the Food
 *  Affordability page, which is what made it feel slow/intermittent.
 *  This does the expensive pull exactly ONCE per request, however many
 *  foods are asked for. */
export async function getAllVariantsGroupedByFood(): Promise<Map<string, EssentialProduct[]>> {
  const allProducts = await getAllFlaggedProducts()
  const byFoodId = new Map<string, EssentialProduct[]>()
  for (const p of allProducts) {
    if (!byFoodId.has(p.foodId)) byFoodId.set(p.foodId, [])
    byFoodId.get(p.foodId)!.push(p)
  }
  return byFoodId
}

