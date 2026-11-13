import { prisma } from "../../configs/db/index.js";

const ADDRESS_SELECT = {
  id: true,
  fullName: true,
  phone: true,
  street: true,
  ward: true,
  district: true,
  city: true,
  postalCode: true,
  countryCode: true,
  isDefault: true,
};

export const addressPrismaRepository = {
  count: (userId) => prisma.address.count({ where: { userId } }),

  create: async (userId, data) => {
    return prisma.address.create({ data: { ...data, userId }, select: ADDRESS_SELECT });
  },

  // why: resetting all defaults in the same transaction prevents a race condition where two concurrent requests both set isDefault: true.
  createAtomic: async (userId, data) => {
    const [, created] = await prisma.$transaction([
      prisma.address.updateMany({ where: { userId }, data: { isDefault: false } }),
      prisma.address.create({ data: { ...data, userId }, select: ADDRESS_SELECT }),
    ]);
    return created;
  },

  update: async (id, userId, data) => {
    return prisma.address.update({ where: { id, userId }, data, select: ADDRESS_SELECT });
  },

  updateAtomic: async (id, userId, data) => {
    const [, updated] = await prisma.$transaction([
      prisma.address.updateMany({ where: { userId }, data: { isDefault: false } }),
      prisma.address.update({ where: { id, userId }, data, select: ADDRESS_SELECT }),
    ]);
    return updated;
  },

  // why: deleting the default address must not leave the user with zero defaults —
  // promote another remaining address so checkout's "find default" lookup keeps working.
  // Returns which address (if any) got promoted so callers don't have to guess.
  deleteAtomic: async (id, userId) => {
    return prisma.$transaction(async (tx) => {
      const deleted = await tx.address.delete({ where: { id, userId }, select: { isDefault: true } });
      if (!deleted.isDefault) return { promoted: null };

      const fallback = await tx.address.findFirst({ where: { userId } });
      if (!fallback) return { promoted: null };

      const promoted = await tx.address.update({
        where: { id: fallback.id },
        data: { isDefault: true },
        select: ADDRESS_SELECT,
      });
      return { promoted };
    });
  },

  setDefaultAtomic: async (addressId, userId) => {
    const [, updated] = await prisma.$transaction([
      prisma.address.updateMany({
        where: { userId },
        data: { isDefault: false },
      }),
      prisma.address.update({
        where: { id: addressId, userId },
        data: { isDefault: true },
        select: ADDRESS_SELECT,
      }),
    ]);
    return updated;
  },
};
