'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useLocationMode } from './LocationModeContext'

const DIETARY_STORAGE_KEY = 'umubot-dietary-restrictions'

/** Mirrors dietaryFlags.ts's DIETARY_RESTRICTIONS/isRestrictionCompliant exactly, duplicated
 *  here (not imported) for the same reason RELATIONSHIP_LABELS is duplicated above: that module
 *  pulls in next/cache's unstable_cache for its server-side fetch, which breaks a client
 *  component's build if imported directly. */
interface DietaryRestriction {
  id: string
  label: string
  excludesFlags: string[]
}
const DIETARY_RESTRICTIONS: DietaryRestriction[] = [
  { id: 'vegetarian', label: 'Vegetarian', excludesFlags: ['contains-meat', 'contains-fish'] },
  { id: 'vegan', label: 'Vegan', excludesFlags: ['contains-meat', 'contains-fish', 'contains-dairy', 'contains-egg'] },
  { id: 'dairy-free', label: 'Dairy-free', excludesFlags: ['contains-dairy'] },
  { id: 'gluten-free', label: 'Gluten-free', excludesFlags: ['contains-gluten'] },
  { id: 'egg-free', label: 'Egg-free', excludesFlags: ['contains-egg'] },
  { id: 'no-pork', label: 'No pork', excludesFlags: ['contains-pork'] },
]
function isRestrictionCompliant(foodFlags: string[], selectedRestrictionIds: string[]): boolean {
  const excluded = new Set(selectedRestrictionIds.flatMap((id) => DIETARY_RESTRICTIONS.find((r) => r.id === id)?.excludesFlags ?? []))
  return !foodFlags.some((f) => excluded.has(f))
}

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
  lowestPriceAsOf: string
  tier: 'live' | 'estimated'
  unitPriceCentsPerKg: number | null
  unitPriceIsAssumed: boolean
  dietaryFlags: string[]
}

/** Phase 2 task 5 (essential-foods-implementation.md Sec13 acceptance criterion #6 -- "clearly
 *  distinguishes observed, stale, and missing prices"): confidence.ts's Live/Estimated tiers
 *  already distinguish observed vs. estimated; this adds the missing third dimension --
 *  showing how OLD a Live price actually is, using the real lowestPriceAsOf timestamp that was
 *  already computed server-side but never surfaced. Deliberately shown only for Live-tier
 *  products -- an Estimated price's "as of" timestamp doesn't carry the same "freshness" meaning
 *  a real observed price does. */
function daysAgoLabel(isoDate: string): string {
  const days = Math.floor((Date.now() - new Date(isoDate).getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return '1 day ago'
  return `${days} days ago`
}
// Today v2 -- Pantry/Nutrition grouping (essential-foods-redesign.md), now shared by all three
// view modes below (default browse, "Use my location", overseas). Supersedes the old
// supermarket-category grouping this component used throughout -- see essentialFoodsView.ts,
// nearbyEssential.ts, and overseasEssential.ts, which all now resolve the same essential_group
// field from essential_foods.
interface GroupedGroup {
  group: 'pantry' | 'nutrition'
  label: string
  products: FlatProduct[]
}

type EssentialGroup = 'pantry' | 'nutrition' | null

interface NearbyMatch {
  itemName: string
  brand: string | null
  packSize: string | null
  priceCents: number
  chain: string
  storeName: string
  distanceKm: number
}

type RelationshipType = 'equivalent' | 'form_alternative' | 'culinary' | 'nutritional'

/** Phase 3 -- mirrors nearbyEssential.ts's RELATIONSHIP_LABELS exactly. Kept as a plain literal
 *  here rather than imported since this is a client component and that module does a real
 *  Supabase call at import time (server-only). */
const RELATIONSHIP_LABELS: Record<RelationshipType, string> = {
  equivalent: 'same product, different pack',
  form_alternative: 'different storage form',
  culinary: 'culinary substitute',
  nutritional: 'nutritional alternative',
}

interface NearbyResult {
  foodId: string
  displayName: string
  essentialGroup: EssentialGroup
  match: NearbyMatch | null
  substituteFor: string | null
  substituteRelationshipType: RelationshipType | null
}

interface OverseasResult {
  foodId: string
  displayName: string
  essentialGroup: EssentialGroup
  tier: 'off' | 'global-estimate' | 'none'
  itemName: string | null
  priceUsd: number | null
  currency: string | null
  storeName: string | null
}

const CHAIN_LABELS: Record<string, string> = { paknsave: "PAK'nSAVE", 'new-world': 'New World' }
const GROUP_LABELS: Record<'pantry' | 'nutrition', string> = { pantry: 'Pantry Essentials', nutrition: 'Nutrition Essentials' }
const GROUP_SUBTITLES: Record<'pantry' | 'nutrition', string> = {
  pantry: 'Non-perishable food foundation — buy in bulk, store, replenish when needed.',
  nutrition: 'Perishable foods and fresh ingredients — buy as needed, use before spoilage.',
}
/** Safeguard, same principle as essentialFoodsView.ts's own: a food with no essential_group yet
 *  (not yet classified) is excluded from every grouped view rather than guessed into either
 *  bucket or dumped into a confusing third section. */
function groupOrder<T extends { essentialGroup: EssentialGroup }>(items: T[]): { group: 'pantry' | 'nutrition'; items: T[] }[] {
  const byGroup = new Map<'pantry' | 'nutrition', T[]>()
  for (const item of items) {
    if (item.essentialGroup === null) continue
    if (!byGroup.has(item.essentialGroup)) byGroup.set(item.essentialGroup, [])
    byGroup.get(item.essentialGroup)!.push(item)
  }
  return (['pantry', 'nutrition'] as const).filter((g) => byGroup.has(g)).map((g) => ({ group: g, items: byGroup.get(g)! }))
}

type Status = 'idle' | 'loading' | 'ready' | 'ready-overseas' | 'denied' | 'error' | 'no-coverage'

export default function NearbyEssential({ groupedGroups }: { groupedGroups: GroupedGroup[] }) {
  const [status, setStatus] = useState<Status>('idle')
  const [results, setResults] = useState<NearbyResult[] | null>(null)
  const [nearestStore, setNearestStore] = useState<string | null>(null)
  const [overseasResults, setOverseasResults] = useState<OverseasResult[] | null>(null)
  const [countryName, setCountryName] = useState<string | null>(null)
  const { setIsConfirmedNZ } = useLocationMode()

  // Phase 3: anonymous, browser-local dietary-restriction filter -- scoped to the default browse
  // view only (the one with real dietaryFlags data attached server-side); "Use my location" and
  // overseas results don't carry per-product dietary data, a stated boundary not a silent gap.
  const [selectedRestrictions, setSelectedRestrictions] = useState<string[]>([])
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DIETARY_STORAGE_KEY)
      if (raw) setSelectedRestrictions(JSON.parse(raw))
    } catch {
      // Private browsing / blocked storage -- just start with no restrictions selected.
    }
  }, [])
  function toggleRestriction(id: string) {
    const next = selectedRestrictions.includes(id) ? selectedRestrictions.filter((r) => r !== id) : [...selectedRestrictions, id]
    setSelectedRestrictions(next)
    try {
      localStorage.setItem(DIETARY_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Not persisted this session -- the filter still works, just won't be remembered.
    }
  }

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
    const grouped = groupOrder(overseasResults)
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
          {grouped.map(({ group, items }) => (
              <div key={group}>
                <h3 className="text-xl font-bold text-gray-800 mb-1">{GROUP_LABELS[group]}</h3>
                <p className="text-xs text-gray-400 mb-3">{GROUP_SUBTITLES[group]}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {items.map((r) => (
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
    const grouped = groupOrder(results)

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
          {grouped.map(({ group, items }) => (
              <div key={group}>
                <h3 className="text-xl font-bold text-gray-800 mb-1">{GROUP_LABELS[group]}</h3>
                <p className="text-xs text-gray-400 mb-3">{GROUP_SUBTITLES[group]}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {items.map((r) => (
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
                              {r.substituteFor && (
                                <span className="ml-1 text-amber-600">
                                  ({r.substituteRelationshipType ? RELATIONSHIP_LABELS[r.substituteRelationshipType] : 'alternative'})
                                </span>
                              )}
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
          <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
            <p className="text-xs text-gray-500 mb-2">
              Filter by dietary restriction — based on each food&apos;s own ingredients, not a certification. A food
              with no flags shown just means none of these apply, not that it&apos;s been checked and cleared.
            </p>
            <div className="flex flex-wrap gap-2">
              {DIETARY_RESTRICTIONS.map((r) => (
                <button
                  key={r.id}
                  onClick={() => toggleRestriction(r.id)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    selectedRestrictions.includes(r.id)
                      ? 'bg-green-600 text-white border-green-600'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-green-400'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          {groupedGroups.map((group) => {
            const filteredProducts =
              selectedRestrictions.length === 0
                ? group.products
                : group.products.filter((p) => isRestrictionCompliant(p.dietaryFlags, selectedRestrictions))
            if (filteredProducts.length === 0) return null
            return (
            <div key={group.group}>
              <div className="flex items-baseline gap-2 mb-1">
                <h3 className="text-xl font-bold text-gray-800">{group.label}</h3>
                <span className="text-sm text-gray-400">{filteredProducts.length} product{filteredProducts.length === 1 ? '' : 's'}</span>
              </div>
              <p className="text-xs text-gray-400 mb-3">{GROUP_SUBTITLES[group.group]}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {filteredProducts.map((p) => (
                  <Link
                    key={p.itemName}
                    href={`/product/${encodeURIComponent(p.itemName)}`}
                    className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-3 hover:border-green-400 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-gray-800 truncate">{p.itemName}</p>
                      <p className="text-xs text-gray-400 truncate">
                        {p.brand ?? 'No brand recorded'}
                        {p.tier === 'estimated' ? (
                          <span className="ml-1.5 text-amber-600 font-medium">Estimated</span>
                        ) : (
                          <span className="ml-1.5 text-green-700">· Live, {daysAgoLabel(p.lowestPriceAsOf)}</span>
                        )}
                      </p>
                    </div>
                    <div className="text-right shrink-0 ml-3">
                      <p className="text-sm font-bold text-gray-800">${(p.lowestPriceCents / 100).toFixed(2)}</p>
                      {p.unitPriceCentsPerKg !== null && (
                        <p className="text-xs text-gray-400">
                          {p.unitPriceIsAssumed ? '~' : ''}${(p.unitPriceCentsPerKg / 100).toFixed(2)}/kg
                        </p>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
