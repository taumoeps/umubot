import { getAllVariantsGroupedByFood, type EssentialProduct } from './essentialFoodsView'

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

/** Reasonable, clearly-assumed per-unit weight (grams) for foods whose
 *  real pack_size is count-based ("ea", "Npk") with no real weight
 *  attached -- see module doc. Only used when no plain, weight-bearing
 *  alternative exists among a food's real flagged variants. */
const ASSUMED_UNIT_GRAMS: Record<string, number> = {
  bread: 80, // one bread roll
  broccoli: 500, // one head
  eggs: 55, // one large egg
  bananas: 130, // one banana
  chicken: 150, // one piece/skewer
}

const PROCESSED_KEYWORDS = [
  'kebab', 'schnitzel', 'crumbed', 'battered', 'fries', 'sausage', 'nugget',
  'marinated', 'honey', 'soy', 'bbq', 'satay', 'stuffed', 'burger', 'patties',
  'pudding', 'twist', 'scroll', 'gluten free', 'half loaf', 'snack pack',
  'cups', 'coconut', 'lemongrass', 'baguette', 'breadcrumbs', 'sprout',
]

function looksPlain(itemName: string): boolean {
  const lower = itemName.toLowerCase()
  return !PROCESSED_KEYWORDS.some((kw) => lower.includes(kw))
}

interface ResolvedWeight {
  totalGrams: number
  isPerKg: boolean
  isAssumedWeight: boolean
}

/** Parses a real Baskt pack_size string into a total gram weight.
 *  Returns null for count-based sizes ("ea", "Npk") with no real
 *  weight -- the caller applies ASSUMED_UNIT_GRAMS for those. */
function parseRealPackSize(packSize: string): ResolvedWeight | null {
  const s = packSize.trim().toLowerCase()

  if (s === 'kg') return { totalGrams: 1000, isPerKg: true, isAssumedWeight: false }

  const multiMatch = s.match(/^(\d+)\s*x\s*(\d+(?:\.\d+)?)\s*g$/)
  if (multiMatch) return { totalGrams: parseFloat(multiMatch[1]) * parseFloat(multiMatch[2]), isPerKg: false, isAssumedWeight: false }

  const kgMatch = s.match(/^(\d+(?:\.\d+)?)\s*kg$/)
  if (kgMatch) return { totalGrams: parseFloat(kgMatch[1]) * 1000, isPerKg: false, isAssumedWeight: false }

  const gMatch = s.match(/^(\d+(?:\.\d+)?)\s*g$/)
  if (gMatch) return { totalGrams: parseFloat(gMatch[1]), isPerKg: false, isAssumedWeight: false }

  const lMatch = s.match(/^(\d+(?:\.\d+)?)\s*l$/)
  if (lMatch) return { totalGrams: parseFloat(lMatch[1]) * 1000, isPerKg: false, isAssumedWeight: false } // 1ml ~ 1g

  const mlMatch = s.match(/^(\d+(?:\.\d+)?)\s*ml$/)
  if (mlMatch) return { totalGrams: parseFloat(mlMatch[1]), isPerKg: false, isAssumedWeight: false }

  return null
}

function resolveWeight(packSize: string | null, foodId: string): ResolvedWeight | null {
  if (!packSize) return null
  const real = parseRealPackSize(packSize)
  if (real) return real

  const unitGrams = ASSUMED_UNIT_GRAMS[foodId]
  if (!unitGrams) return null

  const s = packSize.trim().toLowerCase()
  if (s === 'ea') return { totalGrams: unitGrams, isPerKg: false, isAssumedWeight: true }
  const pkMatch = s.match(/^(\d+)\s*pk$/)
  if (pkMatch) return { totalGrams: unitGrams * parseInt(pkMatch[1], 10), isPerKg: false, isAssumedWeight: true }

  return null
}

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

  const live = withWeight.filter((x) => x.v.tier === 'live')
  const tierPool = live.length > 0 ? live : withWeight
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

/** A fixed 6-day rotation (breakfast/lunch/dinner), cycling for any
 *  number of days -- deterministic, not randomised, so results are
 *  reproducible and the shown "example meal plan" always matches the
 *  real total cost computed for it. */
const DAY_PLANS: { breakfast: string; lunch: string; dinner: string }[] = [
  { breakfast: 'eggs-on-toast', lunch: 'egg-fried-rice', dinner: 'chicken-vegetables' },
  { breakfast: 'rice-porridge-banana', lunch: 'tomato-cheese-pasta', dinner: 'beef-mince-pasta' },
  { breakfast: 'eggs-on-toast', lunch: 'cheese-on-toast', dinner: 'lamb-kumara' },
  { breakfast: 'rice-porridge-banana', lunch: 'egg-fried-rice', dinner: 'fish-rice' },
  { breakfast: 'eggs-on-toast', lunch: 'tomato-cheese-pasta', dinner: 'pork-potatoes' },
  { breakfast: 'rice-porridge-banana', lunch: 'cheese-on-toast', dinner: 'steak-potatoes' },
]

const mealById = new Map(MEAL_DEFINITIONS.map((m) => [m.id, m]))

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

export interface BudgetPlan {
  budgetCents: number
  days: number
  totalMeals: number
  totalCostCents: number
  dayPlans: { breakfast: MealCost; lunch: MealCost; dinner: MealCost }[]
  shoppingList: ShoppingItem[]
  nutritionPerDay: NutritionPer100g
  costPerMealCents: number
}

/** Real deterministic day-by-day affordability calculation: grows the
 *  plan one day at a time (cycling through DAY_PLANS), recomputing the
 *  REAL shopping list needed to cover cumulative ingredient demand
 *  (rounding up to whole packs/kg-units bought once, not re-bought per
 *  day -- the reviewer's "consumption cost vs shopping cost"
 *  distinction) each time, and stops at the largest number of days
 *  whose real total shopping cost still fits the budget. */
export function planForBudget(budgetCents: number, ingredients: Map<string, IngredientReference>): BudgetPlan {
  let best: BudgetPlan = {
    budgetCents, days: 0, totalMeals: 0, totalCostCents: 0, dayPlans: [],
    shoppingList: [], nutritionPerDay: { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fibreG: 0 }, costPerMealCents: 0,
  }

  // Cap at 60 days -- far beyond any real $10-$100 budget's reach, just
  // a safety bound against an infinite loop.
  for (let candidateDays = 1; candidateDays <= 60; candidateDays++) {
    const dayPlans: { breakfast: MealCost; lunch: MealCost; dinner: MealCost }[] = []
    const gramsNeededByFood = new Map<string, number>()
    const usedInMealCount = new Map<string, number>()

    for (let d = 0; d < candidateDays; d++) {
      const plan = DAY_PLANS[d % DAY_PLANS.length]
      const breakfast = costMeal(mealById.get(plan.breakfast)!, ingredients)
      const lunch = costMeal(mealById.get(plan.lunch)!, ingredients)
      const dinner = costMeal(mealById.get(plan.dinner)!, ingredients)
      if (!breakfast || !lunch || !dinner) break
      dayPlans.push({ breakfast, lunch, dinner })
      for (const meal of [plan.breakfast, plan.lunch, plan.dinner]) {
        for (const ing of mealById.get(meal)!.ingredients) {
          gramsNeededByFood.set(ing.foodId, (gramsNeededByFood.get(ing.foodId) ?? 0) + ing.grams)
          usedInMealCount.set(ing.foodId, (usedInMealCount.get(ing.foodId) ?? 0) + 1)
        }
      }
    }
    if (dayPlans.length < candidateDays) break // a meal's ingredients couldn't be resolved

    const shoppingList: ShoppingItem[] = []
    let totalCostCents = 0
    for (const [foodId, gramsNeeded] of gramsNeededByFood) {
      const ref = ingredients.get(foodId)
      if (!ref) continue
      const packsNeeded = ref.weight.isPerKg
        ? Math.ceil(gramsNeeded) / 1000 // priced per kg, buyable in any real fraction
        : Math.ceil(gramsNeeded / ref.weight.totalGrams)
      const totalCost = ref.weight.isPerKg ? centsPerGram(ref) * gramsNeeded : packsNeeded * ref.product.lowestPriceCents
      shoppingList.push({
        foodId, itemName: ref.product.itemName, isSubstitute: ref.isSubstitute, isAssumedWeight: ref.isAssumedWeight,
        packsNeeded: Math.round(packsNeeded * 100) / 100, gramsNeeded: Math.round(gramsNeeded),
        priceCentsPerPack: ref.product.lowestPriceCents, totalCostCents: Math.round(totalCost),
        usedInMealCount: usedInMealCount.get(foodId) ?? 0,
      })
      totalCostCents += totalCost
    }
    totalCostCents = Math.round(totalCostCents)

    if (totalCostCents > budgetCents) break

    const totalMeals = candidateDays * 3
    const nutritionSum = dayPlans.reduce((sum, d) => ({
      kcal: sum.kcal + d.breakfast.nutrition.kcal + d.lunch.nutrition.kcal + d.dinner.nutrition.kcal,
      proteinG: sum.proteinG + d.breakfast.nutrition.proteinG + d.lunch.nutrition.proteinG + d.dinner.nutrition.proteinG,
      carbsG: sum.carbsG + d.breakfast.nutrition.carbsG + d.lunch.nutrition.carbsG + d.dinner.nutrition.carbsG,
      fatG: sum.fatG + d.breakfast.nutrition.fatG + d.lunch.nutrition.fatG + d.dinner.nutrition.fatG,
      fibreG: sum.fibreG + d.breakfast.nutrition.fibreG + d.lunch.nutrition.fibreG + d.dinner.nutrition.fibreG,
    }), { kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, fibreG: 0 })

    best = {
      budgetCents, days: candidateDays, totalMeals, totalCostCents,
      dayPlans, shoppingList: shoppingList.sort((a, b) => b.totalCostCents - a.totalCostCents),
      nutritionPerDay: {
        kcal: nutritionSum.kcal / candidateDays, proteinG: nutritionSum.proteinG / candidateDays,
        carbsG: nutritionSum.carbsG / candidateDays, fatG: nutritionSum.fatG / candidateDays, fibreG: nutritionSum.fibreG / candidateDays,
      },
      costPerMealCents: totalCostCents / totalMeals,
    }
  }

  return best
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
