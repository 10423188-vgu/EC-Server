import { prisma } from "../../configs/db/index.js";
import { USER_SELECT } from "../user/user.fields.js";

export const authPrismaRepository = {
  findAccessState: (id) =>
    prisma.user.findUnique({
      where: { id },
      select: { role: true, suspendedAt: true, sessionVersion: true },
    }),
  findByEmail: async (email) => {
    return prisma.user.findUnique({ where: { email }, select: USER_SELECT });
  },

  // why: the complete profile is derived after credential/MFA verification;
  // loading addresses here would repeat that relation query on every login.
  findByEmailWithPassword: async (email) => {
    return prisma.user.findUnique({
      where: { email },
      select: { id: true, role: true, password: true },
    });
  },

  create: async (data) => {
    return prisma.user.create({ data, select: USER_SELECT });
  },

  findByGoogleId: async (googleId) => {
    return prisma.user.findUnique({
      where: { googleId },
      select: { ...USER_SELECT, googleId: true },
    });
  },

  findByEmailForGoogle: async (email) => {
    return prisma.user.findUnique({
      where: { email },
      select: { ...USER_SELECT, googleId: true },
    });
  },

  createFromGoogle: async ({
    name,
    email,
    googleId,
    avatar,
    emailVerifiedAt,
  }) => {
    return prisma.user.create({
      data: { name, email, googleId, avatar, emailVerifiedAt },
      select: USER_SELECT,
    });
  },

  // why: compare-and-set prevents concurrent linking from replacing another Google identity
  // or linking an email that changed since the ownership check; a lost race raises P2025.
  linkGoogleId: async (id, { email, googleId, emailVerifiedAt }) => {
    return prisma.user.update({
      where: { id, email, googleId: null },
      data: { googleId, emailVerifiedAt },
      select: USER_SELECT,
    });
  },
};
