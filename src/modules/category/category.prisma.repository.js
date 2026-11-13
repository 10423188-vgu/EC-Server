import { prisma } from "../../configs/db/index.js";
import {
  CATEGORY_BASE_FIELDS,
  CATEGORY_PUBLIC_SELECT,
  CATEGORY_ADMIN_SELECT,
} from "./category.fields.js";

export const categoryPrismaRepository = {
  findAllRoots: async ({ includeChildren, limit }) => {
    return prisma.category.findMany({
      where: { isActive: true, parentId: null },
      select: includeChildren ? CATEGORY_PUBLIC_SELECT : CATEGORY_BASE_FIELDS,
      orderBy: { name: "asc" },
      ...(limit && { take: limit }),
    });
  },

  findBySlug: async (slug) => {
    return prisma.category.findUnique({
      where: { slug },
      select: CATEGORY_PUBLIC_SELECT,
    });
  },

  findById: async (id) => {
    return prisma.category.findUnique({
      where: { id },
      select: CATEGORY_ADMIN_SELECT,
    });
  },

  create: async (data, tx = prisma) => {
    return tx.category.create({ data, select: CATEGORY_ADMIN_SELECT });
  },

  update: async (id, data, tx = prisma) => {
    return tx.category.update({
      where: { id },
      data,
      select: CATEGORY_ADMIN_SELECT,
    });
  },

  delete: async (id) => {
    return prisma.category.delete({ where: { id } });
  },

  countChildren: async (id) => {
    return prisma.category.count({ where: { parentId: id } });
  },
};
