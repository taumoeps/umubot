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
  hasValue: boolean
  indexValue: number | null
  pctChangeMom: number | null
  period: string | null
  basePeriod: string | null
  publicationStatus: 'published' | 'suppressed' | 'chain_restarted' | null
  coveragePct: number | null
}

export async function getIndexOverview(countryCode: string, chain: string, category: string): Promise<IndexOverview> {
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
    return { countryCode, chain, category, hasValue: false, indexValue: null, pctChangeMom: null, period: null, basePeriod: null, publicationStatus: null, coveragePct: null }
  }

  const row = data as
    | { index_value: number; pct_change_mom: number | null; period: string; base_period: string; publication_status: string; coverage_pct: number }
    | null

  if (!row) {
    return { countryCode, chain, category, hasValue: false, indexValue: null, pctChangeMom: null, period: null, basePeriod: null, publicationStatus: null, coveragePct: null }
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
    publicationStatus: row.publication_status as IndexOverview['publicationStatus'],
    coveragePct: row.coverage_pct,
  }
}
