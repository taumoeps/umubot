import type { ChainHistory } from '@/lib/productDetailView'

// UmuBot -- mirrors Pricer's price history line chart. Hand-rolled SVG,
// not a charting library (none installed). Plots only real data points
// -- a chain missing a day is a gap in its line, never interpolated or
// faked.
//
// Labels and dots are real HTML overlays, not SVG <text>/<circle> --
// real bug caught live, 2026-10-12: this page has no max-width (see
// layout.tsx), so on a wide screen the SVG (a fixed 800x260 viewBox,
// stretched via w-full) could render 1.5-2x larger than its native
// size, and SVG fontSize/stroke-width/radius are specified in viewBox
// units, so they scaled up right along with it -- "the graph fonts and
// lines too big compared to the rest of the page" was a real,
// reproducible rendering bug, not a one-off. HTML text/dots use the
// page's own font-size scale and render at a consistent size
// regardless of the container's actual width; only the gridlines and
// connecting line (genuinely fine to scale with the plot area, like
// any responsive chart) stay in SVG, using a percentage-based 0-100
// viewBox so both coordinate systems share the same plain
// left/top percentages.

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

// Percentages of the plot box's own width/height -- converted from the
// original fixed-pixel 800x260 margins (left 56/800, right 16/800, top
// 16/260, bottom 28/260), so the proportions look the same as before.
const MARGIN = { top: 6, right: 2, bottom: 11, left: 7 }
const PLOT_W = 100 - MARGIN.left - MARGIN.right
const PLOT_H = 100 - MARGIN.top - MARGIN.bottom

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
      <div className="relative w-full" style={{ aspectRatio: '800 / 260' }}>
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="absolute inset-0 w-full h-full"
          role="img"
          aria-label="Price history chart"
        >
          {yTicks.map((price, i) => (
            <line
              key={i}
              x1={MARGIN.left}
              x2={100 - MARGIN.right}
              y1={yFor(price)}
              y2={yFor(price)}
              stroke="#f3f4f6"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {history.map((h) => {
            if (h.points.length < 2) return null
            const color = CHAIN_COLORS[h.chain] ?? FALLBACK_COLOR
            const d = h.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xFor(p.date).toFixed(2)} ${yFor(p.minPriceCents).toFixed(2)}`).join(' ')
            return <path key={h.chain} d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" />
          })}
        </svg>

        {yTicks.map((price, i) => (
          <span
            key={i}
            className="absolute text-xs text-gray-400 pr-1 text-right"
            style={{ left: 0, width: `${MARGIN.left}%`, top: `${yFor(price)}%`, transform: 'translateY(-50%)' }}
          >
            ${(price / 100).toFixed(2)}
          </span>
        ))}
        <span className="absolute text-xs text-gray-400" style={{ left: `${MARGIN.left}%`, bottom: 0 }}>
          {allDates[0]}
        </span>
        <span className="absolute text-xs text-gray-400" style={{ right: `${MARGIN.right}%`, bottom: 0 }}>
          {allDates[allDates.length - 1]}
        </span>

        {history.flatMap((h) => {
          const color = CHAIN_COLORS[h.chain] ?? FALLBACK_COLOR
          return h.points.map((p) => (
            <span
              key={`${h.chain}-${p.date}`}
              className="absolute w-2 h-2 rounded-full -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${xFor(p.date)}%`, top: `${yFor(p.minPriceCents)}%`, backgroundColor: color }}
            />
          ))
        })}
      </div>
    </div>
  )
}
