import { NextRequest, NextResponse } from 'next/server'
import { findNearbyLocations, resolveNearestFood, getRealBasketFoods } from '@/lib/nearbyEssential'

// UmuBot -- real nearest-store lookup for the real 22-item essential
// basket, triggered ONLY by an explicit user action (the "Use my
// location" button client-side) -- never an automatic background scan,
// per Baskt's own usage terms (see nearbyEssential.ts's module doc).
//
// Bounded concurrency (not all 22 foods at once) -- same "small
// concurrent batches, gentle on Baskt's public endpoint" discipline as
// mosaro's basktSync.ts.

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

  const [locations, foods] = await Promise.all([
    findNearbyLocations(lat, lng, 2),
    getRealBasketFoods(),
  ])

  if (locations.length === 0) {
    return NextResponse.json({ results: [], nearestStore: null, noCoverage: true })
  }

  const foodsById = new Map(foods.map((f) => [f.id, f]))
  const results = await runBatched(foods, 4, (food) => resolveNearestFood(food, locations, foodsById))

  return NextResponse.json({ results, nearestStore: locations[0]?.name ?? null, noCoverage: false })
}
