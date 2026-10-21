import { getAllVariantsGroupedByFood, looksPlain, type EssentialProduct } from './essentialFoodsView'
import { resolveWeight, type ResolvedWeight } from './packWeight'

// UmuBot -- Food Affordability / Meal Budgets engine. Operator request,
// 2026-10-12, replacing Price Index in the nav: "how many meals can I
// make with $X, using the real 22 essential foods" rather than "is the
// generic cost of groceries rising." Built from an external reviewer's
// proposal (pasted to the operator as two documents), with one of its
// own warnings taken seriously (their section 5): Essential's "cheapest
// flagged representative" per food is sometimes a processed/derivative
// product (Kumara Fries, Beef Steak Sausages, a flavoured chicken
// kebab) because of how the live matching happens to land -- using
// those AS-IS for a meal-costing engine would distort the result. This
// module picks its OWN representative per food (pickIngredientProduct
// below), preferring a plain, weight-parseable product over whatever
// Essential's homepage shows as cheapest, and explicitly marks it as a
// substitute when no plain option is available among the real flagged
// candidates.
//
// looksPlain/PROCESSED_KEYWORDS now live in essentialFoodsView.ts, not
// here -- operator request, 2026-10-12: Essential's own homepage had
// the exact same "Beef Steak Sausages representing Beef steak" bug
// this module already solved, because its own representative pick had
// no plain-ness preference at all. Sharing one copy means Essential and
// Budget can never pick different representatives for the same food.
//
// Deterministic by design (the reviewer's own stated requirement):
// every number here is computed from real current essential_products
// prices + a hand-authored meal/nutrition reference, in plain
// arithmetic -- no AI call, nothing non-reproducible. What's NOT
// measured-per-product, honestly: the NUTRITION_PER_100G table is
// standard reference values (USDA FoodData Central / NZ FOODfiles
// ballpark figures for the raw/generic form of each food), not lab
// results for the specific real product priced; and a handful of
// count-sold items (a bread roll, a broccoli head, an egg, a banana)
// have no real weight in Baskt's own pack_size field, so a labelled,
// reasonable assumed unit weight fills that gap (ASSUMED_UNIT_GRAMS).
// Both are flagged in the returned data (nutritionIsStandardReference
// always true; a resolved ingredient's weight.isAssumedWeight flags
// the latter), never silently presented as measured.

export interface NutritionPer100g {
  kcal: number
  proteinG: number
  carbsG: number
  fatG: number
  fibreG: number
}

/** Standard per-100g reference values for the raw/generic form of each
 *  essential food -- not a measurement of the specific priced product,
 *  see module doc. */
export const NUTRITION_PER_100G: Record<string, NutritionPer100g> = {
  apples: { kcal: 52, proteinG: 0.3, carbsG: 14, fatG: 0.2, fibreG: 2.4 },
  bananas: { kcal: 89, proteinG: 1.1, carbsG: 23, fatG: 0.3, fibreG: 2.6 },
  'beef-mince': { kcal: 250, proteinG: 26, carbsG: 0, fatG: 17, fibreG: 0 },
  steak: { kcal: 190, proteinG: 27, carbsG: 0, fatG: 8, fibreG: 0 },
  bread: { kcal: 265, proteinG: 9, carbsG: 49, fatG: 3.2, fibreG: 2.7 },
  broccoli: { kcal: 34, proteinG: 2.8, carbsG: 7, fatG: 0.4, fibreG: 2.6 },
  cheese: { kcal: 403, proteinG: 25, carbsG: 1.3, fatG: 33, fibreG: 0 },
  chicken: { kcal: 165, proteinG: 31, carbsG: 0, fatG: 3.6, fibreG: 0 },
  'cooking-oil': { kcal: 884, proteinG: 0, carbsG: 0, fatG: 100, fibreG: 0 },
  eggs: { kcal: 155, proteinG: 13, carbsG: 1.1, fatG: 11, fibreG: 0 },
  flour: { kcal: 364, proteinG: 10, carbsG: 76, fatG: 1, fibreG: 2.7 },
  fish: { kcal: 100, proteinG: 21, carbsG: 0, fatG: 1.3, fibreG: 0 },
  kumara: { kcal: 86, proteinG: 1.6, carbsG: 20, fatG: 0.1, fibreG: 3 },
  lamb: { kcal: 206, proteinG: 25, carbsG: 0, fatG: 11, fibreG: 0 },
  milk: { kcal: 46, proteinG: 3.4, carbsG: 5, fatG: 1, fibreG: 0 },
  pasta: { kcal: 371, proteinG: 13, carbsG: 75, fatG: 1.5, fibreG: 3 },
  pork: { kcal: 143, proteinG: 21, carbsG: 0, fatG: 6, fibreG: 0 },
  potatoes: { kcal: 77, proteinG: 2, carbsG: 17, fatG: 0.1, fibreG: 2.2 },
  rice: { kcal: 365, proteinG: 7, carbsG: 80, fatG: 0.7, fibreG: 1.3 },
  salt: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fibreG: 0 },
  sugar: { kcal: 387, proteinG: 0, carbsG: 100, fatG: 0, fibreG: 0 },
  tomatoes: { kcal: 18, proteinG: 0.9, carbsG: 3.9, fatG: 0.2, fibreG: 1.2 },
}

// ASSUMED_UNIT_GRAMS, ResolvedWeight, parseRealPackSize, resolveWeight now live in
// packWeight.ts (shared with essentialFoodsView.ts's unit-price display, 2026-10-18) -- see
// that module's own doc for why this moved rather than being duplicated.

export interface IngredientReference {
  foodId: string
  product: EssentialProduct
  weight: ResolvedWeight
  /** True when no plain, weight-resolvable flagged variant existed for
   *  this food, so a processed/derivative product had to stand in --
   *  the reviewer's own "mark substitutes explicitly" requirement. */
  isSubstitute: boolean
  /** True when the weight itself rests on an assumed per-unit gram
   *  figure (module doc), not a real Baskt pack_size. */
  isAssumedWeight: boolean
}

/** Picks the best real flagged variant of one essential food to use as
 *  the MEAL ENGINE's ingredient reference -- NOT the same selection as
 *  Essential's homepage "cheapest" pick, deliberately. Tier comes
 *  FIRST, same as the homepage (real bug caught live, 2026-10-12,
 *  immediately after this function started picking plain-named but
 *  agent_web_search-estimated items -- "Chicken breast $4.60" with
 *  chain=null -- over the real "Skinless Chicken Breast (kg)" live
 *  price, purely because the fake estimate was cheaper): only fall
 *  back to an estimated item when NOTHING live resolves at all. Within
 *  a tier, preference order is (1) a plain-named product with a real,
 *  parseable weight, cheapest among those; (2) a plain-named product
 *  needing an assumed unit weight; (3) any weight-resolvable product at
 *  all (marked isSubstitute). Returns null only if NOTHING for this
 *  food has any resolvable weight in either tier. Takes the food's
 *  variants pre-fetched (see resolveAllIngredients) -- calling
 *  getAllVariantsForFood per food here was a real perf bug, caught
 *  live: each call independently re-ran the full flagged-products
 *  query, so resolving ~20 ingredients meant the same expensive query
 *  running 20 times over on every click on the Food Affordability page. */
function pickIngredientProduct(foodId: string, variants: EssentialProduct[]): IngredientReference | null {
  const withWeight = variants
    .map((v) => ({ v, w: resolveWeight(v.packSize, foodId) }))
    .filter((x): x is { v: EssentialProduct; w: ResolvedWeight } => x.w !== null)

  // Best available tier first (live, then recent), else whatever is current.
  const tierPool =
    (['live', 'recent'] as const).map((t) => withWeight.filter((x) => x.v.tier === t)).find((p) => p.length > 0) ?? withWeight
  if (tierPool.length === 0) return null

  const plainReal = tierPool.filter((x) => !x.w.isAssumedWeight && looksPlain(x.v.itemName))
  const plainAny = tierPool.filter((x) => looksPlain(x.v.itemName))
  const pool = plainReal.length > 0 ? plainReal : plainAny.length > 0 ? plainAny : tierPool
  if (pool.length === 0) return null

  const best = pool.sort((a, b) => a.v.lowestPriceCents - b.v.lowestPriceCents)[0]
  return {
    foodId,
    product: best.v,
    weight: best.w,
    isSubstitute: pool !== plainReal && pool !== plainAny,
    isAssumedWeight: best.w.isAssumedWeight,
  }
}

/** Resolves an ingredient reference for every real essential food that
 *  has at least one usable flagged variant. Cheap to call from every
 *  budget tier/tab: getAllVariantsGroupedByFood's own underlying fetch
 *  (essentialFoodsView.ts's getAllFlaggedProducts) is cached via
 *  unstable_cache at its source now (real perf fix, 2026-10-12, moved
 *  there from a cache wrapper that used to live in this file --
 *  caching down at the one function every caller, including this one,
 *  the homepage, and product detail pages' "other variants", goes
 *  through fixes all three at once instead of just this one). The
 *  per-ingredient selection logic below (pickIngredientProduct) is
 *  plain in-memory work on already-fetched data, cheap enough not to
 *  need its own cache layer on top. */
export async function resolveAllIngredients(foodIds: string[]): Promise<Map<string, IngredientReference>> {
  const variantsByFood = await getAllVariantsGroupedByFood()
  const map = new Map<string, IngredientReference>()
  for (const foodId of foodIds) {
    const ref = pickIngredientProduct(foodId, variantsByFood.get(foodId) ?? [])
    if (ref) map.set(foodId, ref)
  }
  return map
}

/** Real per-gram cost (cents) of an ingredient, from its real resolved
 *  pack price / pack weight. undefined when the food's representative
 *  couldn't be resolved at all (no flagged product with any usable
 *  weight). */
export function centsPerGram(ref: IngredientReference): number {
  return ref.product.lowestPriceCents / ref.weight.totalGrams
}

/** Short display labels for the 22 real essential foods -- matches
 *  essential_foods.display_name, hardcoded here to avoid an extra
 *  round trip just for UI labels on a fixed, known set of 22 ids. */
export const FOOD_DISPLAY_NAMES: Record<string, string> = {
  apples: 'Apples', bananas: 'Bananas', 'beef-mince': 'Beef mince', steak: 'Beef steak',
  bread: 'Bread', broccoli: 'Broccoli', cheese: 'Cheese', chicken: 'Chicken breast',
  'cooking-oil': 'Cooking oil', eggs: 'Eggs', flour: 'Flour', fish: 'Fresh snapper',
  kumara: 'Kumara', lamb: 'Lamb chops', milk: 'Milk', pasta: 'Pasta', pork: 'Pork chops',
  potatoes: 'Potatoes', rice: 'Rice', salt: 'Salt', sugar: 'Sugar', tomatoes: 'Tomatoes',
}

export interface MealIngredient {
  foodId: string
  grams: number
}

export interface MealDefinition {
  id: string
  name: string
  mealType: 'breakfast' | 'lunch' | 'dinner'
  ingredients: MealIngredient[]
}

// Real meals built ONLY from the real 22 essential foods -- no
// off-list ingredients (soy sauce, oats, herbs) the reviewer's own
// example mockup used but this site doesn't actually price.
export const MEAL_DEFINITIONS: MealDefinition[] = [
  { id: 'eggs-on-toast', name: 'Eggs on Toast', mealType: 'breakfast', ingredients: [
    { foodId: 'eggs', grams: 110 }, { foodId: 'bread', grams: 60 }, { foodId: 'cooking-oil', grams: 5 },
  ] },
  { id: 'rice-porridge-banana', name: 'Rice Porridge with Banana', mealType: 'breakfast', ingredients: [
    { foodId: 'rice', grams: 40 }, { foodId: 'milk', grams: 200 }, { foodId: 'bananas', grams: 120 }, { foodId: 'sugar', grams: 5 },
  ] },
  { id: 'egg-fried-rice', name: 'Egg Fried Rice', mealType: 'lunch', ingredients: [
    { foodId: 'rice', grams: 75 }, { foodId: 'eggs', grams: 55 }, { foodId: 'broccoli', grams: 80 }, { foodId: 'cooking-oil', grams: 10 }, { foodId: 'salt', grams: 2 },
  ] },
  { id: 'tomato-cheese-pasta', name: 'Tomato & Cheese Pasta', mealType: 'lunch', ingredients: [
    { foodId: 'pasta', grams: 75 }, { foodId: 'tomatoes', grams: 100 }, { foodId: 'cheese', grams: 30 }, { foodId: 'cooking-oil', grams: 5 },
  ] },
  { id: 'cheese-on-toast', name: 'Cheese on Toast', mealType: 'lunch', ingredients: [
    { foodId: 'bread', grams: 60 }, { foodId: 'cheese', grams: 40 }, { foodId: 'cooking-oil', grams: 5 },
  ] },
  { id: 'chicken-vegetables', name: 'Chicken & Vegetables', mealType: 'dinner', ingredients: [
    { foodId: 'chicken', grams: 120 }, { foodId: 'kumara', grams: 150 }, { foodId: 'broccoli', grams: 100 }, { foodId: 'cooking-oil', grams: 5 },
  ] },
  { id: 'beef-mince-pasta', name: 'Beef Mince Pasta', mealType: 'dinner', ingredients: [
    { foodId: 'beef-mince', grams: 100 }, { foodId: 'pasta', grams: 75 }, { foodId: 'tomatoes', grams: 100 }, { foodId: 'cooking-oil', grams: 5 },
  ] },
  { id: 'lamb-kumara', name: 'Lamb Chops & Kumara', mealType: 'dinner', ingredients: [
    { foodId: 'lamb', grams: 120 }, { foodId: 'kumara', grams: 150 }, { foodId: 'broccoli', grams: 80 },
  ] },
  { id: 'fish-rice', name: 'Fish & Rice', mealType: 'dinner', ingredients: [
    { foodId: 'fish', grams: 120 }, { foodId: 'rice', grams: 75 }, { foodId: 'broccoli', grams: 80 }, { foodId: 'cooking-oil', grams: 5 },
  ] },
  { id: 'pork-potatoes', name: 'Pork Chops & Potatoes', mealType: 'dinner', ingredients: [
    { foodId: 'pork', grams: 120 }, { foodId: 'potatoes', grams: 150 }, { foodId: 'broccoli', grams: 80 },
  ] },
  { id: 'steak-potatoes', name: 'Steak & Potatoes', mealType: 'dinner', ingredients: [
    { foodId: 'steak', grams: 120 }, { foodId: 'potatoes', grams: 150 }, { foodId: 'tomatoes', grams: 80 },
  ] },
]

export interface MealCost {
  meal: MealDefinition
  costCents: number
  nutrition: NutritionPer100g
}

/** Real deterministic cost + nutrition for one meal, from real
 *  resolved ingredient prices (cents/gram) and the standard per-100g
 *  nutrition reference. Pure function -- same inputs, same output,
 *  every time. */
export function costMeal(meal: MealDefinition, ingredients: Map<string, IngredientReference>): MealCost | null {
  let costCents = 0
  const nutrition: NutritionPer100g = { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fibreG: 0 }
  for (const { foodId, grams } of meal.ingredients) {
    const ref = ingredients.get(foodId)
    const nutritionPer100g = NUTRITION_PER_100G[foodId]
    if (!ref || !nutritionPer100g) return null
    costCents += centsPerGram(ref) * grams
    const factor = grams / 100
    nutrition.kcal += nutritionPer100g.kcal * factor
    nutrition.proteinG += nutritionPer100g.proteinG * factor
    nutrition.carbsG += nutritionPer100g.carbsG * factor
    nutrition.fatG += nutritionPer100g.fatG * factor
    nutrition.fibreG += nutritionPer100g.fibreG * factor
  }
  return { meal, costCents, nutrition }
}

export interface ShoppingItem {
  foodId: string
  itemName: string
  isSubstitute: boolean
  isAssumedWeight: boolean
  /** How many whole real packs/kg-units must be bought to cover the
   *  total grams needed across the whole plan. */
  packsNeeded: number
  gramsNeeded: number
  priceCentsPerPack: number
  totalCostCents: number
  usedInMealCount: number
}

export type MealType = 'breakfast' | 'lunch' | 'dinner'

export interface NutritionTargets {
  caloriesPerMeal?: number
  proteinPerMeal?: number
  carbsPerMeal?: number
  fatPerMeal?: number
}

export interface MealPlanConstraints {
  budgetCents: number
  mealCount: number
  mealTypes: MealType[]
  maxCostPerMealCents?: number
  targets?: NutritionTargets
}

export interface GeneratedMeal {
  meal: MealDefinition
  cost: MealCost
}

export interface MealPlanResult {
  feasible: boolean
  infeasibleReason?: string
  meals: GeneratedMeal[]
  shoppingList: ShoppingItem[]
  totalCostCents: number
  averageCostPerMealCents: number
  nutritionAveragePerMeal: NutritionPer100g
}

/** Real shopping-list cost for an ARBITRARY list of meals (not tied to
 *  a fixed day rotation) -- same whole-pack-aware aggregation the
 *  earlier fixed-tier planner used (a pack bought once covers every
 *  meal that needs it, never re-bought), generalised so the
 *  configurable planner below can cost any real meal combination, not
 *  just a hardcoded 6-day cycle. Returns null only if a selected
 *  meal's own ingredients can't be resolved at all (shouldn't happen
 *  given generateMealPlan only selects from already-costed candidates). */
function computeShoppingListForMeals(
  meals: MealDefinition[],
  ingredients: Map<string, IngredientReference>
): { shoppingList: ShoppingItem[]; totalCostCents: number } | null {
  const gramsNeededByFood = new Map<string, number>()
  const usedInMealCount = new Map<string, number>()
  for (const meal of meals) {
    for (const ing of meal.ingredients) {
      gramsNeededByFood.set(ing.foodId, (gramsNeededByFood.get(ing.foodId) ?? 0) + ing.grams)
      usedInMealCount.set(ing.foodId, (usedInMealCount.get(ing.foodId) ?? 0) + 1)
    }
  }
  const shoppingList: ShoppingItem[] = []
  let totalCostCents = 0
  for (const [foodId, gramsNeeded] of gramsNeededByFood) {
    const ref = ingredients.get(foodId)
    if (!ref) return null
    const packsNeeded = ref.weight.isPerKg ? Math.ceil(gramsNeeded) / 1000 : Math.ceil(gramsNeeded / ref.weight.totalGrams)
    const totalCost = ref.weight.isPerKg ? centsPerGram(ref) * gramsNeeded : packsNeeded * ref.product.lowestPriceCents
    shoppingList.push({
      foodId, itemName: ref.product.itemName, isSubstitute: ref.isSubstitute, isAssumedWeight: ref.isAssumedWeight,
      packsNeeded: Math.round(packsNeeded * 100) / 100, gramsNeeded: Math.round(gramsNeeded),
      priceCentsPerPack: ref.product.lowestPriceCents, totalCostCents: Math.round(totalCost),
      usedInMealCount: usedInMealCount.get(foodId) ?? 0,
    })
    totalCostCents += totalCost
  }
  return { shoppingList: shoppingList.sort((a, b) => b.totalCostCents - a.totalCostCents), totalCostCents: Math.round(totalCostCents) }
}

/** Sum of relative deviations from whichever per-meal targets are
 *  actually set -- unset targets contribute nothing, so a meal is only
 *  ever scored against what the user actually asked for. Relative (not
 *  absolute) so calories (hundreds) and fat (tens of grams) don't
 *  silently dominate the score just from having bigger raw numbers. */
function nutritionDeviation(cost: MealCost, targets: NutritionTargets): number {
  let dev = 0
  if (targets.caloriesPerMeal != null) dev += Math.abs(cost.nutrition.kcal - targets.caloriesPerMeal) / Math.max(targets.caloriesPerMeal, 1)
  if (targets.proteinPerMeal != null) dev += Math.abs(cost.nutrition.proteinG - targets.proteinPerMeal) / Math.max(targets.proteinPerMeal, 1)
  if (targets.carbsPerMeal != null) dev += Math.abs(cost.nutrition.carbsG - targets.carbsPerMeal) / Math.max(targets.carbsPerMeal, 1)
  if (targets.fatPerMeal != null) dev += Math.abs(cost.nutrition.fatG - targets.fatPerMeal) / Math.max(targets.fatPerMeal, 1)
  return dev
}

/** The real constraint-driven meal planner (operator request,
 *  2026-10-13, replacing the old fixed 6-day-rotation planner): given a
 *  budget, a meal count, which meal types to include, and optional
 *  per-meal cost/nutrition targets, selects a real combination from
 *  MEAL_DEFINITIONS that fits every constraint -- or says plainly why
 *  it can't, rather than silently showing something that doesn't
 *  actually fit (the spec's own explicit requirement). Pure and
 *  synchronous -- same real ingredient prices in, same plan out, every
 *  time, cheap enough to re-run on every settings change with no
 *  server round trip.
 *
 *  Two-phase: (1) build the CHEAPEST possible combination first -- if
 *  even that doesn't fit the budget, nothing will, so this is the real
 *  feasibility check, not a guess. (2) build the nutrition/variety-
 *  aware combination (closest to any set targets, preferring an unused
 *  meal on a tie); if THAT doesn't fit the budget, greedily swap the
 *  most expensive selected meal for a cheaper same-type alternative,
 *  recomputing the real shopping total each time, until it fits or no
 *  cheaper swap remains (which can't happen, given phase 1 already
 *  proved a fitting combination exists). */
export function generateMealPlan(constraints: MealPlanConstraints, ingredients: Map<string, IngredientReference>): MealPlanResult {
  const empty: MealPlanResult = {
    feasible: false, meals: [], shoppingList: [], totalCostCents: 0, averageCostPerMealCents: 0,
    nutritionAveragePerMeal: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fibreG: 0 },
  }

  if (constraints.mealTypes.length === 0) return { ...empty, infeasibleReason: 'Select at least one meal type.' }
  if (constraints.mealCount <= 0) return { ...empty, infeasibleReason: 'Choose at least 1 meal.' }

  const candidatesByType = new Map<MealType, GeneratedMeal[]>()
  for (const type of constraints.mealTypes) {
    const candidates = MEAL_DEFINITIONS
      .filter((m) => m.mealType === type)
      .map((m) => {
        const cost = costMeal(m, ingredients)
        return cost ? { meal: m, cost } : null
      })
      .filter((x): x is GeneratedMeal => x !== null)
      .filter((x) => constraints.maxCostPerMealCents == null || x.cost.costCents <= constraints.maxCostPerMealCents)
    if (candidates.length === 0) {
      const costNote = constraints.maxCostPerMealCents != null ? ` under $${(constraints.maxCostPerMealCents / 100).toFixed(2)}` : ''
      return { ...empty, infeasibleReason: `No real ${type} meals available${costNote}.` }
    }
    candidatesByType.set(type, candidates)
  }

  function buildPlan(preferCheapest: boolean): GeneratedMeal[] {
    const usedCount = new Map<string, number>()
    const plan: GeneratedMeal[] = []
    for (let i = 0; i < constraints.mealCount; i++) {
      const type = constraints.mealTypes[i % constraints.mealTypes.length]
      const scored = candidatesByType.get(type)!.map((c) => ({
        c,
        score: constraints.targets ? nutritionDeviation(c.cost, constraints.targets) : c.cost.costCents,
        used: usedCount.get(c.meal.id) ?? 0,
      }))
      // Phase-1 (preferCheapest) is the real feasibility probe -- pure
      // cheapest, ignoring variety, since its only job is proving the
      // floor cost. Phase-2 exhausts real variety first (every eligible
      // candidate of a type gets used once before any repeats), THEN
      // breaks ties by nutrition-fit/cost -- spec's own explicit
      // "optimise for nutritional balance, affordability, AND variety"
      // when no targets are set, not cost-above-all (real bug caught
      // live: an unconstrained "6 breakfasts" request returned the same
      // cheapest meal 6 times even though a second real breakfast
      // option existed).
      scored.sort(preferCheapest ? (a, b) => a.score - b.score : (a, b) => a.used - b.used || a.score - b.score)
      const picked = scored[0].c
      plan.push(picked)
      usedCount.set(picked.meal.id, (usedCount.get(picked.meal.id) ?? 0) + 1)
    }
    return plan
  }

  const cheapestPlan = buildPlan(true)
  const cheapestShopping = computeShoppingListForMeals(cheapestPlan.map((m) => m.meal), ingredients)
  if (!cheapestShopping || cheapestShopping.totalCostCents > constraints.budgetCents) {
    const costNote = cheapestShopping ? `cost $${(cheapestShopping.totalCostCents / 100).toFixed(2)}` : "couldn't be priced"
    return { ...empty, infeasibleReason: `Even the cheapest ${constraints.mealCount} meals of these types ${costNote} -- try a higher budget or fewer meals.` }
  }

  let plan = buildPlan(false)
  let shopping = computeShoppingListForMeals(plan.map((m) => m.meal), ingredients)!

  if (shopping.totalCostCents > constraints.budgetCents) {
    for (let attempt = 0; attempt < constraints.mealCount * 2 && shopping.totalCostCents > constraints.budgetCents; attempt++) {
      const byIndividualCostDesc = plan.map((m, idx) => [idx, m] as const).sort((a, b) => b[1].cost.costCents - a[1].cost.costCents)
      let swapped = false
      for (const [idx, current] of byIndividualCostDesc) {
        const cheaperAlt = candidatesByType.get(current.meal.mealType)!
          .filter((c) => c.meal.id !== current.meal.id)
          .sort((a, b) => a.cost.costCents - b.cost.costCents)[0]
        if (cheaperAlt && cheaperAlt.cost.costCents < current.cost.costCents) {
          plan = [...plan]
          plan[idx] = cheaperAlt
          swapped = true
          break
        }
      }
      if (!swapped) break
      shopping = computeShoppingListForMeals(plan.map((m) => m.meal), ingredients)!
    }
  }

  if (shopping.totalCostCents > constraints.budgetCents) {
    return { ...empty, infeasibleReason: `Couldn't fit ${constraints.mealCount} meals of these types within this budget, even using the cheapest options -- try a higher budget or fewer meals.` }
  }

  const nutritionSum = plan.reduce((sum, m) => ({
    kcal: sum.kcal + m.cost.nutrition.kcal, proteinG: sum.proteinG + m.cost.nutrition.proteinG,
    carbsG: sum.carbsG + m.cost.nutrition.carbsG, fatG: sum.fatG + m.cost.nutrition.fatG, fibreG: sum.fibreG + m.cost.nutrition.fibreG,
  }), { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fibreG: 0 })

  return {
    feasible: true,
    meals: plan,
    shoppingList: shopping.shoppingList,
    totalCostCents: shopping.totalCostCents,
    averageCostPerMealCents: shopping.totalCostCents / constraints.mealCount,
    nutritionAveragePerMeal: {
      kcal: nutritionSum.kcal / constraints.mealCount, proteinG: nutritionSum.proteinG / constraints.mealCount,
      carbsG: nutritionSum.carbsG / constraints.mealCount, fatG: nutritionSum.fatG / constraints.mealCount,
      fibreG: nutritionSum.fibreG / constraints.mealCount,
    },
  }
}

export const BUDGET_TIERS_CENTS = [1000, 2000, 4000, 6000, 8000, 10000]

// Only the foods the real meal set actually uses -- deliberately NOT
// every one of the 22 (flour and apples currently sit out: flour's
// only real live-tier flagged product is a 20kg commercial bag,
// $38.09, which would dominate every budget tier the moment any meal
// needed it; apples were never worked into a meal. Both stay available
// via NUTRITION_PER_100G/getAllVariantsForFood for a future meal, just
// not force-fit into one today to avoid a real data gap breaking the
// budget calculator for everyone).
export const MEAL_FOOD_IDS = Array.from(new Set(MEAL_DEFINITIONS.flatMap((m) => m.ingredients.map((i) => i.foodId))))
