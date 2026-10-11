import Link from 'next/link'
import { CATALOG_TAXONOMY } from '@/lib/pricerCatalogTaxonomy'
import { getSubcategoryProductCounts, subcategoryCountKey } from '@/lib/productCatalogView'

// UmuBot -- the fuller Pricer-structured catalogue (13 categories,
// subcategories), kept as a SECONDARY section for future growth
// (operator decision, 2026-10-11): Essential Foods (/) is the primary
// homepage now -- this is real, working code kept around to expand
// into later, not the site's identity. See
// src/lib/productCatalogView.ts's module doc for the full reasoning.

export const revalidate = 300

export default async function ProductsPage() {
  const counts = await getSubcategoryProductCounts()

  return (
    <div>
      <p className="text-sm text-gray-500 mb-1">
        <Link href="/" className="hover:text-green-600">Essential</Link>
        <span className="mx-2">›</span>
        Products
      </p>
      <h2 className="text-2xl font-bold text-gray-800 mb-1">Products</h2>
      <p className="text-sm text-gray-500 mb-6 max-w-2xl">
        The fuller catalogue structure, for future growth beyond the essential-foods basket — real
        counts, not Pricer&apos;s. Most categories read zero today; this is scaffolding for later, not
        the current focus.
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
                      href={`/products/category/${category.slug}/${sub.slug}`}
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
