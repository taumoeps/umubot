'use client'

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'

// Optional sign-in (Essentials alignment plan, step 5.2; operator decision 4, 2026-10-21):
// the same Supabase accounts as the RecipeBot app, so a person's food replacements follow
// them across both. Browsing stays account-free (redesign §8) -- nothing here gates a page.
// Google and Apple only, matching the app (email/password was declined to avoid holding
// credentials). The session lives in this browser (supabase-js storage); the server never
// sees it, so pages stay statically cacheable -- signed-in calls send the access token to
// mosaro from the browser.

type Provider = 'google' | 'apple'

interface AuthValue {
  session: Session | null
  ready: boolean
  signIn: (provider: Provider) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

let browserClient: SupabaseClient | null = null
function authClient(): SupabaseClient {
  browserClient ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { flowType: 'pkce', persistSession: true, detectSessionInUrl: true, storageKey: 'umubot-auth' },
  })
  return browserClient
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const client = authClient()
    let cancelled = false
    client.auth.getSession().then(({ data }) => {
      if (cancelled) return
      setSession(data.session)
      setReady(true)
    })
    const { data: sub } = client.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => {
      cancelled = true
      sub.subscription.unsubscribe()
    }
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      session,
      ready,
      async signIn(provider) {
        await authClient().auth.signInWithOAuth({ provider, options: { redirectTo: window.location.href.split('#')[0].split('?')[0] } })
      },
      async signOut() {
        await authClient().auth.signOut()
      },
    }),
    [session, ready]
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}
