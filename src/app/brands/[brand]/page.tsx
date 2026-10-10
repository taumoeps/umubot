import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getProductsForBrand } from '@/lib/pricerCatalogView'

// UmuBot -- mirrors Pricer's /brands/[id] detail page.

export const revalidate = 0

export default async function BrandDetailPage({ params }: { params: Promise<{ brand: string }> }) {
  const { brand: encoded } = await params
  const brand = decodeURIComponent(encoded)
  const products = await getProductsForBrand(brand)
  if (products.length === 0) notFound()

  const chains = Array.from(new Set(products.flatMap((p) => p.chains)))

  return (
    <div>
      <p className="text-sm text-gray-500 mb-1">
        <Link href="/brands" className="hover:text-green-600">Brands</Link>
        <span className="mx-2">›</span>
        {brand}
      </p>
      <h2 className="text-2xl font-bold text-gray-800 mb-1">{brand}</h2>
      <p className="text-sm text-gray-500 mb-6">
        {products.length} product{products.length === 1 ? '' : 's'} at {chains.join(', ') || 'no tracked chains'}
      </p>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-5 py-3 font-semibold text-gray-600">Name</th>
              <th className="text-left px-5 py-3 font-semibold text-gray-600">Size</th>
              <th className="text-right px-5 py-3 font-semibold text-gray-600">Lowest Price</th>
              <th className="text-left px-5 py-3 font-semibold text-gray-600">Available At</th>
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.itemName} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                <td className="px-5 py-3">
                  <Link href={`/product/${encodeURIComponent(p.itemName)}`} className="font-medium text-gray-800 hover:text-green-600">
                    {p.itemName}
                  </Link>
                </td>
                <td className="px-5 py-3 text-gray-600">{p.packSize ?? '—'}</td>
                <td className="px-5 py-3 text-right font-medium text-gray-800">${(p.lowestPriceCents / 100).toFixed(2)}</td>
                <td className="px-5 py-3 text-gray-600">{p.chains.join(', ') || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
