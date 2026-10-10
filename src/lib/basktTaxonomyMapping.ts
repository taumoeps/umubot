// UmuBot -- Baskt's own category/subcategory vocabulary does NOT match
// Pricer's exactly, confirmed live 2026-10-10 against a full real
// essential-foods sync (e.g. Baskt's "Meat, Poultry & Seafood" vs
// Pricer's "Meat & Seafood"; "Fridge, Deli & Eggs" vs "Dairy & Eggs";
// "Fruit & Vegetables" vs "Fresh Produce"; "Baking Supplies & Sugar" vs
// "Baking"). An earlier version of this code assumed a 1:1 match based
// on a single sample ("Pantry"/"World Foods") that happened to agree --
// wrong once checked against the real sync's full distinct pair list.
//
// This table is built ONLY from pairs actually observed live in
// price_observations (queried directly, not guessed) -- it is not a
// general-purpose fuzzy taxonomy mapper. A pair not listed here means
// nothing's been seen with that real Baskt category/subcategory
// combination yet; it's excluded from the Pricer-structured browse
// rather than force-mapped to a guess. Add a new row here once a new
// real pair shows up (query price_observations for distinct
// (baskt_category, baskt_subcategory) pairs not already in this list).
// Kept in sync with mosaro's copy of this same file (RecipeBot repo) --
// mosaro's version is the canonical one since that's where new real
// pairs get discovered first (its sync jobs write baskt_category).
//
// "Bakery"::"In-Store Bakery" -> Rolls & Buns is the one judgment call in
// this table, not a literal name match: the only essential_foods search
// terms that land in Baskt's Bakery category are "Bread Rolls"/"Dinner
// Rolls" (mosaro's basktSync.ts sync log, 2026-10-10), so Rolls & Buns
// is a real, evidence-based pick, not an arbitrary default.

export interface BasktTaxonomyAlias {
  basktCategory: string
  basktSubcategory: string
  pricerCategorySlug: string
  pricerSubcategorySlug: string
}

export const BASKT_TAXONOMY_ALIASES: BasktTaxonomyAlias[] = [
  { basktCategory: 'Bakery', basktSubcategory: 'In-Store Bakery', pricerCategorySlug: 'bakery', pricerSubcategorySlug: 'rolls-buns' },
  { basktCategory: 'Fridge, Deli & Eggs', basktSubcategory: 'Cheese', pricerCategorySlug: 'dairy-eggs', pricerSubcategorySlug: 'cheese' },
  { basktCategory: 'Frozen', basktSubcategory: 'Frozen Fish & Seafood', pricerCategorySlug: 'frozen', pricerSubcategorySlug: 'frozen-meat-seafood' },
  { basktCategory: 'Fruit & Vegetables', basktSubcategory: 'Fruit', pricerCategorySlug: 'fresh-produce', pricerSubcategorySlug: 'fruit' },
  { basktCategory: 'Fruit & Vegetables', basktSubcategory: 'Vegetables', pricerCategorySlug: 'fresh-produce', pricerSubcategorySlug: 'vegetables' },
  { basktCategory: 'Meat, Poultry & Seafood', basktSubcategory: 'Beef', pricerCategorySlug: 'meat-seafood', pricerSubcategorySlug: 'beef-lamb' },
  { basktCategory: 'Meat, Poultry & Seafood', basktSubcategory: 'Chicken & Poultry', pricerCategorySlug: 'meat-seafood', pricerSubcategorySlug: 'chicken-poultry' },
  { basktCategory: 'Meat, Poultry & Seafood', basktSubcategory: 'Lamb', pricerCategorySlug: 'meat-seafood', pricerSubcategorySlug: 'beef-lamb' },
  { basktCategory: 'Meat, Poultry & Seafood', basktSubcategory: 'Pork & Ham', pricerCategorySlug: 'meat-seafood', pricerSubcategorySlug: 'pork' },
  { basktCategory: 'Meat, Poultry & Seafood', basktSubcategory: 'Seafood', pricerCategorySlug: 'meat-seafood', pricerSubcategorySlug: 'seafood' },
  { basktCategory: 'Pantry', basktSubcategory: 'Baking Supplies & Sugar', pricerCategorySlug: 'pantry', pricerSubcategorySlug: 'baking' },
  { basktCategory: 'Pantry', basktSubcategory: 'Pasta, Rice & Noodles', pricerCategorySlug: 'pantry', pricerSubcategorySlug: 'pasta-rice-grains' },
]

export function mapBasktToPricer(
  basktCategory: string | null,
  basktSubcategory: string | null
): { categorySlug: string; subcategorySlug: string } | null {
  if (!basktCategory || !basktSubcategory) return null
  const needleCategory = basktCategory.trim().toLowerCase()
  const needleSubcategory = basktSubcategory.trim().toLowerCase()
  const match = BASKT_TAXONOMY_ALIASES.find(
    (a) => a.basktCategory.toLowerCase() === needleCategory && a.basktSubcategory.toLowerCase() === needleSubcategory
  )
  return match ? { categorySlug: match.pricerCategorySlug, subcategorySlug: match.pricerSubcategorySlug } : null
}
