// UmuBot -- the real New World / PAK'nSAVE grocery category structure
// (Baskt only covers these two chains -- see baskt.ts's module doc in
// mosaro), replacing pricerCatalogTaxonomy.ts (operator request,
// 2026-10-12: "I copied this from Pricer" -- Pricer's own invented
// names, e.g. "Fresh Produce"/"Meat & Seafood"/"Dairy & Eggs", never
// matched the real supermarket taxonomy). These 13 top-level category
// names are taken directly from newworld.co.nz and paknsave.co.nz's own
// real "Groceries" menu (both identical), confirmed live 2026-10-12 --
// excludes their non-category promotional entries ("Featured", "New
// World Wine Awards").
//
// Deliberately NO hardcoded subcategory list, unlike the old Pricer
// copy: a subcategory here is whatever Baskt's own baskt_subcategory
// text says for a real observed row -- see basktTaxonomyMapping.ts.
// That's a real design change, not just a rename -- the old table
// needed a manual edit every time a new real (category, subcategory)
// pair showed up in a sync; trusting Baskt's own real text removes
// that maintenance burden and the risk of silently excluding a real
// pair nobody added yet.

export interface Category {
  name: string
  slug: string
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const REAL_CATEGORY_NAMES = [
  'Fruit & Vegetables',
  'Meat, Poultry & Seafood',
  'Fridge, Deli & Eggs',
  'Bakery',
  'Frozen',
  'Pantry',
  'Hot & Cold Drinks',
  'Beer, Wine & Cider',
  'Health & Body',
  'Baby & Toddler',
  'Pets',
  'Household & Cleaning',
  'Snacks, Treats & Easy Meals',
]

export const CATALOG_CATEGORIES: Category[] = REAL_CATEGORY_NAMES.map((name) => ({ name, slug: slugify(name) }))

export function findCategory(slug: string): Category | undefined {
  return CATALOG_CATEGORIES.find((c) => c.slug === slug)
}

export { slugify }
