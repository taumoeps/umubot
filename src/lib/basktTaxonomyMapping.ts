import { CATALOG_CATEGORIES, slugify } from './groceryCatalogTaxonomy'

// UmuBot -- resolves a real price_observations row's own
// baskt_category/baskt_subcategory into the catalogue's category/
// subcategory slugs. Simplified, 2026-10-12, now that
// groceryCatalogTaxonomy.ts's category names ARE Baskt's own real
// category names (New World/PAK'nSAVE's real menu, not Pricer's
// invented one -- see that file's module doc): a row's category only
// needs a direct name match against the known real list; its
// subcategory is trusted as-is from Baskt's own text (slugified for
// the URL, kept verbatim for display) rather than translated through a
// hand-maintained alias table. The old version of this file needed a
// manual edit every time a new real (category, subcategory) pair
// appeared in a sync -- this doesn't.
//
// A row whose baskt_category isn't one of the known real 13 is
// excluded, not guessed into the nearest bucket -- same "don't force a
// match" discipline as before, just resting on a real, confirmed-live
// category list instead of an alias table.

const categoryByRealName = new Map(CATALOG_CATEGORIES.map((c) => [c.name.toLowerCase(), c.slug]))

export interface ResolvedBasktCategory {
  categorySlug: string
  subcategorySlug: string
  /** Baskt's own real subcategory text, verbatim -- used as the
   *  display name directly, since it's real supermarket vocabulary,
   *  not a translated/invented one. */
  subcategoryName: string
}

export function mapBasktToCatalog(basktCategory: string | null, basktSubcategory: string | null): ResolvedBasktCategory | null {
  if (!basktCategory || !basktSubcategory) return null
  const categorySlug = categoryByRealName.get(basktCategory.trim().toLowerCase())
  if (!categorySlug) return null
  const subcategoryName = basktSubcategory.trim()
  if (!subcategoryName) return null
  return { categorySlug, subcategorySlug: slugify(subcategoryName), subcategoryName }
}
