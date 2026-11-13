import { prisma } from "../../configs/db/index.js";
import {
  getCatalogOverview,
  listCatalogRecords,
} from "../../shared/catalog/catalog-admin.js";
import { brandPrismaRepository } from "./brand.prisma.repository.js";
import { Product } from "../../models/product.model.js";
import { outboxRepository } from "../../shared/outbox/outbox.prisma.repository.js";
import { deleteFromCloudinary } from "../../shared/utils/cloudinary.util.js";
import { logger } from "../../shared/utils/logger.js";
import { NotFoundError, BadRequestError } from "../../shared/errors/app.error.js";

export const brandService = {
  overview: () => getCatalogOverview(prisma.brand, "brandId"),
  listAdmin: (query) => listCatalogRecords(prisma.brand, "brandId", query),
  getBrands: async ({ limit }) => {
    return brandPrismaRepository.findAll({ limit: limit ? Number(limit) : undefined });
  },

  getBrandBySlug: async (slug) => {
    const brand = await brandPrismaRepository.findBySlug(slug);
    if (!brand) throw new NotFoundError("Brand");
    return brand;
  },

  getBrandById: async (id) => {
    const brand = await brandPrismaRepository.findById(id);
    if (!brand) throw new NotFoundError("Brand");
    return brand;
  },

  createBrand: async (data) => {
    return brandPrismaRepository.create(data);
  },

  updateBrand: async (id, data) => {
    const existing = await brandPrismaRepository.findById(id);
    if (!existing) throw new NotFoundError("Brand");

    // why: Product documents denormalize brandName/brandSlug to avoid a cross-DB join on every
    // listing. A plain dual-write here could commit the Postgres rename and then fail the Mongo
    // write, leaving Product permanently stale — so the sync is queued as an outbox row in the
    // same Postgres transaction as the rename, and a background worker (outbox.worker.js)
    // relays it to Mongo with retries.
    const shouldSyncProducts = data.name !== undefined || data.slug !== undefined;
    const updated = await prisma.$transaction(async (tx) => {
      const updated = await brandPrismaRepository.update(id, data, tx);
      if (shouldSyncProducts) {
        await outboxRepository.enqueue(tx, {
          eventType: "brand.renamed",
          payload: { brandId: id, name: data.name, slug: data.slug },
        });
      }
      return updated;
    });

    // why: cleanup runs after the DB write succeeds, and fire-and-forget with logged errors, so
    // a Cloudinary failure never rolls back the update.
    if (
      data.logoUrl !== undefined &&
      existing.logoUrl &&
      data.logoUrl !== existing.logoUrl
    ) {
      deleteFromCloudinary(existing.logoUrl, "brands").catch((err) =>
        logger.error({ err }, "[Cloudinary] brand logo cleanup failed")
      );
    }

    return updated;
  },

  deleteBrand: async (id) => {
    const existing = await brandPrismaRepository.findById(id);
    if (!existing) throw new NotFoundError("Brand");

    const productCount = await Product.countDocuments({ brandId: id });
    if (productCount > 0) throw new BadRequestError("Cannot delete a brand that has existing products");

    const deleted = await brandPrismaRepository.delete(id);

    if (existing.logoUrl) {
      deleteFromCloudinary(existing.logoUrl, "brands").catch((err) =>
        logger.error({ err }, "[Cloudinary] brand logo cleanup failed")
      );
    }

    return deleted;
  },
};
