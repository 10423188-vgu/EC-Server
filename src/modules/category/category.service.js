import { prisma } from "../../configs/db/index.js";
import {
  getCatalogOverview,
  listCatalogRecords,
} from "../../shared/catalog/catalog-admin.js";
import { validateCategoryParent } from "./category.hierarchy.js";
import { categoryPrismaRepository } from "./category.prisma.repository.js";
import { Product } from "../../models/product.model.js";
import { outboxRepository } from "../../shared/outbox/outbox.prisma.repository.js";
import { deleteFromCloudinary } from "../../shared/utils/cloudinary.util.js";
import { logger } from "../../shared/utils/logger.js";
import {
  NotFoundError,
  BadRequestError,
} from "../../shared/errors/app.error.js";

export const categoryService = {
  overview: () => getCatalogOverview(prisma.category, "categoryId"),
  listAdmin: (query) => listCatalogRecords(prisma.category, "categoryId", query),

  parentOptions: () =>
    prisma.category.findMany({
      select: { id: true, name: true, parentId: true, isActive: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    }),
  getCategories: async ({ includeChildren, limit }) => {
    return categoryPrismaRepository.findAllRoots({
      includeChildren,
      limit: limit ? Number(limit) : undefined,
    });
  },

  getCategoryBySlug: async (slug) => {
    const category = await categoryPrismaRepository.findBySlug(slug);
    if (!category) throw new NotFoundError("Category");
    return category;
  },

  getCategoryById: async (id) => {
    const category = await categoryPrismaRepository.findById(id);
    if (!category) throw new NotFoundError("Category");
    return category;
  },

  createCategory: async (data) => {
    return prisma.$transaction(async (tx) => {
      await validateCategoryParent(tx, null, data.parentId);
      return categoryPrismaRepository.create(data, tx);
    });
  },

  updateCategory: async (id, data) => {
    const existing = await categoryPrismaRepository.findById(id);
    if (!existing) throw new NotFoundError("Category");

    // why: Product documents denormalize categoryName/categorySlug to avoid a cross-DB join on
    // every listing. A plain dual-write here could commit the Postgres rename and then fail the
    // Mongo write, leaving Product permanently stale — so the sync is queued as an outbox row in
    // the same Postgres transaction as the rename, and a background worker (outbox.worker.js)
    // relays it to Mongo with retries.
    const shouldSyncProducts = data.name !== undefined || data.slug !== undefined;
    const updated = await prisma.$transaction(async (tx) => {
      if (data.parentId !== undefined) {
        await validateCategoryParent(tx, id, data.parentId);
      }
      const updated = await categoryPrismaRepository.update(id, data, tx);
      if (shouldSyncProducts) {
        await outboxRepository.enqueue(tx, {
          eventType: "category.renamed",
          payload: { categoryId: id, name: data.name, slug: data.slug },
        });
      }
      return updated;
    });

    // why: cleanup runs after the DB write succeeds, and fire-and-forget with logged errors, so
    // a Cloudinary failure never rolls back the update.
    const cloudinaryCleanup = [];
    if (
      data.imageUrl !== undefined &&
      existing.imageUrl &&
      data.imageUrl !== existing.imageUrl
    ) {
      cloudinaryCleanup.push(deleteFromCloudinary(existing.imageUrl, "categories"));
    }
    if (
      data.videoUrl !== undefined &&
      existing.videoUrl &&
      data.videoUrl !== existing.videoUrl
    ) {
      cloudinaryCleanup.push(deleteFromCloudinary(existing.videoUrl, "categories"));
    }
    if (cloudinaryCleanup.length > 0) {
      Promise.all(cloudinaryCleanup).catch((err) =>
        logger.error({ err }, "[Cloudinary] category media cleanup failed")
      );
    }

    return updated;
  },

  deleteCategory: async (id) => {
    const existing = await categoryPrismaRepository.findById(id);
    if (!existing) throw new NotFoundError("Category");

    const [productCount, childCount] = await Promise.all([
      Product.countDocuments({ categoryId: id }),
      categoryPrismaRepository.countChildren(id),
    ]);

    if (childCount > 0)
      throw new BadRequestError("Cannot delete a category that has subcategories");
    if (productCount > 0)
      throw new BadRequestError("Cannot delete a category that has existing products");

    const deleted = await categoryPrismaRepository.delete(id);

    const cloudinaryCleanup = [];
    if (existing.imageUrl) cloudinaryCleanup.push(deleteFromCloudinary(existing.imageUrl, "categories"));
    if (existing.videoUrl) cloudinaryCleanup.push(deleteFromCloudinary(existing.videoUrl, "categories"));
    if (cloudinaryCleanup.length > 0) {
      Promise.all(cloudinaryCleanup).catch((err) =>
        logger.error({ err }, "[Cloudinary] category media cleanup failed")
      );
    }

    return deleted;
  },
};
