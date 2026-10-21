import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'
import Nav from '@/components/Nav'
import { LocationModeProvider } from '@/components/LocationModeContext'
import { AuthProvider } from '@/components/AuthContext'

const geist = Geist({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'UmuBot',
  description: 'Essential New Zealand food prices, tagged live or estimated — never shown without saying which',
}

// No auth gate -- this site is public, unlike mosaro's portal it was
// split out from. Every query runs through the read-only anon Supabase
// client (src/lib/supabase.ts); there is no service-role key in this
// codebase. Sign-in (AuthContext.tsx, 2026-10-21) is optional and only
// adds a visitor's own food replacements on top of the public pages.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${geist.className} bg-gray-50`}>
        <AuthProvider>
          <LocationModeProvider>
            <div className="flex min-h-screen">
              <Nav />
              <main className="flex-1 p-8">{children}</main>
            </div>
          </LocationModeProvider>
        </AuthProvider>
      </body>
    </html>
  )
}
