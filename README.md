# UmuBot

Real New Zealand supermarket price tracking, structured like
[pricer.nz](https://pricer.nz) — Products, Brands, and a Price Index.
Public, no login, split out from the `mosaro` repo's internal admin
portal on 2026-10-11 so this could be a real standalone product instead
of living behind an operator login.

## Data

Reads from the same Supabase project as `mosaro`/`RecipeBot`, through
the public `anon` key only — there is no service-role key anywhere in
this codebase, by design. Every table this app queries has an explicit
public SELECT-only RLS policy (`mosaro/supabase/schema.sql`, "Public
read-only RLS for the Food Index tables" section, 2026-10-11); without
those policies a query here just returns zero rows, not an error. This
app never writes to the database — all population/sync jobs that write
real price data live in `mosaro` and run on its own schedule.

## Setup

```bash
npm install
cp .env.local.example .env.local
# fill in .env.local from mosaro/.env.local's NEXT_PUBLIC_SUPABASE_URL
# and NEXT_PUBLIC_SUPABASE_ANON_KEY -- same project, same two values
npm run dev
```

## Deploy

Not yet connected to a GitHub repo or Vercel project — that's a manual
step (no `gh`/`vercel` CLI access from the environment this was
scaffolded in). To ship it:

1. `git init && git add -A && git commit -m "initial commit"` (this
   directory is already set up as intended — check `git status` first).
2. Create a new GitHub repo and push.
3. Import it into a new Vercel project, set `NEXT_PUBLIC_SUPABASE_URL`
   and `NEXT_PUBLIC_SUPABASE_ANON_KEY` as env vars in the Vercel
   dashboard (same two values as local `.env.local`).
4. Point `umubot.com` at the new Vercel project (Vercel's dashboard →
   Domains).

## Structure

- `/` — Products, the real Pricer category/subcategory taxonomy with
  real counts
- `/category/[category]/[subcategory]` — product table for one
  subcategory
- `/product/[itemName]` — product detail: today's prices, price
  outlook, price history chart
- `/brands`, `/brands/[brand]` — real brands from Baskt's own item data

`src/lib/pricerCatalogTaxonomy.ts` and `src/lib/basktTaxonomyMapping.ts`
are kept in sync with the same two files in `mosaro` — `mosaro`'s copies
are canonical since that's where new real Baskt category/subcategory
pairs get discovered first (its sync jobs write `baskt_category`). If a
category looks wrong or empty that shouldn't be, check whether
`mosaro`'s `basktTaxonomyMapping.ts` has a newer pair this copy is
missing.
