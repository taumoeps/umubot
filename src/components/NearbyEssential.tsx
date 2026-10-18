'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useLocationMode } from './LocationModeContext'

// UmuBot -- client-side "Use my location" flow for Essential, ported
// from the RecipeBot iOS app's Today view behaviour at the operator's
// explicit request, 2026-10-11: find the real nearest store's price for
// each essential food, substituting a real fallback food when the
// primary has no nearby match. Only triggered by an explicit button
// click -- never an automatic prompt on page load -- both for normal
// privacy/UX reasons and because Baskt's own usage terms forbid
// anything that looks like an automated bulk scan (src/lib/
// nearbyEssential.ts's module doc).

interface FlatProduct {
  itemName: string
  brand: string | null
  lowestPriceCents: number
  tier: 'live' | 'estimated'
}
interface FlatGroup {
  category: string
  label: string
  products: FlatProduct[]
}
// Today v2 -- Pantry/Nutrition grouping for the default browse view (essential-foods-
// redesign.md). Separate from FlatGroup/flatGroups above on purpose: flatGroups (real supermarket
// category) is still needed by the "Use my location" and overseas branches below for their own
// category-label lookup, since nearbyEssential.ts/overseasEssential.ts still group by category.
interface GroupedGroup {
  group: 'pantry' | 'nutrition'
  label: string
  products: FlatProduct[]
}

interface NearbyMatch {
  itemName: string
  brand: string | null
  packSize: string | null
  priceCents: number
  chain: string
  storeName: string
  distanceKm: number
}
interface NearbyResult {
  foodId: string
  displayName: string
  category: string
  match: NearbyMatch | null
  substituteFor: string | null
}

interface OverseasResult {
  foodId: string
  displayName: string
  category: string
  tier: 'off' | 'global-estimate' | 'none'
  itemName: string | null
  priceUsd: number | null
  currency: string | null
  storeName: string | null
}

const CHAIN_LABELS: Record<string, string> = { paknsave: "PAK'nSAVE", 'new-world': 'New World' }

type Status = 'idle' | 'loading' | 'ready' | 'ready-overseas' | 'denied' | 'error' | 'no-coverage'

export default function NearbyEssential({ groupedGroups, flatGroups }: { groupedGroups: GroupedGroup[]; flatGroups: FlatGroup[] }) {
  const [status, setStatus] = useState<Status>('idle')
  const [results, setResults] = useState<NearbyResult[] | null>(null)
  const [nearestStore, setNearestStore] = useState<string | null>(null)
  const [overseasResults, setOverseasResults] = useState<OverseasResult[] | null>(null)
  const [countryName, setCountryName] = useState<string | null>(null)
  const { setIsConfirmedNZ } = useLocationMode()

  const categoryLabels: Record<string, string> = {}
  for (const g of flatGroups) categoryLabels[g.category] = g.label

  function useMyLocation() {
    if (!navigator.geolocation) {
      setStatus('error')
      return
    }
    setStatus('loading')
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch(`/api/nearby-essential?lat=${pos.coords.latitude}&lng=${pos.coords.longitude}`)
          const data = await res.json()
          if (data.mode === 'overseas') {
            setOverseasResults(data.results)
            setCountryName(data.countryName)
            setIsConfirmedNZ(false)
            setStatus('ready-overseas')
            return
          }
          // Grocery only reveals on a REAL confirmation (route's own
          // confirmedNZ field, set only when reverse-geocoding actually
          // returned NZ) -- a failed geocode that merely fell through to
          // the NZ flow doesn't count as confirming anything.
          setIsConfirmedNZ(Boolean(data.confirmedNZ))
          if (data.noCoverage) {
            setStatus('no-coverage')
            return
          }
          setResults(data.results)
          setNearestStore(data.nearestStore)
          setStatus('ready')
        } catch {
          setStatus('error')
        }
      },
      () => setStatus('denied'),
      { timeout: 10000 }
    )
  }

  if (status === 'ready-overseas' && overseasResults) {
    const byCategory = new Map<string, OverseasResult[]>()
    for (const r of overseasResults) {
      if (!byCategory.has(r.category)) byCategory.set(r.category, [])
      byCategory.get(r.category)!.push(r)
    }
    const categoryOrder = flatGroups.length > 0 ? flatGroups.map((g) => g.category) : Array.from(byCategory.keys())
    const withData = overseasResults.filter((r) => r.tier !== 'none').length

    return (
      <div>
        <div className="flex items-center justify-between gap-4 mb-6 bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
          <p className="text-sm text-blue-800">
            Showing real international price data for {countryName} — {withData} of {overseasResults.length} essential foods have data available.
            Coverage varies a lot by country; a gap means no real data exists yet, not an error.
          </p>
          <button onClick={() => setStatus('idle')} className="text-xs text-blue-700 hover:underline shrink-0">
            Show NZ prices instead
          </button>
        </div>
        <div className="space-y-8">
          {categoryOrder
            .filter((c) => byCategory.has(c))
            .map((category) => (
              <div key={category}>
                <h3 className="text-xl font-bold text-gray-800 mb-3">{categoryLabels[category] ?? category}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {byCategory.get(category)!.map((r) => (
                    <div key={r.foodId} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
                      <p className="text-xs text-gray-400">{r.displayName}</p>
                      {r.tier === 'off' && r.itemName && r.priceUsd !== null ? (
                        <>
                          <p className="font-medium text-gray-800 truncate">{r.itemName}</p>
                          <div className="flex items-center justify-between mt-1">
                            <p className="text-xs text-gray-500 truncate">
                              <span className="text-green-700 font-medium">Live</span>
                              {r.storeName && ` · ${r.storeName}`}
                            </p>
                            <p className="text-sm font-bold text-gray-800 shrink-0 ml-2">{r.priceUsd.toFixed(2)} {r.currency}</p>
                          </div>
                        </>
                      ) : r.tier === 'global-estimate' && r.priceUsd !== null ? (
                        <>
                          <p className="font-medium text-gray-800 truncate">{r.itemName}</p>
                          <div className="flex items-center justify-between mt-1">
                            <p className="text-xs text-amber-600 font-medium">Estimated (USD)</p>
                            <p className="text-sm font-bold text-gray-800 shrink-0 ml-2">${r.priceUsd.toFixed(2)}</p>
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-gray-400 mt-1">No data for this country yet</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      </div>
    )
  }

  if (status === 'ready' && results) {
    const byCategory = new Map<string, NearbyResult[]>()
    for (const r of results) {
      if (!byCategory.has(r.category)) byCategory.set(r.category, [])
      byCategory.get(r.category)!.push(r)
    }
    const categoryOrder = flatGroups.length > 0 ? flatGroups.map((g) => g.category) : Array.from(byCategory.keys())

    return (
      <div>
        <div className="flex items-center justify-between gap-4 mb-6 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <p className="text-sm text-green-800">
            Showing the real nearest price for each essential food{nearestStore ? ` — nearest store: ${nearestStore}` : ''}.
          </p>
          <button onClick={() => setStatus('idle')} className="text-xs text-green-700 hover:underline shrink-0">
            Show all variants instead
          </button>
        </div>
        <div className="space-y-8">
          {categoryOrder
            .filter((c) => byCategory.has(c))
            .map((category) => (
              <div key={category}>
                <h3 className="text-xl font-bold text-gray-800 mb-3">{categoryLabels[category] ?? category}</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {byCategory.get(category)!.map((r) => (
                    <div key={r.foodId} className="bg-white rounded-xl border border-gray-200 px-4 py-3">
                      <p className="text-xs text-gray-400">{r.displayName}</p>
                      {r.match ? (
                        <>
                          <Link href={`/product/${encodeURIComponent(r.match.itemName)}`} className="block font-medium text-gray-800 hover:text-green-600 truncate">
                            {r.match.itemName}
                          </Link>
                          <div className="flex items-center justify-between mt-1">
                            <p className="text-xs text-gray-500">
                              {CHAIN_LABELS[r.match.chain] ?? r.match.chain} · {r.match.distanceKm.toFixed(1)}km
                              {r.substituteFor && <span className="ml-1 text-amber-600">(alternative)</span>}
                            </p>
                            <p className="text-sm font-bold text-gray-800">${(r.match.priceCents / 100).toFixed(2)}</p>
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-gray-400 mt-1">Not available nearby</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-6">
        {status === 'idle' && (
          <button
            onClick={useMyLocation}
            className="text-sm px-4 py-2 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700"
          >
            📍 Use my location for nearest prices
          </button>
        )}
        {status === 'loading' && (
          <p className="text-sm text-gray-500">Finding the nearest real prices — this can take a few seconds…</p>
        )}
        {status === 'denied' && <p className="text-sm text-gray-400">Location unavailable — showing all real variants instead.</p>}
        {status === 'error' && <p className="text-sm text-gray-400">Couldn&apos;t look up nearby prices — showing all real variants instead.</p>}
        {status === 'no-coverage' && <p className="text-sm text-gray-400">No real covered store found near you — showing all real variants instead.</p>}
      </div>

      {groupedGroups.length === 0 ? (
        <p className="text-sm text-gray-400 bg-white rounded-xl border border-dashed border-gray-200 px-4 py-10 text-center">
          No products flagged essential yet.
        </p>
      ) : (
        <div className="space-y-8">
          {groupedGroups.map((group) => (
            <div key={group.group}>
              <div className="flex items-baseline gap-2 mb-1">
                <h3 className="text-xl font-bold text-gray-800">{group.label}</h3>
                <span className="text-sm text-gray-400">{group.products.length} product{group.products.length === 1 ? '' : 's'}</span>
              </div>
              <p className="text-xs text-gray-400 mb-3">
                {group.group === 'pantry'
                  ? 'Non-perishable food foundation — buy in bulk, store, replenish when needed.'
                  : 'Perishable foods and fresh ingredients — buy as needed, use before spoilage.'}
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {group.products.map((p) => (
                  <Link
                    key={p.itemName}
                    href={`/product/${encodeURIComponent(p.itemName)}`}
                    className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-3 hover:border-green-400 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-gray-800 truncate">{p.itemName}</p>
                      <p className="text-xs text-gray-400 truncate">
                        {p.brand ?? 'No brand recorded'}
                        {p.tier === 'estimated' && <span className="ml-1.5 text-amber-600 font-medium">Estimated</span>}
                      </p>
                    </div>
                    <p className="text-sm font-bold text-gray-800 shrink-0 ml-3">${(p.lowestPriceCents / 100).toFixed(2)}</p>
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
