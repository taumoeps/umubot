// UmuBot -- the real differentiator from Pricer, per the operator's
// explicit decision 2026-10-11: don't try to out-catalogue Pricer (they
// track ~60,000 products across every category; this site tracks ~50
// real essential foods). Instead, show something Pricer's UI doesn't:
// whether a price was actually seen or is an estimate.
//
// Deliberately NOT importing mosaro's full 5-tier confidenceTierForObservation
// (priceIndexConfidence.ts) -- that nuance (government_statistics vs
// retailer_observed vs estimated_range) exists for the Food Index's
// internal weighting, not a simple user-facing badge. This is the
// conservative 2-state collapse of the same real logic: 'observed' is
// 'observed', everything else is 'estimated' -- never claim Live for a
// source this doesn't recognize.

export type ConfidenceTier = 'live' | 'estimated'

export function confidenceTierForSource(source: string): ConfidenceTier {
  return source === 'baskt' || source === 'openfoodfacts' ? 'live' : 'estimated'
}
