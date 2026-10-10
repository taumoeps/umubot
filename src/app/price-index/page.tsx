import Link from 'next/link'
import { getIndexOverview } from '@/lib/priceIndexOverviewView'
import { getCoverageAndFreshness } from '@/lib/priceIndexCoverageView'

// UmuBot -- mirrors Pricer's /price-index (Overview / Supermarkets /
// Categories tabs). The real, honest difference from Pricer's version:
// price_index_values has zero rows right now (no real link has ever
// been 'computed' yet). Every tab here reads the real getIndexOverview/
// getCoverageAndFreshness functions, which means every tab honestly
// shows "not enough data yet" instead of a fabricated number.

// 5-minute cache -- same reasoning as the homepage (external review,
// 2026-10-11): underlying data changes once daily/monthly, not per-request.
export const revalidate = 300

const CHAINS = ['new-world', 'paknsave']
const CATEGORIES = ['fruit_veg', 'meat_poultry_fish', 'dairy_eggs_staples']
const CATEGORY_LABELS: Record<string, string> = {
  meat_poultry_fish: 'Meat, Poultry & Fish',
  dairy_eggs_staples: 'Dairy, Eggs & Staples',
  fruit_veg: 'Fruit & Vegetables',
}
const CHAIN_LABELS: Record<string, string> = { 'new-world': 'New World', paknsave: "PAK'nSAVE" }

type Tab = 'overview' | 'supermarkets' | 'categories'

export default async function PriceIndexPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab: rawTab } = await searchParams
  const tab: Tab = rawTab === 'supermarkets' || rawTab === 'categories' ? rawTab : 'overview'

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-1">UmuBot Food Price Index</h2>
      <p className="text-sm text-gray-500 mb-6">
        A real, chained Essential Food Price Index for New Zealand — built and scheduled, real NZ data,
        honestly empty until comparable monthly history exists.
      </p>

      <div className="flex gap-1 mb-6 border-b border-gray-200">
        {(['overview', 'supermarkets', 'categories'] as Tab[]).map((t) => (
          <Link
            key={t}
            href={t === 'overview' ? '/price-index' : `/price-index?tab=${t}`}
            className={`px-4 py-2 text-sm font-medium capitalize border-b-2 -mb-px ${
              tab === t ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </Link>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'supermarkets' && <SupermarketsTab />}
      {tab === 'categories' && <CategoriesTab />}
    </div>
  )
}

async function OverviewTab() {
  const overview = await getIndexOverview('NZ', '__all__', '__all__')
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">UmuBot Essential Food Price Index</p>
      {overview.hasValue ? (
        <>
          <p className="text-4xl font-bold text-gray-800 mt-1">{overview.indexValue?.toFixed(2)}</p>
          <p className="text-sm text-gray-500 mt-1">
            {overview.pctChangeMom !== null && `${overview.pctChangeMom >= 0 ? '+' : ''}${overview.pctChangeMom.toFixed(2)}% vs last month`}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            {overview.publicationStatus} · coverage {overview.coveragePct?.toFixed(0)}% · base period {overview.basePeriod}
          </p>
        </>
      ) : overview.queryFailed ? (
        <>
          <p className="text-2xl font-semibold text-red-500 mt-1">Couldn&apos;t load the index right now</p>
          <p className="text-sm text-gray-500 mt-2 max-w-md">
            A real query failed — this is a genuine error, not an honestly empty index. Try again shortly.
          </p>
        </>
      ) : overview.suppressed ? (
        <>
          <p className="text-2xl font-semibold text-gray-400 mt-1">Index computed, not published</p>
          <p className="text-sm text-gray-500 mt-2 max-w-md">
            A real number was computed for {overview.period}, but coverage was too thin to publish it as a
            trustworthy headline (coverage {overview.coveragePct?.toFixed(0)}%). Shown as unavailable rather
            than displayed with false confidence.
          </p>
        </>
      ) : (
        <>
          <p className="text-2xl font-semibold text-gray-400 mt-1">No index value yet</p>
          <p className="text-sm text-gray-500 mt-2 max-w-md">
            Real price observations only span a few days so far — the chained index needs comparable data
            across two real months before a genuine number exists here. The engine is live and scheduled
            (daily population, monthly computation); this isn&apos;t a missing feature, it&apos;s a data
            timeline.
          </p>
        </>
      )}
    </div>
  )
}

async function SupermarketsTab() {
  const rows = await Promise.all(
    CHAINS.map(async (chain) => ({ chain, overview: await getIndexOverview('NZ', chain, '__all__') }))
  )
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <p className="px-5 pt-4 text-xs text-gray-400">Each chain against its own base period, once real data exists — not a direct dollar comparison.</p>
      <table className="w-full text-sm mt-3">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="text-left px-5 py-3 font-semibold text-gray-600">Chain</th>
            <th className="text-right px-5 py-3 font-semibold text-gray-600">Index</th>
            <th className="text-right px-5 py-3 font-semibold text-gray-600">vs last month</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ chain, overview }) => (
            <tr key={chain} className="border-b border-gray-100 last:border-0">
              <td className="px-5 py-3 font-medium text-gray-800">{CHAIN_LABELS[chain]}</td>
              <td className="px-5 py-3 text-right text-gray-700">
                {overview.hasValue ? (
                  overview.indexValue?.toFixed(2)
                ) : overview.queryFailed ? (
                  <span className="text-red-500 text-xs">query failed</span>
                ) : overview.suppressed ? (
                  <span className="text-gray-400 text-xs" title={`Coverage ${overview.coveragePct?.toFixed(0)}% -- too thin to publish`}>not published</span>
                ) : (
                  <span className="text-gray-400 text-xs">no data yet</span>
                )}
              </td>
              <td className="px-5 py-3 text-right text-gray-500">{overview.hasValue && overview.pctChangeMom !== null ? `${overview.pctChangeMom >= 0 ? '+' : ''}${overview.pctChangeMom.toFixed(2)}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

async function CategoriesTab() {
  const rows = await Promise.all(
    CATEGORIES.map(async (category) => ({
      category,
      byChain: await Promise.all(CHAINS.map(async (chain) => ({ chain, coverage: await getCoverageAndFreshness('NZ', chain, category) }))),
    }))
  )
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <p className="px-5 pt-4 text-xs text-gray-400">
        Real coverage per category/chain — eligible foods, matched (comparable month-to-month), and link status. This is the real, live data behind the index, not a fabricated number.
      </p>
      <table className="w-full text-sm mt-3">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="text-left px-5 py-3 font-semibold text-gray-600">Category</th>
            {CHAINS.map((c) => (
              <th key={c} className="text-right px-5 py-3 font-semibold text-gray-600">{CHAIN_LABELS[c]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ category, byChain }) => (
            <tr key={category} className="border-b border-gray-100 last:border-0">
              <td className="px-5 py-3 font-medium text-gray-800">{CATEGORY_LABELS[category]}</td>
              {byChain.map(({ chain, coverage }) => (
                <td key={chain} className="px-5 py-3 text-right">
                  {coverage.queryFailed ? (
                    <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-100 text-red-600">query failed</span>
                  ) : (
                    <>
                      <span className="text-gray-700">{coverage.matchedCount ?? 0}/{coverage.eligibleCount}</span>
                      <span
                        className={`ml-2 text-xs px-2 py-0.5 rounded-full font-medium ${
                          coverage.linkStatus === 'computed' ? 'bg-green-100 text-green-700' : coverage.linkStatus === 'uncomputable' ? 'bg-gray-100 text-gray-500' : 'bg-gray-50 text-gray-400'
                        }`}
                      >
                        {coverage.linkStatus === 'no_attempt_yet' ? 'not run' : coverage.linkStatus}
                      </span>
                    </>
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
