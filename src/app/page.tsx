import { getEssentialProductsByCategory, getEssentialProductsByGroup } from '@/lib/essentialFoodsView'
import NearbyEssential from '@/components/NearbyEssential'

// UmuBot -- homepage. Essential shows ONLY real products individually
// flagged essential (essential_products), not every product that
// happened to match an essential_foods search-term concept. Each
// essential-food concept shows ONE card at its real cheapest flagged
// price (operator request, 2026-10-12, matching the real RecipeBot iOS
// app's Today view) -- the other real flagged variants (other sizes/
// brands) surface on that product's own detail page, not flattened
// onto this grid.
//
// Location-aware nearest-store matching (NearbyEssential.tsx), ported
// from the RecipeBot iOS app's Today view at the operator's explicit
// request, 2026-10-11 -- an explicit "Use my location" action finds
// the real nearest store's price for each of the real 22 essential
// foods, substituting a real fallback food when the primary has none
// nearby. Declining or not using it just shows this cheapest-per-food
// view (the default below), same as before.

export const revalidate = 300

export default async function HomePage() {
  // Today v2 (essential-foods-redesign.md): the default browse view groups by essential_group
  // (Pantry/Nutrition), not supermarket category. `categoryGroups` is still fetched and passed
  // through as `flatGroups` -- NearbyEssential's "Use my location" and overseas modes still group
  // their own results by real supermarket category (nearbyEssential.ts/overseasEssential.ts
  // weren't touched in this change) and need it for their category-label lookup. Not a leftover;
  // both are real, in use, for different parts of the same component.
  const [groups, categoryGroups] = await Promise.all([getEssentialProductsByGroup(), getEssentialProductsByCategory()])
  const totalProducts = groups.reduce((sum, g) => sum + g.products.length, 0)

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-1">Essential</h2>
      <p className="text-sm text-gray-500 mb-1 max-w-2xl">
        {totalProducts} essential food{totalProducts === 1 ? '' : 's'}, each shown at its real cheapest
        flagged price — tap one to see other sizes & brands, cheapest to most expensive.
      </p>
      <p className="text-xs text-gray-400 mb-6 max-w-2xl">
        Every price below is tagged <span className="text-green-600 font-medium">Live</span> (a real
        scanned price) or <span className="text-amber-600 font-medium">Estimated</span> — never shown
        without saying which.
      </p>

      <NearbyEssential groupedGroups={groups} flatGroups={categoryGroups} />
    </div>
  )
}
