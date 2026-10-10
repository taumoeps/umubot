import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getFoodDetail, getCategoryLabel } from '@/lib/essentialFoodsView'

// UmuBot -- shows every real product matched to one essential food
// (e.g. "Milk" might have several real distinct products: different
// brands/sizes, at different chains). Each one tagged Live/Estimated.

export const revalidate = 300

function TierBadge({ tier }: { tier: 'live' | 'estimated' }) {
  return tier === 'live' ? (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">Live</span>
  ) : (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">Estimated</span>
  )
}

export default async function FoodDetailPage({ params }: { params: Promise<{ foodId: string }> }) {
  const { foodId: encoded } = await params
  const foodId = decodeURIComponent(encoded)
  const detail = await getFoodDetail(foodId)
  if (!detail) notFound()
  const categoryLabel = await getCategoryLabel(detail.category)

  return (
    <div>
      <p className="text-sm text-gray-500 mb-1">
        <Link href="/" className="hover:text-green-600">Essential Foods</Link>
        <span className="mx-2">›</span>
        {categoryLabel}
      </p>
      <h2 className="text-2xl font-bold text-gray-800 mb-6">{detail.displayName}</h2>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-5 py-3 font-semibold text-gray-600">Product</th>
              <th className="text-left px-5 py-3 font-semibold text-gray-600">Brand</th>
              <th className="text-left px-5 py-3 font-semibold text-gray-600">Size</th>
              <th className="text-right px-5 py-3 font-semibold text-gray-600">Price</th>
              <th className="text-left px-5 py-3 font-semibold text-gray-600">Store</th>
              <th className="text-left px-5 py-3 font-semibold text-gray-600">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {detail.products.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-10 text-gray-400">No real observations for this food yet</td></tr>
            ) : (
              detail.products.map((p, i) => (
                <tr key={`${p.itemName}-${p.chain}-${i}`} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                  <td className="px-5 py-3">
                    <Link href={`/product/${encodeURIComponent(p.itemName)}`} className="font-medium text-gray-800 hover:text-green-600">
                      {p.itemName}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-gray-600">{p.brand ?? '—'}</td>
                  <td className="px-5 py-3 text-gray-600">{p.packSize ?? '—'}</td>
                  <td className="px-5 py-3 text-right font-medium text-gray-800" title={`As of ${new Date(p.observedAt).toLocaleDateString()}`}>
                    ${(p.priceCents / 100).toFixed(2)}
                  </td>
                  <td className="px-5 py-3 text-gray-600">{p.storeName}</td>
                  <td className="px-5 py-3"><TierBadge tier={p.tier} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
