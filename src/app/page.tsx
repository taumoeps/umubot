import Link from 'next/link'
import { getEssentialFoodsByCategory } from '@/lib/essentialFoodsView'

// UmuBot -- homepage, rebuilt 2026-10-11 to differentiate from Pricer
// (operator decision): instead of copying Pricer's 13-category, ~60,000-
// product catalogue, this tracks a narrow, honest set of real essential
// foods. Every count here is real (price_observations.food_id, a direct
// foreign key to essential_foods -- no category-name-guessing table).

// 5-minute cache -- underlying data only changes via the daily sync
// cron, not per-request.
export const revalidate = 300

export default async function HomePage() {
  const groups = await getEssentialFoodsByCategory()
  const totalFoods = groups.reduce((sum, g) => sum + g.foods.length, 0)
  const totalTracked = groups.reduce((sum, g) => sum + g.foods.filter((f) => f.trackedItemCount > 0).length, 0)

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-1">Essential Foods</h2>
      <p className="text-sm text-gray-500 mb-1 max-w-2xl">
        Not a full supermarket catalogue — {totalFoods} real essential foods, tracked honestly.
        {' '}{totalTracked} currently have real New Zealand price data.
      </p>
      <p className="text-xs text-gray-400 mb-6 max-w-2xl">
        Every price below is tagged <span className="text-green-600 font-medium">Live</span> (a real
        scanned price) or <span className="text-amber-600 font-medium">Estimated</span> — never shown
        without saying which.
      </p>

      <div className="space-y-8">
        {groups.map((group) => (
          <div key={group.category}>
            <div className="flex items-baseline gap-2 mb-3">
              <h3 className="text-xl font-bold text-gray-800">{group.label}</h3>
              <span className="text-sm text-gray-400">{group.foods.length} foods</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {group.foods.map((food) => (
                <Link
                  key={food.id}
                  href={`/food/${encodeURIComponent(food.id)}`}
                  className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-3 hover:border-green-400 transition-colors"
                >
                  <div>
                    <p className="font-medium text-gray-800">{food.displayName}</p>
                    <p className={`text-xs mt-0.5 ${food.trackedItemCount > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                      {food.trackedItemCount > 0
                        ? `${food.trackedItemCount} real product${food.trackedItemCount === 1 ? '' : 's'} tracked`
                        : 'No real data yet'}
                    </p>
                  </div>
                  <span className="text-gray-300">›</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
