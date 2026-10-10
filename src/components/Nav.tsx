'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Public nav -- no auth, no sign-out. Rebuilt 2026-10-11 (operator
// decision to differentiate from Pricer): dropped "Brands" (real brand
// data barely exists and it was a direct Pricer-structure copy), and
// "Products" became "Essential Foods" -- a narrow, honest list of real
// foods, not a copy of Pricer's full catalogue.
const links = [
  { href: '/', label: 'Essential Foods', icon: '▣' },
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
          // '/' itself also owns /food/* and /product/* (Essential Foods
          // browsing) -- /price-index is its own exact subtree.
          const isActive = href === '/'
            ? pathname === '/' || pathname.startsWith('/food/') || pathname.startsWith('/product/')
            : pathname === href || pathname.startsWith(`${href}/`)
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
