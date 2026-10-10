# UmuBot

Real New Zealand essential-food price tracking. Public, no login, split
out from the `mosaro` repo's internal admin portal on 2026-10-11 so this
could be a real standalone product instead of living behind an operator
login.

Deliberately different from [pricer.nz](https://pricer.nz), not a copy
of it (operator decision, 2026-10-11): Pricer tracks ~60,000 products
across every supermarket category. This tracks a narrow, honest set of
real essential foods (~50), and every price is tagged **Live** (a real
scanned price) or **Estimated** — a distinction Pricer's UI doesn't
surface at all. "Essential Foods" is the whole homepage, not a sub-page
of a general catalogue.

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

- `/` — Essential Foods, grouped by essential_foods' own 3 real
  categories (Meat/Poultry/Fish, Dairy/Eggs/Staples, Fruit & Veg), real
  tracked-item counts
- `/food/[foodId]` — every real product matched to one essential food
  (an essential food like "Milk" can have several real distinct
  branded products), each tagged Live/Estimated
- `/product/[itemName]` — one specific product: today's prices, price
  outlook, price history chart, also tagged Live/Estimated
- `/price-index` — the real chained Essential Food Price Index

No Brands page, no Pricer-style category/subcategory taxonomy --
removed 2026-10-11. `price_observations.food_id` is a direct foreign
key to `essential_foods`, so browsing doesn't need a category-name-
guessing table the way the earlier Pricer-structured version did.
