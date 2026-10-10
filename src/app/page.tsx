import Link from 'next/link'
import { CATALOG_TAXONOMY } from '@/lib/pricerCatalogTaxonomy'
import { getSubcategoryProductCounts, subcategoryCountKey } from '@/lib/pricerCatalogView'

// UmuBot -- structured exactly like pricer.nz/browse: every category as
// a section header with its real subcategories listed below. The
// taxonomy (names, hierarchy) is copied verbatim from Pricer; the counts
// are real counts from live price_observations, not Pricer's own
// numbers. Most will honestly read 0 -- the real catalog today is a
// 48-food essential basket, not a full supermarket catalog.

// 5-minute cache, not 0 -- found via external review 2026-10-11: this
// page runs getSubcategoryProductCounts(), which pages through the
// entire price_observations table (up to 50,000 rows). The underlying
// data only changes via the daily sync cron, so a 5-minute staleness
// window is invisible in practice while cutting a full-table scan down
// to once per 5 minutes instead of once per request.
export const revalidate = 300

export default async function ProductsPage() {
  const counts = await getSubcategoryProductCounts()

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-1">Products</h2>
      <p className="text-sm text-gray-500 mb-6">
        Real New Zealand supermarket prices, tracked honestly — every number here comes from a real
        observation, never an estimate.
      </p>

      <div className="space-y-8">
        {CATALOG_TAXONOMY.map((category) => {
          const categoryTotal = category.subcategories.reduce(
            (sum, sub) => sum + (counts.get(subcategoryCountKey(category.slug, sub.slug)) ?? 0),
            0
          )
          return (
            <div key={category.slug}>
              <div className="flex items-baseline gap-2 mb-3">
                <h3 className="text-xl font-bold text-gray-800">{category.name}</h3>
                <span className="text-sm text-gray-400">
                  {categoryTotal.toLocaleString()} product{categoryTotal === 1 ? '' : 's'}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {category.subcategories.map((sub) => {
                  const count = counts.get(subcategoryCountKey(category.slug, sub.slug)) ?? 0
                  return (
                    <Link
                      key={sub.slug}
                      href={`/category/${category.slug}/${sub.slug}`}
                      className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-3 hover:border-green-400 transition-colors"
                    >
                      <div>
                        <p className="font-medium text-gray-800">{sub.name}</p>
                        <p className={`text-xs mt-0.5 ${count > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                          {count.toLocaleString()} product{count === 1 ? '' : 's'}
                        </p>
                      </div>
                      <span className="text-gray-300">›</span>
                    </Link>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
