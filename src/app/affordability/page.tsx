import Link from 'next/link'
import {
  resolveAllIngredients, planForBudget, costMeal, BUDGET_TIERS_CENTS, MEAL_FOOD_IDS,
  MEAL_DEFINITIONS, FOOD_DISPLAY_NAMES,
  type BudgetPlan, type IngredientReference,
} from '@/lib/mealAffordability'

// UmuBot -- Food Affordability. Replaces Price Index in the nav
// (operator decision, 2026-10-12): "how many meals can I make with $X
// using real local food prices" instead of "is the generic cost of
// groceries rising" -- built from an external reviewer's two-document
// proposal (Meal/Food Affordability Index) the operator pasted in, with
// its own "deterministic, code-verified, not AI-invented" requirement
// followed: every number on this page comes from src/lib/
// mealAffordability.ts's plain arithmetic over real current
// essential_products prices, nothing generated per-request.

export const revalidate = 300

const DAILY_TARGETS = { kcal: 2000, proteinG: 50, carbsG: 250, fatG: 70, fibreG: 25 }

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

type Tab = 'budgets' | 'index' | 'how-it-works'

function tabHref(tab: Tab, budgetCents: number): string {
  return `/affordability?tab=${tab}${tab === 'budgets' ? `&budget=${budgetCents}` : ''}`
}

export default async function AffordabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; budget?: string }>
}) {
  const { tab: rawTab, budget: rawBudget } = await searchParams
  const tab: Tab = rawTab === 'index' || rawTab === 'how-it-works' ? rawTab : 'budgets'
  const budgetCents = BUDGET_TIERS_CENTS.includes(Number(rawBudget)) ? Number(rawBudget) : 4000

  const ingredients = await resolveAllIngredients(MEAL_FOOD_IDS)
  const plan = planForBudget(budgetCents, ingredients)

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-800 mb-1">Budget</h2>
      <p className="text-sm text-gray-500 mb-1 max-w-2xl">
        See what you can eat for different budgets, using real current prices for the 22 essential foods.
      </p>
      <p className="text-xs text-gray-400 mb-6 max-w-2xl">
        Every number below is computed from real current prices and real meal quantities in plain arithmetic —
        never invented by AI.
      </p>

      <div className="flex gap-1 border-b border-gray-200 mb-6 text-sm">
        {(['budgets', 'index', 'how-it-works'] as Tab[]).map((t) => (
          <Link
            key={t}
            href={tabHref(t, budgetCents)}
            className={`px-4 py-2 -mb-px border-b-2 font-medium ${
              tab === t ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            {t === 'budgets' ? 'Meal Budgets' : t === 'index' ? 'Budget Index' : 'How it works'}
          </Link>
        ))}
      </div>

      {tab === 'budgets' && <MealBudgetsTab plan={plan} budgetCents={budgetCents} ingredientCount={ingredients.size} />}
      {tab === 'index' && <AffordabilityIndexTab ingredients={ingredients} />}
      {tab === 'how-it-works' && <HowItWorksTab />}
    </div>
  )
}

function MealBudgetsTab({ plan, budgetCents, ingredientCount }: { plan: BudgetPlan; budgetCents: number; ingredientCount: number }) {
  const pct = (value: number, target: number) => Math.round((value / target) * 100)
  const barColor = (p: number) => (p > 130 ? 'bg-amber-500' : 'bg-green-500')

  return (
    <div>
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <h3 className="text-base font-bold text-gray-800 mb-1">Choose your total food budget</h3>
        <p className="text-xs text-gray-400 mb-4">
          The total money you have to feed yourself — not the cost of one meal. Real whole packs must be
          bought, not fractions, so the first few days cost more per meal than later ones.
        </p>
        <div className="flex flex-wrap gap-2">
          {BUDGET_TIERS_CENTS.map((cents) => (
            <Link
              key={cents}
              href={tabHref('budgets', cents)}
              className={`px-4 py-2 rounded-full text-sm font-semibold border ${
                cents === budgetCents
                  ? 'bg-green-600 text-white border-green-600'
                  : 'bg-white text-gray-700 border-gray-300 hover:border-green-400'
              }`}
            >
              ${(cents / 100).toFixed(0)}
            </Link>
          ))}
        </div>
      </div>

      {plan.totalMeals === 0 ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6">
          <p className="text-sm text-amber-800">
            Not enough to buy a full day&apos;s worth across these {ingredientCount} real staple ingredients at
            once — real whole-pack prices mean the first grocery trip has a baseline cost. Try $40 or more,
            or see the shopping list breakdown in <Link href={tabHref('how-it-works', budgetCents)} className="underline">How it works</Link>.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard icon="🍲" label="Meals" value={`${plan.totalMeals}`} sub="approximate servings" color="blue" />
            <StatCard icon="💰" label="Estimated cost" value={fmt(plan.totalCostCents)} sub={`${fmt(plan.costPerMealCents)} per meal`} color="green" />
            <StatCard icon="🥕" label="Calories (daily avg)" value={`${Math.round(plan.nutritionPerDay.kcal)}`} sub={`${Math.round(plan.nutritionPerDay.proteinG)}g protein`} color="amber" />
            <StatCard icon="🛒" label="Items to buy" value={`${plan.shoppingList.length}`} sub="essential food products" color="purple" />
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
            <div className="flex items-baseline justify-between mb-1">
              <h3 className="text-base font-bold text-gray-800">Example meal plan</h3>
              <span className="text-xs text-gray-400">{plan.days} day{plan.days === 1 ? '' : 's'}, real current prices</span>
            </div>
            <p className="text-xs text-gray-400 mb-4">A real rotation of meals built from the 22 essential foods — repeats after day {Math.min(plan.days, 6)}.</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {plan.dayPlans[0] && (
                <>
                  <MealCard label="Breakfast" cost={plan.dayPlans[0].breakfast} />
                  <MealCard label="Lunch" cost={plan.dayPlans[0].lunch} />
                  <MealCard label="Dinner" cost={plan.dayPlans[0].dinner} />
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-base font-bold text-gray-800 mb-1">Shopping list</h3>
              <p className="text-xs text-gray-400 mb-4">Real products and quantities needed to cover all {plan.totalMeals} meals.</p>
              <div className="divide-y divide-gray-100">
                {plan.shoppingList.map((item) => (
                  <div key={item.foodId} className="flex items-center justify-between py-2 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-800 truncate">
                        {item.itemName}
                        {item.isSubstitute && <span className="ml-1.5 text-amber-600 text-xs font-medium">substitute</span>}
                      </p>
                      <p className="text-xs text-gray-400">
                        {item.packsNeeded} pack{item.packsNeeded === 1 ? '' : 's'}
                        {item.isAssumedWeight && <span className="ml-1">· assumed weight</span>}
                        {' · used in '}{item.usedInMealCount} meal{item.usedInMealCount === 1 ? '' : 's'}
                      </p>
                    </div>
                    <p className="font-bold text-gray-800 shrink-0 ml-3">{fmt(item.totalCostCents)}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-base font-bold text-gray-800 mb-1">Nutrition (daily average)</h3>
              <p className="text-xs text-gray-400 mb-4">Against standard reference targets — see How it works for the source.</p>
              <div className="space-y-3">
                <NutritionBar label="Calories" value={plan.nutritionPerDay.kcal} unit="cal" target={DAILY_TARGETS.kcal} pct={pct(plan.nutritionPerDay.kcal, DAILY_TARGETS.kcal)} color={barColor(pct(plan.nutritionPerDay.kcal, DAILY_TARGETS.kcal))} />
                <NutritionBar label="Protein" value={plan.nutritionPerDay.proteinG} unit="g" target={DAILY_TARGETS.proteinG} pct={pct(plan.nutritionPerDay.proteinG, DAILY_TARGETS.proteinG)} color={barColor(pct(plan.nutritionPerDay.proteinG, DAILY_TARGETS.proteinG))} />
                <NutritionBar label="Carbohydrates" value={plan.nutritionPerDay.carbsG} unit="g" target={DAILY_TARGETS.carbsG} pct={pct(plan.nutritionPerDay.carbsG, DAILY_TARGETS.carbsG)} color={barColor(pct(plan.nutritionPerDay.carbsG, DAILY_TARGETS.carbsG))} />
                <NutritionBar label="Fat" value={plan.nutritionPerDay.fatG} unit="g" target={DAILY_TARGETS.fatG} pct={pct(plan.nutritionPerDay.fatG, DAILY_TARGETS.fatG)} color={barColor(pct(plan.nutritionPerDay.fatG, DAILY_TARGETS.fatG))} />
                <NutritionBar label="Fibre" value={plan.nutritionPerDay.fibreG} unit="g" target={DAILY_TARGETS.fibreG} pct={pct(plan.nutritionPerDay.fibreG, DAILY_TARGETS.fibreG)} color={barColor(pct(plan.nutritionPerDay.fibreG, DAILY_TARGETS.fibreG))} />
              </div>
              <p className="text-xs text-gray-400 mt-4 bg-gray-50 rounded-lg p-3">
                Standard nutrition reference values for the raw/generic form of each food — not lab-measured for the exact product priced.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function StatCard({ icon, label, value, sub, color }: { icon: string; label: string; value: string; sub: string; color: 'blue' | 'green' | 'amber' | 'purple' }) {
  const bg = { blue: 'bg-blue-50', green: 'bg-green-50', amber: 'bg-amber-50', purple: 'bg-purple-50' }[color]
  return (
    <div className={`${bg} rounded-xl p-4`}>
      <p className="text-xl mb-1">{icon}</p>
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-800">{value}</p>
      <p className="text-xs text-gray-400">{sub}</p>
    </div>
  )
}

function MealCard({ label, cost }: { label: string; cost: { meal: { name: string; ingredients: { foodId: string }[] }; costCents: number } }) {
  const ingredientNames = cost.meal.ingredients.map((i) => FOOD_DISPLAY_NAMES[i.foodId] ?? i.foodId).join(', ')
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
      <p className="font-bold text-gray-800 mt-1">{cost.meal.name}</p>
      <p className="text-xs text-gray-500 mt-0.5">{ingredientNames}</p>
      <p className="text-sm font-bold text-green-700 mt-2">{fmt(cost.costCents)} / serving</p>
    </div>
  )
}

function NutritionBar({ label, value, unit, target, pct, color }: { label: string; value: number; unit: string; target: number; pct: number; color: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between text-sm mb-1">
        <span className="text-gray-600">{label}</span>
        <span className="font-medium text-gray-800">
          {Math.round(value)}{unit} / {target}{unit} <span className="text-gray-400">({pct}%)</span>
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
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
          <strong className="text-gray-800">How many days fit a budget.</strong> Starting from day 1, the real
          day-by-day meal rotation grows one day at a time, recomputing the real total shopping cost needed so
          far, and stops at the largest number of days whose real cost still fits the chosen budget.
        </p>
        <p>
          <strong className="text-gray-800">Nutrition.</strong> Calories, protein, carbohydrate, fat and fibre
          use standard reference values for the raw/generic form of each food (comparable to USDA/NZ food
          composition data) — not a lab measurement of the specific product priced. Daily targets shown
          (2,000 cal, 50g protein, 250g carbs, 70g fat, 25g fibre) are standard adult reference figures, not a
          personalised recommendation.
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
