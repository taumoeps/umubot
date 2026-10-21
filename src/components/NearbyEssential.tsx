'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { useLocationMode } from './LocationModeContext'
import { fetchEssentials, formatUnitPrice, MOSARO_URL, NEARBY_RADIUS_KM, storeLabel, type EssentialItem, type EssentialsGroup, type Offer } from '@/lib/essentialsClient'
import { useAuth } from './AuthContext'

const DIETARY_STORAGE_KEY = 'umubot-dietary-restrictions'

/** Mirrors dietaryFlags.ts's DIETARY_RESTRICTIONS/isRestrictionCompliant exactly, duplicated
 *  here (not imported): that module
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
function subscribeToStorage(onChange: () => void): () => void {
  window.addEventListener('storage', onChange)
  return () => window.removeEventListener('storage', onChange)
}
function readStoredRestrictions(): string | null {
  try {
    return localStorage.getItem(DIETARY_STORAGE_KEY)
  } catch {
    return null // private browsing / blocked storage: start with no restrictions selected
  }
}
function parseRestrictions(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
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
type EssentialGroup = 'pantry' | 'nutrition' | null

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

const TIER_STYLES: Record<Offer['tier'], { label: string; className: string }> = {
  live: { label: 'Live', className: 'text-green-700' },
  recent: { label: 'Recent', className: 'text-sky-700' },
  estimated: { label: 'Estimated', className: 'text-amber-600 font-medium' },
}

/** Signed-in replacement actions for one card; absent for anonymous visitors. */
interface ReplaceActions {
  replace: (defaultFoodId: string, foodName: string) => Promise<string | null>
  revert: (defaultFoodId: string) => Promise<string | null>
}

/** One essential food as mosaro's essentials service chose it -- the same product
 *  RecipeBot's Today shows. `nearby` adds distance and the cheaper-store line. */
function EssentialCard({ item, nearby, actions }: { item: EssentialItem; nearby: boolean; actions?: ReplaceActions }) {
  const offer = item.representative
  const tier = offer ? TIER_STYLES[offer.tier] : null
  const unit = offer ? formatUnitPrice(offer) : null
  const cheaper = nearby ? item.cheapestNearby : null
  return (
    <div className="bg-white rounded-xl border border-gray-200 px-4 py-3">
      <p className="text-xs text-gray-400">
        {item.displayName}
        {item.substituteFor && <span className="ml-1 text-amber-600">(alternative for {item.substituteFor})</span>}
        {item.isCustom && <span className="ml-1 text-green-700">(your pick)</span>}
      </p>
      {offer && tier ? (
        <>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <Link href={`/product/${encodeURIComponent(offer.itemName)}`} className="block font-medium text-gray-800 hover:text-green-600 truncate">
                {offer.itemName}
              </Link>
              <p className="text-xs text-gray-400 truncate">
                {storeLabel(offer)}
                {nearby && offer.distanceKm != null && ` · ${offer.distanceKm.toFixed(1)} km`}
                <span className={`ml-1.5 ${tier.className}`}>
                  · {tier.label}{offer.tier !== 'estimated' && `, ${daysAgoLabel(offer.observedAt)}`}
                </span>
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-bold text-gray-800">${(offer.priceCents / 100).toFixed(2)}</p>
              {unit && <p className="text-xs text-gray-400">{unit}</p>}
            </div>
          </div>
          {cheaper && (
            <p className="text-xs text-green-700 mt-1">
              Cheaper nearby: ${(cheaper.priceCents / 100).toFixed(2)} at {storeLabel(cheaper)}
              {cheaper.distanceKm != null && ` (${cheaper.distanceKm.toFixed(1)} km)`}
            </p>
          )}
        </>
      ) : item.outOfRange ? (
        <p className="text-sm text-gray-400 mt-1">
          Not sold nearby — nearest: {storeLabel(item.outOfRange)}
          {item.outOfRange.distanceKm != null && `, ${Math.round(item.outOfRange.distanceKm)} km`}
        </p>
      ) : (
        <p className="text-sm text-gray-400 mt-1">No current price</p>
      )}
      {actions && <ReplaceControls item={item} actions={actions} />}
    </div>
  )
}

function ReplaceControls({ item, actions }: { item: EssentialItem; actions: ReplaceActions }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  async function run(work: () => Promise<string | null>) {
    setBusy(true)
    setMessage(null)
    const result = await work()
    setBusy(false)
    setMessage(result)
    if (result === null) {
      setEditing(false)
      setName('')
    }
  }

  if (!editing) {
    return (
      <div className="flex gap-3 mt-2 text-xs">
        <button onClick={() => setEditing(true)} className="text-green-700 hover:underline">
          Change
        </button>
        {item.isCustom && (
          <button disabled={busy} onClick={() => run(() => actions.revert(item.defaultFoodId))} className="text-gray-500 hover:underline disabled:opacity-50">
            Use default
          </button>
        )}
        {message && <span className="text-amber-600">{message}</span>}
      </div>
    )
  }
  return (
    <form
      className="mt-2 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim()) run(() => actions.replace(item.defaultFoodId, name.trim()))
      }}
    >
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        maxLength={60}
        placeholder={`Instead of ${item.displayName}, e.g. "Tasty Cheese"`}
        aria-label={`Replacement for ${item.displayName}`}
        className="flex-1 min-w-0 text-sm px-2 py-1 border border-gray-300 rounded"
      />
      <button type="submit" disabled={busy || !name.trim()} className="text-xs px-2 py-1 rounded bg-green-600 text-white disabled:opacity-50">
        {busy ? 'Saving…' : 'Save'}
      </button>
      <button type="button" onClick={() => setEditing(false)} className="text-xs text-gray-500">
        Cancel
      </button>
      {message && <span className="text-xs text-amber-600 self-center">{message}</span>}
    </form>
  )
}

function groupSubtitle(group: EssentialsGroup['group']): string {
  return GROUP_SUBTITLES[group]
}

type Status = 'idle' | 'loading' | 'ready' | 'ready-overseas' | 'denied' | 'error' | 'no-coverage'

export default function NearbyEssential({ groups, dietaryFlagsByFoodId }: { groups: EssentialsGroup[]; dietaryFlagsByFoodId: Record<string, string[]> }) {
  const [status, setStatus] = useState<Status>('idle')
  const [nearbyGroups, setNearbyGroups] = useState<EssentialsGroup[] | null>(null)
  const [overseasResults, setOverseasResults] = useState<OverseasResult[] | null>(null)
  const [countryName, setCountryName] = useState<string | null>(null)
  const { setIsConfirmedNZ } = useLocationMode()
  const { session } = useAuth()
  const token = session?.access_token ?? null
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null)

  // Signed in: this person's own version (their replacements applied), keyed by token so a
  // sign-out or a different account never shows someone else's picks.
  const [personal, setPersonal] = useState<{ token: string; groups: EssentialsGroup[] } | null>(null)
  const [refreshCount, setRefreshCount] = useState(0)
  useEffect(() => {
    if (!token) return
    let cancelled = false
    fetchEssentials({ accessToken: token })
      .then((r) => { if (!cancelled) setPersonal({ token, groups: r.groups }) })
      .catch(() => { /* keep the public view */ })
    return () => { cancelled = true }
  }, [token, refreshCount])
  const shownGroups = personal && personal.token === token ? personal.groups : groups

  async function customFood(method: 'POST' | 'DELETE', body: object): Promise<Response> {
    return fetch(`${MOSARO_URL}/api/food-prices/custom-food`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  }
  const actions: ReplaceActions | undefined = token
    ? {
        async replace(defaultFoodId, foodName) {
          // The route uses the location only for its instant "nearby price" preview; Wellington
          // when the visitor hasn't shared one.
          const at = coords ?? { lat: -41.2865, lng: 174.7762 }
          const res = await customFood('POST', { defaultFoodId, foodName, latitude: at.lat, longitude: at.lng, radiusKm: NEARBY_RADIUS_KM })
          if (!res.ok) return res.status === 401 ? 'Please sign in again.' : 'Couldn’t save that — try another name.'
          const data = await res.json().catch(() => ({}))
          setRefreshCount((n) => n + 1)
          if (status === 'ready') refreshNearby()
          return data.matched === false ? 'Saved — no nearby store has it yet, so the default shows meanwhile.' : null
        },
        async revert(defaultFoodId) {
          const res = await customFood('DELETE', { defaultFoodId })
          if (!res.ok) return 'Couldn’t undo that — please try again.'
          setRefreshCount((n) => n + 1)
          if (status === 'ready') refreshNearby()
          return null
        },
      }
    : undefined

  // Phase 3: anonymous, browser-local dietary-restriction filter -- scoped to the default browse
  // view only (the one with real dietaryFlags data attached server-side); "Use my location" and
  // overseas results don't carry per-product dietary data, a stated boundary not a silent gap.
  // Read through useSyncExternalStore, not setState in an effect (cascading-render lint error):
  // the server and first client render see no saved filter, then the stored one.
  const storedRestrictions = useSyncExternalStore(subscribeToStorage, readStoredRestrictions, () => null)
  const [chosenRestrictions, setChosenRestrictions] = useState<string[] | null>(null)
  const selectedRestrictions = chosenRestrictions ?? parseRestrictions(storedRestrictions)
  function toggleRestriction(id: string) {
    const next = selectedRestrictions.includes(id) ? selectedRestrictions.filter((r) => r !== id) : [...selectedRestrictions, id]
    setChosenRestrictions(next)
    try {
      localStorage.setItem(DIETARY_STORAGE_KEY, JSON.stringify(next))
    } catch {
      // Not persisted this session -- the filter still works, just won't be remembered.
    }
  }

  async function loadNearby(lat: number, lng: number) {
    const res = await fetch(`/api/nearby-essential?lat=${lat}&lng=${lng}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return res.json()
  }

  function refreshNearby() {
    if (!coords) return
    loadNearby(coords.lat, coords.lng)
      .then((data) => { if (data.groups) setNearbyGroups(data.groups) })
      .catch(() => { /* keep what's shown */ })
  }

  function useMyLocation() {
    if (!navigator.geolocation) {
      setStatus('error')
      return
    }
    setStatus('loading')
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        try {
          const data = await loadNearby(pos.coords.latitude, pos.coords.longitude)
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
          setNearbyGroups(data.groups)
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

  if (status === 'ready' && nearbyGroups) {
    return (
      <div>
        <div className="flex items-center justify-between gap-4 mb-6 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
          <p className="text-sm text-green-800">
            Showing each essential food at the nearest store that sells it, within 50 km — the same prices RecipeBot shows.
          </p>
          <button onClick={() => setStatus('idle')} className="text-xs text-green-700 hover:underline shrink-0">
            Show cheapest in NZ instead
          </button>
        </div>
        <div className="space-y-8">
          {nearbyGroups.map((g) => (
            <div key={g.group}>
              <h3 className="text-xl font-bold text-gray-800 mb-1">{g.label}</h3>
              <p className="text-xs text-gray-400 mb-3">{groupSubtitle(g.group)}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {g.items.map((item) => <EssentialCard key={item.defaultFoodId} item={item} nearby actions={actions} />)}
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
        {status === 'denied' && <p className="text-sm text-gray-400">Location unavailable — showing the cheapest price in NZ instead.</p>}
        {status === 'error' && <p className="text-sm text-gray-400">Couldn&apos;t look up nearby prices — showing the cheapest price in NZ instead.</p>}
        {status === 'no-coverage' && <p className="text-sm text-gray-400">No covered store within 50 km of you — showing the cheapest price in NZ instead.</p>}
      </div>

      {shownGroups.length === 0 ? (
        <p className="text-sm text-gray-400 bg-white rounded-xl border border-dashed border-gray-200 px-4 py-10 text-center">
          Prices are unavailable right now — please try again shortly.
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
          {shownGroups.map((g) => {
            const items =
              selectedRestrictions.length === 0
                ? g.items
                : g.items.filter((i) => isRestrictionCompliant(dietaryFlagsByFoodId[i.foodId] ?? [], selectedRestrictions))
            if (items.length === 0) return null
            return (
              <div key={g.group}>
                <div className="flex items-baseline gap-2 mb-1">
                  <h3 className="text-xl font-bold text-gray-800">{g.label}</h3>
                  <span className="text-sm text-gray-400">{items.length} food{items.length === 1 ? '' : 's'}</span>
                </div>
                <p className="text-xs text-gray-400 mb-3">{groupSubtitle(g.group)}</p>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {items.map((item) => <EssentialCard key={item.defaultFoodId} item={item} nearby={false} actions={actions} />)}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
