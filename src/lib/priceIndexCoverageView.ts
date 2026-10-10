import { supabase } from './supabase'

// Food Index Architecture (docs/food-index-architecture.md, RecipeBot
// repo) -- the "Coverage & freshness" P0 view, read through the public
// anon client. Without it there's no way to tell whether a given
// month's index is trustworthy.

export interface SeriesFreshness {
  foodId: string
  itemName: string | null
  lastRealObservedAt: string | null
}

export interface CoverageAndFreshness {
  countryCode: string
  chain: string
  category: string
  eligibleCount: number
  matchedCount: number | null
  linkStatus: 'computed' | 'uncomputable' | 'no_attempt_yet'
  coveragePct: number | null
  publicationStatus: 'published' | 'suppressed' | 'chain_restarted' | 'no_value_yet'
  seriesFreshness: SeriesFreshness[]
  /** True when any of the three underlying queries genuinely failed (not
   *  just returned no row) -- real bug, found via external review
   *  2026-10-11: errors on all three were silently discarded (only
   *  .data was read, .error never checked), so a real backend/RLS
   *  failure would render identically to honest "nothing computed yet"
   *  emptiness. The caller/UI can use this to tell the two apart. */
  queryFailed: boolean
}

/** `category` here is essential_foods' own internal 3-value category
 *  (meat_poultry_fish/dairy_eggs_staples/fruit_veg), NOT a Pricer
 *  taxonomy slug -- matching mosaro's own usage of this function. */
export async function getCoverageAndFreshness(countryCode: string, chain: string, category: string): Promise<CoverageAndFreshness> {
  const [linkResult, valueResult, foodsResult] = await Promise.all([
    supabase
      .from('price_index_links')
      .select('matched_count, eligible_count, link_status')
      .eq('country_code', countryCode)
      .eq('chain', chain)
      .eq('category', category)
      .order('period_to', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('price_index_values')
      .select('coverage_pct, publication_status')
      .eq('country_code', countryCode)
      .eq('chain', chain)
      .eq('category', category)
      .order('period', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from('essential_foods').select('id').eq('category', category),
  ])

  let queryFailed = false
  if (linkResult.error) { console.error('[umubot] getCoverageAndFreshness link query error:', linkResult.error.message); queryFailed = true }
  if (valueResult.error) { console.error('[umubot] getCoverageAndFreshness value query error:', valueResult.error.message); queryFailed = true }
  if (foodsResult.error) { console.error('[umubot] getCoverageAndFreshness foods query error:', foodsResult.error.message); queryFailed = true }

  const foodIds = (foodsResult.data ?? []).map((f) => f.id as string)
  let seriesFreshness: SeriesFreshness[] = []
  if (foodIds.length > 0) {
    const { data: seriesRows } = await supabase
      .from('price_index_series')
      .select('id, food_id, item_name')
      .eq('country_code', countryCode)
      .eq('chain', chain)
      .in('food_id', foodIds)

    const rows = (seriesRows ?? []) as { id: string; food_id: string; item_name: string | null }[]
    seriesFreshness = await Promise.all(
      rows.map(async (s) => {
        const { data: latestStats } = await supabase
          .from('price_rolling_stats')
          .select('last_real_observed_at')
          .eq('series_id', s.id)
          .order('as_of_date', { ascending: false })
          .limit(1)
          .maybeSingle()
        return {
          foodId: s.food_id,
          itemName: s.item_name,
          lastRealObservedAt: (latestStats as { last_real_observed_at: string | null } | null)?.last_real_observed_at ?? null,
        }
      })
    )
  }

  const link = linkResult.data as { matched_count: number; eligible_count: number; link_status: string } | null
  const value = valueResult.data as { coverage_pct: number; publication_status: string } | null

  return {
    countryCode,
    chain,
    category,
    eligibleCount: link?.eligible_count ?? foodIds.length,
    matchedCount: link?.matched_count ?? null,
    linkStatus: (link?.link_status as 'computed' | 'uncomputable' | undefined) ?? 'no_attempt_yet',
    coveragePct: value?.coverage_pct ?? null,
    publicationStatus: (value?.publication_status as CoverageAndFreshness['publicationStatus'] | undefined) ?? 'no_value_yet',
    seriesFreshness,
    queryFailed,
  }
}
