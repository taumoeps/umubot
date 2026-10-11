'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Public nav -- no auth, no sign-out. "Essential" (real products
// individually flagged essential) is the primary identity now, not a
// copy of Pricer's full catalogue. "Products" -- the fuller Pricer-
// structured catalogue, including Brands -- is kept as a real, working
// secondary section for future growth rather than deleted (operator
// decision: keep it to introduce later, don't throw the code away).
const links = [
  { href: '/', label: 'Essential', icon: '▣' },
  { href: '/products', label: 'Products', icon: '▦' },
  { href: '/price-index', label: 'Price Index', icon: '◈' },
]

export default function Nav() {
  const pathname = usePathname()
  return (
    <aside className="w-56 min-h-screen bg-gray-900 text-white flex flex-col">
      <div className="px-6 py-6 border-b border-gray-700">
        <h1 className="text-xl font-bold tracking-widest text-white">UmuBot</h1>
        <p className="text-xs text-gray-400 mt-1">Real NZ food prices</p>
      </div>
      <nav className="flex-1 px-3 py-4 space-y-1">
        {links.map(({ href, label, icon }) => {
          // '/' is active on an EXACT match only -- pathname.startsWith('/')
          // is trivially true for every path, so that shortcut (used for
          // every other href here) would wrongly make '/' always active.
          // '/products' owns its own /products/* subtree. '/product/[x]'
          // is reachable from both and doesn't highlight either -- it's
          // genuinely shared, not owned by one.
          const isActive = href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`)
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                isActive ? 'bg-green-600 text-white' : 'text-gray-400 hover:bg-gray-800 hover:text-white'
              }`}
            >
              <span className="text-base">{icon}</span>
              {label}
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
