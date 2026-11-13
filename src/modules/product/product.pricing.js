export const lowestProductPrice = (product) => {
  if (!product || product.isActive === false || product.deletedAt) return null;
  const prices = (product.variants ?? [])
    .filter((variant) => variant.isActive !== false && !variant.deletedAt)
    .map((variant) => Number(variant.salePrice ?? variant.price))
    .filter((price) => Number.isFinite(price) && price > 0);
  return prices.length ? Math.min(...prices) : null;
};
