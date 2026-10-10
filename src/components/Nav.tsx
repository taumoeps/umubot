'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Public nav -- no auth, no sign-out, no admin-portal links (Apps/Users/
// Logs/Profile from mosaro's Sidebar.tsx don't belong here; this project
// is exactly one thing, not a multi-section admin portal). Same visual
// pattern as mosaro's Sidebar for continuity, pared down to what this
// site actually has: Products, Brands, Price Index -- matching Pricer's
// real left nav structure.
const links = [
  { href: '/', label: 'Products', icon: '▣' },
  { href: '/brands', label: 'Brands', icon: '◆' },
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
          // '/' itself also owns /category/* and /product/* (Products
          // browsing) -- /brands and /price-index are their own exact
          // subtrees, checked on their own href.
          const isActive = href === '/'
            ? pathname === '/' || pathname.startsWith('/category/') || pathname.startsWith('/product/')
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
