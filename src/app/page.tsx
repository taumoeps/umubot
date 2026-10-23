import Link from 'next/link'
import { fetchEssentials, type EssentialsGroup } from '@/lib/essentialsClient'
import { getDietaryFlagsByFoodId } from '@/lib/dietaryFlags'
import NearbyEssential from '@/components/NearbyEssential'

// UmuBot -- homepage. Each essential food shows ONE product: the one mosaro's shared
// essentials service chooses (GET /api/essentials), the same product RecipeBot's Today screen
// shows, at the cheapest store in NZ that has it. Since 2026-10-21 (Essentials alignment plan,
// step 5) this page no longer picks products itself -- its own rule picked sausages for "Beef
// steak" and kebabs for "Chicken breast". "Use my location" (NearbyEssential.tsx) asks the same
// service for the nearest store instead.

export const revalidate = 300

export default async function HomePage() {
  let groups: EssentialsGroup[] = []
  try {
    // The redesign's full list (approved foods), not just the original 22 (decision D).
    groups = (await fetchEssentials({ set: 'all' }, { next: { revalidate } })).groups
  } catch (err) {
    console.error('[home] essentials service unavailable:', err instanceof Error ? err.message : err)
  }
  const dietaryFlagsByFoodId = await getDietaryFlagsByFoodId()
  const priced = groups.reduce((sum, g) => sum + g.items.filter((i) => i.representative).length, 0)

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-1">Essential</h2>
      <p className="text-sm text-gray-500 mb-1 max-w-2xl">
        {priced} essential food{priced === 1 ? '' : 's'}, each shown as its everyday product at the cheapest
        store in NZ — tap one to see other sizes & brands, cheapest to most expensive.
      </p>
      <p className="text-xs text-gray-400 mb-6 max-w-2xl">
        Every price below is tagged <span className="text-green-600 font-medium">Live</span>{' '}(scanned
        in the last 7 days), <span className="text-sky-700 font-medium">Recent</span>{' '}(scanned 8–30 days
        ago) or <span className="text-amber-600 font-medium">Estimated</span>{' '}— never shown without saying
        which. Prices older than 30 days aren&apos;t shown.{' '}
        <Link href="/how-it-works" className="text-green-700 hover:underline">How it works</Link>
      </p>

      <NearbyEssential groups={groups} dietaryFlagsByFoodId={dietaryFlagsByFoodId} />
    </div>
  )
}
