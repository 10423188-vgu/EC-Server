import { esClient, esAvailable, INDEX } from "../../configs/integrations/elasticsearch.js";
import { Product } from "../../models/product.model.js";
import { logger } from "./logger.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// why: retries up to 3× with exponential backoff — ES transient failures should not lose writes
const withRetry = async (fn, { retries = 3, baseDelay = 500, label = "" } = {}) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === retries) throw err;
      const delay = baseDelay * Math.pow(2, attempt - 1);
      logger.warn({ err, attempt, label }, `[ES] retrying in ${delay}ms`);
      await sleep(delay);
    }
  }
};

const buildDoc = (product) => {
  const activeVariants = product.variants.filter(
    (v) => v.isActive && !v.deletedAt,
  );
  // why: salePrice takes precedence as the effective price; raw price is kept separately for discount calculation
  const activePrices = activeVariants
    .map((v) => v.salePrice ?? v.price)
    .filter(Boolean);
  const originalPrices = activeVariants.map((v) => v.price).filter(Boolean);

  return {
    name: product.name,
    slug: product.slug,
    description: product.description ?? "",
    categoryId: product.categoryId,
    categorySlug: product.categorySlug,
    categoryName: product.categoryName,
    brandId: product.brandId ?? null,
    brandSlug: product.brandSlug ?? null,
    brandName: product.brandName ?? null,
    tags: product.tags ?? [],
    isActive: product.isActive && !product.deletedAt,
    isFeatured: product.isFeatured,
    thumbnail: product.images?.[0]?.url ?? null,
    minPrice: activePrices.length
      ? activePrices.reduce((a, b) => (b < a ? b : a))
      : 0,
    maxPrice: activePrices.length
      ? activePrices.reduce((a, b) => (b > a ? b : a))
      : 0,
    minOriginalPrice: originalPrices.length
      ? originalPrices.reduce((a, b) => (b < a ? b : a))
      : 0,
    inStock: activeVariants.some((v) => v.stock > 0),
    // why: first in-stock variant, used by ProductCard to add to cart directly from search results
    firstVariantId:
      (activeVariants.find((v) => v.stock > 0) ?? activeVariants[0])?._id ??
      null,
    reviewStats: {
      count: product.reviewStats?.count ?? 0,
      average: product.reviewStats?.average ?? 0,
    },
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
};

// why: batches N pending product changes into one _bulk request instead of N individual
// index()/delete() calls — a category rename or stock-rollback bulkWrite can otherwise
// fan out thousands of unthrottled ES requests almost simultaneously
export const syncProductsBatch = async (productIds) => {
  if (!productIds.length) return;
  if (!esAvailable) throw new Error("Elasticsearch is not available");
  await withRetry(
    async () => {
      const products = await Product.find({ _id: { $in: productIds } }).lean();
      const foundIds = new Set(products.map((p) => String(p._id)));
      const deletedIds = productIds.filter((id) => !foundIds.has(id));

      const operations = [
        ...products.flatMap((p) => [
          { index: { _index: INDEX, _id: String(p._id) } },
          buildDoc(p),
        ]),
        ...deletedIds.map((id) => ({ delete: { _index: INDEX, _id: id } })),
      ];
      if (!operations.length) return;

      const bulkRes = await esClient.bulk({ operations });
      if (bulkRes.errors) {
        // why: a delete for a doc that was never indexed 404s — that's expected, not a failure
        const failed = bulkRes.items
          .map((i) => i.index ?? i.delete)
          .filter((item) => item?.error && item.status !== 404);
        if (failed.length) {
          logger.warn({ failed: failed.map((i) => i.error) }, "[ES] batch sync -- some documents failed");
          throw new Error(`${failed.length} Elasticsearch bulk items failed`);
        }
      }
    },
    { label: `syncProductsBatch:${productIds.length}` },
  );
};

export const reindexAllProducts = async () => {
  if (!esAvailable) throw new Error("Elasticsearch not available");

  let indexed = 0;
  let cursor = null;
  const BATCH = 200;

  do {
    const query = cursor ? { _id: { $gt: cursor } } : {};
    const products = await Product.find(query)
      .sort({ _id: 1 })
      .limit(BATCH)
      .lean();

    if (!products.length) break;

    const operations = products.flatMap((p) => [
      { index: { _index: INDEX, _id: String(p._id) } },
      buildDoc(p),
    ]);

    await withRetry(async () => {
      const bulkRes = await esClient.bulk({ operations });
      // why: bulk can return HTTP 200 with failed items; a reindex must report
      // failure instead of claiming those products were indexed successfully.
      if (bulkRes.errors && bulkRes.items.some((item) => item.index?.error)) {
        throw new Error("Elasticsearch reindex batch has failed items");
      }
    }, { label: `reindexAllProducts:${products.length}` });
    indexed += products.length;
    cursor = products[products.length - 1]._id;

    if (products.length < BATCH) break;
  } while (true);

  return { indexed };
};
