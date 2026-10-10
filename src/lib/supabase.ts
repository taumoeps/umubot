import { createClient } from '@supabase/supabase-js'

// Deliberately the anon/publishable key ONLY -- no service-role client
// exists anywhere in this project. This app is public (no login), so it
// must never hold write-capable credentials to the shared Supabase
// project (which also hosts RecipeBot's user data and Relay's/RigDraw's
// data). Every table this app reads has an explicit public SELECT-only
// RLS policy (mosaro/supabase/schema.sql, "Public read-only RLS for the
// Food Index tables", 2026-10-11) -- without that policy, a query here
// just returns zero rows, not an error.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
