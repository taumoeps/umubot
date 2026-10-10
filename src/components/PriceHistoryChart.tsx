import type { ChainHistory } from '@/lib/productDetailView'

// UmuBot -- mirrors Pricer's price history line chart. Hand-rolled SVG,
// not a charting library (none installed). Plots only real data points
// -- a chain missing a day is a gap in its line, never interpolated or
// faked.

const CHAIN_COLORS: Record<string, string> = {
  paknsave: '#eab308',
  'new-world': '#ef4444',
  woolworths: '#22c55e',
  freshchoice: '#3b82f6',
}
const CHAIN_LABELS: Record<string, string> = {
  paknsave: "PAK'nSAVE",
  'new-world': 'New World',
  woolworths: 'Woolworths',
  freshchoice: 'FreshChoice',
}
const FALLBACK_COLOR = '#9ca3af'

const WIDTH = 800
const HEIGHT = 260
const MARGIN = { top: 16, right: 16, bottom: 28, left: 56 }
const PLOT_W = WIDTH - MARGIN.left - MARGIN.right
const PLOT_H = HEIGHT - MARGIN.top - MARGIN.bottom

export default function PriceHistoryChart({ history }: { history: ChainHistory[] }) {
  const allDates = Array.from(new Set(history.flatMap((h) => h.points.map((p) => p.date)))).sort()
  const allPrices = history.flatMap((h) => h.points.map((p) => p.minPriceCents))

  if (allDates.length === 0 || allPrices.length === 0) {
    return <p className="text-sm text-gray-400 py-8 text-center">No real price history to chart yet.</p>
  }

  const minPrice = Math.min(...allPrices)
  const maxPrice = Math.max(...allPrices)
  const pad = maxPrice > minPrice ? (maxPrice - minPrice) * 0.15 : Math.max(maxPrice * 0.1, 50)
  const yMin = Math.max(0, minPrice - pad)
  const yMax = maxPrice + pad

  const dateIndex = new Map(allDates.map((d, i) => [d, i]))
  const xFor = (date: string) => MARGIN.left + (allDates.length === 1 ? PLOT_W / 2 : (dateIndex.get(date)! / (allDates.length - 1)) * PLOT_W)
  const yFor = (cents: number) => MARGIN.top + PLOT_H - ((cents - yMin) / (yMax - yMin)) * PLOT_H

  const yTicks = [yMin, (yMin + yMax) / 2, yMax]

  return (
    <div>
      <div className="flex flex-wrap gap-4 mb-3">
        {history.map((h) => {
          const latest = h.points[h.points.length - 1]
          return (
            <div key={h.chain} className="flex items-center gap-1.5 text-xs text-gray-600">
              <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: CHAIN_COLORS[h.chain] ?? FALLBACK_COLOR }} />
              {CHAIN_LABELS[h.chain] ?? h.chain}
              {latest && <span className="font-semibold text-gray-800">${(latest.minPriceCents / 100).toFixed(2)}</span>}
            </div>
          )
        })}
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full h-auto" role="img" aria-label="Price history chart">
        <rect x="0" y="0" width={WIDTH} height={HEIGHT} fill="white" />
        {yTicks.map((price, i) => (
          <g key={i}>
            <line
              x1={MARGIN.left}
              x2={WIDTH - MARGIN.right}
              y1={yFor(price)}
              y2={yFor(price)}
              stroke="#f3f4f6"
              strokeWidth="1"
            />
            <text x={MARGIN.left - 8} y={yFor(price) + 4} fontSize="11" fill="#9ca3af" textAnchor="end">
              ${(price / 100).toFixed(2)}
            </text>
          </g>
        ))}
        <text x={MARGIN.left} y={HEIGHT - 6} fontSize="11" fill="#9ca3af" textAnchor="start">
          {allDates[0]}
        </text>
        <text x={WIDTH - MARGIN.right} y={HEIGHT - 6} fontSize="11" fill="#9ca3af" textAnchor="end">
          {allDates[allDates.length - 1]}
        </text>
        {history.map((h) => {
          const color = CHAIN_COLORS[h.chain] ?? FALLBACK_COLOR
          if (h.points.length === 1) {
            const p = h.points[0]
            return <circle key={h.chain} cx={xFor(p.date)} cy={yFor(p.minPriceCents)} r="4" fill={color} />
          }
          const d = h.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(p.date).toFixed(1)} ${yFor(p.minPriceCents).toFixed(1)}`).join(' ')
          return (
            <g key={h.chain}>
              <path d={d} fill="none" stroke={color} strokeWidth="2" />
              {h.points.map((p) => (
                <circle key={p.date} cx={xFor(p.date)} cy={yFor(p.minPriceCents)} r="3" fill={color} />
              ))}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
