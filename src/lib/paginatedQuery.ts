// UmuBot -- shared pagination for PostgREST queries over
// price_observations (or anything else past PostgREST's default
// 1000-row cap). Consolidated 2026-10-12 after the same two bugs were
// each found and fixed three separate times, by hand, one file at a
// time, only after a specific page was reported slow:
//
// 1. Sequential pagination. Two of the three files that needed this
//    (productCatalogView.ts, productDetailView.ts) were still awaiting
//    each page one at a time; only essentialFoodsView.ts had been
//    upgraded to fire every page in parallel once the real row count
//    is known from page one (confirmed live, 2026-10-12: this alone
//    cut a ~4.3s query to sub-second). The other two were only getting
//    the caching fix (#2 below), not this one -- their first load
//    after a cache miss was still paying the slower sequential cost.
// 2. No caching. Three separate files independently fetched the same
//    kind of data fresh on every single page view, confirmed live as
//    the root cause of "Bread Rolls took 3-5s to open", "Frozen Fish &
//    Seafood took 2-3s", and "Free Range Eggs (12pk) took 1-2s even
//    after the other two fixes" -- three different reports, same root
//    cause, three different files, found one at a time because each
//    developer (me) had to remember to add unstable_cache by hand at
//    each new call site.
//
// cachedPaginatedQuery/cachedPaginatedQueryWithArg below fix both at
// once, structurally: any NEW query that needs to page past 1000 rows
// gets real parallel pagination AND cross-request caching just by
// going through one of these two functions -- there's no second step
// to forget, and no slower sequential loop to accidentally reach for
// instead. This is the honest limit of "universal", though: a query
// that needs OTHER prep work before pagination starts (essentialFoodsView
// .ts's getAllFlaggedProducts, which fetches the real flagged-item list
// first) still wraps its own async function in unstable_cache directly,
// using runPaginated internally -- there's no way to make an arbitrary
// shape of "prep work, then paginate" fully generic without losing
// real type safety, so that file calls runPaginated + unstable_cache
// itself rather than these two wrappers. What IS guaranteed either way:
// every file in this project doing paginated price_observations work
// now shares the SAME pagination implementation, not three drifting
// copies.

import { unstable_cache } from 'next/cache'

const PAGE_SIZE = 1000

export interface PageResult<T> {
  data: T[] | null
  error: { message: string } | null
  count?: number | null
}

/** Pages through a PostgREST query, firing every page after the first
 *  in parallel once the real row count is known (not sequentially) --
 *  the actual pagination logic every cached query below shares. build's
 *  withCount=true call must pass { count: 'exact' } to Supabase so the
 *  real total is known up front. */
export async function runPaginated<T>(
  build: (from: number, to: number, withCount: boolean) => Promise<PageResult<T>>
): Promise<T[]> {
  const first = await build(0, PAGE_SIZE - 1, true)
  if (first.error) throw new Error(first.error.message)
  const rows = [...(first.data ?? [])]
  const total = first.count ?? rows.length
  const numPages = Math.ceil(total / PAGE_SIZE)
  if (numPages > 1) {
    const rest = await Promise.all(
      Array.from({ length: numPages - 1 }, (_, i) => {
        const page = i + 1
        return build(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1, false)
      })
    )
    for (const r of rest) {
      if (r.error) throw new Error(r.error.message)
      rows.push(...(r.data ?? []))
    }
  }
  return rows
}

/** A paginated query with no extra arguments (e.g. "every category-
 *  tagged row"), cached across requests for 5 minutes. cacheKey must be
 *  unique per distinct query shape. */
export function cachedPaginatedQuery<T>(
  cacheKey: string[],
  build: (from: number, to: number, withCount: boolean) => Promise<PageResult<T>>
): () => Promise<T[]> {
  return unstable_cache(() => runPaginated(build), cacheKey, { revalidate: 300 })
}

/** Same as cachedPaginatedQuery, for a query scoped by one argument (an
 *  item_name, a brand). The real cache entry varies per argument value
 *  automatically -- unstable_cache includes the actual call argument in
 *  its cache key, so "Bread Rolls" and "Free Range Eggs" get separate
 *  entries, never one shared/colliding one. */
export function cachedPaginatedQueryWithArg<T, A>(
  cacheKey: string[],
  build: (arg: A, from: number, to: number, withCount: boolean) => Promise<PageResult<T>>
): (arg: A) => Promise<T[]> {
  return unstable_cache((arg: A) => runPaginated((from, to, withCount) => build(arg, from, to, withCount)), cacheKey, { revalidate: 300 })
}
