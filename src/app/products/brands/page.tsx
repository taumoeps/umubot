import Link from 'next/link'
import { getBrandList } from '@/lib/productCatalogView'

// UmuBot -- mirrors Pricer's /brands table (Name, Stockists, Products).
// Real data only: price_observations.brand. Kept as part of the
// secondary Products catalogue section (operator decision, 2026-10-11
// -- see src/lib/productCatalogView.ts's module doc).

export const revalidate = 300

export default async function BrandsPage() {
  const brands = await getBrandList()

  return (
    <div>
      <p className="text-sm text-gray-500 mb-1">
        <Link href="/products" className="hover:text-green-600">Products</Link>
        <span className="mx-2">›</span>
        Brands
      </p>
      <h2 className="text-2xl font-bold text-gray-800 mb-1">Brands</h2>
      <p className="text-sm text-gray-500 mb-6">
        Real brands pulled from Baskt&apos;s own item data — nothing invented.
      </p>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-5 py-3 font-semibold text-gray-600">Name</th>
              <th className="text-left px-5 py-3 font-semibold text-gray-600">Stockists</th>
              <th className="text-right px-5 py-3 font-semibold text-gray-600">Products</th>
            </tr>
          </thead>
          <tbody>
            {brands.length === 0 ? (
              <tr><td colSpan={3} className="text-center py-10 text-gray-400">No real brand data yet</td></tr>
            ) : (
              brands.map((b) => (
                <tr key={b.brand} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="px-5 py-3">
                    <Link href={`/products/brands/${encodeURIComponent(b.brand)}`} className="font-medium text-gray-800 hover:text-green-600">
                      {b.brand}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-gray-600">{b.chains.join(', ') || '—'}</td>
                  <td className="px-5 py-3 text-right text-gray-600">{b.productCount}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
