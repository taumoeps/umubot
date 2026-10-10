import Link from 'next/link'
import { notFound } from 'next/navigation'
import { findSubcategory } from '@/lib/pricerCatalogTaxonomy'
import { getProductsForSubcategory } from '@/lib/pricerCatalogView'

// UmuBot -- mirrors Pricer's /categories/[id] product table (Name,
// Brand, Size, Lowest Price, Available At).

export const revalidate = 0

export default async function SubcategoryPage({
  params,
}: {
  params: Promise<{ category: string; subcategory: string }>
}) {
  const { category: categorySlug, subcategory: subcategorySlug } = await params
  const match = findSubcategory(categorySlug, subcategorySlug)
  if (!match) notFound()
  const { category, subcategory } = match

  const products = await getProductsForSubcategory(category.slug, subcategory.slug)

  return (
    <div>
      <p className="text-sm text-gray-500 mb-1">
        <Link href="/" className="hover:text-green-600">Products</Link>
        <span className="mx-2">›</span>
        {category.name}
        <span className="mx-2">›</span>
        {subcategory.name}
      </p>
      <h2 className="text-2xl font-bold text-gray-800 mb-6">{subcategory.name}</h2>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-5 py-3 font-semibold text-gray-600">Name</th>
              <th className="text-left px-5 py-3 font-semibold text-gray-600">Brand</th>
              <th className="text-left px-5 py-3 font-semibold text-gray-600">Size</th>
              <th className="text-right px-5 py-3 font-semibold text-gray-600">Lowest Price</th>
              <th className="text-left px-5 py-3 font-semibold text-gray-600">Available At</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-10 text-gray-400">No real observations in this subcategory yet</td></tr>
            ) : (
              products.map((p) => (
                <tr key={p.itemName} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="px-5 py-3">
                    <Link href={`/product/${encodeURIComponent(p.itemName)}`} className="font-medium text-gray-800 hover:text-green-600">
                      {p.itemName}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-gray-600">{p.brand ?? '—'}</td>
                  <td className="px-5 py-3 text-gray-600">{p.packSize ?? '—'}</td>
                  <td className="px-5 py-3 text-right font-medium text-gray-800">${(p.lowestPriceCents / 100).toFixed(2)}</td>
                  <td className="px-5 py-3 text-gray-600">{p.chains.join(', ') || '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
