import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getProductDetail } from '@/lib/productDetailView'
import { getOtherVariants } from '@/lib/essentialFoodsView'
import PriceHistoryChart from '@/components/PriceHistoryChart'

// UmuBot -- product detail page. Deliberately NOT Pricer's layout
// (operator decision, 2026-10-11, after a direct side-by-side
// comparison): Pricer leads with a "Today's prices" card grid + a
// sidebar "Price outlook" card, with the chart stacked underneath as
// an afterthought. That hierarchy says "price comparison tool, chart
// optional". UmuBot's actual thesis is the opposite -- the real
// observation history IS the product, not a footnote -- so this page
// leads with the chart as the hero, compresses the lowest/current
// stats into inline chips under it instead of a separate sidebar card,
// and turns "where to buy now" into a compact utility list at the
// BOTTOM instead of Pricer's card-grid hero at the top.
//
// What's real vs honestly flagged:
// - No product image -- nothing real to show one from, so a plain
//   placeholder square, not a stock photo.
// - Each store row is tagged Live or Estimated (src/lib/confidence.ts)
//   -- says which prices were actually seen vs estimated, which
//   Pricer's UI never does.
// - "Lowest observed" reports a real date range, not a fixed "30-day
//   low" -- actual history here is often shorter than 30 days.

export const revalidate = 300

const CHAIN_LABELS: Record<string, string> = {
  paknsave: "PAK'nSAVE",
  'new-world': 'New World',
  woolworths: 'Woolworths',
  freshchoice: 'FreshChoice',
}

function TierBadge({ tier }: { tier: 'live' | 'estimated' }) {
  return tier === 'live' ? (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">Live</span>
  ) : (
    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">Estimated</span>
  )
}

export default async function ProductDetailPage({ params }: { params: Promise<{ itemName: string }> }) {
  const { itemName: encoded } = await params
  const itemName = decodeURIComponent(encoded)
  const detail = await getProductDetail(itemName)
  if (!detail) notFound()

  const otherVariants = detail.foodId ? await getOtherVariants(detail.foodId, detail.itemName) : []

  const atLowest = detail.todayByChain.some((t) => t.priceCents === detail.lowestEverCents)
  const sameDay = detail.historyStartDate === detail.historyEndDate
  const cheapest = detail.todayByChain.find((t) => t.isCheapest)

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        <Link href="/" className="hover:text-green-600">Essential</Link>
      </p>

      <div className="flex items-start gap-4 mb-6">
        <div className="w-16 h-16 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-300 text-2xl shrink-0">
          ◻
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2 mb-1">
            {detail.brand && <span className="text-sm font-semibold text-green-700">{detail.brand}</span>}
            {detail.packSize && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">{detail.packSize}</span>
            )}
          </div>
          <h2 className="text-2xl font-bold text-gray-800">{detail.itemName}</h2>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mb-6">
        <div className="px-5 py-4 border-b border-gray-100">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Real price timeline</h3>
          <p className="text-xs text-gray-400 mt-0.5">Real minimum price per day per chain — no estimated or interpolated points</p>
        </div>
        <div className="px-5 pt-4">
          <PriceHistoryChart history={detail.history} />
        </div>
        <div className="flex flex-wrap gap-3 px-5 pb-5 pt-2">
          <div className="flex-1 min-w-[200px] rounded-lg bg-gray-50 px-4 py-3">
            <p className="text-xs text-gray-400">Lowest observed</p>
            <p className="text-lg font-bold text-gray-800">
              ${(detail.lowestEverCents / 100).toFixed(2)}
              <span className="text-xs font-normal text-gray-400 ml-1">on {detail.lowestEverDate}</span>
            </p>
          </div>
          <div className="flex-1 min-w-[200px] rounded-lg bg-gray-50 px-4 py-3">
            <p className="text-xs text-gray-400">Right now</p>
            <p className={`text-sm font-semibold ${atLowest ? 'text-green-700' : 'text-gray-700'}`}>
              {atLowest ? 'At its lowest observed price' : `$${((cheapest?.priceCents ?? 0) / 100).toFixed(2)} above lowest`}
            </p>
          </div>
          <div className="flex-1 min-w-[200px] rounded-lg bg-gray-50 px-4 py-3">
            <p className="text-xs text-gray-400">Real history window</p>
            <p className="text-sm font-medium text-gray-700">
              {detail.historyStartDate}{!sameDay && ` – ${detail.historyEndDate}`}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Where to buy now</h3>
        </div>
        <div className="divide-y divide-gray-100">
          {detail.todayByChain.map((t) => (
            <div key={t.chain} className="flex items-center justify-between px-5 py-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium text-gray-800">{CHAIN_LABELS[t.chain] ?? t.chain}</span>
                {t.isCheapest && <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-green-100 text-green-700">Cheapest</span>}
                <TierBadge tier={t.tier} />
                <span className="text-xs text-gray-400 truncate">{t.storeName} · as of {new Date(t.observedAt).toLocaleDateString()}</span>
              </div>
              <p className="text-lg font-bold text-gray-800 shrink-0 ml-4">${(t.priceCents / 100).toFixed(2)}</p>
            </div>
          ))}
        </div>
      </div>

      {otherVariants.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden mt-6">
          <div className="px-5 py-3 border-b border-gray-100">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Other sizes & brands</h3>
            <p className="text-xs text-gray-400 mt-0.5">Cheapest to most expensive</p>
          </div>
          <div className="divide-y divide-gray-100">
            {otherVariants.map((v) => (
              <Link
                key={v.itemName}
                href={`/product/${encodeURIComponent(v.itemName)}`}
                className="flex items-center justify-between px-5 py-3 hover:bg-gray-50"
              >
                <div className="min-w-0">
                  <p className="font-medium text-gray-800 truncate">{v.itemName}</p>
                  <p className="text-xs text-gray-400 truncate">{v.brand ?? 'No brand recorded'}</p>
                </div>
                <p className="text-lg font-bold text-gray-800 shrink-0 ml-4">${(v.lowestPriceCents / 100).toFixed(2)}</p>
              </Link>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
