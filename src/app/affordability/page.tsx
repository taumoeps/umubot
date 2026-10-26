import Link from 'next/link'
import {
  resolveAllIngredients, costMeal, MEAL_FOOD_IDS,
  MEAL_DEFINITIONS, type IngredientReference,
} from '@/lib/mealAffordability'
import MealPlanner from '@/components/MealPlanner'
import { fetchBudgetBasket, fetchFeatureFlags, type BudgetBasket } from '@/lib/essentialsClient'

// UmuBot -- Food Affordability. Replaces Price Index in the nav
// (operator decision, 2026-10-12): "how many meals can I make with $X
// using real local food prices" instead of "is the generic cost of
// groceries rising" -- built from an external reviewer's two-document
// proposal (Meal/Food Affordability Index) the operator pasted in, with
// its own "deterministic, code-verified, not AI-invented" requirement
// followed: every number on this page comes from src/lib/
// mealAffordability.ts's plain arithmetic over real current
// essential_products prices, nothing generated per-request.
//
// Meal Budgets tab replaced 2026-10-13 (operator spec) with a real
// constraint-driven planner -- budget, meal count, meal types, optional
// per-meal cost/nutrition targets, auto-recalculated client-side on
// every change (see MealPlanner.tsx). This page's own job is now just
// resolving real ingredient prices ONCE server-side and handing them
// down serialised -- the old fixed 6-day-rotation planForBudget/
// BudgetPlan/DAY_PLANS are gone from mealAffordability.ts, not left as
// dead code alongside the new engine.

export const revalidate = 300

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

type Tab = 'budgets' | 'basket' | 'index' | 'how-it-works'

function tabHref(tab: Tab): string {
  return `/affordability?tab=${tab}`
}

export default async function AffordabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; budget?: string; adults?: string; children?: string }>
}) {
  const sp = await searchParams
  const rawTab = sp.tab
  // Year 2 feature 2.5: the Basket tab exists only while the budget-basket switch is on.
  const flags = await fetchFeatureFlags({ next: { revalidate } })
  const basketOn = flags['budget-basket'] === true
  const tab: Tab = rawTab === 'index' || rawTab === 'how-it-works' || (rawTab === 'basket' && basketOn) ? rawTab : 'budgets'
  const tabs: Tab[] = basketOn ? ['budgets', 'basket', 'index', 'how-it-works'] : ['budgets', 'index', 'how-it-works']

  // Only the tabs that use them load meal ingredient prices.
  const ingredients = tab === 'budgets' || tab === 'index' ? await resolveAllIngredients(MEAL_FOOD_IDS) : null

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-1">Budget</h2>
      <p className="text-sm text-gray-500 mb-1 max-w-2xl">
        Set your budget, number of meals, meal types, and optional nutrition targets. Leave nutrition blank and
        UmuBot will automatically calculate the best meals using current essential food prices.
      </p>
      <p className="text-xs text-gray-400 mb-6 max-w-2xl">
        Every number below is computed from real current prices and real meal quantities in plain arithmetic —
        never invented by AI.
      </p>

      <div className="flex gap-1 border-b border-gray-200 mb-6 text-sm">
        {tabs.map((t) => (
          <Link
            key={t}
            href={tabHref(t)}
            className={`px-4 py-2 -mb-px border-b-2 font-medium ${
              tab === t ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t === 'budgets' ? 'Meal Budgets' : t === 'basket' ? 'Basket' : t === 'index' ? 'Budget Index' : 'How it works'}
          </Link>
        ))}
      </div>

      {tab === 'basket' && <BasketTab budget={sp.budget} adults={sp.adults} childrenCount={sp.children} />}
      {tab === 'budgets' && ingredients && <MealPlanner ingredientEntries={Array.from(ingredients.entries())} />}
      {tab === 'index' && ingredients && <AffordabilityIndexTab ingredients={ingredients} />}
      {tab === 'how-it-works' && <HowItWorksTab />}
    </div>
  )
}

async function AffordabilityIndexTab({ ingredients }: { ingredients: Map<string, IngredientReference> }) {
  const mealCosts = MEAL_DEFINITIONS.map((m) => costMeal(m, ingredients)).filter((c): c is NonNullable<typeof c> => c !== null)
  const avgCostCents = mealCosts.reduce((s, m) => s + m.costCents, 0) / mealCosts.length
  const cheapest = [...mealCosts].sort((a, b) => a.costCents - b.costCents)[0]
  const mostExpensive = [...mealCosts].sort((a, b) => b.costCents - a.costCents)[0]

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-base font-bold text-gray-800 mb-1">Budget Index</h3>
      <p className="text-xs text-gray-400 mb-6 max-w-xl">
        Tracks the real cost of a standard essential-food meal over time and across locations. This is Day 1 —
        an index needs comparable history to show a trend, so today this page shows the current baseline value,
        not yet a change over time.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-green-50 rounded-xl p-4">
          <p className="text-xs text-gray-500">Average cost per meal</p>
          <p className="text-2xl font-bold text-gray-800">{fmt(avgCostCents)}</p>
          <p className="text-xs text-gray-400">across {mealCosts.length} real reference meals, today</p>
        </div>
        <div className="bg-blue-50 rounded-xl p-4">
          <p className="text-xs text-gray-500">Cheapest real meal</p>
          <p className="text-lg font-bold text-gray-800">{cheapest.meal.name}</p>
          <p className="text-sm font-semibold text-green-700">{fmt(cheapest.costCents)} / serving</p>
        </div>
        <div className="bg-amber-50 rounded-xl p-4">
          <p className="text-xs text-gray-500">Most expensive real meal</p>
          <p className="text-lg font-bold text-gray-800">{mostExpensive.meal.name}</p>
          <p className="text-sm font-semibold text-gray-800">{fmt(mostExpensive.costCents)} / serving</p>
        </div>
      </div>
      <div className="divide-y divide-gray-100">
        {mealCosts.map((m) => (
          <div key={m.meal.id} className="flex items-center justify-between py-2 text-sm">
            <span className="text-gray-700">{m.meal.name}</span>
            <span className="font-medium text-gray-800">{fmt(m.costCents)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function HowItWorksTab() {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5 max-w-2xl">
      <h3 className="text-base font-bold text-gray-800 mb-4">How this is calculated</h3>
      <div className="space-y-4 text-sm text-gray-600">
        <p>
          <strong className="text-gray-800">Real prices.</strong> Each ingredient&apos;s price comes from the same
          real, currently-flagged essential products as the Essential page — not the cheapest flagged variant
          (which is sometimes a processed product like Kumara Fries or a flavoured kebab), but the cheapest{' '}
          <em>plain</em> variant, so a meal&apos;s cost reflects a real staple, not a derivative product. When no
          plain option exists, the product used is marked &quot;substitute&quot; on the shopping list.
        </p>
        <p>
          <strong className="text-gray-800">Whole packs, not fractions.</strong> Real supermarkets sell in real
          pack sizes. The shopping list totals the real number of whole packs (or, for loose per-kg items, the
          real fractional kg) needed to cover every meal in the plan — the same pack bought once covers every
          day that needs it, it isn&apos;t re-bought per day.
        </p>
        <p>
          <strong className="text-gray-800">Choosing which meals fit your settings.</strong> UmuBot first checks
          whether the cheapest possible combination of your chosen meal count and meal types even fits your
          budget — if not, it says so plainly rather than showing a plan that doesn&apos;t actually fit. If it
          fits, it then picks meals that best match any nutrition targets you set (or favour variety when none
          are set), and only falls back toward cheaper substitutions if that combination turns out to cost more
          than your budget.
        </p>
        <p>
          <strong className="text-gray-800">Nutrition.</strong> Calories, protein, carbohydrate, fat and fibre
          use standard reference values for the raw/generic form of each food (comparable to USDA/NZ food
          composition data) — not a lab measurement of the specific product priced. Any target you set is a real
          constraint the planner optimises toward, not a guarantee — the shown nutrition summary always reflects
          what the selected meals actually add up to, so you can see the real gap if one exists.
        </p>
        <p>
          <strong className="text-gray-800">A few assumed weights.</strong> A small number of real products
          (a bread roll, a broccoli head, an egg, a banana) are sold by count, not weight, in Baskt&apos;s own
          data — those use a reasonable assumed typical weight, flagged &quot;assumed weight&quot; on the
          shopping list rather than presented as measured.
        </p>
        <p>
          <strong className="text-gray-800">Nothing here is AI-generated per request.</strong> The meals,
          quantities and nutrition reference are hand-authored once; every number shown is plain arithmetic
          over real current prices, computed the same way every time.
        </p>
      </div>
    </div>
  )
}

const clampInt = (raw: string | undefined, fallback: number, min: number, max: number) => {
  const n = Math.round(Number(raw))
  return Number.isFinite(n) && raw != null && raw !== '' ? Math.min(max, Math.max(min, n)) : fallback
}

async function BasketTab({ budget, adults, childrenCount }: { budget?: string; adults?: string; childrenCount?: string }) {
  const q = { budgetDollars: clampInt(budget, 120, 10, 2000), adults: clampInt(adults, 2, 1, 10), children: clampInt(childrenCount, 0, 0, 10) }
  const basket: BudgetBasket | null = await fetchBudgetBasket(q, { next: { revalidate } }).catch(() => null)
  const field = 'mt-1 w-24 rounded-lg border border-gray-300 px-3 py-2 text-sm'
  return (
    <div className="space-y-6" data-testid="budget-basket">
      <form method="get" action="/affordability" className="bg-white rounded-xl border border-gray-200 p-5 flex flex-wrap items-end gap-4">
        <input type="hidden" name="tab" value="basket" />
        <label className="text-xs font-semibold text-gray-600">Weekly budget ($)
          <input name="budget" type="number" min={10} max={2000} defaultValue={q.budgetDollars} className={`${field} block`} />
        </label>
        <label className="text-xs font-semibold text-gray-600">Adults
          <input name="adults" type="number" min={1} max={10} defaultValue={q.adults} className={`${field} block`} />
        </label>
        <label className="text-xs font-semibold text-gray-600">Children
          <input name="children" type="number" min={0} max={10} defaultValue={q.children} className={`${field} block`} />
        </label>
        <button type="submit" className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700">Show basket</button>
      </form>

      {!basket && <p className="text-sm text-gray-500">Couldn&apos;t build the basket right now. Try again shortly.</p>}

      {basket && (
        <>
          <div className="bg-white rounded-xl border border-gray-200 p-5">
            <p className="text-xs text-gray-500">What {fmt(basket.budgetCents)} a week buys for {basket.adults} adult{basket.adults === 1 ? '' : 's'}{basket.children ? ` and ${basket.children} child${basket.children === 1 ? '' : 'ren'}` : ''}</p>
            <p className="text-2xl font-bold text-gray-800 mt-1">{fmt(basket.totalCents)} <span className="text-sm font-normal text-gray-500">this week</span></p>
            <p className={`text-sm mt-1 ${basket.fits ? 'text-green-700' : 'text-amber-700'}`}>
              {basket.fits
                ? `The full basket fits, with ${fmt(basket.budgetCents - basket.totalCents)} to spare.`
                : `The full basket costs ${fmt(basket.fullBasketCents)}; some foods don't fit (below).`}
            </p>
            <p className="text-xs text-gray-400 mt-2">Cheapest real prices at New World and PAK&apos;nSAVE stores anywhere in New Zealand, so a guide to what the money buys rather than one shop; the RecipeBot app uses your nearby stores. Fresh food is whole packs you can finish before it spoils; long-life food counts this week&apos;s share. Cupboard basics (oil, salt, herbs) aren&apos;t included.</p>
          </div>

          {basket.groups.map((g) => (
            <div key={g.key} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex items-baseline justify-between px-5 py-3 border-b border-gray-100">
                <h3 className="text-sm font-semibold text-gray-800">{g.label}</h3>
                <p className={`text-xs ${g.portionsCovered >= g.portionsNeeded ? 'text-gray-500' : 'text-amber-700'}`}>{g.portionsCovered} of {g.portionsNeeded} portions</p>
              </div>
              {g.lines.length === 0 && <p className="px-5 py-3 text-sm text-gray-400">Nothing from this group fits the budget.</p>}
              <div className="divide-y divide-gray-50">
                {g.lines.map((l) => (
                  <div key={l.foodId} className="flex items-start justify-between px-5 py-2.5">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-800">{l.displayName}</p>
                      <p className="text-xs text-gray-500">
                        {l.productName}{l.packs > 1 ? ` × ${l.packs}` : ''}{l.storeName ? ` · ${l.storeName}` : ''} · {l.portions} portions{l.servingLabel ? ` of ${l.servingLabel}` : ''}{l.lastsWeeks ? ` · one pack lasts ~${l.lastsWeeks} weeks` : ''}
                      </p>
                    </div>
                    <p className="text-sm font-semibold text-gray-800 shrink-0 ml-4">{fmt(l.costCents)}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {basket.fallsOff.length > 0 && (
            <div className="bg-amber-50 rounded-xl border border-amber-200 p-5">
              <h3 className="text-sm font-semibold text-amber-900">Doesn&apos;t fit the budget</h3>
              <ul className="mt-2 space-y-1 text-sm text-amber-900">
                {basket.fallsOff.map((f) => <li key={f.foodId}>{f.displayName} ({f.group}) — {fmt(f.costCents)}</li>)}
              </ul>
            </div>
          )}
          {basket.note && <p className="text-xs text-gray-400">{basket.note}</p>}
        </>
      )}
    </div>
  )
}
