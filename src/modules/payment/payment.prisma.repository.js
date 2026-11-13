import { prisma } from "../../configs/db/index.js";

export const paymentPrismaRepository = {
  findByOrderId: (orderId) =>
    prisma.payment.findUnique({ where: { orderId } }),
};
