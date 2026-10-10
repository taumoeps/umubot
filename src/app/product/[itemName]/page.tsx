import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getProductDetail } from '@/lib/pricerCatalogView'
import PriceHistoryChart from '@/components/PriceHistoryChart'

// UmuBot -- mirrors Pricer's product detail page structure (image/tag
// header, Today's prices + Price outlook two-column layout, Price
// history chart). Keyed by the real observed item_name.
//
// Real differences from Pricer, kept honest rather than hidden:
// - No product image -- nothing real to show one from, so a plain
//   placeholder square, not a stock photo.
// - "Today's prices" shows each chain's most recent REAL observation,
//   which may be days old -- the real date is shown on each row rather
//   than implying it's literally today's price.
// - "Price outlook" reports a real lowest-ever price and the real date
//   range behind it, not a fixed "30-day low" -- actual history here is
//   often shorter than 30 days.

// 5-minute cache -- same reasoning as the homepage (external review,
// 2026-10-11): underlying data changes once daily, not per-request.
export const revalidate = 300

const CHAIN_LABELS: Record<string, string> = {
  paknsave: "PAK'nSAVE",
  'new-world': 'New World',
  woolworths: 'Woolworths',
  freshchoice: 'FreshChoice',
}

export default async function ProductDetailPage({ params }: { params: Promise<{ itemName: string }> }) {
  const { itemName: encoded } = await params
  const itemName = decodeURIComponent(encoded)
  const detail = await getProductDetail(itemName)
  if (!detail) notFound()

  const atLowest = detail.todayByChain.some((t) => t.priceCents === detail.lowestEverCents)
  const sameDay = detail.historyStartDate === detail.historyEndDate

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        <Link href="/" className="hover:text-green-600">Products</Link>
        {detail.category && (
          <>
            <span className="mx-2">›</span>
            {detail.category}
          </>
        )}
        {detail.subcategory && (
          <>
            <span className="mx-2">›</span>
            {detail.subcategory}
          </>
        )}
      </p>

      <div className="flex items-start gap-4 mb-6">
        <div className="w-16 h-16 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-300 text-2xl shrink-0">
          ◻
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            {detail.brand && <span className="text-sm font-semibold text-green-700">{detail.brand}</span>}
            {detail.subcategory && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">{detail.subcategory}</span>
            )}
            {detail.packSize && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">{detail.packSize}</span>
            )}
          </div>
          <h2 className="text-2xl font-bold text-gray-800">{detail.itemName}</h2>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <div className="lg:col-span-2 bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-200">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Today&apos;s prices</h3>
          </div>
          <div className="divide-y divide-gray-100">
            {detail.todayByChain.map((t) => (
              <div key={t.chain} className="flex items-center justify-between px-5 py-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-800">{CHAIN_LABELS[t.chain] ?? t.chain}</span>
                    {t.isCheapest && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">Cheapest</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {t.storeName} · as of {new Date(t.observedAt).toLocaleDateString()}
                  </p>
                </div>
                <p className="text-2xl font-bold text-gray-800">${(t.priceCents / 100).toFixed(2)}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">Price outlook</h3>
          <p className="text-xs text-gray-400 mb-4">Computed from real observed prices — not an AI estimate</p>
          {atLowest ? (
            <>
              <p className="text-sm font-semibold text-green-700 mb-1">At its lowest real observed price</p>
              <p className="text-xs text-gray-500">
                Matches the lowest price seen in real history ({detail.historyStartDate}
                {!sameDay && ` – ${detail.historyEndDate}`}).
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-gray-700 mb-1">Above its lowest real observed price</p>
              <p className="text-xs text-gray-500">
                Lowest real price seen was ${(detail.lowestEverCents / 100).toFixed(2)} on {detail.lowestEverDate}.
              </p>
            </>
          )}
          <div className="mt-4 pt-4 border-t border-gray-100">
            <p className="text-xs text-gray-400">Lowest observed</p>
            <p className="text-xl font-bold text-gray-800">${(detail.lowestEverCents / 100).toFixed(2)}</p>
            <p className="text-xs text-gray-400">{detail.lowestEverDate}</p>
          </div>
          <div className="mt-3 pt-3 border-t border-gray-100">
            <p className="text-xs text-gray-400">
              Real history window: {detail.historyStartDate}
              {!sameDay && ` to ${detail.historyEndDate}`}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-200">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Price history</h3>
          <p className="text-xs text-gray-400 mt-0.5">Real minimum price per day per chain — no estimated or interpolated points</p>
        </div>
        <div className="px-5 py-4">
          <PriceHistoryChart history={detail.history} />
        </div>
      </div>
    </div>
  )
}
