'use client'

import { useMemo, useState } from 'react'
import {
  generateMealPlan, BUDGET_TIERS_CENTS, FOOD_DISPLAY_NAMES,
  type IngredientReference, type MealType, type GeneratedMeal,
} from '@/lib/mealAffordability'

// UmuBot -- the real constraint-driven meal planner (operator request,
// 2026-10-13, replacing the old fixed 6-day-rotation Meal Budgets tab).
// Runs entirely client-side: the server resolves real ingredient prices
// ONCE (see affordability/page.tsx) and hands them down serialised as
// props; every setting change below re-runs generateMealPlan (a pure,
// synchronous function over that same data) instantly, with no server
// round trip -- this is what makes "recipes and shopping list update
// automatically when you change any setting" actually instant rather
// than a page reload.

const MEAL_TYPE_LABELS: Record<MealType, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' }
const ALL_MEAL_TYPES: MealType[] = ['breakfast', 'lunch', 'dinner']

function fmt(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

/** Parses an optional numeric text input -- empty/invalid means "no
 *  target set" (undefined), never 0 or NaN silently treated as a real
 *  constraint. */
function parseOptionalNumber(raw: string): number | undefined {
  const trimmed = raw.trim()
  if (trimmed === '') return undefined
  const n = Number(trimmed)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export default function MealPlanner({ ingredientEntries }: { ingredientEntries: [string, IngredientReference][] }) {
  const ingredients = useMemo(() => new Map(ingredientEntries), [ingredientEntries])

  const [budgetCents, setBudgetCents] = useState(4000)
  const [mealCount, setMealCount] = useState(5)
  const [mealTypes, setMealTypes] = useState<MealType[]>(['breakfast', 'lunch', 'dinner'])
  const [maxCostPerMeal, setMaxCostPerMeal] = useState('')
  const [targetCalories, setTargetCalories] = useState('')
  const [targetProtein, setTargetProtein] = useState('')
  const [targetCarbs, setTargetCarbs] = useState('')
  const [targetFat, setTargetFat] = useState('')

  const result = useMemo(() => {
    const maxCostPerMealCents = parseOptionalNumber(maxCostPerMeal)
    const caloriesPerMeal = parseOptionalNumber(targetCalories)
    const proteinPerMeal = parseOptionalNumber(targetProtein)
    const carbsPerMeal = parseOptionalNumber(targetCarbs)
    const fatPerMeal = parseOptionalNumber(targetFat)
    const hasTargets = caloriesPerMeal != null || proteinPerMeal != null || carbsPerMeal != null || fatPerMeal != null
    return generateMealPlan(
      {
        budgetCents, mealCount, mealTypes,
        maxCostPerMealCents: maxCostPerMealCents != null ? Math.round(maxCostPerMealCents * 100) : undefined,
        targets: hasTargets ? { caloriesPerMeal, proteinPerMeal, carbsPerMeal, fatPerMeal } : undefined,
      },
      ingredients
    )
  }, [budgetCents, mealCount, mealTypes, maxCostPerMeal, targetCalories, targetProtein, targetCarbs, targetFat, ingredients])

  function toggleMealType(type: MealType) {
    setMealTypes((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]))
  }

  return (
    <div>
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
          <h3 className="text-base font-bold text-gray-800">Meal planner settings</h3>
          <p className="text-xs text-green-700 bg-green-50 rounded-full px-3 py-1">
            Recipes and shopping list update automatically when you change any of the settings.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1">Total food budget</p>
            <p className="text-xs text-gray-400 mb-2">Choose how much you want to spend.</p>
            <div className="flex flex-wrap gap-2">
              {BUDGET_TIERS_CENTS.map((cents) => (
                <button
                  key={cents}
                  onClick={() => setBudgetCents(cents)}
                  className={`px-3 py-1.5 rounded-full text-sm font-semibold border ${
                    cents === budgetCents ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-300 hover:border-green-400'
                  }`}
                >
                  ${(cents / 100).toFixed(0)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1">Number of meals</p>
            <p className="text-xs text-gray-400 mb-2">Total meals to generate.</p>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setMealCount((n) => Math.max(1, n - 1))}
                className="w-9 h-9 rounded-lg border border-gray-300 text-gray-600 font-bold hover:bg-gray-50"
                aria-label="Decrease number of meals"
              >
                −
              </button>
              <span className="w-10 text-center text-lg font-bold text-gray-800">{mealCount}</span>
              <button
                onClick={() => setMealCount((n) => Math.min(21, n + 1))}
                className="w-9 h-9 rounded-lg border border-gray-300 text-gray-600 font-bold hover:bg-gray-50"
                aria-label="Increase number of meals"
              >
                +
              </button>
            </div>
          </div>

          <div>
            <p className="text-sm font-semibold text-gray-700 mb-1">Meal types</p>
            <p className="text-xs text-gray-400 mb-2">Select which meal types to include.</p>
            <div className="flex flex-wrap gap-2">
              {ALL_MEAL_TYPES.map((type) => (
                <button
                  key={type}
                  onClick={() => toggleMealType(type)}
                  className={`px-3 py-1.5 rounded-full text-sm font-semibold border flex items-center gap-1.5 ${
                    mealTypes.includes(type) ? 'bg-green-600 text-white border-green-600' : 'bg-white text-gray-700 border-gray-300 hover:border-green-400'
                  }`}
                >
                  {mealTypes.includes(type) && <span>✓</span>}
                  {MEAL_TYPE_LABELS[type]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="border-t border-gray-100 pt-4">
          <p className="text-sm font-semibold text-gray-700 mb-1">Optional nutrition targets (per meal)</p>
          <p className="text-xs text-gray-400 mb-3">Set maximums or targets for each meal. Leave blank to let UmuBot optimise automatically.</p>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <LabelledInput label="Max cost per meal" prefix="$" placeholder="e.g. 8.00" value={maxCostPerMeal} onChange={setMaxCostPerMeal} />
            <LabelledInput label="Calories" placeholder="e.g. 600" value={targetCalories} onChange={setTargetCalories} />
            <LabelledInput label="Protein (g)" placeholder="e.g. 30" value={targetProtein} onChange={setTargetProtein} />
            <LabelledInput label="Carbs (g)" placeholder="e.g. 50" value={targetCarbs} onChange={setTargetCarbs} />
            <LabelledInput label="Fat (g)" placeholder="e.g. 20" value={targetFat} onChange={setTargetFat} />
          </div>
        </div>
      </div>

      {!result.feasible ? (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 mb-6">
          <p className="text-sm font-semibold text-amber-800 mb-1">Can&apos;t generate this plan</p>
          <p className="text-sm text-amber-800">{result.infeasibleReason}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <StatCard icon="🍲" label="Meals generated" value={`${result.meals.length}`} sub="across selected meal types" color="blue" />
            <StatCard icon="💰" label="Estimated total cost" value={fmt(result.totalCostCents)} sub={`${fmt(result.averageCostPerMealCents)} per meal`} color="green" />
            <StatCard icon="🏷️" label="Average cost per meal" value={fmt(result.averageCostPerMealCents)} sub={`within ${fmt(budgetCents)} budget`} color="amber" />
            <StatCard
              icon="📊"
              label="Nutrition average per meal"
              value={`${Math.round(result.nutritionAveragePerMeal.kcal)} cal`}
              sub={`${Math.round(result.nutritionAveragePerMeal.proteinG)}g protein · ${Math.round(result.nutritionAveragePerMeal.carbsG)}g carbs · ${Math.round(result.nutritionAveragePerMeal.fatG)}g fat`}
              color="purple"
            />
          </div>

          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
            <h3 className="text-base font-bold text-gray-800 mb-1">Auto-generated meals</h3>
            <p className="text-xs text-gray-400 mb-4">These recipes update automatically based on your budget, meal types and nutrition targets.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {result.meals.map((m, idx) => (
                <GeneratedMealCard key={`${m.meal.id}-${idx}`} generated={m} />
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-gray-200 p-5">
              <h3 className="text-base font-bold text-gray-800 mb-1">Shopping list for this meal plan</h3>
              <p className="text-xs text-gray-400 mb-4">Essential food products and estimated costs, current prices.</p>
              <div className="divide-y divide-gray-100">
                {result.shoppingList.map((item) => (
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
              <h3 className="text-base font-bold text-gray-800 mb-1">Nutrition summary</h3>
              <p className="text-xs text-gray-400 mb-4">Average per meal, based on your {result.meals.length} generated meals.</p>
              <div className="space-y-3">
                <TargetBar label="Calories" unit="cal" value={result.nutritionAveragePerMeal.kcal} target={parseOptionalNumber(targetCalories)} />
                <TargetBar label="Protein" unit="g" value={result.nutritionAveragePerMeal.proteinG} target={parseOptionalNumber(targetProtein)} />
                <TargetBar label="Carbohydrates" unit="g" value={result.nutritionAveragePerMeal.carbsG} target={parseOptionalNumber(targetCarbs)} />
                <TargetBar label="Fat" unit="g" value={result.nutritionAveragePerMeal.fatG} target={parseOptionalNumber(targetFat)} />
              </div>
              <p className="text-xs text-gray-400 mt-4 bg-gray-50 rounded-lg p-3">
                Estimated from standard reference nutrition values and real current essential food prices — not
                lab-measured for the exact products priced. A target shown without a bar means none was set for
                that nutrient, so it was optimised for balance and variety instead.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function LabelledInput({ label, prefix, placeholder, value, onChange }: { label: string; prefix?: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <div className="relative">
        {prefix && <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-sm">{prefix}</span>}
        <input
          type="number"
          min="0"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full border border-gray-300 rounded-lg py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent ${prefix ? 'pl-6 pr-2' : 'px-2'}`}
        />
      </div>
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

function GeneratedMealCard({ generated }: { generated: GeneratedMeal }) {
  const { meal, cost } = generated
  const ingredientNames = meal.ingredients.map((i) => FOOD_DISPLAY_NAMES[i.foodId] ?? i.foodId).join(', ')
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{MEAL_TYPE_LABELS[meal.mealType]}</p>
      <p className="font-bold text-gray-800 mt-1">{meal.name}</p>
      <p className="text-xs text-gray-500 mt-0.5">{ingredientNames}</p>
      <p className="text-sm font-bold text-green-700 mt-2">{fmt(cost.costCents)} per meal</p>
      <p className="text-xs text-gray-400 mt-1">
        {Math.round(cost.nutrition.kcal)} cal · {Math.round(cost.nutrition.proteinG)}g protein · {Math.round(cost.nutrition.carbsG)}g carbs · {Math.round(cost.nutrition.fatG)}g fat
      </p>
    </div>
  )
}

function TargetBar({ label, unit, value, target }: { label: string; unit: string; value: number; target: number | undefined }) {
  if (target == null) {
    return (
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-gray-600">{label}</span>
        <span className="font-medium text-gray-800">{Math.round(value)}{unit} <span className="text-gray-400">(no target set)</span></span>
      </div>
    )
  }
  const pct = Math.round((value / target) * 100)
  const color = pct > 130 ? 'bg-amber-500' : 'bg-green-500'
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
