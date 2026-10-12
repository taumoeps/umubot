import { NextRequest, NextResponse } from 'next/server'
import { findNearbyLocations, resolveNearestFood, getRealBasketFoods } from '@/lib/nearbyEssential'
import { reverseGeocodeCountry, resolveOverseasEssentials } from '@/lib/overseasEssential'

// UmuBot -- real nearest-store lookup for the real 22-item essential
// basket, triggered ONLY by an explicit user action (the "Use my
// location" button client-side) -- never an automatic background scan,
// per Baskt's own usage terms (see nearbyEssential.ts's module doc).
//
// Bounded concurrency (not all 22 foods at once) -- same "small
// concurrent batches, gentle on Baskt's public endpoint" discipline as
// mosaro's basktSync.ts.
//
// Country-aware since 2026-10-13 (operator request, after confirming
// RecipeBot's iOS app already has real, tested non-NZ support in its
// own authenticated Today pipeline -- this ports the two real, non-AI
// tiers of that same fallback chain for this public site, see
// overseasEssential.ts's module doc for the full reasoning and real
// limits). Reverse-geocodes the same real GPS coordinates this button
// already collects; NZ stays on the existing Baskt-backed flow
// unchanged, anything else switches to the overseas resolver. If
// reverse-geocoding itself fails, falls back to the NZ flow's own
// existing noCoverage path rather than guessing a country.

export const maxDuration = 60

async function runBatched<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency)
    results.push(...(await Promise.all(batch.map(fn))))
  }
  return results
}

export async function GET(req: NextRequest) {
  const lat = parseFloat(req.nextUrl.searchParams.get('lat') ?? '')
  const lng = parseFloat(req.nextUrl.searchParams.get('lng') ?? '')
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: 'lat and lng query params are required' }, { status: 400 })
  }

  const country = await reverseGeocodeCountry(lat, lng)

  if (country && country.countryCode !== 'NZ') {
    const results = await resolveOverseasEssentials(lat, lng, country.countryName)
    return NextResponse.json({ mode: 'overseas', countryName: country.countryName, results })
  }

  // confirmedNZ is true ONLY when reverse-geocoding actually returned
  // NZ -- if it failed outright (country === null), this still falls
  // through to the same NZ-flow behaviour (a real location failure
  // shouldn't block using the site), but the client needs to know that
  // wasn't a real confirmation, not just "not overseas" (operator
  // request, 2026-10-13: Grocery should only reveal on an actual
  // confirmed-NZ result, not merely "we couldn't tell").
  const confirmedNZ = country?.countryCode === 'NZ'

  const [locations, foods] = await Promise.all([
    findNearbyLocations(lat, lng, 2),
    getRealBasketFoods(),
  ])

  if (locations.length === 0) {
    return NextResponse.json({ mode: 'nz', confirmedNZ, results: [], nearestStore: null, noCoverage: true })
  }

  const foodsById = new Map(foods.map((f) => [f.id, f]))
  const results = await runBatched(foods, 4, (food) => resolveNearestFood(food, locations, foodsById))

  return NextResponse.json({ mode: 'nz', confirmedNZ, results, nearestStore: locations[0]?.name ?? null, noCoverage: false })
}
