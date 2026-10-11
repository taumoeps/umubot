import Link from 'next/link'
import { getEssentialProductsByCategory } from '@/lib/essentialFoodsView'

// UmuBot -- homepage. Rebuilt 2026-10-11 (operator decision): Essential
// now shows ONLY real products individually flagged essential
// (essential_products), not every product that happened to match an
// essential_foods search-term concept. A category with nothing flagged
// in it simply doesn't show -- that clutter was the whole complaint
// that led to this rebuild.

export const revalidate = 300

export default async function HomePage() {
  const groups = await getEssentialProductsByCategory()
  const totalProducts = groups.reduce((sum, g) => sum + g.products.length, 0)

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-1">Essential</h2>
      <p className="text-sm text-gray-500 mb-1 max-w-2xl">
        {totalProducts} real product{totalProducts === 1 ? '' : 's'}, individually flagged essential — not
        every product that happens to match a search term.
      </p>
      <p className="text-xs text-gray-400 mb-6 max-w-2xl">
        Every price below is tagged <span className="text-green-600 font-medium">Live</span> (a real
        scanned price) or <span className="text-amber-600 font-medium">Estimated</span> — never shown
        without saying which.
      </p>

      {groups.length === 0 ? (
        <p className="text-sm text-gray-400 bg-white rounded-xl border border-dashed border-gray-200 px-4 py-10 text-center">
          No products flagged essential yet.
        </p>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <div key={group.category}>
              <div className="flex items-baseline gap-2 mb-3">
                <h3 className="text-xl font-bold text-gray-800">{group.label}</h3>
                <span className="text-sm text-gray-400">{group.products.length} product{group.products.length === 1 ? '' : 's'}</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {group.products.map((p) => (
                  <Link
                    key={p.itemName}
                    href={`/product/${encodeURIComponent(p.itemName)}`}
                    className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-3 hover:border-green-400 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-gray-800 truncate">{p.itemName}</p>
                      <p className="text-xs text-gray-400 truncate">{p.brand ?? 'No brand recorded'}</p>
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
