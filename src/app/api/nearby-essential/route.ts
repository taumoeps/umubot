import { NextRequest, NextResponse } from 'next/server'
import { fetchEssentials, NEARBY_RADIUS_KM } from '@/lib/essentialsClient'
import { reverseGeocodeCountry, resolveOverseasEssentials } from '@/lib/overseasEssential'

// UmuBot -- "Use my location" for the essential basket, triggered only by the
// explicit button client-side. NZ (2026-10-21, Essentials alignment plan, step 5):
// a thin proxy to mosaro's shared essentials service, so the website and
// RecipeBot's Today show the same product at the same nearest store. Overseas:
// unchanged -- reverse-geocode, then overseasEssential.ts's two non-AI tiers,
// until the shared service covers other countries. If reverse-geocoding
// fails, the NZ path answers (a location failure shouldn't block the site).

export const maxDuration = 60

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

  // NZ: the shared essentials service (mosaro), same answer as RecipeBot's Today.
  try {
    const essentials = await fetchEssentials({ lat, lng, radiusKm: NEARBY_RADIUS_KM })
    const noCoverage = essentials.groups.every((g) => g.items.every((i) => !i.representative))
    return NextResponse.json({ mode: 'nz', confirmedNZ, groups: essentials.groups, noCoverage })
  } catch (err) {
    console.error('[nearby-essential] essentials service error:', err instanceof Error ? err.message : err)
    return NextResponse.json({ error: 'Could not load nearby prices' }, { status: 502 })
  }
}
