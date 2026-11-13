import { prisma } from "../../configs/db/index.js";
import { BRAND_BASE_FIELDS, BRAND_ADMIN_SELECT } from "./brand.fields.js";

export const brandPrismaRepository = {
  findAll: async ({ limit }) => {
    return prisma.brand.findMany({
      where: { isActive: true },
      select: BRAND_BASE_FIELDS,
      orderBy: { name: "asc" },
      ...(limit && { take: limit }),
    });
  },

  findBySlug: async (slug) => {
    return prisma.brand.findUnique({
      where: { slug },
      select: BRAND_BASE_FIELDS,
    });
  },

  findById: async (id) => {
    return prisma.brand.findUnique({
      where: { id },
      select: BRAND_ADMIN_SELECT,
    });
  },

  create: async (data) => {
    return prisma.brand.create({ data, select: BRAND_ADMIN_SELECT });
  },

  update: async (id, data, tx = prisma) => {
    return tx.brand.update({
      where: { id },
      data,
      select: BRAND_ADMIN_SELECT,
    });
  },

  delete: async (id) => {
    return prisma.brand.delete({ where: { id } });
  },
};
