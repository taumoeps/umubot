import Link from 'next/link'
import { CATALOG_CATEGORIES } from '@/lib/groceryCatalogTaxonomy'
import { getCategorySubcategorySummaries } from '@/lib/productCatalogView'

// UmuBot -- the fuller real grocery catalogue (New World/PAK'nSAVE's
// own real 13 categories), kept as a SECONDARY section for future
// growth (operator decision, 2026-10-11): Essential (/) is the primary
// homepage now -- this is real, working code kept around to expand
// into later, not the site's identity. Renamed from "Products" to
// "Grocery" and rebuilt off the real supermarket category structure
// instead of Pricer's invented one, operator request 2026-10-12 -- see
// src/lib/groceryCatalogTaxonomy.ts's module doc. See
// src/lib/productCatalogView.ts's module doc for the full reasoning.

export const revalidate = 300

export default async function GroceryPage() {
  const subcategoriesByCategory = await getCategorySubcategorySummaries()

  return (
    <div>
      <p className="text-sm text-gray-500 mb-1">
        <Link href="/" className="hover:text-green-600">Essential</Link>
        <span className="mx-2">›</span>
        Grocery
      </p>
      <h2 className="text-2xl font-bold text-gray-800 mb-1">Grocery</h2>
      <p className="text-sm text-gray-500 mb-6 max-w-2xl">
        The fuller catalogue structure, for future growth beyond the essential-foods basket — the real
        New World/PAK&apos;nSAVE category structure, with real counts. Most categories read zero today;
        this is scaffolding for later, not the current focus.
      </p>

      <div className="space-y-8">
        {CATALOG_CATEGORIES.map((category) => {
          const subcategories = subcategoriesByCategory.get(category.slug) ?? []
          const categoryTotal = subcategories.reduce((sum, sub) => sum + sub.productCount, 0)
          return (
            <div key={category.slug}>
              <div className="flex items-baseline gap-2 mb-3">
                <h3 className="text-xl font-bold text-gray-800">{category.name}</h3>
                <span className="text-sm text-gray-400">
                  {categoryTotal.toLocaleString()} product{categoryTotal === 1 ? '' : 's'}
                </span>
              </div>
              {subcategories.length === 0 ? (
                <p className="text-sm text-gray-400 bg-white rounded-xl border border-dashed border-gray-200 px-4 py-6">
                  Nothing synced here yet.
                </p>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {subcategories.map((sub) => (
                    <Link
                      key={sub.slug}
                      href={`/products/category/${category.slug}/${sub.slug}`}
                      className="flex items-center justify-between bg-white rounded-xl border border-gray-200 px-4 py-3 hover:border-green-400 transition-colors"
                    >
                      <div>
                        <p className="font-medium text-gray-800">{sub.name}</p>
                        <p className="text-xs mt-0.5 text-green-600">
                          {sub.productCount.toLocaleString()} product{sub.productCount === 1 ? '' : 's'}
                        </p>
                      </div>
                      <span className="text-gray-300">›</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
