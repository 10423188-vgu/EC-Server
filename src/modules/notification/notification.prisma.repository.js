import { prisma } from "../../configs/db/index.js";

export const notificationPrismaRepository = {
  // why: outbox retries may find the notification already committed; a unique
  // event key makes that duplicate a successful no-op.
  create: async (data) => {
    try {
      return await prisma.notification.create({ data });
    } catch (err) {
      if (err?.code === "P2002") return null;
      throw err;
    }
  },

  findByUser: async (userId, { page, limit }) => {
    const where = { userId };
    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({ where: { userId, isRead: false } }),
    ]);
    return { notifications, total, unreadCount };
  },

  markRead: (id, userId) =>
    prisma.notification.updateMany({ where: { id, userId }, data: { isRead: true } }),

  markAllRead: (userId) =>
    prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } }),
};
