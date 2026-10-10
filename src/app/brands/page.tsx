import Link from 'next/link'
import { getBrandList } from '@/lib/pricerCatalogView'

// UmuBot -- mirrors Pricer's /brands table (Name, Stockists, Products).
// Real data only: price_observations.brand.

// 5-minute cache -- same reasoning as the homepage (external review,
// 2026-10-11): underlying data changes once daily, not per-request.
export const revalidate = 300

export default async function BrandsPage() {
  const brands = await getBrandList()

  return (
    <div>
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
                    <Link href={`/brands/${encodeURIComponent(b.brand)}`} className="font-medium text-gray-800 hover:text-green-600">
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
