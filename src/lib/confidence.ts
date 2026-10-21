// UmuBot -- the real differentiator from Pricer, per the operator's
// explicit decision 2026-10-11: don't try to out-catalogue Pricer (they
// track ~60,000 products across every category; this site tracks ~50
// real essential foods). Instead, show something Pricer's UI doesn't:
// whether a price was actually seen or is an estimate.
//
// Deliberately NOT importing mosaro's full 5-tier confidenceTierForObservation
// (priceIndexConfidence.ts) -- that nuance exists for the Food Index's
// internal weighting, not a simple user-facing badge.
//
// 2026-10-21 (Essentials alignment plan, step 2; operator decision 3): the
// label now also reflects *age*. Before, "live" meant only "came from a
// scanner", so a month-old scanned price showed as Live. Now:
//   live      -- scanned source, observed within LIVE_MAX_DAYS
//   recent    -- scanned source, LIVE_MAX_DAYS..MAX_AGE_DAYS old
//   estimated -- any other source (agent web search, derived), within MAX_AGE_DAYS
//   null      -- older than MAX_AGE_DAYS: not shown at all

export type ConfidenceTier = 'live' | 'recent' | 'estimated'

export const LIVE_MAX_DAYS = 7
export const MAX_AGE_DAYS = 30

const SCANNED_SOURCES = new Set(['baskt', 'openfoodfacts'])
const DAY_MS = 24 * 60 * 60 * 1000

/** Higher is better; used to prefer one price over another before plain-ness and price. */
export const TIER_RANK: Record<ConfidenceTier, number> = { live: 3, recent: 2, estimated: 1 }

export function tierFor(source: string, observedAt: string | Date, now: number = Date.now()): ConfidenceTier | null {
  const observed = typeof observedAt === 'string' ? Date.parse(observedAt) : observedAt.getTime()
  if (Number.isNaN(observed)) return null
  const ageDays = (now - observed) / DAY_MS
  if (ageDays > MAX_AGE_DAYS) return null
  if (!SCANNED_SOURCES.has(source)) return 'estimated'
  return ageDays <= LIVE_MAX_DAYS ? 'live' : 'recent'
}
