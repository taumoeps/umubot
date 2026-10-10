// UmuBot -- the real Pricer category/subcategory taxonomy (names only,
// copied verbatim from pricer.nz/browse, 2026-10-10 -- NOT Pricer's own
// product counts, which belong to Pricer's catalog, not UmuBot's).
// Matched against price_observations.baskt_category/baskt_subcategory,
// which carry Baskt's own real tags -- see basktTaxonomyMapping.ts for
// why that match isn't a literal string comparison.

export interface Subcategory {
  name: string
  slug: string
}

export interface Category {
  name: string
  slug: string
  subcategories: Subcategory[]
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const RAW: { name: string; subcategories: string[] }[] = [
  { name: 'Alcohol', subcategories: ['Beer & Cider', 'Ready To Drink', 'Red Wine', 'Rosé Wine', 'Sparkling Wine', 'Spirits', 'White Wine'] },
  { name: 'Baby & Child', subcategories: ['Baby Care & Accessories', 'Baby Food', 'Baby Formula', 'Nappies & Wipes'] },
  { name: 'Bakery', subcategories: ['Baked Goods & Cakes', 'Bread', 'Cakes, Muffins & Desserts', 'Fresh Biscuits & Slices', 'Pies & Savouries', 'Rolls & Buns', 'Sweet Pastries & Donuts', 'Wraps & Flatbread'] },
  { name: 'Dairy & Eggs', subcategories: ['Butter & Margarine', 'Cheese', 'Cream & Sour Cream', 'Eggs', 'Milk', 'Yoghurt'] },
  { name: 'Drinks', subcategories: ['Cordials & Mixers', 'Juice', 'Soft Drinks', 'Sports & Energy Drinks', 'Water'] },
  { name: 'Fresh Produce', subcategories: ['Fresh Herbs', 'Fruit', 'Organic Produce', 'Prepared Salads', 'Salads & Herbs', 'Vegetables'] },
  { name: 'Frozen', subcategories: ['Frozen Fruit', 'Frozen Meals', 'Frozen Meat & Seafood', 'Frozen Pastry & Bread', 'Frozen Pizza & Snacks', 'Frozen Vegetables', 'Ice Cream & Desserts'] },
  { name: 'Health & Beauty', subcategories: ['Bath & Body', 'Deodorant', 'Feminine Care', 'First Aid & Medical', 'Hair Care', 'Makeup & Nails', 'Oral Care', 'Shaving & Grooming', 'Skin Care', 'Sun Care & Tanning', 'Vitamins & Supplements'] },
  { name: 'Household', subcategories: ['Air Fresheners', 'Batteries & Electrical', 'Cleaning', 'Dishwashing', 'Home & Outdoor', 'Kitchen & Cookware', 'Laundry', 'Paper & Plastic Wrap'] },
  { name: 'Meat & Seafood', subcategories: ['BBQ & Marinated', 'Beef & Lamb', 'Chicken & Poultry', 'Deli Meats', 'Mince & Burgers', 'Pork', 'Sausages & Bacon', 'Seafood'] },
  { name: 'Pantry', subcategories: ['Baking', 'Canned & Tinned', 'Cereals & Oats', 'Noodles & Asian', 'Oils & Vinegars', 'Pasta, Rice & Grains', 'Sauces & Condiments', 'Soup & Stock', 'Spices & Seasonings', 'Spreads & Honey', 'Tea & Coffee', 'World Foods'] },
  { name: 'Pet Care', subcategories: ['Cat Food', 'Dog Food', 'Pet Accessories', 'Pet Treats'] },
  { name: 'Snacks & Confectionery', subcategories: ['Biscuits & Crackers', 'Chips & Crisps', 'Chocolate', 'Lollies & Sweets', 'Muesli Bars', 'Nuts & Trail Mix', 'Popcorn & Rice Cakes'] },
]

export const CATALOG_TAXONOMY: Category[] = RAW.map((c) => ({
  name: c.name,
  slug: slugify(c.name),
  subcategories: c.subcategories.map((s) => ({ name: s, slug: slugify(s) })),
}))

export function findCategory(slug: string): Category | undefined {
  return CATALOG_TAXONOMY.find((c) => c.slug === slug)
}

export function findSubcategory(categorySlug: string, subcategorySlug: string): { category: Category; subcategory: Subcategory } | undefined {
  const category = findCategory(categorySlug)
  const subcategory = category?.subcategories.find((s) => s.slug === subcategorySlug)
  return category && subcategory ? { category, subcategory } : undefined
}
