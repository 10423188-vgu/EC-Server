import { prisma } from "../../configs/db/index.js";
import { productMongoRepository } from "./product.mongo.repository.js";
import { buildProductFilter } from "./product.filter.js";
import {
  NotFoundError,
  BadRequestError,
} from "../../shared/errors/app.error.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const resolveCategoryBrand = async (categoryId, brandId) => {
  const [category, brand] = await Promise.all([
    categoryId
      ? prisma.category.findUnique({
          where: { id: categoryId },
          select: { id: true, name: true, slug: true },
        })
      : null,
    brandId
      ? prisma.brand.findUnique({
          where: { id: brandId },
          select: { id: true, name: true, slug: true },
        })
      : null,
  ]);

  if (categoryId && !category) throw new BadRequestError("Category not found");
  if (brandId && !brand) throw new BadRequestError("Brand not found");

  return {
    categoryId: category?.id ?? null,
    categorySlug: category?.slug ?? null,
    categoryName: category?.name ?? null,
    brandId: brand?.id ?? null,
    brandSlug: brand?.slug ?? null,
    brandName: brand?.name ?? null,
  };
};

// ─── Service ──────────────────────────────────────────────────────────────────

const validateVariantSale = (variant) => {
  if (variant.salePrice != null && variant.salePrice >= variant.price) {
    throw new BadRequestError("Sale price must be lower than price");
  }
};

export const productService = {
  getProducts: async (query) => {
    const {
      page = 1,
      limit = 12,
      sortBy = "createdAt",
      sortOrder = "desc",
      ...filters
    } = query;

    // why: Zod schema already coerces page/limit to numbers — parseInt is redundant
    const skip = (page - 1) * limit;
    const filter = buildProductFilter(filters);

    const { products, total } = await productMongoRepository.findAll({
      filter,
      sortField: sortBy,
      sortOrder,
      skip,
      take: limit,
    });

    return {
      data: products,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  },

  getProductById: async (id) => {
    const product = await productMongoRepository.findById(id);
    if (!product || !product.isActive) throw new NotFoundError("Product");
    return product;
  },

  getAdminProductById: async (id) => {
    const product = await productMongoRepository.findAdminById(id);
    if (!product) throw new NotFoundError("Product");
    return product;
  },

  createProduct: async (data) => {
    const { categoryId, brandId, variants, ...rest } = data;

    // why: single $in query vs N sequential checks — unique index is the real guard; this is a fast pre-check
    const skus = variants.map((v) => v.sku);
    if (new Set(skus).size !== skus.length)
      throw new BadRequestError("SKU must be unique within the product");
    variants.forEach(validateVariantSale);
    // why: SKU check (Mongo) and category/brand lookup (Postgres) are independent — run concurrently
    const [dupSku, denormalized] = await Promise.all([
      productMongoRepository.skuExistsAny(skus),
      resolveCategoryBrand(categoryId, brandId),
    ]);
    if (dupSku) throw new BadRequestError(`SKU "${dupSku}" already exists`);

    let product;
    try {
      product = await productMongoRepository.create({
        ...rest,
        ...denormalized,
        variants,
      });
    } catch (err) {
      // why: concurrent requests can pass the pre-check simultaneously — unique index catches duplicates at DB level
      if (err.code === 11000) {
        if (err.keyValue?.slug)
          throw new BadRequestError("Slug already exists");
        const dupSku = err.keyValue?.["variants.sku"] ?? "unknown";
        throw new BadRequestError(`SKU "${dupSku}" already exists`);
      }
      throw err;
    }

    return product;
  },

  updateProduct: async (id, data) => {
    const existing = await productMongoRepository.findById(id);
    if (!existing) throw new NotFoundError("Product");

    const { images, categoryId, brandId, ...rest } = data;

    let denormalized = {};
    if (categoryId !== undefined || brandId !== undefined) {
      denormalized = await resolveCategoryBrand(
        categoryId ?? existing.categoryId,
        brandId !== undefined ? brandId : existing.brandId,
      );
    }

    const updateData = {
      ...rest,
      ...(images !== undefined && { images }),
      ...denormalized,
    };

    let updated;
    try {
      updated = await productMongoRepository.update(id, updateData);
    } catch (error) {
      if (error.code === 11000)
        throw new BadRequestError("Slug already exists");
      throw error;
    }
    if (!updated) throw new NotFoundError("Product");

    // why: removed gallery URLs may still belong to variants or old order snapshots.
    // Detaching a photo from the gallery must not destroy its Cloudinary asset.

    return updated;
  },

  deleteProduct: async (id, deletedBy) => {
    const deleted = await productMongoRepository.delete(id, deletedBy);
    if (!deleted) throw new NotFoundError("Product");
    return deleted;
  },

  restoreProduct: async (id) => {
    const restored = await productMongoRepository.restore(id);
    if (!restored) throw new NotFoundError("Product");
    return restored;
  },

  createVariant: async (productId, data) => {
    validateVariantSale(data);
    // why: product existence and SKU-uniqueness are independent reads — run concurrently
    const [product, skuTaken] = await Promise.all([
      productMongoRepository.findById(productId),
      productMongoRepository.skuExists(data.sku),
    ]);
    if (!product) throw new NotFoundError("Product");
    if (skuTaken) {
      throw new BadRequestError(`SKU "${data.sku}" already exists`);
    }

    let result;
    try {
      result = await productMongoRepository.addVariant(productId, data);
    } catch (err) {
      // why: concurrent requests can pass the pre-check simultaneously — unique index catches duplicates at DB level
      if (err.code === 11000) {
        throw new BadRequestError(`SKU "${data.sku}" already exists`);
      }
      throw err;
    }
    if (!result) throw new NotFoundError("Product");
    return result;
  },

  updateVariant: async (productId, variantId, data) => {
    if (data.stock !== undefined) {
      throw new BadRequestError(
        "Use a stock adjustment instead of replacing stock",
      );
    }
    const variant = await productMongoRepository.findVariant(
      productId,
      variantId,
    );
    if (!variant) throw new NotFoundError("Variant");
    if (
      data.sku &&
      (await productMongoRepository.skuExists(data.sku, variantId))
    ) {
      throw new BadRequestError(`SKU "${data.sku}" already exists`);
    }
    const price = data.price ?? variant.price;
    const salePrice =
      data.salePrice === undefined ? variant.salePrice : data.salePrice;
    if (salePrice != null && salePrice >= price) {
      throw new BadRequestError("Sale price must be lower than price");
    }

    const { images, ...coreData } = data;
    if (images !== undefined) coreData.images = images;

    let updated;
    try {
      updated = await productMongoRepository.updateVariant(
        productId,
        variantId,
        coreData,
      );
    } catch (error) {
      if (error.code === 11000)
        throw new BadRequestError(`SKU "${data.sku}" already exists`);
      throw error;
    }

    if (!updated) throw new NotFoundError("Variant");
    return updated;
  },

  deleteVariant: async (productId, variantId, deletedBy) => {
    const variant = await productMongoRepository.findVariant(
      productId,
      variantId,
      { includeDeleted: true },
    );
    if (!variant) throw new NotFoundError("Variant");
    if (!variant.deletedAt) {
      const deleted = await productMongoRepository.deleteVariant(
        productId,
        variantId,
        deletedBy,
      );
      if (!deleted) throw new NotFoundError("Variant");
    }
  },

  restoreVariant: async (productId, variantId) => {
    const variant = await productMongoRepository.restoreVariant(
      productId,
      variantId,
    );
    if (!variant) throw new NotFoundError("Variant");
    return variant;
  },

  getRelatedProducts: async (id, limit) => {
    const source = await productMongoRepository.findForRelated(id);
    if (!source) throw new NotFoundError("Product");

    return productMongoRepository.findRelated(
      id,
      {
        categoryId: source.categoryId,
        brandId: source.brandId,
        tags: source.tags ?? [],
      },
      limit,
    );
  },
};
