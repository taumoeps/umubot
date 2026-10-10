import { supabase } from './supabase'

// Food Index Architecture (docs/food-index-architecture.md, RecipeBot
// repo) -- the "Index overview" P0 view, read through the public anon
// client. Its main real-data case (a published index_value) can't be
// exercised yet -- no price_index_values row has ever been written
// (every real link attempt so far has been 'uncomputable'). What's
// real-tested is the honest empty state: a grouping with no computed
// value yet returns hasValue: false, not a fabricated 100 or a crash.

export interface IndexOverview {
  countryCode: string
  chain: string
  category: string
  /** True only when a real, intentionally-publishable number exists --
   *  'published' or 'chain_restarted' (a fresh base=100 after a break is
   *  still a real, meant-to-be-shown value). NOT true for 'suppressed'.
   *  Real bug, found via external review 2026-10-11: the previous
   *  version set hasValue:true for ANY row regardless of
   *  publication_status, which would have shown a 'suppressed' index
   *  (real math, but the backend explicitly decided coverage was too
   *  thin to trust as a headline number) as if it were a confident
   *  published figure. */
  hasValue: boolean
  indexValue: number | null
  pctChangeMom: number | null
  period: string | null
  basePeriod: string | null
  publicationStatus: 'published' | 'suppressed' | 'chain_restarted' | null
  coveragePct: number | null
  /** True when a real row exists but publication_status is 'suppressed'
   *  -- distinct from hasValue:false's "no row at all" case, so the UI
   *  can say "computed but not published (low coverage)" instead of
   *  implying nothing has run yet. */
  suppressed: boolean
  /** True when the underlying query genuinely failed (not just "no
   *  row") -- distinct from both of the above, so the UI/caller can
   *  tell a real backend/RLS failure apart from genuine absence of data.
   *  Previously this case was silently treated the same as "no row",
   *  which could hide a real failure as if it were honest emptiness. */
  queryFailed: boolean
}

export async function getIndexOverview(countryCode: string, chain: string, category: string): Promise<IndexOverview> {
  const empty = (overrides: Partial<IndexOverview> = {}): IndexOverview => ({
    countryCode, chain, category, hasValue: false, indexValue: null, pctChangeMom: null,
    period: null, basePeriod: null, publicationStatus: null, coveragePct: null,
    suppressed: false, queryFailed: false, ...overrides,
  })

  const { data, error } = await supabase
    .from('price_index_values')
    .select('index_value, pct_change_mom, period, base_period, publication_status, coverage_pct')
    .eq('country_code', countryCode)
    .eq('chain', chain)
    .eq('category', category)
    .order('period', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    console.error('[umubot] getIndexOverview error:', error.message)
    return empty({ queryFailed: true })
  }

  const row = data as
    | { index_value: number; pct_change_mom: number | null; period: string; base_period: string; publication_status: string; coverage_pct: number }
    | null

  if (!row) return empty()

  const publicationStatus = row.publication_status as IndexOverview['publicationStatus']
  if (publicationStatus === 'suppressed') {
    return empty({ period: row.period, basePeriod: row.base_period, publicationStatus, coveragePct: row.coverage_pct, suppressed: true })
  }

  return {
    countryCode,
    chain,
    category,
    hasValue: true,
    indexValue: row.index_value,
    pctChangeMom: row.pct_change_mom,
    period: row.period,
    basePeriod: row.base_period,
    publicationStatus,
    coveragePct: row.coverage_pct,
    suppressed: false,
    queryFailed: false,
  }
}
