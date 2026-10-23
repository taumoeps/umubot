'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useLocationMode } from './LocationModeContext'
import { useAuth } from './AuthContext'

// Public nav. Optional sign-in at the bottom (2026-10-21) -- only adds a visitor's own food
// replacements; every page works without it. "Essential" (real products
// individually flagged essential) is the primary identity now, not a
// copy of Pricer's full catalogue. "Price Index" replaced by "Food
// Affordability" (operator decision, 2026-10-12) -- "how many meals
// can I make with $X" is a stronger, more actionable differentiator
// than a generic inflation index; the old Price Index route/libs were
// removed, not just unlinked.
//
// Grocery hidden by default, shown ONLY once a visitor's location is
// actually confirmed NZ (operator decision, 2026-10-13, correcting an
// earlier version that defaulted to visible) -- Grocery's own
// catalogue is 100% NZ-specific (the real New World/PAK'nSAVE category
// structure), so it stays hidden until there's a real reason to think
// a visitor is in NZ, not just an absence of evidence they aren't.
// isConfirmedNZ comes from LocationModeContext, set by
// NearbyEssential.tsx from the real API response's confirmedNZ field --
// the route/code stays working either way (/products is still a real
// page) -- this only ever hides the link.
const baseLinks = [
  { href: '/', label: 'Essential', icon: '▣' },
  { href: '/products', label: 'Grocery', icon: '▦' },
  { href: '/affordability', label: 'Budget', icon: '🍽' },
  { href: '/how-it-works', label: 'How it works', icon: 'ⓘ' },
]

export default function Nav() {
  const pathname = usePathname()
  const { isConfirmedNZ } = useLocationMode()
  const links = isConfirmedNZ ? baseLinks : baseLinks.filter((l) => l.href !== '/products')
  return (
    <aside className="w-56 h-screen sticky top-0 shrink-0 bg-gray-900 text-white flex flex-col">
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
      <AccountBox />
    </aside>
  )
}

function AccountBox() {
  const { session, ready, signIn, signOut } = useAuth()
  if (!ready) return <div className="px-6 py-5 border-t border-gray-700 h-24" />
  if (session) {
    const who = session.user.email ?? (session.user.user_metadata?.full_name as string | undefined) ?? 'Signed in'
    return (
      <div className="px-6 py-5 border-t border-gray-700">
        <p className="text-xs text-gray-400">Signed in — your RecipeBot food picks apply here too.</p>
        <p className="text-sm text-white truncate mt-1">{who}</p>
        <button onClick={() => signOut()} className="text-xs text-gray-400 hover:text-white mt-2">
          Sign out
        </button>
      </div>
    )
  }
  return (
    <div className="px-6 py-5 border-t border-gray-700 space-y-2">
      <p className="text-xs text-gray-400">Use your RecipeBot account to see and change your own food picks.</p>
      <button onClick={() => signIn('apple')} className="w-full text-sm py-2 rounded-lg bg-white text-gray-900 font-medium hover:bg-gray-200">
        Sign in with Apple
      </button>
      <button onClick={() => signIn('google')} className="w-full text-sm py-2 rounded-lg border border-gray-600 text-white hover:bg-gray-800">
        Sign in with Google
      </button>
    </div>
  )
}
