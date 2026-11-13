// why: category/brand filtering uses denormalized slugs to avoid a cross-DB join between MongoDB and Prisma
export const buildProductFilter = (query) => {
  const {
    search,
    categorySlug,
    categorySlugs,
    brandSlug,
    tagSlug,
    minPrice,
    maxPrice,
    isFeatured,
    inStock,
    onSale,
  } = query;

  const filter = { isActive: true, deletedAt: null };

  if (isFeatured !== undefined) filter.isFeatured = isFeatured;

  if (search) filter.$text = { $search: search };

  if (categorySlugs) {
    const slugs = Array.isArray(categorySlugs)
      ? categorySlugs
      : [categorySlugs];
    if (slugs.length > 0) filter.categorySlug = { $in: slugs };
  } else if (categorySlug) {
    filter.categorySlug = categorySlug;
  }

  if (brandSlug) filter.brandSlug = brandSlug;
  if (tagSlug) filter.tags = tagSlug;

  const stockClause = inStock ? { stock: { $gt: 0 } } : {};

  if (onSale) {
    // why: hasSale is an indexed pre-filter (narrows the scan when category/brand
    // don't); $elemMatch stays as the exact check since a product can have a variant
    // on sale AND a separate variant in stock without either one being both
    filter.hasSale = true;
    filter.variants = {
      $elemMatch: {
        isActive: true,
        deletedAt: null,
        salePrice: { $ne: null },
        ...stockClause,
      },
    };
  } else if (minPrice !== undefined || maxPrice !== undefined) {
    const priceRange = {};
    if (minPrice !== undefined) priceRange.$gte = minPrice;
    if (maxPrice !== undefined) priceRange.$lte = maxPrice;

    // why: match variants where effective price (salePrice ?? price) is in range —
    // can't use the denormalized minPrice here: a product's cheapest variant may sit
    // outside this range while a different variant of the same product is inside it
    filter.variants = {
      $elemMatch: {
        isActive: true,
        deletedAt: null,
        ...stockClause,
        $or: [
          { salePrice: { $ne: null, ...priceRange } },
          { salePrice: null, price: priceRange },
        ],
      },
    };
  } else if (inStock) {
    filter.inStock = true;
    filter.variants = {
      $elemMatch: { isActive: true, deletedAt: null, stock: { $gt: 0 } },
    };
  }

  return filter;
};
