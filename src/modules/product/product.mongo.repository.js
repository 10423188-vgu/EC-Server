import { Product } from "../../models/product.model.js";
import { logger } from "../../shared/utils/logger.js";

// why: single source of truth for minPrice/hasSale/inStock — recomputed and written
// by the repository on every mutation that touches variants, so sort/filter can use
// real indexes instead of computing over variants for the whole result set each time
const computeDenormalizedFields = (variants = []) => {
  const active = variants.filter((v) => v.isActive !== false && !v.deletedAt);
  const activePrices = active.map((v) => v.salePrice ?? v.price);
  return {
    minPrice: activePrices.length ? Math.min(...activePrices) : null,
    hasSale: active.some((v) => v.salePrice != null),
    inStock: active.some((v) => v.stock > 0),
  };
};

// why: addVariant/updateVariant/deleteVariant mutate `variants` first, then need a 2nd write
// to sync minPrice/hasSale/inStock from the resulting array (can't compute a JS reduction
// inside the same $push/$set/$pull). A naive "$set fields computed from the array I got
// back" 2nd write races: if another variant write lands in between, its own sync can get
// overwritten by this one's now-stale computation (lost update). Guarding the $set on
// updatedAt — bumped by every write — makes it a no-op when that happens, so we re-read
// and retry instead of persisting derived fields computed from data that's no longer current.
const syncDenormalizedFields = async (productId) => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const doc = await Product.findById(productId, {
      variants: 1,
      updatedAt: 1,
    }).lean();
    if (!doc) return;
    const { matchedCount } = await Product.updateOne(
      { _id: productId, updatedAt: doc.updatedAt },
      { $set: computeDenormalizedFields(doc.variants) },
    );
    if (matchedCount > 0) return;
  }
  logger.warn(
    { productId },
    "[Product] denormalized field sync gave up after 5 attempts (high write contention)",
  );
};

const LIST_PROJECTION = {
  name: 1,
  slug: 1,
  description: 1,
  isActive: 1,
  isFeatured: 1,
  createdAt: 1,
  categoryId: 1,
  categorySlug: 1,
  categoryName: 1,
  brandId: 1,
  brandSlug: 1,
  brandName: 1,
  tags: 1,
  images: { $slice: 1 },
  reviewStats: 1,
  "variants._id": 1,
  "variants.price": 1,
  "variants.salePrice": 1,
  "variants.stock": 1,
  "variants.isActive": 1,
  "variants.deletedAt": 1,
};

const toPlain = (doc) => {
  if (!doc) return null;
  const obj = typeof doc.toObject === "function" ? doc.toObject() : doc;
  const { _id, ...rest } = obj;
  return { id: String(_id), ...rest };
};

const shapeList = (doc) => {
  const p = toPlain(doc);
  if (!p) return null;
  return {
    ...p,
    category: { id: p.categoryId, name: p.categoryName, slug: p.categorySlug },
    brand: p.brandId
      ? { id: p.brandId, name: p.brandName, slug: p.brandSlug }
      : null,
    variants: (p.variants ?? [])
      .filter((v) => v.isActive && !v.deletedAt)
      .map((v) => ({ ...v, id: String(v._id ?? v.id) })),
  };
};

const shapeDetail = (doc) => {
  const p = toPlain(doc);
  if (!p) return null;
  return {
    ...p,
    category: { id: p.categoryId, name: p.categoryName, slug: p.categorySlug },
    brand: p.brandId
      ? { id: p.brandId, name: p.brandName, slug: p.brandSlug }
      : null,
    variants: (p.variants ?? [])
      .filter((v) => v.isActive && !v.deletedAt)
      .sort((a, b) => a.price - b.price)
      .map((v) => ({
        ...v,
        id: String(v._id ?? v.id),
        options:
          v.options instanceof Map
            ? Object.fromEntries(v.options)
            : (v.options ?? {}),
      })),
  };
};

export const productMongoRepository = {
  findAll: async ({
    filter,
    sortField = "createdAt",
    sortOrder = "desc",
    skip = 0,
    take = 12,
  }) => {
    const sortDir = sortOrder === "asc" ? 1 : -1;
    const sortKey =
      sortField === "price"
        ? "minPrice"
        : sortField === "name"
          ? "name"
          : "createdAt";

    const [docs, total] = await Promise.all([
      Product.find(filter, LIST_PROJECTION)
        .sort({ [sortKey]: sortDir })
        .skip(skip)
        .limit(take)
        .maxTimeMS(10_000)
        .lean(),
      Product.countDocuments(filter).maxTimeMS(10_000),
    ]);

    return { products: docs.map(shapeList), total };
  },

  findById: async (id) => {
    const doc = await Product.findOne({ _id: id, deletedAt: null }).lean();
    return shapeDetail(doc);
  },

  findAdminById: async (id) => {
    const doc = await Product.findOne({ _id: id, deletedAt: null }).lean();
    if (!doc) return null;
    return {
      ...toPlain(doc),
      variants: doc.variants.map((variant) => ({
        ...variant,
        id: variant._id,
      })),
    };
  },

  create: async (data) => {
    const doc = await Product.create({
      ...data,
      ...computeDenormalizedFields(data.variants),
    });
    return shapeDetail(doc.toObject());
  },

  update: async (id, data) => {
    const setData = data.variants
      ? { ...data, ...computeDenormalizedFields(data.variants) }
      : data;
    const doc = await Product.findOneAndUpdate(
      { _id: id, deletedAt: null },
      { $set: setData },
      { returnDocument: "after", runValidators: true },
    ).lean();
    return shapeDetail(doc);
  },

  delete: async (id, deletedBy) => {
    // why: retries retain the first deletion's audit fields and never remove inventory.
    return Product.findOneAndUpdate(
      { _id: id },
      [
        {
          $set: {
            isActive: false,
            deletedAt: { $ifNull: ["$deletedAt", new Date()] },
            deletedBy: {
              $cond: [
                { $eq: [{ $ifNull: ["$deletedAt", null] }, null] },
                { $literal: deletedBy ?? null },
                "$deletedBy",
              ],
            },
          },
        },
      ],
      { returnDocument: "after", updatePipeline: true },
    ).lean();
  },

  restore: async (id) => {
    const doc = await Product.findOneAndUpdate(
      { _id: id, deletedAt: { $ne: null } },
      { $set: { deletedAt: null, deletedBy: null, isActive: false } },
      { returnDocument: "after" },
    ).lean();
    return shapeDetail(doc) ?? productMongoRepository.findById(id);
  },

  findRelated: async (productId, { categoryId, brandId, tags }, limit = 8) => {
    const collected = new Map();
    const exclude = [productId];

    if (brandId) {
      const p1 = await Product.find(
        {
          _id: { $nin: exclude },
          categoryId,
          brandId,
          isActive: true,
          deletedAt: null,
        },
        LIST_PROJECTION,
      )
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
      p1.forEach((d) => collected.set(String(d._id), shapeList(d)));
    }

    if (collected.size < limit) {
      const seen = [productId, ...collected.keys()];
      const p2 = await Product.find(
        { _id: { $nin: seen }, categoryId, isActive: true, deletedAt: null },
        LIST_PROJECTION,
      )
        .sort({ createdAt: -1 })
        .limit(limit - collected.size)
        .lean();
      p2.forEach((d) => collected.set(String(d._id), shapeList(d)));
    }

    if (collected.size < limit && tags?.length > 0) {
      const seen = [productId, ...collected.keys()];
      const p3 = await Product.find(
        {
          _id: { $nin: seen },
          tags: { $in: tags },
          isActive: true,
          deletedAt: null,
        },
        LIST_PROJECTION,
      )
        .sort({ createdAt: -1 })
        .limit(limit - collected.size)
        .lean();
      p3.forEach((d) => collected.set(String(d._id), shapeList(d)));
    }

    return [...collected.values()];
  },

  addVariant: async (productId, variantData) => {
    const doc = await Product.findOneAndUpdate(
      {
        _id: productId,
        deletedAt: null,
        "variants.sku": { $ne: variantData.sku },
      },
      { $push: { variants: variantData } },
      { returnDocument: "after", runValidators: true },
    ).lean();
    if (!doc) return null;
    await syncDenormalizedFields(productId);
    const v = doc.variants.find((v) => v.sku === variantData.sku);
    if (!v) return null;
    return {
      ...v,
      id: String(v._id),
      options:
        v.options instanceof Map
          ? Object.fromEntries(v.options)
          : (v.options ?? {}),
    };
  },

  findVariant: async (
    productId,
    variantId,
    { includeDeleted = false } = {},
  ) => {
    const doc = await Product.findOne(
      {
        _id: productId,
        deletedAt: null,
        variants: {
          $elemMatch: {
            _id: variantId,
            ...(!includeDeleted && { deletedAt: null }),
          },
        },
      },
      { "variants.$": 1 },
    ).lean();
    if (!doc?.variants?.[0]) return null;
    const v = doc.variants[0];
    return {
      ...v,
      id: String(v._id),
      options:
        v.options instanceof Map
          ? Object.fromEntries(v.options)
          : (v.options ?? {}),
    };
  },

  updateVariant: async (productId, variantId, data) => {
    const setFields = {};
    for (const [k, v] of Object.entries(data)) {
      setFields[`variants.$.${k}`] = v;
    }
    setFields["variants.$.updatedAt"] = new Date();

    const doc = await Product.findOneAndUpdate(
      {
        _id: productId,
        deletedAt: null,
        variants: { $elemMatch: { _id: variantId, deletedAt: null } },
        ...(data.sku && {
          $and: [
            {
              variants: {
                $not: {
                  $elemMatch: { sku: data.sku, _id: { $ne: variantId } },
                },
              },
            },
          ],
        }),
      },
      { $set: setFields },
      { returnDocument: "after" },
    )
      .select({ variants: 1 })
      .lean();
    if (!doc?.variants?.length) return null;
    await syncDenormalizedFields(productId);
    const v = doc.variants.find((v) => String(v._id) === String(variantId));
    if (!v) return null;
    return {
      ...v,
      id: String(v._id),
      options:
        v.options instanceof Map
          ? Object.fromEntries(v.options)
          : (v.options ?? {}),
    };
  },

  deleteVariant: async (productId, variantId, deletedBy) => {
    const doc = await Product.findOneAndUpdate(
      {
        _id: productId,
        deletedAt: null,
        variants: { $elemMatch: { _id: variantId, deletedAt: null } },
      },
      {
        $set: {
          "variants.$.isActive": false,
          "variants.$.deletedAt": new Date(),
          "variants.$.deletedBy": deletedBy ?? null,
        },
      },
      { returnDocument: "after" },
    )
      .select({ variants: 1 })
      .lean();
    if (doc) await syncDenormalizedFields(productId);
    return doc;
  },

  restoreVariant: async (productId, variantId) => {
    const doc = await Product.findOneAndUpdate(
      {
        _id: productId,
        deletedAt: null,
        variants: { $elemMatch: { _id: variantId, deletedAt: { $ne: null } } },
      },
      {
        $set: {
          "variants.$.isActive": false,
          "variants.$.deletedAt": null,
          "variants.$.deletedBy": null,
        },
      },
      { returnDocument: "after" },
    ).lean();
    if (doc) await syncDenormalizedFields(productId);
    return productMongoRepository.findVariant(productId, variantId);
  },

  skuExists: async (sku, excludeVariantId = null) => {
    const filter = {
      variants: {
        $elemMatch: {
          sku,
          ...(excludeVariantId && { _id: { $ne: excludeVariantId } }),
        },
      },
    };
    return !!(await Product.findOne(filter, { _id: 1 }).lean());
  },

  // why: single $in query vs N sequential skuExists calls when creating multiple variants
  skuExistsAny: async (skus) => {
    if (!skus.length) return null;
    const doc = await Product.findOne(
      { "variants.sku": { $in: skus } },
      { "variants.sku": 1 },
    ).lean();
    if (!doc) return null;
    return skus.find((s) => doc.variants.some((v) => v.sku === s)) ?? null;
  },

  // why: getRelatedProducts only needs these 3 fields — avoids fetching full product document
  findForRelated: async (id) => {
    const doc = await Product.findOne(
      { _id: id, isActive: true, deletedAt: null },
      { categoryId: 1, brandId: 1, tags: 1 },
    ).lean();
    return doc;
  },
};
