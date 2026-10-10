import { supabase } from './supabase'
import { confidenceTierForSource, type ConfidenceTier } from './confidence'

// UmuBot -- real data layer for the essential-foods-first browse
// structure (operator decision, 2026-10-11: differentiate from Pricer
// by tracking a narrow, honest set of real essential foods instead of
// copying Pricer's full 60,000-product catalogue). Replaces the earlier
// Pricer-taxonomy-driven browsing (pricerCatalogTaxonomy.ts,
// basktTaxonomyMapping.ts, pricerCatalogView.ts's category/brand
// functions -- all deleted) with queries keyed directly off
// price_observations.food_id, a real foreign key straight to
// essential_foods. No category-name-guessing table needed at all: the
// FK already ties every real observation to a real essential food.
//
// Paginated with .range() -- PostgREST's default 1000-row cap silently
// truncates an unpaginated pull, a real bug caught twice in the mosaro
// codebase this was split out of.

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

export const CATEGORY_LABELS: Record<string, string> = {
  meat_poultry_fish: 'Meat, Poultry & Fish',
  dairy_eggs_staples: 'Dairy, Eggs & Staples',
  fruit_veg: 'Fruit & Vegetables',
}
export const CATEGORY_ORDER = ['meat_poultry_fish', 'dairy_eggs_staples', 'fruit_veg']

export interface FoodSummary {
  id: string
  displayName: string
  category: string
  trackedItemCount: number
}

interface EssentialFoodRow {
  id: string
  display_name: string
  category: string
}

export async function getEssentialFoodsByCategory(): Promise<{ category: string; label: string; foods: FoodSummary[] }[]> {
  const { data: foods, error: foodsError } = await supabase
    .from('essential_foods')
    .select('id, display_name, category')
    .eq('is_active', true)
    .order('display_name', { ascending: true })
  if (foodsError) throw new Error(foodsError.message)

  const rows = (foods ?? []) as EssentialFoodRow[]

  const obsRows = await fetchAllRows<{ food_id: string; item_name: string }>((from, to) =>
    supabase
      .from('price_observations')
      .select('food_id, item_name')
      .range(from, to) as unknown as Promise<{ data: { food_id: string; item_name: string }[] | null; error: { message: string } | null }>
  )
  const itemsByFood = new Map<string, Set<string>>()
  for (const r of obsRows) {
    if (!itemsByFood.has(r.food_id)) itemsByFood.set(r.food_id, new Set())
    itemsByFood.get(r.food_id)!.add(r.item_name)
  }

  const byCategory = new Map<string, FoodSummary[]>()
  for (const f of rows) {
    if (!byCategory.has(f.category)) byCategory.set(f.category, [])
    byCategory.get(f.category)!.push({
      id: f.id,
      displayName: f.display_name,
      category: f.category,
      trackedItemCount: itemsByFood.get(f.id)?.size ?? 0,
    })
  }

  return CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((category) => ({
    category,
    label: CATEGORY_LABELS[category] ?? category,
    foods: byCategory.get(category)!,
  }))
}

export interface FoodProduct {
  itemName: string
  brand: string | null
  packSize: string | null
  chain: string | null
  storeName: string
  priceCents: number
  observedAt: string
  tier: ConfidenceTier
}

export interface FoodDetail {
  id: string
  displayName: string
  category: string
  /** The latest real observation per distinct (item_name, chain) -- every
   *  real product matched to this essential food, not just one number.
   *  An essential food like "Milk" can have several real distinct
   *  products (different brands/sizes) at different chains; showing all
   *  of them, each tagged live/estimated, is the honest picture. */
  products: FoodProduct[]
}

interface FoodDetailRow {
  item_name: string
  brand: string | null
  pack_size: string | null
  chain: string | null
  store_name: string
  price_cents: number
  observed_at: string
  source: string
}

export async function getFoodDetail(foodId: string): Promise<FoodDetail | null> {
  const { data: food, error: foodError } = await supabase
    .from('essential_foods')
    .select('id, display_name, category')
    .eq('id', foodId)
    .maybeSingle()
  if (foodError) throw new Error(foodError.message)
  if (!food) return null

  const rows = await fetchAllRows<FoodDetailRow>((from, to) =>
    supabase
      .from('price_observations')
      .select('item_name, brand, pack_size, chain, store_name, price_cents, observed_at, source')
      .eq('food_id', foodId)
      .order('observed_at', { ascending: false })
      .range(from, to) as unknown as Promise<{ data: FoodDetailRow[] | null; error: { message: string } | null }>
  )

  const latestByItemChain = new Map<string, FoodDetailRow>()
  for (const r of rows) {
    const key = `${r.item_name}::${r.chain ?? r.store_name}`
    const existing = latestByItemChain.get(key)
    if (!existing || r.observed_at > existing.observed_at) latestByItemChain.set(key, r)
  }

  const products: FoodProduct[] = Array.from(latestByItemChain.values())
    .map((r) => ({
      itemName: r.item_name,
      brand: r.brand,
      packSize: r.pack_size,
      chain: r.chain,
      storeName: r.store_name,
      priceCents: r.price_cents,
      observedAt: r.observed_at,
      tier: confidenceTierForSource(r.source),
    }))
    .sort((a, b) => a.priceCents - b.priceCents)

  return {
    id: food.id as string,
    displayName: food.display_name as string,
    category: food.category as string,
    products,
  }
}
