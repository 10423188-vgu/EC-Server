import crypto from "node:crypto";
import { searchESRepository } from "./search.es.repository.js";
import { esAvailable, esBreaker } from "../../configs/integrations/elasticsearch.js";
import { logger } from "../../shared/utils/logger.js";
import { Product } from "../../models/product.model.js";
import { buildProductFilter } from "../product/product.filter.js";
import { reindexAllProducts } from "../../shared/utils/es-sync.util.js";
import { redisClient, redisCircuit } from "../../configs/cache/redis.js";

// ─── MongoDB fallback ─────────────────────────────────────────────────────────

// why: priceStats/categoryAgg run over the WHOLE filtered set (not just the current
// page) — exactly the path traffic falls back to when ES is down, so it's the worst
// possible moment to pay for an uncached full-collection aggregate on every request.
// Cached by a hash of the match filter since the same filter combination recurs a lot.
const AGGREGATE_CACHE_TTL_SECONDS = 180;
const pendingMongoSearches = new Map();

const getAggregateCacheKey = (filter) =>
  `search:mongo-agg:${crypto.createHash("sha1").update(JSON.stringify(filter)).digest("hex")}`;

const getCachedAggregates = async (key) => {
  try {
    const cached = await redisCircuit.execute(() => redisClient.get(key));
    return cached ? JSON.parse(cached) : null;
  } catch {
    return null;
  }
};

const setCachedAggregates = (key, value) => {
  redisCircuit
    .execute(() => redisClient.set(key, JSON.stringify(value), { EX: AGGREGATE_CACHE_TTL_SECONDS }))
    .catch(() => {
      // why: caching is a pure optimization — a Redis failure here must not break search
    });
};

const runMongoSearch = async ({ q, filters, sort, page, limit }) => {
  const mongoFilters = {
    search: q || undefined,
    // NOTE: categorySlugs[] maps to $in inside buildProductFilter
    ...(filters.categorySlugs?.length === 1
      ? { categorySlug: filters.categorySlugs[0] }
      : filters.categorySlugs?.length > 1
      ? { categorySlugs: filters.categorySlugs }
      : {}),
    brandSlug: filters.brandSlug,
    minPrice: filters.minPrice,
    maxPrice: filters.maxPrice,
    inStock: filters.inStock,
    isFeatured: filters.isFeatured,
  };

  let filter = buildProductFilter(mongoFilters);
  // why: minRating filters on denormalized reviewStats — not handled inside buildProductFilter
  if (filters.minRating !== undefined) {
    filter["reviewStats.average"] = { $gte: filters.minRating };
  }
  const sortMap = {
    price_asc: { "variants.price": 1 },
    price_desc: { "variants.price": -1 },
    createdAt_desc: { createdAt: -1 },
    createdAt_asc: { createdAt: 1 },
    name_asc: { name: 1 },
    // why: textScore only exists because buildProductFilter adds $text: { $search } when filters.search is set
    relevance: q ? { score: { $meta: "textScore" } } : { createdAt: -1 },
    rating: { "reviewStats.average": -1 },
  };
  const sortField = sortMap[sort] ?? { createdAt: -1 };
  const skip = (page - 1) * limit;

  const aggCacheKey = getAggregateCacheKey(filter);
  const cachedAgg = await getCachedAggregates(aggCacheKey);

  const [products, total, priceAgg, categoryAgg] = await Promise.all([
    Product.find(filter)
      .sort(sortField)
      .skip(skip)
      .limit(limit)
      .maxTimeMS(5_000)
      .select("name slug description categoryId categorySlug categoryName brandId brandSlug brandName tags images variants reviewStats isFeatured createdAt")
      .lean(),
    Product.countDocuments(filter).maxTimeMS(5_000),
    cachedAgg
      ? cachedAgg.priceAgg
      : Product.aggregate([
          { $match: filter },
          { $unwind: "$variants" },
          { $match: { "variants.isActive": true, "variants.deletedAt": null } },
          {
            $group: {
              _id: null,
              min: { $min: { $cond: [{ $ne: ["$variants.salePrice", null] }, "$variants.salePrice", "$variants.price"] } },
              max: { $max: { $cond: [{ $ne: ["$variants.salePrice", null] }, "$variants.salePrice", "$variants.price"] } },
            },
          },
        ]).option({ maxTimeMS: 5_000 }),
    cachedAgg
      ? cachedAgg.categoryAgg
      : Product.aggregate([
          { $match: { ...filter, isActive: true } },
          { $group: { _id: { slug: "$categorySlug", name: "$categoryName" }, count: { $sum: 1 } } },
        ]).option({ maxTimeMS: 5_000 }),
  ]);

  if (!cachedAgg) setCachedAggregates(aggCacheKey, { priceAgg, categoryAgg });

  const hits = products.map((p) => {
    const activeVariants = p.variants.filter((v) => v.isActive && !v.deletedAt);
    const effectivePrices = activeVariants.map((v) => v.salePrice ?? v.price).filter(Boolean);
    const originalPrices = activeVariants.map((v) => v.price).filter(Boolean);
    return {
      id: String(p._id),
      slug: p.slug,
      name: p.name,
      description: p.description ?? "",
      categorySlug: p.categorySlug,
      categoryName: p.categoryName,
      brandSlug: p.brandSlug,
      brandName: p.brandName,
      tags: p.tags,
      thumbnail: p.images?.[0]?.url ?? null,
      minPrice: effectivePrices.length ? Math.min(...effectivePrices) : 0,
      maxPrice: effectivePrices.length ? Math.max(...effectivePrices) : 0,
      minOriginalPrice: originalPrices.length ? Math.min(...originalPrices) : 0,
      inStock: activeVariants.some((v) => v.stock > 0),
      firstVariantId: (activeVariants.find((v) => v.stock > 0) ?? activeVariants[0])?._id ?? null,
      isFeatured: p.isFeatured,
      reviewStats: p.reviewStats ?? { count: 0, average: 0 },
    };
  });

  const aggregations = {
    categories: categoryAgg
      .map((r) => ({ slug: r._id.slug, name: r._id.name, count: r.count }))
      .filter((c) => c.slug),
    priceStats: {
      min: priceAgg[0]?.min ?? 0,
      max: priceAgg[0]?.max ?? 0,
    },
  };

  return { hits, total, aggregations, source: "mongodb" };
};

const mongoSearch = (params) => {
  const key = JSON.stringify(params);
  const pending = pendingMongoSearches.get(key);
  if (pending) return pending;

  // why: concurrent fallback requests with identical filters otherwise repeat
  // the same find, count and aggregate work while Elasticsearch is unavailable.
  const search = runMongoSearch(params).finally(() => {
    pendingMongoSearches.delete(key);
  });
  pendingMongoSearches.set(key, search);
  return search;
};

// ─── ES response normalizer ───────────────────────────────────────────────────

const normalizeESResponse = (response) => {
  // NOTE: _id is the MongoDB ObjectId stored as the ES document id, absent from _source
  const hits = response.hits.hits.map((h) => ({
    id: h._id,
    ...h._source,
    highlight: h.highlight ?? null,
    score: h._score,
  }));

  const aggs = response.aggregations;
  const aggregations = {
    categories: aggs.categories.inner.buckets.map((b) => ({
      slug: b.key,
      name: b.name?.buckets?.[0]?.key ?? b.key,
      count: b.doc_count,
    })),
    brands: aggs.brands.inner.buckets.map((b) => ({
      slug: b.key,
      name: b.name?.buckets?.[0]?.key ?? b.key,
      count: b.doc_count,
    })),
    priceStats: {
      min: aggs.price_stats.inner.min ?? 0,
      max: aggs.price_stats.inner.max ?? 0,
      avg: aggs.price_stats.inner.avg ?? 0,
    },
    ratingDist: aggs.rating_dist.buckets.map((b) => ({
      label: b.key,
      count: b.doc_count,
    })),
    inStockCount: aggs.in_stock.doc_count,
  };

  return {
    hits,
    total: response.hits.total?.value ?? 0,
    aggregations,
    source: "elasticsearch",
  };
};

// ─── Service ──────────────────────────────────────────────────────────────────

// why: change-stream indexing is asynchronous; one batched Mongo read prevents
// deleted products from leaking through stale ES results without an N+1 query.
const areSearchResultsCurrent = async (results) => {
  if (!results.length) return true;
  const products = await Product.find(
    { slug: { $in: results.map((result) => result.slug) }, isActive: true, deletedAt: null },
    { slug: 1, "variants._id": 1, "variants.isActive": 1, "variants.deletedAt": 1 },
  ).lean();
  const bySlug = new Map(products.map((product) => [product.slug, product]));
  return results.every((result) => {
    const product = bySlug.get(result.slug);
    return product && (!result.firstVariantId || product.variants.some(
      (variant) => variant._id === result.firstVariantId && variant.isActive && !variant.deletedAt,
    ));
  });
};

export const searchService = {
  search: async ({ q, filters, sort, page, limit }) => {
    const from = (page - 1) * limit;

    if (esAvailable) {
      try {
        const raw = await esBreaker.execute(() =>
          searchESRepository.search({ q, filters, sort, from, size: limit })
        );
        const { hits, total, aggregations } = normalizeESResponse(raw);
        if (await areSearchResultsCurrent(hits)) return {
          data: hits,
          aggregations,
          pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
          source: "elasticsearch",
        };
      } catch (err) {
        logger.warn({ err: err.message }, "[search] ES unavailable, falling back to MongoDB");
      }
    }

    const { hits, total, aggregations } = await mongoSearch({ q, filters, sort, page, limit });
    return {
      data: hits,
      aggregations,
      pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
      source: "mongodb",
    };
  },

  suggest: async (q) => {
    if (esAvailable) {
      try {
        const suggestions = await esBreaker.execute(() => searchESRepository.suggest(q));
        if (await areSearchResultsCurrent(suggestions)) return suggestions;
      } catch (err) {
        logger.warn({ err: err.message }, "[suggest] ES unavailable, falling back to MongoDB");
      }
    }
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const products = await Product.find(
      { name: { $regex: `^${escaped}`, $options: "i" }, isActive: true, deletedAt: null },
      { name: 1, slug: 1, images: { $slice: 1 } }
    )
      .limit(8)
      .lean();
    return products.map((p) => ({
      name: p.name,
      slug: p.slug,
      thumbnail: p.images?.[0]?.url ?? null,
    }));
  },

  trending: async (limit = 6) => {
    if (esAvailable) {
      try {
        const trending = await esBreaker.execute(() => searchESRepository.trending(limit));
        if (await areSearchResultsCurrent(trending)) return trending;
      } catch (err) {
        logger.warn({ err: err.message }, "[trending] ES unavailable, falling back to MongoDB");
      }
    }
    const products = await Product.find({ isActive: true, deletedAt: null })
      .sort({ "reviewStats.count": -1 })
      .limit(limit)
      .select("name slug")
      .lean();
    return products.map((p) => ({ term: p.name, slug: p.slug }));
  },

  reindex: async () => reindexAllProducts(),
};
