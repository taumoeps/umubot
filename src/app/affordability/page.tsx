import Link from 'next/link'
import {
  resolveAllIngredients, costMeal, MEAL_FOOD_IDS,
  MEAL_DEFINITIONS, type IngredientReference,
} from '@/lib/mealAffordability'
import MealPlanner from '@/components/MealPlanner'

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

type Tab = 'budgets' | 'index' | 'how-it-works'

function tabHref(tab: Tab): string {
  return `/affordability?tab=${tab}`
}

export default async function AffordabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab: rawTab } = await searchParams
  const tab: Tab = rawTab === 'index' || rawTab === 'how-it-works' ? rawTab : 'budgets'

  const ingredients = await resolveAllIngredients(MEAL_FOOD_IDS)

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
        {(['budgets', 'index', 'how-it-works'] as Tab[]).map((t) => (
          <Link
            key={t}
            href={tabHref(t)}
            className={`px-4 py-2 -mb-px border-b-2 font-medium ${
              tab === t ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t === 'budgets' ? 'Meal Budgets' : t === 'index' ? 'Budget Index' : 'How it works'}
          </Link>
        ))}
      </div>

      {tab === 'budgets' && <MealPlanner ingredientEntries={Array.from(ingredients.entries())} />}
      {tab === 'index' && <AffordabilityIndexTab ingredients={ingredients} />}
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
